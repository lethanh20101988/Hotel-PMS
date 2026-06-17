import { Device, DeviceStatus, DeviceType } from '@shared/types';
import { loadXlsx } from '@shared/utils/lazyXlsx';

const TEMPLATE_HEADERS = [
  'STT',
  'Tên thiết bị',
  'Loại thiết bị',
  'IMEI',
  'Serial Number',
  'Biển số xe',
  'SDT Sim',
  'Nhà cung cấp',
  'Gói viễn thông',
  'Tên khách hàng',
  'SDT khách hàng',
  'Tài khoản đăng nhập',
  'Phí gia hạn (VND)',
  'VAT (%)',
];

const TEMPLATE_COLS = [
  { wch: 8 },
  { wch: 24 },
  { wch: 18 },
  { wch: 18 },
  { wch: 18 },
  { wch: 14 },
  { wch: 14 },
  { wch: 20 },
  { wch: 18 },
  { wch: 22 },
  { wch: 16 },
  { wch: 20 },
  { wch: 18 },
  { wch: 10 },
];

const SAMPLE_ROWS = [
  ['1', 'Thiết bị định vị GT06', 'GPS Tracker', '861234567890123', 'SN2024001', '29A-123.45', '0912345678', 'Victory Tech', 'B2VIP', 'Nguyễn Văn An', '0988888888', 'vtr_admin01', '600000', '10'],
  ['2', 'Camera hành trình X5', 'Camera', '351234567890456', 'CAM-9988', '30H-999.99', '0977123456', 'VTR Solutions', 'CAM_FREE', 'Trần Thị Bình', '0966555444', 'user_cam_02', '1200000', '10'],
];

const HEADER_ALIASES = {
  name: ['tenthietbi', 'tenthietbikhachhang'],
  type: ['loaithietbi', 'loai'],
  imei: ['imei'],
  serial: ['serialnumber', 'serial'],
  licensePlate: ['biensoxe', 'bienso'],
  phoneNumber: ['sdtsim', 'simsdt', 'sdtthietbi'],
  provider: ['nhacungcap', 'ncc'],
  telecomPlan: ['goivienthong', 'goicuocvienthong', 'goicuoc'],
  customerName: ['tenkhachhang', 'tenkh'],
  customerPhone: ['sdtkhachhang', 'dienthoaikhachhang'],
  username: ['taikhoandangnhap', 'tentaikhoandangnhap', 'username'],
  renewalFee: ['phigiahanvnd', 'phigiahan', 'renewalfee'],
  vatRate: ['vat', 'thuesuat', 'vatrate'],
} as const;

const POSITIONAL_KEYS = [
  'stt',
  'tenthietbi',
  'loaithietbi',
  'imei',
  'serialnumber',
  'biensoxe',
  'sdtsim',
  'nhacungcap',
  'goivienthong',
  'tenkhachhang',
  'sdtkhachhang',
  'taikhoandangnhap',
  'phigiahanvnd',
  'vat',
];

export interface DeviceImportParseResult {
  devices: Device[];
  skippedRows: string[];
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

  const text = toCellText(value)
    .replace(/\s+/g, '')
    .replace(/%/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(/,/g, '.');

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function detectHeaderRowIndex(rows: unknown[][]) {
  let bestScore = -1;
  let bestIndex = -1;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 10); rowIndex++) {
    const normalizedCells = (rows[rowIndex] || [])
      .map((cell) => normalizeText(toCellText(cell)))
      .filter(Boolean);

    if (normalizedCells.length === 0) continue;

    let score = 0;
    Object.values(HEADER_ALIASES).forEach((aliases) => {
      if (aliases.some((alias) => normalizedCells.includes(alias))) score += 1;
    });

    const hasName = HEADER_ALIASES.name.some((alias) => normalizedCells.includes(alias));
    const hasImei = HEADER_ALIASES.imei.some((alias) => normalizedCells.includes(alias));
    if (hasName && hasImei && score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }

  return bestIndex >= 0 ? bestIndex : 0;
}

function buildHeaderMap(headerRow: unknown[]) {
  const normalizedHeader = (headerRow || []).map((cell) => normalizeText(toCellText(cell)));
  const map = new Map<string, number>();

  normalizedHeader.forEach((cell, index) => {
    if (!cell) return;
    map.set(cell, index);
  });

  return map;
}

function pickCell(row: unknown[], headerMap: Map<string, number>, aliases: readonly string[], fallbackIndex: number) {
  const aliasHit = aliases.find((alias) => headerMap.has(alias));
  if (aliasHit) return row[headerMap.get(aliasHit) ?? -1];
  return row[fallbackIndex];
}

function createDeviceId(rowIndex: number) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `DEVICE-${Date.now()}-${rowIndex + 1}`;
}

