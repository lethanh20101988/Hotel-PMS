import type {
  FinancialYear,
  FundTransaction,
  JournalEntry,
  JournalEntryDetail,
} from '../../types';

export type Tt58S4aLedgerRowKind =
  | 'section_header'
  | 'opening'
  | 'detail'
  | 'period_total'
  | 'closing';

export type Tt58S4aLedgerRow = {
  kind: Tt58S4aLedgerRowKind;
  docNo?: string;
  docDate?: string;
  description: string;
  receivable?: number;
  collected?: number;
  remainingReceivable?: number;
  payable?: number;
  paid?: number;
  remainingPayable?: number;
  bold?: boolean;
};

export type Tt58S4aPartnerSection = {
  sectionId: string;
  partnerLabel: string;
  rows: Tt58S4aLedgerRow[];
};

export type Tt58S4aDnsnLedgerData = {
  sections: Tt58S4aPartnerSection[];
  year: number;
};

/** TK phải thu (cột 1–3). */
const RECEIVABLE_PREFIXES = ['131', '141', '136', '128'];

/** TK phải trả (cột 4–6), gồm lương, vay, ký quỹ… */
const PAYABLE_PREFIXES = ['331', '334', '341', '338', '335', '336', '352', '353'];

/** Thuế phải nộp NN (không gồm GTGT 3331* và TNDN 3334). */
const TAX_PAYABLE_PREFIXES = ['3332', '3333', '3335', '3336', '3337', '3338', '33381', '33382', '3339'];

const EXCLUDED_TAX_PREFIXES = ['3331', '3334'];

const TAX_ACCOUNT_LABELS: Record<string, string> = {
  '3332': 'Thuế tiêu thụ đặc biệt',
  '3333': 'Thuế xuất khẩu, thuế nhập khẩu',
  '3335': 'Thuế thu nhập cá nhân',
  '3336': 'Thuế tài nguyên',
  '3337': 'Thuế bảo vệ môi trường',
  '3338': 'Thuế sử dụng đất',
  '33381': 'Thuế sử dụng đất (chi tiết)',
  '33382': 'Thuế khác (chi tiết)',
  '3339': 'Thuế khác',
};

const asEntries = (value: JournalEntry[] | undefined | null) => (Array.isArray(value) ? value : []);

const asFundTransactions = (value: FundTransaction[] | undefined | null) =>
  Array.isArray(value) ? value : [];

const inPeriod = (dateStr: string, startDate: string, endDate: string) =>
  dateStr >= startDate && dateStr <= endDate;

const formatDocDate = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
};

const matchesPrefix = (account: string, prefixes: string[]) =>
  prefixes.some((p) => {
    const acc = String(account || '').trim();
    return acc === p || acc.startsWith(p);
  });

const isExcludedTax = (account: string) => matchesPrefix(account, EXCLUDED_TAX_PREFIXES);

const classifyDebtSide = (account: string): 'receivable' | 'payable' | null => {
  const acc = String(account || '').trim();
  if (!acc || isExcludedTax(acc)) return null;
  if (matchesPrefix(acc, RECEIVABLE_PREFIXES)) return 'receivable';
  if (matchesPrefix(acc, PAYABLE_PREFIXES)) return 'payable';
  if (matchesPrefix(acc, TAX_PAYABLE_PREFIXES)) return 'payable';
  return null;
};

const taxPartnerLabel = (account: string): string => {
  const acc = String(account || '').trim();
  for (const prefix of TAX_PAYABLE_PREFIXES.sort((a, b) => b.length - a.length)) {
    if (acc === prefix || acc.startsWith(prefix)) {
      return TAX_ACCOUNT_LABELS[prefix] || `TK ${prefix}`;
    }
  }
  return `TK ${acc}`;
};

