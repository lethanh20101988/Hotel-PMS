import type {
  BomAlertOverride,
  BomAlertSeverity,
  BomAlertStatus,
  Bom154Category,
  BomComponentLine,
  BomCostMethod,
  BomDefinition,
  BomMrpPlanLine,
  BomVersionStatus,
  InventoryItem,
  InventoryTransaction,
  Warehouse,
} from '../types';
import { getWarehouseQuantity } from './warehouseInventory';

export const BOM_154_CATEGORY_OPTIONS: Array<{ value: Bom154Category; label: string }> = [
  { value: 'DIRECT_MATERIAL', label: 'NVL trực tiếp' },
  { value: 'DIRECT_LABOR', label: 'Nhân công trực tiếp' },
  { value: 'OVERHEAD', label: 'Sản xuất chung' },
];

const BOM_STATUS_LABELS: Record<BomVersionStatus, string> = {
  DRAFT: 'Nháp',
  APPROVED: 'Approved / Active',
  OBSOLETE: 'Obsolete',
};

const BOM_COST_METHOD_LABELS: Record<BomCostMethod, string> = {
  STANDARD: 'Standard Cost',
  ACTUAL: 'Actual Cost',
  AVERAGE: 'Average Cost',
};

const BOM_ALERT_SEVERITY_LABELS: Record<BomAlertSeverity, string> = {
  INFO: 'Info',
  WARNING: 'Warning',
  CRITICAL: 'Critical',
};

const BOM_ALERT_STATUS_LABELS: Record<BomAlertStatus, string> = {
  NEW: 'New',
  SEEN: 'Seen',
  RESOLVED: 'Resolved',
};

const STOCK_ACCOUNT_PREFIXES = ['152', '153', '156'] as const;
export const DEFAULT_BOM_MAX_DEPTH = 10;
const BOM_CYCLE_MAX_DEPTH = 24;
const BOM_QTY_EPSILON = 1e-6;

const todayIsoDate = () => new Date().toISOString().split('T')[0];

const safeIsoDate = (raw?: string | null) => {
  const value = String(raw || '').trim();
  return value ? value.split('T')[0] : '';
};

const compareDateDesc = (a?: string | null, b?: string | null) => {
  const left = safeIsoDate(a);
  const right = safeIsoDate(b);
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left < right ? 1 : -1;
};

const toItemMap = (items: InventoryItem[]) => {
  const map = new Map<string, InventoryItem>();
  for (const item of items || []) {
    map.set(String(item.id || '').trim(), item);
  }
  return map;
};

const quantityEpsilonEqual = (left: number, right: number) => Math.abs(left - right) <= BOM_QTY_EPSILON;

const accumulateLineQuantities = (
  lines: Array<{ itemId?: string; qty?: number }>,
): Map<string, number> => {
  const map = new Map<string, number>();
  for (const line of lines || []) {
    const itemId = String(line?.itemId || '').trim();
    if (!itemId) continue;
    const qty = roundBomQuantity(Number(line?.qty || 0));
    map.set(itemId, roundBomQuantity((map.get(itemId) || 0) + qty));
  }
  return map;
};

function sortBomDefinitionsForParent(a: BomDefinition, b: BomDefinition) {
  const versionDiff = getBomVersionNumber(b) - getBomVersionNumber(a);
  if (versionDiff !== 0) return versionDiff;
  const effectiveDiff = compareDateDesc(a.effectiveDate, b.effectiveDate);
  if (effectiveDiff !== 0) return effectiveDiff;
  const updatedDiff = compareDateDesc(a.updatedAt, b.updatedAt);
  if (updatedDiff !== 0) return updatedDiff;
  return String(b.id || '').localeCompare(String(a.id || ''), 'vi');
}

function getGraphDefinitionForParent(
  definitions: BomDefinition[],
  parentItemId: string,
  targetDate?: string,
): BomDefinition | undefined {
  const versions = getBomVersionsForParent(definitions, parentItemId);
  const active = versions.find((definition) => isBomVersionActive(definition, targetDate));
  if (active) return active;
  const approved = versions.find((definition) => normalizeBomVersionStatus(definition.status) === 'APPROVED');
  if (approved) return approved;
  return versions[0];
}

function resolveAlertStatusForKey(
  key: string,
  overrides?: BomAlertOverride[],
): BomAlertStatus {
  const override = (overrides || []).find((item) => String(item.key || '').trim() === key);
  return override?.status || 'NEW';
}

export function getBom154CategoryLabel(value: Bom154Category): string {
  return BOM_154_CATEGORY_OPTIONS.find((option) => option.value === value)?.label || value;
}

export function getBomVersionStatusLabel(value?: BomVersionStatus | null): string {
  return BOM_STATUS_LABELS[normalizeBomVersionStatus(value)] || BOM_STATUS_LABELS.DRAFT;
}

export function getBomCostMethodLabel(value?: BomCostMethod | null): string {
  const method = normalizeBomCostMethod(value);
  return BOM_COST_METHOD_LABELS[method] || BOM_COST_METHOD_LABELS.STANDARD;
}

