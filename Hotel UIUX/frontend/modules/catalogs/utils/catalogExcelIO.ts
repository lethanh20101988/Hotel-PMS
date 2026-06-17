import type { WorkSheet } from 'xlsx';
import type { Asset, Customer, InventoryItem, Supplier, Warehouse } from '@shared/types';
import { loadXlsx, type XlsxModule } from '@shared/utils/lazyXlsx';

function normStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function normNum(v: unknown): number {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function downloadBlob(filename: string, buf: ArrayBuffer) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Xuất Excel — dòng 1: tên cột (Anh), dễ import lại. */
export async function exportCustomersExcel(rows: Customer[], filename = 'danh-muc-khach-hang.xlsx') {
  const XLSX = await loadXlsx();
  const data = rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    taxCode: c.taxCode ?? '',
    address: c.address ?? '',
    phone: c.phone ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ id: '', code: '', name: '', taxCode: '', address: '', phone: '' }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'KhachHang');
  downloadBlob(filename, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

export async function exportSuppliersExcel(rows: Supplier[], filename = 'danh-muc-nha-cung-cap.xlsx') {
  const XLSX = await loadXlsx();
  const data = rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    taxCode: c.taxCode ?? '',
    address: c.address ?? '',
    phone: c.phone ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ id: '', code: '', name: '', taxCode: '', address: '', phone: '' }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'NhaCungCap');
  downloadBlob(filename, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

export async function exportWarehousesExcel(rows: Warehouse[], filename = 'danh-muc-kho-bai.xlsx') {
  const XLSX = await loadXlsx();
  const data = rows.map((w) => ({
    id: w.id,
    code: w.code,
    name: w.name,
    address: w.address ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ id: '', code: '', name: '', address: '' }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'KhoBai');
  downloadBlob(filename, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

/** Xuất / nhập Danh mục hàng hóa: chỉ SKU, tên, ĐVT, danh mục (cột tiếng Việt). */
export async function exportInventoryExcel(rows: InventoryItem[], filename = 'danh-muc-hang-hoa-vat-tu.xlsx') {
  const XLSX = await loadXlsx();
  const data = rows.map((it) => ({
    'Mã SKU': it.sku,
    'Tên hàng hóa': it.name,
    ĐVT: it.unit,
    'Danh mục': it.category,
  }));
  const empty = { 'Mã SKU': '', 'Tên hàng hóa': '', ĐVT: '', 'Danh mục': '' };
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [empty]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'VatTu');
  downloadBlob(filename, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

const INVENTORY_TEMPLATE_KEYS = [
  'id',
  'Mã SKU',
  'Tên hàng hóa',
  'ĐVT',
  'Danh mục',
  'Tồn ban đầu',
  'Tối thiểu',
  'Giá vốn',
  'Giá bán',
  'TK kho',
  'TK giá vốn',
] as const;

/**
 * Mẫu import đồng bộ Danh mục + Kho (cột id để trống; hệ thống khớp theo SKU khi nhập lại).
 */
export async function exportInventoryItemTemplateExcel(filename = 'mau-import-hang-hoa-vat-tu.xlsx') {
  const XLSX = await loadXlsx();
  const example: Record<string, string | number> = {
    id: '',
    'Mã SKU': 'VD-001',
    'Tên hàng hóa': 'Hàng mẫu — sửa hoặc xóa dòng này',
    ĐVT: 'Cái',
    'Danh mục': 'Chung',
    'Tồn ban đầu': 0,
    'Tối thiểu': 5,
    'Giá vốn': 100000,
    'Giá bán': 150000,
    'TK kho': '156',
    'TK giá vốn': '632',
  };
  const blank: Record<string, string> = Object.fromEntries(INVENTORY_TEMPLATE_KEYS.map((k) => [k, '']));
  const ws = XLSX.utils.json_to_sheet([example, blank]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'HangHoa');
  downloadBlob(filename, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

function cellNum(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
    const v = row[k];
    if (v === '' || v == null) continue;
    const n = normNum(v);
    return n;
  }
  return undefined;
}

/** Đọc một dòng Excel — cột tiếng Việt (mẫu Kho) hoặc tiếng Anh; chỉ gán trường khi cột có trong file (tránh ghi đè 0 khi cập nhật). */
export function parseInventoryItemFromExcelRow(row: Record<string, unknown>): Partial<InventoryItem> & { sku?: string } {
  const base = rowToInventoryCatalogRow(row);
  const id =
    normStr(row.id) ||
    normStr(row['Mã nội bộ']) ||
    normStr(row['Ma noi bo']) ||
    undefined;
  const p: Partial<InventoryItem> & { sku?: string } = { ...base };
  if (id) p.id = id;

  const quantity = cellNum(row, ['Tồn ban đầu', 'Ton ban dau', 'Tồn kho', 'Ton kho', 'quantity']);
  if (quantity !== undefined) p.quantity = quantity;

  const minStock = cellNum(row, ['Tối thiểu', 'Toi thieu', 'Cảnh báo tối thiểu', 'minStock']);
  if (minStock !== undefined) p.minStock = minStock;

  const costPrice = cellNum(row, ['Giá vốn', 'Gia von', 'costPrice']);
  if (costPrice !== undefined) p.costPrice = costPrice;

  const sellingPrice = cellNum(row, ['Giá bán', 'Gia ban', 'sellingPrice']);
  if (sellingPrice !== undefined) p.sellingPrice = sellingPrice;

  const accountCode =
    normStr(row['TK kho']) ||
    normStr(row['TK Kho']) ||
    normStr(row.accountCode) ||
    undefined;
  if (accountCode) p.accountCode = accountCode;

  const costAccount =
    normStr(row['TK giá vốn']) ||
    normStr(row['TK gia von']) ||
    normStr(row.costAccount) ||
    undefined;
  if (costAccount) p.costAccount = costAccount;

  const tt = normStr(row['Kiểu theo dõi'] || row.trackingType).toUpperCase();
  if (tt === 'SERIAL' || tt === 'LOT') p.trackingType = tt as 'SERIAL' | 'LOT';

  return p;
}

/**
 * Import hàng hóa từ sheet (cùng logic Danh mục & Kho): khớp theo id hoặc SKU, cập nhật/ thêm và đồng bộ inventory + inventoryCatalog.
 */
export function applyInventoryExcelImport(
  rows: Record<string, unknown>[],
  inventoryCatalog: InventoryItem[],
  inventory: InventoryItem[],
  handleAddCatalogItem: (type: string, item: any) => void,
  handleUpdateCatalogItem: (type: string, item: any) => void,
): { added: number; updated: number; errors: string[] } {
  let added = 0;
  let updated = 0;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const p = parseInventoryItemFromExcelRow(rows[i]);
    if (!p.sku?.trim() && !p.name?.trim()) continue;
    const skuKey = String(p.sku || '').trim();
    const idKey = String(p.id || '').trim();
    const byId = idKey
      ? inventoryCatalog.find((it) => String(it.id) === idKey) || inventory.find((it) => String(it.id) === idKey)
      : undefined;
    const bySku = skuKey
      ? inventoryCatalog.find((it) => String(it.sku || '').trim() === skuKey) ||
        inventory.find((it) => String(it.sku || '').trim() === skuKey)
      : undefined;
    try {
      if (byId) {
        handleUpdateCatalogItem('ITEMS', { ...byId, ...p, id: byId.id });
        updated += 1;
      } else if (bySku) {
        handleUpdateCatalogItem('ITEMS', { ...bySku, ...p, id: bySku.id });
        updated += 1;
      } else {
        handleAddCatalogItem('ITEMS', {
          sku: p.sku || `SKU-${Date.now()}-${i}`,
          name: p.name || p.sku || 'Vật tư',
          unit: p.unit || 'Cái',
          category: p.category || 'Chung',
          quantity: p.quantity ?? 0,
          minStock: p.minStock ?? 0,
          costPrice: p.costPrice ?? 0,
          sellingPrice: p.sellingPrice ?? 0,
          accountCode: p.accountCode,
          costAccount: p.costAccount,
          trackingType: p.trackingType,
        });
        added += 1;
      }
    } catch (e: any) {
      errors.push(`Dòng ${i + 2}: ${e?.message || e}`);
    }
  }
  return { added, updated, errors };
}

/**
 * Import hàng loạt trên bản sao catalog/inventory — tránh closure cũ khi gọi nhiều lần setState trong vòng lặp.
 */
export function applyInventoryExcelImportBatch(
  rows: Record<string, unknown>[],
  inventoryCatalog: InventoryItem[],
  inventory: InventoryItem[],
  newEntityId: () => string,
): { catalog: InventoryItem[]; inventory: InventoryItem[]; added: number; updated: number; errors: string[] } {
  let added = 0;
  let updated = 0;
  const errors: string[] = [];
  const catalog = [...inventoryCatalog];
  const inv = [...inventory];

  const findInCatalog = (idKey: string, skuKey: string) => {
    const byId = idKey
      ? catalog.find((it) => String(it.id) === idKey) || inv.find((it) => String(it.id) === idKey)
      : undefined;
    const bySku = skuKey
      ? catalog.find((it) => String(it.sku || '').trim() === skuKey) ||
        inv.find((it) => String(it.sku || '').trim() === skuKey)
      : undefined;
    return { byId, bySku };
  };

  for (let i = 0; i < rows.length; i++) {
    const p = parseInventoryItemFromExcelRow(rows[i]);
    if (!p.sku?.trim() && !p.name?.trim()) continue;
    const skuKey = String(p.sku || '').trim();
    const idKey = String(p.id || '').trim();
    const { byId, bySku } = findInCatalog(idKey, skuKey);
    try {
      if (byId) {
        const id = byId.id;
        const idxCat = catalog.findIndex((it) => it.id === id);
        const merged = { ...byId, ...p, id };
        if (idxCat >= 0) catalog[idxCat] = merged;
        else catalog.push(merged);
        const idxInv = inv.findIndex((it) => it.id === id);
        if (idxInv >= 0) {
          inv[idxInv] = {
            ...inv[idxInv],
            ...merged,
            quantity: inv[idxInv].quantity,
            serials: inv[idxInv].serials,
            serialDetails: inv[idxInv].serialDetails,
            warehouseBalances: inv[idxInv].warehouseBalances,
          };
        } else {
          inv.push({ ...merged, quantity: Number(p.quantity ?? 0), serials: [], serialDetails: [] });
        }
        updated += 1;
      } else if (bySku) {
        const id = bySku.id;
        const idxCat = catalog.findIndex((it) => it.id === id);
        const merged = { ...bySku, ...p, id };
        if (idxCat >= 0) catalog[idxCat] = merged;
        else catalog.push(merged);
        const idxInv = inv.findIndex((it) => it.id === id);
        if (idxInv >= 0) {
          inv[idxInv] = {
            ...inv[idxInv],
            ...merged,
            quantity: inv[idxInv].quantity,
            serials: inv[idxInv].serials,
            serialDetails: inv[idxInv].serialDetails,
            warehouseBalances: inv[idxInv].warehouseBalances,
          };
        } else {
          inv.push({ ...merged, quantity: Number(p.quantity ?? 0), serials: [], serialDetails: [] });
        }
        updated += 1;
      } else {
        const nid = newEntityId();
        const catalogRow: InventoryItem = {
          id: nid,
          sku: p.sku || `SKU-${nid}`,
          name: p.name || p.sku || 'Vật tư',
          unit: p.unit || 'Cái',
          category: p.category || 'Chung',
          quantity: 0,
          minStock: Number(p.minStock ?? 0),
          costPrice: Number(p.costPrice ?? 0),
          sellingPrice: Number(p.sellingPrice ?? 0),
          accountCode: p.accountCode,
          costAccount: p.costAccount,
          trackingType: p.trackingType,
        };
        catalog.push(catalogRow);
        inv.push({
          ...catalogRow,
          quantity: Number(p.quantity ?? 0),
          serials: [],
          serialDetails: [],
        });
        added += 1;
      }
    } catch (e: any) {
      errors.push(`Dòng ${i + 2}: ${e?.message || e}`);
    }
  }

  return { catalog, inventory: inv, added, updated, errors };
}

export async function exportAssetsExcel(rows: Asset[], filename = 'danh-muc-tai-san.xlsx') {
  const XLSX = await loadXlsx();
  const data = rows.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    assetGroup: a.assetGroup,
    assetAccount: a.assetAccount,
    depreciationAccount: a.depreciationAccount,
    cost: a.cost,
    vatRate: a.vatRate ?? '',
    vatAmount: a.vatAmount ?? '',
    purchaseInvoiceNumber: a.purchaseInvoiceNumber ?? '',
    purchaseFormNo: a.purchaseFormNo ?? '',
    purchaseSymbolCode: a.purchaseSymbolCode ?? '',
    buyDate: a.buyDate,
    useDate: a.useDate,
    usefulLife: a.usefulLife,
    accumulatedDepreciation: a.accumulatedDepreciation,
    accumulatedAllocation: a.accumulatedAllocation,
    residualValue: a.residualValue,
    department: a.department,
    status: a.status,
    supplierName: a.supplierName ?? '',
    supplierAddress: a.supplierAddress ?? '',
    supplierTaxCode: a.supplierTaxCode ?? '',
    supplierPhone: a.supplierPhone ?? '',
    salvageValue: a.salvageValue ?? '',
    expenseAccount: a.expenseAccount ?? '',
    ccdcLifecycle: a.ccdcLifecycle ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TaiSan');
  downloadBlob(filename, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

function sheetToObjects(sheet: WorkSheet, xlsx: XlsxModule): Record<string, unknown>[] {
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  return rows.filter((r) => Object.values(r).some((v) => normStr(v) !== ''));
}

export async function parseCatalogExcelFile(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const raw = sheetToObjects(sheet, XLSX);
  return raw.map((row) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const key = normStr(k).replace(/^\uFEFF/, '');
      if (!key) continue;
      o[key] = v;
    }
    return o;
  });
}

export function rowToCustomer(row: Record<string, unknown>): Partial<Customer> & { id?: string; code?: string } {
  return {
    id: normStr(row.id),
    code: normStr(row.code),
    name: normStr(row.name),
    taxCode: normStr(row.taxCode) || undefined,
    address: normStr(row.address) || undefined,
    phone: normStr(row.phone) || undefined,
  };
}

export function rowToSupplier(row: Record<string, unknown>): Partial<Supplier> & { id?: string; code?: string } {
  return rowToCustomer(row) as Partial<Supplier> & { id?: string; code?: string };
}

export function rowToWarehouse(row: Record<string, unknown>): Partial<Warehouse> & { id?: string; code?: string } {
  return {
    id: normStr(row.id),
    code: normStr(row.code),
    name: normStr(row.name),
    address: normStr(row.address) || undefined,
  };
}

export function rowToInventoryItem(row: Record<string, unknown>): Partial<InventoryItem> & { id?: string; sku?: string } {
  const tt = normStr(row.trackingType).toUpperCase();
  const trackingType =
    tt === 'SERIAL' || tt === 'LOT' ? (tt as 'SERIAL' | 'LOT') : ('NONE' as const);
  return {
    id: normStr(row.id),
    sku: normStr(row.sku),
    name: normStr(row.name),
    unit: normStr(row.unit),
    category: normStr(row.category),
    quantity: normNum(row.quantity),
    minStock: normNum(row.minStock),
    costPrice: normNum(row.costPrice),
    sellingPrice: normNum(row.sellingPrice),
    accountCode: normStr(row.accountCode) || undefined,
    costAccount: normStr(row.costAccount) || undefined,
    trackingType,
  };
}

/** Import từ file chỉ 4 cột (VN hoặc tên cột tiếng Anh cũ). Khớp theo SKU. */
export function rowToInventoryCatalogRow(row: Record<string, unknown>): Partial<InventoryItem> & { sku?: string } {
  const sku =
    normStr(row['Mã SKU']) ||
    normStr(row['Ma SKU']) ||
    normStr(row.sku);
  const name =
    normStr(row['Tên hàng hóa']) ||
    normStr(row['Ten hang hoa']) ||
    normStr(row.name);
  const unit =
    normStr(row.ĐVT) ||
    normStr(row['DVT']) ||
    normStr(row.unit);
  const category =
    normStr(row['Danh mục']) ||
    normStr(row['Danh muc']) ||
    normStr(row.category);
  return { sku, name, unit, category };
}

export function rowToAssetPartial(row: Record<string, unknown>): Partial<Asset> & { id?: string; code?: string } {
  const typeRaw = normStr(row.type);
  const type = typeRaw === 'CCDC' ? ('CCDC' as const) : ('TSCĐ' as const);
  const statusRaw = normStr(row.status).toUpperCase();
  const status = statusRaw === 'LIQUIDATED' ? ('LIQUIDATED' as const) : ('ACTIVE' as const);
  const life = normNum(row.usefulLife);
  return {
    id: normStr(row.id),
    code: normStr(row.code),
    name: normStr(row.name),
    type,
    assetGroup: normStr(row.assetGroup),
    assetAccount: normStr(row.assetAccount),
    depreciationAccount: normStr(row.depreciationAccount),
    cost: normNum(row.cost),
    vatRate: row.vatRate === '' || row.vatRate == null ? undefined : normNum(row.vatRate),
    vatAmount: row.vatAmount === '' || row.vatAmount == null ? undefined : normNum(row.vatAmount),
    purchaseInvoiceNumber: normStr(row.purchaseInvoiceNumber) || undefined,
    purchaseFormNo: normStr(row.purchaseFormNo) || undefined,
    purchaseSymbolCode: normStr(row.purchaseSymbolCode) || undefined,
    buyDate: normStr(row.buyDate).slice(0, 10) || undefined,
    useDate: normStr(row.useDate).slice(0, 10) || undefined,
    usefulLife: life > 0 ? life : undefined,
    accumulatedDepreciation: normNum(row.accumulatedDepreciation),
    accumulatedAllocation: normNum(row.accumulatedAllocation),
    residualValue: row.residualValue === '' || row.residualValue == null ? undefined : normNum(row.residualValue),
    department: normStr(row.department),
    status,
    supplierName: normStr(row.supplierName) || undefined,
    supplierAddress: normStr(row.supplierAddress) || undefined,
    supplierTaxCode: normStr(row.supplierTaxCode) || undefined,
    supplierPhone: normStr(row.supplierPhone) || undefined,
    salvageValue: row.salvageValue === '' || row.salvageValue == null ? undefined : normNum(row.salvageValue),
    expenseAccount: normStr(row.expenseAccount) || undefined,
    ccdcLifecycle:
      normStr(row.ccdcLifecycle) === 'STOCK_153'
        ? 'STOCK_153'
        : normStr(row.ccdcLifecycle) === 'IN_USE'
          ? 'IN_USE'
          : undefined,
  };
}
