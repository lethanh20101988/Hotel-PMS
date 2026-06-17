import { CompanyInfo, Invoice, InvoiceDetail } from '@shared/types';
import { loadXlsx, type XlsxModule } from '@shared/utils/lazyXlsx';
import { VAT_RATE_NOT_SUBJECT, vatAmountUnrounded } from '@shared/utils/vatRate';
import { roundInvoiceTotalsFromSums, roundVnd } from '@shared/utils/vndMoney';

/** Thuế suất (%): tối đa 2 chữ số thập phân — không áp dụng quy tắc làm tròn tiền VND. */
function roundVatPercent(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Tỷ giá / hệ số: giữ 2 chữ số thập phân (không làm tròn đồng). */
function roundScalar2dp(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export type InvoiceImportMode = 'SALES' | 'PURCHASE';
export type InvoiceImportCategory = 'DEVICE' | 'SERVICE';

export interface InvoiceImportDraft extends Omit<Invoice, 'id'> {}

export interface InvoiceImportParseResult {
  drafts: InvoiceImportDraft[];
  skippedRows: string[];
}

type NormalizedRow = Record<string, string>;

interface ParsedImportLine {
  rowNumber: number;
  formNo: string;
  symbolCode: string;
  invoiceNumber: string;
  date: string;
  partnerTaxCode: string;
  partnerName: string;
  partnerAddress: string;
  description: string;
  unit: string;
  quantity: number;
  amount: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  discountAmount: number;
  currency: string;
  exchangeRate?: number;
  sourceInvoiceStatus: string;
  sourceCheckResult: string;
  /** 1111 / 1121 / 131 / 331 — cột TK thanh toán trên mẫu Excel */
  paymentAccountCode?: string;
}

const TEMPLATE_HEADERS = [
  'STT',
  'Ký hiệu hóa đơn',
  'Số hóa đơn',
  'Ngày lập',
  'MST bên bán/MST người xuất hàng',
  'Tên người bán/Tên đơn vị xuất hàng',
  'Địa chỉ người bán',
  'MST người mua/MST người nhập hàng',
  'Tên người mua/Tên người bán hàng',
  'Nội dung',
  'Đơn vị tính',
  'Số lượng',
  'Tổng tiền chưa thuế',
  'Thuế suất (%)',
  'Tổng tiền thuế',
  'Tổng tiền chiết khấu thương mại',
  'Tổng tiền phải thanh toán',
  'Tổng tiền thanh toán',
  'Đơn vị tiền tệ',
  'Tỉ giá',
  'Trạng thái hóa đơn',
  'Kết quả kiểm tra hóa đơn',
  'TK thanh toán (1111/1121/131/331)',
];

const TEMPLATE_COLS = [
  { wch: 8 },
  { wch: 18 },
  { wch: 16 },
  { wch: 14 },
  { wch: 24 },
  { wch: 28 },
  { wch: 34 },
  { wch: 24 },
  { wch: 28 },
  { wch: 36 },
  { wch: 14 },
  { wch: 14 },
  { wch: 18 },
  { wch: 12 },
  { wch: 16 },
  { wch: 22 },
  { wch: 22 },
  { wch: 20 },
  { wch: 16 },
  { wch: 12 },
  { wch: 20 },
  { wch: 24 },
  { wch: 28 },
];

const HEADER_ALIASES = {
  formNo: ['mausohoadon', 'mauso'],
  symbolCode: ['kyhieuhoadon', 'kihieuhoadon', 'kyhieu'],
  invoiceNumber: ['sohoadon', 'sohd'],
  date: ['ngaylap', 'ngayhoadon', 'ngay'],
  sellerTaxCode: ['mstbenbanmstnguoixuathang', 'mstbenban', 'mstnguoixuathang'],
  sellerName: ['tennguoibantendonvixuathang', 'tennguoiban', 'tendonvixuathang'],
  sellerAddress: ['diachinguoiban', 'diachibenban', 'diachinguoixuathang'],
  buyerTaxCode: ['mstnguoimuamstnguoinhaphang', 'mstnguoimua', 'mstnguoinhaphang'],
  buyerName: ['tennguoimuatennguoibanhang', 'tennguoimua', 'tennguoibanhang'],
  description: ['noidung', 'diengiai', 'tenhanghoa', 'tenhanghoadichvu'],
  unit: ['donvitinh', 'dvt'],
  quantity: ['soluong', 'sl'],
  amount: ['tongtienchuathue', 'tienchuathue', 'thanhtienchuathue'],
  vatRate: ['thuesuat', 'thuesuatgtgt', 'thuegtgt', 'vatrate'],
  vatAmount: ['tongtienthue', 'tienthue', 'vatamount'],
  discountAmount: ['tongtienchietkhauthuongmai', 'chietkhauthuongmai', 'discountamount'],
  totalDue: ['tongtienphaithanhtoan', 'tongtienphai'],
  totalAmount: ['tongtienthanhtoan'],
  currency: ['donvitiente', 'loaitien'],
  exchangeRate: ['tigia', 'tygia', 'exchangerate'],
  sourceInvoiceStatus: ['trangthaihoadon'],
  sourceCheckResult: ['ketquakiemtrahoadon'],
  paymentAccount: [
    'tkthanhtoan11111121331331',
    'tkthanhtoan',
    'tktt',
    'taikhoanthanhtoan',
    'tkthanhtoancongno',
  ],
} as const;

const HEADER_GROUPS = Object.values(HEADER_ALIASES);
const POSITIONAL_HEADER_KEYS = [
  'stt',
  'kyhieuhoadon',
  'sohoadon',
  'ngaylap',
  'mstbenbanmstnguoixuathang',
  'tennguoibantendonvixuathang',
  'diachinguoiban',
  'mstnguoimuamstnguoinhaphang',
  'tennguoimuatennguoibanhang',
  'noidung',
  'donvitinh',
  'soluong',
  'tongtienchuathue',
  'thuesuat',
  'tongtienthue',
  'tongtienchietkhauthuongmai',
  'tongtienphaithanhtoan',
  'tongtienthanhtoan',
  'donvitiente',
  'tigia',
  'trangthaihoadon',
  'ketquakiemtrahoadon',
  'tkthanhtoan',
];

function detectHeaderRowIndex(rows: unknown[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
    const normalizedCells = (rows[rowIndex] || [])
      .map((cell) => normalizeText(toCellText(cell)))
      .filter(Boolean);

    if (normalizedCells.length === 0) continue;

    let score = 0;
    HEADER_GROUPS.forEach((aliases) => {
      if (aliases.some((alias) => normalizedCells.includes(alias))) score += 1;
    });

    const hasInvoice = HEADER_ALIASES.invoiceNumber.some((alias) => normalizedCells.includes(alias));
    const hasDate = HEADER_ALIASES.date.some((alias) => normalizedCells.includes(alias));
    if (hasInvoice && hasDate && score >= 4) return rowIndex;
  }

  return -1;
}

function countNonEmptyCells(row: unknown[]) {
  return (row || []).filter((cell) => String(toCellText(cell)).trim() !== '').length;
}

function trimLeadingEmptyCells(row: unknown[]) {
  const cells = [...(row || [])];
  while (cells.length > 0 && String(toCellText(cells[0])).trim() === '') {
    cells.shift();
  }
  return cells;
}

function looksLikeDataRow(row: unknown[], xlsx: XlsxModule) {
  const cells = trimLeadingEmptyCells(row);
  if (cells.length < 10) return false;
  const invoiceNumber = toCellText(cells[2] ?? '');
  const date = parseDateValue(cells[3] ?? '', xlsx);
  const amount = parseLooseNumber(cells[12] ?? '');
  const description = toCellText(cells[9] ?? '');
  return !!invoiceNumber && !!date && !!description && amount >= 0;
}

function findStructuredRowIndex(rows: unknown[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
    if (countNonEmptyCells(rows[rowIndex] || []) >= 8) return rowIndex;
  }
  return -1;
}

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
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function parseLooseNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  let text = toCellText(value);
  if (!text) return 0;

  text = text.replace(/\s+/g, '').replace(/%/g, '');

  if (/^\d{5,}$/.test(text)) {
    return Number(text);
  }

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = text.split(',');
    text = parts.length === 2 && parts[1].length <= 2
      ? text.replace(',', '.')
      : text.replace(/,/g, '');
  } else if (hasDot) {
    const parts = text.split('.');
    text = parts.length === 2 && parts[1].length <= 2
      ? text
      : text.replace(/\./g, '');
  }

  text = text.replace(/[^0-9.-]/g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseVatRate(value: unknown) {
  const text = toCellText(value).trim().toLowerCase();
  if (text === 'kct' || text.includes('không chịu') || text.includes('khong chiu')) {
    return VAT_RATE_NOT_SUBJECT;
  }
  const raw = parseLooseNumber(value);
  if (raw === VAT_RATE_NOT_SUBJECT) return VAT_RATE_NOT_SUBJECT;
  if (!raw) return 0;
  if (raw > 0 && raw < 1) return roundVatPercent(raw * 100);
  return roundVatPercent(raw);
}

/** Nhận 1111, 1121, 131, 331 từ cột TK thanh toán. */
export function parsePaymentTkAccount(raw: unknown): '1111' | '1121' | '131' | '331' | undefined {
  const t = toCellText(raw).trim();
  if (!t) return undefined;
  const m = t.match(/\b(1111|1121|131|331)\b/);
  if (!m) return undefined;
  return m[1] as '1111' | '1121' | '131' | '331';
}

function parseDateValue(value: unknown, xlsx: XlsxModule) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = toCellText(value);
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }

  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(text)) {
    const [day, month, year] = text.split(/[/-]/).map((part) => Number(part));
    if (!day || !month || !year) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  if (/^\d{5,}$/.test(text)) {
    const parsed = xlsx.SSF.parse_date_code(Number(text));
    if (!parsed) return null;
    const year = String(parsed.y).padStart(4, '0');
    const month = String(parsed.m).padStart(2, '0');
    const day = String(parsed.d).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const fallback = new Date(text);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString().slice(0, 10);
  }

  return null;
}

