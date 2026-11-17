import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { TEAM_ROSTER } from '../src/data/team.ts';
import {
  acknowledgeMemberReport,
  getJob,
  getWorkflowState,
  listInvites,
  listMemberReports,
  listTasks,
  registerOrUpdateDevice,
  resolveAuthorizedMember,
  saveMemberReport,
  saveWorkflowState,
  updateMemberProfile,
  upsertInvite,
  verifyWorkerToken,
} from '../src/server/firestoreStore.ts';
import {
  approvedDocumentPlan,
  classifyMail,
  filterComments,
  planMail,
  wordCount,
} from '../src/server/mailWorkflow.ts';
import {
  assignWaitingJob,
  claimNextTaskForWorker,
  completeWorkerTask,
  createOrchestratedJob,
  expireStaleLeases,
  failWorkerTask,
  handleDeviceHeartbeat,
  replyToWaitingJob,
  retryJob,
  toggleReportClosed,
} from '../src/server/orchestrator.ts';
import { ingestMailMessages, toggleDailySchedule } from '../src/server/scheduler.ts';

const require = createRequire(import.meta.url);
const mcp = require('../worker/project-docs-mcp.cjs') as {
  checked: (p: string) => string;
  call: (name: string, args: Record<string, unknown>) => Promise<Array<{ type: string; text: string }>>;
};

const DATA_STATE = path.resolve(process.cwd(), '.office-data', 'runtime-state.json');

