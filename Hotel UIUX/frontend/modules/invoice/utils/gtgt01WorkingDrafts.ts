/** Bản làm việc theo kỳ — lưu qua API → SQLite (không dùng localStorage). */
export const GTGT01_WORKING_DRAFTS_KEY = 'victory_gtgt01_working_drafts_by_period_v1';

export type Gtgt01WorkingDraftMap = Record<string, string>;

/**
 * Một kỳ có nhiều ngữ cảnh: lần đầu vs bổ sung lần 1, 2, … — không dùng chung một key.
 * - Lần đầu: `periodKey|FIRST`
 * - Bổ sung: `periodKey|SUP|${số thứ tự}`
 */
export function getGtgt01WorkingDraftKey(
  periodBaselineKey: string,
  filingFirst: boolean,
  supplementaryNo: string,
): string {
  if (filingFirst) return `${periodBaselineKey}|FIRST`;
  const n = String(supplementaryNo ?? '').trim() || '1';
  return `${periodBaselineKey}|SUP|${n}`;
}

/** Chuẩn hóa bản cũ chỉ có key kỳ → key composite (đọc filingFirst / supplementaryNo trong JSON). */
export function migrateLegacyGtgt01WorkingDraftKeys(map: Gtgt01WorkingDraftMap): Gtgt01WorkingDraftMap {
  const next: Gtgt01WorkingDraftMap = { ...map };
  let changed = false;
  for (const k of Object.keys(map)) {
    if (k.includes('|FIRST') || k.includes('|SUP|')) continue;
    const json = map[k];
    if (!json) continue;
    try {
      const o = JSON.parse(json) as { filingFirst?: boolean; supplementaryNo?: string };
      const fk = typeof o.filingFirst === 'boolean' ? o.filingFirst : true;
      const sup = typeof o.supplementaryNo === 'string' ? o.supplementaryNo : '';
      const nk = getGtgt01WorkingDraftKey(k, fk, sup);
      if (nk !== k) {
        if (!next[nk]) next[nk] = json;
        delete next[k];
        changed = true;
      }
    } catch {
      /* ignore */
    }
  }
  return changed ? next : map;
}

export function loadGtgt01WorkingDrafts(): Gtgt01WorkingDraftMap {
  return {};
}

export function saveGtgt01WorkingDrafts(_map: Gtgt01WorkingDraftMap): void {
  /* Server-only: GET/PUT /api/tax/gtgt01/data */
}
