import type { JournalEntry } from '../types';
import { journalEntryDetailsArray } from './journalEntryDetails';

const detailsOf = (e: JournalEntry) => journalEntryDetailsArray(e);

/** Giống quy ước B01b trong Report133 / accounting.ts */
const sumNetUntil = (entries: JournalEntry[], endDate: string, prefixes: string[]) => {
  return prefixes.reduce((sum, prefix) => {
    const net = entries
      .filter(e => e.date <= endDate)
      .reduce((acc, e) => {
        return acc + detailsOf(e).reduce((s, d) => {
          if (String(d.account).startsWith(prefix)) return s + (Number(d.debit || 0) - Number(d.credit || 0));
          return s;
        }, 0);
      }, 0);
    return sum + net;
  }, 0);
};

const assetSide = (net: number) => (net > 0 ? net : 0);
const liabilitySide = (net: number) => (net < 0 ? Math.abs(net) : 0);

const assetSideP = (entries: JournalEntry[], end: string, prefix: string) =>
  assetSide(sumNetUntil(entries, end, [prefix]));
const liabilitySideP = (entries: JournalEntry[], end: string, prefix: string) =>
  liabilitySide(sumNetUntil(entries, end, [prefix]));

const turnover = (
  entries: JournalEntry[],
  prefix: string,
  side: 'DEBIT' | 'CREDIT',
  start: string,
  end: string,
) =>
  entries
    .filter(e => e.date >= start && e.date <= end)
    .reduce(
      (acc, e) =>
        acc +
        detailsOf(e).reduce((sum, d) => {
          if (!String(d.account).startsWith(prefix)) return sum;
          return sum + (side === 'DEBIT' ? Number(d.debit || 0) : Number(d.credit || 0));
        }, 0),
      0,
    );

const isOpeningEntry = (e: JournalEntry) => {
  const ref = (e.referenceId || '').toUpperCase();
  const desc = (e.description || '').toLowerCase();
  return ref.startsWith('OPENING') || desc.includes('số dư đầu kỳ');
};

const getDetailedFlow = (
  entries: JournalEntry[],
  startStr: string,
  endStr: string,
  type: 'DEBIT' | 'CREDIT',
  offsetPrefixes: string[] | null,
  excludeOffsetPrefixes: string[] | null,
) => {
  return entries
    .filter(e => e.date >= startStr && e.date <= endStr && !isOpeningEntry(e))
    .reduce((acc, entry) => {
      const det = detailsOf(entry);
      const moneyParts = det.filter(
        d => String(d.account).startsWith('111') || String(d.account).startsWith('112'),
      );
      return (
        acc +
        moneyParts.reduce((sum, mp) => {
          const isCorrectSide = type === 'DEBIT' ? mp.debit > 0 : mp.credit > 0;
          if (!isCorrectSide) return sum;
          const offsets = det.filter(d => d.account !== mp.account);
          const matchesOffset =
            !offsetPrefixes || offsets.some(o => offsetPrefixes.some(p => String(o.account).startsWith(p)));
          const isExcluded =
            excludeOffsetPrefixes && offsets.some(o => excludeOffsetPrefixes.some(p => String(o.account).startsWith(p)));
          if (matchesOffset && !isExcluded) return sum + (type === 'DEBIT' ? mp.debit : mp.credit);
          return sum;
        }, 0)
      );
    }, 0);
};

export type B09FinancialMetrics = {
  period: { start: string; end: string };
  b01b: {
    cash_110: number;
    receivables131: number;
    prepaid331: number;
    otherReceivables133: number;
    group130: number;
    inventory_141: number;
    fixedAssets_220: number;
    payables411: number;
    customerAdvances412: number;
    loans341_416: number;
    totalAssets_300: number;
    totalSources_600: number;
  };
  b02: {
    revenue01: number;
    deductions02: number;
    netRevenue10: number;
    cogs11: number;
    gross20: number;
    finRev21: number;
    finExp22: number;
    admin24: number;
    netOp30: number;
    otherInc31: number;
    otherExp32: number;
    other40: number;
    pbt50: number;
    tax51: number;
    pat60: number;
  };
  b03: {
    thu01: number;
    chi02: number;
    chi03: number;
    lct20: number;
    chi21: number;
    thu22: number;
    lct30: number;
    thu31: number;
    chi32: number;
    lct40: number;
    net50: number;
  };
};

