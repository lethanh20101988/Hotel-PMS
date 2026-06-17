import type { FinancialYear, JournalEntry, JournalEntryDetail } from '../../types';
import { journalEntryDetailsArray } from '../../utils/journalEntryDetails';

export type Tt58S4dLedgerRowKind =
  | 'section_header'
  | 'opening'
  | 'detail'
  | 'period_total'
  | 'closing';

export type Tt58S4dLedgerRow = {
  kind: Tt58S4dLedgerRowKind;
  docNo?: string;
  docDate?: string;
  description: string;
  increase?: number;
  decrease?: number;
  balance?: number;
  bold?: boolean;
};

export type Tt58S4dEquitySection = {
  sectionId: string;
  sectionLabel: string;
  rows: Tt58S4dLedgerRow[];
};

export type Tt58S4dDnsnLedgerData = {
  sections: Tt58S4dEquitySection[];
  year: number;
};

export const TT58_S4D_HEADERS = [
  'Số hiệu',
  'Ngày, tháng',
  'Diễn giải',
  'Tăng trong kỳ',
  'Giảm trong kỳ',
  'Số dư',
];

type EquitySectionDef = {
  id: string;
  label: string;
  prefixes: string[];
  /** TK 419 — Có giảm vốn; 421 — chỉ hiển thị phần lãi tích lũy (Có). */
  mode: 'credit_equity' | 'contra_419' | 'retained_421';
};

const EQUITY_SECTIONS: EquitySectionDef[] = [
  {
    id: 'capital',
    label: '1. Vốn góp của chủ sở hữu',
    prefixes: ['411', '412', '413', '418', '419'],
    mode: 'credit_equity',
  },
  {
    id: 'retained',
    label: '2. Lợi nhuận sau thuế chưa phân phối',
    prefixes: ['421'],
    mode: 'retained_421',
  },
  {
    id: 'funds',
    label: '3. Các quỹ thuộc vốn chủ sở hữu',
    prefixes: ['353', '356'],
    mode: 'credit_equity',
  },
];

const ACCOUNT_LABELS: Record<string, string> = {
  '4111': 'Vốn đầu tư của chủ sở hữu',
  '4112': 'Thặng dư vốn cổ phần',
  '4118': 'Vốn khác',
  '413': 'Chênh lệch tỷ giá hối đoái',
  '418': 'Các quỹ thuộc vốn chủ sở hữu',
  '419': 'Cổ phiếu quỹ',
  '421': 'Lợi nhuận sau thuế chưa phân phối',
  '4211': 'LNST chưa phân phối năm trước',
  '4212': 'LNST chưa phân phối năm nay',
  '353': 'Quỹ khen thưởng, phúc lợi',
  '3531': 'Quỹ khen thưởng',
  '3532': 'Quỹ phúc lợi',
  '356': 'Quỹ phát triển KH&Công nghệ',
  '3561': 'Quỹ phát triển KH&Công nghệ',
};

const asEntries = (value: JournalEntry[] | undefined | null) => (Array.isArray(value) ? value : []);

const inPeriod = (dateStr: string, startDate: string, endDate: string) =>
  dateStr >= startDate && dateStr <= endDate;

const formatDocDate = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
};

const previousDay = (dateStr: string) => {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
};

const accountMode = (account: string, section: EquitySectionDef): EquitySectionDef['mode'] => {
  if (account.startsWith('419')) return 'contra_419';
  if (section.mode === 'retained_421') return 'retained_421';
  return 'credit_equity';
};

const matchesSection = (account: string, section: EquitySectionDef): boolean => {
  const acc = String(account || '').trim();
  if (!acc) return false;
  return section.prefixes.some((p) => acc === p || acc.startsWith(p));
};

const resolveAccountLabel = (account: string): string => {
  const acc = String(account || '').trim();
  for (const key of Object.keys(ACCOUNT_LABELS).sort((a, b) => b.length - a.length)) {
    if (acc === key || acc.startsWith(key)) return ACCOUNT_LABELS[key] || `TK ${acc}`;
  }
  return `TK ${acc}`;
};

const netForPrefixes = (entries: JournalEntry[], endDate: string, prefixes: string[]): number => {
  let net = 0;
  for (const entry of entries) {
    if (String(entry.date || '') > endDate) continue;
    for (const d of journalEntryDetailsArray(entry)) {
      const acc = String(d.account || '').trim();
      if (!prefixes.some((p) => acc === p || acc.startsWith(p))) continue;
      net += Number(d.debit || 0) - Number(d.credit || 0);
    }
  }
  return net;
};

/** Số dư vốn CSH hiển thị (dương = tăng vốn). */
const equityBalanceAmount = (net: number, mode: EquitySectionDef['mode']): number => {
  if (mode === 'contra_419') {
    return net > 0 ? Math.max(0, net) : 0;
  }
  if (mode === 'retained_421') {
    return net < 0 ? Math.abs(net) : 0;
  }
  return net < 0 ? Math.abs(net) : 0;
};

const splitMovement = (
  detail: JournalEntryDetail,
  account: string,
  section: EquitySectionDef,
): { increase: number; decrease: number } => {
  const mode = accountMode(account, section);
  const debit = Math.round(Number(detail.debit || 0));
  const credit = Math.round(Number(detail.credit || 0));
  if (mode === 'contra_419') {
    return { increase: debit, decrease: credit };
  }
  return { increase: credit, decrease: debit };
};

