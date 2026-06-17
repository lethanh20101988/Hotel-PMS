/** Quy tắc gỡ bút toán Sổ NKC khi lifecycle xóa entity — đồng bộ với frontend journalEntryLifecycleCascade.ts */
type JournalEntryLike = {
  id?: string;
  referenceId?: string;
  description?: string;
  details?: unknown[];
};

const jeId = (je: JournalEntryLike) => String(je.id || "");
const jeRef = (je: JournalEntryLike) => String(je.referenceId || "");
const jeDesc = (je: JournalEntryLike) => String(je.description || "");

function journalDetailsReferenceInvoice(
  je: JournalEntryLike,
  invId: string,
  invoiceRef: string,
): boolean {
  const details = je.details;
  if (!Array.isArray(details)) return false;
  for (const raw of details) {
    const row = raw as Record<string, unknown>;
    const src = String(row.sourceInvoiceId || "").trim();
    const obj = String(row.objectId || "").trim();
    if (src === invId || obj === invId) return true;
    if (invoiceRef && String(row.sourceInvoiceNumber || "").trim() === invoiceRef) return true;
  }
  return false;
}

function getInvoiceLinkedJournalEntryIds(invId: string): string[] {
  const id = String(invId || "").trim();
  if (!id) return [];
  const linkedVoucherId = `VOU-INV-${id}`;
  const separatePaymentVoucherId = `VOU-INV-PAY-${id}`;
  const separatePaymentFundId = `FT-INV-PAY-${id}`;
  return [
    `JE-INV-${id}`,
    `JE-INV-COGS-${id}`,
    `JE-VOU-${linkedVoucherId}`,
    `JE-VOU-${separatePaymentVoucherId}`,
    `JE-VOU-INV-${id}`,
    `JE-VOU-INV-PAY-${id}`,
    `JE-FT-FT-INV-${id}`,
    `JE-FT-${separatePaymentFundId}`,
  ];
}

function shouldRemoveJournalForInvoice(invId: string, invoiceNumber: string | undefined, je: JournalEntryLike): boolean {
  const invIdStr = String(invId);
  const invoiceRef = String(invoiceNumber || invIdStr).trim();
  const invoiceRefEqualsId = !invoiceRef || invoiceRef === invIdStr;
  const voucherId = `VOU-INV-${invIdStr}`;
  const separatePaymentVoucherId = `VOU-INV-PAY-${invIdStr}`;
  const voucherRefs = new Set([
    voucherId,
    separatePaymentVoucherId,
    `UNC-${invoiceRef}`,
    `PC-${invoiceRef}`,
    `BC-${invoiceRef}`,
    `PT-${invoiceRef}`,
  ]);
  const mPurBatch = invIdStr.match(/^INV-PUR-BATCH-(.+)$/);
  const mSalesBatch = invIdStr.match(/^INV-SALES-BATCH-(.+)$/);
  const batchId = String((mPurBatch?.[1] || mSalesBatch?.[1] || "").trim());
  const mTrx = invIdStr.match(/^INV-(PUR|SALES)-(TRX-[A-Za-z0-9-]+)/);
  const trxId = mTrx?.[2] || "";
  const id = jeId(je);
  const ref = jeRef(je);
  const desc = jeDesc(je);
  if (id === `JE-INV-${invIdStr}`) {
    if (invoiceRefEqualsId) return true;
    return ref === invoiceRef || desc.includes(invoiceRef);
  }
  if (id === `JE-INV-COGS-${invIdStr}`) return true;
  if (id.startsWith(`JE-PAY-INV-${invIdStr}-`)) {
    if (invoiceRefEqualsId) return true;
    return ref === invoiceRef || desc.includes(invoiceRef);
  }
  if (id === `JE-VOU-${voucherId}`) {
    if (invoiceRefEqualsId) return true;
    return voucherRefs.has(ref) || desc.includes(invoiceRef);
  }
  if (id === `JE-VOU-${separatePaymentVoucherId}`) {
    if (invoiceRefEqualsId) return true;
    return voucherRefs.has(ref) || desc.includes(invoiceRef);
  }
  if (trxId) {
    if (id === `JE-IM-${trxId}`) return true;
    if (id === `JE-EX-COST-${trxId}`) return true;
    if (id === `JE-EX-REV-${trxId}`) return true;
  }
  if (batchId) {
    if (id === `JE-IM-BATCH-${batchId}`) return true;
    if (id === `JE-EX-COST-BATCH-${batchId}`) return true;
    if (id === `JE-EX-REV-BATCH-${batchId}`) return true;
    if (id === `JE-FT-FT-PUR-BATCH-${batchId}`) return true;
    if (id === `JE-FT-FT-SALES-BATCH-${batchId}`) return true;
  }
  if (trxId) {
    if (id === `JE-FT-FT-PUR-${trxId}`) return true;
    if (id === `JE-FT-FT-SALES-${trxId}`) return true;
  }
  for (const linkedId of getInvoiceLinkedJournalEntryIds(invIdStr)) {
    if (id === linkedId) return true;
  }
  if (id === `JE-FT-FT-INV-${invIdStr}`) return true;
  if (ref === invIdStr) return true;
  if (invoiceRef && ref === invoiceRef) return true;
  if (journalDetailsReferenceInvoice(je, invIdStr, invoiceRef)) return true;
  return false;
}

