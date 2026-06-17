import type { AccountDefinition } from '@shared/types';

/**
 * Bổ sung danh mục TK (TT133) cho cột TK Nợ — Hóa đơn mua dịch vụ.
 * Gộp vào DEFAULT_ACCOUNTS trong store (ghi đè/ghi thêm theo mã).
 */
export const INVOICE_PURCHASE_SERVICE_EXTRA_ACCOUNTS: AccountDefinition[] = [
  { id: 'acc_128841', code: '128841', name: 'Phải thu về cho vay: ngắn hạn', type: 'Dư Nợ' },
  { id: 'acc_131111', code: '131111', name: 'Phải thu ngắn hạn khách hàng: Hđ SXKD (VNĐ)', type: 'Dư Nợ' },
  { id: 'acc_131112', code: '131112', name: 'Phải thu ngắn hạn khách hàng: Hđ SXKD (USD)', type: 'Dư Nợ' },
  { id: 'acc_131113', code: '131113', name: 'Phải thu ngắn hạn khách hàng: Hđ SXKD (JPY)', type: 'Dư Nợ' },
  { id: 'acc_131114', code: '131114', name: 'Phải thu ngắn hạn khách hàng: Hđ SXKD (SGD)', type: 'Dư Nợ' },
  { id: 'acc_131115', code: '131115', name: 'Phải thu ngắn hạn khách hàng: Hđ SXKD (CNY)', type: 'Dư Nợ' },
  { id: 'acc_131116', code: '131116', name: 'Phải thu ngắn hạn khách hàng: Hđ SXKD (EUR)', type: 'Dư Nợ' },
  { id: 'acc_131121', code: '131121', name: 'Phải thu ngắn hạn khách hàng: Hđ đầu tư (VNĐ)', type: 'Dư Nợ' },
  { id: 'acc_131122', code: '131122', name: 'Phải thu ngắn hạn khách hàng: Hđ đầu tư (USD)', type: 'Dư Nợ' },
  { id: 'acc_131123', code: '131123', name: 'Phải thu ngắn hạn khách hàng: Hđ đầu tư (GBP)', type: 'Dư Nợ' },
  { id: 'acc_131131', code: '131131', name: 'Phải thu ngắn hạn khách hàng: hoạt động TC (VNĐ)', type: 'Dư Nợ' },
  { id: 'acc_131132', code: '131132', name: 'Phải thu ngắn hạn khách hàng: hoạt động TC (USD)', type: 'Dư Nợ' },
  { id: 'acc_131211', code: '131211', name: 'Phải thu dài hạn khách hàng: Hđ SXKD (VNĐ)', type: 'Dư Nợ' },
  { id: 'acc_131212', code: '131212', name: 'Phải thu dài hạn khách hàng: Hđ SXKD (USD)', type: 'Dư Nợ' },
  { id: 'acc_131221', code: '131221', name: 'Phải thu dài hạn khách hàng: Hđ đầu tư (VNĐ)', type: 'Dư Nợ' },
  { id: 'acc_131222', code: '131222', name: 'Phải thu dài hạn khách hàng: Hđ đầu tư (USD)', type: 'Dư Nợ' },
  { id: 'acc_131231', code: '131231', name: 'Phải thu dài hạn khách hàng: Hđ tài chính (VNĐ)', type: 'Dư Nợ' },
  { id: 'acc_131232', code: '131232', name: 'Phải thu dài hạn khách hàng: Hđ tài chính (USD)', type: 'Dư Nợ' },
  { id: 'acc_13861', code: '13861', name: 'Cầm cố, thế chấp, ký quỹ, ký cược: ngắn hạn', type: 'Dư Nợ' },
  { id: 'acc_13862', code: '13862', name: 'Cầm cố, thế chấp, ký quỹ, ký cược: dài hạn', type: 'Dư Nợ' },
  { id: 'acc_138811', code: '138811', name: 'Phải thu ngắn hạn: HĐ SXKD', type: 'Dư Nợ' },
  { id: 'acc_1388121', code: '1388121', name: 'Phải thu về cổ tức, lợi nhuận được chia', type: 'Dư Nợ' },
  { id: 'acc_1388128', code: '1388128', name: 'Phải thu ngắn hạn HĐ SXKD khác', type: 'Dư Nợ' },
  { id: 'acc_138818', code: '138818', name: 'Phải thu ngắn hạn khác', type: 'Dư Nợ' },
  { id: 'acc_13882', code: '13882', name: 'Phải thu dài hạn khác', type: 'Dư Nợ' },
  { id: 'acc_22931', code: '22931', name: 'Các khoản phải thu quá hạn thanh toán hoặc khó đòi', type: 'Dư Có' },
  { id: 'acc_331111', code: '331111', name: 'Phải trả ngắn hạn người bán: HĐ SXKD (VND)', type: 'Lưỡng tính' },
  { id: 'acc_331112', code: '331112', name: 'Phải trả ngắn hạn người bán: HĐ SXKD (USD)', type: 'Lưỡng tính' },
  { id: 'acc_331113', code: '331113', name: 'Phải trả ngắn hạn người bán: HĐ SXKD (EUR)', type: 'Lưỡng tính' },
  { id: 'acc_331114', code: '331114', name: 'Phải trả ngắn hạn người bán: HĐ SXKD (AUD)', type: 'Lưỡng tính' },
  { id: 'acc_331115', code: '331115', name: 'Phải trả ngắn hạn người bán: HĐ SXKD (CNY)', type: 'Lưỡng tính' },
  { id: 'acc_331121', code: '331121', name: 'Phải trả ngắn hạn người bán: HĐ đầu tư (VND)', type: 'Lưỡng tính' },
  { id: 'acc_331122', code: '331122', name: 'Phải trả ngắn hạn người bán: HĐ đầu tư (USD)', type: 'Lưỡng tính' },
  { id: 'acc_331131', code: '331131', name: 'Phải trả ngắn hạn người bán: HĐ tài chính (VND)', type: 'Lưỡng tính' },
  { id: 'acc_331132', code: '331132', name: 'Phải trả ngắn hạn người bán: HĐ tài chính (USD)', type: 'Lưỡng tính' },
  { id: 'acc_331133', code: '331133', name: 'Phải trả ngắn hạn người bán: HĐ tài chính (GBP)', type: 'Lưỡng tính' },
  { id: 'acc_331211', code: '331211', name: 'Phải trả dài hạn người bán: HĐ SXKD (VND)', type: 'Lưỡng tính' },
  { id: 'acc_331212', code: '331212', name: 'Phải trả dài hạn người bán: HĐ SXKD (USD)', type: 'Lưỡng tính' },
  { id: 'acc_331221', code: '331221', name: 'Phải trả dài hạn người bán: HĐ đầu tư (VND)', type: 'Lưỡng tính' },
  { id: 'acc_331222', code: '331222', name: 'Phải trả dài hạn người bán: HĐ đầu tư (USD)', type: 'Lưỡng tính' },
  { id: 'acc_331231', code: '331231', name: 'Phải trả dài hạn người bán: HĐ tài chính (VND)', type: 'Lưỡng tính' },
  { id: 'acc_331232', code: '331232', name: 'Phải trả dài hạn người bán: HĐ tài chính (USD)', type: 'Lưỡng tính' },
  { id: 'acc_33511', code: '33511', name: 'Chi phí phải trả ngắn hạn: lãi vay', type: 'Dư Có' },
  { id: 'acc_33518', code: '33518', name: 'Chi phí phải trả ngắn hạn khác', type: 'Dư Có' },
  { id: 'acc_33521', code: '33521', name: 'Chi phí phải trả dài hạn: lãi vay', type: 'Dư Có' },
  { id: 'acc_33528', code: '33528', name: 'Chi phí phải trả dài hạn khác', type: 'Dư Có' },
  { id: 'acc_33681', code: '33681', name: 'Phải trả nội bộ khác: ngắn hạn', type: 'Dư Có' },
  { id: 'acc_33682', code: '33682', name: 'Phải trả nội bộ khác: dài hạn', type: 'Dư Có' },
  { id: 'acc_33861', code: '33861', name: 'Nhận ký quỹ, ký cược: ngắn hạn', type: 'Dư Có' },
  { id: 'acc_33862', code: '33862', name: 'Nhận ký quỹ, ký cược: dài hạn', type: 'Dư Có' },
  { id: 'acc_33881', code: '33881', name: 'Cổ tức, lợi nhuận phải trả', type: 'Dư Có' },
  { id: 'acc_3388211', code: '3388211', name: 'Phải trả, phải nộp ngắn hạn khác: HĐ SXKD', type: 'Dư Có' },
  { id: 'acc_3388212', code: '3388212', name: 'Phải trả, phải nộp ngắn hạn khác: HĐ đầu tư', type: 'Dư Có' },
  { id: 'acc_3388213', code: '3388213', name: 'Phải trả, phải nộp ngắn hạn khác: HĐ tài chính', type: 'Dư Có' },
  { id: 'acc_3388221', code: '3388221', name: 'Phải trả, phải nộp dài hạn khác: HĐ SXKD', type: 'Dư Có' },
  { id: 'acc_3388222', code: '3388222', name: 'Phải trả, phải nộp dài hạn khác: HĐ đầu tư', type: 'Dư Có' },
  { id: 'acc_3388223', code: '3388223', name: 'Phải trả, phải nộp dài hạn khác: HĐ tài chính', type: 'Dư Có' },
  { id: 'acc_3389', code: '3389', name: 'Bảo hiểm tai nạn, bệnh nghề nghiệp', type: 'Dư Có' },
  { id: 'acc_34111', code: '34111', name: 'Các khoản đi vay: ngắn hạn', type: 'Dư Có' },
  { id: 'acc_34112', code: '34112', name: 'Các khoản đi vay: dài hạn', type: 'Dư Có' },
  { id: 'acc_34121', code: '34121', name: 'Nợ thuê tài chính: ngắn hạn', type: 'Dư Có' },
  { id: 'acc_34122', code: '34122', name: 'Nợ thuê tài chính: dài hạn', type: 'Dư Có' },
  /** Cập nhật nhãn theo bảng danh mục người dùng (trùng mã với DEFAULT). */
  { id: 'acc_3361', code: '3361', name: 'Vốn kinh doanh ở các đơn vị trực thuộc', type: 'Dư Có' },
];

