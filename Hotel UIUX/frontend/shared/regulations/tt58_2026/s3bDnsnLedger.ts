import type { FinancialYear, JournalEntry } from '../../types';
import { journalEntryDetailsArray } from '../../utils/journalEntryDetails';
import { computeTt58TaxSummary } from './financialStatements';

export type Tt58S3bDnsnRowKind =
  | 'section_header'
  | 'opening_line'
  | 'period_header'
  | 'detail'
  | 'period_subtotal'
  | 'vat_payable_period'
  | 'vat_paid'
  | 'vat_refunded'
  | 'closing_header'
  | 'closing_line';

export type Tt58S3bDnsnLedgerRow = {
  kind: Tt58S3bDnsnRowKind;
  docNo?: string;
  docDate?: string;
  description: string;
  vatInput?: number;
  vatOutput?: number;
  bold?: boolean;
};

export type Tt58S3bDnsnLedgerData = {
  rows: Tt58S3bDnsnLedgerRow[];
  openingVatCredit: number;
  openingVatPayable: number;
  vatInput: number;
  vatOutput: number;
  vatPayableInPeriod: number;
  vatPaid: number;
  vatRefunded: number;
  closingVatCredit: number;
  closingVatPayable: number;
  closingVatCreditFromAccounts: number;
  closingVatPayableFromAccounts: number;
};

export const TT58_S3B_HEADERS = [
  'Số hiệu (A)',
  'Ngày, tháng (B)',
  'Nội dung nghiệp vụ (C)',
  'Số thuế GTGT đầu vào (1)',
  'Số thuế GTGT đầu ra (2)',
];

const asEntries = (entries: JournalEntry[] | undefined | null) => (Array.isArray(entries) ? entries : []);

const inPeriod = (dateStr: string, startDate: string, endDate: string) =>
  dateStr >= startDate && dateStr <= endDate;

const formatDocDate = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
};

const accountStartsWith = (account: string, prefixes: string[]) =>
  prefixes.some((p) => String(account || '').startsWith(p));

const entryAmountByPrefixes = (
  entry: JournalEntry,
  prefixes: string[],
  side: 'debit' | 'credit',
) =>
  journalEntryDetailsArray(entry).reduce((sum, d) => {
    if (!accountStartsWith(String(d.account || ''), prefixes)) return sum;
    return sum + (side === 'debit' ? Math.round(Number(d.debit || 0)) : Math.round(Number(d.credit || 0)));
  }, 0);

const entryHasPrefixes = (entry: JournalEntry, prefixes: string[]) =>
  journalEntryDetailsArray(entry).some((d) => accountStartsWith(String(d.account || ''), prefixes));

/** Thuế GTGT đã nộp (tiền mặt/ngân hàng), không gồm bút khấu trừ Nợ 3331 / Có 133. */
const sumVatPaidInPeriod = (entries: JournalEntry[], startDate: string, endDate: string) => {
  let total = 0;
  for (const entry of entries) {
    const date = String(entry.date || '').slice(0, 10);
    if (!inPeriod(date, startDate, endDate)) continue;
    if (!entryHasPrefixes(entry, ['3331'])) continue;
    const paid = entryAmountByPrefixes(entry, ['3331'], 'debit');
    if (paid <= 0) continue;
    const hasCash = entryHasPrefixes(entry, ['111', '112']);
    const hasOffset133 = entryHasPrefixes(entry, ['133']);
    if (hasCash && !hasOffset133) total += paid;
  }
  return total;
};

/** Thuế GTGT đã được hoàn trong kỳ (tiền về TK 111/112: Nợ 111,Có 133 hoặc Nợ 111,Có 3331). */
const sumVatRefundedInPeriod = (entries: JournalEntry[], startDate: string, endDate: string) => {
  let total = 0;
  for (const entry of entries) {
    const date = String(entry.date || '').slice(0, 10);
    if (!inPeriod(date, startDate, endDate)) continue;
    const cashIn = entryAmountByPrefixes(entry, ['111', '112'], 'debit');
    if (cashIn <= 0) continue;
    total += entryAmountByPrefixes(entry, ['133'], 'credit');
    total += entryAmountByPrefixes(entry, ['3331'], 'credit');
  }
  return total;
};

type VatDetailLine = {
  date: string;
  sortKey: string;
  docNo: string;
  docDate: string;
  description: string;
  vatInput: number;
  vatOutput: number;
};

