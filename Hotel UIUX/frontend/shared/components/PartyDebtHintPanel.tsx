import React from 'react';
import { BarChart3 } from 'lucide-react';
import { formatCurrency } from '../utils/format';
import type { PartyDebtPairsResult } from '../utils/arApSubledger';

type Props = {
  data: PartyDebtPairsResult | null;
  /** Màu viền / nền nhẹ thei ngữ cảnh */
  accent?: 'emerald' | 'indigo' | 'red';
};

const accentClass: Record<NonNullable<Props['accent']>, string> = {
  emerald: 'border-emerald-200 bg-emerald-50/90 text-emerald-950',
  indigo: 'border-indigo-200 bg-indigo-50/95 text-indigo-950',
  red: 'border-red-200 bg-red-50/90 text-red-950',
};

export const PartyDebtHintPanel: React.FC<Props> = ({ data, accent = 'indigo' }) => {
  if (!data) return null;
  const kindLabel = data.kind === 'AR' ? 'Công nợ phải thu (TK 131)' : 'Công nợ phải trả (TK 331)';
  const box = accentClass[accent];

  return (
    <div className={`mt-3 rounded-lg border p-3 shadow-sm ${box}`}>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold">
        <BarChart3 className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
        Gợi ý số dư — {kindLabel}
      </p>
      {!data.hasObjectMatch && (
        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50/90 px-2 py-1.5 text-[10px] font-medium text-amber-900">
          Chưa khớp KH/NCC hoặc hóa đơn trong danh mục — số liệu có thể là 0. Gõ đúng tên hoặc chọn từ gợi ý.
        </p>
      )}
      <div className="overflow-x-auto rounded-md border border-white/60 bg-white/80">
        <table className="w-full min-w-[320px] border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90 text-left text-slate-600">
              <th className="p-2 font-semibold">Phạm vi</th>
              <th className="p-2 font-semibold">Mốc trước</th>
              <th className="p-2 text-right font-semibold">Số dư</th>
              <th className="p-2 font-semibold">Hiện tại</th>
              <th className="p-2 text-right font-semibold">Số dư</th>
            </tr>
          </thead>
          <tbody>
            {data.pairs.map((row) => (
              <tr key={row.scope} className="border-b border-slate-100 last:border-0">
                <td className="p-2 font-bold text-slate-800">{row.scope}</td>
                <td className="p-2 text-slate-600">
                  <div>{row.prevLabel}</div>
                  <div className="font-mono text-[9px] text-slate-400">{row.prevDate}</div>
                </td>
                <td className="p-2 text-right font-mono font-semibold tabular-nums text-slate-800">
                  {formatCurrency(row.prevBalance)}
                </td>
                <td className="p-2 text-slate-600">
                  <div>{row.curLabel}</div>
                  <div className="font-mono text-[9px] text-slate-400">{row.curDate}</div>
                </td>
                <td className="p-2 text-right font-mono font-semibold tabular-nums text-slate-800">
                  {formatCurrency(row.curBalance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[9px] font-medium text-slate-500">
        Số liệu theo Nhật ký chung đến từng ngày mốc; “hiện tại” = đến ngày chứng từ đang nhập.
      </p>
    </div>
  );
};