export function getBomAlertSeverityLabel(value: BomAlertSeverity): string {
  return BOM_ALERT_SEVERITY_LABELS[value] || value;
}

export function getBomAlertStatusLabel(value: BomAlertStatus): string {
  return BOM_ALERT_STATUS_LABELS[value] || value;
}

export function normalizeBomVersionStatus(raw?: string | null): BomVersionStatus {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'APPROVED') return 'APPROVED';
  if (value === 'OBSOLETE') return 'OBSOLETE';
  return 'DRAFT';
}

export function normalizeBomCostMethod(raw?: string | null): BomCostMethod {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'ACTUAL') return 'ACTUAL';
  if (value === 'AVERAGE') return 'AVERAGE';
  return 'STANDARD';
}

export function getBomVersionNumber(definition?: BomDefinition | null): number {
  const version = Math.floor(Number(definition?.versionNumber || 1));
  return Number.isFinite(version) && version > 0 ? version : 1;
}

export function getBomVersionCode(definition?: BomDefinition | null): string {
  const explicitCode = String(definition?.versionCode || '').trim();
  return explicitCode || `V${getBomVersionNumber(definition)}`;
}

export function getBomVersionsForParent(
  definitions: BomDefinition[],
  parentItemId?: string,
): BomDefinition[] {
  const parentId = String(parentItemId || '').trim();
  if (!parentId) return [];
  return (definitions || [])
    .filter((definition) => String(definition.parentItemId || '').trim() === parentId)
    .sort(sortBomDefinitionsForParent);
}

export function isBomVersionActive(
  definition: BomDefinition | undefined,
  targetDate?: string,
): boolean {
  if (!definition) return false;
  if (normalizeBomVersionStatus(definition.status) !== 'APPROVED') return false;
  const target = safeIsoDate(targetDate) || todayIsoDate();
  const effectiveDate = safeIsoDate(definition.effectiveDate);
  const expiryDate = safeIsoDate(definition.expiryDate);
  if (effectiveDate && effectiveDate > target) return false;
  if (expiryDate && expiryDate < target) return false;
  return true;
}

export function getBomDefinitionForParent(
  definitions: BomDefinition[],
  parentItemId?: string,
  targetDate?: string,
): BomDefinition | undefined {
  const parentId = String(parentItemId || '').trim();
  if (!parentId) return undefined;
  const active = getBomVersionsForParent(definitions, parentId).find((definition) =>
    isBomVersionActive(definition, targetDate),
  );
  if (active) return active;
  return undefined;
}

export function normalizeBomAccountCode(raw?: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const matched = value.match(/^(\d{3,4})/);
  if (matched) return matched[1];
  return value.split(/[\s-]/)[0] || '';
}

export function isProductionExportPurpose(raw?: string): boolean {
  const account = normalizeBomAccountCode(raw);
  return account === '154' || account === '1541' || account === '1542';
}

export function isStockCreditAccount(raw?: string): boolean {
  const account = normalizeBomAccountCode(raw);
  return STOCK_ACCOUNT_PREFIXES.some((prefix) => account.startsWith(prefix));
}

export function roundBomQuantity(value: number): number {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(6));
}

export function computeBomRequiredQuantity(
  quantityPerUnit: number,
  parentQuantity: number,
  lossRate: number,
  lossQuantityPerUnit = 0,
): number {
  const baseQtyPerUnit = Math.max(0, Number(quantityPerUnit || 0)) + Math.max(0, Number(lossQuantityPerUnit || 0));
  const base = baseQtyPerUnit * Math.max(0, Number(parentQuantity || 0));
  const factor = 1 + Math.max(0, Number(lossRate || 0)) / 100;
  return roundBomQuantity(base * factor);
}

export function resolveBomComponentItem(
  component: BomComponentLine,
  items: InventoryItem[],
): InventoryItem | undefined {
  const componentId = String(component.componentItemId || '').trim();
  if (!componentId) return undefined;
  return (items || []).find((item) => String(item.id || '').trim() === componentId);
}

export function isStockTrackedBomComponent(
  component: BomComponentLine,
  item?: InventoryItem | null,
): boolean {
  if (component.account154Category !== 'DIRECT_MATERIAL') return false;
  return isStockCreditAccount(item?.accountCode);
}

export interface BomResolvedComponent {
  component: BomComponentLine;
  item?: InventoryItem;
  requiredQuantity: number;
  isStockTracked: boolean;
}

export interface BomPlannedStockLine {
  component: BomComponentLine;
  item: InventoryItem;
  requiredQuantity: number;
}

export interface BomStockShortage {
  itemId: string;
  item?: InventoryItem;
  requiredQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
}

export interface BomTreeNode {
  key: string;
  level: number;
  path: string[];
  component: BomComponentLine;
  itemId: string;
  item?: InventoryItem;
  requiredQuantity: number;
  isStockTracked: boolean;
  children: BomTreeNode[];
  nestedDefinition?: BomDefinition;
  cycleDetected?: boolean;
  missingItem?: boolean;
  maxDepthReached?: boolean;
}

