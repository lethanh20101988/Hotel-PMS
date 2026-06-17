import type { FundTransaction, InventoryTransaction, JournalEntry } from '@shared/types';

/**
 * Bút toán tự sinh từ xuất/nhập kho (batch): id dạng JE-EX-COST-BATCH-<batchId>, batchId = BATCH-<ts>-<n>.
 */
function tryResolveInventoryLinkedJe(
  entry: JournalEntry,
  transactions: InventoryTransaction[],
): { voucherNo: string; docDescription: string } | null {
  const id = entry.id;
  let batchId: string | null = null;
  let trxId: string | null = null;

  if (id.startsWith('JE-EX-COST-BATCH-')) {
    batchId = id.slice('JE-EX-COST-BATCH-'.length);
  } else if (id.startsWith('JE-IM-BATCH-')) {
    batchId = id.slice('JE-IM-BATCH-'.length);
  } else if (id.startsWith('JE-EX-REV-BATCH-')) {
    batchId = id.slice('JE-EX-REV-BATCH-'.length);
  } else if (id.startsWith('JE-EX-COST-')) {
    trxId = id.slice('JE-EX-COST-'.length);
  } else if (id.startsWith('JE-IM-')) {
    trxId = id.slice('JE-IM-'.length);
  } else if (id.startsWith('JE-EX-REV-')) {
    trxId = id.slice('JE-EX-REV-'.length);
  }

  if (batchId) {
    const peer = transactions.filter((t) => String(t.batchId || '').trim() === batchId);
    const t0 = peer[0];
    if (t0) {
      const voucherNo =
        (t0.voucherNumber || t0.documentRef || '').trim() ||
        (entry.referenceId || '').trim() ||
        entry.id;
      const docDescription =
        (entry.description || '').trim() ||
        (t0.note || '').trim() ||
        '—';
      return { voucherNo, docDescription };
    }
  }
  if (trxId) {
    const t = transactions.find((x) => x.id === trxId);
    if (t) {
      const voucherNo =
        (t.voucherNumber || t.documentRef || '').trim() ||
        (entry.referenceId || '').trim() ||
        entry.id;
      const docDescription = (entry.description || '').trim() || (t.note || '').trim() || '—';
      return { voucherNo, docDescription };
    }
  }
  return null;
}

/** Lấy mã trong ngoặc đầu tiên từ diễn giải bút toán (vd: Giá vốn xuất kho (PXK-01)) */
function firstParentheticalToken(text: string): string | null {
  const m = /\(([^)]+)\)/.exec(String(text || ''));
  return m ? m[1].trim() : null;
}

/**
 * Số chứng từ & diễn giải hiển thị tại Phân loại chi phí TNDN:
 * ưu tiên chứng từ gốc (Quỹ, phiếu xuất/nhập kho), không dùng id bút JE tự sinh để hiển thị.
 */
export function resolveCitExpenseVoucherDisplay(
  entry: JournalEntry,
  fundTransactions: FundTransaction[],
  transactions: InventoryTransaction[] = [],
): { voucherNo: string; docDescription: string } {
  if (entry.id.startsWith('JE-FT-')) {
    const ftId = entry.id.slice('JE-FT-'.length);
    const ft = fundTransactions.find((f) => f.id === ftId);
    const voucherNo = (ft?.voucherNumber || entry.referenceId || '').trim() || entry.id;
    const docDescription = (ft?.description || entry.description || '').trim() || '—';
    return { voucherNo, docDescription };
  }

  const invResolved = tryResolveInventoryLinkedJe(entry, transactions);
  if (invResolved) return invResolved;

  const ref = (entry.referenceId || '').trim();
  if (ref) {
    const ft = fundTransactions.find(
      (f) =>
        (f.voucherNumber && f.voucherNumber === ref) ||
        (f.referenceDoc && f.referenceDoc === ref),
    );
    if (ft) {
      return {
        voucherNo: (ft.voucherNumber || ref).trim(),
        docDescription: (ft.description || entry.description || '').trim() || '—',
      };
    }
    return {
      voucherNo: ref,
      docDescription: (entry.description || '').trim() || '—',
    };
  }

  const fromParen = firstParentheticalToken(entry.description);
  if (fromParen) {
    return {
      voucherNo: fromParen,
      docDescription: (entry.description || '').trim() || '—',
    };
  }

  return {
    voucherNo: entry.id,
    docDescription: (entry.description || '').trim() || '—',
  };
}