const partnerLabelFromDetail = (detail: JournalEntryDetail, entry: JournalEntry, account: string): string => {
  const name = String(detail.objectName || entry.description || '').trim();
  if (name) return name;
  const inv = String(detail.sourceInvoiceNumber || '').trim();
  if (inv) return `Hóa đơn ${inv}`;
  const side = classifyDebtSide(account);
  if (side === 'payable' && matchesPrefix(account, TAX_PAYABLE_PREFIXES)) {
    return taxPartnerLabel(account);
  }
  return side === 'receivable' ? 'Phải thu khác' : 'Phải trả khác';
};

type PartnerLedger = {
  sectionId: string;
  partnerLabel: string;
  side: 'receivable' | 'payable';
  openingReceivable: number;
  openingPayable: number;
  movements: Array<{
    date: string;
    sortKey: string;
    docNo: string;
    docDate: string;
    description: string;
    receivable?: number;
    collected?: number;
    payable?: number;
    paid?: number;
  }>;
};

const partnerKey = (side: 'receivable' | 'payable', label: string) =>
  `${side}::${String(label || '').trim().toLowerCase()}`;

const getOrCreatePartner = (map: Map<string, PartnerLedger>, side: 'receivable' | 'payable', label: string) => {
  const key = partnerKey(side, label);
  let row = map.get(key);
  if (!row) {
    row = {
      sectionId: key,
      partnerLabel: label,
      side,
      openingReceivable: 0,
      openingPayable: 0,
      movements: [],
    };
    map.set(key, row);
  }
  return row;
};

const applyDetailToPartner = (
  partner: PartnerLedger,
  detail: JournalEntryDetail,
  entry: JournalEntry,
  inPeriodFlag: boolean,
) => {
  const account = String(detail.account || '').trim();
  const side = classifyDebtSide(account);
  if (!side || side !== partner.side) return;

  if (String(detail.openingNote || '').includes('Bù tổng') && !String(detail.objectName || '').trim()) {
    return;
  }

  const debit = Math.round(Number(detail.debit || 0));
  const credit = Math.round(Number(detail.credit || 0));
  if (debit <= 0 && credit <= 0) return;

  const docNo = String(entry.referenceId || detail.sourceInvoiceNumber || entry.id || '').trim();
  const docDate = formatDocDate(entry.date);
  const description =
    String(detail.description || entry.description || '').trim() ||
    (side === 'receivable' ? 'Phát sinh phải thu' : 'Phát sinh phải trả');

  if (!inPeriodFlag) {
    if (side === 'receivable') {
      partner.openingReceivable += debit - credit;
    } else {
      partner.openingPayable += credit - debit;
    }
    return;
  }

  const movement = {
    date: String(entry.date || '').slice(0, 10),
    sortKey: String(entry.id || ''),
    docNo,
    docDate,
    description,
    receivable: side === 'receivable' && debit > 0 ? debit : undefined,
    collected: side === 'receivable' && credit > 0 ? credit : undefined,
    payable: side === 'payable' && credit > 0 ? credit : undefined,
    paid: side === 'payable' && debit > 0 ? debit : undefined,
  };

  const last = partner.movements[partner.movements.length - 1];
  if (
    last &&
    last.docNo === movement.docNo &&
    last.date === movement.date &&
    last.description === movement.description
  ) {
    last.receivable = (last.receivable || 0) + (movement.receivable || 0) || undefined;
    last.collected = (last.collected || 0) + (movement.collected || 0) || undefined;
    last.payable = (last.payable || 0) + (movement.payable || 0) || undefined;
    last.paid = (last.paid || 0) + (movement.paid || 0) || undefined;
    if (last.receivable === 0) last.receivable = undefined;
    if (last.collected === 0) last.collected = undefined;
    if (last.payable === 0) last.payable = undefined;
    if (last.paid === 0) last.paid = undefined;
    return;
  }

  partner.movements.push(movement);
};

const fundContraIsDebt = (account: string) => classifyDebtSide(account) != null;

