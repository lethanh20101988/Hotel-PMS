/**
 * Chuẩn hóa mã TK từ chi tiết bút toán (TT133) để báo cáo khớp dòng 242, 6422, 214…
 * Hỗ trợ: "242", "242 - Chi phí trả trước", "6422", "2112 - Máy móc".
 */
export function normalizeLedgerAccountCode(raw: unknown): string {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{3,4})/);
  return m ? m[1] : '';
}