const extraCodes = INVOICE_PURCHASE_SERVICE_EXTRA_ACCOUNTS.map((a) => a.code);
const sortCode = (a: string, b: string) => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, 'vi', { numeric: true });
};

/** Các mã đã có trong DEFAULT_ACCOUNTS nhưng nằm trong bảng ảnh (cần hiện trong ô chọn TK Nợ). */
const PURCHASE_SERVICE_OVERLAP_DEFAULT_CODES = ['141', '1361', '1368', '1381'] as const;

/** TK 642 (TT133) — TK Nợ gợi ý cho HĐ mua thiết bị / mua dịch vụ. */
const PURCHASE_INVOICE_DEBIT_642_DETAIL_CODES = [
  '6421',
  '6422',
  '6423',
  '6424',
  '6425',
  '6426',
  '6427',
  '6428',
] as const;

/** TK Nợ gợi ý: 154 (mặc định CP SXKD dở dang) + mã trong ảnh (gồm cả đã có trong danh mục gốc) + chi tiết TK 642. */
export const PURCHASE_SERVICE_DEBIT_ACCOUNT_CODES: readonly string[] = Object.freeze(
  [
    ...new Set([
      '154',
      ...PURCHASE_SERVICE_OVERLAP_DEFAULT_CODES,
      ...PURCHASE_INVOICE_DEBIT_642_DETAIL_CODES,
      ...extraCodes,
    ]),
  ].sort(sortCode),
);

