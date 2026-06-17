import type { FinancialYear, Invoice, JournalEntry, JournalEntryDetail } from '../../types';
import { journalEntryDetailsArray } from '../../utils/journalEntryDetails';

export type Tt58S4cTaxSectionId =
  | 'xnk_excise'
  | 'environment'
  | 'resource'
  | 'land'
  | 'other'
  | 'grand';

export type Tt58S4cDnsnRowKind = 'section_header' | 'detail' | 'section_subtotal' | 'grand_total' | 'empty';

export type Tt58S4cDnsnLedgerRow = {
  kind: Tt58S4cDnsnRowKind;
  docDate?: string;
  description: string;
  taxableQuantity?: number;
  absoluteRate?: number;
  taxBase?: number;
  taxRatePercent?: number;
  taxByPercent?: number;
  taxByAbsolute?: number;
  taxXnkExcisePayable?: number;
  taxEnvironmentPayable?: number;
  taxResourcePayable?: number;
  taxLandPayable?: number;
  taxOtherPayable?: number;
  bold?: boolean;
};

export type Tt58S4cDnsnSection = {
  sectionId: Tt58S4cTaxSectionId;
  title: string;
  rows: Tt58S4cDnsnLedgerRow[];
};

export type Tt58S4cDnsnLedgerData = {
  sections: Tt58S4cDnsnSection[];
  year: number;
};

/** Tiêu đề đầy đủ — dùng cho xuất Excel. */
export const TT58_S4C_HEADERS = [
  'Ngày, tháng ghi sổ (A)',
  'Nội dung nghiệp vụ (B)',
  'Lượng HHDV chịu thuế (1)',
  'Mức thuế tuyệt đối (2)',
  'Giá tính thuế/đơn vị (3)',
  'Thuế suất % (4)',
  'Thuế XNK/NK/TTĐB theo % (5)',
  'Thuế XNK/NK/TTĐB tuyệt đối (6)',
  'Thuế XNK/NK/TTĐB phải nộp (7)',
  'Thuế BVMT phải nộp (8)',
  'Thuế tài nguyên phải nộp (9)',
  'Thuế sử dụng đất phải nộp (10)',
  'Thuế khác phải nộp (11)',
];

/** Tiêu đề 2 dòng trên màn hình — tránh tràn cột 5–7. */
export const TT58_S4C_HEADER_DISPLAY: { label: string; code: string; printLabel?: string }[] = [
  { label: 'Ngày, tháng ghi sổ', code: 'A', printLabel: 'Ngày ghi sổ' },
  { label: 'Nội dung nghiệp vụ', code: 'B', printLabel: 'Nội dung' },
  { label: 'Lượng HHDV chịu thuế', code: '1', printLabel: 'Lượng' },
  { label: 'Mức thuế tuyệt đối', code: '2', printLabel: 'Thuế TTĐ' },
  { label: 'Giá tính thuế/đơn vị', code: '3', printLabel: 'Giá tính thuế' },
  { label: 'Thuế suất', code: '4', printLabel: 'Thuế suất' },
  { label: 'Thuế XNK/NK/TTĐB theo %', code: '5', printLabel: 'XNK/TTĐB %' },
  { label: 'Thuế XNK/NK/TTĐB tuyệt đối', code: '6', printLabel: 'XNK/TTĐB TTĐ' },
  { label: 'Thuế XNK/NK/TTĐB phải nộp', code: '7', printLabel: 'XNK/TTĐB PN' },
  { label: 'Thuế BVMT phải nộp', code: '8', printLabel: 'Thuế BVMT' },
  { label: 'Thuế tài nguyên phải nộp', code: '9', printLabel: 'Tài nguyên' },
  { label: 'Thuế sử dụng đất phải nộp', code: '10', printLabel: 'Sử dụng đất' },
  { label: 'Thuế khác phải nộp', code: '11', printLabel: 'Thuế khác' },
];

