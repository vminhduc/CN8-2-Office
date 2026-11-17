import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { TEAM_ROSTER } from './src/data/team.ts';
import { getDashboardData, isLiveSheetConfigured } from './src/server/dashboardData.ts';
import {
  OWNER_EMAIL,
  verifyFirebaseIdToken,
  type AuthorizedContext,
} from './src/server/firebaseAuth.ts';
import {
  acknowledgeMemberReport,
  DEFAULT_ALLOWED_MEMBER_EMAIL,
  getJob,
  getOnlineDevices,
  getWorkflowState,
  hasAdminFirestore,
  hydrateFromFirestore,
  inviteIdForEmail,
  listDevices,
  listInvites,
  listJobs,
  listMemberReports,
  listMembers,
  notifyClients,
  registerOrUpdateDevice,
  resolveAuthorizedMember,
  saveMemberReport,
  saveWorkflowState,
  subscribeStateUpdates,
  updateMemberProfile,
  upsertInvite,
  upsertMember,
  verifyWorkerToken,
} from './src/server/firestoreStore.ts';
import { MAIL_WORKFLOW_RULES, planMail } from './src/server/mailWorkflow.ts';
import {
  assignWaitingJob,
  claimNextTaskForWorker,
  completeWorkerTask,
  createOrchestratedJob,
  failWorkerTask,
  handleDeviceHeartbeat,
  replyToWaitingJob,
  retryJob,
  toggleReportClosed,
} from './src/server/orchestrator.ts';
import {
  ingestMailMessages,
  startServerMailScheduler,
  toggleDailySchedule,
  triggerScheduledMailCheck,
} from './src/server/scheduler.ts';
import type { AgentId, MemberReport, MemberRole, WorkerDevice } from './src/types/office.ts';

const PORT = Number(process.env.PORT || 3000);

interface AuthedRequest extends Request {
  authContext?: AuthorizedContext;
  workerDeviceId?: string;
}

async function requireMemberAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Support SSE EventSource passing token in Authorization header or ?token=
    const authHeader =
      req.headers.authorization ||
      (typeof req.query.token === 'string' && req.query.token
        ? `Bearer ${req.query.token}`
        : undefined);
    const verified = await verifyFirebaseIdToken(authHeader);
    const ctx = await resolveAuthorizedMember(verified);
    req.authContext = ctx;
    next();
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Yêu cầu đăng nhập Google hợp lệ.';
    const status = msg.includes('chưa được cấp quyền') ? 403 : 401;
    res.status(status).json({ error: msg });
  }
}

function requireRole(allowed: MemberRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const ctx = req.authContext;
    if (!ctx || !allowed.includes(ctx.role)) {
      res.status(403).json({
        error: 'Chỉ Đức (Thành viên Quản lý dự án) hoặc thành viên được phân quyền mới có thể thực hiện thao tác này.',
      });
      return;
    }
    next();
  };
}

function requireAccessAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const ctx = req.authContext;
  if (!ctx || ctx.user.email.toLowerCase() !== OWNER_EMAIL) {
    res.status(403).json({
      error: 'Chỉ Đức (minhduc@pmh.com.vn) mới có chức năng cấp quyền.',
    });
    return;
  }
  next();
}

function requireWorkerAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const deviceId = String(req.headers['x-worker-device-id'] || '').trim();
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (!deviceId || !/^[a-zA-Z0-9._-]{3,80}$/.test(deviceId) || !token) {
    res.status(401).json({ error: 'Thiếu thông tin định danh cầu nối Windows.' });
    return;
  }
  if (!verifyWorkerToken(deviceId, token)) {
    res.status(403).json({
      error: 'Thiết bị chưa được cấp phép hoặc đã bị thu hồi quyền.',
    });
    return;
  }
  req.workerDeviceId = deviceId;
  next();
}

