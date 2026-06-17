import type { FinancialYear, InventoryItem, InventoryTransaction } from '../../types';

export type Tt58S2cLedgerRow = {
  docNo?: string;
  docDate?: string;
  description: string;
  unit?: string;
  unitPrice?: number;
  importQty?: number;
  importValue?: number;
  exportQty?: number;
  exportValue?: number;
  balanceQty?: number;
  balanceValue?: number;
  bold?: boolean;
};

export type Tt58S2cItemLedger = {
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  rows: Tt58S2cLedgerRow[];
  openingQty: number;
  openingValue: number;
  closingQty: number;
  closingValue: number;
};

export type Tt58S2cDnsnLedgerData = {
  items: Tt58S2cItemLedger[];
  year: number;
};

const formatDocDate = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
};

const mergeInventoryMasters = (
  inventory: InventoryItem[],
  catalog: InventoryItem[],
): InventoryItem[] => {
  const map = new Map<string, InventoryItem>();
  for (const c of catalog) map.set(String(c.id), { ...c });
  for (const i of inventory) {
    const id = String(i.id);
    map.set(id, { ...(map.get(id) || {}), ...i, id });
  }
  return [...map.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
};

const replayItemLedger = (
  item: InventoryItem,
  transactions: InventoryTransaction[],
  startDate: string,
  endDate: string,
): Tt58S2cItemLedger | null => {
  const itemTrxs = transactions
    .filter((t) => String(t.itemId) === String(item.id))
    .sort((a, b) => {
      const d = String(a.date || '').localeCompare(String(b.date || ''));
      if (d !== 0) return d;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

  let qty = 0;
  let value = 0;

  for (const t of itemTrxs) {
    if (String(t.date || '') >= startDate) break;
    const q = Number(t.quantity || 0);
    if (t.type === 'IMPORT') {
      qty += q;
      value += q * Number(t.price || 0);
    } else if (q > 0) {
      const avg = qty > 0 ? value / qty : Number(t.price || 0);
      qty -= q;
      value -= q * avg;
    }
  }

  const openingQty = Math.max(0, qty);
  const openingValue = Math.max(0, value);
  const openingUnitPrice = openingQty > 0 ? openingValue / openingQty : Number(item.costPrice || 0);

  const rows: Tt58S2cLedgerRow[] = [
    {
      description: 'Số dư đầu kỳ',
      unit: item.unit,
      unitPrice: openingUnitPrice,
      balanceQty: openingQty,
      balanceValue: openingValue,
      bold: true,
    },
  ];

  qty = openingQty;
  value = openingValue;

  let sumImportQty = 0;
  let sumImportValue = 0;
  let sumExportQty = 0;
  let sumExportValue = 0;

  const periodTrxs = itemTrxs.filter(
    (t) => String(t.date || '') >= startDate && String(t.date || '') <= endDate,
  );

  for (const t of periodTrxs) {
    const q = Number(t.quantity || 0);
    if (q <= 0) continue;
    const docNo = String(t.voucherNumber || t.documentRef || t.id || '').trim();
    const docDate = formatDocDate(t.date);
    const desc =
      String(t.note || '').trim() ||
      (t.type === 'IMPORT'
        ? `Nhập kho — ${t.supplier ? `NCC: ${t.supplier}` : item.name}`
        : `Xuất kho — ${t.customer ? `KH: ${t.customer}` : item.name}`);

    if (t.type === 'IMPORT') {
      const price = Number(t.price || 0);
      const importValue = q * price;
      qty += q;
      value += importValue;
      sumImportQty += q;
      sumImportValue += importValue;
      rows.push({
        docNo,
        docDate,
        description: desc,
        unit: item.unit,
        unitPrice: price,
        importQty: q,
        importValue,
        balanceQty: qty,
        balanceValue: value,
      });
    } else {
      const avg = qty > 0 ? value / qty : Number(t.price || 0);
      const exportValue = q * avg;
      qty = Math.max(0, qty - q);
      value = Math.max(0, value - exportValue);
      sumExportQty += q;
      sumExportValue += exportValue;
      rows.push({
        docNo,
        docDate,
        description: desc,
        unit: item.unit,
        unitPrice: avg,
        exportQty: q,
        exportValue,
        balanceQty: qty,
        balanceValue: value,
      });
    }
  }

  rows.push({
    description: 'Cộng phát sinh trong kỳ',
    unit: item.unit,
    importQty: sumImportQty,
    importValue: sumImportValue,
    exportQty: sumExportQty,
    exportValue: sumExportValue,
    bold: true,
  });

  const closingQty = qty;
  const closingValue = value;
  const closingUnitPrice = closingQty > 0 ? closingValue / closingQty : openingUnitPrice;

  rows.push({
    description: 'Số dư cuối kỳ',
    unit: item.unit,
    unitPrice: closingUnitPrice,
    balanceQty: closingQty,
    balanceValue: closingValue,
    bold: true,
  });

  const hasActivity =
    periodTrxs.length > 0 || openingQty > 0 || closingQty > 0 || Number(item.quantity || 0) > 0;
  if (!hasActivity) return null;

  return {
    itemId: String(item.id),
    itemName: String(item.name || item.sku || item.id),
    sku: String(item.sku || ''),
    unit: String(item.unit || ''),
    rows,
    openingQty,
    openingValue,
    closingQty,
    closingValue,
  };
};

/** S2c-DNSN — sổ chi tiết vật liệu, hàng hóa (bình quân gia quyền). */
export function computeTt58S2cDnsnLedger(
  inventoryInput: InventoryItem[] | undefined | null,
  catalogInput: InventoryItem[] | undefined | null,
  transactionsInput: InventoryTransaction[] | undefined | null,
  financialYear: FinancialYear,
): Tt58S2cDnsnLedgerData {
  const startDate = financialYear.startDate;
  const endDate = financialYear.endDate;
  const year = Number(String(startDate || '').slice(0, 4)) || new Date().getFullYear();
  const masters = mergeInventoryMasters(
    Array.isArray(inventoryInput) ? inventoryInput : [],
    Array.isArray(catalogInput) ? catalogInput : [],
  );
  const transactions = Array.isArray(transactionsInput) ? transactionsInput : [];

  const items = masters
    .map((item) => replayItemLedger(item, transactions, startDate, endDate))
    .filter((x): x is Tt58S2cItemLedger => x != null);

  return { items, year };
}

const num = (v: number | undefined, format: (n: number) => string) =>
  v != null && Number.isFinite(v) && v !== 0 ? format(v) : '';

export function tt58S2cRowToTableRow(
  row: Tt58S2cLedgerRow,
  formatAmount: (n: number) => string,
): (string | number)[] {
  return [
    row.docNo || '',
    row.docDate || '',
    row.description,
    row.unit || '',
    num(row.unitPrice, formatAmount),
    row.importQty != null && row.importQty > 0 ? formatAmount(row.importQty) : '',
    num(row.importValue, formatAmount),
    row.exportQty != null && row.exportQty > 0 ? formatAmount(row.exportQty) : '',
    num(row.exportValue, formatAmount),
    row.balanceQty != null && Number.isFinite(row.balanceQty) ? formatAmount(row.balanceQty) : '',
    num(row.balanceValue, formatAmount),
  ];
}

export const TT58_S2C_HEADERS = [
  'Số hiệu',
  'Ngày, tháng',
  'Diễn giải',
  'Đơn vị tính',
  'Đơn giá',
  'Nhập SL',
  'Nhập TT',
  'Xuất SL',
  'Xuất TT',
  'Tồn SL',
  'Tồn TT',
];

export const TT58_S2C_COLUMN_LABELS = ['A', 'B', 'C', 'D', '1', '2', '3', '4', '5', '6', '7'];
