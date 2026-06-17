import type { Invoice, JournalEntry } from '../types';
import { roundVnd } from './vndMoney';

const DAY_MS = 24 * 60 * 60 * 1000;

export type DeferredRevenueScheduleRow = {
  period: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  days: number;
  amount: number;
};

export type DeferredRevenueScheduleStatusRow = DeferredRevenueScheduleRow & {
  posted: boolean;
  cumulativePosted: number;
  remainingBalance: number;
};

const toUtcDate = (dateStr?: string | null) => {
  const raw = String(dateStr || '').split('T')[0];
  if (!raw) return null;
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
};

const toDateOnly = (date: Date) => date.toISOString().split('T')[0];

const diffDaysInclusive = (start: Date, end: Date) =>
  Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;

const minDate = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
const maxDate = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

const toMonthKey = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const toMonthLabel = (period: string) => {
  const [year, month] = String(period || '').split('-');
  return month && year ? `${month}/${year}` : period;
};

const getMonthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const getMonthEnd = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));

export const isDeferredRevenueInvoice = (invoice?: Partial<Invoice> | null) => {
  if (!invoice || invoice.type !== 'SALES' || !invoice.deferredRevenueEnabled) return false;
  const amount = Number(invoice.amount || 0);
  const startDate = toUtcDate(invoice.serviceStartDate);
  const endDate = toUtcDate(invoice.serviceEndDate);
  if (!startDate || !endDate || endDate.getTime() < startDate.getTime()) return false;
  return amount > 0;
};

export const getDeferredRevenueRecognitionAccount = (invoice?: Partial<Invoice> | null) => {
  const manualAccount = String(invoice?.revenueRecognitionAccount || '').trim();
  if (manualAccount) return manualAccount;
  return invoice?.category === 'SERVICE' ? '5113' : '5111';
};

export const getDeferredRevenuePostingRef = (invoiceId: string, period: string) =>
  `PB-3387-${period}-${invoiceId}`;

export const parseDeferredRevenuePostingRef = (referenceId?: string | null) => {
  const match = String(referenceId || '').match(/^PB-3387-(\d{4}-\d{2})-(.+)$/);
  if (!match) return null;
  return {
    period: match[1],
    invoiceId: match[2],
  };
};

