import { Order, Vehicle } from '../types';

/**
 * BỘ MÁY TỐI ƯU ĐIỀU PHỐI 5 TẦNG (Dispatch Optimization Engine)
 * -------------------------------------------------------------------
 * 1. Constraint Engine   — loại xe vi phạm tải trọng / CBM / pallet / chiều cao / hàng nguy hiểm / nhiệt độ.
 * 2. Scoring Engine      — chấm điểm GPS, tuyến, ETA, tỷ lệ lấp đầy, chi phí nhiên liệu, ưu tiên khách (SLA).
 * 3. 3D Bin Packing      — xếp từng kiện vào thùng (X,Y,Z + xoay), tính tỷ lệ lấp đầy thực tế.
 * 4. Load Balance Engine — trọng tâm (CGX/CGY/CGZ) + tải trọng trục, cảnh báo mất cân bằng.
 * 5. Rule Engine         — bộ quy tắc cấu hình được (bật/tắt, đổi trọng số) không cần sửa mã nguồn.
 *
 * Toàn bộ công thức (#1 → #21) được hiện thực dưới dạng hàm thuần, có thể tái sử dụng & kiểm thử.
 */

// ============================================================
// Hằng số ước lượng khi dữ liệu đầu vào thiếu
// ============================================================
const DEFAULT_DENSITY_KG_PER_CBM = 250; // ước lượng CBM từ trọng lượng
const DEFAULT_PALLET_CBM = 1.5; // 1 pallet ~ 1.5 m³
const DEFAULT_AVG_SPEED_KMH = 40;
const DEFAULT_FUEL_CONSUMPTION = 25; // L/100km
const DEFAULT_FUEL_PRICE = 22000; // đồng/L
const CG_UNSAFE_THRESHOLD = 0.3; // lệch > 30% trọng tâm => Unsafe Loading

// ============================================================
// Thuật toán cho phép người dùng chọn
// ============================================================
export type DispatchAlgorithm =
  | 'WEIGHT' // Theo tải trọng
  | 'CBM' // Theo CBM
  | 'PALLET' // Theo pallet
  | 'ROUTE' // Theo tuyến
  | 'GPS' // Theo GPS
  | 'ETA' // Theo ETA
  | 'PRIORITY' // Theo ưu tiên khách
  | 'COST' // Theo chi phí
  | 'AI_SCORE'; // Theo AI Score (khuyến nghị)

export const ALGORITHM_OPTIONS: { id: DispatchAlgorithm; label: string; desc: string }[] = [
  { id: 'AI_SCORE', label: 'AI Score (khuyến nghị)', desc: 'Tổng hợp có trọng số mọi tiêu chí' },
  { id: 'WEIGHT', label: 'Theo tải trọng', desc: 'Ưu tiên còn nhiều tải trọng' },
  { id: 'CBM', label: 'Theo CBM', desc: 'Ưu tiên còn nhiều thể tích' },
  { id: 'PALLET', label: 'Theo pallet', desc: 'Ưu tiên còn nhiều pallet' },
  { id: 'ROUTE', label: 'Theo tuyến', desc: 'Ưu tiên xe cùng tuyến' },
  { id: 'GPS', label: 'Theo GPS', desc: 'Ưu tiên xe gần điểm giao' },
  { id: 'ETA', label: 'Theo ETA', desc: 'Ưu tiên thời gian tới nhanh' },
  { id: 'PRIORITY', label: 'Theo ưu tiên khách', desc: 'Ưu tiên khách VIP/SLA' },
  { id: 'COST', label: 'Theo chi phí', desc: 'Ưu tiên xe tiết kiệm nhiên liệu' },
];

// Chiến lược xếp (bin packing strategy)
export type PackingStrategy = 'FIRST_FIT' | 'BEST_FIT' | 'WORST_FIT' | 'BFD';

export const PACKING_OPTIONS: { id: PackingStrategy; label: string }[] = [
  { id: 'BFD', label: 'Best Fit Decreasing (hiệu quả cao)' },
  { id: 'BEST_FIT', label: 'Best Fit (lấp đầy tối đa)' },
  { id: 'FIRST_FIT', label: 'First Fit (nhanh nhất)' },
  { id: 'WORST_FIT', label: 'Worst Fit (dàn đều)' },
];

