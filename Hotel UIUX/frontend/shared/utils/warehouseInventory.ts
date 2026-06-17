import type {
  InventoryItem,
  InventoryWarehouseBalance,
  SerialInfo,
  Warehouse,
} from '../types';

export const DEFAULT_WAREHOUSE_ID = 'WH-DEFAULT';
export const DEFAULT_WAREHOUSE_CODE = 'KHO-TONG';
export const DEFAULT_WAREHOUSE_NAME = 'Kho tong';

const uniqueStrings = (values: string[]) => Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));

const cloneSerialDetails = (details?: SerialInfo[]) => (details || []).map((detail) => ({ ...detail }));

export function createDefaultWarehouse(): Warehouse {
  return {
    id: DEFAULT_WAREHOUSE_ID,
    code: DEFAULT_WAREHOUSE_CODE,
    name: DEFAULT_WAREHOUSE_NAME,
    address: '',
    isDefault: true,
  };
}

export function normalizeWarehouses(raw: Warehouse[] | undefined | null): Warehouse[] {
  const list = Array.isArray(raw)
    ? raw
        .map((warehouse) => ({
          ...warehouse,
          id: String(warehouse?.id || '').trim() || DEFAULT_WAREHOUSE_ID,
          code: String(warehouse?.code || '').trim() || DEFAULT_WAREHOUSE_CODE,
          name: String(warehouse?.name || '').trim() || DEFAULT_WAREHOUSE_NAME,
          address: String(warehouse?.address || '').trim() || undefined,
          isDefault: !!warehouse?.isDefault,
        }))
        .filter((warehouse) => warehouse.id && warehouse.code && warehouse.name)
    : [];
  if (list.length === 0) return [createDefaultWarehouse()];
  const defaultIndex = list.findIndex((warehouse) => warehouse.isDefault);
  if (defaultIndex >= 0) {
    return list.map((warehouse, index) => ({ ...warehouse, isDefault: index === defaultIndex }));
  }
  return list.map((warehouse, index) => ({ ...warehouse, isDefault: index === 0 }));
}

export function getDefaultWarehouse(warehouses: Warehouse[] | undefined | null): Warehouse {
  return normalizeWarehouses(warehouses).find((warehouse) => warehouse.isDefault) || createDefaultWarehouse();
}

export function getDefaultWarehouseId(warehouses: Warehouse[] | undefined | null): string {
  return getDefaultWarehouse(warehouses).id;
}

export function cloneWarehouseBalances(
  balances?: InventoryWarehouseBalance[],
): InventoryWarehouseBalance[] {
  return (balances || []).map((balance) => ({
    ...balance,
    serials: [...(balance.serials || [])],
    serialDetails: cloneSerialDetails(balance.serialDetails),
  }));
}

export function ensureWarehouseBalances(
  item: InventoryItem,
  defaultWarehouseId = DEFAULT_WAREHOUSE_ID,
): InventoryItem {
  const clonedBalances = cloneWarehouseBalances(item.warehouseBalances);
  if (clonedBalances.length > 0) {
    return rebuildItemTotalsFromWarehouseBalances({ ...item, warehouseBalances: clonedBalances });
  }
  const quantity = Number(item.quantity || 0);
  const serials = uniqueStrings([...(item.serials || [])]);
  const serialDetails = cloneSerialDetails(item.serialDetails);
  if (quantity <= 0 && serials.length === 0 && serialDetails.length === 0) {
    return { ...item, warehouseBalances: [] };
  }
  return rebuildItemTotalsFromWarehouseBalances({
    ...item,
    warehouseBalances: [
      {
        warehouseId: defaultWarehouseId,
        quantity: quantity > 0 ? quantity : serials.length,
        serials,
        serialDetails,
        updatedAt: new Date().toISOString(),
      },
    ],
  });
}

/**
 * Đổi mã kho nội bộ trên tồn theo kho (gộp nếu trùng kho đích).
 * Dùng khi xóa kho: chuyển toàn bộ tồn sang kho thay thế.
 */
export function remapWarehouseIdOnItem(
  item: InventoryItem,
  fromId: string,
  toId: string,
  defaultWarehouseId: string,
): InventoryItem {
  const from = String(fromId || '').trim();
  const to = String(toId || '').trim();
  if (!from || !to || from === to) return ensureWarehouseBalances(item, defaultWarehouseId);
  const balancesIn = cloneWarehouseBalances(item.warehouseBalances).map((b) =>
    String(b.warehouseId || '').trim() === from ? { ...b, warehouseId: to } : b,
  );
  const byId = new Map<string, InventoryWarehouseBalance>();
  for (const b of balancesIn) {
    const wid = String(b.warehouseId || '').trim() || defaultWarehouseId;
    const ex = byId.get(wid);
    if (!ex) {
      byId.set(wid, {
        ...b,
        warehouseId: wid,
        serials: uniqueStrings([...(b.serials || [])]),
        serialDetails: cloneSerialDetails(b.serialDetails),
      });
    } else {
      byId.set(wid, {
        ...ex,
        quantity: Number(ex.quantity || 0) + Number(b.quantity || 0),
        serials: uniqueStrings([...(ex.serials || []), ...(b.serials || [])]),
        serialDetails: [...cloneSerialDetails(ex.serialDetails), ...cloneSerialDetails(b.serialDetails)],
        updatedAt: b.updatedAt || ex.updatedAt,
      });
    }
  }
  return rebuildItemTotalsFromWarehouseBalances({
    ...item,
    warehouseBalances: Array.from(byId.values()),
  });
}

