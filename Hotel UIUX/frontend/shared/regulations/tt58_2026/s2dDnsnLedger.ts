import type {
  BankAccount,
  FinancialYear,
  FundTransaction,
  OpeningBalanceAccountRecord,
} from '../../types';

export type Tt58S2dLedgerRowKind =
  | 'section_header'
  | 'subsection_header'
  | 'placeholder'
  | 'opening'
  | 'detail'
  | 'total_receipt'
  | 'total_payment'
  | 'closing';

/** Dòng chấm điền tên ngân hàng / chứng từ trên mẫu S2d-DNSN. */
const TT58_S2D_FILLER_LINE = '..............................';

const MIN_DETAIL_PLACEHOLDER_ROWS = 2;

export type Tt58S2dLedgerRow = {
  kind: Tt58S2dLedgerRowKind;
  docNo?: string;
  docDate?: string;
  description: string;
  receipt?: number;
  payment?: number;
  balance?: number;
  bold?: boolean;
};

export type Tt58S2dMoneySection = {
  sectionId: string;
  title: string;
  rows: Tt58S2dLedgerRow[];
  openingBalance: number;
  totalReceipt: number;
  totalPayment: number;
  closingBalance: number;
};

export type Tt58S2dDnsnLedgerData = {
  cash: Tt58S2dMoneySection;
  /** Dòng tiêu đề «Tiền gửi không kỳ hạn» (theo mẫu S2d-DNSN). */
  bankDepositHeader?: Tt58S2dLedgerRow;
  banks: Tt58S2dMoneySection[];
  year: number;
};

export const TT58_S2D_HEADERS = [
  'Số hiệu (A)',
  'Ngày tháng (B)',
  'Diễn giải (C)',
  'Thu/Gửi vào (1)',
  'Chi/Rút ra (2)',
];

export const TT58_S2D_HEADER_DISPLAY: { label: string; code: string }[] = [
  { label: 'Số hiệu', code: 'A' },
  { label: 'Ngày tháng', code: 'B' },
  { label: 'Diễn giải', code: 'C' },
  { label: 'Thu/Gửi vào', code: '1' },
  { label: 'Chi/Rút ra', code: '2' },
];

const asFundTransactions = (value: FundTransaction[] | undefined | null) =>
  Array.isArray(value) ? value : [];

const asBankAccounts = (value: BankAccount[] | undefined | null) => Array.isArray(value) ? value : [];

const asOpeningAccounts = (value: OpeningBalanceAccountRecord[] | undefined | null) =>
  Array.isArray(value) ? value : [];

const inPeriod = (dateStr: string, startDate: string, endDate: string) =>
  dateStr >= startDate && dateStr <= endDate;

const formatDocDate = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
};

const isCompleted = (t: FundTransaction) => String(t.status || 'COMPLETED') === 'COMPLETED';

const accountNetOpening = (
  openingBalanceAccounts: OpeningBalanceAccountRecord[],
  accountCode: string,
): number | undefined => {
  const code = String(accountCode || '').trim();
  if (!code) return undefined;
  const row = asOpeningAccounts(openingBalanceAccounts).find((r) => String(r.accountCode || '').trim() === code);
  if (!row) return undefined;
  return Math.round(Number(row.debit || 0) - Number(row.credit || 0));
};

