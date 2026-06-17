import React, { useCallback, useEffect, useState } from 'react';
import { Bell, ChevronDown, ChevronUp, KeyRound, LogOut, QrCode, X } from 'lucide-react';

const API_PREFIX = String((import.meta as any).env?.VITE_API_URL || '/api').replace(/\/$/, '');

type NotificationRow = {
  id: string;
  title?: string | null;
  body?: string | null;
  message?: string | null;
  readAt?: string | null;
  createdAt?: string;
};

type OverviewHubModalProps = {
  open: boolean;
  onClose: () => void;
  onUnreadChange?: (n: number) => void;
};

export const OverviewHubModal: React.FC<OverviewHubModalProps> = ({
  open,
  onClose,
  onUnreadChange,
}) => {
  const token = (() => {
    try {
      return localStorage.getItem('auth_token') || '';
    } catch {
      return '';
    }
  })();

  const [unreadNotes, setUnreadNotes] = useState(0);
  const [recent, setRecent] = useState<NotificationRow[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const pushUnread = useCallback(
    (n: number) => {
      setUnreadNotes(n);
      onUnreadChange?.(n);
    },
    [onUnreadChange],
  );

  const loadSummary = useCallback(async () => {
    if (!token) {
      pushUnread(0);
      return;
    }
    try {
      const res = await fetch(`${API_PREFIX}/notifications/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const n = Number(data?.unreadNotifications);
      pushUnread(Number.isFinite(n) ? n : 0);
    } catch {
      pushUnread(0);
    }
  }, [token, pushUnread]);

  const loadRecent = useCallback(async () => {
    if (!token) return;
    setLoadingRecent(true);
    try {
      const res = await fetch(`${API_PREFIX}/notifications/recent`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setRecent(Array.isArray(data) ? data : []);
    } catch {
      setRecent([]);
    } finally {
      setLoadingRecent(false);
    }
  }, [token]);

  useEffect(() => {
    if (!open) return;
    void loadSummary();
    void loadRecent();
  }, [open, loadSummary, loadRecent]);

  useEffect(() => {
    if (!open || !token) return;
    const onRemote = (event: Event) => {
      const kinds = ((event as CustomEvent<{ kinds?: string[] }>).detail?.kinds || []) as string[];
      if (kinds.includes('notification')) void loadSummary();
    };
    window.addEventListener('vtr:state-remote-update', onRemote);
    const id = window.setInterval(() => void loadSummary(), 90_000);
    return () => {
      window.removeEventListener('vtr:state-remote-update', onRemote);
      window.clearInterval(id);
    };
  }, [open, token, loadSummary]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    setPasswordOpen(false);
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordMessage('');
    setPasswordLoading(false);
  }, [open]);

  const submitPasswordChange = async () => {
    setPasswordMessage('');
    if (!oldPassword.trim()) {
      setPasswordMessage('Vui lòng nhập mật khẩu cũ.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMessage('Mật khẩu mới tối thiểu 6 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage('Xác nhận mật khẩu mới không khớp.');
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Đổi mật khẩu thất bại');
      setPasswordMessage('Đổi mật khẩu thành công.');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordOpen(false);
    } catch (e: unknown) {
      setPasswordMessage((e as Error)?.message || 'Đổi mật khẩu thất bại');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      // ignore
    } finally {
      try {
        localStorage.removeItem('auth_token');
      } catch {
        /* empty */
      }
      window.location.reload();
    }
  };

  const handleApproveQr = async () => {
    const code = window.prompt('Nhập mã duyệt QR (6 số):')?.trim() || '';
    if (!/^\d{6}$/.test(code)) return;
    try {
      const res = await fetch('/api/auth/qr/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pairCode: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Approve failed');
      alert('Đã duyệt đăng nhập QR. Thiết bị kia sẽ tự đăng nhập.');
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Duyệt QR thất bại');
    }
  };

  const markRead = async (id: string) => {
    if (!token) return;
    try {
      await fetch(`${API_PREFIX}/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      void loadSummary();
      void loadRecent();
    } catch {
      /* empty */
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="overview-hub-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative max-h-[min(90vh,640px)] w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="overview-hub-title" className="text-lg font-semibold text-slate-800">
              Tổng quan — Tiện ích
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Thông báo, duyệt đăng nhập QR, đổi mật khẩu và đăng xuất — mở từ nút cuối thanh bên.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Đóng"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>

        <div className="max-h-[calc(min(90vh,640px)-5rem)] overflow-y-auto px-5 py-4">
          <section className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
            <div className="flex items-center gap-2 text-slate-800">
              <Bell className="h-5 w-5 shrink-0 text-slate-500" strokeWidth={1.5} />
              <span className="font-medium">Thông báo &amp; tổng quan import</span>
              {unreadNotes > 0 ? (
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {unreadNotes > 99 ? '99+' : unreadNotes}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Danh sách thông báo gần đây (bấm dòng để đánh dấu đã đọc).
            </p>
            <div className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-white p-2 text-xs">
              {loadingRecent ? (
                <p className="py-4 text-center text-slate-400">Đang tải…</p>
              ) : recent.length === 0 ? (
                <p className="py-4 text-center text-slate-400">Chưa có thông báo.</p>
              ) : (
                recent.map((row) => {
                  const text = row.title || row.message || row.body || '(Không tiêu đề)';
                  const unread = !row.readAt;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => unread && void markRead(row.id)}
                      className={`flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors ${
                        unread ? 'bg-blue-50/80 hover:bg-blue-100/80' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className={`font-medium ${unread ? 'text-slate-900' : 'text-slate-600'}`}>
                        {text}
                      </span>
                      {row.createdAt ? (
                        <span className="text-[10px] text-slate-400">
                          {new Date(row.createdAt).toLocaleString('vi-VN')}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <button
            type="button"
            onClick={handleApproveQr}
            className="mt-4 flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-800 transition-colors hover:border-indigo-200 hover:bg-indigo-50/50"
          >
            <QrCode className="h-5 w-5 shrink-0 text-indigo-600" strokeWidth={1.5} />
            <span>Duyệt đăng nhập QR</span>
          </button>

          <div className="mt-3 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setPasswordOpen((open) => !open);
                if (passwordOpen) setPasswordMessage('');
              }}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium transition-colors ${
                passwordOpen
                  ? 'bg-emerald-50/80 text-emerald-800'
                  : 'text-slate-800 hover:bg-slate-50'
              }`}
              aria-expanded={passwordOpen}
            >
              <KeyRound className="h-5 w-5 shrink-0 text-emerald-600" strokeWidth={1.5} />
              <span className="flex-1">Đổi mật khẩu</span>
              {passwordOpen ? (
                <ChevronUp className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
              )}
            </button>

            {passwordOpen && (
              <div className="border-t border-slate-100 px-4 py-3 space-y-2.5">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Mật khẩu cũ</label>
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full h-9 px-3 bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Mật khẩu mới</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full h-9 px-3 bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold"
                    placeholder="Tối thiểu 6 ký tự"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Xác nhận mật khẩu mới</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full h-9 px-3 bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold"
                  />
                </div>
                {passwordMessage ? (
                  <div className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700">
                    {passwordMessage}
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={passwordLoading}
                  onClick={() => void submitPasswordChange()}
                  className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider disabled:opacity-50"
                >
                  {passwordLoading ? 'Đang xử lý...' : 'Đổi mật khẩu'}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 flex w-full items-center gap-3 rounded-xl border border-red-100 bg-red-50/40 px-4 py-3 text-left text-sm font-medium text-red-800 transition-colors hover:bg-red-50"
          >
            <LogOut className="h-5 w-5 shrink-0 text-red-600" strokeWidth={1.5} />
            <span>Đăng xuất</span>
          </button>
        </div>
      </div>
    </div>
  );
};
