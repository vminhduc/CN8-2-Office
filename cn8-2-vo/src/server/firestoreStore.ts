import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type {
  MemberInvite,
  MemberReport,
  OfficeJob,
  ProjectMember,
  WorkerDevice,
  WorkerTask,
  WorkflowScheduleState,
} from '../types/office.ts';
import {
  FIREBASE_CONFIG,
  OWNER_EMAIL,
  type AuthorizedContext,
  type VerifiedFirebaseUser,
} from './firebaseAuth.ts';

export const DEFAULT_ALLOWED_MEMBER_EMAIL = 'trongnghia@pmh.com.vn';

export interface MailItemRecord {
  sourceKey: string;
  messageId: string;
  branch: 'new_submission' | 'approval_work' | 'case_closing' | 'other_mail';
  status: string;
  caseId?: string | null;
  revision?: string | null;
  jobId?: string | null;
  updatedAt: string;
}

export interface StoredDeviceSecret {
  deviceId: string;
  tokenHash: string;
}

interface RuntimeSnapshot {
  version: number;
  members: Record<string, ProjectMember>;
  invites: Record<string, MemberInvite>;
  memberReports: Record<string, MemberReport>;
  jobs: Record<string, OfficeJob>;
  tasks: Record<string, WorkerTask>;
  devices: Record<string, WorkerDevice>;
  deviceSecrets: Record<string, StoredDeviceSecret>;
  workflows: Record<string, WorkflowScheduleState>;
  mailItems: Record<string, MailItemRecord>;
}

const DATA_DIR = path.resolve(process.cwd(), '.office-data');
const STATE_FILE = path.join(DATA_DIR, 'runtime-state.json');

const DEFAULT_WORKFLOW_ID = 'cn82-daily-mail-review';

function initAdminFirestore(): Firestore | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    let parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }
    const app =
      getApps()[0] ||
      initializeApp({
        credential: cert(parsed as Record<string, string>),
        projectId: FIREBASE_CONFIG.projectId,
      });
    return getFirestore(app, FIREBASE_CONFIG.firestoreDatabaseId);
  } catch (err) {
    console.error('Không khởi tạo được firebase-admin:', err);
    return null;
  }
}

const adminDb = initAdminFirestore();

export function inviteIdForEmail(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .slice(0, 128);
}

export function defaultRoleTitle(
  email: string,
  role: MemberInvite['role'],
  explicit?: string,
): string {
  const clean = email.trim().toLowerCase();
  if (clean === OWNER_EMAIL) return 'Thành viên Quản lý dự án';
  if (explicit && explicit.trim()) return explicit.trim().slice(0, 120);
  if (clean === DEFAULT_ALLOWED_MEMBER_EMAIL) return 'Quản lý dự án';
  if (role === 'viewer') return 'Xem';
  return 'Thành viên';
}

export function enrichMemberForClient(member: ProjectMember): ProjectMember {
  return {
    ...member,
    roleTitle: defaultRoleTitle(member.email, member.role, member.roleTitle),
    canManageAccess: member.email.trim().toLowerCase() === OWNER_EMAIL,
  };
}

