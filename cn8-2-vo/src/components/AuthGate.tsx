import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import {
  signInWithGoogle,
  signOutFirebase,
  subscribeAuthState,
  testFirestoreConnection,
} from '../firebase/client';
import type { ProjectMember, TeamApiResponse } from '../types/office';

interface AuthGateProps {
  children: (ctx: {
    user: User;
    member: ProjectMember;
    getIdToken: () => Promise<string>;
    initialTeam: TeamApiResponse;
    onSignOut: () => Promise<void>;
  }) => ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [teamData, setTeamData] = useState<TeamApiResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [firstNameInput, setFirstNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  const verifyMembership = useCallback(async (firebaseUser: User) => {
    setVerifying(true);
    setErrorMsg(null);
    try {
      const token = await firebaseUser.getIdToken();
      await testFirestoreConnection();
      const res = await fetch('/api/team', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as TeamApiResponse & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          data.error ||
            'Tài khoản Google này chưa được cấp quyền truy cập CN8-2 Office.',
        );
      }
      setTeamData(data);
      setFirstNameInput(
        data.member?.displayName ||
          firebaseUser.displayName ||
          firebaseUser.email?.split('@')[0] ||
          '',
      );
    } catch (err) {
      setTeamData(null);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể xác minh quyền thành viên dự án.',
      );
    } finally {
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeAuthState((nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
      if (nextUser) {
        void verifyMembership(nextUser);
      } else {
        setTeamData(null);
        setErrorMsg(null);
      }
    });
    return unsub;
  }, [verifyMembership]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setErrorMsg(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Đăng nhập Google chưa hoàn tất. Vui lòng thử lại.',
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSaveFirstName = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !teamData) return;
    const clean = firstNameInput.trim();
    if (!clean) {
      setErrorMsg('Vui lòng nhập tên hiển thị của bạn.');
      return;
    }
    setSavingName(true);
    setErrorMsg(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ displayName: clean }),
      });
      const rawText = await res.text();
      let data: { member?: ProjectMember; error?: string } = {};
      try {
        data = rawText ? (JSON.parse(rawText) as { member?: ProjectMember; error?: string }) : {};
      } catch {
        data = {};
      }
      if (!res.ok || !data.member) {
        throw new Error(
          data.error ||
            `Không lưu được tên hiển thị (HTTP ${res.status}).`,
        );
      }
      setTeamData({ ...teamData, member: data.member });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Không lưu được tên hiển thị.',
      );
    } finally {
      setSavingName(false);
    }
  };

  if (authLoading || (user && verifying && !teamData)) {
    return (
      <div className="fixed inset-0 grid place-content-center bg-[#e8e7de] text-[13px] tracking-[3px] text-[#746a5b]">
        ĐANG XÁC MINH QUYỀN TRUY CẬP CN8-2
      </div>
    );
  }

  if (!user || !teamData) {
    return (
      <div className="fixed inset-0 grid place-content-center bg-[#e8e7de] p-6 text-[#27313e]">
        <div className="w-full max-w-md border border-[#d5d1ca] bg-[#fffdf8] p-8 shadow-sm">
          <div className="flex items-center justify-between border-b border-[#ece8df] pb-4">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.2em] text-[#8e7957]">
                CASA LUNA · PMH
              </p>
              <h1 className="mt-1 text-xl font-semibold text-[#27313e]">
                CN8-2 Office
              </h1>
            </div>
            <span className="border border-[#dfd8c5] bg-[#f8f6f0] px-2.5 py-1 text-[11px] font-medium text-[#6c655b]">
              Nội bộ dự án
            </span>
          </div>

          <p className="mt-5 text-sm leading-relaxed text-[#525d6d]">
            {user
              ? `Tài khoản ${user.email || ''} chưa nằm trong danh sách thành viên được Đức cấp quyền truy cập.`
              : 'Đăng nhập bằng tài khoản Google được cấp quyền để vào văn phòng 3D CN8-2 và theo dõi công việc thực tế.'}
          </p>

          {errorMsg && (
            <div className="mt-4 border border-[#dfbbb4] bg-[#fdf3f1] px-3.5 py-2.5 text-xs leading-relaxed text-[#8c3d32]">
              {errorMsg}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2.5">
            {!user ? (
              <button
                type="button"
                onClick={() => void handleSignIn()}
                disabled={signingIn}
                className="w-full bg-[#353c45] px-4 py-2.5 text-sm font-medium text-[#f7f1d9] transition hover:bg-[#27313e] disabled:opacity-60"
              >
                {signingIn ? 'Đang mở đăng nhập Google…' : 'Đăng nhập bằng Google'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void verifyMembership(user)}
                  disabled={verifying}
                  className="w-full bg-[#353c45] px-4 py-2.5 text-sm font-medium text-[#f7f1d9] transition hover:bg-[#27313e] disabled:opacity-60"
                >
                  Kiểm tra lại quyền truy cập
                </button>
                <button
                  type="button"
                  onClick={() => void signOutFirebase()}
                  className="w-full border border-[#d5d1ca] bg-[#fffdf8] px-4 py-2.5 text-sm font-medium text-[#525d6d] transition hover:bg-[#f4f1ea]"
                >
                  Đăng xuất / Đổi tài khoản Google
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // First-login display name setup
  if (!teamData.member.nameSetAt) {
    return (
      <div className="fixed inset-0 grid place-content-center bg-[#e8e7de] p-6 text-[#27313e]">
        <form
          onSubmit={(e) => void handleSaveFirstName(e)}
          className="w-full max-w-md border border-[#d5d1ca] bg-[#fffdf8] p-8 shadow-sm"
        >
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[#8e7957]">
            ĐĂNG NHẬP LẦN ĐẦU · CN8-2
          </p>
          <h1 className="mt-1.5 text-xl font-semibold text-[#27313e]">
            Đặt tên người đăng nhập
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-[#586474]">
            Tài khoản: <span className="font-medium text-[#27313e]">{teamData.member.email}</span>
          </p>

          <label className="mt-5 block text-xs font-medium text-[#525d6d]">
            Tên hiển thị trên văn phòng
            <input
              type="text"
              maxLength={120}
              required
              autoFocus
              value={firstNameInput}
              onChange={(e) => setFirstNameInput(e.target.value)}
              placeholder="Ví dụ: Võ Minh Đức"
              className="mt-1.5 w-full border border-[#cfc9be] bg-white px-3.5 py-2.5 text-sm text-[#27313e] outline-none focus:border-[#8e7957]"
            />
          </label>

          {errorMsg && (
            <div className="mt-4 border border-[#dfbbb4] bg-[#fdf3f1] px-3.5 py-2 text-xs text-[#8c3d32]">
              {errorMsg}
            </div>
          )}

          <div className="mt-6 flex gap-2.5">
            <button
              type="submit"
              disabled={savingName}
              className="flex-1 bg-[#353c45] px-4 py-2.5 text-sm font-medium text-[#f7f1d9] transition hover:bg-[#27313e] disabled:opacity-60"
            >
              {savingName ? 'Đang lưu…' : 'Xác nhận và vào văn phòng'}
            </button>
            <button
              type="button"
              onClick={() => void signOutFirebase()}
              className="border border-[#d5d1ca] bg-[#fffdf8] px-3.5 py-2.5 text-xs font-medium text-[#525d6d] transition hover:bg-[#f4f1ea]"
            >
              Đổi tài khoản
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <>
      {children({
        user,
        member: teamData.member,
        getIdToken: () => user.getIdToken(),
        initialTeam: teamData,
        onSignOut: signOutFirebase,
      })}
    </>
  );
}