const replayFundBalance = (
  transactions: FundTransaction[],
  filter: (t: FundTransaction) => boolean,
  beforeDate: string,
): number => {
  let balance = 0;
  const sorted = [...transactions].filter(isCompleted).filter(filter).sort((a, b) => {
    const d = String(a.date || '').localeCompare(String(b.date || ''));
    if (d !== 0) return d;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  for (const t of sorted) {
    if (String(t.date || '') >= beforeDate) break;
    const amount = Math.round(Number(t.amount || 0));
    if (t.type === 'RECEIPT') balance += amount;
    else if (t.type === 'PAYMENT') balance -= amount;
  }
  return balance;
};

const resolveCashOpening = (
  fundTransactions: FundTransaction[],
  openingBalanceAccounts: OpeningBalanceAccountRecord[],
  cashFlowOpening: Record<string, number> | undefined,
  startDate: string,
): number => {
  if (typeof cashFlowOpening?.['60'] === 'number') {
    return Math.round(Number(cashFlowOpening['60']));
  }
  if (typeof cashFlowOpening?.['70'] === 'number') {
    return Math.round(Number(cashFlowOpening['70']));
  }
  const from1111 = accountNetOpening(openingBalanceAccounts, '1111');
  if (from1111 != null) return from1111;
  const from1112 = accountNetOpening(openingBalanceAccounts, '1112');
  if (from1112 != null) return from1112;
  return replayFundBalance(fundTransactions, (t) => t.method === 'CASH', startDate);
};

const matchesBankTransaction = (t: FundTransaction, bank: BankAccount) => {
  const bankId = String(bank.id || '').trim();
  const linked = String(bank.linkedAccountCode || '').trim();
  const txBankId = String(t.bankAccountId || '').trim();
  const txLinked = String(t.bankLedgerAccountCode || '').trim();
  const txNumber = String(t.bankAccountNumber || '').trim();
  if (bankId && txBankId && txBankId === bankId) return true;
  if (linked && txLinked && txLinked === linked) return true;
  if (
    txNumber &&
    String(bank.accountNumber || '').trim() &&
    txNumber === String(bank.accountNumber || '').trim()
  ) {
    return true;
  }
  return false;
};

const resolveBankOpening = (
  fundTransactions: FundTransaction[],
  openingBalanceAccounts: OpeningBalanceAccountRecord[],
  bank: BankAccount,
  startDate: string,
): number => {
  const code = String(bank.linkedAccountCode || '').trim();
  if (code) {
    const fromOb = accountNetOpening(openingBalanceAccounts, code);
    if (fromOb != null) return fromOb;
  }
  return replayFundBalance(
    fundTransactions,
    (t) => t.method === 'BANK' && matchesBankTransaction(t, bank),
    startDate,
  );
};

const buildTransactionDescription = (t: FundTransaction): string => {
  const parts = [
    String(t.description || '').trim(),
    String(t.payerReceiver || '').trim() ? `Đối tượng: ${t.payerReceiver}` : undefined,
    String(t.category || '').trim() ? `Loại: ${t.category}` : undefined,
    String(t.referenceDoc || '').trim() ? `Tham chiếu: ${t.referenceDoc}` : undefined,
  ].filter(Boolean);
  return parts.join(' — ') || (t.type === 'RECEIPT' ? 'Thu tiền' : 'Chi tiền');
};

type Tt58S2dSectionKind = 'cash' | 'deposit';

const sectionLabels = (kind: Tt58S2dSectionKind) => ({
  opening: kind === 'cash' ? 'Tiền mặt tồn đầu kỳ' : 'Tiền gửi tồn đầu kỳ',
  totalReceipt: kind === 'cash' ? 'Tổng tiền thu vào trong kỳ' : 'Tổng tiền gửi vào trong kỳ',
  totalPayment: kind === 'cash' ? 'Tổng tiền chi ra trong kỳ' : 'Tổng tiền rút ra trong kỳ',
  closing: kind === 'cash' ? 'Tiền mặt tồn cuối kỳ' : 'Tiền gửi tồn cuối kỳ',
});

const buildMoneySection = (
  sectionId: string,
  title: string,
  openingBalance: number,
  periodTransactions: FundTransaction[],
  kind: Tt58S2dSectionKind,
): Tt58S2dMoneySection => {
  const labels = sectionLabels(kind);
  const rows: Tt58S2dLedgerRow[] = [
    { kind: 'opening', description: labels.opening, balance: openingBalance, bold: true },
  ];

  let totalReceipt = 0;
  let totalPayment = 0;

  const sorted = [...periodTransactions].filter(isCompleted).sort((a, b) => {
    const d = String(a.date || '').localeCompare(String(b.date || ''));
    if (d !== 0) return d;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  for (const t of sorted) {
    const amount = Math.round(Number(t.amount || 0));
    if (amount <= 0) continue;
    const receipt = t.type === 'RECEIPT' ? amount : undefined;
    const payment = t.type === 'PAYMENT' ? amount : undefined;
    if (receipt) totalReceipt += receipt;
    if (payment) totalPayment += payment;
    rows.push({
      kind: 'detail',
      docNo: String(t.voucherNumber || t.referenceDoc || t.id || '').trim(),
      docDate: formatDocDate(t.date),
      description: buildTransactionDescription(t),
      receipt,
      payment,
    });
  }

  if (sorted.length === 0) {
    for (let i = 0; i < MIN_DETAIL_PLACEHOLDER_ROWS; i++) {
      rows.push({ kind: 'placeholder', description: TT58_S2D_FILLER_LINE });
    }
  }

  const closingBalance = openingBalance + totalReceipt - totalPayment;

  rows.push(
    { kind: 'total_receipt', description: labels.totalReceipt, receipt: totalReceipt, bold: true },
    { kind: 'total_payment', description: labels.totalPayment, payment: totalPayment, bold: true },
    {
      kind: 'closing',
      description: labels.closing,
      balance: closingBalance,
      bold: true,
    },
  );

  return {
    sectionId,
    title,
    rows,
    openingBalance,
    totalReceipt,
    totalPayment,
    closingBalance,
  };
};

const bankSectionKey = (bank: BankAccount) => String(bank.id || bank.linkedAccountCode || bank.accountNumber);

const bankSubsectionRows = (bank: BankAccount | null, sectionRows: Tt58S2dLedgerRow[]): Tt58S2dLedgerRow[] => {
  const filler =
    bank && (bank.bankName || bank.accountNumber)
      ? [
          bank.bankName,
          bank.accountNumber ? `STK: ${bank.accountNumber}` : '',
          bank.linkedAccountCode ? `TK: ${bank.linkedAccountCode}` : '',
        ]
          .filter(Boolean)
          .join(' — ')
      : TT58_S2D_FILLER_LINE;
  return [
    { kind: 'subsection_header', description: 'Ngân hàng….', bold: true },
    { kind: 'placeholder', description: filler },
    ...sectionRows,
  ];
};

export const computeTt58S2dDnsnLedger = (
  fundTransactions: FundTransaction[] | undefined | null,
  bankAccounts: BankAccount[] | undefined | null,
  openingBalanceAccounts: OpeningBalanceAccountRecord[] | undefined | null,
  cashFlowOpening: Record<string, number> | undefined,
  financialYear: FinancialYear,
): Tt58S2dDnsnLedgerData => {
  const startDate = String(financialYear.startDate || '').slice(0, 10);
  const endDate = String(financialYear.endDate || '').slice(0, 10);
  const year = Number(startDate.slice(0, 4)) || new Date().getFullYear();
  const txs = asFundTransactions(fundTransactions);
  const banks = asBankAccounts(bankAccounts);
  const openingAccounts = asOpeningAccounts(openingBalanceAccounts);

  const cashOpening = resolveCashOpening(txs, openingAccounts, cashFlowOpening, startDate);
  const cashPeriod = txs.filter(
    (t) => t.method === 'CASH' && inPeriod(String(t.date || '').slice(0, 10), startDate, endDate),
  );

  const cashSection = buildMoneySection('cash', 'Tiền mặt', cashOpening, cashPeriod, 'cash');

  const bankSections: Tt58S2dMoneySection[] = [];
  const assignedTxIds = new Set<string>();

  const bankList = [...banks].sort((a, b) => {
    const statusOrder = (s: string) => (s === 'ACTIVE' ? 0 : 1);
    const so = statusOrder(a.status) - statusOrder(b.status);
    if (so !== 0) return so;
    return String(a.bankName || '').localeCompare(String(b.bankName || ''), 'vi');
  });

  for (const bank of bankList) {
    const periodTxs = txs.filter((t) => {
      if (t.method !== 'BANK') return false;
      if (!inPeriod(String(t.date || '').slice(0, 10), startDate, endDate)) return false;
      return matchesBankTransaction(t, bank);
    });
    periodTxs.forEach((t) => assignedTxIds.add(String(t.id)));
    const hasPrior = txs.some(
      (t) =>
        t.method === 'BANK' &&
        matchesBankTransaction(t, bank) &&
        String(t.date || '').slice(0, 10) < startDate &&
        isCompleted(t),
    );
    const opening = resolveBankOpening(txs, openingAccounts, bank, startDate);
    if (periodTxs.length === 0 && opening === 0 && !hasPrior) continue;

    const section = buildMoneySection(bankSectionKey(bank), 'Ngân hàng….', opening, periodTxs, 'deposit');
    bankSections.push({
      ...section,
      title: 'Ngân hàng….',
      rows: bankSubsectionRows(bank, section.rows),
    });
  }

  const orphanPeriod = txs.filter((t) => {
    if (t.method !== 'BANK') return false;
    if (!inPeriod(String(t.date || '').slice(0, 10), startDate, endDate)) return false;
    if (assignedTxIds.has(String(t.id))) return false;
    return true;
  });

  if (orphanPeriod.length > 0) {
    const orphanOpening = replayFundBalance(
      txs,
      (t) => t.method === 'BANK' && !bankList.some((b) => matchesBankTransaction(t, b)),
      startDate,
    );
    const orphanSection = buildMoneySection(
      '__unassigned__',
      'Ngân hàng….',
      orphanOpening,
      orphanPeriod,
      'deposit',
    );
    bankSections.push({
      ...orphanSection,
      rows: bankSubsectionRows(null, orphanSection.rows),
    });
  }

  if (bankSections.length === 0) {
    const emptyDeposit = buildMoneySection('__default_bank__', 'Ngân hàng….', 0, [], 'deposit');
    bankSections.push({
      ...emptyDeposit,
      rows: bankSubsectionRows(null, emptyDeposit.rows),
    });
  }

  const cashWithHeader: Tt58S2dMoneySection = {
    ...cashSection,
    rows: [{ kind: 'section_header', description: 'Tiền mặt', bold: true }, ...cashSection.rows],
  };

  const bankDepositHeader: Tt58S2dLedgerRow = {
    kind: 'section_header',
    description: 'Tiền gửi không kỳ hạn',
    bold: true,
  };

  return {
    cash: cashWithHeader,
    bankDepositHeader,
    banks: bankSections,
    year,
  };
};

export function tt58S2dRowsToTable(
  data: Tt58S2dDnsnLedgerData,
  formatAmount: (value: number) => string,
): (string | number)[][] {
  const toRow = (row: Tt58S2dLedgerRow): (string | number)[] => {
    if (row.kind === 'detail') {
      return [
        row.docNo || '',
        row.docDate || '',
        row.description,
        row.receipt != null ? formatAmount(row.receipt) : '',
        row.payment != null ? formatAmount(row.payment) : '',
      ];
    }
    if (row.kind === 'total_receipt') {
      return ['', '', row.description, formatAmount(Number(row.receipt || 0)), ''];
    }
    if (row.kind === 'total_payment') {
      return ['', '', row.description, '', formatAmount(Number(row.payment || 0))];
    }
    if (row.kind === 'placeholder') {
      return ['', '', row.description, '', ''];
    }
    if (row.kind === 'opening' || row.kind === 'closing') {
      return ['', '', row.description, '', ''];
    }
    return ['', '', row.description, '', ''];
  };

  const rows: (string | number)[][] = [];
  rows.push(...data.cash.rows.map(toRow));
  if (data.bankDepositHeader) {
    rows.push(toRow(data.bankDepositHeader));
  }
  for (const bankBlock of data.banks) {
    rows.push(...bankBlock.rows.map(toRow));
  }
  return rows;
}
