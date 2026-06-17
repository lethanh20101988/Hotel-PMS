import type { Asset, JournalEntry } from '@shared/types';
import {
  getAccumulatedLedgerCap,
  getOpeningCarryForwardAccumulated,
} from '@shared/assetScheduleEngine';
import { journalEntryDetailsArray } from './journalEntryDetails';
import { roundVnd } from './vndMoney';
import { normalizeLedgerAccountCode } from './ledgerAccountCode';

/**
 * Tổng phân bổ/khấu hao ĐÃ GHI SỔ: cộng bên Có TK 242 (CCDC) hoặc Có TK 214 (TSCĐ)
 * trên các bút toán trích do module tài sản (JE-DEPR-… / DEPR-…-assetId).
 * Phản ánh đúng cặp Nợ chi phí / Có 242|214 trên cùng chứng từ.
 */
export function sumPostedDepreciationCreditsForAsset(
  asset: Asset,
  entries: JournalEntry[]
): number {
  const assetId = String(asset.id || '');
  const prefix = asset.type === 'CCDC' ? '242' : '214';
  const cutoffDate = String(asset.useDate || '').split('T')[0];
  let sum = 0;
  for (const e of entries) {
    const jeDate = String(e.date || '').split('T')[0];
    if (cutoffDate && jeDate && jeDate < cutoffDate) continue;
    const jid = String(e.id || '');
    const ref = String(e.referenceId || '');
    const isDepr =
      jid.startsWith(`JE-DEPR-${assetId}-`) || (ref.startsWith('DEPR-') && ref.endsWith(assetId));
    if (!isDepr) continue;
    for (const d of journalEntryDetailsArray(e)) {
      const acc = normalizeLedgerAccountCode(d.account);
      if (acc.startsWith(prefix)) sum += Number(d.credit || 0);
    }
  }
  return roundVnd(sum);
}

/**
 * Đồng bộ accumulated* và residualValue trên tài sản theo NKC (đã ghi sổ).
 * Không dùng ước tính theo thời gian — tránh lệch Bảng cân đối TK / Sổ cái.
 */
export function reconcileAssetBalancesFromJournal(asset: Asset, entries: JournalEntry[]): Asset {
  if (asset.status === 'LIQUIDATED') {
    return asset;
  }
  const posted = sumPostedDepreciationCreditsForAsset(asset, entries);
  const cost = Number(asset.cost || 0);
  const openingAccumulated = getOpeningCarryForwardAccumulated(asset);
  const maxAccumulated = getAccumulatedLedgerCap(asset);
  if (asset.type === 'CCDC') {
    const alloc = Math.min(maxAccumulated, openingAccumulated + posted);
    return {
      ...asset,
      accumulatedAllocation: alloc,
      accumulatedDepreciation: 0,
      residualValue: Math.max(0, cost - alloc),
    };
  }
  const dep = Math.min(maxAccumulated, openingAccumulated + posted);
  const salvage = Math.max(0, Math.min(cost, Number(asset.salvageValue ?? 0)));
  return {
    ...asset,
    accumulatedDepreciation: dep,
    accumulatedAllocation: 0,
    residualValue: Math.max(salvage, cost - dep),
  };
}

export function reconcileAllAssetsWithJournal(assets: Asset[], entries: JournalEntry[]): Asset[] {
  return assets.map((a) => reconcileAssetBalancesFromJournal(a, entries));
}