export interface BomTreeRoot {
  key: string;
  itemId: string;
  item?: InventoryItem;
  quantity: number;
  definition?: BomDefinition;
  children: BomTreeNode[];
  maxDepthReached: boolean;
}

export interface BomExplosionLine {
  key: string;
  parentItemId: string;
  itemId: string;
  item?: InventoryItem;
  level: number;
  path: string[];
  component: BomComponentLine;
  requiredQuantity: number;
  isLeaf: boolean;
  isStockTracked: boolean;
  nestedDefinition?: BomDefinition;
}

export interface BomCostLine {
  key: string;
  itemId: string;
  item?: InventoryItem;
  path: string[];
  level: number;
  category: Bom154Category;
  requiredQuantity: number;
  baseQuantity: number;
  scrapQuantity: number;
  unitCost: number;
  extendedCost: number;
  scrapCost: number;
  method: BomCostMethod;
  source: 'STANDARD' | 'AVERAGE' | 'ACTUAL' | 'FALLBACK';
}

export interface BomCostSummary {
  method: BomCostMethod;
  asOfDate: string;
  quantity: number;
  lines: BomCostLine[];
  unitCost: number;
  totalCost: number;
  materialCost: number;
  laborCost: number;
  overheadCost: number;
  scrapCost: number;
}

export interface BomInventoryCheckLine {
  itemId: string;
  item?: InventoryItem;
  requiredQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  netAvailableQuantity: number;
  shortageQuantity: number;
  level: number;
  path: string[];
}

export interface BomInventoryCheckResult {
  lines: BomInventoryCheckLine[];
  hasShortage: boolean;
  blocked: boolean;
  totalRequiredQuantity: number;
  totalShortageQuantity: number;
}

export interface BomComputedAlert {
  key: string;
  code:
    | 'NO_ACTIVE_VERSION'
    | 'VERSION_OVERLAP'
    | 'OBSOLETE_VERSION'
    | 'INVALID_DATE_RANGE'
    | 'MISSING_COMPONENT'
    | 'MISSING_ITEM'
    | 'CYCLE'
    | 'MAX_DEPTH'
    | 'SHORTAGE'
    | 'MULTI_APPROVED'
    | 'MISSING_APPROVED_VERSION';
  severity: BomAlertSeverity;
  status: BomAlertStatus;
  title: string;
  message: string;
  componentItemId?: string;
  path?: string[];
}

export interface BomMrpResultLine {
  itemId: string;
  item?: InventoryItem;
  warehouseId?: string;
  warehouseName?: string;
  requiredQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  netRequirement: number;
  recommendation: 'NONE' | 'PURCHASE' | 'TRANSFER' | 'PURCHASE_OR_TRANSFER';
}

export interface BomMrpResult {
  lines: BomMrpResultLine[];
  alerts: BomComputedAlert[];
  planCount: number;
  totalRequiredQuantity: number;
  totalNetRequirement: number;
}

export function resolveBomDefinitionComponents(
  definition: BomDefinition | undefined,
  items: InventoryItem[],
  parentQuantity: number,
): BomResolvedComponent[] {
  if (!definition) return [];
  return (definition.components || []).map((component) => {
    const item = resolveBomComponentItem(component, items);
    return {
      component,
      item,
      requiredQuantity: computeBomRequiredQuantity(
        component.quantity,
        parentQuantity,
        component.lossRate,
        component.lossQuantity || 0,
      ),
      isStockTracked: isStockTrackedBomComponent(component, item),
    };
  });
}

export function buildBomPlannedStockLines(
  definition: BomDefinition | undefined,
  items: InventoryItem[],
  parentQuantity: number,
): BomPlannedStockLine[] {
  return resolveBomDefinitionComponents(definition, items, parentQuantity)
    .filter(
      (entry): entry is BomResolvedComponent & { item: InventoryItem } =>
        Boolean(entry.item) && entry.isStockTracked && entry.requiredQuantity > 0,
    )
    .map((entry) => ({
      component: entry.component,
      item: entry.item,
      requiredQuantity: entry.requiredQuantity,
    }));
}

