import { Order, OrderStatus, OrderType, Product, Distributor } from './types';

type CsvRow = {
  ref: string;
  type: string;
  target: string;
  fromWarehouse: string;
  requestDate: string;
  productId: string;
  quantity: number;
  note: string;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCsvRows(text: string): CsvRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 7) continue;
    const quantity = parseInt(cols[6], 10);
    if (!cols[0] || !cols[5] || !Number.isFinite(quantity) || quantity <= 0) continue;
    rows.push({
      ref: cols[0],
      type: cols[1].toUpperCase(),
      target: cols[2],
      fromWarehouse: cols[3] || '',
      requestDate: cols[4] || new Date().toISOString().split('T')[0],
      productId: cols[5],
      quantity,
      note: cols[7] || '',
    });
  }
  return rows;
}

/**
 * Đọc file CSV import đơn hàng (cùng cấu trúc file mẫu) và tạo danh sách Order.
 */
export async function buildOrdersFromCsvFile(
  file: File,
  distributors: Distributor[],
  products: Product[],
): Promise<Order[]> {
  const text = await file.text();
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const grouped = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.ref) ?? [];
    list.push(row);
    grouped.set(row.ref, list);
  }

  const timestamp = Date.now();
  const orders: Order[] = [];

  grouped.forEach((groupRows, ref) => {
    const first = groupRows[0];
    const isInternal = first.type === 'NOIBO' || first.type === 'INTERNAL';
    const type = isInternal ? OrderType.INTERNAL : OrderType.DISTRIBUTOR;

    let distributorId: string | undefined;
    let distributorName = '';
    let toWarehouse: string | undefined;

    if (isInternal) {
      toWarehouse = first.target;
      distributorName = first.target;
    } else {
      const dist = distributors.find((d) => d.id === first.target);
      if (dist) {
        distributorId = dist.id;
        distributorName = dist.name;
      } else {
        distributorName = first.target;
      }
    }

    const items = groupRows.map((r) => {
      const prod = products.find((p) => p.id === r.productId);
      return {
        productId: r.productId,
        productName: prod?.name ?? r.productId,
        quantity: r.quantity,
      };
    });

    const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
    const totalWeight = items.reduce((sum, item) => {
      const p = products.find((prod) => prod.id === item.productId);
      return sum + item.quantity * (p?.weightKg ?? 0);
    }, 0);

    const month = first.requestDate.substring(0, 7);

    orders.push({
      id: `IMP-${timestamp}-${ref.replace(/[^\w-]/g, '')}`,
      type,
      distributorId,
      distributorName,
      toWarehouse,
      fromWarehouse: first.fromWarehouse,
      requestDate: first.requestDate,
      month,
      items,
      totalQuantity,
      totalWeight,
      note: first.note,
      status: OrderStatus.CREATED,
    });
  });

  return orders;
}
