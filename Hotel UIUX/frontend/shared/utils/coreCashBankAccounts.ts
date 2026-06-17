import type { AccountDefinition } from '../types';

/**
 * Bốn TK chi tiết tiền & tiền gửi (TT133) — dùng chung cho danh mục, sổ sách, bút toán.
 * Luôn đảm bảo có trong mergeAccountsWithDefaults để bút Nợ/Có khớp mã.
 */
export const CORE_CASH_BANK_ACCOUNT_CODES = ['1111', '1112', '1121', '1122'] as const;

export const CORE_CASH_BANK_ACCOUNT_DEFINITIONS: ReadonlyArray<AccountDefinition> = [
  { id: 'acc_1111', code: '1111', name: 'Tiền Việt Nam', type: 'Dư Nợ' },
  { id: 'acc_1112', code: '1112', name: 'Ngoại tệ', type: 'Dư Nợ' },
  { id: 'acc_1121', code: '1121', name: 'Tiền Việt Nam', type: 'Dư Nợ' },
  { id: 'acc_1122', code: '1122', name: 'Ngoại tệ', type: 'Dư Nợ' },
] as const;

/** Chèn các TK lõi nếu thiếu (dữ liệu cũ / chỉnh sửa tay xóa nhầm). */
export function ensureCoreCashBankAccounts(
  byCode: Map<string, AccountDefinition>,
): void {
  for (const def of CORE_CASH_BANK_ACCOUNT_DEFINITIONS) {
    if (!byCode.has(def.code)) {
      byCode.set(def.code, { ...def });
    }
  }
}