export function buildBomTree(
  definition: BomDefinition | undefined,
  definitions: BomDefinition[],
  items: InventoryItem[],
  parentQuantity: number,
  opts?: { asOfDate?: string; maxDepth?: number },
): BomTreeRoot | null {
  if (!definition) return null;
  const itemMap = toItemMap(items);
  const maxDepth = Math.min(Math.max(1, Number(opts?.maxDepth || DEFAULT_BOM_MAX_DEPTH)), BOM_CYCLE_MAX_DEPTH);
  const asOfDate = safeIsoDate(opts?.asOfDate) || todayIsoDate();
  const rootItemId = String(definition.parentItemId || '').trim();
  let maxDepthReached = false;

  const visit = (
    currentDefinition: BomDefinition,
    qty: number,
    level: number,
    path: string[],
    stack: Set<string>,
  ): BomTreeNode[] =>
    (currentDefinition.components || []).map((component, index) => {
      const itemId = String(component.componentItemId || '').trim();
      const item = itemMap.get(itemId);
      const requiredQuantity = computeBomRequiredQuantity(
        component.quantity,
        qty,
        component.lossRate,
        component.lossQuantity || 0,
      );
      const nextPath = [...path, itemId || `${index}`];
      const cycleDetected = stack.has(itemId);
      const nestedDefinition = cycleDetected
        ? undefined
        : getGraphDefinitionForParent(definitions, itemId, asOfDate);
      const canDive = Boolean(nestedDefinition) && level < maxDepth;
      if (Boolean(nestedDefinition) && level >= maxDepth) maxDepthReached = true;
      const nextStack = new Set(stack);
      nextStack.add(itemId);
      return {
        key: nextPath.join('>'),
        level,
        path: nextPath,
        component,
        itemId,
        item,
        requiredQuantity,
        isStockTracked: isStockTrackedBomComponent(component, item),
        nestedDefinition,
        cycleDetected,
        missingItem: !item,
        maxDepthReached: Boolean(nestedDefinition) && level >= maxDepth,
        children:
          canDive && nestedDefinition
            ? visit(nestedDefinition, requiredQuantity, level + 1, nextPath, nextStack)
            : [],
      };
    });

  return {
    key: `root:${rootItemId}:${definition.id}`,
    itemId: rootItemId,
    item: itemMap.get(rootItemId),
    quantity: Math.max(0, Number(parentQuantity || 0)),
    definition,
    children: visit(definition, Math.max(0, Number(parentQuantity || 0)), 1, [rootItemId], new Set([rootItemId])),
    maxDepthReached,
  };
}

export function explodeBomRequirements(
  definition: BomDefinition | undefined,
  definitions: BomDefinition[],
  items: InventoryItem[],
  parentQuantity: number,
  opts?: { asOfDate?: string; maxDepth?: number },
): BomExplosionLine[] {
  if (!definition) return [];
  const tree = buildBomTree(definition, definitions, items, parentQuantity, opts);
  if (!tree) return [];
  const lines: BomExplosionLine[] = [];

  const walk = (nodes: BomTreeNode[]) => {
    for (const node of nodes) {
      const isLeaf = node.children.length === 0 || node.cycleDetected || node.maxDepthReached;
      lines.push({
        key: node.key,
        parentItemId: tree.itemId,
        itemId: node.itemId,
        item: node.item,
        level: node.level,
        path: node.path,
        component: node.component,
        requiredQuantity: node.requiredQuantity,
        isLeaf,
        isStockTracked: node.isStockTracked,
        nestedDefinition: node.nestedDefinition,
      });
      if (node.children.length > 0) walk(node.children);
    }
  };

  walk(tree.children);
  return lines;
}

export function hasBomPlannedStockVariance(
  plannedLines: Array<{ itemId?: string; requiredQuantity?: number }>,
  actualLines: Array<{ itemId?: string; qty?: number }>,
): boolean {
  const planned = new Map<string, number>();
  for (const line of plannedLines || []) {
    const itemId = String(line?.itemId || '').trim();
    if (!itemId) continue;
    const qty = roundBomQuantity(Number(line?.requiredQuantity || 0));
    planned.set(itemId, roundBomQuantity((planned.get(itemId) || 0) + qty));
  }
  const actual = accumulateLineQuantities(actualLines);
  const keys = new Set<string>([...planned.keys(), ...actual.keys()]);
  for (const key of keys) {
    if (!quantityEpsilonEqual(planned.get(key) || 0, actual.get(key) || 0)) {
      return true;
    }
  }
  return false;
}

export function getBomStockShortages(
  lines: Array<{ itemId?: string; qty?: number }>,
  items: InventoryItem[],
): BomStockShortage[] {
  return Array.from(accumulateLineQuantities(lines).entries())
    .map(([itemId, requiredQuantity]) => {
      const item = (items || []).find((entry) => String(entry.id || '').trim() === itemId);
      const availableQuantity = roundBomQuantity(Number(item?.quantity || 0));
      const shortageQuantity = roundBomQuantity(requiredQuantity - availableQuantity);
      return {
        itemId,
        item,
        requiredQuantity,
        availableQuantity,
        shortageQuantity,
      };
    })
    .filter((entry) => entry.shortageQuantity > BOM_QTY_EPSILON);
}