/** Độ rộng cột (table-layout: fixed). */
export const TT58_S4C_COL_WIDTHS = [
  '4.75rem',
  '11.5rem',
  '4.25rem',
  '4.25rem',
  '4.5rem',
  '3.25rem',
  '5.25rem',
  '5.25rem',
  '5.25rem',
  '4.75rem',
  '4.75rem',
  '5rem',
  '4.5rem',
] as const;

/** TK thuế khác theo S4c (không gồm GTGT 3331*, TNDN 3334). */
const S4C_TAX_PREFIXES = [
  '33382',
  '33381',
  '3332',
  '3333',
  '3335',
  '3336',
  '3337',
  '3338',
  '3339',
] as const;

const EXCLUDED_PREFIXES = ['3331', '3334', '33311', '33312'];

const EXPENSE_BASE_PREFIXES = ['632', '641', '642', '156', '152', '151', '154', '811', '623', '627', '635'];

const SECTION_ORDER: Tt58S4cTaxSectionId[] = [
  'xnk_excise',
  'environment',
  'resource',
  'land',
  'other',
];

const SECTION_TITLES: Record<Tt58S4cTaxSectionId, string> = {
  xnk_excise: '1. Thuế xuất khẩu, thuế nhập khẩu, thuế tiêu thụ đặc biệt',
  environment: '2. Thuế bảo vệ môi trường',
  resource: '3. Thuế tài nguyên',
  land: '4. Thuế sử dụng đất',
  other: '5. Thuế khác',
};

const asEntries = (entries: JournalEntry[] | undefined | null) => (Array.isArray(entries) ? entries : []);
const asInvoices = (invoices: Invoice[] | undefined | null) => (Array.isArray(invoices) ? invoices : []);

const inPeriod = (dateStr: string, startDate: string, endDate: string) =>
  dateStr >= startDate && dateStr <= endDate;

const formatDocDate = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
};

const matchesPrefix = (account: string, prefixes: readonly string[]) => {
  const acc = String(account || '').trim();
  return prefixes.some((p) => acc === p || acc.startsWith(p));
};

const isExcludedTaxAccount = (account: string) => matchesPrefix(account, EXCLUDED_PREFIXES);

const resolveTaxSection = (account: string): Tt58S4cTaxSectionId | null => {
  const acc = String(account || '').trim();
  if (!acc || isExcludedTaxAccount(acc)) return null;
  if (acc.startsWith('3332') || acc.startsWith('3333')) return 'xnk_excise';
  if (acc.startsWith('33381') || acc.startsWith('3337')) return 'environment';
  if (acc.startsWith('3336')) return 'resource';
  if (acc.startsWith('3338')) return 'land';
  if (acc.startsWith('3335') || acc.startsWith('3339') || acc.startsWith('33382')) return 'other';
  if (matchesPrefix(acc, S4C_TAX_PREFIXES)) return 'other';
  return null;
};

const taxCreditOnDetail = (detail: JournalEntryDetail) => {
  const acc = String(detail.account || '').trim();
  if (!resolveTaxSection(acc)) return 0;
  return Math.round(Number(detail.credit || 0));
};

const expenseBaseInEntry = (entry: JournalEntry) =>
  journalEntryDetailsArray(entry).reduce((sum, d) => {
    const acc = String(d.account || '').trim();
    if (!matchesPrefix(acc, EXPENSE_BASE_PREFIXES)) return sum;
    return sum + Math.round(Number(d.debit || 0));
  }, 0);

const invoiceById = (invoices: Invoice[]) => {
  const map = new Map<string, Invoice>();
  for (const inv of invoices) {
    map.set(String(inv.id || ''), inv);
  }
  return map;
};

