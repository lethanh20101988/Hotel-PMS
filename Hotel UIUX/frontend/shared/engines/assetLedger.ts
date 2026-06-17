import type { Asset } from '@shared/types';
import { AllocationEngine } from './allocationEngine';
import { DepreciationEngine } from './depreciationEngine';

function readOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, parsed);
}

/** Lũy kế đã ghi (KH hoặc phân bổ) theo loại tài sản. */
export function getAccumulatedLedgerAmount(asset: Asset): number {
  if (asset.type === 'CCDC') return Math.max(0, Number(asset.accumulatedAllocation ?? 0));
  return Math.max(0, Number(asset.accumulatedDepreciation ?? 0));
}

/** Hao mòn / phân bổ lũy kế đã có ngay từ bút toán đầu kỳ chuyển kỳ. */
export function getOpeningCarryForwardAccumulated(asset: Asset): number {
  return Math.max(0, Number(asset.openingCarryForwardAccumulated ?? 0));
}

/** GTCL mang sang dùng làm cơ sở trích tiếp cho kỳ hiện tại. */
export function getAssetScheduleBase(asset: Asset): number {
  const carryBase = readOptionalNonNegativeNumber(asset.openingCarryForwardResidualBase);
  if (carryBase !== undefined) return carryBase;
  return asset.type === 'CCDC'
    ? AllocationEngine.getAllocatableBase(Number(asset.cost || 0))
    : DepreciationEngine.getDepreciableBase(asset);
}

/** Trần lũy kế tối đa cho tài sản, gồm cả phần lũy kế đã có đầu kỳ nếu là tài sản chuyển kỳ. */
export function getAccumulatedLedgerCap(asset: Asset): number {
  const carryBase = readOptionalNonNegativeNumber(asset.openingCarryForwardResidualBase);
  if (carryBase !== undefined) {
    return getOpeningCarryForwardAccumulated(asset) + carryBase;
  }
  return asset.type === 'CCDC'
    ? AllocationEngine.getAllocatableBase(Number(asset.cost || 0))
    : DepreciationEngine.getDepreciableBase(asset);
}

export function isOpeningCarryForwardAsset(asset: Asset): boolean {
  return readOptionalNonNegativeNumber(asset.openingCarryForwardResidualBase) !== undefined;
}

export function getOpeningCarryForwardMonthlyAmount(asset: Asset): number | undefined {
  const totalLife = readOptionalNonNegativeNumber(asset.openingCarryForwardTotalUsefulLifeMonths);
  if (totalLife !== undefined && totalLife > 0) {
    const originalCost = Math.max(0, Number(asset.cost || 0));
    if (originalCost > 0) return Math.max(0, Math.round(originalCost / totalLife));
  }
  const carryBase = readOptionalNonNegativeNumber(asset.openingCarryForwardResidualBase);
  const remainingLife = Math.max(0, Number(asset.usefulLife || 0));
  if (carryBase !== undefined && remainingLife > 0) {
    return Math.max(0, Math.floor(carryBase / remainingLife));
  }
  return undefined;
}

/**
 * Tài sản chuyển kỳ giữ nguyên mức trích hàng tháng của lịch gốc;
 * tháng cuối cùng tự cân nốt phần lẻ còn lại.
 */
export function getOpeningCarryForwardTargetAccumulated(asset: Asset, monthsEligible: number): number | undefined {
  const carryBase = readOptionalNonNegativeNumber(asset.openingCarryForwardResidualBase);
  if (carryBase === undefined) return undefined;
  const openingAccumulated = getOpeningCarryForwardAccumulated(asset);
  const remainingLife = Math.max(1, Math.round(Number(asset.usefulLife || 0)));
  const eligible = Math.max(0, Math.min(remainingLife, Math.round(Number(monthsEligible || 0))));
  if (eligible <= 0) return openingAccumulated;
  const monthlyAmount = getOpeningCarryForwardMonthlyAmount(asset);
  if (!monthlyAmount || monthlyAmount <= 0) {
    return openingAccumulated + Math.min(carryBase, Math.round((carryBase / remainingLife) * eligible));
  }
  const scheduledInCarryPeriod =
    eligible >= remainingLife
      ? carryBase
      : Math.min(carryBase, monthlyAmount * eligible);
  return openingAccumulated + scheduledInCarryPeriod;
}
