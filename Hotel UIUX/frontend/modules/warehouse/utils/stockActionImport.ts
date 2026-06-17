import type { InventoryItem, InventoryTransaction } from '@shared/types';
import { loadXlsx, type XlsxModule } from '@shared/utils/lazyXlsx';
import { roundVnd } from '@shared/utils/vndMoney';

export type StockActionImportType = 'IMPORT' | 'EXPORT';

export interface StockActionImportLineDraft {
  id: string;
  itemId: string;
  quantity: string;
  price: string;
  vatRate: number;
  note: string;
  serialInput: string;
  selectedSerial: string[];
}

export interface StockActionImportDraft {
  date: string;
  performer: string;
  warehouseName: string;
  supplier: string;
  supplierTaxCode: string;
  supplierPhone: string;
  supplierAddress: string;
  customer: string;
  customerTaxCode: string;
  customerPhone: string;
  customerAddress: string;
  documentRef: string;
  formNo: string;
  symbolCode: string;
  paymentStatus: 'PAID' | 'PENDING';
  paymentMethod: 'CASH' | 'BANK';
  exportPurpose: string;
  lines: StockActionImportLineDraft[];
}

export interface StockActionImportParseResult {
  draft: StockActionImportDraft;
  batches: StockActionImportDraft[];
  skippedRows: string[];
  warnings: string[];
}

const EXPORT_PURPOSES = [
  { code: '632', label: 'Xuất kho bán hàng (632)' },
  { code: '641', label: 'Xuất dùng bộ phận bán hàng (641)' },
  { code: '642', label: 'Xuất dùng bộ phận quản lý (642)' },
  { code: '154', label: 'Xuất chi phí SXKD dở dang (154)' },
  { code: '1541', label: 'Xuất dùng Lắp đặt/Thi công (1541)' },
  { code: '1542', label: 'Xuất dùng dịch vụ GPS/Phần mềm (1542)' },
  { code: '811', label: 'Xuất hao hụt/Kiểm kê thiếu (811)' },
  { code: '331', label: 'Xuất trả lại Nhà cung cấp (331)' },
];

const COMMON_LINE_HEADERS = [
  'Mã hàng / SKU',
  'Tên mặt hàng',
  'Số lượng',
  'Đơn giá',
  'VAT (%)',
  'Nội dung diễn giải chi tiết',
  'Danh sách Serial/IMEI',
];

const IMPORT_HEADERS = [
  'STT',
  'Ngày giờ hạch toán',
  'Người lập chứng từ',
  'Kho',
  'Tên Nhà cung cấp',
  'MST/CCCD Nhà cung cấp',
  'Số điện thoại Nhà cung cấp',
  'Địa chỉ NCC',
  'Số HĐ / Chứng từ gốc',
  'Mẫu số',
  'Ký hiệu',
  'Trạng thái thanh toán',
  'Phương thức thanh toán',
  ...COMMON_LINE_HEADERS,
];

const EXPORT_HEADERS = [
  'STT',
  'Ngày giờ hạch toán',
  'Người lập chứng từ',
  'Kho',
  'Mục đích xuất kho',
  'Tên Khách hàng / Bộ phận',
  'MST/CCCD Khách hàng',
  'Số điện thoại liên hệ',
  'Địa chỉ nhận hàng / Lắp đặt',
  'Số HĐ / Chứng từ gốc',
  'Mẫu số',
  'Ký hiệu',
  'Trạng thái thanh toán',
  'Phương thức thanh toán',
  ...COMMON_LINE_HEADERS,
];

const IMPORT_COLS = [
  { wch: 8 },
  { wch: 20 },
  { wch: 20 },
  { wch: 18 },
  { wch: 26 },
  { wch: 20 },
  { wch: 18 },
  { wch: 28 },
  { wch: 22 },
  { wch: 16 },
  { wch: 14 },
  { wch: 20 },
  { wch: 20 },
  { wch: 18 },
  { wch: 28 },
  { wch: 12 },
  { wch: 16 },
  { wch: 10 },
  { wch: 34 },
  { wch: 30 },
];

const EXPORT_COLS = [
  { wch: 8 },
  { wch: 20 },
  { wch: 20 },
  { wch: 18 },
  { wch: 28 },
  { wch: 28 },
  { wch: 20 },
  { wch: 18 },
  { wch: 30 },
  { wch: 22 },
  { wch: 16 },
  { wch: 14 },
  { wch: 20 },
  { wch: 20 },
  { wch: 18 },
  { wch: 28 },
  { wch: 12 },
  { wch: 16 },
  { wch: 10 },
  { wch: 34 },
  { wch: 30 },
];