function pickValue(row: NormalizedRow, aliases: readonly string[]) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function normalizeWorkbookRow(rawRow: Record<string, unknown>) {
  const row: NormalizedRow = {};
  Object.entries(rawRow).forEach(([key, value]) => {
    const normalized = normalizeText(key);
    if (!normalized) return;
    row[normalized] = toCellText(value);
  });
  return row;
}

function buildTemplateRows(
  mode: InvoiceImportMode,
  category: InvoiceImportCategory,
  companyInfo: CompanyInfo,
) {
  const sellerName = companyInfo.name || 'Công ty Victory';
  const sellerTaxCode = companyInfo.taxCode || '0109238339';
  const sellerAddress = companyInfo.address || 'Hà Nội';
  const buyerName = mode === 'SALES' ? 'Công ty TNHH Khách hàng mẫu' : sellerName;
  const buyerTaxCode = mode === 'SALES' ? '0312345678' : sellerTaxCode;
  const itemName = category === 'SERVICE'
    ? (mode === 'SALES' ? 'Phí dịch vụ giám sát hành trình tháng 03/2026' : 'Chi phí thuê dịch vụ triển khai hệ thống')
    : (mode === 'SALES' ? 'Thiết bị định vị GPS GT06' : 'Thiết bị camera hành trình X5');
  const sellerSampleName = mode === 'PURCHASE' ? 'Công ty TNHH Nhà cung cấp mẫu' : sellerName;
  const sellerSampleTax = mode === 'PURCHASE' ? '0101112223' : sellerTaxCode;
  const sellerSampleAddress = mode === 'PURCHASE' ? 'Số 12 Trần Duy Hưng, Hà Nội' : sellerAddress;
  const buyerSampleName = mode === 'SALES' ? buyerName : sellerName;
  const buyerSampleTax = mode === 'SALES' ? buyerTaxCode : sellerTaxCode;
  const quantity = category === 'SERVICE' ? 1 : 2;
  const amount = category === 'SERVICE' ? 1500000 : 6000000;
  const vatRate = 10;
  const vatAmount = vatAmountUnrounded(amount, vatRate);
  const total = amount + vatAmount;

  return [[
    '1',
    mode === 'SALES' ? '1C26TVT' : '1C26NCC',
    mode === 'SALES' ? '0000123' : '0000456',
    '2026-03-22',
    sellerSampleTax,
    sellerSampleName,
    sellerSampleAddress,
    buyerSampleTax,
    buyerSampleName,
    itemName,
    category === 'SERVICE' ? 'Lần' : 'Cái',
    String(quantity),
    String(amount),
    String(vatRate),
    String(vatAmount),
    '0',
    String(total),
    String(total),
    'VND',
    '1',
    'Hợp lệ',
    'Đã kiểm tra',
    mode === 'PURCHASE' ? '331' : '1121',
  ]];
}

