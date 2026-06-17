import type { AccountingRegimeConfig, FinancialYear, Invoice, JournalEntry } from '../../types';
import { journalEntryDetailsArray } from '../../utils/journalEntryDetails';
import { computeTt58TaxSummary } from './financialStatements';
import { collectTt58RevenueLinesFromInvoices } from './s1DnsnLedger';

export type Tt58S2bExpenseCategory = 'a' | 'b' | 'c' | 'd' | 'dd' | 'e';

export const TT58_S2B_EXPENSE_CATEGORY_LABELS: Record<Tt58S2bExpenseCategory, string> = {
  a: 'a) Chi phí nguyên liệu, vật liệu, nhiên liệu, năng lượng, hàng hóa sử dụng vào sản xuất, kinh doanh',
  b: 'b) Chi phí tiền lương, tiền công và các khoản phụ cấp',
  c: 'c) Chi phí khấu hao tài sản cố định phục vụ sản xuất, kinh doanh',
  d: 'd) Chi phí dịch vụ mua ngoài',
  dd: 'đ) Chi phí trả lãi tiền vay vốn sản xuất, kinh doanh',
  e: 'e) Các khoản chi khác phục vụ trực tiếp hoạt động sản xuất, kinh doanh',
};

export type Tt58S2bDnsnRowKind =
  | 'opening_cit'
  | 'period_header'
  | 'section_header'
  | 'detail'
  | 'section_subtotal'
  | 'expense_category'
  | 'footer_cit_payable'
  | 'footer_cit_paid'
  | 'footer_cit_closing';

export type Tt58S2bDnsnLedgerRow = {
  kind: Tt58S2bDnsnRowKind;
  docNo?: string;
  docDate?: string;
  description: string;
  amount?: number;
  bold?: boolean;
};

export type Tt58S2bDnsnLedgerData = {
  rows: Tt58S2bDnsnLedgerRow[];
  openingCitPayable: number;
  totalRevenue: number;
  totalExpense: number;
  taxableIncome: number;
  citPayable: number;
  citPaid: number;
  closingCitPayable: number;
};

type LedgerLine = {
  docNo: string;
  docDate: string;
  description: string;
  amount: number;
  expenseCategory?: Tt58S2bExpenseCategory;
};

const asInvoices = (invoices: Invoice[] | undefined | null) => (Array.isArray(invoices) ? invoices : []);
const asEntries = (entries: JournalEntry[] | undefined | null) => (Array.isArray(entries) ? entries : []);

const inPeriod = (dateStr: string, startDate: string, endDate: string) =>
  dateStr >= startDate && dateStr <= endDate;

const formatDocDate = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
};

const invoicePostingDate = (inv: Invoice) =>
  String(inv.accountingPostingDate || inv.date || '').slice(0, 10);

const accountStartsWith = (account: string, prefixes: string[]) =>
  prefixes.some((p) => String(account || '').startsWith(p));

export const classifyTt58S2bExpenseAccount = (account: string): Tt58S2bExpenseCategory => {
  const acc = String(account || '').trim();
  if (accountStartsWith(acc, ['632', '151', '152', '153', '154', '155', '156', '157'])) return 'a';
  if (accountStartsWith(acc, ['622', '334'])) return 'b';
  if (accountStartsWith(acc, ['6424', '214', '627', '241', '242'])) return 'c';
  if (accountStartsWith(acc, ['635'])) return 'dd';
  if (accountStartsWith(acc, ['6427'])) return 'd';
  if (accountStartsWith(acc, ['811'])) return 'e';
  if (accountStartsWith(acc, ['642'])) return 'd';
  return 'e';
};

const EXPENSE_ACCOUNT_PREFIXES = ['632', '635', '642', '811', '622', '627', '641', '154'];
const OTHER_INCOME_PREFIXES = ['515', '711'];

const buildPurchaseDescription = (inv: Invoice, detailLabel?: string) => {
  const base = String(inv.description || '').trim();
  const supplier = String(inv.customerName || '').trim();
  const line = String(detailLabel || '').trim();
  const parts = [line || undefined, base || undefined, supplier ? `NCC: ${supplier}` : undefined].filter(Boolean);
  return parts.join(' — ') || 'Chi phí mua hàng hóa, dịch vụ';
};

