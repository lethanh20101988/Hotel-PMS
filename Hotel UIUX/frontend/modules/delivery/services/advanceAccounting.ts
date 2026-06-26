import type { AccountingVoucher, AccountingVoucherDetail } from '@shared/types';
import type { AdvanceRecord } from '../types';

/**
 * Liên kết "Tạm ứng & Hoàn ứng" (Đội xe & Tài xế) với kế toán:
 * sinh Chứng từ kế toán → tự động tạo bút toán Nhật ký chung → vào Báo cáo
 * (áp dụng cho cả TT133/2016 và TT58/2026 vì dùng hệ thống TK chung).
 *
 * Định khoản:
 *  - Tạm ứng:    Nợ 141 / Có 111 (tiền mặt) hoặc Có 334 (trừ lương).
 *  - Hoàn ứng/Quyết toán:
 *      + Ghi nhận chi phí: Nợ 6421 (nhiên liệu/cầu đường/khác) / Có 141.
 *      + Nộp lại phần thừa: Nợ 111 (hoặc 334) / Có 141.
 *      + Chi bổ sung phần thiếu: Nợ 141 / Có 111 (hoặc 334).
 */
const ADVANCE_ACCOUNT = '141'; // Tạm ứng
const CASH_ACCOUNT = '111'; // Tiền mặt
const SALARY_PAYABLE_ACCOUNT = '334'; // Phải trả người lao động
const DELIVERY_EXPENSE_ACCOUNT = '6421'; // Chi phí bán hàng (vận chuyển/giao hàng)

export const advanceVoucherId = (advanceId: string) => `VOU-ADV-${advanceId}`;

export function buildAdvanceVoucher(record: AdvanceRecord): AccountingVoucher | null {
  if (!record || !record.id) return null;

  const date = String(record.date || new Date().toISOString()).split('T')[0];
  const plate = record.vehiclePlate || '';
  const objectRef = {
    objectType: 'EMPLOYEE' as const,
    objectId: record.vehicleId,
    objectName: plate,
  };

  let lineIndex = 0;
  const makeLine = (
    description: string,
    debitAccount: string,
    creditAccount: string,
    amount: number,
  ): AccountingVoucherDetail => ({
    id: `${advanceVoucherId(record.id)}-D${++lineIndex}`,
    description,
    debitAccount,
    creditAccount,
    amount: Math.round(amount),
    ...objectRef,
  });

  const details: AccountingVoucherDetail[] = [];
  const isRefund = record.type === 'REFUND';

  if (isRefund) {
    const fuel = Number(record.costFuel) || 0;
    const toll = Number(record.costToll) || 0;
    const other = Number(record.costOther) || 0;
    const spent = fuel + toll + other;
    const total = Number(record.totalAdvanceAmount) || 0;
    const balance = total - spent;
    const settleAccount = record.settlementMode === 'SALARY' ? SALARY_PAYABLE_ACCOUNT : CASH_ACCOUNT;

    if (fuel > 0) details.push(makeLine('Chi phí nhiên liệu (quyết toán tạm ứng)', DELIVERY_EXPENSE_ACCOUNT, ADVANCE_ACCOUNT, fuel));
    if (toll > 0) details.push(makeLine('Chi phí cầu đường (quyết toán tạm ứng)', DELIVERY_EXPENSE_ACCOUNT, ADVANCE_ACCOUNT, toll));
    if (other > 0) details.push(makeLine('Chi phí khác (quyết toán tạm ứng)', DELIVERY_EXPENSE_ACCOUNT, ADVANCE_ACCOUNT, other));

    if (balance > 0) {
      details.push(
        makeLine(
          record.settlementMode === 'SALARY' ? 'Thu hồi tạm ứng trừ vào lương' : 'Hoàn ứng nộp lại quỹ',
          settleAccount,
          ADVANCE_ACCOUNT,
          balance,
        ),
      );
    } else if (balance < 0) {
      details.push(
        makeLine(
          record.settlementMode === 'SALARY' ? 'Chi bổ sung tạm ứng qua lương' : 'Chi bổ sung tạm ứng',
          ADVANCE_ACCOUNT,
          settleAccount,
          -balance,
        ),
      );
    }
  } else {
    const amount = Number(record.amount) || 0;
    if (amount <= 0) return null;
    const creditAccount = record.settlementMode === 'SALARY' ? SALARY_PAYABLE_ACCOUNT : CASH_ACCOUNT;
    details.push(makeLine(`Tạm ứng cho lái xe ${plate}`.trim(), ADVANCE_ACCOUNT, creditAccount, amount));
  }

  if (details.length === 0) return null;

  const totalAmount = details.reduce((sum, d) => sum + d.amount, 0);

  return {
    id: advanceVoucherId(record.id),
    voucherType: isRefund ? 'GENERAL' : 'PAYMENT',
    voucherNumber: '',
    date,
    postingDate: date,
    description: `${isRefund ? 'Quyết toán/Hoàn ứng' : 'Tạm ứng'} lái xe ${plate}${record.note ? ` - ${record.note}` : ''}`.trim(),
    contactName: plate,
    totalAmount,
    status: 'POSTED',
    details,
  };
}
