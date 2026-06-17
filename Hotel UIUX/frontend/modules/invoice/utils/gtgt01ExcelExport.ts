import { loadXlsx } from '@shared/utils/lazyXlsx';

export type Gtgt01ExcelRow = {
  stt: string;
  desc: string;
  code: string;
  col4: string;
  col5: string;
};

/** Xuất nhanh các dòng chính 01/GTGT (có thể mở rộng thêm sheet KHBS). */
export async function downloadGtgt01MainSheet(params: { title: string; rows: Gtgt01ExcelRow[] }) {
  const XLSX = await loadXlsx();
  const aoa: (string | number)[][] = [
    ['Tờ khai thuế GTGT (Mẫu 01/GTGT) — trích xuất Excel'],
    [params.title],
    [],
    ['STT', 'Chỉ tiêu', 'Mã chỉ tiêu', 'Cột 4', 'Cột 5'],
    ...params.rows.map((r) => [r.stt, r.desc, r.code, r.col4, r.col5]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '01-GTGT');
  const safe = params.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80);
  XLSX.writeFile(wb, `01-GTGT_${safe}_${Date.now()}.xlsx`);
}
