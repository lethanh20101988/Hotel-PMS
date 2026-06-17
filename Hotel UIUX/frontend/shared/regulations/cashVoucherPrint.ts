import type { AccountingStandard } from '../types';

export interface CashVoucherPrintHeader {
  formTitle: string;
  circularLines: string[];
}

/** Mẫu số & dòng thông tư trên Phiếu thu (01-TT) / Phiếu chi (02-TT) khi in. */
export function getCashVoucherPrintHeader(
  standard: AccountingStandard | undefined,
  isReceipt: boolean
): CashVoucherPrintHeader {
  if (standard === 'TT58_2026') {
    return {
      formTitle: isReceipt ? 'Mẫu số 01-TT' : 'Mẫu số 02-TT',
      circularLines: [
        '(Kèm theo Thông tư số 58/2026/TT-BTC ngày 25 tháng 5 năm 2026 của Bộ trưởng Bộ Tài chính)',
      ],
    };
  }
  return {
    formTitle: `Mẫu số ${isReceipt ? '01' : '02'} - TT`,
    circularLines: [
      '(Ban hành theo Thông tư số 133/2016/TT-',
      'BTC ngày 26/8/2016 của Bộ Tài chính)',
    ],
  };
}