function createInitialState(): RuntimeSnapshot {
  const now = new Date().toISOString();
  const nghiaId = inviteIdForEmail(DEFAULT_ALLOWED_MEMBER_EMAIL);
  return {
    version: 1,
    members: {},
    invites: {
      [nghiaId]: {
        id: nghiaId,
        email: DEFAULT_ALLOWED_MEMBER_EMAIL,
        displayName: 'Trọng Nghĩa',
        role: 'member',
        roleTitle: 'Quản lý dự án',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    },
    memberReports: {},
    jobs: {},
    tasks: {},
    devices: {},
    deviceSecrets: {},
    workflows: {
      [DEFAULT_WORKFLOW_ID]: {
        id: DEFAULT_WORKFLOW_ID,
        enabled: false,
        testedAndConfirmed: false,
        scheduleHour: 21,
        scheduleMinute: 0,
        timezone: 'Asia/Ho_Chi_Minh',
        startBoundaryAt: null,
        lastRunAt: null,
        lastRunStatus: 'paused_not_configured',
        allowedUids: [],
        updatedAt: now,
      },
    },
    mailItems: {},
  };
}

function ensureDefaultInvites(): void {
  const nghiaId = inviteIdForEmail(DEFAULT_ALLOWED_MEMBER_EMAIL);
  if (!state.invites) state.invites = {};
  if (!state.memberReports) state.memberReports = {};
  if (!state.invites[nghiaId]) {
    const now = new Date().toISOString();
    state.invites[nghiaId] = {
      id: nghiaId,
      email: DEFAULT_ALLOWED_MEMBER_EMAIL,
      displayName: 'Trọng Nghĩa',
      role: 'member',
      roleTitle: 'Quản lý dự án',
      active: true,
      createdAt: now,
      updatedAt: now,
    };
  } else if (!state.invites[nghiaId].roleTitle) {
    state.invites[nghiaId].roleTitle = 'Quản lý dự án';
  }
}

function loadState(): RuntimeSnapshot {
  if (!fs.existsSync(STATE_FILE)) return createInitialState();
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<RuntimeSnapshot>;
    const base = createInitialState();
    return {
      ...base,
      ...parsed,
      invites: {
        ...base.invites,
        ...(parsed.invites || {}),
      },
      memberReports: {
        ...(parsed.memberReports || {}),
      },
      workflows: {
        ...base.workflows,
        ...(parsed.workflows || {}),
      },
    };
  } catch {
    return createInitialState();
  }
}

let state: RuntimeSnapshot = loadState();
const sseClients = new Set<(payload: { type: string; at: string }) => void>();

export async function hydrateFromFirestore(): Promise<void> {
  ensureDefaultInvites();
  if (!adminDb) return;
  try {
    const [
      membersSnap,
      invitesSnap,
      reportsSnap,
      jobsSnap,
      tasksSnap,
      devicesSnap,
      workflowsSnap,
      mailSnap,
    ] = await Promise.all([
      adminDb.collection('members').get(),
      adminDb.collection('invites').get(),
      adminDb.collection('memberReports').get(),
      adminDb.collection('jobs').get(),
      adminDb.collection('tasks').get(),
      adminDb.collection('devices').get(),
      adminDb.collection('workflows').get(),
      adminDb.collection('mailItems').get(),
    ]);

    membersSnap.forEach((doc) => {
      const data = doc.data() as ProjectMember;
      if (data?.uid) state.members[data.uid] = data;
    });
    invitesSnap.forEach((doc) => {
      const data = doc.data() as MemberInvite;
      if (data?.id) state.invites[data.id] = data;
    });
    reportsSnap.forEach((doc) => {
      const data = doc.data() as MemberReport;
      if (data?.id) state.memberReports[data.id] = data;
    });
    jobsSnap.forEach((doc) => {
      const data = doc.data() as OfficeJob;
      if (data?.id) state.jobs[data.id] = { ...(state.jobs[data.id] || {}), ...data };
    });
    tasksSnap.forEach((doc) => {
      const data = doc.data() as WorkerTask;
      if (data?.id) state.tasks[data.id] = data;
    });
    devicesSnap.forEach((doc) => {
      const data = doc.data() as WorkerDevice;
      if (data?.deviceId) state.devices[data.deviceId] = data;
    });
    workflowsSnap.forEach((doc) => {
      const data = doc.data() as WorkflowScheduleState;
      if (data?.id) state.workflows[data.id] = data;
    });
    mailSnap.forEach((doc) => {
      const data = doc.data() as MailItemRecord;
      if (data?.sourceKey) state.mailItems[data.sourceKey] = data;
    });
    ensureDefaultInvites();
    const nghiaId = inviteIdForEmail(DEFAULT_ALLOWED_MEMBER_EMAIL);
    if (!invitesSnap.docs.some((d) => d.id === nghiaId) && state.invites[nghiaId]) {
      await adminDb.collection('invites').doc(nghiaId).set(state.invites[nghiaId], { merge: true }).catch(() => {});
    }
    persistLocal();
  } catch (err) {
    console.warn(
      'Hydrate Firestore warning:',
      err instanceof Error ? err.message : err,
    );
  }
}

function persistLocal() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error('Lỗi lưu runtime-state.json:', err);
  }
}