const HEADER_ALIASES = {
  date: ['ngaygiohachtoan', 'ngayhachtoan', 'ngaygio', 'ngaygioct'],
  performer: ['nguoilapchungtu', 'nguoilap', 'nguoitao'],
  warehouse: ['kho', 'tenkho', 'makho', 'warehouse'],
  supplier: ['tennhacungcap', 'nhacungcap', 'tenncc'],
  supplierTaxCode: ['mstcccdnhacungcap', 'mstnhacungcap', 'mstcccdncc'],
  supplierPhone: ['sodienthoainhacungcap', 'sdtnhacungcap', 'sdtncc'],
  supplierAddress: ['diachincc', 'diachinhacungcap'],
  exportPurpose: ['mucdichxuatkho', 'mucdichxuat'],
  customer: ['tenkhachhangbophan', 'tenkhachhang', 'tenbophan'],
  customerTaxCode: ['mstcccdkhachhang', 'mstkhachhang', 'mstcccd'],
  customerPhone: ['sodienthoailienhe', 'sodienthoaikhachhang', 'sdtkhachhang'],
  customerAddress: ['diachinhanhanglapdat', 'diachikhachhang', 'diachinhanhang'],
  documentRef: ['sohdchungtugoc', 'sohd', 'sochungtugoc', 'documentref'],
  formNo: ['mauso', 'mausohoadon'],
  symbolCode: ['kyhieu', 'kyhieuhoadon'],
  paymentStatus: ['trangthaithanhtoan', 'thanhtoancongno'],
  paymentMethod: ['phuongthucthanhtoan', 'taikhoantien'],
  itemSku: ['mahangsku', 'mahang', 'sku'],
  itemName: ['tenmathang', 'tenhang', 'tenhanghoa'],
  quantity: ['soluong', 'sl'],
  price: ['dongia', 'gia'],
  vatRate: ['vat', 'thuesuat', 'vatrate'],
  lineNote: ['noidungdiengiaichitiet', 'diengiaichitiet', 'ghichudong'],
  serials: ['danhsachserialimei', 'serialimei', 'serials'],
} as const;

type HeaderAliasKey = keyof typeof HEADER_ALIASES;
type NormalizedRow = Record<string, string>;
const LINE_FIELD_KEYS = new Set(['itemSku', 'itemName', 'quantity', 'price', 'vatRate', 'lineNote', 'serials']);

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function toCellText(value: unknown) {
  if (value == null) return '';
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return String(value).trim();
}

function toDateTimeLocalValue(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
}

function parseDateTimeValue(value: unknown, xlsx: XlsxModule) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return toDateTimeLocalValue(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (parsed) {
      const asDate = new Date(
        parsed.y,
        Math.max(0, (parsed.m || 1) - 1),
        parsed.d || 1,
        parsed.H || 8,
        parsed.M || 0,
        // Giây trong mã ngày Excel (0–59), không phải tiền VND
        Math.round(parsed.S || 0),
      );
      return toDateTimeLocalValue(asDate);
    }
  }

  const text = String(toCellText(value) || '').trim();
  if (!text) return '';

  const normalized = text.replace(/\//g, '-').replace(/\s+/g, ' ').trim();
  const viMatch = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (viMatch) {
    const [, dd, mm, yyyy, hh = '8', min = '00', ss = '00'] = viMatch;
    const asDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
    if (!Number.isNaN(asDate.getTime())) return toDateTimeLocalValue(asDate);
  }

  const isoLike = normalized.includes('T') ? normalized : normalized.replace(' ', 'T');
  const parsed = new Date(isoLike);
  if (!Number.isNaN(parsed.getTime())) {
    const hasTime = /T\d{1,2}:\d{2}/.test(isoLike);
    if (!hasTime) parsed.setHours(8, 0, 0, 0);
    return toDateTimeLocalValue(parsed);
  }

  return '';
}

function parseLooseNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const text = String(toCellText(value) || '')
    .replace(/\s+/g, '')
    .replace(/%/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(/,/g, '.');

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitSerials(value: unknown) {
  return String(toCellText(value) || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatViDateTime(isoLike: string): string {
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return (isoLike || '').trim() || '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatInvoiceSnippet(formNo?: string, symbolCode?: string): string {
  const f = (formNo || '').trim();
  const s = (symbolCode || '').trim();
  if (f && s) return `mẫu số ${f}, ký hiệu ${s}`;
  if (f) return `mẫu số ${f}`;
  if (s) return `ký hiệu ${s}`;
  return '';
}

function invoiceSnippetSuffix(formNo: string, symbolCode: string): string {
  const t = formatInvoiceSnippet(formNo, symbolCode);
  return t ? `, ${t}` : '';
}

function formatTrxDocumentRef(trx: InventoryTransaction): string {
  const ref = (trx.documentRef || '').trim();
  const v = (trx.voucherNumber || '').trim();
  if (ref && v) return `${ref} (phiếu ${v})`;
  if (ref) return ref;
  if (v) return `Phiếu ${v}`;
  return '—';
}

function collectSerialsFromTransaction(trx: InventoryTransaction): Set<string> {
  const set = new Set<string>();
  for (const s of splitSerials(trx.serials ?? '')) {
    const t = s.trim();
    if (t) set.add(t);
  }
  for (const info of trx.serialInfoSnapshot || []) {
    const t = String(info.serial || '').trim();
    if (t) set.add(t);
  }
  return set;
}

function buildSerialImportProvenanceMap(transactions: InventoryTransaction[]): Map<string, InventoryTransaction> {
  const map = new Map<string, InventoryTransaction>();
  const imports = transactions
    .filter((t) => t.type === 'IMPORT')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  for (const t of imports) {
    for (const ser of collectSerialsFromTransaction(t)) {
      const key = `${t.itemId}\t${ser}`;
      if (!map.has(key)) map.set(key, t);
    }
  }
  return map;
}

function buildSerialExportProvenanceMap(transactions: InventoryTransaction[]): Map<string, InventoryTransaction> {
  const map = new Map<string, InventoryTransaction>();
  const exports = transactions
    .filter((t) => t.type === 'EXPORT')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  for (const t of exports) {
    for (const ser of collectSerialsFromTransaction(t)) {
      const key = `${t.itemId}\t${ser}`;
      if (!map.has(key)) map.set(key, t);
    }
  }
  return map;
}

type FileSerialMeta = {
  rowNumber: number;
  documentRef: string;
  dateIso: string;
  formNo: string;
  symbolCode: string;
};

function buildGuideRows(type: StockActionImportType) {
  const baseRows = [
    ['Cột', 'Ý nghĩa', 'Ghi chú'],
    ['Ngày giờ hạch toán', 'Ngày giờ của phiếu', 'Hỗ trợ yyyy-mm-dd hh:mm hoặc dd/mm/yyyy hh:mm'],
    ['Người lập chứng từ', 'Tên người lập', 'Nếu bỏ trống, modal giữ giá trị hiện tại'],
    ['Số HĐ / Chứng từ gốc', 'Số hóa đơn/chứng từ tham chiếu bên ngoài', 'Không phải số phiếu nội bộ, hệ thống tự sinh số phiếu'],
    ['Mẫu số', 'Mẫu số hóa đơn', 'Có thể để trống nếu không có'],
    ['Ký hiệu', 'Ký hiệu hóa đơn', 'Có thể để trống nếu không có'],
    ['Trạng thái thanh toán', 'PAID hoặc PENDING', 'Có thể nhập: PAID, PENDING, Đã trả tiền, Đã thu tiền, Ghi nợ, Công nợ'],
    ['Phương thức thanh toán', 'CASH hoặc BANK', 'Có thể nhập: CASH/1111/Tiền mặt hoặc BANK/1121/Chuyển khoản (vẫn hỗ trợ 111/112 để tương thích dữ liệu cũ)'],
    ['Mã hàng / SKU', 'Khóa nhận diện mặt hàng ưu tiên', 'Khuyến nghị nhập SKU để hệ thống map đúng vật tư'],
    ['Tên mặt hàng', 'Tên vật tư/hàng hóa', 'Dùng làm phương án dự phòng nếu không có SKU'],
    ['Số lượng / Đơn giá', 'SL & đơn giá (có thể thập phân)', 'Hệ thống cộng theo dòng (decimal), làm tròn half-up đến đồng trên tổng phiếu / hóa đơn.'],
    ['Danh sách Serial/IMEI', 'Các serial của dòng hàng', type === 'IMPORT' ? 'Nhập nhiều serial cách nhau bằng dấu phẩy hoặc xuống dòng' : 'Xuất nhiều serial cách nhau bằng dấu phẩy hoặc xuống dòng'],
  ];

  if (type === 'IMPORT') {
    baseRows.splice(2, 0,
      ['Tên Nhà cung cấp', 'Tên NCC của phiếu nhập', 'Có thể chỉ điền ở dòng đầu, các dòng sau để trống hệ thống sẽ tự kế thừa'],
      ['Kho', 'Kho nhập/xuất thực tế', 'Có thể nhập mã kho hoặc tên kho giống trong Danh mục'],
      ['MST/CCCD Nhà cung cấp', 'Mã số thuế hoặc CCCD NCC', 'Có thể để trống'],
      ['Số điện thoại Nhà cung cấp', 'Thông tin liên hệ NCC', 'Có thể để trống'],
      ['Địa chỉ NCC', 'Địa chỉ nhà cung cấp', 'Có thể để trống'],
    );
  } else {
    baseRows.splice(2, 0,
      ['Mục đích xuất kho', 'Mã hoặc mô tả mục đích', 'Cho phép: 632, 641, 642, 154, 1541, 1542, 811, 331 hoặc đúng nhãn đầy đủ'],
      ['Kho', 'Kho xuất thực tế', 'Có thể nhập mã kho hoặc tên kho giống trong Danh mục'],
      ['Tên Khách hàng / Bộ phận', 'Đối tượng nhận hàng hoặc bộ phận sử dụng', 'Có thể chỉ điền ở dòng đầu, dòng sau để trống sẽ tự kế thừa'],
      ['MST/CCCD Khách hàng', 'Mã số thuế hoặc CCCD', 'Có thể để trống'],
      ['Số điện thoại liên hệ', 'Số điện thoại khách/bộ phận', 'Có thể để trống'],
      ['Địa chỉ nhận hàng / Lắp đặt', 'Địa chỉ giao hàng hoặc lắp đặt', 'Có thể để trống'],
    );
  }

  return baseRows;
}

function getTemplateMeta(type: StockActionImportType) {
  if (type === 'IMPORT') {
    return {
      headers: IMPORT_HEADERS,
      cols: IMPORT_COLS,
      fileName: 'Mau_Import_Nhap_Kho.xlsx',
      sheetName: 'NhapKho',
      sampleRows: [
        ['1', '2026-03-22 08:30', 'Admin', 'Kho Hà Nội', 'Công ty TNHH Victory Supplier', '0101234567', '0912345678', 'Hà Nội', 'NK-0001', '01GTKT0/001', '1C26TAA', 'PAID', 'BANK', 'GPS-001', 'Thiết bị định vị GT06', '2', '850000', '10', 'Nhập thiết bị đợt 1', 'IMEI001,IMEI002'],
        ['2', '', '', '', '', '', '', '', '', '', '', '', '', 'SIM-4G-001', 'Sim dữ liệu 4G', '2', '120000', '0', 'Nhập kèm sim cho lô trên', 'SIM001,SIM002'],
      ],
    };
  }

  return {
    headers: EXPORT_HEADERS,
    cols: EXPORT_COLS,
    fileName: 'Mau_Import_Xuat_Kho.xlsx',
    sheetName: 'XuatKho',
    sampleRows: [
      ['1', '2026-03-22 09:15', 'Admin', 'Kho Hà Nội', '632', 'Nguyễn Văn A', '0123456789', '0988888888', 'Hà Nội', 'XK-0001', '01GTKT0/001', '1C26TAA', 'PAID', 'BANK', 'GPS-001', 'Thiết bị định vị GT06', '2', '1200000', '10', 'Xuất lắp đặt xe khách A', 'IMEI001,IMEI002'],
      ['2', '', '', '', '', '', '', '', '', '', '', '', '', '', 'SIM-4G-001', 'Sim dữ liệu 4G', '2', '150000', '0', 'Xuất kèm sim cho thiết bị', 'SIM001,SIM002'],
    ],
  };
}

function detectHeaderRowIndex(rows: unknown[][]) {
  let bestIndex = -1;
  let bestScore = -1;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex++) {
    const normalizedCells = (rows[rowIndex] || [])
      .map((cell) => normalizeText(toCellText(cell)))
      .filter(Boolean);

    if (normalizedCells.length === 0) continue;

    let score = 0;
    Object.values(HEADER_ALIASES).forEach((aliases) => {
      if (aliases.some((alias) => normalizedCells.includes(alias))) score += 1;
    });

    const hasDate = HEADER_ALIASES.date.some((alias) => normalizedCells.includes(alias));
    const hasItem = HEADER_ALIASES.itemSku.some((alias) => normalizedCells.includes(alias))
      || HEADER_ALIASES.itemName.some((alias) => normalizedCells.includes(alias));
    if (hasDate && hasItem && score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }

  return bestIndex >= 0 ? bestIndex : 0;
}

function buildHeaderMap(headerRow: unknown[]) {
  const normalizedHeader = (headerRow || []).map((cell) => normalizeText(toCellText(cell)));
  const headerMap = new Map<string, number>();

  normalizedHeader.forEach((value, index) => {
    if (!value) return;
    headerMap.set(value, index);
  });

  return headerMap;
}

function pickCell(row: unknown[], headerMap: Map<string, number>, key: HeaderAliasKey, fallbackIndex: number) {
  const aliases = HEADER_ALIASES[key];
  const matched = aliases.find((alias) => headerMap.has(alias));
  if (matched) return row[headerMap.get(matched) ?? -1];
  return row[fallbackIndex];
}

function normalizePaymentStatus(value: unknown): 'PAID' | 'PENDING' {
  const normalized = normalizeText(String(toCellText(value) || ''));
  if (['paid', 'dathutien', 'datratien', 'thanhtoanngay'].includes(normalized)) return 'PAID';
  if (['pending', 'ghino', 'congno', 'dethu', 'detra'].includes(normalized)) return 'PENDING';
  return 'PENDING';
}

function normalizePaymentMethod(value: unknown): 'CASH' | 'BANK' {
  const normalized = normalizeText(String(toCellText(value) || ''));
  if (['bank', '112', '1121', 'chuyenkhoan', 'ck'].includes(normalized)) return 'BANK';
  if (['cash', '111', '1111', 'tienmat'].includes(normalized)) return 'CASH';
  return 'CASH';
}

function normalizeExportPurpose(value: unknown) {
  const text = String(toCellText(value) || '').trim();
  if (!text) return '632';

  const normalized = normalizeText(text);
  const exactCode = EXPORT_PURPOSES.find((purpose) => normalizeText(purpose.code) === normalized);
  if (exactCode) return exactCode.code;

  const matchedLabel = EXPORT_PURPOSES.find((purpose) => normalizeText(purpose.label).includes(normalized) || normalized.includes(normalizeText(purpose.label)));
  return matchedLabel?.code || text;
}

function buildItemLookups(items: InventoryItem[]) {
  return {
    bySku: new Map(
      (items || []).map((item) => [normalizeText(item.sku || ''), item]).filter(([key]) => Boolean(key)),
    ),
    byName: new Map(
      (items || []).map((item) => [normalizeText(item.name || ''), item]).filter(([key]) => Boolean(key)),
    ),
  };
}

function createEmptyDraft(type: StockActionImportType, defaultDateTime: string): StockActionImportDraft {
  return {
    date: defaultDateTime,
    performer: 'Admin',
    warehouseName: '',
    supplier: '',
    supplierTaxCode: '',
    supplierPhone: '',
    supplierAddress: '',
    customer: '',
    customerTaxCode: '',
    customerPhone: '',
    customerAddress: '',
    documentRef: '',
    formNo: '',
    symbolCode: '',
    paymentStatus: 'PENDING',
    paymentMethod: 'CASH',
    exportPurpose: type === 'EXPORT' ? '632' : '',
    lines: [],
  };
}

function buildBatchKey(type: StockActionImportType, draft: StockActionImportDraft) {
  return JSON.stringify([
    type,
    String(draft.date || '').trim(),
    normalizeText(String(draft.performer || '')),
    normalizeText(String(draft.warehouseName || '')),
    normalizeText(String(draft.supplier || '')),
    normalizeText(String(draft.supplierTaxCode || '')),
    normalizeText(String(draft.supplierPhone || '')),
    normalizeText(String(draft.supplierAddress || '')),
    normalizeText(String(draft.customer || '')),
    normalizeText(String(draft.customerTaxCode || '')),
    normalizeText(String(draft.customerPhone || '')),
    normalizeText(String(draft.customerAddress || '')),
    normalizeText(String(draft.documentRef || '')),
    normalizeText(String(draft.formNo || '')),
    normalizeText(String(draft.symbolCode || '')),
    draft.paymentStatus,
    draft.paymentMethod,
    normalizeText(String(draft.exportPurpose || '')),
  ]);
}

function parseRowToNormalized(headerMap: Map<string, number>, row: unknown[], type: StockActionImportType, xlsx: XlsxModule): NormalizedRow {
  const baseFallback = type === 'IMPORT'
    ? { itemSku: 13, itemName: 14, quantity: 15, price: 16, vatRate: 17, lineNote: 18, serials: 19 }
    : { itemSku: 14, itemName: 15, quantity: 16, price: 17, vatRate: 18, lineNote: 19, serials: 20 };

  return {
    date: parseDateTimeValue(pickCell(row, headerMap, 'date', 1), xlsx),
    performer: String(toCellText(pickCell(row, headerMap, 'performer', 2)) || ''),
    warehouse: String(toCellText(pickCell(row, headerMap, 'warehouse', 3)) || ''),
    supplier: type === 'IMPORT' ? String(toCellText(pickCell(row, headerMap, 'supplier', 4)) || '') : '',
    supplierTaxCode: type === 'IMPORT' ? String(toCellText(pickCell(row, headerMap, 'supplierTaxCode', 5)) || '') : '',
    supplierPhone: type === 'IMPORT' ? String(toCellText(pickCell(row, headerMap, 'supplierPhone', 6)) || '') : '',
    supplierAddress: type === 'IMPORT' ? String(toCellText(pickCell(row, headerMap, 'supplierAddress', 7)) || '') : '',
    exportPurpose: type === 'EXPORT' ? String(toCellText(pickCell(row, headerMap, 'exportPurpose', 4)) || '') : '',
    customer: type === 'EXPORT' ? String(toCellText(pickCell(row, headerMap, 'customer', 5)) || '') : '',
    customerTaxCode: type === 'EXPORT' ? String(toCellText(pickCell(row, headerMap, 'customerTaxCode', 6)) || '') : '',
    customerPhone: type === 'EXPORT' ? String(toCellText(pickCell(row, headerMap, 'customerPhone', 7)) || '') : '',
    customerAddress: type === 'EXPORT' ? String(toCellText(pickCell(row, headerMap, 'customerAddress', 8)) || '') : '',
    documentRef: String(toCellText(pickCell(row, headerMap, 'documentRef', type === 'IMPORT' ? 8 : 9)) || ''),
    formNo: String(toCellText(pickCell(row, headerMap, 'formNo', type === 'IMPORT' ? 9 : 10)) || ''),
    symbolCode: String(toCellText(pickCell(row, headerMap, 'symbolCode', type === 'IMPORT' ? 10 : 11)) || ''),
    paymentStatus: String(toCellText(pickCell(row, headerMap, 'paymentStatus', type === 'IMPORT' ? 11 : 12)) || ''),
    paymentMethod: String(toCellText(pickCell(row, headerMap, 'paymentMethod', type === 'IMPORT' ? 12 : 13)) || ''),
    itemSku: String(toCellText(pickCell(row, headerMap, 'itemSku', baseFallback.itemSku)) || ''),
    itemName: String(toCellText(pickCell(row, headerMap, 'itemName', baseFallback.itemName)) || ''),
    quantity: String(toCellText(pickCell(row, headerMap, 'quantity', baseFallback.quantity)) || ''),
    price: String(toCellText(pickCell(row, headerMap, 'price', baseFallback.price)) || ''),
    vatRate: String(toCellText(pickCell(row, headerMap, 'vatRate', baseFallback.vatRate)) || ''),
    lineNote: String(toCellText(pickCell(row, headerMap, 'lineNote', baseFallback.lineNote)) || ''),
    serials: String(toCellText(pickCell(row, headerMap, 'serials', baseFallback.serials)) || ''),
  };
}

export function downloadStockActionTemplate(type: StockActionImportType) {
  const meta = getTemplateMeta(type);
  const workbook = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.aoa_to_sheet([meta.headers, ...meta.sampleRows]);
  dataSheet['!cols'] = meta.cols;

  const guideSheet = XLSX.utils.aoa_to_sheet(buildGuideRows(type));
  guideSheet['!cols'] = [{ wch: 28 }, { wch: 40 }, { wch: 54 }];

  XLSX.utils.book_append_sheet(workbook, dataSheet, meta.sheetName);
  XLSX.utils.book_append_sheet(workbook, guideSheet, 'HuongDan');
  XLSX.writeFile(workbook, meta.fileName);
}

export async function parseStockActionImportFile(
  file: File,
  type: StockActionImportType,
  items: InventoryItem[],
  defaultDateTime: string,
  inventoryTransactions: InventoryTransaction[] = [],
): Promise<StockActionImportParseResult> {
  const XLSX = await loadXlsx();
  const workbook = file.name.toLowerCase().endsWith('.csv')
    ? XLSX.read(await file.text(), { type: 'string' })
    : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
  if (!sheet) {
    return {
      draft: createEmptyDraft(type, defaultDateTime),
      batches: [],
      skippedRows: ['Không tìm thấy sheet dữ liệu để import.'],
      warnings: [],
    };
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: true,
  });

  if (rawRows.length === 0) {
    return {
      draft: createEmptyDraft(type, defaultDateTime),
      batches: [],
      skippedRows: ['File import đang trống.'],
      warnings: [],
    };
  }

  const headerRowIndex = detectHeaderRowIndex(rawRows);
  const headerMap = buildHeaderMap(rawRows[headerRowIndex] || []);
  const itemLookups = buildItemLookups(items);
  const importSerialProvenance = buildSerialImportProvenanceMap(inventoryTransactions);
  const exportSerialProvenance = buildSerialExportProvenanceMap(inventoryTransactions);
  const fileSerialFirstSeen = new Map<string, FileSerialMeta>();
  const skippedRows: string[] = [];
  const warnings: string[] = [];
  const batches: StockActionImportDraft[] = [];
  const batchMap = new Map<string, StockActionImportDraft>();
  const previousHeaderValues: Record<string, string> = {};

  rawRows.slice(headerRowIndex + 1).forEach((row, index) => {
    const rowNumber = headerRowIndex + index + 2;
    const normalized = parseRowToNormalized(headerMap, row, type, XLSX);
    const lineHasContent = [normalized.itemSku, normalized.itemName, normalized.quantity, normalized.price, normalized.lineNote, normalized.serials]
      .some((value) => String(value || '').trim() !== '');
    const headerHasContent = [
      normalized.date,
      normalized.performer,
      normalized.warehouse,
      normalized.supplier,
      normalized.supplierTaxCode,
      normalized.supplierPhone,
      normalized.supplierAddress,
      normalized.exportPurpose,
      normalized.customer,
      normalized.customerTaxCode,
      normalized.customerPhone,
      normalized.customerAddress,
      normalized.documentRef,
      normalized.formNo,
      normalized.symbolCode,
      normalized.paymentStatus,
      normalized.paymentMethod,
    ].some((value) => String(value || '').trim() !== '');

    if (!lineHasContent && !headerHasContent) return;

    Object.entries(normalized).forEach(([key, value]) => {
      if (String(value || '').trim()) {
        previousHeaderValues[key] = value;
      } else if (!LINE_FIELD_KEYS.has(key)) {
        normalized[key] = previousHeaderValues[key] || '';
      }
    });

    if (!lineHasContent) return;

    const effectiveDraft = createEmptyDraft(type, defaultDateTime);
    effectiveDraft.date = normalized.date || defaultDateTime;
    effectiveDraft.performer = normalized.performer || 'Admin';
    effectiveDraft.warehouseName = normalized.warehouse || '';
    effectiveDraft.documentRef = normalized.documentRef || '';
    effectiveDraft.formNo = normalized.formNo || '';
    effectiveDraft.symbolCode = normalized.symbolCode || '';
    effectiveDraft.paymentStatus = normalizePaymentStatus(normalized.paymentStatus || '');
    effectiveDraft.paymentMethod = normalizePaymentMethod(normalized.paymentMethod || '');
    if (type === 'IMPORT') {
      effectiveDraft.supplier = normalized.supplier || '';
      effectiveDraft.supplierTaxCode = normalized.supplierTaxCode || '';
      effectiveDraft.supplierPhone = normalized.supplierPhone || '';
      effectiveDraft.supplierAddress = normalized.supplierAddress || '';
    } else {
      effectiveDraft.exportPurpose = normalizeExportPurpose(normalized.exportPurpose || '632');
      effectiveDraft.customer = normalized.customer || '';
      effectiveDraft.customerTaxCode = normalized.customerTaxCode || '';
      effectiveDraft.customerPhone = normalized.customerPhone || '';
      effectiveDraft.customerAddress = normalized.customerAddress || '';
    }

    const batchKey = buildBatchKey(type, effectiveDraft);
    let batch = batchMap.get(batchKey);
    if (!batch) {
      batch = { ...effectiveDraft, lines: [] };
      batchMap.set(batchKey, batch);
      batches.push(batch);
    }

    const skuKey = normalizeText(normalized.itemSku || '');
    const nameKey = normalizeText(normalized.itemName || '');
    const item = (skuKey ? itemLookups.bySku.get(skuKey) : undefined)
      || (nameKey ? itemLookups.byName.get(nameKey) : undefined);

    if (!item) {
      skippedRows.push(`Dòng ${rowNumber}: không tìm thấy mặt hàng theo SKU/Tên (${normalized.itemSku || normalized.itemName || 'trống'}).`);
      return;
    }

    const parsedQuantity = parseLooseNumber(normalized.quantity);
    const rawSerials = splitSerials(normalized.serials);
    const rowDateIso = normalized.date || defaultDateTime;
    const docRef = (normalized.documentRef || '').trim() || '(chưa ghi Số HĐ/CT)';
    const formNoRow = (normalized.formNo || '').trim();
    const symbolCodeRow = (normalized.symbolCode || '').trim();
    const rowDateDisplay = formatViDateTime(rowDateIso);

    const seenInRow = new Set<string>();
    const serialsForLine: string[] = [];
    for (const s of rawSerials) {
      const key = s.trim();
      if (!key) continue;

      if (seenInRow.has(key)) {
        warnings.push(
          `Dòng ${rowNumber} (${item.sku}): Serial/IMEI «${key}» lặp lại trong cùng một ô — Số HĐ/CT: ${docRef}, ngày ${rowDateDisplay}${invoiceSnippetSuffix(formNoRow, symbolCodeRow)}.`,
        );
        continue;
      }
      seenInRow.add(key);

      const prev = fileSerialFirstSeen.get(key);
      if (prev) {
        const fileActionLabel = type === 'IMPORT' ? 'nhập kho' : 'xuất kho';
        warnings.push(
          `Serial/IMEI «${key}» trùng trong file ${fileActionLabel}: lần 1 — dòng ${prev.rowNumber}, chứng từ «${prev.documentRef}», ngày ${formatViDateTime(prev.dateIso)}${invoiceSnippetSuffix(prev.formNo, prev.symbolCode)}; lần 2 — dòng ${rowNumber}, chứng từ «${docRef}», ngày ${rowDateDisplay}${invoiceSnippetSuffix(formNoRow, symbolCodeRow)}.`,
        );
      } else {
        fileSerialFirstSeen.set(key, {
          rowNumber,
          documentRef: docRef,
          dateIso: rowDateIso,
          formNo: formNoRow,
          symbolCode: symbolCodeRow,
        });
      }

      if (type === 'IMPORT') {
        const inStock = (item.serials || []).some((x) => String(x).trim() === key);
        if (inStock) {
          const trx = importSerialProvenance.get(`${item.id}\t${key}`);
          if (trx) {
            const inv = formatInvoiceSnippet(trx.formNo, trx.symbolCode);
            warnings.push(
              `Dòng ${rowNumber} (Nhập kho): Serial/IMEI «${key}» (${item.name}) đã có trên tồn — đã nhập trước tại chứng từ «${formatTrxDocumentRef(trx)}», ngày ${formatViDateTime(trx.date)}${inv ? `, ${inv}` : ''}.`,
            );
          } else {
            warnings.push(
              `Dòng ${rowNumber} (Nhập kho): Serial/IMEI «${key}» (${item.name}) đã có trên tồn nhưng không tìm thấy phiếu nhập tương ứng trong lịch sử kho.`,
            );
          }
        }
      }

      serialsForLine.push(s);
    }

    const derivedQuantity = parsedQuantity > 0 ? parsedQuantity : (serialsForLine.length > 0 ? serialsForLine.length : 0);
    if (derivedQuantity <= 0) {
      skippedRows.push(`Dòng ${rowNumber}: thiếu số lượng hợp lệ cho mặt hàng ${item.sku || item.name}.`);
      return;
    }

    const parsedPrice = parseLooseNumber(normalized.price);
    const fallbackPrice = type === 'IMPORT' ? Number(item.costPrice || 0) : Number(item.sellingPrice || 0);
    const finalPrice = parsedPrice > 0 ? parsedPrice : fallbackPrice;
    const vatRate = parseLooseNumber(normalized.vatRate);

    let serialInput = '';
    let selectedSerial: string[] = [];
    if (type === 'IMPORT') {
      serialInput = serialsForLine.join('\n');
      if (serialsForLine.length > 0 && parsedQuantity > 0 && parsedQuantity !== serialsForLine.length) {
        warnings.push(`Dòng ${rowNumber}: số lượng nhập và danh sách Serial chưa khớp, vui lòng kiểm tra lại trước khi ghi sổ.`);
      }
    } else {
      const stockSet = new Set((item.serials || []).map((serial) => serial.trim()));
      selectedSerial = serialsForLine.filter((serial) => stockSet.has(serial));
      const missingSerials = serialsForLine.filter((serial) => !stockSet.has(serial));
      if (missingSerials.length > 0) {
        const detail = missingSerials.map((ms) => {
          const k = ms.trim();
          const trx = exportSerialProvenance.get(`${item.id}\t${k}`);
          if (trx) {
            return `«${k}» (xuất kho trước: chứng từ «${formatTrxDocumentRef(trx)}», ngày ${formatViDateTime(trx.date)}${invoiceSnippetSuffix(trx.formNo || '', trx.symbolCode || '')})`;
          }
          return `«${k}»`;
        });
        warnings.push(
          `Dòng ${rowNumber} (Xuất kho, chứng từ ${docRef}, ngày ${rowDateDisplay}): Serial không còn trong kho «${item.name}»: ${detail.join('; ')}.`,
        );
      }
      if (serialsForLine.length === 0) {
        warnings.push(
          `Dòng ${rowNumber} (Xuất kho, chứng từ ${docRef}, ngày ${rowDateDisplay}): chưa có Serial xuất kho cho ${item.name}, cần bổ sung trong modal trước khi ghi sổ.`,
        );
      } else if (selectedSerial.length !== derivedQuantity) {
        warnings.push(
          `Dòng ${rowNumber} (Xuất kho, chứng từ ${docRef}, ngày ${rowDateDisplay}): số lượng xuất và danh sách Serial của ${item.name} chưa khớp.`,
        );
      }
    }

    batch.lines.push({
      id: String(batch.lines.length + 1),
      itemId: item.id,
      quantity: String(roundVnd(derivedQuantity)),
      price: String(finalPrice),
      vatRate,
      note: normalized.lineNote || '',
      serialInput,
      selectedSerial,
    });
  });

  batches.forEach((batch) => {
    batch.lines = batch.lines.map((line, lineIndex) => ({
      ...line,
      id: String(lineIndex + 1),
    }));
    if (type === 'EXPORT' && !batch.exportPurpose) {
      batch.exportPurpose = '632';
    }
  });

  return {
    draft: batches[0] || createEmptyDraft(type, defaultDateTime),
    batches,
    skippedRows,
    warnings,
  };
}
