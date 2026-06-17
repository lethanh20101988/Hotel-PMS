import type { AccountingVoucherDetail, JournalEntry } from '@shared/types';
import { normalizeLedgerAccountCode } from './glLedgerBalances';
import { formatCurrency } from './format';

const EPS = 0.005;

/** Tổng số phát sinh Nợ / Có theo từng dòng chứng từ (mỗi dòng góp cùng một amount vào Nợ và Có). */
export function sumVoucherDebitCredit(details: AccountingVoucherDetail[] | undefined) {
  let debit = 0;
  let credit = 0;
  for (const d of details || []) {
    const amt = Number(d.amount || 0);
    if (!(amt > 0)) continue;
    const da = String(d.debitAccount || '').trim();
    const ca = String(d.creditAccount || '').trim();
    if (da) debit += amt;
    if (ca) credit += amt;
  }
  return { debit, credit };
}

/** Không cho lưu nếu Tổng Nợ ≠ Tổng Có hoặc dòng có tiền nhưng thiếu TK. */
export function validateVoucherBalanced(details: AccountingVoucherDetail[] | undefined): string | null {
  const lines = details || [];
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i];
    const amt = Number(d.amount || 0);
    const da = String(d.debitAccount || '').trim();
    const ca = String(d.creditAccount || '').trim();
    if (amt > 0 && (!da || !ca)) {
      return `Dòng ${i + 1}: Nhập đủ TK Nợ và TK Có khi có số tiền.`;
    }
  }
  const { debit, credit } = sumVoucherDebitCredit(details);
  if (debit <= 0 && credit <= 0) {
    return 'Chứng từ phải có ít nhất một dòng có số tiền và định khoản.';
  }
  if (Math.abs(debit - credit) > EPS) {
    return `Chứng từ không cân đối: Tổng Nợ ${formatCurrency(debit)} ≠ Tổng Có ${formatCurrency(credit)}.`;
  }
  return null;
}

function buildNetByAccount(
  journalEntries: JournalEntry[],
  endDate: string,
  excludeJournalIds: Set<string>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const je of journalEntries) {
    if (excludeJournalIds.has(je.id)) continue;
    const jd = String(je.date || '').split('T')[0];
    if (!jd || jd > endDate) continue;
    for (const det of je.details || []) {
      const acc = String(det.account || '').trim();
      if (!acc) continue;
      map.set(acc, (map.get(acc) || 0) + (Number(det.debit || 0) - Number(det.credit || 0)));
    }
  }
  return map;
}

/**
 * Cấm âm quỹ/tiền gửi: tổng Có vào TK 111*, 112* không được vượt số dư Nợ − Có hiện có (theo NKC đến ngày hạch toán).
 * Khi sửa chứng từ đã ghi sổ, loại bỏ bút JE-VOU-* cũ khỏi tính dư.
 */
export function validateCashNotOverdraft(args: {
  details: AccountingVoucherDetail[] | undefined;
  postingDate: string;
  journalEntries: JournalEntry[];
  voucherId: string;
  voucherWasPosted: boolean;
}): string | null {
  const { details, postingDate, journalEntries, voucherId, voucherWasPosted } = args;
  const date = String(postingDate || '').split('T')[0];
  if (!date) return null;

  const exclude = new Set<string>();
  if (voucherWasPosted && voucherId) exclude.add(`JE-VOU-${voucherId}`);

  const nets = buildNetByAccount(journalEntries, date, exclude);

  const creditByAcc = new Map<string, number>();
  for (const d of details || []) {
    const amt = Number(d.amount || 0);
    if (!(amt > 0)) continue;
    const rawCa = String(d.creditAccount || '').trim();
    if (!rawCa) continue;
    const ca = normalizeLedgerAccountCode(rawCa);
    if (!ca.startsWith('111') && !ca.startsWith('112')) continue;
    creditByAcc.set(ca, (creditByAcc.get(ca) || 0) + amt);
  }

  for (const [acc, need] of creditByAcc.entries()) {
    const bal = nets.get(acc) ?? 0;
    if (bal + EPS < need) {
      return `Không đủ số dư tiền (${acc}): hiện có ${formatCurrency(bal)}, cần chi ${formatCurrency(need)}.`;
    }
  }
  return null;
}