export function getBomInventoryCheck(
  definition: BomDefinition | undefined,
  definitions: BomDefinition[],
  items: InventoryItem[],
  parentQuantity: number,
  opts?: {
    asOfDate?: string;
    maxDepth?: number;
    reservedByItemId?: Record<string, number>;
    blockOnShortage?: boolean;
  },
): BomInventoryCheckResult {
  const stockLeafLines = explodeBomRequirements(definition, definitions, items, parentQuantity, opts)
    .filter((line) => line.isLeaf && line.isStockTracked && line.requiredQuantity > 0);
  const aggregated = new Map<string, BomInventoryCheckLine>();
  const itemMap = toItemMap(items);
  for (const line of stockLeafLines) {
    const current = aggregated.get(line.itemId);
    if (current) {
      current.requiredQuantity = roundBomQuantity(current.requiredQuantity + line.requiredQuantity);
      continue;
    }
    const item = itemMap.get(line.itemId);
    const reservedQuantity = roundBomQuantity(Number(opts?.reservedByItemId?.[line.itemId] || 0));
    const availableQuantity = roundBomQuantity(Number(item?.quantity || 0));
    const netAvailableQuantity = roundBomQuantity(availableQuantity - reservedQuantity);
    aggregated.set(line.itemId, {
      itemId: line.itemId,
      item,
      requiredQuantity: line.requiredQuantity,
      availableQuantity,
      reservedQuantity,
      netAvailableQuantity,
      shortageQuantity: 0,
      level: line.level,
      path: line.path,
    });
  }
  const lines = Array.from(aggregated.values()).map((line) => ({
    ...line,
    shortageQuantity: roundBomQuantity(Math.max(0, line.requiredQuantity - line.netAvailableQuantity)),
  }));
  const totalRequiredQuantity = roundBomQuantity(lines.reduce((sum, line) => sum + line.requiredQuantity, 0));
  const totalShortageQuantity = roundBomQuantity(lines.reduce((sum, line) => sum + line.shortageQuantity, 0));
  const hasShortage = lines.some((line) => line.shortageQuantity > BOM_QTY_EPSILON);
  return {
    lines: lines.sort((a, b) => b.shortageQuantity - a.shortageQuantity || a.itemId.localeCompare(b.itemId, 'vi')),
    hasShortage,
    blocked: Boolean(opts?.blockOnShortage !== false && hasShortage),
    totalRequiredQuantity,
    totalShortageQuantity,
  };
}

function getImportTransactionsForItem(
  itemId: string,
  transactions: InventoryTransaction[],
  asOfDate?: string,
) {
  const cutoff = safeIsoDate(asOfDate);
  return (transactions || [])
    .filter((transaction) => {
      if (transaction.type !== 'IMPORT') return false;
      if (String(transaction.itemId || '').trim() !== itemId) return false;
      if (cutoff && safeIsoDate(transaction.date) > cutoff) return false;
      return true;
    })
    .sort((a, b) => compareDateDesc(a.date, b.date));
}

export function resolveBomItemUnitCost(
  item: InventoryItem | undefined,
  transactions: InventoryTransaction[],
  method: BomCostMethod,
  asOfDate?: string,
): { unitCost: number; source: BomCostLine['source'] } {
  const fallback = Number(item?.costPrice || 0);
  const itemId = String(item?.id || '').trim();
  if (!itemId) return { unitCost: fallback, source: 'FALLBACK' };
  if (method === 'STANDARD') return { unitCost: fallback, source: 'STANDARD' };
  const imports = getImportTransactionsForItem(itemId, transactions, asOfDate);
  if (imports.length === 0) {
    return { unitCost: fallback, source: 'FALLBACK' };
  }
  if (method === 'ACTUAL') {
    return { unitCost: Number(imports[0]?.price || fallback), source: 'ACTUAL' };
  }
  const totalQty = imports.reduce((sum, transaction) => sum + Number(transaction.quantity || 0), 0);
  if (totalQty <= BOM_QTY_EPSILON) {
    return { unitCost: fallback, source: 'FALLBACK' };
  }
  const totalCost = imports.reduce(
    (sum, transaction) => sum + Number(transaction.quantity || 0) * Number(transaction.price || 0),
    0,
  );
  return { unitCost: Number((totalCost / totalQty).toFixed(6)), source: 'AVERAGE' };
}