export async function downloadInvoiceImportTemplate(options: {
  mode: InvoiceImportMode;
  category: InvoiceImportCategory;
  companyInfo: CompanyInfo;
}) {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ...buildTemplateRows(options.mode, options.category, options.companyInfo),
  ]);
  sheet['!cols'] = TEMPLATE_COLS;
  XLSX.utils.book_append_sheet(workbook, sheet, 'HoaDonVAT');

  const modeLabel = options.mode === 'SALES' ? 'Ban' : 'Mua';
  const categoryLabel = options.category === 'SERVICE' ? 'Dich_Vu' : 'Thiet_Bi';
  XLSX.writeFile(workbook, `Mau_Import_Hoa_Don_${modeLabel}_${categoryLabel}.xlsx`);
}

function parseImportLine(
  row: NormalizedRow,
  rowNumber: number,
  mode: InvoiceImportMode,
  category: InvoiceImportCategory,
  xlsx: XlsxModule,
): { line?: ParsedImportLine; error?: string } {
  const invoiceNumber = pickValue(row, HEADER_ALIASES.invoiceNumber);
  if (!invoiceNumber) {
    return { error: `Dòng ${rowNumber}: thiếu số hóa đơn.` };
  }

  const date = parseDateValue(pickValue(row, HEADER_ALIASES.date), xlsx);
  if (!date) {
    return { error: `Dòng ${rowNumber}: ngày lập không hợp lệ.` };
  }

  const sellerTaxCode = pickValue(row, HEADER_ALIASES.sellerTaxCode);
  const sellerName = pickValue(row, HEADER_ALIASES.sellerName);
  const sellerAddress = pickValue(row, HEADER_ALIASES.sellerAddress);
  const buyerTaxCode = pickValue(row, HEADER_ALIASES.buyerTaxCode);
  const buyerName = pickValue(row, HEADER_ALIASES.buyerName);

  const partnerTaxCode = mode === 'PURCHASE' ? sellerTaxCode : buyerTaxCode;
  const partnerName = (mode === 'PURCHASE' ? sellerName : buyerName)
    || (mode === 'SALES' ? 'Khách lẻ' : 'Nhà cung cấp chưa rõ');
  const partnerAddress = mode === 'PURCHASE' ? sellerAddress : '';

  let amount = parseLooseNumber(pickValue(row, HEADER_ALIASES.amount));
  let vatAmount = parseLooseNumber(pickValue(row, HEADER_ALIASES.vatAmount));
  let discountAmount = parseLooseNumber(pickValue(row, HEADER_ALIASES.discountAmount));
  const totalDue = parseLooseNumber(pickValue(row, HEADER_ALIASES.totalDue));
  const explicitTotal = parseLooseNumber(pickValue(row, HEADER_ALIASES.totalAmount)) || totalDue;

  if (!amount && explicitTotal) {
    amount = Math.max(0, explicitTotal - vatAmount);
  } else if (!explicitTotal && discountAmount > 0) {
    amount = Math.max(0, amount - discountAmount);
  }

  let vatRate = parseVatRate(pickValue(row, HEADER_ALIASES.vatRate));
  if (!vatAmount && amount > 0 && vatRate > 0) {
    vatAmount = vatAmountUnrounded(amount, vatRate);
  } else if (!vatRate && amount > 0 && vatAmount > 0) {
    vatRate = roundVatPercent((vatAmount / amount) * 100);
  }

  if (!amount && !explicitTotal) {
    return { error: `Dòng ${rowNumber}: thiếu tổng tiền chưa thuế hoặc tổng tiền thanh toán.` };
  }

  const rawQty = parseLooseNumber(pickValue(row, HEADER_ALIASES.quantity));
  const quantity = rawQty > 0 ? rawQty : 1;
  const description = pickValue(row, HEADER_ALIASES.description)
    || (category === 'SERVICE' ? 'Dịch vụ nhập từ Excel' : 'Hàng hóa nhập từ Excel');
  const totalAmount = explicitTotal || amount + vatAmount;
  const currency = pickValue(row, HEADER_ALIASES.currency) || 'VND';
  const exchangeRate = roundScalar2dp(parseLooseNumber(pickValue(row, HEADER_ALIASES.exchangeRate)));

  return {
    line: {
      rowNumber,
      formNo: pickValue(row, HEADER_ALIASES.formNo),
      symbolCode: pickValue(row, HEADER_ALIASES.symbolCode),
      invoiceNumber,
      date,
      partnerTaxCode,
      partnerName,
      partnerAddress,
      description,
      unit: pickValue(row, HEADER_ALIASES.unit) || (category === 'SERVICE' ? 'Lần' : 'Cái'),
      quantity,
      amount,
      vatRate,
      vatAmount,
      totalAmount,
      discountAmount,
      currency,
      exchangeRate: exchangeRate > 0 ? exchangeRate : undefined,
      sourceInvoiceStatus: pickValue(row, HEADER_ALIASES.sourceInvoiceStatus),
      sourceCheckResult: pickValue(row, HEADER_ALIASES.sourceCheckResult),
      paymentAccountCode: parsePaymentTkAccount(pickValue(row, HEADER_ALIASES.paymentAccount)),
    },
  };
}

