import type { Asset, FinancialYear, JournalEntry } from '../../types';
import { DepreciationEngine } from '../../assetScheduleEngine';
import { getOpeningCarryForwardAccumulated } from '../../engines/assetLedger';

export type Tt58S4bLedgerRowKind =
  | 'group_header'
  | 'opening_carry'
  | 'increase'
  | 'depreciation'
  | 'disposal'
  | 'group_total';

export type Tt58S4bLedgerRow = {
  kind: Tt58S4bLedgerRowKind;
  docNo?: string;
  docDate?: string;
  description: string;
  useMonthYear?: string;
  originalCost?: number;
  annualDepreciationRate?: number;
  periodDepreciation?: number;
  accumulatedDepreciation?: number;
  disposalDocNo?: string;
  disposalDocDate?: string;
  disposalReason?: string;
  bold?: boolean;
};

export type Tt58S4bAssetGroup = {
  groupId: string;
  groupLabel: string;
  rows: Tt58S4bLedgerRow[];
};

export type Tt58S4bDnsnLedgerData = {
  groups: Tt58S4bAssetGroup[];
  year: number;
};

export const TT58_S4B_HEADERS = [
  'Số hiệu',
  'Ngày, tháng',
  'Tên, đặc điểm, ký hiệu TSCĐ',
  'Tháng, năm đưa vào sử dụng',
  'Nguyên giá TSCĐ',
  'Tỷ lệ khấu hao (%)',
  'Khấu hao trong kỳ',
  'Khấu hao lũy kế',
  'Số hiệu CT giảm',
  'Ngày CT giảm',
  'Lý do giảm TSCĐ',
];

const asAssets = (value: Asset[] | undefined | null) => (Array.isArray(value) ? value : []);

const asEntries = (value: JournalEntry[] | undefined | null) => (Array.isArray(value) ? value : []);

const inPeriod = (dateStr: string, startDate: string, endDate: string) =>
  dateStr >= startDate && dateStr <= endDate;

const formatDocDate = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
};

const formatUseMonthYear = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m] = s.split('-');
  if (!y || !m) return '';
  return `${m}/${y}`;
};

const isTscdAsset = (asset: Asset): boolean => {
  if (asset.type === 'TSCĐ') return true;
  const acc = String(asset.assetAccount || '').trim();
  const group = String(asset.assetGroup || '');
  return acc.startsWith('211') || acc.startsWith('213') || group.includes('TSCĐ');
};

const assetDescription = (asset: Asset): string => {
  const parts = [
    String(asset.name || '').trim(),
    asset.code ? `Ký hiệu: ${asset.code}` : undefined,
    asset.department ? `Bộ phận: ${asset.department}` : undefined,
    asset.assetGroup ? `Nhóm: ${asset.assetGroup}` : undefined,
  ].filter(Boolean);
  return parts.join(' — ') || 'Tài sản cố định';
};

const annualDepreciationRatePercent = (asset: Asset): number => {
  const months = Math.max(0, Math.round(Number(asset.usefulLife || 0)));
  if (months <= 0) return 0;
  return Math.round((12 / months) * 10000) / 100;
};

const deprAmountFromJournal = (entry: JournalEntry): number => {
  let amount = 0;
  for (const d of entry.details || []) {
    const acc = String(d.account || '').trim();
    if (acc.startsWith('214')) amount += Math.round(Number(d.credit || 0));
    else if (acc.startsWith('627') || acc.startsWith('641') || acc.startsWith('642')) {
      amount += Math.round(Number(d.debit || 0));
    }
  }
  return amount;
};

const isAssetJournal = (entry: JournalEntry, assetId: string, assetName: string): boolean => {
  const id = String(entry.id || '');
  const ref = String(entry.referenceId || '');
  if (id.includes(assetId) || ref.includes(assetId)) return true;
  const desc = String(entry.description || '');
  return desc.includes(`[${assetName}]`);
};