const resolveQuantityFromEntry = (entry: JournalEntry, invMap: Map<string, Invoice>): number | undefined => {
  for (const d of journalEntryDetailsArray(entry)) {
    const invId = String(d.sourceInvoiceId || '').trim();
    if (invId && invMap.has(invId)) {
      const inv = invMap.get(invId)!;
      const details = Array.isArray(inv.details) ? inv.details : [];
      if (details.length > 0) {
        const qty = details.reduce((s, line) => s + Number(line.quantity || 0), 0);
        if (qty > 0) return qty;
      }
      const q = Number(inv.quantity || 0);
      if (q > 0) return q;
    }
  }
  return undefined;
};

const buildDescription = (entry: JournalEntry, detail: JournalEntryDetail, account: string) => {
  const taxLabel = taxAccountLabel(account);
  const base = String(detail.objectName || entry.description || '').trim();
  const invNo = String(detail.sourceInvoiceNumber || entry.referenceId || '').trim();
  const parts = [base || taxLabel, invNo ? `CT: ${invNo}` : undefined].filter(Boolean);
  return parts.join(' — ') || taxLabel;
};

const taxAccountLabel = (account: string): string => {
  const acc = String(account || '').trim();
  if (acc.startsWith('3332')) return 'Thuế tiêu thụ đặc biệt';
  if (acc.startsWith('3333')) return 'Thuế xuất khẩu, thuế nhập khẩu';
  if (acc.startsWith('3336')) return 'Thuế tài nguyên';
  if (acc.startsWith('3337') || acc.startsWith('33381')) return 'Thuế bảo vệ môi trường';
  if (acc.startsWith('3338')) return 'Thuế sử dụng đất';
  if (acc.startsWith('3335')) return 'Thuế thu nhập cá nhân';
  if (acc.startsWith('3339') || acc.startsWith('33382')) return 'Thuế khác';
  return `TK ${acc}`;
};

type ParsedTaxLine = {
  date: string;
  sortKey: string;
  docDate: string;
  description: string;
  sectionId: Tt58S4cTaxSectionId;
  taxAmount: number;
  taxBase?: number;
  taxableQuantity?: number;
  taxRatePercent?: number;
  taxByPercent?: number;
  taxByAbsolute?: number;
};

const assignPayableColumns = (
  sectionId: Tt58S4cTaxSectionId,
  taxAmount: number,
  taxByPercent?: number,
  taxByAbsolute?: number,
): Pick<
  Tt58S4cDnsnLedgerRow,
  | 'taxXnkExcisePayable'
  | 'taxEnvironmentPayable'
  | 'taxResourcePayable'
  | 'taxLandPayable'
  | 'taxOtherPayable'
  | 'taxByPercent'
  | 'taxByAbsolute'
> => {
  const row: Tt58S4cDnsnLedgerRow = {
    kind: 'detail',
    description: '',
    taxByPercent,
    taxByAbsolute,
  };
  switch (sectionId) {
    case 'xnk_excise':
      row.taxXnkExcisePayable = taxAmount;
      break;
    case 'environment':
      row.taxEnvironmentPayable = taxAmount;
      break;
    case 'resource':
      row.taxResourcePayable = taxAmount;
      break;
    case 'land':
      row.taxLandPayable = taxAmount;
      break;
    default:
      row.taxOtherPayable = taxAmount;
  }
  return row;
};

