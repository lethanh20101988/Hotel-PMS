import type { FinancialYear, JournalEntry } from '../../types';
import { journalEntryDetailsArray } from '../../utils/journalEntryDetails';

export type Tt58ReportRow = {
  code: string;
  label: string;
  value: number;
  beginValue?: number;
  bold?: boolean;
  indent?: number;
  italic?: boolean;
  /** Tiêu đề nhóm (TÀI SẢN, NGUỒN VỐN) — căn giữa, gộp cột */
  sectionHeader?: boolean;
};

export type Tt58B01DnsnData = {
  rows: Tt58ReportRow[];
  endByCode: Record<string, number>;
  beginByCode: Record<string, number>;
  diff: number;
  isBalanced: boolean;
};

const asEntries = (entries: JournalEntry[] | undefined | null) => (Array.isArray(entries) ? entries : []);

const sumNetUntil = (entries: JournalEntry[], endDate: string, prefixes: string[]) =>
  prefixes.reduce((sum, prefix) => {
    return sum + entries
      .filter((entry) => entry.date <= endDate)
      .reduce((acc, entry) => acc + journalEntryDetailsArray(entry).reduce((s, d) => {
        return String(d.account).startsWith(prefix) ? s + Number(d.debit || 0) - Number(d.credit || 0) : s;
      }, 0), 0);
  }, 0);

const turnover = (entries: JournalEntry[], startDate: string, endDate: string, prefixes: string[], side: 'DEBIT' | 'CREDIT') =>
  prefixes.reduce((sum, prefix) => {
    return sum + entries
      .filter((entry) => entry.date >= startDate && entry.date <= endDate)
      .reduce((acc, entry) => acc + journalEntryDetailsArray(entry).reduce((s, d) => {
        if (!String(d.account).startsWith(prefix)) return s;
        return s + (side === 'DEBIT' ? Number(d.debit || 0) : Number(d.credit || 0));
      }, 0), 0);
  }, 0);

const assetSide = (net: number) => (net > 0 ? net : 0);
const liabilitySide = (net: number) => (net < 0 ? Math.abs(net) : 0);

const previousDay = (dateStr: string) => {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
};

function buildB01Codes(entries: JournalEntry[], endDate: string): Record<string, number> {
  const asset = (prefixes: string[]) => assetSide(sumNetUntil(entries, endDate, prefixes));
  const liability = (prefixes: string[]) => liabilitySide(sumNetUntil(entries, endDate, prefixes));
  const bipolarEquity421 = (() => {
    const net = sumNetUntil(entries, endDate, ['421']);
    return net < 0 ? Math.abs(net) : -net;
  })();

  const code110 = asset(['111', '112', '113']);
  const code120 = asset(['131', '133', '136', '138', '141']) + asset(['331']);
  const code130 = asset(['151', '152', '153', '154', '155', '156', '157']);
  const code140 = Math.max(0, asset(['211', '213']) - liability(['214']));
  const code150 = asset(['121', '128', '228', '241', '242']);
  const code200 = code110 + code120 + code130 + code140 + code150;

  const code310 = liability(['331', '334', '335', '336', '338', '341', '352', '353']) + liability(['131']);
  const code320 = liability(['333']);
  const code300 = code310 + code320;
  const code400 = liability(['411', '412', '413', '418']) + bipolarEquity421 - asset(['419']);
  const code410 = liability(['411', '412', '413', '418']);
  const code420 = bipolarEquity421 > 0 ? bipolarEquity421 : 0;
  const code430 = Math.max(0, code400 - code410 - code420);
  const code500 = code300 + code400;

  return {
    '110': code110,
    '120': code120,
    '130': code130,
    '140': code140,
    '150': code150,
    '200': code200,
    '300': code300,
    '310': code310,
    '320': code320,
    '400': code400,
    '410': code410,
    '420': code420,
    '430': code430,
    '500': code500,
  };
}

export function computeTt58B01DnsnData(entriesInput: JournalEntry[], financialYear: FinancialYear): Tt58B01DnsnData {
  const entries = asEntries(entriesInput);
  const beginByCode = buildB01Codes(entries, previousDay(financialYear.startDate));
  const endByCode = buildB01Codes(entries, financialYear.endDate);
  const rows: Tt58ReportRow[] = [
    { code: '', label: 'TÀI SẢN', value: 0, beginValue: 0, sectionHeader: true, bold: true },
    { code: '110', label: '1. Tiền', value: endByCode['110'], beginValue: beginByCode['110'] },
    { code: '120', label: '2. Các khoản nợ phải thu', value: endByCode['120'], beginValue: beginByCode['120'] },
    { code: '130', label: '3. Hàng tồn kho', value: endByCode['130'], beginValue: beginByCode['130'] },
    { code: '140', label: '4. Tài sản cố định', value: endByCode['140'], beginValue: beginByCode['140'] },
    { code: '150', label: '5. Tài sản khác', value: endByCode['150'], beginValue: beginByCode['150'] },
    { code: '200', label: 'TỔNG CỘNG TÀI SẢN (200=110+120+130+140+150)', value: endByCode['200'], beginValue: beginByCode['200'], bold: true },
    { code: '', label: 'NGUỒN VỐN', value: 0, beginValue: 0, sectionHeader: true, bold: true },
    { code: '300', label: 'I. Nợ phải trả', value: endByCode['300'], beginValue: beginByCode['300'], bold: true },
    { code: '310', label: '1. Các khoản nợ phải trả', value: endByCode['310'], beginValue: beginByCode['310'], indent: 1 },
    { code: '320', label: '2. Thuế và các khoản phải nộp Nhà nước', value: endByCode['320'], beginValue: beginByCode['320'], indent: 1 },
    { code: '400', label: 'II. Vốn chủ sở hữu', value: endByCode['400'], beginValue: beginByCode['400'], bold: true },
    { code: '410', label: '1. Vốn đầu tư của chủ sở hữu', value: endByCode['410'], beginValue: beginByCode['410'], indent: 1 },
    { code: '420', label: '2. Lợi nhuận sau thuế chưa phân phối', value: endByCode['420'], beginValue: beginByCode['420'], indent: 1 },
    { code: '430', label: '3. Các quỹ thuộc vốn chủ sở hữu', value: endByCode['430'], beginValue: beginByCode['430'], indent: 1 },
    { code: '500', label: 'TỔNG CỘNG NGUỒN VỐN (500=300+400)', value: endByCode['500'], beginValue: beginByCode['500'], bold: true },
  ];
  const diff = endByCode['200'] - endByCode['500'];
  return {
    rows,
    endByCode,
    beginByCode,
    diff,
    isBalanced: Math.abs(diff) < 0.000001,
  };
}

