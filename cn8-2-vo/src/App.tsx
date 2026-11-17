import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthGate } from './components/AuthGate';
import { TEAM_ROSTER } from './data/team';
import { mountOfficeScene } from './office/scene';
import type {
  AgentId,
  MemberInvite,
  MemberRole,
  OfficeJob,
  ProjectMember,
  TeamApiResponse,
} from './types/office';

const ROLE_LABELS: Record<ProjectMember['role'], string> = {
  owner: 'Thành viên Quản lý dự án',
  member: 'Thành viên',
  viewer: 'Xem',
};

type InvitePreset = 'pm_member' | 'member' | 'viewer';

const INVITE_PRESET_MAP: Record<InvitePreset, { role: MemberRole; roleTitle: string }> = {
  pm_member: { role: 'member', roleTitle: 'Quản lý dự án' },
  member: { role: 'member', roleTitle: 'Thành viên' },
  viewer: { role: 'viewer', roleTitle: 'Xem' },
};

const ASSIGNEE_OPTIONS: Array<{ id: AgentId; label: string }> = [
  { id: 'linh', label: 'Linh — Điều phối tự động theo nội dung' },
  { id: 'hung', label: 'Hùng — An toàn & môi trường (HSE)' },
  { id: 'thinh', label: 'Thịnh — Khối lượng & chi phí (QS)' },
  { id: 'tien', label: 'Tiến — Kỹ thuật & nghiệm thu (QC Xây dựng)' },
  { id: 'hoa', label: 'Hòa — Pháp lý & hợp đồng' },
  { id: 'my', label: 'My — Thư ký tài liệu & hồ sơ' },
  { id: 'bach', label: 'Bách — Kỹ thuật MEPF' },
];

