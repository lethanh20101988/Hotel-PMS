import type { KhbsBundle } from '../components/vatKhbsTypes';

export type Gtgt01Validation = {
  id: string;
  kind: 'error';
  message: string;
};

function parseMoney(v: string): number {
  const n = Number(String(v || '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Chỉ trả về lỗi chặn nghiệp vụ — không cảnh báo / hướng dẫn trên UI */
export function runGtgt01Validations(params: {
  filingFirst: boolean;
  khbs: KhbsBundle;
  nums: {
    v37: number;
    v38: number;
    v40a: number;
    v40b: number;
    v41: number;
    v42: number;
  };
}): Gtgt01Validation[] {
  const out: Gtgt01Validation[] = [];
  const { filingFirst, khbs, nums } = params;
  const tol = 2;

  if (nums.v37 > 0 && nums.v38 > 0) {
    out.push({
      id: 'excl-37-38',
      kind: 'error',
      message:
        'Chỉ tiêu [37] và [38] không được điền đồng thời có số dương — chỉ dùng một chiều điều chỉnh theo chênh lệch khai bổ sung.',
    });
  }

  if (nums.v42 > nums.v41 + tol) {
    out.push({
      id: '42-gt-41',
      kind: 'error',
      message: '[42] đề nghị hoàn không được lớn hơn [41] chưa khấu trừ hết.',
    });
  }

  if (nums.v40b > nums.v40a + tol) {
    out.push({
      id: '40b-gt-40a',
      kind: 'error',
      message: '[40b] mua ĐT bù trừ không được lớn hơn [40a] thuế phải nộp SXKD trong kỳ.',
    });
  }

  if (!filingFirst && (nums.v37 > 0 || nums.v38 > 0)) {
    const hasDoc = khbs.documents.some(d => d.title.trim().length > 0);
    const linesNeedingReason = khbs.lines.filter(l => {
      const diff = Math.abs(parseMoney(l.adjusted) - parseMoney(l.reported));
      const lia = Math.abs(parseMoney(l.liabilityAdj));
      return diff > tol || lia > tol;
    });
    const allReasonsOk =
      linesNeedingReason.length === 0 || linesNeedingReason.every(l => l.reason.trim().length > 0);
    if (!hasDoc && !allReasonsOk) {
      out.push({
        id: 'khbs-reason',
        kind: 'error',
        message:
          'Khai bổ sung có [37]/[38]: cần ghi lý do ở cột (8) 01-1/KHBS cho từng dòng chênh lệch, hoặc kê khai tài liệu kèm theo có tiêu đề.',
      });
    }
  }

  return out;
}