function shouldRemoveJournalForInventoryItem(
  itemId: string,
  snapshot: Record<string, unknown> | null | undefined,
  je: JournalEntryLike,
): boolean {
  const id = String(itemId || "").trim();
  if (!id) return false;
  const sku = String(snapshot?.sku || "").trim();
  const name = String(snapshot?.name || "").trim();
  const jeIdStr = jeId(je);
  const desc = jeDesc(je);
  const ref = jeRef(je);
  if (jeIdStr.includes(id) || ref === id) return true;
  const details = je.details;
  if (Array.isArray(details)) {
    for (const raw of details) {
      const row = raw as Record<string, unknown>;
      const costObjId = String(row.costObjectId || row.objectId || "").trim();
      if (costObjId === id) return true;
    }
  }
  if (sku && (desc.includes(sku) || ref.includes(sku) || jeIdStr.includes(sku))) return true;
  if (name && desc.includes(name)) return true;
  return false;
}

function shouldRemoveJournalForAsset(
  assetId: string,
  snapshot: Record<string, unknown> | null | undefined,
  je: JournalEntryLike,
): boolean {
  const id = String(assetId);
  const assetCode = String(snapshot?.code || "");
  const assetName = String(snapshot?.name || "");
  const jeIdStr = jeId(je);
  const ref = jeRef(je);
  if (jeIdStr.startsWith(`JE-ASSET-INC-${id}`)) return true;
  if (jeIdStr.startsWith(`JE-CCDC-USE-${id}`)) return true;
  if (jeIdStr.startsWith(`JE-ASSET-LIQ-CATCHUP-${id}`)) return true;
  if (jeIdStr.startsWith(`JE-ASSET-LIQ-WRITEOFF-${id}`)) return true;
  if (jeIdStr.startsWith(`JE-ASSET-LIQ-SALE-${id}`)) return true;
  if (jeIdStr.startsWith(`JE-ASSET-DEPR-AUTO-${id}`)) return true;
  if (jeIdStr.startsWith(`JE-DEPR-${id}-`)) return true;
  if (ref === `ASSET-LIQ-CATCHUP-${id}`) return true;
  if (ref === `ASSET-LIQ-WRITEOFF-${id}`) return true;
  if (ref === `ASSET-LIQ-SALE-${id}`) return true;
  if (assetCode && (ref === assetCode || ref === id) && !jeDesc(je).includes("[GV]")) {
    if (jeDesc(je).includes(assetName) || jeIdStr.includes(id)) return true;
  }
  return false;
}

function shouldRemoveJournalForDevice(
  deviceId: string,
  snapshot: Record<string, unknown> | null | undefined,
  je: JournalEntryLike,
): boolean {
  const id = String(deviceId);
  const imei = String(snapshot?.imei || "");
  const name = String(snapshot?.name || "");
  const jeIdStr = jeId(je);
  const ref = jeRef(je);
  const desc = jeDesc(je);
  if (jeIdStr.includes(id) || ref === id) return true;
  if (imei && (desc.includes(imei) || ref.includes(imei) || jeIdStr.includes(imei))) return true;
  if (name && desc.includes(name)) return true;
  return false;
}

function shouldRemoveJournalForInventoryTransaction(
  trxId: string,
  snapshot: Record<string, unknown> | null | undefined,
  je: JournalEntryLike,
): boolean {
  const id = String(trxId);
  const batchId = String((snapshot as { batchId?: string })?.batchId || "").trim();
  const jeIdStr = jeId(je);
  if (jeIdStr === `JE-IM-${id}`) return true;
  if (jeIdStr === `JE-EX-COST-${id}`) return true;
  if (jeIdStr === `JE-EX-REV-${id}`) return true;
  if (batchId) {
    if (jeIdStr === `JE-IM-BATCH-${batchId}`) return true;
    if (jeIdStr === `JE-EX-COST-BATCH-${batchId}`) return true;
    if (jeIdStr === `JE-EX-REV-BATCH-${batchId}`) return true;
  }
  const ref = jeRef(je);
  const vn = String(snapshot?.voucherNumber || "");
  const dr = String(snapshot?.documentRef || "");
  if (vn && ref === vn) return true;
  if (dr && ref === dr) return true;
  return false;
}

