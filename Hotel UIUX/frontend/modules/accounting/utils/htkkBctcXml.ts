import type { AccountDefinition, CompanyInfo, FinancialYear, JournalEntry } from '@shared/types';
import {
  computeBalanceSheetData,
  computeIncomeStatementData,
  computeTrialBalanceData,
  htkkBctcFileName,
} from './financialReportData';

const HTKK_XML_VERSION = '2.3.2';
const HTKK_MA_TKHAI_B01B = '843';

const escapeXml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const xmlEl = (tag: string, value: string | number | boolean | null | undefined, indent = 2) => {
  if (value === null || value === undefined || value === '') return '';
  const pad = ' '.repeat(indent);
  const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  return `${pad}<${tag}>${escapeXml(text)}</${tag}>\n`;
};

const roundVnd = (n: number) => Math.round(Number.isFinite(n) ? n : 0);

/** HTKK: số nguyên VND, không thập phân */
const vnd = (n: number) => String(roundVnd(n));

const formatDateVi = (iso: string) => {
  const [y, m, d] = String(iso || '').split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

const formatDateIso = (iso: string) => {
  const [y, m, d] = String(iso || '').split('-');
  if (!y || !m || !d) return iso;
  return `${y}-${m}-${d}`;
};

const B01B_MA_SO_LIST = [
  '100', '110', '120', '121', '122', '123', '130', '131', '132', '133', '134', '135',
  '140', '141', '142', '150', '151', '152',
  '200', '210', '211', '212', '213', '214', '215', '220', '221', '222', '230', '231', '232',
  '240', '250', '251', '252', '253', '260', '300',
  '400', '410', '411', '412', '413', '414', '415', '416', '417', '418', '420',
  '421', '422', '423', '424', '425', '426', '427',
  '500', '511', '512', '513', '514', '515', '516', '517', '600',
];

const B02_MA_SO_LIST = ['01', '02', '10', '11', '20', '21', '22', '23', '24', '30', '31', '32', '40', '50', '51', '60'];

function buildPlB01b(endByCode: Record<string, number>, beginByCode: Record<string, number>): string {
  let out = '    <PL_B01b_DNN>\n';
  for (const maSo of B01B_MA_SO_LIST) {
    const cuoiKy = endByCode[maSo] ?? 0;
    const dauKy = beginByCode[maSo] ?? 0;
    out += xmlEl(`ct${maSo}_dauKy`, vnd(dauKy), 6);
    out += xmlEl(`ct${maSo}`, vnd(cuoiKy), 6);
  }
  out += '    </PL_B01b_DNN>\n';
  return out;
}

function buildPlB02(rows: ReturnType<typeof computeIncomeStatementData>): string {
  const byCode = Object.fromEntries(rows.map((r) => [r.code, r.value]));
  let out = '    <PL_B02_DNN>\n';
  for (const maSo of B02_MA_SO_LIST) {
    out += xmlEl(`ct${maSo}`, vnd(byCode[maSo] ?? 0), 6);
  }
  out += '    </PL_B02_DNN>\n';
  return out;
}

function buildPlF01(trialData: ReturnType<typeof computeTrialBalanceData>): string {
  let out = '    <PL_F01_DNN>\n';
  for (const row of trialData.rows) {
    const hasValue =
      row.openingDebit ||
      row.openingCredit ||
      row.periodDebit ||
      row.periodCredit ||
      row.closingDebit ||
      row.closingCredit;
    if (!hasValue) continue;
    out += '      <ChiTieu>\n';
    out += xmlEl('soHieuTK', row.code, 8);
    out += xmlEl('tenTK', row.name || TRIAL_BALANCE_FALLBACK_NAME(row.code), 8);
    out += xmlEl('soDuDauKyNo', vnd(row.openingDebit), 8);
    out += xmlEl('soDuDauKyCo', vnd(row.openingCredit), 8);
    out += xmlEl('psNoTrongKy', vnd(row.periodDebit), 8);
    out += xmlEl('psCoTrongKy', vnd(row.periodCredit), 8);
    out += xmlEl('soDuCuoiKyNo', vnd(row.closingDebit), 8);
    out += xmlEl('soDuCuoiKyCo', vnd(row.closingCredit), 8);
    out += '      </ChiTieu>\n';
  }
  out += '    </PL_F01_DNN>\n';
  return out;
}

function TRIAL_BALANCE_FALLBACK_NAME(code: string) {
  return `Tài khoản ${code}`;
}

export type HtkkBctcXmlParams = {
  entries: JournalEntry[];
  financialYear: FinancialYear;
  year: number;
  companyInfo: CompanyInfo;
  accounts: AccountDefinition[];
  signatories?: {
    nguoiLapBieu?: string;
    keToanTruong?: string;
    giamDoc?: string;
  };
  taxOffice?: {
    maCQT?: string;
    tenCQT?: string;
  };
};

export function buildHtkkBctcXml(params: HtkkBctcXmlParams): string {
  const { entries, financialYear, year, companyInfo, accounts } = params;
  const b01 = computeBalanceSheetData(entries, financialYear);
  const b02 = computeIncomeStatementData(entries, year);
  const f01 = computeTrialBalanceData(entries, year, financialYear, accounts);

  const today = new Date();
  const ngayLap = formatDateIso(today.toISOString().split('T')[0]);
  const kyTu = formatDateVi(financialYear.startDate);
  const kyDen = formatDateVi(financialYear.endDate);
  const mst = String(companyInfo.taxCode || '').replace(/\D/g, '');
  const docId = `ID_${mst}_${year}_${Date.now()}`;

  const sign = params.signatories || {};
  const cqt = params.taxOffice || {};

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<HSoThueDTu xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n';
  xml += `  <HSoKhaiThue id="${escapeXml(docId)}">\n`;

  xml += '    <TTinChung>\n';
  xml += '      <TTinDVu>\n';
  xml += xmlEl('maDVu', 'VTR', 8);
  xml += xmlEl('tenDVu', 'Victory Manager', 8);
  xml += xmlEl('pbanDVu', '1.0', 8);
  xml += xmlEl('ttinNhaCCapDVu', 'Victory', 8);
  xml += '      </TTinDVu>\n';

  xml += '      <TTinTKhaiThue>\n';
  xml += xmlEl('maTKhai', HTKK_MA_TKHAI_B01B, 8);
  xml += xmlEl('tenTKhai', 'Bộ báo cáo tài chính (B01b-DNN) (TT 133/2016/TT-BTC)', 8);
  xml += xmlEl('moTaBMau', 'B01b-DNN', 8);
  xml += xmlEl('pbanTKhaiXML', HTKK_XML_VERSION, 8);
  xml += xmlEl('loaiTKhai', 'C', 8);
  xml += xmlEl('soLan', '0', 8);
  xml += '        <KyKKhaiThue>\n';
  xml += xmlEl('kieuKy', 'Y', 10);
  xml += xmlEl('kyKKhai', String(year), 10);
  xml += xmlEl('kyKKhaiTu', kyTu, 10);
  xml += xmlEl('kyKKhaiDen', kyDen, 10);
  xml += '        </KyKKhaiThue>\n';
  xml += xmlEl('maCQTNoiNop', cqt.maCQT || '', 8);
  xml += xmlEl('tenCQTNoiNop', cqt.tenCQT || '', 8);
  xml += xmlEl('ngayLapTKhai', ngayLap, 8);
  xml += '        <GiaHan>\n';
  xml += xmlEl('maLyDoGiaHan', '', 10);
  xml += xmlEl('lyDoGiaHan', '', 10);
  xml += '        </GiaHan>\n';
  xml += '      </TTinTKhaiThue>\n';

  xml += '      <NNT>\n';
  xml += xmlEl('mst', mst, 8);
  xml += xmlEl('tenNNT', companyInfo.name || '', 8);
  xml += xmlEl('dchiNNT', companyInfo.address || '', 8);
  xml += xmlEl('phuongXa', '', 8);
  xml += xmlEl('maTinh', '', 8);
  xml += xmlEl('tenTinh', companyInfo.city || '', 8);
  xml += xmlEl('dthoaiNNT', companyInfo.phone || '', 8);
  xml += xmlEl('faxNNT', companyInfo.fax || '', 8);
  xml += xmlEl('emailNNT', companyInfo.email || '', 8);
  xml += '      </NNT>\n';
  xml += '    </TTinChung>\n';

  xml += '    <CTieuTKhaiChinh>\n';
  xml += xmlEl('ngayLap', ngayLap, 6);
  xml += xmlEl('nguoiLapBieu', sign.nguoiLapBieu || '', 6);
  xml += xmlEl('keToanTruong', sign.keToanTruong || '', 6);
  xml += xmlEl('giamDoc', sign.giamDoc || '', 6);
  xml += xmlEl('bctcDaKiemToan', false, 6);
  xml += xmlEl('hoatDongLienTuc', true, 6);
  xml += xmlEl('tenDonViKiemToan', '', 6);
  xml += xmlEl('chonBCKQHDSXKD', true, 6);
  xml += xmlEl('chonBCDTK', true, 6);
  xml += xmlEl('chonBCLCTTGT', false, 6);
  xml += xmlEl('chonBCLCTTTT', false, 6);
  xml += '    </CTieuTKhaiChinh>\n';

  xml += '    <PLuc>\n';
  xml += buildPlB01b(b01.endByCode, b01.beginByCode);
  xml += buildPlB02(b02);
  xml += buildPlF01(f01);
  xml += '    </PLuc>\n';

  xml += '  </HSoKhaiThue>\n';
  xml += '</HSoThueDTu>\n';

  return xml;
}

export function buildHtkkBctcXmlBlob(params: HtkkBctcXmlParams): { blob: Blob; filename: string } {
  const xml = buildHtkkBctcXml(params);
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const filename = htkkBctcFileName(params.year, params.companyInfo.taxCode || '', 0);
  return { blob, filename };
}
