import type { AccountingStandard, Tt58TaxBookProfile } from '../types';

export type { AccountingStandard, Tt58TaxBookProfile };

export const ACCOUNTING_STANDARD_LABELS: Record<AccountingStandard, string> = {
  TT133: 'Thông tư 133/2016/TT-BTC',
  TT58_2026: 'Thông tư 58/2026/TT-BTC',
};

export const TT58_TAX_BOOK_PROFILE_LABELS: Record<Tt58TaxBookProfile, string> = {
  GTGT_RATE_TNDN_RATE: 'Điều 5 - GTGT tỷ lệ %, TNDN tỷ lệ % doanh thu',
  GTGT_DEDUCT_TNDN_RATE: 'Điều 6 - GTGT khấu trừ, TNDN tỷ lệ % doanh thu',
  GTGT_RATE_TNDN_INCOME: 'Điều 7 - GTGT tỷ lệ %, TNDN theo thu nhập tính thuế',
  GTGT_DEDUCT_TNDN_INCOME: 'Điều 8 - GTGT khấu trừ, TNDN theo thu nhập tính thuế',
};