const sumDepreciationUntil = (
  asset: Asset,
  entries: JournalEntry[],
  endDate: string,
): number => {
  let total = getOpeningCarryForwardAccumulated(asset);
  const cap = DepreciationEngine.getDepreciableBase(asset);
  for (const je of entries) {
    const date = String(je.date || '').slice(0, 10);
    if (!date || date > endDate) continue;
    const id = String(je.id || '');
    if (
      id.startsWith(`JE-DEPR-${asset.id}-`) ||
      id === `JE-ASSET-LIQ-CATCHUP-${asset.id}` ||
      (id.startsWith('JE-DEPR-') && isAssetJournal(je, asset.id, asset.name))
    ) {
      total += deprAmountFromJournal(je);
    }
  }
  return Math.min(cap, Math.max(0, total));
};

const liquidationReason = (asset: Asset, entry?: JournalEntry): string => {
  const desc = String(entry?.description || '').toLowerCase();
  if (Number(asset.liquidationProceedsAmount || 0) > 0 || desc.includes('thu tiền')) {
    return 'Nhượng bán';
  }
  if (desc.includes('thanh lý')) return 'Thanh lý';
  return 'Ghi giảm TSCĐ';
};

type AssetEvent = {
  kind: Tt58S4bLedgerRowKind;
  date: string;
  sortKey: string;
  docNo?: string;
  description: string;
  periodDepreciation?: number;
  disposalDocNo?: string;
  disposalDocDate?: string;
  disposalReason?: string;
};

const buildAssetEvents = (
  asset: Asset,
  entries: JournalEntry[],
  startDate: string,
  endDate: string,
): AssetEvent[] => {
  const events: AssetEvent[] = [];
  const incJe = entries.find((je) => je.id === `JE-ASSET-INC-${asset.id}`);
  const incDate = String(incJe?.date || asset.buyDate || asset.useDate || '').slice(0, 10);

  if (incDate && inPeriod(incDate, startDate, endDate)) {
    events.push({
      kind: 'increase',
      date: incDate,
      sortKey: `inc-${incJe?.id || asset.id}`,
      docNo: String(asset.purchaseInvoiceNumber || incJe?.referenceId || asset.code || '').trim(),
      description: incJe?.description || `Ghi tăng TSCĐ — ${asset.name}`,
    });
  }

  const hasIncreaseInPeriod = events.some((e) => e.kind === 'increase');
  const hasDeprInPeriod = entries.some(
    (je) =>
      String(je.id || '').startsWith(`JE-DEPR-${asset.id}-`) &&
      inPeriod(String(je.date || '').slice(0, 10), startDate, endDate),
  );
  const liqDate = String(asset.liquidationPostingDate || asset.liquidationDate || '').slice(0, 10);
  const inUseAtStart =
    String(asset.useDate || '').slice(0, 10) <= startDate &&
    (asset.status === 'ACTIVE' || (liqDate && liqDate >= startDate));

  if (!hasIncreaseInPeriod && inUseAtStart && (hasDeprInPeriod || asset.status === 'ACTIVE')) {
    const openingAccum = sumDepreciationUntil(asset, entries, startDate);
    if (openingAccum > 0 || Number(asset.cost || 0) > 0) {
      events.push({
        kind: 'opening_carry',
        date: startDate,
        sortKey: `open-${asset.id}`,
        description: 'Số dư đầu kỳ — TSCĐ đang sử dụng',
      });
    }
  }

  for (const je of entries) {
    const id = String(je.id || '');
    const date = String(je.date || '').slice(0, 10);
    if (!inPeriod(date, startDate, endDate)) continue;
    if (id.startsWith(`JE-DEPR-${asset.id}-`)) {
      const amount = deprAmountFromJournal(je);
      if (amount <= 0) continue;
      const ym = id.replace(`JE-DEPR-${asset.id}-`, '');
      events.push({
        kind: 'depreciation',
        date,
        sortKey: id,
        docNo: String(je.referenceId || ym).trim(),
        description: je.description || `Khấu hao TSCĐ tháng ${ym}`,
        periodDepreciation: amount,
      });
    } else if (id === `JE-ASSET-LIQ-CATCHUP-${asset.id}`) {
      const amount = deprAmountFromJournal(je);
      if (amount > 0) {
        events.push({
          kind: 'depreciation',
          date,
          sortKey: id,
          docNo: String(je.referenceId || '').trim(),
          description: je.description || 'Bổ sung khấu hao đến ngày thanh lý',
          periodDepreciation: amount,
        });
      }
    }
  }

  if (asset.status === 'LIQUIDATED' && liqDate && inPeriod(liqDate, startDate, endDate)) {
    const writoffJe = entries.find((je) => je.id === `JE-ASSET-LIQ-WRITEOFF-${asset.id}`);
    events.push({
      kind: 'disposal',
      date: liqDate,
      sortKey: writoffJe?.id || `liq-${asset.id}`,
      docNo: String(writoffJe?.referenceId || `ASSET-LIQ-${asset.code || asset.id}`).trim(),
      description: writoffJe?.description || `Ghi giảm TSCĐ — ${asset.name}`,
      disposalDocNo: String(writoffJe?.referenceId || `ASSET-LIQ-${asset.code || asset.id}`).trim(),
      disposalDocDate: formatDocDate(liqDate),
      disposalReason: liquidationReason(asset, writoffJe),
    });
  }

  return events.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.sortKey.localeCompare(b.sortKey);
  });
};

