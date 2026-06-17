import type { AccountingStandard } from '../types';

export interface WarehouseVoucherPrintHeader {
  formTitle: string;
  circularLines: string[];
}

/** Mẫu số & dòng thông tư trên Phiếu nhập/xuất kho (01/02-VT) khi in. */
export function getWarehouseVoucherPrintHeader(
  standard: AccountingStandard | undefined,
  isImport: boolean
): WarehouseVoucherPrintHeader {
  if (standard === 'TT58_2026') {
    return {
      formTitle: isImport ? 'Mẫu số 01-VT' : 'Mẫu số 02-VT',
      circularLines: [
        '(Kèm theo Thông tư số 58/2026/TT-BTC ngày 25 tháng 5 năm 2026 của Bộ trưởng Bộ Tài chính)',
      ],
    };
  }
  return {
    formTitle: `Mẫu số ${isImport ? '01' : '02'} - VT`,
    circularLines: [
      '(Ban hành theo Thông tư số 133/2016/TT-BTC',
      'ngày 26/8/2016 của Bộ Tài chính)',
    ],
  };
}
