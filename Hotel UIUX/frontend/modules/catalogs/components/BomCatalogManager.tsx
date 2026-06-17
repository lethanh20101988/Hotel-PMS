import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Edit,
  Factory,
  GitBranch,
  Layers,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  X,
  Info,
  StickyNote,
  Calendar,
  Hash,
  Layers,
  ChevronsDown,
  ChevronsUp,
} from 'lucide-react';
import type {
  BomAlertStatus,
  BomComponentLine,
  BomCostMethod,
  BomDefinition,
  BomMrpPlanLine,
  BomVersionStatus,
  InventoryItem,
  ProductionOrder,
  ProductionOrderMaterialLine,
} from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import {
  BOM_154_CATEGORY_OPTIONS,
  DEFAULT_BOM_MAX_DEPTH,
  buildBomTree,
  calculateBomCostSummary,
  collectBomDefinitionAlerts,
  getBom154CategoryLabel,
  getBomAlertSeverityLabel,
  getBomAlertStatusLabel,
  getBomCostMethodLabel,
  getBomDefinitionForParent,
  getBomInventoryCheck,
  getBomVersionCode,
  getBomVersionNumber,
  getBomVersionStatusLabel,
  getBomVersionsForParent,
  isBomVersionActive,
  isStockTrackedBomComponent,
  normalizeBomCostMethod,
  runBomMrp,
  wouldCreateBomCycle,
} from '@shared/utils/bom';
import { getDefaultWarehouseId, getWarehouseQuantity } from '@shared/utils/warehouseInventory';
import { useApp } from '../../../app/store';

type BomWorkspaceTab = 'TREE' | 'COST' | 'INVENTORY' | 'ALERTS' | 'MRP' | 'ORDERS';

