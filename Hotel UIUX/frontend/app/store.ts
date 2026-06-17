
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { 
  Device, Invoice, JournalEntry, InventoryItem, InventoryTransaction, 
  FundTransaction, AccountDefinition, Customer, Supplier, Employee, 
  Asset, Warehouse, ExpenseCategory, TaxRate, PaymentMethod, BankAccount,
  AccountingVoucher, AccountingPeriod, FinancialYear, CompanyInfo, SystemConfig, OpeningAssetToolCarryForward,
  BankAccountSnapshot, OpeningBalanceDebtDetail, OpeningDebtKind, OpeningDebtRevenueType,
  OpeningBalanceAccountRecord, OpeningBalanceRolloverMeta,
  CITExpenseMeta, CITLossRecord, DeviceStatus, DeviceType, InvoiceDetail, SerialInfo, DeviceRenewalHistoryItem,
  Bom154Category, BomAlertOverride, BomAuditEntry, BomComponentLine, BomCostMethod, BomDefinition, BomVersionStatus,
  ProductionOrder, ProductionOrderMaterialLine, AssetTransferRecord,
} from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import {
  buildDocumentCounterKey,
  extractDocumentSequence,
  formatDocumentNumber,
  getFundDocumentPrefix,
  getVoucherDocumentPrefix,
  getWarehouseDocumentPrefix,
  normalizeBranchCode,
  type DocumentNumberPrefix,
} from '@shared/utils/documentNumbering';
import {
  getDeferredRevenueRecognitionAccount,
  hasDeferredRevenueAllocationsPosted,
  isDeferredRevenueInvoice,
} from '@shared/utils/deferredRevenue';
import { coercePaidInvoicePaymentMethodFromDebtLabels } from '@shared/utils/invoiceCoercion';
import {
  filterJournalEntriesForLifecycleEntity,
  findDeviceRenewalInvoiceIds,
  getInvoiceLinkedJournalEntryIds,
  shouldRemoveJournalForInvoice,
} from '../shared/utils/journalEntryLifecycleCascade';
import {
  callLifecycleSoftDelete,
  callLifecycleSoftDeleteMany,
  notifySoftDeleted,
  getLastLifecycleStateVersion,
} from '../modules/lifecycle/lifecycleBridge';
import { tryApplyLifecycleRemoteEntity, LC_TYPE_TO_STORE } from '../modules/lifecycle/lifecycleRemoteSync';
import {
  applyInvoicePaidSyncFromFundTransaction,
  applyInvoicePaidSyncFromPostedVoucher,
  enrichPostedVoucherArApObjects,
  resolveArApLedgerMetaForFundTransaction,
} from '@shared/utils/invoicePaidSync';
import {
  clearBankAccountSnapshot,
  extractBankAccountSnapshot,
  isBankLedgerChildAccountCode,
  resolveBankAccountFromSnapshot,
  resolveCashBankAccountCode,
  resolveFundMethodFromPayment,
} from '@shared/utils/bankAccountPayments';
import {
  AllocationEngine,
  DepreciationEngine,
  getAccumulatedLedgerAmount,
  getAccumulatedLedgerCap,
  resolveAssetExpenseAccount,
} from '@shared/assetScheduleEngine';
import { reconcileAllAssetsWithJournal } from '@shared/utils/assetJournalReconciliation';
import { buildAssetLiquidationPreview, type AssetLiquidationReceiptMethod } from '@shared/utils/assetLiquidation';
import { computeVatAmount, vatAmountUnrounded } from '@shared/utils/vatRate';
import {
  applyTt58IndustryToSalesInvoice,
  getTt58PrimaryIndustryIds,
} from '@shared/regulations/tt58_2026/tt58IndustryCatalog';
import { allocateRoundedTotal, roundInvoiceTotalsFromSums, roundVnd } from '@shared/utils/vndMoney';
import { ensureCoreCashBankAccounts } from '@shared/utils/coreCashBankAccounts';
import { INVOICE_PURCHASE_SERVICE_EXTRA_ACCOUNTS } from '@shared/utils/invoicePurchaseServiceAccounts';
import { buildInvoiceCogsJournalEntry } from '@shared/utils/invoiceCogs';
import {
  bindRealtimeWebSocket,
  dispatchRealtimeWireMessage,
  type RealtimeWireMessage,
} from '../services/realtimeClient';
import { getTabClientId } from '../services/tabClientId';
import {
  buildHotelPmsExpenseInvoiceId,
  buildHotelPmsInvoiceId,
  invoiceLineTypeForRevenueAccount,
  parseHotelPmsCheckoutBookingId,
  parseHotelPmsExpenseId,
  resolveBookingServiceRevenueAccount,
  resolveHotelPmsExpenseAccount,
  resolveHotelPmsExpenseInvoiceCategory,
  type HotelPmsCheckoutPostingPayload,
  type HotelPmsExpensePostingPayload,
} from '../modules/hotel-pms/hotelPmsAccounting';
import {
  clearHotelPmsState,
  getDefaultHotelPmsState,
  loadHotelPmsState,
  normalizeHotelPmsState,
  type HotelPmsPersistedState,
} from '../modules/hotel-pms/hotelPmsStorage';
import { applyInventoryExcelImportBatch } from '../modules/catalogs/utils/catalogExcelIO';
import { findStrictDuplicateInvoice } from '@shared/utils/invoiceDuplicateIdentity';
import {
  analyzeCrossPeriodInvoice,
  buildCrossPeriodMeta,
  buildInvoiceTaxFilingMeta,
  isFullCrossPeriodPosting,
  isSameFyLateTaxFilingOnly,
  type PriorPeriodMateriality,
} from '@shared/utils/crossPeriodInvoice';
import { resolveComparisonBaselineBeforeSave } from '@shared/utils/vatFilingAdjustment';
import { validateCashNotOverdraft, validateVoucherBalanced } from '@shared/utils/voucherSaveGuards';
import {
  EMPTY_PARTNER_NAME_HISTORY,
  mergePartnerNameHistoryImports,
  parsePartnerNameHistoryFromPersist,
  rememberPartnerNameReducer,
  type PartnerNameKind,
  type PartnerNameHistoryState,
} from '@shared/utils/partnerNameMemory';
import {
  buildBomPlannedStockLines,
  getBomDefinitionForParent,
  getBomStockShortages,
  hasBomPlannedStockVariance,
  isProductionExportPurpose,
  isStockCreditAccount,
} from '@shared/utils/bom';
import {
  applyWarehouseBalanceChange,
  cloneWarehouseBalances,
  createDefaultWarehouse,
  ensureWarehouseBalances,
  getDefaultWarehouse,
  getDefaultWarehouseId,
  getWarehouseBalance,
  getWarehouseQuantity,
  getWarehouseScopedItem,
  mapItemsToWarehouseScope,
  normalizeWarehouses,
  rebuildItemTotalsFromWarehouseBalances,
  remapWarehouseIdOnItem,
} from '@shared/utils/warehouseInventory';

/** Id ổn định, không trùng khi thêm nhiều bản ghi trong cùng millisecond (vd. import Excel). */
function newEntityId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeBomCategory(raw: unknown): Bom154Category {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'DIRECT_LABOR') return 'DIRECT_LABOR';
  if (value === 'OVERHEAD') return 'OVERHEAD';
  return 'DIRECT_MATERIAL';
}

function normalizeBomVersionStatus(raw: unknown): BomVersionStatus {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return 'APPROVED';
  if (value === 'OBSOLETE') return 'OBSOLETE';
  if (value === 'APPROVED') return 'APPROVED';
  return 'DRAFT';
}

function normalizeBomCostMethod(raw: unknown): BomCostMethod {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'ACTUAL') return 'ACTUAL';
  if (value === 'AVERAGE') return 'AVERAGE';
  return 'STANDARD';
}

function normalizeBomAuditTrail(raw: unknown): BomAuditEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const action = String((entry as any)?.action || '').trim().toUpperCase();
      if (
        action !== 'CREATED' &&
        action !== 'UPDATED' &&
        action !== 'CLONED' &&
        action !== 'APPROVED' &&
        action !== 'OBSOLETED' &&
        action !== 'ALERT_STATUS_CHANGED'
      ) {
        return null;
      }
      return {
        id: String((entry as any)?.id || '').trim() || newEntityId(),
        action: action as BomAuditEntry['action'],
        actor: String((entry as any)?.actor || '').trim() || 'System',
        timestamp: String((entry as any)?.timestamp || '').trim() || new Date().toISOString(),
        note: String((entry as any)?.note || '').trim() || undefined,
      } satisfies BomAuditEntry;
    })
    .filter((entry): entry is BomAuditEntry => Boolean(entry));
}

function normalizeBomAlertOverrides(raw: unknown): BomAlertOverride[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, BomAlertOverride>();
  for (const entry of raw) {
    const key = String((entry as any)?.key || '').trim();
    if (!key) continue;
    const statusRaw = String((entry as any)?.status || '').trim().toUpperCase();
    const status =
      statusRaw === 'SEEN'
        ? 'SEEN'
        : statusRaw === 'RESOLVED'
          ? 'RESOLVED'
          : 'NEW';
    byKey.set(key, {
      key,
      status,
      updatedAt: String((entry as any)?.updatedAt || '').trim() || new Date().toISOString(),
      updatedBy: String((entry as any)?.updatedBy || '').trim() || undefined,
      note: String((entry as any)?.note || '').trim() || undefined,
    });
  }
  return Array.from(byKey.values());
}

function normalizeBomComponentLine(raw: any): BomComponentLine | null {
  const componentItemId = String(raw?.componentItemId || '').trim();
  if (!componentItemId) return null;
  return {
    id: String(raw?.id || '').trim() || newEntityId(),
    componentItemId,
    quantity: Math.max(0, Number(raw?.quantity || 0)),
    lossRate: Math.max(0, Number(raw?.lossRate || 0)),
    lossQuantity: Math.max(0, Number(raw?.lossQuantity || 0)) || undefined,
    account154Category: normalizeBomCategory(raw?.account154Category),
    note: String(raw?.note || '').trim() || undefined,
  };
}

function normalizeBomDefinition(raw: any): BomDefinition | null {
  const parentItemId = String(raw?.parentItemId || '').trim();
  if (!parentItemId) return null;
  const updatedAt = String(raw?.updatedAt || '').trim() || new Date().toISOString();
  const versionNumber = Math.max(1, Math.floor(Number(raw?.versionNumber || 1)) || 1);
  const componentMap = new Map<string, BomComponentLine>();
  for (const component of Array.isArray(raw?.components) ? raw.components : []) {
    const normalized = normalizeBomComponentLine(component);
    if (!normalized) continue;
    componentMap.set(normalized.componentItemId, normalized);
  }
  const components = Array.from(componentMap.values());
  if (components.length === 0) return null;
  return {
    id: String(raw?.id || '').trim() || newEntityId(),
    parentItemId,
    versionNumber,
    versionCode: String(raw?.versionCode || '').trim() || `V${versionNumber}`,
    status: normalizeBomVersionStatus(raw?.status),
    effectiveDate: String(raw?.effectiveDate || '').trim() || updatedAt.split('T')[0],
    expiryDate: String(raw?.expiryDate || '').trim() || undefined,
    approvedAt: String(raw?.approvedAt || '').trim() || undefined,
    approvedBy: String(raw?.approvedBy || '').trim() || undefined,
    obsoleteAt: String(raw?.obsoleteAt || '').trim() || undefined,
    clonedFromId: String(raw?.clonedFromId || '').trim() || undefined,
    changeSummary: String(raw?.changeSummary || '').trim() || undefined,
    defaultCostMethod: normalizeBomCostMethod(raw?.defaultCostMethod),
    note: String(raw?.note || '').trim() || undefined,
    components,
    auditTrail: normalizeBomAuditTrail(raw?.auditTrail),
    alertOverrides: normalizeBomAlertOverrides(raw?.alertOverrides),
    updatedAt,
  };
}

function normalizeBomDefinitions(raw: unknown): BomDefinition[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, BomDefinition>();
  for (const item of raw) {
    const normalized = normalizeBomDefinition(item);
    if (!normalized) continue;
    const key = String(normalized.id || '').trim() || `${normalized.parentItemId}::${normalized.versionCode || normalized.versionNumber || 1}`;
    byKey.set(key, normalized);
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const parentA = `${a.parentItemId}::${String(a.versionCode || a.versionNumber || '')}`;
    const parentB = `${b.parentItemId}::${String(b.versionCode || b.versionNumber || '')}`;
    return parentA.localeCompare(parentB, 'vi');
  });
}

/** Tài sản tổng hợp để chạy KH/phân bổ tiếp sau bút Opening (không tạo nghiệp vụ mua). */
const LEGACY_SYNTHETIC_OPENING_ASSET_CARRY_ID = 'ASSET-OPEN-CARRY';
const LEGACY_OPENING_ASSET_CARRY_REFERENCE_ID = 'OPENING-ASSET-CARRY';
const SYNTHETIC_OPENING_ASSET_CARRY_ID_PREFIX = 'ASSET-OPEN-CARRY';
const OPENING_ASSET_CARRY_REFERENCE_ID_PREFIX = 'OPENING-ASSET-CARRY';
const LEGACY_OPENING_ASSET_CARRY_ENTRY_ID = 'legacy-opening-asset-carry';

function normalizeLedgerAccountCode(raw: string | undefined, fallback: string): string {
  const s = String(raw || '').trim();
  if (!s) return fallback;
  const m = s.match(/^(\d{3,4})/);
  return m ? m[1] : (s.split(/[\s-]/)[0] || fallback);
}

function getOpeningCarryDefaultName(kind: 'TSCD' | 'CCDC'): string {
  return kind === 'CCDC' ? 'CCDC đầu kỳ' : 'TSCĐ đầu kỳ';
}

function buildSyntheticOpeningCarryAssetId(carryId: string): string {
  return `${SYNTHETIC_OPENING_ASSET_CARRY_ID_PREFIX}-${carryId}`;
}

function buildOpeningAssetCarryReferenceId(carryId: string): string {
  return `${OPENING_ASSET_CARRY_REFERENCE_ID_PREFIX}-${carryId}`;
}

function isSyntheticOpeningCarryAssetId(assetId: string): boolean {
  return assetId === LEGACY_SYNTHETIC_OPENING_ASSET_CARRY_ID || assetId.startsWith(`${SYNTHETIC_OPENING_ASSET_CARRY_ID_PREFIX}-`);
}

function isOpeningAssetCarryReferenceId(referenceId: string): boolean {
  return (
    referenceId === LEGACY_OPENING_ASSET_CARRY_REFERENCE_ID ||
    referenceId.startsWith(`${OPENING_ASSET_CARRY_REFERENCE_ID_PREFIX}-`)
  );
}

function normalizeOpeningAssetToolCarryForwardEntry(
  raw: any,
  prev?: OpeningAssetToolCarryForward,
  opts?: { useLegacyIds?: boolean },
): OpeningAssetToolCarryForward {
  const carryKind: 'TSCD' | 'CCDC' = raw?.carryKind === 'CCDC' ? 'CCDC' : 'TSCD';
  const useLegacyIds = Boolean(opts?.useLegacyIds);
  const id =
    raw?.id != null && String(raw.id).trim()
      ? String(raw.id).trim()
      : prev?.id || (useLegacyIds ? LEGACY_OPENING_ASSET_CARRY_ENTRY_ID : newEntityId());
  const name =
    String(raw?.name || '').trim() ||
    String(raw?.accountingNote || '').trim() ||
    prev?.name ||
    getOpeningCarryDefaultName(carryKind);
  const code =
    String(raw?.code || '').trim() ||
    prev?.code ||
    `${carryKind === 'CCDC' ? 'DK-CCDC' : 'DK-TSCD'}-${id.slice(-6).toUpperCase()}`;
  const syntheticAssetId =
    raw?.syntheticAssetId != null && String(raw.syntheticAssetId).trim()
      ? String(raw.syntheticAssetId).trim()
      : prev?.syntheticAssetId ||
        (useLegacyIds ? LEGACY_SYNTHETIC_OPENING_ASSET_CARRY_ID : undefined);
  const openingEntryReferenceId =
    raw?.openingEntryReferenceId != null && String(raw.openingEntryReferenceId).trim()
      ? String(raw.openingEntryReferenceId).trim()
      : prev?.openingEntryReferenceId ||
        (useLegacyIds ? LEGACY_OPENING_ASSET_CARRY_REFERENCE_ID : undefined);
  const normalized: OpeningAssetToolCarryForward = {
    id,
    code,
    name,
    originalCost: Math.max(0, Number(raw?.originalCost || 0)),
    accumulatedDepreciation: Math.max(0, Number(raw?.accumulatedDepreciation || 0)),
    residualCarriedForward: Math.max(0, Number(raw?.residualCarriedForward || 0)),
    accountingNote: String(raw?.accountingNote || '').trim(),
    openingVat1331: Math.max(0, Number(raw?.openingVat1331 || 0)),
    carryKind,
    accountOriginal: raw?.accountOriginal != null && String(raw.accountOriginal).trim() ? String(raw.accountOriginal).trim() : undefined,
    accountAccumulated:
      raw?.accountAccumulated != null && String(raw.accountAccumulated).trim() ? String(raw.accountAccumulated).trim() : undefined,
    accountEquity: raw?.accountEquity != null && String(raw.accountEquity).trim() ? String(raw.accountEquity).trim() : undefined,
    totalUsefulLifeMonths:
      raw?.totalUsefulLifeMonths != null && String(raw.totalUsefulLifeMonths) !== ''
        ? Math.max(1, Math.round(Number(raw.totalUsefulLifeMonths)))
        : undefined,
    usefulLifeMonths:
      raw?.usefulLifeMonths != null && String(raw.usefulLifeMonths) !== ''
        ? Math.max(1, Math.round(Number(raw.usefulLifeMonths)))
        : undefined,
    openingEntryPosted: raw?.openingEntryPosted !== undefined ? Boolean(raw.openingEntryPosted) : Boolean(prev?.openingEntryPosted),
    openingPostedAt: raw?.openingPostedAt !== undefined ? raw.openingPostedAt : prev?.openingPostedAt,
    openingEntryReferenceId,
    syntheticAssetId,
  };
  return normalized;
}

function getOpeningAssetToolCarryForwards(cfg: SystemConfig | undefined): OpeningAssetToolCarryForward[] {
  if (!cfg) return [];
  if (Array.isArray(cfg.openingAssetToolCarryForwards) && cfg.openingAssetToolCarryForwards.length > 0) {
    return cfg.openingAssetToolCarryForwards;
  }
  return cfg.openingAssetToolCarryForward ? [cfg.openingAssetToolCarryForward] : [];
}

function withOpeningAssetToolCarryForwards(
  cfg: SystemConfig,
  entries: OpeningAssetToolCarryForward[],
): SystemConfig {
  const nextEntries = entries.length > 0 ? entries : [];
  return {
    ...cfg,
    openingAssetToolCarryForwards: nextEntries.length > 0 ? nextEntries : undefined,
    openingAssetToolCarryForward: nextEntries[0],
  };
}

/**
 * Đường thẳng: mỗi tháng trích ≈ NG / tổng tháng; số tháng đã trích ≈ round(lũy kế / mức đó); còn lại = tổng − đã (tối thiểu 1).
 */
function computeCarryForwardRemainingLifeMonths(
  originalCost: number,
  accumulatedDepreciation: number,
  totalUsefulLifeMonths: number | undefined,
): number | undefined {
  const oc = Math.max(0, originalCost);
  const acc = Math.max(0, accumulatedDepreciation);
  const total =
    totalUsefulLifeMonths != null && !Number.isNaN(Number(totalUsefulLifeMonths))
      ? Math.max(1, Math.round(Number(totalUsefulLifeMonths)))
      : 0;
  if (!total || oc <= 0) return undefined;
  const monthly = oc / total;
  if (monthly <= 0) return undefined;
  const elapsed = Math.min(total, Math.round(acc / monthly));
  return Math.max(1, total - elapsed);
}

function buildSyntheticOpeningCarryAsset(ocf: OpeningAssetToolCarryForward, fyStart: string): Asset {
  const isCcdc = ocf.carryKind === 'CCDC';
  const life = Math.max(
    1,
    Math.round(
      Number(
        ocf.usefulLifeMonths ??
          computeCarryForwardRemainingLifeMonths(
            Number(ocf.originalCost || 0),
            Number(ocf.accumulatedDepreciation || 0),
            ocf.totalUsefulLifeMonths,
          ) ??
          36,
      ),
    ),
  );
  const res = Math.max(0, Number(ocf.residualCarriedForward || 0));
  const oc = Math.max(0, Number(ocf.originalCost || 0));
  const acc = Math.max(0, Number(ocf.accumulatedDepreciation || 0));
  const displayCost = oc > 0 ? oc : res;
  const syntheticId = ocf.syntheticAssetId || buildSyntheticOpeningCarryAssetId(ocf.id);
  const baseName = String(ocf.name || '').trim() || getOpeningCarryDefaultName(ocf.carryKind);
  const displayCode =
    String(ocf.code || '').trim() ||
    `${isCcdc ? 'DK-CCDC' : 'DK-TSCD'}-${ocf.id.slice(-6).toUpperCase()}`;
  const tail = oc > 0 || acc > 0 ? ` (NK đầu kỳ NG ${formatCurrency(oc)} / HM ${formatCurrency(acc)})` : '';
  return {
    id: syntheticId,
    code: displayCode,
    name: `${baseName} — giữ NG gốc, trích tiếp GTCL (~${life} tháng)${tail}`,
    type: isCcdc ? 'CCDC' : 'TSCĐ',
    assetGroup: isCcdc ? 'CCDC (đầu kỳ)' : 'TSCĐ (đầu kỳ)',
    assetAccount: isCcdc ? '242' : normalizeLedgerAccountCode(ocf.accountOriginal, '2112'),
    depreciationAccount: isCcdc ? '242' : normalizeLedgerAccountCode(ocf.accountAccumulated, '214'),
    cost: displayCost,
    vatRate: 0,
    vatAmount: 0,
    buyDate: fyStart,
    useDate: fyStart,
    usefulLife: life,
    accumulatedDepreciation: isCcdc ? 0 : acc,
    accumulatedAllocation: isCcdc ? acc : 0,
    residualValue: res,
    department: '',
    status: 'ACTIVE',
    expenseAccount: isCcdc ? '6422' : '6421',
    ccdcLifecycle: isCcdc ? 'IN_USE' : undefined,
    salvageValue: isCcdc ? undefined : 0,
    openingCarryForwardResidualBase: res,
    openingCarryForwardAccumulated: acc,
    openingCarryForwardTotalUsefulLifeMonths:
      ocf.totalUsefulLifeMonths != null && Number.isFinite(Number(ocf.totalUsefulLifeMonths))
        ? Math.max(1, Math.round(Number(ocf.totalUsefulLifeMonths)))
        : undefined,
  };
}

function buildRolledOpeningCarryForwardStates(
  currentCarries: OpeningAssetToolCarryForward[],
  currentAssets: Asset[],
  nextFyStart: string,
): {
  nextCarries: OpeningAssetToolCarryForward[];
  nextAssets: Asset[];
} {
  if (currentCarries.length === 0) return { nextCarries: [], nextAssets: currentAssets };
  const nextAssets = currentAssets.filter((asset) => !isSyntheticOpeningCarryAssetId(String(asset.id || '')));
  const nextCarries = currentCarries.map((currentCarry) => {
    const currentSynthetic = currentAssets.find((asset) => asset.id === currentCarry.syntheticAssetId);
    const accumulated = currentSynthetic
      ? getAccumulatedLedgerAmount(currentSynthetic)
      : Math.max(0, Number(currentCarry.accumulatedDepreciation || 0));
    const originalCost = Math.max(
      0,
      Number(currentSynthetic?.cost || currentCarry.originalCost || 0),
    );
    const residual = Math.max(
      0,
      Number(currentSynthetic?.residualValue ?? Math.max(0, originalCost - accumulated)),
    );
    const remainingLife =
      residual > 0
        ? computeCarryForwardRemainingLifeMonths(
            originalCost,
            accumulated,
            currentCarry.totalUsefulLifeMonths,
          ) ??
          (currentCarry.usefulLifeMonths != null && Number.isFinite(Number(currentCarry.usefulLifeMonths))
            ? Math.max(1, Math.round(Number(currentCarry.usefulLifeMonths)))
            : Math.max(1, Math.round(Number(currentSynthetic?.usefulLife || 1))))
        : undefined;
    const nextCarry: OpeningAssetToolCarryForward = {
      ...currentCarry,
      originalCost,
      accumulatedDepreciation: accumulated,
      residualCarriedForward: residual,
      usefulLifeMonths: remainingLife,
      syntheticAssetId:
        residual > 0 || originalCost > 0
          ? currentCarry.syntheticAssetId || buildSyntheticOpeningCarryAssetId(currentCarry.id)
          : undefined,
      openingEntryReferenceId:
        currentCarry.openingEntryReferenceId || buildOpeningAssetCarryReferenceId(currentCarry.id),
    };
    const nextSynthetic =
      residual > 0 || originalCost > 0 ? buildSyntheticOpeningCarryAsset(nextCarry, nextFyStart) : undefined;
    if (nextSynthetic) nextAssets.push(nextSynthetic);
    return nextCarry;
  });
  return { nextCarries, nextAssets };
}

/** Cập nhật danh mục Hàng hóa theo tồn kho (sau nhập/xuất hoặc hoàn tác phiếu). */
function syncCatalogFromInventoryRows(
  catalog: InventoryItem[],
  invRows: InventoryItem[],
  touchedIds: Set<string>,
): InventoryItem[] {
  if (touchedIds.size === 0) return catalog;
  const invById = new Map(invRows.map((r) => [r.id, r]));
  const next = catalog.map((c) => {
    if (!touchedIds.has(c.id)) return c;
    const row = invById.get(c.id);
    if (!row) return c;
    return {
      ...c,
      sku: row.sku,
      name: row.name,
      unit: row.unit,
      category: row.category,
      minStock: row.minStock,
      costPrice: row.costPrice,
      sellingPrice: row.sellingPrice,
      accountCode: row.accountCode,
      costAccount: row.costAccount,
      trackingType: row.trackingType,
      quantity: row.quantity,
      serials: [...(row.serials || [])],
      serialDetails: (row.serialDetails || []).map((d) => ({ ...d })),
      warehouseBalances: cloneWarehouseBalances(row.warehouseBalances),
    };
  });
  for (const id of touchedIds) {
    if (next.some((c) => c.id === id)) continue;
    const row = invById.get(id);
    if (row) next.push({ ...row });
  }
  return next;
}

function normalizeInventoryRows(items: InventoryItem[], defaultWarehouseId: string): InventoryItem[] {
  return (items || []).map((item) => ensureWarehouseBalances(item, defaultWarehouseId));
}

function remapInventoryRowsWarehouseId(
  items: InventoryItem[],
  fromId: string,
  toId: string,
  defaultWarehouseId: string,
): InventoryItem[] {
  return (items || []).map((item) => remapWarehouseIdOnItem(item, fromId, toId, defaultWarehouseId));
}

function remapTransactionsWarehouseIds(
  list: InventoryTransaction[],
  fromId: string,
  toId: string,
  oldDefaultId: string,
  replacementName?: string,
): InventoryTransaction[] {
  return (list || []).map((t) => {
    const w = String(t.warehouseId || '').trim();
    const pointsToDeleted = w === fromId || (!w && fromId === oldDefaultId);
    if (!pointsToDeleted) return t;
    return { ...t, warehouseId: toId, warehouseName: replacementName || t.warehouseName };
  });
}

function remapProductionOrdersWarehouseIds(
  list: ProductionOrder[],
  fromId: string,
  toId: string,
  oldDefaultId: string,
  replacementName?: string,
): ProductionOrder[] {
  const mapWid = (wid: string | undefined) => {
    const w = String(wid || '').trim();
    if (w === fromId) return toId;
    if (!w && fromId === oldDefaultId) return toId;
    return w || toId;
  };
  const mapName = (wid: string | undefined, prevName?: string) => {
    const w = String(wid || '').trim();
    if (w === fromId || (!w && fromId === oldDefaultId)) return replacementName || prevName;
    return prevName;
  };
  return (list || []).map((po) => ({
    ...po,
    sourceWarehouseId: mapWid(po.sourceWarehouseId),
    targetWarehouseId: mapWid(po.targetWarehouseId),
    sourceWarehouseName: mapName(po.sourceWarehouseId, po.sourceWarehouseName),
    targetWarehouseName: mapName(po.targetWarehouseId, po.targetWarehouseName),
    materials: (po.materials || []).map((m) => ({
      ...m,
      sourceWarehouseId: mapWid(m.sourceWarehouseId),
      sourceWarehouseName: mapName(m.sourceWarehouseId, m.sourceWarehouseName),
    })),
    output: {
      ...po.output,
      targetWarehouseId: mapWid(po.output?.targetWarehouseId),
      targetWarehouseName: mapName(po.output?.targetWarehouseId, po.output?.targetWarehouseName),
    },
  }));
}

const DEFAULT_ACCOUNTS: AccountDefinition[] = [
  // --- LOẠI TÀI KHOẢN TÀI SẢN ---
  { id: 'acc_111', code: '111', name: 'Tiền mặt', type: 'Dư Nợ' },
  { id: 'acc_1111', code: '1111', name: 'Tiền Việt Nam', type: 'Dư Nợ' },
  { id: 'acc_1112', code: '1112', name: 'Ngoại tệ', type: 'Dư Nợ' },
  { id: 'acc_112', code: '112', name: 'Tiền gửi Ngân hàng', type: 'Dư Nợ' },
  { id: 'acc_1121', code: '1121', name: 'Tiền Việt Nam', type: 'Dư Nợ' },
  { id: 'acc_1122', code: '1122', name: 'Ngoại tệ', type: 'Dư Nợ' },
  { id: 'acc_121', code: '121', name: 'Chứng khoán kinh doanh', type: 'Dư Nợ' },
  { id: 'acc_128', code: '128', name: 'Đầu tư nắm giữ đến ngày đáo hạn', type: 'Dư Nợ' },
  { id: 'acc_1281', code: '1281', name: 'Tiền gửi có kỳ hạn', type: 'Dư Nợ' },
  { id: 'acc_1288', code: '1288', name: 'Các khoản đầu tư khác nắm giữ đến ngày đáo hạn', type: 'Dư Nợ' },
  { id: 'acc_131', code: '131', name: 'Phải thu của Khách hàng', type: 'Lưỡng tính' },
  { id: 'acc_133', code: '133', name: 'Thuế GTGT được khấu trừ', type: 'Dư Nợ' },
  { id: 'acc_1331', code: '1331', name: 'Thuế GTGT được khấu trừ của hàng hoá, dịch vụ', type: 'Dư Nợ' },
  { id: 'acc_1332', code: '1332', name: 'Thuế GTGT được khấu trừ TSCĐ', type: 'Dư Nợ' },
  { id: 'acc_136', code: '136', name: 'Phải thu nội bộ', type: 'Dư Nợ' },
  { id: 'acc_1361', code: '1361', name: 'Vốn kinh doanh ở đơn vị trực thuộc', type: 'Dư Nợ' },
  { id: 'acc_1368', code: '1368', name: 'Phải thu nội bộ khác', type: 'Dư Nợ' },
  { id: 'acc_138', code: '138', name: 'Phải thu khác', type: 'Dư Nợ' },
  { id: 'acc_1381', code: '1381', name: 'Tài sản thiếu chờ xử lý', type: 'Dư Nợ' },
  { id: 'acc_1386', code: '1386', name: 'Cầm cố, thế chấp, ký quỹ, ký cược', type: 'Dư Nợ' },
  { id: 'acc_1388', code: '1388', name: 'Phải thu khác', type: 'Dư Nợ' },
  { id: 'acc_141', code: '141', name: 'Tạm ứng', type: 'Dư Nợ' },
  { id: 'acc_151', code: '151', name: 'Hàng mua đang đi đường', type: 'Dư Nợ' },
  { id: 'acc_152', code: '152', name: 'Nguyên liệu, vật liệu', type: 'Dư Nợ' },
  { id: 'acc_153', code: '153', name: 'Công cụ, dụng cụ', type: 'Dư Nợ' },
  { id: 'acc_154', code: '154', name: 'Chi phí sản xuất, kinh doanh dở dang', type: 'Dư Nợ' },
  { id: 'acc_155', code: '155', name: 'Thành phẩm', type: 'Dư Nợ' },
  { id: 'acc_156', code: '156', name: 'Hàng hoá', type: 'Dư Nợ' },
  { id: 'acc_157', code: '157', name: 'Hàng gửi đi bán', type: 'Dư Nợ' },
  { id: 'acc_211', code: '211', name: 'Tài sản cố định', type: 'Dư Nợ' },
  { id: 'acc_2111', code: '2111', name: 'TSCĐ Hữu hình', type: 'Dư Nợ' },
  { id: 'acc_2112', code: '2112', name: 'TSCĐ thuê tài chính', type: 'Dư Nợ' },
  { id: 'acc_2113', code: '2113', name: 'TSCĐ Vô hình', type: 'Dư Nợ' },
  { id: 'acc_214', code: '214', name: 'Hao mòn tài sản cố định', type: 'Dư Có' },
  { id: 'acc_2141', code: '2141', name: 'Hao mòn TSCĐ Hữu hình', type: 'Dư Có' },
  { id: 'acc_2142', code: '2142', name: 'Hao mòn TSCĐ thuê tài chính', type: 'Dư Có' },
  { id: 'acc_2143', code: '2143', name: 'Hao mòn TSCĐ vô hình', type: 'Dư Có' },
  { id: 'acc_2147', code: '2147', name: 'Hao mòn Bất động sản đầu tư', type: 'Dư Có' },
  { id: 'acc_228', code: '228', name: 'Đầu tư góp vốn vào đơn vị khác', type: 'Dư Nợ' },
  { id: 'acc_2281', code: '2281', name: 'Đầu tư vào công ty liên doanh, liên kết', type: 'Dư Nợ' },
  { id: 'acc_2288', code: '2288', name: 'Đầu tư khác', type: 'Dư Nợ' },
  { id: 'acc_229', code: '229', name: 'Dự phòng tổn thất tài sản', type: 'Dư Có' },
  { id: 'acc_2291', code: '2291', name: 'Dự phòng giảm giá chứng khoán kinh doanh', type: 'Dư Có' },
  { id: 'acc_2292', code: '2292', name: 'Dự phòng tổn thất đầu tư vào đơn vị khác', type: 'Dư Có' },
  { id: 'acc_2293', code: '2293', name: 'Dự phòng phải thu khó đòi', type: 'Dư Có' },
  { id: 'acc_2294', code: '2294', name: 'Dự phòng giảm giá hàng tồn kho', type: 'Dư Có' },
  { id: 'acc_241', code: '241', name: 'Xây dựng cơ bản dở dang', type: 'Dư Nợ' },
  { id: 'acc_2411', code: '2411', name: 'Mua sắm TSCĐ', type: 'Dư Nợ' },
  { id: 'acc_2412', code: '2412', name: 'Xây dựng cơ bản', type: 'Dư Nợ' },
  { id: 'acc_2413', code: '2413', name: 'Sửa chữa lớn TSCĐ', type: 'Dư Nợ' },
  { id: 'acc_242', code: '242', name: 'Chi phí trả trước', type: 'Dư Nợ' },

  // --- LOẠI TÀI KHOẢN NỢ PHẢI TRẢ ---
  { id: 'acc_331', code: '331', name: 'Phải trả cho người bán', type: 'Lưỡng tính' },
  { id: 'acc_333', code: '333', name: 'Thuế và các khoản phải nộp nhà nước', type: 'Dư Có' },
  { id: 'acc_3331', code: '3331', name: 'Thuế GTGT phải nộp', type: 'Dư Có' },
  { id: 'acc_33311', code: '33311', name: 'Thuế GTGT đầu ra', type: 'Dư Có' },
  { id: 'acc_33312', code: '33312', name: 'Thuế GTGT hàng nhập khẩu', type: 'Dư Có' },
  { id: 'acc_3332', code: '3332', name: 'Thuế tiêu thụ đặc biệt', type: 'Dư Có' },
  { id: 'acc_3333', code: '3333', name: 'Thuế xuất, nhập khẩu', type: 'Dư Có' },
  { id: 'acc_3334', code: '3334', name: 'Thuế thu nhập doanh nghiệp', type: 'Dư Có' },
  { id: 'acc_3335', code: '3335', name: 'Thuế thu nhập cá nhân', type: 'Dư Có' },
  { id: 'acc_3336', code: '3336', name: 'Thuế tài nguyên', type: 'Dư Có' },
  { id: 'acc_3337', code: '3337', name: 'Thuế nhà đất, tiền thuê đất', type: 'Dư Có' },
  { id: 'acc_3338', code: '3338', name: 'Nộp lệ phí môn bài', type: 'Dư Có' },
  { id: 'acc_33381', code: '33381', name: 'Thuế bảo vệ môi trường', type: 'Dư Có' },
  { id: 'acc_33382', code: '33382', name: 'Các loại thuế khác', type: 'Dư Có' },
  { id: 'acc_3339', code: '3339', name: 'Phí, lệ phí và các khoản phải nộp khác', type: 'Dư Có' },
  { id: 'acc_334', code: '334', name: 'Phải trả người lao động', type: 'Dư Có' },
  { id: 'acc_335', code: '335', name: 'Chi phí phải trả', type: 'Dư Có' },
  { id: 'acc_336', code: '336', name: 'Phải trả nội bộ', type: 'Dư Có' },
  { id: 'acc_3361', code: '3361', name: 'Phải trả nội bộ về vốn kinh doanh', type: 'Dư Có' },
  { id: 'acc_3368', code: '3368', name: 'Phải trả nội bộ khác', type: 'Dư Có' },
  { id: 'acc_338', code: '338', name: 'Phải trả, phải nộp khác', type: 'Lưỡng tính' },
  { id: 'acc_3381', code: '3381', name: 'Tài sản thừa chờ giải quyết', type: 'Dư Có' },
  { id: 'acc_3382', code: '3382', name: 'Kinh phí công đoàn', type: 'Dư Có' },
  { id: 'acc_3383', code: '3383', name: 'Bảo hiểm xã hội', type: 'Dư Có' },
  { id: 'acc_3384', code: '3384', name: 'Bảo hiểm y tế', type: 'Dư Có' },
  { id: 'acc_3385', code: '3385', name: 'Bảo hiểm thất nghiệp', type: 'Dư Có' },
  { id: 'acc_3386', code: '3386', name: 'Nhận ký quỹ, ký cược', type: 'Dư Có' },
  { id: 'acc_3387', code: '3387', name: 'Doanh thu chưa thực hiện', type: 'Dư Có' },
  { id: 'acc_3388', code: '3388', name: 'Phải trả, phải nộp khác', type: 'Lưỡng tính' },
  { id: 'acc_341', code: '341', name: 'Vay và nợ thuê tài chính', type: 'Dư Có' },
  { id: 'acc_3411', code: '3411', name: 'Các khoản đi vay', type: 'Dư Có' },
  { id: 'acc_3412', code: '3412', name: 'Nợ thuê tài chính', type: 'Dư Có' },
  { id: 'acc_352', code: '352', name: 'Dự phòng phải trả', type: 'Dư Có' },
  { id: 'acc_3521', code: '3521', name: 'Dự phòng bảo hành sản phẩm hàng hoá', type: 'Dư Có' },
  { id: 'acc_3522', code: '3522', name: 'Dự phòng bảo hành công trình xây dựng', type: 'Dư Có' },
  { id: 'acc_3524', code: '3524', name: 'Dự phòng phải trả khác', type: 'Dư Có' },
  { id: 'acc_353', code: '353', name: 'Quỹ khen thưởng Phúc lợi', type: 'Dư Có' },
  { id: 'acc_3531', code: '3531', name: 'Quỹ khen thưởng', type: 'Dư Có' },
  { id: 'acc_3532', code: '3532', name: 'Quỹ phúc lợi', type: 'Dư Có' },
  { id: 'acc_3533', code: '3533', name: 'Quỹ phúc lợi đã hình thành TSCĐ', type: 'Dư Có' },
  { id: 'acc_3534', code: '3534', name: 'Quỹ thưởng ban quản lý điều hành công ty', type: 'Dư Có' },
  { id: 'acc_356', code: '356', name: 'Quỹ phát triển khoa học và công nghệ', type: 'Dư Có' },
  { id: 'acc_3561', code: '3561', name: 'Quỹ phát triển khoa học và công nghệ', type: 'Dư Có' },
  { id: 'acc_3562', code: '3562', name: 'Quỹ phát triển khoa học và công nghệ đã hình thành TSCĐ', type: 'Dư Có' },

  // --- LOẠI TÀI KHOẢN VỐN CHỦ SỞ HỮU ---
  { id: 'acc_4111', code: '4111', name: 'Vốn đầu tư của chủ sở hữu', type: 'Dư Có' },
  { id: 'acc_4112', code: '4112', name: 'Thặng dư vốn cổ phần', type: 'Dư Có' },
  { id: 'acc_4118', code: '4118', name: 'Vốn khác', type: 'Dư Có' },
  { id: 'acc_413', code: '413', name: 'Chênh lệch tỷ giá hối đoái', type: 'Lưỡng tính' },
  { id: 'acc_418', code: '418', name: 'Các quỹ thuộc vốn chủ sở hữu', type: 'Dư Có' },
  { id: 'acc_419', code: '419', name: 'Cổ phiếu quỹ', type: 'Dư Nợ' },
  { id: 'acc_421', code: '421', name: 'Lợi nhuận sau thuế chưa phân phối', type: 'Lưỡng tính' },
  { id: 'acc_4211', code: '4211', name: 'Lợi nhuận sau thuế chưa phân phối năm trước', type: 'Lưỡng tính' },
  { id: 'acc_4212', code: '4212', name: 'Lợi nhuận sau thuế chưa phân phối năm nay', type: 'Lưỡng tính' },

  // --- LOẠI TÀI KHOẢN DOANH THU ---
  { id: 'acc_511', code: '511', name: 'Doanh thu bán hàng và cung cấp dịch vụ', type: 'Dư Có' },
  { id: 'acc_5111', code: '5111', name: 'Doanh thu bán hàng hoá', type: 'Dư Có' },
  { id: 'acc_5112', code: '5112', name: 'Doanh thu bán thành phẩm', type: 'Dư Có' },
  { id: 'acc_5113', code: '5113', name: 'Doanh thu cung cấp dịch vụ', type: 'Dư Có' },
  { id: 'acc_5118', code: '5118', name: 'Doanh thu khác', type: 'Dư Có' },
  { id: 'acc_515', code: '515', name: 'Doanh thu hoạt động tài chính', type: 'Dư Có' },

  // --- LOẠI TÀI KHOẢN CHI PHÍ SẢN XUẤT, KINH DOANH ---
  { id: 'acc_611', code: '611', name: 'Mua hàng', type: 'Dư Nợ' },
  { id: 'acc_631', code: '631', name: 'Giá thành sản xuất', type: 'Dư Nợ' },
  { id: 'acc_632', code: '632', name: 'Giá vốn hàng bán', type: 'Dư Nợ' },
  { id: 'acc_635', code: '635', name: 'Chi phí tài chính', type: 'Dư Nợ' },
  { id: 'acc_642', code: '642', name: 'Chi phí quản lý doanh nghiệp', type: 'Dư Nợ' },
  { id: 'acc_6421', code: '6421', name: 'Chi phí bán hàng', type: 'Dư Nợ' },
  { id: 'acc_6422', code: '6422', name: 'Chi phí quản lý doanh nghiệp', type: 'Dư Nợ' },
  { id: 'acc_6423', code: '6423', name: 'Chi phí đồ dùng văn phòng', type: 'Dư Nợ' },
  { id: 'acc_6424', code: '6424', name: 'Chi phí khấu hao TSCĐ', type: 'Dư Nợ' },
  { id: 'acc_6425', code: '6425', name: 'Thuế, phí và lệ phí', type: 'Dư Nợ' },
  { id: 'acc_6426', code: '6426', name: 'Chi phí dự phòng', type: 'Dư Nợ' },
  { id: 'acc_6427', code: '6427', name: 'Chi phí dịch vụ mua ngoài', type: 'Dư Nợ' },
  { id: 'acc_6428', code: '6428', name: 'Chi phí bằng tiền khác', type: 'Dư Nợ' },

  // --- LOẠI TÀI KHOẢN THU NHẬP KHÁC ---
  { id: 'acc_711', code: '711', name: 'Thu nhập khác', type: 'Dư Có' },

  // --- LOẠI TÀI KHOẢN CHI PHÍ KHÁC ---
  { id: 'acc_811', code: '811', name: 'Chi phí khác', type: 'Dư Nợ' },
  { id: 'acc_821', code: '821', name: 'Chi phí thuế thu nhập doanh nghiệp', type: 'Dư Nợ' },

  // --- XÁC ĐỊNH KQKD ---
  { id: 'acc_911', code: '911', name: 'Xác định kết quả kinh doanh', type: 'Lưỡng tính' },
];

const mergeAccountsWithDefaults = (existing: AccountDefinition[] | undefined | null): AccountDefinition[] => {
  const byCode = new Map<string, AccountDefinition>();
  for (const a of DEFAULT_ACCOUNTS) byCode.set(String(a.code), a);
  for (const a of INVOICE_PURCHASE_SERVICE_EXTRA_ACCOUNTS) {
    const code = String(a.code);
    const prev = byCode.get(code);
    byCode.set(code, prev ? ({ ...prev, ...a } as AccountDefinition) : a);
  }
  if (Array.isArray(existing)) {
    for (const a of existing) {
      if (!a || !a.code) continue;
      byCode.set(String(a.code), { ...byCode.get(String(a.code)), ...a } as AccountDefinition);
    }
  }

  ensureCoreCashBankAccounts(byCode);

  // Enforce a few business-specific names for consistency in UI dropdowns/datalists.
  // (Existing persisted state may carry older labels.)
  const acc3338 = byCode.get('3338');
  if (acc3338) byCode.set('3338', { ...acc3338, name: 'Nộp lệ phí môn bài' });

  for (const code of ['6421', '6422'] as const) {
    const def = DEFAULT_ACCOUNTS.find((x) => String(x.code) === code);
    const cur = byCode.get(code);
    if (def && cur) {
      byCode.set(code, { ...cur, name: def.name, type: def.type });
    }
  }

  const list = Array.from(byCode.values());
  list.sort((a, b) => {
    const ca = String(a.code);
    const cb = String(b.code);
    const na = Number(ca);
    const nb = Number(cb);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    if (ca !== cb && (ca.startsWith(cb) || cb.startsWith(ca))) return ca.length - cb.length;
    return ca.localeCompare(cb, 'vi');
  });
  return list;
};

const buildBankLinkedAccountName = (bankName: string, accountNumber: string) => {
  const trimmedBankName = String(bankName || '').trim();
  const trimmedAccountNumber = String(accountNumber || '').trim();
  return `Tiền gửi ${trimmedBankName}${trimmedAccountNumber ? ` - ${trimmedAccountNumber}` : ''}`.trim();
};

const buildBankLinkedAccountDefinition = (
  bank: Pick<BankAccount, 'linkedAccountCode' | 'bankName' | 'accountNumber'>,
): AccountDefinition => ({
  id: `acc_${String(bank.linkedAccountCode).trim()}`,
  code: String(bank.linkedAccountCode).trim(),
  name: buildBankLinkedAccountName(bank.bankName, bank.accountNumber),
  type: 'Dư Nợ',
});

const normalizeBankAccountRecord = (raw: Partial<BankAccount> | undefined | null): BankAccount | null => {
  if (!raw) return null;
  const bankName = String(raw.bankName || '').trim();
  const accountNumber = String(raw.accountNumber || '').trim();
  const accountHolder = String(raw.accountHolder || '').trim();
  const linkedAccountCode = String(raw.linkedAccountCode || '').trim();
  if (!bankName || !accountNumber || !accountHolder || !linkedAccountCode) return null;
  return {
    id: String(raw.id || '').trim() || newEntityId(),
    bankName,
    accountNumber,
    accountHolder,
    branch: String(raw.branch || '').trim() || undefined,
    linkedAccountCode,
    status: raw.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
  };
};

const normalizeBankAccounts = (items: unknown): BankAccount[] => {
  if (!Array.isArray(items)) return [];
  const seenIds = new Set<string>();
  const out: BankAccount[] = [];
  for (const item of items) {
    const normalized = normalizeBankAccountRecord(item as Partial<BankAccount>);
    if (!normalized) continue;
    if (seenIds.has(normalized.id)) continue;
    seenIds.add(normalized.id);
    out.push(normalized);
  }
  out.sort((a, b) => {
    const bankCmp = a.bankName.localeCompare(b.bankName, 'vi');
    if (bankCmp !== 0) return bankCmp;
    return a.accountNumber.localeCompare(b.accountNumber, 'vi');
  });
  return out;
};

// Persist app data to backend + SQLite (via /api/state).
// Vite proxy maps `/api` -> `http://127.0.0.1:4000` in dev.
const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';
/** Tránh lặp dấu / khi ghép path (vd. env `.../api/`) */
const API_PREFIX = String(API_BASE || '/api').replace(/\/$/, '');
const getToken = () => {
  try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
};
const consumePostLoginTab = () => {
  try {
    const v = localStorage.getItem('post_login_tab') || '';
    if (v) localStorage.removeItem('post_login_tab');
    return v;
  } catch {
    return '';
  }
};
const clearToken = () => {
  try { localStorage.removeItem('auth_token'); } catch {}
};
const forceLogout = () => {
  clearToken();
  // hard reload to re-enter <AuthPage /> gate in App.tsx
  window.location.reload();
};

const getClientId = () => getTabClientId();

const apiAuthHeaders = (token: string, withJson = false): Record<string, string> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Client-Id': getClientId(),
  };
  if (withJson) headers['Content-Type'] = 'application/json';
  return headers;
};

const buildWebSocketUrl = (path: string, token: string) => {
  const wsPath = path.startsWith('/') ? path : `/${path}`;
  const isAbsoluteApi = /^https?:\/\//i.test(API_PREFIX);
  const url = isAbsoluteApi
    ? new URL(wsPath, `${new URL(API_PREFIX).protocol}//${new URL(API_PREFIX).host}`)
    : new URL(wsPath, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
};

const writeClientAuditLog = async (input: {
  action: string;
  resource: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
}) => {
  const token = getToken();
  if (!token) return;
  await fetch(`${API_PREFIX}/audit/client`, {
    method: 'POST',
    headers: apiAuthHeaders(token, true),
    body: JSON.stringify(input),
  }).catch((err) => {
    console.warn('[audit] Failed to write client audit log', err);
  });
};

const readStateRevisionHeader = (res: Response): number | null => {
  const raw = res.headers.get('X-State-Revision');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const readStateDataVersionHeader = (res: Response): number | null => {
  const raw = res.headers.get('X-State-Data-Version');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

type EntityDeletionAuditEntry = {
  id: string;
  entityType: string;
  entityId: string;
  label?: string;
  deletedAt: string;
  deletedByUserId?: string;
  deletedByEmail?: string;
  deletedByName?: string;
};

type DeletedEntityTombstones = Record<string, string[]>;

function filterTombstonedByField<T extends { id?: string }>(
  items: T[],
  tombstones: DeletedEntityTombstones,
  field: string,
): T[] {
  const ids = tombstones[field];
  if (!ids?.length) return items;
  const tombstoneIds = new Set(ids.map(String));
  return items.filter((item) => !tombstoneIds.has(String(item.id || '')));
}

function stripDeletedFromYearData(yd: YearData, tombstones: DeletedEntityTombstones): YearData {
  return {
    ...yd,
    inventory: filterTombstonedByField(yd.inventory || [], tombstones, 'inventory'),
    invoices: filterTombstonedByField(yd.invoices || [], tombstones, 'invoices'),
    accountingVouchers: filterTombstonedByField(yd.accountingVouchers || [], tombstones, 'accountingVouchers'),
    journalEntries: filterTombstonedByField(yd.journalEntries || [], tombstones, 'journalEntries'),
    fundTransactions: filterTombstonedByField(yd.fundTransactions || [], tombstones, 'fundTransactions'),
    transactions: filterTombstonedByField(yd.transactions || [], tombstones, 'transactions'),
  };
}

function mergeTombstoneMaps(
  localValue: DeletedEntityTombstones,
  serverValue: DeletedEntityTombstones,
): DeletedEntityTombstones {
  const fields = new Set([...Object.keys(localValue), ...Object.keys(serverValue)]);
  const out: DeletedEntityTombstones = {};
  for (const field of fields) {
    const ids = new Set<string>();
    for (const id of localValue[field] || []) ids.add(String(id));
    for (const id of serverValue[field] || []) ids.add(String(id));
    if (ids.size > 0) out[field] = [...ids];
  }
  return out;
}

function mergeEntityDeletionAuditLogs(
  local: EntityDeletionAuditEntry[],
  server: EntityDeletionAuditEntry[],
): EntityDeletionAuditEntry[] {
  const byKey = new Map<string, EntityDeletionAuditEntry>();
  for (const entry of [...local, ...server]) {
    const key = `${entry.entityType}:${entry.entityId}`;
    const prev = byKey.get(key);
    if (!prev || entry.deletedAt >= prev.deletedAt) byKey.set(key, entry);
  }
  return [...byKey.values()].slice(-500);
}

/** Debounce ghi PostgreSQL trước khi broadcast WebSocket event. */
const STATE_PERSIST_DEBOUNCE_MS = 50;
/** Chờ ngắn sau WebSocket event rồi tải lại (tránh đè persist đang chạy). */
const REMOTE_STATE_RELOAD_DEBOUNCE_MS = 0;
const REMOTE_STATE_RELOAD_WAIT_PERSIST_MS = 50;

type YearKey = string;

type YearData = {
  accountingPeriods: AccountingPeriod[];
  invoices: Invoice[];
  inventory: InventoryItem[];
  journalEntries: JournalEntry[];
  transactions: InventoryTransaction[];
  fundTransactions: FundTransaction[];
  accountingVouchers: AccountingVoucher[];
  productionOrders: ProductionOrder[];
  documentNumberCounters: Record<string, number>;
  cashFlowOpening: Record<string, number>;
  openingBalanceAccounts: OpeningBalanceAccountRecord[];
  openingBalanceDebts: OpeningBalanceDebtDetail[];
  openingBalanceRolloverMeta?: OpeningBalanceRolloverMeta;
  citExpenseMeta: Record<string, CITExpenseMeta>;
  citLossRecords: CITLossRecord[];
};

type OpeningBalancesApiYearPayload = {
  openingBalanceAccounts: OpeningBalanceAccountRecord[];
  openingBalanceRolloverMeta?: OpeningBalanceRolloverMeta | null;
};

type OpeningBalancesApiPayload = {
  byYearKey: Record<YearKey, OpeningBalancesApiYearPayload>;
};

type DebtDetailsApiPayload = {
  byYearKey: Record<YearKey, OpeningBalanceDebtDetail[]>;
};

type InvoiceDeleteTarget = Pick<Invoice, 'id' | 'invoiceNumber' | 'date' | 'customerName' | 'totalAmount' | 'type' | 'category'>;

const makeYearKey = (fy: FinancialYear): YearKey => `${fy.startDate}..${fy.endDate}`;
const parseYearKey = (key: YearKey): FinancialYear => {
  const [startDate, endDate] = key.split('..');
  return { startDate, endDate };
};

/** Đưa ngày YYYY-MM-DD vào [start,end] niên độ để bút toán hiện trên Sổ NKC/Báo cáo khi đang xem đúng kỳ (tránh lọc mất khi nhập ngày SD cũ). */
const clampDateToFinancialYear = (dateStr: string, fy: FinancialYear): string => {
  const d = String(dateStr || '').split('T')[0];
  if (!d) return fy.startDate;
  if (d < fy.startDate) return fy.startDate;
  if (d > fy.endDate) return fy.endDate;
  return d;
};

const dateInFinancialYear = (dateStr: string, start: string, end: string): boolean => {
  const x = String(dateStr || '').split('T')[0];
  return x >= start && x <= end;
};

/** Gỡ các khóa meta CIT khỏi bản sao niên độ (khi hợp nhất / loại trùng bút NKC). */
const stripCitExpenseMetaKeys = (
  meta: Record<string, CITExpenseMeta> | undefined,
  dropKeys: Set<string>,
): Record<string, CITExpenseMeta> => {
  if (!meta || dropKeys.size === 0) return meta ? { ...meta } : {};
  const next: Record<string, CITExpenseMeta> = { ...meta };
  for (const k of dropKeys) delete next[k];
  return next;
};

const buildEmptyYearData = (seedInventory: InventoryItem[] = []): YearData => ({
  accountingPeriods: [],
  invoices: [],
  inventory: seedInventory.map(i => ({
    ...ensureWarehouseBalances(i, createDefaultWarehouse().id),
    quantity: 0,
    costPrice: 0,
    serials: [],
    serialDetails: [],
    warehouseBalances: [],
  })),
  journalEntries: [],
  transactions: [],
  fundTransactions: [],
  accountingVouchers: [],
  documentNumberCounters: {},
  cashFlowOpening: {},
  openingBalanceAccounts: [],
  openingBalanceDebts: [],
  citExpenseMeta: {},
  citLossRecords: [],
  productionOrders: [],
});

/** Bút ghi số dư đầu kỳ / kết chuyển niên độ — không tính là « phát sinh » khi quyết định có ghi đè kết chuyển hay không. */
const isOpeningLikeJournalEntry = (je: JournalEntry): boolean => {
  const ref = (je.referenceId || '').toUpperCase();
  const desc = (je.description || '').toLowerCase();
  const id = String(je.id || '').toUpperCase();
  return (
    ref.startsWith('OPENING') ||
    id.startsWith('JE-OPEN') ||
    desc.includes('số dư đầu kỳ') ||
    desc.includes('dư nợ đầu kỳ')
  );
};

/** Niên độ đã có HĐ, chứng từ, kho, quỹ hoặc bút toán ngoài số dư đầu kỳ → không được xóa bằng kết chuyển sạch. */
const yearDataHasOperationalRecords = (yd: YearData | undefined): boolean => {
  if (!yd) return false;
  if ((yd.invoices?.length || 0) > 0) return true;
  if ((yd.accountingVouchers?.length || 0) > 0) return true;
  if ((yd.transactions?.length || 0) > 0) return true;
  if ((yd.fundTransactions?.length || 0) > 0) return true;
  if ((yd.productionOrders?.length || 0) > 0) return true;
  for (const je of yd.journalEntries || []) {
    if (!isOpeningLikeJournalEntry(je)) return true;
  }
  return false;
};

const computeAccountNetBalances = (entries: JournalEntry[], endDate: string) => {
  const netByAccount = new Map<string, number>();
  for (const je of entries) {
    if (je.date > endDate) continue;
    for (const d of je.details || []) {
      const acc = String(d.account);
      const prev = netByAccount.get(acc) || 0;
      // net = debit - credit (double-entry => sum(net)=0)
      netByAccount.set(acc, prev + (Number(d.debit || 0) - Number(d.credit || 0)));
    }
  }
  // Remove ~0 noise
  for (const [k, v] of Array.from(netByAccount.entries())) {
    if (Math.abs(v) < 0.000001) netByAccount.delete(k);
  }
  return netByAccount;
};

const computeSubledgerNetBalances = (entries: JournalEntry[], endDate: string, accountPrefix: string) => {
  const netByObject = new Map<string, number>();
  for (const je of entries) {
    if (je.date > endDate) continue;
    for (const d of je.details || []) {
      const acc = String(d.account);
      if (!acc.startsWith(accountPrefix)) continue;
      const key = String(d.objectId || d.objectName || 'UNKNOWN');
      const prev = netByObject.get(key) || 0;
      netByObject.set(key, prev + (Number(d.debit || 0) - Number(d.credit || 0)));
    }
  }
  for (const [k, v] of Array.from(netByObject.entries())) {
    if (Math.abs(v) < 0.000001) netByObject.delete(k);
  }
  return netByObject;
};

const computeInvoiceOpenBalances = (
  entries: JournalEntry[],
  endDate: string,
  accountPrefix: '131' | '331',
): Map<string, number> => {
  const out = new Map<string, number>();
  for (const je of entries) {
    if (je.date > endDate) continue;
    for (const d of je.details || []) {
      const account = String(d.account || '');
      if (!account.startsWith(accountPrefix)) continue;
      const key = String(d.sourceInvoiceId || d.objectId || d.sourceInvoiceNumber || '').trim();
      if (!key) continue;
      const prev = out.get(key) || 0;
      out.set(key, prev + (Number(d.debit || 0) - Number(d.credit || 0)));
    }
  }
  for (const [key, net] of Array.from(out.entries())) {
    if (Math.abs(net) < 0.000001) out.delete(key);
  }
  return out;
};

const resolveCashBankAccountFromPaymentMethod = (
  paymentMethod?: string,
  bankLedgerAccountCode?: string,
) => {
  return resolveCashBankAccountCode(paymentMethod, bankLedgerAccountCode);
};

const resolveFundMethodFromPaymentMethod = (
  paymentMethod?: string,
  bankLedgerAccountCode?: string,
): 'BANK' | 'CASH' | null => {
  return resolveFundMethodFromPayment(paymentMethod, bankLedgerAccountCode);
};

const normalizePaymentAccountCode = (account?: string) => {
  const code = String(account || '').trim();
  if (code === '111') return '1111';
  if (code === '112') return '1121';
  return code;
};

const mergeAccountNetBalanceMaps = (a: Map<string, number>, b: Map<string, number>): Map<string, number> => {
  const out = new Map<string, number>(a);
  for (const [k, v] of b.entries()) {
    const n = (out.get(k) || 0) + v;
    if (Math.abs(n) < 0.000001) out.delete(k);
    else out.set(k, n);
  }
  return out;
};

/** Số dư lũy kế theo tài khoản từ chứng từ đã ghi (Dr − Cr trên từng TK) — bổ sung cho journalEntries. */
const computeVoucherAccountNetBalances = (vouchers: AccountingVoucher[] | undefined, endDate: string): Map<string, number> => {
  const netByAccount = new Map<string, number>();
  for (const v of vouchers || []) {
    if (v.status === 'DRAFT') continue;
    const d0 = String(v.postingDate || v.date || '').split('T')[0];
    if (!d0 || d0 > endDate) continue;
    for (const line of v.details || []) {
      const amt = Number(line.amount || 0);
      if (!(amt > 0)) continue;
      const da = normalizePaymentAccountCode(line.debitAccount);
      const ca = normalizePaymentAccountCode(line.creditAccount);
      if (da) {
        netByAccount.set(da, (netByAccount.get(da) || 0) + amt);
      }
      if (ca) {
        netByAccount.set(ca, (netByAccount.get(ca) || 0) - amt);
      }
    }
  }
  for (const [k, v] of Array.from(netByAccount.entries())) {
    if (Math.abs(v) < 0.000001) netByAccount.delete(k);
  }
  return netByAccount;
};

const sumNetDebitPositiveByAccountPrefix = (nets: Map<string, number>, prefix: string) => {
  let t = 0;
  for (const [code, net] of nets.entries()) {
    if (!String(code).startsWith(prefix)) continue;
    if (net > 0) t += net;
  }
  return roundVnd(t);
};

const sumNetCreditMagnitudeByAccountPrefix = (nets: Map<string, number>, prefix: string) => {
  let t = 0;
  for (const [code, net] of nets.entries()) {
    if (!String(code).startsWith(prefix)) continue;
    if (net < 0) t += -net;
  }
  return roundVnd(t);
};

const normalizeJournalEntriesPaymentAccounts = (entries: JournalEntry[] | undefined | null) => {
  if (!Array.isArray(entries)) return [];
  let changed = false;
  const next = entries.map((entry) => {
    let entryChanged = false;
    const details = (Array.isArray(entry.details) ? entry.details : []).map((detail) => {
      const normalizedAccount = normalizePaymentAccountCode(detail.account);
      if (normalizedAccount !== detail.account) {
        changed = true;
        entryChanged = true;
        return { ...detail, account: normalizedAccount };
      }
      return detail;
    });
    return entryChanged ? { ...entry, details } : entry;
  });
  return changed ? next : entries;
};

const normalizeAccountingVouchersPaymentAccounts = (vouchers: AccountingVoucher[] | undefined | null) => {
  if (!Array.isArray(vouchers)) return [];
  let changed = false;
  const next = vouchers.map((voucher) => {
    let voucherChanged = false;
    const details = (voucher.details || []).map((detail) => {
      const debitAccount = normalizePaymentAccountCode(detail.debitAccount);
      const creditAccount = normalizePaymentAccountCode(detail.creditAccount);
      if (debitAccount !== detail.debitAccount || creditAccount !== detail.creditAccount) {
        changed = true;
        voucherChanged = true;
        return { ...detail, debitAccount, creditAccount };
      }
      return detail;
    });
    return voucherChanged ? { ...voucher, details } : voucher;
  });
  return changed ? next : vouchers;
};

const normalizeYearDataPaymentAccounts = (yd: YearData): YearData => {
  const journalEntries = normalizeJournalEntriesPaymentAccounts(yd.journalEntries || []);
  const accountingVouchers = normalizeAccountingVouchersPaymentAccounts(yd.accountingVouchers || []);
  const rawInvoices = yd.invoices || [];
  const invoices = rawInvoices.map((inv) => coercePaidInvoicePaymentMethodFromDebtLabels(inv));
  const invoicesChanged = invoices.some((inv, i) => inv !== rawInvoices[i]);
  const rawOpeningBalanceAccounts = Array.isArray((yd as any).openingBalanceAccounts)
    ? ((yd as any).openingBalanceAccounts as OpeningBalanceAccountRecord[])
    : undefined;
  const normalizedOpeningBalanceAccounts = normalizeOpeningBalanceAccounts((yd as any).openingBalanceAccounts);
  const openingBalanceAccounts =
    normalizedOpeningBalanceAccounts.length > 0
      ? normalizedOpeningBalanceAccounts
      : buildOpeningAccountsFromJournalEntries(journalEntries);
  const openingBalanceDebts = normalizeOpeningBalanceDebts((yd as any).openingBalanceDebts);
  const openingBalanceRolloverMeta = normalizeOpeningBalanceRolloverMeta((yd as any).openingBalanceRolloverMeta);
  const openingAccountsChanged =
    !rawOpeningBalanceAccounts ||
    rawOpeningBalanceAccounts.length !== openingBalanceAccounts.length ||
    rawOpeningBalanceAccounts.some((row, index) => {
      const nextRow = openingBalanceAccounts[index];
      return (
        !nextRow ||
        String(row.accountCode || '') !== String(nextRow.accountCode || '') ||
        Number(row.debit || 0) !== Number(nextRow.debit || 0) ||
        Number(row.credit || 0) !== Number(nextRow.credit || 0) ||
        String(row.originMode || 'MANUAL') !== String(nextRow.originMode || 'MANUAL') ||
        Boolean(row.readOnly) !== Boolean(nextRow.readOnly) ||
        String(row.lockReason || '') !== String(nextRow.lockReason || '')
      );
    });
  const openingDebtsChanged =
    openingBalanceDebts.length !== (((yd as any).openingBalanceDebts as OpeningBalanceDebtDetail[] | undefined)?.length || 0);
  const rolloverMetaChanged =
    JSON.stringify(openingBalanceRolloverMeta || null) !== JSON.stringify((yd as any).openingBalanceRolloverMeta || null);
  if (
    journalEntries === yd.journalEntries &&
    accountingVouchers === yd.accountingVouchers &&
    !invoicesChanged &&
    !openingAccountsChanged &&
    !openingDebtsChanged &&
    !rolloverMetaChanged
  ) {
    return yd;
  }
  return {
    ...yd,
    journalEntries,
    accountingVouchers,
    invoices,
    openingBalanceAccounts,
    openingBalanceDebts,
    openingBalanceRolloverMeta,
  };
};

const createEntityId = (prefix: string) => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {
    // ignore and fallback below
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const OPENING_DEBT_REVENUE_TYPES: readonly OpeningDebtRevenueType[] = [
  'BAN_HANG_HOA',
  'CUNG_CAP_DICH_VU',
  'XAY_LAP_DU_AN',
  'MUA_HANG_HOA',
  'MUA_DICH_VU',
  'TAI_SAN_CCDC',
  'KHAC',
];

const normalizeOpeningDebtRevenueType = (value: unknown): OpeningDebtRevenueType => {
  const raw = String(value || '').trim() as OpeningDebtRevenueType;
  return OPENING_DEBT_REVENUE_TYPES.includes(raw) ? raw : 'KHAC';
};

const normalizeOpeningBalanceDebtDetail = (raw: any): OpeningBalanceDebtDetail | null => {
  if (!raw || typeof raw !== 'object') return null;
  const kind: OpeningDebtKind = raw.kind === 'SUPPLIER_DEBT' ? 'SUPPLIER_DEBT' : 'CUSTOMER_DEBT';
  const amount = Math.max(0, Number(raw.amount || 0));
  return {
    id: String(raw.id || createEntityId('open-debt')),
    kind,
    partnerId: raw.partnerId != null && String(raw.partnerId).trim() ? String(raw.partnerId).trim() : undefined,
    partnerCode: raw.partnerCode != null && String(raw.partnerCode).trim() ? String(raw.partnerCode).trim() : undefined,
    partnerName: String(raw.partnerName || '').trim(),
    invoiceSymbolCode:
      raw.invoiceSymbolCode != null && String(raw.invoiceSymbolCode).trim()
        ? String(raw.invoiceSymbolCode).trim()
        : undefined,
    invoiceNo: String(raw.invoiceNo || '').trim(),
    revenueType: normalizeOpeningDebtRevenueType(raw.revenueType),
    amount,
    dueDate: raw.dueDate != null && String(raw.dueDate).trim() ? String(raw.dueDate).split('T')[0] : undefined,
    note: raw.note != null && String(raw.note).trim() ? String(raw.note).trim() : undefined,
    accountCode: raw.accountCode === '331' ? '331' : '131',
    sourceInvoiceId:
      raw.sourceInvoiceId != null && String(raw.sourceInvoiceId).trim() ? String(raw.sourceInvoiceId).trim() : undefined,
    sourceInvoiceNumber:
      raw.sourceInvoiceNumber != null && String(raw.sourceInvoiceNumber).trim()
        ? String(raw.sourceInvoiceNumber).trim()
        : undefined,
    sourceInvoiceDate:
      raw.sourceInvoiceDate != null && String(raw.sourceInvoiceDate).trim()
        ? String(raw.sourceInvoiceDate).split('T')[0]
        : undefined,
    sourceYearKey:
      raw.sourceYearKey != null && String(raw.sourceYearKey).trim() ? String(raw.sourceYearKey).trim() : undefined,
    openingYearKey:
      raw.openingYearKey != null && String(raw.openingYearKey).trim() ? String(raw.openingYearKey).trim() : undefined,
    originMode: raw.originMode === 'ROLLOVER' ? 'ROLLOVER' : 'MANUAL',
    readOnly: Boolean(raw.readOnly),
    lockReason: raw.lockReason != null && String(raw.lockReason).trim() ? String(raw.lockReason).trim() : undefined,
    syncStatus:
      raw.syncStatus === 'MISMATCHED' || raw.syncStatus === 'STALE' ? raw.syncStatus : 'MATCHED',
  };
};

const normalizeOpeningBalanceDebts = (raw: unknown): OpeningBalanceDebtDetail[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeOpeningBalanceDebtDetail(item))
    .filter((item): item is OpeningBalanceDebtDetail => Boolean(item));
};

const normalizeOpeningBalanceAccountRecord = (raw: any): OpeningBalanceAccountRecord | null => {
  if (!raw || typeof raw !== 'object') return null;
  const accountCode = String(raw.accountCode || raw.account || '').trim();
  if (!accountCode) return null;
  return {
    accountCode,
    debit: Math.max(0, Number(raw.debit || 0)),
    credit: Math.max(0, Number(raw.credit || 0)),
    originMode:
      raw.originMode === 'ROLLOVER' || raw.originMode === 'SYNC_FROM_DEBT' ? raw.originMode : 'MANUAL',
    readOnly: Boolean(raw.readOnly),
    lockReason: raw.lockReason != null && String(raw.lockReason).trim() ? String(raw.lockReason).trim() : undefined,
  };
};

const normalizeOpeningBalanceAccounts = (raw: unknown): OpeningBalanceAccountRecord[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeOpeningBalanceAccountRecord(item))
    .filter((item): item is OpeningBalanceAccountRecord => Boolean(item));
};

const normalizeOpeningBalanceRolloverMeta = (raw: unknown): OpeningBalanceRolloverMeta | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const sourceYearKey = String((raw as any).sourceYearKey || '').trim();
  if (!sourceYearKey) return undefined;
  return {
    sourceYearKey,
    generatedAt: String((raw as any).generatedAt || new Date().toISOString()),
    lockedAccountCodes: Array.isArray((raw as any).lockedAccountCodes)
      ? Array.from(
          new Set(
            (raw as any).lockedAccountCodes
              .map((item: unknown) => String(item || '').trim())
              .filter(Boolean),
          ),
        )
      : undefined,
    lockedDebtKinds: Array.isArray((raw as any).lockedDebtKinds)
      ? Array.from(
          new Set(
            (raw as any).lockedDebtKinds.filter(
              (item: unknown) => item === 'CUSTOMER_DEBT' || item === 'SUPPLIER_DEBT',
            ),
          ),
        ) as OpeningDebtKind[]
      : undefined,
  };
};

const OPENING_STATE_FIELDS = [
  'openingBalanceAccounts',
  'openingBalanceDebts',
  'openingBalanceRolloverMeta',
] as const;

const stripOpeningDataFromStateSnapshot = <T extends Record<string, unknown>>(rawState: T): T => {
  const nextState = JSON.parse(JSON.stringify(rawState || {})) as T & { yearDataByKey?: Record<string, Record<string, unknown>> };

  for (const field of OPENING_STATE_FIELDS) {
    delete (nextState as Record<string, unknown>)[field];
  }

  if (nextState.yearDataByKey && typeof nextState.yearDataByKey === 'object') {
    for (const yearData of Object.values(nextState.yearDataByKey)) {
      if (!yearData || typeof yearData !== 'object') continue;
      for (const field of OPENING_STATE_FIELDS) {
        delete yearData[field];
      }
    }
  }

  return nextState;
};

const buildOpeningApiPayloadsFromYearDataMap = (
  yearDataByKey: Record<YearKey, YearData>,
  activeYearKey: YearKey,
  activeYearData?: YearData,
): {
  openingBalancesPayload: OpeningBalancesApiPayload;
  debtDetailsPayload: DebtDetailsApiPayload;
} => {
  const mergedYearDataByKey =
    activeYearKey && activeYearData
      ? { ...yearDataByKey, [activeYearKey]: activeYearData }
      : { ...yearDataByKey };

  const openingBalancesPayload: OpeningBalancesApiPayload = { byYearKey: {} };
  const debtDetailsPayload: DebtDetailsApiPayload = { byYearKey: {} };

  for (const [yearKey, yearData] of Object.entries(mergedYearDataByKey)) {
    openingBalancesPayload.byYearKey[yearKey] = {
      openingBalanceAccounts: normalizeOpeningBalanceAccounts((yearData as any).openingBalanceAccounts),
      openingBalanceRolloverMeta: normalizeOpeningBalanceRolloverMeta((yearData as any).openingBalanceRolloverMeta) || null,
    };
    debtDetailsPayload.byYearKey[yearKey] = normalizeOpeningBalanceDebts((yearData as any).openingBalanceDebts);
  }

  return { openingBalancesPayload, debtDetailsPayload };
};

const mergeOpeningApiPayloadIntoState = (
  rawState: any,
  openingBalancesPayload: OpeningBalancesApiPayload,
  debtDetailsPayload: DebtDetailsApiPayload,
) => {
  const nextState = rawState && typeof rawState === 'object' ? { ...rawState } : {};
  const rawYearDataByKey =
    nextState.yearDataByKey && typeof nextState.yearDataByKey === 'object'
      ? (nextState.yearDataByKey as Record<YearKey, YearData>)
      : {};
  const nextYearDataByKey: Record<YearKey, YearData> = {};
  const openingBalancesByYearKey = openingBalancesPayload?.byYearKey || {};
  const debtDetailsByYearKey = debtDetailsPayload?.byYearKey || {};
  const allYearKeys = new Set<YearKey>([
    ...Object.keys(rawYearDataByKey),
    ...Object.keys(openingBalancesByYearKey),
    ...Object.keys(debtDetailsByYearKey),
  ]);

  for (const yearKey of allYearKeys) {
    const baseYearData = rawYearDataByKey[yearKey] || buildEmptyYearData([]);
    const openingBalanceYear = openingBalancesByYearKey[yearKey];
    nextYearDataByKey[yearKey] = {
      ...baseYearData,
      openingBalanceAccounts: normalizeOpeningBalanceAccounts(openingBalanceYear?.openingBalanceAccounts),
      openingBalanceDebts: normalizeOpeningBalanceDebts(debtDetailsByYearKey[yearKey]),
      openingBalanceRolloverMeta: normalizeOpeningBalanceRolloverMeta(openingBalanceYear?.openingBalanceRolloverMeta),
    };
  }

  nextState.yearDataByKey = nextYearDataByKey;

  const activeYearKey =
    typeof nextState.activeYearKey === 'string' && nextState.activeYearKey
      ? nextState.activeYearKey
      : nextState.financialYear?.startDate && nextState.financialYear?.endDate
        ? makeYearKey(nextState.financialYear as FinancialYear)
        : '';

  if (activeYearKey) {
    const activeYearData = nextYearDataByKey[activeYearKey] || buildEmptyYearData([]);
    nextState.openingBalanceAccounts = normalizeOpeningBalanceAccounts(activeYearData.openingBalanceAccounts);
    nextState.openingBalanceDebts = normalizeOpeningBalanceDebts(activeYearData.openingBalanceDebts);
    nextState.openingBalanceRolloverMeta =
      normalizeOpeningBalanceRolloverMeta(activeYearData.openingBalanceRolloverMeta) || null;
  }

  return nextState;
};

const buildActiveOpeningHydrationSignature = (
  activeYearKey: YearKey,
  openingYearData?: Partial<YearData> | null,
) =>
  JSON.stringify({
    activeYearKey,
    openingBalanceAccounts: normalizeOpeningBalanceAccounts((openingYearData as any)?.openingBalanceAccounts),
    openingBalanceDebts: normalizeOpeningBalanceDebts((openingYearData as any)?.openingBalanceDebts),
    openingBalanceRolloverMeta: normalizeOpeningBalanceRolloverMeta((openingYearData as any)?.openingBalanceRolloverMeta) || null,
  });

const isActiveOpeningHydrationReady = (
  pendingSignature: string,
  currentOpeningState: {
    activeYearKey: YearKey;
    openingBalanceAccounts: OpeningBalanceAccountRecord[];
    openingBalanceDebts: OpeningBalanceDebtDetail[];
    openingBalanceRolloverMeta?: OpeningBalanceRolloverMeta;
  },
) => {
  try {
    const pending = JSON.parse(pendingSignature) as {
      activeYearKey: YearKey;
      openingBalanceAccounts: OpeningBalanceAccountRecord[];
      openingBalanceDebts: OpeningBalanceDebtDetail[];
      openingBalanceRolloverMeta?: OpeningBalanceRolloverMeta | null;
    };
    const currentAccounts = normalizeOpeningBalanceAccounts(currentOpeningState.openingBalanceAccounts);
    const currentDebts = normalizeOpeningBalanceDebts(currentOpeningState.openingBalanceDebts);
    const currentMeta = normalizeOpeningBalanceRolloverMeta(currentOpeningState.openingBalanceRolloverMeta) || null;
    const pendingMeta = pending.openingBalanceRolloverMeta || null;

    if (currentOpeningState.activeYearKey !== pending.activeYearKey) return false;
    if (currentAccounts.length < (pending.openingBalanceAccounts?.length || 0)) return false;
    if (currentDebts.length < (pending.openingBalanceDebts?.length || 0)) return false;
    if (JSON.stringify(currentMeta) !== JSON.stringify(pendingMeta)) return false;

    return true;
  } catch {
    return false;
  }
};

const buildOpeningAccountsFromJournalEntries = (entries: JournalEntry[]): OpeningBalanceAccountRecord[] => {
  const openingEntry = (entries || []).find((entry) => String(entry.referenceId || '') === 'OPENING-ACC');
  if (!openingEntry) return [];
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const detail of openingEntry.details || []) {
    const accountCode = String(detail.account || '').trim();
    if (!accountCode) continue;
    const current = totals.get(accountCode) || { debit: 0, credit: 0 };
    current.debit += Number(detail.debit || 0);
    current.credit += Number(detail.credit || 0);
    totals.set(accountCode, current);
  }
  return Array.from(totals.entries()).map(([accountCode, value]) => ({
    accountCode,
    debit: Math.round(value.debit),
    credit: Math.round(value.credit),
    originMode: 'MANUAL',
  }));
};

const getOpeningDebtReferenceId = (kind: OpeningDebtKind) =>
  kind === 'CUSTOMER_DEBT' ? 'OPENING-CUSTOMER_DEBT' : 'OPENING-SUPPLIER_DEBT';

const getOpeningDebtDescription = (kind: OpeningDebtKind) =>
  kind === 'CUSTOMER_DEBT' ? 'Dư nợ đầu kỳ Khách hàng' : 'Dư nợ đầu kỳ Nhà cung cấp';

const sumOpeningDebtByKind = (rows: OpeningBalanceDebtDetail[], kind: OpeningDebtKind) =>
  Math.round(
    (rows || [])
      .filter((row) => row.kind === kind)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0),
  );

const syncOpeningDebtTotalsIntoAccounts = (
  rows: OpeningBalanceAccountRecord[],
  debts: OpeningBalanceDebtDetail[],
  opts?: { readOnly?: boolean; originMode?: OpeningBalanceAccountRecord['originMode']; lockReason?: string },
): OpeningBalanceAccountRecord[] => {
  const byAccount = new Map<string, OpeningBalanceAccountRecord>(
    (rows || []).map((row) => [
      String(row.accountCode || '').trim(),
      {
        accountCode: String(row.accountCode || '').trim(),
        debit: Math.max(0, Number(row.debit || 0)),
        credit: Math.max(0, Number(row.credit || 0)),
        originMode: row.originMode || 'MANUAL',
        readOnly: Boolean(row.readOnly),
        lockReason: row.lockReason,
      },
    ]),
  );

  const arTotal = sumOpeningDebtByKind(debts, 'CUSTOMER_DEBT');
  const apTotal = sumOpeningDebtByKind(debts, 'SUPPLIER_DEBT');
  const sharedPatch = {
    originMode: opts?.originMode || 'SYNC_FROM_DEBT',
    readOnly: Boolean(opts?.readOnly),
    lockReason: opts?.lockReason,
  };

  byAccount.set('131', {
    accountCode: '131',
    debit: arTotal,
    credit: 0,
    ...sharedPatch,
  });
  byAccount.set('331', {
    accountCode: '331',
    debit: 0,
    credit: apTotal,
    ...sharedPatch,
  });

  return Array.from(byAccount.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
};

const buildOpeningAccountJournalEntry = (
  rows: OpeningBalanceAccountRecord[],
  debts: OpeningBalanceDebtDetail[],
  startDate: string,
): JournalEntry | null => {
  const details = (rows || [])
    .filter((row) => {
      const accountCode = String(row.accountCode || '').trim();
      if (!accountCode) return false;
      return Number(row.debit || 0) > 0 || Number(row.credit || 0) > 0;
    })
    .map((row) => ({
      account: String(row.accountCode || '').trim(),
      debit: Math.max(0, Number(row.debit || 0)),
      credit: Math.max(0, Number(row.credit || 0)),
    }));
  if (details.length === 0) return null;
  return {
    id: `JE-OPEN-ACC-${Date.now()}`,
    date: startDate,
    referenceId: 'OPENING-ACC',
    description: 'Số dư đầu kỳ Tài khoản',
    details,
  };
};

const buildOpeningDebtJournalEntry = (
  kind: OpeningDebtKind,
  rows: OpeningBalanceDebtDetail[],
  startDate: string,
): JournalEntry | null => {
  const filteredRows = (rows || [])
    .filter((row) => row.kind === kind && Number(row.amount || 0) > 0);
  if (filteredRows.length === 0) return null;
  const totalAmount = filteredRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return {
    id: `JE-OPEN-DEBT-${kind}-${Date.now()}`,
    date: startDate,
    referenceId: getOpeningDebtReferenceId(kind),
    description: getOpeningDebtDescription(kind),
    details:
      kind === 'CUSTOMER_DEBT'
        ? [
            ...filteredRows.map((row) => ({
              account: '131',
              debit: Number(row.amount || 0),
              credit: 0,
              objectType: 'CUSTOMER' as const,
              objectId: row.partnerId,
              objectName: row.partnerName,
              sourceInvoiceId: row.sourceInvoiceId,
              sourceInvoiceNumber: row.invoiceNo,
              invoiceSymbolCode: row.invoiceSymbolCode,
              openingRevenueType: row.revenueType,
              openingDueDate: row.dueDate,
              openingNote: row.note,
            })),
            {
              account: '131',
              debit: 0,
              credit: totalAmount,
              openingNote: 'Bù tổng chi tiết công nợ đầu kỳ',
            },
          ]
        : [
            {
              account: '331',
              debit: totalAmount,
              credit: 0,
              openingNote: 'Bù tổng chi tiết công nợ đầu kỳ',
            },
            ...filteredRows.map((row) => ({
              account: '331',
              debit: 0,
              credit: Number(row.amount || 0),
              objectType: 'SUPPLIER' as const,
              objectId: row.partnerId,
              objectName: row.partnerName,
              sourceInvoiceId: row.sourceInvoiceId,
              sourceInvoiceNumber: row.invoiceNo,
              invoiceSymbolCode: row.invoiceSymbolCode,
              openingRevenueType: row.revenueType,
              openingDueDate: row.dueDate,
              openingNote: row.note,
            })),
          ],
  };
};

const buildOpeningAccountRowsFromNetBalances = (
  nets: Map<string, number>,
  opts?: { readOnly?: boolean; originMode?: OpeningBalanceAccountRecord['originMode']; lockReason?: string },
): OpeningBalanceAccountRecord[] =>
  Array.from(nets.entries())
    .filter(([accountCode, net]) => String(accountCode || '').trim() && Math.round(Math.abs(Number(net || 0))) > 0)
    .map(([accountCode, net]) => ({
      accountCode: String(accountCode || '').trim(),
      debit: net > 0 ? roundVnd(net) : 0,
      credit: net < 0 ? roundVnd(-net) : 0,
      originMode: opts?.originMode || 'MANUAL',
      readOnly: Boolean(opts?.readOnly),
      lockReason: opts?.lockReason,
    }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

const inferOpeningDebtRevenueTypeFromInvoice = (invoice: Invoice): OpeningDebtRevenueType => {
  if (invoice.type === 'SALES') {
    return invoice.category === 'SERVICE' ? 'CUNG_CAP_DICH_VU' : 'BAN_HANG_HOA';
  }
  return invoice.category === 'SERVICE' ? 'MUA_DICH_VU' : 'MUA_HANG_HOA';
};

const buildInvoiceDeleteTarget = (invoice?: Partial<Invoice> | null): InvoiceDeleteTarget | null => {
  if (!invoice) return null;
  const id = String(invoice.id || '').trim();
  if (!id) return null;
  return {
    id,
    invoiceNumber: String(invoice.invoiceNumber || ''),
    date: String(invoice.date || ''),
    customerName: String(invoice.customerName || ''),
    totalAmount: Number(invoice.totalAmount || 0),
    type: ((invoice.type as Invoice['type']) || 'PURCHASE'),
    category: ((invoice.category as Invoice['category']) || 'DEVICE'),
  };
};

const matchesInvoiceDeleteTarget = (candidate: Invoice | null | undefined, target: InvoiceDeleteTarget | null) => {
  if (!candidate || !target) return false;
  return (
    String(candidate.id || '') === target.id &&
    String(candidate.invoiceNumber || '') === target.invoiceNumber &&
    String(candidate.date || '') === target.date &&
    String(candidate.customerName || '') === target.customerName &&
    Number(candidate.totalAmount || 0) === target.totalAmount &&
    candidate.type === target.type &&
    candidate.category === target.category
  );
};

const removeFirstMatch = <T,>(list: T[], predicate: (item: T) => boolean) => {
  const idx = list.findIndex(predicate);
  if (idx < 0) return list;
  return [...list.slice(0, idx), ...list.slice(idx + 1)];
};

const MONEY_EPSILON = 0.000001;

const toMoneyNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const roundMoneyAmount = (value: unknown, precision = 6) => {
  const factor = 10 ** precision;
  return Math.round(toMoneyNumber(value) * factor) / factor;
};

const getJournalDetailsImbalance = (details: Array<{ debit?: number; credit?: number }>) => {
  const debit = details.reduce((sum, detail) => sum + toMoneyNumber(detail.debit), 0);
  const credit = details.reduce((sum, detail) => sum + toMoneyNumber(detail.credit), 0);
  return roundMoneyAmount(debit - credit);
};

const isTaxJournalAccount = (account: unknown) => {
  const value = String(account || '');
  return value.startsWith('1331') || value.startsWith('3331');
};

const isInvoiceContraAccount = (account: unknown) => {
  const value = String(account || '');
  return value === '131' || value === '331';
};

const rebalanceInvoiceJournalDetails = (details: any[]) => {
  const next = (details || []).map((detail) => ({
    ...detail,
    debit: toMoneyNumber(detail?.debit),
    credit: toMoneyNumber(detail?.credit),
  }));

  const diff = getJournalDetailsImbalance(next);
  if (Math.abs(diff) < MONEY_EPSILON) return next;

  const side: 'debit' | 'credit' = diff > 0 ? 'debit' : 'credit';
  const delta = Math.abs(diff);
  const candidates = next
    .map((detail, index) => ({
      detail,
      index,
      value: toMoneyNumber(detail?.[side]),
    }))
    .filter((entry) => entry.value > 0 && entry.value + MONEY_EPSILON >= delta);

  const target = candidates.find(({ detail }) => isTaxJournalAccount(detail.account))
    || candidates.find(({ detail }) => !isInvoiceContraAccount(detail.account))
    || candidates[0];

  if (!target) return next;

  const adjustedValue = roundMoneyAmount(target.value - delta);
  next[target.index] = {
    ...next[target.index],
    [side]: Math.abs(adjustedValue) < MONEY_EPSILON ? 0 : adjustedValue,
  };

  return next;
};

const buildInvoicePostingDetails = (invoice: Invoice): any[] => {
  const jeDetails: any[] = [];
  const isPurchase = invoice.type === 'PURCHASE';
  const isSales = invoice.type === 'SALES';
  const isDirectPaidDeferredInvoice = isSales
    && isDeferredRevenueInvoice(invoice)
    && invoice.paymentPostingMode === 'DIRECT'
    && invoice.status === 'PAID';
  /** Sai sót trọng yếu kỳ trước: điều chỉnh qua TK 421 (LNST chưa phân phối). */
  const use421 = invoice.crossPeriodMeta?.materiality === 'MATERIAL';

  if (isPurchase) {
    const defaultPurchaseAcc = invoice.category === 'SERVICE' ? '632' : '156';
    const netAcc = (lineAcc: string) => (use421 ? '421' : lineAcc);
    const invoiceDetails = Array.isArray(invoice.details) ? invoice.details : [];
    if (invoiceDetails.length > 0) {
      const weights = invoiceDetails.map((detail: InvoiceDetail) => toMoneyNumber(detail.amount));
      const allocated = allocateRoundedTotal(weights, toMoneyNumber(invoice.amount));
      invoiceDetails.forEach((detail: InvoiceDetail, i: number) => {
        jeDetails.push({
          account: netAcc(detail.account || defaultPurchaseAcc),
          debit: allocated[i] ?? 0,
          credit: 0,
        });
      });
    } else if (toMoneyNumber(invoice.amount) > 0) {
      jeDetails.push({ account: netAcc(defaultPurchaseAcc), debit: toMoneyNumber(invoice.amount), credit: 0 });
    }
    if (toMoneyNumber(invoice.vatAmount) > 0) {
      jeDetails.push({ account: '1331', debit: toMoneyNumber(invoice.vatAmount), credit: 0 });
    }
    jeDetails.push({
      account: '331',
      debit: 0,
      credit: toMoneyNumber(invoice.totalAmount),
      objectType: 'SUPPLIER',
      objectId: invoice.id,
      objectName: invoice.customerName,
      sourceInvoiceId: invoice.id,
      sourceInvoiceNumber: invoice.invoiceNumber,
    });
  } else if (isSales) {
    const salesDebitAccount = isDirectPaidDeferredInvoice
      ? resolveCashBankAccountFromPaymentMethod(invoice.paymentMethod, invoice.bankLedgerAccountCode)
      : '131';
    jeDetails.push({
      account: salesDebitAccount,
      debit: toMoneyNumber(invoice.totalAmount),
      credit: 0,
      objectType: 'CUSTOMER',
      objectId: invoice.id,
      objectName: invoice.customerName,
      sourceInvoiceId: invoice.id,
      sourceInvoiceNumber: invoice.invoiceNumber,
    });
    const deferredRevenueEnabled = isDeferredRevenueInvoice(invoice);
    const invoiceDetails = Array.isArray(invoice.details) ? invoice.details : [];
    if (deferredRevenueEnabled && toMoneyNumber(invoice.amount) > 0) {
      jeDetails.push({
        account: String(invoice.deferredRevenueAccount || '3387'),
        debit: 0,
        credit: toMoneyNumber(invoice.amount),
        objectType: 'CUSTOMER',
        objectId: invoice.id,
        objectName: invoice.customerName,
        sourceInvoiceId: invoice.id,
        sourceInvoiceNumber: invoice.invoiceNumber,
      });
    } else if (invoiceDetails.length > 0) {
      const weights = invoiceDetails.map((detail: InvoiceDetail) => toMoneyNumber(detail.amount));
      const allocated = allocateRoundedTotal(weights, toMoneyNumber(invoice.amount));
      invoiceDetails.forEach((detail: InvoiceDetail, i: number) => {
        const revAcc = use421 ? '421' : (detail.account || (invoice.category === 'SERVICE' ? '5113' : '5111'));
        jeDetails.push({
          account: revAcc,
          debit: 0,
          credit: allocated[i] ?? 0,
          objectType: 'CUSTOMER',
          objectId: invoice.id,
          objectName: invoice.customerName,
          sourceInvoiceId: invoice.id,
          sourceInvoiceNumber: invoice.invoiceNumber,
        });
      });
    } else if (toMoneyNumber(invoice.amount) > 0) {
      jeDetails.push({
        account: use421 ? '421' : (invoice.category === 'SERVICE' ? '5113' : '5111'),
        debit: 0,
        credit: toMoneyNumber(invoice.amount),
        objectType: 'CUSTOMER',
        objectId: invoice.id,
        objectName: invoice.customerName,
        sourceInvoiceId: invoice.id,
        sourceInvoiceNumber: invoice.invoiceNumber,
      });
    }
    if (toMoneyNumber(invoice.vatAmount) > 0) {
      jeDetails.push({
        account: '3331',
        debit: 0,
        credit: toMoneyNumber(invoice.vatAmount),
        objectType: 'CUSTOMER',
        objectId: invoice.id,
        objectName: invoice.customerName,
        sourceInvoiceId: invoice.id,
        sourceInvoiceNumber: invoice.invoiceNumber,
      });
    }
  }

  return rebalanceInvoiceJournalDetails(jeDetails);
};

/** Các id bút JE có thể gắn thu/chi tiền theo hóa đơn (kể cả biến thể cũ) — dùng khi cập nhật HĐ để gỡ hết rồi ghi lại một bút đúng. */
const getInvoiceLinkedPaymentVoucherJeIds = (invoiceId: string): Set<string> => {
  const id = String(invoiceId || '');
  const linkedVoucherId = `VOU-INV-${id}`;
  const separatePaymentVoucherId = `VOU-INV-PAY-${id}`;
  return new Set([
    `JE-VOU-${linkedVoucherId}`,
    `JE-VOU-${separatePaymentVoucherId}`,
    `JE-VOU-INV-${id}`,
    `JE-VOU-INV-PAY-${id}`,
  ]);
};

/** Hóa đơn sinh từ phiếu nhập/xuất kho (Excel/lô) — tiền mặt/ngân hàng đã hạch toán trong JE-IM-BATCH / JE-EX-REV-*, không dùng VOU-INV. */
const isWarehouseStockInvoice = (inv: Invoice | { id?: string }) => {
  const id = String(inv?.id || '');
  return (
    /^INV-PUR-BATCH-/.test(id) ||
    /^INV-SALES-BATCH-/.test(id) ||
    /^INV-PUR-TRX-/.test(id) ||
    /^INV-SALES-TRX-/.test(id)
  );
};

/** Id bút NKChung có dòng 1111/1121 gắn thanh toán phiếu kho (thay đổi TK khi sửa HĐ, không tạo thêm ủy nhiệm chi). */
const getWarehouseCashJournalEntryId = (invoiceId: string): string | null => {
  const id = String(invoiceId || '');
  const batchPur = id.match(/^INV-PUR-BATCH-(.+)$/);
  if (batchPur) return `JE-IM-BATCH-${batchPur[1]}`;
  const batchSal = id.match(/^INV-SALES-BATCH-(.+)$/);
  if (batchSal) return `JE-EX-REV-BATCH-${batchSal[1]}`;
  const trxPur = id.match(/^INV-PUR-(TRX-.+)$/);
  if (trxPur) return `JE-IM-${trxPur[1]}`;
  const trxSal = id.match(/^INV-SALES-(TRX-.+)$/);
  if (trxSal) return `JE-EX-REV-${trxSal[1]}`;
  return null;
};

/** Phiếu quỹ gắn nhập/xuất kho (batch hoặc TRX đơn). */
const getWarehouseFundTransactionId = (invoiceId: string): string | null => {
  const id = String(invoiceId || '');
  const batchPur = id.match(/^INV-PUR-BATCH-(.+)$/);
  if (batchPur) return `FT-PUR-BATCH-${batchPur[1]}`;
  const batchSal = id.match(/^INV-SALES-BATCH-(.+)$/);
  if (batchSal) return `FT-SALES-BATCH-${batchSal[1]}`;
  const trxPur = id.match(/^INV-PUR-(TRX-.+)$/);
  if (trxPur) return `FT-PUR-${trxPur[1]}`;
  const trxSal = id.match(/^INV-SALES-(TRX-.+)$/);
  if (trxSal) return `FT-SALES-${trxSal[1]}`;
  return null;
};

const getTransactionBatchId = (t: InventoryTransaction) =>
  String((t as InventoryTransaction & { batchId?: string }).batchId || '').trim();

function collectTransactionsAcrossYears(
  activeTransactions: InventoryTransaction[],
  yearDataByKey: Record<string, YearData>,
): InventoryTransaction[] {
  const byId = new Map<string, InventoryTransaction>();
  for (const t of activeTransactions) byId.set(String(t.id), t);
  for (const yd of Object.values(yearDataByKey)) {
    for (const t of yd.transactions || []) byId.set(String(t.id), t);
  }
  return [...byId.values()];
}

function findTransactionAcrossYears(
  trxId: string,
  activeTransactions: InventoryTransaction[],
  yearDataByKey: Record<string, YearData>,
): InventoryTransaction | undefined {
  const id = String(trxId);
  const inActive = activeTransactions.find((t) => String(t.id) === id);
  if (inActive) return inActive;
  for (const yd of Object.values(yearDataByKey)) {
    const t = (yd.transactions || []).find((x) => String(x.id) === id);
    if (t) return t;
  }
  return undefined;
}

function findTransactionsByBatchIdAcrossYears(
  batchId: string,
  activeTransactions: InventoryTransaction[],
  yearDataByKey: Record<string, YearData>,
): InventoryTransaction[] {
  const bid = String(batchId || '').trim();
  if (!bid) return [];
  return collectTransactionsAcrossYears(activeTransactions, yearDataByKey).filter(
    (t) => getTransactionBatchId(t) === bid,
  );
}

function parseWarehouseBatchFromInvoiceId(invId: string): { batchId: string; type: 'IMPORT' | 'EXPORT' } | null {
  const mPur = String(invId).match(/^INV-PUR-BATCH-(.+)$/);
  if (mPur) return { batchId: String(mPur[1]).trim(), type: 'IMPORT' };
  const mSal = String(invId).match(/^INV-SALES-BATCH-(.+)$/);
  if (mSal) return { batchId: String(mSal[1]).trim(), type: 'EXPORT' };
  return null;
}

function parseWarehouseTrxIdFromInvoiceId(invId: string): string | null {
  const m = String(invId).match(/^INV-(PUR|SALES)-(TRX-.+)$/);
  return m?.[2] ? String(m[2]) : null;
}

/** Gỡ HĐ / bút toán / quỹ lô kho khi không còn phiếu transactions (artifact-only). */
const purgeWarehouseBatchFromYearSlice = (
  yd: YearData,
  batchId: string,
  headType: 'IMPORT' | 'EXPORT',
): YearData => {
  const bid = String(batchId || '').trim();
  let nextTransactions = (yd.transactions || []).filter((t) => getTransactionBatchId(t) !== bid);
  let nextInvoices = [...(yd.invoices || [])];
  let nextJe = [...(yd.journalEntries || [])];
  let nextFt = [...(yd.fundTransactions || [])];
  let nextV = [...(yd.accountingVouchers || [])];
  if (headType === 'IMPORT') {
    const invPurId = `INV-PUR-BATCH-${bid}`;
    const vouId = `VOU-INV-${invPurId}`;
    const vouBatchId = `VOU-INV-INV-PUR-BATCH-${bid}`;
    nextInvoices = nextInvoices.filter((inv) => inv.id !== invPurId);
    nextV = nextV.filter((v) => v.id !== vouId && v.id !== vouBatchId);
    nextJe = nextJe.filter((je) => {
      const jid = String(je.id || '');
      return jid !== `JE-IM-BATCH-${bid}` && jid !== `JE-VOU-${vouId}` && jid !== `JE-VOU-${vouBatchId}`;
    });
    nextFt = nextFt.filter((ft) => {
      const fid = String(ft.id || '');
      return fid !== `FT-PUR-BATCH-${bid}` && fid !== `FT-INV-${invPurId}`;
    });
  } else {
    const invSalId = `INV-SALES-BATCH-${bid}`;
    const vouId = `VOU-INV-${invSalId}`;
    const vouBatchId = `VOU-INV-INV-SALES-BATCH-${bid}`;
    nextInvoices = nextInvoices.filter((inv) => inv.id !== invSalId);
    nextV = nextV.filter((v) => v.id !== vouId && v.id !== vouBatchId);
    nextJe = nextJe.filter((je) => {
      const jid = String(je.id || '');
      return jid !== `JE-EX-COST-BATCH-${bid}` && jid !== `JE-EX-REV-BATCH-${bid}` && jid !== `JE-VOU-${vouId}` && jid !== `JE-VOU-${vouBatchId}`;
    });
    nextFt = nextFt.filter((ft) => {
      const fid = String(ft.id || '');
      return fid !== `FT-SALES-BATCH-${bid}` && fid !== `FT-INV-${invSalId}`;
    });
  }
  return {
    ...yd,
    transactions: nextTransactions,
    invoices: nextInvoices,
    journalEntries: nextJe,
    fundTransactions: nextFt,
    accountingVouchers: nextV,
  };
};

const buildPostedVoucherJournalEntry = (
  finalVoucher: AccountingVoucher,
  postingDate: string,
): JournalEntry | null => {
  if (finalVoucher.status !== 'POSTED') return null;
  const details = (finalVoucher.details || []).flatMap((d) => [
    { account: d.debitAccount, debit: Number(d.amount), credit: 0, objectType: d.objectType, objectId: d.objectId, objectName: d.objectName },
    { account: d.creditAccount, debit: 0, credit: Number(d.amount), objectType: d.objectType, objectId: d.objectId, objectName: d.objectName },
  ]);
  const jeDateOnly = String(finalVoucher.date || postingDate).split('T')[0];
  return {
    id: `JE-VOU-${finalVoucher.id}`,
    date: jeDateOnly,
    referenceId: finalVoucher.voucherNumber || finalVoucher.id,
    description: finalVoucher.description,
    details,
  };
};

const normalizeAccountingRegime = (cfg: any, initializationDate?: string): SystemConfig['accountingRegime'] => {
  const raw = cfg?.accountingRegime && typeof cfg.accountingRegime === 'object'
    ? cfg.accountingRegime
    : {};
  const standard = raw.standard === 'TT58_2026' ? 'TT58_2026' : 'TT133';
  const profileCandidates = new Set([
    'GTGT_RATE_TNDN_RATE',
    'GTGT_DEDUCT_TNDN_RATE',
    'GTGT_RATE_TNDN_INCOME',
    'GTGT_DEDUCT_TNDN_INCOME',
  ]);
  const tt58TaxBookProfile = profileCandidates.has(raw.tt58TaxBookProfile)
    ? raw.tt58TaxBookProfile
    : (standard === 'TT58_2026' ? 'GTGT_DEDUCT_TNDN_INCOME' : undefined);
  const tt58PrimaryIndustryIds = getTt58PrimaryIndustryIds({
    standard,
    effectiveFrom: raw.effectiveFrom || initializationDate || '2026-07-01',
    tt58PrimaryIndustryIds: raw.tt58PrimaryIndustryIds,
    tt58PrimaryIndustryId: raw.tt58PrimaryIndustryId,
  });
  return {
    standard,
    effectiveFrom: raw.effectiveFrom || initializationDate || '2026-07-01',
    ...(tt58TaxBookProfile ? { tt58TaxBookProfile } : {}),
    ...(tt58PrimaryIndustryIds.length ? { tt58PrimaryIndustryIds } : {}),
  };
};

const ensureSystemConfigCompat = (cfg: any): SystemConfig => {
  const lock = (cfg?.openingBalanceLock as any) || (cfg?.isOpeningBalanceLocked ? 'HARD' : 'OPEN');
  const initializationDate = cfg?.initializationDate || new Date().toISOString();
  const openingAssetToolCarryForwards = Array.isArray(cfg?.openingAssetToolCarryForwards)
    ? cfg.openingAssetToolCarryForwards
        .filter((row: any) => row && typeof row === 'object')
        .map((row: any) => normalizeOpeningAssetToolCarryForwardEntry(row))
    : [];
  const legacyCarry =
    cfg?.openingAssetToolCarryForward && typeof cfg.openingAssetToolCarryForward === 'object'
      ? normalizeOpeningAssetToolCarryForwardEntry(cfg.openingAssetToolCarryForward, undefined, { useLegacyIds: true })
      : undefined;
  const carries = openingAssetToolCarryForwards.length > 0
    ? openingAssetToolCarryForwards
    : (legacyCarry ? [legacyCarry] : []);
  return {
    initializationDate,
    accountingRegime: normalizeAccountingRegime(cfg, initializationDate),
    isOpeningBalanceLocked: cfg?.isOpeningBalanceLocked, // kept for older UI reads (if any)
    openingBalanceLock: lock,
    openingBalanceLockedBy: cfg?.openingBalanceLockedBy,
    openingBalanceLockedAt: cfg?.openingBalanceLockedAt,
    openingAssetToolCarryForwards: carries.length > 0 ? carries : undefined,
    openingAssetToolCarryForward: carries[0],
  };
};

const generateMonthlyPeriods = (fy: FinancialYear): AccountingPeriod[] => {
  const start = new Date(fy.startDate);
  const end = new Date(fy.endDate);
  const periods: AccountingPeriod[] = [];

  // normalize to first day of month for iteration
  const it = new Date(start.getFullYear(), start.getMonth(), 1);
  while (it <= end) {
    const y = it.getFullYear();
    const m = it.getMonth(); // 0-based
    const monthStart = new Date(y, m, 1);
    const monthEnd = new Date(y, m + 1, 0);

    const startDate = (monthStart < start) ? fy.startDate : monthStart.toISOString().split('T')[0];
    const endDate = (monthEnd > end) ? fy.endDate : monthEnd.toISOString().split('T')[0];

    const monthNum = (m + 1).toString().padStart(2, '0');
    const id = `PERIOD-${y}-${monthNum}`;
    periods.push({
      id,
      name: `Kỳ kế toán tháng ${Number(monthNum)}/${y}`,
      startDate,
      endDate,
      status: 'OPEN',
    });

    it.setMonth(it.getMonth() + 1);
  }

  return periods;
};

/**
 * Rà soát đa niên độ sau khi đọc state: gom HĐ, NKC, chứng từ, phiếu kho, quỹ, CIT loss (theo năm)
 * vào đúng bucket `yearDataByKey` theo niên độ (ngày thuộc [startDate,endDate]).
 * Niên độ lấy từ `financialYears` **và** từ mọi khóa `YYYY-MM-DD..YYYY-MM-DD` trong map (tránh mất 2025 khi danh sách năm lệch DB).
 * Không di chuyển `inventory` / counters / cashFlowOpening giữa các năm.
 */
const repairYearDataByKeyByFiscalDates = (
  map: Record<YearKey, YearData>,
  financialYearsList: FinancialYear[],
): Record<YearKey, YearData> => {
  if (!map || typeof map !== 'object') return {};

  const byFyKey = new Map<string, FinancialYear>();
  for (const fy of financialYearsList || []) {
    if (fy?.startDate && fy?.endDate) byFyKey.set(makeYearKey(fy), fy);
  }
  for (const k of Object.keys(map)) {
    if (!k.includes('..')) continue;
    try {
      const fy = parseYearKey(k);
      if (fy.startDate && fy.endDate) {
        const mk = makeYearKey(fy);
        if (!byFyKey.has(mk)) byFyKey.set(mk, fy);
      }
    } catch {
      // bỏ qua khóa không parse được
    }
  }
  const sortedYears = Array.from(byFyKey.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!sortedYears.length) return { ...map };

  const resolveDate = (dateStr: string | undefined, fallbackKey: YearKey): YearKey => {
    const x = String(dateStr || '').split('T')[0];
    if (!x) return fallbackKey;
    for (const fy of sortedYears) {
      if (x >= fy.startDate && x <= fy.endDate) return makeYearKey(fy);
    }
    return fallbackKey;
  };

  const resolveLossYear = (y: number, fallbackKey: YearKey): YearKey => {
    if (!Number.isFinite(y)) return fallbackKey;
    for (const fy of sortedYears) {
      const ys = new Date(`${fy.startDate}T12:00:00`).getFullYear();
      const ye = new Date(`${fy.endDate}T12:00:00`).getFullYear();
      if (y >= ys && y <= ye) return makeYearKey(fy);
    }
    return fallbackKey;
  };

  const keySet = new Set<YearKey>([...Object.keys(map), ...sortedYears.map(makeYearKey)]);

  const next: Record<YearKey, YearData> = {};
  for (const k of keySet) {
    const src = map[k];
    next[k] = src ? { ...src } : buildEmptyYearData([]);
  }

  type Origin<T> = { item: T; fromKey: YearKey };
  const invO = new Map<string, Origin<Invoice>>();
  const jeO = new Map<string, Origin<JournalEntry>>();
  const vO = new Map<string, Origin<AccountingVoucher>>();
  const tO = new Map<string, Origin<InventoryTransaction>>();
  const fO = new Map<string, Origin<FundTransaction>>();
  const poO = new Map<string, Origin<ProductionOrder>>();
  const lossO = new Map<string, Origin<CITLossRecord>>();
  const metaByJeId = new Map<string, CITExpenseMeta>();

  for (const k of Object.keys(map)) {
    const yd = map[k];
    if (!yd) continue;
    for (const inv of yd.invoices || []) invO.set(String(inv.id), { item: inv, fromKey: k });
    for (const je of yd.journalEntries || []) jeO.set(String(je.id), { item: je, fromKey: k });
    for (const v of yd.accountingVouchers || []) vO.set(String(v.id), { item: v, fromKey: k });
    for (const t of yd.transactions || []) tO.set(String(t.id), { item: t, fromKey: k });
    for (const ft of yd.fundTransactions || []) fO.set(String(ft.id), { item: ft, fromKey: k });
    for (const po of yd.productionOrders || []) poO.set(String(po.id), { item: po, fromKey: k });
    for (const lr of yd.citLossRecords || []) lossO.set(String(lr.id), { item: lr, fromKey: k });
    for (const [mk, mv] of Object.entries(yd.citExpenseMeta || {})) {
      if (!metaByJeId.has(mk)) metaByJeId.set(mk, mv as CITExpenseMeta);
    }
  }

  for (const k of Object.keys(next)) {
    next[k] = {
      ...next[k],
      invoices: [],
      journalEntries: [],
      accountingVouchers: [],
      transactions: [],
      fundTransactions: [],
      productionOrders: [],
      citLossRecords: [],
      citExpenseMeta: {},
    };
  }

  for (const { item, fromKey } of invO.values()) {
    const inv = item as Invoice;
    const routeDate = String(inv.accountingPostingDate || inv.date || '').split('T')[0];
    const dest = resolveDate(routeDate, fromKey);
    next[dest].invoices.push(item);
  }
  for (const { item, fromKey } of jeO.values()) {
    const dest = resolveDate(item.date, fromKey);
    next[dest].journalEntries.push(item);
  }
  for (const { item, fromKey } of vO.values()) {
    const dest = resolveDate(item.date, fromKey);
    next[dest].accountingVouchers.push(item);
  }
  for (const { item, fromKey } of tO.values()) {
    const dest = resolveDate(item.date, fromKey);
    next[dest].transactions.push(item);
  }
  for (const { item, fromKey } of fO.values()) {
    const dest = resolveDate(item.date, fromKey);
    next[dest].fundTransactions.push(item);
  }
  for (const { item, fromKey } of poO.values()) {
    const routeDate = String(item.startDate || item.completionDate || '').split('T')[0];
    const dest = resolveDate(routeDate, fromKey);
    next[dest].productionOrders.push(item);
  }
  for (const { item, fromKey } of lossO.values()) {
    const dest = resolveLossYear(Number(item.year), fromKey);
    next[dest].citLossRecords.push(item);
  }

  for (const k of Object.keys(next)) {
    const jes = next[k].journalEntries || [];
    const meta: Record<string, CITExpenseMeta> = {};
    for (const je of jes) {
      const row = metaByJeId.get(String(je.id));
      if (row) meta[String(je.id)] = row;
    }
    next[k] = { ...next[k], citExpenseMeta: meta };
  }

  for (const k of Object.keys(next)) {
    const yd = next[k];
    if (yd.accountingPeriods?.length) continue;
    try {
      next[k] = { ...yd, accountingPeriods: generateMonthlyPeriods(parseYearKey(k)) };
    } catch {
      // bỏ qua khóa không parse được
    }
  }

  return next;
};

/** Gộp mảng gốc (top-level) trong payload state SQLite vào bucket niên độ đang mở — backup/đồng bộ cũ đôi khi chỉ lưu ở tầng gốc. */
const mergeYearDataMapWithRootArrays = (
  map: Record<YearKey, YearData>,
  activeBucketKey: YearKey,
  s: Record<string, unknown>,
): Record<YearKey, YearData> => {
  const out = Object.fromEntries(
    Object.entries(map).map(([yk, yd]) => [yk, { ...(yd as YearData) }]),
  ) as Record<YearKey, YearData>;
  if (!out[activeBucketKey]) out[activeBucketKey] = buildEmptyYearData([]);
  const b = out[activeBucketKey];
  const dedupe = <T extends { id?: unknown }>(a: T[] | undefined, add: T[] | undefined): T[] => {
    const m = new Map<string, T>();
    for (const x of a || []) {
      const id = String(x.id || '');
      if (id) m.set(id, x);
    }
    for (const x of add || []) {
      const id = String(x.id || '');
      if (!id) continue;
      // Root-level arrays (sau PUT /state) là bản mới nhất — incoming ghi đè bucket cũ cùng id.
      m.set(id, x);
    }
    return Array.from(m.values());
  };
  out[activeBucketKey] = {
    ...b,
    inventory: dedupe(b.inventory, Array.isArray(s.inventory) ? (s.inventory as InventoryItem[]) : undefined),
    invoices: dedupe(b.invoices, Array.isArray(s.invoices) ? (s.invoices as Invoice[]) : undefined),
    journalEntries: dedupe(b.journalEntries, Array.isArray(s.journalEntries) ? (s.journalEntries as JournalEntry[]) : undefined),
    accountingVouchers: dedupe(
      b.accountingVouchers,
      Array.isArray(s.accountingVouchers) ? (s.accountingVouchers as AccountingVoucher[]) : undefined,
    ),
    transactions: dedupe(b.transactions, Array.isArray(s.transactions) ? (s.transactions as InventoryTransaction[]) : undefined),
    fundTransactions: dedupe(
      b.fundTransactions,
      Array.isArray(s.fundTransactions) ? (s.fundTransactions as FundTransaction[]) : undefined,
    ),
    productionOrders: dedupe(
      b.productionOrders,
      Array.isArray((s as any).productionOrders) ? ((s as any).productionOrders as ProductionOrder[]) : undefined,
    ),
    citLossRecords: dedupe(
      b.citLossRecords,
      Array.isArray(s.citLossRecords) ? (s.citLossRecords as CITLossRecord[]) : undefined,
    ),
    citExpenseMeta: {
      ...(b.citExpenseMeta || {}),
      ...(typeof s.citExpenseMeta === 'object' && s.citExpenseMeta && !Array.isArray(s.citExpenseMeta)
        ? (s.citExpenseMeta as Record<string, CITExpenseMeta>)
        : {}),
    },
    documentNumberCounters: {
      ...(b.documentNumberCounters || {}),
      ...(typeof s.documentNumberCounters === 'object' && s.documentNumberCounters && !Array.isArray(s.documentNumberCounters)
        ? (s.documentNumberCounters as Record<string, number>)
        : {}),
    },
    cashFlowOpening: {
      ...(b.cashFlowOpening || {}),
      ...(typeof s.cashFlowOpening === 'object' && s.cashFlowOpening && !Array.isArray(s.cashFlowOpening)
        ? (s.cashFlowOpening as Record<string, number>)
        : {}),
    },
    openingBalanceAccounts: normalizeOpeningBalanceAccounts([
      ...(b.openingBalanceAccounts || []),
      ...normalizeOpeningBalanceAccounts((s as any).openingBalanceAccounts),
    ]),
    openingBalanceDebts: dedupe(
      normalizeOpeningBalanceDebts(b.openingBalanceDebts),
      normalizeOpeningBalanceDebts((s as any).openingBalanceDebts),
    ),
    openingBalanceRolloverMeta:
      normalizeOpeningBalanceRolloverMeta((b as any).openingBalanceRolloverMeta) ||
      normalizeOpeningBalanceRolloverMeta((s as any).openingBalanceRolloverMeta),
  };
  return out;
};

/** Bổ sung niên độ vào danh sách khi đã có bucket trong map (backup thiếu financialYears đầy đủ). */
const mergeFinancialYearsWithMapKeys = (
  base: FinancialYear[],
  m: Record<YearKey, YearData>,
): FinancialYear[] => {
  const byMk = new Map<string, FinancialYear>();
  for (const y of base || []) {
    if (y?.startDate && y?.endDate) byMk.set(makeYearKey(y), y);
  }
  for (const k of Object.keys(m || {})) {
    if (!k.includes('..')) continue;
    const fy = parseYearKey(k);
    if (fy.startDate && fy.endDate) {
      const mk = makeYearKey(fy);
      if (!byMk.has(mk)) byMk.set(mk, fy);
    }
  }
  return Array.from(byMk.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
};

const parseTrxSerialsForPurge = (s?: string) =>
  (s || '')
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

const numQtyPurge = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const roundInvQtyPurge = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0);

/** Trừ tồn + gỡ serial theo các dòng NHẬP (bucket niên độ khác niên độ đang xóa). */
const stripImportPeersFromInventorySnapshot = (
  items: InventoryItem[] | undefined,
  importPeers: InventoryTransaction[],
): InventoryItem[] => {
  const fallbackWarehouseId = createDefaultWarehouse().id;
  const list = (items || []).map((it) => ({
    ...ensureWarehouseBalances(it, fallbackWarehouseId),
    serials: [...(it.serials || [])],
    serialDetails: (it.serialDetails || []).map((d) => ({ ...d })),
    warehouseBalances: cloneWarehouseBalances(it.warehouseBalances),
  }));
  for (const t of importPeers) {
    if (t.type !== 'IMPORT') continue;
    const idx = list.findIndex((i) => i.id === t.itemId);
    if (idx === -1) continue;
    const item = list[idx];
    const serialList = parseTrxSerialsForPurge(t.serials);
    const warehouseId = String(t.warehouseId || fallbackWarehouseId).trim() || fallbackWarehouseId;
    const balance = getWarehouseBalance(item, warehouseId, fallbackWarehouseId);
    const currents = balance.serials || [];
    const onHand = numQtyPurge(balance.quantity);
    const need = numQtyPurge(t.quantity);
    if (serialList.length > 0 && serialList.some((serial) => !currents.includes(serial))) continue;
    list[idx] = applyWarehouseBalanceChange(
      item,
      {
        warehouseId,
        qtyDelta: -Math.max(0, roundInvQtyPurge(Math.min(onHand, need))),
        removeSerials: serialList,
        removeSerialDetailsBySerial: serialList,
        updatedAt: t.date,
      },
      fallbackWarehouseId,
    );
  }
  return list;
};

/** Phiếu kho đã sang bucket niên độ khác nhưng serial còn trên tồn bucket cũ (repair không chuyển inventory). */
const stripOrphanSerialsFromInventory = (
  items: InventoryItem[] | undefined,
  importPeers: InventoryTransaction[],
): InventoryItem[] => {
  const serialList = importPeers.flatMap((t) =>
    t.type === 'IMPORT' ? parseTrxSerialsForPurge(t.serials) : [],
  );
  if (serialList.length === 0) return items || [];
  const drop = new Set(serialList);
  const fallbackWarehouseId = createDefaultWarehouse().id;
  return (items || []).map((it) => {
    const normalized = ensureWarehouseBalances(it, fallbackWarehouseId);
    return rebuildItemTotalsFromWarehouseBalances({
      ...normalized,
      warehouseBalances: (normalized.warehouseBalances || []).map((balance) => ({
        ...balance,
        serials: (balance.serials || []).filter((serial) => !drop.has(serial)),
        serialDetails: (balance.serialDetails || []).filter((detail) => !drop.has(detail.serial)),
      })),
    });
  });
};

/** Gỡ toàn bộ dấu vết phiếu kho / HĐ lô khỏi một slice YearData (dùng cho các niên độ không đang active). */
const purgeWarehouseArtifactFromYearDataSlice = (
  yd: YearData,
  args: {
    peerIds: Set<string>;
    peerTrxs: InventoryTransaction[];
    batchId: string;
    trxId: string;
    headType?: 'IMPORT' | 'EXPORT';
    ref: string;
    sourceRef: string;
    voucherRef: string;
    isActiveBucket: boolean;
  },
): YearData => {
  const { peerIds, peerTrxs, batchId, trxId, headType, ref, sourceRef, voucherRef, isActiveBucket } =
    args;
  const head = peerTrxs[0];
  const importPeers = peerTrxs.filter((t) => t.type === 'IMPORT');
  const hadPeerTrx = (yd.transactions || []).some((t) => peerIds.has(t.id));

  let nextTransactions = (yd.transactions || []).filter((t) => !peerIds.has(t.id));
  let nextInvoices = [...(yd.invoices || [])];
  let nextJe = [...(yd.journalEntries || [])];
  let nextFt = [...(yd.fundTransactions || [])];
  let nextV = [...(yd.accountingVouchers || [])];
  let nextInv = [...(yd.inventory || [])];

  if (batchId && head) {
    const vn = String(head.voucherNumber || '');
    const dr = String(head.documentRef || '');
    const ht = headType || head.type;
    if (ht === 'IMPORT') {
      const invPurId = `INV-PUR-BATCH-${batchId}`;
      const vouId = `VOU-INV-${invPurId}`;
      nextInvoices = nextInvoices.filter((inv) => inv.id !== invPurId);
      nextV = nextV.filter((v) => v.id !== vouId);
      nextJe = nextJe.filter((je) => {
        const jid = String(je.id || '');
        const jref = String(je.referenceId || '');
        if (jid === `JE-IM-BATCH-${batchId}`) return false;
        if (jid === `JE-VOU-${vouId}`) return false;
        if (vn && jref === vn) return false;
        if (dr && jref === dr) return false;
        return true;
      });
      nextFt = nextFt.filter((ft) => {
        const fid = String(ft.id || '');
        if (fid === `FT-PUR-BATCH-${batchId}`) return false;
        if (fid === `FT-INV-${invPurId}`) return false;
        if (vn && (ft.referenceDoc === vn || ft.voucherNumber === vn)) return false;
        if (dr && ft.referenceDoc === dr) return false;
        return true;
      });
    } else {
      const invSalId = `INV-SALES-BATCH-${batchId}`;
      const vouId = `VOU-INV-${invSalId}`;
      nextInvoices = nextInvoices.filter((inv) => inv.id !== invSalId);
      nextV = nextV.filter((v) => v.id !== vouId);
      nextJe = nextJe.filter((je) => {
        const jid = String(je.id || '');
        const jref = String(je.referenceId || '');
        if (jid === `JE-EX-COST-BATCH-${batchId}`) return false;
        if (jid === `JE-EX-REV-BATCH-${batchId}`) return false;
        if (jid === `JE-VOU-${vouId}`) return false;
        if (vn && jref === vn) return false;
        if (dr && jref === dr) return false;
        return true;
      });
      nextFt = nextFt.filter((ft) => {
        const fid = String(ft.id || '');
        if (fid === `FT-SALES-BATCH-${batchId}`) return false;
        if (fid === `FT-INV-${invSalId}`) return false;
        if (vn && (ft.referenceDoc === vn || ft.voucherNumber === vn)) return false;
        if (dr && ft.referenceDoc === dr) return false;
        return true;
      });
    }
  } else if (head) {
    const ht = headType || head.type;
    const linkedInvId = ht === 'IMPORT' ? `INV-PUR-${trxId}` : `INV-SALES-${trxId}`;
    const linkedVouId = `VOU-INV-${linkedInvId}`;
    nextInvoices = nextInvoices.filter((inv) => {
      if (!inv) return true;
      const invNo = (inv as Invoice).invoiceNumber || '';
      if (invNo === ref || (sourceRef && invNo === sourceRef) || (voucherRef && invNo === voucherRef))
        return false;
      if (inv.id === linkedInvId) return false;
      return true;
    });
    nextV = nextV.filter((v) => v.id !== linkedVouId);
    nextJe = nextJe.filter((je) => {
      if (je.referenceId === ref || je.referenceId === sourceRef || je.referenceId === voucherRef || je.referenceId === trxId) return false;
      if (je.id === `JE-IM-${trxId}`) return false;
      if (je.id === `JE-EX-COST-${trxId}`) return false;
      if (je.id === `JE-EX-REV-${trxId}`) return false;
      if (je.id === `JE-VOU-${linkedVouId}`) return false;
      return true;
    });
    nextFt = nextFt.filter((ft) => {
      if (
        ft.referenceDoc === ref ||
        ft.referenceDoc === sourceRef ||
        ft.referenceDoc === voucherRef ||
        ft.voucherNumber === ref ||
        ft.voucherNumber === voucherRef ||
        ft.referenceDoc === trxId
      )
        return false;
      if (ft.id === `FT-PUR-${trxId}`) return false;
      if (ft.id === `FT-SALES-${trxId}`) return false;
      if (ft.id === `FT-INV-${linkedInvId}`) return false;
      return true;
    });
  }

  if (!isActiveBucket && importPeers.length) {
    if (hadPeerTrx) nextInv = stripImportPeersFromInventorySnapshot(nextInv, importPeers);
    else nextInv = stripOrphanSerialsFromInventory(nextInv, importPeers);
  }

  return {
    ...yd,
    transactions: nextTransactions,
    invoices: nextInvoices,
    journalEntries: nextJe,
    fundTransactions: nextFt,
    accountingVouchers: nextV,
    inventory: nextInv,
  };
};

const getPeriodForDate = (periods: AccountingPeriod[], date: string) =>
  periods.find(p => date >= p.startDate && date <= p.endDate);

type StockBatchLinePayload = {
  itemId: string;
  qty: number;
  price: number;
  vat: number;
  note?: string;
  serials: string;
  bomPlannedQuantity?: number;
  bomLossRate?: number;
  bomAccount154Category?: Bom154Category;
};

/** Dòng HĐ mua gắn phiếu nhập kho nhưng không qua tồn kho (chi phí / TK trả trước). */
type StockBatchNonStockLinePayload = {
  lineKey: string;
  productName: string;
  unit?: string;
  qty: number;
  price: number;
  vat: number;
  expenseAccount: string;
  note?: string;
};

type StockBatchPayload = BankAccountSnapshot & {
  actionType?: 'IMPORT' | 'EXPORT';
  date: string;
  warehouseId?: string;
  warehouseName?: string;
  performer: string;
  note: string;
  supplier: string;
  documentRef: string;
  customer?: string;
  customerPhone?: string;
  customerAddress?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  exportPurpose?: string;
  paymentStatus?: 'PAID' | 'PENDING';
  paymentMethod?: string;
  supplierTaxCode?: string;
  customerTaxCode?: string;
  formNo?: string;
  symbolCode?: string;
  costObjectType?: 'BOM_PARENT';
  costObjectId?: string;
  costObjectName?: string;
  costObjectSku?: string;
  bomDefinitionId?: string;
  bomParentQuantity?: number;
  bomVarianceReason?: string;
  productionOrderId?: string;
  productionOrderCode?: string;
  postingMode?: 'STANDARD' | 'PRODUCTION_RECEIPT' | 'PRODUCTION_ISSUE';
  skipLinkedInvoiceDocs?: boolean;
  internalCreditAccount?: string;
  internalDescription?: string;
  lines: StockBatchLinePayload[];
  /** Dòng không nhập kho — gộp vào cùng HĐ mua & bút NKC với phiếu nhập (TK Nợ theo expenseAccount). */
  nonStockLines?: StockBatchNonStockLinePayload[];
};

/** Gọi sau khi ghi xong 1 phiếu nhập kho + HĐ mua liên kết (pipeline import). */
export type StockImportCommittedMeta = {
  batchId: string;
  warehouseVoucherNumber: string;
  purchaseInvoiceId: string;
  journalEntryId: string;
  transactionIds: string[];
};

/** Gộp các dòng cùng mặt hàng trong một phiếu (Excel/import nhiều dòng cùng SKU). */
function mergeStockBatchLinesByItemId(lines: StockBatchLinePayload[]): StockBatchLinePayload[] {
  const filtered = lines.filter((l) => l && l.itemId && Number(l.qty) > 0);
  if (filtered.length <= 1) return filtered;
  const parseSerialsLocal = (s?: string) => (s || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
  const byId = new Map<string, StockBatchLinePayload>();
  for (const line of filtered) {
    const qty = Number(line.qty) || 0;
    const prev = byId.get(line.itemId);
    if (!prev) {
      byId.set(line.itemId, {
        ...line,
        qty,
        price: Number(line.price) || 0,
        vat: Number(line.vat) || 0,
      });
      continue;
    }
    const pq = Number(prev.qty) || 0;
    const newQty = pq + qty;
    const allSerials = [...parseSerialsLocal(prev.serials), ...parseSerialsLocal(line.serials)];
    const serials = allSerials.length ? allSerials.join('\n') : '';
    const p1 = Number(prev.price) || 0;
    const p2 = Number(line.price) || 0;
    const newPrice = newQty > 0 ? (pq * p1 + qty * p2) / newQty : 0;
    const noteJoin = [prev.note, line.note].filter(Boolean).join('; ');
    const plannedQty = (Number(prev.bomPlannedQuantity) || 0) + (Number(line.bomPlannedQuantity) || 0);
    byId.set(line.itemId, {
      ...prev,
      qty: newQty,
      price: newPrice,
      serials,
      note: noteJoin || prev.note,
      bomPlannedQuantity: plannedQty > 0 ? plannedQty : undefined,
      bomLossRate:
        line.bomLossRate != null
          ? Number(line.bomLossRate)
          : prev.bomLossRate != null
            ? Number(prev.bomLossRate)
            : undefined,
      bomAccount154Category: line.bomAccount154Category || prev.bomAccount154Category,
    });
  }
  return Array.from(byId.values());
}

/** Gợi ý form nhập/xuất kho — lưu trong SQLite (VictoryData), không dùng localStorage. */
export type WarehouseFormHintsState = {
  warehouseId?: string;
  supplierName?: string;
  supplierTax?: string;
  formNo?: string;
  symbolCode?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  customerName?: string;
  customerTax?: string;
  customerPhone?: string;
  customerAddress?: string;
};

/** Tùy chọn xóa nâng cao cho sản phẩm trong thẻ Sản phẩm & Bản quyền. */
export type InventoryItemDeleteOptions =
  | { mode: 'INVOICE'; invoiceIds: string[] }
  | { mode: 'SERIAL'; serials: string[] }
  | { mode: 'QUANTITY'; quantity: number; warehouseId?: string };

interface AppContextType {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  hydrated: boolean;
  backendAvailable: boolean;
  persistStatus: { lastOkAt?: number; lastError?: string };
  financialYears: FinancialYear[];
  activeYearKey: string;
  devices: Device[];
  invoices: Invoice[];
  allInvoicesAcrossYears: Invoice[];
  /** Tổng số bản ghi (HĐ, NKC, chứng từ, kho, quỹ, CIT loss…) có ngày/năm thuộc niên độ đang mở nhưng đang nằm bucket niên độ khác hoặc trùng bucket. */
  misplacedYearDataTotal: number;
  inventory: InventoryItem[];
  /** Danh mục hàng hóa/vật tư (SKU, tên, ĐVT, nhóm) — bền; xóa ở Kho không gỡ khỏi đây. */
  inventoryCatalog: InventoryItem[];
  bomDefinitions: BomDefinition[];
  /** Tồn kho + các dòng chỉ có trong danh mục (cùng id) — dùng cho Kho & phiếu Nhập/Xuất. */
  warehouseInventoryItems: InventoryItem[];
  productionOrders: ProductionOrder[];
  journalEntries: JournalEntry[];
  allJournalEntriesAcrossYears: JournalEntry[];
  transactions: InventoryTransaction[];
  allTransactionsAcrossYears: InventoryTransaction[];
  fundTransactions: FundTransaction[];
  assets: Asset[];
  accountingVouchers: AccountingVoucher[];
  accountingPeriods: AccountingPeriod[];
  accounts: AccountDefinition[];
  customers: Customer[];
  suppliers: Supplier[];
  employees: Employee[];
  warehouses: Warehouse[];
  expenseCategories: ExpenseCategory[];
  taxRates: TaxRate[];
  paymentMethods: PaymentMethod[];
  bankAccounts: BankAccount[];
  cashFlowOpening: Record<string, number>;
  openingBalanceAccounts: OpeningBalanceAccountRecord[];
  openingBalanceDebts: OpeningBalanceDebtDetail[];
  openingBalanceRolloverMeta?: OpeningBalanceRolloverMeta;
  citExpenseMeta: Record<string, CITExpenseMeta>;
  citLossRecords: CITLossRecord[];
  financialYear: FinancialYear;
  systemConfig: SystemConfig;
  companyInfo: CompanyInfo;
  modals: any; 
  setModals: React.Dispatch<React.SetStateAction<any>>;
  previewDocumentNumber: (prefix: DocumentNumberPrefix, date?: string) => string;
  handleAddDevice: (device: Partial<Device>) => void;
  handleBulkAddDevices: (newDevices: Device[]) => void;
  handleUpdateDevice: (device: Partial<Device>) => void;
  handleDeleteDevice: (id: string) => void;
  handleRenewConfirm: (
    fee: number,
    vatRate: number,
    newExpiry: Date,
    durationMonths: number,
    paymentMethod: string,
    paymentStatus: 'PAID' | 'DEBT',
    inputCostInfo?: { supplier: string, invoiceNo: string, costPrice: number, vatRate: number, paymentMethod: string, description?: string, unit?: string, bankAccountId?: string },
    salesInfo?: { description?: string, unit?: string, bankAccountId?: string }
  ) => void;
  handleInventoryActions: {
    stockBatch: (payload: StockBatchPayload, onImportCommitted?: (meta: StockImportCommittedMeta) => void) => boolean;
    stockBatches: (payloads: StockBatchPayload[]) => boolean;
    stock: (itemId: string, qty: number, price: number, performer: string, note: string, vat: number, date: string, serials: string, supplier: string, documentRef: string, customer?: string, customerPhone?: string, customerAddress?: string, supplierPhone?: string, supplierAddress?: string, exportPurpose?: string, actionType?: 'IMPORT' | 'EXPORT', paymentStatus?: 'PAID' | 'PENDING', paymentMethod?: string, supplierTaxCode?: string, customerTaxCode?: string, formNo?: string, symbolCode?: string, bankSnapshot?: Partial<BankAccountSnapshot>, warehouseId?: string) => boolean;
    add: (item: any) => void;
    update: (item: any) => void;
  };
  handleUpdateInventoryTransactionMeta?: (trxId: string, patch: any) => void;
  handleDeleteInventoryTransaction: (id: string, opts?: { silent?: boolean }) => Promise<boolean>;
  /** Kiểm tra đồng bộ trước khi xóa (kỳ kế toán, hóa đơn hợp lệ…) — tránh treo nút «Đang xóa…» khi cần confirm. */
  validateDeleteInventoryItemAdvanced: (itemId: string, options: InventoryItemDeleteOptions) => boolean;
  /** Xóa sản phẩm theo tùy chọn: theo số hóa đơn / theo IMEI / theo số lượng. */
  handleDeleteInventoryItemAdvanced: (itemId: string, options: InventoryItemDeleteOptions) => Promise<boolean>;
  handleCreateInvoice: (data: any) => boolean;
  handlePostHotelPmsCheckout: (payload: HotelPmsCheckoutPostingPayload) => boolean;
  handlePostHotelPmsExpense: (payload: HotelPmsExpensePostingPayload) => boolean;
  handleUpdateInvoice: (data: any) => boolean;
  handleDeleteInvoice: (target: string | Invoice) => Promise<boolean>;
  handleReceiveInvoicePayment: (invoiceId: string, paymentDate: string, paymentMethod: string, bankSnapshot?: Partial<BankAccountSnapshot>) => boolean;
  /** Thanh toán HĐ mua vào ghi nợ (331) — sinh Phiếu chi + bút Nợ 331 / Có 1111|1121 (đồng bộ với HĐ từ Kho). */
  handlePayPurchaseInvoice: (invoiceId: string, paymentDate: string, paymentMethod: string, bankSnapshot?: Partial<BankAccountSnapshot>) => boolean;
  handleFundAction: (data: Partial<FundTransaction>) => void;
  handleDeleteFundTransaction: (id: string) => void;
  handleSaveBankAccount: (item: Partial<BankAccount>) => { ok: boolean; bankAccount?: BankAccount; error?: string };
  handleDeleteBankAccount: (id: string) => { ok: boolean; error?: string };
  handleToggleBankAccountStatus: (id: string) => void;
  handleAddCatalogItem: (type: string, item: any) => void;
  handleUpdateCatalogItem: (type: string, item: any) => void;
  handleDeleteCatalogItem: (type: string, id: string) => void;
  handleImportInventoryCatalogFromExcel: (rows: Record<string, unknown>[]) => { added: number; updated: number; errors: string[] };
  handleUpsertBomDefinition: (definition: BomDefinition) => void;
  handleDeleteBomDefinition: (id: string) => void;
  handleUpsertProductionOrder: (order: ProductionOrder) => boolean;
  handleDeleteProductionOrder: (id: string) => void;
  handleReleaseProductionOrder: (id: string) => boolean;
  handleCompleteProductionOrder: (id: string, opts?: { completionDate?: string }) => boolean;
  handleUpdateCITMeta: (id: string, isDeductible: boolean, reason?: string) => void;
  handleUpdateLossRecord: (record: CITLossRecord) => void;
  handleUpdateCITLossRecord: (record: CITLossRecord) => void;
  handleSaveVoucher: (voucher: AccountingVoucher, opts?: { skipEditableDateCheck?: boolean; skipJournalEntry?: boolean }) => { ok: boolean; finalVoucher?: AccountingVoucher };
  handleDeleteVoucher: (id: string) => void;
  handlePostVoucher: (id: string) => void;
  handleUnpostVoucher: (id: string) => void;
  handleAddAsset: (asset: Partial<Asset>, paymentMethod: string, opts?: { retroToPeriod?: string; retroPolicy?: 'DAY1_INCLUDES_MONTH' | 'FULL_MONTHS_ONLY'; bankAccountId?: string }) => void;
  handleUpdateAsset: (asset: Asset) => void;
  handleDeleteAsset: (id: string) => void;
  /** Điều chuyển một hoặc nhiều tài sản sang bộ phận khác, ghi lịch sử. */
  handleTransferAssets: (payload: {
    assetIds: string[];
    toDepartment: string;
    transferDate: string;
    responsiblePersonId?: string;
    responsiblePersonName?: string;
    reason?: string;
    slipNumber?: string;
    createdBy?: string;
  }) => boolean;
  /** CCDC đang TK 153 → chuyển Nợ 242 / Có 153, cập nhật ngày đưa vào SD. */
  handlePutCcdcIntoUse: (assetId: string, putIntoUseDate: string) => void;
  handleLiquidateAsset: (
    assetId: string,
    payload: {
      liquidationDate: string;
      saleAmount?: number;
      saleVatRate?: number;
      receiptMethod?: AssetLiquidationReceiptMethod;
      bankAccountId?: string;
      contactName?: string;
    },
  ) => boolean;
  handleRunDepreciation: (period: string, entries: any[]) => void;
  handleUpdateCompanyInfo: (info: CompanyInfo) => void;
  handleUpsertFinancialYear: (year: FinancialYear, opts?: { rollover?: boolean; rolloverFromKey?: string }) => Promise<boolean>;
  /**
   * Hợp nhất dữ liệu niên độ đang mở: HĐ, bút NKC, chứng từ kế toán, phiếu kho, quỹ, bản ghi CIT (theo ngày/năm)
   * đang nằm sai bucket trong `yearDataByKey`; đồng thời gỡ bản trùng id ở niên độ khác.
   * Dữ liệu từng năm lưu tại SQLite `AppState.data.yearDataByKey["<startDate>..<endDate>"]` (vd. 2025-01-01..2025-12-31).
   */
  handleReconcileInvoicesForActiveFiscalYear: () => {
    ok: boolean;
    merged: number;
    breakdown?: {
      invoices: number;
      journalEntries: number;
      accountingVouchers: number;
      transactions: number;
      fundTransactions: number;
      citLossRecords: number;
      citExpenseMeta: number;
    };
    message?: string;
  };
  handleUpdateSystemConfig: (patch: Partial<SystemConfig>) => void;
  handleToggleSystemLock: () => void;
  handleSaveOpeningBalanceAccounts: (rows: OpeningBalanceAccountRecord[]) => boolean;
  handleSaveOpeningJournal: (entries: JournalEntry[]) => void;
  handleSaveOpeningDebtDetails: (kind: OpeningDebtKind, rows: OpeningBalanceDebtDetail[]) => boolean;
  handleSaveOpeningStock: (items: any[]) => void;
  handleClearOpeningData: () => void;
  handleSaveCashFlowOpening: (values: Record<string, number>) => void;
  handleSaveOpeningAssetToolCarryForward: (payload: OpeningAssetToolCarryForward) => string | undefined;
  handleDeleteOpeningAssetToolCarryForward: (id: string) => void;
  /** Bút Opening 1 lần (ghi đè theo referenceId): mở sổ NG/HM/411/1331; đồng bộ thẻ TSCĐ/CCDC để KH hàng tháng. */
  handlePostOpeningAssetCarryJournal: (id?: string) => boolean;
  handleResetAllData: () => Promise<void>;
  retryLoadState: () => Promise<void>;
  handlePeriodClosing: (entries: JournalEntry[]) => void;
  handleUndoPeriodClosing: (referenceRef: string) => void;
  togglePeriodLock: (id: string) => void; // legacy toggle => SOFT close/open
  setPeriodLock: (id: string, lockType: 'SOFT' | 'HARD' | 'OPEN') => void;
  setOpeningBalanceLock: (lock: 'OPEN' | 'SOFT' | 'HARD') => void;
  warehouseFormHints: WarehouseFormHintsState;
  patchWarehouseFormHints: (patch: Partial<WarehouseFormHintsState>) => void;
  /** Gợi ý tên KH / NCC / đối tượng chứng từ — persist SQLite (VictoryData), không localStorage. */
  partnerNameHistory: PartnerNameHistoryState;
  rememberPartnerName: (kind: PartnerNameKind, raw: string) => void;
  /** Mục con đang mở trong thẻ Danh mục (đồng bộ Header mega menu ↔ CatalogPage). */
  catalogSection: string;
  setCatalogSection: (id: string) => void;
  /** Tăng sau Reset hệ thống — remount Hotel PMS về dữ liệu mặc định. */
  hotelPmsResetNonce: number;
  /** Dữ liệu Hotel PMS — persist SQLite qua PUT /api/state (đồng bộ đa máy). */
  hotelPmsState: HotelPmsPersistedState;
  setHotelPmsState: (state: HotelPmsPersistedState) => void;
  /** Tải lại chỉ hotelPms từ GET /api/state — không reload opening/debt/kế toán. */
  refreshHotelPmsFromBackend: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [catalogSection, setCatalogSection] = useState('ACCOUNTS');
  const [hotelPmsResetNonce, setHotelPmsResetNonce] = useState(0);
  const [hotelPmsState, setHotelPmsState] = useState<HotelPmsPersistedState>(() => getDefaultHotelPmsState());
  const [financialYear, setFinancialYear] = useState<FinancialYear>(() => {
    const currentYear = new Date().getFullYear();
    return { startDate: `${currentYear}-01-01`, endDate: `${currentYear}-12-31` };
  });
  const [financialYears, setFinancialYears] = useState<FinancialYear[]>(() => [financialYear]);
  const [activeYearKey, setActiveYearKey] = useState<YearKey>(() => makeYearKey(financialYear));
  /** Snapshot theo niên độ: key = `${startDate}..${endDate}` (vd. 2025-01-01..2025-12-31). Opening data persist qua API riêng, phần còn lại qua PUT /api/state. */
  const [yearDataByKey, setYearDataByKey] = useState<Record<YearKey, YearData>>(() => ({
    [makeYearKey(financialYear)]: buildEmptyYearData([]),
  }));
  const isSwitchingYearRef = useRef(false);
  const financialYearRef = useRef(financialYear);
  const documentNumberCountersRef = useRef<Record<string, number>>({});
  const repairedInvoiceJournalYearKeyRef = useRef<string | null>(null);
  const pendingRolloverRefreshSourceYearRef = useRef<string | null>(null);
  const lastOpeningPersistSignatureRef = useRef('');
  const pendingHydratedOpeningSignatureRef = useRef<string | null>(null);
  const lastKnownStateRevisionRef = useRef(0);
  /** Phiên bản dữ liệu AppState server đang giữ — gửi kèm PUT để chống ghi đè chéo máy. */
  const stateDataVersionRef = useRef<number | null>(null);
  const authProfileRef = useRef<{ id?: string; role?: string; email?: string; username?: string; permissions?: string[] } | null>(null);
  const suppressPersistUntilRef = useRef(0);
  /** Snapshot (JSON) vừa nhận từ máy khác — nếu persist ra đúng nội dung này thì bỏ qua (chống echo loop). */
  const remoteEchoBodyRef = useRef<string | null>(null);
  const persistInFlightRef = useRef(0);
  /**
   * true khi có thay đổi cục bộ (user vừa nhập) đã lên lịch persist nhưng CHƯA gửi xong lên server.
   * Dùng để chặn remote reload ghi đè mất dữ liệu vừa nhập trong cửa sổ debounce (trước khi PUT chạy).
   */
  const persistPendingRef = useRef(false);
  /** Tăng khi lifecycle xóa/sửa blob — hủy timeout persist cũ (tránh ghi lại bản ghi đã xóa). */
  const persistEpochRef = useRef(0);
  /**
   * Tăng sau khi lifecycle xóa xong (mutation-end) để BẮT BUỘC chạy lại effect persist —
   * lần persist trước đã bị 'mutation-start' hủy (bump epoch), nên thay đổi blob đi kèm
   * (vd: hoàn tác số lượng tồn kho) sẽ không được lưu nếu không kích hoạt lại.
   */
  const [persistNonce, setPersistNonce] = useState(0);
  const remoteReloadTimerRef = useRef<number | null>(null);
  const remoteReloadWaitPersistTimerRef = useRef<number | null>(null);
  const stateEventsRef = useRef<WebSocket | null>(null);
  const scheduleRemoteStateReloadRef = useRef<() => void>(() => {});
  const [hydrated, setHydrated] = useState(false);
  const [openingPersistReady, setOpeningPersistReady] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [persistStatus, setPersistStatus] = useState<{ lastOkAt?: number; lastError?: string }>({});
  const [accountingPeriods, setAccountingPeriods] = useState<AccountingPeriod[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [fundTransactions, setFundTransactions] = useState<FundTransaction[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [accountingVouchers, setAccountingVouchers] = useState<AccountingVoucher[]>([]);
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);
  const [documentNumberCounters, setDocumentNumberCounters] = useState<Record<string, number>>({});
  const [deletedEntityTombstones, setDeletedEntityTombstones] = useState<DeletedEntityTombstones>({});
  const [entityDeletionAuditLog, setEntityDeletionAuditLog] = useState<EntityDeletionAuditEntry[]>([]);
  const deletedEntityTombstonesRef = useRef<DeletedEntityTombstones>({});
  /** Bật sau khi RESET để chu kỳ persist kế tiếp ghi đè toàn bộ state (không hợp nhất). */
  const forceFullReplaceRef = useRef(false);
  /** Trong lúc RESET: chặn mọi lần persist (kể cả timeout đã hẹn trước) ghi đè dữ liệu trống bằng dữ liệu cũ còn trong bộ nhớ. */
  const resetInProgressRef = useRef(false);
  /** Dấu mốc reset của state hiện đang giữ — gửi kèm PUT để server từ chối ghi đè từ client còn dữ liệu cũ sau RESET. */
  const stateResetMarkerRef = useRef<string | number | null>(null);
  const [accounts, setAccounts] = useState<AccountDefinition[]>(() => mergeAccountsWithDefaults(undefined));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(() => normalizeWarehouses([]));
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([
    { id: '1', code: 'VAT0', name: 'VAT 0%', rate: 0 },
    { id: '2', code: 'VAT8', name: 'VAT 8%', rate: 8 },
    { id: '3', code: 'VAT10', name: 'VAT 10%', rate: 10 }
  ]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([
    { id: '1', code: 'TM', name: 'Tiền mặt' },
    { id: '2', code: 'CK', name: 'Chuyển khoản' }
  ]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [cashFlowOpening, setCashFlowOpening] = useState<Record<string, number>>({});
  const [openingBalanceAccounts, setOpeningBalanceAccounts] = useState<OpeningBalanceAccountRecord[]>([]);
  const [openingBalanceDebts, setOpeningBalanceDebts] = useState<OpeningBalanceDebtDetail[]>([]);
  const [openingBalanceRolloverMeta, setOpeningBalanceRolloverMeta] = useState<OpeningBalanceRolloverMeta | undefined>(undefined);
  const currentOpeningHydrationStateRef = useRef<{
    activeYearKey: YearKey;
    openingBalanceAccounts: OpeningBalanceAccountRecord[];
    openingBalanceDebts: OpeningBalanceDebtDetail[];
    openingBalanceRolloverMeta?: OpeningBalanceRolloverMeta;
  }>({
    activeYearKey,
    openingBalanceAccounts: [],
    openingBalanceDebts: [],
    openingBalanceRolloverMeta: undefined,
  });
  currentOpeningHydrationStateRef.current = {
    activeYearKey,
    openingBalanceAccounts,
    openingBalanceDebts,
    openingBalanceRolloverMeta,
  };
  const [citExpenseMeta, setCitExpenseMeta] = useState<Record<string, CITExpenseMeta>>({});
  const [citLossRecords, setCitLossRecords] = useState<CITLossRecord[]>([]);
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(() =>
    ensureSystemConfigCompat({ initializationDate: new Date().toISOString(), openingBalanceLock: 'OPEN' }),
  );
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({
    name: 'Công ty TNHH TMDV và Công nghệ Victory', taxCode: '0109238339', phone: '0922248868', branchCode: 'HN', address: 'Số 5, tổ 4, phường Phúc Lợi, TP Hà Nội, Việt Nam', city: 'Hà Nội', country: 'Việt Nam', email: 'Hanoivictory@gmail.com'
  });
  const [modals, setModals] = useState<any>({});
  const [warehouseFormHints, setWarehouseFormHints] = useState<WarehouseFormHintsState>({});
  const [partnerNameHistory, setPartnerNameHistory] = useState<PartnerNameHistoryState>(() => ({
    ...EMPTY_PARTNER_NAME_HISTORY,
  }));
  const [inventoryCatalog, setInventoryCatalog] = useState<InventoryItem[]>([]);
  const [bomDefinitions, setBomDefinitions] = useState<BomDefinition[]>([]);
  const inventoryCatalogRef = useRef<InventoryItem[]>([]);
  const inventoryRef = useRef<InventoryItem[]>([]);
  const transactionsRef = useRef<InventoryTransaction[]>([]);
  const invoicesRef = useRef<Invoice[]>([]);
  const journalEntriesRef = useRef<JournalEntry[]>([]);
  const yearDataByKeyRef = useRef<Record<YearKey, YearData>>({});
  const activeYearKeyRef = useRef<YearKey>('');

  const resolveBankSelection = useCallback(
    (
      snapshot?: Partial<BankAccountSnapshot> | null,
      opts?: { requireActive?: boolean },
    ): { bankAccount: BankAccount | null; snapshot: BankAccountSnapshot; error?: string } => {
      const matchedBankAccount = resolveBankAccountFromSnapshot(bankAccounts, snapshot);
      if (matchedBankAccount) {
        if (opts?.requireActive && matchedBankAccount.status !== 'ACTIVE') {
          return {
            bankAccount: matchedBankAccount,
            snapshot: extractBankAccountSnapshot(matchedBankAccount),
            error: 'Tài khoản ngân hàng đang ngừng sử dụng. Vui lòng chọn tài khoản khác.',
          };
        }
        return {
          bankAccount: matchedBankAccount,
          snapshot: extractBankAccountSnapshot(matchedBankAccount),
        };
      }

      const rawLedgerCode = String(snapshot?.bankLedgerAccountCode || '').trim();
      if (isBankLedgerChildAccountCode(rawLedgerCode)) {
        return {
          bankAccount: null,
          snapshot: {
            ...clearBankAccountSnapshot(),
            bankAccountId: snapshot?.bankAccountId,
            bankName: snapshot?.bankName,
            bankAccountNumber: snapshot?.bankAccountNumber,
            bankAccountHolder: snapshot?.bankAccountHolder,
            bankBranch: snapshot?.bankBranch,
            bankLedgerAccountCode: rawLedgerCode,
          },
        };
      }

      return {
        bankAccount: null,
        snapshot: clearBankAccountSnapshot(),
      };
    },
    [bankAccounts],
  );
  useEffect(() => {
    inventoryCatalogRef.current = inventoryCatalog;
  }, [inventoryCatalog]);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  useEffect(() => {
    transactionsRef.current = transactions;
  }, [transactions]);

  useEffect(() => {
    invoicesRef.current = invoices;
  }, [invoices]);

  useEffect(() => {
    journalEntriesRef.current = journalEntries;
  }, [journalEntries]);

  useEffect(() => {
    yearDataByKeyRef.current = yearDataByKey;
  }, [yearDataByKey]);

  useEffect(() => {
    activeYearKeyRef.current = activeYearKey;
  }, [activeYearKey]);

  const warehouseInventoryItems = useMemo(() => {
    const defaultWarehouseId = getDefaultWarehouseId(warehouses);
    const tombstoneIds = new Set((deletedEntityTombstones.inventory || []).map(String));
    const fromInv = filterTombstonedByField(inventory, deletedEntityTombstones, 'inventory').map((i) =>
      ensureWarehouseBalances(i, defaultWarehouseId),
    );
    const seen = new Set(fromInv.map((i) => String(i.id)));
    const out = [...fromInv];
    for (const c of inventoryCatalog) {
      const id = String(c.id);
      if (!id || seen.has(id) || tombstoneIds.has(id)) continue;
      seen.add(id);
      // Sản phẩm chỉ có trong danh mục (không có dòng tồn kho/lịch sử) => số dư phải = 0.
      // Tránh hiển thị "số dư ảo" lấy từ quantity cũ trong catalog khi lịch sử đã xóa hết.
      out.push(
        ensureWarehouseBalances(
          { ...c, quantity: 0, serials: [], serialDetails: [], warehouseBalances: [] },
          defaultWarehouseId,
        ),
      );
    }
    return out;
  }, [inventory, inventoryCatalog, warehouses, deletedEntityTombstones]);

  const [catalogBackupSnapshot, setCatalogBackupSnapshot] = useState<{
    updatedAt: number;
    customers: Customer[];
    suppliers: Supplier[];
    inventory: InventoryItem[];
    inventoryCatalog?: InventoryItem[];
    bomDefinitions?: BomDefinition[];
  } | null>(null);

  useEffect(() => {
    financialYearRef.current = financialYear;
  }, [financialYear]);

  useEffect(() => {
    documentNumberCountersRef.current = documentNumberCounters;
  }, [documentNumberCounters]);

  useEffect(() => {
    deletedEntityTombstonesRef.current = deletedEntityTombstones;
  }, [deletedEntityTombstones]);

  const loadYearDataIntoState = (yd: YearData, warehouseList: Warehouse[] = warehouses) => {
    const normalizedYearData = stripDeletedFromYearData(
      normalizeYearDataPaymentAccounts(yd),
      deletedEntityTombstonesRef.current,
    );
    const defaultWarehouseId = getDefaultWarehouseId(warehouseList);
    setAccountingPeriods(normalizedYearData.accountingPeriods || []);
    setInvoices(normalizedYearData.invoices || []);
    setInventory(
      normalizeInventoryRows(
        normalizedYearData.inventory || [],
        defaultWarehouseId,
      ),
    );
    setJournalEntries(normalizedYearData.journalEntries || []);
    setTransactions(normalizedYearData.transactions || []);
    setFundTransactions(normalizedYearData.fundTransactions || []);
    setAccountingVouchers(normalizedYearData.accountingVouchers || []);
    setProductionOrders(normalizedYearData.productionOrders || []);
    setDocumentNumberCounters((normalizedYearData.documentNumberCounters && typeof normalizedYearData.documentNumberCounters === 'object') ? normalizedYearData.documentNumberCounters : {});
    setCashFlowOpening(normalizedYearData.cashFlowOpening || {});
    setOpeningBalanceAccounts(
      normalizeOpeningBalanceAccounts((normalizedYearData as any).openingBalanceAccounts).length > 0
        ? normalizeOpeningBalanceAccounts((normalizedYearData as any).openingBalanceAccounts)
        : buildOpeningAccountsFromJournalEntries(normalizedYearData.journalEntries || []),
    );
    setOpeningBalanceDebts(normalizeOpeningBalanceDebts((normalizedYearData as any).openingBalanceDebts));
    setOpeningBalanceRolloverMeta(normalizeOpeningBalanceRolloverMeta((normalizedYearData as any).openingBalanceRolloverMeta));
    setCitExpenseMeta(normalizedYearData.citExpenseMeta || {});
    setCitLossRecords(normalizedYearData.citLossRecords || []);
  };

  const getCurrentYearSnapshot = (): YearData => ({
    accountingPeriods,
    invoices,
    inventory,
    journalEntries,
    transactions,
    fundTransactions,
    accountingVouchers,
    productionOrders,
    documentNumberCounters,
    cashFlowOpening,
    openingBalanceAccounts,
    openingBalanceDebts,
    openingBalanceRolloverMeta,
    citExpenseMeta,
    citLossRecords,
  });

  const getCombinedYearDataSnapshot = () => {
    const tombstones = deletedEntityTombstonesRef.current;
    const combined = {
      ...yearDataByKey,
      [activeYearKey]: getCurrentYearSnapshot(),
    };
    if (!Object.keys(tombstones).length) return combined;
    return Object.fromEntries(
      Object.entries(combined).map(([yearKey, yearData]) => [
        yearKey,
        stripDeletedFromYearData(yearData, tombstones),
      ]),
    ) as Record<YearKey, YearData>;
  };

  const persistOpeningDataToBackend = useCallback(
    async (
      token: string,
      openingBalancesPayload: OpeningBalancesApiPayload,
      debtDetailsPayload: DebtDetailsApiPayload,
    ) => {
      const debtRes = await fetch(`${API_PREFIX}/debt-details`, {
        method: 'PUT',
        headers: apiAuthHeaders(token, true),
        body: JSON.stringify(debtDetailsPayload),
      });
      if (debtRes.status === 401) {
        forceLogout();
        return false;
      }
      if (!debtRes.ok) throw new Error('persist debt details failed');

      const openingBalancesRes = await fetch(`${API_PREFIX}/opening-balances`, {
        method: 'PUT',
        headers: apiAuthHeaders(token, true),
        body: JSON.stringify(openingBalancesPayload),
      });
      if (openingBalancesRes.status === 401) {
        forceLogout();
        return false;
      }
      if (!openingBalancesRes.ok) throw new Error('persist opening balances failed');

      return true;
    },
    [],
  );

  const markFutureRolloverSnapshotsStaleForSourceYear = useCallback((sourceYearKey: string) => {
    setYearDataByKey((prev) => {
      let changed = false;
      const next: Record<YearKey, YearData> = { ...prev };
      for (const [yearKey, yearData] of Object.entries(prev)) {
        const meta = normalizeOpeningBalanceRolloverMeta((yearData as any).openingBalanceRolloverMeta);
        if (!meta || meta.sourceYearKey !== sourceYearKey) continue;
        const nextDebts = normalizeOpeningBalanceDebts(yearData.openingBalanceDebts).map((row) => ({
          ...row,
          syncStatus: 'STALE' as const,
        }));
        next[yearKey] = {
          ...yearData,
          openingBalanceDebts: nextDebts,
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  const refreshFutureRolloverSnapshotsForSourceYear = useCallback((sourceYearKey: string) => {
    const combined = getCombinedYearDataSnapshot();
    const sourceYearData = combined[sourceYearKey];
    if (!sourceYearData) return { refreshed: 0, skipped: 0 };

    const targets = Object.entries(combined)
      .filter(([yearKey, yearData]) => {
        if (yearKey === sourceYearKey) return false;
        const meta = normalizeOpeningBalanceRolloverMeta((yearData as any).openingBalanceRolloverMeta);
        return meta?.sourceYearKey === sourceYearKey;
      })
      .sort(([a], [b]) => a.localeCompare(b));

    if (targets.length === 0) return { refreshed: 0, skipped: 0 };

    let refreshed = 0;
    let skipped = 0;
    setYearDataByKey((prev) => {
      const working: Record<YearKey, YearData> = {
        ...prev,
        [activeYearKey]: activeYearKey === sourceYearKey ? getCurrentYearSnapshot() : prev[activeYearKey],
      };
      for (const [targetKey, yearData] of targets) {
        if (yearDataHasOperationalRecords(yearData)) {
          const nextDebts = normalizeOpeningBalanceDebts(yearData.openingBalanceDebts).map((row) => ({
            ...row,
            syncStatus: 'STALE' as const,
          }));
          working[targetKey] = {
            ...yearData,
            openingBalanceDebts: nextDebts,
          };
          skipped += 1;
          continue;
        }
        const targetYear = parseYearKey(targetKey);
        const refreshedSnapshot = buildRolloverOpeningSnapshot(working[sourceYearKey] || sourceYearData, sourceYearKey, targetYear);
        working[targetKey] = {
          ...yearData,
          accountingPeriods: yearData.accountingPeriods?.length ? yearData.accountingPeriods : generateMonthlyPeriods(targetYear),
          openingBalanceAccounts: refreshedSnapshot.openingBalanceAccounts,
          openingBalanceDebts: refreshedSnapshot.openingBalanceDebts,
          openingBalanceRolloverMeta: refreshedSnapshot.openingBalanceRolloverMeta,
          journalEntries: [
            ...(yearData.journalEntries || []).filter((entry) =>
              !['OPENING-ACC', 'OPENING-CUSTOMER_DEBT', 'OPENING-SUPPLIER_DEBT'].includes(String(entry.referenceId || '')),
            ),
            ...refreshedSnapshot.journalEntries,
          ],
        };
        refreshed += 1;
      }
      return working;
    });
    return { refreshed, skipped };
  }, [
    activeYearKey,
    yearDataByKey,
    invoices,
    journalEntries,
    openingBalanceDebts,
    openingBalanceAccounts,
    openingBalanceRolloverMeta,
    customers,
    suppliers,
  ]);

  useEffect(() => {
    const sourceYearKey = pendingRolloverRefreshSourceYearRef.current;
    if (!sourceYearKey) return;
    pendingRolloverRefreshSourceYearRef.current = null;
    const { refreshed, skipped } = refreshFutureRolloverSnapshotsForSourceYear(sourceYearKey);
    if (refreshed > 0 || skipped > 0) {
      window.setTimeout(() => {
        if (skipped > 0) {
          window.alert(
            `Đã cập nhật lại ${refreshed} niên độ kết chuyển từ năm nguồn. Có ${skipped} niên độ đã có phát sinh nên chỉ được đánh dấu cần kiểm tra lại số dư đầu kỳ.`,
          );
        } else {
          window.alert(`Đã cập nhật lại ${refreshed} niên độ kế tiếp từ số liệu vừa sửa.`);
        }
      }, 0);
    }
  }, [refreshFutureRolloverSnapshotsForSourceYear]);

  const getAllInvoicesAcrossYearsInternal = () =>
    Object.values(getCombinedYearDataSnapshot()).flatMap((yd) => yd.invoices || []);

  const getAllJournalEntriesAcrossYearsInternal = () =>
    Object.values(getCombinedYearDataSnapshot()).flatMap((yd) => yd.journalEntries || []);

  const getAllTransactionsAcrossYearsInternal = () =>
    Object.values(getCombinedYearDataSnapshot()).flatMap((yd) => yd.transactions || []);

  const allInvoicesAcrossYears = useMemo(
    () => getAllInvoicesAcrossYearsInternal(),
    [yearDataByKey, activeYearKey, invoices, accountingPeriods, inventory, journalEntries, transactions, fundTransactions, accountingVouchers, documentNumberCounters, cashFlowOpening, citExpenseMeta, citLossRecords, deletedEntityTombstones],
  );

  const allJournalEntriesAcrossYears = useMemo(
    () => getAllJournalEntriesAcrossYearsInternal(),
    [yearDataByKey, activeYearKey, invoices, accountingPeriods, inventory, journalEntries, transactions, fundTransactions, accountingVouchers, documentNumberCounters, cashFlowOpening, citExpenseMeta, citLossRecords, deletedEntityTombstones],
  );

  const allTransactionsAcrossYears = useMemo(
    () => getAllTransactionsAcrossYearsInternal(),
    [yearDataByKey, activeYearKey, invoices, accountingPeriods, inventory, journalEntries, transactions, fundTransactions, accountingVouchers, documentNumberCounters, cashFlowOpening, citExpenseMeta, citLossRecords, deletedEntityTombstones],
  );

  /** Số bản ghi cần hợp nhất / trùng bucket (niên độ đang mở theo ngày hoặc năm CIT). */
  const misplacedYearDataTotal = useMemo(() => {
    const start = financialYear.startDate;
    const end = financialYear.endDate;
    const combined = getCombinedYearDataSnapshot();
    const invL = new Set(invoices.map((i) => String(i.id)));
    const jeL = new Set(journalEntries.map((j) => String(j.id)));
    const vL = new Set(accountingVouchers.map((v) => String(v.id)));
    const tL = new Set(transactions.map((t) => String(t.id)));
    const fL = new Set(fundTransactions.map((f) => String(f.id)));
    const lossL = new Set(citLossRecords.map((r) => String(r.id)));
    const fyCalYear = new Date(start).getFullYear();

    const strayInv = new Set<string>();
    const strayJe = new Set<string>();
    const strayV = new Set<string>();
    const strayT = new Set<string>();
    const strayF = new Set<string>();
    const strayLoss = new Set<string>();

    for (const yd of Object.values(combined)) {
      for (const inv of yd.invoices || []) {
        if (dateInFinancialYear(inv.date, start, end) && !invL.has(String(inv.id))) strayInv.add(String(inv.id));
      }
      for (const je of yd.journalEntries || []) {
        if (dateInFinancialYear(je.date, start, end) && !jeL.has(String(je.id))) strayJe.add(String(je.id));
      }
      for (const v of yd.accountingVouchers || []) {
        if (dateInFinancialYear(v.date, start, end) && !vL.has(String(v.id))) strayV.add(String(v.id));
      }
      for (const tr of yd.transactions || []) {
        if (dateInFinancialYear(tr.date, start, end) && !tL.has(String(tr.id))) strayT.add(String(tr.id));
      }
      for (const ft of yd.fundTransactions || []) {
        if (dateInFinancialYear(ft.date, start, end) && !fL.has(String(ft.id))) strayF.add(String(ft.id));
      }
      for (const lr of yd.citLossRecords || []) {
        if (Number(lr.year) === fyCalYear && !lossL.has(String(lr.id))) strayLoss.add(String(lr.id));
      }
    }

    let dup = 0;
    for (const [k, yd] of Object.entries(yearDataByKey)) {
      if (k === activeYearKey) continue;
      dup += (yd.invoices || []).filter((i) => invL.has(String(i.id))).length;
      dup += (yd.journalEntries || []).filter((j) => jeL.has(String(j.id))).length;
      dup += (yd.accountingVouchers || []).filter((v) => vL.has(String(v.id))).length;
      dup += (yd.transactions || []).filter((t) => tL.has(String(t.id))).length;
      dup += (yd.fundTransactions || []).filter((f) => fL.has(String(f.id))).length;
      dup += (yd.citLossRecords || []).filter((r) => lossL.has(String(r.id))).length;
    }

    return strayInv.size + strayJe.size + strayV.size + strayT.size + strayF.size + strayLoss.size + dup;
  }, [
    yearDataByKey,
    activeYearKey,
    financialYear,
    invoices,
    journalEntries,
    accountingVouchers,
    transactions,
    fundTransactions,
    citLossRecords,
    accountingPeriods,
    inventory,
    documentNumberCounters,
    cashFlowOpening,
    citExpenseMeta,
  ]);

  /** Đồng bộ lũy kế TSCĐ/CCDC với NKC (bút JE-DEPR-… / DEPR-…) — tránh lệch thẻ tài sản vs Bảng cân đối TK. */
  useEffect(() => {
    if (!hydrated) return;
    setAssets((prev) => reconcileAllAssetsWithJournal(prev, allJournalEntriesAcrossYears));
  }, [hydrated, allJournalEntriesAcrossYears]);

  const patchWarehouseFormHints = useCallback((patch: Partial<WarehouseFormHintsState>) => {
    setWarehouseFormHints((prev) => ({ ...prev, ...patch }));
  }, []);

  const rememberPartnerName = useCallback((kind: PartnerNameKind, raw: string) => {
    setPartnerNameHistory((prev) => rememberPartnerNameReducer(prev, kind, raw));
  }, []);

  const applyStateFromBackend = useCallback((s: any) => {
    // Only set known fields; keep safe defaults if missing.
    const forced = consumePostLoginTab();
    if (forced) setActiveTab(forced);
    if (Array.isArray(s.devices)) {
      setDevices(s.devices.map((device: Device) => normalizeDeviceStatus(device)));
    }
    if (Array.isArray(s.assets)) {
      // Normalize asset type by account/group to avoid mismatched UI (e.g. assetAccount=242 but type=TSCĐ)
      const normalized = s.assets.map((a: any) => {
        const group = String(a?.assetGroup || '');
        const acc = String(a?.assetAccount || '').trim();
        const inferred =
          (acc.startsWith('242') || group.includes('CCDC') || group.includes('(242)')) ? 'CCDC' :
          (acc.startsWith('211') || acc.startsWith('213') || group.includes('TSCĐ') || group.includes('(211)') || group.includes('(213)')) ? 'TSCĐ' :
          (a?.type === 'CCDC' || a?.type === 'TSCĐ') ? a.type : 'TSCĐ';
        const depreciationAccount = inferred === 'TSCĐ' ? '214' : '242';
        let ccdcLifecycle = a?.ccdcLifecycle;
        if (inferred === 'CCDC' && !ccdcLifecycle && acc.startsWith('153')) ccdcLifecycle = 'STOCK_153';
        let accumulatedDepreciation = Number(a?.accumulatedDepreciation ?? 0);
        let accumulatedAllocation = Number(a?.accumulatedAllocation ?? 0);
        if (inferred === 'CCDC') {
          if (a?.accumulatedAllocation == null || a?.accumulatedAllocation === undefined) {
            accumulatedAllocation = accumulatedDepreciation;
          }
          accumulatedDepreciation = 0;
        } else {
          accumulatedAllocation = 0;
        }
        return {
          ...a,
          type: inferred,
          depreciationAccount: a?.depreciationAccount || depreciationAccount,
          ccdcLifecycle,
          accumulatedDepreciation,
          accumulatedAllocation,
          openingCarryForwardResidualBase:
            a?.openingCarryForwardResidualBase != null && a?.openingCarryForwardResidualBase !== ''
              ? Math.max(0, Number(a.openingCarryForwardResidualBase))
              : undefined,
          openingCarryForwardAccumulated:
            a?.openingCarryForwardAccumulated != null && a?.openingCarryForwardAccumulated !== ''
              ? Math.max(0, Number(a.openingCarryForwardAccumulated))
              : undefined,
          openingCarryForwardTotalUsefulLifeMonths:
            a?.openingCarryForwardTotalUsefulLifeMonths != null && a?.openingCarryForwardTotalUsefulLifeMonths !== ''
              ? Math.max(1, Number(a.openingCarryForwardTotalUsefulLifeMonths))
              : undefined,
        };
      });
      setAssets(normalized);
    }
    const loadedBankAccounts = normalizeBankAccounts((s as any).bankAccounts);
    if (Array.isArray(s.accounts)) {
      setAccounts(
        mergeAccountsWithDefaults([
          ...s.accounts,
          ...loadedBankAccounts.map((bank) => buildBankLinkedAccountDefinition(bank)),
        ]),
      );
    } else if (loadedBankAccounts.length > 0) {
      setAccounts(mergeAccountsWithDefaults(loadedBankAccounts.map((bank) => buildBankLinkedAccountDefinition(bank))));
    }
    if (Array.isArray(s.customers)) setCustomers(s.customers);
    if (Array.isArray(s.suppliers)) setSuppliers(s.suppliers);
    if (Array.isArray(s.employees)) setEmployees(s.employees);
    const loadedWarehouses = normalizeWarehouses(Array.isArray(s.warehouses) ? (s.warehouses as Warehouse[]) : []);
    setWarehouses(loadedWarehouses);
    if (Array.isArray(s.expenseCategories)) setExpenseCategories(s.expenseCategories);
    if (Array.isArray(s.taxRates)) setTaxRates(s.taxRates);
    if (Array.isArray(s.paymentMethods)) setPaymentMethods(s.paymentMethods);
    setBankAccounts(loadedBankAccounts);
    if (s.systemConfig && typeof s.systemConfig === 'object') setSystemConfig(ensureSystemConfigCompat(s.systemConfig));
    if (s.companyInfo && typeof s.companyInfo === 'object') {
      setCompanyInfo((prev) => ({
        ...prev,
        ...s.companyInfo,
        branchCode: normalizeBranchCode(s.companyInfo.branchCode, s.companyInfo.city || prev.city),
      }));
    }
    if (s.warehouseFormHints && typeof s.warehouseFormHints === 'object' && !Array.isArray(s.warehouseFormHints)) {
      setWarehouseFormHints(s.warehouseFormHints as WarehouseFormHintsState);
    }
    {
      let fromServer = parsePartnerNameHistoryFromPersist(s.partnerNameHistory);
      try {
        const rawLegacy = localStorage.getItem('vtr_partner_name_suggestions_v1');
        if (rawLegacy) {
          const fromLs = parsePartnerNameHistoryFromPersist(JSON.parse(rawLegacy));
          localStorage.removeItem('vtr_partner_name_suggestions_v1');
          fromServer = mergePartnerNameHistoryImports(fromServer, fromLs);
        }
      } catch {
        /* ignore legacy */
      }
      setPartnerNameHistory(fromServer);
    }
    setBomDefinitions(normalizeBomDefinitions((s as any).bomDefinitions));
    const tombstonesFromServer: DeletedEntityTombstones =
      s.deletedEntityTombstones && typeof s.deletedEntityTombstones === 'object' && !Array.isArray(s.deletedEntityTombstones)
        ? (s.deletedEntityTombstones as DeletedEntityTombstones)
        : {};
    if ((s as any).stateResetMarker !== undefined) {
      stateResetMarkerRef.current = (s as any).stateResetMarker ?? null;
    }
    const tombstonesRaw = mergeTombstoneMaps(deletedEntityTombstonesRef.current, tombstonesFromServer);
    // Cập nhật ref đồng bộ trước khi loadYearDataIntoState chạy (hàm này đọc ref để
    // lọc bản ghi đã xóa). Nếu chỉ dựa vào setState thì ref còn cũ trong cùng lần render
    // và dữ liệu đã xóa sẽ bị nạp lại.
    deletedEntityTombstonesRef.current = tombstonesRaw;
    setDeletedEntityTombstones(tombstonesRaw);
    const auditFromServer = Array.isArray(s.entityDeletionAuditLog)
      ? (s.entityDeletionAuditLog as EntityDeletionAuditEntry[])
      : [];
    setEntityDeletionAuditLog((prev) => mergeEntityDeletionAuditLogs(prev, auditFromServer));
    {
      const hasHotelPmsKey = Object.prototype.hasOwnProperty.call(s, 'hotelPms');
      if (hasHotelPmsKey) {
        setHotelPmsState(normalizeHotelPmsState(s.hotelPms));
      } else {
        const legacyHotelPms = loadHotelPmsState();
        setHotelPmsState(legacyHotelPms ?? getDefaultHotelPmsState());
        if (legacyHotelPms) clearHotelPmsState();
      }
    }
    if (s.catalogBackupSnapshot && typeof s.catalogBackupSnapshot === 'object') {
      const c = s.catalogBackupSnapshot as Record<string, unknown>;
      const defaultWhForBackup = getDefaultWarehouseId(loadedWarehouses);
      setCatalogBackupSnapshot({
        updatedAt: Number(c.updatedAt) || Date.now(),
        customers: Array.isArray(c.customers) ? (c.customers as Customer[]) : [],
        suppliers: Array.isArray(c.suppliers) ? (c.suppliers as Supplier[]) : [],
        inventory: filterTombstonedByField(
          normalizeInventoryRows(
            Array.isArray(c.inventory) ? (c.inventory as InventoryItem[]) : [],
            defaultWhForBackup,
          ),
          tombstonesRaw,
          'inventory',
        ),
        inventoryCatalog: Array.isArray(c.inventoryCatalog)
          ? filterTombstonedByField(
              normalizeInventoryRows(c.inventoryCatalog as InventoryItem[], defaultWhForBackup),
              tombstonesRaw,
              'inventory',
            )
          : undefined,
        bomDefinitions: normalizeBomDefinitions((c as any).bomDefinitions),
      });
    }

    // --- Multi-year hydration (backward compatible) ---
    const fy: FinancialYear =
      (s.financialYear?.startDate && s.financialYear?.endDate) ? s.financialYear : financialYearRef.current;
    const key: YearKey = typeof s.activeYearKey === 'string' ? s.activeYearKey : makeYearKey(fy);
    const years: FinancialYear[] = Array.isArray(s.financialYears) && s.financialYears.length > 0 ? s.financialYears : [fy];

    if (s.yearDataByKey && typeof s.yearDataByKey === 'object') {
      const rawMap = s.yearDataByKey as Record<YearKey, YearData>;
      const mergedRoot = mergeYearDataMapWithRootArrays(rawMap, key, s as Record<string, unknown>);
      const normalizedMap = Object.fromEntries(
        Object.entries(mergedRoot).map(([yearKey, yearData]) => [yearKey, normalizeYearDataPaymentAccounts(yearData as YearData)])
      ) as Record<YearKey, YearData>;
      const repairedMap = repairYearDataByKeyByFiscalDates(normalizedMap, years);
      const yearsMerged = mergeFinancialYearsWithMapKeys(years, repairedMap);
      const strippedMap = Object.fromEntries(
        Object.entries(repairedMap).map(([yearKey, yearData]) => [
          yearKey,
          stripDeletedFromYearData(yearData as YearData, tombstonesRaw),
        ]),
      ) as Record<YearKey, YearData>;
      setFinancialYear(fy);
      setFinancialYears(yearsMerged);
      setActiveYearKey(key);
      setYearDataByKey(strippedMap);
      const active = strippedMap[key] || buildEmptyYearData([]);
      // Auto-generate periods if missing
      if (!active.accountingPeriods || active.accountingPeriods.length === 0) {
        active.accountingPeriods = generateMonthlyPeriods(fy);
      }
      loadYearDataIntoState(active, loadedWarehouses);
      const defaultWhId = getDefaultWarehouseId(loadedWarehouses);
      if (Array.isArray(s.inventoryCatalog) && (s.inventoryCatalog as InventoryItem[]).length > 0) {
        setInventoryCatalog(
          filterTombstonedByField(
            normalizeInventoryRows(s.inventoryCatalog as InventoryItem[], defaultWhId),
            tombstonesRaw,
            'inventory',
          ),
        );
      } else {
        const inv = active.inventory || [];
        setInventoryCatalog(
          normalizeInventoryRows(
            inv.map((i: InventoryItem) => ({ ...i })),
            defaultWhId,
          ),
        );
      }
    } else {
      // Migrate from legacy single-year shape into multi-year (có thể tách theo ngày nếu financialYears có nhiều niên độ).
      const migrated: YearData = {
        accountingPeriods: Array.isArray(s.accountingPeriods) && s.accountingPeriods.length > 0 ? s.accountingPeriods : generateMonthlyPeriods(fy),
        invoices: Array.isArray(s.invoices) ? s.invoices : [],
        inventory: Array.isArray(s.inventory) ? s.inventory : [],
        journalEntries: Array.isArray(s.journalEntries) ? s.journalEntries : [],
        transactions: Array.isArray(s.transactions) ? s.transactions : [],
        fundTransactions: Array.isArray(s.fundTransactions) ? s.fundTransactions : [],
        accountingVouchers: Array.isArray(s.accountingVouchers) ? s.accountingVouchers : [],
        productionOrders: Array.isArray((s as any).productionOrders) ? ((s as any).productionOrders as ProductionOrder[]) : [],
        documentNumberCounters: (s.documentNumberCounters && typeof s.documentNumberCounters === 'object') ? s.documentNumberCounters : {},
        cashFlowOpening: (s.cashFlowOpening && typeof s.cashFlowOpening === 'object') ? s.cashFlowOpening : {},
        openingBalanceAccounts: normalizeOpeningBalanceAccounts((s as any).openingBalanceAccounts),
        openingBalanceDebts: normalizeOpeningBalanceDebts((s as any).openingBalanceDebts),
        openingBalanceRolloverMeta: normalizeOpeningBalanceRolloverMeta((s as any).openingBalanceRolloverMeta),
        citExpenseMeta: (s.citExpenseMeta && typeof s.citExpenseMeta === 'object') ? s.citExpenseMeta : {},
        citLossRecords: Array.isArray(s.citLossRecords) ? s.citLossRecords : [],
      };
      const normalizedMigrated = normalizeYearDataPaymentAccounts(migrated);
      setFinancialYear(fy);
      setActiveYearKey(key);
      let initialMap: Record<YearKey, YearData>;
      if (years.length > 1) {
        initialMap = {};
        for (const yf of years) {
          initialMap[makeYearKey(yf)] = buildEmptyYearData(normalizedMigrated.inventory);
        }
        initialMap[key] = { ...normalizedMigrated };
      } else {
        initialMap = { [key]: normalizedMigrated };
      }
      const repairedLegacy = repairYearDataByKeyByFiscalDates(initialMap, years);
      const yearsLegacyMerged = mergeFinancialYearsWithMapKeys(years, repairedLegacy);
      const strippedLegacy = Object.fromEntries(
        Object.entries(repairedLegacy).map(([yearKey, yearData]) => [
          yearKey,
          stripDeletedFromYearData(yearData as YearData, tombstonesRaw),
        ]),
      ) as Record<YearKey, YearData>;
      setFinancialYears(yearsLegacyMerged);
      setYearDataByKey(strippedLegacy);
      const activeLegacy = strippedLegacy[key] || buildEmptyYearData([]);
      if (!activeLegacy.accountingPeriods || activeLegacy.accountingPeriods.length === 0) {
        activeLegacy.accountingPeriods = generateMonthlyPeriods(fy);
      }
      loadYearDataIntoState(activeLegacy, loadedWarehouses);
      if (Array.isArray(s.inventoryCatalog) && (s.inventoryCatalog as InventoryItem[]).length > 0) {
        setInventoryCatalog(
          filterTombstonedByField(
            normalizeInventoryRows(
              s.inventoryCatalog as InventoryItem[],
              getDefaultWarehouseId(loadedWarehouses),
            ),
            tombstonesRaw,
            'inventory',
          ),
        );
      } else {
        const inv = activeLegacy.inventory || [];
        setInventoryCatalog(
          normalizeInventoryRows(
            inv.map((i: InventoryItem) => ({ ...i })),
            getDefaultWarehouseId(loadedWarehouses),
          ),
        );
      }
    }
  }, []);

  const loadStateFromBackend = useCallback(async (opts?: { ignoreIfNoToken?: boolean; remote?: boolean; lite?: boolean }) => {
    const token = getToken();
    if (!token) {
      if (opts?.ignoreIfNoToken) setBackendAvailable(true);
      return;
    }
    if (opts?.remote) {
      suppressPersistUntilRef.current = Date.now() + 600;
      remoteEchoBodyRef.current = null;
    }
    const liteRemote = opts?.lite && opts?.remote;
    if (!liteRemote) {
      setOpeningPersistReady(false);
    }
    try {
      const authHeaders = apiAuthHeaders(token);

      if (liteRemote) {
        const stateRes = await fetch(`${API_PREFIX}/state`, { headers: authHeaders, cache: 'no-store' });
        if (stateRes.status === 401) {
          forceLogout();
          setBackendAvailable(true);
          return;
        }
        if (!stateRes.ok) {
          throw new Error('failed to fetch state');
        }
        // Có thay đổi cục bộ chưa persist (vd: vừa Nạp tài nguyên) — không ghi đè bằng bản server cũ.
        if (persistPendingRef.current || persistInFlightRef.current > 0) {
          scheduleRemoteStateReloadRef.current();
          setBackendAvailable(true);
          return;
        }
        const dataVersion = readStateDataVersionHeader(stateRes);
        if (dataVersion != null) stateDataVersionRef.current = dataVersion;
        const s = await stateRes.json();
        // Echo = snapshot server vừa tải (trước apply) — tránh persist gửi lại y hệt sau reload,
        // nhưng vẫn cho phép persist khi user đã sửa cục bộ (vd: Nạp tài nguyên).
        try {
          remoteEchoBodyRef.current = JSON.stringify(stripOpeningDataFromStateSnapshot(s));
        } catch {
          remoteEchoBodyRef.current = null;
        }
        applyStateFromBackend(s);
        setOpeningPersistReady(true);
        setBackendAvailable(true);
        setPersistStatus((s0) => ({ ...s0, lastError: undefined }));
        return;
      }

      // Không gọi /api/health riêng: dễ báo sai (race Docker, proxy) trong khi /api/state vẫn OK.
      const [stateRes, openingBalancesRes, debtDetailsRes, meRes] = await Promise.all([
        fetch(`${API_PREFIX}/state`, { headers: authHeaders, cache: 'no-store' }),
        fetch(`${API_PREFIX}/opening-balances`, { headers: authHeaders, cache: 'no-store' }),
        fetch(`${API_PREFIX}/debt-details`, { headers: authHeaders, cache: 'no-store' }),
        fetch(`${API_PREFIX}/me`, { headers: authHeaders, cache: 'no-store' }),
      ]);
      if (stateRes.status === 401 || openingBalancesRes.status === 401 || debtDetailsRes.status === 401) {
        forceLogout();
        setBackendAvailable(true);
        return;
      }
      const readApiError = async (response: Response, fallback: string) => {
        try {
          const body = await response.json();
          return typeof body?.error === 'string' ? body.error : fallback;
        } catch {
          return fallback;
        }
      };
      if (!stateRes.ok) {
        throw new Error(await readApiError(stateRes, 'failed to fetch state'));
      }
      if (!openingBalancesRes.ok) {
        throw new Error(await readApiError(openingBalancesRes, 'failed to fetch opening balances'));
      }
      if (!debtDetailsRes.ok) {
        throw new Error(await readApiError(debtDetailsRes, 'failed to fetch debt details'));
      }
      if (meRes.ok) {
        try {
          authProfileRef.current = await meRes.json();
        } catch {
          authProfileRef.current = null;
        }
      }
      const dataVersion = readStateDataVersionHeader(stateRes);
      if (dataVersion != null) {
        stateDataVersionRef.current = dataVersion;
      }
      const [stateBody, openingBalancesBody, debtDetailsBody] = await Promise.all([
        stateRes.json(),
        openingBalancesRes.json(),
        debtDetailsRes.json(),
      ]);
      const s: any = mergeOpeningApiPayloadIntoState(
        stateBody,
        openingBalancesBody as OpeningBalancesApiPayload,
        debtDetailsBody as DebtDetailsApiPayload,
      );
      const openingActiveYearKey =
        typeof s?.activeYearKey === 'string' && s.activeYearKey
          ? s.activeYearKey
          : s?.financialYear?.startDate && s?.financialYear?.endDate
            ? makeYearKey(s.financialYear as FinancialYear)
            : makeYearKey(financialYearRef.current);
      const openingYearDataByKey =
        s?.yearDataByKey && typeof s.yearDataByKey === 'object'
          ? (s.yearDataByKey as Record<YearKey, YearData>)
          : {};
      lastOpeningPersistSignatureRef.current = JSON.stringify(
        buildOpeningApiPayloadsFromYearDataMap(openingYearDataByKey, openingActiveYearKey),
      );
      pendingHydratedOpeningSignatureRef.current = buildActiveOpeningHydrationSignature(
        openingActiveYearKey,
        openingYearDataByKey[openingActiveYearKey],
      );
      if (
        isActiveOpeningHydrationReady(
          pendingHydratedOpeningSignatureRef.current,
          currentOpeningHydrationStateRef.current,
        )
      ) {
        pendingHydratedOpeningSignatureRef.current = null;
        setOpeningPersistReady(true);
      }

      applyStateFromBackend(s);

      let catalogBackupForRestore: any =
        s?.catalogBackupSnapshot && typeof s.catalogBackupSnapshot === 'object' ? s.catalogBackupSnapshot : null;

      // Migrate warehouse hints / catalog backup từ localStorage (một lần) nếu DB cũ chưa có trường mới
      try {
        if (!s.warehouseFormHints || Object.keys(s.warehouseFormHints || {}).length === 0) {
          const wh: Partial<WarehouseFormHintsState> = {};
          const pairs: [string, keyof WarehouseFormHintsState][] = [
            ['warehouse_last_supplier_name', 'supplierName'],
            ['warehouse_last_supplier_tax', 'supplierTax'],
            ['warehouse_last_form_no', 'formNo'],
            ['warehouse_last_symbol_code', 'symbolCode'],
            ['warehouse_last_supplier_phone', 'supplierPhone'],
            ['warehouse_last_supplier_address', 'supplierAddress'],
            ['warehouse_last_customer_name', 'customerName'],
            ['warehouse_last_customer_tax', 'customerTax'],
            ['warehouse_last_customer_phone', 'customerPhone'],
            ['warehouse_last_customer_address', 'customerAddress'],
          ];
          for (const [lsKey, sk] of pairs) {
            const v = localStorage.getItem(lsKey);
            if (v) wh[sk] = v;
          }
          if (Object.keys(wh).length) {
            setWarehouseFormHints((prev) => ({ ...prev, ...wh }));
            pairs.forEach(([k]) => localStorage.removeItem(k));
          }
        }
        if (!s.catalogBackupSnapshot) {
          const raw = localStorage.getItem('catalog_backup_v1');
          if (raw) {
            const parsed = JSON.parse(raw);
            catalogBackupForRestore = catalogBackupForRestore || parsed;
            setCatalogBackupSnapshot({
              updatedAt: Number(parsed.updatedAt) || Date.now(),
              customers: Array.isArray(parsed.customers) ? parsed.customers : [],
              suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
              inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
              bomDefinitions: normalizeBomDefinitions((parsed as any)?.bomDefinitions),
            });
            localStorage.removeItem('catalog_backup_v1');
          }
        }
      } catch {
        // ignore migration
      }

      setBackendAvailable(true);
      setPersistStatus(s0 => ({ ...s0, lastError: undefined }));

      try {
        const versionRes = await fetch(`${API_PREFIX}/state/version`, { headers: authHeaders });
        if (versionRes.ok) {
          const v = await versionRes.json();
          const rev = Number(v?.revision);
          if (Number.isFinite(rev)) {
            lastKnownStateRevisionRef.current = Math.max(lastKnownStateRevisionRef.current, rev);
          }
        }
      } catch {
        // ignore
      }

      // Safety net: danh mục rỗng nhưng có snapshot (SQLite hoặc vừa migrate từ localStorage)
      if (!opts?.remote) try {
        const backup = catalogBackupForRestore;
        const bCustomers = Array.isArray(backup?.customers) ? backup.customers : [];
        const bSuppliers = Array.isArray(backup?.suppliers) ? backup.suppliers : [];
        const bInventory = Array.isArray(backup?.inventory) ? backup.inventory : [];
        const bInventoryCatalog = Array.isArray((backup as any)?.inventoryCatalog) ? (backup as any).inventoryCatalog : [];
        const bBomDefinitions = normalizeBomDefinitions((backup as any)?.bomDefinitions);
        const sCustomers = Array.isArray(s?.customers) ? s.customers : null;
        const sSuppliers = Array.isArray(s?.suppliers) ? s.suppliers : null;
        const sBomDefinitions = Array.isArray((s as any)?.bomDefinitions) ? (s as any).bomDefinitions : null;
        const key: YearKey = typeof s?.activeYearKey === 'string' ? s.activeYearKey : makeYearKey(s?.financialYear || financialYearRef.current);
        const sYear = s?.yearDataByKey && typeof s.yearDataByKey === 'object' ? (s.yearDataByKey as Record<string, any>)[key] : null;
        const sInventory = Array.isArray(sYear?.inventory) ? sYear.inventory : null;
        const missingCustomers = Array.isArray(sCustomers) && sCustomers.length === 0 && bCustomers.length > 0;
        const missingSuppliers = Array.isArray(sSuppliers) && sSuppliers.length === 0 && bSuppliers.length > 0;
        const missingInventory = Array.isArray(sInventory) && sInventory.length === 0 && bInventory.length > 0;
        const missingBomDefinitions = Array.isArray(sBomDefinitions) && sBomDefinitions.length === 0 && bBomDefinitions.length > 0;
        if (missingCustomers || missingSuppliers || missingInventory || missingBomDefinitions) {
          const ok = window.confirm(
            'Phát hiện một phần danh mục (Khách hàng / Nhà cung cấp / Hàng hóa - Vật tư / BOM) trên hệ thống đang rỗng, nhưng có bản sao lưu danh mục (đã lưu trên máy chủ / dữ liệu cũ).\n\n' +
            'Bạn có muốn khôi phục lại danh mục từ bản sao lưu đó không?'
          );
          if (ok) {
            if (missingCustomers) setCustomers(bCustomers);
            if (missingSuppliers) setSuppliers(bSuppliers);
            if (missingInventory) {
              const defaultWarehouseId = getDefaultWarehouseId(loadedWarehouses);
              const tombstones = deletedEntityTombstonesRef.current;
              setInventory(
                filterTombstonedByField(
                  normalizeInventoryRows(bInventory, defaultWarehouseId),
                  tombstones,
                  'inventory',
                ),
              );
              if (bInventoryCatalog.length > 0) {
                setInventoryCatalog(
                  filterTombstonedByField(
                    normalizeInventoryRows(bInventoryCatalog as InventoryItem[], defaultWarehouseId),
                    tombstones,
                    'inventory',
                  ),
                );
              }
            }
            if (missingBomDefinitions) setBomDefinitions(bBomDefinitions);
          }
        }
      } catch {
        // ignore
      }
    } catch (err) {
      console.warn('Backend state not loaded; running in-memory only.', err);
      setBackendAvailable(false);
      setPersistStatus(s0 => ({ ...s0, lastError: String((err as any)?.message || err || 'Load failed') }));
      pendingHydratedOpeningSignatureRef.current = null;
      setOpeningPersistReady(true);
    }
  }, [applyStateFromBackend]);

  const retryLoadState = useCallback(async () => {
    setPersistStatus(s0 => ({ ...s0, lastError: undefined }));
    await loadStateFromBackend({});
  }, [loadStateFromBackend]);

  const refreshHotelPmsFromBackend = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_PREFIX}/state`, {
        headers: apiAuthHeaders(token),
        cache: 'no-store',
      });
      if (res.status === 401) {
        forceLogout();
        return;
      }
      if (!res.ok) return;
      const s = await res.json();
      if (s?.hotelPms && typeof s.hotelPms === 'object') {
        setHotelPmsState(normalizeHotelPmsState(s.hotelPms));
      } else if (s?.hotelPms === null || s?.hotelPms === undefined) {
        setHotelPmsState(getDefaultHotelPmsState());
      }
      setHotelPmsResetNonce((n) => n + 1);
    } catch (err) {
      console.warn('[hotel-pms] refresh slice failed', err);
    }
  }, []);

  useEffect(() => {
    const onLifecycleMutationStart = () => {
      persistEpochRef.current += 1;
      suppressPersistUntilRef.current = Math.max(suppressPersistUntilRef.current, Date.now() + 300);
    };
    const onLifecycleMutationEnd = () => {
      // Lifecycle vừa bump phiên bản state ở backend → đồng bộ lại để PUT /state kế tiếp
      // không bị coi là xung đột (nếu xung đột, backend union-merge sẽ giữ giá trị cũ ở
      // server, vd: số lượng tồn kho chưa hoàn tác → số dư lệch sau khi tải lại).
      const v = getLastLifecycleStateVersion();
      if (v != null && Number.isFinite(v)) {
        stateDataVersionRef.current = v;
      }
      // Lifecycle đã xong: gỡ cửa sổ suppress + bộ chống-echo do mutation-start đặt, nếu không
      // lần persist ép buộc bên dưới sẽ bị hiểu nhầm là "echo thuần" và bị bỏ qua (mất hoàn tác tồn).
      suppressPersistUntilRef.current = 0;
      remoteEchoBodyRef.current = null;
      // Kích hoạt lại effect persist (lần trước đã bị mutation-start hủy) để lưu thay đổi blob.
      setPersistNonce((n) => n + 1);
    };
    window.addEventListener('vtr:lifecycle-mutation-start', onLifecycleMutationStart);
    window.addEventListener('vtr:lifecycle-mutation-end', onLifecycleMutationEnd);
    return () => {
      window.removeEventListener('vtr:lifecycle-mutation-start', onLifecycleMutationStart);
      window.removeEventListener('vtr:lifecycle-mutation-end', onLifecycleMutationEnd);
    };
  }, []);

  // Hydrate app state from backend (SQLite) if available.
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        await loadStateFromBackend({ ignoreIfNoToken: true });
      } finally {
        if (!ignore) setHydrated(true);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [loadStateFromBackend]);

  useEffect(() => {
    const clearRemoteReloadTimers = () => {
      if (remoteReloadTimerRef.current != null) {
        window.clearTimeout(remoteReloadTimerRef.current);
        remoteReloadTimerRef.current = null;
      }
      if (remoteReloadWaitPersistTimerRef.current != null) {
        window.clearTimeout(remoteReloadWaitPersistTimerRef.current);
        remoteReloadWaitPersistTimerRef.current = null;
      }
    };

    scheduleRemoteStateReloadRef.current = () => {
      clearRemoteReloadTimers();
      remoteReloadTimerRef.current = window.setTimeout(() => {
        remoteReloadTimerRef.current = null;
        // Hoãn reload nếu đang gửi persist (in-flight) HOẶC có thay đổi cục bộ vừa nhập
        // còn chờ trong cửa sổ debounce. Nếu reload ngay sẽ ghi đè mất dữ liệu user vừa nhập
        // (vd: vừa Nạp tài nguyên nhưng chưa kịp lưu lên server) → số dư về 0.
        if (persistInFlightRef.current > 0 || persistPendingRef.current) {
          remoteReloadWaitPersistTimerRef.current = window.setTimeout(() => {
            remoteReloadWaitPersistTimerRef.current = null;
            scheduleRemoteStateReloadRef.current();
          }, REMOTE_STATE_RELOAD_WAIT_PERSIST_MS);
          return;
        }
        void loadStateFromBackend({ remote: true, lite: true });
      }, REMOTE_STATE_RELOAD_DEBOUNCE_MS);
    };

    return () => {
      clearRemoteReloadTimers();
    };
  }, [loadStateFromBackend]);

  const removeFromStoreArray = useCallback((storeKey: string, entityId: string) => {
    const id = String(entityId);
    switch (storeKey) {
      case 'devices':
        setDevices((p) => p.filter((x) => x.id !== id));
        break;
      case 'invoices':
        setInvoices((p) => p.filter((x) => x.id !== id));
        setYearDataByKey((yd) =>
          Object.fromEntries(
            Object.entries(yd).map(([yk, data]) => [
              yk,
              { ...data, invoices: data.invoices.filter((x) => x.id !== id) },
            ]),
          ) as Record<YearKey, YearData>,
        );
        break;
      case 'accountingVouchers':
        setAccountingVouchers((p) => p.filter((x) => x.id !== id));
        setYearDataByKey((yd) =>
          Object.fromEntries(
            Object.entries(yd).map(([yk, data]) => [
              yk,
              { ...data, accountingVouchers: (data.accountingVouchers || []).filter((x) => x.id !== id) },
            ]),
          ) as Record<YearKey, YearData>,
        );
        break;
      case 'fundTransactions':
        setFundTransactions((p) => p.filter((x) => x.id !== id));
        setYearDataByKey((yd) =>
          Object.fromEntries(
            Object.entries(yd).map(([yk, data]) => [
              yk,
              { ...data, fundTransactions: (data.fundTransactions || []).filter((x) => x.id !== id) },
            ]),
          ) as Record<YearKey, YearData>,
        );
        break;
      case 'bankAccounts':
        setBankAccounts((p) => p.filter((x) => x.id !== id));
        break;
      case 'inventory':
        setInventory((p) => p.filter((x) => x.id !== id));
        setInventoryCatalog((p) => p.filter((x) => x.id !== id));
        setYearDataByKey((yd) =>
          Object.fromEntries(
            Object.entries(yd).map(([yk, data]) => [
              yk,
              { ...data, inventory: (data.inventory || []).filter((x) => x.id !== id) },
            ]),
          ) as Record<YearKey, YearData>,
        );
        break;
      case 'transactions':
        setTransactions((p) => p.filter((x) => x.id !== id));
        setYearDataByKey((yd) =>
          Object.fromEntries(
            Object.entries(yd).map(([yk, data]) => [
              yk,
              { ...data, transactions: (data.transactions || []).filter((x) => x.id !== id) },
            ]),
          ) as Record<YearKey, YearData>,
        );
        break;
      case 'journalEntries':
        setJournalEntries((p) => p.filter((x) => x.id !== id));
        setYearDataByKey((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([yk, yd]) => [
              yk,
              { ...yd, journalEntries: (yd.journalEntries || []).filter((x) => x.id !== id) },
            ]),
          ) as Record<YearKey, YearData>,
        );
        break;
      case 'assets':
        setAssets((p) => p.filter((x) => x.id !== id));
        break;
      default:
        break;
    }
  }, []);

  const purgeJournalEntriesAcrossYears = useCallback(
    (entityType: string, entityId: string, snapshot?: Record<string, unknown> | null) => {
      const apply = (entries: JournalEntry[]) =>
        filterJournalEntriesForLifecycleEntity(entries, entityType, entityId, snapshot);
      setJournalEntries((prev) => apply(prev));
      setYearDataByKey((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([yk, yd]) => [
            yk,
            { ...yd, journalEntries: apply(yd.journalEntries || []) },
          ]),
        ) as Record<YearKey, YearData>,
      );
      if (entityType === 'device') {
        const renewalIds = findDeviceRenewalInvoiceIds(invoices, snapshot);
        for (const invId of renewalIds) {
          const inv = invoices.find((i) => String(i.id) === invId);
          const invSnap = inv ? (inv as unknown as Record<string, unknown>) : null;
          const applyInv = (entries: JournalEntry[]) =>
            filterJournalEntriesForLifecycleEntity(entries, 'invoice', invId, invSnap);
          setJournalEntries((prev) => applyInv(prev));
          setYearDataByKey((prev) =>
            Object.fromEntries(
              Object.entries(prev).map(([yk, yd]) => [
                yk,
                { ...yd, journalEntries: applyInv(yd.journalEntries || []) },
              ]),
            ) as Record<YearKey, YearData>,
          );
        }
      }
    },
    [invoices],
  );

  const handleRemoteStateSignal = useCallback(
    (data: { revision?: number; sourceClientId?: string; kinds?: string[]; entity?: unknown }) => {
      if (!data || typeof data.revision !== 'number') return;
      if (data.kinds?.includes('connected')) {
        lastKnownStateRevisionRef.current = Math.max(
          lastKnownStateRevisionRef.current,
          data.revision,
        );
        return;
      }
      if (data.sourceClientId && data.sourceClientId === getClientId()) {
        lastKnownStateRevisionRef.current = Math.max(
          lastKnownStateRevisionRef.current,
          data.revision,
        );
        return;
      }
      if (data.revision <= lastKnownStateRevisionRef.current) return;
      lastKnownStateRevisionRef.current = data.revision;

      const entity = data.entity as { action?: string; entityType?: string; entityId?: string } | undefined;
      const lifecycleApplied =
        entity?.entityId &&
        entity?.entityType &&
        entity?.action &&
        tryApplyLifecycleRemoteEntity(
          {
            action: entity.action,
            entityType: entity.entityType,
            entityId: entity.entityId,
          },
          removeFromStoreArray,
          purgeJournalEntriesAcrossYears,
        );

      window.dispatchEvent(
        new CustomEvent('vtr:state-remote-update', {
          detail: { kinds: data.kinds || [], entity },
        }),
      );

      if (lifecycleApplied) {
        const storeKey = LC_TYPE_TO_STORE[entity.entityType || ''];
        const tombstoneId = String(entity.entityId || '');
        if (storeKey && tombstoneId) {
          const applyTombstone = (prev: DeletedEntityTombstones) => ({
            ...prev,
            [storeKey]: [...new Set([...(prev[storeKey] || []), tombstoneId])],
          });
          deletedEntityTombstonesRef.current = applyTombstone(deletedEntityTombstonesRef.current);
          setDeletedEntityTombstones(applyTombstone);
        }
        persistEpochRef.current += 1;
        return;
      }

      if (
        (data.kinds?.includes('tax') ||
          data.kinds?.includes('rbac') ||
          data.kinds?.includes('notification') ||
          data.kinds?.includes('e-invoice')) &&
        !data.kinds?.some((kind) => ['state', 'opening', 'debt', 'reset', 'restore'].includes(kind))
      ) {
        return;
      }
      scheduleRemoteStateReloadRef.current();
    },
    [removeFromStoreArray, purgeJournalEntriesAcrossYears],
  );

  // Realtime sync: WebSocket từ server khi máy khác lưu dữ liệu.
  useEffect(() => {
    if (!hydrated || !backendAvailable) return;
    const token = getToken();
    if (!token) return;

    let closed = false;
    let reconnectTimer: number | null = null;
    const connect = () => {
      if (closed) return;
      stateEventsRef.current?.close();
      const ws = new WebSocket(buildWebSocketUrl('/ws/state', token));
      stateEventsRef.current = ws;
      bindRealtimeWebSocket(ws);

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data || '{}')) as RealtimeWireMessage;
          if (dispatchRealtimeWireMessage(data)) return;
          handleRemoteStateSignal(data);
        } catch {
          // ignore malformed event
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };

      ws.onclose = () => {
        if (stateEventsRef.current === ws) stateEventsRef.current = null;
        if (closed) return;
        if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      if (remoteReloadTimerRef.current != null) {
        window.clearTimeout(remoteReloadTimerRef.current);
        remoteReloadTimerRef.current = null;
      }
      if (remoteReloadWaitPersistTimerRef.current != null) {
        window.clearTimeout(remoteReloadWaitPersistTimerRef.current);
        remoteReloadWaitPersistTimerRef.current = null;
      }
      stateEventsRef.current?.close();
      stateEventsRef.current = null;
    };
  }, [hydrated, backendAvailable, handleRemoteStateSignal]);

  useEffect(() => {
    const onOpenTab = (ev: Event) => {
      const tab = (ev as CustomEvent<{ tab?: string }>).detail?.tab;
      if (typeof tab === 'string' && tab.trim()) setActiveTab(tab.trim());
    };
    window.addEventListener('vtr:open-tab', onOpenTab);
    return () => window.removeEventListener('vtr:open-tab', onOpenTab);
  }, []);

  useEffect(() => {
    if (openingPersistReady) return;
    const pendingSignature = pendingHydratedOpeningSignatureRef.current;
    if (!pendingSignature) return;

    if (
      !isActiveOpeningHydrationReady(pendingSignature, {
        activeYearKey,
        openingBalanceAccounts,
        openingBalanceDebts,
        openingBalanceRolloverMeta,
      })
    ) {
      return;
    }

    pendingHydratedOpeningSignatureRef.current = null;
    setOpeningPersistReady(true);
  }, [
    openingPersistReady,
    activeYearKey,
    openingBalanceAccounts,
    openingBalanceDebts,
    openingBalanceRolloverMeta,
  ]);

  // Bản sao danh mục dự phòng — đồng bộ SQLite (VictoryData) qua snapshot persist, không dùng localStorage.
  useEffect(() => {
    setCatalogBackupSnapshot({
      updatedAt: Date.now(),
      customers,
      suppliers,
      inventory,
      inventoryCatalog,
      bomDefinitions,
    });
  }, [customers, suppliers, inventory, inventoryCatalog, bomDefinitions]);

  // Persist changes to backend (debounced).
  useEffect(() => {
    if (!hydrated || !backendAvailable || !openingPersistReady) return;
    const token = getToken();
    if (!token) return;
    // Ensure map has latest active year before persisting
    const snapshotActive = getCurrentYearSnapshot();
    const nextYearDataByKey = { ...yearDataByKey, [activeYearKey]: snapshotActive };
    const snapshot = {
      financialYear,
      financialYears,
      activeYearKey,
      yearDataByKey: nextYearDataByKey,
      accountingPeriods,
      devices,
      invoices,
      inventory,
      journalEntries,
      transactions,
      fundTransactions,
      assets,
      accountingVouchers,
      productionOrders,
      accounts,
      customers,
      suppliers,
      employees,
      warehouses,
      expenseCategories,
      taxRates,
      paymentMethods,
      bankAccounts,
      cashFlowOpening,
      citExpenseMeta,
      citLossRecords,
      systemConfig,
      companyInfo,
      warehouseFormHints,
      partnerNameHistory,
      catalogBackupSnapshot,
      inventoryCatalog,
      bomDefinitions,
      hotelPms: hotelPmsState,
      deletedEntityTombstones,
      entityDeletionAuditLog,
      ...(stateResetMarkerRef.current != null ? { stateResetMarker: stateResetMarkerRef.current } : {}),
      // UI-only state such as activeTab/modals should not be persisted.
    };
    const strippedSnapshot = stripOpeningDataFromStateSnapshot(snapshot);

    // Trong suppress window (vừa áp dữ liệu remote): KHÔNG bỏ qua persist (sẽ mất
    // thay đổi user nhập trong window) — chỉ hoãn tới khi window kết thúc, và ghi
    // nhớ snapshot remote để cuối cùng so sánh: nếu không có gì khác (echo thuần)
    // thì bỏ qua, tránh vòng lặp persist↔reload giữa các máy.
    // remoteEchoBodyRef được gán khi lite remote load (snapshot server), không gán từ local.
    const suppressRemainingMs = suppressPersistUntilRef.current - Date.now();
    const delayMs = Math.max(STATE_PERSIST_DEBOUNCE_MS, suppressRemainingMs + 50);
    const epochAtSchedule = persistEpochRef.current;
    // Có thay đổi đang chờ persist → chặn remote reload ghi đè trong cửa sổ debounce.
    persistPendingRef.current = true;

    const t = window.setTimeout(() => {
      if (epochAtSchedule !== persistEpochRef.current) {
        persistPendingRef.current = false;
        return;
      }
      // Đang RESET: bỏ qua mọi persist để không ghi lại dữ liệu cũ lên DB vừa xóa sạch.
      if (resetInProgressRef.current) {
        persistPendingRef.current = false;
        return;
      }
      const body = JSON.stringify(strippedSnapshot);
      if (remoteEchoBodyRef.current != null) {
        const isPureEcho = body === remoteEchoBodyRef.current;
        remoteEchoBodyRef.current = null;
        if (isPureEcho) {
          persistPendingRef.current = false;
          return;
        }
      }
      persistInFlightRef.current += 1;
      const headers = apiAuthHeaders(token, true);
      if (stateDataVersionRef.current != null) {
        headers['X-Expected-State-Version'] = String(stateDataVersionRef.current);
      }
      // Sau khi RESET: ép ghi đè toàn bộ (bỏ qua hợp nhất theo id ở backend) để dữ liệu
      // cũ không bị "phục hồi" do cơ chế union-merge giữ lại các bản ghi chỉ-có-ở-server.
      if (forceFullReplaceRef.current) {
        headers['X-Force-Replace'] = '1';
        forceFullReplaceRef.current = false;
      }
      fetch(`${API_PREFIX}/state`, {
        method: 'PUT',
        headers,
        body,
      }).then((r) => {
        if (r.status === 401) {
          forceLogout();
          return;
        }
        if (r.status === 409) {
          // Máy khác vừa ghi sau lần mình đọc — không ghi đè. Tải lại bản mới nhất;
          // thay đổi local sẽ được persist lại ở chu kỳ sau (trên nền dữ liệu mới).
          console.warn('[persist] State version conflict — reloading latest from server.');
          scheduleRemoteStateReloadRef.current();
          return;
        }
        if (!r.ok) throw new Error('persist failed');
        const rev = readStateRevisionHeader(r);
        if (rev != null) {
          lastKnownStateRevisionRef.current = Math.max(lastKnownStateRevisionRef.current, rev);
        }
        const dataVersion = readStateDataVersionHeader(r);
        if (dataVersion != null) {
          stateDataVersionRef.current = dataVersion;
        }
        if (r.headers.get('X-State-Merged-Conflict') === '1') {
          scheduleRemoteStateReloadRef.current();
        }
        setPersistStatus({ lastOkAt: Date.now(), lastError: undefined });
      }).catch((err) => {
        console.warn('Failed to persist state; backend disabled.', err);
        setBackendAvailable(false);
        setPersistStatus(s0 => ({ ...s0, lastError: String((err as any)?.message || err || 'persist failed') }));
        // Auto-retry after a short delay to avoid permanent "stuck" offline mode.
        window.setTimeout(() => setBackendAvailable(true), 3000);
      }).finally(() => {
        persistInFlightRef.current = Math.max(0, persistInFlightRef.current - 1);
        persistPendingRef.current = false;
      });
    }, delayMs);

    return () => window.clearTimeout(t);
  }, [
    hydrated,
    backendAvailable,
    financialYear,
    financialYears,
    activeYearKey,
    yearDataByKey,
    accountingPeriods,
    devices,
    invoices,
    inventory,
    journalEntries,
    transactions,
    fundTransactions,
    assets,
    accountingVouchers,
    documentNumberCounters,
    accounts,
    customers,
    suppliers,
    employees,
    warehouses,
    expenseCategories,
    taxRates,
    paymentMethods,
    bankAccounts,
    citExpenseMeta,
    citLossRecords,
    systemConfig,
    companyInfo,
    warehouseFormHints,
    partnerNameHistory,
    catalogBackupSnapshot,
    inventoryCatalog,
    bomDefinitions,
    hotelPmsState,
    deletedEntityTombstones,
    entityDeletionAuditLog,
    persistNonce,
  ]);

  useEffect(() => {
    if (!hydrated || !backendAvailable || !openingPersistReady) return;
    const token = getToken();
    if (!token) return;
    const activeOpeningYearData: YearData = {
      ...(yearDataByKey[activeYearKey] || buildEmptyYearData([])),
      openingBalanceAccounts,
      openingBalanceDebts,
      openingBalanceRolloverMeta,
    };
    const { openingBalancesPayload, debtDetailsPayload } = buildOpeningApiPayloadsFromYearDataMap(
      yearDataByKey,
      activeYearKey,
      activeOpeningYearData,
    );
    const payloadSignature = JSON.stringify({
      openingBalancesPayload,
      debtDetailsPayload,
    });

    if (lastOpeningPersistSignatureRef.current === payloadSignature) return;

    // Hoãn (không bỏ qua) khi vừa nhận dữ liệu remote — signature ở trên đã chặn echo.
    const suppressRemainingMs = suppressPersistUntilRef.current - Date.now();
    const delayMs = Math.max(STATE_PERSIST_DEBOUNCE_MS, suppressRemainingMs + 50);

    const t = window.setTimeout(() => {
      persistOpeningDataToBackend(token, openingBalancesPayload, debtDetailsPayload)
        .then((ok) => {
          if (!ok) return;
          lastOpeningPersistSignatureRef.current = payloadSignature;
          setPersistStatus({ lastOkAt: Date.now(), lastError: undefined });
        })
        .catch((err) => {
          console.warn('Failed to persist opening data; backend disabled.', err);
          setBackendAvailable(false);
          setPersistStatus(s0 => ({ ...s0, lastError: String((err as any)?.message || err || 'persist opening failed') }));
          window.setTimeout(() => setBackendAvailable(true), 3000);
        });
    }, delayMs);

    return () => window.clearTimeout(t);
  }, [
    hydrated,
    backendAvailable,
    openingPersistReady,
    yearDataByKey,
    activeYearKey,
    openingBalanceAccounts,
    openingBalanceDebts,
    openingBalanceRolloverMeta,
    persistOpeningDataToBackend,
  ]);

  // Keep multi-year map synced with active year data (avoid clobbering during a year switch).
  useEffect(() => {
    if (isSwitchingYearRef.current) return;
    setYearDataByKey(prev => ({
      ...prev,
      [activeYearKey]: getCurrentYearSnapshot(),
    }));
  }, [
    activeYearKey,
    accountingPeriods,
    invoices,
    inventory,
    journalEntries,
    transactions,
    fundTransactions,
    accountingVouchers,
    documentNumberCounters,
    cashFlowOpening,
    openingBalanceAccounts,
    openingBalanceDebts,
    openingBalanceRolloverMeta,
    citExpenseMeta,
    citLossRecords,
  ]);

  useEffect(() => {
    if (!hydrated || isSwitchingYearRef.current) return;
    if (repairedInvoiceJournalYearKeyRef.current === activeYearKey) return;
    if (invoices.length === 0 || journalEntries.length === 0) return;

    const invoiceById = new Map(invoices.map((invoice) => [String(invoice.id || ''), invoice]));
    let changed = false;
    const nextEntries = journalEntries.map((entry) => {
      const entryId = String(entry.id || '');
      const match = entryId.match(/^JE-INV-(.+)$/);
      if (!match) return entry;

      const invoice = invoiceById.get(match[1]);
      if (!invoice) return entry;

      const currentDiff = getJournalDetailsImbalance(entry.details || []);
      if (Math.abs(currentDiff) < MONEY_EPSILON) return entry;

      const expectedDetails = buildInvoicePostingDetails(invoice);
      if (Math.abs(getJournalDetailsImbalance(expectedDetails)) >= MONEY_EPSILON) return entry;

      changed = true;
      return {
        ...entry,
        details: expectedDetails,
      };
    });

    repairedInvoiceJournalYearKeyRef.current = activeYearKey;
    if (changed) setJournalEntries(nextEntries);
  }, [activeYearKey, hydrated, invoices, journalEntries]);

  // RESET MODALS ON TAB CHANGE
  useEffect(() => {
    setModals({});
  }, [activeTab]);

  const isOpeningBalanceLockedNow = () => {
    const lock = systemConfig.openingBalanceLock || (systemConfig.isOpeningBalanceLocked ? 'HARD' : 'OPEN');
    return lock !== 'OPEN';
  };

  const getResolvedBranchCode = useCallback(
    () => normalizeBranchCode(companyInfo.branchCode, companyInfo.city),
    [companyInfo.branchCode, companyInfo.city],
  );

  const getExistingDocumentSequenceMax = useCallback((prefix: DocumentNumberPrefix, date?: string) => {
    const branchCode = getResolvedBranchCode();
    let maxSequence = 0;
    const inspect = (value?: string) => {
      const sequence = extractDocumentSequence(value, prefix, branchCode, date);
      if (sequence && sequence > maxSequence) maxSequence = sequence;
    };

    accountingVouchers.forEach((voucher) => inspect(voucher.voucherNumber));
    fundTransactions.forEach((transaction) => inspect(transaction.voucherNumber));
    transactions.forEach((transaction) => inspect(transaction.voucherNumber));

    return maxSequence;
  }, [accountingVouchers, fundTransactions, getResolvedBranchCode, transactions]);

  const previewDocumentNumber = useCallback((prefix: DocumentNumberPrefix, date?: string) => {
    const branchCode = getResolvedBranchCode();
    const counterKey = buildDocumentCounterKey(prefix, branchCode, date);
    const stored = Number(documentNumberCountersRef.current[counterKey] || 0);
    const existingMax = getExistingDocumentSequenceMax(prefix, date);
    const nextSequence = Math.max(stored, existingMax) + 1;
    return formatDocumentNumber(prefix, branchCode, date, nextSequence);
  }, [getExistingDocumentSequenceMax, getResolvedBranchCode]);

  const reserveDocumentNumber = useCallback((prefix: DocumentNumberPrefix, date?: string) => {
    const branchCode = getResolvedBranchCode();
    const counterKey = buildDocumentCounterKey(prefix, branchCode, date);
    const stored = Number(documentNumberCountersRef.current[counterKey] || 0);
    const existingMax = getExistingDocumentSequenceMax(prefix, date);
    const nextSequence = Math.max(stored, existingMax) + 1;

    documentNumberCountersRef.current = {
      ...documentNumberCountersRef.current,
      [counterKey]: nextSequence,
    };
    setDocumentNumberCounters((prev) => ({
      ...prev,
      [counterKey]: Math.max(Number(prev[counterKey] || 0), nextSequence),
    }));

    return formatDocumentNumber(prefix, branchCode, date, nextSequence);
  }, [getExistingDocumentSequenceMax, getResolvedBranchCode]);

  useEffect(() => {
    if (!hydrated) return;

    const branchCode = getResolvedBranchCode();
    const counterDraft: Record<string, number> = { ...documentNumberCountersRef.current };
    let counterChanged = false;

    const seedCounter = (prefix: DocumentNumberPrefix, date: string | undefined, voucherNumber?: string) => {
      const key = buildDocumentCounterKey(prefix, branchCode, date);
      const sequence = extractDocumentSequence(voucherNumber, prefix, branchCode, date);
      if (!sequence) return;
      if (sequence > Number(counterDraft[key] || 0)) {
        counterDraft[key] = sequence;
        counterChanged = true;
      }
    };

    accountingVouchers.forEach((voucher) => seedCounter(getVoucherDocumentPrefix(voucher.voucherType), voucher.date, voucher.voucherNumber));
    transactions.forEach((transaction) => seedCounter(getWarehouseDocumentPrefix(transaction.type), transaction.date, transaction.voucherNumber));
    fundTransactions.forEach((transaction) => seedCounter(getFundDocumentPrefix(transaction.type, transaction.method), transaction.date, transaction.voucherNumber));

    const assignNext = (prefix: DocumentNumberPrefix, date: string | undefined) => {
      const key = buildDocumentCounterKey(prefix, branchCode, date);
      const nextSequence = Number(counterDraft[key] || 0) + 1;
      counterDraft[key] = nextSequence;
      counterChanged = true;
      return formatDocumentNumber(prefix, branchCode, date, nextSequence);
    };

    const missingTransactions = transactions
      .filter((transaction) => !String(transaction.voucherNumber || '').trim())
      .slice()
      .sort((a, b) => `${a.date}|${a.id}`.localeCompare(`${b.date}|${b.id}`));
    const transactionNumbers = new Map<string, string>();
    missingTransactions.forEach((transaction) => {
      transactionNumbers.set(transaction.id, assignNext(getWarehouseDocumentPrefix(transaction.type), transaction.date));
    });

    const missingFunds = fundTransactions
      .filter((transaction) => !String(transaction.voucherNumber || '').trim())
      .slice()
      .sort((a, b) => `${a.date}|${a.id}`.localeCompare(`${b.date}|${b.id}`));
    const fundNumbers = new Map<string, string>();
    missingFunds.forEach((transaction) => {
      fundNumbers.set(transaction.id, assignNext(getFundDocumentPrefix(transaction.type, transaction.method), transaction.date));
    });

    if (transactionNumbers.size > 0) {
      setTransactions((prev) => prev.map((transaction) => (
        transactionNumbers.has(transaction.id)
          ? { ...transaction, voucherNumber: transactionNumbers.get(transaction.id) }
          : transaction
      )));
    }

    if (fundNumbers.size > 0) {
      setFundTransactions((prev) => prev.map((transaction) => (
        fundNumbers.has(transaction.id)
          ? { ...transaction, voucherNumber: fundNumbers.get(transaction.id) }
          : transaction
      )));
    }

    if (counterChanged) {
      documentNumberCountersRef.current = counterDraft;
      setDocumentNumberCounters((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(counterDraft);
        const sameSize = prevKeys.length === nextKeys.length;
        const sameValues = sameSize && nextKeys.every((key) => Number(prev[key] || 0) === Number(counterDraft[key] || 0));
        return sameValues ? prev : counterDraft;
      });
    }
  }, [activeYearKey, accountingVouchers, fundTransactions, getResolvedBranchCode, hydrated, transactions]);

  const assertEditableDate = (date: string, actionLabel: string) => {
    const profile = authProfileRef.current;
    if (profile?.role === 'super_admin') return true;
    if (profile?.permissions?.includes('delete_data') && actionLabel.includes('xóa')) return true;

    const p = getPeriodForDate(accountingPeriods, date);
    if (!p) return true;

    if (p.status === 'CLOSED') {
      const label = p.lockType === 'HARD' ? 'KHÓA CỨNG' : 'KHÓA MỀM';
      if (p.lockType !== 'HARD') {
        const ok = window.confirm(
          `Kỳ kế toán (${p.name}) đang ${label}.\n` +
          `Bạn muốn TẠM MỞ KHÓA kỳ này để ${actionLabel} không?\n\n` +
          `Lưu ý: Đây là hành động quản trị và có thể ảnh hưởng số liệu.`
        );
        if (!ok) return false;
        // Open this period (soft unlock) so user can proceed
        setAccountingPeriods(prev => prev.map(x => x.id === p.id ? { ...x, status: 'OPEN', lockType: undefined, lockedBy: undefined, lockedAt: undefined } : x));
        return true;
      }
      alert(`Không thể ${actionLabel}. Kỳ kế toán (${p.name}) đã ${label}.`);
      return false;
    }

    // Prevent editing in the past if any later period is locked (protect future)
    const laterClosed = accountingPeriods
      .filter(x => x.startDate > p.endDate && x.status === 'CLOSED')
      .slice()
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (laterClosed.length > 0) {
      const hard = laterClosed.filter(x => x.lockType === 'HARD');
      if (hard.length > 0) {
        alert(
          `Không thể ${actionLabel}. Đã có kỳ kế toán sau đang KHÓA CỨNG, không cho sửa quá khứ làm ảnh hưởng tương lai.\n` +
          `Các kỳ khóa cứng: ${hard.map(x => x.name).join(', ')}`
        );
        return false;
      }

      const ok = window.confirm(
        `Đã có kỳ kế toán sau đang KHÓA MỀM nên không cho ${actionLabel} (để bảo vệ tương lai).\n` +
        `Bạn muốn TẠM MỞ KHÓA các kỳ sau để tiếp tục không?\n\n` +
        `Các kỳ sẽ mở: ${laterClosed.map(x => x.name).join(', ')}`
      );
      if (!ok) return false;
      const ids = new Set(laterClosed.map(x => x.id));
      setAccountingPeriods(prev => prev.map(x => ids.has(x.id) ? { ...x, status: 'OPEN', lockType: undefined, lockedBy: undefined, lockedAt: undefined } : x));
      return true;
    }

    return true;
  };

  const assertOpeningEditable = (actionLabel: string) => {
    if (isOpeningBalanceLockedNow()) {
      const label = (systemConfig.openingBalanceLock || 'HARD') === 'HARD' ? 'KHÓA CỨNG' : 'KHÓA MỀM';
      alert(`Không thể ${actionLabel}. Số dư đầu kỳ đang ${label}.`);
      return false;
    }
    return true;
  };

  const handleAddDevice = (device: Partial<Device>) => {
    const newDevice = normalizeDeviceStatus({
      renewalHistory: [],
      ...device,
      id: Date.now().toString(),
    } as Device);
    setDevices(prev => [...prev, newDevice]);
  };

  const handleBulkAddDevices = (newDevices: Device[]) => {
    setDevices(prev => [...prev, ...(newDevices || []).map(device => normalizeDeviceStatus({
      ...device,
      renewalHistory: Array.isArray(device.renewalHistory) ? device.renewalHistory : [],
    }))]);
  };

  const handleUpdateDevice = (device: Partial<Device>) => {
    setDevices(prev => prev.map(d => {
      if (d.id !== device.id) return d;
      const merged = { ...d, ...device } as Device;
      merged.status = resolveDeviceStatusFromExpiry(merged.expiryDate);
      return merged;
    }));
  };

  const handleDeleteDevice = async (id: string) => {
    const device = devices.find((d) => d.id === id);
    persistEpochRef.current += 1;
    recordEntityDeletion('devices', id, device?.name || id, device, 'soft_delete_device', 'devices');
    purgeJournalEntriesAcrossYears('device', id, device ? (device as unknown as Record<string, unknown>) : null);
    setDevices((prev) => prev.filter((d) => d.id !== id));
    const lc = await callLifecycleSoftDelete('devices', id);
    if (!lc.ok) {
      scheduleRemoteStateReloadRef.current();
      window.alert(`Không thể đưa vào thùng rác: ${lc.error}`);
      return;
    }
    notifySoftDeleted(device?.name || id);
  };

  const handleRenewConfirm = (
    fee: number, 
    vatRate: number, 
    newExpiry: Date, 
    durationMonths: number, 
    paymentMethod: string, 
    paymentStatus: 'PAID' | 'DEBT',
    inputCostInfo?: {
      supplier: string,
      invoiceNo: string,
      costPrice: number,
      vatRate: number,
      paymentMethod: string,
      description?: string,
      unit?: string,
      bankAccountId?: string
    },
    salesInfo?: {
      description?: string,
      unit?: string,
      bankAccountId?: string
    }
  ) => {
    const device = modals.renewDevice as Device;
    if (!device) return;

    const renewDate = new Date().toISOString();
    const renewDateOnly = renewDate.split('T')[0];
    const oldExpiryStr = device.expiryDate;
    const newExpiryStr = newExpiry.toISOString().split('T')[0];
    const internalInvId = `INV-REN-${Date.now()}`;
    const vatAmount = computeVatAmount(fee, vatRate);
    const totalAmount = fee + vatAmount;
    const salesInvoiceNumber = `HĐ-${internalInvId.slice(-6)}`;
    const costVatAmount = inputCostInfo ? computeVatAmount(inputCostInfo.costPrice, inputCostInfo.vatRate) : 0;
    const costTotal = inputCostInfo ? inputCostInfo.costPrice + costVatAmount : 0;
    const purchaseInvoiceNumber = inputCostInfo
      ? (inputCostInfo.invoiceNo || `PN-REN-${Date.now().toString().slice(-6)}`)
      : undefined;
    const salesBankSelection =
      paymentStatus === 'PAID' && paymentMethod === 'BANK'
        ? resolveBankSelection({ bankAccountId: salesInfo?.bankAccountId }, { requireActive: true })
        : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
    if (salesBankSelection.error) {
      window.alert(salesBankSelection.error);
      return;
    }
    if (paymentStatus === 'PAID' && paymentMethod === 'BANK' && !salesBankSelection.bankAccount) {
      window.alert('Vui lòng chọn tài khoản ngân hàng cho phần thu tiền gia hạn.');
      return;
    }
    const inputCostBankSelection =
      inputCostInfo?.paymentMethod === 'BANK'
        ? resolveBankSelection({ bankAccountId: inputCostInfo.bankAccountId }, { requireActive: true })
        : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
    if (inputCostBankSelection.error) {
      window.alert(inputCostBankSelection.error);
      return;
    }
    if (inputCostInfo?.paymentMethod === 'BANK' && !inputCostBankSelection.bankAccount) {
      window.alert('Vui lòng chọn tài khoản ngân hàng cho phần thanh toán NCC.');
      return;
    }
    const renewalHistoryItem: DeviceRenewalHistoryItem = {
      id: `REN-${Date.now()}`,
      renewedAt: renewDate,
      oldExpiryDate: oldExpiryStr,
      newExpiryDate: newExpiryStr,
      durationMonths,
      fee,
      vatRate,
      vatAmount,
      totalAmount,
      paymentStatus,
      paymentMethod,
      salesDescription: salesInfo?.description || `Gia hạn ${device.name} - ${durationMonths} tháng`,
      salesUnit: salesInfo?.unit || 'Lần',
      salesInvoiceNumber,
      purchaseInvoiceNumber,
      inputCostSupplier: inputCostInfo?.supplier,
      inputCostPrice: inputCostInfo?.costPrice,
      inputCostVatRate: inputCostInfo?.vatRate,
      inputCostVatAmount: inputCostInfo ? costVatAmount : undefined,
      inputCostTotal: inputCostInfo ? costTotal : undefined,
      inputCostPaymentMethod: inputCostInfo?.paymentMethod,
      inputCostDescription: inputCostInfo?.description,
    };

    handleUpdateDevice({
      id: device.id,
      expiryDate: newExpiryStr,
      renewalHistory: [...(device.renewalHistory || []), renewalHistoryItem],
    });

    const salesInvoice: any = {
      id: internalInvId,
      invoiceNumber: salesInvoiceNumber,
      date: renewDateOnly,
      customerName: device.customerName,
      buyerUnitName: device.customerName,
      description: renewalHistoryItem.salesDescription,
      amount: fee,
      vatRate,
      vatAmount,
      totalAmount,
      type: 'SALES',
      category: 'SERVICE',
      status: paymentStatus === 'PAID' ? 'PAID' : 'PENDING',
      paymentMethod: paymentStatus === 'PAID' ? (paymentMethod === 'BANK' ? 'Chuyển khoản' : 'Tiền mặt') : 'Công nợ',
      ...(paymentStatus === 'PAID' && paymentMethod === 'BANK'
        ? salesBankSelection.snapshot
        : clearBankAccountSnapshot()),
      details: [{ 
        id: '1', productName: `Gia hạn dịch vụ GPS/Camera: ${device.imei}`, type: 'SERVICE', unit: (salesInfo?.unit || 'Lần'), quantity: 1, price: fee, amount: fee, vatRate, vatAmount, account: '5113'
      }]
    };
    handleCreateInvoice(salesInvoice);

    if (inputCostInfo) {
      const purchaseInvoice: any = {
        id: `INV-PUR-REN-${Date.now()}`,
        invoiceNumber: purchaseInvoiceNumber,
        date: renewDateOnly,
        customerName: inputCostInfo.supplier,
        description: inputCostInfo.description || `Giá vốn gia hạn thiết bị ${device.imei}`,
        amount: inputCostInfo.costPrice,
        vatRate: inputCostInfo.vatRate,
        vatAmount: costVatAmount,
        totalAmount: costTotal,
        type: 'PURCHASE',
        category: 'SERVICE',
        status: inputCostInfo.paymentMethod === 'DEBT' ? 'PENDING' : 'PAID',
        paymentMethod: inputCostInfo.paymentMethod === 'DEBT' ? 'Ghi nợ' : (inputCostInfo.paymentMethod === 'BANK' ? 'Chuyển khoản' : 'Tiền mặt'),
        ...(inputCostInfo.paymentMethod === 'BANK'
          ? inputCostBankSelection.snapshot
          : clearBankAccountSnapshot()),
        details: [{
          // Fix: Corrected variable names to inputCostInfo properties
          // Renewal service: post COGS (632) immediately (real-time layer).
          id: '1', productName: `Phí cổng/Sim NCC: ${device.imei}`, type: 'SERVICE', unit: (inputCostInfo.unit || 'Lần'), quantity: 1, price: inputCostInfo.costPrice, amount: inputCostInfo.costPrice, vatRate: inputCostInfo.vatRate, vatAmount: costVatAmount, account: '632'
        }]
      };
      handleCreateInvoice(purchaseInvoice);
    }
  };

  const getDeferredRevenueLockReason = (invoice?: Partial<Invoice> | null) => {
    if (!invoice || !isDeferredRevenueInvoice(invoice)) return '';
    const hasPostedAllocations = hasDeferredRevenueAllocationsPosted(invoice as Invoice, getAllJournalEntriesAcrossYearsInternal());
    if (!hasPostedAllocations) return '';
    return (
      `Hóa đơn ${invoice.invoiceNumber || invoice.id || ''} đã có kỳ phân bổ doanh thu chưa thực hiện (3387) được ghi sổ.\n` +
      'Để tránh lệch sổ sách, hệ thống khóa sửa/xóa hóa đơn gốc sau khi đã phát sinh phân bổ.'
    );
  };

  const handleReceiveInvoicePayment = (
    invoiceId: string,
    paymentDateInput: string,
    paymentMethodInput: string,
    bankSnapshot?: Partial<BankAccountSnapshot>,
  ) => {
    const invoice = invoices.find((item) => String(item.id) === String(invoiceId));
    if (!invoice) {
      window.alert('Không tìm thấy hóa đơn để thu tiền.');
      return false;
    }
    if (invoice.type !== 'SALES') {
      window.alert('Luồng thu tiền riêng chỉ áp dụng cho hóa đơn bán hàng.');
      return false;
    }

    const linkedVoucherId = `VOU-INV-${invoice.id}`;
    const linkedJeId = `JE-VOU-${linkedVoucherId}`;
    if (invoice.status === 'PAID') {
      const hasV = accountingVouchers.some((v) => v.id === linkedVoucherId);
      const hasJe = journalEntries.some((je) => je.id === linkedJeId);
      if (hasV && hasJe) {
        window.alert('Hóa đơn đã được ghi nhận thanh toán đầy đủ (chứng từ & Sổ nhật ký chung).');
        return false;
      }
    }

    const paymentDate = String(paymentDateInput || new Date().toISOString().split('T')[0]).split('T')[0];
    if (!assertEditableDate(paymentDate, 'thu tiền hóa đơn')) return false;

    const fundMethod = resolveFundMethodFromPaymentMethod(
      paymentMethodInput,
      bankSnapshot?.bankLedgerAccountCode,
    );
    if (!fundMethod) {
      window.alert('Không thể ghi nhận thu tiền cho phương thức đã chọn.');
      return false;
    }

    // Cùng id với handleUpdateInvoice / HĐ PAID tạo mới (VOU-INV-*), không dùng VOU-INV-PAY-* để tránh lệch Sổ quỹ & NKChung so với nút Sửa.
    const voucherId = linkedVoucherId;
    const fundId = `FT-INV-${invoice.id}`;
    const existingLinkedVoucher = accountingVouchers.find(v => v.id === voucherId);
    const existingLinkedFund = fundTransactions.find(ft => ft.id === fundId);
    const sharedPaymentVoucherNumber = existingLinkedVoucher?.voucherNumber
      || existingLinkedFund?.voucherNumber
      || reserveDocumentNumber(getFundDocumentPrefix('RECEIPT', fundMethod), paymentDate);
    const isDeferred = isDeferredRevenueInvoice(invoice);
    const methodForSave = coercePaidInvoicePaymentMethodFromDebtLabels({
      ...invoice,
      status: 'PAID',
      paymentMethod: paymentMethodInput,
    }).paymentMethod;
    const bankSelection = fundMethod === 'BANK'
      ? resolveBankSelection({ ...invoice, ...bankSnapshot }, { requireActive: !!(bankSnapshot?.bankAccountId || invoice.bankAccountId) })
      : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
    if (bankSelection.error) {
      window.alert(bankSelection.error);
      return false;
    }
    const paymentBankSnapshot = fundMethod === 'BANK' ? bankSelection.snapshot : clearBankAccountSnapshot();
    const moneyAcc = resolveCashBankAccountFromPaymentMethod(
      methodForSave || paymentMethodInput,
      paymentBankSnapshot.bankLedgerAccountCode,
    );
    const voucherType: any = fundMethod === 'BANK' ? 'BANK_CREDIT' : 'RECEIPT';
    const invoiceRef = String(invoice.invoiceNumber || invoice.id || '').trim();
    const amount = Number(invoice.totalAmount || 0);
    const description = isDeferred
      ? `Thu tiền riêng HĐ 3387 ${invoiceRef}`
      : `Thu tiền hóa đơn ${invoiceRef}`;

    setInvoices(prev => prev.map((item) => item.id === invoice.id ? {
      ...item,
      status: 'PAID',
      paymentMethod: methodForSave,
      paymentPostingMode: item.paymentPostingMode || 'RECEIVABLE',
      paymentDate,
      paymentVoucherNumber: sharedPaymentVoucherNumber,
        ...paymentBankSnapshot,
    } : item));

    setFundTransactions(prev => {
      const nextRow: FundTransaction = {
        id: fundId,
        voucherNumber: sharedPaymentVoucherNumber,
        date: paymentDate,
        type: 'RECEIPT',
        method: fundMethod,
        amount,
        payerReceiver: invoice.customerName,
        description,
        category: isDeferred ? 'Thu tiền hóa đơn 3387' : 'Doanh thu bán hàng',
        status: 'COMPLETED',
        referenceDoc: invoiceRef,
        accountingType: '131',
        ...paymentBankSnapshot,
      };
      const filtered = prev.filter(ft => ft.id !== fundId);
      return [...filtered, nextRow];
    });

    const savePay = handleSaveVoucher(
      {
        id: voucherId,
        voucherType,
        voucherNumber: sharedPaymentVoucherNumber,
        date: paymentDate,
        postingDate: paymentDate,
        description,
        contactName: invoice.customerName,
        totalAmount: amount,
        status: 'POSTED',
        ...paymentBankSnapshot,
        details: [{
          id: '1',
          description,
          debitAccount: moneyAcc,
          creditAccount: '131',
          amount,
          objectType: 'CUSTOMER',
          objectId: invoice.id,
          objectName: invoice.customerName,
        }],
      } as AccountingVoucher,
      { skipEditableDateCheck: true }
    );
    if (!savePay.ok) return false;

    return true;
  };

  const handlePayPurchaseInvoice = (
    invoiceId: string,
    paymentDateInput: string,
    paymentMethodInput: string,
    bankSnapshot?: Partial<BankAccountSnapshot>,
  ) => {
    const invoice = invoices.find((item) => String(item.id) === String(invoiceId));
    if (!invoice) {
      window.alert('Không tìm thấy hóa đơn để thanh toán.');
      return false;
    }
    if (invoice.type !== 'PURCHASE') {
      window.alert('Luồng thanh toán này chỉ áp dụng cho hóa đơn mua vào.');
      return false;
    }

    const voucherId = `VOU-INV-${invoice.id}`;
    const jeId = `JE-VOU-${voucherId}`;
    const existingVoucher = accountingVouchers.find((v) => v.id === voucherId);
    const existingJe = journalEntries.find((je) => je.id === jeId);

    if (existingVoucher && existingJe) {
      if (invoice.status === 'PENDING') {
        const paymentDate = String(paymentDateInput || new Date().toISOString().split('T')[0]).split('T')[0];
        if (!assertEditableDate(paymentDate, 'thanh toán hóa đơn mua vào')) return false;
        const vn = existingVoucher.voucherNumber || '';
        const bankSelection = resolveFundMethodFromPaymentMethod(paymentMethodInput, bankSnapshot?.bankLedgerAccountCode) === 'BANK'
          ? resolveBankSelection({ ...invoice, ...bankSnapshot }, { requireActive: !!(bankSnapshot?.bankAccountId || invoice.bankAccountId) })
          : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
        if (bankSelection.error) {
          window.alert(bankSelection.error);
          return false;
        }
        setInvoices((prev) =>
          prev.map((item) =>
            item.id === invoice.id
              ? {
                  ...item,
                  status: 'PAID',
                  paymentMethod: paymentMethodInput,
                  paymentDate,
                  paymentVoucherNumber: vn || item.paymentVoucherNumber,
                  ...(resolveFundMethodFromPaymentMethod(paymentMethodInput, bankSnapshot?.bankLedgerAccountCode) === 'BANK'
                    ? bankSelection.snapshot
                    : clearBankAccountSnapshot()),
                }
              : item,
          ),
        );
      }
      return true;
    }

    if (existingVoucher && !existingJe) {
      if (!handleSaveVoucher({ ...existingVoucher, status: 'POSTED' }, { skipEditableDateCheck: true }).ok) return false;
      if (invoice.status === 'PENDING') {
        const paymentDate = String(paymentDateInput || new Date().toISOString().split('T')[0]).split('T')[0];
        if (!assertEditableDate(paymentDate, 'thanh toán hóa đơn mua vào')) return false;
        const vn = existingVoucher.voucherNumber || '';
        const bankSelection = resolveFundMethodFromPaymentMethod(paymentMethodInput, bankSnapshot?.bankLedgerAccountCode) === 'BANK'
          ? resolveBankSelection({ ...invoice, ...bankSnapshot }, { requireActive: !!(bankSnapshot?.bankAccountId || invoice.bankAccountId) })
          : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
        if (bankSelection.error) {
          window.alert(bankSelection.error);
          return false;
        }
        setInvoices((prev) =>
          prev.map((item) =>
            item.id === invoice.id
              ? {
                  ...item,
                  status: 'PAID',
                  paymentMethod: paymentMethodInput,
                  paymentDate,
                  paymentVoucherNumber: vn || item.paymentVoucherNumber,
                  ...(resolveFundMethodFromPaymentMethod(paymentMethodInput, bankSnapshot?.bankLedgerAccountCode) === 'BANK'
                    ? bankSelection.snapshot
                    : clearBankAccountSnapshot()),
                }
              : item,
          ),
        );
      }
      return true;
    }

    const isRepairPaid = invoice.status === 'PAID';
    if (invoice.status !== 'PENDING' && !isRepairPaid) {
      window.alert('Chỉ hóa đơn chưa thanh toán hoặc HĐ mua đã thanh toán cần đồng bộ chứng từ mới dùng được thao tác này.');
      return false;
    }

    const paymentDate = String(
      paymentDateInput ||
        invoice.paymentDate ||
        invoice.date ||
        new Date().toISOString().split('T')[0],
    ).split('T')[0];
    if (!assertEditableDate(paymentDate, isRepairPaid ? 'đồng bộ chứng từ thanh toán' : 'thanh toán hóa đơn mua vào')) {
      return false;
    }

    const methodForFund = coercePaidInvoicePaymentMethodFromDebtLabels({
      ...invoice,
      status: 'PAID',
      paymentMethod: paymentMethodInput || invoice.paymentMethod || 'Tiền mặt',
    }).paymentMethod;
    const fundMethod = resolveFundMethodFromPaymentMethod(
      methodForFund,
      bankSnapshot?.bankLedgerAccountCode || invoice.bankLedgerAccountCode,
    );
    if (!fundMethod) {
      window.alert('Không thể ghi nhận thanh toán cho phương thức đã chọn.');
      return false;
    }

    const fundId = `FT-INV-${invoice.id}`;
    const existingLinkedFund = fundTransactions.find((ft) => ft.id === fundId);
    const sharedPaymentVoucherNumber =
      existingVoucher?.voucherNumber ||
      existingLinkedFund?.voucherNumber ||
      reserveDocumentNumber(getFundDocumentPrefix('PAYMENT', fundMethod), paymentDate);
    const bankSelection = fundMethod === 'BANK'
      ? resolveBankSelection({ ...invoice, ...bankSnapshot }, { requireActive: !!(bankSnapshot?.bankAccountId || invoice.bankAccountId) })
      : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
    if (bankSelection.error) {
      window.alert(bankSelection.error);
      return false;
    }
    const paymentBankSnapshot = fundMethod === 'BANK' ? bankSelection.snapshot : clearBankAccountSnapshot();
    const moneyAcc = resolveCashBankAccountFromPaymentMethod(
      methodForFund,
      paymentBankSnapshot.bankLedgerAccountCode,
    );
    const voucherType: any = fundMethod === 'BANK' ? 'PAYMENT_ORDER' : 'PAYMENT';
    const invoiceRef = String(invoice.invoiceNumber || invoice.id || '').trim();
    const amount = Number(invoice.totalAmount || 0);
    const description = `Thanh toán hóa đơn mua vào ${invoiceRef}`;

    if (!isRepairPaid) {
      setInvoices((prev) =>
        prev.map((item) =>
          item.id === invoice.id
            ? {
                ...item,
                status: 'PAID',
                paymentMethod: methodForFund,
                paymentDate,
                paymentVoucherNumber: sharedPaymentVoucherNumber,
                ...paymentBankSnapshot,
              }
            : item,
        ),
      );
    } else {
      setInvoices((prev) =>
        prev.map((item) =>
          item.id === invoice.id
            ? {
                ...item,
                paymentMethod: methodForFund,
                paymentDate,
                paymentVoucherNumber: sharedPaymentVoucherNumber,
                ...paymentBankSnapshot,
              }
            : item,
        ),
      );
    }

    setFundTransactions((prev) => {
      const nextRow: FundTransaction = {
        id: fundId,
        voucherNumber: sharedPaymentVoucherNumber,
        date: paymentDate,
        type: 'PAYMENT',
        method: fundMethod,
        amount,
        payerReceiver: invoice.customerName,
        description,
        category: 'Chi mua hàng hóa',
        status: 'COMPLETED',
        referenceDoc: invoiceRef,
        ...paymentBankSnapshot,
      };
      const filtered = prev.filter((ft) => ft.id !== fundId);
      return [...filtered, nextRow];
    });

    const savePur = handleSaveVoucher(
      {
        id: voucherId,
        voucherType,
        voucherNumber: sharedPaymentVoucherNumber,
        date: paymentDate,
        postingDate: paymentDate,
        description,
        contactName: invoice.customerName,
        totalAmount: amount,
        status: 'POSTED',
        ...paymentBankSnapshot,
        details: [
          {
            id: '1',
            description,
            debitAccount: '331',
            creditAccount: moneyAcc,
            amount,
            objectType: 'SUPPLIER',
            objectId: invoice.id,
            objectName: invoice.customerName,
          },
        ],
      } as AccountingVoucher,
      { skipEditableDateCheck: true },
    );
    if (!savePur.ok) return false;

    return true;
  };

  const handleCreateInvoice = (data: any) => {
    const postingDate = (data?.date || new Date().toISOString().split('T')[0]).split('T')[0];
    const crossAnalysis = analyzeCrossPeriodInvoice(postingDate, financialYear, accountingPeriods);
    const fullCrossPeriod = isFullCrossPeriodPosting(crossAnalysis);
    const sameFyLateTaxOnly = isSameFyLateTaxFilingOnly(crossAnalysis);
    const lockCheckDate = fullCrossPeriod ? crossAnalysis.discoveryPostingDate : postingDate;
    if (!assertEditableDate(lockCheckDate, 'tạo hóa đơn')) return false;
    if (fullCrossPeriod && !(data as any).crossPeriodWorkflowAcknowledged) {
      window.alert(
        'Đây là hóa đơn khác niên độ / kỳ gốc khóa cứng (hạch toán tại kỳ phát hiện). ' +
          'Trên form, bật xác nhận «Ghi nhận theo chế độ HĐ khác niên độ» rồi lưu lại.',
      );
      return false;
    }
    if (sameFyLateTaxOnly && !(data as any).sameFyTaxSupplementAcknowledged) {
      window.alert(
        'Hóa đơn kê khai thuế chậm trong cùng niên độ (sổ theo ngày HĐ, thuế kê tại kỳ phát hiện). ' +
          'Tick xác nhận «Kê khai bổ sung cùng niên độ» trên form rồi lưu lại.',
      );
      return false;
    }

    // --- DUPLICATE PREVENTION for Hoá đơn & VAT (cùng mua/bán + thiết bị/dịch vụ) ---
    const invType = data?.type as 'SALES' | 'PURCHASE' | undefined;
    const invCategory = data?.category as 'DEVICE' | 'SERVICE' | undefined;
    const peers = invoices.filter(
      (i) =>
        (invType ? i.type === invType : true) &&
        (invCategory ? i.category === invCategory : true),
    );
    const dupCreate = findStrictDuplicateInvoice(
      {
        symbolCode: data?.symbolCode,
        invoiceNumber: data?.invoiceNumber,
        buyerTaxCode: data?.buyerTaxCode,
        date: postingDate,
      },
      peers,
    );
    if (dupCreate) {
      window.alert(
        `Không thể "Ghi sổ ngay": Trùng số hóa đơn, ký hiệu và mã số thuế đối tác.\n` +
          `Đã có: Số ${dupCreate.invoiceNumber || dupCreate.id} · Ký hiệu ${dupCreate.symbolCode || '—'} · MST ${dupCreate.buyerTaxCode || '—'}`,
      );
      return false;
    }
    const newId = String(data.id || '').trim() || createEntityId('INV');
    const deferredRevenueEnabled = data?.type === 'SALES' && !!data?.deferredRevenueEnabled;
    const serviceStartDate = String(data?.serviceStartDate || '').split('T')[0];
    const serviceEndDate = String(data?.serviceEndDate || '').split('T')[0];
    if (deferredRevenueEnabled) {
      if (!serviceStartDate || !serviceEndDate) {
        window.alert('Hóa đơn dùng TK 3387 bắt buộc phải khai báo thời gian thực hiện dịch vụ.');
        return false;
      }
      if (serviceEndDate < serviceStartDate) {
        window.alert('Kỳ thực hiện dịch vụ không hợp lệ: ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.');
        return false;
      }
    }
    if (deferredRevenueEnabled && fullCrossPeriod) {
      window.alert('Hóa đơn dùng TK 3387 không áp dụng chung với hóa đơn khác niên độ / kỳ khóa cứng. Tắt TK 3387 hoặc chỉnh ngày HĐ.');
      return false;
    }
    const initialPaidFundMethod = data?.status === 'PAID'
      ? resolveFundMethodFromPaymentMethod(data?.paymentMethod, data?.bankLedgerAccountCode)
      : null;
    const initialBankSelection = initialPaidFundMethod === 'BANK'
      ? resolveBankSelection(data, { requireActive: !!data?.bankAccountId })
      : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
    if (initialBankSelection.error) {
      window.alert(initialBankSelection.error);
      return false;
    }
    const directPaymentPostingMode = deferredRevenueEnabled
      && data?.status === 'PAID'
      && !!resolveFundMethodFromPaymentMethod(data?.paymentMethod, data?.bankLedgerAccountCode)
      ? 'DIRECT'
      : 'RECEIVABLE';

    const normalizedDetails: InvoiceDetail[] = (data.details || []).map((d: any) => {
      const qty = Number(d.quantity || 0);
      const price = Number(d.price || 0);
      const rawVat = Number(d.vatRate);
      const vatRate = Number.isFinite(rawVat) ? rawVat : 0;
      const amount = qty * price;
      const vatAmount = vatAmountUnrounded(amount, vatRate);
      return { ...d, quantity: qty, price, amount, vatRate, vatAmount };
    });
    let sumNet = normalizedDetails.reduce((s, d) => s + Number(d.amount || 0), 0);
    let sumVat = normalizedDetails.reduce((s, d) => s + Number(d.vatAmount || 0), 0);
    if (normalizedDetails.length === 0) {
      const net = Number(data.amount || 0);
      const rawVat = Number(data.vatRate);
      const vatRate = Number.isFinite(rawVat) ? rawVat : 0;
      sumNet = net;
      sumVat = vatAmountUnrounded(net, vatRate);
    }
    const { amount: hdrAmount, vatAmount: hdrVat, totalAmount: hdrTotal } = roundInvoiceTotalsFromSums(sumNet, sumVat);

    const priorMat = (String((data as any).priorPeriodMateriality || 'IMMATERIAL').toUpperCase() === 'MATERIAL'
      ? 'MATERIAL'
      : 'IMMATERIAL') as PriorPeriodMateriality;
    const useCrossPeriod = fullCrossPeriod && !!(data as any).crossPeriodWorkflowAcknowledged;
    const useSameFyLateTax = sameFyLateTaxOnly && !!(data as any).sameFyTaxSupplementAcknowledged;
    const accountingPostingDate = useCrossPeriod ? crossAnalysis.discoveryPostingDate : undefined;
    const vatFilingAnchorDate = useSameFyLateTax ? crossAnalysis.discoveryPostingDate : undefined;
    const crossPeriodMeta = useCrossPeriod
      ? buildCrossPeriodMeta(
          crossAnalysis,
          priorMat,
          hdrVat > 0,
          `Tạo HĐ; ngày HĐ ${postingDate}; hạch toán ${crossAnalysis.discoveryPostingDate}; ` +
            `${priorMat === 'MATERIAL' ? 'Trọng yếu → TK 421' : 'Không trọng yếu → DT/CP kỳ hiện tại'}`,
        )
      : undefined;
    const taxFilingMetaBuilt =
      useCrossPeriod || useSameFyLateTax
        ? buildInvoiceTaxFilingMeta({
            type: (invType || 'PURCHASE') as 'SALES' | 'PURCHASE',
            vatAmount: hdrVat,
            comparisonBaselineVat: 0,
            invoiceDocumentDate: postingDate,
            filingAnchorDate: crossAnalysis.discoveryPostingDate,
            originPeriod: crossAnalysis.originalPeriod,
            filingPeriod: crossAnalysis.discoveryPeriod,
            split: useSameFyLateTax ? 'SAME_FY_LATE_TAX' : 'CROSS_FY_OR_LOCKED',
            auditAction: 'GHI_NHAN',
            auditDetail:
              useSameFyLateTax
                ? `Cùng niên độ — sổ ngày HĐ ${postingDate}; thuế neo kỳ ${crossAnalysis.discoveryPostingDate}`
                : `Khác niên độ/khóa cứng — hạch toán ${crossAnalysis.discoveryPostingDate}`,
          })
        : undefined;
    const taxFilingMeta = taxFilingMetaBuilt
      ? { ...taxFilingMetaBuilt, filingAdjustmentPriorVat: 0 }
      : undefined;

    const newInvoice: Invoice = {
      ...data,
      id: newId,
      importedFromExcel: !!(data as any).importedFromExcel,
      deferredRevenueEnabled,
      deferredRevenueAccount: deferredRevenueEnabled ? '3387' : undefined,
      revenueRecognitionAccount: deferredRevenueEnabled ? getDeferredRevenueRecognitionAccount(data) : undefined,
      serviceStartDate: deferredRevenueEnabled ? serviceStartDate : undefined,
      serviceEndDate: deferredRevenueEnabled ? serviceEndDate : undefined,
      paymentPostingMode: deferredRevenueEnabled ? directPaymentPostingMode : undefined,
      details: normalizedDetails.length > 0 ? normalizedDetails : (data.details || []),
      amount: hdrAmount,
      vatAmount: hdrVat,
      totalAmount: hdrTotal,
      accountingPostingDate,
      vatFilingAnchorDate,
      crossPeriodMeta,
      taxFilingMeta,
      ...(initialPaidFundMethod === 'BANK' ? initialBankSelection.snapshot : clearBankAccountSnapshot()),
    };
    // Ensure invoice-level vatRate is present for VAT listing (fallback derived from line items)
    try {
      if (typeof (newInvoice as any).vatRate !== 'number') {
        const rates = Array.from(new Set((newInvoice.details || []).map((d: any) => Number(d.vatRate)).filter((n: number) => Number.isFinite(n))));
        (newInvoice as any).vatRate = (rates.length === 1 ? rates[0] : 0);
      }
    } catch {}
    if (useCrossPeriod && newInvoice.status === 'PAID') {
      (newInvoice as any).paymentDate = crossAnalysis.discoveryPostingDate;
    }
    let invoiceToSave = newInvoice;
    if (newInvoice.type === 'SALES' && systemConfig.accountingRegime?.standard === 'TT58_2026') {
      const applied = applyTt58IndustryToSalesInvoice(newInvoice, systemConfig.accountingRegime);
      const dets = applied.details || [];
      if (dets.length > 0) {
        const sumNet = dets.reduce((s, d) => s + Number(d.amount || 0), 0);
        const sumVat = dets.reduce((s, d) => s + Number(d.vatAmount || 0), 0);
        const rounded = roundInvoiceTotalsFromSums(sumNet, sumVat);
        invoiceToSave = { ...applied, ...rounded };
      } else {
        invoiceToSave = applied;
      }
    }
    setInvoices(prev => [...prev, invoiceToSave]);

    const isPurchase = invoiceToSave.type === 'PURCHASE';
    const isSales = invoiceToSave.type === 'SALES';
    const isDirectPaidDeferredInvoice = isSales && isDeferredRevenueInvoice(invoiceToSave) && invoiceToSave.paymentPostingMode === 'DIRECT';
    const jeDetails = buildInvoicePostingDetails(invoiceToSave);
    const ledgerDate = String(invoiceToSave.accountingPostingDate || invoiceToSave.date || '').split('T')[0];
    const jeDescriptionBase = `${isPurchase ? 'Mua hàng' : 'Bán hàng'} - HĐ số: ${invoiceToSave.invoiceNumber || newId}`;
    const jeDescription =
      useCrossPeriod
        ? `${jeDescriptionBase} [HĐ khác niên độ — kỳ gốc chứng từ ${postingDate}]`
        : useSameFyLateTax
          ? `${jeDescriptionBase} [Sổ kỳ phát sinh ${postingDate} — kê khai thuế kỳ ${crossAnalysis.discoveryPostingDate}]`
          : jeDescriptionBase;
    const paidFundMethod = invoiceToSave.status === 'PAID'
      ? resolveFundMethodFromPaymentMethod(invoiceToSave.paymentMethod, invoiceToSave.bankLedgerAccountCode)
      : null;
    const paidVoucherNumber = paidFundMethod
      ? reserveDocumentNumber(getFundDocumentPrefix(isPurchase ? 'PAYMENT' : 'RECEIPT', paidFundMethod), ledgerDate)
      : undefined;

    if (jeDetails.length > 0) {
      const baseJe: JournalEntry = {
        id: `JE-INV-${newId}`,
        date: ledgerDate,
        referenceId: invoiceToSave.invoiceNumber || newId,
        description: jeDescription,
        details: jeDetails,
      };
      const cogsBuild = buildInvoiceCogsJournalEntry(invoiceToSave, inventoryCatalogRef.current, ledgerDate);
      if (cogsBuild.issues.length > 0) {
        // Avoid blocking invoice creation; reconciliation at period-end will prevent locking if COGS can't be computed.
        window.alert(
          `Chưa sinh được giá vốn 632 cho hóa đơn ${invoiceToSave.invoiceNumber || newId}.\n` +
            `${cogsBuild.issues.slice(0, 5).join('\n')}` +
            `${cogsBuild.issues.length > 5 ? '\n...' : ''}`,
        );
      }
      setJournalEntries((prev) => [...prev, baseJe, ...(cogsBuild.journalEntry ? [cogsBuild.journalEntry] : [])]);
    }

    if (invoiceToSave.status === 'PAID') {
      if (paidFundMethod) {
      const fundTrx: FundTransaction = {
        id: `FT-INV-${newId}`,
        voucherNumber: paidVoucherNumber,
        date: ledgerDate,
        type: isPurchase ? 'PAYMENT' : 'RECEIPT',
          method: paidFundMethod,
        amount: invoiceToSave.totalAmount,
        payerReceiver: invoiceToSave.customerName,
        description: `${isPurchase ? 'Thanh toán' : 'Thu tiền'} hóa đơn ${invoiceToSave.invoiceNumber || newId}`,
        category: isPurchase ? 'Chi mua hàng hóa' : 'Doanh thu bán hàng',
        status: 'COMPLETED',
        referenceDoc: invoiceToSave.invoiceNumber || newId,
        ...(paidFundMethod === 'BANK'
          ? {
              bankAccountId: invoiceToSave.bankAccountId,
              bankName: invoiceToSave.bankName,
              bankAccountNumber: invoiceToSave.bankAccountNumber,
              bankAccountHolder: invoiceToSave.bankAccountHolder,
              bankBranch: invoiceToSave.bankBranch,
              bankLedgerAccountCode: invoiceToSave.bankLedgerAccountCode,
            }
          : clearBankAccountSnapshot()),
      };
      setFundTransactions(prev => [...prev, fundTrx]);
      }
    }

    // Auto-create linked voucher for payment account selection:
    // - 1121 -> Ủy nhiệm chi (purchase) / Báo có (sales)
    // - 1111 -> Phiếu chi (purchase) / Phiếu thu (sales)
    try {
      const pm = String(invoiceToSave.paymentMethod || '');
      const pmLower = pm.toLowerCase();
      const hasCashBank =
        pmLower.includes('chuyển khoản') ||
        pmLower.includes('chuyen khoan') ||
        pmLower.includes('tiền mặt') ||
        pmLower.includes('tien mat');
      if (!isDirectPaidDeferredInvoice && invoiceToSave.status === 'PAID' && hasCashBank) {
        const isBank = paidFundMethod === 'BANK';
        const vId = `VOU-INV-${newId}`;
        const date = ledgerDate;
        const voucherType: any = isPurchase
          ? (isBank ? 'PAYMENT_ORDER' : 'PAYMENT')
          : (isBank ? 'BANK_CREDIT' : 'RECEIPT');
        const moneyAcc = resolveCashBankAccountFromPaymentMethod(
          coercePaidInvoicePaymentMethodFromDebtLabels(invoiceToSave).paymentMethod || pm,
          invoiceToSave.bankLedgerAccountCode,
        );
        const contraAcc = isPurchase ? '331' : '131';
        const total = Number(invoiceToSave.totalAmount || 0);
        const detailDesc = `${isPurchase ? 'Thanh toán' : 'Thu tiền'} HĐ ${invoiceToSave.invoiceNumber || newId}`;
        const vou: AccountingVoucher = {
          id: vId,
          voucherType,
          voucherNumber: paidVoucherNumber || reserveDocumentNumber(getVoucherDocumentPrefix(voucherType), date),
          date,
          postingDate: date,
          description: detailDesc,
          contactName: invoiceToSave.customerName,
          totalAmount: total,
          status: 'POSTED',
          ...(isBank
            ? {
                bankAccountId: invoiceToSave.bankAccountId,
                bankName: invoiceToSave.bankName,
                bankAccountNumber: invoiceToSave.bankAccountNumber,
                bankAccountHolder: invoiceToSave.bankAccountHolder,
                bankBranch: invoiceToSave.bankBranch,
                bankLedgerAccountCode: invoiceToSave.bankLedgerAccountCode,
              }
            : clearBankAccountSnapshot()),
          details: [{
            id: '1',
            description: detailDesc,
            debitAccount: isPurchase ? contraAcc : moneyAcc,
            creditAccount: isPurchase ? moneyAcc : contraAcc,
            amount: total,
            objectType: isPurchase ? 'SUPPLIER' : 'CUSTOMER',
            objectId: newId,
            objectName: invoiceToSave.customerName
          }]
        };
        if (!handleSaveVoucher(vou).ok) return false;
      }
    } catch (err) {
      console.error('Không thể tạo chứng từ tự động cho hóa đơn', err);
      return false;
    }
    return true;
  };

  const handlePostHotelPmsCheckout = (payload: HotelPmsCheckoutPostingPayload): boolean => {
    const invoiceId = buildHotelPmsInvoiceId(payload.bookingId);
    const journalId = `JE-INV-${invoiceId}`;
    const voucherId = `VOU-INV-${invoiceId}`;
    const existingInvoice = invoices.find((inv) => String(inv.id) === invoiceId);
    const hasInvoiceJournal = journalEntries.some((je) => String(je.id) === journalId);

    if (existingInvoice && hasInvoiceJournal) {
      return true;
    }

    if (existingInvoice && !hasInvoiceJournal) {
      setInvoices((prev) => prev.filter((inv) => String(inv.id) !== invoiceId));
      setJournalEntries((prev) =>
        prev.filter(
          (je) =>
            String(je.id) !== journalId &&
            String(je.id) !== `JE-VOU-${voucherId}` &&
            !String(je.id).startsWith(`JE-PAY-INV-${invoiceId}-`),
        ),
      );
      setFundTransactions((prev) =>
        prev.filter(
          (ft) =>
            String(ft.id) !== `FT-INV-${invoiceId}` &&
            !String(ft.id).startsWith(`FT-PAY-INV-${invoiceId}-`),
        ),
      );
      setAccountingVouchers((prev) => prev.filter((v) => String(v.id) !== voucherId));
    }

    const checkoutDate = String(payload.checkoutDate || '').split('T')[0];
    if (!checkoutDate) {
      window.alert('Ngày thanh toán Hotel PMS không hợp lệ.');
      return false;
    }
    if (checkoutDate < financialYear.startDate || checkoutDate > financialYear.endDate) {
      window.alert(
        `Ngày trả phòng (${checkoutDate}) nằm ngoài niên độ đang mở (${financialYear.startDate} → ${financialYear.endDate}). ` +
          'Vui lòng chuyển niên độ tài chính hoặc chỉnh ngày trả phòng trước khi hạch toán.',
      );
      return false;
    }

    const isDebt = payload.paymentMethod === 'DEBT';
    const paymentLabel = isDebt
      ? 'Công nợ'
      : payload.paymentMethod === 'TRANSFER' || payload.paymentMethod === 'CARD'
        ? 'Chuyển khoản'
        : 'Tiền mặt';

    const details: InvoiceDetail[] = [];
    if (Number(payload.roomChargePreTax || 0) > 0) {
      details.push({
        id: 'room',
        productName: `Lưu trú phòng ${payload.roomNumber}`,
        type: 'SERVICE',
        unit: 'Lần',
        quantity: 1,
        price: Number(payload.roomChargePreTax || 0),
        amount: Number(payload.roomChargePreTax || 0),
        vatRate: Number(payload.roomVatRate || 0),
        vatAmount: Number(payload.roomVatAmount || 0),
        account: '5113',
        note: 'Dịch vụ lưu trú khách sạn — Hotel PMS',
        tt58IndustryId: 'personal_service',
      });
    }

    const inventoryIdSet = new Set(
      (payload.inventoryItemIds || []).map((id) => String(id || '')).filter(Boolean),
    );

    payload.services.forEach((service, index) => {
      const quantity = Number(service.quantity || 0);
      const price = Number(service.price || 0);
      const preTax = quantity * price;
      if (preTax <= 0) return;
      const vatRate = Number(service.vatRate || 0);
      const vatAmount = preTax * (vatRate / 100);
      const revenueAccount = resolveBookingServiceRevenueAccount(service, inventoryIdSet);
      const lineType = invoiceLineTypeForRevenueAccount(revenueAccount);
      details.push({
        id: `svc-${index}`,
        productName: service.name,
        type: lineType,
        unit: lineType === 'GOODS' ? 'Hàng hóa' : 'Dịch vụ',
        quantity,
        price,
        amount: preTax,
        vatRate,
        vatAmount,
        account: revenueAccount,
        inventoryItemId: lineType === 'GOODS' ? service.serviceId : undefined,
        note:
          revenueAccount === '5111'
            ? 'Minibar / hàng hóa — Hotel PMS'
            : 'Dịch vụ phòng — Hotel PMS',
        tt58IndustryId: 'personal_service',
      });
    });

    if (details.length === 0 && Number(payload.grandTotal || 0) > 0) {
      const vatTotal = Number(payload.roomVatAmount || 0) + Number(payload.servicesVatAmount || 0);
      const preTax = Math.max(0, Number(payload.grandTotal || 0) - vatTotal);
      details.push({
        id: 'summary',
        productName: `Doanh thu phòng ${payload.roomNumber} — Hotel PMS`,
        type: 'SERVICE',
        unit: 'Lần',
        quantity: 1,
        price: preTax,
        amount: preTax,
        vatRate: 0,
        vatAmount: vatTotal,
        account: '5113',
        note: 'Tổng hợp check-out — Hotel PMS',
        tt58IndustryId: 'personal_service',
      });
    }

    if (details.length === 0) {
      window.alert('Không có số tiền thanh toán để hạch toán.');
      return false;
    }

    const invoiceNumber = `HTL-${payload.roomNumber}-${String(payload.bookingId).slice(-6)}`;
    return handleCreateInvoice({
      id: invoiceId,
      invoiceNumber,
      symbolCode: 'HTL-PMS',
      formNo: 'HTL-PMS',
      date: checkoutDate,
      customerName: payload.customerName || 'Khách lẻ',
      buyerPhone: payload.customerPhone || '',
      buyerTaxCode: payload.customerIdentityCard || '',
      type: 'SALES',
      category: 'SERVICE',
      status: isDebt ? 'PENDING' : 'PAID',
      paymentMethod: paymentLabel,
      bankAccountId: payload.bankAccountId,
      bankLedgerAccountCode: payload.bankLedgerAccountCode,
      description: `Thanh toán phòng ${payload.roomNumber} — Hotel PMS [BK:${payload.bookingId}]`,
      tt58IndustryId: 'personal_service',
      details,
    });
  };

  const handlePostHotelPmsExpense = (payload: HotelPmsExpensePostingPayload): boolean => {
    const invoiceId = buildHotelPmsExpenseInvoiceId(payload.expenseId);
    if (invoices.some((inv) => String(inv.id) === invoiceId)) {
      return true;
    }

    const postingDate = String(payload.date || '').split('T')[0];
    if (!postingDate) {
      window.alert('Ngày chi phí Hotel PMS không hợp lệ.');
      return false;
    }

    const preTax = Number(payload.preTaxAmount || 0);
    const vatRate = Number(payload.vatRate || 0);
    const vatAmount = Number(payload.vatAmount || 0);
    const totalAmount = Number(payload.totalAmount || preTax + vatAmount);
    if (preTax <= 0 && totalAmount <= 0) {
      window.alert('Số tiền chi phí không hợp lệ.');
      return false;
    }

    const expenseAccount = resolveHotelPmsExpenseAccount(payload.category);
    const invoiceCategory = resolveHotelPmsExpenseInvoiceCategory(payload.category);
    const paymentLabel =
      payload.paymentMethod === 'TRANSFER' || payload.paymentMethod === 'CARD'
        ? 'Chuyển khoản'
        : 'Tiền mặt';
    const supplierName = String(payload.supplierName || 'Nhà cung cấp — Hotel PMS').trim();
    const invoiceNumber = payload.invoiceRef?.trim()
      || `HTL-EXP-${String(payload.expenseId).slice(-8)}`;

    const details: InvoiceDetail[] = [{
      id: '1',
      productName: payload.name,
      type: invoiceCategory === 'DEVICE' ? 'DEVICE' : 'SERVICE',
      unit: 'Lần',
      quantity: 1,
      price: preTax,
      amount: preTax,
      vatRate,
      vatAmount,
      account: expenseAccount,
      note: `Chi phí Hotel PMS — ${payload.category}${payload.notes ? ` — ${payload.notes}` : ''}`,
      tt58IndustryId: 'personal_service',
    }];

    const categoryLabel: Record<HotelPmsExpensePostingPayload['category'], string> = {
      IMPORT: 'Nhập kho',
      UTILITY: 'Điện nước / tiện ích',
      SALARY: 'Lương nhân viên',
      MAINTENANCE: 'Bảo trì',
      OTHER: 'Chi phí khác',
    };

    const posted = handleCreateInvoice({
      id: invoiceId,
      invoiceNumber,
      symbolCode: 'HTL-EXP',
      formNo: 'HTL-EXP',
      date: postingDate,
      customerName: supplierName,
      type: 'PURCHASE',
      category: invoiceCategory,
      status: 'PAID',
      paymentMethod: paymentLabel,
      description: `${categoryLabel[payload.category]}: ${payload.name} — Hotel PMS [EXP:${payload.expenseId}]`,
      tt58IndustryId: 'personal_service',
      details,
      amount: preTax,
      vatRate,
      vatAmount,
      totalAmount,
    });

    return posted;
  };

  const handleUpdateInvoice = (data: any) => {
    const postingDate = (data?.date || new Date().toISOString().split('T')[0]).split('T')[0];
    const oldInvoice = invoices.find((i) => String(i.id) === String(data?.id));
    if (!oldInvoice) return false;
    const futureRolloverTargets = Object.entries(getCombinedYearDataSnapshot()).filter(([yearKey, yearData]) => {
      if (yearKey === activeYearKey) return false;
      const meta = normalizeOpeningBalanceRolloverMeta((yearData as any).openingBalanceRolloverMeta);
      return meta?.sourceYearKey === activeYearKey;
    });
    if (futureRolloverTargets.length > 0) {
      const shouldRefresh = window.confirm(
        'Cảnh báo: Hóa đơn này đã được kết chuyển số dư sang kỳ kế tiếp. Bạn có muốn cập nhật lại số dư đầu kỳ năm nay không?',
      );
      if (shouldRefresh) {
        pendingRolloverRefreshSourceYearRef.current = activeYearKey;
      } else {
        markFutureRolloverSnapshotsStaleForSourceYear(activeYearKey);
      }
    }
    const crossAnalysis = analyzeCrossPeriodInvoice(postingDate, financialYear, accountingPeriods);
    const fullCrossPeriod = isFullCrossPeriodPosting(crossAnalysis);
    const sameFyLateTaxOnly = isSameFyLateTaxFilingOnly(crossAnalysis);
    const lockCheckDate = fullCrossPeriod ? crossAnalysis.discoveryPostingDate : postingDate;
    if (!assertEditableDate(lockCheckDate, 'cập nhật hóa đơn')) return false;
    const deferredLockReason = getDeferredRevenueLockReason(oldInvoice);
    if (deferredLockReason) {
      window.alert(deferredLockReason);
      return false;
    }

    // --- DUPLICATE PREVENTION (editing should not create duplicates, cùng loại HĐ) ---
    const peersUpdate = invoices.filter(
      (i) => i.type === oldInvoice.type && i.category === oldInvoice.category,
    );
    const dupUpdate = findStrictDuplicateInvoice(
      {
        symbolCode: data.symbolCode !== undefined ? data.symbolCode : oldInvoice.symbolCode,
        invoiceNumber: data.invoiceNumber !== undefined ? data.invoiceNumber : oldInvoice.invoiceNumber,
        buyerTaxCode: data.buyerTaxCode !== undefined ? data.buyerTaxCode : oldInvoice.buyerTaxCode,
        date: postingDate,
      },
      peersUpdate,
      oldInvoice.id,
    );
    if (dupUpdate) {
      window.alert(
        `Không thể cập nhật: Trùng số hóa đơn, ký hiệu và mã số thuế đối tác.\n` +
          `Đã có: Số ${dupUpdate.invoiceNumber || dupUpdate.id} · Ký hiệu ${dupUpdate.symbolCode || '—'} · MST ${dupUpdate.buyerTaxCode || '—'}`,
      );
      return false;
    }

    const needsCrossAck = fullCrossPeriod && !oldInvoice.crossPeriodMeta;
    if (needsCrossAck && !(data as any).crossPeriodWorkflowAcknowledged) {
      window.alert(
        'Hóa đơn khác niên độ / kỳ khóa cứng: bật xác nhận «Ghi nhận theo chế độ HĐ khác niên độ» trên form rồi lưu lại.',
      );
      return false;
    }
    const needsSameFyAck = sameFyLateTaxOnly && !oldInvoice.vatFilingAnchorDate;
    if (needsSameFyAck && !(data as any).sameFyTaxSupplementAcknowledged) {
      window.alert(
        'Hóa đơn kê khai thuế chậm (cùng niên độ): tick «Kê khai bổ sung cùng niên độ» trên form rồi lưu lại.',
      );
      return false;
    }

    // Normalize & re-calc totals: amount/vatAmount từ qty×price và thuế suất (không tin amount cũ từ payload).
    const normalizedDetails: InvoiceDetail[] = (data.details || oldInvoice.details || []).map((d: any) => {
      const qty = Number(d.quantity || 0);
      const price = Number(d.price || 0);
      const rawVat = Number(d.vatRate);
      const vatRate = Number.isFinite(rawVat) ? rawVat : 0;
      const amount = qty * price;
      const vatAmount = vatAmountUnrounded(amount, vatRate);
      return { ...d, quantity: qty, price, amount, vatRate, vatAmount };
    });
    const sumNet = normalizedDetails.reduce((s, d) => s + Number(d.amount || 0), 0);
    const sumVat = normalizedDetails.reduce((s, d) => s + Number(d.vatAmount || 0), 0);
    const { amount: nextAmount, vatAmount: nextVatAmount, totalAmount: nextTotal } = roundInvoiceTotalsFromSums(sumNet, sumVat);
    const deferredRevenueEnabled = (data?.deferredRevenueEnabled !== undefined ? !!data.deferredRevenueEnabled : !!oldInvoice.deferredRevenueEnabled)
      && (data?.type || oldInvoice.type) === 'SALES';
    const serviceStartDate = String((data?.serviceStartDate !== undefined ? data.serviceStartDate : oldInvoice.serviceStartDate) || '').split('T')[0];
    const serviceEndDate = String((data?.serviceEndDate !== undefined ? data.serviceEndDate : oldInvoice.serviceEndDate) || '').split('T')[0];
    if (deferredRevenueEnabled) {
      if (!serviceStartDate || !serviceEndDate) {
        window.alert('Hóa đơn dùng TK 3387 bắt buộc phải khai báo thời gian thực hiện dịch vụ.');
        return false;
      }
      if (serviceEndDate < serviceStartDate) {
        window.alert('Kỳ thực hiện dịch vụ không hợp lệ: ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.');
        return false;
      }
    }
    if (deferredRevenueEnabled && fullCrossPeriod) {
      window.alert('Hóa đơn dùng TK 3387 không áp dụng chung với hóa đơn khác niên độ / kỳ khóa cứng.');
      return false;
    }

    const priorMatUpdate = (
      (data as any).priorPeriodMateriality !== undefined
        ? String((data as any).priorPeriodMateriality).toUpperCase() === 'MATERIAL'
        : oldInvoice.crossPeriodMeta?.materiality === 'MATERIAL'
    )
      ? ('MATERIAL' as PriorPeriodMateriality)
      : ('IMMATERIAL' as PriorPeriodMateriality);

    let accountingPostingDate: string | undefined;
    let vatFilingAnchorDate: string | undefined;
    let crossPeriodMeta: Invoice['crossPeriodMeta'];
    let taxFilingMeta: Invoice['taxFilingMeta'];

    if (fullCrossPeriod) {
      const prevTrail = oldInvoice.crossPeriodMeta?.auditTrail || [];
      const built = buildCrossPeriodMeta(
        crossAnalysis,
        priorMatUpdate,
        nextVatAmount > 0,
        `Cập nhật HĐ; ngày HĐ ${postingDate}; hạch toán ${crossAnalysis.discoveryPostingDate}`,
      );
      accountingPostingDate = crossAnalysis.discoveryPostingDate;
      crossPeriodMeta = {
        ...built,
        auditTrail: [...prevTrail, ...(built.auditTrail || [])].slice(-50),
      };
      vatFilingAnchorDate = undefined;
      const prevTaxTrail = oldInvoice.taxFilingMeta?.auditTrail || [];
      const builtTax = buildInvoiceTaxFilingMeta({
        type: (data?.type || oldInvoice.type) as 'SALES' | 'PURCHASE',
        vatAmount: nextVatAmount,
        comparisonBaselineVat: resolveComparisonBaselineBeforeSave(oldInvoice),
        invoiceDocumentDate: postingDate,
        filingAnchorDate: crossAnalysis.discoveryPostingDate,
        originPeriod: crossAnalysis.originalPeriod,
        filingPeriod: crossAnalysis.discoveryPeriod,
        split: 'CROSS_FY_OR_LOCKED',
        auditAction: 'CAP_NHAT',
        auditDetail: `Cập nhật; hạch toán ${crossAnalysis.discoveryPostingDate}`,
      });
      taxFilingMeta = {
        ...builtTax,
        filingAdjustmentPriorVat: Math.round(oldInvoice.vatAmount || 0),
        auditTrail: [...prevTaxTrail, ...(builtTax.auditTrail || [])].slice(-50),
      };
    } else if (sameFyLateTaxOnly) {
      accountingPostingDate = undefined;
      crossPeriodMeta = undefined;
      vatFilingAnchorDate = crossAnalysis.discoveryPostingDate;
      const prevTaxTrail = oldInvoice.taxFilingMeta?.auditTrail || [];
      const builtTax = buildInvoiceTaxFilingMeta({
        type: (data?.type || oldInvoice.type) as 'SALES' | 'PURCHASE',
        vatAmount: nextVatAmount,
        comparisonBaselineVat: resolveComparisonBaselineBeforeSave(oldInvoice),
        invoiceDocumentDate: postingDate,
        filingAnchorDate: crossAnalysis.discoveryPostingDate,
        originPeriod: crossAnalysis.originalPeriod,
        filingPeriod: crossAnalysis.discoveryPeriod,
        split: 'SAME_FY_LATE_TAX',
        auditAction: 'CAP_NHAT',
        auditDetail: `Cùng niên độ — sổ ${postingDate}; thuế neo ${crossAnalysis.discoveryPostingDate}`,
      });
      taxFilingMeta = {
        ...builtTax,
        filingAdjustmentPriorVat: Math.round(oldInvoice.vatAmount || 0),
        auditTrail: [...prevTaxTrail, ...(builtTax.auditTrail || [])].slice(-50),
      };
    } else {
      accountingPostingDate = undefined;
      vatFilingAnchorDate = undefined;
      crossPeriodMeta = undefined;
      taxFilingMeta = undefined;
    }

    // Tổng tiền/thuế luôn lấy từ chi tiết đã chuẩn hóa — một nguồn sự thật cho NKChung, chứng từ, quỹ, bảng kê VAT.
    // Tránh lệch khi form gửi amount/vatAmount/totalAmount không khớp details (re-render, làm tròn).
    let nextInvoice: Invoice = {
      ...oldInvoice,
      ...data,
      // Ensure invoiceNumber isn't accidentally cleared (it is used as the linkage key across modules)
      invoiceNumber: (String(data.invoiceNumber || '').trim() || oldInvoice.invoiceNumber || data.id),
      symbolCode: (data.symbolCode !== undefined ? data.symbolCode : oldInvoice.symbolCode),
      date: (data.date || oldInvoice.date),
      details: normalizedDetails,
      amount: nextAmount,
      vatAmount: nextVatAmount,
      totalAmount: nextTotal,
      deferredRevenueEnabled,
      deferredRevenueAccount: deferredRevenueEnabled ? '3387' : undefined,
      revenueRecognitionAccount: deferredRevenueEnabled
        ? getDeferredRevenueRecognitionAccount({ ...oldInvoice, ...data, category: (data?.category || oldInvoice.category) })
        : undefined,
      serviceStartDate: deferredRevenueEnabled ? serviceStartDate : undefined,
      serviceEndDate: deferredRevenueEnabled ? serviceEndDate : undefined,
      paymentPostingMode: deferredRevenueEnabled
        ? (((data?.status || oldInvoice.status) === 'PENDING')
            ? 'RECEIVABLE'
            : (oldInvoice.paymentPostingMode || 'RECEIVABLE'))
        : undefined,
      accountingPostingDate,
      vatFilingAnchorDate,
      crossPeriodMeta,
      taxFilingMeta,
    };
    // Keep invoice-level vatRate in sync for VAT listing
    try {
      const rates = Array.from(new Set((nextInvoice.details || []).map((d: any) => Number(d.vatRate)).filter((n: number) => Number.isFinite(n))));
      (nextInvoice as any).vatRate = (rates.length === 1 ? rates[0] : 0);
    } catch {}

    nextInvoice = coercePaidInvoicePaymentMethodFromDebtLabels(nextInvoice);
    const nextPaymentFundMethod = nextInvoice.status === 'PAID'
      ? resolveFundMethodFromPaymentMethod(nextInvoice.paymentMethod, nextInvoice.bankLedgerAccountCode)
      : null;
    const nextBankSelection = nextPaymentFundMethod === 'BANK'
      ? resolveBankSelection(nextInvoice, { requireActive: !!((data as any)?.bankAccountId || oldInvoice.bankAccountId) })
      : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
    if (nextBankSelection.error) {
      window.alert(nextBankSelection.error);
      return false;
    }
    nextInvoice = {
      ...nextInvoice,
      ...(nextPaymentFundMethod === 'BANK' ? nextBankSelection.snapshot : clearBankAccountSnapshot()),
    };
    if ((data as any).importedFromExcel !== undefined) {
      (nextInvoice as any).importedFromExcel = !!(data as any).importedFromExcel;
    } else if (oldInvoice.importedFromExcel) {
      (nextInvoice as any).importedFromExcel = true;
    }

    if (nextInvoice.crossPeriodMeta && nextInvoice.status === 'PAID') {
      const ap = String(nextInvoice.accountingPostingDate || '').split('T')[0];
      if (ap) nextInvoice = { ...nextInvoice, paymentDate: ap };
    }

    if (nextInvoice.type === 'SALES' && systemConfig.accountingRegime?.standard === 'TT58_2026') {
      const applied = applyTt58IndustryToSalesInvoice(nextInvoice, systemConfig.accountingRegime);
      const dets = applied.details || [];
      if (dets.length > 0) {
        const sumNet = dets.reduce((s, d) => s + Number(d.amount || 0), 0);
        const sumVat = dets.reduce((s, d) => s + Number(d.vatAmount || 0), 0);
        const rounded = roundInvoiceTotalsFromSums(sumNet, sumVat);
        nextInvoice = { ...applied, ...rounded };
      } else {
        nextInvoice = applied;
      }
    }

    const invLedgerBase = String(nextInvoice.accountingPostingDate || nextInvoice.date || '').split('T')[0];

    // Chứng từ thanh toán dùng ngày chi tiền — kiểm tra kỳ khóa TRƯỚC khi ghi PAID (tránh HĐ PAID mà không có bút Nợ 331/Có 1111).
    const isDirectPaidDeferredEarly =
      nextInvoice.type === 'SALES' &&
      isDeferredRevenueInvoice(nextInvoice) &&
      nextInvoice.paymentPostingMode === 'DIRECT';
    const pmEarlyLower = String(nextInvoice.paymentMethod || '').toLowerCase();
    const cashPaidNeedsLockedDateCheck =
      !isDirectPaidDeferredEarly &&
      nextInvoice.status === 'PAID' &&
      (pmEarlyLower.includes('chuyển khoản') ||
        pmEarlyLower.includes('chuyen khoan') ||
        pmEarlyLower.includes('tiền mặt') ||
        pmEarlyLower.includes('tien mat'));
    const cashMovementDateEarly = (() => {
      if (nextInvoice.status !== 'PAID') return invLedgerBase;
      const pd = nextInvoice.paymentDate ? String(nextInvoice.paymentDate).split('T')[0] : '';
      return pd || invLedgerBase;
    })();
    if (cashPaidNeedsLockedDateCheck && !assertEditableDate(cashMovementDateEarly, 'ghi nhận thanh toán (chứng từ)')) {
      return false;
    }

    const oldRef = oldInvoice.invoiceNumber || oldInvoice.id;
    const newRef = nextInvoice.invoiceNumber || nextInvoice.id;

    const linkedVoucherId = `VOU-INV-${nextInvoice.id}`;
    const whFundId = getWarehouseFundTransactionId(nextInvoice.id);
    const existingLinkedFund =
      fundTransactions.find(ft => ft.id === `FT-INV-${nextInvoice.id}`) ||
      (whFundId ? fundTransactions.find(ft => ft.id === whFundId) : undefined);
    const existingLinkedVoucher = accountingVouchers.find(v => v.id === linkedVoucherId);
    const nextFundMethod = resolveFundMethodFromPaymentMethod(
      nextInvoice.paymentMethod,
      nextInvoice.bankLedgerAccountCode,
    );
    const isDirectPaidDeferredInvoice = nextInvoice.type === 'SALES'
      && isDeferredRevenueInvoice(nextInvoice)
      && nextInvoice.paymentPostingMode === 'DIRECT';
    const cashMovementDate = (() => {
      if (nextInvoice.status !== 'PAID') return invLedgerBase;
      const pd = nextInvoice.paymentDate ? String(nextInvoice.paymentDate).split('T')[0] : '';
      return pd || invLedgerBase;
    })();
    const sharedPaymentVoucherNumber = (nextInvoice.status === 'PAID' && nextFundMethod)
      ? (existingLinkedVoucher?.voucherNumber
        || existingLinkedFund?.voucherNumber
        || reserveDocumentNumber(getFundDocumentPrefix(nextInvoice.type === 'PURCHASE' ? 'PAYMENT' : 'RECEIPT', nextFundMethod), cashMovementDate))
      : (existingLinkedVoucher?.voucherNumber || existingLinkedFund?.voucherNumber);

    const pmLowerVoucher = String(
      coercePaidInvoicePaymentMethodFromDebtLabels(nextInvoice).paymentMethod || '',
    ).toLowerCase();
    const isPurchaseVoucher = nextInvoice.type === 'PURCHASE';
    const isWarehouseInvoice = isWarehouseStockInvoice(nextInvoice);
    const warehouseCashJeId = getWarehouseCashJournalEntryId(nextInvoice.id);
    const warehouseNeedsDebtSettlementVoucher = (() => {
      if (!isWarehouseInvoice || nextInvoice.status !== 'PAID' || !warehouseCashJeId) return false;
      const whJe = journalEntries.find((e) => String(e.id || '') === warehouseCashJeId);
      if (!whJe) return false;
      const debtPrefix = isPurchaseVoucher ? '331' : '131';
      return (whJe.details || []).some((d) => String(d.account || '').startsWith(debtPrefix));
    })();
    /**
     * HĐ kho: nếu đã ghi trực tiếp tiền (111/112) thì không tạo thêm chứng từ.
     * Riêng trường hợp từ công nợ 331/131 chuyển sang PAID thì bắt buộc sinh VOU-INV để triệt tiêu công nợ.
     */
    const shouldHaveVoucher =
      (!isWarehouseInvoice || warehouseNeedsDebtSettlementVoucher) &&
      !isDirectPaidDeferredInvoice &&
      nextInvoice.status === 'PAID' &&
      (pmLowerVoucher.includes('chuyển khoản') ||
        pmLowerVoucher.includes('chuyen khoan') ||
        pmLowerVoucher.includes('tiền mặt') ||
        pmLowerVoucher.includes('tien mat'));

    const primaryJeVouId = `JE-VOU-${linkedVoucherId}`;
    const journalHasPrimaryJeVou = journalEntries.some((je) => String(je.id || '') === primaryJeVouId);
    const oldPm = coercePaidInvoicePaymentMethodFromDebtLabels(oldInvoice).paymentMethod || '';
    const nextPm = coercePaidInvoicePaymentMethodFromDebtLabels(nextInvoice).paymentMethod || '';
    const samePaidCashSnapshot =
      oldInvoice.status === 'PAID' &&
      nextInvoice.status === 'PAID' &&
      resolveCashBankAccountFromPaymentMethod(oldPm, oldInvoice.bankLedgerAccountCode) ===
        resolveCashBankAccountFromPaymentMethod(nextPm, nextInvoice.bankLedgerAccountCode) &&
      Number(oldInvoice.totalAmount || 0) === Number(nextInvoice.totalAmount || 0) &&
      String(oldInvoice.paymentDate || oldInvoice.date || '').split('T')[0] ===
        String(nextInvoice.paymentDate || nextInvoice.date || '').split('T')[0];
    /** Đã có chứng từ/bút thu chi hợp lệ và không đổi tiền mặt–ngân hàng/tổng/ngày → không ghi đè số phiếu mới (tránh “thêm” lần ủy nhiệm chi khi sửa sau import). */
    const skipVoucherResync =
      shouldHaveVoucher &&
      samePaidCashSnapshot &&
      (existingLinkedVoucher || journalHasPrimaryJeVou);

    let finalPaymentVoucherForJournal: AccountingVoucher | undefined;
    if (!shouldHaveVoucher) {
      setAccountingVouchers(prev => prev.filter(v => v.id !== linkedVoucherId));
    } else if (!skipVoucherResync) {
      const isBank = nextFundMethod === 'BANK';
      const voucherType: any = isPurchaseVoucher
        ? (isBank ? 'PAYMENT_ORDER' : 'PAYMENT')
        : (isBank ? 'BANK_CREDIT' : 'RECEIPT');
      const moneyAcc = resolveCashBankAccountFromPaymentMethod(
        coercePaidInvoicePaymentMethodFromDebtLabels(nextInvoice).paymentMethod || '',
        nextInvoice.bankLedgerAccountCode,
      );
      const contraAcc = isPurchaseVoucher ? '331' : '131';
      const total = Number(nextInvoice.totalAmount || 0);
      const detailDesc = `${isPurchaseVoucher ? 'Thanh toán' : 'Thu tiền'} HĐ ${newRef}`;
      // Chỉ cập nhật danh sách chứng từ — bút JE-VOU gắn thu/chi HĐ ghi trong một lần setJournalEntries phía dưới (tránh chồng 1111/1121 khi batch React).
      const saveResult = handleSaveVoucher(
        {
          id: linkedVoucherId,
          voucherType,
          voucherNumber: existingLinkedVoucher?.voucherNumber || sharedPaymentVoucherNumber || reserveDocumentNumber(getVoucherDocumentPrefix(voucherType), cashMovementDate),
          date: cashMovementDate,
          postingDate: cashMovementDate,
          description: detailDesc,
          contactName: nextInvoice.customerName,
          totalAmount: total,
          status: 'POSTED',
          ...(isBank
            ? {
                bankAccountId: nextInvoice.bankAccountId,
                bankName: nextInvoice.bankName,
                bankAccountNumber: nextInvoice.bankAccountNumber,
                bankAccountHolder: nextInvoice.bankAccountHolder,
                bankBranch: nextInvoice.bankBranch,
                bankLedgerAccountCode: nextInvoice.bankLedgerAccountCode,
              }
            : clearBankAccountSnapshot()),
          details: [{
            id: '1',
            description: detailDesc,
            debitAccount: isPurchaseVoucher ? contraAcc : moneyAcc,
            creditAccount: isPurchaseVoucher ? moneyAcc : contraAcc,
            amount: total,
            objectType: isPurchaseVoucher ? 'SUPPLIER' : 'CUSTOMER',
            objectId: nextInvoice.id,
            objectName: nextInvoice.customerName
          }]
        } as AccountingVoucher,
        { skipEditableDateCheck: true, skipJournalEntry: true }
      );
      if (!saveResult.ok) return false;
      finalPaymentVoucherForJournal = saveResult.finalVoucher;
    }

    // Luôn cập nhật theo id — không dùng matchesInvoiceDeleteTarget (so khớp date/tổng tiền/tên NCC
    // dễ lệch sau chuẩn hóa chi tiết), khiến không thay được dòng HĐ nhưng vẫn chạy tiếp logic chứng từ → lệch sổ.
    setInvoices((prev) => {
      const idx = prev.findIndex((i) => i.id === nextInvoice.id);
      if (idx < 0) return prev;
      const out = [...prev];
      out[idx] = nextInvoice;
      return out;
    });

    // Sync related Warehouse History row (Kho & Vật tư -> Lịch sử) when invoice is edited.
    // Warehouse-generated invoices have id pattern:
    // - INV-PUR-TRX-<...>  (IMPORT)
    // - INV-SALES-TRX-<...> (EXPORT)
    try {
      const m = String(nextInvoice.id || '').match(/^INV-(PUR|SALES)-(TRX-\d+)/);
      const trxId = m?.[2] || '';
      if (trxId) {
        const targetType = nextInvoice.type === 'PURCHASE' ? 'IMPORT' : 'EXPORT';
        const mergeDateKeepingTime = (oldStr: string, newDateOnly: string) => {
          const parts = String(oldStr || '').split('T');
          if (parts.length >= 2) return `${newDateOnly}T${parts.slice(1).join('T')}`;
          return newDateOnly;
        };

        // Derive single vatRate + unit price from invoice lines (warehouse invoices are typically single-line)
        const detailRates = Array.from(new Set((nextInvoice.details || []).map((d: any) => Number(d.vatRate)).filter((n: number) => Number.isFinite(n))));
        const derivedVatRate = (detailRates.length === 1 ? detailRates[0] : 0);
        const sumQty = (nextInvoice.details || []).reduce((s: number, d: any) => s + Number(d.quantity || 0), 0);
        const derivedQty = sumQty > 0 ? sumQty : undefined;
        const derivedUnitPrice = (sumQty > 0) ? roundVnd(Number(nextInvoice.amount || 0) / sumQty) : undefined;

        setTransactions(prev => prev.map((t) => {
          if (t.id !== trxId) return t;
          if (t.type !== targetType) return t;
          return {
            ...t,
            // Keep time component if transaction stored datetime-local string
            date: mergeDateKeepingTime(t.date || '', String(nextInvoice.date || '').split('T')[0]),
            // Keep documentRef aligned with invoiceNumber so both modules show the same
            documentRef: String(newRef || '').trim() || t.documentRef,
            // Sync Mẫu số / Ký hiệu
            formNo: (String((nextInvoice as any).formNo || '').trim() || t.formNo),
            symbolCode: (String((nextInvoice as any).symbolCode || '').trim() || t.symbolCode),
            // Reflect edits to đơn giá / thuế suất / số lượng into history list
            price: (derivedUnitPrice !== undefined ? derivedUnitPrice : t.price),
            vatRate: (Number.isFinite(derivedVatRate) ? derivedVatRate : t.vatRate),
            quantity: (derivedQty !== undefined ? derivedQty : t.quantity),
            ...(nextInvoice.status === 'PAID' && nextFundMethod === 'BANK'
              ? {
                  bankAccountId: nextInvoice.bankAccountId,
                  bankName: nextInvoice.bankName,
                  bankAccountNumber: nextInvoice.bankAccountNumber,
                  bankAccountHolder: nextInvoice.bankAccountHolder,
                  bankBranch: nextInvoice.bankBranch,
                  bankLedgerAccountCode: nextInvoice.bankLedgerAccountCode,
                }
              : clearBankAccountSnapshot()),
          };
        }));
      }
    } catch {}

    // Sync related Warehouse History rows for multi-line vouchers (BATCH) when invoice is edited.
    // id dạng INV-PUR-BATCH-<batchId> với batchId = BATCH-<ts>-<n> (không cắt bằng BATCH-\\d+).
    try {
      const mbPur = String(nextInvoice.id || '').match(/^INV-PUR-BATCH-(.+)$/);
      const mbSal = String(nextInvoice.id || '').match(/^INV-SALES-BATCH-(.+)$/);
      const batchId = String((mbPur?.[1] || mbSal?.[1] || '').trim());
      if (batchId) {
        const targetType = nextInvoice.type === 'PURCHASE' ? 'IMPORT' : 'EXPORT';
        const dateOnly = String(nextInvoice.date || '').split('T')[0];
        const formNo = (String((nextInvoice as any).formNo || '').trim() || undefined);
        const symbolCode = (String((nextInvoice as any).symbolCode || '').trim() || undefined);
        const mergeDateKeepingTime = (oldStr: string, newDateOnly: string) => {
          const parts = String(oldStr || '').split('T');
          if (parts.length >= 2) return `${newDateOnly}T${parts.slice(1).join('T')}`;
          return newDateOnly;
        };

        // Build per-item updates from invoice lines (inventoryItemId is set for warehouse batch invoices)
        const lineByItemId = new Map<string, any>();
        (nextInvoice.details || []).forEach((d: any) => {
          const iid = String(d.inventoryItemId || '').trim();
          if (!iid) return;
          lineByItemId.set(iid, d);
        });

        setTransactions(prev => prev.map((t) => {
          if ((t as any).batchId !== batchId) return t;
          if (t.type !== targetType) return t;

          const d = lineByItemId.get(t.itemId);
          const nextQty = d ? Number(d.quantity || t.quantity) : t.quantity;
          const nextPrice = d ? Number(d.price || t.price) : t.price;
          const nextVatRate = d ? Number(d.vatRate || t.vatRate) : t.vatRate;
          const nextNote = d ? (String(d.note || '').trim() || t.note) : t.note;

          return {
            ...t,
            date: mergeDateKeepingTime(t.date || '', dateOnly),
            documentRef: String(newRef || '').trim() || t.documentRef,
            formNo: formNo || (t as any).formNo,
            symbolCode: symbolCode || (t as any).symbolCode,
            quantity: Number.isFinite(nextQty) ? nextQty : t.quantity,
            price: Number.isFinite(nextPrice) ? nextPrice : t.price,
            vatRate: Number.isFinite(nextVatRate) ? nextVatRate : t.vatRate,
            note: nextNote,
            ...(nextInvoice.status === 'PAID' && nextFundMethod === 'BANK'
              ? {
                  bankAccountId: nextInvoice.bankAccountId,
                  bankName: nextInvoice.bankName,
                  bankAccountNumber: nextInvoice.bankAccountNumber,
                  bankAccountHolder: nextInvoice.bankAccountHolder,
                  bankBranch: nextInvoice.bankBranch,
                  bankLedgerAccountCode: nextInvoice.bankLedgerAccountCode,
                }
              : clearBankAccountSnapshot()),
          };
        }));
      }
    } catch {}

    // Update accounting artifacts tied to this invoice so edits are reflected "mọi nơi"
    // Rule: Invoice postings always go to AR/AP (131/331). Payments/receipts are represented by AccountingVouchers (1111/1121).
    // Một lần setJournalEntries: gỡ mọi biến thể JE thu/chi gắn HĐ + cập nhật JE-INV + ghi lại JE-VOU (tránh chồng tài khoản khi đổi hình thức thanh toán).
    const invoicePaymentJeIds = getInvoiceLinkedPaymentVoucherJeIds(nextInvoice.id);
    if (skipVoucherResync) {
      invoicePaymentJeIds.delete(primaryJeVouId);
    }
    setJournalEntries(prev => {
      const isPurchase = nextInvoice.type === 'PURCHASE';
      const rebuildInvoicePostingDetails = (): any[] => buildInvoicePostingDetails(nextInvoice);

      let next = prev
        // Drop legacy settlement entries for this invoice (we use vouchers instead)
        .filter(e => !String(e.id || '').startsWith(`JE-PAY-INV-${nextInvoice.id}-`))
        // Gỡ toàn bộ bút chứng từ thu/chi tiền gắn HĐ (kể cả id cũ) trước khi ghi lại đúng một bút
        .filter(e => !invoicePaymentJeIds.has(String(e.id || '')))
        .map(e => {
          // Invoice posting entry
          if (e.id === `JE-INV-${nextInvoice.id}`) {
            const docD = String(nextInvoice.date || '').split('T')[0];
            const jeBase = `${isPurchase ? 'Mua hàng' : 'Bán hàng'} - HĐ số: ${newRef}`;
            const filing = String(nextInvoice.vatFilingAnchorDate || '').split('T')[0];
            const jeDesc = nextInvoice.crossPeriodMeta
              ? `${jeBase} [HĐ khác niên độ — kỳ gốc chứng từ ${docD}]`
              : nextInvoice.taxFilingMeta?.accountingTaxSplit === 'SAME_FY_LATE_TAX' && filing
                ? `${jeBase} [Sổ kỳ phát sinh ${docD} — kê khai thuế kỳ ${filing}]`
                : jeBase;
            return {
              ...e,
              date: invLedgerBase,
              referenceId: newRef,
              description: jeDesc,
              details: rebuildInvoicePostingDetails()
            };
          }

          // If invoiceNumber changes, keep references consistent (best-effort)
          if (e.referenceId === oldRef) {
            return { ...e, referenceId: newRef };
          }
          if (typeof e.description === 'string' && oldRef && e.description.includes(oldRef)) {
            return { ...e, description: e.description.split(oldRef).join(newRef) };
          }
          return e;
        });

      if (shouldHaveVoucher && finalPaymentVoucherForJournal?.status === 'POSTED') {
        const pd = String(finalPaymentVoucherForJournal.date || cashMovementDate || '').split('T')[0];
        const vje = buildPostedVoucherJournalEntry(finalPaymentVoucherForJournal, pd);
        if (vje) next = [...next, vje];
      }

      // Đổi 1111 ↔ 1121 (v.v.) trên đúng bút phiếu kho — không tạo thêm chứng từ thanh toán module.
      const whJeId = getWarehouseCashJournalEntryId(nextInvoice.id);
      if (whJeId && nextInvoice.status === 'PAID') {
        const pmCoerced = coercePaidInvoicePaymentMethodFromDebtLabels(nextInvoice).paymentMethod || '';
        const targetAcc = resolveCashBankAccountFromPaymentMethod(pmCoerced, nextInvoice.bankLedgerAccountCode);
        next = next.map((e) => {
          if (String(e.id || '') !== whJeId) return e;
          return {
            ...e,
            details: (e.details || []).map((d: any) => {
              const acc = String(d.account || '');
              if (/^(1111|1112|1122|1121)$/.test(acc) || /^1121[A-Za-z0-9]+$/.test(acc)) {
                return { ...d, account: targetAcc };
              }
              return d;
            }),
          };
        });
      }

      // --- Layer 1 (real-time) COGS for sales invoices ---
      const costJeId = `JE-INV-COGS-${nextInvoice.id}`;
      next = next.filter((e) => String(e.id || '') !== costJeId);
      const cogsBuild = buildInvoiceCogsJournalEntry(nextInvoice, inventoryCatalogRef.current, invLedgerBase);
      if (cogsBuild.journalEntry) {
        next = [...next, cogsBuild.journalEntry];
      } else if (cogsBuild.issues.length > 0) {
        // Keep editing behavior unblocked; reconciliation at period-end will prevent locking if COGS can't be computed.
        window.alert(
          `Chưa cập nhật được giá vốn 632 cho hóa đơn ${nextInvoice.invoiceNumber || nextInvoice.id}.\n` +
            `${cogsBuild.issues.slice(0, 5).join('\n')}${cogsBuild.issues.length > 5 ? '\n...' : ''}`,
        );
      }

      return next;
    });

    setFundTransactions(prev => {
      const isPurchase = nextInvoice.type === 'PURCHASE';
      const amt = Number(nextInvoice.totalAmount || 0);

      // If switching back to PENDING, remove paid artifacts
      if (nextInvoice.status === 'PENDING') {
        return prev.filter(ft =>
          ft.id !== `FT-INV-${nextInvoice.id}` &&
          (whFundId ? ft.id !== whFundId : true) &&
          !ft.id.startsWith(`FT-PAY-${nextInvoice.id}-`) &&
          ft.referenceDoc !== oldRef &&
          ft.referenceDoc !== newRef
        );
      }

      // Update existing fund rows referencing this invoice
      let next = prev.map(ft => {
        if (
          ft.id === `FT-INV-${nextInvoice.id}` ||
          (whFundId && ft.id === whFundId) ||
          ft.referenceDoc === oldRef
        ) {
          return {
            ...ft,
            voucherNumber: ft.voucherNumber || sharedPaymentVoucherNumber,
            date: cashMovementDate,
            amount: amt,
            payerReceiver: nextInvoice.customerName,
            description: `${isPurchase ? 'Thanh toán' : 'Thu tiền'} hóa đơn ${newRef}`,
            referenceDoc: newRef,
            method: nextFundMethod || ft.method,
            ...(nextFundMethod === 'BANK'
              ? {
                  bankAccountId: nextInvoice.bankAccountId,
                  bankName: nextInvoice.bankName,
                  bankAccountNumber: nextInvoice.bankAccountNumber,
                  bankAccountHolder: nextInvoice.bankAccountHolder,
                  bankBranch: nextInvoice.bankBranch,
                  bankLedgerAccountCode: nextInvoice.bankLedgerAccountCode,
                }
              : clearBankAccountSnapshot()),
          };
        }
        // Legacy settlement fund rows are no longer used (we use vouchers)
        if (ft.referenceDoc === oldRef) return { ...ft, referenceDoc: newRef };
        if (typeof ft.description === 'string' && oldRef && ft.description.includes(oldRef)) {
          return { ...ft, description: ft.description.split(oldRef).join(newRef) };
        }
        return ft;
      });

      if (isWarehouseStockInvoice(nextInvoice)) {
        next = next.filter(ft => ft.id !== `FT-INV-${nextInvoice.id}`);
      }

      // Ensure there is a fund row for invoices that are PAID
      const hasPayFund = next.some(ft => ft.id.startsWith(`FT-PAY-${nextInvoice.id}-`));
      const hasInvFund =
        next.some(ft => ft.id === `FT-INV-${nextInvoice.id}`) ||
        (whFundId ? next.some(ft => ft.id === whFundId) : false);
      // Remove legacy pay fund rows if any
      if (hasPayFund) {
        next = next.filter(ft => !ft.id.startsWith(`FT-PAY-${nextInvoice.id}-`));
      }
      if (!hasInvFund && nextFundMethod) {
        next = [...next, {
          id: `FT-INV-${nextInvoice.id}`,
          voucherNumber: sharedPaymentVoucherNumber,
          date: cashMovementDate,
          type: isPurchase ? 'PAYMENT' : 'RECEIPT',
          method: nextFundMethod,
          amount: amt,
          payerReceiver: nextInvoice.customerName,
          description: `${isPurchase ? 'Thanh toán' : 'Thu tiền'} hóa đơn ${newRef}`,
          category: isPurchase ? 'Chi mua hàng hóa' : 'Doanh thu bán hàng',
          status: 'COMPLETED',
          referenceDoc: newRef,
          ...(nextFundMethod === 'BANK'
            ? {
                bankAccountId: nextInvoice.bankAccountId,
                bankName: nextInvoice.bankName,
                bankAccountNumber: nextInvoice.bankAccountNumber,
                bankAccountHolder: nextInvoice.bankAccountHolder,
                bankBranch: nextInvoice.bankBranch,
                bankLedgerAccountCode: nextInvoice.bankLedgerAccountCode,
              }
            : clearBankAccountSnapshot()),
        } as FundTransaction];
      }
      return next;
    });

    void writeClientAuditLog({
      action: 'update_invoice',
      resource: 'Invoice',
      resourceId: String(nextInvoice.id || ''),
      before: oldInvoice,
      after: nextInvoice,
    });

    return true;
  };

  const handleUpdateInventoryTransactionMeta = (trxId: string, patch: Partial<InventoryTransaction>) => {
    const trx = transactions.find(t => t.id === trxId);
    if (!trx) return;

    const postingDate = (String((patch as any).date || trx.date || new Date().toISOString()).split('T')[0]);
    if (!assertEditableDate(postingDate, 'cập nhật lịch sử nhập/xuất kho')) return;

    const nextTrx: InventoryTransaction = {
      ...trx,
      ...patch,
      documentRef: (patch.documentRef !== undefined ? String(patch.documentRef || '').trim() : trx.documentRef),
      formNo: ((patch as any).formNo !== undefined ? String((patch as any).formNo || '').trim() || undefined : (trx as any).formNo),
      symbolCode: ((patch as any).symbolCode !== undefined ? String((patch as any).symbolCode || '').trim() || undefined : (trx as any).symbolCode),
    };

    setTransactions(prev => prev.map(t => t.id === trxId ? nextTrx : t));

    // Sync to linked invoice if it exists (warehouse-created invoice ids are deterministic)
    const invId = (trx.type === 'IMPORT') ? `INV-PUR-${trxId}` : `INV-SALES-${trxId}`;
    const inv = invoices.find(i => i.id === invId);
    if (!inv) return;

    const dateOnly = String(nextTrx.date || inv.date || '').split('T')[0] || inv.date;
    const nextInvoiceNumber = (String(nextTrx.documentRef || '').trim() || inv.invoiceNumber);
    const nextSymbol = (String((nextTrx as any).symbolCode || '').trim() || inv.symbolCode);
    const nextForm = (String((nextTrx as any).formNo || '').trim() || (inv as any).formNo);

    let nextDetails: any[] = (inv.details || []).slice();
    if (nextDetails.length > 0) {
      const d0 = { ...nextDetails[0] };
      const qty = Number.isFinite(Number(nextTrx.quantity)) ? Number(nextTrx.quantity) : Number(d0.quantity || 0);
      const price = Number.isFinite(Number(nextTrx.price)) ? Number(nextTrx.price) : Number(d0.price || 0);
      const amount = qty * price;
      const vatRate = Number.isFinite(Number(nextTrx.vatRate)) ? Number(nextTrx.vatRate) : Number(d0.vatRate || 0);
      const vatAmount = vatAmountUnrounded(amount, vatRate);
      d0.quantity = qty;
      d0.price = price;
      d0.amount = amount;
      d0.vatRate = vatRate;
      d0.vatAmount = vatAmount;
      nextDetails = [d0, ...nextDetails.slice(1)];
    }

    handleUpdateInvoice({
      id: inv.id,
      invoiceNumber: nextInvoiceNumber,
      symbolCode: nextSymbol,
      formNo: nextForm,
      date: dateOnly,
      details: nextDetails,
    });
  };

  const appendEntityTombstones = (updates: Partial<DeletedEntityTombstones>) => {
    const computeNext = (prev: DeletedEntityTombstones) => {
      const next = { ...prev };
      for (const [entityType, ids] of Object.entries(updates)) {
        if (!ids?.length) continue;
        next[entityType] = [...new Set([...(next[entityType] || []), ...ids.map(String)])];
      }
      return next;
    };
    // Cập nhật ref đồng bộ để mọi reload realtime ngay sau khi xóa đều lọc đúng bản ghi.
    deletedEntityTombstonesRef.current = computeNext(deletedEntityTombstonesRef.current);
    setDeletedEntityTombstones(computeNext);
  };

  const removeEntityTombstones = (updates: Partial<DeletedEntityTombstones>) => {
    const computeNext = (prev: DeletedEntityTombstones) => {
      let changed = false;
      const next = { ...prev };
      for (const [entityType, ids] of Object.entries(updates)) {
        if (!ids?.length) continue;
        const current = next[entityType] || [];
        if (current.length === 0) continue;
        const removeIds = new Set(ids.map(String));
        const filtered = current.filter((id) => !removeIds.has(String(id)));
        if (filtered.length !== current.length) {
          changed = true;
          if (filtered.length > 0) {
            next[entityType] = filtered;
          } else {
            delete next[entityType];
          }
        }
      }
      return changed ? next : prev;
    };
    deletedEntityTombstonesRef.current = computeNext(deletedEntityTombstonesRef.current);
    setDeletedEntityTombstones(computeNext);
  };

  const recordEntityDeletion = (
    entityType: string,
    entityId: string,
    label?: string,
    before?: unknown,
    auditAction?: string,
    auditResource?: string,
  ) => {
    const id = String(entityId);
    const at = new Date().toISOString();
    const profile = authProfileRef.current;
    const entry: EntityDeletionAuditEntry = {
      id: `${entityType}-${id}-${at}`,
      entityType,
      entityId: id,
      label: label || undefined,
      deletedAt: at,
      deletedByUserId: profile?.id,
      deletedByEmail: profile?.email,
      deletedByName: profile?.email || profile?.username || profile?.id,
    };
    const applyTombstone = (prev: DeletedEntityTombstones) => ({
      ...prev,
      [entityType]: [...new Set([...(prev[entityType] || []), id])],
    });
    deletedEntityTombstonesRef.current = applyTombstone(deletedEntityTombstonesRef.current);
    setDeletedEntityTombstones(applyTombstone);
    setEntityDeletionAuditLog((prev) => [...prev.slice(-499), entry]);
    void writeClientAuditLog({
      action: auditAction || `delete_${entityType}`,
      resource: auditResource || entityType,
      resourceId: id,
      before,
      after: { deletedAt: at, deletedBy: entry.deletedByName, deletedByEmail: entry.deletedByEmail },
    });
  };

  const handleDeleteInvoice = async (target: string | Invoice) => {
    const invIdLookup = typeof target === 'string' ? target : String(target?.id || '');
    const inv =
      invoices.find((i) => String(i.id) === String(invIdLookup)) ||
      getAllInvoicesAcrossYearsInternal().find((i) => String(i.id) === String(invIdLookup));
    if (!inv) {
      window.alert('Không tìm thấy hóa đơn.');
      return false;
    }
    const postingDate = (inv?.accountingPostingDate || inv?.date || new Date().toISOString().split('T')[0]).split('T')[0];
    if (!assertEditableDate(postingDate, 'xóa hóa đơn')) return false;
    const deferredLockReason = getDeferredRevenueLockReason(inv);
    if (deferredLockReason) {
      window.alert(deferredLockReason);
      return false;
    }

    const invId = String(inv.id);

    // Hóa đơn sinh từ Kho (nạp tài nguyên / bàn giao): xóa ở Hóa đơn & VAT phải gỡ phiếu kho, tồn, Sổ NKC
    if (isWarehouseStockInvoice(inv)) {
      const batchMeta = parseWarehouseBatchFromInvoiceId(invId);
      if (batchMeta) {
        const peerTrxs = findTransactionsByBatchIdAcrossYears(
          batchMeta.batchId,
          transactions,
          yearDataByKey,
        );
        if (peerTrxs.length > 0) {
          return await handleDeleteInventoryTransaction(peerTrxs[0].id);
        }
      }
      const trxIdFromInv = parseWarehouseTrxIdFromInvoiceId(invId);
      if (
        trxIdFromInv &&
        findTransactionAcrossYears(trxIdFromInv, transactions, yearDataByKey)
      ) {
        return await handleDeleteInventoryTransaction(trxIdFromInv);
      }
      if (batchMeta) {
        return await handleDeleteWarehouseBatchArtifacts(batchMeta.batchId, batchMeta.type, inv);
      }
    }

    // IMPORTANT: Do NOT delete by substring matching (includes) because it can accidentally
    // remove other invoices/vouchers with similar numbers. Only delete exact, traceable artifacts.
    const invoiceRef = String(inv?.invoiceNumber || invId || '').trim();
    const invoiceRefEqualsId = !invoiceRef || invoiceRef === invId;
    const voucherId = `VOU-INV-${invId}`;
    const separatePaymentVoucherId = `VOU-INV-PAY-${invId}`;
    const separatePaymentFundId = `FT-INV-PAY-${invId}`;
    const voucherRefs = new Set([
      voucherId,
      separatePaymentVoucherId,
      `UNC-${invoiceRef}`,
      `PC-${invoiceRef}`,
      `BC-${invoiceRef}`,
      `PT-${invoiceRef}`,
    ]);

    // Warehouse invoices have deterministic ids:
    // - INV-PUR-TRX-...  (legacy single-line)
    // - INV-SALES-TRX-... (legacy single-line)
    // - INV-PUR-BATCH-<batchId> / INV-SALES-BATCH-<batchId> với batchId = BATCH-<ts>-<n> (không chỉ BATCH-\\d+)
    const mPurBatch = invId.match(/^INV-PUR-BATCH-(.+)$/);
    const mSalesBatch = invId.match(/^INV-SALES-BATCH-(.+)$/);
    const batchId = String((mPurBatch?.[1] || mSalesBatch?.[1] || '').trim());
    const mTrx = invId.match(/^INV-(PUR|SALES)-(TRX-[A-Za-z0-9-]+)/);
    const trxId = mTrx?.[2] || '';

    const shouldDeleteJournal = (je: any) =>
      shouldRemoveJournalForInvoice(invId, inv?.invoiceNumber, je);

    const shouldDeleteFund = (ft: any) => {
      const ftId = String(ft?.id || '');
      const ftRef = String(ft?.referenceDoc || '');
      const ftDesc = String(ft?.description || '');
      // Standard invoice module fund entries
      if (ftId === `FT-INV-${invId}`) {
        if (invoiceRefEqualsId) return true;
        return ftRef === invoiceRef || ftDesc.includes(invoiceRef);
      }
      if (ftId === separatePaymentFundId) {
        if (invoiceRefEqualsId) return true;
        return ftRef === invoiceRef || ftDesc.includes(invoiceRef);
      }
      if (ftId.startsWith(`FT-PAY-${invId}-`)) {
        if (invoiceRefEqualsId) return true;
        return ftRef === invoiceRef || ftDesc.includes(invoiceRef);
      }

      // Warehouse legacy single-line fund entries
      if (trxId) {
        if (ftId === `FT-PUR-${trxId}`) return true;
        if (ftId === `FT-SALES-${trxId}`) return true;
      }

      // Warehouse batch (multi-line) fund entries
      if (batchId) {
        if (ftId === `FT-PUR-BATCH-${batchId}`) return true;
        if (ftId === `FT-SALES-BATCH-${batchId}`) return true;
      }

      return false;
    };

    const shouldDeleteVoucher = (v: any) => {
      const vId = String(v?.id || '');
      const vNo = String(v?.voucherNumber || '');
      const vDesc = String(v?.description || '');
      if (vId !== voucherId && vId !== separatePaymentVoucherId) return false;
      if (invoiceRefEqualsId) return true;
      return voucherRefs.has(vNo) || vDesc.includes(invoiceRef);
    };

    const collectRelatedDeletionIds = () => {
      const journalIds = new Set<string>();
      const fundIds = new Set<string>();
      const voucherIds = new Set<string>();

      const scanYearData = (yd: YearData) => {
        for (const je of yd.journalEntries || []) {
          if (shouldDeleteJournal(je) && je.id) journalIds.add(String(je.id));
        }
        for (const ft of yd.fundTransactions || []) {
          if (shouldDeleteFund(ft) && ft.id) fundIds.add(String(ft.id));
        }
        for (const v of yd.accountingVouchers || []) {
          if (shouldDeleteVoucher(v) && v.id) voucherIds.add(String(v.id));
        }
      };

      for (const linkedJeId of getInvoiceLinkedJournalEntryIds(invId)) {
        journalIds.add(linkedJeId);
      }
      for (const je of journalEntries) {
        if (shouldDeleteJournal(je) && je.id) journalIds.add(String(je.id));
      }

      scanYearData(getCurrentYearSnapshot());
      for (const yd of Object.values(yearDataByKey)) {
        if (yd) scanYearData(yd);
      }

      return {
        journalEntries: [...journalIds],
        fundTransactions: [...fundIds],
        accountingVouchers: [...voucherIds],
      };
    };

    const relatedIds = collectRelatedDeletionIds();

    const lcItems: Array<{ storeType: string; id: string }> = [
      { storeType: 'invoices', id: invId },
      ...relatedIds.journalEntries.map((jid) => ({ storeType: 'journalEntries', id: jid })),
      ...relatedIds.fundTransactions.map((fid) => ({ storeType: 'fundTransactions', id: fid })),
      ...relatedIds.accountingVouchers.map((vid) => ({ storeType: 'accountingVouchers', id: vid })),
    ];

    persistEpochRef.current += 1;
    recordEntityDeletion(
      'invoices',
      invId,
      String(inv?.invoiceNumber || invId),
      inv,
      'delete_invoice',
      'Invoice',
    );
    appendEntityTombstones(relatedIds);

    purgeJournalEntriesAcrossYears('invoice', invId, inv as unknown as Record<string, unknown>);

    setInvoices((prev) => removeFirstMatch(prev, (i) => i.id === invId));
    setJournalEntries(prev => prev.filter(je => !shouldDeleteJournal(je)));
    setFundTransactions(prev => prev.filter(ft => !shouldDeleteFund(ft)));

    // Also delete linked auto-voucher (if any) generated from Hoá đơn & VAT payment selection
    try {
      setAccountingVouchers(prev => prev.filter(v => !shouldDeleteVoucher(v)));
    } catch {}

    setYearDataByKey((prev) => {
      const out = { ...prev } as Record<YearKey, YearData>;
      for (const k of Object.keys(out)) {
        const yd = out[k];
        if (!yd) continue;
        out[k] = {
          ...yd,
          invoices: (yd.invoices || []).filter((i) => String(i.id) !== invId),
          journalEntries: (yd.journalEntries || []).filter((je) => !shouldDeleteJournal(je)),
          fundTransactions: (yd.fundTransactions || []).filter((ft) => !shouldDeleteFund(ft)),
          accountingVouchers: (yd.accountingVouchers || []).filter((v) => !shouldDeleteVoucher(v)),
        };
      }
      return out;
    });

    const checkoutBookingId = parseHotelPmsCheckoutBookingId(invId);
    const hotelPmsExpenseId = parseHotelPmsExpenseId(invId);
    if (checkoutBookingId || hotelPmsExpenseId) {
      setHotelPmsState((prev) => {
        let next = prev;
        if (checkoutBookingId) {
          next = {
            ...next,
            bookings: (next.bookings || []).filter((b) => String(b.id) !== checkoutBookingId),
          };
        }
        if (hotelPmsExpenseId) {
          next = {
            ...next,
            expenses: (next.expenses || []).filter((e) => String(e.id) !== hotelPmsExpenseId),
          };
        }
        return next;
      });
      setHotelPmsResetNonce((n) => n + 1);
    }

    const lc = await callLifecycleSoftDeleteMany(lcItems, 'xóa hóa đơn');
    if (!lc.ok) {
      scheduleRemoteStateReloadRef.current();
      window.alert(`Không thể đưa vào thùng rác: ${lc.error}`);
      return false;
    }
    notifySoftDeleted(String(inv?.invoiceNumber || invId));

    return true;
  };

  const applyStockBatches = (
    payloads: StockBatchPayload[],
    onImportCommitted?: (meta: StockImportCommittedMeta) => void,
  ) => {
    const orderedPayloads = (Array.isArray(payloads) ? payloads : [])
      .filter((payload): payload is StockBatchPayload => Boolean(payload))
      .map((payload, index) => ({ payload, index }))
      .sort((a, b) => {
        const byDate = String(a.payload?.date || '').localeCompare(String(b.payload?.date || ''));
        return byDate !== 0 ? byDate : a.index - b.index;
      })
      .map(entry => entry.payload);

    if (orderedPayloads.length === 0) return false;

    for (const payload of orderedPayloads) {
      const postingDate = (payload?.date || new Date().toISOString()).split('T')[0];
      if (!assertEditableDate(postingDate, 'ghi nhận nhập/xuất kho')) return false;
    }

    const norm = (s?: string) => (s || '').trim().toLowerCase();
    const serialKey = (s: string) => s.trim();
    const parseSerials = (s?: string) => (s || '').split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
    const importSeed = Date.now();
    const activeWarehouses = normalizeWarehouses(warehouses);
    const defaultWarehouseId = getDefaultWarehouseId(activeWarehouses);
    const warehouseById = new Map(activeWarehouses.map((warehouse) => [warehouse.id, warehouse]));

    let workingInventory = normalizeInventoryRows(inventory, defaultWarehouseId).map(item => ({
      ...item,
      serials: [...(item.serials || [])],
      serialDetails: [...(item.serialDetails || [])],
      warehouseBalances: cloneWarehouseBalances(item.warehouseBalances),
    }));
    let workingTransactions = [...transactions];
    let workingInvoices = [...invoices];
    let workingJournalEntries = [...journalEntries];
    let workingFundTransactions = [...fundTransactions];
    const stockBatchTouchedItemIds = new Set<string>();

    for (let batchIndex = 0; batchIndex < orderedPayloads.length; batchIndex++) {
      const payload = orderedPayloads[batchIndex];
      const type = payload?.actionType || 'IMPORT';
      const postingDate = (payload?.date || new Date().toISOString()).split('T')[0];
      const warehouseId = String(payload.warehouseId || defaultWarehouseId).trim() || defaultWarehouseId;
      const warehouseName =
        String(payload.warehouseName || '').trim() || warehouseById.get(warehouseId)?.name || undefined;
      const sourceDocumentRef = (payload.documentRef && payload.documentRef.trim()) ? payload.documentRef.trim() : '';
      const docKey = norm(sourceDocumentRef);
      const nonStockLines =
        type === 'IMPORT'
          ? (Array.isArray(payload.nonStockLines) ? payload.nonStockLines : []).filter(
              (x) =>
                x &&
                String(x.productName || '').trim() &&
                Number(x.qty) > 0 &&
                String(x.expenseAccount || '').trim() &&
                Number(x.price) >= 0,
            )
          : [];
      const lines = mergeStockBatchLinesByItemId(
        ((payload.lines || []).filter((l) => l && l.itemId && Number(l.qty) > 0)) as StockBatchLinePayload[],
      );
      if (lines.length === 0 && nonStockLines.length === 0) continue;

      lines.forEach((l) => stockBatchTouchedItemIds.add(l.itemId));
      for (const line of lines) {
        if (workingInventory.some((i) => i.id === line.itemId)) continue;
        const cat = inventoryCatalogRef.current.find((c) => c.id === line.itemId);
        if (cat) {
          workingInventory.push({
            ...ensureWarehouseBalances(
              {
                ...cat,
                quantity: Number(cat.quantity || 0),
                serials: [...(cat.serials || [])],
                serialDetails: (cat.serialDetails || []).map((d) => ({ ...d })),
              },
              defaultWarehouseId,
            ),
          });
        }
      }

      const bomCostObjectId = String(payload.costObjectId || '').trim();
      const bomReferenceDate = String(payload.date || new Date().toISOString()).split('T')[0];
      const requiresBomProductionExport =
        type === 'EXPORT' && isProductionExportPurpose(payload.exportPurpose);
      const isBomProductionExport =
        requiresBomProductionExport &&
        payload.costObjectType === 'BOM_PARENT' &&
        !!bomCostObjectId;
      const activeBomDefinition =
        isBomProductionExport ? getBomDefinitionForParent(bomDefinitions, bomCostObjectId, bomReferenceDate) : undefined;
      const referencedBomDefinition = isBomProductionExport
        ? (bomDefinitions || []).find((definition) => definition.id === String(payload.bomDefinitionId || '').trim())
        : undefined;
      const bomDefinition =
        isBomProductionExport && String(payload.productionOrderId || '').trim() && referencedBomDefinition
          ? referencedBomDefinition
          : activeBomDefinition;
      const bomParentQuantity = Math.max(0, Number(payload.bomParentQuantity || 0));
      if (requiresBomProductionExport && !isBomProductionExport) {
        window.alert('Không thể lưu: Phiếu xuất 154 phải chọn sản phẩm/dịch vụ cha và BOM tập hợp chi phí.');
        return false;
      }
      if (isBomProductionExport) {
        if (
          !bomDefinition ||
          bomDefinition.parentItemId !== bomCostObjectId ||
          bomDefinition.id !== String(payload.bomDefinitionId || '').trim()
        ) {
          window.alert('Không thể lưu: BOM cha không còn hợp lệ hoặc đã thay đổi. Vui lòng mở lại phiếu và chọn lại BOM.');
          return false;
        }
        if (bomParentQuantity <= 0) {
          window.alert('Không thể lưu: Số lượng sản phẩm/dịch vụ cha phải lớn hơn 0.');
          return false;
        }
        const warehouseScopedInventory = mapItemsToWarehouseScope(workingInventory, warehouseId, defaultWarehouseId);
        const plannedBomStockLines = buildBomPlannedStockLines(
          bomDefinition,
          warehouseScopedInventory,
          bomParentQuantity,
        );
        if (plannedBomStockLines.length === 0) {
          window.alert('Không thể lưu: BOM này không có dòng vật tư kho hợp lệ để xuất 154.');
          return false;
        }
        const plannedShortages = getBomStockShortages(
          plannedBomStockLines.map((entry) => ({
            itemId: entry.item.id,
            qty: entry.requiredQuantity,
          })),
          warehouseScopedInventory,
        );
        if (plannedShortages.length > 0) {
          window.alert(
            `Không thể lưu: BOM đang thiếu tồn kho.\n- ${plannedShortages
              .map(
                (entry) =>
                  `${entry.item?.sku || entry.itemId}: cần ${entry.requiredQuantity}, tồn ${entry.availableQuantity}, thiếu ${entry.shortageQuantity}`,
              )
              .join('\n- ')}`,
          );
          return false;
        }
        const hasBomVariance = hasBomPlannedStockVariance(
          plannedBomStockLines.map((entry) => ({
            itemId: entry.item.id,
            requiredQuantity: entry.requiredQuantity,
          })),
          lines.map((line) => ({
            itemId: line.itemId,
            qty: Number(line.qty || 0),
          })),
        );
        if (hasBomVariance && !String(payload.bomVarianceReason || '').trim()) {
          window.alert('Không thể lưu: Phiếu xuất 154 đang lệch BOM nhưng chưa có lý do sai lệch.');
          return false;
        }
      }

      if (docKey) {
        const dupLine = lines.find((l) =>
          workingTransactions.some(
            (t) =>
              norm(t.documentRef) === docKey &&
              t.type === type &&
              t.itemId === l.itemId &&
              String(t.warehouseId || defaultWarehouseId).trim() === warehouseId,
          ),
        );
        if (dupLine) {
          const hit = workingTransactions.find(
            (t) =>
              norm(t.documentRef) === docKey &&
              t.type === type &&
              t.itemId === dupLine.itemId &&
              String(t.warehouseId || defaultWarehouseId).trim() === warehouseId,
          );
          window.alert(
            `Không thể lưu: Trùng Số HĐ/Chứng từ gốc "${sourceDocumentRef}" cho cùng mặt hàng trong cùng kho.\nĐã tồn tại ${hit?.type === 'IMPORT' ? 'NHẬP' : 'XUẤT'} mặt hàng "${hit?.itemName}" ngày ${(hit?.date || '').split('T')[0]} (Mã: ${hit?.id}).`,
          );
          return false;
        }
      }

      {
        const seen = new Set<string>();
        const dup = lines.find(l => (seen.has(l.itemId) ? true : (seen.add(l.itemId), false)));
        if (dup) {
          window.alert('Không thể lưu: Trong cùng một phiếu, mỗi mặt hàng chỉ được nhập 1 dòng. Vui lòng gộp số lượng/serial vào cùng một dòng.');
          return false;
        }
      }

      const allSerials = lines.flatMap(l => parseSerials(l.serials).map(serialKey));
      if (allSerials.length > 0 && new Set(allSerials).size !== allSerials.length) {
        window.alert('Không thể lưu: Danh sách Serial/IMEI/SDT bị trùng trong chính phiếu này.');
        return false;
      }

      if (type === 'IMPORT' && allSerials.length > 0) {
        const importedSet = new Set<string>();
        workingTransactions
          .filter(t => t.type === 'IMPORT')
          .forEach(t => parseSerials(t.serials).forEach(s => importedSet.add(serialKey(s))));
        const dup = allSerials.filter(s => importedSet.has(s));
        if (dup.length > 0) {
          window.alert(`Không thể lưu: Serial/IMEI/SDT đã từng nhập kho trước đó.\nTrùng: ${dup.slice(0, 20).join(', ')}${dup.length > 20 ? '…' : ''}`);
          return false;
        }
      }

      if (type === 'EXPORT' && allSerials.length > 0) {
        const exportedSet = new Set<string>();
        workingTransactions
          .filter(t => t.type === 'EXPORT')
          .forEach(t => parseSerials(t.serials).forEach(s => exportedSet.add(serialKey(s))));
        const dup = allSerials.filter(s => exportedSet.has(s));
        if (dup.length > 0) {
          window.alert(`Không thể lưu: Serial/IMEI đã từng xuất kho trước đó.\nTrùng: ${dup.slice(0, 20).join(', ')}${dup.length > 20 ? '…' : ''}`);
          return false;
        }
      }

      for (const line of lines) {
        const item = workingInventory.find(i => i.id === line.itemId);
        const qty = Number(line.qty || 0);
        const serialList = parseSerials(line.serials);
        if (!item) {
          window.alert(`Không thể lưu: Không tìm thấy mặt hàng tương ứng cho dòng có mã nội bộ "${line.itemId}".`);
          return false;
        }
        if (serialList.length > 0 && serialList.length !== qty) {
          window.alert(`Không thể lưu: Mặt hàng "${item.name}" ngày ${postingDate} có số lượng ${qty} nhưng chỉ có ${serialList.length} Serial/IMEI.`);
          return false;
        }
        const warehouseQuantity = getWarehouseQuantity(item, warehouseId, defaultWarehouseId);
        if (type === 'EXPORT' && warehouseQuantity < qty) {
          window.alert(
            `Không thể lưu: Số lượng xuất vượt tồn hiện tại của mặt hàng "${item.name}" trong kho ${warehouseName || warehouseId}.`,
          );
          return false;
        }
      }

      const batchId = `BATCH-${importSeed}-${batchIndex + 1}`;
      const warehouseVoucherNumber = reserveDocumentNumber(getWarehouseDocumentPrefix(type), postingDate);
      const paidFundMethod = (payload.paymentStatus === 'PAID')
        ? resolveFundMethodFromPaymentMethod(payload.paymentMethod, payload.bankLedgerAccountCode)
        : null;
      const batchBankSelection = paidFundMethod === 'BANK'
        ? resolveBankSelection(payload, { requireActive: !!payload.bankAccountId })
        : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
      if (batchBankSelection.error) {
        window.alert(batchBankSelection.error);
        return false;
      }
      const batchPaymentBankSnapshot = paidFundMethod === 'BANK'
        ? batchBankSelection.snapshot
        : clearBankAccountSnapshot();
      const paymentVoucherNumber = paidFundMethod
        ? reserveDocumentNumber(getFundDocumentPrefix(type === 'IMPORT' ? 'PAYMENT' : 'RECEIPT', paidFundMethod), postingDate)
        : undefined;

      const newTransList: InventoryTransaction[] = [];
      let totalNetFloat = 0;
      let totalVatFloat = 0;
      const lineNetSeries: number[] = [];
      const lineVatSeries: number[] = [];

      for (let idx = 0; idx < lines.length; idx++) {
        const l = lines[idx];
        const itemIndex = workingInventory.findIndex(i => i.id === l.itemId);
        if (itemIndex === -1) {
          window.alert(`Không thể lưu: Không tìm thấy mặt hàng tương ứng cho dòng có mã nội bộ "${l.itemId}".`);
          return false;
        }

        const item = workingInventory[itemIndex];
        const qty = Number(l.qty);
        const price = Number(l.price);
        const vat = Number(l.vat);
        const lineAmount = qty * price;
        const lineVat = vatAmountUnrounded(lineAmount, vat);
        lineNetSeries.push(lineAmount);
        lineVatSeries.push(lineVat);
        totalNetFloat += lineAmount;
        totalVatFloat += lineVat;

        const serialList = parseSerials(l.serials);
        let serialInfoSnapshot: SerialInfo[] = [];
        const warehouseBalance = getWarehouseBalance(item, warehouseId, defaultWarehouseId);
        const currentSerials = warehouseBalance.serials || [];
        const currentSerialDetails = warehouseBalance.serialDetails || [];

        if (type === 'IMPORT') {
          const newDetails: SerialInfo[] = serialList.map(s => ({ serial: s, inboundVatRate: vat }));
          serialInfoSnapshot = newDetails;
          workingInventory[itemIndex] = applyWarehouseBalanceChange(
            item,
            {
              warehouseId,
              qtyDelta: qty,
              addSerials: serialList,
              addSerialDetails: newDetails,
              updatedAt: payload.date,
              costPrice: price,
            },
            defaultWarehouseId,
          );
        } else {
          const stockSerials = new Set((warehouseBalance.serials || []).map(serialKey));
          const missing = serialList.map(serialKey).filter(s => !stockSerials.has(s));
          if (missing.length > 0) {
            window.alert(
              `Không thể lưu: Có Serial/IMEI không tồn tại trong kho hiện tại của mặt hàng "${item.name}" tại kho ${warehouseName || warehouseId}.\nKhông tìm thấy: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`,
            );
            return false;
          }
          const removedDetails = currentSerialDetails.filter(sd => serialList.includes(sd.serial));
          serialInfoSnapshot = removedDetails;
          workingInventory[itemIndex] = applyWarehouseBalanceChange(
            item,
            {
              warehouseId,
              qtyDelta: -qty,
              removeSerials: serialList,
              removeSerialDetailsBySerial: serialList,
              updatedAt: payload.date,
            },
            defaultWarehouseId,
          );
        }

        newTransList.push({
          id: `TRX-${batchId}-${idx + 1}`,
          voucherNumber: warehouseVoucherNumber,
          batchId,
          itemId: l.itemId,
          itemName: item.name,
          type,
          quantity: qty,
          price,
          date: payload.date,
          warehouseId,
          warehouseName,
          performer: payload.performer,
          note: (String(l.note || '').trim() || payload.note),
          vatRate: vat,
          supplier: payload.supplier,
          supplierTaxCode: payload.supplierTaxCode,
          supplierPhone: payload.supplierPhone,
          supplierAddress: payload.supplierAddress,
          customer: payload.customer,
          customerTaxCode: payload.customerTaxCode,
          customerPhone: payload.customerPhone,
          customerAddress: payload.customerAddress,
          formNo: (String(payload.formNo || '').trim() || undefined),
          symbolCode: (String(payload.symbolCode || '').trim() || undefined),
          documentRef: sourceDocumentRef || undefined,
          serials: serialList.join('\n'),
          serialInfoSnapshot,
          exportPurpose: payload.exportPurpose,
          costObjectType: isBomProductionExport ? 'BOM_PARENT' : undefined,
          costObjectId: isBomProductionExport ? bomCostObjectId : undefined,
          costObjectName:
            isBomProductionExport ? String(payload.costObjectName || '').trim() || undefined : undefined,
          costObjectSku:
            isBomProductionExport ? String(payload.costObjectSku || '').trim() || undefined : undefined,
          bomDefinitionId:
            isBomProductionExport ? String(payload.bomDefinitionId || '').trim() || undefined : undefined,
          bomComponentCategory: isBomProductionExport ? l.bomAccount154Category : undefined,
          bomPlannedQuantity: isBomProductionExport ? Number(l.bomPlannedQuantity || 0) || undefined : undefined,
          bomLossRate: isBomProductionExport ? Number(l.bomLossRate || 0) || undefined : undefined,
          bomVarianceReason:
            isBomProductionExport ? String(payload.bomVarianceReason || '').trim() || undefined : undefined,
          productionOrderId: String(payload.productionOrderId || '').trim() || undefined,
          productionOrderCode: String(payload.productionOrderCode || '').trim() || undefined,
          postingMode: payload.postingMode || 'STANDARD',
          paymentStatus: payload.paymentStatus,
          paymentMethod: (payload.paymentMethod === 'BANK' ? 'BANK' : 'CASH'),
          ...(payload.paymentStatus === 'PAID' && paidFundMethod === 'BANK'
            ? batchPaymentBankSnapshot
            : clearBankAccountSnapshot()),
        });
      }

      for (const ns of nonStockLines) {
        const qty = Number(ns.qty) || 0;
        const price = Number(ns.price) || 0;
        const vat = Number(ns.vat) || 0;
        const lineAmount = qty * price;
        const lineVat = vatAmountUnrounded(lineAmount, vat);
        lineNetSeries.push(lineAmount);
        lineVatSeries.push(lineVat);
        totalNetFloat += lineAmount;
        totalVatFloat += lineVat;
      }

      workingTransactions = [...workingTransactions, ...newTransList];

      const jeDate = postingDate;
      const { amount: invNetRounded, vatAmount: invVatRounded, totalAmount: grandTotal } = roundInvoiceTotalsFromSums(
        totalNetFloat,
        totalVatFloat,
      );
      const netAlloc = allocateRoundedTotal(lineNetSeries, invNetRounded);
      const vatAlloc = allocateRoundedTotal(lineVatSeries, invVatRounded);
      const paymentStatus = payload.paymentStatus || 'PENDING';
      const paymentMethod = payload.paymentMethod || 'CASH';
      const formNo = (String(payload.formNo || '').trim() || undefined);
      const symbolCode = (String(payload.symbolCode || '').trim() || undefined);
      const detailRates = Array.from(
        new Set(
          [...lines.map((l) => Number(l.vat)), ...nonStockLines.map((ns) => Number(ns.vat))].filter((n) =>
            Number.isFinite(n),
          ),
        ),
      );
      const invoiceVatRate = (detailRates.length === 1 ? detailRates[0] : 0);
      const skipPurchaseDocs = !!payload.skipLinkedInvoiceDocs || payload.postingMode === 'PRODUCTION_RECEIPT';

      if (type === 'IMPORT') {
        if (skipPurchaseDocs) {
          const receiptDescription =
            String(payload.internalDescription || '').trim() || `Nhập kho nội bộ (${warehouseVoucherNumber})`;
          const creditAccount = String(payload.internalCreditAccount || '').trim() || '154';
          const jeDetails: any[] = [];
          lines.forEach((l, idx) => {
            const it = workingInventory.find((i) => i.id === l.itemId);
            jeDetails.push({
              account: it?.accountCode || '155',
              debit: netAlloc[idx] ?? roundVnd(Number(l.qty) * Number(l.price)),
              credit: 0,
            });
          });
          nonStockLines.forEach((ns, j) => {
            const idx = lines.length + j;
            jeDetails.push({
              account: String(ns.expenseAccount || '6427').trim() || '6427',
              debit: netAlloc[idx] ?? roundVnd(Number(ns.qty) * Number(ns.price)),
              credit: 0,
            });
          });
          jeDetails.push({
            account: creditAccount,
            debit: 0,
            credit: invNetRounded,
          });
          workingJournalEntries = [
            ...workingJournalEntries,
            {
              id: `JE-IM-BATCH-${batchId}`,
              date: jeDate,
              referenceId: warehouseVoucherNumber,
              description: receiptDescription,
              details: jeDetails,
            },
          ];
        } else {
          const purchaseInvoice: Invoice = {
            id: `INV-PUR-BATCH-${batchId}`,
            invoiceNumber: sourceDocumentRef || warehouseVoucherNumber,
            formNo,
            symbolCode,
            date: jeDate,
            customerName: payload.supplier || 'Nhà cung cấp lẻ',
            buyerAddress: payload.supplierAddress || '',
            buyerPhone: payload.supplierPhone || '',
            buyerTaxCode: payload.supplierTaxCode || '',
            description:
              nonStockLines.length > 0
                ? `Nhập kho (${warehouseVoucherNumber}) + chi phí không qua kho`
                : `Nhập kho (${warehouseVoucherNumber})`,
            amount: invNetRounded,
            vatRate: invoiceVatRate,
            vatAmount: invVatRounded,
            totalAmount: grandTotal,
            type: 'PURCHASE',
            category: 'DEVICE',
            status: paymentStatus === 'PAID' ? 'PAID' : 'PENDING',
            paymentMethod: paymentStatus === 'PENDING' ? 'Ghi nợ (331)' : (paymentMethod === 'BANK' ? 'Chuyển khoản' : 'Tiền mặt'),
            ...(paymentStatus === 'PAID' && paidFundMethod === 'BANK'
              ? batchPaymentBankSnapshot
              : clearBankAccountSnapshot()),
            details: [
              ...lines.map((l, idx) => {
              const it = workingInventory.find(i => i.id === l.itemId);
              const amt = Number(l.qty) * Number(l.price);
              const v = vatAmountUnrounded(amt, Number(l.vat));
              return {
                id: String(idx + 1),
                productName: it?.name || 'Hàng hóa',
                type: 'GOODS' as const,
                unit: it?.unit || '',
                quantity: Number(l.qty),
                price: Number(l.price),
                amount: amt,
                vatRate: Number(l.vat),
                vatAmount: v,
                account: it?.accountCode || '156',
                inventoryItemId: l.itemId,
                note: String(l.note || '').trim() || undefined,
              };
            }),
              ...nonStockLines.map((ns, j) => {
                const amt = Number(ns.qty) * Number(ns.price);
                const v = vatAmountUnrounded(amt, Number(ns.vat));
                return {
                  id: `ns-${j + 1}`,
                  productName: String(ns.productName || '').trim() || 'Dịch vụ / chi phí',
                  type: 'SERVICE' as const,
                  unit: String(ns.unit || '').trim(),
                  quantity: Number(ns.qty),
                  price: Number(ns.price),
                  amount: amt,
                  vatRate: Number(ns.vat),
                  vatAmount: v,
                  account: String(ns.expenseAccount || '6427').trim() || '6427',
                  note: String(ns.note || '').trim() || undefined,
                };
              }),
            ],
          };
          workingInvoices = [...workingInvoices, purchaseInvoice];

          const paidContra = paymentStatus === 'PAID'
            ? resolveCashBankAccountFromPaymentMethod(paymentMethod, batchPaymentBankSnapshot.bankLedgerAccountCode)
            : '331';
          const jeDetails: any[] = [];
          purchaseInvoice.details.forEach((d, idx) => {
            jeDetails.push({ account: (d.account || '156'), debit: netAlloc[idx] ?? 0, credit: 0 });
            const vPart = vatAlloc[idx] ?? 0;
            if (vPart > 0) jeDetails.push({ account: '1331', debit: vPart, credit: 0 });
          });
          jeDetails.push({
            account: paidContra,
            debit: 0,
            credit: grandTotal,
            objectType: 'SUPPLIER',
            objectId: purchaseInvoice.id,
            objectName: payload.supplier,
            sourceInvoiceId: purchaseInvoice.id,
            sourceInvoiceNumber: purchaseInvoice.invoiceNumber,
          });
          workingJournalEntries = [...workingJournalEntries, {
            id: `JE-IM-BATCH-${batchId}`,
            date: jeDate,
            referenceId: warehouseVoucherNumber,
            description:
              nonStockLines.length > 0
                ? `Nhập kho (${warehouseVoucherNumber}) + chi phí không qua kho`
                : `Nhập kho (${warehouseVoucherNumber})`,
            details: jeDetails,
          }];

          if (onImportCommitted) {
            onImportCommitted({
              batchId,
              warehouseVoucherNumber,
              purchaseInvoiceId: purchaseInvoice.id,
              journalEntryId: `JE-IM-BATCH-${batchId}`,
              transactionIds: newTransList.map((t) => t.id),
            });
          }

          if (paymentStatus === 'PAID') {
            workingFundTransactions = [...workingFundTransactions, {
              id: `FT-PUR-BATCH-${batchId}`,
              voucherNumber: paymentVoucherNumber,
              date: jeDate,
              type: 'PAYMENT',
              method: paidFundMethod || 'CASH',
              amount: grandTotal,
              payerReceiver: payload.supplier || 'Nhà cung cấp',
              description: `Chi thanh toán nhập kho (${warehouseVoucherNumber})`,
              category: 'Chi mua hàng hóa',
              status: 'COMPLETED',
              referenceDoc: warehouseVoucherNumber,
              ...(paidFundMethod === 'BANK'
                ? batchPaymentBankSnapshot
                : clearBankAccountSnapshot()),
            }];
          }
        }
      } else {
        const debitAcc = payload.exportPurpose || '632';
        const costDetails: any[] = [];
        lines.forEach((l) => {
          const it = workingInventory.find(i => i.id === l.itemId);
          const costValue = roundVnd(Number(l.qty) * Number(it?.costPrice || 0));
          const costObjectMeta =
            isBomProductionExport
              ? {
                  costObjectType: 'BOM_PARENT' as const,
                  costObjectId: bomCostObjectId,
                  costObjectName: String(payload.costObjectName || '').trim() || undefined,
                  costObjectSku: String(payload.costObjectSku || '').trim() || undefined,
                }
              : {};
          costDetails.push({ account: debitAcc, debit: costValue, credit: 0, ...costObjectMeta });
          costDetails.push({ account: it?.accountCode || '156', debit: 0, credit: costValue, ...costObjectMeta });
        });
        workingJournalEntries = [...workingJournalEntries, {
          id: `JE-EX-COST-BATCH-${batchId}`,
          date: jeDate,
          referenceId: warehouseVoucherNumber,
          description: isBomProductionExport
            ? `Tập hợp chi phí ${String(payload.costObjectSku || '').trim() || String(payload.costObjectName || '').trim() || '154'} (${warehouseVoucherNumber})`
            : `Giá vốn xuất kho (${warehouseVoucherNumber})`,
          details: costDetails,
        }];

        if (debitAcc === '632') {
          const salesInvoice: Invoice = {
            id: `INV-SALES-BATCH-${batchId}`,
            invoiceNumber: sourceDocumentRef || warehouseVoucherNumber,
            formNo,
            symbolCode,
            date: jeDate,
            customerName: payload.customer || 'Khách hàng lẻ',
            buyerAddress: payload.customerAddress || '',
            buyerPhone: payload.customerPhone || '',
            buyerTaxCode: payload.customerTaxCode || '',
            description: `Bán hàng hóa (${warehouseVoucherNumber})`,
            amount: invNetRounded,
            vatRate: invoiceVatRate,
            vatAmount: invVatRounded,
            totalAmount: grandTotal,
            type: 'SALES',
            category: 'DEVICE',
            status: paymentStatus === 'PAID' ? 'PAID' : 'PENDING',
            paymentMethod: paymentStatus === 'PENDING' ? 'Phải thu (131)' : (paymentMethod === 'BANK' ? 'Chuyển khoản' : 'Tiền mặt'),
            ...(paymentStatus === 'PAID' && paidFundMethod === 'BANK'
              ? batchPaymentBankSnapshot
              : clearBankAccountSnapshot()),
            details: lines.map((l, idx) => {
              const it = workingInventory.find(i => i.id === l.itemId);
              const amt = Number(l.qty) * Number(l.price);
              const v = vatAmountUnrounded(amt, Number(l.vat));
              return {
                id: String(idx + 1),
                productName: it?.name || 'Hàng hóa',
                type: 'GOODS',
                unit: it?.unit || '',
                quantity: Number(l.qty),
                price: Number(l.price),
                amount: amt,
                vatRate: Number(l.vat),
                vatAmount: v,
                account: '5111',
                inventoryItemId: l.itemId,
                note: String(l.note || '').trim() || undefined,
              };
            }),
          };
          workingInvoices = [...workingInvoices, salesInvoice];

          const moneyAcc = paymentStatus === 'PAID'
            ? resolveCashBankAccountFromPaymentMethod(paymentMethod, batchPaymentBankSnapshot.bankLedgerAccountCode)
            : '131';
          const revDetails: any[] = [
            { account: moneyAcc, debit: grandTotal, credit: 0, objectType: 'CUSTOMER', objectName: payload.customer },
          ];
          salesInvoice.details.forEach((d, idx) => {
            revDetails.push({ account: '5111', debit: 0, credit: netAlloc[idx] ?? 0 });
            const vPart = vatAlloc[idx] ?? 0;
            if (vPart > 0) revDetails.push({ account: '3331', debit: 0, credit: vPart });
          });
          workingJournalEntries = [...workingJournalEntries, {
            id: `JE-EX-REV-BATCH-${batchId}`,
            date: jeDate,
            referenceId: warehouseVoucherNumber,
            description: `Doanh thu xuất bán (${warehouseVoucherNumber})`,
            details: revDetails,
          }];

          if (paymentStatus === 'PAID') {
            workingFundTransactions = [...workingFundTransactions, {
              id: `FT-SALES-BATCH-${batchId}`,
              voucherNumber: paymentVoucherNumber,
              date: jeDate,
              type: 'RECEIPT',
              method: paidFundMethod || 'CASH',
              amount: grandTotal,
              payerReceiver: payload.customer || 'Khách hàng',
              description: `Thu tiền xuất bán (${warehouseVoucherNumber})`,
              category: 'Doanh thu bán hàng',
              status: 'COMPLETED',
              referenceDoc: warehouseVoucherNumber,
            ...(paidFundMethod === 'BANK'
              ? batchPaymentBankSnapshot
              : clearBankAccountSnapshot()),
            }];
          }
        }
      }
    }

    if (stockBatchTouchedItemIds.size > 0) {
      // Một mặt hàng từng bị đưa vào thùng rác có thể vẫn còn trong catalog và được nạp lại.
      // Nếu giữ tombstone inventory cũ, lần persist/realtime kế tiếp sẽ lọc mất dòng Số dư mới.
      removeEntityTombstones({ inventory: [...stockBatchTouchedItemIds] });
    }
    const nextInventoryCatalog = syncCatalogFromInventoryRows(
      inventoryCatalogRef.current,
      workingInventory,
      stockBatchTouchedItemIds,
    );
    const nextYearDataByKey = {
      ...yearDataByKeyRef.current,
      [activeYearKeyRef.current || activeYearKey]: {
        ...(yearDataByKeyRef.current[activeYearKeyRef.current || activeYearKey] || buildEmptyYearData([])),
        inventory: workingInventory,
        transactions: workingTransactions,
        invoices: workingInvoices,
        journalEntries: workingJournalEntries,
        fundTransactions: workingFundTransactions,
        accountingVouchers,
      },
    } as Record<YearKey, YearData>;

    // Commit đồng bộ state + refs trước khi persist/realtime chạy, tránh reload lite hoặc
    // Bàn giao/Kích hoạt đọc lại snapshot tồn cũ (0) trong vài giây ngay sau Nạp tài nguyên.
    inventoryRef.current = workingInventory;
    inventoryCatalogRef.current = nextInventoryCatalog;
    transactionsRef.current = workingTransactions;
    invoicesRef.current = workingInvoices;
    journalEntriesRef.current = workingJournalEntries;
    yearDataByKeyRef.current = nextYearDataByKey;
    persistPendingRef.current = true;
    remoteEchoBodyRef.current = null;
    setPersistNonce((n) => n + 1);

    setInventory(workingInventory);
    setInventoryCatalog(nextInventoryCatalog);
    setTransactions(workingTransactions);
    setInvoices(workingInvoices);
    setJournalEntries(workingJournalEntries);
    setFundTransactions(workingFundTransactions);
    setYearDataByKey(nextYearDataByKey);
    return true;
  };

  const handleInventoryActions = {
    stockBatch: (payload: StockBatchPayload, onImportCommitted?: (meta: StockImportCommittedMeta) => void) =>
      applyStockBatches([payload], onImportCommitted),
    stockBatches: (payloads: StockBatchPayload[]) => applyStockBatches(payloads),
    stock: (itemId: string, qty: number, price: number, performer: string, note: string, vat: number, date: string, serials: string, supplier: string, documentRef: string, customer?: string, customerPhone?: string, customerAddress?: string, supplierPhone?: string, supplierAddress?: string, exportPurpose?: string, actionType?: 'IMPORT' | 'EXPORT', paymentStatus?: 'PAID' | 'PENDING', paymentMethod?: string, supplierTaxCode?: string, customerTaxCode?: string, formNo?: string, symbolCode?: string, bankSnapshot?: Partial<BankAccountSnapshot>, warehouseId?: string) => {
      return handleInventoryActions.stockBatch({
        actionType,
        date,
        warehouseId,
        performer,
        note,
        supplier,
        documentRef,
        customer,
        customerPhone,
        customerAddress,
        supplierPhone,
        supplierAddress,
        exportPurpose,
        paymentStatus,
        paymentMethod,
        supplierTaxCode,
        customerTaxCode,
        formNo,
        symbolCode,
        ...bankSnapshot,
        lines: [{ itemId, qty, price, vat, serials }],
      });
    },
    add: (item: any) => {
      const id = String(item?.id || '').trim() || newEntityId();
      const newRow: InventoryItem = ensureWarehouseBalances(
        {
          ...item,
          id,
          quantity: Number(item.quantity || 0),
          costPrice: Number(item.costPrice || 0),
          sellingPrice: Number(item.sellingPrice || 0),
          minStock: Number(item.minStock ?? 0),
        },
        getDefaultWarehouseId(warehouses),
      );
      setInventory((prev) => [...prev, newRow]);
      setInventoryCatalog((prev) => [...prev, { ...newRow }]);
    },
    update: (item: any) => {
      const normalized: InventoryItem = ensureWarehouseBalances(
        {
          ...item,
          quantity: Number(item.quantity || 0),
          costPrice: Number(item.costPrice || 0),
          sellingPrice: Number(item.sellingPrice || 0),
          minStock: Number(item.minStock ?? 0),
        },
        getDefaultWarehouseId(warehouses),
      );
      setInventory((prev) => prev.map((i) => (i.id === item.id ? normalized : i)));
      setInventoryCatalog((prev) => {
        const has = prev.some((c) => c.id === item.id);
        if (has) return prev.map((c) => (c.id === item.id ? { ...c, ...normalized } : c));
        return [...prev, { ...normalized }];
      });
    },
  };

  /** Serial trên một phiếu kho (text ưu tiên, fallback snapshot). */
  const parseTransactionSerials = (t: InventoryTransaction): string[] => {
    const fromText = String(t.serials || '')
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (fromText.length > 0) return fromText;
    return (t.serialInfoSnapshot || [])
      .map((si) => String(si.serial || '').trim())
      .filter(Boolean);
  };

  /**
   * Giảm một phần phiếu NHẬP kho của 1 sản phẩm (xóa theo IMEI / số lượng / số hóa đơn):
   * - trừ số lượng & gỡ serial khỏi phiếu nhập + tồn kho
   * - co dòng hàng tương ứng trên hóa đơn mua, dựng lại bút toán Sổ NKC + phiếu quỹ
   * - nếu hóa đơn không còn dòng nào → xóa hẳn cả phiếu (ủy quyền cascade chuẩn)
   */
  const reduceImportTransactionPartial = async (
    trxId: string,
    requestedRemoveQty: number,
    removeSerialsInput: string[],
  ): Promise<boolean> => {
    const numQty = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const defaultWarehouseId = getDefaultWarehouseId(warehouses);
    const trx = findTransactionAcrossYears(trxId, transactionsRef.current, yearDataByKeyRef.current);
    if (!trx || trx.type !== 'IMPORT') {
      window.alert('Chỉ hỗ trợ xóa theo IMEI / số lượng trên phiếu NHẬP kho.');
      return false;
    }
    const postingDate = (trx.date || new Date().toISOString()).split('T')[0];
    if (!assertEditableDate(postingDate, 'xóa một phần hàng nhập kho')) return false;

    const itemId = String(trx.itemId || '');
    const trxWarehouseId = String(trx.warehouseId || defaultWarehouseId).trim() || defaultWarehouseId;
    const allSerials = parseTransactionSerials(trx);
    const serialTracked = allSerials.length > 0;

    const removeSerials = serialTracked
      ? [...new Set(removeSerialsInput.map((s) => String(s).trim()).filter((s) => allSerials.includes(s)))]
      : [];
    const removeQty = serialTracked ? removeSerials.length : Math.min(numQty(requestedRemoveQty), numQty(trx.quantity));
    if (removeQty <= 0) return true;

    // Kiểm tra tồn kho hiện tại đủ để hoàn tác (tránh âm kho do đã xuất sau đó).
    const liveItem = inventoryRef.current.find((i) => i.id === itemId);
    if (liveItem) {
      const bal = getWarehouseBalance(liveItem, trxWarehouseId, defaultWarehouseId);
      const onHand = numQty(bal.quantity);
      if (onHand + 1e-6 < removeQty) {
        window.alert(
          'Không thể xóa vì tồn kho hiện tại nhỏ hơn số lượng cần gỡ (có thể đã xuất kho sau phiếu này).',
        );
        return false;
      }
      if (serialTracked) {
        const missing = removeSerials.filter((s) => !(bal.serials || []).includes(s));
        if (missing.length > 0) {
          window.alert(`Một số IMEI không còn trong kho (đã xuất): ${missing.slice(0, 10).join(', ')}`);
          return false;
        }
      }
    }

    const batchId = getTransactionBatchId(trx);
    const invId = batchId ? `INV-PUR-BATCH-${batchId}` : `INV-PUR-${trxId}`;
    const jeId = batchId ? `JE-IM-BATCH-${batchId}` : `JE-IM-${trxId}`;
    const fundId = batchId ? `FT-PUR-BATCH-${batchId}` : `FT-PUR-${trxId}`;
    const voucherId = `VOU-INV-${invId}`;
    const paymentJournalId = `JE-VOU-${voucherId}`;

    const findInvoiceAcrossYears = (id: string): Invoice | undefined => {
      const fromActive = invoicesRef.current.find((i) => String(i.id) === id);
      if (fromActive) return fromActive;
      for (const yd of Object.values(yearDataByKeyRef.current)) {
        const hit = (yd.invoices || []).find((i) => String(i.id) === id);
        if (hit) return hit;
      }
      return undefined;
    };
    const findJournalAcrossYears = (id: string): JournalEntry | undefined => {
      const fromActive = journalEntriesRef.current.find((j) => String(j.id) === id);
      if (fromActive) return fromActive;
      for (const yd of Object.values(yearDataByKeyRef.current)) {
        const hit = (yd.journalEntries || []).find((j) => String(j.id) === id);
        if (hit) return hit;
      }
      return undefined;
    };

    const inv = findInvoiceAcrossYears(invId);

    // Không tìm thấy hóa đơn liên kết → gỡ trọn phiếu để giữ sổ sách cân đối.
    if (!inv) {
      return await handleDeleteInventoryTransaction(trxId, { silent: true });
    }

    const lineIdx = (inv.details || []).findIndex((d) => String(d.inventoryItemId || '') === itemId);
    let newDetails = (inv.details || []).map((d) => ({ ...d }));
    if (lineIdx >= 0) {
      const line = newDetails[lineIdx];
      const lineQty = numQty(line.quantity);
      const price = numQty(line.price);
      const vatRate = numQty(line.vatRate);
      const newLineQty = lineQty - removeQty;
      if (newLineQty <= 1e-9) {
        newDetails.splice(lineIdx, 1);
      } else {
        const amount = newLineQty * price;
        newDetails[lineIdx] = {
          ...line,
          quantity: newLineQty,
          amount,
          vatAmount: vatAmountUnrounded(amount, vatRate),
        };
      }
    }

    // Hết dòng hàng trên hóa đơn → gỡ trọn phiếu (cascade chuẩn xử lý lifecycle + thùng rác).
    if (newDetails.length === 0) {
      return await handleDeleteInventoryTransaction(trxId, { silent: true });
    }

    // Dựng lại bút toán Sổ NKC từ chi tiết hóa đơn còn lại.
    const existingJe = findJournalAcrossYears(jeId);
    const contraAccount =
      (existingJe?.details || []).slice().reverse().find((d) => numQty(d.credit) > 0)?.account || '331';

    const lineNet = newDetails.map((d) => numQty(d.amount));
    const lineVat = newDetails.map((d) => numQty(d.vatAmount));
    const sumNet = lineNet.reduce((a, b) => a + b, 0);
    const sumVat = lineVat.reduce((a, b) => a + b, 0);
    const { amount: invNet, vatAmount: invVat, totalAmount: grandTotal } = roundInvoiceTotalsFromSums(sumNet, sumVat);
    const netAlloc = allocateRoundedTotal(lineNet, invNet);
    const vatAlloc = allocateRoundedTotal(lineVat, invVat);
    const rebuiltJeDetails: JournalEntry['details'] = [];
    newDetails.forEach((d, idx) => {
      rebuiltJeDetails.push({ account: String(d.account || '156'), debit: netAlloc[idx] ?? 0, credit: 0 });
      const vPart = vatAlloc[idx] ?? 0;
      if (vPart > 0) rebuiltJeDetails.push({ account: '1331', debit: vPart, credit: 0 });
    });
    rebuiltJeDetails.push({
      account: contraAccount,
      debit: 0,
      credit: grandTotal,
      objectType: 'SUPPLIER',
      objectId: invId,
      objectName: inv.customerName,
      sourceInvoiceId: invId,
      sourceInvoiceNumber: inv.invoiceNumber,
    });
    const rebuiltJe: JournalEntry = existingJe
      ? { ...existingJe, details: rebuiltJeDetails }
      : {
          id: jeId,
          date: postingDate,
          referenceId: inv.invoiceNumber || invId,
          description: `Nhập kho (${inv.invoiceNumber || invId})`,
          details: rebuiltJeDetails,
        };

    const remainingSerials = allSerials.filter((s) => !removeSerials.includes(s));
    const remainingSnapshot = (trx.serialInfoSnapshot || []).filter(
      (si) => !removeSerials.includes(String(si.serial || '').trim()),
    );
    const nextTrxQty = numQty(trx.quantity) - removeQty;

    const applyTrx = (list: InventoryTransaction[]) =>
      list.map((t) =>
        String(t.id) === trxId
          ? {
              ...t,
              quantity: nextTrxQty,
              serials: serialTracked ? remainingSerials.join('\n') : t.serials,
              serialInfoSnapshot: serialTracked ? remainingSnapshot : t.serialInfoSnapshot,
            }
          : t,
      );
    const applyInv = (list: Invoice[]) =>
      list.map((i) =>
        String(i.id) === invId ? { ...i, details: newDetails, amount: invNet, vatAmount: invVat, totalAmount: grandTotal } : i,
      );
    const applyVoucher = (list: AccountingVoucher[]) =>
      list.map((v) =>
        String(v.id) === voucherId
          ? {
              ...v,
              totalAmount: grandTotal,
              details: (v.details || []).map((d) => ({ ...d, amount: grandTotal })),
            }
          : v,
      );
    const applyJe = (list: JournalEntry[]) =>
      list.map((j) => {
        const jid = String(j.id || '');
        if (jid === jeId) return rebuiltJe;
        if (jid === paymentJournalId) {
          return {
            ...j,
            details: (j.details || []).map((d) => ({
              ...d,
              debit: numQty(d.debit) > 0 ? grandTotal : d.debit,
              credit: numQty(d.credit) > 0 ? grandTotal : d.credit,
            })),
          };
        }
        return j;
      });
    const applyFund = (list: FundTransaction[]) =>
      list.map((f) => (String(f.id) === fundId || String(f.id) === `FT-INV-${invId}` ? { ...f, amount: grandTotal } : f));
    const applyInventory = (list: InventoryItem[]) =>
      list.map((it) =>
        String(it.id) === itemId
          ? applyWarehouseBalanceChange(
              it,
              {
                warehouseId: trxWarehouseId,
                qtyDelta: -removeQty,
                removeSerials: serialTracked ? removeSerials : undefined,
                removeSerialDetailsBySerial: serialTracked ? removeSerials : undefined,
                updatedAt: new Date().toISOString().split('T')[0],
              },
              defaultWarehouseId,
            )
          : it,
      );

    persistEpochRef.current += 1;
    const nextTransactions = applyTrx(transactionsRef.current);
    const nextInvoices = applyInv(invoicesRef.current);
    const nextJournalEntries = applyJe(journalEntriesRef.current);
    const nextFundTransactions = applyFund(fundTransactions);
    const nextInventory = applyInventory(inventoryRef.current);
    const nextInventoryCatalog = applyInventory(inventoryCatalogRef.current);
    const nextYearDataByKey = (() => {
      const out = { ...yearDataByKeyRef.current } as Record<YearKey, YearData>;
      for (const k of Object.keys(out)) {
        const yd = out[k];
        if (!yd) continue;
        out[k] = {
          ...yd,
          transactions: applyTrx(yd.transactions || []),
          invoices: applyInv(yd.invoices || []),
          accountingVouchers: applyVoucher(yd.accountingVouchers || []),
          journalEntries: applyJe(yd.journalEntries || []),
          fundTransactions: applyFund(yd.fundTransactions || []),
          inventory: applyInventory(yd.inventory || []),
        };
      }
      return out;
    })();

    transactionsRef.current = nextTransactions;
    invoicesRef.current = nextInvoices;
    journalEntriesRef.current = nextJournalEntries;
    inventoryRef.current = nextInventory;
    inventoryCatalogRef.current = nextInventoryCatalog;
    yearDataByKeyRef.current = nextYearDataByKey;

    setTransactions(nextTransactions);
    setInvoices(nextInvoices);
    setAccountingVouchers(applyVoucher);
    setJournalEntries(nextJournalEntries);
    setFundTransactions(nextFundTransactions);
    setInventory(nextInventory);
    setInventoryCatalog(nextInventoryCatalog);
    setYearDataByKey(nextYearDataByKey);

    return true;
  };

  const collectImportTrxsForItem = (itemId: string): InventoryTransaction[] =>
    collectTransactionsAcrossYears(transactionsRef.current, yearDataByKeyRef.current)
      .filter((t) => String(t.itemId || '') === itemId && t.type === 'IMPORT')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const batchInvoiceIdForTrx = (t: InventoryTransaction): string => {
    const bid = getTransactionBatchId(t);
    return bid ? `INV-PUR-BATCH-${bid}` : `INV-PUR-${String(t.id)}`;
  };

  const assertEditableDatesForTrxs = (trxs: InventoryTransaction[], actionLabel: string): boolean => {
    for (const t of trxs) {
      const postingDate = (t.date || new Date().toISOString()).split('T')[0];
      if (!assertEditableDate(postingDate, actionLabel)) return false;
    }
    return true;
  };

  const validateDeleteInventoryItemAdvanced = (
    itemId: string,
    options: InventoryItemDeleteOptions,
  ): boolean => {
    const id = String(itemId || '').trim();
    if (!id) return false;

    const numAll = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const importTrxs = collectImportTrxsForItem(id);

    if (options.mode === 'INVOICE') {
      const wanted = new Set(options.invoiceIds.map((s) => String(s).trim()).filter(Boolean));
      if (wanted.size === 0) {
        window.alert('Vui lòng chọn ít nhất một hóa đơn.');
        return false;
      }
      const targets = importTrxs.filter((t) => wanted.has(batchInvoiceIdForTrx(t)));
      if (targets.length === 0) {
        window.alert('Không tìm thấy phiếu nhập của sản phẩm thuộc hóa đơn đã chọn.');
        return false;
      }
      return assertEditableDatesForTrxs(targets, 'xóa theo hóa đơn');
    }

    if (options.mode === 'SERIAL') {
      const wanted = new Set(options.serials.map((s) => String(s).trim()).filter(Boolean));
      if (wanted.size === 0) {
        window.alert('Vui lòng chọn ít nhất một IMEI/serial.');
        return false;
      }
      const perTrx = new Map<string, string[]>();
      for (const t of importTrxs) {
        const serials = parseTransactionSerials(t).filter((s) => wanted.has(s));
        if (serials.length > 0) perTrx.set(String(t.id), serials);
      }
      if (perTrx.size === 0) {
        window.alert('Không tìm thấy IMEI đã chọn trên phiếu nhập của sản phẩm.');
        return false;
      }
      const trxs = importTrxs.filter((t) => perTrx.has(String(t.id)));
      return assertEditableDatesForTrxs(trxs, 'xóa theo IMEI');
    }

    const remaining = Math.max(0, Math.floor(numAll(options.quantity)));
    if (remaining <= 0) {
      window.alert('Vui lòng nhập số lượng cần xóa.');
      return false;
    }
    const fifoTrxs: InventoryTransaction[] = [];
    let need = remaining;
    for (const t of importTrxs) {
      if (need <= 0) break;
      const trxQty = Math.max(0, numAll(t.quantity));
      if (trxQty <= 0) continue;
      fifoTrxs.push(t);
      need -= Math.min(need, trxQty);
    }
    if (fifoTrxs.length === 0) {
      window.alert('Không có phiếu nhập để giảm số lượng.');
      return false;
    }
    return assertEditableDatesForTrxs(fifoTrxs, 'xóa theo số lượng');
  };

  const handleDeleteInventoryItemAdvanced = async (
    itemId: string,
    options: InventoryItemDeleteOptions,
  ): Promise<boolean> => {
    const id = String(itemId || '').trim();
    if (!id) return false;

    const numAll = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    if (options.mode === 'INVOICE') {
      const wanted = new Set(options.invoiceIds.map((s) => String(s).trim()).filter(Boolean));
      if (wanted.size === 0) return false;
      let okAll = true;
      for (const invId of wanted) {
        const targets = collectImportTrxsForItem(id).filter((t) => batchInvoiceIdForTrx(t) === invId);
        if (targets.length === 0) {
          window.alert('Không tìm thấy phiếu nhập của sản phẩm thuộc hóa đơn đã chọn.');
          okAll = false;
          break;
        }
        const ok = await handleDeleteInventoryTransaction(String(targets[0].id), { silent: true });
        okAll = okAll && ok;
        if (!okAll) break;
      }
      if (okAll) notifySoftDeleted(`hóa đơn của sản phẩm (${wanted.size})`);
      return okAll;
    }

    const importTrxs = collectImportTrxsForItem(id);

    if (options.mode === 'SERIAL') {
      const wanted = new Set(options.serials.map((s) => String(s).trim()).filter(Boolean));
      if (wanted.size === 0) return false;
      const perTrx = new Map<string, string[]>();
      for (const t of importTrxs) {
        const serials = parseTransactionSerials(t).filter((s) => wanted.has(s));
        if (serials.length > 0) perTrx.set(String(t.id), serials);
      }
      if (perTrx.size === 0) {
        window.alert('Không tìm thấy IMEI đã chọn trên phiếu nhập của sản phẩm.');
        return false;
      }
      let okAll = true;
      for (const [tid, serials] of perTrx) {
        const ok = await reduceImportTransactionPartial(tid, serials.length, serials);
        okAll = okAll && ok;
        if (!ok) break;
      }
      if (okAll) notifySoftDeleted(`IMEI đã xóa (${wanted.size})`);
      return okAll;
    }

    // QUANTITY mode — FIFO từ phiếu cũ nhất.
    let remaining = Math.max(0, Math.floor(numAll(options.quantity)));
    if (remaining <= 0) return false;
    let okAll = true;
    for (const t of importTrxs) {
      if (remaining <= 0) break;
      const trxQty = Math.max(0, numAll(t.quantity));
      if (trxQty <= 0) continue;
      const take = Math.min(remaining, trxQty);
      const serials = parseTransactionSerials(t).slice(0, take);
      const ok = await reduceImportTransactionPartial(String(t.id), take, serials);
      if (!ok) {
        okAll = false;
        break;
      }
      remaining -= take;
    }
    if (okAll && remaining > 0) {
      window.alert(`Đã xóa tối đa theo tồn hiện có. Còn thiếu ${remaining} chưa xóa được (vượt số lượng đã nhập).`);
    }
    if (okAll) notifySoftDeleted('số lượng sản phẩm đã giảm');
    return okAll;
  };

  const handleDeleteWarehouseBatchArtifacts = async (
    batchId: string,
    headType: 'IMPORT' | 'EXPORT',
    inv?: Invoice,
  ) => {
    const bid = String(batchId || '').trim();
    if (!bid) return false;

    const invPurId = `INV-PUR-BATCH-${bid}`;
    const invSalId = `INV-SALES-BATCH-${bid}`;
    const invId = headType === 'IMPORT' ? invPurId : invSalId;
    const lcItems: Array<{ storeType: string; id: string }> = [
      { storeType: 'invoices', id: invId },
      { storeType: 'accountingVouchers', id: `VOU-INV-${invId}` },
      { storeType: 'accountingVouchers', id: `VOU-INV-INV-${headType === 'IMPORT' ? 'PUR' : 'SALES'}-BATCH-${bid}` },
      {
        storeType: 'fundTransactions',
        id: headType === 'IMPORT' ? `FT-PUR-BATCH-${bid}` : `FT-SALES-BATCH-${bid}`,
      },
      { storeType: 'fundTransactions', id: `FT-INV-${invId}` },
    ];

    persistEpochRef.current += 1;
    if (inv) {
      recordEntityDeletion('invoices', invId, inv.invoiceNumber || invId, inv, 'delete_warehouse_invoice', 'Invoice');
    }
    purgeJournalEntriesAcrossYears('invoice', invId, inv ? (inv as unknown as Record<string, unknown>) : null);

    setTransactions((prev) => prev.filter((t) => getTransactionBatchId(t) !== bid));
    setInvoices((prev) => prev.filter((i) => i.id !== invPurId && i.id !== invSalId));
    setAccountingVouchers((prev) =>
      prev.filter(
        (v) =>
          v.id !== `VOU-INV-${invPurId}` &&
          v.id !== `VOU-INV-${invSalId}` &&
          v.id !== `VOU-INV-INV-PUR-BATCH-${bid}` &&
          v.id !== `VOU-INV-INV-SALES-BATCH-${bid}`,
      ),
    );
    setFundTransactions((prev) =>
      prev.filter(
        (ft) =>
          ft.id !== `FT-PUR-BATCH-${bid}` &&
          ft.id !== `FT-SALES-BATCH-${bid}` &&
          ft.id !== `FT-INV-${invPurId}` &&
          ft.id !== `FT-INV-${invSalId}`,
      ),
    );
    setYearDataByKey((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([yk, yd]) => [
          yk,
          purgeWarehouseBatchFromYearSlice(yd, bid, headType),
        ]),
      ) as Record<YearKey, YearData>,
    );

    const lc = await callLifecycleSoftDeleteMany(lcItems, 'xóa hóa đơn kho liên kết');
    if (!lc.ok) {
      scheduleRemoteStateReloadRef.current();
      window.alert(`Không thể đưa vào thùng rác: ${lc.error}`);
      return false;
    }
    notifySoftDeleted(inv?.invoiceNumber || invId);
    return true;
  };

  const handleDeleteInventoryTransaction = async (id: string, opts?: { silent?: boolean }) => {
    /** Sai số làm tròn khi cộng/trừ tồn qua nhiều phiếu — tránh chặn xóa phiếu nhập oan */
    const INV_QTY_ROLLBACK_EPS = 1e-4;
    const numQty = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const roundInvQty = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0);
    const defaultWarehouseId = getDefaultWarehouseId(warehouses);

    const deleteOne = async (trxId: string, opts?: { silent?: boolean }) => {
      const trx = findTransactionAcrossYears(trxId, transactionsRef.current, yearDataByKeyRef.current);
      const postingDate = (trx?.date || new Date().toISOString()).split('T')[0];
      if (!assertEditableDate(postingDate, 'xóa lịch sử nhập/xuất kho')) return false;
      if (!trx) return false;

      const batchId = getTransactionBatchId(trx);
      const peerTrxs = batchId
        ? findTransactionsByBatchIdAcrossYears(batchId, transactionsRef.current, yearDataByKeyRef.current)
        : [trx];
      const peerIds = new Set(peerTrxs.map(p => p.id));
      const peerTrxsSnapshot = peerTrxs.map((p) => ({ ...p }));

      if (batchId && peerTrxs.length > 1 && !opts?.silent) {
        const ok = window.confirm(
          `Chứng từ này gồm ${peerTrxs.length} dòng cùng phiếu.\n` +
            'Xóa sẽ gỡ toàn bộ các dòng, hóa đơn liên kết và hạch toán (nhật ký chung, quỹ, chứng từ kế toán).\n\nTiếp tục?',
        );
        if (!ok) return false;
      }

      const ref = (trx.voucherNumber || trx.documentRef || trxId);
      const sourceRef = String(trx.documentRef || '');
      const voucherRef = String(trx.voucherNumber || '');
      const cloneInventoryRow = (it: InventoryItem): InventoryItem => ({
        ...ensureWarehouseBalances(it, defaultWarehouseId),
        serials: [...(it.serials || [])],
        serialDetails: (it.serialDetails || []).map(d => ({ ...d })),
        warehouseBalances: cloneWarehouseBalances(it.warehouseBalances),
      });
      let workingInv = inventoryRef.current.map(cloneInventoryRow);
      /** Cascade gọi deleteOne lồng — tồn đã commit trong lời gọi con; không được ghi đè bằng workingInv gốc */
      let skipOuterInventorySet = false;
      /** Người dùng chấp nhận xóa HĐ/chứng từ/phiếu kho khi không đủ tồn để trừ lại (không chỉnh quantity trong kho) */
      let forceSkipInventoryRollback = false;
      /** Tồn hiện < số đã nhập NHƯNG không có phiếu xuất nào (lệch dữ liệu) → cho xóa, kẹp tồn về 0. */
      let clampInventoryRollback = false;

      if (!opts?.silent && peerTrxs.length > 0 && peerTrxs.every(p => p.type === 'IMPORT')) {
        let sim = inventory.map(cloneInventoryRow);
        let preflight: 'ok' | 'need_force' | 'defer_serial' = 'ok';
        for (const t of peerTrxs) {
          const idx = sim.findIndex(i => i.id === t.itemId);
          if (idx === -1) continue;
          const row = sim[idx];
          const trxWarehouseId = String(t.warehouseId || defaultWarehouseId).trim() || defaultWarehouseId;
          const sl = t.serials ? t.serials.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [];
          const warehouseBalance = getWarehouseBalance(row, trxWarehouseId, defaultWarehouseId);
          const curS = warehouseBalance.serials || [];
          if (sl.length > 0) {
            const missing = sl.filter(s => !curS.includes(s));
            if (missing.length > 0) {
              preflight = 'defer_serial';
              break;
            }
          }
          const onH = numQty(warehouseBalance.quantity);
          const needQ = numQty(t.quantity);
          if (onH + INV_QTY_ROLLBACK_EPS < needQ) {
            preflight = 'need_force';
            break;
          }
          sim[idx] = applyWarehouseBalanceChange(
            row,
            {
              warehouseId: trxWarehouseId,
              qtyDelta: -needQ,
              removeSerials: sl,
              removeSerialDetailsBySerial: sl,
              updatedAt: t.date,
            },
            defaultWarehouseId,
          );
        }
        if (preflight === 'need_force') {
          // Có thực sự đã xuất kho mặt hàng trong phiếu này không? (mức tồn tối thiểu = 0)
          const peerItemIds = new Set(peerTrxs.map(p => String(p.itemId)));
          const allTrxs = collectTransactionsAcrossYears(transactionsRef.current, yearDataByKeyRef.current);
          const hasRealExports = allTrxs.some(
            x => x.type === 'EXPORT' && peerItemIds.has(String(x.itemId)) && numQty(x.quantity) > 0,
          );
          if (!hasRealExports) {
            // Không có phiếu xuất → tồn nhỏ hơn là do lệch dữ liệu. Cho xóa, kẹp tồn về 0
            // (không hiện cảnh báo, không để tồn âm).
            clampInventoryRollback = true;
          } else {
            const proceed = window.confirm(
              'Hệ thống không thể trừ lại đúng số lượng đã nhập vì tồn kho hiện tại nhỏ hơn (đã có xuất kho sau phiếu này).\n\n' +
                'Bạn có muốn **vẫn xóa** hóa đơn, chứng từ kế toán, quỹ và phiếu kho khỏi hệ thống **mà không tự động chỉnh số lượng tồn**?\n' +
                'Chỉ dùng khi bạn chắc chắn nghiệp vụ và sẽ đối chiếu/điều chỉnh tồn sau.\n\n' +
                'OK = xóa (bỏ qua cập nhật tồn) · Hủy = giữ nguyên dữ liệu.',
            );
            if (!proceed) {
              window.alert('Không thể xóa phiếu nhập này vì tồn kho hiện tại không đủ để hoàn tác (đã có xuất kho sau đó).');
              return false;
            }
            forceSkipInventoryRollback = true;
          }
        }
      }

      const rollbackInventoryForPeer = async (t: InventoryTransaction): Promise<boolean> => {
        if (forceSkipInventoryRollback) return true;
        const tid = t.id;
        const itemIndex = workingInv.findIndex(i => i.id === t.itemId);
        const serialList = (t.serials ? t.serials.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : []);
        const trxWarehouseId = String(t.warehouseId || defaultWarehouseId).trim() || defaultWarehouseId;

        if (itemIndex === -1) return true;

        const item = workingInv[itemIndex];
        const currentBalance = getWarehouseBalance(item, trxWarehouseId, defaultWarehouseId);
        const currentSerials = currentBalance.serials || [];
        const currentDetails = currentBalance.serialDetails || [];

        if (t.type === 'IMPORT') {
          const onHand = numQty(currentBalance.quantity);
          const need = numQty(t.quantity);
          if (onHand + INV_QTY_ROLLBACK_EPS < need) {
            // Lệch dữ liệu (không có phiếu xuất): kẹp tồn về 0 thay vì để âm, và vẫn cho xóa.
            if (clampInventoryRollback) {
              const removeQty = Math.max(0, Math.min(onHand, need));
              workingInv[itemIndex] = applyWarehouseBalanceChange(
                item,
                {
                  warehouseId: trxWarehouseId,
                  qtyDelta: -removeQty,
                  removeSerials: serialList,
                  removeSerialDetailsBySerial: serialList,
                  updatedAt: t.date,
                },
                defaultWarehouseId,
              );
              return true;
            }
            if (!opts?.silent) {
              window.alert('Không thể xóa phiếu nhập này vì tồn kho hiện tại không đủ để hoàn tác (đã có xuất kho sau đó).');
            }
            return false;
          }

          if (serialList.length > 0) {
            const missing = serialList.filter(s => !currentSerials.includes(s));
            if (missing.length > 0) {
              if (batchId && peerTrxs.length > 1) {
                if (!opts?.silent) {
                  window.alert(
                    'Phiếu nhập nhiều dòng có serial đã xuất: không hỗ trợ xóa cả lô tự động.\n' +
                      'Vui lòng xóa lần lượt từng dòng (hoặc xóa phiếu xuất liên quan trước).',
                  );
                }
                return false;
              }
              const depExports = collectTransactionsAcrossYears(transactionsRef.current, yearDataByKeyRef.current)
                .filter(x => x.type === 'EXPORT')
                .filter(x => {
                  const sl = (x.serials ? x.serials.split(/[\n,]+/).map(z => z.trim()).filter(Boolean) : []);
                  return sl.some(s => missing.includes(s));
                })
                .slice()
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

              if (!opts?.silent) {
                if (depExports.length === 0) {
                  window.alert('[CASCADE] Không thể xóa phiếu nhập này vì một số serial đã được xuất/không còn trong tồn kho, nhưng không tìm thấy phiếu xuất liên quan để xóa dây chuyền.');
                  return false;
                }

                const willConflict = depExports.filter(ex => {
                  const sl = (ex.serials ? ex.serials.split(/[\n,]+/).map(z => z.trim()).filter(Boolean) : []);
                  return sl.some(s => currentSerials.includes(s));
                });
                if (willConflict.length > 0) {
                  window.alert(
                    'Không thể xóa tự động vì có serial đã được nhập lại sau đó (nếu hoàn tác xuất sẽ bị trùng serial).\n' +
                      `Serial bị vướng: ${willConflict.flatMap(ex => (ex.serials || '').split(/[\n,]+/).map(z => z.trim()).filter(Boolean).filter(s => currentSerials.includes(s))).slice(0, 20).join(', ')}`,
                  );
                  return false;
                }

                const ok = window.confirm(
                  `Phiếu nhập này có serial đã được xuất sau đó.\n` +
                    `Để xóa phiếu nhập, cần xóa kèm ${depExports.length} phiếu xuất liên quan.\n\n` +
                    `Bạn có muốn xóa dây chuyền không? (CASCADE)\n` +
                    `- Phiếu nhập: ${t.voucherNumber || t.documentRef || t.id}\n` +
                    `- Phiếu xuất: ${depExports.slice(0, 5).map(x => x.voucherNumber || x.documentRef || x.id).join(', ')}${depExports.length > 5 ? '…' : ''}`,
                );
                if (!ok) return false;

                for (const ex of depExports) {
                  const okEx = await deleteOne(ex.id, { silent: true });
                  if (!okEx) {
                    window.alert(`Không thể xóa dây chuyền: lỗi khi xóa phiếu xuất ${ex.voucherNumber || ex.documentRef || ex.id}.`);
                    return false;
                  }
                }

                skipOuterInventorySet = true;
                return await deleteOne(tid, { silent: true });
              }

              return false;
            }
          }

          const remaining = collectTransactionsAcrossYears(transactionsRef.current, yearDataByKeyRef.current).filter(
            x => !peerIds.has(x.id) && x.itemId === t.itemId && x.type === 'IMPORT',
          );
          const lastImport = remaining.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).at(-1);

          const nextInventoryItem = applyWarehouseBalanceChange(
            item,
            {
              warehouseId: trxWarehouseId,
              qtyDelta: -need,
              removeSerials: serialList,
              removeSerialDetailsBySerial: serialList,
              updatedAt: t.date,
              costPrice: lastImport ? Number(lastImport.price) : item.costPrice,
            },
            defaultWarehouseId,
          );

          workingInv[itemIndex] = nextInventoryItem;
        } else {
          if (serialList.length > 0) {
            const dup = serialList.filter(s => currentSerials.includes(s));
            if (dup.length > 0) {
              if (!opts?.silent) window.alert('Không thể xóa phiếu xuất này vì một số serial đã tồn tại trong kho (trùng serial).');
              return false;
            }
          }
          const restoredDetails: SerialInfo[] =
            t.serialInfoSnapshot && t.serialInfoSnapshot.length > 0 ? t.serialInfoSnapshot : [];

          const addQ = numQty(t.quantity);
          const nextInventoryItem = applyWarehouseBalanceChange(
            item,
            {
              warehouseId: trxWarehouseId,
              qtyDelta: addQ,
              addSerials: serialList,
              addSerialDetails: restoredDetails,
              updatedAt: t.date,
            },
            defaultWarehouseId,
          );

          workingInv[itemIndex] = nextInventoryItem;
        }
        return true;
      };

      if (!forceSkipInventoryRollback) {
        for (const t of peerTrxs) {
          if (!(await rollbackInventoryForPeer(t))) return false;
        }
        if (!skipOuterInventorySet) {
          setInventory(workingInv);
          const delTouched = new Set(peerTrxs.map((t) => t.itemId).filter(Boolean));
          setInventoryCatalog((prev) => syncCatalogFromInventoryRows(prev, workingInv, delTouched));
        }
      }

      const lcItems: Array<{ storeType: string; id: string }> = peerTrxs.map((t) => ({
        storeType: 'transactions',
        id: t.id,
      }));
      if (batchId) {
        const head = peerTrxs[0];
        if (head?.type === 'IMPORT') {
          const invId = `INV-PUR-BATCH-${batchId}`;
          lcItems.push({ storeType: 'invoices', id: invId });
          lcItems.push({ storeType: 'accountingVouchers', id: `VOU-INV-${invId}` });
          lcItems.push({ storeType: 'accountingVouchers', id: `VOU-INV-INV-PUR-BATCH-${batchId}` });
          lcItems.push({ storeType: 'fundTransactions', id: `FT-PUR-BATCH-${batchId}` });
          lcItems.push({ storeType: 'fundTransactions', id: `FT-INV-${invId}` });
        } else {
          const invId = `INV-SALES-BATCH-${batchId}`;
          lcItems.push({ storeType: 'invoices', id: invId });
          lcItems.push({ storeType: 'accountingVouchers', id: `VOU-INV-${invId}` });
          lcItems.push({ storeType: 'accountingVouchers', id: `VOU-INV-INV-SALES-BATCH-${batchId}` });
          lcItems.push({ storeType: 'fundTransactions', id: `FT-SALES-BATCH-${batchId}` });
          lcItems.push({ storeType: 'fundTransactions', id: `FT-INV-${invId}` });
        }
      } else {
        const linkedInvId = trx.type === 'IMPORT' ? `INV-PUR-${trxId}` : `INV-SALES-${trxId}`;
        lcItems.push({ storeType: 'invoices', id: linkedInvId });
        lcItems.push({ storeType: 'accountingVouchers', id: `VOU-INV-${linkedInvId}` });
        lcItems.push({ storeType: 'fundTransactions', id: trx.type === 'IMPORT' ? `FT-PUR-${trxId}` : `FT-SALES-${trxId}` });
        lcItems.push({ storeType: 'fundTransactions', id: `FT-INV-${linkedInvId}` });
      }
      const journalLcIds = new Set<string>();
      if (batchId) {
        const head = peerTrxs[0];
        const invId = head?.type === 'IMPORT' ? `INV-PUR-BATCH-${batchId}` : `INV-SALES-BATCH-${batchId}`;
        const vouId = `VOU-INV-${invId}`;
        if (head?.type === 'IMPORT') {
          journalLcIds.add(`JE-IM-BATCH-${batchId}`);
        } else {
          journalLcIds.add(`JE-EX-COST-BATCH-${batchId}`);
          journalLcIds.add(`JE-EX-REV-BATCH-${batchId}`);
        }
        journalLcIds.add(`JE-VOU-${vouId}`);
      } else {
        const linkedInvId = trx.type === 'IMPORT' ? `INV-PUR-${trxId}` : `INV-SALES-${trxId}`;
        const linkedVouId = `VOU-INV-${linkedInvId}`;
        if (trx.type === 'IMPORT') {
          journalLcIds.add(`JE-IM-${trxId}`);
        } else {
          journalLcIds.add(`JE-EX-COST-${trxId}`);
          journalLcIds.add(`JE-EX-REV-${trxId}`);
        }
        journalLcIds.add(`JE-VOU-${linkedVouId}`);
      }
      for (const jid of journalLcIds) {
        lcItems.push({ storeType: 'journalEntries', id: jid });
      }

      persistEpochRef.current += 1;
      for (const item of lcItems) {
        recordEntityDeletion(item.storeType, item.id, item.id, undefined, 'delete_inventory_transaction', item.storeType);
      }
      for (const t of peerTrxs) {
        purgeJournalEntriesAcrossYears(
          'inventoryTransaction',
          String(t.id),
          t as unknown as Record<string, unknown>,
        );
      }
      for (const item of lcItems) {
        if (item.storeType === 'invoices') {
          purgeJournalEntriesAcrossYears('invoice', item.id, null);
        } else if (item.storeType === 'accountingVouchers') {
          purgeJournalEntriesAcrossYears('voucher', item.id, null);
        }
      }

      setTransactions(prev => prev.filter(x => !peerIds.has(x.id)));

      if (batchId) {
        const head = peerTrxs[0];
        const vn = String(head.voucherNumber || '');
        const dr = String(head.documentRef || '');
        if (head.type === 'IMPORT') {
          const invPurId = `INV-PUR-BATCH-${batchId}`;
          const vouId = `VOU-INV-${invPurId}`;
          setInvoices(prev => prev.filter(inv => inv.id !== invPurId));
          setAccountingVouchers(prev => prev.filter(v => v.id !== vouId));
          setJournalEntries(prev =>
            prev.filter(je => {
              const jid = String(je.id || '');
              const jref = String(je.referenceId || '');
              if (jid === `JE-IM-BATCH-${batchId}`) return false;
              if (jid === `JE-VOU-${vouId}`) return false;
              if (vn && jref === vn) return false;
              if (dr && jref === dr) return false;
              return true;
            }),
          );
          setFundTransactions(prev =>
            prev.filter(ft => {
              const fid = String(ft.id || '');
              if (fid === `FT-PUR-BATCH-${batchId}`) return false;
              if (fid === `FT-INV-${invPurId}`) return false;
              if (vn && (ft.referenceDoc === vn || ft.voucherNumber === vn)) return false;
              if (dr && ft.referenceDoc === dr) return false;
              return true;
            }),
          );
        } else {
          const invSalId = `INV-SALES-BATCH-${batchId}`;
          const vouId = `VOU-INV-${invSalId}`;
          setInvoices(prev => prev.filter(inv => inv.id !== invSalId));
          setAccountingVouchers(prev => prev.filter(v => v.id !== vouId));
          setJournalEntries(prev =>
            prev.filter(je => {
              const jid = String(je.id || '');
              const jref = String(je.referenceId || '');
              if (jid === `JE-EX-COST-BATCH-${batchId}`) return false;
              if (jid === `JE-EX-REV-BATCH-${batchId}`) return false;
              if (jid === `JE-VOU-${vouId}`) return false;
              if (vn && jref === vn) return false;
              if (dr && jref === dr) return false;
              return true;
            }),
          );
          setFundTransactions(prev =>
            prev.filter(ft => {
              const fid = String(ft.id || '');
              if (fid === `FT-SALES-BATCH-${batchId}`) return false;
              if (fid === `FT-INV-${invSalId}`) return false;
              if (vn && (ft.referenceDoc === vn || ft.voucherNumber === vn)) return false;
              if (dr && ft.referenceDoc === dr) return false;
              return true;
            }),
          );
        }
      } else {
        const linkedInvId = trx.type === 'IMPORT' ? `INV-PUR-${trxId}` : `INV-SALES-${trxId}`;
        const linkedVouId = `VOU-INV-${linkedInvId}`;
        setInvoices(prev =>
          prev.filter(inv => {
            if (!inv) return true;
            const invNo = (inv as Invoice).invoiceNumber || '';
            if (invNo === ref || (sourceRef && invNo === sourceRef) || (voucherRef && invNo === voucherRef)) return false;
            if (inv.id === linkedInvId) return false;
            return true;
          }),
        );
        setAccountingVouchers(prev => prev.filter(v => v.id !== linkedVouId));
        setJournalEntries(prev =>
          prev.filter(je => {
            if (je.referenceId === ref || je.referenceId === sourceRef || je.referenceId === voucherRef || je.referenceId === trxId) return false;
            if (je.id === `JE-IM-${trxId}`) return false;
            if (je.id === `JE-EX-COST-${trxId}`) return false;
            if (je.id === `JE-EX-REV-${trxId}`) return false;
            if (je.id === `JE-VOU-${linkedVouId}`) return false;
            return true;
          }),
        );
        setFundTransactions(prev =>
          prev.filter(ft => {
            if (ft.referenceDoc === ref || ft.referenceDoc === sourceRef || ft.referenceDoc === voucherRef || ft.voucherNumber === ref || ft.voucherNumber === voucherRef || ft.referenceDoc === trxId) return false;
            if (ft.id === `FT-PUR-${trxId}`) return false;
            if (ft.id === `FT-SALES-${trxId}`) return false;
            if (ft.id === `FT-INV-${linkedInvId}`) return false;
            return true;
          }),
        );
      }

      setYearDataByKey((prev) => {
        const out = { ...prev } as Record<YearKey, YearData>;
        for (const k of Object.keys(out)) {
          const slice = out[k];
          if (!slice) continue;
          out[k] = purgeWarehouseArtifactFromYearDataSlice(slice, {
            peerIds,
            peerTrxs: peerTrxsSnapshot,
            batchId,
            trxId: trx.id,
            headType: peerTrxs[0]?.type,
            ref,
            sourceRef,
            voucherRef,
            isActiveBucket: k === activeYearKeyRef.current,
          });
        }
        return out;
      });
      transactionsRef.current = transactionsRef.current.filter((x) => !peerIds.has(x.id));
      invoicesRef.current = invoicesRef.current.filter(
        (inv) => !lcItems.some((item) => item.storeType === 'invoices' && item.id === inv.id),
      );
      journalEntriesRef.current = journalEntriesRef.current.filter((je) => !journalLcIds.has(String(je.id || '')));
      if (!forceSkipInventoryRollback && !skipOuterInventorySet) {
        inventoryRef.current = workingInv;
        inventoryCatalogRef.current = syncCatalogFromInventoryRows(
          inventoryCatalogRef.current,
          workingInv,
          new Set(peerTrxs.map((t) => t.itemId).filter(Boolean)),
        );
      }
      yearDataByKeyRef.current = Object.fromEntries(
        Object.entries(yearDataByKeyRef.current).map(([k, slice]) => [
          k,
          slice
            ? purgeWarehouseArtifactFromYearDataSlice(slice, {
                peerIds,
                peerTrxs: peerTrxsSnapshot,
                batchId,
                trxId: trx.id,
                headType: peerTrxs[0]?.type,
                ref,
                sourceRef,
                voucherRef,
                isActiveBucket: k === activeYearKeyRef.current,
              })
            : slice,
        ]),
      ) as Record<YearKey, YearData>;

      const lc = await callLifecycleSoftDeleteMany(lcItems, 'xóa phiếu kho');
      if (!lc.ok) {
        scheduleRemoteStateReloadRef.current();
        if (!opts?.silent) window.alert(`Không thể đưa vào thùng rác: ${lc.error}`);
        return false;
      }
      if (!opts?.silent) notifySoftDeleted(ref || trxId);

      return true;
    };

    return await deleteOne(id, opts);
  };
  const handleFundAction = (data: Partial<FundTransaction>) => {
    const postingDate = (data?.date || new Date().toISOString().split('T')[0]).split('T')[0];
    if (!assertEditableDate(postingDate, 'tạo phiếu thu/chi')) return;
    const type = data.type === 'PAYMENT' ? 'PAYMENT' : 'RECEIPT';
    const method = data.method === 'BANK' ? 'BANK' : 'CASH';
    const resolvedBank = method === 'BANK'
      ? resolveBankSelection(data, { requireActive: true })
      : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
    if (method === 'BANK') {
      if (resolvedBank.error) {
        window.alert(resolvedBank.error);
        return;
      }
      if (!resolvedBank.bankAccount) {
        window.alert('Vui lòng chọn tài khoản ngân hàng trước khi lưu phiếu.');
        return;
      }
    }
    const trxId = `FT-${Date.now()}`;
    const voucherNumber = reserveDocumentNumber(getFundDocumentPrefix(type, method), postingDate);
    const newFT = {
      ...data,
      id: trxId,
      voucherNumber,
      date: postingDate,
      type,
      method,
      ...(method === 'BANK' ? resolvedBank.snapshot : clearBankAccountSnapshot()),
    } as FundTransaction;
    setFundTransactions(prev => [...prev, newFT]);
    const sideAcc = method === 'BANK'
      ? resolveCashBankAccountFromPaymentMethod(newFT.method, newFT.bankLedgerAccountCode)
      : '1111';
    const contraAcc = newFT.accountingType || '811';
    const voucherRef = newFT.voucherNumber || newFT.referenceDoc || trxId;
    const contraIsArAp =
      String(contraAcc).startsWith('131') || String(contraAcc).startsWith('331');
    const arApLeg = contraIsArAp
      ? resolveArApLedgerMetaForFundTransaction(newFT, invoices, customers, suppliers)
      : null;
    const arApFields = arApLeg
      ? {
          objectId: arApLeg.objectId,
          objectName: arApLeg.objectName,
          objectType: arApLeg.objectType,
          sourceInvoiceId: arApLeg.sourceInvoiceId,
          sourceInvoiceNumber: arApLeg.sourceInvoiceNumber,
        }
      : {};
    const ftDetails =
      newFT.type === 'RECEIPT'
        ? [
            { account: sideAcc, debit: newFT.amount, credit: 0 },
            { account: contraAcc, debit: 0, credit: newFT.amount, ...arApFields },
          ]
        : [
            { account: contraAcc, debit: newFT.amount, credit: 0, ...arApFields },
            { account: sideAcc, debit: 0, credit: newFT.amount },
          ];
    setJournalEntries(prev => [...prev, {
      id: `JE-FT-${trxId}`, date: newFT.date, referenceId: voucherRef, description: newFT.description,
      details: ftDetails,
    }]);
    setInvoices((prev) => applyInvoicePaidSyncFromFundTransaction(prev, newFT, customers, suppliers));
  };
  const handleDeleteFundTransaction = async (id: string) => {
    const ft = fundTransactions.find(t => t.id === id);
    const postingDate = (ft?.date || new Date().toISOString().split('T')[0]).split('T')[0];
    if (!assertEditableDate(postingDate, 'xóa phiếu thu/chi')) return;
    persistEpochRef.current += 1;
    recordEntityDeletion('fundTransactions', id, ft?.voucherNumber || ft?.referenceDoc || id, ft, 'delete_fund_transaction', 'FundTransaction');
    purgeJournalEntriesAcrossYears('fundTransaction', id, ft ? (ft as unknown as Record<string, unknown>) : null);
    setFundTransactions(prev => prev.filter(t => t.id !== id));
    const lc = await callLifecycleSoftDelete('fundTransactions', id);
    if (!lc.ok) {
      scheduleRemoteStateReloadRef.current();
      window.alert(`Không thể đưa vào thùng rác: ${lc.error}`);
      return;
    }
    notifySoftDeleted(ft?.voucherNumber || ft?.referenceDoc || id);
  };

  const handleSaveBankAccount = (item: Partial<BankAccount>) => {
    const normalized = normalizeBankAccountRecord(item);
    if (!normalized) {
      return { ok: false, error: 'Vui lòng nhập đủ ngân hàng, số tài khoản, chủ tài khoản và tài khoản kế toán liên kết.' };
    }
    if (!isBankLedgerChildAccountCode(normalized.linkedAccountCode)) {
      return {
        ok: false,
        error: 'Tài khoản kế toán liên kết phải là tài khoản con thuộc 1121 (ví dụ 112101 hoặc 112101MB).',
      };
    }
    const duplicateAccountNumber = bankAccounts.find(
      (bank) => bank.id !== normalized.id && bank.accountNumber === normalized.accountNumber,
    );
    if (duplicateAccountNumber) {
      return { ok: false, error: `Số tài khoản ${normalized.accountNumber} đã tồn tại trong danh mục.` };
    }
    const duplicateLinkedAccount = bankAccounts.find(
      (bank) => bank.id !== normalized.id && bank.linkedAccountCode === normalized.linkedAccountCode,
    );
    if (duplicateLinkedAccount) {
      return {
        ok: false,
        error: `Tài khoản ${normalized.linkedAccountCode} đã được liên kết với ${duplicateLinkedAccount.bankName}.`,
      };
    }
    setBankAccounts((prev) => {
      const exists = prev.some((bank) => bank.id === normalized.id);
      const next = exists
        ? prev.map((bank) => (bank.id === normalized.id ? normalized : bank))
        : [...prev, normalized];
      return normalizeBankAccounts(next);
    });
    setAccounts((prev) => {
      if (prev.some((account) => String(account.code) === normalized.linkedAccountCode)) return prev;
      return mergeAccountsWithDefaults([...prev, buildBankLinkedAccountDefinition(normalized)]);
    });
    return { ok: true, bankAccount: normalized };
  };

  const handleDeleteBankAccount = async (id: string) => {
    const target = bankAccounts.find((bank) => bank.id === id);
    if (!target) return { ok: false, error: 'Không tìm thấy tài khoản ngân hàng cần xóa.' };
    const hasFundTransactions = fundTransactions.some(
      (ft) => ft.bankAccountId === id || ft.bankLedgerAccountCode === target.linkedAccountCode,
    );
    const hasJournalEntries = journalEntries.some((entry) =>
      (entry.details || []).some((detail) => String(detail.account || '') === target.linkedAccountCode),
    );
    const hasVouchers = accountingVouchers.some((voucher) =>
      (voucher.details || []).some(
        (detail) =>
          String(detail.debitAccount || '') === target.linkedAccountCode ||
          String(detail.creditAccount || '') === target.linkedAccountCode,
      ),
    );
    if (hasFundTransactions || hasJournalEntries || hasVouchers) {
      return { ok: false, error: 'Không thể xóa tài khoản ngân hàng đã phát sinh giao dịch.' };
    }
    persistEpochRef.current += 1;
    recordEntityDeletion('bankAccounts', id, target.accountNumber || target.bankName || id, target, 'delete_bank_account', 'BankAccount');
    setBankAccounts((prev) => prev.filter((bank) => bank.id !== id));
    const lc = await callLifecycleSoftDelete('bankAccounts', id);
    if (!lc.ok) {
      scheduleRemoteStateReloadRef.current();
      return { ok: false, error: lc.error };
    }
    notifySoftDeleted(target.accountNumber || target.bankName || id);
    return { ok: true };
  };

  const handleToggleBankAccountStatus = (id: string) => {
    setBankAccounts((prev) =>
      prev.map((bank) =>
        bank.id === id
          ? { ...bank, status: bank.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }
          : bank,
      ),
    );
  };

  /** TSCĐ/CCDC từ form Danh mục / Excel — không sinh hóa đơn mua tài sản. */
  const buildCatalogAssetFromPartial = (partial: any, idFallback: string): Asset => {
    const id = String(partial.id || idFallback || Date.now()).trim();
    const type: 'TSCĐ' | 'CCDC' = partial.type === 'CCDC' ? 'CCDC' : 'TSCĐ';
    const cost = Number(partial.cost ?? 0) || 0;
    const buyDate = String(partial.buyDate || new Date().toISOString().split('T')[0]).slice(0, 10);
    const useDate = String(partial.useDate || partial.buyDate || buyDate).slice(0, 10);
    const accD = type === 'TSCĐ' ? Number(partial.accumulatedDepreciation ?? 0) : 0;
    const accA = type === 'CCDC' ? Number(partial.accumulatedAllocation ?? 0) : 0;
    const residual =
      partial.residualValue != null && partial.residualValue !== ''
        ? Number(partial.residualValue)
        : Math.max(0, cost - (type === 'TSCĐ' ? accD : accA));
    return {
      id,
      code: String(partial.code || id),
      name: String(partial.name || ''),
      type,
      assetGroup: String(partial.assetGroup || ''),
      assetAccount: String(partial.assetAccount || (type === 'TSCĐ' ? '2112' : '242')),
      depreciationAccount: String(partial.depreciationAccount || (type === 'TSCĐ' ? '214' : '242')),
      cost,
      vatRate: partial.vatRate != null && partial.vatRate !== '' ? Number(partial.vatRate) : 0,
      vatAmount: partial.vatAmount != null && partial.vatAmount !== '' ? Number(partial.vatAmount) : 0,
      purchaseInvoiceNumber: partial.purchaseInvoiceNumber,
      purchaseFormNo: partial.purchaseFormNo,
      purchaseSymbolCode: partial.purchaseSymbolCode,
      buyDate,
      useDate,
      usefulLife: Number(partial.usefulLife ?? 36) || 36,
      accumulatedDepreciation: type === 'TSCĐ' ? accD : 0,
      accumulatedAllocation: type === 'CCDC' ? accA : 0,
      residualValue: residual,
      department: String(partial.department || ''),
      status: partial.status === 'LIQUIDATED' ? 'LIQUIDATED' : 'ACTIVE',
      supplierName: partial.supplierName,
      supplierAddress: partial.supplierAddress,
      supplierTaxCode: partial.supplierTaxCode,
      supplierPhone: partial.supplierPhone,
      salvageValue:
        type === 'TSCĐ' && partial.salvageValue != null && partial.salvageValue !== ''
          ? Number(partial.salvageValue)
          : undefined,
      expenseAccount: partial.expenseAccount,
      ccdcLifecycle:
        type === 'CCDC'
          ? partial.ccdcLifecycle === 'STOCK_153'
            ? 'STOCK_153'
            : 'IN_USE'
          : undefined,
      liquidationDate: partial.liquidationDate,
      liquidationPostingDate: partial.liquidationPostingDate,
      liquidationAdditionalDepreciation:
        partial.liquidationAdditionalDepreciation != null && partial.liquidationAdditionalDepreciation !== ''
          ? Number(partial.liquidationAdditionalDepreciation)
          : undefined,
      liquidationWriteoffAmount:
        partial.liquidationWriteoffAmount != null && partial.liquidationWriteoffAmount !== ''
          ? Number(partial.liquidationWriteoffAmount)
          : undefined,
      liquidationProceedsAmount:
        partial.liquidationProceedsAmount != null && partial.liquidationProceedsAmount !== ''
          ? Number(partial.liquidationProceedsAmount)
          : undefined,
      liquidationVatRate:
        partial.liquidationVatRate != null && partial.liquidationVatRate !== ''
          ? Number(partial.liquidationVatRate)
          : undefined,
      liquidationVatAmount:
        partial.liquidationVatAmount != null && partial.liquidationVatAmount !== ''
          ? Number(partial.liquidationVatAmount)
          : undefined,
      liquidationTotalAmount:
        partial.liquidationTotalAmount != null && partial.liquidationTotalAmount !== ''
          ? Number(partial.liquidationTotalAmount)
          : undefined,
      liquidationReceiptAccount: partial.liquidationReceiptAccount,
    };
  };

  const handleAddCatalogItem = (type: string, item: any) => {
    const newItem = { ...item, id: String(item?.id || '').trim() || newEntityId() };
    switch (type) {
      case 'ACCOUNTS':
        setAccounts((prev) => [...prev, newItem]);
        break;
      case 'CUSTOMERS':
        setCustomers((prev) => [...prev, newItem]);
        break;
      case 'SUPPLIERS':
        setSuppliers((prev) => [...prev, newItem]);
        break;
      case 'EMPLOYEES':
        setEmployees((prev) => [...prev, newItem]);
        break;
      case 'WAREHOUSES':
        setWarehouses((prev) => normalizeWarehouses([...prev, newItem]));
        break;
      case 'ASSETS': {
        const nid = String(item.id || '').trim() || newEntityId();
        const built = buildCatalogAssetFromPartial({ ...item, id: nid }, nid);
        setAssets((prev) => [...prev, built]);
        break;
      }
      case 'EXPENSES':
        setExpenseCategories((prev) => [...prev, newItem]);
        break;
      case 'TAXES':
        setTaxRates((prev) => [...prev, newItem]);
        break;
      case 'PAYMENT_METHODS':
        setPaymentMethods((prev) => [...prev, newItem]);
        break;
      case 'ITEMS': {
        const nid = String(item.id || '').trim() || newEntityId();
        const catalogRow: InventoryItem = {
          id: nid,
          sku: String(item.sku || `SKU-${nid}`).trim() || `SKU-${nid}`,
          name: String(item.name || item.sku || 'Vật tư').trim() || 'Vật tư',
          unit: String(item.unit || 'Cái').trim() || 'Cái',
          category: String(item.category || 'Chung').trim() || 'Chung',
          quantity: 0,
          minStock: Number(item.minStock ?? 0),
          costPrice: Number(item.costPrice ?? 0),
          sellingPrice: Number(item.sellingPrice ?? 0),
          accountCode: item.accountCode,
          costAccount: item.costAccount,
          trackingType: item.trackingType,
        };
        const normalizedCatalogRow = ensureWarehouseBalances(catalogRow, getDefaultWarehouseId(warehouses));
        setInventoryCatalog((prev) => [...prev, normalizedCatalogRow]);
        const invRow: InventoryItem = ensureWarehouseBalances(
          {
            ...catalogRow,
            quantity: Number(item.quantity ?? 0),
            serials: [],
            serialDetails: [],
          },
          getDefaultWarehouseId(warehouses),
        );
        setInventory((prev) => {
          if (prev.some((i) => i.id === nid)) return prev;
          return [...prev, invRow];
        });
        const seedForYear: InventoryItem = ensureWarehouseBalances(
          {
            ...catalogRow,
            quantity: 0,
            serials: [],
            serialDetails: [],
            warehouseBalances: [],
          },
          getDefaultWarehouseId(warehouses),
        );
        setYearDataByKey((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([yk, yd]) => {
              const inv = yd.inventory || [];
              if (inv.some((i) => i.id === nid)) return [yk, yd];
              return [yk, { ...yd, inventory: [...inv, seedForYear] }];
            }),
          ) as Record<YearKey, YearData>,
        );
        break;
      }
    }
  };
  const handleUpdateCatalogItem = (type: string, item: any) => {
    switch (type) {
      case 'ACCOUNTS':
        setAccounts((prev) => prev.map((i) => (i.id === item.id ? item : i)));
        break;
      case 'CUSTOMERS':
        setCustomers((prev) => prev.map((i) => (i.id === item.id ? item : i)));
        break;
      case 'SUPPLIERS':
        setSuppliers((prev) => prev.map((i) => (i.id === item.id ? item : i)));
        break;
      case 'EMPLOYEES':
        setEmployees((prev) => prev.map((i) => (i.id === item.id ? item : i)));
        break;
      case 'WAREHOUSES':
        setWarehouses((prev) => normalizeWarehouses(prev.map((i) => (i.id === item.id ? item : i))));
        break;
      case 'ASSETS': {
        const id = String(item?.id || '');
        if (!id) break;
        setAssets((prev) => {
          const ex = prev.find((a) => a.id === id);
          const merged = buildCatalogAssetFromPartial({ ...(ex || {}), ...item }, id);
          const next = prev.map((a) => (a.id === id ? merged : a));
          return reconcileAllAssetsWithJournal(next, getAllJournalEntriesAcrossYearsInternal());
        });
        break;
      }
      case 'EXPENSES':
        setExpenseCategories((prev) => prev.map((i) => (i.id === item.id ? item : i)));
        break;
      case 'TAXES':
        setTaxRates((prev) => prev.map((i) => (i.id === item.id ? item : i)));
        break;
      case 'PAYMENT_METHODS':
        setPaymentMethods((prev) => prev.map((i) => (i.id === item.id ? item : i)));
        break;
      case 'ITEMS': {
        const id = String(item?.id || '');
        if (!id) break;
        removeEntityTombstones({ inventory: [id] });
        const prevCat = inventoryCatalogRef.current.find((i) => i.id === id);
        const base: InventoryItem =
          prevCat || {
            id,
            sku: String(item.sku || `SKU-${id}`).trim() || `SKU-${id}`,
            name: String(item.name || item.sku || 'Vật tư').trim() || 'Vật tư',
            unit: String(item.unit || 'Cái').trim() || 'Cái',
            category: String(item.category || 'Chung').trim() || 'Chung',
            quantity: 0,
            minStock: Number(item.minStock ?? 0),
            costPrice: Number(item.costPrice ?? 0),
            sellingPrice: Number(item.sellingPrice ?? 0),
          };
        const merged: InventoryItem = ensureWarehouseBalances({
          ...base,
          ...item,
          id,
          sku: String(item.sku ?? base.sku).trim() || base.sku,
          name: String(item.name ?? base.name).trim() || base.name,
          unit: String(item.unit ?? base.unit).trim() || base.unit,
          category: String(item.category ?? base.category).trim() || base.category,
          minStock: Number(item.minStock ?? base.minStock ?? 0),
          costPrice: Number(item.costPrice ?? base.costPrice ?? 0),
          sellingPrice: Number(item.sellingPrice ?? base.sellingPrice ?? 0),
        }, getDefaultWarehouseId(warehouses));
        setInventoryCatalog((prev) => {
          const hasCat = prev.some((i) => i.id === id);
          if (!hasCat) return [...prev, merged];
          return prev.map((i) => (i.id === id ? merged : i));
        });
        const patchInv = (row: InventoryItem): InventoryItem => ({
          ...ensureWarehouseBalances(merged, getDefaultWarehouseId(warehouses)),
          quantity: row.quantity,
          serials: row.serials,
          serialDetails: row.serialDetails,
          warehouseBalances: cloneWarehouseBalances(row.warehouseBalances),
        });
        setInventory((prev) => {
          const has = prev.some((i) => i.id === id);
          if (!has) {
            return [
              ...prev,
              ensureWarehouseBalances(
                { ...merged, quantity: 0, serials: [], serialDetails: [], warehouseBalances: [] },
                getDefaultWarehouseId(warehouses),
              ),
            ];
          }
          return prev.map((i) => (i.id === id ? patchInv(i) : i));
        });
        setYearDataByKey((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([yk, yd]) => {
              const inv = yd.inventory || [];
              const has = inv.some((i) => i.id === id);
              const nextInv = has
                ? inv.map((i) => (i.id === id ? patchInv(i) : i))
                : [
                    ...inv,
                    ensureWarehouseBalances(
                      { ...merged, quantity: 0, serials: [], serialDetails: [], warehouseBalances: [] },
                      getDefaultWarehouseId(warehouses),
                    ),
                  ];
              return [
                yk,
                {
                  ...yd,
                  inventory: nextInv,
                },
              ];
            }),
          ) as Record<YearKey, YearData>,
        );
        break;
      }
    }
  };
  const handleDeleteCatalogItem = (type: string, id: string) => {
    switch (type) {
      case 'ACCOUNTS': {
        const target = accounts.find((item) => item.id === id);
        if (target && bankAccounts.some((bank) => bank.linkedAccountCode === target.code)) {
          window.alert('Không thể xóa tài khoản kế toán đang được liên kết với danh mục tài khoản ngân hàng.');
          break;
        }
        setAccounts((prev) => prev.filter((i) => i.id !== id));
        break;
      }
      case 'CUSTOMERS':
        setCustomers((prev) => prev.filter((i) => i.id !== id));
        break;
      case 'SUPPLIERS':
        setSuppliers((prev) => prev.filter((i) => i.id !== id));
        break;
      case 'EMPLOYEES':
        setEmployees((prev) => prev.filter((i) => i.id !== id));
        break;
      case 'WAREHOUSES': {
        const oldDefaultId = getDefaultWarehouseId(warehouses);
        const remaining = warehouses.filter((i) => i.id !== id);
        if (remaining.length === 0) {
          window.alert('Phải có ít nhất một kho trong danh mục.');
          break;
        }
        const normalizedRemaining = normalizeWarehouses(remaining);
        const replacementId = getDefaultWarehouseId(normalizedRemaining);
        const replacementName = normalizedRemaining.find((w) => w.id === replacementId)?.name;

        setInventory((prev) => remapInventoryRowsWarehouseId(prev, id, replacementId, replacementId));
        setInventoryCatalog((prev) => remapInventoryRowsWarehouseId(prev, id, replacementId, replacementId));
        setTransactions((prev) =>
          remapTransactionsWarehouseIds(prev, id, replacementId, oldDefaultId, replacementName),
        );
        setProductionOrders((prev) =>
          remapProductionOrdersWarehouseIds(prev, id, replacementId, oldDefaultId, replacementName),
        );
        setYearDataByKey((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([yk, yd]) => [
              yk,
              {
                ...yd,
                inventory: remapInventoryRowsWarehouseId(yd.inventory || [], id, replacementId, replacementId),
                transactions: remapTransactionsWarehouseIds(
                  yd.transactions || [],
                  id,
                  replacementId,
                  oldDefaultId,
                  replacementName,
                ),
                productionOrders: remapProductionOrdersWarehouseIds(
                  yd.productionOrders || [],
                  id,
                  replacementId,
                  oldDefaultId,
                  replacementName,
                ),
              },
            ]),
          ) as Record<YearKey, YearData>,
        );
        setWarehouseFormHints((prev) =>
          prev.warehouseId === id ? { ...prev, warehouseId: replacementId } : prev,
        );
        setWarehouses(normalizedRemaining);
        break;
      }
      case 'EXPENSES':
        setExpenseCategories((prev) => prev.filter((i) => i.id !== id));
        break;
      case 'TAXES':
        setTaxRates((prev) => prev.filter((i) => i.id !== id));
        break;
      case 'PAYMENT_METHODS':
        setPaymentMethods((prev) => prev.filter((i) => i.id !== id));
        break;
      case 'ITEMS':
        setInventoryCatalog((prev) => prev.filter((i) => i.id !== id));
        setInventory((prev) => prev.filter((i) => i.id !== id));
        setYearDataByKey((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([yk, yd]) => [
              yk,
              { ...yd, inventory: (yd.inventory || []).filter((i) => i.id !== id) },
            ]),
          ) as Record<YearKey, YearData>,
        );
        setBomDefinitions((prev) =>
          prev
            .map((definition) => {
              if (definition.parentItemId === id) return null;
              const hadRemovedComponent = (definition.components || []).some(
                (component) => component.componentItemId === id,
              );
              if (!hadRemovedComponent) return definition;
              return normalizeBomDefinition({
                ...definition,
                components: (definition.components || []).filter(
                  (component) => component.componentItemId !== id,
                ),
                updatedAt: new Date().toISOString(),
              });
            })
            .filter((definition): definition is BomDefinition => Boolean(definition)),
        );
        break;
    }
  };

  const handleImportInventoryCatalogFromExcel = (rows: Record<string, unknown>[]) => {
    suppressPersistUntilRef.current = Date.now() + 4000;
    const defaultWarehouseId = getDefaultWarehouseId(warehouses);
    const batch = applyInventoryExcelImportBatch(
      rows,
      inventoryCatalogRef.current,
      inventoryRef.current,
      newEntityId,
    );
    const nextCatalog = normalizeInventoryRows(batch.catalog, defaultWarehouseId);
    const nextInventory = normalizeInventoryRows(batch.inventory, defaultWarehouseId);
    const importedInventoryIds = nextInventory.map((row) => String(row.id || '')).filter(Boolean);
    if (importedInventoryIds.length > 0) {
      removeEntityTombstones({ inventory: importedInventoryIds });
    }
    setInventoryCatalog(nextCatalog);
    setInventory(nextInventory);
    setYearDataByKey((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([yk, yd]) => {
          const inv = yd.inventory || [];
          const byId = new Map(inv.map((row) => [String(row.id), row]));
          for (const row of nextInventory) {
            const existing = byId.get(String(row.id));
            if (existing) {
              byId.set(String(row.id), {
                ...existing,
                sku: row.sku,
                name: row.name,
                unit: row.unit,
                category: row.category,
                minStock: row.minStock,
                costPrice: row.costPrice,
                sellingPrice: row.sellingPrice,
                accountCode: row.accountCode,
                costAccount: row.costAccount,
                trackingType: row.trackingType,
              });
            } else {
              byId.set(String(row.id), {
                ...row,
                quantity: 0,
                serials: [],
                serialDetails: [],
                warehouseBalances: [],
              });
            }
          }
          return [yk, { ...yd, inventory: Array.from(byId.values()) }];
        }),
      ) as Record<YearKey, YearData>,
    );
    return { added: batch.added, updated: batch.updated, errors: batch.errors };
  };

  const handleUpsertBomDefinition = (definition: BomDefinition) => {
    const nextDefinition = normalizeBomDefinition({
      ...definition,
      id: String(definition?.id || '').trim() || newEntityId(),
      updatedAt: new Date().toISOString(),
    });
    if (!nextDefinition.parentItemId) {
      window.alert('BOM phải gắn với một mã hàng hoặc dịch vụ cha.');
      return;
    }
    setBomDefinitions((prev) => {
      const existing = prev.find((item) => item.id === nextDefinition.id);
      if (!existing) return [...prev, nextDefinition];
      const merged = normalizeBomDefinition({
        ...existing,
        ...nextDefinition,
        id: existing.id,
        updatedAt: nextDefinition.updatedAt,
      });
      return prev.map((item) => (item.id === existing.id ? merged : item));
    });
  };
  const handleDeleteBomDefinition = (id: string) => {
    const targetId = String(id || '').trim();
    if (!targetId) return;
    setBomDefinitions((prev) => prev.filter((definition) => definition.id !== targetId));
  };
  const normalizeProductionOrderDraft = (
    order: ProductionOrder,
    existing?: ProductionOrder,
  ): ProductionOrder => {
    const normalizedWarehouses = normalizeWarehouses(warehouses);
    const defaultWarehouse = getDefaultWarehouse(normalizedWarehouses);
    const warehouseMap = new Map(normalizedWarehouses.map((warehouse) => [warehouse.id, warehouse]));
    const sourceWarehouseId = String(order.sourceWarehouseId || defaultWarehouse.id).trim() || defaultWarehouse.id;
    const targetWarehouseId = String(order.targetWarehouseId || sourceWarehouseId).trim() || sourceWarehouseId;
    const now = new Date().toISOString();
    const quantity = Math.max(0, Number(order.quantity || 0));
    const outputQuantity = Math.max(0, Number(order.output?.quantity || quantity));
    const normalizedMaterials: ProductionOrderMaterialLine[] = (order.materials || [])
      .filter((line) => String(line.itemId || '').trim())
      .map((line) => ({
        ...line,
        id: String(line.id || '').trim() || newEntityId(),
        itemId: String(line.itemId || '').trim(),
        itemName: String(line.itemName || '').trim() || line.itemSku || 'Vật tư',
        itemSku: String(line.itemSku || '').trim() || undefined,
        unit: String(line.unit || '').trim() || undefined,
        requiredQuantity: Math.max(0, Number(line.requiredQuantity || 0)),
        actualQuantity: Math.max(0, Number(line.actualQuantity ?? line.requiredQuantity ?? 0)),
        sourceWarehouseId: String(line.sourceWarehouseId || sourceWarehouseId).trim() || sourceWarehouseId,
        sourceWarehouseName:
          String(line.sourceWarehouseName || '').trim() ||
          warehouseMap.get(String(line.sourceWarehouseId || sourceWarehouseId).trim() || sourceWarehouseId)?.name ||
          warehouseMap.get(sourceWarehouseId)?.name,
        bomComponentCategory: line.bomComponentCategory,
        bomLossRate: Math.max(0, Number(line.bomLossRate || 0)),
        bomPlannedQuantity: Math.max(0, Number(line.bomPlannedQuantity ?? line.requiredQuantity ?? 0)),
        note: String(line.note || '').trim() || undefined,
      }));
    const normalizedOutput = {
      ...order.output,
      itemId: String(order.output?.itemId || order.parentItemId || '').trim(),
      itemName: String(order.output?.itemName || order.parentItemName || '').trim() || order.parentItemSku || 'Thành phẩm',
      itemSku: String(order.output?.itemSku || order.parentItemSku || '').trim() || undefined,
      unit: String(order.output?.unit || '').trim() || undefined,
      quantity: outputQuantity,
      targetWarehouseId,
      targetWarehouseName:
        String(order.output?.targetWarehouseName || '').trim() ||
        warehouseMap.get(targetWarehouseId)?.name ||
        warehouseMap.get(sourceWarehouseId)?.name,
      unitCost: order.output?.unitCost != null ? Math.max(0, Number(order.output.unitCost || 0)) : undefined,
      totalCost: order.output?.totalCost != null ? Math.max(0, Number(order.output.totalCost || 0)) : undefined,
    };
    return {
      ...existing,
      ...order,
      id: String(order.id || existing?.id || '').trim() || newEntityId(),
      orderNumber:
        String(order.orderNumber || existing?.orderNumber || '').trim() ||
        reserveDocumentNumber('LSX', order.startDate || existing?.startDate),
      parentItemId: String(order.parentItemId || existing?.parentItemId || '').trim(),
      parentItemName: String(order.parentItemName || existing?.parentItemName || '').trim() || order.parentItemSku || 'Sản phẩm',
      parentItemSku: String(order.parentItemSku || existing?.parentItemSku || '').trim() || undefined,
      bomDefinitionId: String(order.bomDefinitionId || existing?.bomDefinitionId || '').trim(),
      bomVersionCode: String(order.bomVersionCode || existing?.bomVersionCode || '').trim() || undefined,
      quantity,
      startDate: String(order.startDate || existing?.startDate || '').trim() || new Date().toISOString().split('T')[0],
      dueDate: String(order.dueDate || existing?.dueDate || '').trim() || undefined,
      completionDate: String(order.completionDate || existing?.completionDate || '').trim() || undefined,
      sourceWarehouseId,
      sourceWarehouseName:
        String(order.sourceWarehouseName || existing?.sourceWarehouseName || '').trim() ||
        warehouseMap.get(sourceWarehouseId)?.name,
      targetWarehouseId,
      targetWarehouseName:
        String(order.targetWarehouseName || existing?.targetWarehouseName || '').trim() ||
        warehouseMap.get(targetWarehouseId)?.name,
      status: order.status || existing?.status || 'DRAFT',
      note: String(order.note || existing?.note || '').trim() || undefined,
      materials: normalizedMaterials,
      output: normalizedOutput,
      shortageCount: order.shortageCount ?? existing?.shortageCount ?? 0,
      totalPlannedCost:
        order.totalPlannedCost != null
          ? Math.max(0, Number(order.totalPlannedCost || 0))
          : existing?.totalPlannedCost,
      unitPlannedCost:
        order.unitPlannedCost != null ? Math.max(0, Number(order.unitPlannedCost || 0)) : existing?.unitPlannedCost,
      releasedAt: order.releasedAt || existing?.releasedAt,
      releasedBy: order.releasedBy || existing?.releasedBy,
      completedAt: order.completedAt || existing?.completedAt,
      completedBy: order.completedBy || existing?.completedBy,
      linkedIssueTransactionIds: order.linkedIssueTransactionIds || existing?.linkedIssueTransactionIds,
      linkedReceiptTransactionIds: order.linkedReceiptTransactionIds || existing?.linkedReceiptTransactionIds,
      linkedJournalEntryIds: order.linkedJournalEntryIds || existing?.linkedJournalEntryIds,
      createdAt: existing?.createdAt || order.createdAt || now,
      createdBy: existing?.createdBy || order.createdBy || 'Admin',
      updatedAt: now,
    };
  };
  const handleUpsertProductionOrder = (order: ProductionOrder) => {
    const existing = productionOrders.find((entry) => entry.id === order.id);
    const normalized = normalizeProductionOrderDraft(order, existing);
    if (!normalized.parentItemId) {
      window.alert('Lệnh sản xuất phải chọn sản phẩm cha.');
      return false;
    }
    if (!normalized.bomDefinitionId) {
      window.alert('Lệnh sản xuất phải gắn với một BOM version hợp lệ.');
      return false;
    }
    if (normalized.quantity <= 0 || normalized.output.quantity <= 0) {
      window.alert('Số lượng lệnh sản xuất và số lượng thành phẩm phải lớn hơn 0.');
      return false;
    }
    if ((normalized.materials || []).length === 0) {
      window.alert('Lệnh sản xuất phải có ít nhất một dòng vật tư.');
      return false;
    }
    setProductionOrders((prev) => {
      if (!existing) return [...prev, normalized];
      return prev.map((entry) => (entry.id === normalized.id ? normalized : entry));
    });
    return true;
  };
  const handleDeleteProductionOrder = (id: string) => {
    const targetId = String(id || '').trim();
    if (!targetId) return;
    const target = productionOrders.find((entry) => entry.id === targetId);
    if (!target) return;
    if (target.status === 'COMPLETED') {
      window.alert('Không thể xóa lệnh sản xuất đã hoàn thành vì đã phát sinh kho và bút toán liên quan.');
      return;
    }
    setProductionOrders((prev) => prev.filter((entry) => entry.id !== targetId));
  };
  const handleReleaseProductionOrder = (id: string) => {
    const targetId = String(id || '').trim();
    if (!targetId) return false;
    const target = productionOrders.find((entry) => entry.id === targetId);
    if (!target) return false;
    if (target.status === 'COMPLETED' || target.status === 'CANCELLED') return false;
    const now = new Date().toISOString();
    setProductionOrders((prev) =>
      prev.map((entry) =>
        entry.id === targetId
          ? {
              ...entry,
              status: 'RELEASED',
              releasedAt: entry.releasedAt || now,
              releasedBy: entry.releasedBy || 'Admin',
              updatedAt: now,
            }
          : entry,
      ),
    );
    return true;
  };
  const handleCompleteProductionOrder = (id: string, opts?: { completionDate?: string }) => {
    const targetId = String(id || '').trim();
    if (!targetId) return false;
    const target = productionOrders.find((entry) => entry.id === targetId);
    if (!target) return false;
    if (target.status === 'COMPLETED') {
      window.alert('Lệnh sản xuất này đã hoàn thành.');
      return false;
    }
    if (target.status === 'CANCELLED') {
      window.alert('Không thể hoàn thành lệnh sản xuất đã hủy.');
      return false;
    }
    const defaultCompletionDate = new Date().toISOString().split('T')[0];
    const completionDate = String(opts?.completionDate || target.completionDate || defaultCompletionDate).trim() || defaultCompletionDate;
    if (!assertEditableDate(completionDate, 'hoàn thành lệnh sản xuất')) return false;
    const normalizedTarget = normalizeProductionOrderDraft({ ...target, completionDate }, target);
    const finishedItem =
      inventoryCatalogRef.current.find((item) => item.id === normalizedTarget.parentItemId) ||
      inventory.find((item) => item.id === normalizedTarget.parentItemId);
    if (!finishedItem) {
      window.alert('Không tìm thấy thành phẩm trong danh mục để hoàn thành lệnh sản xuất.');
      return false;
    }
    const materialLines = (normalizedTarget.materials || []).filter(
      (line) => String(line.itemId || '').trim() && Math.max(0, Number(line.actualQuantity || 0)) > 0,
    );
    if (materialLines.length === 0) {
      window.alert('Lệnh sản xuất chưa có vật tư thực tế để xuất kho.');
      return false;
    }
    const varianceDetected = materialLines.some(
      (line) => Math.abs(Number(line.actualQuantity || 0) - Number(line.requiredQuantity || 0)) > 1e-6,
    );
    const inventoryMap = new Map(warehouseInventoryItems.map((item) => [String(item.id || '').trim(), item]));
    const totalIssueCost = Number(
      materialLines
        .reduce((sum, line) => sum + Math.max(0, Number(line.actualQuantity || 0)) * Number(inventoryMap.get(line.itemId)?.costPrice || 0), 0)
        .toFixed(6),
    );
    const outputQuantity = Math.max(0, Number(normalizedTarget.output.quantity || normalizedTarget.quantity || 0));
    if (outputQuantity <= 0) {
      window.alert('Số lượng nhập thành phẩm phải lớn hơn 0.');
      return false;
    }
    const unitCost = outputQuantity > 0 ? Number((totalIssueCost / outputQuantity).toFixed(6)) : 0;
    const issuePayload: StockBatchPayload = {
      actionType: 'EXPORT',
      date: completionDate,
      warehouseId: normalizedTarget.sourceWarehouseId,
      warehouseName: normalizedTarget.sourceWarehouseName,
      performer: 'Admin',
      note: `Xuất NVL cho ${normalizedTarget.orderNumber}`,
      supplier: '',
      documentRef: normalizedTarget.orderNumber,
      exportPurpose: '154',
      costObjectType: 'BOM_PARENT',
      costObjectId: normalizedTarget.parentItemId,
      costObjectName: normalizedTarget.parentItemName,
      costObjectSku: normalizedTarget.parentItemSku,
      bomDefinitionId: normalizedTarget.bomDefinitionId,
      bomParentQuantity: normalizedTarget.quantity,
      bomVarianceReason: varianceDetected ? `LSX ${normalizedTarget.orderNumber} dùng thực tế khác định mức.` : undefined,
      productionOrderId: normalizedTarget.id,
      productionOrderCode: normalizedTarget.orderNumber,
      postingMode: 'PRODUCTION_ISSUE',
      lines: materialLines.map((line) => ({
        itemId: line.itemId,
        qty: Math.max(0, Number(line.actualQuantity || 0)),
        price: Number(inventoryMap.get(line.itemId)?.costPrice || 0),
        vat: 0,
        serials: '',
        note: line.note,
        bomPlannedQuantity: line.requiredQuantity,
        bomLossRate: line.bomLossRate,
        bomAccount154Category: line.bomComponentCategory,
      })),
    };
    const receiptPayload: StockBatchPayload = {
      actionType: 'IMPORT',
      date: completionDate,
      warehouseId: normalizedTarget.targetWarehouseId,
      warehouseName: normalizedTarget.targetWarehouseName,
      performer: 'Admin',
      note: `Nhập thành phẩm từ ${normalizedTarget.orderNumber}`,
      supplier: '',
      documentRef: normalizedTarget.orderNumber,
      productionOrderId: normalizedTarget.id,
      productionOrderCode: normalizedTarget.orderNumber,
      postingMode: 'PRODUCTION_RECEIPT',
      skipLinkedInvoiceDocs: true,
      internalCreditAccount: '154',
      internalDescription: `Nhập thành phẩm ${normalizedTarget.parentItemSku || normalizedTarget.parentItemName} (${normalizedTarget.orderNumber})`,
      lines: [
        {
          itemId: normalizedTarget.output.itemId,
          qty: outputQuantity,
          price: unitCost,
          vat: 0,
          serials: '',
          note: normalizedTarget.note,
        },
      ],
    };
    if (!applyStockBatches([issuePayload, receiptPayload])) return false;
    const now = new Date().toISOString();
    setProductionOrders((prev) =>
      prev.map((entry) =>
        entry.id === targetId
          ? {
              ...normalizedTarget,
              status: 'COMPLETED',
              completionDate,
              completedAt: now,
              completedBy: 'Admin',
              releasedAt: entry.releasedAt || now,
              releasedBy: entry.releasedBy || 'Admin',
              totalPlannedCost: totalIssueCost,
              unitPlannedCost: unitCost,
              output: {
                ...normalizedTarget.output,
                quantity: outputQuantity,
                unitCost,
                totalCost: totalIssueCost,
              },
              updatedAt: now,
            }
          : entry,
      ),
    );
    return true;
  };
  const handleUpdateCITMeta = (id: string, isDeductible: boolean, reason?: string) => setCitExpenseMeta(prev => ({ ...prev, [id]: { journalEntryId: id, isDeductible, reason } }));
  const handleUpdateLossRecord = (record: CITLossRecord) => setCitLossRecords(prev => [...prev, record]);
  const handleUpdateCITLossRecord = (record: CITLossRecord) => setCitLossRecords(prev => prev.map(r => r.id === record.id ? record : r));
  const handleSaveVoucher = (
    voucher: AccountingVoucher,
    opts?: { skipEditableDateCheck?: boolean; skipJournalEntry?: boolean }
  ): { ok: boolean; finalVoucher?: AccountingVoucher } => {
    const postingDate = (voucher?.date || new Date().toISOString().split('T')[0]).split('T')[0];
    if (!opts?.skipEditableDateCheck && !assertEditableDate(postingDate, 'lưu chứng từ kế toán')) {
      return { ok: false };
    }
    const isBankVoucher =
      voucher.voucherType === 'PAYMENT_ORDER' ||
      voucher.voucherType === 'BANK_DEBIT' ||
      voucher.voucherType === 'BANK_CREDIT';
    const inferredVoucherBankLedgerCode = (() => {
      if (voucher.voucherType === 'BANK_CREDIT') {
        return (voucher.details || [])
          .map((d) => String(d.debitAccount || '').trim())
          .find((code) => isBankLedgerChildAccountCode(code));
      }
      if (voucher.voucherType === 'PAYMENT_ORDER' || voucher.voucherType === 'BANK_DEBIT') {
        return (voucher.details || [])
          .map((d) => String(d.creditAccount || '').trim())
          .find((code) => isBankLedgerChildAccountCode(code));
      }
      return undefined;
    })();
    const voucherBankSelection = isBankVoucher || voucher.bankAccountId || voucher.bankLedgerAccountCode
      ? resolveBankSelection(
          {
            ...voucher,
            bankLedgerAccountCode: voucher.bankLedgerAccountCode || inferredVoucherBankLedgerCode,
          },
          { requireActive: !!voucher.bankAccountId },
        )
      : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
    if (voucherBankSelection.error) {
      window.alert(voucherBankSelection.error);
      return { ok: false };
    }
    const normalizedVoucher: AccountingVoucher = {
      ...voucher,
      ...(isBankVoucher ? voucherBankSelection.snapshot : clearBankAccountSnapshot()),
      details: (voucher.details || []).map(d => ({
        ...d,
        debitAccount:
          voucher.voucherType === 'BANK_CREDIT' && voucherBankSelection.snapshot.bankLedgerAccountCode
            ? (() => {
                const normalized = normalizePaymentAccountCode(d.debitAccount);
                if (!normalized || normalized === '1121' || isBankLedgerChildAccountCode(normalized)) {
                  return String(voucherBankSelection.snapshot.bankLedgerAccountCode);
                }
                return normalized;
              })()
            : normalizePaymentAccountCode(d.debitAccount),
        creditAccount:
          (voucher.voucherType === 'PAYMENT_ORDER' || voucher.voucherType === 'BANK_DEBIT') &&
          voucherBankSelection.snapshot.bankLedgerAccountCode
            ? (() => {
                const normalized = normalizePaymentAccountCode(d.creditAccount);
                if (!normalized || normalized === '1121' || isBankLedgerChildAccountCode(normalized)) {
                  return String(voucherBankSelection.snapshot.bankLedgerAccountCode);
                }
                return normalized;
              })()
            : normalizePaymentAccountCode(d.creditAccount),
      })),
    };
    const existingVoucher = accountingVouchers.find(v => v.id === normalizedVoucher.id);
    const balanceErr = validateVoucherBalanced(normalizedVoucher.details);
    if (balanceErr) {
      window.alert(balanceErr);
      return { ok: false };
    }
    // Chứng từ thu/chi gắn HĐ (VOU-INV-*) quyết toán 131/331: không chặn theo dư tiền trên sổ —
    // dư TK 111/112 thường chưa phản ánh thực tế khi mới ghi nhận thanh toán từ thẻ Hóa đơn.
    const isInvoiceSettlementVoucher = String(normalizedVoucher.id || '').startsWith('VOU-INV-');
    if (!isInvoiceSettlementVoucher) {
      const cashErr = validateCashNotOverdraft({
        details: normalizedVoucher.details,
        postingDate,
        journalEntries: allJournalEntriesAcrossYears,
        voucherId: String(normalizedVoucher.id || ''),
        voucherWasPosted: existingVoucher?.status === 'POSTED',
      });
      if (cashErr) {
        window.alert(cashErr);
        return { ok: false };
      }
    }
    const ensuredVoucherNumber = existingVoucher?.voucherNumber
      || normalizedVoucher.voucherNumber
      || reserveDocumentNumber(getVoucherDocumentPrefix(voucher.voucherType), postingDate);
    const finalVoucher: AccountingVoucher = existingVoucher
      ? { ...existingVoucher, ...normalizedVoucher, voucherNumber: ensuredVoucherNumber }
      : {
          ...normalizedVoucher,
          voucherNumber: ensuredVoucherNumber,
        };
    const voucherToStore = enrichPostedVoucherArApObjects(finalVoucher, invoices, customers, suppliers);
    setAccountingVouchers(prev => {
      const exists = prev.find(v => v.id === voucherToStore.id);
      return exists ? prev.map(v => v.id === voucherToStore.id ? voucherToStore : v) : [...prev, voucherToStore];
    });
    if (voucherToStore.status === 'POSTED' && !opts?.skipJournalEntry) {
      const je = buildPostedVoucherJournalEntry(voucherToStore, postingDate);
      if (je) {
        setJournalEntries((current) => {
          const jeVouId = je.id;
          const filtered = current.filter((e) => e.id !== jeVouId);
          return [...filtered, je];
        });
      }
    }
    if (voucherToStore.status === 'POSTED') {
      setInvoices((prev) =>
        applyInvoicePaidSyncFromPostedVoucher(prev, voucherToStore, customers, suppliers),
      );
    }
    return { ok: true, finalVoucher: voucherToStore };
  };
  const handleDeleteVoucher = async (id: string) => {
    const voucher = accountingVouchers.find(v => v.id === id);
    const postingDate = (voucher?.date || new Date().toISOString().split('T')[0]).split('T')[0];
    if (!assertEditableDate(postingDate, 'xóa chứng từ kế toán')) return;
    const voucherNumber = voucher?.voucherNumber;
    const shouldDeleteJournal = (e: JournalEntry) =>
      e.referenceId === id || e.referenceId === voucherNumber;

    persistEpochRef.current += 1;
    recordEntityDeletion(
      'accountingVouchers',
      id,
      voucher?.voucherNumber || id,
      voucher,
      'delete_voucher',
      'AccountingVoucher',
    );
    purgeJournalEntriesAcrossYears('voucher', id, voucher ? (voucher as unknown as Record<string, unknown>) : null);

    setAccountingVouchers(prev => prev.filter(v => v.id !== id));
    setJournalEntries(prev => prev.filter(e => !shouldDeleteJournal(e)));
    setYearDataByKey((prev) => {
      const out = { ...prev } as Record<YearKey, YearData>;
      for (const k of Object.keys(out)) {
        if (k === activeYearKey) continue;
        const yd = out[k];
        if (!yd) continue;
        out[k] = {
          ...yd,
          accountingVouchers: (yd.accountingVouchers || []).filter(v => v.id !== id),
          journalEntries: (yd.journalEntries || []).filter(e => !shouldDeleteJournal(e)),
        };
      }
      return out;
    });

    const lc = await callLifecycleSoftDelete('accountingVouchers', id);
    if (!lc.ok) {
      scheduleRemoteStateReloadRef.current();
      window.alert(`Không thể đưa vào thùng rác: ${lc.error}`);
      return;
    }
    notifySoftDeleted(voucher?.voucherNumber || id);
  };
  const handlePostVoucher = (id: string) => {
    const voucher = accountingVouchers.find(v => v.id === id);
    if (!voucher) return;
    const postingDate = (voucher?.date || new Date().toISOString().split('T')[0]).split('T')[0];
    if (!assertEditableDate(postingDate, 'ghi sổ chứng từ')) return;
    void handleSaveVoucher({ ...voucher, status: 'POSTED' });
  };
  const handleUnpostVoucher = (id: string) => {
    const voucher = accountingVouchers.find(v => v.id === id);
    if (!voucher) return;
    const postingDate = (voucher?.date || new Date().toISOString().split('T')[0]).split('T')[0];
    if (!assertEditableDate(postingDate, 'bỏ ghi sổ chứng từ')) return;
    setAccountingVouchers(prev => prev.map(v => v.id === id ? { ...v, status: 'DRAFT' } : v));
    setJournalEntries(prev => prev.filter(e => e.referenceId !== voucher.id && e.referenceId !== voucher.voucherNumber));
  };
  const handleAddAsset = (
    asset: Partial<Asset>,
    paymentMethod: string,
    opts?: { retroToPeriod?: string; retroPolicy?: 'DAY1_INCLUDES_MONTH' | 'FULL_MONTHS_ONLY'; bankAccountId?: string },
  ) => {
    const rawUseDate = (asset.useDate || new Date().toISOString().split('T')[0]).split('T')[0];
    const postingDate = clampDateToFinancialYear(rawUseDate, financialYear);
    if (!assertEditableDate(postingDate, 'ghi tăng tài sản')) return;
    const assetId = Date.now().toString();
    const cost = Number(asset.cost || 0);
    const vatRate = Number(asset.vatRate || 0);
    const { amount: purchaseAmountRounded, vatAmount, totalAmount } = roundInvoiceTotalsFromSums(
      cost,
      vatAmountUnrounded(cost, vatRate),
    );
    const assetBankSelection = paymentMethod === 'BANK'
      ? resolveBankSelection({ bankAccountId: opts?.bankAccountId }, { requireActive: true })
      : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
    if (assetBankSelection.error) {
      window.alert(assetBankSelection.error);
      return;
    }
    if (paymentMethod === 'BANK' && !assetBankSelection.bankAccount) {
      window.alert('Vui lòng chọn tài khoản ngân hàng liên kết trước khi ghi tăng tài sản.');
      return;
    }
    const usefulLife = Number(asset.usefulLife || 1);
    const normalizedType = (() => {
      const group = String((asset as any)?.assetGroup || '');
      const acc = String((asset as any)?.assetAccount || '').trim();
      // Strong signals first: account/group imply CCDC regardless of what `asset.type` says.
      if (acc.startsWith('242') || acc.startsWith('153') || group.includes('CCDC') || group.includes('(242)')) return 'CCDC';
      // Strong signals for TSCĐ
      if (acc.startsWith('211') || acc.startsWith('213') || group.includes('TSCĐ') || group.includes('(211)') || group.includes('(213)')) return 'TSCĐ';
      // Fallback to provided type if valid, else default TSCĐ.
      const t = (asset as any)?.type;
      if (t === 'CCDC' || t === 'TSCĐ') return t;
      return 'TSCĐ';
    })();
    const accDepr = normalizedType === 'TSCĐ' ? Number(asset.accumulatedDepreciation || 0) : 0;
    const accAlloc = normalizedType === 'CCDC' ? Number((asset as Asset).accumulatedAllocation || 0) : 0;
    const residual = cost - (normalizedType === 'TSCĐ' ? accDepr : accAlloc);
    const depreciationAccount = normalizedType === 'TSCĐ' ? '214' : '242';
    const accTrim = String((asset as any)?.assetAccount || '').trim();
    const ccdcLifecycleResolved: 'STOCK_153' | 'IN_USE' | undefined =
      normalizedType === 'CCDC'
        ? ((asset as Asset).ccdcLifecycle === 'STOCK_153' || accTrim.startsWith('153') ? 'STOCK_153' : 'IN_USE')
        : undefined;
    const salvageValueTsc =
      normalizedType === 'TSCĐ'
        ? Math.max(0, Math.min(cost, Number((asset as Asset).salvageValue ?? 0)))
        : 0;
    const depreciableBaseTsc = DepreciationEngine.getDepreciableBase({ cost, salvageValue: salvageValueTsc });
    const allocatableBaseCcdc = AllocationEngine.getAllocatableBase(cost);
    const scheduleBase = normalizedType === 'TSCĐ' ? depreciableBaseTsc : allocatableBaseCcdc;
    const invNo = String((asset as any).purchaseInvoiceNumber || asset.code || `ASSET-${assetId.slice(-4)}`).trim();
    const newAsset: Asset = {
      id: assetId,
      ...asset,
      code: String((asset as any).code || invNo).trim(),
      type: normalizedType as any,
      depreciationAccount: (asset as any).depreciationAccount || depreciationAccount,
      cost,
      vatRate,
      vatAmount,
      usefulLife,
      accumulatedDepreciation: normalizedType === 'TSCĐ' ? accDepr : 0,
      accumulatedAllocation: normalizedType === 'CCDC' ? accAlloc : 0,
      residualValue: residual,
      salvageValue: normalizedType === 'TSCĐ' ? salvageValueTsc : undefined,
      expenseAccount: (asset as Asset).expenseAccount,
      ccdcLifecycle: ccdcLifecycleResolved,
      status: 'ACTIVE'
    } as Asset;
    setAssets(prev => [...prev, newAsset]);
    const dateNote =
      rawUseDate !== postingDate
        ? ` (ngày SD gốc ${rawUseDate}, chứng từ ghi theo kỳ ${financialYear.startDate}–${financialYear.endDate})`
        : '';
    const typeLabel = normalizedType;
    const accountDr =
      normalizedType === 'TSCĐ'
        ? (asset as any).assetAccount || '2112 - Máy móc, thiết bị'
        : ccdcLifecycleResolved === 'STOCK_153'
          ? '153 - Công cụ dụng cụ chờ phân bổ'
          : (asset as any).assetAccount || '242 - Chi phí trả trước (CCDC)';
    const deprAccount = depreciationAccount;
    const newInvoice: Invoice = {
      id: `INV-ASSET-${assetId}`,
      relatedId: assetId,
      invoiceNumber: invNo,
      formNo: (asset as any).purchaseFormNo,
      symbolCode: (asset as any).purchaseSymbolCode,
      date: postingDate,
      customerName: asset.supplierName || 'Nhà cung cấp tài sản',
      buyerTaxCode: asset.supplierTaxCode,
      buyerAddress: asset.supplierAddress,
      buyerPhone: asset.supplierPhone,
      description: `Mua ${typeLabel}: ${asset.name}`,
      amount: purchaseAmountRounded,
      vatRate: vatRate,
      vatAmount: vatAmount,
      totalAmount: totalAmount,
      type: 'PURCHASE',
      category: typeLabel === 'TSCĐ' ? 'DEVICE' : 'SERVICE',
      status: paymentMethod === 'DEBT' ? 'PENDING' : 'PAID',
      paymentMethod: paymentMethod === 'DEBT' ? 'Công nợ' : (paymentMethod === 'BANK' ? 'Chuyển khoản' : 'Tiền mặt'),
      ...(paymentMethod === 'BANK' ? assetBankSelection.snapshot : clearBankAccountSnapshot()),
      details: [{
        id: '1',
        productName: asset.name || '',
        type: 'GOODS',
        unit: 'Cái',
        quantity: 1,
        price: cost,
        amount: cost,
        vatRate,
        vatAmount: vatAmountUnrounded(cost, vatRate),
        account: accountDr,
      }],
    };
    setInvoices(prev => [...prev, newInvoice]);
    const creditAcc = paymentMethod === 'DEBT'
      ? '331'
      : paymentMethod === 'BANK'
        ? resolveCashBankAccountFromPaymentMethod(paymentMethod, assetBankSelection.snapshot.bankLedgerAccountCode)
        : '1111';
    const creditLine: any = {
      account: creditAcc,
      debit: 0,
      credit: totalAmount,
    };
    if (creditAcc === '331') {
      creditLine.objectType = 'SUPPLIER';
      creditLine.objectId = newInvoice.id;
      creditLine.objectName = newInvoice.customerName;
      creditLine.sourceInvoiceId = newInvoice.id;
      creditLine.sourceInvoiceNumber = newInvoice.invoiceNumber;
    }
    const jeDetails = [
      {
        account: accountDr,
        debit: purchaseAmountRounded,
        credit: 0,
      },
      creditLine,
    ];
    if (vatAmount > 0) jeDetails.push({ account: '1331', debit: vatAmount, credit: 0 });
    const newEntries: JournalEntry[] = [
      {
        id: `JE-ASSET-INC-${assetId}`,
        date: postingDate,
        referenceId: asset.code || assetId,
        description: `Ghi tăng ${typeLabel}: ${asset.name} (HĐ: ${newInvoice.invoiceNumber}${newInvoice.symbolCode ? ` - ${newInvoice.symbolCode}` : ''}${newInvoice.formNo ? ` - ${newInvoice.formNo}` : ''})${dateNote}`,
        details: jeDetails,
      },
    ];

    // Retroactive depreciation/amortization ("trích hồi ký") from useDate, independent of financial year.
    // This posts monthly entries at month-end up to opts.retroToPeriod (YYYY-MM), using continuous-month rules.
    const retroTo = String(opts?.retroToPeriod || '').trim();
    const policy = opts?.retroPolicy || 'DAY1_INCLUDES_MONTH';
    let retroBlocked = false;
    if (ccdcLifecycleResolved !== 'STOCK_153' && retroTo && /^\d{4}-\d{2}$/.test(retroTo)) {
      const [ry, rm] = retroTo.split('-').map(Number);
      const periodEnd = new Date(ry, rm, 0);
      const start = new Date(String(asset.useDate || ''));
      if (!Number.isNaN(start.getTime()) && periodEnd >= start && usefulLife > 0) {
        const monthDiff = (periodEnd.getFullYear() - start.getFullYear()) * 12 + (periodEnd.getMonth() - start.getMonth());
        const includeStartMonth = (policy === 'DAY1_INCLUDES_MONTH' && start.getDate() === 1) ? 1 : 0;
        const monthsEligible = Math.min(usefulLife, Math.max(0, monthDiff + includeStartMonth));
        const monthlyAmount = usefulLife > 0 ? (scheduleBase / usefulLife) : 0;
        const targetAccumulated = Math.min(scheduleBase, roundVnd(monthlyAmount * monthsEligible));
        if (targetAccumulated > 0) {
          const expenseAccount = resolveAssetExpenseAccount({
            expenseAccount: (asset as Asset).expenseAccount,
            department: String(asset.department || ''),
          });
          // Generate month-end entries, idempotent by (assetId, YYYY-MM)
          // Start month: if includeStartMonth=1, start from useDate month; else from next month.
          const startMonthIndex = start.getFullYear() * 12 + start.getMonth() + (includeStartMonth ? 0 : 1);
          for (let k = 0; k < monthsEligible; k++) {
            const idx = startMonthIndex + k;
            const y = Math.floor(idx / 12);
            const m0 = idx % 12;
            const m = m0 + 1;
            const d = new Date(y, m, 0); // month-end
            const ym = `${y}-${String(m).padStart(2, '0')}`;
            const isLast = k === monthsEligible - 1;
            const amount = isLast
              ? Math.max(0, targetAccumulated - roundVnd(monthlyAmount * k))
              : roundVnd(monthlyAmount);
            if (amount <= 0) continue;
            // Best effort: respect period locks by checking each month-end date.
            const monthEndStr = d.toISOString().split('T')[0];
            if (!assertEditableDate(monthEndStr, 'trích hồi ký khấu hao/phân bổ')) { retroBlocked = true; break; }
            newEntries.push({
              id: `JE-DEPR-${assetId}-${ym}`,
              date: monthEndStr,
              referenceId: `DEPR-${ym}-${assetId}`,
              description: `Trích khấu hao/Phân bổ tài sản [${asset.name}] tháng ${ym} (hồi ký)`,
              details: [
                { account: expenseAccount, debit: amount, credit: 0 },
                { account: deprAccount, debit: 0, credit: amount }
              ]
            });
          }

          if (!retroBlocked) {
            setAssets(prev =>
              prev.map((a) =>
                a.id === assetId
                  ? normalizedType === 'TSCĐ'
                    ? {
                        ...a,
                        accumulatedDepreciation: targetAccumulated,
                        accumulatedAllocation: 0,
                        residualValue: cost - targetAccumulated,
                      }
                    : {
                        ...a,
                        accumulatedAllocation: targetAccumulated,
                        accumulatedDepreciation: 0,
                        residualValue: cost - targetAccumulated,
                      }
                  : a
              )
            );
          } else {
            // If retro posting is blocked by locked periods, keep the asset but don't fake accumulated numbers.
            // User can switch year/unlock periods then run monthly depreciation to catch up.
            // eslint-disable-next-line no-alert
            window.alert('Không thể trích hồi ký vì có kỳ kế toán bị khóa. Tài sản vẫn được ghi tăng, nhưng chưa ghi hồi ký khấu hao/phân bổ.');
            // Remove any retro entries we may have appended before hitting the lock
            for (let i = newEntries.length - 1; i >= 0; i--) {
              if (String(newEntries[i]?.id || '').startsWith(`JE-DEPR-${assetId}-`)) newEntries.splice(i, 1);
            }
          }
        }
      }
    }
    if (paymentMethod !== 'DEBT') {
      setFundTransactions((prev) => [
        ...prev,
        {
          id: `FT-ASSET-${assetId}`,
          date: postingDate,
          type: 'PAYMENT',
          method: paymentMethod === 'BANK' ? 'BANK' : 'CASH',
          amount: totalAmount,
          payerReceiver: asset.supplierName || 'Nhà cung cấp tài sản',
          description: `Chi mua ${typeLabel}: ${asset.name}`,
          category: typeLabel === 'TSCĐ' ? 'Mua sắm TSCĐ' : 'Mua sắm CCDC',
          status: 'COMPLETED',
          referenceDoc: newInvoice.invoiceNumber,
          ...(paymentMethod === 'BANK' ? assetBankSelection.snapshot : clearBankAccountSnapshot()),
        },
      ]);
    }
    if (newEntries.length > 0) {
      setJournalEntries(prev => {
        const removeIds = new Set(newEntries.map(e => String(e.id || '')).filter(Boolean));
        const removeRefs = new Set(newEntries.map(e => String(e.referenceId || '')).filter(Boolean));
        const filtered = prev.filter(e => !removeIds.has(String(e.id || '')) && !removeRefs.has(String(e.referenceId || '')));
        return [...filtered, ...newEntries];
      });
    }
  };

  const handlePutCcdcIntoUse = (assetId: string, putIntoUseDate: string) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset || asset.type !== 'CCDC' || asset.ccdcLifecycle !== 'STOCK_153') return;
    const postingDate = putIntoUseDate.split('T')[0];
    if (!assertEditableDate(postingDate, 'đưa CCDC vào sử dụng')) return;
    const amt = roundVnd(Number(asset.cost || 0));
    if (amt <= 0) return;
    const je: JournalEntry = {
      id: `JE-CCDC-USE-${assetId}`,
      date: postingDate,
      referenceId: `CCDC-USE-${assetId}`,
      description: `Chuyển CCDC vào sử dụng [${asset.name}] (Nợ 242 / Có 153)`,
      details: [
        { account: '242', debit: amt, credit: 0 },
        { account: '153', debit: 0, credit: amt },
      ],
    };
    setAssets((prev) =>
      prev.map((a) =>
        a.id === assetId
          ? {
              ...a,
              ccdcLifecycle: 'IN_USE',
              useDate: postingDate,
              assetAccount: '242 - Chi phí trả trước (CCDC)',
            }
          : a
      )
    );
    setJournalEntries((prev) => {
      const filtered = prev.filter((e) => e.id !== je.id && e.referenceId !== je.referenceId);
      return [...filtered, je];
    });
  };

  const handleLiquidateAsset = (
    assetId: string,
    payload: {
      liquidationDate: string;
      saleAmount?: number;
      saleVatRate?: number;
      receiptMethod?: AssetLiquidationReceiptMethod;
      bankAccountId?: string;
      contactName?: string;
    },
  ): boolean => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return false;
    if (asset.status === 'LIQUIDATED') {
      window.alert('Tài sản này đã được thanh lý trước đó.');
      return false;
    }

    const rawLiquidationDate = String(payload.liquidationDate || new Date().toISOString().split('T')[0]).split('T')[0];
    const postingDate = clampDateToFinancialYear(rawLiquidationDate, financialYear);
    if (!assertEditableDate(postingDate, 'thanh lý tài sản')) return false;

    const preview = buildAssetLiquidationPreview(
      asset,
      rawLiquidationDate,
      Number(payload.saleAmount || 0),
      Number(payload.saleVatRate || 0),
    );
    if (!preview.isValidDate) {
      window.alert(preview.invalidReason || 'Không thể tính toán thanh lý cho tài sản này.');
      return false;
    }
    if (asset.type === 'CCDC' && preview.ccdcHandling === 'STOCK_153') {
      window.alert('CCDC đang ở TK 153 (chờ đưa vào sử dụng). Hãy chuyển vào sử dụng hoặc xử lý riêng khỏi luồng thanh lý sớm.');
      return false;
    }

    const saleHasValue = preview.saleTotalAmount > 0;
    const requestedReceiptMethod =
      saleHasValue
        ? payload.receiptMethod === 'BANK' || payload.receiptMethod === 'RECEIVABLE'
          ? payload.receiptMethod
          : 'CASH'
        : 'NONE';
    const receiptMethod: AssetLiquidationReceiptMethod = saleHasValue ? requestedReceiptMethod : 'NONE';
    const receiptBankSelection =
      receiptMethod === 'BANK'
        ? resolveBankSelection({ bankAccountId: payload.bankAccountId }, { requireActive: true })
        : { bankAccount: null, snapshot: clearBankAccountSnapshot(), error: undefined };
    if (receiptMethod === 'BANK') {
      if (receiptBankSelection.error) {
        window.alert(receiptBankSelection.error);
        return false;
      }
      if (!receiptBankSelection.bankAccount) {
        window.alert('Vui lòng chọn tài khoản ngân hàng nhận tiền thanh lý.');
        return false;
      }
    }

    const receiptAccount =
      receiptMethod === 'RECEIVABLE'
        ? '131'
        : receiptMethod === 'BANK'
          ? resolveCashBankAccountFromPaymentMethod('BANK', receiptBankSelection.snapshot.bankLedgerAccountCode)
          : receiptMethod === 'CASH'
            ? '1111'
            : '';
    const counterpartyName = String(payload.contactName || '').trim() || `Thanh lý ${asset.name}`;
    const dateNote =
      rawLiquidationDate !== postingDate
        ? ` (ngày thanh lý gốc ${rawLiquidationDate}, chứng từ ghi theo kỳ ${financialYear.startDate}–${financialYear.endDate})`
        : '';

    const objectFields =
      receiptAccount === '131'
        ? {
            objectType: 'CUSTOMER' as const,
            objectId: `ASSET-LIQUIDATION-${assetId}`,
            objectName: counterpartyName,
          }
        : {};

    const newJournalEntries: JournalEntry[] = [];
    const addJournalEntry = (entry: JournalEntry) => {
      newJournalEntries.push(entry);
    };

    if (asset.type === 'TSCĐ' && preview.additionalDepreciation > 0) {
      addJournalEntry({
        id: `JE-ASSET-LIQ-CATCHUP-${assetId}`,
        date: postingDate,
        referenceId: `ASSET-LIQ-CATCHUP-${assetId}`,
        description: `Bổ sung khấu hao đến ngày thanh lý [${asset.name}]${dateNote}`,
        details: [
          {
            account: preview.expenseAccountCode,
            debit: preview.additionalDepreciation,
            credit: 0,
            objectType: 'ASSET',
            objectId: asset.id,
            objectName: asset.name,
          },
          {
            account: preview.depreciationAccountCode,
            debit: 0,
            credit: preview.additionalDepreciation,
            objectType: 'ASSET',
            objectId: asset.id,
            objectName: asset.name,
          },
        ],
      });
    }

    if (asset.type === 'TSCĐ') {
      const writeoffDetails = [
        preview.remainingValue > 0
          ? {
              account: '811',
              debit: preview.remainingValue,
              credit: 0,
              objectType: 'ASSET' as const,
              objectId: asset.id,
              objectName: asset.name,
            }
          : null,
        {
          account: preview.depreciationAccountCode,
          debit: preview.accumulatedAtLiquidation,
          credit: 0,
          objectType: 'ASSET' as const,
          objectId: asset.id,
          objectName: asset.name,
        },
        {
          account: preview.assetAccountCode,
          debit: 0,
          credit: roundVnd(Number(asset.cost || 0)),
          objectType: 'ASSET' as const,
          objectId: asset.id,
          objectName: asset.name,
        },
      ].filter(Boolean) as JournalEntry['details'];
      addJournalEntry({
        id: `JE-ASSET-LIQ-WRITEOFF-${assetId}`,
        date: postingDate,
        referenceId: `ASSET-LIQ-WRITEOFF-${assetId}`,
        description: `Thanh lý/xóa sổ TSCĐ [${asset.name}]${dateNote}`,
        details: writeoffDetails,
      });
    } else if (preview.ccdcWriteoffAmount > 0) {
      addJournalEntry({
        id: `JE-ASSET-LIQ-WRITEOFF-${assetId}`,
        date: postingDate,
        referenceId: `ASSET-LIQ-WRITEOFF-${assetId}`,
        description: `Thanh lý CCDC nhiều kỳ [${asset.name}] - kết chuyển giá trị còn lại${dateNote}`,
        details: [
          {
            account: preview.expenseAccountCode,
            debit: preview.ccdcWriteoffAmount,
            credit: 0,
            objectType: 'ASSET',
            objectId: asset.id,
            objectName: asset.name,
          },
          {
            account: preview.depreciationAccountCode,
            debit: 0,
            credit: preview.ccdcWriteoffAmount,
            objectType: 'ASSET',
            objectId: asset.id,
            objectName: asset.name,
          },
        ],
      });
    }

    if (saleHasValue && receiptAccount) {
      addJournalEntry({
        id: `JE-ASSET-LIQ-SALE-${assetId}`,
        date: postingDate,
        referenceId: `ASSET-LIQ-SALE-${assetId}`,
        description: `Thu tiền thanh lý ${asset.type} [${asset.name}]${dateNote}`,
        details: [
          {
            account: receiptAccount,
            debit: preview.saleTotalAmount,
            credit: 0,
            ...objectFields,
          },
          {
            account: '711',
            debit: 0,
            credit: preview.saleAmount,
          },
          ...(preview.saleVatAmount > 0
            ? [
                {
                  account: '33311',
                  debit: 0,
                  credit: preview.saleVatAmount,
                },
              ]
            : []),
        ],
      });
    }

    if (newJournalEntries.length > 0) {
      setJournalEntries((prev) => {
        const removeIds = new Set(newJournalEntries.map((e) => String(e.id || '')));
        const removeRefs = new Set(newJournalEntries.map((e) => String(e.referenceId || '')));
        const filtered = prev.filter(
          (e) => !removeIds.has(String(e.id || '')) && !removeRefs.has(String(e.referenceId || '')),
        );
        return [...filtered, ...newJournalEntries];
      });
    }

    if (saleHasValue && (receiptMethod === 'CASH' || receiptMethod === 'BANK')) {
      const voucherNumber = reserveDocumentNumber(getFundDocumentPrefix('RECEIPT', receiptMethod), postingDate);
      const fundRow: FundTransaction = {
        id: `FT-ASSET-LIQ-${assetId}`,
        voucherNumber,
        date: postingDate,
        type: 'RECEIPT',
        method: receiptMethod,
        amount: preview.saleTotalAmount,
        payerReceiver: counterpartyName,
        description: `Thu tiền thanh lý ${asset.type}: ${asset.name}`,
        category: 'Thanh lý tài sản',
        status: 'COMPLETED',
        referenceDoc: `ASSET-LIQ-SALE-${assetId}`,
        accountingType: receiptAccount,
        ...(receiptMethod === 'BANK' ? receiptBankSelection.snapshot : clearBankAccountSnapshot()),
      };
      setFundTransactions((prev) => {
        const filtered = prev.filter((ft) => ft.id !== fundRow.id);
        return [...filtered, fundRow];
      });
    }

    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        if (a.type === 'TSCĐ') {
          return {
            ...a,
            status: 'LIQUIDATED',
            residualValue: 0,
            accumulatedDepreciation: preview.accumulatedAtLiquidation,
            accumulatedAllocation: 0,
            liquidationDate: rawLiquidationDate,
            liquidationPostingDate: postingDate,
            liquidationAdditionalDepreciation: preview.additionalDepreciation,
            liquidationWriteoffAmount: preview.remainingValue,
            liquidationProceedsAmount: saleHasValue ? preview.saleAmount : undefined,
            liquidationVatRate: saleHasValue ? preview.saleVatRate : undefined,
            liquidationVatAmount: saleHasValue ? preview.saleVatAmount : undefined,
            liquidationTotalAmount: saleHasValue ? preview.saleTotalAmount : undefined,
            liquidationReceiptAccount: receiptAccount || undefined,
          };
        }
        return {
          ...a,
          status: 'LIQUIDATED',
          residualValue: 0,
          accumulatedDepreciation: 0,
          accumulatedAllocation:
            preview.ccdcHandling === 'STOCK_153'
              ? a.accumulatedAllocation
              : roundVnd(Number(a.cost || 0)),
          liquidationDate: rawLiquidationDate,
          liquidationPostingDate: postingDate,
          liquidationAdditionalDepreciation: 0,
          liquidationWriteoffAmount: preview.ccdcWriteoffAmount,
          liquidationProceedsAmount: saleHasValue ? preview.saleAmount : undefined,
          liquidationVatRate: saleHasValue ? preview.saleVatRate : undefined,
          liquidationVatAmount: saleHasValue ? preview.saleVatAmount : undefined,
          liquidationTotalAmount: saleHasValue ? preview.saleTotalAmount : undefined,
          liquidationReceiptAccount: receiptAccount || undefined,
        };
      }),
    );

    window.alert(`Đã ghi sổ thanh lý ${asset.type}: ${asset.name}.`);
    return true;
  };

  const handleUpdateAsset = (asset: Asset) => {
    const postingDate = (asset.useDate || new Date().toISOString().split('T')[0]).split('T')[0];
    if (!assertEditableDate(postingDate, 'cập nhật tài sản')) return;
    setAssets((prev) => {
      const merged = prev.map((a) => (a.id === asset.id ? { ...a, ...asset } : a));
      return reconcileAllAssetsWithJournal(merged, getAllJournalEntriesAcrossYearsInternal());
    });
  };

  const generateAssetTransferSlipNumber = () => {
    const ymd = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `DC-${ymd}-${suffix}`;
  };

  const handleTransferAssets = (payload: {
    assetIds: string[];
    toDepartment: string;
    transferDate: string;
    responsiblePersonId?: string;
    responsiblePersonName?: string;
    reason?: string;
    slipNumber?: string;
    createdBy?: string;
  }): boolean => {
    const ids = (payload.assetIds || []).filter(Boolean);
    const toDepartment = String(payload.toDepartment || '').trim();
    const transferDate = String(payload.transferDate || '').split('T')[0];
    if (!ids.length) {
      window.alert('Chưa chọn tài sản để điều chuyển.');
      return false;
    }
    if (!toDepartment) {
      window.alert('Vui lòng chọn bộ phận tiếp nhận.');
      return false;
    }
    if (!assertEditableDate(transferDate, 'điều chuyển tài sản')) return false;

    const targets = assets.filter((a) => ids.includes(a.id) && a.status === 'ACTIVE');
    if (!targets.length) {
      window.alert('Không có tài sản đang sử dụng phù hợp để điều chuyển.');
      return false;
    }
    const movable = targets.filter((a) => a.department !== toDepartment);
    if (!movable.length) {
      window.alert('Các tài sản đã thuộc bộ phận tiếp nhận, không cần điều chuyển.');
      return false;
    }

    const slipNumber = payload.slipNumber || (movable.length > 1 ? generateAssetTransferSlipNumber() : undefined);
    const employee = payload.responsiblePersonId
      ? employees.find((e) => e.id === payload.responsiblePersonId)
      : undefined;
    const responsiblePersonName =
      String(payload.responsiblePersonName || employee?.name || '').trim() || undefined;

    setAssets((prev) =>
      prev.map((a) => {
        if (!movable.some((m) => m.id === a.id)) return a;
        const prevEx = String(a.expenseAccount || '').trim();
        const nextExpenseAccount = /^(641|627)$/.test(prevEx)
          ? prevEx
          : resolveAssetExpenseAccount({ department: toDepartment, expenseAccount: undefined });
        const record: AssetTransferRecord = {
          id: `TR-${a.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          transferDate,
          fromDepartment: a.department,
          toDepartment,
          responsiblePersonId: payload.responsiblePersonId,
          responsiblePersonName,
          reason: String(payload.reason || '').trim() || undefined,
          slipNumber,
          createdAt: new Date().toISOString(),
          createdBy: String(payload.createdBy || '').trim() || undefined,
        };
        return {
          ...a,
          department: toDepartment,
          expenseAccount: nextExpenseAccount,
          responsiblePersonId: payload.responsiblePersonId,
          responsiblePersonName,
          transferHistory: [...(a.transferHistory || []), record],
        };
      }),
    );

    const label = movable.length === 1 ? movable[0].name : `${movable.length} tài sản`;
    window.alert(
      slipNumber
        ? `Đã lập phiếu ${slipNumber} — điều chuyển ${label} sang ${toDepartment}.`
        : `Đã điều chuyển ${label} sang ${toDepartment}.`,
    );
    return true;
  };

  const handleDeleteAsset = async (id: string) => {
    // no reliable posting date on delete; use today guard and rely on period locking policy
    if (!assertEditableDate(new Date().toISOString().split('T')[0], 'xóa tài sản')) return;
    const asset = assets.find(a => a.id === id);
    const assetCode = asset?.code || '';
    const invNo = String((asset as any)?.purchaseInvoiceNumber || '').trim();

    persistEpochRef.current += 1;
    recordEntityDeletion('assets', id, asset?.name || asset?.code || id, asset, 'delete_asset', 'Asset');
    purgeJournalEntriesAcrossYears('asset', id, asset ? (asset as unknown as Record<string, unknown>) : null);
    purgeJournalEntriesAcrossYears('invoice', `INV-ASSET-${id}`, null);
    purgeJournalEntriesAcrossYears('fundTransaction', `FT-ASSET-${id}`, null);
    purgeJournalEntriesAcrossYears('fundTransaction', `FT-ASSET-LIQ-${id}`, null);
    setAssets(prev => prev.filter(a => a.id !== id));

    const lc = await callLifecycleSoftDelete('assets', id);
    if (!lc.ok) {
      scheduleRemoteStateReloadRef.current();
      window.alert(`Không thể đưa vào thùng rác: ${lc.error}`);
      return;
    }
    notifySoftDeleted(asset?.name || asset?.code || id);

    // Gỡ hóa đơn / phiếu quỹ liên kết mua TSCĐ (bút toán đã gỡ ở bước purge phía trên)
    setInvoices(prev => prev.filter(inv => {
      const invId = String(inv.id || '');
      const relatedId = String((inv as any).relatedId || '');
      const invNo = String(inv.invoiceNumber || '');
      if (invId === `INV-ASSET-${id}`) return false;
      if (relatedId === id) return false;
      if (assetCode && invNo === assetCode) return false;
      if (invNo && invNo === String((asset as any).purchaseInvoiceNumber || '').trim()) return false;
      return true;
    }));

    // 4) Remove linked fund transactions (payments) for this asset purchase
    setFundTransactions(prev => prev.filter(ft => {
      const ftId = String(ft.id || '');
      if (ftId === `FT-ASSET-${id}`) return false;
      if (ftId === `FT-ASSET-LIQ-${id}`) return false;
      if (assetCode && String(ft.referenceDoc || '') === assetCode) return false;
      if (String(ft.referenceDoc || '') === `INV-ASSET-${id}`) return false;
      if (String(ft.referenceDoc || '') === `ASSET-LIQ-SALE-${id}`) return false;
      return true;
    }));
  };
  const handleRunDepreciation = (period: string, entries: any[]) => {
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const postingDate = `${year}-${month.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;
    if (!assertEditableDate(postingDate, 'trích khấu hao/phân bổ')) return;
    // Only post rows that actually have value to post.
    const cleaned = (Array.isArray(entries) ? entries : []).filter(e => Number(e?.amount || 0) > 0);
    if (cleaned.length === 0) {
      alert(`Không có phát sinh khấu hao/phân bổ cần ghi sổ cho tháng ${month}/${year}.`);
      return;
    }

    // Update accumulated depreciation to the "target as-of period" when provided (continuous month life),
    // otherwise fallback to additive.
    setAssets(prev => prev.map(asset => {
      const match = cleaned.find(e => e.assetId === asset.id);
      if (!match) return asset;
      const cost = Number(asset.cost || 0);
      const salvage = Math.max(0, Math.min(cost, Number(asset.salvageValue ?? 0)));
      const current = getAccumulatedLedgerAmount(asset);
      const maxLedger = getAccumulatedLedgerCap(asset);
      const target = Number.isFinite(Number(match.targetAccumulated))
        ? Number(match.targetAccumulated)
        : current + Number(match.amount || 0);
      const next = Math.max(0, Math.min(maxLedger, target));
      if (asset.type === 'CCDC') {
        return {
          ...asset,
          accumulatedAllocation: next,
          accumulatedDepreciation: 0,
          residualValue: Math.max(0, cost - next),
        };
      }
      return {
        ...asset,
        accumulatedDepreciation: next,
        accumulatedAllocation: 0,
        residualValue: Math.max(salvage, cost - next),
      };
    }));

    const newJournalEntries: JournalEntry[] = cleaned.map(e => ({
      id: `JE-DEPR-${e.assetId}-${period}`,
      date: postingDate,
      referenceId: `DEPR-${period}-${e.assetId}`,
      description: `Trích khấu hao/Phân bổ tài sản [${e.assetName}] tháng ${period}`,
      details: [
        { account: e.debitAccount, debit: Number(e.amount), credit: 0 },
        { account: e.creditAccount, debit: 0, credit: Number(e.amount) }
      ]
    }));

    if (newJournalEntries.length > 0) {
      setJournalEntries(prev => {
        const toRemove = new Set(newJournalEntries.map(je => je.id));
        const toRemoveRef = new Set(newJournalEntries.map(je => je.referenceId));
        const filtered = prev.filter(je => !toRemove.has(String(je.id || '')) && !toRemoveRef.has(String(je.referenceId || '')));
        return [...filtered, ...newJournalEntries];
      });
      alert(`Đã ghi sổ khấu hao/tháng ${month}/${year} thành công.`);
    }
  };
  const handleUpdateCompanyInfo = (info: CompanyInfo) => setCompanyInfo({
    ...info,
    branchCode: normalizeBranchCode(info.branchCode, info.city),
  });

  /** Khóa duy nhất dòng công nợ khi kết chuyển (ký hiệu + số HĐ tránh trùng khác serie). */
  const openingDebtRolloverDedupeKey = (row: OpeningBalanceDebtDetail) =>
    [
      row.kind,
      row.sourceInvoiceId || '',
      row.invoiceSymbolCode || '',
      row.invoiceNo || '',
      row.partnerId || '',
      row.partnerName || '',
    ].join('|');

  const buildRolloverOpeningSnapshot = (
    fromData: YearData,
    fromYearKey: string,
    toYear: FinancialYear,
  ) => {
    const sourceFy = parseYearKey(fromYearKey);
    const targetYearKey = makeYearKey(toYear);
    const sourceYearLabel = new Date(sourceFy.startDate).getFullYear();
    const targetYearLabel = new Date(toYear.startDate).getFullYear();
    const lockReason = `Kết chuyển tự động từ niên độ ${sourceYearLabel} sang ${targetYearLabel}.`;
    // Tính liên tục đích danh theo từng tài khoản:
    // số dư đầu kỳ = số dư cuối kỳ của chính tài khoản đó trên sổ NKC.
    // Không cộng/trừ chéo giữa các nhóm tài khoản khác loại.
    const nets = computeAccountNetBalances(fromData.journalEntries || [], sourceFy.endDate);
    const baseAccounts = buildOpeningAccountRowsFromNetBalances(nets, {
      readOnly: true,
      originMode: 'ROLLOVER',
      lockReason,
    });

    const customerNetByObject = computeSubledgerNetBalances(fromData.journalEntries || [], sourceFy.endDate, '131');
    const supplierNetByObject = computeSubledgerNetBalances(fromData.journalEntries || [], sourceFy.endDate, '331');
    const customerById = new Map(customers.map((item) => [String(item.id || '').trim(), item]));
    const supplierById = new Map(suppliers.map((item) => [String(item.id || '').trim(), item]));
    const customerByName = new Map(customers.map((item) => [String(item.name || '').trim().toLowerCase(), item]));
    const supplierByName = new Map(suppliers.map((item) => [String(item.name || '').trim().toLowerCase(), item]));
    const invoiceById = new Map((fromData.invoices || []).map((invoice) => [String(invoice.id || '').trim(), invoice]));
    const invoiceByNo = new Map((fromData.invoices || []).map((invoice) => [String(invoice.invoiceNumber || '').trim(), invoice]));
    const rolloverRows: OpeningBalanceDebtDetail[] = [];

    const pushDebtRow = (kind: OpeningDebtKind, objectKey: string, rawAmount: number) => {
      const amount = roundVnd(Number(rawAmount || 0));
      if (!(amount > 0)) return;
      const key = String(objectKey || '').trim() || 'UNKNOWN';
      const keyLower = key.toLowerCase();
      const linkedInvoice = invoiceById.get(key) || invoiceByNo.get(key);
      const matchedPartner = kind === 'CUSTOMER_DEBT'
        ? customerById.get(key) || customerByName.get(keyLower)
        : supplierById.get(key) || supplierByName.get(keyLower);
      const partnerName = String(
        matchedPartner?.name ||
          linkedInvoice?.customerName ||
          (key === 'UNKNOWN'
            ? (kind === 'CUSTOMER_DEBT'
              ? '(Chưa gắn đối tượng công nợ phải thu)'
              : '(Chưa gắn đối tượng công nợ phải trả)')
            : key),
      ).trim();
      const invoiceNo = String(
        linkedInvoice?.invoiceNumber ||
          (key === 'UNKNOWN'
            ? (kind === 'CUSTOMER_DEBT' ? 'KC-131-UNKNOWN' : 'KC-331-UNKNOWN')
            : key),
      ).trim();
      const invoiceSymbolCode = String(linkedInvoice?.symbolCode || '').trim() || undefined;
      rolloverRows.push({
        id: createEntityId('open-debt'),
        kind,
        partnerId: matchedPartner?.id,
        partnerCode: matchedPartner?.code,
        partnerName,
        invoiceSymbolCode,
        invoiceNo,
        revenueType: linkedInvoice ? inferOpeningDebtRevenueTypeFromInvoice(linkedInvoice) : 'KHAC',
        amount,
        dueDate: linkedInvoice?.paymentDate || undefined,
        note: invoiceSymbolCode
          ? `Kết chuyển tự động từ HĐ ${invoiceSymbolCode} số ${invoiceNo}`
          : `Kết chuyển tự động theo số dư chi tiết TK ${kind === 'CUSTOMER_DEBT' ? '131' : '331'} cuối kỳ`,
        accountCode: kind === 'CUSTOMER_DEBT' ? '131' : '331',
        sourceInvoiceId: linkedInvoice?.id,
        sourceInvoiceNumber: linkedInvoice?.invoiceNumber,
        sourceInvoiceDate: String(linkedInvoice?.date || '').split('T')[0] || undefined,
        sourceYearKey: fromYearKey,
        openingYearKey: targetYearKey,
        originMode: 'ROLLOVER',
        readOnly: true,
        lockReason,
        syncStatus: 'MATCHED',
      });
    };

    for (const [objectKey, net] of customerNetByObject.entries()) {
      if (!(Number(net || 0) > 0)) continue;
      pushDebtRow('CUSTOMER_DEBT', String(objectKey || ''), Number(net || 0));
    }
    for (const [objectKey, net] of supplierNetByObject.entries()) {
      if (!(Number(net || 0) < 0)) continue;
      pushDebtRow('SUPPLIER_DEBT', String(objectKey || ''), -Number(net || 0));
    }

    const openingBalanceAccounts = baseAccounts;
    const openingBalanceRolloverMeta: OpeningBalanceRolloverMeta = {
      sourceYearKey: fromYearKey,
      generatedAt: new Date().toISOString(),
      lockedAccountCodes: openingBalanceAccounts.map((row) => row.accountCode),
      lockedDebtKinds: ['CUSTOMER_DEBT', 'SUPPLIER_DEBT'],
    };

    const journalEntries = [
      buildOpeningAccountJournalEntry(openingBalanceAccounts, rolloverRows, toYear.startDate),
      buildOpeningDebtJournalEntry('CUSTOMER_DEBT', rolloverRows, toYear.startDate),
      buildOpeningDebtJournalEntry('SUPPLIER_DEBT', rolloverRows, toYear.startDate),
    ].filter(Boolean) as JournalEntry[];

    return {
      openingBalanceAccounts,
      openingBalanceDebts: rolloverRows,
      openingBalanceRolloverMeta,
      journalEntries,
    };
  };

  const handleUpsertFinancialYear = async (
    year: FinancialYear,
    opts?: { rollover?: boolean; rolloverFromKey?: string },
  ): Promise<boolean> => {
    const newKey = makeYearKey(year);
    const currentKey = activeYearKey;
    const currentSnapshot = getCurrentYearSnapshot();
    let shouldRebaseOpeningCarry = false;

    if (opts?.rollover && newKey === currentKey) {
      window.alert(
        'Không thể thực hiện kết chuyển số dư: bạn chưa chọn niên độ đích khác với niên độ đang làm việc.\n\n' +
          'Hãy chọn kỳ mới trong « Niên độ hiện có » (hoặc tạo năm tài chính tiếp theo), sau đó bấm « Cập nhật niên độ ». ' +
          'Nếu không, hệ thống có thể ghi nhậm số dư mở đầu vào cùng kỳ đang mở — không đúng bản chất kết chuyển.',
      );
      return false;
    }

    const fromKey = (opts?.rolloverFromKey && typeof opts.rolloverFromKey === 'string') ? opts.rolloverFromKey : currentKey;
    const fromData = (fromKey === currentKey) ? currentSnapshot : (yearDataByKey[fromKey] || buildEmptyYearData([]));

    // Build or load target year data
    let target: YearData = yearDataByKey[newKey] || buildEmptyYearData(fromData.inventory);
    if (!target.accountingPeriods || target.accountingPeriods.length === 0) {
      target = { ...target, accountingPeriods: generateMonthlyPeriods(year) };
    }

    if (opts?.rollover) {
      // Niên độ đích đã có phát sinh: giữ nguyên bucket (tránh mất HĐ / kho / chứng từ khi bấm lại kết chuyển hoặc quay lại năm sau).
      const baselineForPreserve: YearData | null =
        newKey === currentKey ? currentSnapshot : (yearDataByKey[newKey] ?? null);
      if (baselineForPreserve && yearDataHasOperationalRecords(baselineForPreserve)) {
        target = {
          ...baselineForPreserve,
          accountingPeriods:
            baselineForPreserve.accountingPeriods?.length
              ? baselineForPreserve.accountingPeriods
              : generateMonthlyPeriods(year),
        };
        window.alert(
          'Niên độ đích đã có dữ liệu phát sinh (hóa đơn, kho, chứng từ, bút toán…). Hệ thống giữ nguyên toàn bộ dữ liệu đó, không áp dụng lại kết chuyển « sạch » để tránh mất số liệu.',
        );
      } else {
        const rolloverSnapshot = buildRolloverOpeningSnapshot(fromData, fromKey, year);

        target = {
          ...buildEmptyYearData(fromData.inventory),
          accountingPeriods: generateMonthlyPeriods(year),
          openingBalanceAccounts: rolloverSnapshot.openingBalanceAccounts,
          openingBalanceDebts: rolloverSnapshot.openingBalanceDebts,
          openingBalanceRolloverMeta: rolloverSnapshot.openingBalanceRolloverMeta,
          journalEntries: rolloverSnapshot.journalEntries,
          // Keep inventory with quantities/cost/serials from previous year as opening stock
          inventory: (fromData.inventory || []).map(i => ({ ...i })),
        };
        shouldRebaseOpeningCarry = true;
      }
    }

    const mergedYearDataByKey: Record<YearKey, YearData> = { ...yearDataByKey };
    if (newKey !== currentKey) {
      mergedYearDataByKey[currentKey] = currentSnapshot;
      mergedYearDataByKey[newKey] = target;
    } else {
      mergedYearDataByKey[currentKey] = opts?.rollover ? target : currentSnapshot;
    }

    const dataToLoad = newKey !== currentKey ? target : (opts?.rollover ? target : currentSnapshot);

    const updatedFinancialYears = financialYears.some(y => makeYearKey(y) === newKey)
      ? financialYears
      : [...financialYears, year].sort((a, b) => a.startDate.localeCompare(b.startDate));

    const currentCarryEntries = getOpeningAssetToolCarryForwards(systemConfig);
    const rolledCarryState = shouldRebaseOpeningCarry
      ? buildRolledOpeningCarryForwardStates(currentCarryEntries, assets, year.startDate)
      : { nextCarries: currentCarryEntries, nextAssets: assets };
    const nextAssets = rolledCarryState.nextAssets;
    const nextSystemConfig = shouldRebaseOpeningCarry
      ? withOpeningAssetToolCarryForwards(systemConfig, rolledCarryState.nextCarries)
      : systemConfig;

    const token = getToken();
    if (hydrated && backendAvailable && token) {
      const persistPayload = {
        financialYear: year,
        financialYears: updatedFinancialYears,
        activeYearKey: newKey,
        yearDataByKey: mergedYearDataByKey,
        accountingPeriods: dataToLoad.accountingPeriods,
        devices,
        invoices: dataToLoad.invoices,
        inventory: dataToLoad.inventory,
        journalEntries: dataToLoad.journalEntries,
        transactions: dataToLoad.transactions,
        fundTransactions: dataToLoad.fundTransactions,
        assets: nextAssets,
        accountingVouchers: dataToLoad.accountingVouchers,
        productionOrders: dataToLoad.productionOrders,
        accounts,
        customers,
        suppliers,
        employees,
        warehouses,
        expenseCategories,
        taxRates,
        paymentMethods,
        bankAccounts,
        cashFlowOpening: dataToLoad.cashFlowOpening,
        citExpenseMeta: dataToLoad.citExpenseMeta,
        citLossRecords: dataToLoad.citLossRecords,
        systemConfig: nextSystemConfig,
        companyInfo,
        warehouseFormHints,
        partnerNameHistory,
        catalogBackupSnapshot,
        inventoryCatalog,
        bomDefinitions,
        ...(stateResetMarkerRef.current != null ? { stateResetMarker: stateResetMarkerRef.current } : {}),
      };
      const strippedPersistPayload = stripOpeningDataFromStateSnapshot(persistPayload);
      const { openingBalancesPayload, debtDetailsPayload } = buildOpeningApiPayloadsFromYearDataMap(
        mergedYearDataByKey,
        newKey,
        dataToLoad,
      );
      try {
        const res = await fetch(`${API_PREFIX}/state`, {
          method: 'PUT',
          headers: apiAuthHeaders(token, true),
          body: JSON.stringify(strippedPersistPayload),
        });
        if (res.status === 401) {
          forceLogout();
          return false;
        }
        if (!res.ok) throw new Error('persist failed');
        const rev = readStateRevisionHeader(res);
        if (rev != null) {
          lastKnownStateRevisionRef.current = Math.max(lastKnownStateRevisionRef.current, rev);
        }
        const dataVersion = readStateDataVersionHeader(res);
        if (dataVersion != null) {
          stateDataVersionRef.current = dataVersion;
        }
        const openingPersisted = await persistOpeningDataToBackend(token, openingBalancesPayload, debtDetailsPayload);
        if (!openingPersisted) return false;
        lastOpeningPersistSignatureRef.current = JSON.stringify({
          openingBalancesPayload,
          debtDetailsPayload,
        });
        setPersistStatus({ lastOkAt: Date.now(), lastError: undefined });
      } catch (e) {
        console.error('[handleUpsertFinancialYear] persist', e);
        window.alert(
          'Không thể lưu dữ liệu lên máy chủ. Chuyển niên độ đã bị hủy để tránh mất dữ liệu. Vui lòng kiểm tra kết nối và thử lại.',
        );
        return false;
      }
    }

    isSwitchingYearRef.current = true;
    try {
      setYearDataByKey(mergedYearDataByKey);
      setFinancialYears(updatedFinancialYears);
      loadYearDataIntoState(dataToLoad, warehouses);
      setAssets(nextAssets);
      setSystemConfig(nextSystemConfig);
      setFinancialYear(year);
      setActiveYearKey(newKey);
      setActiveTab('dashboard');
    } finally {
      window.setTimeout(() => { isSwitchingYearRef.current = false; }, 0);
    }
    return true;
  };

  const handleReconcileInvoicesForActiveFiscalYear = useCallback(() => {
    const start = financialYear.startDate;
    const end = financialYear.endDate;
    const combined: Record<YearKey, YearData> = {
      ...yearDataByKey,
      [activeYearKey]: getCurrentYearSnapshot(),
    };

    const invLocal = new Set(invoices.map((i) => String(i.id)));
    const jeLocal = new Set(journalEntries.map((j) => String(j.id)));
    const vLocal = new Set(accountingVouchers.map((v) => String(v.id)));
    const tLocal = new Set(transactions.map((t) => String(t.id)));
    const fLocal = new Set(fundTransactions.map((f) => String(f.id)));
    const lossLocal = new Set(citLossRecords.map((r) => String(r.id)));
    const metaLocal = new Set(Object.keys(citExpenseMeta || {}));
    const fyCalYear = new Date(start).getFullYear();

    const toInv = new Map<string, Invoice>();
    const toJe = new Map<string, JournalEntry>();
    const toV = new Map<string, AccountingVoucher>();
    const toT = new Map<string, InventoryTransaction>();
    const toF = new Map<string, FundTransaction>();
    const toLoss = new Map<string, CITLossRecord>();

    for (const yd of Object.values(combined)) {
      for (const inv of yd.invoices || []) {
        if (!dateInFinancialYear(inv.date, start, end)) continue;
        const id = String(inv.id);
        if (invLocal.has(id)) continue;
        if (!toInv.has(id)) toInv.set(id, inv);
      }
      for (const je of yd.journalEntries || []) {
        if (!dateInFinancialYear(je.date, start, end)) continue;
        const id = String(je.id);
        if (jeLocal.has(id)) continue;
        if (!toJe.has(id)) toJe.set(id, je);
      }
      for (const v of yd.accountingVouchers || []) {
        if (!dateInFinancialYear(v.date, start, end)) continue;
        const id = String(v.id);
        if (vLocal.has(id)) continue;
        if (!toV.has(id)) toV.set(id, v);
      }
      for (const tr of yd.transactions || []) {
        if (!dateInFinancialYear(tr.date, start, end)) continue;
        const id = String(tr.id);
        if (tLocal.has(id)) continue;
        if (!toT.has(id)) toT.set(id, tr);
      }
      for (const ft of yd.fundTransactions || []) {
        if (!dateInFinancialYear(ft.date, start, end)) continue;
        const id = String(ft.id);
        if (fLocal.has(id)) continue;
        if (!toF.has(id)) toF.set(id, ft);
      }
      for (const lr of yd.citLossRecords || []) {
        if (Number(lr.year) !== fyCalYear) continue;
        const id = String(lr.id);
        if (lossLocal.has(id)) continue;
        if (!toLoss.has(id)) toLoss.set(id, lr);
      }
    }

    const mergeInvIds = new Set(toInv.keys());
    const mergeJeIds = new Set(toJe.keys());
    const mergeVIds = new Set(toV.keys());
    const mergeTIds = new Set(toT.keys());
    const mergeFIds = new Set(toF.keys());
    const mergeLossIds = new Set(toLoss.keys());

    const metaKeysToDrop = new Set<string>([...jeLocal, ...mergeJeIds]);
    const metaToAdd: Record<string, CITExpenseMeta> = {};
    for (const yd of Object.values(combined)) {
      const meta = yd.citExpenseMeta || {};
      for (const jeId of mergeJeIds) {
        if (metaLocal.has(jeId) || metaToAdd[jeId]) continue;
        const row = meta[jeId];
        if (row) metaToAdd[jeId] = row;
      }
    }
    const metaAddedCount = Object.keys(metaToAdd).length;

    let dupRows = 0;
    for (const [k, yd] of Object.entries(yearDataByKey)) {
      if (k === activeYearKey) continue;
      dupRows += (yd.invoices || []).filter((i) => invLocal.has(String(i.id))).length;
      dupRows += (yd.journalEntries || []).filter((j) => jeLocal.has(String(j.id))).length;
      dupRows += (yd.accountingVouchers || []).filter((v) => vLocal.has(String(v.id))).length;
      dupRows += (yd.transactions || []).filter((t) => tLocal.has(String(t.id))).length;
      dupRows += (yd.fundTransactions || []).filter((f) => fLocal.has(String(f.id))).length;
      dupRows += (yd.citLossRecords || []).filter((r) => lossLocal.has(String(r.id))).length;
    }

    const movedRows =
      toInv.size +
      toJe.size +
      toV.size +
      toT.size +
      toF.size +
      toLoss.size +
      metaAddedCount;
    if (movedRows === 0 && dupRows === 0) {
      return {
        ok: true,
        merged: 0,
        message:
          'Không có dữ liệu nào cần hợp nhất (theo ngày trong niên độ đang mở) hoặc bản trùng id giữa các bucket.',
      };
    }

    setYearDataByKey((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key === activeYearKey) continue;
        const yd = next[key];
        next[key] = {
          ...yd,
          invoices: (yd.invoices || []).filter(
            (i) => !invLocal.has(String(i.id)) && !mergeInvIds.has(String(i.id)),
          ),
          journalEntries: (yd.journalEntries || []).filter(
            (j) => !jeLocal.has(String(j.id)) && !mergeJeIds.has(String(j.id)),
          ),
          accountingVouchers: (yd.accountingVouchers || []).filter(
            (v) => !vLocal.has(String(v.id)) && !mergeVIds.has(String(v.id)),
          ),
          transactions: (yd.transactions || []).filter(
            (t) => !tLocal.has(String(t.id)) && !mergeTIds.has(String(t.id)),
          ),
          fundTransactions: (yd.fundTransactions || []).filter(
            (f) => !fLocal.has(String(f.id)) && !mergeFIds.has(String(f.id)),
          ),
          citLossRecords: (yd.citLossRecords || []).filter(
            (r) => !lossLocal.has(String(r.id)) && !mergeLossIds.has(String(r.id)),
          ),
          citExpenseMeta: stripCitExpenseMetaKeys(yd.citExpenseMeta, metaKeysToDrop),
        };
      }
      return next;
    });

    if (toInv.size > 0) {
      setInvoices((prev) => {
        const ids = new Set(prev.map((i) => String(i.id)));
        const add = [...toInv.values()].filter((inv) => !ids.has(String(inv.id)));
        return [...prev, ...add];
      });
    }
    if (toJe.size > 0) {
      setJournalEntries((prev) => {
        const ids = new Set(prev.map((j) => String(j.id)));
        const add = [...toJe.values()].filter((je) => !ids.has(String(je.id)));
        return [...prev, ...add];
      });
    }
    if (toV.size > 0) {
      setAccountingVouchers((prev) => {
        const ids = new Set(prev.map((v) => String(v.id)));
        const add = [...toV.values()].filter((v) => !ids.has(String(v.id)));
        return [...prev, ...add];
      });
    }
    if (toT.size > 0) {
      setTransactions((prev) => {
        const ids = new Set(prev.map((t) => String(t.id)));
        const add = [...toT.values()].filter((t) => !ids.has(String(t.id)));
        return [...prev, ...add];
      });
    }
    if (toF.size > 0) {
      setFundTransactions((prev) => {
        const ids = new Set(prev.map((f) => String(f.id)));
        const add = [...toF.values()].filter((f) => !ids.has(String(f.id)));
        return [...prev, ...add];
      });
    }
    if (toLoss.size > 0) {
      setCitLossRecords((prev) => {
        const ids = new Set(prev.map((r) => String(r.id)));
        const add = [...toLoss.values()].filter((r) => !ids.has(String(r.id)));
        return [...prev, ...add];
      });
    }
    if (metaAddedCount > 0) {
      setCitExpenseMeta((prev) => ({ ...prev, ...metaToAdd }));
    }

    const breakdown = {
      invoices: toInv.size,
      journalEntries: toJe.size,
      accountingVouchers: toV.size,
      transactions: toT.size,
      fundTransactions: toF.size,
      citLossRecords: toLoss.size,
      citExpenseMeta: metaAddedCount,
    };
    const merged = movedRows + dupRows;
    const msgParts = [
      `Hóa đơn: +${breakdown.invoices}`,
      `NKC: +${breakdown.journalEntries}`,
      `Chứng từ: +${breakdown.accountingVouchers}`,
      `Kho: +${breakdown.transactions}`,
      `Quỹ: +${breakdown.fundTransactions}`,
      `CIT lỗ: +${breakdown.citLossRecords}`,
      `Meta CIT (theo NKC): +${breakdown.citExpenseMeta}`,
    ];
    if (dupRows > 0) msgParts.push(`Đã gỡ ${dupRows} bản trùng id ở bucket niên độ khác`);
    return {
      ok: true,
      merged,
      breakdown,
      message: `Đã hợp nhất dữ liệu vào niên độ đang mở (${activeYearKey}). ${msgParts.join(' · ')}.`,
    };
  }, [
    financialYear,
    yearDataByKey,
    activeYearKey,
    invoices,
    journalEntries,
    accountingVouchers,
    transactions,
    fundTransactions,
    citLossRecords,
    citExpenseMeta,
  ]);

  const handleUpdateSystemConfig = (patch: Partial<SystemConfig>) =>
    setSystemConfig((prev) => ensureSystemConfigCompat({ ...prev, ...patch }));

  const handleToggleSystemLock = () =>
    setSystemConfig(prev => {
      const current = prev.openingBalanceLock || (prev.isOpeningBalanceLocked ? 'HARD' : 'OPEN');
      const next = current === 'OPEN' ? 'SOFT' : 'OPEN';
      return {
        ...prev,
        openingBalanceLock: next,
        isOpeningBalanceLocked: next !== 'OPEN',
        openingBalanceLockedBy: next === 'OPEN' ? undefined : 'Admin',
        openingBalanceLockedAt: next === 'OPEN' ? undefined : new Date().toISOString(),
      };
    });
  const isOpeningJournalEntry = (je: JournalEntry) => {
    const ref = (je.referenceId || '').toUpperCase();
    const desc = (je.description || '').toLowerCase();
    return (
      ref.startsWith('OPENING') ||
      isOpeningAssetCarryReferenceId(ref) ||
      je.id.startsWith('JE-OPEN') ||
      desc.includes('số dư đầu kỳ') ||
      desc.includes('dư nợ đầu kỳ') ||
      desc.includes('đầu kỳ chuyển kỳ')
    );
  };

  // Save opening entries by replacing existing ones of the same referenceId (avoid duplicates).
  const handleSaveOpeningJournal = (newEntries: JournalEntry[]) => {
    if (!assertOpeningEditable('lưu số dư đầu kỳ')) return;
    const normalizedEntries = normalizeJournalEntriesPaymentAccounts(newEntries);
    setJournalEntries((prev) => {
      const replaceRefSet = new Set(
        normalizedEntries.map((e) => String(e.referenceId || '').trim()).filter(Boolean),
      );
      const replaceDescSet = new Set(
        normalizedEntries.map((e) => String(e.description || '').trim()).filter(Boolean),
      );
      const filtered = prev.filter((e) => {
        const ref = String(e.referenceId || '').trim();
        const opening = isOpeningJournalEntry(e);
        // Remove prior opening entry with the same reference (stable replace).
        if (replaceRefSet.has(ref) && opening) {
          return false;
        }
        // Legacy: older builds could persist OPENING debt journals without referenceId; those were
        // never removed because refsToReplace.has(undefined) was false, so each save appended again.
        if (!ref && opening && replaceDescSet.has(String(e.description || '').trim())) {
          return false;
        }
        return true;
      });
      return [...filtered, ...normalizedEntries];
    });
  };

  const replaceOpeningAccountJournal = (
    nextAccounts: OpeningBalanceAccountRecord[],
    nextDebts: OpeningBalanceDebtDetail[],
  ) => {
    const openingEntry = buildOpeningAccountJournalEntry(nextAccounts, nextDebts, financialYear.startDate);
    setJournalEntries((prev) => {
      const filtered = prev.filter((entry) => String(entry.referenceId || '') !== 'OPENING-ACC');
      return openingEntry ? [...filtered, normalizeJournalEntriesPaymentAccounts([openingEntry])[0]] : filtered;
    });
  };

  const handleSaveOpeningBalanceAccounts = (rows: OpeningBalanceAccountRecord[]) => {
    if (!assertOpeningEditable('lưu bảng OpeningBalance')) return false;
    const normalizedRows = normalizeOpeningBalanceAccounts(rows)
      .map((row) => ({
        ...row,
        originMode:
          row.accountCode === '131' || row.accountCode === '331'
            ? row.originMode || 'MANUAL'
            : row.originMode || 'MANUAL',
      }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const generic1121Row = normalizedRows.find(
      (row) =>
        String(row.accountCode || '').trim() === '1121' &&
        (Number(row.debit || 0) > 0 || Number(row.credit || 0) > 0),
    );
    if (generic1121Row) {
      const bankLinked1121Codes = Array.from(
        new Set(
          bankAccounts
            .map((bank) => String(bank.linkedAccountCode || '').trim())
            .filter((code) => code.startsWith('1121') && code !== '1121'),
        ),
      ).sort((a, b) => a.localeCompare(b, 'vi'));
      if (bankLinked1121Codes.length === 0) {
        alert(
          'TK 1121 phải nhập đích danh theo từng tài khoản ngân hàng. Vui lòng khai báo tài khoản ngân hàng trước, sau đó nhập số dư vào các TK con 1121xxx thay vì TK 1121 tổng hợp.',
        );
        return false;
      }
      alert(
        `Không thể lưu số dư đầu kỳ trực tiếp vào TK 1121 tổng hợp. Vui lòng nhập vào đúng tài khoản ngân hàng liên kết: ${bankLinked1121Codes.join(', ')}.`,
      );
      return false;
    }
    setOpeningBalanceAccounts(normalizedRows);
    replaceOpeningAccountJournal(normalizedRows, openingBalanceDebts);
    alert('Đã lưu số dư OpeningBalance đầu kỳ.');
    return true;
  };

  const handleSaveOpeningDebtDetails = (kind: OpeningDebtKind, rows: OpeningBalanceDebtDetail[]) => {
    if (!assertOpeningEditable('lưu công nợ đầu kỳ')) return false;

    const partnerSource = kind === 'CUSTOMER_DEBT' ? customers : suppliers;
    const partnersById = new Map(partnerSource.map((partner) => [String(partner.id), partner]));
    const partnersByLookup = new Map<string, Customer | Supplier>();
    partnerSource.forEach((partner) => {
      const nameKey = String(partner.name || '').trim().toLowerCase();
      const codeKey = String(partner.code || '').trim().toLowerCase();
      if (nameKey) partnersByLookup.set(nameKey, partner);
      if (codeKey) partnersByLookup.set(codeKey, partner);
    });

    const cleanedRows: OpeningBalanceDebtDetail[] = [];

    for (let index = 0; index < (Array.isArray(rows) ? rows.length : 0); index++) {
      const raw = rows[index];
      if (!raw) continue;

      const partnerNameInput = String(raw.partnerName || '').trim();
      const invoiceNo = String(raw.invoiceNo || '').trim();
      const invoiceSymbolCode =
        raw.invoiceSymbolCode != null && String(raw.invoiceSymbolCode).trim()
          ? String(raw.invoiceSymbolCode).trim()
          : undefined;
      const revenueTypeInput = String(raw.revenueType || '').trim();
      const dueDate = raw.dueDate != null && String(raw.dueDate).trim() ? String(raw.dueDate).split('T')[0] : undefined;
      const note = raw.note != null && String(raw.note).trim() ? String(raw.note).trim() : undefined;
      const amount = Math.max(0, Number(raw.amount || 0));
      // Do not treat revenueType alone as "user input": the UI always has a <select> default, so an
      // otherwise blank draft row would look "touched" and block save/delete with a false
      // "chưa có tên đối tượng" error.
      const touched = Boolean(partnerNameInput || invoiceNo || invoiceSymbolCode || dueDate || note || amount > 0);

      if (!touched) continue;

      if (!partnerNameInput) {
        alert(`Dòng công nợ #${index + 1} chưa có tên đối tượng.`);
        return false;
      }
      if (!invoiceNo) {
        const okWithoutInvoice = window.confirm(
          'Khoản nợ này chưa gắn với hóa đơn doanh thu, bạn có muốn bổ sung để theo dõi tuổi nợ?',
        );
        if (!okWithoutInvoice) return false;
      }
      if (!(amount > 0)) {
        alert(`Dòng công nợ #${index + 1} phải có số tiền lớn hơn 0.`);
        return false;
      }
      if (!revenueTypeInput) {
        alert(`Dòng công nợ #${index + 1} chưa chọn loại doanh thu / nguồn nợ.`);
        return false;
      }

      const matchedPartner =
        (raw.partnerId != null && String(raw.partnerId).trim()
          ? partnersById.get(String(raw.partnerId).trim())
          : undefined) || partnersByLookup.get(partnerNameInput.toLowerCase());

      cleanedRows.push({
        id: String(raw.id || createEntityId('open-debt')),
        kind,
        partnerId:
          matchedPartner?.id ||
          (raw.partnerId != null && String(raw.partnerId).trim() ? String(raw.partnerId).trim() : undefined),
        partnerCode:
          matchedPartner?.code ||
          (raw.partnerCode != null && String(raw.partnerCode).trim() ? String(raw.partnerCode).trim() : undefined),
        partnerName: matchedPartner?.name ? String(matchedPartner.name).trim() : partnerNameInput,
        invoiceSymbolCode,
        invoiceNo,
        revenueType: normalizeOpeningDebtRevenueType(revenueTypeInput),
        amount,
        dueDate,
        note,
        accountCode: kind === 'CUSTOMER_DEBT' ? '131' : '331',
        sourceInvoiceId:
          raw.sourceInvoiceId != null && String(raw.sourceInvoiceId).trim() ? String(raw.sourceInvoiceId).trim() : undefined,
        sourceInvoiceNumber:
          raw.sourceInvoiceNumber != null && String(raw.sourceInvoiceNumber).trim()
            ? String(raw.sourceInvoiceNumber).trim()
            : undefined,
        sourceInvoiceDate:
          raw.sourceInvoiceDate != null && String(raw.sourceInvoiceDate).trim()
            ? String(raw.sourceInvoiceDate).split('T')[0]
            : undefined,
        sourceYearKey:
          raw.sourceYearKey != null && String(raw.sourceYearKey).trim() ? String(raw.sourceYearKey).trim() : undefined,
        openingYearKey: activeYearKey,
        originMode: raw.originMode === 'ROLLOVER' ? 'ROLLOVER' : 'MANUAL',
        readOnly: Boolean(raw.readOnly),
        lockReason: raw.lockReason != null && String(raw.lockReason).trim() ? String(raw.lockReason).trim() : undefined,
        syncStatus: raw.syncStatus === 'STALE' || raw.syncStatus === 'MISMATCHED' ? raw.syncStatus : 'MATCHED',
      });
    }

    const referenceId = getOpeningDebtReferenceId(kind);
    const totalAmount = cleanedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const nextDebts = [...openingBalanceDebts.filter((row) => row.kind !== kind), ...cleanedRows];

    setOpeningBalanceDebts(nextDebts);
    replaceOpeningAccountJournal(openingBalanceAccounts, nextDebts);

    if (cleanedRows.length === 0) {
      setJournalEntries((prev) => prev.filter((entry) => String(entry.referenceId || '') !== referenceId));
      alert(
        kind === 'CUSTOMER_DEBT'
          ? 'Đã xóa chi tiết công nợ khách hàng đầu kỳ.'
          : 'Đã xóa chi tiết công nợ nhà cung cấp đầu kỳ.',
      );
      return true;
    }

    const journalEntry: JournalEntry = {
      id: `JE-OPEN-DEBT-${kind}-${Date.now()}`,
      date: financialYear.startDate,
      referenceId,
      description: getOpeningDebtDescription(kind),
      details:
        kind === 'CUSTOMER_DEBT'
          ? [
              ...cleanedRows.map((row) => ({
                account: '131',
                debit: Number(row.amount || 0),
                credit: 0,
                objectType: 'CUSTOMER' as const,
                objectId: row.partnerId,
                objectName: row.partnerName,
                sourceInvoiceId: row.sourceInvoiceId,
                sourceInvoiceNumber: row.invoiceNo,
                invoiceSymbolCode: row.invoiceSymbolCode,
                openingRevenueType: row.revenueType,
                openingDueDate: row.dueDate,
                openingNote: row.note,
              })),
              {
                account: '131',
                debit: 0,
                credit: totalAmount,
                openingNote: 'Bù tổng chi tiết công nợ đầu kỳ',
              },
            ]
          : [
              {
                account: '331',
                debit: totalAmount,
                credit: 0,
                openingNote: 'Bù tổng chi tiết công nợ đầu kỳ',
              },
              ...cleanedRows.map((row) => ({
                account: '331',
                debit: 0,
                credit: Number(row.amount || 0),
                objectType: 'SUPPLIER' as const,
                objectId: row.partnerId,
                objectName: row.partnerName,
                sourceInvoiceId: row.sourceInvoiceId,
                sourceInvoiceNumber: row.invoiceNo,
                invoiceSymbolCode: row.invoiceSymbolCode,
                openingRevenueType: row.revenueType,
                openingDueDate: row.dueDate,
                openingNote: row.note,
              })),
            ],
    };

    handleSaveOpeningJournal([journalEntry]);
    alert(
      kind === 'CUSTOMER_DEBT'
        ? 'Đã lưu chi tiết công nợ khách hàng đầu kỳ.'
        : 'Đã lưu chi tiết công nợ nhà cung cấp đầu kỳ.',
    );
    return true;
  };

  const handleSaveOpeningStock = (items: any[]) => {
    if (!assertOpeningEditable('lưu tồn kho đầu kỳ')) return;
    const defaultWarehouseId = getDefaultWarehouseId(warehouses);
    const newItems = inventoryRef.current.map(i => {
      const match = items.find(m => m.itemId === i.id);
      if (match) {
        const nextSerials = (String(match.serials || '').split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean));
        // IMPORTANT: Opening stock should NOT create accounting entries and should NOT touch TK156.
        // It is only for operational stock details (quantity + serial list).
        return ensureWarehouseBalances(
          {
            ...i,
            quantity: Number(match.quantity || 0),
            // Do NOT update costPrice here to avoid double-counting value vs Opening balances.
            serials: nextSerials,
            // Keep serialDetails empty for opening stock (unknown inbound VAT per serial).
            serialDetails: [],
            warehouseBalances:
              Number(match.quantity || 0) > 0 || nextSerials.length > 0
                ? [
                    {
                      warehouseId: defaultWarehouseId,
                      quantity: Number(match.quantity || 0),
                      serials: nextSerials,
                      serialDetails: [],
                      updatedAt: new Date().toISOString(),
                    },
                  ]
                : [],
          },
          defaultWarehouseId,
        );
      }
      return ensureWarehouseBalances(i, defaultWarehouseId);
    });
    const touchedIds = new Set(items.map((item) => String(item?.itemId || '').trim()).filter(Boolean));
    const nextCatalog = syncCatalogFromInventoryRows(inventoryCatalogRef.current, newItems, touchedIds);
    const nextYearDataByKey = {
      ...yearDataByKeyRef.current,
      [activeYearKeyRef.current || activeYearKey]: {
        ...(yearDataByKeyRef.current[activeYearKeyRef.current || activeYearKey] || buildEmptyYearData([])),
        inventory: newItems,
      },
    } as Record<YearKey, YearData>;
    inventoryRef.current = newItems;
    inventoryCatalogRef.current = nextCatalog;
    yearDataByKeyRef.current = nextYearDataByKey;
    persistPendingRef.current = true;
    remoteEchoBodyRef.current = null;
    setPersistNonce((n) => n + 1);
    setInventory(newItems);
    setInventoryCatalog(nextCatalog);
    setYearDataByKey(nextYearDataByKey);
    alert("Đã lưu tồn kho đầu kỳ thành công.");
  };

  const handleClearOpeningData = () => {
    if (!assertOpeningEditable('xóa dữ liệu đầu kỳ')) return;
    // Remove all opening journal entries and reset opening stock quantities/costs.
    setJournalEntries(prev => prev.filter(e => !isOpeningJournalEntry(e)));
    setOpeningBalanceAccounts([]);
    setOpeningBalanceDebts([]);
    setOpeningBalanceRolloverMeta(undefined);
    setInventory(prev =>
      prev.map(i => ({
        ...i,
        quantity: 0,
        costPrice: 0,
        serials: [],
        serialDetails: [],
        warehouseBalances: [],
      }))
    );
    setSystemConfig((prev) => withOpeningAssetToolCarryForwards(prev, []));
    setAssets((prev) => prev.filter((a) => !isSyntheticOpeningCarryAssetId(String(a.id || ''))));
    alert('Đã xóa dữ liệu thiết lập ban đầu (số dư đầu kỳ, công nợ chi tiết đầu kỳ, tồn kho đầu kỳ & số dư CCDC/TSCĐ tham chiếu).');
  };

  const handleSaveCashFlowOpening = (values: Record<string, number>) => {
    if (!assertOpeningEditable('lưu số liệu B03 "Số đầu năm"')) return;
    setCashFlowOpening(values);
    alert('Đã lưu số liệu "Số đầu năm" cho Báo cáo lưu chuyển tiền tệ (B03).');
  };

  const handleSaveOpeningAssetToolCarryForward = (payload: OpeningAssetToolCarryForward): string | undefined => {
    if (!assertOpeningEditable('lưu số dư đầu kỳ CCDC/TSCĐ tham chiếu')) return undefined;
    const carryId = String(payload.id || '').trim() || newEntityId();
    setSystemConfig((prev) => {
      const existing = getOpeningAssetToolCarryForwards(prev);
      const previous = existing.find((row) => row.id === carryId);
      const totalM =
        payload.totalUsefulLifeMonths != null && String(payload.totalUsefulLifeMonths) !== ''
          ? Math.max(1, Math.round(Number(payload.totalUsefulLifeMonths)))
          : undefined;
      const oc = Math.max(0, Number(payload.originalCost || 0));
      const acc = Math.max(0, Number(payload.accumulatedDepreciation || 0));
      const autoLife = computeCarryForwardRemainingLifeMonths(oc, acc, totalM);
      const normalized = normalizeOpeningAssetToolCarryForwardEntry(
        {
          ...payload,
          id: carryId,
          totalUsefulLifeMonths: totalM,
          usefulLifeMonths:
            autoLife ??
            (payload.usefulLifeMonths != null && String(payload.usefulLifeMonths) !== ''
              ? Math.max(1, Math.round(Number(payload.usefulLifeMonths)))
              : undefined),
        },
        previous,
      );
      const nextEntries = previous
        ? existing.map((row) => (row.id === carryId ? normalized : row))
        : [...existing, normalized];
      return withOpeningAssetToolCarryForwards(prev, nextEntries);
    });
    alert(
      'Đã lưu 1 dòng số dư CCDC/TSCĐ đầu kỳ. Bạn có thể thêm nhiều dòng và ghi bút toán cho từng dòng hoặc toàn bộ danh sách.'
    );
    return carryId;
  };

  const handleDeleteOpeningAssetToolCarryForward = (id: string) => {
    if (!assertOpeningEditable('xóa số dư đầu kỳ CCDC/TSCĐ')) return;
    const currentRows = getOpeningAssetToolCarryForwards(systemConfig);
    const target = currentRows.find((row) => row.id === id);
    if (!target) return;
    const referenceId = target.openingEntryReferenceId || buildOpeningAssetCarryReferenceId(target.id);
    const syntheticId = target.syntheticAssetId || buildSyntheticOpeningCarryAssetId(target.id);
    setSystemConfig((prev) =>
      withOpeningAssetToolCarryForwards(
        prev,
        getOpeningAssetToolCarryForwards(prev).filter((row) => row.id !== id),
      ),
    );
    setJournalEntries((prev) => prev.filter((je) => String(je.referenceId || '') !== referenceId));
    setAssets((prev) => prev.filter((asset) => String(asset.id || '') !== syntheticId));
    alert('Đã xóa dòng số dư CCDC/TSCĐ đầu kỳ đã chọn.');
  };

  const handlePostOpeningAssetCarryJournal = (targetId?: string): boolean => {
    if (!assertOpeningEditable('ghi bút toán đầu kỳ TSCĐ/CCDC chuyển kỳ')) return false;
    const carryRows = getOpeningAssetToolCarryForwards(systemConfig);
    const selectedRows = targetId
      ? carryRows.filter((row) => row.id === targetId)
      : carryRows;
    if (selectedRows.length === 0) {
      alert('Vui lòng lưu ít nhất một dòng số dư đầu kỳ CCDC/TSCĐ trước.');
      return false;
    }
    const postingDate = financialYear.startDate;
    const nowIso = new Date().toISOString();
    const selectedIds = new Set(selectedRows.map((row) => row.id));
    const journalEntriesToSave: JournalEntry[] = [];
    const syntheticAssetsToSave: Asset[] = [];
    const syntheticIdsToReplace = new Set<string>();
    const nextCarryRows: OpeningAssetToolCarryForward[] = [];

    for (const ocf of carryRows) {
      if (!selectedIds.has(ocf.id)) {
        nextCarryRows.push(ocf);
        continue;
      }
      const oc = Math.max(0, Number(ocf.originalCost || 0));
      const acc = Math.max(0, Number(ocf.accumulatedDepreciation || 0));
      const res = Math.max(0, Number(ocf.residualCarriedForward || 0));
      const vat = Math.max(0, Number(ocf.openingVat1331 || 0));
      if (oc <= 0 && vat <= 0) {
        alert(`Dòng «${ocf.name || ocf.code || ocf.id}» cần ít nhất nguyên giá (> 0) hoặc VAT đầu kỳ 1331 (> 0) để ghi bút toán.`);
        return false;
      }
      const implied = Math.max(0, oc - acc);
      if ((oc > 0 || acc > 0) && Math.round(implied) !== Math.round(res)) {
        if (
          !window.confirm(
            `Cảnh báo tại dòng «${ocf.name || ocf.code || ocf.id}»: Nguyên giá − Hao mòn (${formatCurrency(implied)}) khác «Giá trị còn lại» (${formatCurrency(res)}). Vẫn ghi bút toán cân theo số Nợ/Có (411 = Nguyên giá + VAT − Hao mòn)?`
          )
        ) {
          return false;
        }
      }

      const isCcdc = ocf.carryKind === 'CCDC';
      const drAsset = normalizeLedgerAccountCode(ocf.accountOriginal, isCcdc ? '242' : '2112');
      const crAccum = normalizeLedgerAccountCode(ocf.accountAccumulated, isCcdc ? '242' : '214');
      const crEq = normalizeLedgerAccountCode(ocf.accountEquity, '4111');
      const details: { account: string; debit: number; credit: number }[] = [];
      let sumDr = 0;
      let sumCr = 0;
      if (oc > 0) {
        details.push({ account: drAsset, debit: oc, credit: 0 });
        sumDr += oc;
      }
      if (acc > 0) {
        details.push({ account: crAccum, debit: 0, credit: acc });
        sumCr += acc;
      }
      if (vat > 0) {
        details.push({ account: '1331', debit: vat, credit: 0 });
        sumDr += vat;
      }
      const eqCr = sumDr - sumCr;
      if (eqCr < 0) {
        alert(`Dòng «${ocf.name || ocf.code || ocf.id}» có tổng Có vượt tổng Nợ. Vui lòng kiểm tra lại nguyên giá, hao mòn và VAT đầu kỳ.`);
        return false;
      }
      if (eqCr > 0) {
        details.push({ account: crEq, debit: 0, credit: eqCr });
        sumCr += eqCr;
      }
      if (Math.round(sumDr) !== Math.round(sumCr)) {
        alert(`Bút toán đầu kỳ của dòng «${ocf.name || ocf.code || ocf.id}» không cân đối. Vui lòng kiểm tra lại số liệu.`);
        return false;
      }

      const referenceId = ocf.openingEntryReferenceId || buildOpeningAssetCarryReferenceId(ocf.id);
      const syntheticAssetId = ocf.syntheticAssetId || buildSyntheticOpeningCarryAssetId(ocf.id);
      const kindLabel = isCcdc ? 'CCDC' : 'TSCĐ';
      const titleBits = [ocf.code, ocf.name].filter(Boolean).join(' - ');
      journalEntriesToSave.push({
        id: `JE-OPEN-ASSET-CARRY-${ocf.id}`,
        date: postingDate,
        referenceId,
        description: `Đầu kỳ chuyển kỳ ${kindLabel}${titleBits ? ` [${titleBits}]` : ''} — Opening balance (không mua lại, không dòng tiền). NG ${formatCurrency(oc)} | HM ${formatCurrency(acc)} | GTCL ${formatCurrency(res)}${vat ? ` | VAT 1331 ${formatCurrency(vat)}` : ''}${ocf.accountingNote ? `. ${ocf.accountingNote}` : ''}`.slice(0, 500),
        details,
      });

      const needSynthetic = oc > 0 || res > 0;
      syntheticIdsToReplace.add(syntheticAssetId);
      const nextCarry = normalizeOpeningAssetToolCarryForwardEntry(
        {
          ...ocf,
          openingEntryPosted: true,
          openingPostedAt: nowIso,
          openingEntryReferenceId: referenceId,
          syntheticAssetId: needSynthetic ? syntheticAssetId : undefined,
        },
        ocf,
      );
      nextCarryRows.push(nextCarry);
      if (needSynthetic) syntheticAssetsToSave.push(buildSyntheticOpeningCarryAsset(nextCarry, postingDate));
    }

    handleSaveOpeningJournal(journalEntriesToSave);
    setAssets((prev) => {
      const filtered = prev.filter((asset) => !syntheticIdsToReplace.has(String(asset.id || '')));
      return [...filtered, ...syntheticAssetsToSave];
    });
    setSystemConfig((prev) => withOpeningAssetToolCarryForwards(prev, nextCarryRows));

    alert(
      selectedRows.length > 1
        ? `Đã ghi ${selectedRows.length} nhật ký đầu kỳ và tạo/cập nhật ${syntheticAssetsToSave.length} thẻ tài sản tổng hợp để khấu hao / phân bổ tiếp.`
        : 'Đã ghi nhật ký đầu kỳ (Opening entry — có thể ghi lại để cập nhật) và tạo/cập nhật thẻ tài sản để trích khấu hao / phân bổ hàng tháng. Không sinh mua vào, không VAT mua, không phiếu quỹ.'
    );
    return true;
  };

  const resetHotelPmsClientState = () => {
    setHotelPmsState(getDefaultHotelPmsState());
    clearHotelPmsState();
    setHotelPmsResetNonce((n) => n + 1);
  };

  // Hard reset: máy chủ xóa sạch toàn bộ dữ liệu (SQLite), sau đó tải lại trang để
  // nạp lại từ trạng thái trống. Dùng reload thay vì cập nhật state trong bộ nhớ để
  // loại bỏ hoàn toàn các tranh chấp persist/hợp nhất realtime khiến dữ liệu cũ "phục hồi".
  const handleResetAllData = async () => {
    // Chặn ngay mọi persist (kể cả timeout đã hẹn trước khi bấm reset) để không ghi
    // lại dữ liệu cũ còn trong bộ nhớ lên DB vừa được xóa sạch.
    resetInProgressRef.current = true;
    suppressPersistUntilRef.current = Date.now() + 120_000;
    try {
      const token = getToken();
      const res = await fetch(`${API_PREFIX}/reset`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status === 401) {
        forceLogout();
        return;
      }
      if (res.status === 403) {
        resetInProgressRef.current = false;
        suppressPersistUntilRef.current = 0;
        alert('Tài khoản của bạn không có quyền xóa sạch dữ liệu. Vui lòng đăng nhập bằng tài khoản quản trị (admin/super admin) rồi thử lại.');
        return;
      }
      if (!res.ok) throw new Error('reset failed');
      // Máy chủ đã xóa sạch DB. Dọn cache cục bộ rồi tải lại trang.
      resetHotelPmsClientState();
      try {
        sessionStorage.setItem('sme_hotel_post_reset', '1');
      } catch {
        /* ignore */
      }
      alert('Đã xóa sạch dữ liệu cũ (kế toán + Hotel PMS). Hệ thống sẽ tải lại để khởi tạo trạng thái trống.');
      window.location.reload();
    } catch (err) {
      console.warn('Backend reset failed.', err);
      resetInProgressRef.current = false;
      suppressPersistUntilRef.current = 0;
      alert('Không thể xóa sạch dữ liệu vì máy chủ không phản hồi. Hãy đảm bảo máy chủ (backend) đang chạy rồi thử lại.');
    }
  };
  const handlePeriodClosing = (entries: JournalEntry[]) => setJournalEntries(prev => [...prev, ...entries]);
  const handleUndoPeriodClosing = (ref: string) => setJournalEntries(prev => prev.filter(e => e.referenceId !== ref));
  const canLockSequentially = (periods: AccountingPeriod[], targetId: string) => {
    const ordered = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const idx = ordered.findIndex(p => p.id === targetId);
    if (idx < 0) return true;
    return ordered.slice(0, idx).every(p => p.status === 'CLOSED');
  };

  const canUnlockSequentially = (periods: AccountingPeriod[], targetId: string) => {
    const ordered = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const idx = ordered.findIndex(p => p.id === targetId);
    if (idx < 0) return true;
    return ordered.slice(idx + 1).every(p => p.status === 'OPEN');
  };

  const setPeriodLock = (id: string, lockType: 'SOFT' | 'HARD' | 'OPEN') => {
    setAccountingPeriods(prev => {
      const target = prev.find(p => p.id === id);
      if (!target) return prev;

      if (lockType === 'OPEN') {
        if (!canUnlockSequentially(prev, id)) {
          alert('Không thể mở sổ kỳ này vì vẫn còn kỳ sau đang khóa. Hãy mở sổ từ kỳ gần nhất trở về trước.');
          return prev;
        }
      } else {
        if (!canLockSequentially(prev, id)) {
          alert('Không thể khóa sổ kỳ này vì có kỳ trước chưa khóa. Hãy khóa theo thứ tự từ tháng đầu năm.');
          return prev;
        }
      }

      return prev.map(p => {
        if (p.id !== id) return p;
        if (lockType === 'OPEN') return { ...p, status: 'OPEN', lockType: undefined, lockedBy: undefined, lockedAt: undefined };
        return { ...p, status: 'CLOSED', lockType, lockedBy: 'Admin', lockedAt: new Date().toISOString() };
      });
    });
  };

  const togglePeriodLock = (id: string) => {
    const p = accountingPeriods.find(x => x.id === id);
    if (!p) return;
    if (p.status === 'OPEN') setPeriodLock(id, 'SOFT');
    else setPeriodLock(id, 'OPEN');
  };

  const setOpeningBalanceLock = (lock: 'OPEN' | 'SOFT' | 'HARD') => {
    setSystemConfig(prev => ({
      ...prev,
      openingBalanceLock: lock,
      isOpeningBalanceLocked: lock !== 'OPEN',
      openingBalanceLockedBy: lock === 'OPEN' ? undefined : 'Admin',
      openingBalanceLockedAt: lock === 'OPEN' ? undefined : new Date().toISOString(),
    }));
  };

  const value = {
    activeTab,
    setActiveTab,
    hydrated,
    backendAvailable,
    persistStatus,
    financialYears,
    activeYearKey,
    devices,
    invoices,
    allInvoicesAcrossYears,
    misplacedYearDataTotal,
    inventory,
    inventoryCatalog,
    bomDefinitions,
    warehouseInventoryItems,
    productionOrders,
    journalEntries,
    allJournalEntriesAcrossYears,
    transactions,
    allTransactionsAcrossYears,
    fundTransactions,
    assets,
    accountingVouchers,
    accountingPeriods,
    accounts,
    customers,
    suppliers,
    employees,
    warehouses,
    expenseCategories,
    taxRates,
    paymentMethods,
    bankAccounts,
    cashFlowOpening,
    openingBalanceAccounts,
    openingBalanceDebts,
    openingBalanceRolloverMeta,
    citExpenseMeta,
    citLossRecords,
    financialYear,
    systemConfig,
    companyInfo,
    modals,
    setModals,
    previewDocumentNumber,
    handleAddDevice,
    handleBulkAddDevices,
    handleUpdateDevice,
    handleDeleteDevice,
    handleRenewConfirm,
    handleInventoryActions,
    handleUpdateInventoryTransactionMeta,
    handleDeleteInventoryTransaction,
    validateDeleteInventoryItemAdvanced,
    handleDeleteInventoryItemAdvanced,
    handleCreateInvoice,
    handlePostHotelPmsCheckout,
    handlePostHotelPmsExpense,
    handleUpdateInvoice,
    handleDeleteInvoice,
    handleReceiveInvoicePayment,
    handlePayPurchaseInvoice,
    handleFundAction,
    handleDeleteFundTransaction,
    handleSaveBankAccount,
    handleDeleteBankAccount,
    handleToggleBankAccountStatus,
    handleAddCatalogItem,
    handleUpdateCatalogItem,
    handleDeleteCatalogItem,
    handleImportInventoryCatalogFromExcel,
    handleUpsertBomDefinition,
    handleDeleteBomDefinition,
    handleUpsertProductionOrder,
    handleDeleteProductionOrder,
    handleReleaseProductionOrder,
    handleCompleteProductionOrder,
    handleUpdateCITMeta,
    handleUpdateLossRecord,
    handleUpdateCITLossRecord,
    handleSaveVoucher,
    handleDeleteVoucher,
    handlePostVoucher,
    handleUnpostVoucher,
    handleAddAsset,
    handleUpdateAsset,
    handleDeleteAsset,
    handleTransferAssets,
    handlePutCcdcIntoUse,
    handleLiquidateAsset,
    handleRunDepreciation,
    handleUpdateCompanyInfo,
    handleUpsertFinancialYear,
    handleReconcileInvoicesForActiveFiscalYear,
    handleUpdateSystemConfig,
    handleToggleSystemLock,
    handleSaveOpeningBalanceAccounts,
    handleSaveOpeningJournal,
    handleSaveOpeningDebtDetails,
    handleSaveOpeningStock,
    handleClearOpeningData,
    handleSaveCashFlowOpening,
    handleSaveOpeningAssetToolCarryForward,
    handleDeleteOpeningAssetToolCarryForward,
    handlePostOpeningAssetCarryJournal,
    handleResetAllData,
    retryLoadState,
    handlePeriodClosing,
    handleUndoPeriodClosing,
    togglePeriodLock,
    setPeriodLock,
    setOpeningBalanceLock,
    warehouseFormHints,
    patchWarehouseFormHints,
    partnerNameHistory,
    rememberPartnerName,
    catalogSection,
    setCatalogSection,
    hotelPmsResetNonce,
    hotelPmsState,
    setHotelPmsState,
    refreshHotelPmsFromBackend,
  };
  return React.createElement(AppContext.Provider, { value }, children);
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