export function shouldRemoveJournalForLifecycleEntity(
  entityType: string,
  entityId: string,
  je: JournalEntryLike,
  snapshot?: Record<string, unknown> | null,
): boolean {
  const id = String(entityId);
  const jeIdStr = jeId(je);
  const ref = jeRef(je);
  switch (entityType) {
    case "journalEntry":
      return jeIdStr === id;
    case "invoice":
      return shouldRemoveJournalForInvoice(
        id,
        snapshot?.invoiceNumber != null ? String(snapshot.invoiceNumber) : undefined,
        je,
      );
    case "voucher":
      const vNo = snapshot?.voucherNumber != null ? String(snapshot.voucherNumber) : undefined;
      return ref === id || (vNo && ref === vNo) || jeIdStr === `JE-VOU-${id}`;
    case "fundTransaction":
      const ftRef = String(snapshot?.voucherNumber || snapshot?.referenceDoc || id);
      return jeIdStr === `JE-FT-${id}` || ref === ftRef || ref === id;
    case "asset":
      return shouldRemoveJournalForAsset(id, snapshot, je);
    case "device":
      return shouldRemoveJournalForDevice(id, snapshot, je);
    case "inventoryTransaction":
      return shouldRemoveJournalForInventoryTransaction(id, snapshot, je);
    case "inventoryItem":
      return shouldRemoveJournalForInventoryItem(id, snapshot, je);
    default:
      return false;
  }
}

function filterJournalList(
  entries: JournalEntryLike[],
  entityType: string,
  entityId: string,
  snapshot?: Record<string, unknown> | null,
): JournalEntryLike[] {
  return entries.filter(
    (je) => !shouldRemoveJournalForLifecycleEntity(entityType, entityId, je, snapshot),
  );
}

function findDeviceRenewalInvoiceIds(
  invoices: Array<{ id?: string }>,
  snapshot: Record<string, unknown> | null | undefined,
): string[] {
  const imei = String(snapshot?.imei || "").trim();
  const name = String(snapshot?.name || "").trim();
  const deviceId = String(snapshot?.id || "").trim();
  const out: string[] = [];
  for (const inv of invoices) {
    const invId = String(inv.id || "");
    if (!/^INV-(PUR-)?REN-/.test(invId)) continue;
    const blob = JSON.stringify(inv);
    if (deviceId && blob.includes(deviceId)) {
      out.push(invId);
      continue;
    }
    if (imei && blob.includes(imei)) {
      out.push(invId);
      continue;
    }
    if (name && blob.includes(name)) out.push(invId);
  }
  return out;
}

/** Gỡ một bút toán theo id khỏi journalEntries và mọi yearDataByKey. */
export function removeJournalEntryIdFromAppState(state: Record<string, unknown>, jeId: string): void {
  const id = String(jeId);
  const filter = (entries: JournalEntryLike[]) =>
    Array.isArray(entries) ? entries.filter((je) => String(je.id || "") !== id) : entries;
  if (Array.isArray(state.journalEntries)) {
    state.journalEntries = filter(state.journalEntries as JournalEntryLike[]);
  }
  const ydMap = state.yearDataByKey;
  if (ydMap && typeof ydMap === "object") {
    for (const yk of Object.keys(ydMap as Record<string, unknown>)) {
      const yd = (ydMap as Record<string, unknown>)[yk];
      if (!yd || typeof yd !== "object") continue;
      const slice = yd as { journalEntries?: JournalEntryLike[] };
      if (Array.isArray(slice.journalEntries)) {
        slice.journalEntries = filter(slice.journalEntries);
      }
    }
  }
}

/** Gỡ bút toán liên quan entity khỏi toàn bộ AppState (journalEntries + yearDataByKey). */
export function purgeJournalEntriesInAppState(
  state: Record<string, unknown>,
  entityType: string,
  entityId: string,
  snapshot?: Record<string, unknown> | null,
): void {
  const snap = snapshot ?? null;
  if (Array.isArray(state.journalEntries)) {
    state.journalEntries = filterJournalList(state.journalEntries as JournalEntryLike[], entityType, entityId, snap);
  }
  const ydMap = state.yearDataByKey;
  if (ydMap && typeof ydMap === "object") {
    for (const yk of Object.keys(ydMap as Record<string, unknown>)) {
      const yd = (ydMap as Record<string, unknown>)[yk];
      if (!yd || typeof yd !== "object") continue;
      const slice = yd as { journalEntries?: JournalEntryLike[] };
      if (Array.isArray(slice.journalEntries)) {
        slice.journalEntries = filterJournalList(slice.journalEntries, entityType, entityId, snap);
      }
    }
  }

  if (entityType === "device" && snap && Array.isArray(state.invoices)) {
    const renewalIds = findDeviceRenewalInvoiceIds(state.invoices as Array<{ id?: string }>, snap);
    for (const invId of renewalIds) {
      const inv = (state.invoices as Array<Record<string, unknown>>).find((x) => String(x.id) === invId);
      purgeJournalEntriesInAppState(state, "invoice", invId, inv ?? null);
    }
  }
}