export function computeB09FinancialMetrics(
  entries: JournalEntry[] | undefined | null,
  financialYear: { startDate: string; endDate: string },
): B09FinancialMetrics {
  const list = Array.isArray(entries) ? entries : [];
  const start = financialYear.startDate;
  const end = financialYear.endDate;

  const ts_110 = ['111', '112', '113'].reduce((acc, p) => acc + assetSideP(list, end, p), 0);
  const ts_121 = assetSide(sumNetUntil(list, end, ['121']));
  const ts_123 = assetSide(sumNetUntil(list, end, ['128']));
  const ts_120 = ts_121 + ts_123;
  const ts_131 = assetSide(sumNetUntil(list, end, ['131']));
  const ts_132 = assetSide(sumNetUntil(list, end, ['331']));
  const ts_133 = assetSideP(list, end, '138') + assetSideP(list, end, '136');
  const ts_130 = ts_131 + ts_132 + ts_133;
  const ts_141 = assetSide(sumNetUntil(list, end, ['151', '152', '153', '154', '155', '156']));
  const ts_221 = assetSideP(list, end, '211') + assetSideP(list, end, '213');
  const ts_222 = -liabilitySide(sumNetUntil(list, end, ['214']));
  const ts_220 = ts_221 + ts_222;
  const ts_231 = assetSide(sumNetUntil(list, end, ['217']));
  const ts_230 = ts_231;
  const assets200 = ts_220 + ts_230 + ['221', '228', '241'].reduce((acc, p) => acc + assetSideP(list, end, p), 0);

  const net133 = list
    .filter(e => e.date <= end)
    .reduce(
      (sum, e) =>
        sum + detailsOf(e).reduce((s, d) => (String(d.account).startsWith('133') ? s + (Number(d.debit || 0) - Number(d.credit || 0)) : s), 0),
      0,
    );
  const net3331 = list
    .filter(e => e.date <= end)
    .reduce(
      (sum, e) =>
        sum + detailsOf(e).reduce((s, d) => (String(d.account).startsWith('3331') ? s + (Number(d.credit || 0) - Number(d.debit || 0)) : s), 0),
      0,
    );
  const netVatStatus = net133 - net3331;
  const ts_151 = netVatStatus > 0 ? netVatStatus : 0;
  const ts_152 = assetSide(sumNetUntil(list, end, ['141', '242']));
  const ts_150 = ts_151 + ts_152;

  const assets100 = ts_110 + ts_120 + ts_130 + ts_141 + ts_150;
  const totalAssets_300 = assets100 + assets200;

  const nv_411 = liabilitySide(sumNetUntil(list, end, ['331']));
  const nv_412 = liabilitySide(sumNetUntil(list, end, ['131']));
  const nv_413_val = netVatStatus < 0 ? Math.abs(netVatStatus) : 0;
  const nv_413_otherTaxes = ['3332', '3333', '3334', '3335', '3336', '3337', '3338', '3339'].reduce(
    (acc, p) => acc + liabilitySideP(list, end, p),
    0,
  );
  const nv_413 = nv_413_val + nv_413_otherTaxes;
  const nv_414 = liabilitySide(sumNetUntil(list, end, ['334']));
  const nv_415 =
    liabilitySideP(list, end, '338') +
    ['335', '336', '337'].reduce((acc, p) => acc + liabilitySideP(list, end, p), 0);
  const nv_416 = ['341', '311', '312', '319', '320'].reduce((acc, p) => acc + liabilitySideP(list, end, p), 0);
  const nv_417 = liabilitySideP(list, end, '352');
  const nv_418 = liabilitySideP(list, end, '353');
  const nv_410 = nv_411 + nv_412 + nv_413 + nv_414 + nv_415 + nv_416 + nv_417 + nv_418;

  const nv_511 = liabilitySide(sumNetUntil(list, end, ['411']));
  const net421 = sumNetUntil(list, end, ['421']);
  const nv_517 = net421 < 0 ? Math.abs(net421) : -net421;
  const totalEquity_500 =
    nv_511 + nv_517 + ['412', '413', '418', '419'].reduce((acc, p) => acc + liabilitySideP(list, end, p), 0);
  const totalSources_600 = nv_410 + totalEquity_500;

  const revenue = turnover(list, '511', 'CREDIT', start, end);
  const deductions = turnover(list, '521', 'DEBIT', start, end);
  const netRevenue_10 = revenue - deductions;
  const cogs_11 = turnover(list, '632', 'DEBIT', start, end);
  const grossProfit_20 = netRevenue_10 - cogs_11;
  const financialRevenue_21 = turnover(list, '515', 'CREDIT', start, end);
  const financialExpense_22 = turnover(list, '635', 'DEBIT', start, end);
  const adminExpense_24 = turnover(list, '642', 'DEBIT', start, end);
  const netOpProfit_30 = grossProfit_20 + financialRevenue_21 - financialExpense_22 - adminExpense_24;
  const otherIncome_31 = turnover(list, '711', 'CREDIT', start, end);
  const otherExpense_32 = turnover(list, '811', 'DEBIT', start, end);
  const otherProfit_40 = otherIncome_31 - otherExpense_32;
  const totalProfitBeforeTax_50 = netOpProfit_30 + otherProfit_40;
  const citTaxExpense_51 = turnover(list, '821', 'DEBIT', start, end);
  const profitAfterTax_60 = totalProfitBeforeTax_50 - citTaxExpense_51;

  const thu_01 = getDetailedFlow(list, start, end, 'DEBIT', ['511', '131', '515', '711'], null);
  const chi_02 = getDetailedFlow(list, start, end, 'CREDIT', ['331', '152', '156', '641', '642'], ['211', '213', '241']);
  const chi_03 = getDetailedFlow(list, start, end, 'CREDIT', ['334'], null);
  const lct_20 = thu_01 - chi_02 - chi_03;
  const chi_21 = getDetailedFlow(list, start, end, 'CREDIT', ['211', '213', '241'], null);
  const thu_22 = getDetailedFlow(list, start, end, 'DEBIT', ['711'], null);
  const lct_30 = thu_22 - chi_21;
  const thu_31 = getDetailedFlow(list, start, end, 'DEBIT', ['411'], null);
  const chi_32 = getDetailedFlow(list, start, end, 'CREDIT', ['411', '421'], null);
  const lct_40 = thu_31 - chi_32;
  const netCash_50 = lct_20 + lct_30 + lct_40;

  return {
    period: { start, end },
    b01b: {
      cash_110: ts_110,
      receivables131: ts_131,
      prepaid331: ts_132,
      otherReceivables133: ts_133,
      group130: ts_130,
      inventory_141: ts_141,
      fixedAssets_220: ts_220,
      payables411: nv_411,
      customerAdvances412: nv_412,
      loans341_416: nv_416,
      totalAssets_300,
      totalSources_600,
    },
    b02: {
      revenue01: revenue,
      deductions02: deductions,
      netRevenue10: netRevenue_10,
      cogs11: cogs_11,
      gross20: grossProfit_20,
      finRev21: financialRevenue_21,
      finExp22: financialExpense_22,
      admin24: adminExpense_24,
      netOp30: netOpProfit_30,
      otherInc31: otherIncome_31,
      otherExp32: otherExpense_32,
      other40: otherProfit_40,
      pbt50: totalProfitBeforeTax_50,
      tax51: citTaxExpense_51,
      pat60: profitAfterTax_60,
    },
    b03: {
      thu01: thu_01,
      chi02: chi_02,
      chi03: chi_03,
      lct20: lct_20,
      chi21: chi_21,
      thu22: thu_22,
      lct30: lct_30,
      thu31: thu_31,
      chi32: chi_32,
      lct40: lct_40,
      net50: netCash_50,
    },
  };
}