const makeLocalId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `bom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const todayIsoDate = () => new Date().toISOString().split('T')[0];

const formatQty = (value: number) =>
  Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 6 });

const createEmptyComponent = (): BomComponentLine => ({
  id: makeLocalId(),
  componentItemId: '',
  quantity: 1,
  lossRate: 0,
  lossQuantity: 0,
  account154Category: 'DIRECT_MATERIAL',
  note: '',
});

const createMrpPlanLine = (parentItemId = ''): BomMrpPlanLine => ({
  id: makeLocalId(),
  parentItemId,
  quantity: 1,
  planDate: todayIsoDate(),
  warehouseId: '',
  note: '',
});

const buildAuditEntry = (
  action: 'CREATED' | 'UPDATED' | 'CLONED' | 'APPROVED' | 'OBSOLETED' | 'ALERT_STATUS_CHANGED',
  note?: string,
) => ({
  id: makeLocalId(),
  action,
  actor: 'Admin',
  timestamp: new Date().toISOString(),
  note: note || undefined,
});

const chipClassByStatus = (status?: BomVersionStatus) => {
  switch (status) {
    case 'APPROVED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'OBSOLETE':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-amber-50 text-amber-700 border-amber-200';
  }
};

const chipClassByAlertStatus = (status?: BomAlertStatus) => {
  switch (status) {
    case 'SEEN':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'RESOLVED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    default:
      return 'bg-amber-50 text-amber-700 border-amber-200';
  }
};

const severityBadgeClass = (severity: 'INFO' | 'WARNING' | 'CRITICAL') => {
  switch (severity) {
    case 'CRITICAL':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'WARNING':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    default:
      return 'bg-blue-50 text-blue-700 border-blue-200';
  }
};

const productionStatusClass = (status: ProductionOrder['status']) => {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'RELEASED':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'CANCELLED':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-amber-50 text-amber-700 border-amber-200';
  }
};

export const BomCatalogManager: React.FC = () => {
  const {
    inventoryCatalog,
    warehouseInventoryItems,
    transactions,
    warehouses,
    bomDefinitions,
    productionOrders,
    handleUpsertBomDefinition,
    handleDeleteBomDefinition,
    handleUpsertProductionOrder,
    handleDeleteProductionOrder,
    handleReleaseProductionOrder,
    handleCompleteProductionOrder,
    previewDocumentNumber,
  } = useApp();

  const [draft, setDraft] = useState<BomDefinition | null>(null);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<BomWorkspaceTab>('TREE');
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  const [expandedTreeKeys, setExpandedTreeKeys] = useState<Record<string, boolean>>({});
  const [lotQuantity, setLotQuantity] = useState('1');
  const [asOfDate, setAsOfDate] = useState(todayIsoDate());
  const [maxDepth, setMaxDepth] = useState(String(DEFAULT_BOM_MAX_DEPTH));
  const [costMethod, setCostMethod] = useState<BomCostMethod>('STANDARD');
  const [reservedByItemId, setReservedByItemId] = useState<Record<string, string>>({});
  const [mrpPlans, setMrpPlans] = useState<BomMrpPlanLine[]>([createMrpPlanLine()]);
  const [mrpReservedByItemId, setMrpReservedByItemId] = useState<Record<string, string>>({});
  const [productionDraft, setProductionDraft] = useState<ProductionOrder | null>(null);
  const [mainBomActionsOpen, setMainBomActionsOpen] = useState(false);
  const [versionActionMenuId, setVersionActionMenuId] = useState<string | null>(null);
  const [bomLineNoteEditId, setBomLineNoteEditId] = useState<string | null>(null);
  const [bomItemPickerLineId, setBomItemPickerLineId] = useState<string | null>(null);
  const [bomItemPickerQuery, setBomItemPickerQuery] = useState('');
  const bomItemPickerRef = useRef<HTMLDivElement>(null);
  const mainActionMenuRef = useRef<HTMLDivElement>(null);
  const versionActionMenuRef = useRef<HTMLDivElement>(null);

  const maxDepthNumber = Math.min(10, Math.max(1, Number(maxDepth || DEFAULT_BOM_MAX_DEPTH)));
  const lotQuantityNumber = Math.max(1, Number(lotQuantity || 1));
  const defaultWarehouseId = useMemo(() => getDefaultWarehouseId(warehouses), [warehouses]);

  const allItems = useMemo(() => {
    const merged = new Map<string, InventoryItem>();
    for (const item of inventoryCatalog || []) {
      merged.set(String(item.id || '').trim(), { ...item });
    }
    for (const item of warehouseInventoryItems || []) {
      const key = String(item.id || '').trim();
      const current = merged.get(key);
      merged.set(key, { ...(current || {}), ...item } as InventoryItem);
    }
    return Array.from(merged.values()).sort((a, b) =>
      `${a.sku || ''} ${a.name || ''}`.localeCompare(`${b.sku || ''} ${b.name || ''}`, 'vi'),
    );
  }, [inventoryCatalog, warehouseInventoryItems]);

  const itemMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of allItems) {
      map.set(String(item.id || '').trim(), item);
    }
    return map;
  }, [allItems]);

  const bomDraftTotals = useMemo(() => {
    const list = draft?.components || [];
    let sumQty = 0;
    let sumLossQty = 0;
    let filled = 0;
    for (const c of list) {
      sumQty += Number(c.quantity || 0);
      sumLossQty += Number(c.lossQuantity || 0);
      if (String(c.componentItemId || '').trim()) filled += 1;
    }
    return { sumQty, sumLossQty, filled, lineCount: list.length };
  }, [draft?.components]);

  const groupedDefinitions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const groups = new Map<string, { parent: InventoryItem | undefined; versions: BomDefinition[] }>();
    for (const definition of bomDefinitions || []) {
      const parentId = String(definition.parentItemId || '').trim();
      const parentItem = itemMap.get(parentId);
      const haystack = [
        parentItem?.sku || '',
        parentItem?.name || '',
        definition.note || '',
        definition.changeSummary || '',
        getBomVersionCode(definition),
      ]
        .join(' ')
        .toLowerCase();
      if (query && !haystack.includes(query)) continue;
      const entry = groups.get(parentId) || { parent: parentItem, versions: [] };
      entry.versions.push(definition);
      groups.set(parentId, entry);
    }
    return Array.from(groups.entries())
      .map(([parentItemId, entry]) => ({
        parentItemId,
        parentItem: entry.parent,
        versions: getBomVersionsForParent(entry.versions, parentItemId),
      }))
      .sort((a, b) => {
        const keyA = `${a.parentItem?.sku || ''} ${a.parentItem?.name || ''}`;
        const keyB = `${b.parentItem?.sku || ''} ${b.parentItem?.name || ''}`;
        return keyA.localeCompare(keyB, 'vi');
      });
  }, [bomDefinitions, itemMap, searchTerm]);

  const flatDefinitions = useMemo(
    () => groupedDefinitions.flatMap((group) => group.versions),
    [groupedDefinitions],
  );

  useEffect(() => {
    if (flatDefinitions.length === 0) {
      setSelectedDefinitionId('');
      return;
    }
    const stillExists = flatDefinitions.some((definition) => definition.id === selectedDefinitionId);
    if (!stillExists) {
      setSelectedDefinitionId(flatDefinitions[0].id);
    }
  }, [flatDefinitions, selectedDefinitionId]);

  const selectedDefinition = useMemo(
    () => flatDefinitions.find((definition) => definition.id === selectedDefinitionId) || flatDefinitions[0] || null,
    [flatDefinitions, selectedDefinitionId],
  );

  const selectedParentItem = useMemo(
    () => (selectedDefinition ? itemMap.get(selectedDefinition.parentItemId) : undefined),
    [selectedDefinition, itemMap],
  );
  const selectedParentSku = String(selectedParentItem?.sku || '').trim();

  useEffect(() => {
    if (!mainBomActionsOpen && !versionActionMenuId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (mainActionMenuRef.current?.contains(t)) return;
      if (versionActionMenuRef.current?.contains(t)) return;
      setMainBomActionsOpen(false);
      setVersionActionMenuId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [mainBomActionsOpen, versionActionMenuId]);

  useEffect(() => {
    if (!bomItemPickerLineId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (bomItemPickerRef.current?.contains(t)) return;
      setBomItemPickerLineId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [bomItemPickerLineId]);

  useEffect(() => {
    if (!selectedDefinition?.parentItemId) return;
    setExpandedParents((prev) => ({ ...prev, [selectedDefinition.parentItemId]: true }));
    setCostMethod(normalizeBomCostMethod(selectedDefinition.defaultCostMethod));
  }, [selectedDefinition?.id, selectedDefinition?.parentItemId, selectedDefinition?.defaultCostMethod]);

  useEffect(() => {
    if (selectedDefinition && mrpPlans.length === 1 && !mrpPlans[0].parentItemId) {
      setMrpPlans([createMrpPlanLine(selectedDefinition.parentItemId)]);
    }
  }, [selectedDefinition, mrpPlans]);

  const tree = useMemo(
    () =>
      buildBomTree(selectedDefinition || undefined, bomDefinitions, allItems, lotQuantityNumber, {
        asOfDate,
        maxDepth: maxDepthNumber,
      }),
    [selectedDefinition, bomDefinitions, allItems, lotQuantityNumber, asOfDate, maxDepthNumber],
  );

  const costSummaryStandard = useMemo(
    () =>
      calculateBomCostSummary(
        selectedDefinition || undefined,
        bomDefinitions,
        allItems,
        transactions,
        lotQuantityNumber,
        'STANDARD',
        asOfDate,
      ),
    [selectedDefinition, bomDefinitions, allItems, transactions, lotQuantityNumber, asOfDate],
  );

  const costSummaryActual = useMemo(
    () =>
      calculateBomCostSummary(
        selectedDefinition || undefined,
        bomDefinitions,
        allItems,
        transactions,
        lotQuantityNumber,
        'ACTUAL',
        asOfDate,
      ),
    [selectedDefinition, bomDefinitions, allItems, transactions, lotQuantityNumber, asOfDate],
  );

  const costSummaryAverage = useMemo(
    () =>
      calculateBomCostSummary(
        selectedDefinition || undefined,
        bomDefinitions,
        allItems,
        transactions,
        lotQuantityNumber,
        'AVERAGE',
        asOfDate,
      ),
    [selectedDefinition, bomDefinitions, allItems, transactions, lotQuantityNumber, asOfDate],
  );

  const activeCostSummary = {
    STANDARD: costSummaryStandard,
    ACTUAL: costSummaryActual,
    AVERAGE: costSummaryAverage,
  }[costMethod];

  const reservedQuantityMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(reservedByItemId).map(([itemId, value]) => [itemId, Math.max(0, Number(value || 0))]),
      ),
    [reservedByItemId],
  );

  const inventoryCheck = useMemo(
    () =>
      getBomInventoryCheck(selectedDefinition || undefined, bomDefinitions, allItems, lotQuantityNumber, {
        asOfDate,
        maxDepth: maxDepthNumber,
        reservedByItemId: reservedQuantityMap,
        blockOnShortage: true,
      }),
    [selectedDefinition, bomDefinitions, allItems, lotQuantityNumber, asOfDate, maxDepthNumber, reservedQuantityMap],
  );

  const computedAlerts = useMemo(
    () =>
      collectBomDefinitionAlerts(selectedDefinition || undefined, bomDefinitions, allItems, {
        asOfDate,
        parentQuantity: lotQuantityNumber,
        maxDepth: maxDepthNumber,
        reservedByItemId: reservedQuantityMap,
      }),
    [selectedDefinition, bomDefinitions, allItems, asOfDate, lotQuantityNumber, maxDepthNumber, reservedQuantityMap],
  );

  const mrpReservedMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(mrpReservedByItemId).map(([itemId, value]) => [itemId, Math.max(0, Number(value || 0))]),
      ),
    [mrpReservedByItemId],
  );

  const mrpResult = useMemo(
    () =>
      runBomMrp(mrpPlans, bomDefinitions, allItems, {
        asOfDate,
        reservedByItemId: mrpReservedMap,
        maxDepth: maxDepthNumber,
        warehouses,
      }),
    [mrpPlans, bomDefinitions, allItems, asOfDate, mrpReservedMap, maxDepthNumber, warehouses],
  );

  const summaryCards = useMemo(() => {
    const activeCount = groupedDefinitions.filter((group) =>
      Boolean(getBomDefinitionForParent(bomDefinitions, group.parentItemId, asOfDate)),
    ).length;
    const criticalCount = computedAlerts.filter((alert) => alert.severity === 'CRITICAL' && alert.status !== 'RESOLVED').length;
    const totalVersions = bomDefinitions.length;
    return { activeCount, criticalCount, totalVersions };
  }, [groupedDefinitions, bomDefinitions, asOfDate, computedAlerts]);
  const firstCriticalAlertMessage = useMemo(
    () => computedAlerts.find((a) => a.severity === 'CRITICAL' && a.status !== 'RESOLVED')?.message || '',
    [computedAlerts],
  );
  const productionOrderRows = useMemo(
    () =>
      [...(productionOrders || [])].sort(
        (a, b) =>
          new Date(b.startDate || b.createdAt).getTime() - new Date(a.startDate || a.createdAt).getTime(),
      ),
    [productionOrders],
  );

  const buildProductionOrderDraft = (plan: {
    parentItemId: string;
    quantity: number;
    planDate: string;
    warehouseId?: string;
    note?: string;
  }): ProductionOrder | null => {
    const parentItemId = String(plan.parentItemId || '').trim();
    const quantity = Math.max(0, Number(plan.quantity || 0));
    if (!parentItemId || quantity <= 0) {
      window.alert('Kế hoạch sản xuất phải có sản phẩm cha và số lượng lớn hơn 0.');
      return null;
    }
    const definition = getBomDefinitionForParent(bomDefinitions, parentItemId, plan.planDate || asOfDate);
    if (!definition) {
      window.alert('Không tìm thấy BOM active cho kế hoạch đang chọn.');
      return null;
    }
    const parentItem = itemMap.get(parentItemId);
    const sourceWarehouseId = String(plan.warehouseId || defaultWarehouseId).trim() || defaultWarehouseId;
    const targetWarehouseId = sourceWarehouseId;
    const materialLines = buildBomPlannedStockLines(definition, allItems, quantity).map((line) => {
      const availableQuantity = getWarehouseQuantity(line.item, sourceWarehouseId, defaultWarehouseId);
      return {
        id: makeLocalId(),
        itemId: line.item.id,
        itemName: line.item.name,
        itemSku: line.item.sku,
        unit: line.item.unit,
        requiredQuantity: line.requiredQuantity,
        actualQuantity: line.requiredQuantity,
        sourceWarehouseId,
        sourceWarehouseName: warehouses.find((warehouse) => warehouse.id === sourceWarehouseId)?.name,
        bomComponentCategory: line.component.account154Category,
        bomLossRate: line.component.lossRate,
        bomPlannedQuantity: line.requiredQuantity,
        note: line.component.note,
        availableQuantity,
      } as ProductionOrderMaterialLine & { availableQuantity?: number };
    });
    const totalPlannedCost = Number(
      materialLines
        .reduce((sum, line) => sum + Number(line.actualQuantity || 0) * Number(itemMap.get(line.itemId)?.costPrice || 0), 0)
        .toFixed(6),
    );
    const unitPlannedCost = quantity > 0 ? Number((totalPlannedCost / quantity).toFixed(6)) : 0;
    const shortageCount = materialLines.filter(
      (line) => getWarehouseQuantity(itemMap.get(line.itemId), sourceWarehouseId, defaultWarehouseId) + 1e-6 < line.requiredQuantity,
    ).length;
    return {
      id: '',
      orderNumber: '',
      parentItemId,
      parentItemName: parentItem?.name || parentItemId,
      parentItemSku: parentItem?.sku,
      bomDefinitionId: definition.id,
      bomVersionCode: getBomVersionCode(definition),
      quantity,
      startDate: plan.planDate || todayIsoDate(),
      dueDate: plan.planDate || todayIsoDate(),
      sourceWarehouseId,
      sourceWarehouseName: warehouses.find((warehouse) => warehouse.id === sourceWarehouseId)?.name,
      targetWarehouseId,
      targetWarehouseName: warehouses.find((warehouse) => warehouse.id === targetWarehouseId)?.name,
      status: 'DRAFT',
      note: String(plan.note || '').trim() || undefined,
      materials: materialLines.map(({ availableQuantity: _availableQuantity, ...line }) => line),
      output: {
        itemId: parentItemId,
        itemName: parentItem?.name || parentItemId,
        itemSku: parentItem?.sku,
        unit: parentItem?.unit,
        quantity,
        targetWarehouseId,
        targetWarehouseName: warehouses.find((warehouse) => warehouse.id === targetWarehouseId)?.name,
        unitCost: unitPlannedCost,
        totalCost: totalPlannedCost,
      },
      shortageCount,
      totalPlannedCost,
      unitPlannedCost,
      createdAt: new Date().toISOString(),
      createdBy: 'Admin',
      updatedAt: new Date().toISOString(),
    };
  };

  const openProductionOrderFromPlan = (plan: BomMrpPlanLine) => {
    const draftOrder = buildProductionOrderDraft({
      parentItemId: plan.parentItemId,
      quantity: plan.quantity,
      planDate: plan.planDate,
      warehouseId: plan.warehouseId,
      note: plan.note,
    });
    if (!draftOrder) return;
    setProductionDraft(draftOrder);
    setActiveTab('ORDERS');
  };

  const openProductionOrderFromSelectedBom = () => {
    if (!selectedDefinition) return;
    const draftOrder = buildProductionOrderDraft({
      parentItemId: selectedDefinition.parentItemId,
      quantity: lotQuantityNumber,
      planDate: asOfDate,
      warehouseId: defaultWarehouseId,
      note: selectedDefinition.changeSummary || selectedDefinition.note,
    });
    if (!draftOrder) return;
    setProductionDraft(draftOrder);
    setActiveTab('ORDERS');
  };

  const rebuildProductionOrderDraft = (order: ProductionOrder, options?: { resetActual?: boolean }) => {
    const quantity = Math.max(0, Number(order.quantity || 0));
    const sourceWarehouseId = String(order.sourceWarehouseId || defaultWarehouseId).trim() || defaultWarehouseId;
    const targetWarehouseId = String(order.targetWarehouseId || sourceWarehouseId || defaultWarehouseId).trim() || sourceWarehouseId;
    const definition =
      bomDefinitions.find((entry) => entry.id === order.bomDefinitionId) ||
      getBomDefinitionForParent(bomDefinitions, order.parentItemId, order.startDate || asOfDate);
    const parentItem = itemMap.get(order.parentItemId);
    const sourceWarehouseName = warehouses.find((warehouse) => warehouse.id === sourceWarehouseId)?.name;
    const targetWarehouseName = warehouses.find((warehouse) => warehouse.id === targetWarehouseId)?.name;
    if (!definition) {
      return {
        ...order,
        quantity,
        sourceWarehouseId,
        sourceWarehouseName,
        targetWarehouseId,
        targetWarehouseName,
      };
    }

    const previousByItemId = new Map((order.materials || []).map((line) => [line.itemId, line]));
    const materialLines = buildBomPlannedStockLines(definition, allItems, quantity).map((line) => {
      const previous = previousByItemId.get(line.item.id);
      const requiredQuantity = Number(line.requiredQuantity || 0);
      return {
        id: previous?.id || makeLocalId(),
        itemId: line.item.id,
        itemName: line.item.name,
        itemSku: line.item.sku,
        unit: line.item.unit,
        requiredQuantity,
        actualQuantity: options?.resetActual ? requiredQuantity : Number(previous?.actualQuantity ?? requiredQuantity),
        sourceWarehouseId,
        sourceWarehouseName,
        bomComponentCategory: line.component.account154Category,
        bomLossRate: line.component.lossRate,
        bomPlannedQuantity: requiredQuantity,
        note: previous?.note ?? line.component.note,
      };
    });

    const totalPlannedCost = Number(
      materialLines
        .reduce((sum, line) => sum + Number(line.actualQuantity || 0) * Number(itemMap.get(line.itemId)?.costPrice || 0), 0)
        .toFixed(6),
    );
    const unitPlannedCost = quantity > 0 ? Number((totalPlannedCost / quantity).toFixed(6)) : 0;
    const shortageCount = materialLines.filter((line) => {
      const available = getWarehouseQuantity(itemMap.get(line.itemId), sourceWarehouseId, defaultWarehouseId);
      const required = Math.max(Number(line.actualQuantity || 0), Number(line.requiredQuantity || 0));
      return available + 1e-6 < required;
    }).length;

    return {
      ...order,
      quantity,
      sourceWarehouseId,
      sourceWarehouseName,
      targetWarehouseId,
      targetWarehouseName,
      materials: materialLines,
      output: {
        ...order.output,
        itemId: order.output?.itemId || order.parentItemId,
        itemName: parentItem?.name || order.parentItemName || order.parentItemId,
        itemSku: parentItem?.sku || order.parentItemSku,
        unit: parentItem?.unit || order.output?.unit,
        quantity,
        targetWarehouseId,
        targetWarehouseName,
        unitCost: unitPlannedCost,
        totalCost: totalPlannedCost,
      },
      shortageCount,
      totalPlannedCost,
      unitPlannedCost,
      updatedAt: new Date().toISOString(),
    };
  };

  const updateProductionDraft = (patch: Partial<ProductionOrder>) => {
    setProductionDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      const shouldRebuild =
        patch.quantity !== undefined ||
        patch.sourceWarehouseId !== undefined ||
        patch.targetWarehouseId !== undefined ||
        patch.startDate !== undefined ||
        patch.bomDefinitionId !== undefined;
      return shouldRebuild
        ? rebuildProductionOrderDraft(next, { resetActual: patch.quantity !== undefined || patch.bomDefinitionId !== undefined })
        : next;
    });
  };

  const updateProductionDraftMaterial = (lineId: string, patch: Partial<ProductionOrderMaterialLine>) => {
    setProductionDraft((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        materials: (prev.materials || []).map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
      };
      return rebuildProductionOrderDraft(next);
    });
  };

  const saveProductionDraft = () => {
    if (!productionDraft) return;
    const ok = handleUpsertProductionOrder(productionDraft);
    if (ok) setProductionDraft(null);
  };

  const nextVersionNumberForParent = (parentItemId: string, ignoreId?: string) => {
    const versions = getBomVersionsForParent(bomDefinitions, parentItemId)
      .filter((definition) => definition.id !== ignoreId)
      .map((definition) => getBomVersionNumber(definition));
    return (versions.length > 0 ? Math.max(...versions) : 0) + 1;
  };

  const makeDraft = (
    definition?: BomDefinition,
    mode: 'create' | 'edit' | 'clone' = 'create',
  ): BomDefinition => {
    const parentItemId = String(definition?.parentItemId || '').trim();
    const nextVersionNumber =
      mode === 'clone'
        ? nextVersionNumberForParent(parentItemId)
        : definition?.versionNumber || (parentItemId ? nextVersionNumberForParent(parentItemId) : 1);
    const baseComponents =
      definition?.components?.length && Array.isArray(definition.components)
        ? definition.components.map((component) => ({
            ...component,
            id: mode === 'edit' ? component.id : makeLocalId(),
          }))
        : [createEmptyComponent()];
    return {
      id: mode === 'edit' ? definition?.id || '' : '',
      parentItemId,
      versionNumber: nextVersionNumber,
      versionCode: `V${nextVersionNumber}`,
      status: mode === 'edit' ? definition?.status || 'DRAFT' : 'DRAFT',
      effectiveDate:
        mode === 'edit'
          ? definition?.effectiveDate || todayIsoDate()
          : todayIsoDate(),
      expiryDate: mode === 'edit' ? definition?.expiryDate || '' : '',
      approvedAt: mode === 'edit' ? definition?.approvedAt : undefined,
      approvedBy: mode === 'edit' ? definition?.approvedBy : undefined,
      obsoleteAt: mode === 'edit' ? definition?.obsoleteAt : undefined,
      clonedFromId: mode === 'clone' ? definition?.id : definition?.clonedFromId,
      changeSummary:
        mode === 'clone'
          ? `Clone từ ${getBomVersionCode(definition)}`
          : definition?.changeSummary || '',
      defaultCostMethod: normalizeBomCostMethod(definition?.defaultCostMethod),
      note: definition?.note || '',
      components: baseComponents,
      auditTrail: mode === 'edit' ? definition?.auditTrail || [] : definition?.auditTrail ? [...definition.auditTrail] : [],
      alertOverrides: mode === 'edit' ? definition?.alertOverrides || [] : [],
      updatedAt: definition?.updatedAt || new Date().toISOString(),
    };
  };

  const openCreate = (parentItemId = selectedDefinition?.parentItemId || '') => {
    const versionNumber = parentItemId ? nextVersionNumberForParent(parentItemId) : 1;
    setDraft({
      id: '',
      parentItemId,
      versionNumber,
      versionCode: `V${versionNumber}`,
      status: 'DRAFT',
      effectiveDate: todayIsoDate(),
      expiryDate: '',
      approvedAt: undefined,
      approvedBy: undefined,
      obsoleteAt: undefined,
      clonedFromId: undefined,
      changeSummary: '',
      defaultCostMethod: 'STANDARD',
      note: '',
      components: [createEmptyComponent()],
      auditTrail: [],
      alertOverrides: [],
      updatedAt: new Date().toISOString(),
    });
  };

  const openEdit = (definition: BomDefinition) => {
    if (definition.status === 'APPROVED') {
      openClone(definition);
      return;
    }
    setDraft(makeDraft(definition, 'edit'));
  };

  const openClone = (definition: BomDefinition) => {
    setDraft(makeDraft(definition, 'clone'));
  };

  const closeModal = () => {
    setBomLineNoteEditId(null);
    setBomItemPickerLineId(null);
    setBomItemPickerQuery('');
    setDraft(null);
  };

  const updateDraft = (patch: Partial<BomDefinition>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateComponent = (componentId: string, patch: Partial<BomComponentLine>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        components: (prev.components || []).map((component) =>
          component.id === componentId ? { ...component, ...patch } : component,
        ),
      };
    });
  };

  const addComponent = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        components: [...(prev.components || []), createEmptyComponent()],
      };
    });
  };

  const removeComponent = (componentId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = (prev.components || []).filter((component) => component.id !== componentId);
      return {
        ...prev,
        components: next.length > 0 ? next : [createEmptyComponent()],
      };
    });
  };

  const sanitizeDraft = (base: BomDefinition) => {
    const parentItemId = String(base.parentItemId || '').trim();
    const versionNumber = Math.max(1, Math.floor(Number(base.versionNumber || 1)));
    const components = (base.components || [])
      .map((component) => ({
        ...component,
        id: String(component.id || '').trim() || makeLocalId(),
        componentItemId: String(component.componentItemId || '').trim(),
        quantity: Math.max(0, Number(component.quantity || 0)),
        lossRate: Math.max(0, Number(component.lossRate || 0)),
        lossQuantity: Math.max(0, Number(component.lossQuantity || 0)),
        note: String(component.note || '').trim(),
      }))
      .filter((component) => component.componentItemId && component.quantity > 0);
    return {
      ...base,
      parentItemId,
      versionNumber,
      versionCode: `V${versionNumber}`,
      effectiveDate: String(base.effectiveDate || '').trim() || todayIsoDate(),
      expiryDate: String(base.expiryDate || '').trim() || undefined,
      changeSummary: String(base.changeSummary || '').trim() || undefined,
      note: String(base.note || '').trim() || undefined,
      defaultCostMethod: normalizeBomCostMethod(base.defaultCostMethod),
      components,
    } satisfies BomDefinition;
  };

  const persistDefinition = (baseDefinition: BomDefinition, targetStatus: BomVersionStatus) => {
    const nextDefinition = sanitizeDraft(baseDefinition);
    const parentItemId = String(nextDefinition.parentItemId || '').trim();
    if (!parentItemId) {
      window.alert('Vui lòng chọn sản phẩm/dịch vụ cha.');
      return;
    }
    if (nextDefinition.components.length === 0) {
      window.alert('BOM phải có ít nhất một thành phần hợp lệ.');
      return;
    }
    if (nextDefinition.expiryDate && nextDefinition.effectiveDate && nextDefinition.expiryDate < nextDefinition.effectiveDate) {
      window.alert('Ngày hết hiệu lực phải lớn hơn hoặc bằng ngày hiệu lực.');
      return;
    }
    if (
      (bomDefinitions || []).some(
        (definition) =>
          definition.id !== nextDefinition.id &&
          definition.parentItemId === parentItemId &&
          getBomVersionNumber(definition) === getBomVersionNumber(nextDefinition),
      )
    ) {
      window.alert('Version này đã tồn tại cho sản phẩm đang chọn. Vui lòng tăng số version.');
      return;
    }
    if (nextDefinition.components.some((component) => component.componentItemId === parentItemId)) {
      window.alert('Mã cha không thể đồng thời là một thành phần trong chính BOM này.');
      return;
    }
    const duplicateComponentIds = new Set<string>();
    for (const component of nextDefinition.components) {
      if (duplicateComponentIds.has(component.componentItemId)) {
        window.alert('Một thành phần chỉ nên xuất hiện một lần trong cùng một version BOM.');
        return;
      }
      duplicateComponentIds.add(component.componentItemId);
    }
    if (
      wouldCreateBomCycle(
        parentItemId,
        {
          id: nextDefinition.id,
          parentItemId,
          components: nextDefinition.components,
        },
        bomDefinitions,
        nextDefinition.effectiveDate,
      )
    ) {
      window.alert('Cấu trúc BOM tạo vòng lặp phụ thuộc. Hãy chỉnh lại cây BOM trước khi lưu.');
      return;
    }
    if (baseDefinition.id && baseDefinition.status === 'APPROVED' && targetStatus !== 'OBSOLETE') {
      window.alert('Version đã Approved không được sửa trực tiếp. Hãy clone sang version mới.');
      return;
    }

    const now = new Date().toISOString();
    const nextId = String(nextDefinition.id || '').trim() || makeLocalId();
    const auditTrail = [...(nextDefinition.auditTrail || [])];
    if (!baseDefinition.id) {
      auditTrail.push(
        buildAuditEntry(
          baseDefinition.clonedFromId ? 'CLONED' : 'CREATED',
          nextDefinition.changeSummary || nextDefinition.note,
        ),
      );
    } else {
      auditTrail.push(buildAuditEntry('UPDATED', nextDefinition.changeSummary || 'Cập nhật cấu trúc BOM'));
    }
    if (targetStatus === 'APPROVED') {
      auditTrail.push(buildAuditEntry('APPROVED', `Approved ${nextDefinition.versionCode}`));
      getBomVersionsForParent(bomDefinitions, parentItemId)
        .filter((definition) => definition.id !== nextId && definition.status === 'APPROVED')
        .forEach((definition) => {
          handleUpsertBomDefinition({
            ...definition,
            status: 'OBSOLETE',
            obsoleteAt: now,
            auditTrail: [
              ...(definition.auditTrail || []),
              buildAuditEntry('OBSOLETED', `Obsolete bởi ${nextDefinition.versionCode}`),
            ],
          });
        });
    }
    if (targetStatus === 'OBSOLETE') {
      auditTrail.push(buildAuditEntry('OBSOLETED', `Obsolete ${nextDefinition.versionCode}`));
    }
    const finalDefinition: BomDefinition = {
      ...nextDefinition,
      id: nextId,
      status: targetStatus,
      approvedAt: targetStatus === 'APPROVED' ? now : nextDefinition.approvedAt,
      approvedBy: targetStatus === 'APPROVED' ? 'Admin' : nextDefinition.approvedBy,
      obsoleteAt: targetStatus === 'OBSOLETE' ? now : undefined,
      updatedAt: now,
      auditTrail,
    };
    handleUpsertBomDefinition(finalDefinition);
    setSelectedDefinitionId(nextId);
    closeModal();
  };

  const saveDraft = (targetStatus: BomVersionStatus) => {
    if (!draft) return;
    persistDefinition(draft, targetStatus);
  };

  const handleDelete = (definition: BomDefinition) => {
    const ok = window.confirm(
      `Bạn có chắc muốn xóa ${itemMap.get(definition.parentItemId)?.name || definition.parentItemId} ${getBomVersionCode(definition)}?`,
    );
    if (!ok) return;
    handleDeleteBomDefinition(definition.id);
  };

  const handleObsolete = (definition: BomDefinition) => {
    const ok = window.confirm(`Chuyển ${getBomVersionCode(definition)} sang Obsolete?`);
    if (!ok) return;
    handleUpsertBomDefinition({
      ...definition,
      status: 'OBSOLETE',
      obsoleteAt: new Date().toISOString(),
      auditTrail: [...(definition.auditTrail || []), buildAuditEntry('OBSOLETED', 'Chuyển trạng thái Obsolete')],
    });
  };

  const handleApprove = (definition: BomDefinition) => {
    if (definition.status === 'APPROVED') return;
    persistDefinition(makeDraft(definition, 'edit'), 'APPROVED');
  };

  const updateAlertStatus = (alertKey: string, status: BomAlertStatus) => {
    if (!selectedDefinition) return;
    const nextOverrides = [
      ...(selectedDefinition.alertOverrides || []).filter((entry) => entry.key !== alertKey),
      {
        key: alertKey,
        status,
        updatedAt: new Date().toISOString(),
        updatedBy: 'Admin',
      },
    ];
    handleUpsertBomDefinition({
      ...selectedDefinition,
      alertOverrides: nextOverrides,
      auditTrail: [
        ...(selectedDefinition.auditTrail || []),
        buildAuditEntry('ALERT_STATUS_CHANGED', `${alertKey} → ${status}`),
      ],
    });
  };

  const collectTreeKeys = (nodes: NonNullable<typeof tree>['children']): string[] =>
    nodes.flatMap((node) => [node.key, ...collectTreeKeys(node.children)]);

  const toggleTreeKey = (key: string) => {
    setExpandedTreeKeys((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  };

  const renderTreeRows = (nodes: NonNullable<typeof tree>['children']): React.ReactNode =>
    nodes.map((node) => {
      const isExpanded = expandedTreeKeys[node.key] ?? node.level <= 2;
      const nestedVersion = node.nestedDefinition ? getBomVersionCode(node.nestedDefinition) : '';
      const indentPx = 10 + (node.level - 1) * 18;
      return (
        <React.Fragment key={node.key}>
          <tr className="border-b border-slate-100 align-middle transition-colors hover:bg-slate-50/60 [&>td]:py-2.5">
            <td className="min-w-0 bg-white pl-2" style={{ paddingLeft: `${indentPx}px` }}>
              <div className="flex min-h-[48px] items-start gap-1.5">
                <div className="flex w-5 shrink-0 justify-center pt-1">
                  {node.children.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => toggleTreeKey(node.key)}
                      className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} /> : <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />}
                    </button>
                  ) : (
                    <span className="inline-block w-3 pt-1 text-center text-[10px] text-slate-300">·</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold leading-snug text-slate-900">
                      {node.item?.name || 'Thành phần không tồn tại'}
                    </span>
                    {nestedVersion ? (
                      <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-px text-[10px] font-medium text-blue-700">
                        {nestedVersion}
                      </span>
                    ) : null}
                    {node.missingItem ? (
                      <span className="rounded border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-medium text-red-700">
                        Thiếu mã
                      </span>
                    ) : null}
                    {node.cycleDetected ? (
                      <span className="rounded border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-medium text-red-700">
                        Vòng lặp
                      </span>
                    ) : null}
                    {node.isStockTracked && node.item
                      ? (() => {
                          const whQty = getWarehouseQuantity(node.item, defaultWarehouseId, defaultWarehouseId);
                          const need = Number(node.requiredQuantity || 0);
                          const short = whQty + 1e-9 < need;
                          const whName = warehouses.find((w) => w.id === defaultWarehouseId)?.name || 'Kho mặc định';
                          return short ? (
                            <span
                              title={`${whName} còn ${formatQty(whQty)} — cần nhập thêm ${formatQty(Math.max(0, need - whQty))}`}
                              className="cursor-help text-sm leading-none text-red-600"
                              role="img"
                              aria-label="Thiếu tồn kho"
                            >
                              ⚠️
                            </span>
                          ) : null;
                        })()
                      : null}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">SKU: {node.item?.sku || '—'}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      ĐVT {node.item?.unit || '—'}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      TK {node.item?.accountCode || '—'}
                    </span>
                    <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
                      {getBom154CategoryLabel(node.component.account154Category)}
                    </span>
                  </div>
                </div>
              </div>
            </td>
            <td className="bg-white text-right text-sm font-medium tabular-nums text-slate-800">{formatQty(node.requiredQuantity)}</td>
            <td className="bg-white text-right text-sm tabular-nums text-slate-600">{formatQty(Number(node.component.lossRate || 0))}%</td>
            <td className="bg-white text-right text-sm tabular-nums text-slate-600">{formatQty(Number(node.component.lossQuantity || 0))}</td>
            <td className="bg-white text-right">
              <span
                className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  node.isStockTracked
                    ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80'
                    : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80'
                }`}
              >
                {node.isStockTracked ? 'Tự động kho' : 'Tham chiếu'}
              </span>
            </td>
          </tr>
          {node.children.length > 0 && isExpanded ? renderTreeRows(node.children) : null}
        </React.Fragment>
      );
    });

  return (
    <div className="space-y-3 p-2 md:p-4">
      <div className="rounded-[4px] border border-slate-200 bg-slate-50/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="min-w-0 max-w-[min(100%,42rem)] text-base font-semibold leading-snug text-slate-900">
            Cấu trúc đa cấp, phiên bản, giá thành và MRP
          </h4>
          <button
            type="button"
            onClick={() => openCreate()}
            title="Tạo phiên bản BOM mới"
            className="inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-blue-600 px-2 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">Tạo phiên bản</span>
            <span className="sm:hidden">Thêm</span>
          </button>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] leading-snug text-slate-700 shadow-sm"
        title={summaryCards.criticalCount > 0 ? firstCriticalAlertMessage || 'Có cảnh báo nghiêm trọng cần xử lý' : undefined}
      >
        <span className="whitespace-nowrap">
          <span className="text-slate-500">Sản phẩm có BOM:</span>{' '}
          <span className="font-semibold tabular-nums text-slate-900">{groupedDefinitions.length}</span>
        </span>
        <span className="text-slate-300">|</span>
        <span className="whitespace-nowrap">
          <span className="text-slate-500">Phiên bản:</span>{' '}
          <span className="font-semibold tabular-nums text-slate-900">{summaryCards.totalVersions}</span>
        </span>
        <span className="text-slate-300">|</span>
        <span className="whitespace-nowrap">
          <span className="text-slate-500">Hiệu lực:</span>{' '}
          <span className="font-semibold tabular-nums text-emerald-700">{summaryCards.activeCount}</span>
        </span>
        <span className="text-slate-300">|</span>
        <span className="whitespace-nowrap">
          <span className="text-slate-500">Cảnh báo nặng:</span>{' '}
          <span className="font-semibold tabular-nums text-red-600">{summaryCards.criticalCount}</span>
          {summaryCards.criticalCount > 0 ? <span className="ml-0.5 text-red-500">⚠</span> : null}
        </span>
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,25%)_minmax(0,75%)]">
        <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-3">
            <p className="mb-2 text-[11px] font-semibold text-slate-500">Danh sách sản phẩm / dịch vụ (SKU)</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                placeholder="Tìm SKU, tên, phiên bản..."
              />
            </div>
          </div>
          <div className="max-h-[min(70vh,42rem)] flex-1 overflow-y-auto p-2">
            {groupedDefinitions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                Chưa có BOM phù hợp bộ lọc hiện tại.
              </div>
            ) : null}
            <div className="space-y-3">
              {groupedDefinitions.map((group) => {
                const activeDefinition = getBomDefinitionForParent(bomDefinitions, group.parentItemId, asOfDate);
                const isExpanded = expandedParents[group.parentItemId] ?? group.parentItemId === selectedDefinition?.parentItemId;
                return (
                  <div key={group.parentItemId} className="rounded-2xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedParents((prev) => ({ ...prev, [group.parentItemId]: !(prev[group.parentItemId] ?? true) }))
                      }
                      className="flex w-full items-start justify-between gap-3 rounded-2xl px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div
                          className="text-[13px] font-semibold leading-snug text-slate-900"
                          title={String(group.parentItem?.sku || '').trim() ? `Mã SKU: ${group.parentItem?.sku}` : undefined}
                        >
                          {group.parentItem?.name || 'Mã cha không còn tồn tại'}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-slate-500">
                          <span>{group.versions.length} phiên bản</span>
                          {String(group.parentItem?.sku || '').trim() ? (
                            <span className="font-mono text-[11px] text-slate-400" title={`Mã SKU: ${group.parentItem?.sku}`}>
                              {group.parentItem?.sku}
                            </span>
                          ) : null}
                          <span>ĐVT: {group.parentItem?.unit || '---'}</span>
                          {activeDefinition ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                              Đang dùng: {getBomVersionCode(activeDefinition)}
                            </span>
                          ) : (
                            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-semibold text-red-700">
                              Chưa có phiên bản hiệu lực
                            </span>
                          )}
                        </div>
                      </div>
                      {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />}
                    </button>
                    {isExpanded ? (
                      <div className="space-y-2 border-t border-slate-200 p-3">
                        {group.versions.map((definition) => {
                          const isSelected = definition.id === selectedDefinition?.id;
                          const parentItem = itemMap.get(definition.parentItemId);
                          const isActive = isBomVersionActive(definition, asOfDate);
                          return (
                            <div
                              key={definition.id}
                              className={`rounded-xl border p-3 transition-colors ${
                                isSelected ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 bg-white'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedDefinitionId(definition.id)}
                                className="w-full text-left"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-bold text-slate-800">{getBomVersionCode(definition)}</span>
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${chipClassByStatus(definition.status)}`}>
                                    {getBomVersionStatusLabel(definition.status)}
                                  </span>
                                  {isActive ? (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                      Đang hiệu lực
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  Hiệu lực: {definition.effectiveDate || '---'} {definition.expiryDate ? `→ ${definition.expiryDate}` : '→ không giới hạn'}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {definition.changeSummary || definition.note || parentItem?.name || 'Không có mô tả'}
                                </div>
                              </button>
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedDefinitionId(definition.id)}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                >
                                  Xem
                                </button>
                                <div
                                  ref={versionActionMenuId === definition.id ? versionActionMenuRef : undefined}
                                  className="relative"
                                >
                                  <button
                                    type="button"
                                    onClick={() => setVersionActionMenuId((id) => (id === definition.id ? null : definition.id))}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                    aria-expanded={versionActionMenuId === definition.id}
                                  >
                                    <MoreHorizontal className="h-3.5 w-3.5" /> Thao tác
                                  </button>
                                  {versionActionMenuId === definition.id ? (
                                    <div className="absolute right-0 z-30 mt-1 min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          definition.status === 'APPROVED' ? openClone(definition) : openEdit(definition);
                                          setVersionActionMenuId(null);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                                      >
                                        {definition.status === 'APPROVED' ? (
                                          <>
                                            <Copy className="h-3.5 w-3.5 shrink-0 text-blue-600" /> Clone
                                          </>
                                        ) : (
                                          <>
                                            <Edit className="h-3.5 w-3.5 shrink-0 text-blue-600" /> Sửa
                                          </>
                                        )}
                                      </button>
                                      {definition.status !== 'APPROVED' ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleApprove(definition);
                                            setVersionActionMenuId(null);
                                          }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-emerald-700 hover:bg-emerald-50"
                                        >
                                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Duyệt
                                        </button>
                                      ) : null}
                                      {definition.status !== 'OBSOLETE' ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleObsolete(definition);
                                            setVersionActionMenuId(null);
                                          }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-amber-800 hover:bg-amber-50"
                                        >
                                          Ngừng hiệu lực
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleDelete(definition);
                                          setVersionActionMenuId(null);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50"
                                      >
                                        <Trash2 className="h-3.5 w-3.5 shrink-0" /> Xóa
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {selectedDefinition ? (
            <>
              <div className="rounded-[4px] border border-slate-200 bg-white p-3 shadow-sm md:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className="text-[13px] font-semibold leading-snug text-slate-900"
                        title={selectedParentSku ? `Mã SKU: ${selectedParentSku}` : undefined}
                      >
                        {selectedParentSku ? <span className="sr-only">SKU {selectedParentSku}. </span> : null}
                        {selectedParentItem?.name || 'Mã cha không còn tồn tại'}
                      </h3>
                      <span className={`rounded-[4px] border px-2 py-0.5 text-[12px] font-semibold ${chipClassByStatus(selectedDefinition.status)}`}>
                        {getBomVersionStatusLabel(selectedDefinition.status)}
                      </span>
                      <span className="rounded-[4px] border border-blue-200 bg-blue-50 px-2 py-0.5 text-[12px] font-semibold text-blue-700">
                        {getBomVersionCode(selectedDefinition)}
                      </span>
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-slate-500">
                      <span>Hiệu lực {selectedDefinition.effectiveDate || '—'}</span>
                      <span className="text-slate-300" aria-hidden>
                        |
                      </span>
                      <span>Hết {selectedDefinition.expiryDate || 'Không giới hạn'}</span>
                      <span className="text-slate-300" aria-hidden>
                        |
                      </span>
                      <span>Cập nhật {new Date(selectedDefinition.updatedAt).toLocaleString('vi-VN')}</span>
                      <span className="text-slate-300" aria-hidden>
                        |
                      </span>
                      <span>Giá {getBomCostMethodLabel(selectedDefinition.defaultCostMethod)}</span>
                    </p>
                    <p className="mt-1.5 max-w-4xl text-[13px] font-normal leading-relaxed text-slate-600">
                      {selectedDefinition.changeSummary || selectedDefinition.note || 'Chưa có ghi chú thay đổi cho version này.'}
                    </p>
                  </div>
                  <div ref={mainActionMenuRef} className="relative flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {selectedDefinition.status === 'APPROVED' ? (
                      <button
                        type="button"
                        onClick={openProductionOrderFromSelectedBom}
                        className="inline-flex items-center gap-1 rounded-[4px] border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[12px] font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        <Factory className="h-3.5 w-3.5" /> Tạo lệnh SX
                      </button>
                    ) : null}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMainBomActionsOpen((o) => !o)}
                        className="inline-flex items-center gap-1 rounded-[4px] border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                        aria-expanded={mainBomActionsOpen}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" /> Thao tác
                      </button>
                      {mainBomActionsOpen ? (
                        <div className="absolute right-0 z-30 mt-1 min-w-[12rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => {
                              openClone(selectedDefinition);
                              setMainBomActionsOpen(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <Copy className="h-4 w-4 shrink-0 text-blue-600" /> Clone phiên bản
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              openCreate(selectedDefinition.parentItemId);
                              setMainBomActionsOpen(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <Plus className="h-4 w-4 shrink-0 text-slate-600" /> Thêm phiên bản
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleDelete(selectedDefinition);
                              setMainBomActionsOpen(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4 shrink-0" /> Xóa phiên bản
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
                  {[
                    { id: 'TREE', label: 'Cây BOM đa cấp', icon: GitBranch },
                    { id: 'COST', label: 'Giá thành theo BOM', icon: Calculator },
                    { id: 'INVENTORY', label: 'Kiểm tra tồn kho', icon: Factory },
                    { id: 'ALERTS', label: 'Hệ thống cảnh báo', icon: ShieldAlert },
                    { id: 'MRP', label: 'MRP cơ bản', icon: ClipboardList },
                    { id: 'ORDERS', label: 'Lệnh sản xuất', icon: Factory },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as BomWorkspaceTab)}
                      className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                        activeTab === tab.id
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <tab.icon className="mr-1 inline h-4 w-4" /> {tab.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-2 p-2 sm:p-3">
                  <div className="rounded-[4px] border border-slate-200 bg-slate-50/90 px-2 py-2 shadow-sm">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="flex min-h-8 min-w-0 items-center gap-1.5 rounded-[4px] border border-slate-200 bg-white px-2 shadow-sm">
                        <Hash className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden title="Số lượng phân rã / tính" />
                        <input
                          type="number"
                          min="1"
                          step="0.000001"
                          value={lotQuantity}
                          onChange={(event) => setLotQuantity(event.target.value)}
                          placeholder="Số lượng…"
                          title="Số lượng cần phân rã / tính"
                          className="h-8 min-h-8 w-full min-w-0 border-0 bg-transparent text-[13px] leading-none outline-none placeholder:text-slate-400 focus:ring-0"
                        />
                      </div>
                      <div className="flex min-h-8 min-w-0 items-center gap-1.5 rounded-[4px] border border-slate-200 bg-white px-2 shadow-sm">
                        <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden title="Ngày hiệu lực / costing" />
                        <input
                          type="date"
                          value={asOfDate}
                          onChange={(event) => setAsOfDate(event.target.value)}
                          title="Ngày hiệu lực / costing"
                          className="h-8 min-h-8 w-full min-w-0 border-0 bg-transparent text-[13px] leading-none outline-none focus:ring-0"
                        />
                      </div>
                      <div className="flex min-h-8 min-w-0 items-center gap-1 rounded-[4px] border border-slate-200 bg-white px-1.5 shadow-sm">
                        <Layers className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden title="Độ sâu cấp" />
                        <select
                          value={maxDepth}
                          onChange={(event) => setMaxDepth(event.target.value)}
                          title="Số cấp drill-down"
                          className="h-8 min-h-8 min-w-0 flex-1 cursor-pointer border-0 bg-transparent py-0 pl-0.5 pr-6 text-[13px] leading-none outline-none focus:ring-0"
                        >
                          <option value="5">5 cấp</option>
                          <option value="7">7 cấp</option>
                          <option value="10">10 cấp</option>
                        </select>
                        {activeTab === 'TREE' ? (
                          <div className="flex shrink-0 items-center gap-0 border-l border-slate-200 pl-1">
                            <button
                              type="button"
                              title="Mở tất cả nhánh"
                              onClick={() =>
                                setExpandedTreeKeys(
                                  Object.fromEntries((tree ? collectTreeKeys(tree.children) : []).map((key) => [key, true])),
                                )
                              }
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                            >
                              <ChevronsDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Thu gọn tất cả"
                              onClick={() => setExpandedTreeKeys({})}
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                            >
                              <ChevronsUp className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex min-h-8 min-w-0 items-center gap-1.5 rounded-[4px] border border-slate-200 bg-white px-2 shadow-sm">
                        <Calculator className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden title="Phương pháp giá" />
                        <select
                          value={costMethod}
                          onChange={(event) => setCostMethod(event.target.value as BomCostMethod)}
                          title="Phương pháp giá"
                          className="h-8 min-h-8 w-full min-w-0 flex-1 cursor-pointer border-0 bg-transparent text-[13px] leading-none outline-none focus:ring-0"
                        >
                          <option value="STANDARD">Giá chuẩn</option>
                          <option value="ACTUAL">Giá thực tế</option>
                          <option value="AVERAGE">Giá bình quân</option>
                        </select>
                      </div>
                    </div>
                    {activeTab === 'TREE' && selectedDefinition ? (
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-slate-200/80 pt-2 text-[11px] text-slate-500">
                        <span>
                          Cây <b className="font-semibold text-slate-700">{tree ? collectTreeKeys(tree.children).length : 0}</b>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span>{getBomVersionCode(selectedDefinition)}</span>
                        <span className="text-slate-300">|</span>
                        <span>
                          Sâu <b className="font-semibold text-slate-700">{maxDepthNumber}</b>
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {activeTab === 'TREE' ? (
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <div className="border-b border-slate-100 bg-[#F8FAFC] px-3 py-2">
                        <h4 className="text-sm font-semibold text-slate-800">Cây cấu trúc BOM đa cấp</h4>
                        <p className="text-[11px] text-slate-500">Mở/đóng nhánh; xem phân tầng tới vật tư đầu cuối.</p>
                      </div>
                      <div className="overflow-x-auto">
                        {tree ? (
                          <table className="w-full min-w-[640px] table-fixed border-collapse bg-white text-sm">
                            <colgroup>
                              <col className="min-w-0 w-[40%]" />
                              <col className="w-[15%]" />
                              <col className="w-[15%]" />
                              <col className="w-[15%]" />
                              <col className="w-[15%]" />
                            </colgroup>
                            <thead>
                              <tr className="border-b border-slate-100 bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                <th className="px-2 py-2 text-left align-bottom" rowSpan={2}>
                                  Thành phần
                                </th>
                                <th className="px-1 py-1.5 text-center" colSpan={3}>
                                  Định mức
                                </th>
                                <th className="px-2 py-2 text-right align-bottom" rowSpan={2}>
                                  Tồn kho
                                </th>
                              </tr>
                              <tr className="border-b border-slate-100 bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                <th className="whitespace-nowrap px-1 py-1.5 text-right">Nhu cầu</th>
                                <th className="whitespace-nowrap px-1 py-1.5 text-right">Hao hụt %</th>
                                <th className="whitespace-nowrap px-1 py-1.5 text-right">Hao hụt SL</th>
                              </tr>
                            </thead>
                            <tbody>{renderTreeRows(tree.children)}</tbody>
                          </table>
                        ) : (
                          <div className="p-6 text-sm text-slate-400">Không có dữ liệu cây BOM.</div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {activeTab === 'COST' ? (
                    <div className="space-y-3">
                      {(() => {
                        const m = Math.max(0, activeCostSummary.materialCost);
                        const l = Math.max(0, activeCostSummary.laborCost);
                        const o = Math.max(0, activeCostSummary.overheadCost);
                        const denom = m + l + o || 1;
                        const mp = (m / denom) * 100;
                        const lp = (l / denom) * 100;
                        const op = (o / denom) * 100;
                        const varStdAct = costSummaryActual.totalCost - costSummaryStandard.totalCost;
                        return (
                          <div className="rounded border border-slate-200 bg-white p-3 md:p-4">
                            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#F1F5F9] pb-3">
                              <div>
                                <p className="text-[12px] font-semibold text-slate-600">
                                  Đơn giá ({getBomCostMethodLabel(costMethod)})
                                </p>
                                <p className="mt-0.5 text-[13px] font-normal tabular-nums text-slate-900 md:text-lg md:font-bold">
                                  {formatCurrency(activeCostSummary.unitCost)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-[12px] font-semibold text-slate-600">Tổng chi phí lô</p>
                                <p className="mt-0.5 text-[13px] font-normal tabular-nums text-slate-900 md:text-lg md:font-bold">
                                  {formatCurrency(activeCostSummary.totalCost)}
                                </p>
                              </div>
                            </div>
                            <div className="mt-3 space-y-2">
                              <div className="flex h-2.5 w-full max-w-3xl overflow-hidden rounded-[4px] bg-slate-100">
                                <div className="bg-blue-500 transition-[width]" style={{ width: `${mp}%` }} title="NVL" />
                                <div className="bg-amber-500 transition-[width]" style={{ width: `${lp}%` }} title="Nhân công" />
                                <div className="bg-violet-500 transition-[width]" style={{ width: `${op}%` }} title="SX chung" />
                              </div>
                              <div className="flex max-w-3xl flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-600">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-hidden />
                                  NVL trực tiếp{' '}
                                  <span className="font-semibold tabular-nums text-slate-900">
                                    {formatCurrency(activeCostSummary.materialCost)}
                                  </span>
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
                                  Nhân công{' '}
                                  <span className="font-semibold tabular-nums text-slate-900">
                                    {formatCurrency(activeCostSummary.laborCost)}
                                  </span>
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500" aria-hidden />
                                  SX chung{' '}
                                  <span className="font-semibold tabular-nums text-slate-900">
                                    {formatCurrency(activeCostSummary.overheadCost)}
                                  </span>
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500">
                                Chuẩn so với thực tế (lô):{' '}
                                <span className={varStdAct >= 0 ? 'font-semibold text-red-600' : 'font-semibold text-emerald-700'}>
                                  {formatCurrency(varStdAct)}
                                </span>
                                {' · '}
                                Chi phí hao hụt (tổng):{' '}
                                <span className="font-semibold text-amber-800">{formatCurrency(activeCostSummary.scrapCost)}</span>
                              </p>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="overflow-hidden rounded border border-slate-200 bg-white">
                        <div className="border-b border-[#F1F5F9] bg-white px-3 py-2 md:px-4">
                          <h4 className="text-[13px] font-semibold text-slate-900">Bảng costing roll-up theo BOM</h4>
                          <p className="text-[11px] text-slate-500">
                            Đơn giá & thành tiền theo nhu cầu; phế phẩm và chi phí hao hụt đối soát cạnh nhau.
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[1100px] border-collapse text-[13px] text-slate-900">
                            <thead>
                              <tr className="border-b border-[#F1F5F9] bg-white">
                                <th className="px-2 py-2 text-left text-[12px] font-semibold text-slate-600">Thành phần</th>
                                <th className="w-[88px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">Nhu cầu</th>
                                <th className="w-[88px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">SL cơ sở</th>
                                <th className="w-[88px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">Phế phẩm</th>
                                <th className="w-[104px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">CP hao hụt</th>
                                <th className="w-[112px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">Đơn giá</th>
                                <th className="w-[120px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">Thành tiền</th>
                                <th className="min-w-[120px] px-2 py-2 text-left text-[12px] font-semibold text-slate-600">Nguồn</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {activeCostSummary.lines.map((line) => (
                                <tr key={line.key} className="border-b border-[#F1F5F9]">
                                  <td className="px-2 py-1.5 align-top">
                                    <div className="font-semibold leading-tight text-slate-900">
                                      {line.item?.sku || line.itemId} — {line.item?.name || 'Component không còn tồn tại'}
                                    </div>
                                    <div className="text-[11px] leading-snug text-slate-500">{line.path.join(' → ')}</div>
                                  </td>
                                  <td className="h-9 px-2 py-1.5 text-right align-middle tabular-nums">{formatQty(line.requiredQuantity)}</td>
                                  <td className="h-9 px-2 py-1.5 text-right align-middle tabular-nums">{formatQty(line.baseQuantity)}</td>
                                  <td className="h-9 px-2 py-1.5 text-right align-middle tabular-nums text-amber-800">{formatQty(line.scrapQuantity)}</td>
                                  <td className="h-9 px-2 py-1.5 text-right align-middle tabular-nums text-amber-800">{formatCurrency(line.scrapCost)}</td>
                                  <td className="h-9 px-2 py-1.5 text-right align-middle tabular-nums">{formatCurrency(line.unitCost)}</td>
                                  <td className="h-9 px-2 py-1.5 text-right align-middle font-medium tabular-nums">{formatCurrency(line.extendedCost)}</td>
                                  <td className="px-2 py-1.5 align-top">
                                    <div className="font-normal text-slate-900">{line.source}</div>
                                    <div className="text-[11px] text-slate-500">{getBom154CategoryLabel(line.category)}</div>
                                  </td>
                                </tr>
                              ))}
                              {activeCostSummary.lines.length === 0 ? (
                                <tr>
                                  <td colSpan={8} className="px-3 py-8 text-center text-[13px] text-slate-400">
                                    Chưa có line costing để tính.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {activeTab === 'INVENTORY' ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 md:px-4">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${inventoryCheck.blocked ? 'bg-red-500' : 'bg-emerald-500'}`}
                            aria-hidden
                          />
                          <span className="text-slate-600">Block sản xuất:</span>
                          <span className={`font-semibold ${inventoryCheck.blocked ? 'text-red-700' : 'text-emerald-700'}`}>
                            {inventoryCheck.blocked ? 'Có' : 'Không'}
                          </span>
                        </span>
                        <span className="hidden text-slate-300 sm:inline">|</span>
                        <span className="whitespace-nowrap">
                          <span className="text-slate-600">Thiếu hàng:</span>{' '}
                          <span className="text-base font-bold tabular-nums text-red-700">
                            {formatQty(inventoryCheck.totalShortageQuantity)}
                          </span>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="whitespace-nowrap">
                          <span className="text-slate-600">Nhu cầu:</span>{' '}
                          <span className="font-semibold tabular-nums text-slate-900">
                            {formatQty(inventoryCheck.totalRequiredQuantity)}
                          </span>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="whitespace-nowrap text-slate-600">
                          Kho:{' '}
                          <span className="font-semibold text-slate-900">
                            {warehouses.length > 0 ? `${warehouses.length} kho` : 'Chưa cấu hình'}
                          </span>
                        </span>
                        <span className="ml-auto inline-flex items-center gap-1 text-slate-500" title="Net = Khả dụng − Đã giữ; thiếu khi nhu cầu vượt tồn khả dụng sau giữ.">
                          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="max-w-[14rem] truncate text-[11px] sm:max-w-none">
                            Tồn tổng; cột Đã giữ điều chỉnh trước SX.
                          </span>
                        </span>
                      </div>

                      <div className="overflow-hidden rounded border border-slate-200 bg-white">
                        <div className="border-b border-[#F1F5F9] px-3 py-2 md:px-4">
                          <h4 className="text-[13px] font-semibold text-slate-900">Tồn khả dụng so với nhu cầu</h4>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[960px] border-collapse text-[13px] text-slate-900">
                            <thead>
                              <tr className="border-b border-[#F1F5F9] bg-white">
                                <th className="min-w-[200px] px-2 py-2 text-left text-[12px] font-semibold text-slate-600">
                                  Vật tư
                                </th>
                                <th className="w-[88px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">Nhu cầu</th>
                                <th className="w-[88px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">Khả dụng</th>
                                <th className="w-[104px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">Đã giữ</th>
                                <th className="w-[88px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">Còn lại</th>
                                <th className="w-[96px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">NET</th>
                                <th className="w-[88px] px-2 py-2 text-right text-[12px] font-semibold text-slate-600">Thiếu</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {inventoryCheck.lines.map((line) => {
                                const netBalance = line.netAvailableQuantity - line.requiredQuantity;
                                const netNegative = netBalance < -0.000001;
                                const netPositive = netBalance > 0.000001;
                                return (
                                  <tr key={line.itemId} className="border-b border-[#F1F5F9]">
                                    <td className="px-2 py-1.5 align-top">
                                      <div className="font-semibold leading-tight text-slate-900">
                                        {line.item?.sku || line.itemId} — {line.item?.name || 'Component không còn tồn tại'}
                                      </div>
                                      <div className="text-[11px] leading-snug text-slate-500">{line.path.join(' → ')}</div>
                                    </td>
                                    <td className="h-9 px-2 py-1.5 text-right align-middle tabular-nums">{formatQty(line.requiredQuantity)}</td>
                                    <td className="h-9 px-2 py-1.5 text-right align-middle tabular-nums">{formatQty(line.availableQuantity)}</td>
                                    <td className="h-9 px-2 py-1.5 text-right align-middle">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.000001"
                                        value={reservedByItemId[line.itemId] || ''}
                                        onChange={(event) =>
                                          setReservedByItemId((prev) => ({ ...prev, [line.itemId]: event.target.value }))
                                        }
                                        className="h-8 w-[6.5rem] rounded-[4px] border border-slate-300 px-2 py-0 text-right text-[13px] tabular-nums outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30"
                                      />
                                    </td>
                                    <td className="h-9 px-2 py-1.5 text-right align-middle tabular-nums">{formatQty(line.netAvailableQuantity)}</td>
                                    <td
                                      className={`h-9 px-2 py-1.5 text-right align-middle font-semibold tabular-nums ${
                                        netNegative
                                          ? 'text-red-700'
                                          : netPositive
                                            ? 'text-emerald-700'
                                            : 'text-slate-800'
                                      }`}
                                      title="NET = Còn lại − Nhu cầu (dương: dư; âm: thiếu so với nhu cầu)"
                                    >
                                      {formatQty(netBalance)}
                                    </td>
                                    <td
                                      className={`h-9 px-2 py-1.5 text-right align-middle font-semibold tabular-nums ${
                                        line.shortageQuantity > 0 ? 'text-red-700' : 'text-emerald-700'
                                      }`}
                                    >
                                      {formatQty(line.shortageQuantity)}
                                    </td>
                                  </tr>
                                );
                              })}
                              {inventoryCheck.lines.length === 0 ? (
                                <tr>
                                  <td colSpan={7} className="px-3 py-8 text-center text-[13px] text-slate-400">
                                    Không có dòng NVL kho nào để kiểm tra.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {activeTab === 'ALERTS' ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700">
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">Info:</span>{' '}
                          <span className="font-semibold tabular-nums text-blue-700">
                            {computedAlerts.filter((alert) => alert.severity === 'INFO' && alert.status !== 'RESOLVED').length}
                          </span>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">Cảnh báo:</span>{' '}
                          <span className="font-semibold tabular-nums text-amber-700">
                            {computedAlerts.filter((alert) => alert.severity === 'WARNING' && alert.status !== 'RESOLVED').length}
                          </span>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">Nghiêm trọng:</span>{' '}
                          <span className="font-semibold tabular-nums text-red-600">
                            {computedAlerts.filter((alert) => alert.severity === 'CRITICAL' && alert.status !== 'RESOLVED').length}
                          </span>
                        </span>
                      </div>

                      <div className="overflow-hidden rounded border border-slate-200 bg-white">
                        <div className="border-b border-slate-200 bg-[#F8FAFC] px-2 py-1.5">
                          <h4 className="text-[13px] font-semibold text-slate-900">Danh sách cảnh báo</h4>
                          <p className="text-[11px] text-slate-500">Info / Warning / Critical · New · Seen · Resolved</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[640px] table-fixed border-collapse text-[13px]">
                            <colgroup>
                              <col className="min-w-0 w-[36%]" />
                              <col className="w-[100px]" />
                              <col className="w-[100px]" />
                              <col className="min-w-0 w-auto" />
                              <col className="w-[200px]" />
                            </colgroup>
                            <thead>
                              <tr className="border-b border-slate-200 bg-[#F8FAFC] text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                                <th className="px-2 py-1 text-left">Cảnh báo</th>
                                <th className="px-2 py-1 text-left">Mức</th>
                                <th className="px-2 py-1 text-left">TT</th>
                                <th className="px-2 py-1 text-left">Chi tiết</th>
                                <th className="px-2 py-1 text-right">Xử lý</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {computedAlerts.map((alert) => (
                                <tr key={alert.key} className="border-b border-slate-100">
                                  <td className="px-2 py-1 align-top">
                                    <div className="font-medium leading-snug text-slate-900">{alert.title}</div>
                                    <div className="text-[11px] text-slate-500">{alert.code}</div>
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${severityBadgeClass(alert.severity)}`}>
                                      {getBomAlertSeverityLabel(alert.severity)}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${chipClassByAlertStatus(alert.status)}`}>
                                      {getBomAlertStatusLabel(alert.status)}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1 align-top text-[12px] leading-snug text-slate-600">{alert.message}</td>
                                  <td className="px-2 py-1 align-middle text-right">
                                    <div className="flex flex-wrap justify-end gap-1">
                                      {(['NEW', 'SEEN', 'RESOLVED'] as BomAlertStatus[]).map((status) => (
                                        <button
                                          key={status}
                                          type="button"
                                          onClick={() => updateAlertStatus(alert.key, status)}
                                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                            alert.status === status
                                              ? 'border-blue-300 bg-blue-50 text-blue-700'
                                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                          }`}
                                        >
                                          {status === 'NEW' ? 'Mới' : status === 'SEEN' ? 'Xem' : 'Xong'}
                                        </button>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {computedAlerts.length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="px-2 py-8 text-center text-[13px] text-slate-400">
                                    Không có cảnh báo cho version này.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {activeTab === 'MRP' ? (
                    <div className="space-y-3">
                      <div className="overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-[#F8FAFC] px-2 py-1.5">
                          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0">
                            <h4 className="text-[13px] font-semibold text-slate-900">Kế hoạch sản xuất</h4>
                            <span className="text-[11px] text-slate-500">MRP · {mrpPlans.length} dòng</span>
                            <span className="text-slate-300">|</span>
                            <span className="text-[11px] text-slate-500">Độ sâu xem {maxDepthNumber} cấp</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setMrpPlans((prev) => [...prev, createMrpPlanLine(selectedDefinition?.parentItemId || '')])}
                            className="inline-flex shrink-0 items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                            title="Thêm plan"
                          >
                            <Plus className="h-3.5 w-3.5" /> Thêm
                          </button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[720px] table-fixed border-collapse text-[13px]">
                            <colgroup>
                              <col className="min-w-0 w-[28%]" />
                              <col className="w-[88px]" />
                              <col className="w-[120px]" />
                              <col className="min-w-0 w-[18%]" />
                              <col className="min-w-0 w-[20%]" />
                              <col className="w-[44px]" />
                              <col className="w-[36px]" />
                            </colgroup>
                            <thead>
                              <tr className="border-b border-slate-200 bg-[#F8FAFC] text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                                <th className="px-2 py-1 text-left">Sản phẩm / DV</th>
                                <th className="px-2 py-1 text-right">SL</th>
                                <th className="px-2 py-1 text-left">Ngày</th>
                                <th className="px-2 py-1 text-left">Kho</th>
                                <th className="px-2 py-1 text-left">Ghi chú</th>
                                <th className="px-1 py-1 text-center" title="Tạo lệnh SX">
                                  LSX
                                </th>
                                <th className="px-1 py-1 text-right" />
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {mrpPlans.map((plan, idx) => (
                                <tr key={plan.id} className="border-b border-slate-100">
                                  <td className="px-2 py-1 align-middle">
                                    <span className="mr-1 inline-block w-4 text-center text-[11px] text-slate-400">{idx + 1}</span>
                                    <select
                                      value={plan.parentItemId}
                                      onChange={(event) =>
                                        setMrpPlans((prev) =>
                                          prev.map((entry) =>
                                            entry.id === plan.id ? { ...entry, parentItemId: event.target.value } : entry,
                                          ),
                                        )
                                      }
                                      className="h-8 w-[calc(100%-1.25rem)] rounded border border-slate-200 bg-white px-1.5 text-[13px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/20"
                                    >
                                      <option value="">— Chọn SP —</option>
                                      {groupedDefinitions.map((group) => (
                                        <option key={group.parentItemId} value={group.parentItemId}>
                                          {group.parentItem?.sku || 'N/A'} — {group.parentItem?.name || group.parentItemId}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-2 py-1 align-middle text-right">
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.000001"
                                      value={plan.quantity}
                                      onChange={(event) =>
                                        setMrpPlans((prev) =>
                                          prev.map((entry) =>
                                            entry.id === plan.id ? { ...entry, quantity: Number(event.target.value || 0) } : entry,
                                          ),
                                        )
                                      }
                                      className="h-8 w-full max-w-[5.5rem] rounded border border-slate-200 px-1.5 text-right tabular-nums text-[13px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/20"
                                    />
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    <input
                                      type="date"
                                      value={plan.planDate}
                                      onChange={(event) =>
                                        setMrpPlans((prev) =>
                                          prev.map((entry) =>
                                            entry.id === plan.id ? { ...entry, planDate: event.target.value } : entry,
                                          ),
                                        )
                                      }
                                      className="h-8 w-full rounded border border-slate-200 px-1 text-[11px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/20"
                                    />
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    <select
                                      value={plan.warehouseId || ''}
                                      onChange={(event) =>
                                        setMrpPlans((prev) =>
                                          prev.map((entry) =>
                                            entry.id === plan.id ? { ...entry, warehouseId: event.target.value } : entry,
                                          ),
                                        )
                                      }
                                      className="h-8 w-full rounded border border-slate-200 px-1 text-[12px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/20"
                                    >
                                      <option value="">Tất cả kho</option>
                                      {warehouses.map((warehouse) => (
                                        <option key={warehouse.id} value={warehouse.id}>
                                          {warehouse.name}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    <input
                                      value={plan.note || ''}
                                      onChange={(event) =>
                                        setMrpPlans((prev) =>
                                          prev.map((entry) =>
                                            entry.id === plan.id ? { ...entry, note: event.target.value } : entry,
                                          ),
                                        )
                                      }
                                      className="h-8 w-full rounded border border-slate-200 px-1.5 text-[13px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/20"
                                      placeholder="Ghi chú…"
                                    />
                                  </td>
                                  <td className="px-1 py-1 text-center align-middle">
                                    <button
                                      type="button"
                                      onClick={() => openProductionOrderFromPlan(plan)}
                                      className="inline-flex rounded border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100"
                                      title="Tạo LSX"
                                    >
                                      <Factory className="h-3.5 w-3.5" />
                                    </button>
                                  </td>
                                  <td className="px-1 py-1 text-right align-middle">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setMrpPlans((prev) => (prev.length > 1 ? prev.filter((entry) => entry.id !== plan.id) : prev))
                                      }
                                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                      title="Xóa dòng"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700">
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">Số plan:</span>{' '}
                          <span className="font-semibold tabular-nums">{mrpResult.planCount}</span>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">Tổng nhu cầu:</span>{' '}
                          <span className="font-semibold tabular-nums">{formatQty(mrpResult.totalRequiredQuantity)}</span>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">Net:</span>{' '}
                          <span className="font-semibold tabular-nums text-red-600">{formatQty(mrpResult.totalNetRequirement)}</span>
                        </span>
                      </div>

                      <div className="overflow-hidden rounded border border-slate-200 bg-white">
                        <div className="border-b border-slate-200 bg-[#F8FAFC] px-2 py-1.5">
                          <h4 className="text-[13px] font-semibold text-slate-900">Kết quả lập kế hoạch</h4>
                          <p className="text-[11px] text-slate-500">Mua / chuyển kho khi net &gt; 0.</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[720px] table-fixed border-collapse text-[13px]">
                            <colgroup>
                              <col className="min-w-0 w-[38%]" />
                              <col className="min-w-0 w-[14%]" />
                              <col className="w-[92px]" />
                              <col className="w-[92px]" />
                              <col className="w-[92px]" />
                              <col className="w-[92px]" />
                              <col className="w-[120px]" />
                            </colgroup>
                            <thead>
                              <tr className="border-b border-slate-200 bg-[#F8FAFC] text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                                <th className="px-2 py-1 text-left">Vật tư / chi tiết</th>
                                <th className="px-2 py-1 text-left">Kho</th>
                                <th className="px-2 py-1 text-right">Req.</th>
                                <th className="px-2 py-1 text-right">Avail.</th>
                                <th className="px-2 py-1 text-right">Res.</th>
                                <th className="px-2 py-1 text-right">Net</th>
                                <th className="px-2 py-1 text-left">Gợi ý</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {mrpResult.lines.map((line) => (
                                <tr key={`${line.warehouseId || 'ALL'}::${line.itemId}`} className="border-b border-slate-100">
                                  <td className="px-2 py-1 align-top">
                                    <div className="truncate font-medium text-slate-900" title={`${line.item?.sku || line.itemId} — ${line.item?.name || ''}`}>
                                      {line.item?.name || '—'}
                                    </div>
                                    <div className="truncate text-[11px] text-slate-500">{line.item?.sku || line.itemId}</div>
                                  </td>
                                  <td className="px-2 py-1 align-middle text-[12px] text-slate-600">
                                    <span className="line-clamp-2">{line.warehouseName || line.warehouseId || 'Tồn tổng'}</span>
                                  </td>
                                  <td className="px-2 py-1 text-right align-middle tabular-nums text-slate-800">{formatQty(line.requiredQuantity)}</td>
                                  <td className="px-2 py-1 text-right align-middle tabular-nums text-slate-700">{formatQty(line.availableQuantity)}</td>
                                  <td className="px-2 py-1 text-right align-middle">
                                    {(() => {
                                      const reservedKey = `${line.warehouseId || ''}::${line.itemId}`;
                                      return (
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.000001"
                                          value={mrpReservedByItemId[reservedKey] || mrpReservedByItemId[line.itemId] || ''}
                                          onChange={(event) =>
                                            setMrpReservedByItemId((prev) => ({ ...prev, [reservedKey]: event.target.value }))
                                          }
                                          className="h-8 w-full max-w-[5.5rem] rounded border border-slate-200 px-1 text-right text-[12px] tabular-nums outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/20"
                                        />
                                      );
                                    })()}
                                  </td>
                                  <td className={`px-2 py-1 text-right align-middle tabular-nums font-medium ${line.netRequirement > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                                    {formatQty(line.netRequirement)}
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    <span
                                      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                        line.recommendation === 'NONE'
                                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                          : 'border-amber-200 bg-amber-50 text-amber-700'
                                      }`}
                                    >
                                      {line.recommendation === 'NONE'
                                        ? 'Đủ tồn'
                                        : line.recommendation === 'PURCHASE'
                                          ? 'Mua thêm'
                                          : line.recommendation === 'TRANSFER'
                                            ? 'Chuyển kho'
                                            : 'Mua / CK'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                              {mrpResult.lines.length === 0 ? (
                                <tr>
                                  <td colSpan={7} className="px-2 py-8 text-center text-[13px] text-slate-400">
                                    Chưa có output MRP.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {mrpResult.alerts.length > 0 ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                          <h5 className="font-semibold text-red-700">MRP Alerts</h5>
                          <div className="mt-2 space-y-2 text-sm text-red-700">
                            {mrpResult.alerts.map((alert) => (
                              <div key={alert.key}>• {alert.message}</div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {activeTab === 'ORDERS' ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700">
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">Tổng LSX:</span>{' '}
                          <span className="font-semibold tabular-nums text-slate-900">{productionOrderRows.length}</span>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">Draft:</span>{' '}
                          <span className="font-semibold tabular-nums text-amber-700">
                            {productionOrderRows.filter((order) => order.status === 'DRAFT').length}
                          </span>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">Released:</span>{' '}
                          <span className="font-semibold tabular-nums text-blue-700">
                            {productionOrderRows.filter((order) => order.status === 'RELEASED').length}
                          </span>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">Completed:</span>{' '}
                          <span className="font-semibold tabular-nums text-emerald-700">
                            {productionOrderRows.filter((order) => order.status === 'COMPLETED').length}
                          </span>
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-[#F8FAFC] px-2 py-1.5">
                        <div className="min-w-0">
                          <h4 className="text-[13px] font-semibold text-slate-900">Lệnh sản xuất</h4>
                          <p className="text-[11px] text-slate-500">Draft / Released / Complete · xuất NVL · nhập TP</p>
                        </div>
                        <button
                          type="button"
                          onClick={openProductionOrderFromSelectedBom}
                          className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                          title="Tạo LSX từ BOM đang chọn"
                        >
                          <Factory className="h-3.5 w-3.5" /> Tạo LSX
                        </button>
                      </div>

                      <div className="overflow-hidden rounded border border-slate-200 bg-white">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[900px] border-collapse text-[13px]">
                            <thead>
                              <tr className="border-b border-slate-200 bg-[#F8FAFC] text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                                <th className="px-2 py-1 text-left">Lệnh SX</th>
                                <th className="px-2 py-1 text-left">Thành phẩm</th>
                                <th className="px-2 py-1 text-left">Kho</th>
                                <th className="w-20 px-2 py-1 text-right">SL</th>
                                <th className="px-2 py-1 text-left">Ngày</th>
                                <th className="w-28 px-2 py-1 text-left">TT</th>
                                <th className="w-28 px-2 py-1 text-right">Cost</th>
                                <th className="w-[140px] px-2 py-1 text-right">Thao tác</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {productionOrderRows.map((order) => (
                                <tr key={order.id} className="border-b border-slate-100">
                                  <td className="px-2 py-1 align-top">
                                    <div className="font-medium text-slate-900">
                                      {order.orderNumber || previewDocumentNumber('LSX', order.startDate)}
                                    </div>
                                    <div className="text-[11px] text-slate-500">{order.bomVersionCode || 'BOM'}</div>
                                  </td>
                                  <td className="px-2 py-1 align-top">
                                    <div className="font-medium leading-snug text-slate-900">
                                      {order.parentItemSku || order.parentItemId} — {order.parentItemName}
                                    </div>
                                    <div className="text-[11px] text-slate-500">{order.materials.length} dòng NVL</div>
                                  </td>
                                  <td className="px-2 py-1 align-top text-[12px] text-slate-600">
                                    <div>{order.sourceWarehouseName || order.sourceWarehouseId}</div>
                                    <div className="text-[11px] text-slate-400">→ {order.targetWarehouseName || order.targetWarehouseId}</div>
                                  </td>
                                  <td className="px-2 py-1 text-right align-middle text-[13px] font-semibold tabular-nums text-slate-900">{formatQty(order.quantity)}</td>
                                  <td className="px-2 py-1 align-top text-[12px] text-slate-600">
                                    <div>{order.startDate}</div>
                                    <div className="text-[11px] text-slate-400">HT {order.completionDate || '—'}</div>
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${productionStatusClass(order.status)}`}>
                                      {order.status}
                                    </span>
                                    {order.shortageCount ? (
                                      <div className="mt-0.5 text-[10px] text-red-600">Thiếu {order.shortageCount}</div>
                                    ) : null}
                                  </td>
                                  <td className="px-2 py-1 text-right align-middle text-[12px] font-semibold tabular-nums text-slate-900">
                                    {formatCurrency(order.totalPlannedCost || order.output.totalCost || 0)}
                                  </td>
                                  <td className="px-2 py-1 text-right align-middle">
                                    <div className="flex flex-wrap justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setProductionDraft(order)}
                                        className="rounded border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-50"
                                        title="Sửa"
                                      >
                                        <Edit className="h-3.5 w-3.5" />
                                      </button>
                                      {order.status === 'DRAFT' ? (
                                        <button
                                          type="button"
                                          onClick={() => handleReleaseProductionOrder(order.id)}
                                          className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                                        >
                                          Rel
                                        </button>
                                      ) : null}
                                      {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' ? (
                                        <button
                                          type="button"
                                          onClick={() => handleCompleteProductionOrder(order.id, { completionDate: order.completionDate || order.dueDate || order.startDate })}
                                          className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                                        >
                                          Done
                                        </button>
                                      ) : null}
                                      {order.status !== 'COMPLETED' ? (
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteProductionOrder(order.id)}
                                          className="rounded border border-red-100 p-1 text-red-600 hover:bg-red-50"
                                          title="Xóa"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {productionOrderRows.length === 0 ? (
                                <tr>
                                  <td colSpan={8} className="px-2 py-8 text-center text-[13px] text-slate-400">
                                    Chưa có lệnh sản xuất nào.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-sm text-slate-400 shadow-sm">
              Chọn một BOM ở panel trái hoặc tạo version mới để bắt đầu.
            </div>
          )}
        </div>
      </div>

      {productionDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  {productionDraft.id ? 'Cập nhật lệnh sản xuất' : 'Tạo lệnh sản xuất'}
                </h3>
                <p className="text-sm text-slate-500">
                  Xuất NVL từ kho nguồn và nhập thành phẩm về kho đích khi hoàn thành lệnh.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProductionDraft(null)}
                className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid gap-4 lg:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Số LSX</label>
                  <input
                    value={productionDraft.orderNumber || previewDocumentNumber('LSX', productionDraft.startDate)}
                    readOnly
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Thành phẩm</label>
                  <input
                    value={`${productionDraft.parentItemSku || productionDraft.parentItemId} - ${productionDraft.parentItemName || ''}`}
                    readOnly
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">BOM</label>
                  <input
                    value={productionDraft.bomVersionCode || 'BOM'}
                    readOnly
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Trạng thái</label>
                  <div className="flex h-11 items-center">
                    <span className={`rounded-full border px-3 py-2 text-xs font-semibold ${productionStatusClass(productionDraft.status)}`}>
                      {productionDraft.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Số lượng sản xuất</label>
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    value={productionDraft.quantity}
                    onChange={(event) => updateProductionDraft({ quantity: Number(event.target.value || 0) })}
                    className="h-11 w-full rounded-xl border border-slate-300 px-3 text-right text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Ngày bắt đầu</label>
                  <input
                    type="date"
                    value={productionDraft.startDate || ''}
                    onChange={(event) => updateProductionDraft({ startDate: event.target.value })}
                    className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Ngày dự kiến xong</label>
                  <input
                    type="date"
                    value={productionDraft.dueDate || ''}
                    onChange={(event) => updateProductionDraft({ dueDate: event.target.value })}
                    className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Ngày hoàn thành</label>
                  <input
                    type="date"
                    value={productionDraft.completionDate || ''}
                    onChange={(event) => updateProductionDraft({ completionDate: event.target.value })}
                    className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Kho xuất NVL</label>
                  <select
                    value={productionDraft.sourceWarehouseId || defaultWarehouseId}
                    onChange={(event) => updateProductionDraft({ sourceWarehouseId: event.target.value })}
                    className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  >
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Kho nhập thành phẩm</label>
                  <select
                    value={productionDraft.targetWarehouseId || defaultWarehouseId}
                    onChange={(event) => updateProductionDraft({ targetWarehouseId: event.target.value })}
                    className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  >
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Kết quả tính giá</label>
                  <div className="flex h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
                    {formatCurrency(productionDraft.totalPlannedCost || 0)} / {formatQty(productionDraft.quantity || 0)}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tổng planned cost</p>
                  <p className="mt-2 text-xl font-bold text-slate-800">
                    {formatCurrency(productionDraft.totalPlannedCost || productionDraft.output.totalCost || 0)}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unit cost</p>
                  <p className="mt-2 text-xl font-bold text-slate-800">
                    {formatCurrency(productionDraft.unitPlannedCost || productionDraft.output.unitCost || 0)}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Thiếu vật tư</p>
                  <p className={`mt-2 text-xl font-bold ${(productionDraft.shortageCount || 0) > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {productionDraft.shortageCount || 0} dòng
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Ghi chú lệnh sản xuất</label>
                <textarea
                  value={productionDraft.note || ''}
                  onChange={(event) => updateProductionDraft({ note: event.target.value })}
                  rows={3}
                  className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Ví dụ: lệnh sản xuất theo kế hoạch tuần, ưu tiên giao khách hàng A..."
                />
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <h4 className="font-semibold text-slate-800">Vật tư tiêu hao theo BOM</h4>
                    <p className="text-xs text-slate-500">
                      Actual Qty có thể chỉnh trước khi complete. Cột tồn kho lấy theo kho nguồn đã chọn.
                    </p>
                  </div>
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    {productionDraft.materials.length} dòng NVL
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1280px] text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Vật tư</th>
                        <th className="px-4 py-3 text-left">Kho nguồn</th>
                        <th className="px-4 py-3 text-right">Required</th>
                        <th className="px-4 py-3 text-right">Available</th>
                        <th className="px-4 py-3 text-right">Actual</th>
                        <th className="px-4 py-3 text-left">154</th>
                        <th className="px-4 py-3 text-left">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {productionDraft.materials.map((line) => {
                        const availableQuantity = getWarehouseQuantity(
                          itemMap.get(line.itemId),
                          productionDraft.sourceWarehouseId,
                          defaultWarehouseId,
                        );
                        const isShort = availableQuantity + 1e-6 < Math.max(Number(line.actualQuantity || 0), Number(line.requiredQuantity || 0));
                        return (
                          <tr key={line.id}>
                            <td className="px-4 py-3">
                              <div className="font-semibold text-slate-800">
                                {line.itemSku || line.itemId} - {line.itemName}
                              </div>
                              <div className="text-xs text-slate-500">ĐVT: {line.unit || itemMap.get(line.itemId)?.unit || '---'}</div>
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {productionDraft.sourceWarehouseName || productionDraft.sourceWarehouseId}
                            </td>
                            <td className="px-4 py-3 text-right">{formatQty(line.requiredQuantity)}</td>
                            <td className={`px-4 py-3 text-right font-semibold ${isShort ? 'text-red-600' : 'text-slate-800'}`}>
                              {formatQty(availableQuantity)}
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={line.actualQuantity}
                                onChange={(event) =>
                                  updateProductionDraftMaterial(line.id, { actualQuantity: Number(event.target.value || 0) })
                                }
                                className="h-10 w-full rounded-xl border border-slate-300 px-3 text-right text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                              />
                            </td>
                            <td className="px-4 py-3 text-slate-600">{getBom154CategoryLabel(line.bomComponentCategory)}</td>
                            <td className="px-4 py-3">
                              <input
                                value={line.note || ''}
                                onChange={(event) => updateProductionDraftMaterial(line.id, { note: event.target.value })}
                                className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                                placeholder="Ghi chú vật tư"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <div className="text-sm text-slate-500">
                Thành phẩm nhập kho: <span className="font-semibold text-slate-700">{formatQty(productionDraft.output.quantity)}</span> ·{' '}
                {productionDraft.output.itemSku || productionDraft.output.itemId}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setProductionDraft(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={saveProductionDraft}
                  className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                >
                  Lưu LSX
                </button>
                {productionDraft.id && productionDraft.status === 'DRAFT' ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleReleaseProductionOrder(productionDraft.id);
                      setProductionDraft(null);
                    }}
                    className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    Release
                  </button>
                ) : null}
                {productionDraft.id && productionDraft.status !== 'COMPLETED' && productionDraft.status !== 'CANCELLED' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const completionDate = productionDraft.completionDate || productionDraft.dueDate || productionDraft.startDate;
                      const ok = handleCompleteProductionOrder(productionDraft.id, { completionDate });
                      if (ok) setProductionDraft(null);
                    }}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    <CheckCircle2 className="mr-1 inline h-4 w-4" /> Complete
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-[min(960px,98vw)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-base font-bold text-slate-800">
                  {draft.id ? 'Cập nhật / clone version BOM' : 'Tạo version BOM mới'}
                </h3>
                <span
                  className="group relative inline-flex shrink-0"
                  title="Approved version không sửa trực tiếp; mọi thay đổi cấu trúc phải clone sang version mới."
                >
                  <Info className="h-3.5 w-3.5 cursor-help text-slate-400 hover:text-slate-600" aria-hidden />
                  <span className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-1 w-64 -translate-x-1/2 rounded border border-slate-200 bg-white px-2 py-1.5 text-left text-[11px] font-normal leading-snug text-slate-600 shadow-lg group-hover:visible">
                    Approved version không sửa trực tiếp; mọi thay đổi cấu trúc phải clone sang version mới.
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="min-w-0 lg:col-span-1">
                  <label className="mb-0.5 block text-[12px] font-medium text-slate-600">Sản phẩm / dịch vụ cha</label>
                  <select
                    value={draft.parentItemId}
                    onChange={(event) => {
                      const parentItemId = event.target.value;
                      const versionNumber = parentItemId
                        ? nextVersionNumberForParent(parentItemId, draft.id || undefined)
                        : 1;
                      updateDraft({
                        parentItemId,
                        versionNumber,
                        versionCode: `V${versionNumber}`,
                      });
                    }}
                    className="h-9 w-full rounded border border-slate-300 px-2 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/25"
                  >
                    <option value="">-- Chọn mã cha --</option>
                    {allItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.sku} - {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[12px] font-medium text-slate-600">Version</label>
                  <input
                    type="number"
                    min="1"
                    value={draft.versionNumber || 1}
                    onChange={(event) => {
                      const versionNumber = Math.max(1, Number(event.target.value || 1));
                      updateDraft({
                        versionNumber,
                        versionCode: `V${versionNumber}`,
                      });
                    }}
                    className="h-9 w-full rounded border border-slate-300 px-2 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/25"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[12px] font-medium text-slate-600">Ngày hiệu lực</label>
                  <input
                    type="date"
                    value={draft.effectiveDate || ''}
                    onChange={(event) => updateDraft({ effectiveDate: event.target.value })}
                    className="h-9 w-full rounded border border-slate-300 px-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/25"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[12px] font-medium text-slate-600">Ngày hết hiệu lực</label>
                  <input
                    type="date"
                    value={draft.expiryDate || ''}
                    onChange={(event) => updateDraft({ expiryDate: event.target.value })}
                    className="h-9 w-full rounded border border-slate-300 px-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/25"
                  />
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-3">
                <div>
                  <label className="mb-0.5 block text-[12px] font-medium text-slate-600">Phương pháp giá mặc định</label>
                  <select
                    value={draft.defaultCostMethod || 'STANDARD'}
                    onChange={(event) => updateDraft({ defaultCostMethod: event.target.value as BomCostMethod })}
                    className="h-9 w-full rounded border border-slate-300 px-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/25"
                  >
                    <option value="STANDARD">Giá chuẩn</option>
                    <option value="ACTUAL">Giá thực tế</option>
                    <option value="AVERAGE">Giá bình quân</option>
                  </select>
                </div>
                <div className="min-w-0">
                  <label className="mb-0.5 block text-[12px] font-medium text-slate-600">Tóm tắt thay đổi</label>
                  <textarea
                    value={draft.changeSummary || ''}
                    onChange={(event) => {
                      updateDraft({ changeSummary: event.target.value });
                      const el = event.target;
                      el.style.height = 'auto';
                      el.style.height = `${Math.min(Math.max(el.scrollHeight, 36), 160)}px`;
                    }}
                    rows={1}
                    placeholder="Ví dụ: thêm module, đổi vendor, điều chỉnh loss..."
                    className="min-h-[36px] max-h-40 w-full resize-none overflow-y-auto rounded border border-slate-300 px-2 py-1.5 text-sm leading-snug outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/25"
                  />
                </div>
                <div className="min-w-0">
                  <label className="mb-0.5 block text-[12px] font-medium text-slate-600">Ghi chú BOM</label>
                  <textarea
                    value={draft.note || ''}
                    onChange={(event) => {
                      updateDraft({ note: event.target.value });
                      const el = event.target;
                      el.style.height = 'auto';
                      el.style.height = `${Math.min(Math.max(el.scrollHeight, 36), 160)}px`;
                    }}
                    rows={1}
                    placeholder="Phạm vi version, đối tượng SX, ghi chú giá thành..."
                    className="min-h-[36px] max-h-40 w-full resize-none overflow-y-auto rounded border border-slate-300 px-2 py-1.5 text-sm leading-snug outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/25"
                  />
                </div>
              </div>

              <div className="mt-3 flex w-full flex-col overflow-hidden rounded border border-slate-200 bg-white">
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/90 px-3 py-2">
                  <h4 className="text-sm font-semibold text-slate-800">Chi tiết định mức cấu thành</h4>
                  <span className="group relative inline-flex shrink-0">
                    <Info className="h-3.5 w-3.5 cursor-help text-slate-400" aria-hidden />
                    <span className="pointer-events-none invisible absolute bottom-full left-0 z-30 mb-1 w-72 max-w-[85vw] rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-normal leading-snug text-slate-600 shadow-lg group-hover:visible">
                      Component có thể là bán thành phẩm hoặc NVL cuối. Dòng có NVL trực tiếp + TK 152/153/156 được coi là Auto Stock.
                    </span>
                  </span>
                </div>
                <div className="max-h-[min(520px,52vh)] overflow-auto overscroll-contain">
                  <table className="w-full table-fixed border-collapse text-sm">
                    <colgroup>
                      <col className="min-w-0 w-[35%]" />
                      <col className="min-w-0 w-[15%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[5%]" />
                      <col className="w-[15%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/95 text-[12px] font-semibold uppercase tracking-wide text-slate-600">
                        <th className="px-2 py-2 text-left align-bottom" rowSpan={2}>
                          Component
                        </th>
                        <th className="px-2 py-2 text-left align-bottom" rowSpan={2}>
                          Phân loại
                        </th>
                        <th className="border-x border-slate-200/90 px-1 py-1.5 text-center" colSpan={3}>
                          SL / Hao hụt
                        </th>
                        <th className="px-1 py-2 text-center align-bottom" rowSpan={2} title="Theo NVL + TK kho (152/153/156)">
                          Auto
                        </th>
                        <th className="px-2 py-2 text-center align-bottom" rowSpan={2}>
                          Thao tác
                        </th>
                      </tr>
                      <tr className="border-b border-slate-200 bg-slate-50/95 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <th className="w-[10%] whitespace-nowrap border-l border-slate-200/90 px-1 py-1.5 text-right">
                          Qty
                        </th>
                        <th className="w-[10%] whitespace-nowrap px-1 py-1.5 text-right">Loss %</th>
                        <th className="w-[10%] whitespace-nowrap border-r border-slate-200/90 px-1 py-1.5 text-right">
                          Loss Qty
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {(draft.components || []).map((component) => {
                        const componentItem = itemMap.get(component.componentItemId);
                        const autoStock = isStockTrackedBomComponent(component, componentItem);
                        const filteredItems = allItems
                          .filter((item) => item.id !== draft.parentItemId)
                          .filter((item) => {
                            const q = bomItemPickerQuery.trim().toLowerCase();
                            if (!q) return true;
                            return `${item.sku || ''} ${item.name || ''}`.toLowerCase().includes(q);
                          })
                          .slice(0, 80);
                        const bomInp =
                          'h-9 min-h-[40px] w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-right text-sm tabular-nums text-slate-800 outline-none transition-colors hover:bg-slate-50/90 focus:border-slate-300 focus:bg-white focus:ring-1 focus:ring-slate-200/80';
                        const bomSel =
                          'h-9 min-h-[40px] w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-[11px] text-slate-800 outline-none transition-colors hover:bg-slate-50/90 focus:border-slate-300 focus:bg-white focus:ring-1 focus:ring-slate-200/80';
                        return (
                          <React.Fragment key={component.id}>
                            <tr className="align-middle [&:hover]:bg-slate-50/40">
                              <td className="min-w-0 px-2 py-1">
                                <div className="relative" ref={bomItemPickerLineId === component.id ? bomItemPickerRef : undefined}>
                                  {component.componentItemId && componentItem ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setBomItemPickerLineId(component.id);
                                        setBomItemPickerQuery('');
                                      }}
                                      className="min-h-[40px] w-full rounded border border-transparent px-0.5 py-1 text-left transition-colors hover:bg-slate-50 focus:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-200/80"
                                    >
                                      <div className="truncate text-sm font-semibold text-slate-900">{componentItem.name || '—'}</div>
                                      <div className="truncate text-[11px] text-slate-500">
                                        {componentItem.sku || '—'} · {componentItem.unit || '—'}
                                      </div>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setBomItemPickerLineId(component.id);
                                        setBomItemPickerQuery('');
                                      }}
                                      className="min-h-[40px] w-full rounded border border-dashed border-slate-200 px-2 py-1.5 text-left text-xs text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                                    >
                                      Chọn vật tư…
                                    </button>
                                  )}
                                  {bomItemPickerLineId === component.id ? (
                                    <div className="absolute left-0 top-full z-40 mt-1 w-[min(100%,min(320px,70vw))] rounded border border-slate-200 bg-white shadow-lg">
                                      <input
                                        type="search"
                                        value={bomItemPickerQuery}
                                        onChange={(e) => setBomItemPickerQuery(e.target.value)}
                                        placeholder="Tìm SKU, tên…"
                                        className="w-full border-b border-slate-100 px-2 py-2 text-sm outline-none focus:ring-1 focus:ring-slate-200"
                                        autoFocus
                                      />
                                      <ul className="max-h-48 overflow-auto py-1 text-sm">
                                        {filteredItems.length === 0 ? (
                                          <li className="px-4 py-3 text-left text-xs text-slate-400">Không có kết quả.</li>
                                        ) : (
                                          filteredItems.map((item) => (
                                            <li key={item.id}>
                                              <button
                                                type="button"
                                                className="w-full px-3 py-2 text-left hover:bg-slate-50"
                                                onClick={() => {
                                                  updateComponent(component.id, { componentItemId: item.id });
                                                  setBomItemPickerLineId(null);
                                                  setBomItemPickerQuery('');
                                                }}
                                              >
                                                <span className="block truncate font-medium text-slate-800">{item.name}</span>
                                                <span className="block truncate text-[11px] text-slate-500">
                                                  {item.sku} · {item.unit || '—'}
                                                </span>
                                              </button>
                                            </li>
                                          ))
                                        )}
                                      </ul>
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                              <td className="min-w-0 px-1 py-1">
                                <select
                                  value={component.account154Category}
                                  onChange={(event) =>
                                    updateComponent(component.id, {
                                      account154Category: event.target.value as BomComponentLine['account154Category'],
                                    })
                                  }
                                  className={bomSel}
                                >
                                  {BOM_154_CATEGORY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="border-l border-slate-100 px-0.5 py-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.000001"
                                  value={component.quantity}
                                  onChange={(event) =>
                                    updateComponent(component.id, { quantity: Number(event.target.value || 0) })
                                  }
                                  className={bomInp}
                                />
                              </td>
                              <td className="px-0.5 py-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={component.lossRate}
                                  onChange={(event) =>
                                    updateComponent(component.id, { lossRate: Number(event.target.value || 0) })
                                  }
                                  className={bomInp}
                                />
                              </td>
                              <td className="border-r border-slate-100 px-0.5 py-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.000001"
                                  value={component.lossQuantity || 0}
                                  onChange={(event) =>
                                    updateComponent(component.id, { lossQuantity: Number(event.target.value || 0) })
                                  }
                                  className={bomInp}
                                />
                              </td>
                              <td className="px-0.5 py-1 text-center">
                                <input
                                  type="checkbox"
                                  disabled
                                  checked={autoStock}
                                  title={
                                    autoStock
                                      ? 'Auto Stock: NVL trực tiếp + TK kho theo dõi tồn'
                                      : 'Không auto stock theo quy tắc kho hiện tại'
                                  }
                                  className="h-4 w-4 cursor-not-allowed rounded border-slate-300 accent-slate-600 opacity-90"
                                />
                              </td>
                              <td className="px-1 py-1">
                                <div className="flex min-h-[40px] items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    aria-label={component.note?.trim() ? 'Sửa ghi chú component' : 'Thêm ghi chú component'}
                                    onClick={() =>
                                      setBomLineNoteEditId((id) => (id === component.id ? null : component.id))
                                    }
                                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                  >
                                    <StickyNote
                                      className={`h-4 w-4 ${component.note?.trim() ? 'text-emerald-600' : ''}`}
                                      strokeWidth={component.note?.trim() ? 2.25 : 1.75}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Xóa dòng"
                                    onClick={() => removeComponent(component.id)}
                                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {bomLineNoteEditId === component.id ? (
                              <tr className="bg-slate-50/90">
                                <td colSpan={7} className="border-t border-slate-100 px-3 py-2">
                                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Ghi chú component</label>
                                  <textarea
                                    value={component.note || ''}
                                    onChange={(event) => updateComponent(component.id, { note: event.target.value })}
                                    rows={2}
                                    placeholder="Ghi chú cho dòng component này…"
                                    className="min-h-[36px] w-full max-w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-200"
                                  />
                                </td>
                              </tr>
                            ) : null}
                          </React.Fragment>
                        );
                      })}
                      <tr>
                        <td
                          colSpan={7}
                          className="cursor-pointer border-t border-dashed border-slate-200 bg-slate-50/40 py-2.5 text-center text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                          onClick={addComponent}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              addComponent();
                            }
                          }}
                        >
                          <Plus className="mr-1 inline h-3.5 w-3.5 align-text-bottom" /> Click để thêm dòng mới
                        </td>
                      </tr>
                      <tr className="border-t border-slate-200 bg-slate-50/90 text-[12px] font-semibold text-slate-700">
                        <td colSpan={2} className="px-2 py-2 text-left align-middle text-[11px] uppercase tracking-wide text-slate-500">
                          Tổng cộng
                        </td>
                        <td className="border-l border-slate-200/90 px-1 py-2 text-right tabular-nums">{formatQty(bomDraftTotals.sumQty)}</td>
                        <td className="px-1 py-2 text-center text-slate-400">—</td>
                        <td className="border-r border-slate-200/90 px-1 py-2 text-right tabular-nums">
                          {formatQty(bomDraftTotals.sumLossQty)}
                        </td>
                        <td className="px-1 py-2 text-center text-[11px] font-normal text-slate-500">
                          {bomDraftTotals.filled}/{bomDraftTotals.lineCount} dòng
                        </td>
                        <td className="px-2 py-2 text-center text-slate-400">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded border border-transparent px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={() => saveDraft('DRAFT')}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Lưu draft
                </button>
                <button
                  type="button"
                  onClick={() => saveDraft('APPROVED')}
                  className="rounded bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700"
                >
                  <CheckCircle2 className="mr-1 inline h-4 w-4" /> Save & Approve
                </button>
              </div>
              <p className="mt-1 text-right text-[11px] leading-snug text-slate-500">
                Version lưu nháp để soạn thảo; bấm <b>Approve</b> để dùng cho sản xuất và tự Obsolete các version approved
                trước đó cùng mã cha.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
