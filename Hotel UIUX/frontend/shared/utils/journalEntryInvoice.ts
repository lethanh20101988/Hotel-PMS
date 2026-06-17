import type { Invoice, JournalEntry } from '../types';

const DESCRIPTION_INVOICE_PATTERNS = [
  /HĐ\s*số:\s*([^\s\[\],]+)/i,
  /\[COGS\]\s*Giá vốn từ HĐ\s+([^\s\[\],]+)/i,
  /(?:Thanh toán|Thu tiền)\s+HĐ\s+([^\s\[\],]+)/i,
  /(?:Thanh toán|Thu tiền)\s+hóa đơn\s+([^\s\[\],]+)/i,
  /HĐ\s+([A-Z0-9][A-Z0-9\-_/]*)/i,
] as const;

const pushInvoiceNumber = (target: Set<string>, value?: string) => {
  const no = String(value || '').trim();
  if (no) target.add(no);
};

const parseInvoiceFromDescription = (description: string): string | null => {
  for (const pattern of DESCRIPTION_INVOICE_PATTERNS) {
    const match = description.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
};

const resolveInvoiceIdFromEntryId = (entryId: string): string | null => {
  const id = String(entryId || '').trim();
  if (!id) return null;
  if (id.startsWith('JE-INV-COGS-')) return id.slice('JE-INV-COGS-'.length);
  if (id.startsWith('JE-INV-')) return id.slice('JE-INV-'.length);
  if (id.startsWith('JE-VOU-VOU-INV-PAY-')) return id.slice('JE-VOU-VOU-INV-PAY-'.length);
  if (id.startsWith('JE-VOU-VOU-INV-')) return id.slice('JE-VOU-VOU-INV-'.length);
  return null;
};

/** Lấy danh sách số hóa đơn liên kết với một bút toán nhật ký chung. */
export function resolveJournalEntryInvoiceNumbers(
  entry: JournalEntry,
  invoices?: Invoice[] | null,
): string[] {
  const numbers = new Set<string>();
  const invoiceById = new Map(
    (invoices || []).map((inv) => [String(inv.id || '').trim(), inv]),
  );

  for (const detail of entry.details || []) {
    pushInvoiceNumber(numbers, detail.sourceInvoiceNumber);

    const sourceInvoiceId = String(detail.sourceInvoiceId || '').trim();
    if (sourceInvoiceId) {
      pushInvoiceNumber(numbers, invoiceById.get(sourceInvoiceId)?.invoiceNumber);
    }

    const objectId = String(detail.objectId || '').trim();
    if (objectId) {
      pushInvoiceNumber(numbers, invoiceById.get(objectId)?.invoiceNumber);
    }
  }

  const entryId = String(entry.id || '').trim();
  const linkedInvoiceId = resolveInvoiceIdFromEntryId(entryId);
  if (linkedInvoiceId) {
    pushInvoiceNumber(numbers, invoiceById.get(linkedInvoiceId)?.invoiceNumber);
  }

  if (numbers.size === 0) {
    const ref = String(entry.referenceId || '').trim();
    if (ref) {
      const byRef = invoiceById.get(ref);
      if (byRef?.invoiceNumber) {
        pushInvoiceNumber(numbers, byRef.invoiceNumber);
      } else if (
        entryId.startsWith('JE-INV-') &&
        !ref.startsWith('INV-COGS-') &&
        !ref.startsWith('JE-')
      ) {
        pushInvoiceNumber(numbers, ref);
      }
    }
  }

  if (numbers.size === 0) {
    const parsed = parseInvoiceFromDescription(String(entry.description || ''));
    if (parsed) pushInvoiceNumber(numbers, parsed);
  }

  return Array.from(numbers);
}

export function formatJournalEntryInvoiceLabel(
  entry: JournalEntry,
  invoices?: Invoice[] | null,
): string {
  const numbers = resolveJournalEntryInvoiceNumbers(entry, invoices);
  return numbers.length > 0 ? numbers.join(', ') : '—';
}
