import type { JournalEntry, JournalEntryDetail } from '../types';

/**
 * Luôn trả về mảng chi tiết bút toán. Dữ liệu cũ/API đôi khi có `details` không phải mảng;
 * gọi `.reduce`/`.map` trực tiếp sẽ làm React crash (trang trắng).
 */
export function journalEntryDetailsArray(e: JournalEntry | undefined | null): JournalEntryDetail[] {
  const d = e?.details;
  return Array.isArray(d) ? d : [];
}