const collectVatDetailLines = (
  entries: JournalEntry[],
  startDate: string,
  endDate: string,
): VatDetailLine[] => {
  const lines: VatDetailLine[] = [];

  for (const entry of entries) {
    const date = String(entry.date || '').slice(0, 10);
    if (!inPeriod(date, startDate, endDate)) continue;

    const vatInput = entryAmountByPrefixes(entry, ['133'], 'debit');
    const vatOutput = entryAmountByPrefixes(entry, ['3331'], 'credit');
    if (vatInput <= 0 && vatOutput <= 0) continue;

    const docNo = String(entry.referenceId || entry.id || '').trim();
    const docDate = formatDocDate(date);
    const description =
      String(entry.description || '').trim() ||
      (vatInput > 0 && vatOutput > 0
        ? 'Phát sinh thuế GTGT đầu vào và đầu ra'
        : vatInput > 0
          ? 'Thuế GTGT đầu vào được khấu trừ'
          : 'Thuế GTGT đầu ra');

    lines.push({
      date,
      sortKey: String(entry.id || ''),
      docNo,
      docDate,
      description,
      vatInput,
      vatOutput,
    });
  }

  lines.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.sortKey.localeCompare(b.sortKey);
  });

  return lines;
};

const nonNegative = (n: number) => (n > 0 ? n : 0);

export function computeTt58S3bDnsnLedger(
  entriesInput: JournalEntry[],
  financialYear: FinancialYear,
): Tt58S3bDnsnLedgerData {
  const entries = asEntries(entriesInput);
  const startDate = financialYear.startDate;
  const endDate = financialYear.endDate;
  const tax = computeTt58TaxSummary(entries, financialYear);

  const vatInput = tax.vatInput;
  const vatOutput = tax.vatOutput;
  const vatPaid = sumVatPaidInPeriod(entries, startDate, endDate);
  const vatRefunded = sumVatRefundedInPeriod(entries, startDate, endDate);
  const vatPayableInPeriod = Math.max(0, vatOutput - vatInput);

  const closingVatCredit = nonNegative(
    tax.openingVatCredit + vatInput - vatOutput + vatPaid - vatRefunded,
  );
  const closingVatPayable = nonNegative(
    tax.openingVatPayable + vatOutput - vatInput - vatPaid + vatRefunded,
  );

  const detailLines = collectVatDetailLines(entries, startDate, endDate);
  const rows: Tt58S3bDnsnLedgerRow[] = [];

  rows.push({ kind: 'section_header', description: 'Số dư đầu kỳ', bold: true });
  rows.push({
    kind: 'opening_line',
    description: 'Số thuế GTGT còn được khấu trừ hoặc được hoàn đầu kỳ',
    vatInput: tax.openingVatCredit,
  });
  rows.push({
    kind: 'opening_line',
    description: 'Số thuế GTGT còn phải nộp đầu kỳ',
    vatOutput: tax.openingVatPayable,
  });

  rows.push({ kind: 'period_header', description: 'Số phát sinh trong kỳ', bold: true });
  for (const line of detailLines) {
    rows.push({
      kind: 'detail',
      docNo: line.docNo,
      docDate: line.docDate,
      description: line.description,
      vatInput: line.vatInput > 0 ? line.vatInput : undefined,
      vatOutput: line.vatOutput > 0 ? line.vatOutput : undefined,
    });
  }
  rows.push({
    kind: 'period_subtotal',
    description: 'Cộng số phát sinh trong kỳ',
    vatInput,
    vatOutput,
    bold: true,
  });

  rows.push({
    kind: 'vat_payable_period',
    description: 'Tổng số thuế GTGT phải nộp trong kỳ',
    vatOutput: vatPayableInPeriod,
    bold: true,
  });
  rows.push({
    kind: 'vat_paid',
    description: 'Số thuế GTGT đã nộp trong kỳ',
    vatOutput: vatPaid,
    bold: true,
  });
  rows.push({
    kind: 'vat_refunded',
    description: 'Số thuế GTGT đã được hoàn trong kỳ',
    vatOutput: vatRefunded,
    bold: true,
  });

  rows.push({ kind: 'closing_header', description: 'Số dư cuối kỳ', bold: true });
  rows.push({
    kind: 'closing_line',
    description: 'Số thuế GTGT còn được khấu trừ hoặc được hoàn cuối kỳ',
    vatInput: closingVatCredit,
    bold: true,
  });
  rows.push({
    kind: 'closing_line',
    description: 'Số thuế GTGT còn phải nộp cuối kỳ',
    vatOutput: closingVatPayable,
    bold: true,
  });

  return {
    rows,
    openingVatCredit: tax.openingVatCredit,
    openingVatPayable: tax.openingVatPayable,
    vatInput,
    vatOutput,
    vatPayableInPeriod,
    vatPaid,
    vatRefunded,
    closingVatCredit,
    closingVatPayable,
    closingVatCreditFromAccounts: tax.closingVatCredit,
    closingVatPayableFromAccounts: tax.closingVatPayable,
  };
}

export function tt58S3bRowsToTable(
  data: Tt58S3bDnsnLedgerData,
  formatAmount: (value: number | undefined) => string,
): string[][] {
  return data.rows.map((row) => {
    const docNo = row.docNo || '';
    const docDate = row.docDate || '';
    const col1 =
      row.vatInput !== undefined && row.vatInput > 0 ? formatAmount(row.vatInput) : '';
    const col2 =
      row.vatOutput !== undefined && row.vatOutput > 0 ? formatAmount(row.vatOutput) : '';
    return [docNo, docDate, row.description, col1, col2];
  });
}
