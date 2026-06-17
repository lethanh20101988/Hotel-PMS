/**
 * Gợi ý tên KH / NCC / đối tượng chứng từ — logic thuần (dữ liệu lưu trong AppState → SQLite VictoryData).
 */

export type PartnerNameKind = 'customer' | 'supplier' | 'contact';

export type PartnerNameHistoryState = Record<PartnerNameKind, string[]>;

export const EMPTY_PARTNER_NAME_HISTORY: PartnerNameHistoryState = {
  customer: [],
  supplier: [],
  contact: [],
};

export const MAX_PARTNER_NAMES_PER_KIND = 80;

const PLACEHOLDER_LOWER = new Set(
  [
    'khách hàng',
    'khách hàng lẻ',
    'khách hàng mẫu',
    'khách lẻ',
    'nhà cung cấp',
    'nhà cung cấp lẻ',
    'nhà cung cấp chưa rõ',
    'nhà cung cấp mẫu',
    'nhà cung cấp tài sản',
    'nhà cung cấp dịch vụ',
    '---',
    '—',
    '',
  ].map((s) => s.toLowerCase()),
);

export function normalizePartnerName(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function parsePartnerNameHistoryFromPersist(raw: unknown): PartnerNameHistoryState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...EMPTY_PARTNER_NAME_HISTORY };
  }
  const o = raw as Record<string, unknown>;
  const col = (k: PartnerNameKind): string[] => {
    const a = o[k];
    if (!Array.isArray(a)) return [];
    return a.filter((x): x is string => typeof x === 'string').map(normalizePartnerName).filter(Boolean);
  };
  return {
    customer: col('customer'),
    supplier: col('supplier'),
    contact: col('contact'),
  };
}

/** Gộp hai bản ghi lịch sử (vd. import một lần từ localStorage cũ). */
export function mergePartnerNameHistoryImports(
  a: PartnerNameHistoryState,
  b: PartnerNameHistoryState,
): PartnerNameHistoryState {
  const kinds: PartnerNameKind[] = ['customer', 'supplier', 'contact'];
  const out: PartnerNameHistoryState = { ...EMPTY_PARTNER_NAME_HISTORY };
  for (const k of kinds) {
    const seen = new Set<string>();
    const list: string[] = [];
    const push = (s: string) => {
      const t = normalizePartnerName(s);
      if (!t) return;
      const low = t.toLowerCase();
      if (seen.has(low)) return;
      seen.add(low);
      list.push(t);
    };
    for (const x of a[k] || []) push(x);
    for (const x of b[k] || []) push(x);
    out[k] = list.slice(0, MAX_PARTNER_NAMES_PER_KIND);
  }
  return out;
}

/** Thêm một tên vào lịch sử (immutable). */
export function rememberPartnerNameReducer(
  prev: PartnerNameHistoryState,
  kind: PartnerNameKind,
  raw: string,
): PartnerNameHistoryState {
  const n = normalizePartnerName(raw);
  if (n.length < 2) return prev;
  const low = n.toLowerCase();
  if (PLACEHOLDER_LOWER.has(low)) return prev;

  const list = prev[kind];
  const filtered = list.filter((x) => x.toLowerCase() !== low);
  const merged = [n, ...filtered].slice(0, MAX_PARTNER_NAMES_PER_KIND);
  if (merged.length === list.length && merged[0] === list[0]) return prev;
  return { ...prev, [kind]: merged };
}

/**
 * Hợp danh mục + lịch sử đã lưu, không trùng (không phân biệt hoa thường).
 */
export function mergePartnerNameSuggestions(
  kind: PartnerNameKind,
  catalogNames: string[],
  history: PartnerNameHistoryState,
): string[] {
  const recent = history[kind] || [];
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (s: string) => {
    const t = normalizePartnerName(s);
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };

  for (const c of catalogNames) push(c);
  for (const r of recent) push(r);
  return out;
}