export async function parseInvoiceImportFile(
  file: File,
  options: { mode: InvoiceImportMode; category: InvoiceImportCategory },
): Promise<InvoiceImportParseResult> {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
  });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!sheet) {
    return {
      drafts: [],
      skippedRows: ['Không tìm thấy sheet dữ liệu trong file Excel.'],
    };
  }

  const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });
  const headerRowIndex = detectHeaderRowIndex(rawMatrix);
  const structuredRowIndex = findStructuredRowIndex(rawMatrix);
  if (headerRowIndex < 0 && structuredRowIndex < 0) {
    return {
      drafts: [],
      skippedRows: ['Không nhận diện được dòng tiêu đề. Vui lòng dùng đúng mẫu Excel hoặc giữ lại hàng tiêu đề cột.'],
    };
  }

  const useNamedHeader = headerRowIndex >= 0;
  const effectiveHeaderRowIndex = useNamedHeader ? headerRowIndex : structuredRowIndex;
  const headerRow = useNamedHeader
    ? (rawMatrix[effectiveHeaderRowIndex] || []).map((cell) => normalizeText(toCellText(cell)))
    : POSITIONAL_HEADER_KEYS;
  const startDataRowIndex = useNamedHeader
    ? effectiveHeaderRowIndex + 1
    : (looksLikeDataRow(rawMatrix[effectiveHeaderRowIndex] || [], XLSX) ? effectiveHeaderRowIndex : effectiveHeaderRowIndex + 1);
  const dataRows = rawMatrix.slice(startDataRowIndex);

  const parsedLines: ParsedImportLine[] = [];
  const skippedRows: string[] = [];

  dataRows.forEach((rawRow, index) => {
    const normalizedSource: Record<string, unknown> = {};
    const cells = useNamedHeader ? (rawRow || []) : trimLeadingEmptyCells(rawRow || []);
    cells.forEach((cell, cellIndex) => {
      const key = headerRow[cellIndex];
      if (!key) return;
      normalizedSource[key] = cell;
    });

    const normalized = normalizeWorkbookRow(normalizedSource);
    const hasAnyData = Object.values(normalized).some((value) => String(value).trim() !== '');
    if (!hasAnyData) return;

    const rowNumber = startDataRowIndex + index + 1;
    const parsed = parseImportLine(normalized, rowNumber, options.mode, options.category, XLSX);
    if (parsed.error) {
      skippedRows.push(parsed.error);
      return;
    }
    if (parsed.line) parsedLines.push(parsed.line);
  });

  /** Suy trạng thái thanh toán: ưu tiên cột TK (1111/1121/131/331), sau đó cột Trạng thái / Kết quả kiểm tra. */
  const inferImportPaymentStatus = (lines: ParsedImportLine[]): {
    status: 'PAID' | 'PENDING';
    paymentMethod: string;
    paymentDate?: string;
  } => {
    const explicitTk = lines.map((l) => l.paymentAccountCode).find(Boolean);
    if (explicitTk === '1111') {
      return { status: 'PAID', paymentMethod: 'Tiền mặt', paymentDate: lines[0]?.date };
    }
    if (explicitTk === '1121') {
      return { status: 'PAID', paymentMethod: 'Chuyển khoản', paymentDate: lines[0]?.date };
    }
    if (explicitTk === '131' || explicitTk === '331') {
      return { status: 'PENDING', paymentMethod: 'Công nợ', paymentDate: undefined };
    }

    const combined = lines
      .map((l) => [l.sourceInvoiceStatus || '', l.sourceCheckResult || ''].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' | ')
      .trim();
    if (!combined) return { status: 'PENDING', paymentMethod: 'Công nợ' };
    const lower = combined.toLowerCase();
    const norm = combined
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const looksPaid =
      /da\s*thanh\s*toan|da\s*tt\b|paid|thanh\s*toan\s*du|hop\s*le/.test(norm) ||
      /(đã|da)\s*(thanh\s*toán|thanh toan)/i.test(combined) ||
      /\b(1111|1121)\b/.test(combined) ||
      /chuyen\s*khoan|chuyển\s*khoản|ngan\s*hang|ngân\s*hàng|tien\s*mat|tiền\s*mặt|uy\s*nhiem\s*chi|ủy\s*nhiệm\s*chi|unc\b|báo\s*có|bao\s*co/i.test(combined);

    if (!looksPaid) return { status: 'PENDING', paymentMethod: 'Công nợ' };

    let paymentMethod = 'Tiền mặt';
    if (
      /\b1121\b/.test(combined) ||
      /chuyen\s*khoan|chuyển\s*khoản|ngan\s*hang|ngân\s*hàng|bank\b|unc|uy\s*nhiem\s*chi|ủy\s*nhiệm\s*chi|bao\s*co|báo\s*có/.test(lower)
    ) {
      paymentMethod = 'Chuyển khoản';
    } else if (/\b1111\b/.test(combined) || /tien\s*mat|tiền\s*mặt|cash|phieu\s*thu|phiếu\s*thu|pt\b|pc\b/.test(lower)) {
      paymentMethod = 'Tiền mặt';
    }

    return {
      status: 'PAID',
      paymentMethod,
      paymentDate: lines[0]?.date,
    };
  };

  const groups = new Map<string, ParsedImportLine[]>();
  parsedLines.forEach((line) => {
    const key = [
      normalizeText(line.symbolCode || ''),
      normalizeText(line.invoiceNumber),
      line.date,
      normalizeText(line.partnerTaxCode || ''),
      normalizeText(line.partnerName || ''),
    ].join('|');

    const existing = groups.get(key);
    if (existing) {
      existing.push(line);
    } else {
      groups.set(key, [line]);
    }
  });

  const drafts: InvoiceImportDraft[] = Array.from(groups.values()).map((lines, groupIndex) => {
    const first = lines[0];
    const account = options.mode === 'PURCHASE'
      ? (options.category === 'SERVICE' ? '154' : '156')
      : '';
    const detailType: InvoiceDetail['type'] = options.category === 'SERVICE' ? 'SERVICE' : 'GOODS';

    const details: InvoiceDetail[] = lines.map((line, lineIndex) => {
      const unitPrice = line.quantity > 0 ? line.amount / line.quantity : line.amount;
      const noteParts = [
        line.discountAmount > 0 ? `Chiết khấu thương mại: ${line.discountAmount.toLocaleString('vi-VN')}` : '',
        line.sourceInvoiceStatus ? `Trạng thái HĐ nguồn: ${line.sourceInvoiceStatus}` : '',
        line.sourceCheckResult ? `KQ kiểm tra HĐ: ${line.sourceCheckResult}` : '',
      ].filter(Boolean);

      return {
        id: `IMP-${Date.now()}-${groupIndex}-${lineIndex}`,
        productName: line.description,
        type: detailType,
        unit: line.unit,
        quantity: line.quantity,
        price: unitPrice,
        amount: line.amount,
        vatRate: line.vatRate,
        vatAmount: vatAmountUnrounded(line.amount, line.vatRate),
        isPromotion: false,
        account,
        note: noteParts.length > 0 ? noteParts.join(' | ') : undefined,
      };
    });

    const sumNet = details.reduce((sum, detail) => sum + Number(detail.amount || 0), 0);
    const sumVat = details.reduce((sum, detail) => sum + Number(detail.vatAmount || 0), 0);
    const { amount, vatAmount, totalAmount } = roundInvoiceTotalsFromSums(sumNet, sumVat);
    const vatRates = Array.from(
      new Set(details.map((detail) => roundVatPercent(Number(detail.vatRate || 0))).filter((value) => Number.isFinite(value))),
    );
    const discountAmount = roundVnd(lines.reduce((sum, line) => sum + Number(line.discountAmount || 0), 0));
    const description = details.map((detail) => detail.productName).join('; ');
    const payInf = inferImportPaymentStatus(lines);

    return {
      relatedId: undefined,
      previousExpiryDate: undefined,
      formNo: first.formNo || undefined,
      invoiceNumber: first.invoiceNumber,
      symbolCode: first.symbolCode || undefined,
      date: first.date,
      customerName: first.partnerName,
      buyerUnitName: first.partnerName,
      buyerTaxCode: first.partnerTaxCode || undefined,
      buyerAddress: first.partnerAddress || undefined,
      buyerLegalName: undefined,
      buyerEmail: undefined,
      buyerPhone: undefined,
      description,
      amount,
      vatRate: vatRates.length === 1 ? vatRates[0] : 0,
      vatAmount,
      totalAmount,
      type: options.mode,
      category: options.category,
      status: payInf.status,
      paymentMethod: payInf.paymentMethod,
      paymentDate: payInf.status === 'PAID' ? (payInf.paymentDate || first.date) : undefined,
      importedFromExcel: true,
      currency: first.currency || 'VND',
      exchangeRate: first.exchangeRate,
      discountAmount: discountAmount > 0 ? discountAmount : undefined,
      sourceInvoiceStatus: first.sourceInvoiceStatus || undefined,
      sourceCheckResult: first.sourceCheckResult || undefined,
      details,
      unit: details.length === 1 ? details[0].unit : undefined,
      quantity: details.length === 1 ? details[0].quantity : undefined,
    };
  });

  return { drafts, skippedRows };
}
