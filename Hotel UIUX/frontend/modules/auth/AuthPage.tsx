import React, { useMemo, useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';

type Mode = 'LOGIN_PASSWORD' | 'LOGIN_OTP' | 'LOGIN_QR' | 'REGISTER' | 'FORGOT';

const MODE_TITLE: Record<Mode, string> = {
  LOGIN_PASSWORD: 'Đăng nhập',
  LOGIN_OTP: 'Đăng nhập OTP',
  LOGIN_QR: 'Đăng nhập QR',
  REGISTER: 'Đăng ký',
  FORGOT: 'Quên mật khẩu',
};

const MODE_SUBMIT: Record<Mode, string> = {
  LOGIN_PASSWORD: 'Đăng nhập',
  LOGIN_OTP: 'Đăng nhập',
  LOGIN_QR: 'Đăng nhập',
  REGISTER: 'Tạo tài khoản',
  FORGOT: 'Đặt lại mật khẩu',
};

const FOOTER_LINKS: { id: Mode; label: string }[] = [
  { id: 'LOGIN_OTP', label: 'OTP' },
  { id: 'REGISTER', label: 'Đăng ký' },
  { id: 'FORGOT', label: 'Quên mật khẩu' },
  { id: 'LOGIN_QR', label: 'QR' },
];

export const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<Mode>('LOGIN_PASSWORD');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [message, setMessage] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [qr, setQr] = useState<{ qrId: string; pairCode: string; qrDataUrl?: string | null; ttlSeconds: number } | null>(null);
  const [qrMessage, setQrMessage] = useState<string>('');
  const [qrPolling, setQrPolling] = useState(false);
  const [qrOtp, setQrOtp] = useState<{ otp: string; qrDataUrl?: string | null; ttlSeconds: number; purpose: 'register' | 'login' | 'reset' } | null>(null);

  const markPostLoginRedirect = () => {
    try { localStorage.setItem('post_login_tab', 'dashboard'); } catch {}
  };

  const isEmail = useMemo(() => identifier.includes('@'), [identifier]);

  const requestOtp = async (purpose: 'register' | 'login') => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, purpose }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Request OTP failed');
      setMessage(`Đã gửi OTP. Vui lòng kiểm tra ${isEmail ? 'email' : 'tin nhắn'}.`);
      setOtpCooldown(50);
    } catch (e: any) {
      setMessage(e?.message || 'Request OTP failed');
    } finally {
      setLoading(false);
    }
  };

  const requestResetOtp = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, purpose: 'reset' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Request OTP failed');
      setMessage('Nếu tài khoản tồn tại, hệ thống đã gửi OTP để đặt lại mật khẩu.');
      setOtpCooldown(50);
    } catch (e: any) {
      setMessage(e?.message || 'Request OTP failed');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = window.setInterval(() => {
      setOtpCooldown(s => {
        if (s <= 1) return 0;
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [otpCooldown]);

  const submit = async () => {
    setLoading(true);
    setMessage('');
    try {
      let url = '';
      let body: any = {};
      if (mode === 'REGISTER') {
        url = '/api/auth/register';
        body = { identifier, otp, password };
      } else if (mode === 'FORGOT') {
        url = '/api/auth/reset-password';
        body = { identifier, otp, newPassword: resetNewPassword };
      } else if (mode === 'LOGIN_PASSWORD') {
        url = '/api/auth/login/password';
        body = { identifier, password };
      } else if (mode === 'LOGIN_QR') {
        return;
      } else {
        url = '/api/auth/login/otp';
        body = { identifier, otp };
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Auth failed');
      if (mode === 'FORGOT') {
        setMessage('Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.');
        setMode('LOGIN_PASSWORD');
        setOtp('');
        setResetNewPassword('');
        setResetConfirm('');
        return;
      }
      if (mode === 'REGISTER') {
        setMessage('Tạo tài khoản thành công. Đang đăng nhập...');
      } else {
        setMessage('Đăng nhập thành công. Đang vào hệ thống...');
      }
      markPostLoginRedirect();
      localStorage.setItem('auth_token', data.token);
      window.setTimeout(() => window.location.reload(), 800);
    } catch (e: any) {
      setMessage(e?.message || 'Auth failed');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit =
    mode !== 'LOGIN_QR' &&
    !loading &&
    identifier.trim() &&
    (mode === 'LOGIN_OTP' ? otp.length === 6 : true) &&
    (mode === 'REGISTER' ? (password.length >= 1 && otp.length === 6) : true) &&
    (mode === 'FORGOT' ? (otp.length === 6 && resetNewPassword.length >= 6 && resetNewPassword === resetConfirm) : true);

  const startQrLogin = async () => {
    setLoading(true);
    setQrMessage('');
    setQr(null);
    setQrOtp(null);
    try {
      const res = await fetch('/api/auth/qr/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'QR start failed');
      setQr({ qrId: data.qrId, pairCode: data.pairCode, qrDataUrl: data.qrDataUrl, ttlSeconds: data.ttlSeconds });
      setQrMessage('Mở app nội bộ / thiết bị đã đăng nhập để quét QR hoặc nhập mã 6 số để duyệt.');
      setQrPolling(true);
    } catch (e: any) {
      setQrMessage(e?.message || 'QR start failed');
    } finally {
      setLoading(false);
    }
  };

  const startQrOtp = async (purpose: 'register' | 'reset') => {
    setLoading(true);
    setQrMessage('');
    setQr(null);
    setQrPolling(false);
    setQrOtp(null);
    try {
      if (!identifier.trim()) throw new Error('Vui lòng nhập Email / SĐT trước');
      const res = await fetch('/api/auth/qr/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, purpose }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'QR OTP failed');
      setQrOtp({ otp: data.otp, qrDataUrl: data.qrDataUrl, ttlSeconds: data.ttlSeconds, purpose });
      setQrMessage(
        purpose === 'register'
          ? 'Đã tạo OTP bằng QR. Copy 6 số này dán vào ô OTP trong tab Đăng ký.'
          : 'Đã tạo OTP bằng QR. Copy 6 số này dán vào ô OTP trong tab Quên mật khẩu.',
      );
    } catch (e: any) {
      setQrMessage(e?.message || 'QR OTP failed');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (!qrPolling || !qr?.qrId) return;
    let cancelled = false;
    let consumed = false;
    const consumeQr = async () => {
      if (consumed || cancelled) return;
      consumed = true;
      const consume = await fetch('/api/auth/qr/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrId: qr.qrId }),
      });
      const data = await consume.json();
      if (!consume.ok) {
        consumed = false;
        return;
      }
      markPostLoginRedirect();
      localStorage.setItem('auth_token', data.token);
      window.location.reload();
    };

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/qr?session_id=${encodeURIComponent(qr.qrId)}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type === 'qr_confirmed') {
          void consumeQr();
        }
      } catch {
        // ignore
      }
    };

    const tick = async () => {
      try {
        const r = await fetch(`/api/auth/qr/status?qrId=${encodeURIComponent(qr.qrId)}`);
        if (!r.ok) return;
        const s = await r.json();
        if (cancelled) return;
        if (s.status === 'approved') {
          void consumeQr();
        }
      } catch {
        // ignore
      }
    };

    let pollDelay = 1000;
    let pollTimer: number | null = null;
    const schedulePoll = () => {
      if (cancelled) return;
      pollTimer = window.setTimeout(async () => {
        await tick();
        if (cancelled) return;
        pollDelay = Math.min(pollDelay * 2, 5000);
        schedulePoll();
      }, pollDelay);
    };
    schedulePoll();

    return () => {
      cancelled = true;
      if (pollTimer != null) window.clearTimeout(pollTimer);
      ws.close();
    };
  }, [qrPolling, qr?.qrId]);

  const inputClass =
    'w-full h-12 px-4 rounded-2xl border border-white/30 bg-black/20 text-white text-sm font-medium placeholder:text-white/35 outline-none focus:border-white/50 focus:bg-black/30 transition-colors';
  const labelClass = 'block text-sm text-white/90 mb-2';
  const glassPanelClass = 'rounded-2xl border border-white/15 bg-black/20 p-4';

  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 flex items-center justify-center p-6 overflow-hidden bg-[#3d2f28]">
      {/* Nền gradient nội thất — không dùng ảnh mockup (tránh lặp giao diện đăng nhập) */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(145deg, #2a1f18 0%, #5c4638 35%, #8b6f5c 55%, #4a382c 80%, #1e1612 100%)',
        }}
        aria-hidden
      />
      <div
        className="absolute -top-[20%] -left-[10%] h-[55%] w-[55%] rounded-full bg-[#c4a882]/25 blur-[100px]"
        aria-hidden
      />
      <div
        className="absolute -bottom-[15%] -right-[10%] h-[50%] w-[50%] rounded-full bg-[#6b8f7a]/20 blur-[90px]"
        aria-hidden
      />
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[3px]" aria-hidden />

      {/* Thẻ glass đăng nhập */}
      <div
        className="relative z-10 w-full max-w-[420px] rounded-[28px] border border-white/25 bg-white/10 p-8 shadow-[0_24px_64px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
        style={{ WebkitBackdropFilter: 'blur(24px)' }}
      >
        <h1 className="text-center text-3xl font-semibold tracking-tight text-white">
          {MODE_TITLE[mode]}
        </h1>

        {mode !== 'LOGIN_PASSWORD' && (
          <button
            type="button"
            onClick={() => setMode('LOGIN_PASSWORD')}
            className="mt-3 mx-auto block text-xs text-white/60 hover:text-white transition-colors"
          >
            ← Quay lại đăng nhập
          </button>
        )}

        <form
          className="mt-8 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            submit();
          }}
        >
          {mode !== 'LOGIN_QR' && (
            <div>
              <label className={labelClass}>Email / số điện thoại</label>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={inputClass}
                placeholder="vd: user@email.com hoặc +8490..."
                autoComplete="username"
              />
            </div>
          )}

          {(mode === 'LOGIN_PASSWORD' || mode === 'REGISTER') && (
            <div>
              <label className={labelClass}>Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder={mode === 'REGISTER' ? 'Tối thiểu 6 ký tự' : ''}
                autoComplete={mode === 'REGISTER' ? 'new-password' : 'current-password'}
              />
            </div>
          )}

          {(mode === 'LOGIN_OTP' || mode === 'REGISTER') && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={labelClass + ' mb-0'}>OTP (6 số)</label>
                <button
                  type="button"
                  disabled={loading || !identifier.trim() || otpCooldown > 0}
                  onClick={() => requestOtp(mode === 'REGISTER' ? 'register' : 'login')}
                  className="text-xs font-semibold text-white/80 hover:text-white disabled:opacity-40 transition-colors"
                >
                  {otpCooldown > 0 ? `Gửi lại sau ${otpCooldown}s` : 'Gửi OTP'}
                </button>
              </div>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                className={inputClass + ' font-mono text-center tracking-[0.35em]'}
                placeholder="------"
              />
            </div>
          )}

          {mode === 'FORGOT' && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelClass + ' mb-0'}>OTP (6 số)</label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={loading || !identifier.trim() || otpCooldown > 0}
                      onClick={requestResetOtp}
                      className="text-xs font-semibold text-white/80 hover:text-white disabled:opacity-40"
                    >
                      {otpCooldown > 0 ? `Gửi lại sau ${otpCooldown}s` : 'Gửi OTP'}
                    </button>
                    <button
                      type="button"
                      disabled={loading || !identifier.trim()}
                      onClick={() => startQrOtp('reset')}
                      className="text-xs font-semibold text-white/80 hover:text-white disabled:opacity-40"
                    >
                      OTP QR
                    </button>
                  </div>
                </div>
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  className={inputClass + ' font-mono text-center tracking-[0.35em]'}
                  placeholder="------"
                />
              </div>
              <div>
                <label className={labelClass}>Mật khẩu mới</label>
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  className={inputClass}
                  placeholder="Tối thiểu 6 ký tự"
                />
              </div>
              <div>
                <label className={labelClass}>Xác nhận mật khẩu mới</label>
                <input
                  type="password"
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  className={inputClass}
                />
              </div>
              {qrOtp?.purpose === 'reset' && (
                <div className={glassPanelClass + ' text-center'}>
                  <div className="text-xs text-white/60 uppercase tracking-wide">OTP (QR)</div>
                  <div className="mt-1 font-mono text-2xl font-bold tracking-[0.35em] text-white">{qrOtp.otp}</div>
                  <button
                    type="button"
                    className="mt-3 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold text-white hover:bg-white/25 transition-colors"
                    onClick={() => {
                      setOtp(qrOtp.otp);
                      try { navigator.clipboard?.writeText(qrOtp.otp); } catch {}
                    }}
                  >
                    Copy & Điền OTP
                  </button>
                  <div className="mt-2 text-[10px] text-white/50">Hết hạn sau {qrOtp.ttlSeconds}s</div>
                </div>
              )}
            </div>
          )}

          {mode === 'LOGIN_QR' && (
            <div className="space-y-4">
              <p className="text-sm text-white/70 text-center">
                Thiết bị đã đăng nhập duyệt đăng nhập cho thiết bị này.
              </p>
              <button
                type="button"
                disabled={loading}
                onClick={startQrLogin}
                className="w-full h-12 rounded-full bg-[#009688] text-white text-sm font-semibold shadow-lg shadow-teal-900/30 hover:bg-[#008577] disabled:opacity-50 transition-colors"
              >
                Tạo QR
              </button>

              {qr && (
                <div className={glassPanelClass}>
                  {qr.qrDataUrl ? (
                    <img src={qr.qrDataUrl} alt="QR Login" className="w-[200px] h-[200px] mx-auto bg-white p-2 rounded-xl" />
                  ) : (
                    <p className="text-xs text-white/70 text-center">Không tạo được ảnh QR. Dùng mã bên dưới.</p>
                  )}
                  <div className="mt-4 text-center">
                    <div className="text-xs text-white/60 uppercase">Mã duyệt (6 số)</div>
                    <div className="mt-1 font-mono text-2xl font-bold tracking-[0.35em] text-white">{qr.pairCode}</div>
                  </div>
                </div>
              )}

              <div className={glassPanelClass}>
                <p className="text-xs text-white/70 mb-3">QR tạo OTP cho Đăng ký — nhập Email/SĐT ở tab Đăng ký trước.</p>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => startQrOtp('register')}
                  className="w-full h-10 rounded-full bg-white/15 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-50 transition-colors"
                >
                  Tạo OTP QR
                </button>
                {qrOtp && (
                  <div className="mt-4 text-center">
                    {qrOtp.qrDataUrl ? (
                      <img src={qrOtp.qrDataUrl} alt="QR OTP" className="w-[160px] h-[160px] mx-auto bg-white p-2 rounded-xl" />
                    ) : null}
                    <div className="mt-3 text-xs text-white/60 uppercase">OTP (6 số)</div>
                    <div className="font-mono text-2xl font-bold tracking-[0.35em] text-white">{qrOtp.otp}</div>
                    <button
                      type="button"
                      className="mt-3 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold text-white hover:bg-white/25"
                      onClick={() => {
                        setOtp(qrOtp.otp);
                        try { navigator.clipboard?.writeText(qrOtp.otp); } catch {}
                      }}
                    >
                      Copy & Điền OTP
                    </button>
                  </div>
                )}
              </div>

              {qrMessage && (
                <p className="text-sm text-white/80 text-center rounded-2xl border border-white/15 bg-black/20 px-4 py-3">
                  {qrMessage}
                </p>
              )}
            </div>
          )}

          {message && (
            <p className="text-sm text-white/90 rounded-2xl border border-white/15 bg-black/25 px-4 py-3 text-center">
              {message}
            </p>
          )}

          {mode !== 'LOGIN_QR' && (
            <button
              type="submit"
              disabled={!canSubmit}
              className="group mt-2 flex w-full h-12 items-center justify-center gap-1 rounded-full bg-[#009688] text-white text-base font-semibold shadow-[0_8px_24px_rgba(0,150,136,0.45)] hover:bg-[#008577] disabled:opacity-45 disabled:shadow-none transition-all"
            >
              {loading ? 'Đang xử lý...' : MODE_SUBMIT[mode]}
              {!loading && <ChevronRight size={18} className="transition-transform group-hover:translate-x-0.5" />}
            </button>
          )}

          <nav className="flex items-center justify-between pt-2 text-sm text-white/85">
            {FOOTER_LINKS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`font-medium transition-colors hover:text-white ${
                  mode === id ? 'text-white underline underline-offset-4' : 'text-white/75'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </form>
      </div>

      {/* Icon sao góc dưới */}
      <Sparkles
        size={22}
        className="absolute bottom-6 right-6 z-10 text-white/70 drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]"
        aria-hidden
      />
    </div>
  );
};