export function calculateBomCostSummary(
  definition: BomDefinition | undefined,
  definitions: BomDefinition[],
  items: InventoryItem[],
  transactions: InventoryTransaction[],
  quantity: number,
  method: BomCostMethod,
  asOfDate?: string,
): BomCostSummary {
  const lines = explodeBomRequirements(definition, definitions, items, quantity, { asOfDate })
    .filter((line) => line.isLeaf && line.requiredQuantity > 0)
    .map((line) => {
      const unitCostResolved = resolveBomItemUnitCost(line.item, transactions, method, asOfDate);
      const baseQuantity = roundBomQuantity(Number(line.component.quantity || 0) * Math.max(0, Number(quantity || 0)));
      const scrapQuantity = roundBomQuantity(Math.max(0, line.requiredQuantity - baseQuantity));
      const extendedCost = Number((line.requiredQuantity * unitCostResolved.unitCost).toFixed(6));
      const scrapCost = Number((scrapQuantity * unitCostResolved.unitCost).toFixed(6));
      return {
        key: line.key,
        itemId: line.itemId,
        item: line.item,
        path: line.path,
        level: line.level,
        category: line.component.account154Category,
        requiredQuantity: line.requiredQuantity,
        baseQuantity,
        scrapQuantity,
        unitCost: unitCostResolved.unitCost,
        extendedCost,
        scrapCost,
        method,
        source: unitCostResolved.source,
      } satisfies BomCostLine;
    });
  const totalCost = Number(lines.reduce((sum, line) => sum + line.extendedCost, 0).toFixed(6));
  const materialCost = Number(
    lines
      .filter((line) => line.category === 'DIRECT_MATERIAL')
      .reduce((sum, line) => sum + line.extendedCost, 0)
      .toFixed(6),
  );
  const laborCost = Number(
    lines
      .filter((line) => line.category === 'DIRECT_LABOR')
      .reduce((sum, line) => sum + line.extendedCost, 0)
      .toFixed(6),
  );
  const overheadCost = Number(
    lines
      .filter((line) => line.category === 'OVERHEAD')
      .reduce((sum, line) => sum + line.extendedCost, 0)
      .toFixed(6),
  );
  const scrapCost = Number(lines.reduce((sum, line) => sum + line.scrapCost, 0).toFixed(6));
  const safeQty = Math.max(0, Number(quantity || 0));
  return {
    method,
    asOfDate: safeIsoDate(asOfDate) || todayIsoDate(),
    quantity: safeQty,
    lines,
    unitCost: safeQty > BOM_QTY_EPSILON ? Number((totalCost / safeQty).toFixed(6)) : totalCost,
    totalCost,
    materialCost,
    laborCost,
    overheadCost,
    scrapCost,
  };
}

export function applyBomAlertOverrides(
  alerts: Array<Omit<BomComputedAlert, 'status'> | BomComputedAlert>,
  overrides?: BomAlertOverride[],
): BomComputedAlert[] {
  return (alerts || []).map((alert) => ({
    ...alert,
    status: 'status' in alert ? alert.status : resolveAlertStatusForKey(alert.key, overrides),
  }));
}

