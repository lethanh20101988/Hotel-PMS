import type { AccountingVoucher, FinancialYear, JournalEntry } from '@shared/types';

/** Khớp normalizePaymentAccountCode trong store (TT133) */
export function normalizeLedgerAccountCode(account?: string): string {
  const code = String(account || '').trim();
  if (code === '111') return '1111';
  if (code === '112') return '1121';
  return code;
}

/** Nợ − Có trên NKC, lọc theo niên độ, theo 3 chữ đầu TK */
export function journalNetForPrefixInYear(
  entries: JournalEntry[],
  yearStart: string,
  yearEnd: string,
  prefix: string,
): number {
  let sum = 0;
  for (const e of entries) {
    const ed = String(e.date || '').split('T')[0];
    if (!ed || ed < yearStart || ed > yearEnd) continue;
    for (const d of e.details || []) {
      const base = String(d.account || '').substring(0, 3);
      if (base !== prefix) continue;
      sum += Number(d.debit || 0) - Number(d.credit || 0);
    }
  }
  return sum;
}

/**
 * Phát sinh từ chứng từ POSTED khi không có bút JE-VOU trong cùng niên độ
 * (tránh lệch Tổng quan / Thiết lập ban đầu sau phiếu thu/chi).
 */
export function voucherNetDeltaForPrefix(
  vouchers: AccountingVoucher[] | undefined,
  allJournalEntries: JournalEntry[],
  yearStart: string,
  yearEnd: string,
  prefix: string,
): number {
  let sum = 0;
  for (const v of vouchers || []) {
    if (v.status === 'DRAFT') continue;
    const d0 = String(v.postingDate || v.date || '').split('T')[0];
    if (!d0 || d0 < yearStart || d0 > yearEnd) continue;
    const je = allJournalEntries.find((e) => e.id === `JE-VOU-${v.id}`);
    if (je && je.date >= yearStart && je.date <= yearEnd) continue;
    for (const line of v.details || []) {
      const amt = Number(line.amount || 0);
      if (!(amt > 0)) continue;
      const da = normalizeLedgerAccountCode(line.debitAccount);
      const ca = normalizeLedgerAccountCode(line.creditAccount);
      if (da.substring(0, 3) === prefix) sum += amt;
      if (ca.substring(0, 3) === prefix) sum -= amt;
    }
  }
  return sum;
}

export function combinedNetForPrefix(
  journalEntries: JournalEntry[],
  accountingVouchers: AccountingVoucher[] | undefined,
  yearStart: string,
  yearEnd: string,
  prefix: string,
): number {
  return (
    journalNetForPrefixInYear(journalEntries, yearStart, yearEnd, prefix) +
    voucherNetDeltaForPrefix(accountingVouchers, journalEntries, yearStart, yearEnd, prefix)
  );
}

/** Phải thu 131 / Phải trả 331 (dương) hiển thị trên báo cáo */
export function getDisplayArApFromGl(
  journalEntries: JournalEntry[],
  accountingVouchers: AccountingVoucher[] | undefined,
  fy: FinancialYear,
): { ar: number; ap: number } {
  const ys = fy.startDate;
  const ye = fy.endDate;
  const n131 = combinedNetForPrefix(journalEntries, accountingVouchers, ys, ye, '131');
  const n331 = combinedNetForPrefix(journalEntries, accountingVouchers, ys, ye, '331');
  const ar = Math.max(0, Math.round(n131));
  const ap = Math.max(0, Math.round(-n331));
  return { ar, ap };
}