const collectTaxLines = (
  entries: JournalEntry[],
  startDate: string,
  endDate: string,
  invMap: Map<string, Invoice>,
): ParsedTaxLine[] => {
  const lines: ParsedTaxLine[] = [];

  for (const entry of entries) {
    const date = String(entry.date || '').slice(0, 10);
    if (!inPeriod(date, startDate, endDate)) continue;

    const taxBase = expenseBaseInEntry(entry);
    const qty = resolveQuantityFromEntry(entry, invMap);

    for (const detail of journalEntryDetailsArray(entry)) {
      const credit = taxCreditOnDetail(detail);
      if (credit <= 0) continue;

      const account = String(detail.account || '').trim();
      const sectionId = resolveTaxSection(account);
      if (!sectionId) continue;

      const taxRatePercent =
        taxBase > 0 ? Math.round((credit / taxBase) * 10000) / 100 : undefined;
      const usePercent = taxRatePercent != null && taxRatePercent > 0 && taxRatePercent <= 100;

      lines.push({
        date,
        sortKey: `${String(entry.id || '')}:${account}`,
        docDate: formatDocDate(date),
        description: buildDescription(entry, detail, account),
        sectionId,
        taxAmount: credit,
        taxBase: taxBase > 0 ? taxBase : undefined,
        taxableQuantity: qty,
        taxRatePercent: usePercent ? taxRatePercent : undefined,
        taxByPercent: usePercent ? credit : undefined,
        taxByAbsolute: usePercent ? undefined : undefined,
      });
    }
  }

  lines.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.sortKey.localeCompare(b.sortKey);
  });

  return lines;
};

const sumRowAmounts = (rows: Tt58S4cDnsnLedgerRow[]) => {
  const init = {
    taxableQuantity: 0,
    taxBase: 0,
    taxByPercent: 0,
    taxByAbsolute: 0,
    taxXnkExcisePayable: 0,
    taxEnvironmentPayable: 0,
    taxResourcePayable: 0,
    taxLandPayable: 0,
    taxOtherPayable: 0,
  };
  for (const r of rows) {
    if (r.kind !== 'detail') continue;
    init.taxableQuantity += Number(r.taxableQuantity || 0);
    init.taxBase += Number(r.taxBase || 0);
    init.taxByPercent += Number(r.taxByPercent || 0);
    init.taxByAbsolute += Number(r.taxByAbsolute || 0);
    init.taxXnkExcisePayable += Number(r.taxXnkExcisePayable || 0);
    init.taxEnvironmentPayable += Number(r.taxEnvironmentPayable || 0);
    init.taxResourcePayable += Number(r.taxResourcePayable || 0);
    init.taxLandPayable += Number(r.taxLandPayable || 0);
    init.taxOtherPayable += Number(r.taxOtherPayable || 0);
  }
  return init;
};

