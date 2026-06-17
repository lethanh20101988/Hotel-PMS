import type { Asset } from '@shared/types';
import {
  countEligibleMonths,
  getAccumulatedLedgerAmount,
  getAccumulatedLedgerCap,
  getAssetScheduleBase,
  getOpeningCarryForwardMonthlyAmount,
  getOpeningCarryForwardTargetAccumulated,
  resolveAssetExpenseAccount,
} from '@shared/assetScheduleEngine';
import { normalizeLedgerAccountCode } from './ledgerAccountCode';
import { roundInvoiceTotalsFromSums, roundVnd } from './vndMoney';
import { vatAmountUnrounded } from './vatRate';

export type AssetLiquidationReceiptMethod = 'NONE' | 'CASH' | 'BANK' | 'RECEIVABLE';

export interface AssetLiquidationPreview {
  liquidationDate: string;
  isValidDate: boolean;
  invalidReason?: string;
  type: 'TSCĐ' | 'CCDC';
  assetAccountCode: string;
  depreciationAccountCode: string;
  expenseAccountCode: string;
  currentAccumulated: number;
  monthlyAmount: number;
  additionalDepreciation: number;
  accumulatedAtLiquidation: number;
  remainingValue: number;
  ccdcHandling: 'ONE_TIME' | 'MULTI' | 'STOCK_153';
  ccdcWriteoffAmount: number;
  saleAmount: number;
  saleVatRate: number;
  saleVatAmount: number;
  saleTotalAmount: number;
}

function parseLocalDateOnly(value: string): Date {
  const raw = String(value || '').split('T')[0];
  const [y, m, d] = raw.split('-').map((part) => Number(part));
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function clampNonNegative(value: unknown): number {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, num);
}