/** Tên hiển thị cho mã trùng danh mục gốc (không nằm trong INVOICE_PURCHASE_SERVICE_EXTRA_ACCOUNTS). */
const RECEIPT_FUND_CONTRA_LABELS: Record<string, string> = {
  '154': 'Chi phí sản xuất, kinh doanh dở dang',
  '141': 'Tạm ứng',
  '1361': 'Vốn kinh doanh ở đơn vị trực thuộc',
  '1368': 'Phải thu nội bộ khác',
  '1381': 'Tài sản thiếu chờ xử lý',
  '6421': 'Chi phí bán hàng',
  '6422': 'Chi phí quản lý doanh nghiệp',
  '6423': 'Chi phí đồ dùng văn phòng',
  '6424': 'Chi phí khấu hao TSCĐ',
  '6425': 'Thuế, phí và lệ phí',
  '6426': 'Chi phí dự phòng',
  '6427': 'Chi phí dịch vụ mua ngoài',
  '6428': 'Chi phí bằng tiền khác',
};

export function getReceiptFundContraAccountLabel(accountCode: string): string {
  const fromExtra = INVOICE_PURCHASE_SERVICE_EXTRA_ACCOUNTS.find((a) => a.code === accountCode);
  if (fromExtra) return fromExtra.name;
  return RECEIPT_FUND_CONTRA_LABELS[accountCode] || accountCode;
}