export function notifyClients(type = 'state_updated') {
  const payload = { type, at: new Date().toISOString() };
  for (const listener of sseClients) {
    try {
      listener(payload);
    } catch {
      // ignore closed stream
    }
  }
}

export function subscribeStateUpdates(
  listener: (payload: { type: string; at: string }) => void,
): () => void {
  sseClients.add(listener);
  return () => sseClients.delete(listener);
}

// Firestore REST encoding helpers for user-token sync when FIREBASE_SERVICE_ACCOUNT_JSON is absent
function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreValue(val: Record<string, unknown>): unknown {
  if ('nullValue' in val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('arrayValue' in val) {
    const arr = (val.arrayValue as { values?: Array<Record<string, unknown>> })?.values || [];
    return arr.map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const fields =
      (val.mapValue as { fields?: Record<string, Record<string, unknown>> })?.fields || {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function docBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/${FIREBASE_CONFIG.firestoreDatabaseId}/documents`;
}

async function restGetDoc(
  collection: string,
  docId: string,
  idToken: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${docBaseUrl()}/${collection}/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const doc = (await res.json()) as { fields?: Record<string, Record<string, unknown>> };
  if (!doc.fields) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

async function restPatchDoc(
  collection: string,
  docId: string,
  data: Record<string, unknown>,
  idToken: string,
): Promise<void> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  const res = await fetch(`${docBaseUrl()}/${collection}/${encodeURIComponent(docId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore sync (${collection}/${docId}) failed: ${res.status} ${text}`);
  }
}

export function getAllowedUids(): string[] {
  const active = Object.values(state.members)
    .filter((m) => m.active)
    .map((m) => m.uid);
  return active.length ? active : ['bootstrapped-owner'];
}

export function getOwnerUids(): string[] {
  const owners = Object.values(state.members)
    .filter((m) => m.active && m.role === 'owner')
    .map((m) => m.uid);
  return owners.length ? owners : ['bootstrapped-owner'];
}

function allowedUidsForJob(job: OfficeJob): string[] {
  const set = new Set<string>(getOwnerUids());
  if (job.createdByUid) set.add(job.createdByUid);
  if (job.createdByEmail) {
    const creator = Object.values(state.members).find(
      (m) => m.active && m.email.toLowerCase() === job.createdByEmail!.toLowerCase(),
    );
    if (creator) set.add(creator.uid);
  }
  return Array.from(set);
}

function allowedUidsForReport(report: MemberReport): string[] {
  const set = new Set<string>(getOwnerUids());
  if (report.sentByUid) set.add(report.sentByUid);
  const recipient = Object.values(state.members).find(
    (m) => m.active && m.email.toLowerCase() === report.recipientEmail.toLowerCase(),
  );
  if (recipient) set.add(recipient.uid);
  return Array.from(set);
}

async function findActiveInviteForEmail(
  email: string,
  idToken?: string,
): Promise<MemberInvite | undefined> {
  ensureDefaultInvites();
  const norm = email.trim().toLowerCase();
  const id = inviteIdForEmail(norm);
  let inv = state.invites[id];
  if (!inv && adminDb) {
    const snap = await adminDb.collection('invites').doc(id).get();
    if (snap.exists) {
      inv = snap.data() as MemberInvite;
      state.invites[id] = inv;
    }
  } else if (!inv && idToken) {
    const remote = await restGetDoc('invites', id, idToken);
    if (remote) {
      inv = remote as unknown as MemberInvite;
      state.invites[id] = inv;
    }
  }
  return inv && inv.active ? inv : undefined;
}

export async function resolveAuthorizedMember(
  user: VerifiedFirebaseUser,
): Promise<AuthorizedContext> {
  // Check local state + Firestore (Admin SDK or REST via user's token)
  let member = state.members[user.uid];

  if (!member && adminDb) {
    const snap = await adminDb.collection('members').doc(user.uid).get();
    if (snap.exists) {
      member = snap.data() as ProjectMember;
      state.members[user.uid] = member;
      persistLocal();
    }
  } else if (!member) {
    const remote = await restGetDoc('members', user.uid, user.idToken);
    if (remote) {
      member = remote as unknown as ProjectMember;
      state.members[user.uid] = member;
      persistLocal();
    }
  }

  // Bootstrap designated access admin / member (Duc) or pre-authorized invite on first sign-in
  if (!member && user.email === OWNER_EMAIL && user.emailVerified) {
    const now = new Date().toISOString();
    member = {
      uid: user.uid,
      email: user.email,
      displayName: user.name || 'Võ Minh Đức',
      nameSetAt: null,
      role: 'owner',
      roleTitle: 'Thành viên Quản lý dự án',
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    state.members[user.uid] = member;
    persistLocal();
    await syncMemberToFirestore(member, user.idToken).catch(() => {});
  } else if (!member && user.emailVerified) {
    const invite = await findActiveInviteForEmail(user.email, user.idToken);
    if (invite) {
      const now = new Date().toISOString();
      member = {
        uid: user.uid,
        email: user.email,
        displayName: user.name || invite.displayName || user.email.split('@')[0],
        nameSetAt: null,
        role: invite.role,
        roleTitle: defaultRoleTitle(user.email, invite.role, invite.roleTitle),
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      state.members[user.uid] = member;
      // Refresh allowedUids on existing jobs/reports addressed to this member
      for (const report of Object.values(state.memberReports)) {
        if (report.recipientEmail.toLowerCase() === user.email.toLowerCase()) {
          report.allowedUids = allowedUidsForReport(report);
        }
      }
      for (const job of Object.values(state.jobs)) {
        if (job.createdByEmail?.toLowerCase() === user.email.toLowerCase()) {
          job.allowedUids = allowedUidsForJob(job);
        }
      }
      persistLocal();
      await syncMemberToFirestore(member, user.idToken).catch(() => {});
    }
  }

  // Synchronize roleTitle & invite active state for existing signed-in members
  if (member) {
    const expectedTitle = defaultRoleTitle(
      member.email,
      member.role,
      member.email.toLowerCase() === DEFAULT_ALLOWED_MEMBER_EMAIL
        ? 'Quản lý dự án'
        : member.roleTitle,
    );
    if (member.roleTitle !== expectedTitle) {
      member.roleTitle = expectedTitle;
      member.updatedAt = new Date().toISOString();
      persistLocal();
      await syncMemberToFirestore(member, user.idToken).catch(() => {});
    }
  }

  // Keep member's active status synchronized with email invite revocation
  if (member && member.role !== 'owner') {
    const inviteId = inviteIdForEmail(member.email);
    const invite = state.invites[inviteId];
    if (invite && !invite.active && member.active) {
      member.active = false;
      member.updatedAt = new Date().toISOString();
      persistLocal();
      await syncMemberToFirestore(member, user.idToken).catch(() => {});
    }
  }

  if (!member || !member.active) {
    throw new Error(
      `Tài khoản ${user.email} chưa được Đức cấp quyền truy cập dự án CN8-2.`,
    );
  }

  return {
    user,
    member: enrichMemberForClient(member),
    role: member.role,
  };
}

function toFirestoreMemberPayload(member: ProjectMember): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    uid: member.uid,
    email: member.email,
    role: member.role,
    roleTitle: defaultRoleTitle(member.email, member.role, member.roleTitle),
    active: member.active,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
  if (member.displayName) payload.displayName = member.displayName;
  if ('nameSetAt' in member) payload.nameSetAt = member.nameSetAt ?? null;
  return payload;
}

export async function syncMemberToFirestore(
  member: ProjectMember,
  idToken?: string,
): Promise<void> {
  const payload = toFirestoreMemberPayload(member);
  if (adminDb) {
    await adminDb.collection('members').doc(member.uid).set(payload, { merge: true });
    return;
  }
  if (idToken) {
    await restPatchDoc('members', member.uid, payload, idToken);
  }
}

function toFirestoreJobPayload(job: OfficeJob): Record<string, unknown> {
  return {
    id: job.id,
    request: job.request,
    targetAgent: job.targetAgent || 'linh',
    reportTo: job.reportTo || 'duc',
    sourceKey: job.sourceKey ?? null,
    status: job.status,
    currentAgent: job.currentAgent ?? null,
    currentStepType: job.currentStepType ?? null,
    reviewRound: job.reviewRound ?? 0,
    planSummary: job.plan?.summary ?? job.planSummary ?? null,
    result: job.result || '',
    error: job.error ?? null,
    questions: job.questions || [],
    clarifications: job.clarifications || [],
    allowedUids: job.allowedUids?.length ? job.allowedUids : allowedUidsForJob(job),
    createdByUid: job.createdByUid || 'bootstrapped-owner',
    createdByEmail: job.createdByEmail || OWNER_EMAIL,
    createdByRole: job.createdByRole || 'owner',
    createdByName: job.createdByName || job.createdByEmail || OWNER_EMAIL,
    assignedByUid: job.assignedByUid ?? null,
    assignedAt: job.assignedAt ?? null,
    ownerNote: job.ownerNote ?? null,
    ownerClosedAt: job.ownerClosedAt ?? null,
    ownerClosedBy: job.ownerClosedBy ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt || job.createdAt,
  };
}

export async function syncJobToFirestore(
  job: OfficeJob,
  idToken?: string,
): Promise<void> {
  const payload = toFirestoreJobPayload(job);
  if (adminDb) {
    await adminDb.collection('jobs').doc(job.id).set(payload, { merge: true });
    return;
  }
  if (idToken) {
    await restPatchDoc('jobs', job.id, payload, idToken);
  }
}

export async function syncWorkflowToFirestore(
  wf: WorkflowScheduleState,
  idToken?: string,
): Promise<void> {
  const payload: Record<string, unknown> = {
    ...wf,
    allowedUids: wf.allowedUids?.length ? wf.allowedUids : getAllowedUids(),
  };
  if (adminDb) {
    await adminDb.collection('workflows').doc(wf.id).set(payload, { merge: true });
    return;
  }
  if (idToken) {
    await restPatchDoc('workflows', wf.id, payload, idToken);
  }
}

export async function syncDeviceToFirestore(
  device: WorkerDevice,
  idToken?: string,
): Promise<void> {
  const payload: Record<string, unknown> = {
    ...device,
    allowedUids: device.allowedUids?.length ? device.allowedUids : getAllowedUids(),
  };
  if (adminDb) {
    await adminDb.collection('devices').doc(device.deviceId).set(payload, { merge: true });
    return;
  }
  if (idToken) {
    await restPatchDoc('devices', device.deviceId, payload, idToken);
  }
}

export function listMembers(): ProjectMember[] {
  return Object.values(state.members)
    .map(enrichMemberForClient)
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function updateMemberProfile(
  uid: string,
  displayName: string,
  idToken?: string,
): Promise<ProjectMember> {
  let existing = state.members[uid];
  if (!existing && adminDb) {
    const snap = await adminDb.collection('members').doc(uid).get();
    if (snap.exists) {
      existing = snap.data() as ProjectMember;
      state.members[uid] = existing;
    }
  } else if (!existing && idToken) {
    const remote = await restGetDoc('members', uid, idToken);
    if (remote) {
      existing = remote as unknown as ProjectMember;
      state.members[uid] = existing;
    }
  }
  if (!existing) {
    throw new Error('Không tìm thấy thông tin thành viên.');
  }
  const cleanName = displayName.trim();
  if (!cleanName || cleanName.length > 120) {
    throw new Error('Tên người đăng nhập phải từ 1 đến 120 ký tự.');
  }
  const now = new Date().toISOString();
  const updated: ProjectMember = {
    ...existing,
    displayName: cleanName,
    nameSetAt: existing.nameSetAt || now,
    roleTitle: defaultRoleTitle(existing.email, existing.role, existing.roleTitle),
    updatedAt: now,
  };
  state.members[uid] = updated;
  persistLocal();
  try {
    await syncMemberToFirestore(updated, idToken);
  } catch (err) {
    console.warn(
      'Cảnh báo đồng bộ tên hiển thị lên Firestore:',
      err instanceof Error ? err.message : err,
    );
  }
  notifyClients('members_updated');
  return enrichMemberForClient(updated);
}

export async function upsertMember(
  member: ProjectMember,
  idToken?: string,
): Promise<ProjectMember> {
  state.members[member.uid] = member;
  // Refresh allowedUids on existing jobs/workflows/devices
  const allowedUids = getAllowedUids();
  for (const job of Object.values(state.jobs)) {
    job.allowedUids = allowedUids;
  }
  for (const wf of Object.values(state.workflows)) {
    wf.allowedUids = allowedUids;
  }
  for (const dev of Object.values(state.devices)) {
    dev.allowedUids = allowedUids;
  }
  persistLocal();
  await syncMemberToFirestore(member, idToken).catch(() => {});
  notifyClients('members_updated');
  return member;
}

export function listJobs(): OfficeJob[] {
  return Object.values(state.jobs).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function getJob(jobId: string): OfficeJob | undefined {
  return state.jobs[jobId];
}

export async function saveJob(job: OfficeJob, idToken?: string): Promise<OfficeJob> {
  job.updatedAt = new Date().toISOString();
  job.allowedUids = allowedUidsForJob(job);
  state.jobs[job.id] = job;
  persistLocal();
  await syncJobToFirestore(job, idToken).catch((err) => {
    console.warn('Firestore sync warning (job cached locally):', err instanceof Error ? err.message : err);
  });
  notifyClients('jobs_updated');
  return job;
}

export function listInvites(): MemberInvite[] {
  ensureDefaultInvites();
  return Object.values(state.invites)
    .map((inv) => ({
      ...inv,
      roleTitle: defaultRoleTitle(inv.email, inv.role, inv.roleTitle),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function upsertInvite(
  invite: MemberInvite,
  idToken?: string,
): Promise<MemberInvite> {
  ensureDefaultInvites();
  const cleanEmail = invite.email.trim().toLowerCase();
  const id = inviteIdForEmail(cleanEmail);
  const now = new Date().toISOString();
  const existing = state.invites[id];
  const saved: MemberInvite = {
    ...existing,
    ...invite,
    id,
    email: cleanEmail,
    roleTitle: defaultRoleTitle(cleanEmail, invite.role, invite.roleTitle ?? existing?.roleTitle),
    createdAt: existing?.createdAt || invite.createdAt || now,
    updatedAt: now,
  };
  state.invites[id] = saved;
  // Sync matching signed-in member's active, role & roleTitle if already registered
  for (const m of Object.values(state.members)) {
    if (m.email.toLowerCase() === cleanEmail && m.email.toLowerCase() !== OWNER_EMAIL) {
      m.active = saved.active;
      m.role = saved.role;
      m.roleTitle = saved.roleTitle;
      m.updatedAt = now;
      await syncMemberToFirestore(m, idToken).catch(() => {});
    }
  }
  persistLocal();
  if (adminDb) {
    await adminDb.collection('invites').doc(saved.id).set(saved, { merge: true }).catch(() => {});
  } else if (idToken) {
    await restPatchDoc('invites', saved.id, saved as unknown as Record<string, unknown>, idToken).catch(() => {});
  }
  notifyClients('invites_updated');
  return saved;
}

export function listMemberReports(filterEmail?: string): MemberReport[] {
  if (!state.memberReports) state.memberReports = {};
  const list = Object.values(state.memberReports);
  const filtered = filterEmail
    ? list.filter((r) => r.recipientEmail.toLowerCase() === filterEmail.toLowerCase())
    : list;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveMemberReport(
  report: MemberReport,
  idToken?: string,
): Promise<MemberReport> {
  if (!state.memberReports) state.memberReports = {};
  report.updatedAt = new Date().toISOString();
  report.allowedUids = allowedUidsForReport(report);
  state.memberReports[report.id] = report;
  persistLocal();
  const payload: Record<string, unknown> = {
    id: report.id,
    recipientEmail: report.recipientEmail.toLowerCase(),
    recipientName: report.recipientName,
    title: report.title,
    content: report.content,
    sourceJobId: report.sourceJobId ?? null,
    sentByUid: report.sentByUid,
    sentByEmail: report.sentByEmail,
    sentByName: report.sentByName,
    acknowledgedAt: report.acknowledgedAt ?? null,
    allowedUids: report.allowedUids,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
  if (adminDb) {
    await adminDb.collection('memberReports').doc(report.id).set(payload, { merge: true }).catch((err) => {
      console.warn('Firestore sync warning (memberReport):', err instanceof Error ? err.message : err);
    });
  } else if (idToken) {
    await restPatchDoc('memberReports', report.id, payload, idToken).catch(() => {});
  }
  notifyClients('reports_updated');
  return report;
}

export async function acknowledgeMemberReport(
  reportId: string,
  actorEmail: string,
  isOwnerActor: boolean,
  idToken?: string,
): Promise<MemberReport> {
  if (!state.memberReports) state.memberReports = {};
  const report = state.memberReports[reportId];
  if (!report) throw new Error('Không tìm thấy báo cáo.');
  if (!isOwnerActor && report.recipientEmail.toLowerCase() !== actorEmail.toLowerCase()) {
    throw new Error('Bạn không có quyền xác nhận báo cáo này.');
  }
  report.acknowledgedAt = report.acknowledgedAt ? null : new Date().toISOString();
  return saveMemberReport(report, idToken);
}

export function listTasks(): WorkerTask[] {
  return Object.values(state.tasks).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function getTask(taskId: string): WorkerTask | undefined {
  return state.tasks[taskId];
}

export async function saveTask(task: WorkerTask): Promise<WorkerTask> {
  task.updatedAt = new Date().toISOString();
  state.tasks[task.id] = task;
  persistLocal();
  if (adminDb) {
    await adminDb.collection('tasks').doc(task.id).set(task, { merge: true }).catch(() => {});
  }
  notifyClients('tasks_updated');
  return task;
}

export function listDevices(): WorkerDevice[] {
  const now = Date.now();
  return Object.values(state.devices).map((d) => {
    if (d.revoked) return { ...d, status: 'revoked' as const };
    const stale = now - Date.parse(d.lastHeartbeatAt || d.updatedAt) > 45_000;
    if (stale && d.status !== 'offline') {
      return { ...d, status: 'offline' as const };
    }
    return d;
  });
}

export function getOnlineDevices(): WorkerDevice[] {
  return listDevices().filter(
    (d) => !d.revoked && (d.status === 'online' || d.status === 'busy' || d.status === 'locked'),
  );
}

export async function registerOrUpdateDevice(
  device: WorkerDevice,
  workerSecret?: string,
  idToken?: string,
): Promise<WorkerDevice> {
  device.updatedAt = new Date().toISOString();
  device.allowedUids = getAllowedUids();
  state.devices[device.deviceId] = device;
  if (workerSecret) {
    state.deviceSecrets[device.deviceId] = {
      deviceId: device.deviceId,
      tokenHash: crypto.createHash('sha256').update(workerSecret).digest('hex'),
    };
  }
  persistLocal();
  await syncDeviceToFirestore(device, idToken).catch(() => {});
  notifyClients('devices_updated');
  return device;
}

export function verifyWorkerToken(deviceId: string, token: string): boolean {
  const secret = state.deviceSecrets[deviceId];
  const device = state.devices[deviceId];
  if (device?.revoked) return false;
  if (secret) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(secret.tokenHash));
  }
  // Bootstrap allowance via server environment secret CN82_WORKER_BOOTSTRAP_SECRET
  const bootstrap = process.env.CN82_WORKER_BOOTSTRAP_SECRET;
  return Boolean(bootstrap && token === bootstrap);
}

export function getWorkflowState(id = DEFAULT_WORKFLOW_ID): WorkflowScheduleState {
  return state.workflows[id] || createInitialState().workflows[DEFAULT_WORKFLOW_ID];
}

export async function saveWorkflowState(
  wf: WorkflowScheduleState,
  idToken?: string,
): Promise<WorkflowScheduleState> {
  wf.updatedAt = new Date().toISOString();
  wf.allowedUids = getAllowedUids();
  state.workflows[wf.id] = wf;
  persistLocal();
  await syncWorkflowToFirestore(wf, idToken).catch(() => {});
  notifyClients('workflows_updated');
  return wf;
}

export function getMailItem(sourceKey: string): MailItemRecord | undefined {
  return state.mailItems[sourceKey];
}

export async function saveMailItem(item: MailItemRecord): Promise<MailItemRecord> {
  item.updatedAt = new Date().toISOString();
  state.mailItems[item.sourceKey] = item;
  persistLocal();
  if (adminDb) {
    await adminDb.collection('mailItems').doc(item.sourceKey).set(item, { merge: true }).catch(() => {});
  }
  return item;
}

export function hasAdminFirestore(): boolean {
  return Boolean(adminDb);
}
