/**
 * Cầu nối giữa store (màn nghiệp vụ) và API lifecycle (/api/lc/*).
 * Mọi xóa mềm từ UI phải đi qua đây để bản ghi xuất hiện trong Thùng rác / Lưu trữ / Chờ xóa.
 */
import { lifecycleApi, getLastLifecycleStateVersion } from './lifecycleClient';

export { getLastLifecycleStateVersion };

/** Map tên mảng / key trong store → entity_type của lifecycle backend. */
export const STORE_TO_LC_TYPE: Record<string, string> = {
  invoices: 'invoice',
  accountingVouchers: 'voucher',
  fundTransactions: 'fundTransaction',
  bankAccounts: 'bankAccount',
  inventory: 'inventoryItem',
  transactions: 'inventoryTransaction',
  devices: 'device',
  assets: 'asset',
  journalEntries: 'journalEntry',
};

export type LifecycleSoftDeleteResult = { ok: true } | { ok: false; error: string; code?: string };

export async function callLifecycleSoftDelete(
  storeEntityType: string,
  entityId: string,
  reason?: string,
): Promise<LifecycleSoftDeleteResult> {
  const lcType = STORE_TO_LC_TYPE[storeEntityType];
  if (!lcType) {
    return { ok: false, error: `Loại dữ liệu chưa hỗ trợ thùng rác: ${storeEntityType}` };
  }
  const id = String(entityId || '').trim();
  if (!id) return { ok: false, error: 'Thiếu id bản ghi' };
  try {
    window.dispatchEvent(new CustomEvent('vtr:lifecycle-mutation-start'));
  } catch {
    // ignore
  }
  try {
    await lifecycleApi.remove(lcType, id, reason);
    return { ok: true };
  } catch (e: unknown) {
    const err = e as Error & { code?: string };
    return { ok: false, error: err?.message || String(e), code: err?.code };
  } finally {
    // Báo cho store biết lifecycle đã xong để: (1) đồng bộ lại phiên bản state mới,
    // (2) kích hoạt lại lần persist đã bị 'mutation-start' hủy — nhờ đó các thay đổi
    // blob đi kèm (vd: hoàn tác số lượng tồn kho) mới được lưu lên server.
    try {
      window.dispatchEvent(new CustomEvent('vtr:lifecycle-mutation-end'));
    } catch {
      // ignore
    }
  }
}

/** Gọi soft-delete cho nhiều bản ghi (cascade). Bỏ qua NOT_FOUND (đã xóa trước đó). */
export async function callLifecycleSoftDeleteMany(
  items: Array<{ storeType: string; id: string }>,
  reason?: string,
): Promise<LifecycleSoftDeleteResult> {
  const errors: string[] = [];
  for (const { storeType, id } of items) {
    const r = await callLifecycleSoftDelete(storeType, id, reason);
    if (!r.ok && r.code !== 'NOT_FOUND') {
      errors.push(`${storeType}/${id}: ${r.error}`);
    }
  }
  if (errors.length) return { ok: false, error: errors.join('; ') };
  return { ok: true };
}

/** Thông báo ngắn sau khi xóa mềm thành công. */
export function notifySoftDeleted(label?: string) {
  const msg = label
    ? `Đã chuyển "${label}" vào Thùng rác. Xem tab Vòng đời dữ liệu → Thùng rác.`
    : 'Đã chuyển bản ghi vào Thùng rác. Xem tab Vòng đời dữ liệu → Thùng rác.';
  try {
    window.dispatchEvent(new CustomEvent('vtr:lifecycle-soft-deleted', { detail: { message: msg } }));
  } catch {
    // ignore
  }
}