const assetActiveInYear = (asset: Asset, startDate: string, endDate: string): boolean => {
  const useDate = String(asset.useDate || asset.buyDate || '').slice(0, 10);
  if (!useDate || useDate > endDate) return false;
  const liqDate = String(asset.liquidationPostingDate || asset.liquidationDate || '').slice(0, 10);
  if (asset.status === 'LIQUIDATED' && liqDate && liqDate < startDate) return false;
  return true;
};

export const computeTt58S4bDnsnLedger = (
  assets: Asset[] | undefined | null,
  journalEntries: JournalEntry[] | undefined | null,
  financialYear: FinancialYear,
): Tt58S4bDnsnLedgerData => {
  const startDate = String(financialYear.startDate || '').slice(0, 10);
  const endDate = String(financialYear.endDate || '').slice(0, 10);
  const year = Number(startDate.slice(0, 4)) || new Date().getFullYear();
  const list = asAssets(assets).filter(isTscdAsset).filter((a) => assetActiveInYear(a, startDate, endDate));
  const entries = asEntries(journalEntries);

  const byGroup = new Map<string, Asset[]>();
  for (const asset of list) {
    const label = String(asset.assetGroup || 'TSCĐ khác').trim() || 'TSCĐ khác';
    const bucket = byGroup.get(label) || [];
    bucket.push(asset);
    byGroup.set(label, bucket);
  }

  const groups: Tt58S4bAssetGroup[] = [];

  for (const groupLabel of [...byGroup.keys()].sort((a, b) => a.localeCompare(b, 'vi'))) {
    const groupAssets = (byGroup.get(groupLabel) || []).sort((a, b) =>
      String(a.code || '').localeCompare(String(b.code || ''), 'vi'),
    );
    const rows: Tt58S4bLedgerRow[] = [
      { kind: 'group_header', description: `Loại TSCĐ: ${groupLabel}`, bold: true },
    ];

    let sumCost = 0;
    let sumPeriodDep = 0;
    let sumAccum = 0;

    for (const asset of groupAssets) {
      const events = buildAssetEvents(asset, entries, startDate, endDate);
      if (events.length === 0) continue;

      const originalCost = Math.round(Number(asset.cost || 0));
      const annualRate = annualDepreciationRatePercent(asset);
      const useMonthYear = formatUseMonthYear(asset.useDate);
      const desc = assetDescription(asset);
      let runningAccum =
        events[0]?.kind === 'opening_carry'
          ? sumDepreciationUntil(asset, entries, startDate)
          : sumDepreciationUntil(
              asset,
              entries,
              String(
                events.find((e) => e.kind === 'increase')?.date ||
                  asset.useDate ||
                  startDate,
              ).slice(0, 10),
            );

      for (const ev of events) {
        if (ev.kind === 'increase') {
          runningAccum = Math.min(
            DepreciationEngine.getDepreciableBase(asset),
            getOpeningCarryForwardAccumulated(asset),
          );
        }
        if (ev.kind === 'depreciation') {
          runningAccum = Math.min(
            DepreciationEngine.getDepreciableBase(asset),
            runningAccum + Number(ev.periodDepreciation || 0),
          );
        }
        if (ev.kind === 'disposal') {
          runningAccum = sumDepreciationUntil(asset, entries, ev.date);
        }

        const row: Tt58S4bLedgerRow = {
          kind: ev.kind,
          docNo: ev.docNo,
          docDate: ev.kind === 'opening_carry' ? '' : formatDocDate(ev.date),
          description:
            ev.kind === 'opening_carry' ? `${desc} — ${ev.description}` : ev.description,
          useMonthYear: ev.kind === 'increase' || ev.kind === 'opening_carry' ? useMonthYear : '',
          originalCost:
            ev.kind === 'increase' || ev.kind === 'opening_carry' ? originalCost : undefined,
          annualDepreciationRate:
            ev.kind === 'increase' || ev.kind === 'opening_carry' ? annualRate : undefined,
          periodDepreciation: ev.periodDepreciation,
          accumulatedDepreciation: runningAccum,
          disposalDocNo: ev.disposalDocNo,
          disposalDocDate: ev.disposalDocDate,
          disposalReason: ev.disposalReason,
        };

        if (ev.kind === 'increase') sumCost += originalCost;
        if (ev.periodDepreciation) sumPeriodDep += ev.periodDepreciation;

        rows.push(row);
      }

      sumAccum += sumDepreciationUntil(asset, entries, endDate);
    }

    if (rows.length > 1) {
      rows.push({
        kind: 'group_total',
        description: `Cộng loại TSCĐ: ${groupLabel}`,
        originalCost: sumCost > 0 ? sumCost : undefined,
        periodDepreciation: sumPeriodDep > 0 ? sumPeriodDep : undefined,
        accumulatedDepreciation: sumAccum > 0 ? sumAccum : undefined,
        bold: true,
      });
    }

    if (rows.length > 1) {
      groups.push({ groupId: groupLabel, groupLabel, rows });
    }
  }

  if (groups.length === 0) {
    groups.push({
      groupId: 'empty',
      groupLabel: '',
      rows: [
        {
          kind: 'group_header',
          description: 'Chưa có TSCĐ hoặc chưa có phát sinh ghi tăng, khấu hao, ghi giảm trong kỳ.',
          bold: false,
        },
      ],
    });
  }

  return { groups, year };
};

export function tt58S4bRowsToTable(
  data: Tt58S4bDnsnLedgerData,
  formatAmount: (value: number) => string,
): (string | number)[][] {
  const fmtOpt = (v?: number) => (v != null && Number.isFinite(v) && v > 0 ? formatAmount(v) : '');
  const fmtRate = (v?: number) => (v != null && v > 0 ? `${v}%` : '');

  const toRow = (row: Tt58S4bLedgerRow): (string | number)[] => [
    row.docNo || '',
    row.docDate || '',
    row.description,
    row.useMonthYear || '',
    fmtOpt(row.originalCost),
    fmtRate(row.annualDepreciationRate),
    fmtOpt(row.periodDepreciation),
    fmtOpt(row.accumulatedDepreciation),
    row.disposalDocNo || '',
    row.disposalDocDate || '',
    row.disposalReason || '',
  ];

  const out: (string | number)[][] = [];
  for (const group of data.groups) {
    out.push(...group.rows.map(toRow));
  }
  return out;
}