// ============================================================
// Rule Engine — cấu hình quy tắc (lưu DB / store, bật tắt & đổi trọng số)
// ============================================================
export type DispatchRule = {
  id: string;
  label: string;
  /** Hard rule = ràng buộc loại trừ; số = trọng số tính điểm */
  weight: number | 'HARD';
  enabled: boolean;
};

export const DEFAULT_DISPATCH_RULES: DispatchRule[] = [
  { id: 'max_weight', label: 'Không vượt tải trọng', weight: 'HARD', enabled: true },
  { id: 'max_cbm', label: 'Không vượt CBM', weight: 'HARD', enabled: true },
  { id: 'max_pallet', label: 'Không vượt pallet', weight: 'HARD', enabled: true },
  { id: 'cooling', label: 'Đáp ứng hàng cần xe lạnh', weight: 'HARD', enabled: true },
  { id: 'dangerous', label: 'Đáp ứng hàng nguy hiểm', weight: 'HARD', enabled: true },
  { id: 'same_route', label: 'Cùng tuyến', weight: 20, enabled: true },
  { id: 'near_gps', label: 'Xe gần GPS', weight: 15, enabled: true },
  { id: 'vip', label: 'Khách VIP', weight: 10, enabled: true },
  { id: 'fuel', label: 'Xe tiết kiệm nhiên liệu', weight: 5, enabled: true },
  { id: 'fill_rate', label: 'Tỷ lệ lấp đầy xe', weight: 25, enabled: true },
  { id: 'load_balance', label: 'Cân bằng trọng tâm', weight: 25, enabled: true },
  { id: 'eta', label: 'ETA nhanh', weight: 10, enabled: true },
];

export type DispatchConfig = {
  algorithm: DispatchAlgorithm;
  packing: PackingStrategy;
  rules: DispatchRule[];
};

export function getDefaultDispatchConfig(): DispatchConfig {
  return {
    algorithm: 'AI_SCORE',
    packing: 'BFD',
    rules: DEFAULT_DISPATCH_RULES.map((r) => ({ ...r })),
  };
}

export function normalizeDispatchConfig(raw: unknown): DispatchConfig {
  const def = getDefaultDispatchConfig();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Partial<DispatchConfig>;
  const validAlgo = ALGORITHM_OPTIONS.some((a) => a.id === r.algorithm);
  const validPack = PACKING_OPTIONS.some((p) => p.id === r.packing);
  // Giữ trọng số/bật-tắt người dùng đã lưu, nhưng đảm bảo đủ rule mặc định.
  const savedRules = Array.isArray(r.rules) ? r.rules : [];
  const rules = DEFAULT_DISPATCH_RULES.map((base) => {
    const saved = savedRules.find((s) => s && s.id === base.id);
    if (!saved) return { ...base };
    return {
      ...base,
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : base.enabled,
      weight: base.weight === 'HARD' ? 'HARD' : (typeof saved.weight === 'number' ? saved.weight : base.weight),
    };
  });
  return {
    algorithm: validAlgo ? (r.algorithm as DispatchAlgorithm) : def.algorithm,
    packing: validPack ? (r.packing as PackingStrategy) : def.packing,
    rules,
  };
}

// ============================================================
// Ước lượng chỉ số đơn hàng & xe (dùng field thật nếu có)
// ============================================================
export type OrderMetrics = {
  id: string;
  weight: number;
  cbm: number;
  pallets: number;
  priority: number; // 1-5
  isVip: boolean;
  fragile: boolean;
  requiresCooling: boolean;
  isDangerous: boolean;
  distanceKm: number;
  density: number; // kg/m³ (#5)
};

export function deriveOrderMetrics(order: Order): OrderMetrics {
  const weight = Number(order.totalWeight) || 0;
  const cbm = order.cbm && order.cbm > 0 ? order.cbm : Math.max(weight / DEFAULT_DENSITY_KG_PER_CBM, 0.01);
  const pallets = order.pallets && order.pallets > 0 ? order.pallets : Math.max(1, Math.ceil(cbm / DEFAULT_PALLET_CBM));
  return {
    id: order.id,
    weight,
    cbm,
    pallets,
    priority: Math.min(5, Math.max(1, Number(order.priority) || (order.isVip ? 5 : 3))),
    isVip: !!order.isVip,
    fragile: !!order.fragile,
    requiresCooling: !!order.requiresCooling,
    isDangerous: !!order.isDangerous,
    distanceKm: order.distanceKm && order.distanceKm > 0 ? order.distanceKm : 0,
    density: density(weight, cbm),
  };
}

