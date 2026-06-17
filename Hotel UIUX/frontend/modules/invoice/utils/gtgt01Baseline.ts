export type BaselinePeriodKind = 'MONTH' | 'QUARTER';

/** Baseline lưu qua API → SQLite (không dùng localStorage). */
export const GTGT01_BASELINE_STORAGE_KEY = 'victory_gtgt01_first_filing_baseline_v1';

export type Gtgt01BaselineRecord = {
  savedAt: string;
  /** Toàn bộ state serialize (giống bản nháp), kỳ vọng filingFirst === true */
  json: string;
};

export type Gtgt01BaselineMap = Record<string, Gtgt01BaselineRecord>;

export function getPeriodBaselineKey(
  periodKind: BaselinePeriodKind,
  year: number,
  month: number,
  quarter: number,
): string {
  if (periodKind === 'MONTH') return `${year}|M|${month}`;
  return `${year}|Q|${quarter}`;
}

/** Kỳ tính thuế liền trước (cùng loại tháng/quý). */
export function getPreviousTaxPeriod(
  periodKind: BaselinePeriodKind,
  year: number,
  month: number,
  quarter: number,
): {
  periodKind: BaselinePeriodKind;
  year: number;
  month: number;
  quarter: number;
  baselineKey: string;
} | null {
  if (periodKind === 'MONTH') {
    const m = Math.min(12, Math.max(1, month));
    if (m <= 1) {
      const y = year - 1;
      return {
        periodKind: 'MONTH',
        year: y,
        month: 12,
        quarter: 1,
        baselineKey: getPeriodBaselineKey('MONTH', y, 12, 1),
      };
    }
    return {
      periodKind: 'MONTH',
      year,
      month: m - 1,
      quarter: 1,
      baselineKey: getPeriodBaselineKey('MONTH', year, m - 1, 1),
    };
  }
  const q = Math.min(4, Math.max(1, quarter));
  if (q <= 1) {
    const y = year - 1;
    return {
      periodKind: 'QUARTER',
      year: y,
      month: 1,
      quarter: 4,
      baselineKey: getPeriodBaselineKey('QUARTER', y, 1, 4),
    };
  }
  return {
    periodKind: 'QUARTER',
    year,
    month: 1,
    quarter: q - 1,
    baselineKey: getPeriodBaselineKey('QUARTER', year, 1, q - 1),
  };
}

export function snapshotJsonMatchesPeriod(
  json: string,
  periodKind: BaselinePeriodKind,
  year: number,
  month: number,
  quarter: number,
): boolean {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (o.periodKind !== periodKind) return false;
    if (Number(o.year) !== year) return false;
    if (periodKind === 'MONTH' && Number(o.month) !== month) return false;
    if (periodKind === 'QUARTER' && Number(o.quarter) !== quarter) return false;
    return true;
  } catch {
    return false;
  }
}

/** [43] từ bản nháp mới nhất (mọi lần đầu/bổ sung) khớp kỳ — dùng so với baseline lần đầu để suy [37]/[38]. */
export function latestSnapshotV43ForPeriod(
  snapshots: { createdAt: string; json: string }[],
  periodKind: BaselinePeriodKind,
  year: number,
  month: number,
  quarter: number,
): number | null {
  const matching = snapshots
    .filter(s => snapshotJsonMatchesPeriod(s.json, periodKind, year, month, quarter))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const top = matching[0];
  if (!top) return null;
  const vals = khbsReportedAmountsFromSnapshotJson(top.json);
  if (!vals) return null;
  return typeof vals['[43]'] === 'number' ? vals['[43]'] : null;
}

export function loadGtgt01Baselines(): Gtgt01BaselineMap {
  return {};
}

export function saveGtgt01Baselines(_map: Gtgt01BaselineMap): void {
  /* Server-only: GET/PUT /api/tax/gtgt01/data */
}

const MAIN_DECL_KEYS = [
  'noActivity',
  'n22',
  'n23',
  'n23a',
  'n24',
  'n24a',
  'n25',
  'n26',
  'n29',
  'n30',
  'n31',
  'n32',
  'n33',
  'n32a',
] as const;