export function rebuildItemTotalsFromWarehouseBalances(item: InventoryItem): InventoryItem {
  const balances = cloneWarehouseBalances(item.warehouseBalances)
    .filter((balance) => String(balance.warehouseId || '').trim())
    .map((balance) => ({
      ...balance,
      warehouseId: String(balance.warehouseId || '').trim(),
      quantity: Number(balance.quantity || 0),
      serials: uniqueStrings([...(balance.serials || [])]),
      serialDetails: cloneSerialDetails(balance.serialDetails),
    }));
  const quantity = balances.reduce((sum, balance) => sum + Number(balance.quantity || 0), 0);
  const serials = uniqueStrings(balances.flatMap((balance) => balance.serials || []));
  const serialDetails = balances.flatMap((balance) => cloneSerialDetails(balance.serialDetails));
  return {
    ...item,
    quantity,
    serials,
    serialDetails,
    warehouseBalances: balances,
  };
}

export function getWarehouseBalance(
  item: InventoryItem,
  warehouseId: string | undefined,
  defaultWarehouseId = DEFAULT_WAREHOUSE_ID,
): InventoryWarehouseBalance {
  const normalized = ensureWarehouseBalances(item, defaultWarehouseId);
  const key = String(warehouseId || defaultWarehouseId).trim() || defaultWarehouseId;
  const found = (normalized.warehouseBalances || []).find((balance) => balance.warehouseId === key);
  if (found) {
    return {
      ...found,
      serials: [...(found.serials || [])],
      serialDetails: cloneSerialDetails(found.serialDetails),
    };
  }
  return {
    warehouseId: key,
    quantity: 0,
    serials: [],
    serialDetails: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getWarehouseQuantity(
  item: InventoryItem,
  warehouseId: string | undefined,
  defaultWarehouseId = DEFAULT_WAREHOUSE_ID,
): number {
  return Number(getWarehouseBalance(item, warehouseId, defaultWarehouseId).quantity || 0);
}

export function getWarehouseScopedItem(
  item: InventoryItem,
  warehouseId: string | undefined,
  defaultWarehouseId = DEFAULT_WAREHOUSE_ID,
): InventoryItem {
  const balance = getWarehouseBalance(item, warehouseId, defaultWarehouseId);
  return {
    ...ensureWarehouseBalances(item, defaultWarehouseId),
    quantity: Number(balance.quantity || 0),
    serials: [...(balance.serials || [])],
    serialDetails: cloneSerialDetails(balance.serialDetails),
  };
}

export function mapItemsToWarehouseScope(
  items: InventoryItem[],
  warehouseId: string | undefined,
  defaultWarehouseId = DEFAULT_WAREHOUSE_ID,
): InventoryItem[] {
  return (items || []).map((item) => getWarehouseScopedItem(item, warehouseId, defaultWarehouseId));
}

export function applyWarehouseBalanceChange(
  item: InventoryItem,
  params: {
    warehouseId: string;
    qtyDelta: number;
    addSerials?: string[];
    removeSerials?: string[];
    addSerialDetails?: SerialInfo[];
    removeSerialDetailsBySerial?: string[];
    updatedAt?: string;
    costPrice?: number;
  },
  defaultWarehouseId = DEFAULT_WAREHOUSE_ID,
): InventoryItem {
  const normalized = ensureWarehouseBalances(item, defaultWarehouseId);
  const key = String(params.warehouseId || defaultWarehouseId).trim() || defaultWarehouseId;
  const balances = cloneWarehouseBalances(normalized.warehouseBalances);
  const idx = balances.findIndex((balance) => balance.warehouseId === key);
  const current =
    idx >= 0
      ? balances[idx]
      : {
          warehouseId: key,
          quantity: 0,
          serials: [],
          serialDetails: [],
          updatedAt: params.updatedAt || new Date().toISOString(),
        };
  const removeSerials = new Set(uniqueStrings([...(params.removeSerials || []), ...(params.removeSerialDetailsBySerial || [])]));
  const nextSerials = uniqueStrings([
    ...(current.serials || []).filter((serial) => !removeSerials.has(serial)),
    ...(params.addSerials || []),
  ]);
  const nextSerialDetails = [
    ...(current.serialDetails || []).filter((detail) => !removeSerials.has(String(detail.serial || '').trim())),
    ...cloneSerialDetails(params.addSerialDetails),
  ];
  const nextBalance: InventoryWarehouseBalance = {
    warehouseId: key,
    quantity: Number(current.quantity || 0) + Number(params.qtyDelta || 0),
    serials: nextSerials,
    serialDetails: nextSerialDetails,
    updatedAt: params.updatedAt || new Date().toISOString(),
  };
  if (idx >= 0) balances[idx] = nextBalance;
  else balances.push(nextBalance);
  const nextItem = rebuildItemTotalsFromWarehouseBalances({
    ...normalized,
    ...(params.costPrice != null ? { costPrice: Number(params.costPrice || 0) } : {}),
    warehouseBalances: balances,
  });
  return nextItem;
}