export type VehicleMetrics = {
  id: string;
  weightCap: number;
  cbmCap: number;
  palletCap: number;
  frontAxleMax: number;
  rearAxleMax: number;
  cooling: boolean;
  allowDangerous: boolean;
  fuelConsumption: number;
  fuelPrice: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export function deriveVehicleMetrics(vehicle: Vehicle): VehicleMetrics {
  const weightCap = Number(vehicle.capacityKg) || 0;
  const cbmCap =
    vehicle.volumeCapacityCbm && vehicle.volumeCapacityCbm > 0
      ? vehicle.volumeCapacityCbm
      : Math.max(weightCap / DEFAULT_DENSITY_KG_PER_CBM, 1);
  const palletCap =
    vehicle.palletCapacity && vehicle.palletCapacity > 0
      ? vehicle.palletCapacity
      : Math.max(1, Math.floor(cbmCap / DEFAULT_PALLET_CBM));
  // Kích thước thùng — ước lượng từ CBM nếu thiếu (giả định tỷ lệ 2.5 : 1 : 1.1 m)
  let lengthCm = vehicle.cargoLengthCm || 0;
  let widthCm = vehicle.cargoWidthCm || 0;
  let heightCm = vehicle.cargoHeightCm || 0;
  if (!(lengthCm > 0 && widthCm > 0 && heightCm > 0)) {
    const base = Math.cbrt((cbmCap * 1_000_000) / (2.5 * 1.0 * 1.1)); // cm
    lengthCm = Math.round(base * 2.5);
    widthCm = Math.round(base * 1.0);
    heightCm = Math.round(base * 1.1);
  }
  return {
    id: vehicle.id,
    weightCap,
    cbmCap,
    palletCap,
    frontAxleMax: vehicle.frontAxleMaxKg && vehicle.frontAxleMaxKg > 0 ? vehicle.frontAxleMaxKg : weightCap * 0.45,
    rearAxleMax: vehicle.rearAxleMaxKg && vehicle.rearAxleMaxKg > 0 ? vehicle.rearAxleMaxKg : weightCap * 0.6,
    cooling: !!vehicle.cooling,
    allowDangerous: !!vehicle.allowDangerousGoods,
    fuelConsumption: vehicle.fuelConsumption && vehicle.fuelConsumption > 0 ? vehicle.fuelConsumption : DEFAULT_FUEL_CONSUMPTION,
    fuelPrice: vehicle.fuelPrice && vehicle.fuelPrice > 0 ? vehicle.fuelPrice : DEFAULT_FUEL_PRICE,
    lengthCm,
    widthCm,
    heightCm,
  };
}

// ============================================================
// CÔNG THỨC #1 → #16 (hàm thuần)
// ============================================================
// #1 Weight First
export const remainingWeight = (truckCap: number, loaded: number) => truckCap - loaded;
export const fitsWeight = (truckCap: number, loaded: number, orderWeight: number) =>
  remainingWeight(truckCap, loaded) >= orderWeight;

// #2 CBM First
export const cbmOf = (lengthCm: number, widthCm: number, heightCm: number) =>
  (lengthCm * widthCm * heightCm) / 1_000_000; // cm³ → m³
export const remainingCbm = (truckCbm: number, loadedCbm: number) => truckCbm - loadedCbm;
export const fitsCbm = (truckCbm: number, loadedCbm: number, orderCbm: number) =>
  remainingCbm(truckCbm, loadedCbm) >= orderCbm;

// #3 Pallet
export const remainingPallet = (truckPallet: number, loadedPallet: number) => truckPallet - loadedPallet;

// #4 Load Factor = MAX(weight%, volume%)
export const loadFactor = (loadedWeight: number, truckWeight: number, loadedCbm: number, truckCbm: number) => {
  const w = truckWeight > 0 ? loadedWeight / truckWeight : 0;
  const v = truckCbm > 0 ? loadedCbm / truckCbm : 0;
  return Math.max(w, v);
};

// #5 Density
export const density = (weight: number, cbm: number) => (cbm > 0 ? weight / cbm : 0);

// #6 Fill Rate
export const fillRate = (usedVolume: number, totalVolume: number) =>
  totalVolume > 0 ? usedVolume / totalVolume : 0;

// #7 Space Optimization
export const emptySpace = (truckVolume: number, loadedVolume: number) => truckVolume - loadedVolume;

// #14 Route / Distance Score
export const distanceScore = (distanceKm: number) => (distanceKm > 0 ? 1 / distanceKm : 1);

// #15 ETA
export const eta = (distanceKm: number, avgSpeed = DEFAULT_AVG_SPEED_KMH) =>
  avgSpeed > 0 ? distanceKm / avgSpeed : 0;

// #16 Fuel Cost
export const fuelCost = (distanceKm: number, consumptionPer100: number, fuelPrice: number) =>
  (distanceKm / 100) * consumptionPer100 * fuelPrice;

// Haversine — khoảng cách 2 điểm GPS (km)
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================
// TẦNG 3 — 3D BIN PACKING (#19) + xếp theo lớp, cho phép xoay
// ============================================================
export type PackBox = {
  id: string;
  l: number;
  w: number;
  h: number;
  weight: number;
  fragile: boolean;
};

export type Placement = {
  id: string;
  x: number;
  y: number;
  z: number;
  l: number;
  w: number;
  h: number;
  weight: number;
};

export type PackResult = {
  placements: Placement[];
  unplaced: string[];
  usedVolumeCbm: number;
  containerCbm: number;
  fillRatePct: number; // #6
};

/**
 * 3D Bin Packing đơn giản hoá theo lớp (shelf/layer first-fit), cho phép xoay quanh trục đứng.
 * Trả về toạ độ (x,y,z) từng kiện để tính trọng tâm.
 */
export function pack3D(boxes: PackBox[], containerCm: { l: number; w: number; h: number }): PackResult {
  const placements: Placement[] = [];
  const unplaced: string[] = [];
  const { l: CL, w: CW, h: CH } = containerCm;

  // Con trỏ vị trí xếp
  let cursorX = 0; // dọc chiều dài
  let cursorY = 0; // ngang chiều rộng
  let cursorZ = 0; // chiều cao (lớp)
  let rowMaxW = 0; // bề rộng lớn nhất hàng hiện tại (theo trục Y)
  let layerMaxH = 0; // cao nhất của lớp hiện tại

  for (const box of boxes) {
    // Thử hướng gốc & xoay 90° quanh trục đứng (l<->w)
    const orientations = [
      { l: box.l, w: box.w, h: box.h },
      { l: box.w, w: box.l, h: box.h },
    ];

    let placed = false;
    for (const o of orientations) {
      if (o.l > CL || o.w > CW || o.h > CH) continue; // không vừa container theo hướng này

      // Hết chiều rộng hàng → xuống hàng mới (tăng X)
      if (cursorY + o.w > CW) {
        cursorX += rowMaxW; // thực ra dịch theo trục dài
        cursorY = 0;
        rowMaxW = 0;
      }
      // Hết chiều dài → lên lớp mới (tăng Z)
      if (cursorX + o.l > CL) {
        cursorZ += layerMaxH;
        cursorX = 0;
        cursorY = 0;
        rowMaxW = 0;
        layerMaxH = 0;
      }
      // Vượt chiều cao container → không xếp được
      if (cursorZ + o.h > CH) break;

      placements.push({
        id: box.id,
        x: cursorX,
        y: cursorY,
        z: cursorZ,
        l: o.l,
        w: o.w,
        h: o.h,
        weight: box.weight,
      });
      cursorY += o.w;
      rowMaxW = Math.max(rowMaxW, o.l);
      layerMaxH = Math.max(layerMaxH, o.h);
      placed = true;
      break;
    }
    if (!placed) unplaced.push(box.id);
  }

  const usedVolumeCbm = placements.reduce((s, p) => s + cbmOf(p.l, p.w, p.h), 0);
  const containerCbm = cbmOf(CL, CW, CH);
  return {
    placements,
    unplaced,
    usedVolumeCbm,
    containerCbm,
    fillRatePct: Math.round(fillRate(usedVolumeCbm, containerCbm) * 100),
  };
}

// Quy đổi 1 đơn hàng thành 1 kiện đại diện (từ CBM) để xếp & tính trọng tâm
function orderToBox(m: OrderMetrics): PackBox {
  const side = Math.cbrt(m.cbm * 1_000_000); // cm (giả định khối lập phương)
  return { id: m.id, l: Math.round(side), w: Math.round(side), h: Math.round(side), weight: m.weight, fragile: m.fragile };
}

// ============================================================
// TẦNG 4 — LOAD BALANCE (#12 Center of Gravity, #13 Axle Load)
// ============================================================
export type LoadBalanceResult = {
  cgxPct: number; // vị trí trọng tâm theo chiều dài (0-1)
  offsetPct: number; // độ lệch so với tâm (0-1)
  isUnsafe: boolean; // lệch > 30%
  frontAxleKg: number;
  rearAxleKg: number;
  axleOverloaded: boolean;
  score: number; // 0-100
};

export function computeLoadBalance(
  placements: Placement[],
  container: { l: number },
  vm: VehicleMetrics,
): LoadBalanceResult {
  const totalW = placements.reduce((s, p) => s + p.weight, 0);
  if (totalW <= 0 || container.l <= 0) {
    return { cgxPct: 0.5, offsetPct: 0, isUnsafe: false, frontAxleKg: 0, rearAxleKg: 0, axleOverloaded: false, score: 100 };
  }
  // #12 CGX = Σ(W × X) / ΣW (lấy tâm kiện = x + l/2)
  const cgx = placements.reduce((s, p) => s + p.weight * (p.x + p.l / 2), 0) / totalW;
  const cgxPct = cgx / container.l;
  const offsetPct = Math.abs(cgxPct - 0.5) / 0.5; // 0 = cân, 1 = lệch hẳn
  const isUnsafe = offsetPct > CG_UNSAFE_THRESHOLD;

  // #13 Axle Load — đòn bẩy đơn giản: phần trọng tâm về sau → dồn lên trục sau
  const rearAxleKg = totalW * cgxPct;
  const frontAxleKg = totalW - rearAxleKg;
  const axleOverloaded = frontAxleKg > vm.frontAxleMax || rearAxleKg > vm.rearAxleMax;

  const score = Math.max(0, Math.round((1 - offsetPct) * 100));
  return { cgxPct, offsetPct, isUnsafe, frontAxleKg, rearAxleKg, axleOverloaded, score };
}

// ============================================================
// TẦNG 1 — CONSTRAINT ENGINE
// ============================================================
export type ConstraintResult = { ok: boolean; violations: string[] };

export function checkConstraints(
  vm: VehicleMetrics,
  orders: OrderMetrics[],
  rules: DispatchRule[],
): ConstraintResult {
  const ruleOn = (id: string) => rules.find((r) => r.id === id)?.enabled !== false;
  const violations: string[] = [];
  const totW = orders.reduce((s, o) => s + o.weight, 0);
  const totCbm = orders.reduce((s, o) => s + o.cbm, 0);
  const totPallet = orders.reduce((s, o) => s + o.pallets, 0);

  if (ruleOn('max_weight') && totW > vm.weightCap) violations.push('Vượt tải trọng');
  if (ruleOn('max_cbm') && totCbm > vm.cbmCap) violations.push('Vượt CBM');
  if (ruleOn('max_pallet') && totPallet > vm.palletCap) violations.push('Vượt số pallet');
  if (ruleOn('cooling') && orders.some((o) => o.requiresCooling) && !vm.cooling)
    violations.push('Cần xe lạnh');
  if (ruleOn('dangerous') && orders.some((o) => o.isDangerous) && !vm.allowDangerous)
    violations.push('Không chở được hàng nguy hiểm');

  return { ok: violations.length === 0, violations };
}

// ============================================================
// Ngữ cảnh tuyến / GPS / khoảng cách
// ============================================================
function estimateDistanceKm(vehicle: Vehicle, orders: Order[], om: OrderMetrics[]): number {
  // Ưu tiên GPS thực nếu có ở cả xe và đơn
  const withGps = orders.find((o) => o.destinationLat != null && o.destinationLng != null);
  if (withGps && vehicle.gpsLat != null && vehicle.gpsLng != null) {
    return haversineKm(vehicle.gpsLat, vehicle.gpsLng, withGps.destinationLat!, withGps.destinationLng!);
  }
  // Ưu tiên distanceKm khai báo trên đơn
  const declared = om.find((m) => m.distanceKm > 0);
  if (declared) return declared.distanceKm;
  // Heuristic theo tuyến: trùng tuyến → gần, lệch → xa (ổn định theo id)
  const route = String(vehicle.preferredRoute || '').toLowerCase();
  const sameRoute = orders.some((o) => {
    const name = `${o.distributorName} ${o.note || ''}`.toLowerCase();
    if (!route) return false;
    return route.split(/[\s-]+/).some((tok) => tok.length >= 3 && name.includes(tok));
  });
  const hash = Math.abs(vehicle.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 20;
  return sameRoute ? 8 + hash : 60 + hash;
}

function routeMatches(vehicle: Vehicle, orders: Order[]): boolean {
  const route = String(vehicle.preferredRoute || '').toLowerCase();
  if (!route) return false;
  return orders.some((o) => {
    const name = `${o.distributorName} ${o.note || ''}`.toLowerCase();
    return route.split(/[\s-]+/).some((tok) => tok.length >= 3 && name.includes(tok));
  });
}

// ============================================================
// TẦNG 3 (#8-#11) — XẾP ĐƠN VÀO XE theo chiến lược
// ============================================================
function sortOrdersForPacking(orders: OrderMetrics[], algo: DispatchAlgorithm, strategy: PackingStrategy): OrderMetrics[] {
  const arr = [...orders];
  // BFD: hàng lớn → nhỏ
  if (strategy === 'BFD') {
    return arr.sort((a, b) => b.cbm + b.weight / 1000 - (a.cbm + a.weight / 1000));
  }
  // Theo thuật toán chính
  switch (algo) {
    case 'WEIGHT':
      return arr.sort((a, b) => b.weight - a.weight);
    case 'CBM':
      return arr.sort((a, b) => b.cbm - a.cbm);
    case 'PALLET':
      return arr.sort((a, b) => b.pallets - a.pallets);
    case 'PRIORITY':
      return arr.sort((a, b) => b.priority - a.priority);
    default:
      return arr;
  }
}

export type PackAssign = { fitted: OrderMetrics[]; leftover: OrderMetrics[] };

/** Greedy: nhồi đơn vào 1 xe đến khi chạm 1 trong các giới hạn (tải/CBM/pallet). */
export function packOrdersIntoVehicle(
  vm: VehicleMetrics,
  orders: OrderMetrics[],
  algo: DispatchAlgorithm,
  strategy: PackingStrategy,
): PackAssign {
  const ordered = sortOrdersForPacking(orders, algo, strategy);
  const fitted: OrderMetrics[] = [];
  const leftover: OrderMetrics[] = [];
  let loadedW = 0;
  let loadedCbm = 0;
  let loadedPallet = 0;
  for (const o of ordered) {
    const okW = fitsWeight(vm.weightCap, loadedW, o.weight);
    const okCbm = fitsCbm(vm.cbmCap, loadedCbm, o.cbm);
    const okPallet = remainingPallet(vm.palletCap, loadedPallet) >= o.pallets;
    const okCooling = !o.requiresCooling || vm.cooling;
    const okDanger = !o.isDangerous || vm.allowDangerous;
    if (okW && okCbm && okPallet && okCooling && okDanger) {
      fitted.push(o);
      loadedW += o.weight;
      loadedCbm += o.cbm;
      loadedPallet += o.pallets;
    } else {
      leftover.push(o);
    }
  }
  return { fitted, leftover };
}

// ============================================================
// TẦNG 2 + 5 — SCORING ENGINE + RULE ENGINE (#14-#18, #21)
// ============================================================
export type ScoreBreakdown = {
  rule: string;
  label: string;
  weight: number;
  score: number; // 0-100
  weighted: number;
};

export type VehicleEvaluation = {
  vehicleId: string;
  plate: string;
  type: string;
  feasible: boolean;
  violations: string[];
  fittedOrderIds: string[];
  leftoverOrderIds: string[];
  // chỉ số
  loadedWeight: number;
  weightCap: number;
  loadedCbm: number;
  cbmCap: number;
  loadedPallet: number;
  palletCap: number;
  fillRatePct: number; // #6 từ 3D packing
  loadFactorPct: number; // #4
  distanceKm: number;
  etaHours: number;
  fuelCostVnd: number;
  loadBalance: LoadBalanceResult;
  packing: PackResult;
  // điểm
  breakdown: ScoreBreakdown[];
  totalScore: number; // #18 / #21
};

const ruleWeight = (rules: DispatchRule[], id: string): number => {
  const r = rules.find((x) => x.id === id);
  if (!r || !r.enabled || r.weight === 'HARD') return 0;
  return r.weight as number;
};

/**
 * Chấm điểm 1 xe cho nhóm đơn (sau khi đã packing).
 * Áp dụng Rule Engine: Total Score = Σ(Rule Weight × Rule Score) / Σ Weight  (chuẩn hoá về 0-100)
 */
export function evaluateVehicle(
  vehicle: Vehicle,
  allOrders: Order[],
  config: DispatchConfig,
  context: { maxFuel: number; minFuel: number; maxDist: number; minDist: number },
): VehicleEvaluation {
  const vm = deriveVehicleMetrics(vehicle);
  const om = allOrders.map(deriveOrderMetrics);

  // Tầng 1: ràng buộc trên toàn nhóm (để biết vi phạm tổng thể)
  const hardCheck = checkConstraints(vm, om, config.rules);

  // Tầng 3: nhồi đơn vào xe theo thuật toán + chiến lược
  const { fitted, leftover } = packOrdersIntoVehicle(vm, om, config.algorithm, config.packing);

  // 3D bin packing cho phần đã nhồi
  const boxes = fitted.map(orderToBox);
  const packing = pack3D(boxes, { l: vm.lengthCm, w: vm.widthCm, h: vm.heightCm });

  // Tầng 4: cân bằng tải
  const loadBalance = computeLoadBalance(packing.placements, { l: vm.lengthCm }, vm);

  const loadedWeight = fitted.reduce((s, o) => s + o.weight, 0);
  const loadedCbm = fitted.reduce((s, o) => s + o.cbm, 0);
  const loadedPallet = fitted.reduce((s, o) => s + o.pallets, 0);

  // Ngữ cảnh tuyến/khoảng cách dựa trên các đơn đã nhồi (fallback toàn bộ)
  const fittedOrders = allOrders.filter((o) => fitted.some((f) => f.id === o.id));
  const ctxOrders = fittedOrders.length ? fittedOrders : allOrders;
  const distanceKm = estimateDistanceKm(vehicle, ctxOrders, om);
  const etaHours = eta(distanceKm);
  const fuelCostVnd = fuelCost(distanceKm, vm.fuelConsumption, vm.fuelPrice);

  // Điểm thành phần (0-100)
  const fillScore = packing.fillRatePct; // #6
  const balanceScore = loadBalance.score; // #12
  const routeScore = routeMatches(vehicle, ctxOrders) ? 100 : 30; // #14
  const gpsScore = context.maxDist > context.minDist
    ? Math.round(((context.maxDist - distanceKm) / (context.maxDist - context.minDist)) * 100)
    : 100; // gần hơn → cao
  const etaScore = gpsScore; // ETA tỷ lệ nghịch khoảng cách (#15)
  const fuelScore = context.maxFuel > context.minFuel
    ? Math.round(((context.maxFuel - fuelCostVnd) / (context.maxFuel - context.minFuel)) * 100)
    : 100; // #16 rẻ hơn → cao
  const vipScore = fitted.some((o) => o.isVip) ? 100 : (fitted.length ? Math.round((fitted.reduce((s, o) => s + o.priority, 0) / fitted.length / 5) * 100) : 0); // SLA/ưu tiên

  const componentByRule: Record<string, number> = {
    same_route: routeScore,
    near_gps: gpsScore,
    vip: vipScore,
    fuel: fuelScore,
    fill_rate: fillScore,
    load_balance: balanceScore,
    eta: etaScore,
  };

  // Rule Engine (#21): Total = Σ(weight × score) / Σ weight
  let weightedSum = 0;
  let weightTotal = 0;
  const breakdown: ScoreBreakdown[] = [];
  for (const rule of config.rules) {
    if (rule.weight === 'HARD' || !rule.enabled) continue;
    const s = componentByRule[rule.id];
    if (s == null) continue;
    const w = rule.weight as number;
    weightedSum += w * s;
    weightTotal += w;
    breakdown.push({ rule: rule.id, label: rule.label, weight: w, score: Math.round(s), weighted: Math.round(w * s) });
  }

  let totalScore = weightTotal > 0 ? weightedSum / weightTotal : 0;

  // Phạt nặng nếu vi phạm hard-rule hoặc xếp không an toàn
  const feasible = hardCheck.ok && fitted.length > 0 && packing.unplaced.length === 0 && !loadBalance.axleOverloaded;
  const violations = [...hardCheck.violations];
  if (packing.unplaced.length > 0) violations.push('Không xếp đủ kiện (3D)');
  if (loadBalance.isUnsafe) violations.push('Trọng tâm lệch (Unsafe Loading)');
  if (loadBalance.axleOverloaded) violations.push('Quá tải trục');
  if (!feasible) totalScore = totalScore * 0.4; // hạ điểm xe không khả thi

  return {
    vehicleId: vehicle.id,
    plate: vehicle.plateNumber,
    type: vehicle.type,
    feasible,
    violations,
    fittedOrderIds: fitted.map((o) => o.id),
    leftoverOrderIds: leftover.map((o) => o.id),
    loadedWeight,
    weightCap: vm.weightCap,
    loadedCbm,
    cbmCap: vm.cbmCap,
    loadedPallet,
    palletCap: vm.palletCap,
    fillRatePct: packing.fillRatePct,
    loadFactorPct: Math.round(loadFactor(loadedWeight, vm.weightCap, loadedCbm, vm.cbmCap) * 100),
    distanceKm: Math.round(distanceKm * 10) / 10,
    etaHours: Math.round(etaHours * 10) / 10,
    fuelCostVnd: Math.round(fuelCostVnd),
    loadBalance,
    packing,
    breakdown,
    totalScore: Math.round(totalScore * 10) / 10,
  };
}

// ============================================================
// HÀM CHÍNH — chạy pipeline & xếp hạng xe
// ============================================================
export function runDispatchOptimization(
  selectedOrders: Order[],
  vehicles: Vehicle[],
  config: DispatchConfig,
): VehicleEvaluation[] {
  if (selectedOrders.length === 0 || vehicles.length === 0) return [];

  // Ngữ cảnh chuẩn hoá GPS/ETA/Fuel để chấm điểm tương đối
  const om = selectedOrders.map(deriveOrderMetrics);
  const dists = vehicles.map((v) => estimateDistanceKm(v, selectedOrders, om));
  const fuels = vehicles.map((v, i) => {
    const vm = deriveVehicleMetrics(v);
    return fuelCost(dists[i], vm.fuelConsumption, vm.fuelPrice);
  });
  const context = {
    maxDist: Math.max(...dists, 1),
    minDist: Math.min(...dists, 0),
    maxFuel: Math.max(...fuels, 1),
    minFuel: Math.min(...fuels, 0),
  };

  const evaluations = vehicles.map((v) => evaluateVehicle(v, selectedOrders, config, context));

  // Sort DESC theo điểm; xe khả thi luôn xếp trên xe không khả thi
  return evaluations.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    return b.totalScore - a.totalScore;
  });
}

// ============================================================
// QUY TẮC XẾP HÀNG (#20) — gợi ý vị trí đặt theo loại hàng
// ============================================================
export const STACKING_RULES: { label: string; zone: string }[] = [
  { label: 'Hàng nặng (Heavy)', zone: 'Đáy thùng (Bottom)' },
  { label: 'Hàng trung bình (Medium)', zone: 'Giữa thùng (Middle)' },
  { label: 'Hàng nhẹ (Light)', zone: 'Trên cùng (Top)' },
  { label: 'Hàng dễ vỡ (Fragile)', zone: 'Chỉ xếp trên cùng (Top Only)' },
  { label: 'Hàng lỏng (Liquid)', zone: 'Đặt đứng (Stand Up)' },
  { label: 'Hàng nguy hiểm (Hazardous)', zone: 'Khu riêng (Separate Zone)' },
  { label: 'Hàng đông lạnh (Frozen)', zone: 'Khu lạnh (Cold Area)' },
];
