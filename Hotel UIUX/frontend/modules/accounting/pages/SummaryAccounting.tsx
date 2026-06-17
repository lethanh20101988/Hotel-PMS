
import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Book, BookOpen, Boxes, Settings, FileText, DollarSign, Landmark, Box, Building, 
  PieChart, Calendar, Download, ShieldCheck, Lock, Unlock, Clock,
  ArrowRightLeft, RefreshCw, Trash2, CheckCircle, Printer, FileSpreadsheet, Calculator, TrendingUp,
  ArrowRight, ListChecks, FileSearch, CheckCircle2, ClipboardList, Scale, ChevronDown, ChevronRight
} from 'lucide-react';
import { JournalEntry, AccountingPeriod, AccountDefinition } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { computeB01bTotals } from '@shared/utils/accounting';
import { buildInvoiceCogsJournalEntry } from '@shared/utils/invoiceCogs';
import { formatJournalEntryInvoiceLabel } from '@shared/utils/journalEntryInvoice';
import {
  buildDeferredRevenueScheduleWithStatus,
  getDeferredRevenuePostingRef,
  getDeferredRevenueRecognitionAccount,
  getDeferredRevenueRemainingBalance,
  isDeferredRevenueInvoice,
} from '@shared/utils/deferredRevenue';
import { useApp } from '../../../app/store';
import { useSidebarLayout } from '../../../app/layout/sidebarLayoutContext';
import { Pagination } from '@shared/components/Pagination';

type AccountingBookType = 
  | 'GENERAL_JOURNAL' 
  | 'GENERAL_LEDGER' 
  | 'DEBT' 
  | 'CASH' 
  | 'BANK' 
  | 'INVENTORY' 
  | 'ASSETS' 
  | 'EXPENSE' 
  | 'PERIOD_CLOSING' 
  | 'PERIOD_END_CLOSING';

type PeriodEndClosingMode = 'MONTH' | 'QUARTER';

type StandardPageSize = 10 | 20 | 50 | 100;

type AccountingNavGroupKey = 'reports' | 'inventory' | 'utils';

/** Khớp với Sidebar: w-64 (256px) / w-[72px] / ẩn — fallback khi chưa đo được DOM. */
function sidebarInsetPx(mode: 'expanded' | 'icons' | 'hidden'): number {
  if (mode === 'hidden') return 0;
  if (mode === 'icons') return 72;
  return 256;
}

/** Cạnh phải thực của thanh sidebar (theo layout, kể cả lúc đang animate width). */
function getSidebarRightEdgePx(fallbackInsetPx: number): number {
  if (typeof document === 'undefined') return fallbackInsetPx;
  const el = document.querySelector('[data-vtr-sidebar]');
  if (!el) return fallbackInsetPx;
  const r = el.getBoundingClientRect();
  if (!Number.isFinite(r.right) || r.width < 4) return fallbackInsetPx;
  return Math.min(window.innerWidth, Math.ceil(r.right));
}

/** Giới hạn rộng panel theo chế độ sidebar — mở rộng thì co lại, ẩn sidebar thì rộng hơn (giống tinh thần flyout sidebar). */
function accountingMenuPrefCapPx(
  mode: 'expanded' | 'icons' | 'hidden',
  vw: number,
  availableWidth: number,
): number {
  const margin = 12;
  if (mode === 'hidden') {
    return Math.min(400, vw - margin * 2);
  }
  if (mode === 'icons') {
    return Math.min(320, Math.max(availableWidth, vw - margin * 2));
  }
  return Math.min(272, Math.max(availableWidth, 200));
}

function clampPageSize(n: number): StandardPageSize {
  if (n <= 10) return 10;
  if (n <= 20) return 20;
  if (n <= 50) return 50;
  return 100;
}

function hashString(input: string) {
  // Lightweight stable hash for sessionStorage keys (no crypto dependency)
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function logSlowQuery(label: string, ms: number, meta: Record<string, unknown>) {
  if (ms <= 200) return;
  // eslint-disable-next-line no-console
  console.warn(`[PERF] ${label} took ${Math.round(ms)}ms`, meta);
}

function formatVndDigits(amount: number) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(Math.max(0, amount)));
}

/** Định dạng số VND (giá trị tuyệt đối) — dùng trong bảng khi đơn vị đã ghi ở tiêu đề cột. */
function formatVndAbs(amount: number) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(Math.abs(amount)));
}

function formatClosingMonthLabel(period: string) {
  const [year, month] = String(period || '').split('-');
  if (!year || !month) return period;
  return `Tháng ${month}/${year}`;
}

function getPeriodEndDate(period: string) {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || !month) return '';
  return new Date(year, month, 0).toISOString().split('T')[0];
}

function enumeratePeriodMonths(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= endMonth) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function buildQuarterOptions(startDate: string, endDate: string) {
  const byQuarter = new Map<string, { value: string; label: string; periods: string[] }>();
  enumeratePeriodMonths(startDate, endDate).forEach((period) => {
    const [year, month] = period.split('-').map(Number);
    const quarter = Math.floor((month - 1) / 3) + 1;
    const key = `${year}-Q${quarter}`;
    const found = byQuarter.get(key);
    if (found) {
      found.periods.push(period);
      return;
    }
    byQuarter.set(key, {
      value: key,
      label: `Quý ${quarter}/${year}`,
      periods: [period],
    });
  });
  return Array.from(byQuarter.values());
}

function ClosingPreviewTableHead() {
  return (
    <thead>
      <tr className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        <th scope="col" className="w-14 pb-2 pr-2 text-left font-medium">
          Bên
        </th>
        <th scope="col" className="w-[4.25rem] pb-2 pr-2 text-left font-medium">
          Mã TK
        </th>
        <th scope="col" className="pb-2 pr-3 text-left font-medium">
          Tên tài khoản
        </th>
        <th scope="col" className="w-[10rem] pb-2 text-right font-medium">
          Số tiền (VNĐ)
        </th>
      </tr>
    </thead>
  );
}

/** Số tiền VND: chữ số nổi bật, ký hiệu «đ» nhỏ hơn + kerning (kiểu ứng dụng tài chính). */
function ClosingProfitAmount({ amount }: { amount: number }) {
  const negative = amount < 0;
  const digits = new Intl.NumberFormat('vi-VN').format(Math.round(Math.abs(amount)));
  return (
    <span className="inline-flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0">
      <span
        className={`text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl ${
          negative ? 'text-red-600' : 'text-emerald-700'
        }`}
      >
        {negative ? '−' : ''}
        {digits}
      </span>
      <span className="text-sm font-medium tabular-nums tracking-widest text-slate-400 translate-y-px">đ</span>
    </span>
  );
}