export function computeTt58S4cDnsnLedger(
  entriesInput: JournalEntry[],
  financialYear: FinancialYear,
  invoicesInput?: Invoice[],
): Tt58S4cDnsnLedgerData {
  const entries = asEntries(entriesInput);
  const invMap = invoiceById(asInvoices(invoicesInput));
  const year = Number(String(financialYear.startDate || '').slice(0, 4)) || new Date().getFullYear();
  const parsed = collectTaxLines(entries, financialYear.startDate, financialYear.endDate, invMap);

  const bySection = new Map<Tt58S4cTaxSectionId, Tt58S4cDnsnLedgerRow[]>();
  for (const id of SECTION_ORDER) bySection.set(id, []);

  for (const line of parsed) {
    const cols = assignPayableColumns(
      line.sectionId,
      line.taxAmount,
      line.taxByPercent,
      line.taxByAbsolute,
    );
    bySection.get(line.sectionId)!.push({
      kind: 'detail',
      docDate: line.docDate,
      description: line.description,
      taxableQuantity: line.taxableQuantity,
      taxBase: line.taxBase,
      taxRatePercent: line.taxRatePercent,
      ...cols,
    });
  }

  const sections: Tt58S4cDnsnSection[] = [];
  const grandDetailRows: Tt58S4cDnsnLedgerRow[] = [];

  for (const sectionId of SECTION_ORDER) {
    const details = bySection.get(sectionId) || [];
    if (details.length === 0) continue;

    const sub = sumRowAmounts(details);
    const sectionRows: Tt58S4cDnsnLedgerRow[] = [
      { kind: 'section_header', description: SECTION_TITLES[sectionId], bold: true },
      ...details,
      {
        kind: 'section_subtotal',
        description: `Cộng — ${SECTION_TITLES[sectionId]}`,
        taxableQuantity: sub.taxableQuantity || undefined,
        taxBase: sub.taxBase || undefined,
        taxByPercent: sub.taxByPercent || undefined,
        taxByAbsolute: sub.taxByAbsolute || undefined,
        taxXnkExcisePayable: sub.taxXnkExcisePayable || undefined,
        taxEnvironmentPayable: sub.taxEnvironmentPayable || undefined,
        taxResourcePayable: sub.taxResourcePayable || undefined,
        taxLandPayable: sub.taxLandPayable || undefined,
        taxOtherPayable: sub.taxOtherPayable || undefined,
        bold: true,
      },
    ];

    sections.push({ sectionId, title: SECTION_TITLES[sectionId], rows: sectionRows });
    grandDetailRows.push(...details);
  }

  if (sections.length === 0) {
    sections.push({
      sectionId: 'other',
      title: '',
      rows: [
        {
          kind: 'empty',
          description: 'Không có phát sinh nghĩa vụ thuế khác trong kỳ (TK 3332, 3333, 3336–3339…)',
        },
      ],
    });
  } else {
    const grand = sumRowAmounts(grandDetailRows);
    sections.push({
      sectionId: 'grand',
      title: '',
      rows: [
        {
          kind: 'grand_total',
          description: 'Tổng cộng',
          taxableQuantity: grand.taxableQuantity || undefined,
          taxBase: grand.taxBase || undefined,
          taxByPercent: grand.taxByPercent || undefined,
          taxByAbsolute: grand.taxByAbsolute || undefined,
          taxXnkExcisePayable: grand.taxXnkExcisePayable || undefined,
          taxEnvironmentPayable: grand.taxEnvironmentPayable || undefined,
          taxResourcePayable: grand.taxResourcePayable || undefined,
          taxLandPayable: grand.taxLandPayable || undefined,
          taxOtherPayable: grand.taxOtherPayable || undefined,
          bold: true,
        },
      ],
    });
  }

  return { sections, year };
}

const formatQty = (value: number | undefined) => {
  if (value == null || value <= 0) return '';
  return String(value);
};

const formatRate = (value: number | undefined) => {
  if (value == null || value <= 0) return '';
  return `${value}%`;
};

export function tt58S4cRowsToTable(
  data: Tt58S4cDnsnLedgerData,
  formatAmount: (value: number | undefined) => string,
): string[][] {
  const rows: string[][] = [];
  for (const section of data.sections) {
    for (const row of section.rows) {
      rows.push([
        row.docDate || '',
        row.description,
        formatQty(row.taxableQuantity),
        row.absoluteRate != null && row.absoluteRate > 0 ? formatAmount(row.absoluteRate) : '',
        row.taxBase != null && row.taxBase > 0 ? formatAmount(row.taxBase) : '',
        formatRate(row.taxRatePercent),
        row.taxByPercent != null && row.taxByPercent > 0 ? formatAmount(row.taxByPercent) : '',
        row.taxByAbsolute != null && row.taxByAbsolute > 0 ? formatAmount(row.taxByAbsolute) : '',
        row.taxXnkExcisePayable != null && row.taxXnkExcisePayable > 0
          ? formatAmount(row.taxXnkExcisePayable)
          : '',
        row.taxEnvironmentPayable != null && row.taxEnvironmentPayable > 0
          ? formatAmount(row.taxEnvironmentPayable)
          : '',
        row.taxResourcePayable != null && row.taxResourcePayable > 0
          ? formatAmount(row.taxResourcePayable)
          : '',
        row.taxLandPayable != null && row.taxLandPayable > 0 ? formatAmount(row.taxLandPayable) : '',
        row.taxOtherPayable != null && row.taxOtherPayable > 0 ? formatAmount(row.taxOtherPayable) : '',
      ]);
    }
  }
  return rows;
}