/** Bổ sung thu/chi quỹ gắn TK công nợ khi chưa có bút toán tương ứng. */
const supplementFromFundTransactions = (
  map: Map<string, PartnerLedger>,
  fundTransactions: FundTransaction[],
  entries: JournalEntry[],
  startDate: string,
  endDate: string,
) => {
  const journalRefs = new Set<string>();
  for (const je of entries) {
    journalRefs.add(String(je.referenceId || '').trim());
    journalRefs.add(String(je.id || '').trim());
  }

  for (const ft of asFundTransactions(fundTransactions)) {
    if (String(ft.status || 'COMPLETED') !== 'COMPLETED') continue;
    const date = String(ft.date || '').slice(0, 10);
    if (!inPeriod(date, startDate, endDate)) continue;
    const contra = String(ft.accountingType || '').trim();
    if (!fundContraIsDebt(contra)) continue;
    const ref = String(ft.referenceDoc || ft.voucherNumber || ft.id || '').trim();
    if (ref && journalRefs.has(ref)) continue;

    const side = classifyDebtSide(contra);
    if (!side) continue;
    const label = String(ft.payerReceiver || '').trim() || (side === 'receivable' ? 'Phải thu khác' : 'Phải trả khác');
    const partner = getOrCreatePartner(map, side, label);
    const amount = Math.round(Number(ft.amount || 0));
    if (amount <= 0) continue;

    partner.movements.push({
      date,
      sortKey: `ft-${ft.id}`,
      docNo: String(ft.voucherNumber || ref).trim(),
      docDate: formatDocDate(date),
      description: String(ft.description || '').trim() || 'Thu chi quỹ tiền',
      receivable: side === 'receivable' && ft.type === 'PAYMENT' ? amount : undefined,
      collected: side === 'receivable' && ft.type === 'RECEIPT' ? amount : undefined,
      payable: side === 'payable' && ft.type === 'RECEIPT' ? amount : undefined,
      paid: side === 'payable' && ft.type === 'PAYMENT' ? amount : undefined,
    });
  }
};

const buildSectionRows = (partner: PartnerLedger): Tt58S4aLedgerRow[] => {
  const rows: Tt58S4aLedgerRow[] = [
    { kind: 'section_header', description: `Đối tượng: ${partner.partnerLabel}`, bold: true },
  ];

  let recvBal = Math.max(0, partner.openingReceivable);
  let payBal = Math.max(0, partner.openingPayable);

  rows.push({
    kind: 'opening',
    description: 'Số dư đầu kỳ',
    remainingReceivable: partner.side === 'receivable' ? recvBal : undefined,
    remainingPayable: partner.side === 'payable' ? payBal : undefined,
    bold: true,
  });

  let sumRecv = 0;
  let sumCollected = 0;
  let sumPayable = 0;
  let sumPaid = 0;

  const sorted = [...partner.movements].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.sortKey.localeCompare(b.sortKey);
  });

  for (const m of sorted) {
    const r1 = m.receivable || 0;
    const r2 = m.collected || 0;
    const r4 = m.payable || 0;
    const r5 = m.paid || 0;
    if (partner.side === 'receivable') {
      recvBal += r1 - r2;
      sumRecv += r1;
      sumCollected += r2;
    } else {
      payBal += r4 - r5;
      sumPayable += r4;
      sumPaid += r5;
    }

    rows.push({
      kind: 'detail',
      docNo: m.docNo,
      docDate: m.docDate,
      description: m.description,
      receivable: partner.side === 'receivable' ? m.receivable : undefined,
      collected: partner.side === 'receivable' ? m.collected : undefined,
      remainingReceivable: partner.side === 'receivable' ? Math.max(0, recvBal) : undefined,
      payable: partner.side === 'payable' ? m.payable : undefined,
      paid: partner.side === 'payable' ? m.paid : undefined,
      remainingPayable: partner.side === 'payable' ? Math.max(0, payBal) : undefined,
    });
  }

  rows.push({
    kind: 'period_total',
    description: 'Cộng phát sinh trong kỳ',
    receivable: partner.side === 'receivable' && sumRecv > 0 ? sumRecv : undefined,
    collected: partner.side === 'receivable' && sumCollected > 0 ? sumCollected : undefined,
    payable: partner.side === 'payable' && sumPayable > 0 ? sumPayable : undefined,
    paid: partner.side === 'payable' && sumPaid > 0 ? sumPaid : undefined,
    bold: true,
  });

  rows.push({
    kind: 'closing',
    description: 'Số dư cuối kỳ',
    remainingReceivable: partner.side === 'receivable' ? Math.max(0, recvBal) : undefined,
    remainingPayable: partner.side === 'payable' ? Math.max(0, payBal) : undefined,
    bold: true,
  });

  return rows;
};