function parseDeviceType(value: unknown) {
  const normalized = normalizeText(toCellText(value));
  if (normalized.includes('camera') || normalized.includes('cam')) return DeviceType.CAMERA;
  return DeviceType.GPS;
}

function createImportedDevice(row: unknown[], headerMap: Map<string, number>, rowIndex: number): Device | null {
  const name = toCellText(pickCell(row, headerMap, HEADER_ALIASES.name, 1));
  const imei = toCellText(pickCell(row, headerMap, HEADER_ALIASES.imei, 3));
  const serial = toCellText(pickCell(row, headerMap, HEADER_ALIASES.serial, 4));
  const customerName = toCellText(pickCell(row, headerMap, HEADER_ALIASES.customerName, 9));
  const licensePlate = toCellText(pickCell(row, headerMap, HEADER_ALIASES.licensePlate, 5));

  if (!name && !imei && !serial && !customerName && !licensePlate) return null;

  const today = new Date();
  const activationDate = today.toISOString().slice(0, 10);
  const expiryDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()).toISOString().slice(0, 10);

  return {
    id: createDeviceId(rowIndex),
    name: name || 'Thiết bị mới',
    type: parseDeviceType(pickCell(row, headerMap, HEADER_ALIASES.type, 2)),
    imei,
    serial,
    licensePlate,
    phoneNumber: toCellText(pickCell(row, headerMap, HEADER_ALIASES.phoneNumber, 6)),
    provider: toCellText(pickCell(row, headerMap, HEADER_ALIASES.provider, 7)),
    telecomPlan: toCellText(pickCell(row, headerMap, HEADER_ALIASES.telecomPlan, 8)),
    activationDate,
    expiryDate,
    status: DeviceStatus.ACTIVE,
    customerName: customerName || 'Khách lẻ',
    customerPhone: toCellText(pickCell(row, headerMap, HEADER_ALIASES.customerPhone, 10)),
    username: toCellText(pickCell(row, headerMap, HEADER_ALIASES.username, 11)),
    planName: 'Nhập từ Excel',
    renewalFee: parseLooseNumber(pickCell(row, headerMap, HEADER_ALIASES.renewalFee, 12)),
    vatRate: parseLooseNumber(pickCell(row, headerMap, HEADER_ALIASES.vatRate, 13)) || 10,
  };
}

export function downloadDeviceImportTemplate() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...SAMPLE_ROWS]);
  sheet['!cols'] = TEMPLATE_COLS;
  XLSX.utils.book_append_sheet(workbook, sheet, 'ThietBiGiaHan');
  XLSX.writeFile(workbook, 'Mau_Import_Thiet_Bi_Gia_Han.xlsx');
}

export async function parseDeviceImportFile(file: File): Promise<DeviceImportParseResult> {
  const XLSX = await loadXlsx();
  const fileName = file.name.toLowerCase();
  const workbook = fileName.endsWith('.csv')
    ? XLSX.read(await file.text(), { type: 'string' })
    : XLSX.read(await file.arrayBuffer(), {
        type: 'array',
        cellDates: true,
      });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
  if (!sheet) {
    return { devices: [], skippedRows: ['Không tìm thấy sheet dữ liệu trong file import.'] };
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  });

  if (rawRows.length === 0) {
    return { devices: [], skippedRows: ['File import đang trống.'] };
  }

  const headerRowIndex = detectHeaderRowIndex(rawRows);
  const headerMap = buildHeaderMap(rawRows[headerRowIndex] || []);

  // Backward-compatible fallback for files that still follow the old fixed column order.
  POSITIONAL_KEYS.forEach((key, index) => {
    if (!headerMap.has(key)) headerMap.set(key, index);
  });

  const devices: Device[] = [];
  const skippedRows: string[] = [];

  rawRows.slice(headerRowIndex + 1).forEach((row, index) => {
    const device = createImportedDevice(row, headerMap, index);
    if (device) {
      devices.push(device);
    } else {
      skippedRows.push(`Dòng ${headerRowIndex + index + 2}: không có dữ liệu thiết bị hợp lệ.`);
    }
  });

  return { devices, skippedRows };
}
