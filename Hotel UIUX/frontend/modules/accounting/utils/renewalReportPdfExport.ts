import type { CompanyInfo } from '@shared/types';
import { saveBlobWithPicker, supportsSaveFilePicker } from '@shared/utils/saveFileWithPicker';

type RenewalDetailExportRow = Record<string, string | number>;

type ExportRenewalReportPdfParams = {
  companyInfo: CompanyInfo;
  filterLabel: string;
  periodModeLabel: string;
  filteredRowsCount: number;
  renewedDeviceCount: number;
  totalFee: number;
  totalVat: number;
  totalAmount: number;
  latestRenewalLabel: string;
  generatedAtLabel: string;
  exportBaseName: string;
  detailExportRows: RenewalDetailExportRow[];
  formatCurrency: (amount: number) => string;
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const PDF_DETAIL_COLUMNS: Array<{
  key: string;
  label: string;
  isCurrency?: boolean;
  format?: (row: RenewalDetailExportRow, formatCurrency: (amount: number) => string) => string;
}> = [
  { key: 'Thời gian gia hạn', label: 'Thời gian gia hạn' },
  { key: 'IMEI', label: 'IMEI Thiết bị' },
  {
    key: 'Số tháng gia hạn',
    label: 'Thời lượng',
    format: (row) => {
      const months = Number(row['Số tháng gia hạn'] || 0);
      return months > 0 ? `${months} tháng` : '---';
    },
  },
  { key: 'Khách hàng', label: 'Khách hàng' },
  { key: 'Tổng thanh toán', label: 'Tổng thanh toán', isCurrency: true },
];

function formatCellValue(
  row: RenewalDetailExportRow,
  column: (typeof PDF_DETAIL_COLUMNS)[number],
  formatCurrency: (amount: number) => string,
): string {
  if (column.format) {
    return column.format(row, formatCurrency);
  }
  const raw = row[column.key];
  if (column.isCurrency) {
    return formatCurrency(Number(raw || 0));
  }
  const text = String(raw ?? '').trim();
  return text || '---';
}

function buildRenewalReportBody(params: ExportRenewalReportPdfParams): string {
  const {
    companyInfo,
    filterLabel,
    periodModeLabel,
    filteredRowsCount,
    renewedDeviceCount,
    totalFee,
    totalVat,
    totalAmount,
    latestRenewalLabel,
    generatedAtLabel,
    detailExportRows,
    formatCurrency,
  } = params;

  const summaryItems = [
    ['Kỳ báo cáo', filterLabel],
    ['Chế độ lọc', periodModeLabel],
    ['Số lần gia hạn', String(filteredRowsCount)],
    ['Số thiết bị phát sinh', String(renewedDeviceCount)],
    ['Doanh thu chưa thuế', formatCurrency(totalFee)],
    ['VAT đầu ra', formatCurrency(totalVat)],
    ['Tổng thanh toán', formatCurrency(totalAmount)],
    ['Gia hạn gần nhất', latestRenewalLabel],
    ['Thời gian tạo báo cáo', generatedAtLabel],
  ];

  const summaryRows = [];
  for (let i = 0; i < summaryItems.length; i += 3) {
    const cells = summaryItems.slice(i, i + 3).map(
      ([label, value]) => `
        <td class="summary-cell">
          <div class="summary-label">${escapeHtml(label)}</div>
          <div class="summary-value">${escapeHtml(value)}</div>
        </td>
      `,
    );
    while (cells.length < 3) {
      cells.push('<td class="summary-cell"></td>');
    }
    summaryRows.push(`<tr>${cells.join('')}</tr>`);
  }

  const tableHeader = PDF_DETAIL_COLUMNS.map(
    (column) => `<th>${escapeHtml(column.label)}</th>`,
  ).join('');

  const tableRows = detailExportRows
    .map((row) => {
      const cells = PDF_DETAIL_COLUMNS.map((column) => {
        const value = formatCellValue(row, column, formatCurrency);
        const align = column.isCurrency ? ' class="text-right"' : '';
        return `<td${align}>${escapeHtml(value)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `
    <div class="report-root">
      <div class="header">
        <div class="company">
          <div><strong>Đơn vị:</strong> ${escapeHtml(companyInfo.name || '')}</div>
          <div><strong>Mã số thuế:</strong> ${escapeHtml(companyInfo.taxCode || '')}</div>
          <div><strong>Địa chỉ:</strong> ${escapeHtml(companyInfo.address || '')}</div>
        </div>
        <h1>Báo cáo gia hạn</h1>
        <p class="subtitle">Kỳ báo cáo: ${escapeHtml(filterLabel)} · Tổng thanh toán: ${escapeHtml(formatCurrency(totalAmount))}</p>
      </div>

      <table class="summary-table">${summaryRows.join('')}</table>

      <div class="section-title">Chi tiết giao dịch gia hạn (${detailExportRows.length} dòng)</div>
      <table class="detail-table">
        <thead><tr>${tableHeader}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

const PDF_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #0f172a;
    font-family: 'Times New Roman', Times, serif;
  }
  body { padding: 12px; }
  .report-root { width: 800px; background: #ffffff; }
  .company { font-size: 12px; line-height: 1.5; margin-bottom: 10px; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 6px; text-transform: uppercase; }
  .subtitle { font-size: 12px; color: #475569; margin: 0 0 12px; }
  .section-title { font-size: 14px; font-weight: 700; margin: 14px 0 8px; }
  .summary-table { width: 100%; border-collapse: separate; border-spacing: 8px; margin: 0 0 8px; }
  .summary-cell {
    width: 33.33%;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 10px 12px;
    vertical-align: top;
    background: #ffffff;
  }
  .summary-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: #64748b;
    margin-bottom: 6px;
  }
  .summary-value {
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    word-break: break-word;
  }
  .detail-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .detail-table th,
  .detail-table td {
    border: 1px solid #94a3b8;
    padding: 8px 10px;
    font-size: 11px;
    vertical-align: top;
    text-align: left;
    word-break: break-word;
    background: #ffffff;
  }
  .detail-table td.text-right,
  .detail-table th:last-child {
    text-align: right;
  }
  .detail-table th {
    background: #e2e8f0;
    font-weight: 700;
  }
  .detail-table tbody tr:nth-child(even) td { background: #f8fafc; }
`;

async function createPdfRenderTarget(bodyHtml: string): Promise<{
  target: HTMLElement;
  cleanup: () => void;
}> {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:800px',
    'pointer-events:none',
    'z-index:-1',
    'overflow:visible',
    'background:#ffffff',
  ].join(';');

  const style = document.createElement('style');
  style.textContent = PDF_STYLES;
  wrapper.appendChild(style);

  const contentHost = document.createElement('div');
  contentHost.innerHTML = bodyHtml;
  wrapper.appendChild(contentHost);
  document.body.appendChild(wrapper);

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await new Promise((resolve) => setTimeout(resolve, 150));

  const target = contentHost.querySelector('.report-root') as HTMLElement | null;
  if (!target || !target.textContent?.trim()) {
    document.body.removeChild(wrapper);
    throw new Error('Không có nội dung để xuất PDF.');
  }

  return {
    target,
    cleanup: () => {
      if (wrapper.parentNode) {
        document.body.removeChild(wrapper);
      }
    },
  };
}

export async function exportRenewalReportPdf(params: ExportRenewalReportPdfParams): Promise<void> {
  if (params.detailExportRows.length === 0) {
    throw new Error('Không có dữ liệu gia hạn để xuất PDF.');
  }

  const bodyHtml = buildRenewalReportBody(params);
  const { target, cleanup } = await createPdfRenderTarget(bodyHtml);

  try {
    const html2pdf = (await import('html2pdf.js')).default;
    const renderWidth = Math.max(target.scrollWidth, target.offsetWidth, 800);
    const renderHeight = Math.max(target.scrollHeight, target.offsetHeight, 200);

    const blob = (await html2pdf()
      .set({
        margin: [6, 6, 6, 6],
        filename: `${params.exportBaseName}.pdf`,
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

    if (!blob || blob.size < 1024) {
      throw new Error('File PDF được tạo nhưng không có dữ liệu.');
    }

    const result = await saveBlobWithPicker(blob, `${params.exportBaseName}.pdf`, [
      {
        description: 'PDF Document',
        accept: { 'application/pdf': ['.pdf'] },
      },
    ]);

    if (result === 'saved') {
      if (supportsSaveFilePicker()) {
        window.alert('Đã lưu báo cáo PDF thành công.');
      } else {
        window.alert(
          'Trình duyệt hiện tại không hỗ trợ chọn thư mục lưu trực tiếp. File PDF đã được tải về theo cài đặt download mặc định của trình duyệt.',
        );
      }
    }
  } finally {
    cleanup();
  }
}