export const computeTt58S4aDnsnLedger = (
  journalEntries: JournalEntry[] | undefined | null,
  fundTransactions: FundTransaction[] | undefined | null,
  financialYear: FinancialYear,
): Tt58S4aDnsnLedgerData => {
  const startDate = String(financialYear.startDate || '').slice(0, 10);
  const endDate = String(financialYear.endDate || '').slice(0, 10);
  const year = Number(startDate.slice(0, 4)) || new Date().getFullYear();
  const entries = asEntries(journalEntries);
  const partnerMap = new Map<string, PartnerLedger>();

  for (const entry of entries) {
    const date = String(entry.date || '').slice(0, 10);
    if (!date || date > endDate) continue;
    const inPeriodFlag = inPeriod(date, startDate, endDate);

    for (const detail of entry.details || []) {
      const account = String(detail.account || '').trim();
      const side = classifyDebtSide(account);
      if (!side) continue;
      const label = partnerLabelFromDetail(detail, entry, account);
      const partner = getOrCreatePartner(partnerMap, side, label);
      applyDetailToPartner(partner, detail, entry, inPeriodFlag);
    }
  }

  supplementFromFundTransactions(partnerMap, fundTransactions || [], entries, startDate, endDate);

  const sections: Tt58S4aPartnerSection[] = [...partnerMap.values()]
    .filter(
      (p) =>
        p.openingReceivable !== 0 ||
        p.openingPayable !== 0 ||
        p.movements.length > 0,
    )
    .sort((a, b) => {
      if (a.side !== b.side) return a.side === 'receivable' ? -1 : 1;
      return a.partnerLabel.localeCompare(b.partnerLabel, 'vi');
    })
    .map((p) => ({
      sectionId: p.sectionId,
      partnerLabel: p.partnerLabel,
      rows: buildSectionRows(p),
    }));

  if (sections.length === 0) {
    sections.push({
      sectionId: 'empty',
      partnerLabel: '',
      rows: [
        {
          kind: 'section_header',
          description: 'Chưa có phát sinh công nợ phải thu, phải trả trong kỳ.',
          bold: false,
        },
      ],
    });
  }

  return { sections, year };
};

export const TT58_S4A_HEADERS = [
  'Số hiệu',
  'Ngày, tháng',
  'Diễn giải',
  'Phải thu',
  'Đã thu',
  'Còn phải thu',
  'Phải trả',
  'Đã trả',
  'Còn phải trả',
];

export function tt58S4aRowsToTable(
  data: Tt58S4aDnsnLedgerData,
  formatAmount: (value: number) => string,
): (string | number)[][] {
  const fmtOpt = (v?: number) => (v != null && v > 0 ? formatAmount(v) : '');

  const toRow = (row: Tt58S4aLedgerRow): (string | number)[] => {
    if (row.kind === 'detail') {
      return [
        row.docNo || '',
        row.docDate || '',
        row.description,
        fmtOpt(row.receivable),
        fmtOpt(row.collected),
        fmtOpt(row.remainingReceivable),
        fmtOpt(row.payable),
        fmtOpt(row.paid),
        fmtOpt(row.remainingPayable),
      ];
    }
    return [
      '',
      '',
      row.description,
      fmtOpt(row.receivable),
      fmtOpt(row.collected),
      fmtOpt(row.remainingReceivable),
      fmtOpt(row.payable),
      fmtOpt(row.paid),
      fmtOpt(row.remainingPayable),
    ];
  };

  const out: (string | number)[][] = [];
  for (const section of data.sections) {
    out.push(...section.rows.map(toRow));
  }
  return out;
}
