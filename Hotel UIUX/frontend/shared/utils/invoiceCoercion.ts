import type { Invoice } from '@shared/types';
import { isBankLedgerChildAccountCode } from '@shared/utils/bankAccountPayments';

/** HĐ PAID nhưng paymentMethod vẫn là nhãn nợ (Kho: Ghi nợ 331…) → chuẩn hóa Tiền mặt để sinh chứng từ (Nợ 331 / Có 1111). */
export const coercePaidInvoicePaymentMethodFromDebtLabels = (inv: Invoice): Invoice => {
  if (inv.status !== 'PAID') return inv;
  if (isBankLedgerChildAccountCode(inv.bankLedgerAccountCode)) {
    return { ...inv, paymentMethod: 'Chuyển khoản' };
  }
  const pm = String(inv.paymentMethod || '');
  const low = pm.toLowerCase();
  const hasExplicitCashBank =
    pm.includes('Chuyển khoản') ||
    pm.includes('Tiền mặt') ||
    low.includes('chuyển khoản') ||
    low.includes('chuyen khoan') ||
    low.includes('tiền mặt') ||
    low.includes('tien mat');
  if (hasExplicitCashBank) return inv;
  if (low.includes('3388') || low.includes('chi hộ') || low.includes('chi ho')) return inv;
  const isDebtLedger =
    pm === 'Công nợ' ||
    low.includes('ghi nợ') ||
    low.includes('phải thu') ||
    low.includes('phai thu') ||
    low.includes('công nợ') ||
    low.includes('cong no');
  if (!isDebtLedger) return inv;
  return { ...inv, paymentMethod: 'Tiền mặt' };
};