const collectPurchaseExpenseLines = (
  invoices: Invoice[],
  startDate: string,
  endDate: string,
): LedgerLine[] => {
  const lines: LedgerLine[] = [];
  for (const inv of invoices) {
    if (inv.type !== 'PURCHASE') continue;
    const postDate = invoicePostingDate(inv);
    if (!postDate || !inPeriod(postDate, startDate, endDate)) continue;

    const docNo = String(inv.invoiceNumber || inv.symbolCode || inv.id || '').trim();
    const docDate = formatDocDate(inv.date || postDate);
    const details = Array.isArray(inv.details) ? inv.details : [];

    if (details.length === 0) {
      const amount = Number(inv.amount || 0);
      if (amount <= 0) continue;
      lines.push({
        docNo,
        docDate,
        description: buildPurchaseDescription(inv),
        amount,
        expenseCategory: classifyTt58S2bExpenseAccount('632'),
      });
      continue;
    }

    for (const d of details) {
      const amount = Number(d.amount || 0);
      if (amount <= 0 && !String(d.productName || '').trim()) continue;
      lines.push({
        docNo,
        docDate,
        description: buildPurchaseDescription(inv, d.productName),
        amount,
        expenseCategory: classifyTt58S2bExpenseAccount(String(d.account || '632')),
      });
    }
  }
  return lines;
};

const collectJournalLedgerLines = (
  entries: JournalEntry[],
  startDate: string,
  endDate: string,
  mode: 'revenue_other' | 'expense',
  skipInvoiceIds: Set<string>,
): LedgerLine[] => {
  const lines: LedgerLine[] = [];
  for (const entry of entries) {
    const date = String(entry.date || '').slice(0, 10);
    if (!date || !inPeriod(date, startDate, endDate)) continue;
    const docNo = String(entry.referenceId || entry.id || '').trim();
    const docDate = formatDocDate(date);
    const baseDesc = String(entry.description || '').trim();

    for (const d of journalEntryDetailsArray(entry)) {
      if (d.sourceInvoiceId && skipInvoiceIds.has(String(d.sourceInvoiceId))) continue;

      if (mode === 'revenue_other') {
        const credit = Number(d.credit || 0);
        if (credit <= 0) continue;
        if (!accountStartsWith(String(d.account), OTHER_INCOME_PREFIXES)) continue;
        lines.push({
          docNo,
          docDate,
          description: baseDesc || `Thu nhập TK ${d.account}`,
          amount: credit,
        });
        continue;
      }

      const debit = Number(d.debit || 0);
      if (debit <= 0) continue;
      if (!accountStartsWith(String(d.account), EXPENSE_ACCOUNT_PREFIXES)) continue;
      lines.push({
        docNo,
        docDate,
        description: baseDesc || `Chi phí TK ${d.account}`,
        amount: debit,
        expenseCategory: classifyTt58S2bExpenseAccount(String(d.account)),
      });
    }
  }
  return lines;
};

