import {
  getDefaultDispatchConfig,
  normalizeDispatchConfig,
  type DispatchConfig,
} from './services/dispatchEngine';
import type {
  AdvanceRecord,
  CostRecord,
  Distributor,
  Order,
  Product,
  ReturnLog,
  SalaryRecord,
  Trip,
  Vehicle,
  WarehouseReceipt,
} from './types';

/**
 * Dữ liệu module Giao hàng (LogiSmart) — persist xuống SQLite qua PUT /api/state
 * dưới khóa `delivery`, đồng bộ realtime đa máy giống Hotel PMS.
 */
export type DeliveryPersistedState = {
  distributors: Distributor[];
  products: Product[];
  orders: Order[];
  vehicles: Vehicle[];
  trips: Trip[];
  costs: CostRecord[];
  advances: AdvanceRecord[];
  salaries: SalaryRecord[];
  warehouseReceipts: WarehouseReceipt[];
  returnLogs: ReturnLog[];
  dispatchConfig: DispatchConfig;
};

export function getDefaultDeliveryState(): DeliveryPersistedState {
  return {
    distributors: [],
    products: [],
    orders: [],
    vehicles: [],
    trips: [],
    costs: [],
    advances: [],
    salaries: [],
    warehouseReceipts: [],
    returnLogs: [],
    dispatchConfig: getDefaultDispatchConfig(),
  };
}

/** Dấu hiệu bộ seed cũ (constants.ts đã xóa) — xóa một lần khi đọc từ DB. */
function isLegacySeedDeliveryState(parsed: Partial<DeliveryPersistedState>): boolean {
  const dists = parsed.distributors ?? [];
  const products = parsed.products ?? [];
  const vehicles = parsed.vehicles ?? [];
  const orders = parsed.orders ?? [];
  const costs = parsed.costs ?? [];
  const advances = parsed.advances ?? [];
  return (
    dists.length === 4 &&
    products.length === 4 &&
    vehicles.length === 3 &&
    orders.length === 3 &&
    costs.length === 4 &&
    advances.length === 2 &&
    dists.some((d) => d.id === 'NPP01') &&
    vehicles.some((v) => v.id === 'V01') &&
    orders.some((o) => o.id === 'DH-1001')
  );
}

/**
 * Chuẩn hóa dữ liệu đọc từ server. Khi object hợp lệ → giữ nguyên các mảng
 * (tôn trọng cả mảng rỗng do người dùng đã xóa hết), chỉ điền [] cho khóa thiếu.
 * Chỉ trả về dữ liệu mặc định (rỗng) khi raw không hợp lệ hoặc còn seed cũ.
 */
export function normalizeDeliveryState(raw: unknown): DeliveryPersistedState {
  const parsed = raw as Partial<DeliveryPersistedState> | null | undefined;
  if (!parsed || typeof parsed !== 'object') {
    return getDefaultDeliveryState();
  }
  if (isLegacySeedDeliveryState(parsed)) {
    return getDefaultDeliveryState();
  }
  return {
    distributors: Array.isArray(parsed.distributors) ? parsed.distributors : [],
    products: Array.isArray(parsed.products) ? parsed.products : [],
    orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : [],
    trips: Array.isArray(parsed.trips) ? parsed.trips : [],
    costs: Array.isArray(parsed.costs) ? parsed.costs : [],
    advances: Array.isArray(parsed.advances) ? parsed.advances : [],
    salaries: Array.isArray(parsed.salaries) ? parsed.salaries : [],
    warehouseReceipts: Array.isArray(parsed.warehouseReceipts) ? parsed.warehouseReceipts : [],
    returnLogs: Array.isArray(parsed.returnLogs) ? parsed.returnLogs : [],
    dispatchConfig: normalizeDispatchConfig(parsed.dispatchConfig),
  };
}