export function collectBomDefinitionAlerts(
  definition: BomDefinition | undefined,
  definitions: BomDefinition[],
  items: InventoryItem[],
  opts?: {
    asOfDate?: string;
    parentQuantity?: number;
    maxDepth?: number;
    reservedByItemId?: Record<string, number>;
  },
): BomComputedAlert[] {
  if (!definition) {
    return [
      {
        key: 'NO_ACTIVE_VERSION',
        code: 'NO_ACTIVE_VERSION',
        severity: 'CRITICAL',
        status: 'NEW',
        title: 'Không có BOM active',
        message: 'Sản phẩm hiện chưa có BOM approved/active theo ngày hiệu lực.',
      },
    ];
  }
  const alerts: Omit<BomComputedAlert, 'status'>[] = [];
  const itemMap = toItemMap(items);
  const asOfDate = safeIsoDate(opts?.asOfDate) || todayIsoDate();
  const versions = getBomVersionsForParent(definitions, definition.parentItemId);
  const approvedVersions = versions.filter((item) => normalizeBomVersionStatus(item.status) === 'APPROVED');
  const activeVersion = versions.find((item) => isBomVersionActive(item, asOfDate));

  if (!activeVersion) {
    alerts.push({
      key: `NO_ACTIVE_VERSION:${definition.parentItemId}:${asOfDate}`,
      code: 'NO_ACTIVE_VERSION',
      severity: 'CRITICAL',
      title: 'Không có BOM active',
      message: `Không có BOM approved nào đang hiệu lực cho ngày ${asOfDate}.`,
    });
  }
  if (approvedVersions.length === 0) {
    alerts.push({
      key: `MISSING_APPROVED_VERSION:${definition.parentItemId}`,
      code: 'MISSING_APPROVED_VERSION',
      severity: 'WARNING',
      title: 'Chưa có version approved',
      message: 'Sản phẩm này chưa có version BOM nào được approved để dùng cho sản xuất.',
    });
  }
  if (approvedVersions.length > 1) {
    alerts.push({
      key: `MULTI_APPROVED:${definition.parentItemId}`,
      code: 'MULTI_APPROVED',
      severity: 'CRITICAL',
      title: 'Nhiều version approved',
      message: 'Có nhiều hơn 1 version approved cho cùng một sản phẩm, cần khóa/obsolete bớt.',
    });
  }
  if (normalizeBomVersionStatus(definition.status) === 'OBSOLETE') {
    alerts.push({
      key: `OBSOLETE_VERSION:${definition.id}`,
      code: 'OBSOLETE_VERSION',
      severity: 'WARNING',
      title: 'Version đã obsolete',
      message: 'Version này đã obsolete, không nên dùng để sản xuất mới.',
    });
  }
  if (safeIsoDate(definition.expiryDate) && safeIsoDate(definition.effectiveDate) && safeIsoDate(definition.expiryDate) < safeIsoDate(definition.effectiveDate)) {
    alerts.push({
      key: `INVALID_DATE_RANGE:${definition.id}`,
      code: 'INVALID_DATE_RANGE',
      severity: 'CRITICAL',
      title: 'Sai khoảng ngày hiệu lực',
      message: 'Ngày hết hiệu lực đang nhỏ hơn ngày hiệu lực.',
    });
  }
  if (
    wouldCreateBomCycle(
      definition.parentItemId,
      {
        id: definition.id,
        parentItemId: definition.parentItemId,
        components: definition.components || [],
      },
      definitions.filter((item) => item.id !== definition.id),
      asOfDate,
    )
  ) {
    alerts.push({
      key: `CYCLE:${definition.id}`,
      code: 'CYCLE',
      severity: 'CRITICAL',
      title: 'BOM vòng',
      message: 'Cấu trúc BOM hiện tại tạo vòng lặp phụ thuộc và phải được sửa trước khi dùng.',
    });
  }
  for (const component of definition.components || []) {
    const componentId = String(component.componentItemId || '').trim();
    if (!componentId) {
      alerts.push({
        key: `MISSING_COMPONENT:${definition.id}:${component.id}`,
        code: 'MISSING_COMPONENT',
        severity: 'CRITICAL',
        title: 'Thiếu component',
        message: 'Có dòng BOM chưa chọn vật tư/thành phần.',
        componentItemId: componentId,
      });
      continue;
    }
    if (!itemMap.has(componentId)) {
      alerts.push({
        key: `MISSING_ITEM:${definition.id}:${componentId}`,
        code: 'MISSING_ITEM',
        severity: 'CRITICAL',
        title: 'Component không tồn tại',
        message: `Component ${componentId} không còn trong danh mục vật tư/hàng hóa.`,
        componentItemId: componentId,
      });
    }
  }
  const tree = buildBomTree(definition, definitions, items, Math.max(1, Number(opts?.parentQuantity || 1)), {
    asOfDate,
    maxDepth: opts?.maxDepth,
  });
  if (tree?.maxDepthReached) {
    alerts.push({
      key: `MAX_DEPTH:${definition.id}`,
      code: 'MAX_DEPTH',
      severity: 'WARNING',
      title: 'Vượt ngưỡng cấp BOM',
      message: `Cấu trúc BOM sâu hơn ngưỡng ${Math.min(Math.max(1, Number(opts?.maxDepth || DEFAULT_BOM_MAX_DEPTH)), BOM_CYCLE_MAX_DEPTH)} cấp đang xem.`,
    });
  }
  const inventoryCheck = getBomInventoryCheck(
    definition,
    definitions,
    items,
    Math.max(1, Number(opts?.parentQuantity || 1)),
    {
      asOfDate,
      maxDepth: opts?.maxDepth,
      reservedByItemId: opts?.reservedByItemId,
      blockOnShortage: true,
    },
  );
  for (const line of inventoryCheck.lines.filter((entry) => entry.shortageQuantity > BOM_QTY_EPSILON)) {
    alerts.push({
      key: `SHORTAGE:${definition.id}:${line.itemId}`,
      code: 'SHORTAGE',
      severity: 'CRITICAL',
      title: 'Thiếu vật tư sản xuất',
      message: `${line.item?.sku || line.item?.name || line.itemId}: thiếu ${line.shortageQuantity} so với nhu cầu.`,
      componentItemId: line.itemId,
      path: line.path,
    });
  }
  return applyBomAlertOverrides(alerts, definition.alertOverrides);
}

