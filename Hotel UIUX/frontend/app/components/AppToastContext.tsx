import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ToastVariant = 'info' | 'success' | 'error' | 'warning';

export type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
  durationMs: number;
  actionLabel?: string;
  onAction?: () => void;
};

type ToastContextValue = {
  pushToast: (t: Omit<ToastItem, 'id'> & { durationMs?: number }) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const variantClass: Record<ToastVariant, string> = {
  info: 'border-slate-200 bg-white text-slate-800 shadow-lg',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-950 shadow-lg',
  error: 'border-red-200 bg-red-50 text-red-950 shadow-lg',
  warning: 'border-amber-200 bg-amber-50 text-amber-950 shadow-lg',
};

export const AppToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);

  const pushToast = useCallback((t: Omit<ToastItem, 'id'> & { durationMs?: number }) => {
    const id = Date.now() + Math.random();
    const durationMs = t.durationMs ?? 5200;
    const entry: ToastItem = {
      id,
      message: t.message,
      variant: t.variant,
      durationMs,
      actionLabel: t.actionLabel,
      onAction: t.onAction,
    };
    setItems((prev) => [...prev, entry]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, durationMs);
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  useEffect(() => {
    const onSoftDeleted = (ev: Event) => {
      const msg = (ev as CustomEvent<{ message?: string }>).detail?.message;
      if (!msg) return;
      pushToast({
        message: msg,
        variant: 'success',
        durationMs: 9000,
        actionLabel: 'Mở thùng rác',
        onAction: () =>
          window.dispatchEvent(new CustomEvent('vtr:open-tab', { detail: { tab: 'lifecycle' } })),
      });
    };
    window.addEventListener('vtr:lifecycle-soft-deleted', onSoftDeleted);
    return () => window.removeEventListener('vtr:lifecycle-soft-deleted', onSoftDeleted);
  }, [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[500] flex w-[min(100vw-1.5rem,20rem)] flex-col gap-2 print:hidden"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border px-3 py-2.5 text-xs font-semibold leading-snug ${variantClass[t.variant]}`}
          >
            <p>{t.message}</p>
            {t.actionLabel && t.onAction ? (
              <button
                type="button"
                onClick={() => {
                  try {
                    t.onAction?.();
                  } catch {
                    // ignore
                  }
                }}
                className="mt-2 w-full rounded-lg bg-slate-900 py-1.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-slate-800"
              >
                {t.actionLabel}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useAppToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useAppToast requires AppToastProvider');
  return ctx;
}
