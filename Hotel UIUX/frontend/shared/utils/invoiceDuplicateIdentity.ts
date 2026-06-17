/**
 * Trùng hóa đơn theo yêu cầu nghiệp vụ:
 * - Chặn: cùng số HĐ + ký hiệu + MST đối tác (trên cùng loại mua/bán & thiết bị/dịch vụ).
 * - Cảnh báo (không chặn): cùng số HĐ nhưng khác ký hiệu hoặc khác MST so với một chứng từ đã có.
 */

export type InvoiceIdentityFields = {
  formNo?: string;
  symbolCode?: string;
  invoiceNumber?: string;
  buyerTaxCode?: string;
  date?: string;
};

export function normInvoiceText(s?: string | null): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normInvoiceTaxDigits(s?: string | null): string {
  return String(s ?? '').replace(/[^0-9]/g, '');
}

export function normInvoiceNumberKey(s?: string | null): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function invoiceCalendarYear(date?: string): string {
  const d = String(date || '').split('T')[0];
  return d.length >= 4 ? d.slice(0, 4) : '';
}

/** Trùng cần chặn nhập/lưu: Số HĐ + Ký hiệu + MST (đối tác lưu ở buyerTaxCode cho cả mua và bán). */
export function strictInvoiceDuplicateKey(inv: InvoiceIdentityFields): string {
  return [
    normInvoiceNumberKey(inv.invoiceNumber),
    normInvoiceText(inv.symbolCode),
    normInvoiceTaxDigits(inv.buyerTaxCode ?? ''),
  ].join('\u0001');
}

export function findStrictDuplicateInvoice<T extends InvoiceIdentityFields & { id?: string }>(
  candidate: InvoiceIdentityFields,
  list: readonly T[],
  excludeId?: string,
): T | undefined {
  const key = strictInvoiceDuplicateKey(candidate);
  if (!normInvoiceNumberKey(candidate.invoiceNumber)) return undefined;
  for (const inv of list) {
    if (excludeId != null && String(inv.id) === String(excludeId)) continue;
    if (strictInvoiceDuplicateKey(inv) === key) return inv;
  }
  return undefined;
}

/** Cùng số HĐ với một chứng từ khác nhưng khác ký hiệu hoặc MST — chỉ để cảnh báo. */
export function findSoftDuplicateSameNumber<T extends InvoiceIdentityFields & { id?: string }>(
  candidate: InvoiceIdentityFields,
  list: readonly T[],
  excludeId?: string,
): T | undefined {
  const cStrict = strictInvoiceDuplicateKey(candidate);
  const cNum = normInvoiceNumberKey(candidate.invoiceNumber);
  if (!cNum) return undefined;
  for (const inv of list) {
    if (excludeId != null && String(inv.id) === String(excludeId)) continue;
    if (normInvoiceNumberKey(inv.invoiceNumber) !== cNum) continue;
    if (strictInvoiceDuplicateKey(inv) === cStrict) continue;
    return inv;
  }
  return undefined;
}