export function buildAssetLiquidationPreview(
  asset: Asset,
  liquidationDate: string,
  saleAmountInput = 0,
  saleVatRateInput = 0,
): AssetLiquidationPreview {
  const cost = clampNonNegative(asset.cost);
  const currentAccumulated = clampNonNegative(getAccumulatedLedgerAmount(asset));
  const expenseAccountCode = resolveAssetExpenseAccount(asset);
  const assetAccountCode = normalizeLedgerAccountCode(asset.assetAccount) || (asset.type === 'CCDC' ? '242' : '211');
  const depreciationAccountCode =
    normalizeLedgerAccountCode(asset.depreciationAccount) || (asset.type === 'CCDC' ? '242' : '214');
  const saleBase = clampNonNegative(saleAmountInput);
  const saleVatRate = clampNonNegative(saleVatRateInput);
  const saleRounded = roundInvoiceTotalsFromSums(
    saleBase,
    vatAmountUnrounded(saleBase, saleVatRate),
  );

  const invalidPreview: AssetLiquidationPreview = {
    liquidationDate,
    isValidDate: false,
    invalidReason: 'Ngày thanh lý không hợp lệ.',
    type: asset.type,
    assetAccountCode,
    depreciationAccountCode,
    expenseAccountCode,
    currentAccumulated,
    monthlyAmount: 0,
    additionalDepreciation: 0,
    accumulatedAtLiquidation: currentAccumulated,
    remainingValue: clampNonNegative(cost - currentAccumulated),
    ccdcHandling: asset.ccdcLifecycle === 'STOCK_153' ? 'STOCK_153' : 'MULTI',
    ccdcWriteoffAmount: 0,
    saleAmount: saleRounded.amount,
    saleVatRate,
    saleVatAmount: saleRounded.vatAmount,
    saleTotalAmount: saleRounded.totalAmount,
  };

  const liqDate = parseLocalDateOnly(liquidationDate);
  const useDate = parseLocalDateOnly(asset.useDate);
  if (Number.isNaN(liqDate.getTime())) return invalidPreview;
  if (Number.isNaN(useDate.getTime())) {
    return { ...invalidPreview, invalidReason: 'Tài sản chưa có ngày bắt đầu sử dụng hợp lệ.' };
  }
  if (liqDate < useDate) {
    return { ...invalidPreview, invalidReason: 'Ngày thanh lý phải lớn hơn hoặc bằng ngày bắt đầu sử dụng.' };
  }

  if (asset.type === 'CCDC') {
    const remainingValue = roundVnd(Math.max(0, cost - currentAccumulated));
    const ccdcHandling =
      asset.ccdcLifecycle === 'STOCK_153'
        ? 'STOCK_153'
        : remainingValue <= 0
          ? 'ONE_TIME'
          : 'MULTI';
    const writeoffAmount = ccdcHandling === 'MULTI' ? remainingValue : 0;
    return {
      liquidationDate,
      isValidDate: true,
      type: asset.type,
      assetAccountCode,
      depreciationAccountCode,
      expenseAccountCode,
      currentAccumulated,
      monthlyAmount:
        clampNonNegative(getOpeningCarryForwardMonthlyAmount(asset)) ||
        (asset.usefulLife > 0 ? roundVnd(getAssetScheduleBase(asset) / Math.max(1, Number(asset.usefulLife || 1))) : 0),
      additionalDepreciation: 0,
      accumulatedAtLiquidation: ccdcHandling === 'STOCK_153' ? currentAccumulated : roundVnd(cost),
      remainingValue,
      ccdcHandling,
      ccdcWriteoffAmount: writeoffAmount,
      saleAmount: saleRounded.amount,
      saleVatRate,
      saleVatAmount: saleRounded.vatAmount,
      saleTotalAmount: saleRounded.totalAmount,
    };
  }

  const usefulLife = Math.max(1, Number(asset.usefulLife || 1));
  const monthBeforeLiquidationEnd = new Date(liqDate.getFullYear(), liqDate.getMonth(), 0);
  const fullMonthsBeforeLiquidation = countEligibleMonths(
    asset.useDate,
    monthBeforeLiquidationEnd,
    usefulLife,
    'DAY1_INCLUDES_MONTH',
  );
  const scheduleBase = getAssetScheduleBase(asset);
  const monthlyAmount =
    clampNonNegative(getOpeningCarryForwardMonthlyAmount(asset)) ||
    (usefulLife > 0 ? scheduleBase / usefulLife : 0);
  const openingTargetBeforeMonth = getOpeningCarryForwardTargetAccumulated(asset, fullMonthsBeforeLiquidation);
  const targetBeforeMonth =
    openingTargetBeforeMonth != null
      ? clampNonNegative(openingTargetBeforeMonth)
      : roundVnd(monthlyAmount * fullMonthsBeforeLiquidation);
  const firstChargeDayInMonth =
    useDate.getFullYear() === liqDate.getFullYear() && useDate.getMonth() === liqDate.getMonth()
      ? useDate.getDate()
      : 1;
  const usedDaysInLiquidationMonth = Math.max(0, liqDate.getDate() - firstChargeDayInMonth + 1);
  const monthDays = getDaysInMonth(liqDate);
  const partialMonthAmount = monthDays > 0 ? monthlyAmount * (usedDaysInLiquidationMonth / monthDays) : 0;
  const computedAccumulated = Math.min(
    getAccumulatedLedgerCap(asset),
    roundVnd(targetBeforeMonth + partialMonthAmount),
  );
  const accumulatedAtLiquidation = Math.max(currentAccumulated, computedAccumulated);
  const additionalDepreciation = roundVnd(Math.max(0, accumulatedAtLiquidation - currentAccumulated));
  const remainingValue = roundVnd(Math.max(0, cost - accumulatedAtLiquidation));

  return {
    liquidationDate,
    isValidDate: true,
    type: asset.type,
    assetAccountCode,
    depreciationAccountCode,
    expenseAccountCode,
    currentAccumulated,
    monthlyAmount: roundVnd(monthlyAmount),
    additionalDepreciation,
    accumulatedAtLiquidation: roundVnd(accumulatedAtLiquidation),
    remainingValue,
    ccdcHandling: 'MULTI',
    ccdcWriteoffAmount: 0,
    saleAmount: saleRounded.amount,
    saleVatRate,
    saleVatAmount: saleRounded.vatAmount,
    saleTotalAmount: saleRounded.totalAmount,
  };
}