/** S2b-DNSN — sổ chi tiết doanh thu, chi phí và theo dõi TNDN. */
export function computeTt58S2bDnsnLedger(
  invoicesInput: Invoice[] | undefined | null,
  entriesInput: JournalEntry[] | undefined | null,
  financialYear: FinancialYear,
  regime?: AccountingRegimeConfig,
): Tt58S2bDnsnLedgerData {
  const invoices = asInvoices(invoicesInput);
  const entries = asEntries(entriesInput);
  const { startDate, endDate } = financialYear;
  const tax = computeTt58TaxSummary(entries, financialYear);

  const salesInvoiceIds = new Set(
    invoices.filter((i) => i.type === 'SALES').map((i) => String(i.id)),
  );
  const purchaseInvoiceIds = new Set(
    invoices.filter((i) => i.type === 'PURCHASE').map((i) => String(i.id)),
  );

  const revenueFromInvoices = collectTt58RevenueLinesFromInvoices(invoices, startDate, endDate, regime).map(
    (l) => ({
      docNo: l.docNo,
      docDate: l.docDate,
      description: l.description,
      amount: l.revenue,
    }),
  );
  const revenueFromJournal = collectJournalLedgerLines(
    entries,
    startDate,
    endDate,
    'revenue_other',
    salesInvoiceIds,
  );
  const revenueLines = [...revenueFromInvoices, ...revenueFromJournal];

  const expenseFromInvoices = collectPurchaseExpenseLines(invoices, startDate, endDate);
  const expenseFromJournal = collectJournalLedgerLines(
    entries,
    startDate,
    endDate,
    'expense',
    purchaseInvoiceIds,
  );
  const expenseLines = [...expenseFromInvoices, ...expenseFromJournal];

  const totalRevenue = revenueLines.reduce((s, l) => s + l.amount, 0);
  const totalExpense = expenseLines.reduce((s, l) => s + l.amount, 0);
  const taxableIncome = Math.max(0, totalRevenue - totalExpense);
  const citPayable = tax.citExpense;
  const closingCitPayable = tax.openingCitPayable + citPayable - tax.citPaid;

  const categoryTotals: Record<Tt58S2bExpenseCategory, number> = {
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    dd: 0,
    e: 0,
  };
  for (const line of expenseLines) {
    const cat = line.expenseCategory || 'e';
    categoryTotals[cat] += line.amount;
  }

  const rows: Tt58S2bDnsnLedgerRow[] = [
    {
      kind: 'opening_cit',
      description: 'Số thuế TNDN còn phải nộp đầu kỳ',
      amount: tax.openingCitPayable,
      bold: true,
    },
    { kind: 'period_header', description: 'Số phát sinh trong kỳ', bold: true },
    { kind: 'section_header', description: '1. Doanh thu và thu nhập', bold: true },
  ];

  if (revenueLines.length === 0) {
    rows.push({
      kind: 'detail',
      description: '(Chưa có hóa đơn/chứng từ doanh thu, thu nhập trong kỳ)',
    });
  } else {
    for (const line of revenueLines) {
      rows.push({
        kind: 'detail',
        docNo: line.docNo,
        docDate: line.docDate,
        description: line.description,
        amount: line.amount,
      });
    }
  }

  rows.push({
    kind: 'section_subtotal',
    description: 'Cộng doanh thu và thu nhập',
    amount: totalRevenue,
    bold: true,
  });

  rows.push({ kind: 'section_header', description: '2. Chi phí', bold: true });

  if (expenseLines.length === 0) {
    rows.push({
      kind: 'detail',
      description: '(Chưa có hóa đơn/chứng từ chi phí trong kỳ)',
    });
  } else {
    for (const line of expenseLines) {
      rows.push({
        kind: 'detail',
        docNo: line.docNo,
        docDate: line.docDate,
        description: line.description,
        amount: line.amount,
      });
    }
  }

  (['a', 'b', 'c', 'd', 'dd', 'e'] as Tt58S2bExpenseCategory[]).forEach((cat) => {
    if (categoryTotals[cat] > 0) {
      rows.push({
        kind: 'expense_category',
        description: TT58_S2B_EXPENSE_CATEGORY_LABELS[cat],
        amount: categoryTotals[cat],
      });
    }
  });

  rows.push({
    kind: 'section_subtotal',
    description: 'Cộng chi phí',
    amount: totalExpense,
    bold: true,
  });

  rows.push({
    kind: 'footer_cit_payable',
    description: 'Tổng số thuế TNDN phải nộp trong kỳ',
    amount: citPayable,
    bold: true,
  });
  rows.push({
    kind: 'footer_cit_paid',
    description: 'Số thuế TNDN đã nộp trong kỳ',
    amount: tax.citPaid,
    bold: true,
  });
  rows.push({
    kind: 'footer_cit_closing',
    description: 'Số thuế TNDN còn phải nộp cuối kỳ',
    amount: closingCitPayable,
    bold: true,
  });

  return {
    rows,
    openingCitPayable: tax.openingCitPayable,
    totalRevenue,
    totalExpense,
    taxableIncome,
    citPayable,
    citPaid: tax.citPaid,
    closingCitPayable,
  };
}

export function tt58S2bDnsnRowsToTable(
  data: Tt58S2bDnsnLedgerData,
  formatAmount: (value: number) => string,
): (string | number)[][] {
  return data.rows.map((row) => {
    if (row.kind === 'detail' && row.amount != null) {
      return [row.docNo || '', row.docDate || '', row.description, formatAmount(row.amount)];
    }
    if (row.kind === 'detail') {
      return [row.docNo || '', row.docDate || '', row.description, ''];
    }
    if (row.amount != null && Number.isFinite(row.amount)) {
      return ['', '', row.description, formatAmount(row.amount)];
    }
    return ['', '', row.description, ''];
  });
}
