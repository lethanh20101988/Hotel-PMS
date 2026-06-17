import type { JournalEntry } from '../../types';
import { journalEntryDetailsArray } from '../../utils/journalEntryDetails';

export type Tt133B01bBalanceTotals = {
  assets100: number;
  assets300: number;
  sources600: number;
  diff: number;
  isBalanced: boolean;
};

const sumNetUntil = (entries: JournalEntry[], endDate: string, prefixes: string[]) => {
  return prefixes.reduce((sum, prefix) => {
    const net = entries
      .filter((e) => e.date <= endDate)
      .reduce((acc, e) => {
        return acc + journalEntryDetailsArray(e).reduce((s, d) => {
          if (String(d.account).startsWith(prefix)) {
            return s + (Number(d.debit || 0) - Number(d.credit || 0));
          }
          return s;
        }, 0);
      }, 0);
    return sum + net;
  }, 0);
};

const assetSide = (net: number) => (net > 0 ? net : 0);
const liabilitySide = (net: number) => (net < 0 ? Math.abs(net) : 0);

/**
 * Công thức TT133/B01b-DNN đang dùng để khóa in/xuất báo cáo.
 * Giữ nguyên quy ước số liệu production: Net = Nợ - Có, tài sản max(net, 0),
 * nguồn vốn/nợ max(-net, 0).
 */
export function computeTt133B01bTotals(
  entries: JournalEntry[] | undefined | null,
  endDate: string,
): Tt133B01bBalanceTotals {
  const list = Array.isArray(entries) ? entries : [];
  const assetSideP = (prefix: string) => assetSide(sumNetUntil(list, endDate, [prefix]));
  const liabilitySideP = (prefix: string) => liabilitySide(sumNetUntil(list, endDate, [prefix]));

  const ts_110 = ['111', '112', '113'].reduce((acc, p) => acc + assetSideP(p), 0);
  const ts_121 = assetSide(sumNetUntil(list, endDate, ['121']));
  const ts_122 = 0;
  const ts_123 = assetSide(sumNetUntil(list, endDate, ['128']));
  const ts_120 = ts_121 + ts_122 + ts_123;

  const ts_131 = assetSide(sumNetUntil(list, endDate, ['131']));
  const ts_132 = assetSide(sumNetUntil(list, endDate, ['331']));
  const ts_133 = assetSideP('138') + assetSideP('136');
  const ts_130 = ts_131 + ts_132 + ts_133;

  const ts_141 = assetSide(sumNetUntil(list, endDate, ['151', '152', '153', '154', '155', '156']));
  const ts_140 = ts_141;

  const net133 = list
    .filter((e) => e.date <= endDate)
    .reduce(
      (sum, e) =>
        sum + journalEntryDetailsArray(e).reduce((s, d) => (
          String(d.account).startsWith('133') ? s + (Number(d.debit || 0) - Number(d.credit || 0)) : s
        ), 0),
      0,
    );
  const net3331 = list
    .filter((e) => e.date <= endDate)
    .reduce(
      (sum, e) =>
        sum + journalEntryDetailsArray(e).reduce((s, d) => (
          String(d.account).startsWith('3331') ? s + (Number(d.credit || 0) - Number(d.debit || 0)) : s
        ), 0),
      0,
    );
  const netVatStatus = net133 - net3331;
  const ts_151 = netVatStatus > 0 ? netVatStatus : 0;
  const nv_413_val = netVatStatus < 0 ? Math.abs(netVatStatus) : 0;
  const nv_413_otherTaxes = ['3332', '3333', '3334', '3335', '3336', '3337', '3338', '3339'].reduce(
    (acc, p) => acc + liabilitySideP(p),
    0,
  );
  const nv_413 = nv_413_val + nv_413_otherTaxes;

  const ts_152 = assetSide(sumNetUntil(list, endDate, ['141', '242']));
  const ts_150 = ts_151 + ts_152;
  const assets100 = ts_110 + ts_120 + ts_130 + ts_140 + ts_150;

  const ts_221 = assetSideP('211') + assetSideP('213');
  const ts_222 = -liabilitySide(sumNetUntil(list, endDate, ['214']));
  const ts_220 = ts_221 + ts_222;
  const ts_231 = assetSide(sumNetUntil(list, endDate, ['217']));
  const ts_230 = ts_231;
  const assets200 = ts_220 + ts_230 + ['221', '228', '241'].reduce((acc, p) => acc + assetSideP(p), 0);
  const assets300 = assets100 + assets200;

  const nv_411 = liabilitySide(sumNetUntil(list, endDate, ['331']));
  const nv_412 = liabilitySide(sumNetUntil(list, endDate, ['131']));
  const nv_414 = liabilitySide(sumNetUntil(list, endDate, ['334']));
  const nv_415 = liabilitySideP('338') + ['335', '336', '337'].reduce((acc, p) => acc + liabilitySideP(p), 0);
  const nv_416 = ['341', '311', '312', '319', '320'].reduce((acc, p) => acc + liabilitySideP(p), 0);
  const nv_417 = liabilitySideP('352');
  const nv_418 = liabilitySideP('353');
  const sources400 = nv_411 + nv_412 + nv_413 + nv_414 + nv_415 + nv_416 + nv_417 + nv_418;

  const nv_511 = liabilitySide(sumNetUntil(list, endDate, ['411']));
  const net421 = sumNetUntil(list, endDate, ['421']);
  const nv_517 = net421 < 0 ? Math.abs(net421) : -net421;
  const sources500 = nv_511 + nv_517 + ['412', '413', '418', '419'].reduce((acc, p) => acc + liabilitySideP(p), 0);

  const sources600 = sources400 + sources500;
  const diff = assets300 - sources600;

  return {
    assets100,
    assets300,
    sources600,
    diff,
    isBalanced: Math.abs(diff) < 0.000001,
  };
}
