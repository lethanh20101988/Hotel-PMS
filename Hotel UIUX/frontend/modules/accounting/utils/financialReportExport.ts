import type { AccountDefinition, CompanyInfo, FinancialYear, JournalEntry } from '@shared/types';
import { loadXlsx } from '@shared/utils/lazyXlsx';
import { formatCurrency } from '@shared/utils/format';
import { saveBlobWithPicker, supportsSaveFilePicker } from '@shared/utils/saveFileWithPicker';
import {
  computeBalanceSheetData,
  computeFinancialNotesSections,
  computeIncomeStatementData,
  computeTrialBalanceData,
  reportExportBaseName,
  type FinancialExportReportType,
} from './financialReportData';
import { buildHtkkBctcXmlBlob } from './htkkBctcXml';

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmtNum = (n: number | null | undefined) =>
  formatCurrency(Number.isFinite(Number(n)) ? Number(n) : 0)
    .replace('₫', '')
    .trim();

const PDF_STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: #0f172a; font-family: 'Times New Roman', Times, serif; }
  body { padding: 12px; }
  .report-root { width: 800px; background: #ffffff; }
  .company { font-size: 12px; line-height: 1.5; margin-bottom: 10px; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 6px; text-transform: uppercase; text-align: center; }
  h2 { font-size: 14px; font-weight: 700; margin: 14px 0 6px; }
  .subtitle { font-size: 12px; color: #475569; margin: 0 0 12px; text-align: center; }
  .data-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 12px; }
  .data-table th, .data-table td { border: 1px solid #334155; padding: 6px 8px; font-size: 10px; vertical-align: top; word-break: break-word; }
  .data-table th { background: #e2e8f0; font-weight: 700; text-align: center; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .bold { font-weight: 700; }
  .italic { font-style: italic; }
  .section { margin-bottom: 10px; font-size: 11px; line-height: 1.5; }
`;

async function createPdfRenderTarget(bodyHtml: string): Promise<{ target: HTMLElement; cleanup: () => void }> {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.cssText = 'position:fixed;top:0;left:0;width:800px;pointer-events:none;z-index:-1;overflow:visible;background:#ffffff;';
  const style = document.createElement('style');
  style.textContent = PDF_STYLES;
  wrapper.appendChild(style);
  const contentHost = document.createElement('div');
  contentHost.innerHTML = bodyHtml;
  wrapper.appendChild(contentHost);
  document.body.appendChild(wrapper);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 150));
  const target = contentHost.querySelector('.report-root') as HTMLElement | null;
  if (!target) {
    document.body.removeChild(wrapper);
    throw new Error('Không có nội dung để xuất PDF.');
  }
  return {
    target,
    cleanup: () => {
      if (wrapper.parentNode) document.body.removeChild(wrapper);
    },
  };
}

function companyHeaderHtml(companyInfo: CompanyInfo, title: string, subtitle: string) {
  return `
    <div class="report-root">
      <div class="company">
        <div><strong>Đơn vị:</strong> ${escapeHtml(companyInfo.name || '')}</div>
        <div><strong>Mã số thuế:</strong> ${escapeHtml(companyInfo.taxCode || '')}</div>
        <div><strong>Địa chỉ:</strong> ${escapeHtml(companyInfo.address || '')}</div>
      </div>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
  `;
}

function buildBalanceSheetPdfHtml(entries: JournalEntry[], financialYear: FinancialYear, companyInfo: CompanyInfo, year: number) {
  const data = computeBalanceSheetData(entries, financialYear);
  const rows = data.rows
    .map(
      (r) => `
    <tr class="${r.bold ? 'bold' : ''}">
      <td style="padding-left:${(r.indent || 0) * 12 + 6}px" class="${r.italic ? 'italic' : ''}">${escapeHtml(r.label)}</td>
      <td class="text-center">${escapeHtml(r.code)}</td>
      <td class="text-right">${r.value !== null ? escapeHtml(fmtNum(r.value)) : ''}</td>
      <td class="text-right">${r.beginValue !== null ? escapeHtml(fmtNum(r.beginValue)) : ''}</td>
    </tr>`,
    )
    .join('');

  return (
    companyHeaderHtml(companyInfo, 'BÁO CÁO TÌNH HÌNH TÀI CHÍNH (B01b-DNN)', `Niên độ ${year} — TT133/2016/TT-BTC`) +
    `<table class="data-table">
      <thead><tr>
        <th>Chỉ tiêu</th><th>Mã số</th><th>Số cuối năm</th><th>Số đầu năm</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`
  );
}

function buildIncomeStatementPdfHtml(entries: JournalEntry[], companyInfo: CompanyInfo, year: number) {
  const rows = computeIncomeStatementData(entries, year)
    .map(
      (r) => `
    <tr class="${r.bold ? 'bold' : ''}">
      <td style="padding-left:${(r.indent || 0) * 12 + 6}px" class="${r.italic ? 'italic' : ''}">${escapeHtml(r.label)}</td>
      <td class="text-center">${escapeHtml(r.code)}</td>
      <td class="text-right">${escapeHtml(fmtNum(r.value))}</td>
    </tr>`,
    )
    .join('');

  return (
    companyHeaderHtml(companyInfo, 'BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH (B02-DNN)', `Năm ${year} — TT133/2016/TT-BTC`) +
    `<table class="data-table">
      <thead><tr><th>Chỉ tiêu</th><th>Mã số</th><th>Năm nay</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`
  );
}

function buildTrialBalancePdfHtml(
  entries: JournalEntry[],
  year: number,
  financialYear: FinancialYear,
  companyInfo: CompanyInfo,
  accounts: AccountDefinition[],
) {
  const data = computeTrialBalanceData(entries, year, financialYear, accounts);
  const rows = data.rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.code)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td class="text-right">${escapeHtml(fmtNum(r.openingDebit))}</td>
      <td class="text-right">${escapeHtml(fmtNum(r.openingCredit))}</td>
      <td class="text-right">${escapeHtml(fmtNum(r.periodDebit))}</td>
      <td class="text-right">${escapeHtml(fmtNum(r.periodCredit))}</td>
      <td class="text-right">${escapeHtml(fmtNum(r.closingDebit))}</td>
      <td class="text-right">${escapeHtml(fmtNum(r.closingCredit))}</td>
    </tr>`,
    )
    .join('');

  return (
    companyHeaderHtml(companyInfo, 'BẢNG CÂN ĐỐI TÀI KHOẢN (F01-DNN)', `Năm ${year} — TT133/2016/TT-BTC`) +
    `<table class="data-table">
      <thead><tr>
        <th>TK</th><th>Tên TK</th><th>ĐK Nợ</th><th>ĐK Có</th><th>PS Nợ</th><th>PS Có</th><th>CK Nợ</th><th>CK Có</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="bold">
          <td colspan="2">Tổng cộng</td>
          <td class="text-right">${escapeHtml(fmtNum(data.totals.openingDebit))}</td>
          <td class="text-right">${escapeHtml(fmtNum(data.totals.openingCredit))}</td>
          <td class="text-right">${escapeHtml(fmtNum(data.totals.periodDebit))}</td>
          <td class="text-right">${escapeHtml(fmtNum(data.totals.periodCredit))}</td>
          <td class="text-right">${escapeHtml(fmtNum(data.totals.closingDebit))}</td>
          <td class="text-right">${escapeHtml(fmtNum(data.totals.closingCredit))}</td>
        </tr>
      </tbody>
    </table></div>`
  );
}

function buildNotesPdfHtml(entries: JournalEntry[], financialYear: FinancialYear, companyInfo: CompanyInfo) {
  const notes = computeFinancialNotesSections(entries, financialYear, companyInfo);
  const sections = notes.sections
    .map((s) => `<div class="section"><h2>${escapeHtml(s.title)}</h2><p>${escapeHtml(s.content)}</p></div>`)
    .join('');

  return (
    companyHeaderHtml(companyInfo, 'THUYẾT MINH BÁO CÁO TÀI CHÍNH (B09-DNN)', `Niên độ ${notes.year} — ${escapeHtml(notes.periodLabel)}`) +
    sections +
    '</div>'
  );
}

function buildBalanceSheetExcelRows(entries: JournalEntry[], financialYear: FinancialYear, companyInfo: CompanyInfo, year: number) {
  const data = computeBalanceSheetData(entries, financialYear);
  const header = [
    ['B01b-DNN: Báo cáo tình hình tài chính'],
    [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
    [`Niên độ: ${year}`],
    [],
    ['Chỉ tiêu', 'Mã số', 'Số cuối năm', 'Số đầu năm'],
  ];
  const body = data.rows.map((r) => [
    `${'  '.repeat(r.indent || 0)}${r.label}`,
    r.code,
    r.value ?? 0,
    r.beginValue ?? 0,
  ]);
  return [...header, ...body];
}

function buildIncomeStatementExcelRows(entries: JournalEntry[], companyInfo: CompanyInfo, year: number) {
  const rows = computeIncomeStatementData(entries, year);
  const header = [
    ['B02-DNN: Báo cáo kết quả hoạt động kinh doanh'],
    [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
    [`Năm: ${year}`],
    [],
    ['Chỉ tiêu', 'Mã số', 'Năm nay'],
  ];
  const body = rows.map((r) => [`${'  '.repeat(r.indent || 0)}${r.label}`, r.code, r.value]);
  return [...header, ...body];
}

function buildTrialBalanceExcelRows(
  entries: JournalEntry[],
  year: number,
  financialYear: FinancialYear,
  companyInfo: CompanyInfo,
  accounts: AccountDefinition[],
) {
  const data = computeTrialBalanceData(entries, year, financialYear, accounts);
  const header = [
    ['F01-DNN: Bảng cân đối tài khoản'],
    [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
    [`Năm: ${year}`],
    [],
    ['Số hiệu TK', 'Tên tài khoản', 'Số dư đầu kỳ Nợ', 'Số dư đầu kỳ Có', 'Phát sinh Nợ', 'Phát sinh Có', 'Số dư cuối kỳ Nợ', 'Số dư cuối kỳ Có'],
  ];
  const body = data.rows.map((r) => [
    r.code,
    r.name,
    r.openingDebit,
    r.openingCredit,
    r.periodDebit,
    r.periodCredit,
    r.closingDebit,
    r.closingCredit,
  ]);
  const total = [
    'Tổng cộng',
    '',
    data.totals.openingDebit,
    data.totals.openingCredit,
    data.totals.periodDebit,
    data.totals.periodCredit,
    data.totals.closingDebit,
    data.totals.closingCredit,
  ];
  return [...header, ...body, total];
}

function buildNotesExcelRows(entries: JournalEntry[], financialYear: FinancialYear, companyInfo: CompanyInfo) {
  const notes = computeFinancialNotesSections(entries, financialYear, companyInfo);
  const header = [
    ['B09-DNN: Thuyết minh báo cáo tài chính'],
    [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
    [`Kỳ: ${notes.periodLabel}`],
    [],
    ['Mục', 'Nội dung'],
  ];
  const body = notes.sections.map((s) => [s.title, s.content]);
  return [...header, ...body];
}

export type FinancialReportExportParams = {
  reportType: FinancialExportReportType;
  entries: JournalEntry[];
  financialYear: FinancialYear;
  year: number;
  companyInfo: CompanyInfo;
  accounts: AccountDefinition[];
};

function getPdfHtml(params: FinancialReportExportParams): string {
  const { reportType, entries, financialYear, year, companyInfo, accounts } = params;
  switch (reportType) {
    case 'BALANCE_SHEET':
      return buildBalanceSheetPdfHtml(entries, financialYear, companyInfo, year);
    case 'INCOME_STATEMENT':
      return buildIncomeStatementPdfHtml(entries, companyInfo, year);
    case 'TRIAL_BALANCE':
      return buildTrialBalancePdfHtml(entries, year, financialYear, companyInfo, accounts);
    case 'NOTES':
      return buildNotesPdfHtml(entries, financialYear, companyInfo);
    default:
      throw new Error('Loại báo cáo không hỗ trợ xuất PDF.');
  }
}

function getExcelRows(params: FinancialReportExportParams): unknown[][] {
  const { reportType, entries, financialYear, year, companyInfo, accounts } = params;
  switch (reportType) {
    case 'BALANCE_SHEET':
      return buildBalanceSheetExcelRows(entries, financialYear, companyInfo, year);
    case 'INCOME_STATEMENT':
      return buildIncomeStatementExcelRows(entries, companyInfo, year);
    case 'TRIAL_BALANCE':
      return buildTrialBalanceExcelRows(entries, year, financialYear, companyInfo, accounts);
    case 'NOTES':
      return buildNotesExcelRows(entries, financialYear, companyInfo);
    default:
      throw new Error('Loại báo cáo không hỗ trợ xuất Excel.');
  }
}

export async function exportFinancialReportExcel(params: FinancialReportExportParams): Promise<void> {
  const baseName = reportExportBaseName(params.reportType, params.year, params.companyInfo.taxCode || '');
  const rows = getExcelRows(params);
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BaoCao');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  await saveBlobWithPicker(blob, `${baseName}.xlsx`, [
    { description: 'Excel Spreadsheet', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } },
  ]);
}

export async function exportFinancialReportPdf(params: FinancialReportExportParams): Promise<void> {
  const baseName = reportExportBaseName(params.reportType, params.year, params.companyInfo.taxCode || '');
  const bodyHtml = getPdfHtml(params);
  const { target, cleanup } = await createPdfRenderTarget(bodyHtml);
  try {
    const html2pdf = (await import('html2pdf.js')).default;
    const renderWidth = Math.max(target.scrollWidth, target.offsetWidth, 800);
    const renderHeight = Math.max(target.scrollHeight, target.offsetHeight, 200);
    const blob = (await html2pdf()
      .set({
        margin: [6, 6, 6, 6],
        filename: `${baseName}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale: 1,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          width: renderWidth,
          height: renderHeight,
          windowWidth: renderWidth,
          windowHeight: renderHeight,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(target)
      .outputPdf('blob')) as Blob;

    if (!blob || blob.size < 512) throw new Error('File PDF được tạo nhưng không có dữ liệu.');
    const result = await saveBlobWithPicker(blob, `${baseName}.pdf`, [
      { description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } },
    ]);
    if (result === 'saved' && supportsSaveFilePicker()) {
      window.alert('Đã lưu báo cáo PDF thành công.');
    }
  } finally {
    cleanup();
  }
}

/** Xuất bộ BCTC HTKK (B01b + B02 + F01) — B09 không nằm trong XML nộp thuế */
export async function exportFinancialReportHtkkXml(params: FinancialReportExportParams): Promise<void> {
  const { blob, filename } = buildHtkkBctcXmlBlob({
    entries: params.entries,
    financialYear: params.financialYear,
    year: params.year,
    companyInfo: params.companyInfo,
    accounts: params.accounts,
  });
  const result = await saveBlobWithPicker(blob, filename, [
    { description: 'HTKK XML', accept: { 'application/xml': ['.xml'], 'text/xml': ['.xml'] } },
  ]);
  if (result === 'saved') {
    window.alert(
      'Đã xuất file XML HTKK (B01b + B02 + F01).\n\n' +
        'Vui lòng mở HTKK → Nhập từ XML để kiểm tra trước khi nộp lên Tổng cục Thuế.\n' +
        'Thuyết minh B09-DNN cần đính kèm riêng (Word/PDF).',
    );
  }
}

export async function exportFinancialReport(
  format: 'excel' | 'pdf' | 'xml',
  params: FinancialReportExportParams,
): Promise<void> {
  if (format === 'excel') return exportFinancialReportExcel(params);
  if (format === 'pdf') return exportFinancialReportPdf(params);
  return exportFinancialReportHtkkXml(params);
}
