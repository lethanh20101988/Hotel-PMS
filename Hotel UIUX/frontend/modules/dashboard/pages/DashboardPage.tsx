import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  TrendingUp,
  AlertTriangle,
  FileText,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Users,
  Info,
} from 'lucide-react';
import { DeviceStatus } from '@shared/types';

const DashboardDevicePieChart = lazy(() =>
  import('../components/DashboardDevicePieChart').then((m) => ({ default: m.DashboardDevicePieChart })),
);
import type { JournalEntry } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { getDisplayArApFromGl, voucherNetDeltaForPrefix } from '@shared/utils/glLedgerBalances';
import { journalEntryDetailsArray } from '@shared/utils/journalEntryDetails';
import { useApp } from '../../../app/store';

function sumNetRevenueFromEntries(entries: JournalEntry[]): number {
  let grossRevenue = 0;
  let otherIncome = 0;
  let contraRevenueNet = 0;
  entries.forEach((e) => {
    e.details.forEach((d) => {
      const base = d.account.substring(0, 3);
      if (base === '511' || base === '515') grossRevenue += d.credit;
      if (base === '711') otherIncome += d.credit;
      if (base === '521' || base === '531' || base === '532') contraRevenueNet += d.debit - d.credit;
    });
  });
  return Math.max(0, grossRevenue + otherIncome - contraRevenueNet);
}

function sumCash111112Delta(entries: JournalEntry[]): number {
  return entries.reduce(
    (sum, e) =>
      sum +
      e.details.reduce((s, d) => {
        const a = String(d.account || '');
        if (!a.startsWith('111') && !a.startsWith('112')) return s;
        return s + (Number(d.debit || 0) - Number(d.credit || 0));
      }, 0),
    0,
  );
}

function sumArDelta(entries: JournalEntry[]): number {
  return entries.reduce(
    (sum, e) =>
      sum +
      e.details.reduce((s, d) => {
        if (String(d.account || '').substring(0, 3) !== '131') return s;
        return s + (Number(d.debit || 0) - Number(d.credit || 0));
      }, 0),
    0,
  );
}

function buildSmoothPath(points: [number, number][]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

function MiniSparkline({
  values,
  className,
  accentClass = 'text-emerald-500',
  smooth = false,
}: {
  values: number[];
  className?: string;
  accentClass?: string;
  smooth?: boolean;
}) {
  const w = 112;
  const h = 32;
  const shell = `h-8 w-full max-w-[7rem] shrink-0 ${className || ''}`;
  if (!values.length) return <div className={shell} aria-hidden />;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return <div className={shell} aria-hidden />;
  // Cùng một giá trị mọi ngày → polyline thành gạch ngang đầy màu; ẩn để giao diện gọn.
  if (Math.abs(rawMax - rawMin) < 1e-9) return <div className={shell} aria-hidden />;
  const max = Math.max(rawMax, 1e-9);
  const min = Math.min(rawMin, 0);
  const range = Math.max(max - min, 1e-9);
  const xy: [number, number][] = values.map((v, i) => {
    const x = values.length <= 1 ? w / 2 : (i / (values.length - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return [x, y];
  });
  const pts = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const useSmooth = smooth && xy.length >= 3;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`${shell} ${accentClass}`} preserveAspectRatio="none" aria-hidden>
      {useSmooth ? (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          d={buildSmoothPath(xy)}
        />
      ) : (
        <polyline fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" points={pts} />
      )}
    </svg>
  );
}

function TrendDelta({ pct, label }: { pct: number | null; label?: string }) {
  if (pct === null || !Number.isFinite(pct))
    return <span className="text-[13px] leading-relaxed text-slate-500">Chưa đủ dữ liệu so sánh theo tháng</span>;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[13px] font-bold tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%
      <span className="font-medium text-slate-400">{label || ' so với tháng trước'}</span>
    </span>
  );
}

const iconBoxStyles: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  orange: 'bg-orange-50 text-orange-600',
  purple: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-600',
};

const CARD_ICON_STROKE = 1.75;

/** Ba cột bằng nhau (mobile: 1 cột), chiều cao ô theo hàng = max nội dung */
const OVERVIEW_ROW3 = 'grid grid-cols-1 gap-4 sm:gap-4 lg:grid-cols-3 lg:gap-5 lg:items-stretch';
const OVERVIEW_CELL = 'flex min-h-0 h-full w-full min-w-0';

const DashboardCard = ({ title, children, icon: Icon, color = 'blue', extra, className = '' }: any) => (
  <div
    className={`flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-100/90 bg-white shadow-[0_2px_20px_-6px_rgba(15,23,42,0.08)] ${className}`}
  >
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100/80 bg-slate-50/50 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className={`shrink-0 rounded-lg p-1.5 ${iconBoxStyles[color] || iconBoxStyles.blue}`}>
          <Icon className="h-4 w-4" strokeWidth={CARD_ICON_STROKE} />
        </div>
        <h3 className="truncate text-[14px] font-semibold leading-snug tracking-tight text-slate-600 sm:text-[15px]">{title}</h3>
      </div>
      {extra}
    </div>
    <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">{children}</div>
  </div>
);

