import type { Gtgt01BaselineMap } from './gtgt01Baseline';
import type { Pl204AnnexFormState } from './vatPl204AnnexState';
import type { Gtgt01WorkingDraftMap } from './gtgt01WorkingDrafts';

export const TAX_GTGT01_PAYLOAD_VERSION = 1;

export type TaxGtgt01SnapshotLike = {
  id: string;
  createdAt: string;
  label: string;
  json: string;
  /** Liên kết bản bổ sung với bản tờ khai gốc (KHBS / điều chỉnh) */
  parentSnapshotId?: string;
};

export type TaxGtgt01PersistPayload = {
  version: number;
  snapshots: TaxGtgt01SnapshotLike[];
  baselines: Gtgt01BaselineMap;
  pl204ByPeriod: Record<string, Pl204AnnexFormState>;
  workingDrafts: Gtgt01WorkingDraftMap;
};

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';

export async function fetchTaxGtgt01Payload(): Promise<{
  payload: TaxGtgt01PersistPayload | null;
  updatedAt: string | null;
}> {
  const r = await fetch(`${API_BASE}/tax/gtgt01/data`);
  if (!r.ok) throw new Error('fetchTaxGtgt01Payload failed');
  return r.json();
}

/** Ghi lên SQLite qua API; JWT là tùy chọn (cùng chính sách với GET /api/tax/gtgt01/data). */
export async function putTaxGtgt01Payload(body: TaxGtgt01PersistPayload): Promise<boolean> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : '';
  const clientId = (() => {
    try {
      return localStorage.getItem('vtr_client_id') || '';
    } catch {
      return '';
    }
  })();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (clientId) headers['X-Client-Id'] = clientId;
  const r = await fetch(`${API_BASE}/tax/gtgt01/data`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return r.ok;
}
