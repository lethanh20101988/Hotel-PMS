/**
 * Làm tròn giá trị tiền VND đến đơn vị đồng (0 chữ số thập phân).
 * Half-up: chữ số cần bỏ < 5 → bỏ; ≥ 5 → tăng 1 đơn vị ở chữ số liền trước
 * (số dương: tương đương Math.round).
 */
export function roundVnd(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/**
 * Chuẩn hóa tổng hóa đơn sau khi đã cộng dòng (số thập phân): một lần half-up ở cuối.
 * Đảm bảo amount + vatAmount === totalAmount (đồng).
 */
export function roundInvoiceTotalsFromSums(sumNet: number, sumVat: number): {
  amount: number;
  vatAmount: number;
  totalAmount: number;
} {
  const sn = Number(sumNet) || 0;
  const sv = Number(sumVat) || 0;
  const totalAmount = roundVnd(sn + sv);
  const amount = roundVnd(sn);
  const vatAmount = totalAmount - amount;
  return { amount, vatAmount, totalAmount };
}

/**
 * Phân bổ số đồng đã làm tròn xuống từng dòng theo tỷ trọng (số dương), dư phần lớn nhất.
 */
export function allocateRoundedTotal(weights: number[], totalRounded: number): number[] {
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const tr = roundVnd(totalRounded);
  if (w.length === 0) return [];
  const s = w.reduce((a, b) => a + b, 0);
  if (s <= 0) {
    if (tr <= 0) return w.map(() => 0);
    const out = w.map(() => 0);
    out[0] = tr;
    return out;
  }
  const exact = w.map((wi) => (wi / s) * tr);
  const floors = exact.map((x) => Math.floor(x));
  let rem = tr - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; k < rem; k++) out[order[k].i]++;
  return out;
}