const MiniStat = ({ label, value, isCurrency = true }: any) => {
  const num = typeof value === 'number' ? value : Number(value);
  const isZero = !Number.isFinite(num) || Math.abs(num) < 1e-9;
  return (
    <div className="flex items-end justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-relaxed text-slate-500">{label}</p>
        <p
          className={`text-[15px] font-bold tabular-nums leading-relaxed sm:text-base ${isZero ? 'text-slate-400 opacity-80' : 'text-slate-800'}`}
        >
          {isCurrency ? formatCurrency(value) : value}
        </p>
      </div>
    </div>
  );
};

function KpiInfo({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <button
      type="button"
      className="inline-flex shrink-0 rounded-full text-slate-400 transition-colors hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-1"
      title={text}
      aria-label={text}
    >
      <Info className="h-3.5 w-3.5" strokeWidth={CARD_ICON_STROKE} />
    </button>
  );
}

export const DashboardPage: React.FC = () => {
  const { devices, inventory, journalEntries, accountingVouchers, financialYear } = useApp();

  type PeriodMode = 'DAY' | 'MONTH' | 'QUARTER' | 'YEAR' | 'RANGE';
  const [now, setNow] = useState(() => new Date());
  const [periodMode, setPeriodMode] = useState<PeriodMode>('MONTH');
  const [day, setDay] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    return (today >= financialYear.startDate && today <= financialYear.endDate) ? today : financialYear.startDate;
  });
  const [month, setMonth] = useState(() => {
    const d = new Date();
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return m;
  });
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(() => {
    const q = Math.floor((new Date().getMonth()) / 3) + 1;
    return (q as any) || 1;
  });
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [rangeStart, setRangeStart] = useState(() => financialYear.startDate);
  const [rangeEnd, setRangeEnd] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    return (today >= financialYear.startDate && today <= financialYear.endDate) ? today : financialYear.endDate;
  });

  // Keep "now" moving so the dashboard stays correct across date changes without reload.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Clamp selected range inputs to the current financial year whenever FY changes.
  useEffect(() => {
    setDay(prev => {
      if (prev < financialYear.startDate) return financialYear.startDate;
      if (prev > financialYear.endDate) return financialYear.endDate;
      return prev;
    });
    setRangeStart(prev => prev < financialYear.startDate ? financialYear.startDate : prev);
    setRangeEnd(prev => prev > financialYear.endDate ? financialYear.endDate : prev);
  }, [financialYear.startDate, financialYear.endDate]);

  // --- LOGIC TÍNH TOÁN DỮ LIỆU TỔNG QUAN HỆ THỐNG ---
  const stats = useMemo(() => {
    // Niên độ hiện tại
    const yearStart = financialYear.startDate;
    const yearEnd = financialYear.endDate;

    // Lọc toàn bộ bút toán trong niên độ
    const currentYearEntries = journalEntries.filter(e => e.date >= yearStart && e.date <= yearEnd);

    // ---- Period range selection (for Kết quả kinh doanh) ----
    const clampToFY = (d: string) => {
      if (!d) return yearStart;
      if (d < yearStart) return yearStart;
      if (d > yearEnd) return yearEnd;
      return d;
    };
    const isoToday = now.toISOString().split('T')[0];
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-based
    const currentQuarter = (Math.floor(currentMonth / 3) + 1) as 1 | 2 | 3 | 4;

    const computeRange = (): { start: string; end: string; label: string } => {
      if (periodMode === 'DAY') {
        const d = clampToFY(day);
        return { start: d, end: d, label: `Ngày ${new Date(d).toLocaleDateString('vi-VN')}` };
      }
      if (periodMode === 'MONTH') {
        const m = (month && /^\d{4}-\d{2}$/.test(month))
          ? month
          : `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
        const [y, mm] = m.split('-').map(Number);
        const start = clampToFY(new Date(y, mm - 1, 1).toISOString().split('T')[0]);
        const end = clampToFY(new Date(y, mm, 0).toISOString().split('T')[0]);
        return { start, end, label: `Tháng ${mm}/${y}` };
      }
      if (periodMode === 'QUARTER') {
        const q = (quarter || currentQuarter) as 1 | 2 | 3 | 4;
        const y = year || currentYear;
        const startMonth = (q - 1) * 3; // 0-based
        const start = clampToFY(new Date(y, startMonth, 1).toISOString().split('T')[0]);
        const end = clampToFY(new Date(y, startMonth + 3, 0).toISOString().split('T')[0]);
        return { start, end, label: `Quý ${q}/${y}` };
      }
      if (periodMode === 'YEAR') {
        const y = year || currentYear;
        const start = clampToFY(`${y}-01-01`);
        const end = clampToFY(`${y}-12-31`);
        return { start, end, label: `Năm ${y}` };
      }
      // RANGE
      const s = clampToFY(rangeStart);
      const e = clampToFY(rangeEnd);
      const start = s <= e ? s : e;
      const end = s <= e ? e : s;
      const label = `Từ ${new Date(start).toLocaleDateString('vi-VN')} đến ${new Date(end).toLocaleDateString('vi-VN')}`;
      return { start, end, label };
    };
    const period = computeRange();
    const periodEntries = currentYearEntries.filter(e => e.date >= period.start && e.date <= period.end);

    // Hàm bổ trợ tính số dư ròng cho một nhóm tài khoản (ví dụ 111, 112, 131...)
    const getNetBalance = (prefix: string) =>
      currentYearEntries.reduce(
        (sum, e) =>
          sum +
          e.details.reduce((s, d) => {
            const baseAccount = String(d.account || '').substring(0, 3);
            if (baseAccount !== prefix) return s;
            return s + (Number(d.debit || 0) - Number(d.credit || 0));
          }, 0),
        0,
      );

    /** Số dư theo tiền tố đầy đủ (1111, 1112, 1121, 1122) — khớp bút toán chi tiết TT133 */
    const getNetBalanceStartsWith = (prefix: string) =>
      currentYearEntries.reduce(
        (sum, e) =>
          sum +
          e.details.reduce((s, d) => {
            const a = String(d.account || '');
            if (!a.startsWith(prefix)) return s;
            return s + (Number(d.debit || 0) - Number(d.credit || 0));
          }, 0),
        0,
      );

    // 1. Dòng tiền thực tế (Số dư ròng nhóm TK 111*/112*) + chứng từ bổ sung khi thiếu JE-VOU trong kỳ
    const v111 = voucherNetDeltaForPrefix(accountingVouchers, journalEntries, yearStart, yearEnd, '111');
    const v112 = voucherNetDeltaForPrefix(accountingVouchers, journalEntries, yearStart, yearEnd, '112');
    const cash = getNetBalance('111') + v111;
    const bank = getNetBalance('112') + v112;
    const cash1111 = getNetBalanceStartsWith('1111');
    const cash1112 = getNetBalanceStartsWith('1112');
    const bank1121 = getNetBalanceStartsWith('1121');
    const bank1122 = getNetBalanceStartsWith('1122');

    // 2. KẾT QUẢ KINH DOANH theo khoảng thời gian chọn (phát sinh trong periodEntries)
    // Doanh thu thuần = 511/515/711 (Có) - (521/531/532 ròng)
    // Chi phí: 632 + 641 + 642 + 635 + 811 + 821 (Nợ)
    let grossRevenue = 0;
    let otherIncome = 0;
    let contraRevenueNet = 0;
    let cogs = 0;
    let opex = 0;
    let finExpense = 0;
    let otherExpense = 0;
    let citExpense = 0;
    periodEntries.forEach(e => {
      e.details.forEach(d => {
        const base = d.account.substring(0, 3);
        if (base === '511' || base === '515') grossRevenue += d.credit;
        if (base === '711') otherIncome += d.credit;
        if (base === '521' || base === '531' || base === '532') contraRevenueNet += (d.debit - d.credit);
        if (base === '632') cogs += d.debit;
        if (base === '641' || base === '642') opex += d.debit;
        if (base === '635') finExpense += d.debit;
        if (base === '811') otherExpense += d.debit;
        if (base === '821') citExpense += d.debit;
      });
    });
    const revenue = Math.max(0, (grossRevenue + otherIncome) - contraRevenueNet);
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - opex - finExpense - otherExpense - citExpense;

    // 3. CÔNG NỢ — NKC niên độ + chứng từ (dùng chung util với Thiết lập ban đầu)
    const { ar, ap } = getDisplayArApFromGl(journalEntries, accountingVouchers, financialYear);

    // 4. Thuế VAT — cùng logic Hoá đơn & VAT (133 / 3331), lũy kế từ đầu niên độ đến **cuối kỳ** đang chọn
    // (trước đây lấy cả niên độ nên sai khi xem tháng/quý; không khớp Kết quả KD theo kỳ)
    const vatReconEntries = currentYearEntries.filter(e => e.date <= period.end);
    const net133 = vatReconEntries.reduce(
      (sum, e) =>
        sum +
        journalEntryDetailsArray(e).reduce(
          (s, d) =>
            String(d.account).startsWith('133') ? s + (Number(d.debit || 0) - Number(d.credit || 0)) : s,
          0,
        ),
      0,
    );
    const net3331 = vatReconEntries.reduce(
      (sum, e) =>
        sum +
        journalEntryDetailsArray(e).reduce(
          (s, d) =>
            String(d.account).startsWith('3331') ? s + (Number(d.credit || 0) - Number(d.debit || 0)) : s,
          0,
        ),
      0,
    );

    return {
      cash, bank, totalCash: cash + bank,
      cash1111, cash1112, bank1121, bank1122,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      revenue, cogs, grossProfit,
      opex, finExpense, otherExpense, citExpense,
      netProfit,
      ar, ap,
      vatIn: net133 > 0 ? net133 : 0,
      vatOut: net3331 > 0 ? net3331 : 0,
      /** Thuế phải nộp (dương) / được khấu trừ chuyển (âm) — giống InvoicePage vatToPay */
      vatDiff: net3331 - net133,
      vatCutoffLabel: `Lũy kế đến ${new Date(`${period.end}T12:00:00`).toLocaleDateString('vi-VN')}`,
    };
  }, [journalEntries, accountingVouchers, financialYear, periodMode, day, month, quarter, year, rangeStart, rangeEnd, now]);

  // --- KPI rules (per spec) ---
  const MIN_REVENUE_EVAL = 10_000_000; // if revenue < this => show —%

  const grossMargin = useMemo(() => {
    const revenue = Number(stats.revenue || 0);
    const gp = Number(stats.grossProfit || 0);
    if (revenue < MIN_REVENUE_EVAL) {
      return {
        display: '— %',
        note: '',
        infoTooltip:
          'Doanh thu chưa đủ lớn để đánh giá biên lợi nhuận gộp (ngưỡng tham chiếu dưới 10.000.000 đ).',
        barPct: 0,
        tone: 'neutral' as const,
        labelClass: 'bg-slate-50 text-slate-600',
        barClass: 'bg-slate-500',
      };
    }
    const pctRaw = (gp / revenue) * 100;
    const isOver100 = pctRaw > 100;
    const display = isOver100 ? '100%+' : `${pctRaw.toFixed(1)}%`;
    const note = '';
    const infoTooltip = isOver100
      ? 'Doanh thu thấp hoặc ghi nhận bất thường so với giá vốn — nên rà soát bút toán và tồn kho.'
      : '';
    const barPct = Math.max(0, Math.min(100, pctRaw));

    const tone =
      pctRaw < 0 ? 'loss'
      : pctRaw < 20 ? 'bad'
      : pctRaw < 40 ? 'warn'
      : 'good';

    const stylesByTone: any = {
      good: { labelClass: 'bg-emerald-50 text-emerald-700', barClass: 'bg-emerald-600' },
      warn: { labelClass: 'bg-amber-50 text-amber-700', barClass: 'bg-amber-500' },
      bad: { labelClass: 'bg-red-50 text-red-700', barClass: 'bg-red-600' },
      loss: { labelClass: 'bg-rose-50 text-rose-700', barClass: 'bg-rose-700' },
      neutral: { labelClass: 'bg-slate-50 text-slate-600', barClass: 'bg-slate-500' },
    };

    return { display, note, infoTooltip, barPct, tone, ...stylesByTone[tone] };
  }, [stats.revenue, stats.grossProfit]);

  const liquidityRisk = useMemo(() => {
    const cashEq = Number(stats.totalCash || 0); // 111+112 (tiền & tương đương tiền)
    const ar = Number(stats.ar || 0);
    if (cashEq <= 0) {
      return {
        display: '— %',
        note: '',
        infoTooltip: 'Không có tiền và tương đương tiền (TK 111/112) để đối chiếu với phải thu.',
        barPct: 0,
        labelClass: 'bg-slate-50 text-slate-600',
        barClass: 'bg-slate-500',
      };
    }
    const pctRaw = (ar / cashEq) * 100;
    const isOver200 = pctRaw > 200;
    const display = isOver200 ? '200%+' : `${pctRaw.toFixed(1)}%`;
    const note = '';
    const infoTooltip = isOver200 ? 'Rủi ro thanh khoản rất cao: phải thu lớn so với tiền và tương đương tiền.' : '';
    const barPct = Math.max(0, Math.min(200, pctRaw)); // clamp max 200 per spec

    const tone =
      pctRaw <= 50 ? 'good'
      : pctRaw <= 100 ? 'warn'
      : pctRaw <= 200 ? 'bad'
      : 'alarm';

    const stylesByTone: any = {
      good: { labelClass: 'bg-emerald-50 text-emerald-700', barClass: 'bg-emerald-600' },
      warn: { labelClass: 'bg-amber-50 text-amber-700', barClass: 'bg-amber-500' },
      bad: { labelClass: 'bg-red-50 text-red-700', barClass: 'bg-red-600' },
      alarm: { labelClass: 'bg-rose-50 text-rose-700', barClass: 'bg-rose-700' },
    };

    return {
      display,
      note,
      infoTooltip,
      barPct,
      ...stylesByTone[tone],
    };
  }, [stats.totalCash, stats.ar]);

  const last7Spark = useMemo(() => {
    const ys = financialYear.startDate;
    const ye = financialYear.endDate;
    const revenue: number[] = [];
    const cashFlow: number[] = [];
    const arFlow: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      if (iso < ys || iso > ye) {
        revenue.push(0);
        cashFlow.push(0);
        arFlow.push(0);
        continue;
      }
      const de = journalEntries.filter((e) => e.date === iso);
      revenue.push(sumNetRevenueFromEntries(de));
      cashFlow.push(sumCash111112Delta(de));
      arFlow.push(sumArDelta(de));
    }
    return { revenue, cashFlow, arFlow };
  }, [journalEntries, financialYear.startDate, financialYear.endDate, now]);

  const revenueMom = useMemo(() => {
    const y = now.getFullYear();
    const m = now.getMonth();
    const curStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const curEnd = now.toISOString().split('T')[0];
    const pmDate = new Date(y, m - 1, 1);
    const py = pmDate.getFullYear();
    const pmi = pmDate.getMonth();
    const prevStart = `${py}-${String(pmi + 1).padStart(2, '0')}-01`;
    const prevEnd = new Date(py, pmi + 1, 0).toISOString().split('T')[0];
    const ys = financialYear.startDate;
    const ye = financialYear.endDate;
    const clip = (a: string, b: string) => ({
      a: a < ys ? ys : a,
      b: b > ye ? ye : b,
    });
    const c = clip(curStart, curEnd);
    const p = clip(prevStart, prevEnd);
    const curEntries = journalEntries.filter((e) => e.date >= c.a && e.date <= c.b);
    const prevEntries = journalEntries.filter((e) => e.date >= p.a && e.date <= p.b);
    const rCur = sumNetRevenueFromEntries(curEntries);
    const rPrev = sumNetRevenueFromEntries(prevEntries);
    let pct: number | null = null;
    if (rPrev > 1e-6) pct = ((rCur - rPrev) / rPrev) * 100;
    else if (rCur > 0) pct = 100;
    return { rCur, rPrev, pct };
  }, [journalEntries, financialYear.startDate, financialYear.endDate, now]);

  const inventoryQuantity = (item: any) => {
    const balances = Array.isArray(item?.warehouseBalances) ? item.warehouseBalances : [];
    if (balances.length > 0) {
      return balances.reduce((sum: number, balance: any) => sum + Number(balance?.quantity || 0), 0);
    }
    return Number(item?.quantity || 0);
  };

  const inventoryTotal = useMemo(
    () => inventory.reduce((s, i) => s + inventoryQuantity(i) * Number(i.costPrice || 0), 0),
    [inventory],
  );

  const activeDevs = devices.filter(d => d.status === DeviceStatus.ACTIVE).length;
  const expiredDevs = devices.filter(d => d.status === DeviceStatus.EXPIRED).length;
  const deviceData = [
    { name: 'Hoạt động', value: activeDevs, color: '#10b981' },
    { name: 'Hết hạn', value: expiredDevs, color: '#ef4444' }
  ];

  const kpiShell =
    'relative flex h-full min-h-[160px] min-w-0 w-full flex-col overflow-hidden rounded-xl border border-slate-100/90 bg-white p-4 shadow-[0_2px_20px_-6px_rgba(15,23,42,0.08)] sm:p-5';

  return (
    <div className="animate-fade-in space-y-4 rounded-2xl bg-[#F4F7FA] p-3 pb-10 sm:space-y-5 sm:p-5">
      <section aria-label="Bảng điều khiển nhanh" className={OVERVIEW_ROW3}>
        <div
          className={`${OVERVIEW_CELL} flex-col rounded-xl border border-slate-100/90 bg-white p-4 shadow-[0_2px_16px_-6px_rgba(15,23,42,0.08)]`}
        >
          <p className="text-[13px] font-semibold leading-snug text-slate-600">Tình trạng thiết bị</p>
          <div className="mt-2 flex flex-1 items-center gap-3">
            <div className="h-14 w-14 shrink-0">
              <Suspense fallback={<div className="h-full w-full animate-pulse rounded-full bg-slate-100" />}>
                <DashboardDevicePieChart data={deviceData} />
              </Suspense>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <span className="inline-flex w-full max-w-[11rem] items-center gap-2 rounded-lg border border-emerald-100/90 bg-emerald-50/60 px-2.5 py-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <span className="text-[13px] font-medium leading-snug text-slate-600">
                  <span className="font-semibold tabular-nums text-slate-800">{activeDevs}</span> hoạt động
                </span>
              </span>
              <span className="inline-flex w-full max-w-[11rem] items-center gap-2 rounded-lg border border-red-100/90 bg-red-50/60 px-2.5 py-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
                <span className="text-[13px] font-medium leading-snug text-slate-600">
                  <span className="font-semibold tabular-nums text-slate-800">{expiredDevs}</span> hết hạn
                </span>
              </span>
              <span className="inline-flex w-full max-w-[11rem] items-center gap-2 rounded-lg border border-slate-100/90 bg-slate-50/60 px-2.5 py-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" aria-hidden />
                <span className="text-[13px] font-medium leading-snug text-slate-600">
                  <span className="font-semibold tabular-nums text-slate-800">{devices.length}</span> Tổng
                </span>
              </span>
            </div>
          </div>
        </div>

        <div
          className={`${OVERVIEW_CELL} flex-col rounded-xl border border-slate-100/90 bg-white p-4 shadow-[0_2px_16px_-6px_rgba(15,23,42,0.08)]`}
        >
          <p className="text-[13px] font-semibold leading-snug text-slate-600">Giá trị kho (ước tính 156)</p>
          <p
            className={`mt-1 text-2xl font-black tabular-nums tracking-tight sm:text-[1.65rem] ${inventoryTotal === 0 ? 'text-slate-400 opacity-85' : 'text-slate-800'}`}
          >
            {formatCurrency(inventoryTotal)}
          </p>
          <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-2 py-2 text-center">
              <p className="text-base font-black text-red-600">{inventory.filter((i) => inventoryQuantity(i) <= 0).length}</p>
              <p className="text-[12px] font-medium text-slate-500">Hết hàng</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-2 py-2 text-center">
              <p className="text-base font-black text-amber-600">
                {inventory.filter((i) => {
                  const qty = inventoryQuantity(i);
                  return qty > 0 && qty <= i.minStock;
                }).length}
              </p>
              <p className="text-[12px] font-medium text-slate-500">Cảnh báo</p>
            </div>
          </div>
        </div>

        <div
          className={`${OVERVIEW_CELL} flex-col justify-center rounded-xl border border-slate-100/90 bg-white p-4 shadow-[0_2px_16px_-6px_rgba(15,23,42,0.08)]`}
        >
          <p className="text-[13px] font-semibold leading-snug text-slate-600">Tài chính an toàn</p>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/90 px-3 py-2.5 text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={CARD_ICON_STROKE} />
            <span className="text-[13px] font-semibold leading-relaxed">
              Hạch toán theo TT133 · Số liệu từ nhật ký chung
            </span>
          </div>
        </div>
      </section>

      <div className={OVERVIEW_ROW3}>
        <div className={OVERVIEW_CELL}>
          <DashboardCard title="1. Dòng tiền thực tế" icon={Wallet} color="emerald">
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4
                    className={`text-2xl font-black tabular-nums tracking-tight sm:text-3xl ${stats.totalCash === 0 ? 'text-slate-400 opacity-85' : 'text-slate-800'}`}
                  >
                    {formatCurrency(stats.totalCash)}
                  </h4>
                  <p className="mt-0.5 text-[12px] font-medium leading-relaxed text-slate-400">Tiền &amp; tương đương (111/112)</p>
                </div>
                <MiniSparkline values={last7Spark.cashFlow} accentClass="text-emerald-500" />
              </div>
              <p className="text-[13px] leading-relaxed text-slate-500">Phát sinh ròng 111·112 theo ngày — 7 ngày gần nhất</p>
              <div className="mt-auto border-t border-slate-100/80 pt-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span className="text-[14px] leading-relaxed text-slate-500">Nhóm quỹ (111*)</span>
                  </div>
                  <span
                    className={`shrink-0 text-right font-mono text-[13px] font-bold tabular-nums leading-relaxed ${stats.cash === 0 ? 'text-slate-400 opacity-80' : 'text-slate-700'}`}
                  >
                    {formatCurrency(stats.cash)}
                  </span>

                  <div className="flex min-w-0 items-center gap-2 border-l border-emerald-100 pl-2.5">
                    <span className="text-[13px] leading-relaxed text-slate-600">1111 — Tiền VND</span>
                  </div>
                  <span
                    className={`shrink-0 text-right font-mono text-[13px] font-bold tabular-nums leading-relaxed ${stats.cash1111 === 0 ? 'text-slate-400 opacity-75' : 'text-slate-700'}`}
                  >
                    {formatCurrency(stats.cash1111)}
                  </span>

                  <div className="flex min-w-0 items-center gap-2 border-l border-emerald-100 pl-2.5">
                    <span className="text-[13px] leading-relaxed text-slate-600">1112 — Ngoại tệ</span>
                  </div>
                  <span
                    className={`shrink-0 text-right font-mono text-[13px] font-bold tabular-nums leading-relaxed ${stats.cash1112 === 0 ? 'text-slate-400 opacity-75' : 'text-slate-700'}`}
                  >
                    {formatCurrency(stats.cash1112)}
                  </span>

                  <div className="flex min-w-0 items-center gap-2 pt-0.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                    <span className="text-[14px] leading-relaxed text-slate-500">Nhóm NH (112*)</span>
                  </div>
                  <span
                    className={`shrink-0 pt-0.5 text-right font-mono text-[13px] font-bold tabular-nums leading-relaxed ${stats.bank === 0 ? 'text-slate-400 opacity-80' : 'text-slate-700'}`}
                  >
                    {formatCurrency(stats.bank)}
                  </span>

                  <div className="flex min-w-0 items-center gap-2 border-l border-blue-100 pl-2.5">
                    <span className="text-[13px] leading-relaxed text-slate-600">1121 — VND</span>
                  </div>
                  <span
                    className={`shrink-0 text-right font-mono text-[13px] font-bold tabular-nums leading-relaxed ${stats.bank1121 === 0 ? 'text-slate-400 opacity-75' : 'text-slate-700'}`}
                  >
                    {formatCurrency(stats.bank1121)}
                  </span>

                  <div className="flex min-w-0 items-center gap-2 border-l border-blue-100 pl-2.5">
                    <span className="text-[13px] leading-relaxed text-slate-600">1122 — Ngoại tệ</span>
                  </div>
                  <span
                    className={`shrink-0 text-right font-mono text-[13px] font-bold tabular-nums leading-relaxed ${stats.bank1122 === 0 ? 'text-slate-400 opacity-75' : 'text-slate-700'}`}
                  >
                    {formatCurrency(stats.bank1122)}
                  </span>
                </div>
              </div>
            </div>
          </DashboardCard>
        </div>

        <div className={OVERVIEW_CELL}>
          <DashboardCard
            title={`2. Kết quả kinh doanh (${stats.periodLabel})`}
            icon={TrendingUp}
            color="blue"
            extra={
              <div className="flex max-w-[min(100%,14rem)] flex-wrap items-center justify-end gap-1">
                <select
                  value={periodMode}
                  onChange={(e) => setPeriodMode(e.target.value as any)}
                  className="h-[28px] rounded-md border border-slate-200 bg-white px-1.5 text-[12px] font-semibold text-slate-600"
                  title="Chọn khoảng thời gian"
                >
                  <option value="DAY">Ngày</option>
                  <option value="MONTH">Tháng</option>
                  <option value="QUARTER">Quý</option>
                  <option value="YEAR">Năm</option>
                  <option value="RANGE">Khoảng</option>
                </select>
                {periodMode === 'DAY' && (
                  <input
                    type="date"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                    className="h-[28px] rounded-md border border-slate-200 bg-white px-1 text-[12px] font-semibold text-slate-600"
                  />
                )}
                {periodMode === 'MONTH' && (
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="h-[28px] rounded-md border border-slate-200 bg-white px-1 text-[12px] font-semibold text-slate-600"
                  />
                )}
                {periodMode === 'QUARTER' && (
                  <>
                    <select
                      value={quarter}
                      onChange={(e) => setQuarter(Number(e.target.value) as any)}
                      className="h-[28px] rounded-md border border-slate-200 bg-white px-1 text-[12px] font-semibold text-slate-600"
                    >
                      <option value={1}>Q1</option>
                      <option value={2}>Q2</option>
                      <option value={3}>Q3</option>
                      <option value={4}>Q4</option>
                    </select>
                    <input
                      type="number"
                      value={year}
                      onChange={(e) => setYear(Number(e.target.value || 0))}
                      className="h-[28px] w-[4.25rem] rounded-md border border-slate-200 bg-white px-1 text-[12px] font-semibold text-slate-600"
                    />
                  </>
                )}
                {periodMode === 'YEAR' && (
                  <input
                    type="number"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value || 0))}
                    className="h-[28px] w-[4.25rem] rounded-md border border-slate-200 bg-white px-1 text-[12px] font-semibold text-slate-600"
                  />
                )}
                {periodMode === 'RANGE' && (
                  <>
                    <input
                      type="date"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="h-[28px] rounded-md border border-slate-200 bg-white px-1 text-[12px] font-semibold text-slate-600"
                      title="Từ ngày"
                    />
                    <input
                      type="date"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="h-[28px] rounded-md border border-slate-200 bg-white px-1 text-[12px] font-semibold text-slate-600"
                      title="Đến ngày"
                    />
                  </>
                )}
              </div>
            }
          >
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex items-start justify-between gap-2 border-b border-slate-100/70 pb-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-relaxed text-slate-500">Doanh thu thuần (kỳ chọn)</p>
                  <p
                    className={`text-2xl font-black tabular-nums leading-tight tracking-tight sm:text-3xl ${stats.revenue === 0 ? 'text-slate-400 opacity-85' : 'text-slate-800'}`}
                  >
                    {formatCurrency(stats.revenue)}
                  </p>
                </div>
                <MiniSparkline values={last7Spark.revenue} accentClass="text-blue-500" smooth />
              </div>
              <div className="min-h-[2.5rem]">
                <TrendDelta pct={revenueMom.pct} label=" DT tháng này vs tháng trước" />
              </div>
              <div className="space-y-1 border-t border-slate-100/60 pt-2">
                <MiniStat label="Giá vốn hàng bán" value={stats.cogs} />
                <MiniStat label="Chi phí bán hàng + quản lý doanh nghiệp (641/642)" value={stats.opex || 0} />
              </div>
              <div className="mt-auto space-y-2 border-t border-slate-100/80 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-slate-500">Lợi nhuận gộp</span>
                  <span
                    className={`text-lg font-black tabular-nums leading-relaxed sm:text-xl ${stats.grossProfit === 0 ? 'text-slate-400 opacity-80' : 'text-emerald-600'}`}
                  >
                    {formatCurrency(stats.grossProfit)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-slate-500">Lợi nhuận ước tính</span>
                  <span
                    className={`text-lg font-black tabular-nums leading-relaxed sm:text-xl ${
                      Number(stats.netProfit || 0) === 0
                        ? 'text-slate-400 opacity-80'
                        : Number(stats.netProfit || 0) >= 0
                          ? 'text-emerald-600'
                          : 'text-rose-700'
                    }`}
                  >
                    {formatCurrency(stats.netProfit || 0)}
                  </span>
                </div>
              </div>
            </div>
          </DashboardCard>
        </div>

        <div className={OVERVIEW_CELL}>
          <DashboardCard title="3. Công nợ hiện tại" icon={Users} color="orange">
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex items-start justify-between gap-2 border-b border-slate-100/70 pb-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-relaxed text-slate-500">Tổng dư phải thu &amp; phải trả</p>
                  <p
                    className={`text-2xl font-black tabular-nums leading-tight tracking-tight sm:text-3xl ${stats.ar + stats.ap === 0 ? 'text-slate-400 opacity-85' : 'text-slate-800'}`}
                  >
                    {formatCurrency(stats.ar + stats.ap)}
                  </p>
                </div>
                <MiniSparkline values={last7Spark.arFlow} accentClass="text-orange-500" />
              </div>
              <p className="text-[13px] leading-relaxed text-slate-500">Phát sinh ròng TK 131 theo ngày — 7 ngày gần nhất</p>
              <div className="grid grid-cols-2 gap-2">
                <div
                  className={`rounded-lg border p-2.5 transition-all ${stats.ar === 0 ? 'border-slate-100 bg-slate-50/80 opacity-60' : 'border-blue-100 bg-blue-50/80'}`}
                >
                  <p className="text-[12px] font-medium text-slate-600">Phải thu (131)</p>
                  <p className={`mt-1 text-[15px] font-black tabular-nums sm:text-base ${stats.ar === 0 ? 'text-slate-400' : 'text-blue-700'}`}>
                    {formatCurrency(stats.ar)}
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-2.5 transition-all ${stats.ap === 0 ? 'border-slate-100 bg-slate-50/80 opacity-60' : 'border-red-100 bg-red-50/80'}`}
                >
                  <p className="text-[12px] font-medium text-slate-600">Phải trả (331)</p>
                  <p className={`mt-1 text-[15px] font-black tabular-nums sm:text-base ${stats.ap === 0 ? 'text-slate-400' : 'text-red-700'}`}>
                    {formatCurrency(stats.ap)}
                  </p>
                </div>
              </div>
              {stats.ar === 0 && stats.ap === 0 ? (
                <div className="mt-auto flex items-center justify-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 py-3 text-[13px] font-semibold tracking-tight text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={CARD_ICON_STROKE} aria-hidden /> Đã tất toán
                </div>
              ) : (
                <button
                  type="button"
                  className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 py-3 text-[13px] font-semibold tracking-tight text-white shadow-sm transition-colors hover:bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={CARD_ICON_STROKE} aria-hidden /> Theo dõi nợ
                </button>
              )}
            </div>
          </DashboardCard>
        </div>
      </div>

      <div className={OVERVIEW_ROW3}>
        <div className={OVERVIEW_CELL}>
          <div className={kpiShell}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${grossMargin.labelClass}`}>
              % Lợi nhuận gộp
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={CARD_ICON_STROKE} />
          </div>
          <div className="flex flex-wrap items-baseline gap-1.5">
            <h3
              className={`text-2xl font-black tabular-nums sm:text-[1.75rem] ${grossMargin.display === '— %' ? 'text-slate-400 opacity-90' : 'text-slate-800'}`}
            >
              {grossMargin.display}
            </h3>
            <KpiInfo text={(grossMargin as { infoTooltip?: string }).infoTooltip} />
          </div>
          <p className="mt-1 text-[12px] font-medium text-slate-500">Biên lợi nhuận / Doanh thu</p>
          <div className="mt-auto h-1 w-full rounded-full bg-slate-200/50">
            <div className={`h-full rounded-full ${grossMargin.barClass}`} style={{ width: `${grossMargin.barPct}%` }} />
          </div>
          </div>
        </div>

        <div className={OVERVIEW_CELL}>
          <div className={kpiShell}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${liquidityRisk.labelClass}`}>
              % Phải thu / Tiền &amp; tương đương tiền
            </span>
            <ArrowDownRight className="h-4 w-4 shrink-0 text-blue-500" strokeWidth={CARD_ICON_STROKE} />
          </div>
          <div className="flex flex-wrap items-baseline gap-1.5">
            <h3
              className={`text-2xl font-black tabular-nums sm:text-[1.75rem] ${liquidityRisk.display === '— %' ? 'text-slate-400 opacity-90' : 'text-slate-800'}`}
            >
              {liquidityRisk.display}
            </h3>
            <KpiInfo text={(liquidityRisk as { infoTooltip?: string }).infoTooltip} />
          </div>
          <p className="mt-1 text-[12px] font-medium text-slate-500">Rủi ro thanh khoản</p>
          <div className="mt-auto h-1 w-full rounded-full bg-slate-200/50">
            <div
              className={`h-full rounded-full ${liquidityRisk.barClass}`}
              style={{ width: `${Math.min(100, (liquidityRisk.barPct / 200) * 100)}%` }}
            />
          </div>
          </div>
        </div>

        <div className={OVERVIEW_CELL}>
          <div className={kpiShell}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-700">
              VAT phải nộp (ước tính)
            </span>
            <Activity className="h-4 w-4 shrink-0 text-violet-500" strokeWidth={CARD_ICON_STROKE} />
          </div>
          <h3
            className={`text-2xl font-black tabular-nums sm:text-[1.75rem] ${Math.max(0, stats.vatDiff) === 0 ? 'text-slate-400 opacity-85' : 'text-slate-800'}`}
          >
            {formatCurrency(Math.max(0, stats.vatDiff))}
          </h3>
          <p className="mt-1 text-[12px] font-medium text-slate-500">Dư đầu ra trừ đầu vào (kỳ kinh doanh)</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-5">
        <div className="flex min-h-0 lg:col-span-12">
          <DashboardCard title="4. Đối soát thuế VAT" icon={FileText} color="purple">
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-12">
              <div className="space-y-2 lg:col-span-7">
                <p className="border-b border-slate-100 pb-1.5 text-[12px] font-semibold leading-relaxed text-slate-500">
                  {stats.vatCutoffLabel} · TK 133 / 3331
                </p>
                <div className="flex justify-between gap-2 text-[12px] leading-relaxed">
                  <span className="text-[14px] text-slate-500">VAT đầu ra (3331 ròng ≥ 0)</span>
                  <span
                    className={`font-bold tabular-nums ${stats.vatOut === 0 ? 'text-slate-400 opacity-80' : 'text-slate-800'}`}
                  >
                    {formatCurrency(stats.vatOut)}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-[12px] leading-relaxed">
                  <span className="text-[14px] text-slate-500">VAT đầu vào (133 ròng ≥ 0)</span>
                  <span
                    className={`font-bold tabular-nums ${stats.vatIn === 0 ? 'text-slate-400 opacity-80' : 'text-slate-800'}`}
                  >
                    {formatCurrency(stats.vatIn)}
                  </span>
                </div>
              </div>
              <div
                className={`flex flex-col justify-center rounded-xl border p-3 text-center lg:col-span-5 ${
                  stats.vatDiff > 0
                    ? 'border-red-100 bg-red-50/80 text-red-700'
                    : 'border-emerald-100 bg-emerald-50/80 text-emerald-800'
                }`}
              >
                <p className="text-sm font-bold leading-snug">
                  {stats.vatDiff > 0
                    ? `Thuế phải nộp: ${formatCurrency(stats.vatDiff)}`
                    : `Khấu trừ: ${formatCurrency(Math.abs(stats.vatDiff))}`}
                </p>
              </div>
            </div>
          </DashboardCard>
        </div>
      </div>
    </div>
  );
};
