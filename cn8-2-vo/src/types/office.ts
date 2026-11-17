export type AgentId =
  | 'linh'
  | 'hung'
  | 'thinh'
  | 'tien'
  | 'hoa'
  | 'my'
  | 'dang'
  | 'bach'
  | 'duc';

export interface OfficeMember {
  id: AgentId | 'nghia';
  name: string;
  seat: number;
  role: string;
  model?: string;
  reasoning?: string;
  serviceTier?: string;
  isOwner?: boolean;
  isHumanMember?: boolean;
  color: string;
  description: string;
}

export interface WorkflowConfig {
  coordinator: AgentId;
  reviewer: AgentId;
  specialists: AgentId[];
  maxReviewRounds: number;
  maxActiveJobs: number;
  timeoutMinutesPerStep: number;
}

export interface TeamRoster {
  version: number;
  agents: OfficeMember[];
  workflow: WorkflowConfig;
  owner: OfficeMember;
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'planning'
  | 'working'
  | 'reviewing'
  | 'waiting_input'
  | 'waiting_device'
  | 'waiting_owner_assignment'
  | 'needs_review'
  | 'needs_check'
  | 'needs_owner'
  | 'completed'
  | 'failed'
  | 'interrupted';

export interface JobEvent {
  at: string;
  agent: string;
  state: string;
  detail: string;
}

export interface JobTask {
  agent: AgentId;
  instruction?: string;
}

export interface JobResultEntry {
  agent: AgentId;
  version?: number;
  modelUsed?: string;
  instruction?: string;
  sourcesRead?: string[];
  uncheckedScope?: string;
  text: string;
}

export interface JobReview {
  approved: boolean;
  summary: string;
  questions: string[];
  revisions: Array<{ agent: AgentId; instruction: string }>;
}

export interface OfficeJob {
  id: string;
  status: JobStatus;
  request: string;
  targetAgent?: AgentId;
  reportTo?: string;
  sourceKey?: string | null;
  currentAgent?: AgentId | null;
  currentStepType?: WorkerTaskKind | null;
  reviewRound?: number;
  plan?: {
    summary?: string;
    tasks?: JobTask[];
    questions?: string[];
  } | null;
  planSummary?: string | null;
  results?: JobResultEntry[];
  review?: JobReview | null;
  history?: Array<{
    round: number;
    agent: AgentId;
    previous: JobResultEntry | null;
    revision: string;
  }>;
  questions?: string[];
  clarifications?: string[];
  result: string;
  error?: string | null;
  preview?: boolean;
  allowedUids?: string[];
  createdByUid?: string;
  createdByEmail?: string;
  createdByRole?: MemberRole;
  createdByName?: string;
  assignedByUid?: string | null;
  assignedAt?: string | null;
  ownerNote?: string | null;
  ownerClosedAt: string | null;
  ownerClosedBy?: string | null;
  createdAt: string;
  updatedAt?: string;
  events?: JobEvent[];
}

export type WorkerTaskKind =
  | 'codex_plan'
  | 'codex_specialist'
  | 'codex_review'
  | 'codex_revise'
  | 'mail_scan'
  | 'sheet_lookup'
  | 'drive_download'
  | 'spm_inspect'
  | 'spm_transfer_approved';

export type WorkerTaskStatus =
  | 'queued'
  | 'leased'
  | 'completed'
  | 'needs_check'
  | 'waiting_user_unlock'
  | 'failed';

export interface WorkerTask {
  id: string;
  jobId: string;
  kind: WorkerTaskKind;
  agentId: AgentId;
  model: string;
  reasoning: string;
  serviceTier?: string;
  instruction: string;
  idempotencyKey: string;
  status: WorkerTaskStatus;
  leaseDeviceId?: string | null;
  leaseExpiresAt?: string | null;
  attempt: number;
  timeoutMinutes: number;
  outputText?: string;
  outputJson?: unknown;
  sourcesRead?: string[];
  uncheckedScope?: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerDevice {
  deviceId: string;
  label: string;
  status: 'online' | 'busy' | 'locked' | 'offline' | 'revoked';
  revoked: boolean;
  codexAvailable: boolean;
  desktopUnlocked: boolean;
  lastHeartbeatAt: string;
  activeTaskId?: string | null;
  allowedUids?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowScheduleState {
  id: string;
  enabled: boolean;
  testedAndConfirmed: boolean;
  scheduleHour: number;
  scheduleMinute: number;
  timezone: string;
  startBoundaryAt?: string | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  allowedUids?: string[];
  updatedAt: string;
}

export type MemberRole = 'owner' | 'member' | 'viewer';

export interface ProjectMember {
  uid: string;
  email: string;
  displayName?: string;
  nameSetAt?: string | null;
  role: MemberRole;
  roleTitle?: string;
  canManageAccess?: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemberInvite {
  id: string;
  email: string;
  displayName?: string;
  role: MemberRole;
  roleTitle?: string;
  active: boolean;
  createdByUid?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemberReport {
  id: string;
  recipientEmail: string;
  recipientName: string;
  title: string;
  content: string;
  sourceJobId?: string | null;
  sentByUid: string;
  sentByEmail: string;
  sentByName: string;
  acknowledgedAt?: string | null;
  allowedUids?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyRow {
  week: string;
  date: string;
  plan: number | null;
  actual: number | null;
  sourceRow?: number;
}

export interface HeatRow {
  id: string;
  label: string;
  isTotal?: boolean;
  values: (number | null)[];
  sourceRow?: number;
}

export interface HeatTable {
  kind?: 'work' | 'manpower';
  unit: string;
  dates: string[];
  rows: HeatRow[];
  sourceRange?: string;
}

export interface DashboardSource {
  spreadsheetId?: string;
  classification: 'demo' | 'real_source';
  title: string;
  readAt: string;
  url: string | null;
  website?: string;
  readMethod?: string;
}

export interface DashboardData {
  source: DashboardSource | null;
  weekly: WeeklyRow[];
  work: HeatTable | null;
  manpower: HeatTable | null;
  refreshing: boolean;
  error: string | null;
}

export interface TeamApiResponse {
  team: TeamRoster;
  health: {
    runner: 'codex-bridge' | 'preview-only' | 'sheet-preview';
    preview: boolean;
    activeJobCount: number;
    onlineWorkers: number;
    executableAvailable: boolean;
  };
  member: ProjectMember;
  devices: WorkerDevice[];
  workflow: WorkflowScheduleState;
}

export interface PersonStatus {
  text: string;
  color: string;
  pendingCount?: number;
}