export type MainDeclarationFingerprint = Record<(typeof MAIN_DECL_KEYS)[number], string>;

function parseNum(v: string): number {
  const n = Number(String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function fingerprintFromSnapshotJson(json: string): MainDeclarationFingerprint | null {
  try {
    const o = JSON.parse(json);
    return {
      noActivity: o.noActivity === true ? '1' : '0',
      n22: typeof o.n22 === 'string' ? o.n22 : '',
      n23: typeof o.n23 === 'string' ? o.n23 : '',
      n23a: typeof o.n23a === 'string' ? o.n23a : '',
      n24: typeof o.n24 === 'string' ? o.n24 : '',
      n24a: typeof o.n24a === 'string' ? o.n24a : '',
      n25: typeof o.n25 === 'string' ? o.n25 : '',
      n26: typeof o.n26 === 'string' ? o.n26 : '',
      n29: typeof o.n29 === 'string' ? o.n29 : '',
      n30: typeof o.n30 === 'string' ? o.n30 : '',
      n31: typeof o.n31 === 'string' ? o.n31 : '',
      n32: typeof o.n32 === 'string' ? o.n32 : '',
      n33: typeof o.n33 === 'string' ? o.n33 : '',
      n32a: typeof o.n32a === 'string' ? o.n32a : '',
    };
  } catch {
    return null;
  }
}

export function fingerprintFromLiveState(params: {
  noActivity: boolean;
  n22: string;
  n23: string;
  n23a: string;
  n24: string;
  n24a: string;
  n25: string;
  n26: string;
  n29: string;
  n30: string;
  n31: string;
  n32: string;
  n33: string;
  n32a: string;
}): MainDeclarationFingerprint {
  const p = params;
  return {
    noActivity: p.noActivity ? '1' : '0',
    n22: p.n22,
    n23: p.n23,
    n23a: p.n23a,
    n24: p.n24,
    n24a: p.n24a,
    n25: p.n25,
    n26: p.n26,
    n29: p.n29,
    n30: p.n30,
    n31: p.n31,
    n32: p.n32,
    n33: p.n33,
    n32a: p.n32a,
  };
}

export function mainDeclarationFingerprintsEqual(
  a: MainDeclarationFingerprint,
  b: MainDeclarationFingerprint,
): boolean {
  return MAIN_DECL_KEYS.every(k => (a[k] || '') === (b[k] || ''));
}

/** Giá trị chỉ tiêu để điền cột (4) “Đã kê khai” trên KHBS — từ JSON bản lần đầu */
export function khbsReportedAmountsFromSnapshotJson(json: string): Record<string, number> | null {
  try {
    const o = JSON.parse(json);
    const noActivity = o.noActivity === true;
    const g = (k: string) => (noActivity ? 0 : parseNum(typeof o[k] === 'string' ? o[k] : ''));
    const v22 = g('n22');
    const v25 = g('n25');
    const v26 = g('n26');
    const v29 = g('n29');
    const v30 = g('n30');
    const v31 = g('n31');
    const v32 = g('n32');
    const v33 = g('n33');
    const v32a = g('n32a');
    const v37 = g('n37');
    const v38 = g('n38');
    const v39a = g('n39a');
    const v40b = g('n40b');
    const v42 = g('n42');
    const v27 = v29 + v30 + v32 + v32a;
    const v28 = v31 + v33;
    const v34 = v26 + v27;
    const v35 = v28;
    const v36 = v35 - v25;
    const d = v36 - v22 + v37 - v38 - v39a;
    const v40a = d >= 0 ? d : 0;
    const v41 = d <= 0 ? -d : 0;
    const v40 = v40a - v40b;
    const v43 = v41 - v42;
    return {
      '[36]': v36,
      '[40a]': v40a,
      '[40b]': v40b,
      '[40]': v40,
      '[25]': v25,
      '[22]': v22,
      '[41]': v41,
      '[43]': v43,
      '[42]': v42,
    };
  } catch {
    return null;
  }
}
