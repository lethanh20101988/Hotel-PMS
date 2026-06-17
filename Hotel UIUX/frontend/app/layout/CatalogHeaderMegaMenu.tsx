import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Layers, List } from 'lucide-react';
import { useApp } from '../store';

const GROUPS: { title: string; items: { id: string; label: string }[] }[] = [
  {
    title: 'Nguồn lực',
    items: [
      { id: 'CUSTOMERS', label: 'Khách hàng' },
      { id: 'SUPPLIERS', label: 'Nhà cung cấp' },
      { id: 'EMPLOYEES', label: 'Nhân viên' },
    ],
  },
  {
    title: 'Vật tư',
    items: [
      { id: 'ITEMS', label: 'Hàng hóa - Vật tư' },
      { id: 'WAREHOUSES', label: 'Kho bãi' },
      { id: 'ASSETS', label: 'Tài sản (TSCĐ)' },
    ],
  },
  {
    title: 'Kỹ thuật',
    items: [
      { id: 'BOMS', label: 'Định mức (BOM)' },
      { id: 'ACCOUNTS', label: 'Tài khoản kế toán' },
    ],
  },
  {
    title: 'Khoản mục khác',
    items: [
      { id: 'EXPENSES', label: 'Khoản mục chi phí' },
      { id: 'TAXES', label: 'Thuế suất' },
      { id: 'PAYMENT_METHODS', label: 'Hình thức thanh toán' },
    ],
  },
];

const LABEL_BY_ID: Record<string, string> = GROUPS.flatMap((g) => g.items).reduce(
  (acc, it) => {
    acc[it.id] = it.label;
    return acc;
  },
  {} as Record<string, string>,
);

/** Trên toast (500) và hầu hết modal (50); tránh menu bị che. */
const MENU_Z = 9999;

type MegaMenuPanelProps = {
  catalogSection: string;
  setCatalogSection: (id: string) => void;
  onClose: () => void;
  align: 'left' | 'right';
  triggerRef: React.RefObject<HTMLElement | null>;
  portalRef: React.RefObject<HTMLDivElement | null>;
};

function MegaMenuPortal({
  catalogSection,
  setCatalogSection,
  onClose,
  align,
  triggerRef,
  portalRef,
}: MegaMenuPanelProps) {
  const [style, setStyle] = useState<React.CSSProperties>({});

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const margin = 16;
    const gap = 8;
    const top = r.bottom + gap;
    const maxW = Math.min(672, vw - margin * 2);

    let left: number;
    if (align === 'left') {
      left = Math.max(margin, r.left);
    } else {
      left = r.right - maxW;
    }
    left = Math.max(margin, Math.min(left, vw - maxW - margin));

    setStyle({
      position: 'fixed',
      top,
      left,
      width: maxW,
      maxWidth: maxW,
      boxSizing: 'border-box',
      zIndex: MENU_Z,
    });
  }, [align, triggerRef]);

  useLayoutEffect(() => {
    updatePosition();
    const id = requestAnimationFrame(() => updatePosition());
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [updatePosition]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={portalRef}
      role="menu"
      className="max-h-[min(85vh,calc(100vh-5rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white py-4 shadow-xl ring-1 ring-black/5"
      style={style}
    >
      <div className="grid min-w-0 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-2 border-b border-slate-100 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCatalogSection(item.id);
                      onClose();
                    }}
                    className={`w-full rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                      catalogSection === item.id
                        ? 'bg-blue-50 font-semibold text-blue-800'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export const CatalogHeaderMegaMenu: React.FC = () => {
  const { catalogSection, setCatalogSection } = useApp();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (portalRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const currentLabel = LABEL_BY_ID[catalogSection] || 'Danh mục';
  const isBoms = catalogSection === 'BOMS';

  const portalOpen = open ? (
    <MegaMenuPortal
      catalogSection={catalogSection}
      setCatalogSection={setCatalogSection}
      onClose={() => setOpen(false)}
      align={isBoms ? 'left' : 'right'}
      triggerRef={triggerRef}
      portalRef={portalRef}
    />
  ) : null;

  if (isBoms) {
    return (
      <header className="vtr-no-print mb-4 print:hidden">
        <div
          ref={wrapRef}
          className="relative flex flex-wrap items-center gap-2 rounded-[4px] border border-slate-200 bg-white px-3 py-2 shadow-sm"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] bg-blue-600 text-white shadow-inner">
            <List className="h-[18px] w-[18px]" aria-hidden />
          </div>
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold leading-tight text-slate-900 sm:text-base">
            Định mức (BOM)
          </h2>
          <div className="relative shrink-0">
            <button
              ref={triggerRef}
              type="button"
              aria-expanded={open}
              aria-haspopup="true"
              title="Chọn danh mục"
              onClick={() => setOpen((o) => !o)}
              className="inline-flex h-8 items-center gap-0.5 rounded-[4px] border border-slate-200 bg-slate-50 px-1.5 py-1 text-slate-800 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <Layers className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
              <span className="sr-only">Danh mục</span>
            </button>
          </div>
          {portalOpen}
        </div>
      </header>
    );
  }

  return (
    <header className="vtr-no-print mb-6 print:hidden">
      <div
        ref={wrapRef}
        className="relative flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-inner">
            <List className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Đang xem</p>
            <p className="truncate text-base font-bold text-slate-800">{currentLabel}</p>
          </div>
        </div>

        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-haspopup="true"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <Layers className="h-4 w-4 text-blue-600" aria-hidden />
            Danh mục
            <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {portalOpen}
      </div>
    </header>
  );
};