async function startServer() {
  await hydrateFromFirestore();
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '512kb' }));

  const configuredHosts = new Set<string>();
  for (const envUrl of [process.env.APP_URL, process.env.SHARED_APP_URL]) {
    if (!envUrl) continue;
    try {
      configuredHosts.add(new URL(envUrl).host.toLowerCase());
    } catch {
      // ignore invalid URL env
    }
  }

  // Same-origin guard for browser requests (proxy-aware via x-forwarded-host / APP_URL)
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originHost = new URL(origin).host.toLowerCase();
        const allowedHosts = new Set<string>(configuredHosts);
        if (req.headers.host) {
          allowedHosts.add(String(req.headers.host).trim().toLowerCase());
        }
        const forwardedHost = req.headers['x-forwarded-host'];
        if (forwardedHost) {
          for (const h of String(forwardedHost).split(',')) {
            const clean = h.trim().toLowerCase();
            if (clean) allowedHosts.add(clean);
          }
        }
        if (!allowedHosts.has(originHost)) {
          res.status(403).json({
            error: `Nguồn yêu cầu không hợp lệ (${originHost}).`,
          });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
        return;
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Public health ping (non-sensitive metadata only)
  app.get('/api/health', (_req, res) => {
    const online = getOnlineDevices();
    res.json({
      ok: true,
      authRequired: true,
      onlineWorkers: online.length,
      adminFirestore: hasAdminFirestore(),
    });
  });

  // =========================================================================
  // Windows Background Bridge Endpoints (Outbound HTTPS from site PC only)
  // No arbitrary shell execution API is exposed.
  // =========================================================================
  app.post('/api/worker/heartbeat', requireWorkerAuth, async (req: AuthedRequest, res) => {
    try {
      const deviceId = req.workerDeviceId!;
      const label = String(req.body?.label || deviceId).slice(0, 120);
      const codexAvailable = Boolean(req.body?.codexAvailable);
      const desktopUnlocked = req.body?.desktopUnlocked !== false;
      const activeTaskId =
        typeof req.body?.activeTaskId === 'string' ? req.body.activeTaskId : null;

      const device = await handleDeviceHeartbeat({
        deviceId,
        label,
        codexAvailable,
        desktopUnlocked,
        activeTaskId,
      });
      res.json({ ok: true, device });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Heartbeat không hợp lệ.',
      });
    }
  });

  app.post('/api/worker/claim', requireWorkerAuth, async (req: AuthedRequest, res) => {
    try {
      const task = await claimNextTaskForWorker(req.workerDeviceId!);
      res.json({ task });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Không lấy được tác vụ.',
      });
    }
  });

  app.post('/api/worker/complete', requireWorkerAuth, async (req: AuthedRequest, res) => {
    try {
      const { taskId, outputText, modelUsed, sourcesRead, uncheckedScope } = req.body || {};
      if (typeof taskId !== 'string' || typeof outputText !== 'string') {
        res.status(400).json({ error: 'Thiếu taskId hoặc nội dung kết quả.' });
        return;
      }
      const job = await completeWorkerTask({
        taskId,
        deviceId: req.workerDeviceId!,
        outputText,
        modelUsed: typeof modelUsed === 'string' ? modelUsed : undefined,
        sourcesRead: Array.isArray(sourcesRead) ? sourcesRead.map(String) : undefined,
        uncheckedScope: typeof uncheckedScope === 'string' ? uncheckedScope : undefined,
      });
      res.json({ ok: true, job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không cập nhật được kết quả tác vụ.',
      });
    }
  });

  app.post('/api/worker/fail', requireWorkerAuth, async (req: AuthedRequest, res) => {
    try {
      const { taskId, error, code } = req.body || {};
      if (typeof taskId !== 'string' || typeof error !== 'string') {
        res.status(400).json({ error: 'Thiếu taskId hoặc mô tả lỗi.' });
        return;
      }
      const allowedCodes = ['desktop_locked', 'needs_check', 'model_unavailable', 'failed'] as const;
      const safeCode = allowedCodes.includes(code) ? code : 'failed';
      const job = await failWorkerTask({
        taskId,
        deviceId: req.workerDeviceId!,
        error: error.slice(0, 2000),
        code: safeCode,
      });
      res.json({ ok: true, job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không ghi nhận được lỗi tác vụ.',
      });
    }
  });

  // =========================================================================
  // Cloud Scheduler Webhook (Protected by server-side CN82_SCHEDULER_SECRET)
  // =========================================================================
  app.post('/api/scheduler/tick', async (req, res) => {
    const secret = process.env.CN82_SCHEDULER_SECRET;
    const provided = String(req.headers['x-scheduler-secret'] || '');
    if (!secret || provided !== secret) {
      res.status(403).json({ error: 'Scheduler secret không hợp lệ.' });
      return;
    }
    const result = await triggerScheduledMailCheck('cloud_scheduler');
    res.json(result);
  });

  // =========================================================================
  // Authenticated Project Member & Owner Routes
  // =========================================================================
  app.use('/api', requireMemberAuth);

  app.get('/api/team', (req: AuthedRequest, res) => {
    const ctx = req.authContext!;
    const devices = listDevices();
    const onlineWorkers = devices.filter(
      (d) => !d.revoked && (d.status === 'online' || d.status === 'busy' || d.status === 'locked'),
    ).length;
    const jobs = listJobs();
    const activeJobCount = jobs.filter((j) =>
      ['planning', 'working', 'reviewing', 'running'].includes(j.status),
    ).length;
    const wf = getWorkflowState();

    res.json({
      team: TEAM_ROSTER,
      health: {
        runner: onlineWorkers > 0 ? 'codex-bridge' : isLiveSheetConfigured() ? 'sheet-preview' : 'preview-only',
        preview: false,
        activeJobCount,
        onlineWorkers,
        executableAvailable: devices.some((d) => !d.revoked && d.codexAvailable && d.status !== 'offline'),
      },
      member: ctx.member,
      devices,
      workflow: wf,
    });
  });

  app.get('/api/jobs', (req: AuthedRequest, res) => {
    const ctx = req.authContext!;
    const all = listJobs();
    if (ctx.role === 'owner') {
      res.json({ jobs: all });
      return;
    }
    const email = ctx.user.email.toLowerCase();
    res.json({
      jobs: all.filter(
        (j) => j.createdByUid === ctx.user.uid || j.createdByEmail?.toLowerCase() === email,
      ),
    });
  });

  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (payload: { type: string; at: string }) => {
      res.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    sendEvent({ type: 'connected', at: new Date().toISOString() });
    const unsub = subscribeStateUpdates(sendEvent);
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsub();
    });
  });

  app.get('/api/dashboard', (_req, res) => {
    res.json(getDashboardData());
  });

  app.get('/api/workflows', (_req, res) => {
    const wf = getWorkflowState();
    res.json({
      workflows: [
        {
          ...MAIL_WORKFLOW_RULES,
          status: wf.enabled ? 'active_21_00' : 'paused_until_live_confirmed',
          scheduleState: wf,
        },
      ],
    });
  });

  // Create orchestrated job (Owner -> agent/Linh; Member -> Linh -> forwarded to Duc for assignment)
  app.post('/api/jobs', requireRole(['owner', 'member']), async (req: AuthedRequest, res) => {
    try {
      const ctx = req.authContext!;
      const requestText = String(req.body?.request || '');
      const requestedAgent = (req.body?.agent || 'linh') as AgentId;
      const targetAgent: AgentId = ctx.role === 'member' ? 'linh' : requestedAgent;
      const job = await createOrchestratedJob({
        request: requestText,
        targetAgent,
        createdByUid: ctx.user.uid,
        createdByEmail: ctx.user.email,
        createdByRole: ctx.role,
        createdByName: ctx.member.displayName || ctx.user.email,
        idToken: ctx.user.idToken,
      });
      res.status(201).json({ job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không thể tạo công việc.',
      });
    }
  });

  // Owner delegates a member-submitted waiting_owner_assignment job to Linh or a specialist
  app.post('/api/jobs/:id/assign', requireRole(['owner']), async (req: AuthedRequest, res) => {
    try {
      const ctx = req.authContext!;
      const targetAgent = String(req.body?.targetAgent || 'linh') as AgentId;
      const note = typeof req.body?.note === 'string' ? req.body.note : '';
      const job = await assignWaitingJob({
        jobId: req.params.id,
        targetAgent,
        note,
        assignedByUid: ctx.user.uid,
        idToken: ctx.user.idToken,
      });
      res.json({ job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không thể phân công công việc.',
      });
    }
  });

  // Reply to waiting_input job (Owner or Member who created it)
  app.post(
    '/api/jobs/:id/reply',
    requireRole(['owner', 'member']),
    async (req: AuthedRequest, res) => {
      try {
        const ctx = req.authContext!;
        const existing = getJob(req.params.id);
        if (
          ctx.role !== 'owner' &&
          existing &&
          existing.createdByUid !== ctx.user.uid &&
          existing.createdByEmail?.toLowerCase() !== ctx.user.email.toLowerCase()
        ) {
          res.status(403).json({ error: 'Bạn chỉ có thể bổ sung công việc do mình gửi.' });
          return;
        }
        const job = await replyToWaitingJob(
          req.params.id,
          String(req.body?.answer || ''),
          ctx.user.idToken,
        );
        res.json({ job });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Không thể bổ sung thông tin.',
        });
      }
    },
  );

  // Retry failed / interrupted / needs_check job (Owner or Member who created it)
  app.post(
    '/api/jobs/:id/retry',
    requireRole(['owner', 'member']),
    async (req: AuthedRequest, res) => {
      try {
        const ctx = req.authContext!;
        const existing = getJob(req.params.id);
        if (
          ctx.role !== 'owner' &&
          existing &&
          existing.createdByUid !== ctx.user.uid &&
          existing.createdByEmail?.toLowerCase() !== ctx.user.email.toLowerCase()
        ) {
          res.status(403).json({ error: 'Bạn chỉ có thể chạy lại công việc do mình gửi.' });
          return;
        }
        const job = await retryJob(
          req.params.id,
          String(req.body?.note || ''),
          ctx.user.idToken,
        );
        res.json({ job });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Không thể chạy lại công việc.',
        });
      }
    },
  );

  // Mark report closed/reopened at Duc's desk (Owner ONLY)
  app.post('/api/jobs/:id/done', requireRole(['owner']), async (req: AuthedRequest, res) => {
    try {
      const ctx = req.authContext!;
      if (typeof req.body?.done !== 'boolean') {
        res.status(400).json({ error: 'Thiếu trạng thái done (boolean).' });
        return;
      }
      const job = await toggleReportClosed(
        req.params.id,
        req.body.done,
        ctx.user.uid,
        ctx.user.idToken,
      );
      res.json({ job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không thể cập nhật trạng thái báo cáo.',
      });
    }
  });

  // =========================================================================
  // Reports Sent from Duc to Member Workstation (e.g., Nghia at left desk)
  // =========================================================================
  app.get('/api/reports', requireRole(['owner', 'member', 'viewer']), (req: AuthedRequest, res) => {
    const ctx = req.authContext!;
    const reports =
      ctx.role === 'owner' ? listMemberReports() : listMemberReports(ctx.user.email);
    res.json({ reports });
  });

  app.post('/api/reports', requireRole(['owner']), async (req: AuthedRequest, res) => {
    try {
      const ctx = req.authContext!;
      const recipientEmail = String(
        req.body?.recipientEmail || DEFAULT_ALLOWED_MEMBER_EMAIL,
      )
        .trim()
        .toLowerCase();
      if (!recipientEmail.includes('@') || recipientEmail.length > 254) {
        res.status(400).json({ error: 'Email người nhận không hợp lệ.' });
        return;
      }

      const sourceJobId =
        typeof req.body?.sourceJobId === 'string' && req.body.sourceJobId.trim()
          ? req.body.sourceJobId.trim()
          : null;
      const sourceJob = sourceJobId ? getJob(sourceJobId) : undefined;
      if (sourceJobId && !sourceJob) {
        res.status(404).json({ error: 'Không tìm thấy báo cáo nguồn để gửi.' });
        return;
      }

      const rawTitle = String(req.body?.title || '').trim();
      const rawContent = String(req.body?.content || '').trim();

      const title =
        rawTitle ||
        (sourceJob
          ? sourceJob.plan?.summary || sourceJob.planSummary || sourceJob.request.slice(0, 120)
          : rawContent.split('\n')[0].slice(0, 120));
      const content =
        rawContent ||
        (sourceJob ? sourceJob.result || sourceJob.request : '');

      if (!title || !content || content.length > 60000) {
        res.status(400).json({ error: 'Nội dung báo cáo phải có 1–60.000 ký tự.' });
        return;
      }

      const recipientMember = listMembers().find(
        (m) => m.email.toLowerCase() === recipientEmail,
      );
      const now = new Date().toISOString();
      const report: MemberReport = {
        id: crypto.randomUUID(),
        recipientEmail,
        recipientName:
          recipientMember?.displayName ||
          (recipientEmail === DEFAULT_ALLOWED_MEMBER_EMAIL ? 'Trọng Nghĩa' : recipientEmail.split('@')[0]),
        title: title.slice(0, 500),
        content,
        sourceJobId,
        sentByUid: ctx.user.uid,
        sentByEmail: ctx.user.email,
        sentByName: ctx.member.displayName || 'Võ Minh Đức',
        acknowledgedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const saved = await saveMemberReport(report, ctx.user.idToken);
      res.status(201).json({ report: saved });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không thể gửi báo cáo.',
      });
    }
  });

  app.post('/api/reports/:id/ack', requireRole(['owner', 'member']), async (req: AuthedRequest, res) => {
    try {
      const ctx = req.authContext!;
      const report = await acknowledgeMemberReport(
        req.params.id,
        ctx.user.email,
        ctx.role === 'owner',
        ctx.user.idToken,
      );
      res.json({ report });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không thể xác nhận báo cáo.',
      });
    }
  });

  // Device registry & revocation (Owner ONLY)
  app.get('/api/devices', requireRole(['owner', 'member']), (_req, res) => {
    res.json({ devices: listDevices() });
  });

  app.post('/api/devices/register', requireRole(['owner']), async (req: AuthedRequest, res) => {
    try {
      const ctx = req.authContext!;
      const deviceId = String(req.body?.deviceId || '').trim();
      const label = String(req.body?.label || 'Máy công trường CN8-2').trim();
      if (!/^[a-zA-Z0-9._-]{3,80}$/.test(deviceId)) {
        res.status(400).json({
          error: 'deviceId phải dài 3–80 ký tự (chữ, số, ., _, -).',
        });
        return;
      }
      const secret = crypto.randomBytes(24).toString('hex');
      const now = new Date().toISOString();
      const device: WorkerDevice = {
        deviceId,
        label,
        status: 'offline',
        revoked: false,
        codexAvailable: false,
        desktopUnlocked: true,
        lastHeartbeatAt: now,
        activeTaskId: null,
        createdAt: now,
        updatedAt: now,
      };
      await registerOrUpdateDevice(device, secret, ctx.user.idToken);
      res.status(201).json({ device, workerToken: secret });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không thể đăng ký thiết bị.',
      });
    }
  });

  app.post('/api/devices/:id/revoke', requireRole(['owner']), async (req: AuthedRequest, res) => {
    try {
      const ctx = req.authContext!;
      const existing = listDevices().find((d) => d.deviceId === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Không tìm thấy thiết bị.' });
        return;
      }
      const revoked: WorkerDevice = {
        ...existing,
        revoked: true,
        status: 'revoked',
        activeTaskId: null,
      };
      await registerOrUpdateDevice(revoked, undefined, ctx.user.idToken);
      res.json({ device: revoked });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không thể thu hồi thiết bị.',
      });
    }
  });

  // Self-profile display name update (first-login setup or rename by signed-in user)
  app.post('/api/profile', async (req: AuthedRequest, res) => {
    try {
      const ctx = req.authContext!;
      const displayName = String(req.body?.displayName || '');
      const member = await updateMemberProfile(
        ctx.user.uid,
        displayName,
        ctx.user.idToken,
      );
      res.json({ member });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không cập nhật được tên hiển thị.',
      });
    }
  });

  // Member & Email Invite management (Duc ONLY — only minhduc@pmh.com.vn can grant/revoke access)
  app.get('/api/members', requireAccessAdmin, (_req, res) => {
    res.json({ members: listMembers(), invites: listInvites() });
  });

  app.get('/api/invites', requireAccessAdmin, (_req, res) => {
    res.json({ invites: listInvites() });
  });

  app.post('/api/invites', requireAccessAdmin, async (req: AuthedRequest, res) => {
    try {
      const ctx = req.authContext!;
      const email = String(req.body?.email || '').trim().toLowerCase();
      const role = (req.body?.role || 'member') as MemberRole;
      const roleTitle =
        typeof req.body?.roleTitle === 'string' && req.body.roleTitle.trim()
          ? req.body.roleTitle.trim().slice(0, 120)
          : undefined;
      const displayName =
        typeof req.body?.displayName === 'string' && req.body.displayName.trim()
          ? req.body.displayName.trim().slice(0, 120)
          : undefined;
      const active = req.body?.active !== false;
      if (!email.includes('@') || email.length > 254 || !['member', 'viewer'].includes(role)) {
        res.status(400).json({ error: 'Email hoặc vai trò cấp quyền không hợp lệ.' });
        return;
      }
      const now = new Date().toISOString();
      const invite = await upsertInvite(
        {
          id: inviteIdForEmail(email),
          email,
          displayName,
          role,
          roleTitle,
          active,
          createdByUid: ctx.user.uid,
          createdAt: now,
          updatedAt: now,
        },
        ctx.user.idToken,
      );
      res.json({ invite, invites: listInvites() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không thể cập nhật quyền truy cập.',
      });
    }
  });

  app.post('/api/members', requireAccessAdmin, async (req: AuthedRequest, res) => {
    try {
      const ctx = req.authContext!;
      const { uid, email, displayName, role, roleTitle, active } = req.body || {};
      if (
        typeof uid !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(uid) ||
        typeof email !== 'string' ||
        !email.includes('@') ||
        !['member', 'viewer'].includes(role)
      ) {
        res.status(400).json({ error: 'Thông tin thành viên không hợp lệ.' });
        return;
      }
      const now = new Date().toISOString();
      const member = await upsertMember(
        {
          uid,
          email: email.toLowerCase(),
          displayName: typeof displayName === 'string' ? displayName : undefined,
          role,
          roleTitle: typeof roleTitle === 'string' ? roleTitle.trim().slice(0, 120) : undefined,
          active: active !== false,
          createdAt: now,
          updatedAt: now,
        },
        ctx.user.idToken,
      );
      res.json({ member });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không thể cập nhật thành viên.',
      });
    }
  });

  // Daily 21:00 schedule control (Owner ONLY; stays paused until live-tested & confirmed)
  app.post(
    '/api/workflows/schedule',
    requireRole(['owner']),
    async (req: AuthedRequest, res) => {
      try {
        const ctx = req.authContext!;
        const enabled = Boolean(req.body?.enabled);
        const confirmTestComplete = Boolean(req.body?.confirmTestComplete);
        const wf = await toggleDailySchedule({
          enabled,
          confirmTestComplete,
          idToken: ctx.user.idToken,
        });
        notifyClients('workflows_updated');
        res.json({ workflow: wf });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Không thể cập nhật lịch 21:00.',
        });
      }
    },
  );

  app.post(
    '/api/workflows/boundary',
    requireRole(['owner']),
    async (req: AuthedRequest, res) => {
      const ctx = req.authContext!;
      const wf = getWorkflowState();
      wf.startBoundaryAt =
        typeof req.body?.startBoundaryAt === 'string'
          ? req.body.startBoundaryAt
          : new Date().toISOString();
      const saved = await saveWorkflowState(wf, ctx.user.idToken);
      res.json({ workflow: saved });
    },
  );

  app.post('/api/mail/prepare', requireRole(['owner', 'member']), (req, res) => {
    try {
      res.json({ plan: planMail(req.body) });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Nội dung email không hợp lệ.',
      });
    }
  });

  app.post(
    '/api/mail/ingest',
    requireRole(['owner', 'member']),
    async (req: AuthedRequest, res) => {
      try {
        const ctx = req.authContext!;
        const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
        const results = await ingestMailMessages({
          messages,
          createdByUid: ctx.user.uid,
          createdByEmail: ctx.user.email,
          idToken: ctx.user.idToken,
        });
        res.json({ results });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Không xử lý được danh sách email.',
        });
      }
    },
  );

  // Start server-side 21:00 Asia/Ho_Chi_Minh scheduler loop (stays paused unless enabled & confirmed)
  startServerMailScheduler();

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CN8-2 Office running at http://0.0.0.0:${PORT}`);
  });
}

void startServer();
