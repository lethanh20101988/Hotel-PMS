// Client cho lớp DATA LIFECYCLE (/api/lc/*). Tự đọc token/clientId giống store.
import { getTabClientId } from '../../services/tabClientId';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';
const API_PREFIX = String(API_BASE || '/api').replace(/\/$/, '');

const getToken = () => {
  try {
    return localStorage.getItem('auth_token') || '';
  } catch {
    return '';
  }
};
const getClientId = () => getTabClientId();

export type LifecycleStatus =
  | 'ACTIVE'
  | 'SOFT_DELETED'
  | 'ARCHIVED'
  | 'PENDING_DELETE'
  | 'DELETED';

export type LifecycleRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  status: LifecycleStatus;
  version: number;
  data_json: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  archived_at: string | null;
  purge_after: string | null;
  reason: string | null;
  updated_at: string;
  approved?: number | null;
  requested_by?: string | null;
  requested_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
};

export type MeProfile = {
  id: string;
  role: string;
  email?: string | null;
  username?: string | null;
  permissions: string[];
};

export type RecordVersion = {
  version: number;
  action: string;
  actor_user_id: string | null;
  created_at: string;
};

/**
 * Phiên bản state mới nhất mà server trả về sau một thao tác lifecycle (xóa/khôi phục…).
 * Lifecycle bump state version ở backend; store đọc giá trị này để đồng bộ stateDataVersionRef,
 * tránh PUT /state ngay sau đó bị coi là xung đột (gây hợp nhất sai, mất hoàn tác tồn kho).
 */
let lastLifecycleStateVersion: number | null = null;

export function getLastLifecycleStateVersion(): number | null {
  return lastLifecycleStateVersion;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'X-Client-Id': getClientId(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const verRaw = res.headers.get('X-State-Data-Version');
  if (verRaw != null) {
    const ver = Number(verRaw);
    if (Number.isFinite(ver)) lastLifecycleStateVersion = ver;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { code?: string };
    err.code = data?.code;
    throw err;
  }
  return data as T;
}

export const lifecycleApi = {
  me: () => call<MeProfile>('GET', '/me'),
  listTrash: (type?: string) =>
    call<LifecycleRow[]>('GET', `/lc/trash${type ? `?type=${encodeURIComponent(type)}` : ''}`),
  listArchive: (type?: string) =>
    call<LifecycleRow[]>('GET', `/lc/archive${type ? `?type=${encodeURIComponent(type)}` : ''}`),
  listPendingDelete: (type?: string) =>
    call<LifecycleRow[]>('GET', `/lc/pending-delete${type ? `?type=${encodeURIComponent(type)}` : ''}`),
  restore: (type: string, id: string) => call('POST', `/lc/${type}/${encodeURIComponent(id)}/restore`),
  archive: (type: string, id: string) => call('POST', `/lc/${type}/${encodeURIComponent(id)}/archive`),
  /** Admin: yêu cầu xóa vĩnh viễn (SOFT_DELETED → PENDING_DELETE). */
  requestDelete: (type: string, id: string) =>
    call('POST', `/lc/${type}/${encodeURIComponent(id)}/request-delete`),
  /** Super admin: duyệt yêu cầu xóa. */
  approveDelete: (type: string, id: string) =>
    call('POST', `/lc/${type}/${encodeURIComponent(id)}/approve-delete`),
  /** Super admin: xóa vĩnh viễn (cần confirm = "DELETE"). */
  hardDelete: (type: string, id: string, confirm: string) =>
    call('POST', `/lc/${type}/${encodeURIComponent(id)}/hard-delete`, { confirm }),
  remove: (type: string, id: string, reason?: string) =>
    call('DELETE', `/lc/${type}/${encodeURIComponent(id)}`, reason ? { reason } : undefined),
  versions: (type: string, id: string) =>
    call<RecordVersion[]>('GET', `/lc/${type}/${encodeURIComponent(id)}/versions`),
};

export const HARD_DELETE_CONFIRM_TEXT = 'DELETE';

/** Nhãn tiếng Việt cho entity_type. */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  invoice: 'Hóa đơn',
  voucher: 'Chứng từ',
  fundTransaction: 'Giao dịch quỹ',
  bankAccount: 'Tài khoản ngân hàng',
  inventoryItem: 'Sản phẩm',
  inventoryTransaction: 'Phiếu kho',
  journalEntry: 'Bút toán',
  device: 'Thiết bị',
  asset: 'Tài sản',
  lcTest: '(Test)',
};

export function entityLabel(t: string): string {
  return ENTITY_TYPE_LABELS[t] || t;
}

export function entityTitle(row: LifecycleRow): string {
  try {
    const d = row.data_json ? JSON.parse(row.data_json) : null;
    return (d && (d.name || d.title || d.code || d.documentNumber || d.invoiceNumber)) || row.entity_id;
  } catch {
    return row.entity_id;
  }
}