async function runTests() {
  // Clean slate for deterministic isolated test run
  const backup = fs.existsSync(DATA_STATE) ? fs.readFileSync(DATA_STATE, 'utf8') : null;
  if (fs.existsSync(DATA_STATE)) fs.unlinkSync(DATA_STATE);

  try {
    console.log('1. Checking immutable team.json models & roles...');
    const byId = Object.fromEntries(TEAM_ROSTER.agents.map((a) => [a.id, a]));
    assert.equal(byId.linh.model, 'gpt-6.1-sol');
    assert.equal(byId.hung.model, 'gpt-6.1-terra');
    assert.equal(byId.thinh.model, 'gpt-6.1-sol');
    assert.equal(byId.tien.model, 'gpt-6.1-sol');
    assert.equal(byId.hoa.model, 'gpt-6.1-terra');
    assert.equal(byId.my.model, 'gpt-6.1-terra');
    assert.equal(byId.my.serviceTier, 'priority');
    assert.equal(byId.dang.model, 'gpt-6-astra');
    assert.equal(byId.bach.model, 'gpt-6.1-sol');
    assert.equal(TEAM_ROSTER.owner.isOwner, true);
    assert.equal(TEAM_ROSTER.workflow.maxActiveJobs, 1);
    assert.equal(TEAM_ROSTER.workflow.maxReviewRounds, 3);
    assert.equal(TEAM_ROSTER.workflow.timeoutMinutesPerStep, 20);

    console.log('2. Checking job waits when field PC worker is offline...');
    const job1 = await createOrchestratedJob({
      request: 'Kiểm tra phối hợp MEPF trục B1',
      targetAgent: 'bach',
      createdByUid: 'uid-duc',
      createdByEmail: 'minhduc@pmh.com.vn',
    });
    assert.equal(job1.status, 'waiting_device');

    console.log('3. Checking device registration, token verification, & heartbeat...');
    const deviceSecret = 'test-secret-' + crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    await registerOrUpdateDevice(
      {
        deviceId: 'test-site-pc-01',
        label: 'May Test Cong Truong',
        status: 'online',
        revoked: false,
        codexAvailable: true,
        desktopUnlocked: true,
        lastHeartbeatAt: now,
        createdAt: now,
        updatedAt: now,
      },
      deviceSecret,
    );
    assert.equal(verifyWorkerToken('test-site-pc-01', deviceSecret), true);
    assert.equal(verifyWorkerToken('test-site-pc-01', 'wrong-secret'), false);

    await handleDeviceHeartbeat({
      deviceId: 'test-site-pc-01',
      label: 'May Test Cong Truong',
      codexAvailable: true,
      desktopUnlocked: true,
    });

    console.log('4. Testing full Linh -> Specialists -> Dang (revision) -> Duc flow...');
    const taskPlan1 = await claimNextTaskForWorker('test-site-pc-01');
    assert.ok(taskPlan1);
    assert.equal(taskPlan1.kind, 'codex_plan');
    assert.equal(taskPlan1.agentId, 'linh');
    assert.equal(taskPlan1.model, 'gpt-6.1-sol');

    // Linh asks for clarification
    const waitingJob = await completeWorkerTask({
      taskId: taskPlan1.id,
      deviceId: 'test-site-pc-01',
      outputText: JSON.stringify({
        summary: 'Cần xác nhận bản vẽ MEPF rev mới nhất',
        questions: ['Anh xác nhận đang dùng Rev C hay Rev D?'],
        tasks: [],
      }),
    });
    assert.equal(waitingJob?.status, 'waiting_input');

    // Duc replies
    await replyToWaitingJob(job1.id, 'Dùng Rev D theo thư ngày 16/11.');
    const taskPlan2 = await claimNextTaskForWorker('test-site-pc-01');
    assert.ok(taskPlan2);
    await completeWorkerTask({
      taskId: taskPlan2.id,
      deviceId: 'test-site-pc-01',
      outputText: JSON.stringify({
        summary: 'Kiểm tra MEPF trục B1 (Rev D)',
        questions: [],
        tasks: [
          { agent: 'bach', instruction: 'Kiểm tra hệ thống điện/HVAC trục B1' },
          { agent: 'my', instruction: 'Đối chiếu danh mục Rev D' },
        ],
      }),
    });

    // Bach completes specialist task
    const taskBach = await claimNextTaskForWorker('test-site-pc-01');
    assert.ok(taskBach);
    assert.equal(taskBach.agentId, 'bach');
    await completeWorkerTask({
      taskId: taskBach.id,
      deviceId: 'test-site-pc-01',
      outputText: 'Bách đã kiểm tra tuyến ống HVAC & thang cáp trục B1 (chưa thấy xung đột lớn).',
    });

    // My completes specialist task (priority tier preserved)
    const taskMy = await claimNextTaskForWorker('test-site-pc-01');
    assert.ok(taskMy);
    assert.equal(taskMy.agentId, 'my');
    assert.equal(taskMy.model, 'gpt-6.1-terra');
    assert.equal(taskMy.serviceTier, 'priority');
    await completeWorkerTask({
      taskId: taskMy.id,
      deviceId: 'test-site-pc-01',
      outputText: 'My xác nhận Rev D là bản phát hành hợp lệ trên CHECK.',
    });

    // Dang reviews round 1 -> asks Bach to revise
    const taskDang1 = await claimNextTaskForWorker('test-site-pc-01');
    assert.ok(taskDang1);
    assert.equal(taskDang1.kind, 'codex_review');
    assert.equal(taskDang1.agentId, 'dang');
    assert.equal(taskDang1.model, 'gpt-6-astra');
    await completeWorkerTask({
      taskId: taskDang1.id,
      deviceId: 'test-site-pc-01',
      outputText: JSON.stringify({
        approved: false,
        summary: 'Thiếu trích dẫn số trang bản vẽ của Bách',
        questions: [],
        revisions: [{ agent: 'bach', instruction: 'Bổ sung tên file và số trang bản vẽ đã xem.' }],
      }),
    });

    // Bach revises
    const taskBachRev = await claimNextTaskForWorker('test-site-pc-01');
    assert.ok(taskBachRev);
    assert.equal(taskBachRev.kind, 'codex_revise');
    await completeWorkerTask({
      taskId: taskBachRev.id,
      deviceId: 'test-site-pc-01',
      outputText: 'Đã bổ sung dẫn chứng: MEP-B1-RevD.pdf trang 2 và trang 5.',
    });

    // Dang reviews round 2 -> approves
    const taskDang2 = await claimNextTaskForWorker('test-site-pc-01');
    assert.ok(taskDang2);
    await completeWorkerTask({
      taskId: taskDang2.id,
      deviceId: 'test-site-pc-01',
      outputText: JSON.stringify({
        approved: true,
        summary: 'Đủ căn cứ và phạm vi rõ ràng.',
        questions: [],
        revisions: [],
      }),
    });

    const completed = getJob(job1.id)!;
    assert.equal(completed.status, 'completed');
    assert.equal(completed.history?.length, 1);
    assert.equal(completed.results?.find((r) => r.agent === 'bach')?.version, 2);

    // Owner closes & reopens report
    const closed = await toggleReportClosed(job1.id, true, 'uid-duc');
    assert.ok(closed.ownerClosedAt);
    const reopened = await toggleReportClosed(job1.id, false, 'uid-duc');
    assert.equal(reopened.ownerClosedAt, null);

    console.log('5. Testing desktop_locked & retry & device revocation...');
    const job2 = await createOrchestratedJob({
      request: 'Kiểm tra trạng thái khóa màn hình',
      targetAgent: 'linh',
      createdByUid: 'uid-duc',
      createdByEmail: 'minhduc@pmh.com.vn',
    });
    const t2 = await claimNextTaskForWorker('test-site-pc-01');
    assert.ok(t2);
    const lockedJob = await failWorkerTask({
      taskId: t2.id,
      deviceId: 'test-site-pc-01',
      error: 'Màn hình Windows đang khóa.',
      code: 'desktop_locked',
    });
    assert.equal(lockedJob?.status, 'waiting_input');

    // Device revocation blocks further authentication immediately
    await registerOrUpdateDevice({
      deviceId: 'test-site-pc-01',
      label: 'May Test Cong Truong',
      status: 'revoked',
      revoked: true,
      codexAvailable: true,
      desktopUnlocked: true,
      lastHeartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
    assert.equal(verifyWorkerToken('test-site-pc-01', deviceSecret), false);
    await expireStaleLeases();

    console.log('6. Testing mail workflow branches, >10 word filter, Section 6 & dedupe...');
    assert.equal(wordCount('Một hai ba bốn năm sáu bảy tám chín mười'), 10);
    assert.equal(wordCount('Một hai ba bốn năm sáu bảy tám chín mười một'), 11);
    const filtered = filterComments([
      { text: '1 2 3 4 5 6 7 8 9 10', author: 'A', sourceUrl: 'https://spm.example/1' },
      { text: '1 2 3 4 5 6 7 8 9 10 11', author: 'B', sourceUrl: 'https://spm.example/2' },
    ]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].author, 'B');

    const rulesConfig = {
      ...((await import('../src/server/mailWorkflow.ts')).MAIL_WORKFLOW_RULES),
      mailboxEmail: 'minhduc@pmh.com.vn',
      spmSenderAddresses: ['de.spm@example.com'],
      downloadRoot: 'C:\\Users\\duc\\Downloads\\CHECK',
    };
    assert.equal(
      classifyMail({ id: 'm1', from: 'minhduc@pmh.com.vn', subject: 'Hồ sơ mới vừa được trình' }, rulesConfig)
        .branch,
      'new_submission',
    );
    assert.equal(
      classifyMail({ id: 'm2', from: 'de.spm@example.com', subject: 'de.spm Approval Work Notification' }, rulesConfig)
        .branch,
      'approval_work',
    );
    assert.equal(
      classifyMail({ id: 'm3', from: 'de.spm@example.com', subject: 'de.spm Case Closing Notice' }, rulesConfig)
        .branch,
      'case_closing',
    );
    assert.equal(
      classifyMail({ id: 'm4', from: 'partner@example.com', subject: 'Lịch họp tuần sau' }, rulesConfig)
        .branch,
      'other_mail',
    );

    const commentText = 'Đồng ý theo phương án đã chỉnh sửa tại mặt bằng tầng 2.';
    const sourceHash = crypto.createHash('sha256').update(commentText).digest('hex');
    const sec6Ready = approvedDocumentPlan(
      {
        id: 'm2',
        from: 'de.spm@example.com',
        subject: 'Approval Work Notification',
        caseId: 'CASE-CN82-009',
        revision: 'R2',
        ownerApproval: {
          reviewerName: 'Võ Minh Đức',
          documentIdentityVerified: true,
          proofSource: 'https://drive.google.com/file/d/sample',
          spmAlreadyHandled: false,
          spmHistoryVerified: true,
          pendingForReviewerVerified: true,
          documentVersionKey: 'v2',
          watermark: { verified: true, page: 1, position: 'top_right', text: 'CN8-2' },
          comment: {
            text: commentText,
            section: 'Client Comment & Approval',
            page: 1,
            belongsToReviewerVerified: true,
          },
          translation: {
            text: 'Agreed per revised layout on level 2.',
            sourceHash,
            verified: true,
          },
        },
      },
      rulesConfig,
    );
    assert.equal(sec6Ready?.status, 'ready_for_approved_submission');

    const sec6Already = approvedDocumentPlan(
      {
        id: 'm2b',
        from: 'de.spm@example.com',
        subject: 'Approval Work Notification',
        caseId: 'CASE-CN82-009',
        revision: 'R2',
        ownerApproval: {
          reviewerName: 'Võ Minh Đức',
          documentIdentityVerified: true,
          proofSource: 'https://drive.google.com/file/d/sample',
          spmAlreadyHandled: true,
          spmHistoryVerified: true,
          handledAt: '2026-11-16T10:00:00Z',
          watermark: { verified: true, page: 1, position: 'top_right', text: 'CN8-2' },
        },
      },
      rulesConfig,
    );
    assert.equal(sec6Already?.status, 'already_handled');

    console.log('7. Testing 21:00 schedule guard & messageId deduplication...');
    const wf = getWorkflowState();
    assert.equal(wf.enabled, false);
    assert.equal(wf.testedAndConfirmed, false);
    await assert.rejects(() => toggleDailySchedule({ enabled: true }), /Chưa thể bật lịch 21:00/);

    const ingest1 = await ingestMailMessages({
      messages: [
        {
          id: 'msg-dedupe-001',
          from: 'partner@example.com',
          subject: 'Biên bản họp giao ban tuần 46',
          receivedAt: '2026-11-16T08:00:00Z',
        },
      ],
      createdByUid: 'uid-duc',
      createdByEmail: 'minhduc@pmh.com.vn',
    });
    assert.equal(ingest1[0].status, 'ready_to_summarize');
    assert.ok(ingest1[0].jobId);

    const ingest2 = await ingestMailMessages({
      messages: [
        {
          id: 'msg-dedupe-001',
          from: 'partner@example.com',
          subject: 'Biên bản họp giao ban tuần 46',
          receivedAt: '2026-11-16T08:00:00Z',
        },
      ],
      createdByUid: 'uid-duc',
      createdByEmail: 'minhduc@pmh.com.vn',
    });
    assert.equal(ingest2[0].status, 'duplicate_skipped');
    assert.equal(ingest2[0].jobId, ingest1[0].jobId);

    // Retry works cleanly on failed job
    const failJob = await createOrchestratedJob({
      request: 'Kiểm thử retry',
      createdByUid: 'uid-duc',
      createdByEmail: 'minhduc@pmh.com.vn',
    });
    failJob.status = 'failed';
    const retried = await retryJob(failJob.id, 'Thử lại sau khi kiểm tra');
    assert.equal(retried.status, 'waiting_device');

    console.log('8. Testing read-only MCP path sandboxing...');
    const allowedText = await mcp.call('read_project_text', {
      path: path.resolve(process.cwd(), 'worker', 'worker.local.example.json'),
      start_line: 1,
      max_lines: 5,
    });
    assert.ok(allowedText[0].text.includes('serverUrl'));
    assert.throws(() => mcp.checked('/etc/passwd'), /Ngoài phạm vi/);
    assert.throws(
      () => mcp.checked(path.resolve(process.cwd(), 'server.ts')),
      /Ngoài phạm vi/,
    );

    console.log('9. Testing live HTTP API security on port 3000...');
    const healthRes = await fetch('http://localhost:3000/api/health');
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { ok: boolean; authRequired: boolean };
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.authRequired, true);

    const unauthTeam = await fetch('http://localhost:3000/api/team');
    assert.equal(unauthTeam.status, 401);

    const unauthJobs = await fetch('http://localhost:3000/api/jobs');
    assert.equal(unauthJobs.status, 401);

    const unauthPost = await fetch('http://localhost:3000/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: 'test' }),
    });
    assert.equal(unauthPost.status, 401);

    const fakeAuth = await fetch('http://localhost:3000/api/team', {
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    });
    assert.equal(fakeAuth.status, 401);

    const unauthWorker = await fetch('http://localhost:3000/api/worker/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(unauthWorker.status, 401);

    const badScheduler = await fetch('http://localhost:3000/api/scheduler/tick', {
      method: 'POST',
      headers: { 'X-Scheduler-Secret': 'wrong' },
    });
    assert.equal(badScheduler.status, 403);

    // Verify default schedule remains paused
    await saveWorkflowState({ ...getWorkflowState(), enabled: false, testedAndConfirmed: false });

    console.log('10. Testing Nghia (Quan ly du an) & Duc (Thanh vien Quan ly du an + cap quyen) roles, Linh->Duc waiting_owner_assignment & reports...');
    const invites = listInvites();
    const nghiaInvite = invites.find((inv) => inv.email === 'trongnghia@pmh.com.vn');
    assert.ok(nghiaInvite && nghiaInvite.active && nghiaInvite.role === 'member');
    assert.equal(nghiaInvite.roleTitle, 'Quản lý dự án');

    // Auto-provision minhduc@pmh.com.vn as Thanh vien Quan ly du an with exclusive access-granting privilege
    const ducCtx = await resolveAuthorizedMember({
      uid: 'uid-duc',
      email: 'minhduc@pmh.com.vn',
      emailVerified: true,
      name: 'Võ Minh Đức',
      idToken: '',
    });
    assert.equal(ducCtx.role, 'owner');
    assert.equal(ducCtx.member.roleTitle, 'Thành viên Quản lý dự án');
    assert.equal(ducCtx.member.canManageAccess, true);

    // Auto-provision trongnghia@pmh.com.vn as Quan ly du an WITHOUT access-granting privilege
    const nghiaCtx = await resolveAuthorizedMember({
      uid: 'uid-nghia',
      email: 'trongnghia@pmh.com.vn',
      emailVerified: true,
      name: 'Trọng Nghĩa',
      idToken: '',
    });
    assert.equal(nghiaCtx.role, 'member');
    assert.equal(nghiaCtx.member.roleTitle, 'Quản lý dự án');
    assert.equal(nghiaCtx.member.canManageAccess, false);
    assert.equal(nghiaCtx.member.nameSetAt, null);
    const updatedNghia = await updateMemberProfile('uid-nghia', 'Nguyễn Trọng Nghĩa');
    assert.equal(updatedNghia.displayName, 'Nguyễn Trọng Nghĩa');
    assert.equal(updatedNghia.roleTitle, 'Quản lý dự án');
    assert.equal(updatedNghia.canManageAccess, false);
    assert.ok(updatedNghia.nameSetAt);

    // Uninvited email must be rejected
    await assert.rejects(
      () =>
        resolveAuthorizedMember({
          uid: 'uid-stranger',
          email: 'stranger@example.com',
          emailVerified: true,
          idToken: '',
        }),
      /chưa được Đức cấp quyền/,
    );

    // Bring a worker device online to prove member submissions STILL wait for Duc instead of running Codex
    await registerOrUpdateDevice({
      deviceId: 'test-site-pc-02',
      label: 'May Test Online',
      status: 'online',
      revoked: false,
      codexAvailable: true,
      desktopUnlocked: true,
      lastHeartbeatAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const tasksBeforeMemberJob = listTasks().length;
    const memberJob = await createOrchestratedJob({
      request: 'Kiểm tra tiến độ MEPF khu vực hầm B1',
      targetAgent: 'bach', // Even if client requests bach, member role forces Linh -> Duc
      createdByUid: 'uid-nghia',
      createdByEmail: 'trongnghia@pmh.com.vn',
      createdByRole: 'member',
      createdByName: 'Nguyễn Trọng Nghĩa',
    });
    assert.equal(memberJob.targetAgent, 'linh');
    assert.equal(memberJob.status, 'waiting_owner_assignment');
    assert.equal(listTasks().length, tasksBeforeMemberJob, 'No worker task should be queued until Duc assigns');

    // Duc delegates memberJob to Bach with a note
    const delegatedJob = await assignWaitingJob({
      jobId: memberJob.id,
      targetAgent: 'bach',
      note: 'Bách kiểm tra trực tiếp hồ sơ B1 rồi báo cáo lại.',
      assignedByUid: 'uid-duc',
    });
    assert.equal(delegatedJob.targetAgent, 'bach');
    assert.equal(delegatedJob.assignedByUid, 'uid-duc');
    assert.ok(delegatedJob.assignedAt);
    assert.equal(delegatedJob.status, 'working');
    assert.equal(listTasks().length, tasksBeforeMemberJob + 1);
    const delegatedTask = await claimNextTaskForWorker('test-site-pc-02');
    assert.ok(delegatedTask);
    assert.equal(delegatedTask.jobId, memberJob.id);
    assert.equal(delegatedTask.agentId, 'bach');
    assert.equal(delegatedTask.kind, 'codex_specialist');

    // Duc sends a report to Nghia's left-corner workstation
    const reportNow = new Date().toISOString();
    const savedReport = await saveMemberReport({
      id: 'rep-test-01',
      recipientEmail: 'trongnghia@pmh.com.vn',
      recipientName: 'Trọng Nghĩa',
      title: 'Báo cáo kiểm traMEP tầng hầm B1',
      content: 'Anh đã duyệt phương án thi công MEPF tầng hầm B1.',
      sourceJobId: memberJob.id,
      sentByUid: 'uid-duc',
      sentByEmail: 'minhduc@pmh.com.vn',
      sentByName: 'Võ Minh Đức',
      acknowledgedAt: null,
      createdAt: reportNow,
      updatedAt: reportNow,
    });
    assert.ok(savedReport.allowedUids?.includes('uid-nghia'));
    assert.equal(listMemberReports('trongnghia@pmh.com.vn').length, 1);

    // Other member cannot ack Nghia's report
    await assert.rejects(
      () => acknowledgeMemberReport(savedReport.id, 'other@pmh.com.vn', false),
      /không có quyền xác nhận/,
    );

    // Nghia acknowledges receipt
    const ackedReport = await acknowledgeMemberReport(savedReport.id, 'trongnghia@pmh.com.vn', false);
    assert.ok(ackedReport.acknowledgedAt);

    // Revoke test invite toggle check
    const testInvite = await upsertInvite({
      id: 'invite-test',
      email: 'temp@pmh.com.vn',
      role: 'viewer',
      active: false,
      createdAt: reportNow,
      updatedAt: reportNow,
    });
    assert.equal(testInvite.active, false);

    console.log('\nALL HYBRID ARCHITECTURE + LIVE HTTP SECURITY TESTS PASSED!');
  } finally {
    // Restore original state (or keep runtime clean without test artifacts)
    if (backup !== null) {
      fs.writeFileSync(DATA_STATE, backup);
    } else if (fs.existsSync(DATA_STATE)) {
      fs.unlinkSync(DATA_STATE);
    }
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
