/**
 * Barrel: hai engine tách riêng TSCĐ / CCDC.
 * - DepreciationEngine: khấu hao TSCĐ
 * - AllocationEngine: phân bổ CCDC
 */

export { DepreciationEngine } from './engines/depreciationEngine';
export { AllocationEngine } from './engines/allocationEngine';
export { countEligibleMonths, type DepreciationPolicy } from './engines/periodRules';
export { resolveAssetExpenseAccount } from './engines/expenseAccount';
export {
  getAccumulatedLedgerAmount,
  getAccumulatedLedgerCap,
  getAssetScheduleBase,
  getOpeningCarryForwardMonthlyAmount,
  getOpeningCarryForwardTargetAccumulated,
  getOpeningCarryForwardAccumulated,
  isOpeningCarryForwardAsset,
} from './engines/assetLedger';
