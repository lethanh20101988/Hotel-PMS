/** Map lifecycle entity_type → key mảng trong AppState / store. */
export const LC_TYPE_TO_STORE: Record<string, string> = {
  invoice: 'invoices',
  voucher: 'accountingVouchers',
  fundTransaction: 'fundTransactions',
  bankAccount: 'bankAccounts',
  inventoryItem: 'inventory',
  inventoryTransaction: 'transactions',
  device: 'devices',
  asset: 'assets',
  journalEntry: 'journalEntries',
};

export type LifecycleRemoteEntity = {
  action: string;
  entityType: string;
  entityId: string;
};

const REMOVE_FROM_ACTIVE_ACTIONS = new Set([
  'DATA_SOFT_DELETED',
  'DATA_ARCHIVED',
  'DATA_DELETE_REQUESTED',
  'DATA_DELETE_APPROVED',
  'DATA_DELETED',
  'DATA_PURGED',
]);

/**
 * Áp dụng ngay trên store local khi nhận WS lifecycle — không cần GET /api/state.
 * Trả true nếu đã xử lý (bỏ qua full reload).
 */
export function tryApplyLifecycleRemoteEntity(
  entity: LifecycleRemoteEntity,
  removeFromStoreArray: (storeKey: string, entityId: string) => void,
  purgeJournalsForEntity?: (entityType: string, entityId: string) => void,
): boolean {
  const storeKey = LC_TYPE_TO_STORE[entity.entityType];
  if (!storeKey || !entity.entityId) return false;
  if (!REMOVE_FROM_ACTIVE_ACTIONS.has(entity.action)) return false;
  const entityId = String(entity.entityId);
  removeFromStoreArray(storeKey, entityId);
  purgeJournalsForEntity?.(entity.entityType, entityId);
  return true;
}