/** Kịch bản Phiếu thu: Nợ 1111/1121, Có TK theo mã (cùng bảng mã như HĐ mua dịch vụ). */
export type ReceiptFundScenario = { code: string; label: string; contraAccount: string };

/** Trùng với RECEIPT_SCENARIOS_BASE / PAYMENT_SCENARIOS_BASE — không sinh thêm dòng catalog. */
const FUND_SCENARIO_BASE_ONLY_CODES = new Set(['141']);

export function buildReceiptFundScenariosFromCatalog(): ReceiptFundScenario[] {
  return PURCHASE_SERVICE_DEBIT_ACCOUNT_CODES.filter((code) => !FUND_SCENARIO_BASE_ONLY_CODES.has(code)).map(
    (code) => ({
      code: `RCPT_${code}`,
      label: `${getReceiptFundContraAccountLabel(code)} (Có ${code})`,
      contraAccount: code,
    }),
  );
}

/** Phiếu chi: Nợ TK theo mã, Có 1111/1121 — cùng danh mục mã TK với Phiếu thu / HĐ mua DV. */
export type PaymentFundScenario = { code: string; label: string; contraAccount: string };

export function buildPaymentFundScenariosFromCatalog(): PaymentFundScenario[] {
  return PURCHASE_SERVICE_DEBIT_ACCOUNT_CODES.filter((code) => !FUND_SCENARIO_BASE_ONLY_CODES.has(code)).map(
    (code) => ({
      code: `PMT_${code}`,
      label: `${getReceiptFundContraAccountLabel(code)} (Nợ ${code})`,
      contraAccount: code,
    }),
  );
}

/** Giấy báo Nợ ngân hàng: Nợ TK nghiệp vụ / Có tiền gửi (1121). */
export type BankNoticeScenario = {
  code: string;
  label: string;
  debitAccount: string;
  creditAccount: string;
};

const BANK_NOTICE_DEFAULT_BANK = '1121';

export function buildBankDebitNoticeScenarios(): BankNoticeScenario[] {
  return PURCHASE_SERVICE_DEBIT_ACCOUNT_CODES.map((code) => ({
    code: `BDN_${code}`,
    label: `${getReceiptFundContraAccountLabel(code)} · Nợ nghiệp vụ — Có tiền gửi`,
    debitAccount: code,
    creditAccount: BANK_NOTICE_DEFAULT_BANK,
  }));
}

/** Giấy báo Có ngân hàng: Nợ tiền gửi (1121) / Có TK nghiệp vụ. */
export function buildBankCreditNoticeScenarios(): BankNoticeScenario[] {
  return PURCHASE_SERVICE_DEBIT_ACCOUNT_CODES.map((code) => ({
    code: `BCN_${code}`,
    label: `${getReceiptFundContraAccountLabel(code)} · Nợ tiền gửi — Có nghiệp vụ`,
    debitAccount: BANK_NOTICE_DEFAULT_BANK,
    creditAccount: code,
  }));
}