export const SummaryAccounting = () => {
  const { financialYear } = useApp();
  const { mode: sidebarMode } = useSidebarLayout();
  const [activeBook, setActiveBook] = useState<AccountingBookType>('GENERAL_JOURNAL');
  const [openNavGroup, setOpenNavGroup] = useState<AccountingNavGroupKey | null>(null);
  const accountingNavRef = useRef<HTMLDivElement>(null);
  const accountingMenuPortalRef = useRef<HTMLDivElement>(null);
  const accountingPageShellRef = useRef<HTMLDivElement>(null);
  const navGroupButtonRefs = useRef<Partial<Record<AccountingNavGroupKey, HTMLButtonElement | null>>>({});
  const [accountingMenuPlacement, setAccountingMenuPlacement] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  
  const [dateRange, setDateRange] = useState({
     from: financialYear.startDate,
     to: financialYear.endDate
  });

  useEffect(() => {
    setDateRange({
       from: financialYear.startDate,
       to: financialYear.endDate
    });
  }, [financialYear.startDate, financialYear.endDate]);

  const periodEndClosingYearLabel = useMemo(
    () => new Date(financialYear.startDate).getFullYear().toString(),
    [financialYear.startDate],
  );

  const [periodEndClosingMode, setPeriodEndClosingMode] = useState<PeriodEndClosingMode>('MONTH');
  const [periodEndClosingPeriod, setPeriodEndClosingPeriod] = useState(() => {
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear().toString();
    const defaultPeriod = `${year}-${month}`;
    return defaultPeriod >= financialYear.startDate.slice(0, 7) && defaultPeriod <= financialYear.endDate.slice(0, 7)
      ? defaultPeriod
      : financialYear.startDate.slice(0, 7);
  });
  const quarterOptions = useMemo(
    () => buildQuarterOptions(financialYear.startDate, financialYear.endDate),
    [financialYear.startDate, financialYear.endDate],
  );
  const [periodEndClosingQuarter, setPeriodEndClosingQuarter] = useState(() => quarterOptions[0]?.value || '');

  useEffect(() => {
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear().toString();
    const defaultPeriod = `${year}-${month}`;
    setPeriodEndClosingPeriod(
      defaultPeriod >= financialYear.startDate.slice(0, 7) && defaultPeriod <= financialYear.endDate.slice(0, 7)
        ? defaultPeriod
        : financialYear.startDate.slice(0, 7),
    );
  }, [financialYear.startDate, financialYear.endDate]);

  useEffect(() => {
    if (!quarterOptions.length) {
      setPeriodEndClosingQuarter('');
      return;
    }
    if (!quarterOptions.some((option) => option.value === periodEndClosingQuarter)) {
      setPeriodEndClosingQuarter(quarterOptions[0].value);
    }
  }, [quarterOptions, periodEndClosingQuarter]);

  const selectedClosingPeriods = useMemo(() => {
    if (periodEndClosingMode === 'QUARTER') {
      return quarterOptions.find((option) => option.value === periodEndClosingQuarter)?.periods || [];
    }
    return periodEndClosingPeriod ? [periodEndClosingPeriod] : [];
  }, [periodEndClosingMode, periodEndClosingQuarter, periodEndClosingPeriod, quarterOptions]);

  const periodEndClosingSelectionLabel = useMemo(() => {
    if (periodEndClosingMode === 'QUARTER') {
      return quarterOptions.find((option) => option.value === periodEndClosingQuarter)?.label || 'Quý';
    }
    return formatClosingMonthLabel(periodEndClosingPeriod);
  }, [periodEndClosingMode, periodEndClosingQuarter, periodEndClosingPeriod, quarterOptions]);

  const menuItems: {
    id: AccountingBookType;
    label: string;
    icon: typeof Book;
    desc: string;
  }[] = [
    { id: 'GENERAL_JOURNAL', label: 'Sổ Nhật Ký Chung', icon: Book, desc: 'Tổng hợp tất cả nghiệp vụ' },
    { id: 'GENERAL_LEDGER', label: 'Sổ Cái Tài Khoản', icon: Scale, desc: 'Chi tiết theo từng TK' },
    { id: 'DEBT', label: 'Sổ Chi Tiết Công Nợ', icon: FileText, desc: 'TK 131, 331' },
    { id: 'CASH', label: 'Sổ Quỹ Tiền Mặt', icon: DollarSign, desc: 'TK 1111, 1112 (và 111)' },
    { id: 'BANK', label: 'Sổ Tiền Gửi Ngân Hàng', icon: Landmark, desc: 'TK 1121, 1122 (và 112)' },
    { id: 'INVENTORY', label: 'Sổ Kho (Hàng tồn kho)', icon: Box, desc: 'TK 152, 153, 156...' },
    { id: 'ASSETS', label: 'Sổ Tài Sản Cố Định', icon: Building, desc: 'TK 211, 214' },
    { id: 'EXPENSE', label: 'Sổ Chi Phí SXKD', icon: PieChart, desc: 'TK 632, 641, 642...' },
    { id: 'PERIOD_END_CLOSING', label: 'Kết chuyển cuối kỳ', icon: ArrowRightLeft, desc: 'KC Doanh thu, CP, Lãi lỗ' },
    { id: 'PERIOD_CLOSING', label: 'Khóa Sổ Kế Toán', icon: Lock, desc: 'Quản lý kỳ kế toán' },
  ];

  const accountingNavGroups: {
    key: AccountingNavGroupKey;
    label: string;
    navIcon: typeof BookOpen;
    ids: AccountingBookType[];
  }[] = [
    {
      key: 'reports',
      label: 'Báo cáo & Sổ sách',
      navIcon: BookOpen,
      ids: ['GENERAL_JOURNAL', 'GENERAL_LEDGER', 'DEBT', 'CASH', 'BANK'],
    },
    {
      key: 'inventory',
      label: 'Kho & Tài sản',
      navIcon: Boxes,
      ids: ['INVENTORY', 'ASSETS', 'EXPENSE'],
    },
    {
      key: 'utils',
      label: 'Tiện ích & Cuối kỳ',
      navIcon: Settings,
      ids: ['PERIOD_END_CLOSING', 'PERIOD_CLOSING'],
    },
  ];

  const navGroupContainsActive = (ids: AccountingBookType[]) => ids.includes(activeBook);

  useLayoutEffect(() => {
    if (!openNavGroup) {
      setAccountingMenuPlacement(null);
      return;
    }

    let burstRaf = 0;
    let cancelled = false;

    const updatePlacement = () => {
      if (cancelled) return;
      const b = navGroupButtonRefs.current[openNavGroup];
      if (!b) return;

      const rect = b.getBoundingClientRect();
      const margin = 12;
      const vw = window.innerWidth;
      const rightEdge = vw - margin;
      const fallbackInset = sidebarInsetPx(sidebarMode);
      const sidebarRight = getSidebarRightEdgePx(fallbackInset);
      /** Luôn đặt panel bên phải mép sidebar — không dùng Math.min(vw, sidebarRight) (viewport hẹp từng đẩy panel vào dưới sidebar). */
      const minLeft = sidebarMode === 'hidden' ? margin : sidebarRight + margin;
      const maxWidthByViewport = rightEdge - minLeft;

      if (maxWidthByViewport <= 8) {
        setAccountingMenuPlacement({
          top: rect.bottom + 8,
          left: minLeft,
          width: Math.max(100, Math.max(0, vw - minLeft - margin)),
        });
        return;
      }

      const prefCap = accountingMenuPrefCapPx(sidebarMode, vw, maxWidthByViewport);
      let width = Math.min(prefCap, maxWidthByViewport);
      width = Math.max(
        Math.min(200, maxWidthByViewport),
        Math.min(width, maxWidthByViewport),
      );

      let left = Math.max(minLeft, rect.left);
      if (left + width > rightEdge) {
        left = Math.max(minLeft, rightEdge - width);
      }
      if (left + width > rightEdge) {
        width = Math.max(120, rightEdge - left);
      }
      if (left < minLeft) {
        left = minLeft;
        width = Math.min(width, rightEdge - left);
      }

      setAccountingMenuPlacement({
        top: rect.bottom + 8,
        left,
        width: Math.max(120, width),
      });
    };

    updatePlacement();

    const ro = new ResizeObserver(() => updatePlacement());
    const aside = document.querySelector('[data-vtr-sidebar]');
    if (aside) ro.observe(aside);
    if (accountingPageShellRef.current) ro.observe(accountingPageShellRef.current);

    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);

    const burstUntil = performance.now() + 450;
    const burst = () => {
      updatePlacement();
      if (!cancelled && performance.now() < burstUntil) {
        burstRaf = requestAnimationFrame(burst);
      }
    };
    burstRaf = requestAnimationFrame(burst);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
      cancelAnimationFrame(burstRaf);
    };
  }, [openNavGroup, sidebarMode]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!openNavGroup) return;
      const t = e.target as Node;
      if (accountingNavRef.current?.contains(t)) return;
      if (accountingMenuPortalRef.current?.contains(t)) return;
      setOpenNavGroup(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenNavGroup(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openNavGroup]);

  const openNavGroupMeta = openNavGroup
    ? accountingNavGroups.find((g) => g.key === openNavGroup)
    : null;

  const renderContent = () => {
     switch (activeBook) {
        case 'GENERAL_JOURNAL': return <GeneralJournalView dateRange={dateRange} />;
        case 'GENERAL_LEDGER': return <LedgerView dateRange={dateRange} type="ALL" title="Sổ Cái Tài Khoản" />;
        case 'DEBT': return <LedgerView dateRange={dateRange} accounts={['131', '331']} title="Sổ Chi Tiết Công Nợ (131/331)" />;
        case 'CASH': return <LedgerView dateRange={dateRange} accounts={['1111', '1112', '111']} title="Sổ Quỹ Tiền Mặt (1111 / 1112 / 111)" />;
        case 'BANK': return <LedgerView dateRange={dateRange} accounts={['1121', '1122', '112']} title="Sổ Tiền Gửi Ngân Hàng (1121 / 1122 / 112)" />;
        case 'INVENTORY': return <LedgerView dateRange={dateRange} accounts={['152', '153', '154', '155', '156']} title="Sổ Chi Tiết Vật Tư, Hàng Hóa" />;
        case 'ASSETS': return <LedgerView dateRange={dateRange} accounts={['211', '214']} title="Sổ Tài Sản Cố Định (211/214)" />;
        case 'EXPENSE': return <LedgerView dateRange={dateRange} accounts={['632', '641', '642', '811']} title="Sổ Chi Phí Hoạt Động" />;
        case 'PERIOD_END_CLOSING':
          return (
            <PeriodEndClosingView periods={selectedClosingPeriods} selectionLabel={periodEndClosingSelectionLabel} />
          );
        case 'PERIOD_CLOSING': return <PeriodClosingView />;
        default: return null;
     }
  };

  return (
    <div
      ref={accountingPageShellRef}
      className="flex h-[calc(100vh-128px)] w-full max-w-full min-w-0 flex-col overflow-x-hidden"
    >
      <div className="relative isolate z-0 flex min-h-0 w-full max-w-full flex-1 flex-col overflow-x-hidden rounded-lg border border-slate-200/80 bg-white">
        <div className="relative z-10 shrink-0 overflow-visible border-b border-slate-100 bg-white px-3 py-3 sm:px-4">
          <div
            ref={accountingNavRef}
            className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3"
          >
            {accountingNavGroups.map((group) => {
              const NavIcon = group.navIcon;
              const isOpen = openNavGroup === group.key;
              const groupActive = navGroupContainsActive(group.ids);
              return (
                <div key={group.key} className="relative">
                  <button
                    type="button"
                    ref={(el) => {
                      navGroupButtonRefs.current[group.key] = el;
                    }}
                    aria-expanded={isOpen}
                    aria-haspopup="menu"
                    onClick={() =>
                      setOpenNavGroup((prev) => (prev === group.key ? null : group.key))
                    }
                    className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-all ${
                      isOpen || groupActive
                        ? 'border-blue-200/90 bg-blue-50/80 text-blue-900 shadow-sm'
                        : 'border-slate-200/90 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    } `}
                  >
                    <NavIcon
                      className={`h-4 w-4 shrink-0 ${isOpen || groupActive ? 'text-blue-600' : 'text-slate-500'}`}
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <span className="whitespace-nowrap">{group.label}</span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                      strokeWidth={1.5}
                      aria-hidden
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 bg-white px-3 py-1.5 sm:px-4">
          <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-800">
            {activeBook !== 'PERIOD_CLOSING' && activeBook !== 'PERIOD_END_CLOSING' && (
              <RefreshCw className="h-3.5 w-3.5 shrink-0 text-blue-600" />
            )}
            {activeBook === 'PERIOD_END_CLOSING' && <TrendingUp className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
            <span className="truncate">{menuItems.find(m => m.id === activeBook)?.label}</span>
          </h3>
          {activeBook === 'PERIOD_END_CLOSING' && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
              <span className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Niên độ: {periodEndClosingYearLabel} | Kỳ:
              </span>
              <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setPeriodEndClosingMode('MONTH')}
                  className={`px-3 py-1.5 text-sm font-medium ${
                    periodEndClosingMode === 'MONTH' ? 'bg-violet-600 text-white' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Theo tháng
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodEndClosingMode('QUARTER')}
                  className={`border-l border-slate-200 px-3 py-1.5 text-sm font-medium ${
                    periodEndClosingMode === 'QUARTER' ? 'bg-violet-600 text-white' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Theo quý
                </button>
              </div>
              {periodEndClosingMode === 'MONTH' ? (
                <input
                  type="month"
                  value={periodEndClosingPeriod}
                  min={financialYear.startDate.slice(0, 7)}
                  max={financialYear.endDate.slice(0, 7)}
                  onChange={(e) => setPeriodEndClosingPeriod(e.target.value)}
                  className="min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-violet-500/35"
                />
              ) : (
                <select
                  value={periodEndClosingQuarter}
                  onChange={(e) => setPeriodEndClosingQuarter(e.target.value)}
                  className="min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-violet-500/35"
                >
                  {quarterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {activeBook !== 'PERIOD_CLOSING' && activeBook !== 'PERIOD_END_CLOSING' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-md border border-slate-200/90 bg-slate-50/80 px-2 py-1">
                <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input
                  type="date"
                  value={dateRange.from}
                  onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
                  className="w-[7.25rem] border-none bg-transparent text-[11px] font-semibold text-slate-700 outline-none"
                />
                <span className="text-slate-300">→</span>
                <input
                  type="date"
                  value={dateRange.to}
                  onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
                  className="w-[7.25rem] border-none bg-transparent text-[11px] font-semibold text-slate-700 outline-none"
                />
              </div>
              <button
                type="button"
                className="rounded-md border border-slate-200/90 bg-white p-1.5 text-slate-500 hover:bg-slate-50"
                title="In sổ sách"
              >
                <Printer className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-200/90 bg-white p-1.5 text-emerald-600 hover:bg-slate-50"
                title="Xuất Excel"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-hidden">{renderContent()}</div>
      </div>

      {openNavGroup &&
        openNavGroupMeta &&
        accountingMenuPlacement &&
        createPortal(
          <div
            ref={accountingMenuPortalRef}
            role="menu"
            aria-orientation="vertical"
            style={{
              position: 'fixed',
              top: accountingMenuPlacement.top,
              left: accountingMenuPlacement.left,
              width: accountingMenuPlacement.width,
            }}
            className="z-[100] max-h-[min(72vh,22rem)] overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_22px_56px_-12px_rgba(15,23,42,0.28),0_10px_28px_-8px_rgba(15,23,42,0.14)] ring-1 ring-slate-900/[0.05]"
          >
            <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50/95 to-white px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {openNavGroupMeta.label}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">Chọn sổ hoặc chức năng</p>
            </div>
            <ul
              className="custom-scrollbar flex max-h-[min(calc(72vh-5rem),18rem)] flex-col gap-1 overflow-y-auto overscroll-contain p-2.5"
              role="none"
            >
              {openNavGroupMeta.ids.map((id) => {
                const item = menuItems.find((m) => m.id === id);
                if (!item) return null;
                const RowIcon = item.icon;
                const rowActive = activeBook === item.id;
                return (
                  <li key={item.id} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      title={item.desc}
                      onClick={() => {
                        setActiveBook(item.id);
                        setOpenNavGroup(null);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left text-sm transition-all ${
                        rowActive
                          ? 'border-blue-100/80 bg-blue-50/90 font-medium text-blue-900 shadow-sm'
                          : 'text-slate-700 hover:border-slate-100 hover:bg-slate-50'
                      } `}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          rowActive ? 'bg-white text-blue-600 shadow-sm' : 'bg-slate-100/80 text-slate-500'
                        }`}
                      >
                        <RowIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
};

const GeneralJournalView = ({ dateRange }: { dateRange: { from: string, to: string } }) => {
  const { journalEntries, allInvoicesAcrossYears } = useApp();

  // --- PAGINATION (remember per filter) ---
  const baseStorageKey = 'summaryacct_general_journal_pagination';
  const filterSignature = useMemo(() => JSON.stringify({ from: dateRange.from, to: dateRange.to }), [dateRange.from, dateRange.to]);
  const filterKey = useMemo(() => `f_${hashString(filterSignature)}`, [filterSignature]);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<StandardPageSize>(20);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(baseStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      const saved = map?.[filterKey] || null;
      const lastSize = clampPageSize(Number(map?.__lastPageSize || 20));
      const p = Number(saved?.page || 1);
      const s = clampPageSize(Number(saved?.pageSize || lastSize));
      setPage(Number.isFinite(p) && p >= 1 ? p : 1);
      setPageSize(s);
    } catch {
      setPage(1);
      setPageSize(20);
    }
  }, [filterKey]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(baseStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      map[filterKey] = { page, pageSize, updatedAt: Date.now() };
      map.__lastPageSize = pageSize;
      sessionStorage.setItem(baseStorageKey, JSON.stringify(map));
    } catch {
      // ignore
    }
  }, [filterKey, page, pageSize]);

  const flattenedRows = useMemo(() => {
    const t0 = performance.now();
    const rows = journalEntries
      .filter(e => e.date >= dateRange.from && e.date <= dateRange.to)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .flatMap((entry) => entry.details.map((detail, idx) => ({ entry, detail, idx })));
    const ms = performance.now() - t0;
    logSlowQuery('SummaryAccounting.GeneralJournal.buildRows', ms, { rows: rows.length });
    return rows;
  }, [journalEntries, dateRange.from, dateRange.to]);

  const totalItems = flattenedRows.length;
  const safePageSize = clampPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  useEffect(() => {
    if (safePage !== page) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, totalPages]);

  const pagedRows = useMemo(() => {
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return flattenedRows.slice(from, to);
  }, [flattenedRows, safePage, safePageSize]);

  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-x-hidden">
      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-y-auto overflow-x-auto px-2 pt-2 pb-1">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
            <col className="w-[28%]" />
            <col className="w-[9%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200/90 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 top-0 z-[3] bg-slate-50 py-2 pl-2 pr-1 shadow-[2px_0_6px_-3px_rgba(15,23,42,0.12)]">
                Ngày ghi sổ
              </th>
              <th className="sticky top-0 z-[2] bg-slate-50 py-2 pr-1">Số CT</th>
              <th className="sticky top-0 z-[2] bg-slate-50 py-2 pr-1">Hóa đơn</th>
              <th className="sticky top-0 z-[2] bg-slate-50 py-2 pr-1">Diễn giải</th>
              <th className="sticky top-0 z-[2] bg-slate-50 py-2 text-center">TK</th>
              <th className="sticky top-0 z-[2] bg-slate-50 py-2 pr-1 text-right text-slate-600">Nợ</th>
              <th className="sticky top-0 z-[2] bg-slate-50 py-2 pr-2 text-right text-slate-600">Có</th>
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {pagedRows.map(({ entry, detail, idx }, rowIndex) => {
              const next = pagedRows[rowIndex + 1];
              const isLastOfEntry = !next || next.entry.id !== entry.id;
              const isOpen = expandedEntryId === entry.id;
              const rowMuted = isOpen ? 'bg-sky-50/55' : 'bg-white hover:bg-slate-50/90';
              const stickyBg = isOpen ? 'bg-sky-50/80' : 'bg-white group-hover:bg-slate-50/90';
              const invoiceLabel = formatJournalEntryInvoiceLabel(entry, allInvoicesAcrossYears);

              return (
                <React.Fragment key={`${entry.id}-${idx}`}>
                  <tr
                    className={`group cursor-pointer border-b border-slate-100/90 ${rowMuted}`}
                    onClick={() => setExpandedEntryId(prev => (prev === entry.id ? null : entry.id))}
                    title="Bấm để mở/đóng chi tiết bút toán"
                  >
                    <td
                      className={`sticky left-0 z-[1] border-r border-slate-200/50 py-1.5 pl-2 pr-2 text-[12px] text-slate-600 shadow-[2px_0_6px_-3px_rgba(15,23,42,0.08)] ${stickyBg}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {isLastOfEntry ? (
                          isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          )
                        ) : (
                          <span className="inline-block w-3.5" />
                        )}
                        {idx === 0 ? new Date(entry.date).toLocaleDateString('vi-VN') : ''}
                      </span>
                    </td>
                    <td className="py-1.5 pr-1 align-top font-mono text-[10px] font-semibold uppercase leading-tight text-blue-700 sm:text-[11px]">
                      {idx === 0 ? entry.referenceId : ''}
                    </td>
                    <td
                      className="max-w-0 truncate py-1.5 pr-1 align-top font-mono text-[10px] font-medium leading-tight text-violet-700 sm:text-[11px]"
                      title={idx === 0 ? invoiceLabel : undefined}
                    >
                      {idx === 0 ? invoiceLabel : ''}
                    </td>
                    <td className="hyphens-auto max-w-0 break-words py-1.5 pr-1 align-top text-[11px] leading-snug text-slate-600 sm:text-[12px]">
                      {idx === 0 ? entry.description : ''}
                    </td>
                    <td className="py-1.5 text-center font-mono text-[12px] font-medium text-slate-600">{detail.account}</td>
                    <td className="py-1.5 pr-1 text-right tabular-nums text-[13px] font-semibold text-emerald-700">
                      {detail.debit > 0 ? formatCurrency(detail.debit) : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-[13px] font-semibold text-rose-700">
                      {detail.credit > 0 ? formatCurrency(detail.credit) : '—'}
                    </td>
                  </tr>
                  {isOpen && isLastOfEntry && (
                    <tr className="bg-slate-50/95">
                      <td colSpan={7} className="border-b border-slate-200/80 px-3 py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 border-l-2 border-blue-500 pl-3">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                              Chi tiết bút toán
                            </span>
                            <div className="mt-0.5 font-semibold text-slate-900">{entry.referenceId}</div>
                            {invoiceLabel !== '—' && (
                              <p className="mt-0.5 text-[11px] font-medium text-violet-700">
                                Hóa đơn: {invoiceLabel}
                              </p>
                            )}
                            <p className="mt-0.5 max-w-2xl text-[12px] text-slate-600">{entry.description}</p>
                          </div>
                          <div className="text-right text-[12px] text-slate-600">
                            <span className="text-[10px] font-bold uppercase text-slate-400">Ngày ghi sổ</span>
                            <div className="font-semibold text-slate-800">
                              {new Date(entry.date).toLocaleDateString('vi-VN')}
                            </div>
                          </div>
                        </div>
                        <table className="mt-2 w-full max-w-xl border-collapse text-[12px]">
                          <thead>
                            <tr className="text-left text-[10px] font-bold uppercase text-slate-500">
                              <th className="pb-1 pr-3">TK</th>
                              <th className="pb-1 text-right">Nợ</th>
                              <th className="pb-1 pr-0 text-right">Có</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.details.map((d, i) => (
                              <tr key={i} className="border-t border-slate-200/70">
                                <td className="py-1 pr-3 font-mono font-medium text-slate-800">{d.account}</td>
                                <td className="py-1 text-right tabular-nums font-semibold text-emerald-700">
                                  {d.debit > 0 ? formatCurrency(d.debit) : '—'}
                                </td>
                                <td className="py-1 text-right tabular-nums font-semibold text-rose-700">
                                  {d.credit > 0 ? formatCurrency(d.credit) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {totalItems === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-[13px] text-slate-400">
                  Không có bút toán phát sinh trong khoảng thời gian này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        variant="compact"
        page={safePage}
        totalItems={totalItems}
        pageSize={safePageSize}
        onChangePage={setPage}
        onChangePageSize={(s) => setPageSize(clampPageSize(s))}
      />
    </div>
  );
};

const LedgerView = ({ dateRange, accounts, title, type = 'SPECIFIC' }: { dateRange: any, accounts?: string[], title: string, type?: 'ALL' | 'SPECIFIC' }) => {
  const { journalEntries, accounts: accountDefinitions } = useApp();
  
  const [selectedAcc, setSelectedAcc] = useState<string>('');
  const [expandedLedgerRow, setExpandedLedgerRow] = useState<number | null>(null);

  // Pagination (remember per filter signature)
  const baseStorageKey = 'summaryacct_ledger_pagination';
  const filterSignature = useMemo(() => JSON.stringify({
    selectedAcc,
    from: dateRange.from,
    to: dateRange.to,
    title,
    type,
    allowed: accounts || []
  }), [accounts, dateRange.from, dateRange.to, selectedAcc, title, type]);
  const filterKey = useMemo(() => `f_${hashString(filterSignature)}`, [filterSignature]);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<StandardPageSize>(20);

  useEffect(() => {
    if (type === 'ALL') {
      setSelectedAcc(accountDefinitions.find(a => a.code === '1111')?.code || accountDefinitions[0]?.code || '1111');
    } else if (accounts && accounts.length > 0) {
      setSelectedAcc(accounts[0]);
    }
  }, [accounts, type, accountDefinitions]);

  const filteredData = useMemo(() => {
    if (!selectedAcc) return { openingBalance: 0, periodEntries: [] };

    let openingBalance = 0;
    
    journalEntries.forEach(entry => {
      if (entry.date < dateRange.from) {
        entry.details.forEach(d => {
          // Fix: Logic correctly uses startsWith(selectedAcc) to check if account matches
          if (d.account.startsWith(selectedAcc)) {
            const isAsset = ['1', '2', '6', '8'].some(p => selectedAcc.startsWith(p));
            if (isAsset) openingBalance += (d.debit - d.credit);
            else openingBalance += (d.credit - d.debit);
          }
        });
      }
    });

    const periodEntries: any[] = [];
    journalEntries
      .filter(e => e.date >= dateRange.from && e.date <= dateRange.to)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .forEach(entry => {
         const matchDetails = entry.details.filter(d => d.account.startsWith(selectedAcc));
         if (matchDetails.length > 0) {
            matchDetails.forEach(md => {
               const offsetAcc = entry.details.find(d => d.account !== md.account)?.account || '---';
               periodEntries.push({
                  date: entry.date,
                  voucher: entry.referenceId,
                  desc: entry.description,
                  offsetAcc,
                  debit: md.debit,
                  credit: md.credit
               });
            });
         }
      });

    return { openingBalance, periodEntries };
  }, [journalEntries, dateRange, selectedAcc]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(baseStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      const saved = map?.[filterKey] || null;
      const lastSize = clampPageSize(Number(map?.__lastPageSize || 20));
      const p = Number(saved?.page || 1);
      const s = clampPageSize(Number(saved?.pageSize || lastSize));
      setPage(Number.isFinite(p) && p >= 1 ? p : 1);
      setPageSize(s);
    } catch {
      setPage(1);
      setPageSize(20);
    }
  }, [filterKey]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(baseStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      map[filterKey] = { page, pageSize, updatedAt: Date.now() };
      map.__lastPageSize = pageSize;
      sessionStorage.setItem(baseStorageKey, JSON.stringify(map));
    } catch {
      // ignore
    }
  }, [filterKey, page, pageSize]);

  const totalItems = filteredData.periodEntries.length;
  const safePageSize = clampPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  useEffect(() => { if (safePage !== page) setPage(safePage); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [safePage, totalPages]);

  useEffect(() => {
    setExpandedLedgerRow(null);
  }, [safePage, filterKey, selectedAcc]);

  const pagedRows = useMemo(() => {
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return filteredData.periodEntries.slice(from, to);
  }, [filteredData.periodEntries, safePage, safePageSize]);

  const accName = accountDefinitions.find(a => a.code === selectedAcc)?.name || 'Tài khoản';

  if (!selectedAcc && (type === 'SPECIFIC' && accounts && accounts.length > 0)) return (
    <div className="flex items-center justify-center h-full text-slate-400">
      <RefreshCw className="w-6 h-6 animate-spin mr-2" /> Đang tải dữ liệu tài khoản...
    </div>
  );

  return (
     <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-x-hidden">
        <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2 border-b border-slate-200/80 bg-slate-50/50 px-2 py-1.5">
           <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tài khoản</span>
           <select 
              value={selectedAcc} 
              onChange={e => { setSelectedAcc(e.target.value); setExpandedLedgerRow(null); }}
              className="max-w-full min-w-0 flex-1 rounded-md border border-slate-200/90 bg-white py-1 pl-2 pr-2 text-[12px] font-semibold text-blue-800 outline-none focus:ring-1 focus:ring-blue-500 sm:max-w-[min(100%,280px)] sm:flex-none"
           >
              {type === 'ALL' 
                ? accountDefinitions.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)
                : accounts?.map(code => (
                    <option key={code} value={code}>{code} - {accountDefinitions.find(a => a.code === code)?.name || code}</option>
                  ))
              }
           </select>
           <div className="min-w-0 flex-1 text-right text-[11px] text-slate-500">
              <span className="font-semibold text-slate-800">{selectedAcc}</span>
              <span className="text-slate-400"> · </span>
              <span className="truncate">{accName}</span>
           </div>
        </div>
        
        <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-y-auto overflow-x-auto px-2 pt-2 pb-1 custom-scrollbar">
           <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[13px]">
              <colgroup>
                <col className="w-[11%]" />
                <col className="w-[11%]" />
                <col className="w-[26%]" />
                <col className="w-[9%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead>
                 <tr className="border-b border-slate-200/90 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="sticky left-0 top-0 z-[3] bg-slate-50 py-2 pl-2 pr-1 shadow-[2px_0_6px_-3px_rgba(15,23,42,0.12)]">Ngày CT</th>
                    <th className="sticky top-0 z-[2] bg-slate-50 py-2 pr-1">Số CT</th>
                    <th className="sticky top-0 z-[2] bg-slate-50 py-2 pr-1">Diễn giải</th>
                    <th className="sticky top-0 z-[2] bg-slate-50 py-2 text-center">Đối ứng</th>
                    <th className="sticky top-0 z-[2] bg-slate-50 py-2 pr-1 text-right text-slate-600">PS Nợ</th>
                    <th className="sticky top-0 z-[2] bg-slate-50 py-2 pr-1 text-right text-slate-600">PS Có</th>
                    <th className="sticky top-0 z-[2] bg-slate-50 py-2 pr-2 text-right text-slate-700">Số dư</th>
                 </tr>
              </thead>
              <tbody>
                 <tr className="border-b border-slate-100/90 bg-sky-50/40 font-semibold">
                    <td className="sticky left-0 z-[1] border-r border-slate-200/50 bg-sky-50/90 py-1.5 pl-2 pr-2 text-[12px] text-slate-600 shadow-[2px_0_6px_-3px_rgba(15,23,42,0.08)]">{new Date(dateRange.from).toLocaleDateString('vi-VN')}</td>
                    <td className="py-1.5 pr-2"></td>
                    <td className="py-1.5 pr-2 text-slate-800">Số dư đầu kỳ</td>
                    <td className="py-1.5"></td>
                    <td className="py-1.5"></td>
                    <td className="py-1.5"></td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-[13px] font-semibold text-blue-800">{formatCurrency(filteredData.openingBalance)}</td>
                 </tr>
                 
                 {(() => {
                    const isAsset = ['1', '2', '6', '8'].some(p => selectedAcc.startsWith(p));
                    
                    const size = Math.min(100, safePageSize);
                    const pageStartIndex = (safePage - 1) * size;

                    let running = filteredData.openingBalance;
                    for (let i = 0; i < pageStartIndex; i++) {
                      const r = filteredData.periodEntries[i];
                      if (!r) break;
                      if (isAsset) running += (r.debit - r.credit);
                      else running += (r.credit - r.debit);
                    }

                    return pagedRows.map((row, idx) => {
                       if (isAsset) running += (row.debit - row.credit);
                       else running += (row.credit - row.debit);
                       
                       const key = `${pageStartIndex + idx}`;
                       const isOpen = expandedLedgerRow === idx;
                       const rowBg = isOpen ? 'bg-sky-50/55' : 'bg-white hover:bg-slate-50/90';
                       const stickyBg = isOpen ? 'bg-sky-50/80' : 'bg-white group-hover:bg-slate-50/90';
                       return (
                         <React.Fragment key={key}>
                          <tr
                            className={`group cursor-pointer border-b border-slate-100/90 ${rowBg}`}
                            onClick={() => setExpandedLedgerRow(p => (p === idx ? null : idx))}
                            title="Bấm để mở/đóng chi tiết dòng"
                          >
                             <td className={`sticky left-0 z-[1] border-r border-slate-200/50 py-1.5 pl-2 pr-2 text-[12px] text-slate-600 shadow-[2px_0_6px_-3px_rgba(15,23,42,0.08)] ${stickyBg}`}>
                               <span className="inline-flex items-center gap-1">
                                 {isOpen ? (
                                   <ChevronDown className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                                 ) : (
                                   <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                 )}
                                 {new Date(row.date).toLocaleDateString('vi-VN')}
                               </span>
                             </td>
                             <td className="py-1.5 pr-1 align-top font-mono text-[10px] font-semibold uppercase leading-tight text-blue-700 sm:text-[11px]">{row.voucher}</td>
                             <td className="hyphens-auto max-w-0 break-words py-1.5 pr-1 align-top text-[11px] leading-snug text-slate-600 sm:text-[12px]">{row.desc}</td>
                             <td className="py-1.5 text-center font-mono text-[12px] font-medium text-slate-500">{row.offsetAcc}</td>
                             <td className="py-1.5 pr-1 text-right tabular-nums text-[13px] font-semibold text-emerald-700">{row.debit > 0 ? formatCurrency(row.debit) : '—'}</td>
                             <td className="py-1.5 pr-1 text-right tabular-nums text-[13px] font-semibold text-rose-700">{row.credit > 0 ? formatCurrency(row.credit) : '—'}</td>
                             <td className="py-1.5 pr-2 text-right tabular-nums text-[13px] font-semibold text-slate-800">{formatCurrency(running)}</td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-slate-50/95">
                              <td colSpan={7} className="border-b border-slate-200/80 px-3 py-2">
                                <div className="flex flex-wrap items-start justify-between gap-3 border-l-2 border-blue-500 pl-3 text-[12px]">
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Chi tiết dòng</span>
                                    <div className="mt-0.5 font-mono font-semibold text-slate-900">{row.voucher}</div>
                                    <p className="mt-1 max-w-2xl text-slate-600">{row.desc}</p>
                                    <p className="mt-1 text-slate-500">TK đối ứng: <span className="font-mono font-semibold text-slate-800">{row.offsetAcc}</span></p>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-[10px] font-bold uppercase text-slate-400">Phát sinh</div>
                                    <div className="mt-0.5 tabular-nums text-[13px] font-semibold text-emerald-700">{row.debit > 0 ? `Nợ ${formatCurrency(row.debit)}` : ''}</div>
                                    <div className="tabular-nums text-[13px] font-semibold text-rose-700">{row.credit > 0 ? `Có ${formatCurrency(row.credit)}` : ''}</div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                         </React.Fragment>
                       );
                    });
                 })()}

                 {filteredData.periodEntries.length === 0 && (
                   <tr><td colSpan={7} className="py-8 text-center text-[13px] text-slate-400">Không có phát sinh cho tài khoản {selectedAcc} trong kỳ.</td></tr>
                 )}
              </tbody>
              <tfoot>
                 <tr className="border-t-2 border-slate-200/90 bg-slate-50/80 font-bold">
                    <td className="sticky left-0 z-[1] border-r border-slate-200/50 bg-slate-50/95 py-2 pl-2 pr-2 text-[10px] uppercase tracking-tight text-slate-500 shadow-[2px_0_6px_-3px_rgba(15,23,42,0.08)]" colSpan={4}>Tổng PS & số dư cuối kỳ</td>
                    <td className="py-2 pr-1 text-right tabular-nums text-[13px] font-semibold text-emerald-700">
                       {formatCurrency(filteredData.periodEntries.reduce((s, r) => s + r.debit, 0))}
                    </td>
                    <td className="py-2 pr-1 text-right tabular-nums text-[13px] font-semibold text-rose-700">
                       {formatCurrency(filteredData.periodEntries.reduce((s, r) => s + r.credit, 0))}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-[14px] font-semibold text-blue-900">
                       {(() => {
                          let running = filteredData.openingBalance;
                          const isAsset = ['1', '2', '6', '8'].some(p => selectedAcc.startsWith(p));
                          filteredData.periodEntries.forEach(r => {
                             if (isAsset) running += (r.debit - r.credit);
                             else running += (r.credit - r.debit);
                          });
                          return formatCurrency(running);
                       })()}
                    </td>
                 </tr>
              </tfoot>
           </table>
        </div>

        <Pagination
          variant="compact"
          page={safePage}
          totalItems={totalItems}
          pageSize={safePageSize}
          onChangePage={setPage}
          onChangePageSize={(s) => setPageSize(clampPageSize(s))}
        />
     </div>
  );
};

type PeriodEndClosingViewProps = {
  periods: string[];
  selectionLabel: string;
};

const PeriodEndClosingView = ({ periods, selectionLabel }: PeriodEndClosingViewProps) => {
  const {
    journalEntries,
    allInvoicesAcrossYears,
    allJournalEntriesAcrossYears,
    handlePeriodClosing,
    handleUndoPeriodClosing,
    accounts,
    inventoryCatalog,
    financialYear,
    setPeriodLock,
    accountingPeriods,
  } = useApp();
  const currentFiscalYearStr = useMemo(() => new Date(financialYear.startDate).getFullYear().toString(), [financialYear]);

  const [activeStep, setActiveStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deferredInvoiceSelected, setDeferredInvoiceSelected] = useState<Record<string, boolean>>({});
  const selectedPeriodsKey = useMemo(() => periods.join('|'), [periods]);

  useEffect(() => {
    setDeferredInvoiceSelected({});
    setActiveStep(1);
  }, [selectedPeriodsKey]);

  const buildSnapshotForPeriod = useCallback((period: string) => {
    const isDeferredRowSelected = (item: { selectionKey: string; alreadyPosted: boolean }) =>
      item.alreadyPosted || deferredInvoiceSelected[item.selectionKey] !== false;
    const startOfMonth = `${period}-01`;
    const endOfMonth = getPeriodEndDate(period);
    const deferredInvoices = allInvoicesAcrossYears.filter((invoice) =>
      isDeferredRevenueInvoice(invoice) && String(invoice.date || '') <= endOfMonth,
    );
    const deferredRevenueAllocations = deferredInvoices
      .map((invoice) => {
        const scheduleRows = buildDeferredRevenueScheduleWithStatus(
          invoice,
          allJournalEntriesAcrossYears.filter((entry) => entry.date <= endOfMonth),
        );
        const row = scheduleRows.find((item) => item.period === period);
        if (!row || row.amount <= 0) return null;
        return {
          selectionKey: `${invoice.id}__${period}`,
          period,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          revenueAccount: getDeferredRevenueRecognitionAccount(invoice),
          amount: row.amount,
          days: row.days,
          startDate: row.startDate,
          endDate: row.endDate,
          alreadyPosted: row.posted,
        };
      })
      .filter(Boolean);
    const selectedDeferredAllocations = deferredRevenueAllocations.filter((item) => isDeferredRowSelected(item as any));
    const deferredPostingRefs = new Set(
      selectedDeferredAllocations.map((item) => getDeferredRevenuePostingRef((item as any).invoiceId, period)),
    );
    const journalEntriesForPreview = allJournalEntriesAcrossYears.filter(
      (entry) => entry.date <= endOfMonth && !deferredPostingRefs.has(String(entry.referenceId || '')),
    );
    const periodEntries = journalEntries.filter(e =>
      e.date >= startOfMonth &&
      e.date <= endOfMonth &&
      e.date >= financialYear.startDate &&
      e.date <= financialYear.endDate &&
      !deferredPostingRefs.has(String(e.referenceId || ''))
    );

    const isRenewalPurchaseEntry = (e: JournalEntry) => {
      const id = String(e.id || '');
      const ref = String(e.referenceId || '');
      return id.includes('INV-PUR-REN-') || ref.includes('PN-REN');
    };
    const wip154Renewal = periodEntries
      .filter(isRenewalPurchaseEntry)
      .reduce((sum, e) => sum + e.details.reduce((s, d) => d.account.startsWith('154') ? s + (d.debit - d.credit) : s, 0), 0);
    const wip154To632 = wip154Renewal > 0 ? wip154Renewal : 0;

    const relevantAccCodes = new Set<string>();
    periodEntries.forEach(e => e.details.forEach(d => {
       const firstChar = d.account[0];
       if (['5', '6', '7', '8'].includes(firstChar)) relevantAccCodes.add(d.account);
    }));

    const details = Array.from(relevantAccCodes).map(code => {
       const accName = accounts.find(a => a.code === code)?.name || 'Tài khoản';
       const netBalance = periodEntries.reduce((sum, e) => 
          sum + e.details.reduce((s, d) => d.account === code ? s + (d.debit - d.credit) : s, 0), 0);
       return { code, name: accName, balance: netBalance };
    }).filter(d => d.balance !== 0);

    const revenueMap = new Map<string, { code: string; name: string; balance: number }>();
    details
      .filter(d => ['5', '7'].includes(d.code[0]))
      .forEach((item) => {
        revenueMap.set(item.code, { ...item });
      });
    selectedDeferredAllocations.forEach((item: any) => {
      const existing = revenueMap.get(item.revenueAccount);
      if (existing) {
        existing.balance -= item.amount;
        return;
      }
      revenueMap.set(item.revenueAccount, {
        code: item.revenueAccount,
        name: accounts.find(a => a.code === item.revenueAccount)?.name || 'Doanh thu phân bổ',
        balance: -item.amount,
      });
    });
    const revenueItems = Array.from(revenueMap.values());
    const expenseItemsRaw = details.filter(d => ['6', '8'].includes(d.code[0]));
    const existing632 = expenseItemsRaw.find(i => i.code === '632');
    const base632 = existing632 ? (existing632.balance > 0 ? existing632.balance : Math.abs(existing632.balance)) : 0;
    const merged632 = base632 + wip154To632;
    const expenseItems = [
      ...expenseItemsRaw.filter(i => i.code !== '632'),
      ...(merged632 > 0 ? [{ code: '632', name: accounts.find(a => a.code === '632')?.name || 'Giá vốn hàng bán', balance: merged632 }] : []),
    ];

    const totalRev = revenueItems.reduce((s, i) => s + Math.abs(i.balance), 0);
    const totalExp = expenseItems.reduce((s, i) => s + Math.abs(i.balance), 0);
    const plannedDeferredTotal = selectedDeferredAllocations.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0);
    const deferredLedgerPreviewBasis = journalEntriesForPreview.reduce((sum, entry) => (
      sum + entry.details.reduce((detailSum, detail) => (
        String(detail.account || '').startsWith('3387')
          ? detailSum + (Number(detail.credit || 0) - Number(detail.debit || 0))
          : detailSum
      ), 0)
    ), 0);
    const deferredRemainingPreviewBasis = deferredInvoices.reduce(
      (sum, invoice) => sum + getDeferredRevenueRemainingBalance(invoice, journalEntriesForPreview),
      0,
    );
    const projectedDeferredLedger = deferredLedgerPreviewBasis - plannedDeferredTotal;
    const projectedDeferredRemaining = deferredRemainingPreviewBasis - plannedDeferredTotal;

    return {
      period,
      revenueItems,
      expenseItems,
      totalRev,
      totalExp,
      profit: totalRev - totalExp,
      wip154To632,
      deferredRevenueAllocations: deferredRevenueAllocations as any[],
      selectedDeferredAllocations: selectedDeferredAllocations as any[],
      selectedDeferredNewPostings: (selectedDeferredAllocations as any[]).filter((item) => !item.alreadyPosted),
      periodHas3387Posting: allJournalEntriesAcrossYears.some((e) =>
        String(e.referenceId || '').startsWith(`PB-3387-${period}-`),
      ),
      plannedDeferredTotal,
      deferredLedgerPreviewBasis,
      deferredRemainingPreviewBasis,
      projectedDeferredLedger,
      projectedDeferredRemaining,
      projectedDeferredMismatch: Math.abs(projectedDeferredLedger - projectedDeferredRemaining) > 0.5,
    };
  }, [journalEntries, allInvoicesAcrossYears, allJournalEntriesAcrossYears, accounts, financialYear, deferredInvoiceSelected]);

  const monthlySnapshots = useMemo(
    () => periods.map((period) => buildSnapshotForPeriod(period)),
    [periods, buildSnapshotForPeriod],
  );

  const gatheredBalances = useMemo(() => {
    const revenueMap = new Map<string, { code: string; name: string; balance: number }>();
    const expenseMap = new Map<string, { code: string; name: string; balance: number }>();
    monthlySnapshots.forEach((snapshot) => {
      snapshot.revenueItems.forEach((item) => {
        const current = revenueMap.get(item.code);
        if (current) current.balance += item.balance;
        else revenueMap.set(item.code, { ...item });
      });
      snapshot.expenseItems.forEach((item) => {
        const current = expenseMap.get(item.code);
        if (current) current.balance += item.balance;
        else expenseMap.set(item.code, { ...item });
      });
    });
    const revenueItems = Array.from(revenueMap.values());
    const expenseItems = Array.from(expenseMap.values());
    const totalRev = revenueItems.reduce((sum, item) => sum + Math.abs(item.balance), 0);
    const totalExp = expenseItems.reduce((sum, item) => sum + Math.abs(item.balance), 0);
    const deferredRevenueAllocations = monthlySnapshots.flatMap((snapshot) => snapshot.deferredRevenueAllocations);
    const selectedDeferredAllocations = monthlySnapshots.flatMap((snapshot) => snapshot.selectedDeferredAllocations);
    const selectedDeferredNewPostings = monthlySnapshots.flatMap((snapshot) => snapshot.selectedDeferredNewPostings);
    const plannedDeferredTotal = monthlySnapshots.reduce((sum, snapshot) => sum + snapshot.plannedDeferredTotal, 0);
    const deferredLedgerPreviewBasis = monthlySnapshots.reduce((sum, snapshot) => sum + snapshot.deferredLedgerPreviewBasis, 0);
    const deferredRemainingPreviewBasis = monthlySnapshots.reduce((sum, snapshot) => sum + snapshot.deferredRemainingPreviewBasis, 0);
    const projectedDeferredLedger = monthlySnapshots.reduce((sum, snapshot) => sum + snapshot.projectedDeferredLedger, 0);
    const projectedDeferredRemaining = monthlySnapshots.reduce((sum, snapshot) => sum + snapshot.projectedDeferredRemaining, 0);
    return {
      revenueItems,
      expenseItems,
      totalRev,
      totalExp,
      profit: totalRev - totalExp,
      wip154To632: monthlySnapshots.reduce((sum, snapshot) => sum + snapshot.wip154To632, 0),
      deferredRevenueAllocations,
      selectedDeferredAllocations,
      selectedDeferredNewPostings,
      periodHas3387Posting: monthlySnapshots.some((snapshot) => snapshot.periodHas3387Posting),
      plannedDeferredTotal,
      deferredLedgerPreviewBasis,
      deferredRemainingPreviewBasis,
      projectedDeferredLedger,
      projectedDeferredRemaining,
      projectedDeferredMismatch: Math.abs(projectedDeferredLedger - projectedDeferredRemaining) > 0.5,
    };
  }, [monthlySnapshots]);

  const handleExecuteClosing = () => {
    setIsProcessing(true);

    setTimeout(() => {
      const closingRefs = periods.flatMap((period) => [
        `KC-DT-${period}`,
        `KC-CP-${period}`,
        `KC-KQ-${period}`,
        `GV-154-${period}`,
      ]);
      const hasClosingBatch = journalEntries.some((e) => closingRefs.includes(String(e.referenceId || '')));
      if (hasClosingBatch) {
        const ok = window.confirm(
          'Phạm vi đã chọn đã có bút toán kết chuyển (KC-DT / KC-CP / KC-KQ / GV-154). Tiếp tục sẽ xóa các bút này để ghi lại.\n\n' +
            'Các bút phân bổ 3387 (PB-3387-...) đã ghi sổ được giữ nguyên — không xóa khi kết chuyển lại.',
        );
        if (!ok) {
          setIsProcessing(false);
          return;
        }
        closingRefs.forEach((r) => handleUndoPeriodClosing(r));
      }

      const reconciliationIssues: string[] = [];
      const entriesToSave: JournalEntry[] = [];

      for (const snapshot of monthlySnapshots) {
        const period = snapshot.period;
        const [year, month] = period.split('-').map(Number);
        const startOfMonth = `${period}-01`;
        const endOfMonth = getPeriodEndDate(period);

        let addedExpense632 = 0;
        let debit632TotalForCogs = 0;
        let creditInv154156TotalForCogs = 0;

        const candidateSalesInvoices = allInvoicesAcrossYears.filter((inv) => {
          if (inv.type !== 'SALES') return false;
          const invId = String(inv.id || '');
          if (/^INV-SALES-BATCH-/.test(invId) || /^INV-SALES-TRX-/.test(invId)) return false;
          if (/^INV-REN-/.test(invId)) return false;
          const hasCogsLine = (inv.details || []).some(
            (d) => (String(d?.type || '') === 'GOODS' || String(d?.type || '') === 'SERVICE') && Number(d?.quantity || 0) > 0,
          );
          if (!hasCogsLine) return false;

          const ledgerDate = String(inv.accountingPostingDate || inv.date || '').split('T')[0];
          if (!ledgerDate) return false;
          if (ledgerDate < startOfMonth || ledgerDate > endOfMonth) return false;
          if (ledgerDate < financialYear.startDate || ledgerDate > financialYear.endDate) return false;
          return true;
        });

        for (const inv of candidateSalesInvoices) {
          const invId = String(inv.id || '');
          const ledgerDate = String(inv.accountingPostingDate || inv.date || '').split('T')[0];
          const expected = buildInvoiceCogsJournalEntry(inv, inventoryCatalog, ledgerDate);
          const expectedCostJeId = `JE-INV-COGS-${invId}`;
          const existingCostJe = journalEntries.find((je) => String(je.id || '') === expectedCostJeId);

          if (expected.issues.length > 0) {
            reconciliationIssues.push(...expected.issues.map((x) => `[${period}] HĐ ${inv.invoiceNumber || invId}: ${x}`));
            continue;
          }

          if (expected.expectedTotal <= 0) {
            if (existingCostJe) {
              const existingDebit = (existingCostJe.details || []).reduce(
                (s, d) => s + Number(d.debit || 0),
                0,
              );
              if (Math.abs(existingDebit) > 0.5) {
                reconciliationIssues.push(
                  `[${period}] HĐ ${inv.invoiceNumber || invId}: COGS kỳ vọng bằng 0 nhưng đã có bút toán ${expectedCostJeId} ghi ${existingDebit}.`,
                );
              }
            }
            continue;
          }

          if (!expected.journalEntry) {
            reconciliationIssues.push(
              `[${period}] HĐ ${inv.invoiceNumber || invId}: Không tạo được bút toán COGS dù đã tính ra giá trị.`,
            );
            continue;
          }

          const expectedCostJe = expected.journalEntry;
          const expectedDebitTotal = expected.expectedTotal;

          const expectedCreditInv154156 = (expectedCostJe.details || [])
            .filter((d) => Number(d.credit || 0) > 0 && (String(d.account || '').startsWith('154') || String(d.account || '').startsWith('156')))
            .reduce((s, d) => s + Number(d.credit || 0), 0);

          if (Math.abs(expectedCreditInv154156 - expectedDebitTotal) > 0.5) {
            reconciliationIssues.push(
              `[${period}] HĐ ${inv.invoiceNumber || invId}: Giá vốn phải được ghi Nợ 632 và Có 154/156. Hệ thống đang Có ${expectedCreditInv154156} (kỳ vọng ${expectedDebitTotal}). Kiểm tra mapping TK tồn kho cho vật tư.`,
            );
            continue;
          }

          if (existingCostJe) {
            const existingDebitTotal = (existingCostJe.details || [])
              .filter((d) => String(d.account || '') === expected.costDebitAccount)
              .reduce((s, d) => s + Number(d.debit || 0), 0);

            if (Math.abs(existingDebitTotal - expectedDebitTotal) > 0.5) {
              reconciliationIssues.push(
                `[${period}] HĐ ${inv.invoiceNumber || invId}: Bút toán ${expectedCostJeId} lệch giá vốn (cần ${expectedDebitTotal}, hiện ${existingDebitTotal}).`,
              );
              continue;
            }

            const existingCreditInv154156 = (existingCostJe.details || [])
              .filter((d) => Number(d.credit || 0) > 0 && (String(d.account || '').startsWith('154') || String(d.account || '').startsWith('156')))
              .reduce((s, d) => s + Number(d.credit || 0), 0);

            if (Math.abs(existingCreditInv154156 - expectedDebitTotal) > 0.5) {
              reconciliationIssues.push(
                `[${period}] HĐ ${inv.invoiceNumber || invId}: Bút toán ${expectedCostJeId} lệch đối ứng 154/156 (cần ${expectedDebitTotal}, hiện ${existingCreditInv154156}).`,
              );
              continue;
            }
          } else {
            entriesToSave.push(expectedCostJe);
            if (expected.costDebitAccount === '632') addedExpense632 += expectedDebitTotal;
          }

          if (expected.costDebitAccount === '632') {
            debit632TotalForCogs += expectedDebitTotal;
            creditInv154156TotalForCogs += expectedDebitTotal;
          }
        }

        if (snapshot.wip154To632 > 0) {
          debit632TotalForCogs += snapshot.wip154To632;
          creditInv154156TotalForCogs += snapshot.wip154To632;
        }

        if (Math.abs(debit632TotalForCogs - creditInv154156TotalForCogs) > 0.5) {
          reconciliationIssues.push(
            `[${period}] Chênh lệch chặt chẽ 154/156 ↔ 632: Nợ 632 = ${debit632TotalForCogs}, Có 154/156 = ${creditInv154156TotalForCogs}.`,
          );
        }

        let expenseItemsForClose = snapshot.expenseItems.map((i) => ({ ...i }));
        if (addedExpense632 > 0) {
          const idx632 = expenseItemsForClose.findIndex((x) => x.code === '632');
          const name632 = accounts.find((a) => a.code === '632')?.name || 'Giá vốn hàng bán';
          if (idx632 >= 0) {
            expenseItemsForClose[idx632] = {
              ...expenseItemsForClose[idx632],
              balance: expenseItemsForClose[idx632].balance + addedExpense632,
            };
          } else {
            expenseItemsForClose.push({ code: '632', name: name632, balance: addedExpense632 });
          }
        }
        const totalExpForClose = expenseItemsForClose.reduce((s, i) => s + Math.abs(i.balance), 0);
        const profitForClose = snapshot.totalRev - totalExpForClose;

        if (snapshot.wip154To632 > 0) {
          entriesToSave.push({
            id: `JE-COGS-WIP-${Date.now()}-${period}`,
            date: endOfMonth,
            referenceId: `GV-154-${period}`,
            description: `[GV] Kết chuyển tập hợp 154 → 632 (Gia hạn) tháng ${String(month).padStart(2, '0')}/${year}`,
            details: [
              { account: '632', debit: snapshot.wip154To632, credit: 0 },
              { account: '154', debit: 0, credit: snapshot.wip154To632 },
            ]
          });
        }

        snapshot.deferredRevenueAllocations
          .filter((item) => deferredInvoiceSelected[item.selectionKey] !== false && !item.alreadyPosted)
          .forEach((item) => {
            entriesToSave.push({
              id: `JE-3387-${item.invoiceId}-${item.period}`,
              date: endOfMonth,
              referenceId: getDeferredRevenuePostingRef(item.invoiceId, item.period),
              description: `[PB3387] Phân bổ doanh thu chưa thực hiện HĐ ${item.invoiceNumber} (${item.customerName}) tháng ${String(month).padStart(2, '0')}/${year}`,
              details: [
                {
                  account: '3387',
                  debit: item.amount,
                  credit: 0,
                  objectType: 'CUSTOMER',
                  objectId: item.invoiceId,
                  objectName: item.customerName,
                  sourceInvoiceId: item.invoiceId,
                  sourceInvoiceNumber: item.invoiceNumber,
                },
                {
                  account: item.revenueAccount,
                  debit: 0,
                  credit: item.amount,
                  objectType: 'CUSTOMER',
                  objectId: item.invoiceId,
                  objectName: item.customerName,
                  sourceInvoiceId: item.invoiceId,
                  sourceInvoiceNumber: item.invoiceNumber,
                },
              ],
            });
          });

        if (snapshot.revenueItems.length > 0) {
          entriesToSave.push({
            id: `JE-REV-CLOSE-${Date.now()}-${period}`,
            date: endOfMonth,
            referenceId: `KC-DT-${period}`,
            description: `[KC-DT] Kết chuyển doanh thu, thu nhập chi tiết tháng ${String(month).padStart(2, '0')}/${year}`,
            details: [
              ...snapshot.revenueItems.map(d => ({ account: d.code, debit: Math.abs(d.balance), credit: 0 })),
              { account: '911', debit: 0, credit: snapshot.totalRev }
            ]
          });
        }

        if (expenseItemsForClose.length > 0) {
          entriesToSave.push({
            id: `JE-EXP-CLOSE-${Date.now()}-${period}`,
            date: endOfMonth,
            referenceId: `KC-CP-${period}`,
            description: `[KC-CP] Kết chuyển chi phí hoạt động chi tiết tháng ${String(month).padStart(2, '0')}/${year}`,
            details: [
              ...expenseItemsForClose.map(d => ({ account: d.code, debit: 0, credit: Math.abs(d.balance) })),
              { account: '911', debit: totalExpForClose, credit: 0 }
            ]
          });
        }

        if (profitForClose !== 0) {
          const isProfit = profitForClose > 0;
          entriesToSave.push({
            id: `JE-RES-CLOSE-${Date.now()}-${period}`,
            date: endOfMonth,
            referenceId: `KC-KQ-${period}`,
            description: `[KC-KQ] Kết chuyển ${isProfit ? 'lãi' : 'lỗ'} xác định KQKD tháng ${String(month).padStart(2, '0')}/${year}`,
            details: isProfit
              ? [{ account: '911', debit: profitForClose, credit: 0 }, { account: '421', debit: 0, credit: profitForClose }]
              : [{ account: '421', debit: Math.abs(profitForClose), credit: 0 }, { account: '911', debit: 0, credit: Math.abs(profitForClose) }]
          });
        }
      }

      if (reconciliationIssues.length > 0) {
        window.alert(
          'Không thể khóa kết chuyển cuối kỳ vì chưa reconcile đủ giá vốn 632 / đối ứng 154-156:\n' +
            reconciliationIssues.slice(0, 8).join('\n') +
            `${reconciliationIssues.length > 8 ? '\n...' : ''}`,
        );
        setIsProcessing(false);
        return;
      }

      handlePeriodClosing(entriesToSave);

      try {
        const b01bAfter = computeB01bTotals([...journalEntries, ...entriesToSave], financialYear.endDate);
        if (!b01bAfter.isBalanced) {
          window.alert(
            `Không khóa được vì B01b-DNN vẫn lệch sau khi kết chuyển.\n` +
              `Chênh lệch: ${b01bAfter.diff}`,
          );
        } else {
          periods.forEach((period) => {
            const [year, month] = period.split('-').map(Number);
            const targetPeriodId = `PERIOD-${year}-${String(month).padStart(2, '0')}`;
            const exists = accountingPeriods.some((p) => p.id === targetPeriodId);
            if (exists) setPeriodLock(targetPeriodId, 'SOFT');
          });
        }
      } catch {}

      setIsProcessing(false);
      setActiveStep(4);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/30">
       <div className="flex-1 overflow-y-auto px-2 py-4 sm:px-4 lg:px-6 custom-scrollbar">
          {activeStep === 1 && (
             <div className="mx-auto w-full max-w-[100%] space-y-6 animate-fade-in">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_4px_rgba(15,23,42,0.06)] sm:p-6">
                   <h4 className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
                      <ListChecks className="h-4 w-4 shrink-0 text-violet-500" aria-hidden />
                      Bước 1: Tập hợp số dư tài khoản kết quả (Niên độ {currentFiscalYearStr})
                   </h4>
                   <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-2 lg:gap-6">
                      <div className="flex min-h-0 flex-col rounded-xl border border-slate-100 bg-[#F8F9FA] p-4 lg:min-h-[20rem]">
                         <p className="mb-3 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-700/90">
                           Doanh thu &amp; Thu nhập (Loại 5, 7)
                         </p>
                         <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                            {gatheredBalances.revenueItems.map((item) => (
                               <div key={item.code} className="flex justify-between rounded-lg border border-slate-200/60 bg-white px-2.5 py-2 text-sm">
                                  <span className="font-medium text-slate-700">{item.code} - {item.name}</span>
                                  <span className="font-semibold tabular-nums text-emerald-700">{formatCurrency(Math.abs(item.balance))}</span>
                               </div>
                            ))}
                            {gatheredBalances.revenueItems.length === 0 && (
                              <p className="text-xs italic text-slate-400">Không có phát sinh doanh thu trong kỳ lọc.</p>
                            )}
                         </div>
                         <div className="mt-4 shrink-0 rounded-xl border border-slate-200/80 border-l-4 border-l-emerald-500 bg-white px-4 py-4 shadow-sm">
                            <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-slate-500">
                              Tổng doanh thu tập hợp
                            </p>
                            <p className="flex items-baseline gap-1.5 tabular-nums text-[20px] font-medium leading-none text-slate-800 md:text-[22px]">
                              <span>{formatVndDigits(gatheredBalances.totalRev)}</span>
                              <span className="text-sm font-medium text-slate-400">đ</span>
                            </p>
                         </div>
                      </div>
                      <div className="flex min-h-0 flex-col rounded-xl border border-slate-100 bg-[#F8F9FA] p-4 lg:min-h-[20rem]">
                         <p className="mb-3 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-red-700/90">
                           Chi phí &amp; Giá vốn (Loại 6, 8)
                         </p>
                         <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                            {gatheredBalances.expenseItems.map((item) => (
                               <div key={item.code} className="flex justify-between rounded-lg border border-slate-200/60 bg-white px-2.5 py-2 text-sm">
                                  <span className="font-medium text-slate-700">{item.code} - {item.name}</span>
                                  <span className="font-semibold tabular-nums text-red-700">{formatCurrency(Math.abs(item.balance))}</span>
                               </div>
                            ))}
                            {gatheredBalances.expenseItems.length === 0 && (
                              <p className="text-xs italic text-slate-400">Không có phát sinh chi phí trong kỳ lọc.</p>
                            )}
                         </div>
                         <div className="mt-4 shrink-0 rounded-xl border border-slate-200/80 border-l-4 border-l-red-500 bg-white px-4 py-4 shadow-sm">
                            <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-slate-500">
                              Tổng chi phí tập hợp
                            </p>
                            <p className="flex items-baseline gap-1.5 tabular-nums text-[20px] font-medium leading-none text-slate-800 md:text-[22px]">
                              <span>{formatVndDigits(gatheredBalances.totalExp)}</span>
                              <span className="text-sm font-medium text-slate-400">đ</span>
                            </p>
                         </div>
                      </div>
                   </div>
                   <div className="mt-6 flex justify-center border-t border-slate-100 pt-5">
                      <button
                        type="button"
                        onClick={() => setActiveStep(2)}
                        disabled={
                          gatheredBalances.totalRev === 0 &&
                          gatheredBalances.totalExp === 0 &&
                          gatheredBalances.selectedDeferredAllocations.length === 0
                        }
                        className="inline-flex h-11 max-w-[min(100%,20rem)] items-center justify-center gap-2 rounded-lg bg-violet-500 px-7 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Tiếp theo: Kiểm tra bút toán
                        <ArrowRight className="h-4 w-4 shrink-0 opacity-95" aria-hidden />
                      </button>
                   </div>
                </div>
                {(gatheredBalances.deferredRevenueAllocations.length > 0 || gatheredBalances.deferredLedgerPreviewBasis > 0 || gatheredBalances.deferredRemainingPreviewBasis > 0) && (
                  <div className="bg-white p-6 rounded-2xl border shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b pb-2">
                      <h5 className="font-black text-slate-800 uppercase text-xs flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" /> Phân bổ doanh thu chưa thực hiện 3387
                      </h5>
                      <span className={`text-[10px] font-black px-2 py-1 rounded-full ${
                        gatheredBalances.projectedDeferredMismatch
                          ? 'bg-red-100 text-red-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {gatheredBalances.projectedDeferredMismatch ? 'Cần đối chiếu' : 'Khớp dự kiến'}
                      </span>
                    </div>
                    {gatheredBalances.periodHas3387Posting && (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900">
                        <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          Phạm vi <b>{selectionLabel}</b> đã có ít nhất một bút phân bổ <b>PB-3387</b> trên sổ. Khi kết chuyển lại, hệ thống{' '}
                          <b>không xóa</b> các bút này; chỉ cập nhật lại KC-DT / KC-CP / KC-KQ / GV-154 nếu bạn chạy lại bước kết chuyển.
                        </span>
                      </div>
                    )}
                    {gatheredBalances.deferredRevenueAllocations.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-black uppercase text-slate-500">
                          <span>Chọn hóa đơn để đưa vào phân bổ kỳ này (bảng kê & bút PB)</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setDeferredInvoiceSelected((prev) => {
                                  const next = { ...prev };
                                  gatheredBalances.deferredRevenueAllocations.forEach((row) => {
                                    if (!row.alreadyPosted) next[row.selectionKey] = true;
                                  });
                                  return next;
                                });
                              }}
                              className="rounded-lg border border-amber-200 bg-white px-2 py-1 text-amber-800 hover:bg-amber-50"
                            >
                              Chọn tất cả
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeferredInvoiceSelected((prev) => {
                                  const next = { ...prev };
                                  gatheredBalances.deferredRevenueAllocations.forEach((row) => {
                                    if (!row.alreadyPosted) next[row.selectionKey] = false;
                                  });
                                  return next;
                                });
                              }}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:bg-slate-50"
                            >
                              Bỏ chọn tất cả
                            </button>
                          </div>
                        </div>
                        {gatheredBalances.deferredRevenueAllocations.map((item) => {
                          const checked = item.alreadyPosted || deferredInvoiceSelected[item.selectionKey] !== false;
                          return (
                          <div
                            key={`${item.invoiceId}-${item.period}-${item.revenueAccount}`}
                            className={`grid grid-cols-[auto_1.2fr_0.9fr_0.65fr_0.65fr] gap-3 rounded-xl border px-3 py-2 text-sm items-center ${
                              item.alreadyPosted
                                ? 'border-slate-200 bg-slate-50/80'
                                : 'border-amber-100 bg-amber-50/40'
                            }`}
                          >
                            <div className="flex flex-col items-center gap-1">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300"
                                checked={checked}
                                disabled={item.alreadyPosted}
                                title={
                                  item.alreadyPosted
                                    ? 'Đã phân bổ kỳ này — luôn tính trong bảng kê, không ghi trùng'
                                    : 'Đưa HĐ này vào phân bổ kỳ đang chọn'
                                }
                                onChange={(e) =>
                                  setDeferredInvoiceSelected((prev) => ({
                                    ...prev,
                                    [item.selectionKey]: e.target.checked,
                                  }))
                                }
                              />
                              {item.alreadyPosted && (
                                <span className="text-[9px] font-black uppercase text-slate-500">Đã PB</span>
                              )}
                            </div>
                            <div>
                              <div className="font-bold text-slate-800">{item.invoiceNumber} - {item.customerName}</div>
                              <div className="text-[11px] text-slate-500">
                                Kỳ dịch vụ: {item.startDate}{' -> '}{item.endDate} · Kỳ phân bổ: {formatClosingMonthLabel(item.period)}
                              </div>
                            </div>
                            <div className="text-slate-600">
                              <div className="text-[10px] uppercase text-slate-400">TK ghi nhận</div>
                              <div className="font-black text-indigo-700">{item.revenueAccount}</div>
                            </div>
                            <div className="text-slate-600">
                              <div className="text-[10px] uppercase text-slate-400">Số ngày</div>
                              <div className="font-black">{item.days}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] uppercase text-slate-400">Phân bổ kỳ này</div>
                              <div className="font-black text-amber-700">{formatCurrency(item.amount)}</div>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic">Kỳ này không có hóa đơn 3387 cần phân bổ thêm.</p>
                    )}
                    <div className={`grid grid-cols-2 gap-4 rounded-2xl border p-4 ${
                      gatheredBalances.projectedDeferredMismatch
                        ? 'border-red-200 bg-red-50/70'
                        : 'border-emerald-200 bg-emerald-50/70'
                    }`}>
                      <div>
                        <div className="text-[10px] uppercase font-black text-slate-400">3387 sổ cái sau khi chạy kỳ này</div>
                        <div className="text-lg font-black text-slate-800">{formatCurrency(gatheredBalances.projectedDeferredLedger)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-black text-slate-400">Tổng số dư còn lại theo bảng kê</div>
                        <div className="text-lg font-black text-slate-800">{formatCurrency(gatheredBalances.projectedDeferredRemaining)}</div>
                      </div>
                    </div>
                    {gatheredBalances.projectedDeferredMismatch && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700">
                        Cảnh báo: số dư TK 3387 trên sổ cái chưa khớp với tổng số dư còn lại của các hóa đơn phân bổ. Hãy kiểm tra các bút toán 3387 đã ghi sổ trước đó.
                      </div>
                    )}
                  </div>
                )}
             </div>
          )}

          {activeStep === 2 && (
             <div className="mx-auto w-full max-w-[100%] space-y-6 animate-fade-in">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                   <h4 className="mb-5 flex items-center gap-2 border-b border-slate-100 pb-3 text-sm font-semibold uppercase tracking-wide text-slate-800">
                      <FileSearch className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
                      Bước 2: Xem trước các bút toán sẽ sinh ra ({selectionLabel})
                   </h4>
                   <div className="space-y-5 text-[13px]">
                      {gatheredBalances.selectedDeferredAllocations.length > 0 && (
                        <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-white shadow-sm ring-1 ring-amber-900/[0.04]">
                          <div className="border-b border-amber-200/70 bg-amber-50 px-4 py-2.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                              Bút toán 00: Phân bổ doanh thu chưa thực hiện (3387)
                            </p>
                          </div>
                          <div className="px-4 py-3">
                            {gatheredBalances.selectedDeferredNewPostings.length === 0 && (
                              <p className="mb-3 text-[11px] font-medium text-amber-900/90">
                                Không sinh bút PB mới: các hóa đơn đã tích đều đã phân bổ kỳ này trên sổ (hoặc chưa chọn HĐ nào cần ghi thêm).
                              </p>
                            )}
                            {gatheredBalances.selectedDeferredNewPostings.length > 0 && (
                              <table className="w-full border-collapse text-left">
                                <ClosingPreviewTableHead />
                                {gatheredBalances.selectedDeferredNewPostings.map((item, idx, arr) => (
                                  <tbody key={`${item.invoiceId}-${item.period}-${item.revenueAccount}`} className="font-mono">
                                    <tr>
                                      <td
                                        colSpan={4}
                                        className={`pb-2 text-[11px] font-normal text-slate-500 ${idx === 0 ? 'pt-0' : 'pt-3'}`}
                                      >
                                        <span className="font-medium text-slate-600">
                                          {item.invoiceNumber} — {item.customerName}
                                        </span>
                                        <span className="ml-2 tabular-nums text-slate-400">
                                          {formatClosingMonthLabel(item.period)} · {item.startDate} → {item.endDate} ({item.days} ngày)
                                        </span>
                                      </td>
                                    </tr>
                                    <tr className="text-blue-900">
                                      <td className="py-1.5 pr-2 align-top font-medium text-slate-600">Nợ</td>
                                      <td className="py-1.5 pr-2 font-semibold text-blue-800">3387</td>
                                      <td className="py-1.5 pr-3 text-blue-900/90">Doanh thu chưa thực hiện</td>
                                      <td className="py-1.5 text-right text-sm font-medium tabular-nums text-blue-800">
                                        {formatVndAbs(item.amount)}
                                      </td>
                                    </tr>
                                    <tr
                                      className={`text-amber-900 ${idx < arr.length - 1 ? 'border-b border-amber-100/90' : ''}`}
                                    >
                                      <td className="py-1.5 pl-6 pr-2 align-top font-medium text-slate-600">Có</td>
                                      <td className="py-1.5 pr-2 font-semibold text-amber-800">{item.revenueAccount}</td>
                                      <td className="py-1.5 pr-3 text-amber-900/90">Ghi nhận doanh thu theo ngày thực tế</td>
                                      <td className="py-1.5 text-right text-sm font-medium tabular-nums text-amber-800">
                                        {formatVndAbs(item.amount)}
                                      </td>
                                    </tr>
                                  </tbody>
                                ))}
                              </table>
                            )}
                          </div>
                        </div>
                      )}
                      {gatheredBalances.totalRev > 0 && (
                        <div className="overflow-hidden rounded-xl border border-blue-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.03]">
                          <div className="border-b border-blue-200/60 bg-blue-50 px-4 py-2.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                              Bút toán 01: Kết chuyển doanh thu
                            </p>
                          </div>
                          <div className="px-4 py-3">
                            <table className="w-full border-collapse text-left">
                              <ClosingPreviewTableHead />
                              <tbody className="font-mono">
                                {gatheredBalances.revenueItems.map((item) => (
                                  <tr key={item.code} className="text-blue-900">
                                    <td className="py-1.5 pr-2 align-top font-medium text-slate-600">Nợ</td>
                                    <td className="py-1.5 pr-2 font-semibold text-blue-800">{item.code}</td>
                                    <td className="py-1.5 pr-3 text-blue-900/90">{item.name}</td>
                                    <td className="py-1.5 text-right text-sm font-medium tabular-nums text-blue-800">
                                      {formatVndAbs(item.balance)}
                                    </td>
                                  </tr>
                                ))}
                                <tr className="border-t border-slate-100 font-bold text-blue-900">
                                  <td className="py-2 pl-6 pr-2 align-top font-medium text-slate-600">Có</td>
                                  <td className="py-2 pr-2 text-blue-900">911</td>
                                  <td className="py-2 pr-3 text-blue-900/90">Xác định KQKD</td>
                                  <td className="py-2 text-right text-sm tabular-nums text-blue-800">
                                    {formatVndAbs(gatheredBalances.totalRev)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {gatheredBalances.totalExp > 0 && (
                        <div className="overflow-hidden rounded-xl border border-red-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.03]">
                          <div className="border-b border-red-200/60 bg-red-50 px-4 py-2.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-red-900">
                              Bút toán 02: Kết chuyển chi phí
                            </p>
                          </div>
                          <div className="px-4 py-3">
                            <table className="w-full border-collapse text-left">
                              <ClosingPreviewTableHead />
                              <tbody className="font-mono">
                                <tr className="border-b border-slate-100 font-bold text-red-900">
                                  <td className="py-2 pr-2 align-top font-medium text-slate-600">Nợ</td>
                                  <td className="py-2 pr-2 text-red-800">911</td>
                                  <td className="py-2 pr-3 text-red-900/90">Xác định KQKD</td>
                                  <td className="py-2 text-right text-sm tabular-nums text-red-800">
                                    {formatVndAbs(gatheredBalances.totalExp)}
                                  </td>
                                </tr>
                                {gatheredBalances.expenseItems.map((item) => (
                                  <tr key={item.code} className="text-orange-900">
                                    <td className="py-1.5 pl-6 pr-2 align-top font-medium text-slate-600">Có</td>
                                    <td className="py-1.5 pr-2 font-semibold text-orange-800">{item.code}</td>
                                    <td className="py-1.5 pr-3 text-orange-900/90">{item.name}</td>
                                    <td className="py-1.5 text-right text-sm font-medium tabular-nums text-red-700">
                                      {formatVndAbs(item.balance)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {gatheredBalances.profit !== 0 && (
                        <div className="overflow-hidden rounded-xl border border-indigo-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.03]">
                          <div className="border-b border-indigo-200/60 bg-indigo-50 px-4 py-2.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
                              Bút toán 03: Xác định lãi / lỗ
                            </p>
                          </div>
                          <div className="px-4 py-3">
                            <table className="w-full border-collapse text-left">
                              <ClosingPreviewTableHead />
                              <tbody className="font-mono">
                                {gatheredBalances.profit >= 0 ? (
                                  <>
                                    <tr className="text-slate-800">
                                      <td className="py-2 pr-2 align-top font-medium text-slate-600">Nợ</td>
                                      <td className="py-2 pr-2 font-bold text-slate-900">911</td>
                                      <td className="py-2 pr-3 font-medium text-slate-700">Tất toán tài khoản</td>
                                      <td className="py-2 text-right text-sm font-bold tabular-nums text-slate-900">
                                        {formatVndAbs(gatheredBalances.profit)}
                                      </td>
                                    </tr>
                                    <tr className="text-indigo-900">
                                      <td className="py-2 pl-6 pr-2 align-top font-medium text-slate-600">Có</td>
                                      <td className="py-2 pr-2 font-bold text-indigo-900">4212</td>
                                      <td className="py-2 pr-3 font-semibold text-indigo-900/90">Lợi nhuận kỳ này</td>
                                      <td className="py-2 text-right text-sm font-bold tabular-nums text-indigo-900">
                                        {formatVndAbs(gatheredBalances.profit)}
                                      </td>
                                    </tr>
                                  </>
                                ) : (
                                  <>
                                    <tr className="text-red-900">
                                      <td className="py-2 pr-2 align-top font-medium text-slate-600">Nợ</td>
                                      <td className="py-2 pr-2 font-bold text-red-900">4212</td>
                                      <td className="py-2 pr-3 font-medium text-red-900/90">Lỗ kỳ này</td>
                                      <td className="py-2 text-right text-sm font-bold tabular-nums text-red-900">
                                        {formatVndAbs(gatheredBalances.profit)}
                                      </td>
                                    </tr>
                                    <tr className="text-slate-800">
                                      <td className="py-2 pl-6 pr-2 align-top font-medium text-slate-600">Có</td>
                                      <td className="py-2 pr-2 font-bold text-slate-900">911</td>
                                      <td className="py-2 pr-3 font-medium text-slate-700">Tất toán tài khoản</td>
                                      <td className="py-2 text-right text-sm font-bold tabular-nums text-slate-900">
                                        {formatVndAbs(gatheredBalances.profit)}
                                      </td>
                                    </tr>
                                  </>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                   </div>
                </div>
                <div className="flex justify-center gap-4">
                   <button
                     type="button"
                     onClick={() => setActiveStep(1)}
                     className="rounded-xl border border-slate-300 px-8 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                   >
                     Quay lại
                   </button>
                   <button
                     type="button"
                     onClick={() => setActiveStep(3)}
                     className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-10 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-blue-700 hover:shadow-lg"
                   >
                     Tiếp theo: Lệnh kết chuyển <ArrowRight className="h-5 w-5 shrink-0" aria-hidden />
                   </button>
                </div>
             </div>
          )}

          {activeStep === 3 && (
             <div className="mx-auto flex w-full max-w-[100%] flex-col items-center justify-center space-y-6 py-10 text-center animate-fade-in">
                <div
                  className={`rounded-xl p-5 shadow-sm ring-1 ring-slate-900/5 ${
                    isProcessing ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-600'
                  }`}
                >
                  {isProcessing ? (
                    <RefreshCw className="mx-auto h-10 w-10 animate-spin" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Calculator className="mx-auto h-10 w-10" strokeWidth={1.5} aria-hidden />
                  )}
                </div>
                <div className="max-w-lg px-4">
                   <h3 className="text-2xl font-semibold tracking-tight text-slate-800 sm:text-[1.65rem]">
                     Xác nhận Kết chuyển Cuối kỳ
                   </h3>
                   <p className="mt-2 text-sm text-slate-500">
                     Hệ thống sẽ ghi các bút toán vào Niên độ{' '}
                     <span className="font-medium text-blue-600">{currentFiscalYearStr}</span>.
                   </p>
                </div>

                <div
                  className={`w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/[0.04] ${
                    gatheredBalances.profit >= 0 ? 'border-l-[3px] border-l-emerald-500' : 'border-l-[3px] border-l-red-500'
                  }`}
                >
                   <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                     Lợi nhuận xác định kỳ này
                   </p>
                   <div className="flex justify-center">
                     <ClosingProfitAmount amount={gatheredBalances.profit} />
                   </div>
                </div>

                <button 
                  onClick={handleExecuteClosing}
                  disabled={isProcessing}
                  type="button"
                  className="rounded-xl bg-blue-600 px-8 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-md transition-all hover:bg-blue-700 hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
                >
                   {isProcessing ? 'ĐANG XỬ LÝ...' : 'THỰC HIỆN NGAY'}
                </button>
             </div>
          )}

          {activeStep === 4 && (
             <div className="mx-auto w-full max-w-[100%] space-y-6 animate-fade-in">
                <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-2xl flex items-center gap-4">
                   <div className="p-3 bg-emerald-600 text-white rounded-full shadow-lg"><CheckCircle2 className="w-8 h-8" /></div>
                   <div>
                      <h4 className="text-xl font-black text-emerald-900 leading-none">Kết chuyển thành công!</h4>
                      <p className="text-sm text-emerald-700 mt-2">Các bút toán đã được lưu vào sổ niên độ {currentFiscalYearStr}. Toàn bộ tài khoản doanh thu/chi phí trong phạm vi {selectionLabel.toLowerCase()} đã được triệt tiêu số dư ròng về 0.</p>
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                   <div className="bg-white p-6 rounded-2xl border shadow-sm">
                      <h5 className="font-black text-slate-800 uppercase text-xs mb-4 flex items-center gap-2">
                         <ClipboardList className="w-4 h-4 text-blue-500" /> Bảng đối chiếu số dư sau kết chuyển
                      </h5>
                      <div className="space-y-1 text-sm font-mono">
                         <div className="flex justify-between border-b pb-1 text-slate-400 text-[10px] uppercase font-bold"><span>Tài khoản</span> <span>Số dư cuối</span></div>
                         {gatheredBalances.revenueItems.map(i => <div key={i.code} className="flex justify-between py-1"><span>{i.code}</span> <span className="font-bold">0</span></div>)}
                         {gatheredBalances.expenseItems.map(i => <div key={i.code} className="flex justify-between py-1"><span>{i.code}</span> <span className="font-bold">0</span></div>)}
                         <div className="flex justify-between py-1 border-t-2 mt-2 pt-2 text-indigo-600 font-black"><span>911 (Xác định KQKD)</span> <span>0</span></div>
                         <div className="flex justify-between py-1 text-blue-700 font-black"><span>4212 (Lợi nhuận chưa PP)</span> <span>{formatCurrency(Math.abs(gatheredBalances.profit))}</span></div>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between hover:bg-slate-50 transition-all cursor-pointer group">
                         <div className="flex items-center gap-4">
                            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors"><FileText className="w-6 h-6" /></div>
                            <div><p className="font-black text-slate-800 text-sm">Bảng Cân đối thử</p><p className="text-[10px] text-slate-400">Kiểm tra tính cân đối của các TK</p></div>
                         </div>
                         <ArrowRight className="w-5 h-5 text-slate-200" />
                      </div>
                      <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between hover:bg-slate-50 transition-all cursor-pointer group">
                         <div className="flex items-center gap-4">
                            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-colors"><TrendingUp className="w-6 h-6" /></div>
                            <div><p className="font-black text-slate-800 text-sm">Báo cáo Kết quả Kinh doanh</p><p className="text-[10px] text-slate-400">Xem doanh thu, giá vốn, lãi lỗ</p></div>
                         </div>
                         <ArrowRight className="w-5 h-5 text-slate-200" />
                      </div>
                      <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between hover:bg-slate-50 transition-all cursor-pointer group">
                         <div className="flex items-center gap-4">
                            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl group-hover:bg-emerald-600 group-hover:text-white transition-colors"><Scale className="w-6 h-6" /></div>
                            <div><p className="font-black text-slate-800 text-sm">Bảng Cân đối kế toán</p><p className="text-[10px] text-slate-400">Kiểm tra Tình hình tài chính</p></div>
                         </div>
                         <ArrowRight className="w-5 h-5 text-slate-200" />
                      </div>
                   </div>
                </div>

                <div className="flex justify-center pt-4">
                   <button type="button" onClick={() => setActiveStep(1)} className="text-slate-400 hover:text-indigo-600 text-sm font-bold flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" /> Làm lại kết chuyển kỳ này
                   </button>
                </div>
             </div>
          )}
       </div>
    </div>
  );
};

const PeriodClosingView = () => { 
  const { accountingPeriods, setPeriodLock, financialYear, journalEntries } = useApp();

  const b01bCheck = useMemo(() => computeB01bTotals(journalEntries, financialYear.endDate), [journalEntries, financialYear.endDate]);
  const blockClosing = !b01bCheck.isBalanced;

  const handleSoftLock = (id: string) => {
    if (blockClosing) return;
    setPeriodLock(id, 'SOFT');
  };
  const handleHardLock = (id: string) => {
    if (blockClosing) return;
    const ok = window.confirm('Bạn chắc chắn KHÓA CỨNG kỳ này? Khóa cứng dùng để chặn sửa dữ liệu quá khứ và nên thực hiện theo quy trình quản trị.');
    if (!ok) return;
    setPeriodLock(id, 'HARD');
  };
  const handleOpen = (id: string) => setPeriodLock(id, 'OPEN');

  return (
    <div className="p-6 space-y-6 animate-fade-in h-full flex flex-col overflow-hidden">
      {blockClosing && (
        <div className="bg-rose-50 p-4 rounded-xl border border-rose-200 text-rose-800 text-sm font-bold shrink-0">
          B01b-DNN đang lệch: <span className="font-black">Tổng tài sản (mã 300)</span> = {formatCurrency(b01bCheck.assets300).replace('₫', '').trim()} ;{' '}
          <span className="font-black">Tổng nguồn vốn (mã 600)</span> = {formatCurrency(b01bCheck.sources600).replace('₫', '').trim()} ;{' '}
          <span className="font-black">Chênh lệch</span> = {formatCurrency(b01bCheck.diff).replace('₫', '').trim()}.
          <div className="text-xs font-medium mt-2 text-rose-700">
            Hệ thống tạm thời <span className="font-black">không cho KHÓA SỔ / XUẤT FILE</span> cho đến khi cân đối.
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="bg-slate-50 px-6 py-3 border-b flex justify-between items-center shrink-0">
           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Danh sách kỳ kế toán tháng (Đủ 12 tháng từ 01/01 đến 31/12)</span>
           <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
              <span className="text-[10px] font-bold text-blue-600 uppercase">Niên độ: {new Date(financialYear.startDate).getFullYear()}</span>
           </div>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <table className="w-full text-sm text-left">
            <thead className="sticky top-0 z-[2] border-b bg-white text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <tr>
                <th className="p-4">Tên kỳ kế toán</th>
                <th className="p-4 text-center">Ngày bắt đầu</th>
                <th className="p-4 text-center">Ngày kết thúc</th>
                <th className="p-4 text-center">Trạng thái</th>
                <th className="p-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {accountingPeriods
                .slice()
                .sort((a, b) => a.startDate.localeCompare(b.startDate))
                .map(p => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="p-4 font-bold text-slate-800">{p.name}</td>
                  <td className="p-4 text-center text-slate-500 font-mono font-bold">
                     {new Date(p.startDate).toLocaleDateString('vi-VN')}
                  </td>
                  <td className="p-4 text-center text-slate-500 font-mono font-bold">
                     {new Date(p.endDate).toLocaleDateString('vi-VN')}
                  </td>
                  <td className="p-4">
                    <div className="flex justify-center">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter border flex items-center gap-1.5 shadow-sm transition-all ${
                        p.status === 'CLOSED'
                          ? (p.lockType === 'HARD' ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-red-50 text-red-700 border-red-200')
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        {p.status === 'OPEN' ? <Unlock className="w-3 h-3"/> : <Lock className="w-3 h-3"/>}
                        {p.status === 'OPEN' ? 'Đang mở' : (p.lockType === 'HARD' ? 'Khóa cứng' : 'Khóa mềm')}
                      </span>
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      {p.status === 'OPEN' ? (
                        <>
                    <button 
                            onClick={() => handleSoftLock(p.id)}
                            disabled={blockClosing}
                            title={blockClosing ? 'Không thể khóa sổ khi B01b lệch (Tổng tài sản ≠ Tổng nguồn vốn).' : 'Khóa mềm'}
                            className={`px-4 py-1.5 rounded-lg font-bold text-xs shadow-sm transition-all active:scale-95 border ${
                              blockClosing ? 'bg-slate-300 text-white border-slate-300 cursor-not-allowed' : 'bg-slate-800 text-white border-slate-800 hover:bg-slate-900'
                            }`}
                    >
                            Khóa mềm
                    </button>
                          <button
                            onClick={() => handleHardLock(p.id)}
                            disabled={blockClosing}
                            title={blockClosing ? 'Không thể khóa sổ khi B01b lệch (Tổng tài sản ≠ Tổng nguồn vốn).' : 'Khóa cứng'}
                            className={`px-4 py-1.5 rounded-lg font-bold text-xs shadow-sm transition-all active:scale-95 border ${
                              blockClosing ? 'bg-rose-300 text-white border-rose-300 cursor-not-allowed' : 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700'
                            }`}
                          >
                            Khóa cứng
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleOpen(p.id)}
                          className="px-4 py-1.5 rounded-lg font-bold text-xs shadow-sm transition-all active:scale-95 border bg-white border-slate-200 text-blue-600 hover:bg-blue-50"
                        >
                          Mở sổ
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
