import type { AssetTransferRecord } from '@shared/types';

export const ASSET_DEPARTMENTS = [
  'Bộ phận Quản lý',
  'Bộ phận Bán hàng',
  'Bộ phận Kỹ thuật',
] as const;

export type AssetDepartment = (typeof ASSET_DEPARTMENTS)[number];

export function generateAssetTransferSlipNumber(): string {
  const ymd = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DC-${ymd}-${suffix}`;
}

/** Trừ 1 ngày từ chuỗi YYYY-MM-DD (local). */
export function dayBeforeIso(iso: string): string {
  const d = new Date(iso.split('T')[0] + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

export interface AssetDepartmentTimelineRow {
  fromDate: string;
  toDate: string | 'Hiện tại';
  department: string;
  responsiblePerson?: string;
  reason?: string;
  slipNumber?: string;
}

export function buildAssetDepartmentTimeline(asset: {
  useDate: string;
  department: string;
  responsiblePersonName?: string;
  transferHistory?: AssetTransferRecord[];
}): AssetDepartmentTimelineRow[] {
  const sorted = [...(asset.transferHistory || [])].sort((a, b) => a.transferDate.localeCompare(b.transferDate));
  const rows: AssetDepartmentTimelineRow[] = [];

  if (sorted.length === 0) {
    rows.push({
      fromDate: asset.useDate,
      toDate: 'Hiện tại',
      department: asset.department,
      responsiblePerson: asset.responsiblePersonName,
    });
    return rows;
  }

  const first = sorted[0];
  if (first.transferDate > asset.useDate) {
    rows.push({
      fromDate: asset.useDate,
      toDate: dayBeforeIso(first.transferDate),
      department: first.fromDepartment,
    });
  }

  for (let i = 0; i < sorted.length; i++) {
    const rec = sorted[i];
    const isLast = i === sorted.length - 1;
    rows.push({
      fromDate: rec.transferDate,
      toDate: isLast ? 'Hiện tại' : dayBeforeIso(sorted[i + 1].transferDate),
      department: rec.toDepartment,
      responsiblePerson: rec.responsiblePersonName,
      reason: rec.reason,
      slipNumber: rec.slipNumber,
    });
  }
  return rows;
}