const sectionBalanceAt = (
  entries: JournalEntry[],
  endDate: string,
  section: EquitySectionDef,
): number => {
  if (section.id === 'capital') {
    const netCapital = netForPrefixes(entries, endDate, ['411', '412', '413', '418']);
    const net419 = netForPrefixes(entries, endDate, ['419']);
    return (
      equityBalanceAmount(netCapital, 'credit_equity') -
      equityBalanceAmount(net419, 'contra_419')
    );
  }
  const net = netForPrefixes(entries, endDate, section.prefixes);
  return equityBalanceAmount(net, section.mode);
};

type PeriodMovement = {
  date: string;
  sortKey: string;
  docNo: string;
  docDate: string;
  description: string;
  increase: number;
  decrease: number;
};

const collectPeriodMovements = (
  entries: JournalEntry[],
  section: EquitySectionDef,
  startDate: string,
  endDate: string,
): PeriodMovement[] => {
  const movements: PeriodMovement[] = [];

  for (const entry of entries) {
    const date = String(entry.date || '').slice(0, 10);
    if (!inPeriod(date, startDate, endDate)) continue;
    for (const detail of journalEntryDetailsArray(entry)) {
      const account = String(detail.account || '').trim();
      if (!matchesSection(account, section)) continue;
      const { increase, decrease } = splitMovement(detail, account, section);
      if (increase <= 0 && decrease <= 0) continue;
      const accLabel = resolveAccountLabel(account);
      const desc =
        String(detail.description || entry.description || '').trim() ||
        `Phát sinh ${accLabel}`;
      movements.push({
        date,
        sortKey: `${entry.id}-${account}-${movements.length}`,
        docNo: String(entry.referenceId || entry.id || '').trim(),
        docDate: formatDocDate(date),
        description: `${accLabel} — ${desc}`,
        increase,
        decrease,
      });
    }
  }

  return movements.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.sortKey.localeCompare(b.sortKey);
  });
};

const buildSectionRows = (
  section: EquitySectionDef,
  entries: JournalEntry[],
  startDate: string,
  endDate: string,
): Tt58S4dLedgerRow[] => {
  const openingCutoff = previousDay(startDate);
  let balance = sectionBalanceAt(entries, openingCutoff, section);

  const rows: Tt58S4dLedgerRow[] = [
    { kind: 'section_header', description: section.label, bold: true },
    {
      kind: 'opening',
      description: 'Số dư đầu kỳ',
      balance,
      bold: true,
    },
  ];

  let sumInc = 0;
  let sumDec = 0;
  const movements = collectPeriodMovements(entries, section, startDate, endDate);

  for (const m of movements) {
    balance += m.increase - m.decrease;
    sumInc += m.increase;
    sumDec += m.decrease;
    rows.push({
      kind: 'detail',
      docNo: m.docNo,
      docDate: m.docDate,
      description: m.description,
      increase: m.increase > 0 ? m.increase : undefined,
      decrease: m.decrease > 0 ? m.decrease : undefined,
      balance,
    });
  }

  if (movements.length > 0) {
    rows.push({
      kind: 'period_total',
      description: 'Cộng phát sinh trong kỳ',
      increase: sumInc > 0 ? sumInc : undefined,
      decrease: sumDec > 0 ? sumDec : undefined,
      bold: true,
    });
  }

  const closingBalance = sectionBalanceAt(entries, endDate, section);
  rows.push({
    kind: 'closing',
    description: 'Số dư cuối kỳ',
    balance: closingBalance,
    bold: true,
  });

  return rows;
};

const sectionHasActivity = (
  section: EquitySectionDef,
  entries: JournalEntry[],
  startDate: string,
  endDate: string,
): boolean => {
  const opening = sectionBalanceAt(entries, previousDay(startDate), section);
  const closing = sectionBalanceAt(entries, endDate, section);
  if (opening > 0 || closing > 0) return true;
  return collectPeriodMovements(entries, section, startDate, endDate).length > 0;
};

export const computeTt58S4dDnsnLedger = (
  journalEntries: JournalEntry[] | undefined | null,
  financialYear: FinancialYear,
): Tt58S4dDnsnLedgerData => {
  const startDate = String(financialYear.startDate || '').slice(0, 10);
  const endDate = String(financialYear.endDate || '').slice(0, 10);
  const year = Number(startDate.slice(0, 4)) || new Date().getFullYear();
  const entries = asEntries(journalEntries);

  const sections: Tt58S4dEquitySection[] = [];

  for (const section of EQUITY_SECTIONS) {
    if (!sectionHasActivity(section, entries, startDate, endDate)) continue;
    sections.push({
      sectionId: section.id,
      sectionLabel: section.label,
      rows: buildSectionRows(section, entries, startDate, endDate),
    });
  }

  if (sections.length === 0) {
    sections.push({
      sectionId: 'empty',
      sectionLabel: '',
      rows: [
        {
          kind: 'section_header',
          description:
            'Chưa có phát sinh vốn chủ sở hữu (411, 421, quỹ…) trong kỳ hoặc số dư đầu kỳ.',
          bold: false,
        },
      ],
    });
  }

  return { sections, year };
};

export function tt58S4dRowsToTable(
  data: Tt58S4dDnsnLedgerData,
  formatAmount: (value: number) => string,
): (string | number)[][] {
  const fmtOpt = (v?: number) => (v != null && v > 0 ? formatAmount(v) : '');

  const toRow = (row: Tt58S4dLedgerRow): (string | number)[] => [
    row.docNo || '',
    row.docDate || '',
    row.description,
    fmtOpt(row.increase),
    fmtOpt(row.decrease),
    row.balance != null && row.balance >= 0 ? formatAmount(row.balance) : '',
  ];

  const out: (string | number)[][] = [];
  for (const section of data.sections) {
    out.push(...section.rows.map(toRow));
  }
  return out;
}