export function runBomMrp(
  plans: BomMrpPlanLine[],
  definitions: BomDefinition[],
  items: InventoryItem[],
  opts?: {
    asOfDate?: string;
    reservedByItemId?: Record<string, number>;
    maxDepth?: number;
    warehouses?: Warehouse[];
  },
): BomMrpResult {
  const itemMap = toItemMap(items);
  const requiredMap = new Map<string, { itemId: string; warehouseId?: string; requiredQuantity: number }>();
  const alerts: BomComputedAlert[] = [];
  const warehouses = opts?.warehouses || [];
  const warehouseMap = new Map((warehouses || []).map((warehouse) => [warehouse.id, warehouse]));
  for (const plan of plans || []) {
    const quantity = Math.max(0, Number(plan.quantity || 0));
    const parentItemId = String(plan.parentItemId || '').trim();
    const warehouseId = String(plan.warehouseId || '').trim() || undefined;
    if (!parentItemId || quantity <= 0) continue;
    const definition = getBomDefinitionForParent(definitions, parentItemId, plan.planDate || opts?.asOfDate);
    if (!definition) {
      alerts.push({
        key: `MRP:NO_ACTIVE:${plan.id}`,
        code: 'NO_ACTIVE_VERSION',
        severity: 'CRITICAL',
        status: 'NEW',
        title: 'Thiếu BOM active cho kế hoạch',
        message: `Kế hoạch sản xuất ${itemMap.get(parentItemId)?.name || parentItemId} chưa có BOM active tại ngày ${safeIsoDate(plan.planDate) || todayIsoDate()}.`,
      });
      continue;
    }
    const leafLines = explodeBomRequirements(definition, definitions, items, quantity, {
      asOfDate: plan.planDate || opts?.asOfDate,
      maxDepth: opts?.maxDepth,
    }).filter((line) => line.isLeaf && line.isStockTracked && line.requiredQuantity > 0);
    for (const line of leafLines) {
      const key = `${warehouseId || 'ALL'}::${line.itemId}`;
      const current = requiredMap.get(key);
      requiredMap.set(key, {
        itemId: line.itemId,
        warehouseId,
        requiredQuantity: roundBomQuantity((current?.requiredQuantity || 0) + line.requiredQuantity),
      });
    }
  }
  const lines = Array.from(requiredMap.values())
    .map(({ itemId, warehouseId, requiredQuantity }) => {
      const item = itemMap.get(itemId);
      const availableQuantity = roundBomQuantity(
        warehouseId ? getWarehouseQuantity(item || ({} as InventoryItem), warehouseId) : Number(item?.quantity || 0),
      );
      const reservedQuantity = roundBomQuantity(
        Number(
          opts?.reservedByItemId?.[warehouseId ? `${warehouseId}::${itemId}` : itemId] ??
            opts?.reservedByItemId?.[itemId] ??
            0,
        ),
      );
      const netRequirement = roundBomQuantity(Math.max(0, requiredQuantity - availableQuantity + reservedQuantity));
      const totalAvailableAcrossWarehouses = roundBomQuantity(Number(item?.quantity || 0));
      const recommendation = netRequirement > BOM_QTY_EPSILON
        ? warehouseId
          ? totalAvailableAcrossWarehouses > availableQuantity + BOM_QTY_EPSILON
            ? 'TRANSFER'
            : 'PURCHASE'
          : (warehouses.length > 1 ? 'PURCHASE_OR_TRANSFER' : 'PURCHASE')
        : 'NONE';
      return {
        itemId,
        item,
        warehouseId,
        warehouseName: warehouseId ? warehouseMap.get(warehouseId)?.name : undefined,
        requiredQuantity,
        availableQuantity,
        reservedQuantity,
        netRequirement,
        recommendation,
      } satisfies BomMrpResultLine;
    })
    .sort((a, b) => b.netRequirement - a.netRequirement || a.itemId.localeCompare(b.itemId, 'vi'));
  return {
    lines,
    alerts,
    planCount: (plans || []).filter((plan) => Math.max(0, Number(plan.quantity || 0)) > 0 && String(plan.parentItemId || '').trim()).length,
    totalRequiredQuantity: roundBomQuantity(lines.reduce((sum, line) => sum + line.requiredQuantity, 0)),
    totalNetRequirement: roundBomQuantity(lines.reduce((sum, line) => sum + line.netRequirement, 0)),
  };
}

/**
 * Kiểm tra nếu lưu BOM cho `parentItemId` với các thành phần trong `draftDefinition`
 * sẽ tạo **chu kỳ** trong đồ thị phụ thuộc BOM (A → … → A).
 */
export function wouldCreateBomCycle(
  parentItemId: string,
  draftDefinition: Pick<BomDefinition, 'parentItemId' | 'components' | 'id'>,
  definitions: BomDefinition[],
  targetDate?: string,
): boolean {
  const pid = String(parentItemId || '').trim();
  if (!pid) return false;
  const virtual = (definitions || []).filter((definition) => String(definition.parentItemId || '').trim() !== pid);
  virtual.push({
    id: String(draftDefinition.id || 'draft').trim() || 'draft',
    parentItemId: pid,
    note: '',
    versionNumber: 999999,
    versionCode: 'DRAFT',
    status: 'DRAFT',
    effectiveDate: safeIsoDate(targetDate) || todayIsoDate(),
    components: draftDefinition.components || [],
    updatedAt: new Date().toISOString(),
  });

  const hasPathFromTo = (
    fromItemId: string,
    targetId: string,
    depth: number,
    stack: Set<string>,
  ): boolean => {
    const from = String(fromItemId || '').trim();
    const target = String(targetId || '').trim();
    if (!from || !target) return false;
    if (from === target) return true;
    if (depth > BOM_CYCLE_MAX_DEPTH) return true;
    if (stack.has(from)) return false;
    stack.add(from);
    const bom = getGraphDefinitionForParent(virtual, from, targetDate);
    if (!bom) {
      stack.delete(from);
      return false;
    }
    for (const component of bom.components || []) {
      const componentId = String(component.componentItemId || '').trim();
      if (!componentId) continue;
      if (hasPathFromTo(componentId, target, depth + 1, stack)) {
        stack.delete(from);
        return true;
      }
    }
    stack.delete(from);
    return false;
  };

  for (const component of draftDefinition.components || []) {
    const componentId = String(component.componentItemId || '').trim();
    if (!componentId || componentId === pid) continue;
    if (hasPathFromTo(componentId, pid, 0, new Set())) return true;
  }
  return false;
}
