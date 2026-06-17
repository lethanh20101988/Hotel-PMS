import type { InventoryItem, Invoice, JournalEntry, JournalEntryDetail } from '../types';
import { roundVnd } from './vndMoney';

const normalizeLookupKey = (value?: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

type InventoryLookupRow = {
  item: InventoryItem;
  normName: string;
  normSku: string;
};

const isWarehouseSalesInvoiceId = (id?: string) =>
  /^INV-SALES-BATCH-/.test(String(id || '')) || /^INV-SALES-TRX-/.test(String(id || ''));

const isRenewalSalesInvoiceId = (id?: string) => /^INV-REN-/.test(String(id || ''));

const resolveInventoryItemForInvoiceDetail = (detail: Invoice['details'][number], inventory: InventoryLookupRow[]) => {
  const directId = String((detail as any)?.inventoryItemId || '').trim();
  if (directId) {
    const found = inventory.find((x) => String(x.item.id) === directId);
    return found?.item || null;
  }

  const prodKey = normalizeLookupKey(detail.productName);
  if (!prodKey) return null;

  let best:
    | {
        item: InventoryItem;
        score: number;
      }
    | undefined;

  for (const row of inventory) {
    const { item, normName, normSku } = row;
    if (!normName && !normSku) continue;

    let score = 0;
    if (prodKey && normName && prodKey === normName) score = Math.max(score, 6);
    if (prodKey && normSku && prodKey === normSku) score = Math.max(score, 6);

    // Prefer exact/near-exact includes.
    if (normSku && prodKey.includes(normSku)) score = Math.max(score, 4);
    if (normName && prodKey.includes(normName)) score = Math.max(score, 3);

    // Less strict direction checks.
    if (normSku && normSku.includes(prodKey)) score = Math.max(score, 2);
    if (normName && normName.includes(prodKey)) score = Math.max(score, 1);

    if (!best || score > best.score) {
      best = { item, score };
    }
  }

  if (!best || best.score < 2) return null;
  return best.item || null;
};

export type InvoiceCogsBuildResult = {
  journalEntry: JournalEntry | null;
  issues: string[];
  expectedTotal: number;
  costDebitAccount: string;
};

/**
 * Build deterministic COGS journal entry for invoice module (real-time layer).
 * - Computes costs from sales invoice `details` lines of type `GOODS` and `SERVICE`.
 * - Maps `InvoiceDetail.productName` -> `inventoryCatalog` item using normalized matching.
 * - Skips warehouse-generated invoices and renewal sales invoices (cost comes from purchase side).
 */
export function buildInvoiceCogsJournalEntry(
  invoice: Invoice,
  inventoryCatalog: InventoryItem[],
  ledgerDate: string,
): InvoiceCogsBuildResult {
  const invoiceId = String(invoice?.id || '');
  const costDebitAccount = invoice.crossPeriodMeta?.materiality === 'MATERIAL' ? '421' : '632';

  if (invoice.type !== 'SALES') {
    return { journalEntry: null, issues: [], expectedTotal: 0, costDebitAccount };
  }
  if (isWarehouseSalesInvoiceId(invoiceId)) {
    return { journalEntry: null, issues: [], expectedTotal: 0, costDebitAccount };
  }
  if (isRenewalSalesInvoiceId(invoiceId)) {
    return { journalEntry: null, issues: [], expectedTotal: 0, costDebitAccount };
  }

  const cogsLines = (Array.isArray(invoice.details) ? invoice.details : []).filter(
    (d) => (String(d?.type || '') === 'GOODS' || String(d?.type || '') === 'SERVICE') && Number(d?.quantity || 0) > 0,
  );
  if (cogsLines.length === 0) {
    return { journalEntry: null, issues: [], expectedTotal: 0, costDebitAccount };
  }

  const inventoryLookup: InventoryLookupRow[] = (inventoryCatalog || []).map((item) => ({
    item,
    normName: normalizeLookupKey(item.name),
    normSku: normalizeLookupKey(item.sku),
  }));

  const issues: string[] = [];
  const details: JournalEntryDetail[] = [];
  let expectedTotal = 0;

  for (const d of cogsLines) {
    const inv = resolveInventoryItemForInvoiceDetail(d, inventoryLookup);
    if (!inv) {
      issues.push(
        `Không map được vật tư cho dòng: "${String(d?.productName || '').trim()}" (HĐ ${invoice.invoiceNumber || invoice.id})`,
      );
      continue;
    }

    const qty = Number(d.quantity || 0);
    const costValue = roundVnd(qty * Number(inv.costPrice || 0));
    if (costValue <= 0) continue;

    expectedTotal += costValue;

    const invCreditAcc = inv.accountCode || '156';
    const sourceInvoiceId = invoice.id;
    const sourceInvoiceNumber = invoice.invoiceNumber;

    details.push({
      account: costDebitAccount,
      debit: costValue,
      credit: 0,
      sourceInvoiceId,
      sourceInvoiceNumber,
    });
    details.push({
      account: invCreditAcc,
      debit: 0,
      credit: costValue,
      sourceInvoiceId,
      sourceInvoiceNumber,
    });
  }

  // If any goods line couldn't be mapped, refuse to create partial COGS.
  if (issues.length > 0) {
    return { journalEntry: null, issues, expectedTotal: 0, costDebitAccount };
  }

  if (expectedTotal <= 0 || details.length === 0) {
    return { journalEntry: null, issues: [], expectedTotal: 0, costDebitAccount };
  }

  const invoiceRef = String(invoice.invoiceNumber || invoice.id || '').trim();
  return {
    journalEntry: {
      id: `JE-INV-COGS-${invoiceId}`,
      date: ledgerDate,
      referenceId: `INV-COGS-${invoiceId}`,
      description: `[COGS] Giá vốn từ HĐ ${invoiceRef}`,
      details,
    },
    issues: [],
    expectedTotal,
    costDebitAccount,
  };
}