function OfficeCanvasView({
  member,
  getIdToken,
  initialTeam,
  onSignOut,
}: {
  member: ProjectMember;
  getIdToken: () => Promise<string>;
  initialTeam: TeamApiResponse;
  onSignOut: () => Promise<void>;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLInputElement>(null);
  const getIdTokenRef = useRef(getIdToken);
  getIdTokenRef.current = getIdToken;
  const sceneActionsRef = useRef<{ refresh: () => Promise<void> } | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Owner delegation modal state (when Duc clicks PHÂN CÔNG TIẾP on a member-submitted job)
  const [assigningJob, setAssigningJob] = useState<OfficeJob | null>(null);
  const [assignee, setAssignee] = useState<AgentId>('linh');
  const [assignNote, setAssignNote] = useState('');
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Owner access/invite management modal state
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [invites, setInvites] = useState<MemberInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [newInviteEmail, setNewInviteEmail] = useState('');
  const [newInviteName, setNewInviteName] = useState('');
  const [newInvitePreset, setNewInvitePreset] = useState<InvitePreset>('member');
  const [inviteSaving, setInviteSaving] = useState(false);

  useEffect(() => {
    const container = mountRef.current;
    const inputEl = entryRef.current;
    if (!container || !inputEl) return;

    const cleanup = mountOfficeScene({
      container,
      inputEl,
      initialRoster: initialTeam.team || TEAM_ROSTER,
      initialTeam,
      currentMember: member,
      getIdToken: () => getIdTokenRef.current(),
      onAssignJob: (job) => {
        setAssignee('linh');
        setAssignNote('');
        setAssignError(null);
        setAssigningJob(job);
      },
      onRegisterActions: (actions) => {
        sceneActionsRef.current = actions;
      },
      onReady: () => setLoading(false),
      onError: (msg) => {
        setLoading(false);
        setErrorMsg(msg);
      },
    });

    return cleanup;
  }, [initialTeam, member]);

  async function loadInvites() {
    setInvitesLoading(true);
    setInvitesError(null);
    try {
      const token = await getIdTokenRef.current();
      const res = await fetch('/api/invites', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        invites?: MemberInvite[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Không tải được danh sách quyền (${res.status}).`);
      }
      setInvites(data.invites || []);
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : 'Lỗi tải danh sách quyền.');
    } finally {
      setInvitesLoading(false);
    }
  }

  function handleOpenInvites() {
    setInvitesOpen(true);
    void loadInvites();
  }

  async function handleAssignSubmit(e: FormEvent) {
    e.preventDefault();
    if (!assigningJob) return;
    setAssignSubmitting(true);
    setAssignError(null);
    try {
      const token = await getIdTokenRef.current();
      const res = await fetch(`/api/jobs/${encodeURIComponent(assigningJob.id)}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetAgent: assignee,
          note: assignNote.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Không phân công được (${res.status}).`);
      }
      setAssigningJob(null);
      await sceneActionsRef.current?.refresh();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Không phân công được công việc.');
    } finally {
      setAssignSubmitting(false);
    }
  }

  async function handleSaveInvite(e: FormEvent) {
    e.preventDefault();
    const cleanEmail = newInviteEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setInvitesError('Vui lòng nhập email hợp lệ.');
      return;
    }
    setInviteSaving(true);
    setInvitesError(null);
    try {
      const token = await getIdTokenRef.current();
      const preset = INVITE_PRESET_MAP[newInvitePreset];
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: cleanEmail,
          displayName: newInviteName.trim() || undefined,
          role: preset.role,
          roleTitle: preset.roleTitle,
          active: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Không lưu được quyền (${res.status}).`);
      }
      setNewInviteEmail('');
      setNewInviteName('');
      await loadInvites();
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : 'Không thể cấp quyền.');
    } finally {
      setInviteSaving(false);
    }
  }

  async function handleToggleInvite(inv: MemberInvite) {
    setInvitesError(null);
    try {
      const token = await getIdTokenRef.current();
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: inv.email,
          displayName: inv.displayName,
          role: inv.role,
          roleTitle: inv.roleTitle,
          active: !inv.active,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Không cập nhật được trạng thái (${res.status}).`);
      }
      await loadInvites();
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
    }
  }

  const displayName = member.displayName || member.email.split('@')[0];
  const canManageAccess = Boolean(
    member.canManageAccess ?? member.email.toLowerCase() === 'minhduc@pmh.com.vn',
  );
  const roleDisplay =
    member.roleTitle ||
    (member.email.toLowerCase() === 'trongnghia@pmh.com.vn'
      ? 'Quản lý dự án'
      : ROLE_LABELS[member.role]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#e8e7de]">
      {/* Isolated WebGL mount container */}
      <div ref={mountRef} className="h-full w-full" />

      {/* Compact top-right basic signed-in user badge */}
      {!loading && !errorMsg && (
        <div
          aria-label="Thông tin người đăng nhập"
          className="fixed right-4 top-4 z-10 flex items-center gap-3 border border-[#d5d1ca] bg-[#fffdf8]/95 px-3.5 py-2 text-right shadow-sm backdrop-blur-xs"
        >
          <div className="leading-tight">
            <p className="text-xs font-semibold text-[#27313e]">{displayName}</p>
            <p className="mt-0.5 text-[11px] text-[#6c7580]">
              {roleDisplay} · {member.email}
            </p>
          </div>
          {canManageAccess && (
            <button
              type="button"
              onClick={handleOpenInvites}
              title="Chỉ Đức mới có chức năng cấp quyền"
              className="border-l border-[#e3dfd6] pl-2.5 text-[11px] font-medium text-[#2c5e4b] transition hover:text-[#1f4436]"
            >
              Quyền truy cập
            </button>
          )}
          <button
            type="button"
            onClick={() => void onSignOut()}
            title="Đăng xuất"
            className="border-l border-[#e3dfd6] pl-2.5 text-[11px] font-medium text-[#746a5b] transition hover:text-[#27313e]"
          >
            Thoát
          </button>
        </div>
      )}

      {/* Delegation Modal for Owner */}
      {assigningJob && member.role === 'owner' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Phân công công việc"
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/35 p-4"
        >
          <div className="w-full max-w-lg border border-[#d5d1ca] bg-[#fffdf8] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-[#2c5e4b] uppercase">
                  Chuyển giao qua Linh chờ anh Đức phân công
                </p>
                <h2 className="mt-1 text-lg font-semibold text-[#27313e]">Phân công tiếp</h2>
              </div>
              <button
                type="button"
                onClick={() => setAssigningJob(null)}
                className="text-xs font-medium text-[#746a5b] hover:text-[#27313e]"
              >
                Đóng
              </button>
            </div>

            <div className="mt-4 border border-[#e6e1d7] bg-[#f7f4ec] p-3 text-xs text-[#3a4655]">
              <p className="font-medium text-[#27313e]">
                Người gửi: {assigningJob.createdByName || assigningJob.createdByEmail || 'Thành viên'}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-[#4f5966]">
                {assigningJob.request}
              </p>
            </div>

            <form onSubmit={handleAssignSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#3a4655]">
                  Giao cho ai thực hiện
                </label>
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value as AgentId)}
                  className="mt-1.5 w-full border border-[#d5d1ca] bg-white px-3 py-2 text-sm text-[#27313e] outline-none focus:border-[#2c5e4b]"
                >
                  {ASSIGNEE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#3a4655]">
                  Chỉ đạo thêm của anh (không bắt buộc)
                </label>
                <textarea
                  rows={3}
                  value={assignNote}
                  onChange={(e) => setAssignNote(e.target.value)}
                  placeholder="Ví dụ: Đối chiếu bản vẽ Rev D và gửi lại kết quả trước khi trình..."
                  className="mt-1.5 w-full border border-[#d5d1ca] bg-white px-3 py-2 text-sm text-[#27313e] outline-none focus:border-[#2c5e4b]"
                />
              </div>

              {assignError && (
                <div className="border border-[#e5c2bd] bg-[#fdf4f3] px-3 py-2 text-xs text-[#8e3a32]">
                  {assignError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAssigningJob(null)}
                  className="border border-[#d5d1ca] px-4 py-2 text-xs font-medium text-[#596472] hover:bg-[#f4f1ea]"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={assignSubmitting}
                  className="bg-[#2c5e4b] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#234b3c] disabled:opacity-60"
                >
                  {assignSubmitting ? 'Đang chuyển...' : 'Giao việc ngay'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Duc-ONLY Access & Invites Modal */}
      {invitesOpen && canManageAccess && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quản lý quyền truy cập"
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/35 p-4"
        >
          <div className="w-full max-w-xl border border-[#d5d1ca] bg-[#fffdf8] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-[#2c5e4b] uppercase">
                  Phân quyền văn phòng CN8-2 · Chỉ Đức được cấp quyền
                </p>
                <h2 className="mt-1 text-lg font-semibold text-[#27313e]">
                  Danh sách email được cấp quyền
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setInvitesOpen(false)}
                className="text-xs font-medium text-[#746a5b] hover:text-[#27313e]"
              >
                Đóng
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between border border-[#e6e1d7] bg-[#f7f4ec] px-3.5 py-2.5 text-xs">
                <div>
                  <p className="font-semibold text-[#27313e]">minhduc@pmh.com.vn</p>
                  <p className="text-[#6c7580]">
                    Thành viên Quản lý dự án · Điều phối, gửi báo cáo & người duy nhất có chức năng cấp quyền
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-[#2c5e4b]">Cấp quyền</span>
              </div>

              {invitesLoading ? (
                <p className="py-3 text-xs text-[#6c7580]">Đang tải danh sách...</p>
              ) : (
                invites.map((inv) => {
                  const invTitle =
                    inv.roleTitle ||
                    (inv.email.toLowerCase() === 'trongnghia@pmh.com.vn'
                      ? 'Quản lý dự án'
                      : inv.role === 'member'
                        ? 'Thành viên'
                        : 'Xem');
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between gap-3 border border-[#e6e1d7] bg-white px-3.5 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[#27313e]">
                          {inv.displayName ? `${inv.displayName} · ` : ''}
                          {inv.email}
                        </p>
                        <p className="mt-0.5 text-[#6c7580]">
                          {inv.role === 'member'
                            ? `${invTitle} · Giao việc cho Linh → Chờ anh Đức phân công (không có chức năng cấp quyền)`
                            : `${invTitle} · Chỉ xem dashboard và báo cáo được gửi`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={
                            inv.active
                              ? 'font-medium text-[#2c5e4b]'
                              : 'font-medium text-[#8e3a32]'
                          }
                        >
                          {inv.active ? 'Đang bật' : 'Đã khóa'}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleToggleInvite(inv)}
                          className="border border-[#d5d1ca] px-2.5 py-1 text-[11px] font-medium text-[#3a4655] hover:bg-[#f4f1ea]"
                        >
                          {inv.active ? 'Tạm khóa' : 'Mở lại'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={handleSaveInvite} className="mt-5 border-t border-[#e6e1d7] pt-4">
              <p className="text-xs font-semibold text-[#27313e]">Cấp quyền thêm email mới</p>
              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="email"
                  required
                  value={newInviteEmail}
                  onChange={(e) => setNewInviteEmail(e.target.value)}
                  placeholder="email@pmh.com.vn"
                  className="border border-[#d5d1ca] bg-white px-3 py-2 text-xs text-[#27313e] outline-none focus:border-[#2c5e4b]"
                />
                <input
                  type="text"
                  value={newInviteName}
                  onChange={(e) => setNewInviteName(e.target.value)}
                  placeholder="Tên hiển thị (tuỳ chọn)"
                  className="border border-[#d5d1ca] bg-white px-3 py-2 text-xs text-[#27313e] outline-none focus:border-[#2c5e4b]"
                />
                <select
                  value={newInvitePreset}
                  onChange={(e) => setNewInvitePreset(e.target.value as InvitePreset)}
                  className="border border-[#d5d1ca] bg-white px-3 py-2 text-xs text-[#27313e] outline-none focus:border-[#2c5e4b]"
                >
                  <option value="pm_member">Quản lý dự án (Giao Linh → Đức)</option>
                  <option value="member">Thành viên (Giao Linh → Đức)</option>
                  <option value="viewer">Chỉ xem</option>
                </select>
              </div>

              {invitesError && (
                <div className="mt-2.5 border border-[#e5c2bd] bg-[#fdf4f3] px-3 py-2 text-xs text-[#8e3a32]">
                  {invitesError}
                </div>
              )}

              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={inviteSaving}
                  className="bg-[#2c5e4b] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#234b3c] disabled:opacity-60"
                >
                  {inviteSaving ? 'Đang lưu...' : 'Cấp quyền'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Off-screen input synced directly to 3D monitor canvas editing */}
      <input
        ref={entryRef}
        id="entry"
        maxLength={12000}
        aria-label="Yêu cầu hoặc phản hồi"
        autoComplete="off"
        className="fixed -left-[10000px] top-0 text-base opacity-0"
      />

      {loading && !errorMsg && (
        <div
          id="loading"
          className="fixed inset-0 z-20 grid place-content-center bg-[#e8e7de] text-[13px] tracking-[3px] text-[#746a5b]"
        >
          ĐANG MỞ VĂN PHÒNG
        </div>
      )}

      {errorMsg && (
        <div
          id="failure"
          role="alert"
          className="fixed inset-0 z-30 grid place-content-center bg-[#e8e7de] p-8 text-center leading-relaxed text-[#3a4655]"
        >
          <div>
            <p className="font-semibold">Không thể mở không gian 3D.</p>
            <p className="mt-2 text-sm text-[#596472]">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthGate>
      {({ member, getIdToken, initialTeam, onSignOut }) => (
        <OfficeCanvasView
          member={member}
          getIdToken={getIdToken}
          initialTeam={initialTeam}
          onSignOut={onSignOut}
        />
      )}
    </AuthGate>
  );
}