const TAIL_MAX = 14;

function shortTail(s: string, max = TAIL_MAX): string {
  const t = String(s || '').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `…${t.slice(-(max - 1))}`;
}

/**
 * Rút gọn số chứng từ hiển thị tại Thuế TNDN (dễ đọc; bút tự sinh dạng JE-...).
 * Chuỗi đã là số chứng từ thật (ngắn) thì giữ nguyên.
 */
export function formatCitVoucherNoForDisplay(voucherNo: string, _entry: JournalEntry): string {
  const raw = String(voucherNo || '').trim();
  if (!raw) return '—';

  if (!raw.startsWith('JE-')) {
    if (raw.startsWith('DEPR-')) {
      const dr = /^DEPR-(\d{4}-\d{2})-(.+)$/.exec(raw);
      if (dr) {
        return `KH · ${shortTail(dr[2], 12)} · ${dr[1]}`;
      }
    }
    return raw.length > 40 ? `${raw.slice(0, 18)}…${raw.slice(-16)}` : raw;
  }

  if (raw.startsWith('JE-DEPR-')) {
    const rest = raw.slice('JE-DEPR-'.length);
    const mYm = /^(.+)-(\d{4}-\d{2})$/.exec(rest);
    if (mYm) {
      return `KH · ${shortTail(mYm[1], 12)} · ${mYm[2]}`;
    }
    const mNum = /^(.+)-(\d+)$/.exec(rest);
    if (mNum) {
      return `KH · ${shortTail(mNum[1], 12)} · ${mNum[2]}`;
    }
  }
  if (raw.startsWith('JE-ASSET-DEPR-AUTO-')) {
    return `KH tự động · ${shortTail(raw.replace(/^JE-ASSET-DEPR-AUTO-/, ''), 12)}`;
  }
  if (raw.startsWith('JE-ASSET-INC-')) {
    return `Nhập TSCĐ · ${shortTail(raw.replace(/^JE-ASSET-INC-/, ''), 12)}`;
  }
  if (raw.startsWith('JE-CCDC-USE-')) {
    return `PB CCDC · ${shortTail(raw.replace(/^JE-CCDC-USE-/, ''), 12)}`;
  }
  if (raw.startsWith('JE-INV-')) {
    return `HĐ · ${shortTail(raw.replace(/^JE-INV-/, ''), 16)}`;
  }
  if (raw.startsWith('JE-VOU-')) {
    return `CTGS · ${shortTail(raw.replace(/^JE-VOU-/, ''), 16)}`;
  }
  if (raw.startsWith('JE-PAY-INV-')) {
    return `TT HĐ · ${shortTail(raw.replace(/^JE-PAY-INV-/, ''), 16)}`;
  }
  if (raw.startsWith('JE-EX-COST-BATCH-')) {
    return `GVXK · ${shortTail(raw.slice('JE-EX-COST-BATCH-'.length), 18)}`;
  }
  if (raw.startsWith('JE-IM-BATCH-')) {
    return `NK kho · ${shortTail(raw.slice('JE-IM-BATCH-'.length), 18)}`;
  }
  if (raw.startsWith('JE-EX-REV-BATCH-')) {
    return `DT bán · ${shortTail(raw.slice('JE-EX-REV-BATCH-'.length), 18)}`;
  }
  if (raw.startsWith('JE-FT-')) {
    return `Quỹ · ${shortTail(raw.slice('JE-FT-'.length), 16)}`;
  }
  if (raw.startsWith('JE-OPEN-ROLLOVER-')) {
    return 'Mở đầu kỳ';
  }

  if (raw.length > 32) {
    return `${raw.slice(0, 12)}…${shortTail(raw.slice(12), 14)}`;
  }
  return raw;
}