const priorFinancialYear = (financialYear: FinancialYear): FinancialYear => {
  const year = Number(String(financialYear.startDate || '').slice(0, 4)) || new Date().getFullYear();
  const prev = year - 1;
  return { startDate: `${prev}-01-01`, endDate: `${prev}-12-31` };
};

const buildB02PeriodMetrics = (entries: JournalEntry[], startDate: string, endDate: string) => {
  const revenue =
    turnover(entries, startDate, endDate, ['511'], 'CREDIT') +
    turnover(entries, startDate, endDate, ['515', '711'], 'CREDIT');
  const totalExpense =
    turnover(entries, startDate, endDate, ['632'], 'DEBIT') +
    turnover(entries, startDate, endDate, ['635'], 'DEBIT') +
    turnover(entries, startDate, endDate, ['642'], 'DEBIT') +
    turnover(entries, startDate, endDate, ['811'], 'DEBIT');
  const profitBeforeTax = revenue - totalExpense;
  const citExpense = turnover(entries, startDate, endDate, ['821'], 'DEBIT');
  const profitAfterTax = profitBeforeTax - citExpense;
  return { revenue, totalExpense, profitBeforeTax, citExpense, profitAfterTax };
};

/** B02-DNSN — mẫu TT58/2026 (5 chỉ tiêu; cột Năm nay / Năm trước). */
export function computeTt58B02DnsnRows(entriesInput: JournalEntry[], financialYear: FinancialYear): Tt58ReportRow[] {
  const entries = asEntries(entriesInput);
  const priorFy = priorFinancialYear(financialYear);
  const cur = buildB02PeriodMetrics(entries, financialYear.startDate, financialYear.endDate);
  const prev = buildB02PeriodMetrics(entries, priorFy.startDate, priorFy.endDate);

  return [
    { code: '01', label: '1. Doanh thu và thu nhập thuần', value: cur.revenue, beginValue: prev.revenue },
    { code: '02', label: '2. Các khoản chi phí', value: cur.totalExpense, beginValue: prev.totalExpense },
    {
      code: '03',
      label: '3. Lợi nhuận kế toán trước thuế TNDN {(03)= (01)-(02)}',
      value: cur.profitBeforeTax,
      beginValue: prev.profitBeforeTax,
      bold: true,
    },
    { code: '10', label: '4. Chi phí thuế TNDN', value: cur.citExpense, beginValue: prev.citExpense },
    {
      code: '20',
      label: '5. Lợi nhuận sau thuế TNDN {(20) = (03)-(10)}',
      value: cur.profitAfterTax,
      beginValue: prev.profitAfterTax,
      bold: true,
    },
  ];
}

export function computeTt58TaxSummary(entriesInput: JournalEntry[], financialYear: FinancialYear) {
  const entries = asEntries(entriesInput);
  const startDate = financialYear.startDate;
  const endDate = financialYear.endDate;
  const openingVatCredit = assetSide(sumNetUntil(entries, previousDay(startDate), ['133']));
  const openingVatPayable = liabilitySide(sumNetUntil(entries, previousDay(startDate), ['3331']));
  const vatInput = turnover(entries, startDate, endDate, ['133'], 'DEBIT');
  const vatOutput = turnover(entries, startDate, endDate, ['3331'], 'CREDIT');
  const vatPaid = turnover(entries, startDate, endDate, ['3331'], 'DEBIT');
  const closingVatCredit = assetSide(sumNetUntil(entries, endDate, ['133']));
  const closingVatPayable = liabilitySide(sumNetUntil(entries, endDate, ['3331']));
  const citOpeningPayable = liabilitySide(sumNetUntil(entries, previousDay(startDate), ['3334']));
  const citExpense = turnover(entries, startDate, endDate, ['821'], 'DEBIT');
  const citPaid = turnover(entries, startDate, endDate, ['3334'], 'DEBIT');
  const citClosingPayable = liabilitySide(sumNetUntil(entries, endDate, ['3334']));
  return {
    openingVatCredit,
    openingVatPayable,
    vatInput,
    vatOutput,
    vatPaid,
    closingVatCredit,
    closingVatPayable,
    citOpeningPayable,
    citExpense,
    citPaid,
    citClosingPayable,
  };
}