export const buildDeferredRevenueSchedule = (invoice?: Partial<Invoice> | null): DeferredRevenueScheduleRow[] => {
  if (!isDeferredRevenueInvoice(invoice)) return [];

  const startDate = toUtcDate(invoice?.serviceStartDate)!;
  const endDate = toUtcDate(invoice?.serviceEndDate)!;
  const totalAmount = roundVnd(Number(invoice?.amount || 0));
  const totalDays = diffDaysInclusive(startDate, endDate);

  if (totalDays <= 0 || totalAmount <= 0) return [];

  const rows: Array<Omit<DeferredRevenueScheduleRow, 'amount'>> = [];
  let cursor = getMonthStart(startDate);

  while (cursor.getTime() <= endDate.getTime()) {
    const monthStart = getMonthStart(cursor);
    const monthEnd = getMonthEnd(cursor);
    const segmentStart = maxDate(startDate, monthStart);
    const segmentEnd = minDate(endDate, monthEnd);
    const days = diffDaysInclusive(segmentStart, segmentEnd);

    rows.push({
      period: toMonthKey(cursor),
      periodLabel: toMonthLabel(toMonthKey(cursor)),
      startDate: toDateOnly(segmentStart),
      endDate: toDateOnly(segmentEnd),
      days,
    });

    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  let allocated = 0;
  return rows.map((row, index) => {
    const amount = index === rows.length - 1
      ? totalAmount - allocated
      : roundVnd((totalAmount * row.days) / totalDays);
    allocated += amount;
    return {
      ...row,
      amount,
    };
  });
};

export const getDeferredRevenuePostedPeriods = (
  invoice?: Partial<Invoice> | null,
  entries: JournalEntry[] = [],
) => {
  const posted = new Set<string>();
  const invoiceId = String(invoice?.id || '').trim();
  if (!invoiceId) return posted;

  (entries || []).forEach((entry) => {
    const parsed = parseDeferredRevenuePostingRef(entry.referenceId);
    if (!parsed) return;
    if (parsed.invoiceId === invoiceId) {
      posted.add(parsed.period);
    }
  });

  return posted;
};

export const buildDeferredRevenueScheduleWithStatus = (
  invoice?: Partial<Invoice> | null,
  entries: JournalEntry[] = [],
): DeferredRevenueScheduleStatusRow[] => {
  const schedule = buildDeferredRevenueSchedule(invoice);
  if (schedule.length === 0) return [];

  const postedPeriods = getDeferredRevenuePostedPeriods(invoice, entries);
  const totalAmount = roundVnd(Number(invoice?.amount || 0));
  let cumulativePosted = 0;

  return schedule.map((row) => {
    const posted = postedPeriods.has(row.period);
    if (posted) {
      cumulativePosted += row.amount;
    }
    return {
      ...row,
      posted,
      cumulativePosted,
      remainingBalance: Math.max(0, totalAmount - cumulativePosted),
    };
  });
};

export const getDeferredRevenueRemainingBalance = (
  invoice?: Partial<Invoice> | null,
  entries: JournalEntry[] = [],
) => {
  const schedule = buildDeferredRevenueScheduleWithStatus(invoice, entries);
  if (schedule.length === 0) return 0;
  return schedule[schedule.length - 1]?.remainingBalance || 0;
};

export const hasDeferredRevenueAllocationsPosted = (
  invoice?: Partial<Invoice> | null,
  entries: JournalEntry[] = [],
) => getDeferredRevenuePostedPeriods(invoice, entries).size > 0;

export const getDeferredRevenuePeriodAmount = (
  invoice?: Partial<Invoice> | null,
  period?: string,
) => {
  if (!period) return 0;
  const row = buildDeferredRevenueSchedule(invoice).find((item) => item.period === period);
  return Number(row?.amount || 0);
};

/** Cảnh báo nghiệp vụ (không chặn lưu): ngày HĐ / kỳ dịch vụ có thể không khớp niên độ hoặc hợp đồng. */
export const collectDeferredInvoice3387Warnings = (params: {
  invoiceDate: string;
  serviceStartDate: string;
  serviceEndDate: string;
  financialYearStart: string;
  financialYearEnd: string;
}): string[] => {
  const warnings: string[] = [];
  const inv = String(params.invoiceDate || '').split('T')[0];
  const ss = String(params.serviceStartDate || '').split('T')[0];
  const se = String(params.serviceEndDate || '').split('T')[0];
  const fyS = String(params.financialYearStart || '').split('T')[0];
  const fyE = String(params.financialYearEnd || '').split('T')[0];
  if (inv && ss && se) {
    if (inv < ss || inv > se) {
      warnings.push(
        'Ngày hóa đơn nằm ngoài khoảng thực hiện dịch vụ (có thể sai sót theo hợp đồng hoặc ghi nhận muộn).',
      );
    }
    if (inv.slice(0, 7) !== ss.slice(0, 7) && inv.slice(0, 7) !== se.slice(0, 7)) {
      warnings.push('Tháng của ngày hóa đơn khác tháng bắt đầu/kết thúc dịch vụ (kiểm tra kỳ khai báo).');
    }
  }
  if (ss && fyS && fyE && (ss < fyS || ss > fyE)) {
    warnings.push('Ngày bắt đầu dịch vụ nằm ngoài niên độ kế toán hiện tại.');
  }
  if (se && fyS && fyE && (se < fyS || se > fyE)) {
    warnings.push('Ngày kết thúc dịch vụ nằm ngoài niên độ kế toán hiện tại.');
  }
  return warnings;
};
