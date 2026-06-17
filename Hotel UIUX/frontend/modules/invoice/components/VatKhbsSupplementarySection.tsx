import React, { useMemo } from 'react';
import { ClipboardPaste, Link2, Plus, Printer, Trash2 } from 'lucide-react';
import { formatCurrency } from '@shared/utils/format';
import type { KhbsAdjustmentLine, KhbsBundle, KhbsLineCategory } from './vatKhbsTypes';
import { newKhbsDistRow, newKhbsDocRow, newKhbsLine } from './vatKhbsTypes';

function parseNum(v: string): number {
  const n = Number(String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function moneyInput(
  val: string,
  onChange: (s: string) => void,
  narrow?: boolean,
) {
  return (
    <input
      className={`rounded border border-slate-200 px-1 py-0.5 text-right font-mono text-[11px] print:hidden ${narrow ? 'w-24' : 'w-full min-w-[72px]'}`}
      value={val}
      onChange={e => onChange(e.target.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, ''))}
      placeholder="0"
    />
  );
}

const CAT_LABEL: Record<KhbsLineCategory, string> = {
  PAYABLE: 'Phải nộp',
  DEDUCTIBLE: 'Khấu trừ',
  REFUND: 'ĐN hoàn',
};

type Props = {
  khbs: KhbsBundle;
  setKhbs: React.Dispatch<React.SetStateAction<KhbsBundle>>;
  periodLabel: string;
  supplementaryNo: string;
  taxpayerName: string;
  taxpayerTaxCode: string;
  setTaxpayerName: (v: string) => void;
  setTaxpayerTaxCode: (v: string) => void;
  agentName: string;
  agentTaxCode: string;
  agentContractNo: string;
  agentContractDate: string;
  setAgentName: (v: string) => void;
  setAgentTaxCode: (v: string) => void;
  setAgentContractNo: (v: string) => void;
  setAgentContractDate: (v: string) => void;
  onSyncAdjustedFromMain: () => void;
  /** Đã lưu baseline lần đầu cho đúng kỳ trên 01/GTGT */
  hasFirstFilingBaseline?: boolean;
  onFillKhbsReportedFromBaseline?: () => void;
};

export const VatKhbsSupplementarySection: React.FC<Props> = ({
  khbs,
  setKhbs,
  periodLabel,
  supplementaryNo,
  taxpayerName,
  taxpayerTaxCode,
  setTaxpayerName,
  setTaxpayerTaxCode,
  agentName,
  agentTaxCode,
  agentContractNo,
  agentContractDate,
  setAgentName,
  setAgentTaxCode,
  setAgentContractNo,
  setAgentContractDate,
  onSyncAdjustedFromMain,
  hasFirstFilingBaseline = false,
  onFillKhbsReportedFromBaseline,
}) => {
  const updateLine = (id: string, patch: Partial<KhbsAdjustmentLine>) => {
    setKhbs(prev => ({
      ...prev,
      lines: prev.lines.map(l => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (
          patch.liabilityAdj === undefined &&
          (patch.reported !== undefined || patch.adjusted !== undefined)
        ) {
          const rep = parseNum(next.reported);
          const adj = parseNum(next.adjusted);
          next.liabilityAdj = String(adj - rep);
        }
        return next;
      }),
    }));
  };

  const totals111 = useMemo(() => {
    let t7 = 0;
    let t8 = 0;
    let t9 = 0;
    for (const l of khbs.lines) {
      const v = parseNum(l.liabilityAdj);
      if (l.category === 'PAYABLE') t7 += v;
      else if (l.category === 'DEDUCTIBLE') t8 += v;
      else t9 += v;
    }
    return { t7, t8, t9 };
  }, [khbs.lines]);

  const sumDist = useMemo(
    () => khbs.distribution.reduce((s, r) => s + parseNum(r.amountAdj), 0),
    [khbs.distribution],
  );

  const linesPayable = khbs.lines.filter(l => l.category === 'PAYABLE');
  const linesDed = khbs.lines.filter(l => l.category === 'DEDUCTIBLE');
  const linesRef = khbs.lines.filter(l => l.category === 'REFUND');

  const sumCol3 = (rows: KhbsAdjustmentLine[]) => rows.reduce((s, l) => s + parseNum(l.liabilityAdj), 0);

  const printVal = (s: string) => (
    <span className="hidden font-mono text-[10px] print:inline">{s || '—'}</span>
  );

  const adjTable = (rows: KhbsAdjustmentLine[]) => (
    <div className="mb-4">
      <div className="overflow-x-auto border border-slate-200">
        <table className="w-full min-w-[560px] border-collapse text-[10px]">
          <thead className="bg-slate-100">
            <tr>
              <th className="border border-slate-300 px-1 py-1 text-center align-middle">STT (1)</th>
              <th className="border border-slate-300 px-1 py-1 text-left">Tên tiểu mục (2)</th>
              <th className="border border-slate-300 px-1 py-1">Tăng/giảm (+/-) (3)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={l.id}>
                <td className="border border-slate-300 px-1 text-center align-middle tabular-nums">{i + 1}</td>
                <td className="border border-slate-300 px-1">
                  <span className="print:hidden">{l.itemName || '—'}</span>
                  {printVal(l.itemName)}
                </td>
                <td className="border border-slate-300 px-1 text-right font-mono">
                  {formatCurrency(parseNum(l.liabilityAdj))}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="border border-slate-300 px-2 py-2 text-center text-slate-400">
                  (Chưa có dòng — thêm ở mẫu 01-1/KHBS)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="khbs-supplementary space-y-6 print:space-y-4">
      <div className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-3 print:hidden">
        <p className="text-xs font-black uppercase text-amber-900">Tờ khai bổ sung — Bản giải trình KHBS</p>
        <p className="mt-1 text-[11px] text-amber-800">
          Hai mẫu <b>01/KHBS</b> và <b>01-1/KHBS</b> chỉ dùng khi kê khai <b>bổ sung</b>. Số điều chỉnh có thể{' '}
          <b>đồng bộ từ chỉ tiêu tờ 01/GTGT</b> phía trên; chênh lệch (6) và cột nghĩa vụ (7) cập nhật theo từng
          dòng.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSyncAdjustedFromMain}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-black uppercase text-white shadow hover:bg-amber-700"
          >
            <Link2 className="h-4 w-4" /> Đồng bộ điều chỉnh từ 01/GTGT
          </button>
          {hasFirstFilingBaseline && onFillKhbsReportedFromBaseline && (
            <button
              type="button"
              onClick={onFillKhbsReportedFromBaseline}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-emerald-600 bg-white px-3 py-2 text-xs font-black uppercase text-emerald-800 shadow-sm hover:bg-emerald-50"
            >
              <ClipboardPaste className="h-4 w-4" /> Điền cột (4) đã kê khai từ baseline
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black uppercase text-slate-700"
          >
            <Printer className="h-4 w-4" /> In KHBS
          </button>
        </div>
      </div>

      {/* ——— 01/KHBS ——— */}
      <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm md:p-6">
        <div className="relative mb-6">
          <div className="mx-auto max-w-2xl text-center md:pr-[232px]">
            <p className="text-[11px] font-bold uppercase leading-snug text-slate-900 sm:text-xs">
              Cộng hòa xã hội chủ nghĩa Việt Nam
            </p>
            <p className="mt-0.5 text-[11px] font-bold text-slate-900 sm:text-xs">Độc lập - Tự do - Hạnh phúc</p>
            <div className="mx-auto my-2 w-28 border-t border-dashed border-slate-500" />
            <h3 className="text-base font-black uppercase tracking-tight text-slate-900 sm:text-lg">Tờ khai bổ sung</h3>
          </div>
          <div className="mx-auto mt-4 max-w-[260px] border-2 border-slate-800 bg-white p-2 text-[9px] leading-snug text-slate-800 md:absolute md:right-0 md:top-0 md:mx-0 md:mt-0 md:w-[220px]">
            <p className="font-bold">Mẫu số: 01/KHBS</p>
            <p className="mt-1 italic text-slate-700">
              (Ban hành kèm theo Thông tư số 80/2021/TT-BTC ngày 29 tháng 9 năm 2021 của Bộ trưởng Bộ Tài chính)
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-2.5 text-[11px] leading-relaxed text-slate-900">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[01] Mẫu tờ khai:</span>
            <span className="font-bold uppercase">
              Tờ khai thuế giá trị gia tăng (Mẫu số 01/GTGT)
            </span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[02] Mã giao dịch điện tử:</span>
            <input
              className="min-h-[28px] flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-[11px] print:hidden"
              value={khbs.transactionCode}
              onChange={e => setKhbs(p => ({ ...p, transactionCode: e.target.value }))}
              placeholder="Nhập mã giao dịch (nếu có)"
            />
            <span className="hidden font-mono text-[10px] print:inline">{khbs.transactionCode || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[03] Kỳ tính thuế:</span>
            <span className="font-semibold">{periodLabel}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[04] Bổ sung lần thứ:</span>
            <span className="font-semibold">{supplementaryNo || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[05] Tên người nộp thuế:</span>
            <input
              className="min-h-[28px] flex-1 rounded border border-slate-300 px-2 py-1 font-bold uppercase print:hidden"
              value={taxpayerName}
              onChange={e => setTaxpayerName(e.target.value)}
            />
            <span className="hidden font-bold uppercase print:inline">{taxpayerName || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[06] Mã số thuế:</span>
            <input
              className="min-h-[28px] w-full max-w-xs rounded border border-slate-300 px-2 py-1 font-mono print:hidden"
              value={taxpayerTaxCode}
              onChange={e => setTaxpayerTaxCode(e.target.value)}
            />
            <span className="hidden font-mono print:inline">{taxpayerTaxCode || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[07] Tên đại lý thuế (nếu có):</span>
            <input
              className="min-h-[28px] flex-1 rounded border border-slate-300 px-2 py-1 print:hidden"
              value={agentName}
              onChange={e => setAgentName(e.target.value)}
            />
            <span className="hidden print:inline">{agentName || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[08] Mã số thuế:</span>
            <input
              className="min-h-[28px] w-full max-w-xs rounded border border-slate-300 px-2 py-1 font-mono print:hidden"
              value={agentTaxCode}
              onChange={e => setAgentTaxCode(e.target.value)}
            />
            <span className="hidden font-mono print:inline">{agentTaxCode || '—'}</span>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[09] Hợp đồng đại lý thuế:</span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Số</span>
              <input
                className="w-36 rounded border border-slate-300 px-2 py-1 print:hidden"
                value={agentContractNo}
                onChange={e => setAgentContractNo(e.target.value)}
              />
              <span className="font-semibold">Ngày</span>
              <input
                type="date"
                className="rounded border border-slate-300 px-2 py-1 print:hidden"
                value={agentContractDate}
                onChange={e => setAgentContractDate(e.target.value)}
              />
              <span className="hidden text-[10px] print:inline">
                {[agentContractNo, agentContractDate].filter(Boolean).join(' / ') || '—'}
              </span>
            </span>
          </div>
        </div>

        <p className="mt-4 text-right text-[10px] italic text-slate-600">Đơn vị tiền: Đồng Việt Nam</p>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <h4 className="text-[11px] font-black leading-snug text-slate-900 sm:text-xs">
            A. Xác định tăng/giảm số thuế phải nộp và tiền chậm nộp, tăng/giảm số thuế được khấu trừ, tăng/giảm số
            thuế đề nghị hoàn:
          </h4>

          <div className="mt-3">
            <p className="mb-2 text-[11px] font-bold text-slate-900">
              I. Xác định tăng/giảm số thuế phải nộp và tiền chậm nộp:
            </p>
            <p className="mb-2 text-[11px] font-semibold text-slate-800">
              1. Số thuế phải nộp trên tờ khai điều chỉnh tăng/giảm:
            </p>
            {adjTable(linesPayable)}

            <p className="mb-1 mt-3 text-[10px] font-bold text-slate-700">
              2. Thuế phải nộp trên phụ lục phân bổ (nếu có) — Tổng cộng: [11]
            </p>
            <div className="overflow-x-auto border border-slate-200">
              <table className="w-full min-w-[720px] border-collapse text-[10px]">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="border px-1 py-1 text-center align-middle">STT</th>
                    <th className="border px-1 py-1 text-left">Tên</th>
                    <th className="border px-1 py-1">MST / Mã ĐĐKD</th>
                    <th className="border px-1 py-1">Xã/phường</th>
                    <th className="border px-1 py-1">Tỉnh</th>
                    <th className="border px-1 py-1 text-left">CQT quản lý</th>
                    <th className="border px-1 py-1 text-right">Số tiền điều chỉnh (+/-)</th>
                    <th className="border px-0 print:hidden" />
                  </tr>
                </thead>
                <tbody>
                  {khbs.distribution.map((r, i) => (
                    <tr key={r.id}>
                      <td className="border px-1 text-center align-middle tabular-nums">{i + 1}</td>
                      <td className="border px-1">
                        <input
                          className="w-full border-0 bg-transparent text-[10px] print:hidden"
                          value={r.name}
                          onChange={e =>
                            setKhbs(p => ({
                              ...p,
                              distribution: p.distribution.map(x =>
                                x.id === r.id ? { ...x, name: e.target.value } : x,
                              ),
                            }))
                          }
                        />
                        {printVal(r.name)}
                      </td>
                      <td className="border px-1">
                        <input
                          className="w-full border-0 bg-transparent font-mono text-[10px] print:hidden"
                          value={r.taxOrLocationCode}
                          onChange={e =>
                            setKhbs(p => ({
                              ...p,
                              distribution: p.distribution.map(x =>
                                x.id === r.id ? { ...x, taxOrLocationCode: e.target.value } : x,
                              ),
                            }))
                          }
                        />
                        {printVal(r.taxOrLocationCode)}
                      </td>
                      <td className="border px-1">
                        <input
                          className="w-full border-0 bg-transparent text-[10px] print:hidden"
                          value={r.ward}
                          onChange={e =>
                            setKhbs(p => ({
                              ...p,
                              distribution: p.distribution.map(x =>
                                x.id === r.id ? { ...x, ward: e.target.value } : x,
                              ),
                            }))
                          }
                        />
                        {printVal(r.ward)}
                      </td>
                      <td className="border px-1">
                        <input
                          className="w-full border-0 bg-transparent text-[10px] print:hidden"
                          value={r.province}
                          onChange={e =>
                            setKhbs(p => ({
                              ...p,
                              distribution: p.distribution.map(x =>
                                x.id === r.id ? { ...x, province: e.target.value } : x,
                              ),
                            }))
                          }
                        />
                        {printVal(r.province)}
                      </td>
                      <td className="border px-1">
                        <input
                          className="w-full border-0 bg-transparent text-[10px] print:hidden"
                          value={r.taxAuthority}
                          onChange={e =>
                            setKhbs(p => ({
                              ...p,
                              distribution: p.distribution.map(x =>
                                x.id === r.id ? { ...x, taxAuthority: e.target.value } : x,
                              ),
                            }))
                          }
                        />
                        {printVal(r.taxAuthority)}
                      </td>
                      <td className="border px-1 text-right font-mono">
                        {moneyInput(r.amountAdj, v =>
                          setKhbs(p => ({
                            ...p,
                            distribution: p.distribution.map(x =>
                              x.id === r.id ? { ...x, amountAdj: v } : x,
                            ),
                          })),
                        )}
                        <span className="hidden print:inline">{formatCurrency(parseNum(r.amountAdj))}</span>
                      </td>
                      <td className="border print:hidden">
                        <button
                          type="button"
                          className="p-1 text-rose-600"
                          onClick={() =>
                            setKhbs(p => ({
                              ...p,
                              distribution: p.distribution.filter(x => x.id !== r.id),
                            }))
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={6} className="border px-2 text-right">
                      Tổng cộng [11]
                    </td>
                    <td className="border px-2 text-right font-mono">{formatCurrency(sumDist)}</td>
                    <td className="print:hidden" />
                  </tr>
                </tfoot>
              </table>
            </div>
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 print:hidden hover:underline"
              onClick={() => setKhbs(p => ({ ...p, distribution: [...p.distribution, newKhbsDistRow()] }))}
            >
              <Plus className="h-3 w-3" /> Thêm dòng phân bổ
            </button>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 text-[11px]">
              <label>
                <span className="font-bold text-slate-600">3a) Số ngày chậm nộp:</span>
                <input
                  className="ml-2 w-20 rounded border border-slate-200 px-1 print:hidden"
                  value={khbs.lateDaysPayable}
                  onChange={e => setKhbs(p => ({ ...p, lateDaysPayable: e.target.value.replace(/\D/g, '') }))}
                />
              </label>
              <label>
                <span className="font-bold text-slate-600">3b) Tăng/giảm lãi chậm nộp:</span>
                {moneyInput(khbs.lateInterestPayable, v => setKhbs(p => ({ ...p, lateInterestPayable: v })))}
              </label>
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-1 text-[10px] font-bold uppercase text-slate-700">
              II. Tăng/giảm thuế GTGT được khấu trừ — Tổng cộng [12]:{' '}
              <span className="font-mono">{formatCurrency(sumCol3(linesDed))}</span>
            </p>
            <p className="mb-1 text-[10px] font-semibold text-slate-600">
              Chi tiết (đồng bộ từ 01-1/KHBS, nhóm khấu trừ)
            </p>
            {adjTable(linesDed)}
          </div>

          <div className="mt-4">
            <p className="mb-1 text-[10px] font-bold uppercase text-slate-700">
              III. Tăng/giảm số thuế đề nghị hoàn — Tổng cộng [13]:{' '}
              <span className="font-mono">{formatCurrency(sumCol3(linesRef))}</span>
            </p>
            <p className="mb-1 text-[10px] font-semibold text-slate-600">
              Chi tiết (đồng bộ từ 01-1/KHBS, nhóm hoàn)
            </p>
            {adjTable(linesRef)}
          </div>

          <p className="mt-2 text-[10px] font-black text-slate-500">
            [10] Tổng thuế phải nộp điều chỉnh (mục I.1):{' '}
            <span className="font-mono text-slate-800">{formatCurrency(sumCol3(linesPayable))}</span>
          </p>
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <h4 className="text-xs font-black uppercase text-slate-800">B. Thu hồi tiền hoàn thuế và lãi (nếu có)</h4>
          <div className="mt-2 grid gap-2 text-[11px] md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-bold">I.1 Số tiền phải thu hồi</span>
              {moneyInput(khbs.recoverRefundAmount, v => setKhbs(p => ({ ...p, recoverRefundAmount: v })))}
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-bold">I.2 Quyết định hoàn — Số / Ngày</span>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded border border-slate-200 px-2 py-1 text-[11px] print:hidden"
                  value={khbs.recoverDecisionNo}
                  onChange={e => setKhbs(p => ({ ...p, recoverDecisionNo: e.target.value }))}
                  placeholder="Số"
                />
                <input
                  type="date"
                  className="rounded border border-slate-200 px-2 py-1 text-[11px] print:hidden"
                  value={khbs.recoverDecisionDate}
                  onChange={e => setKhbs(p => ({ ...p, recoverDecisionDate: e.target.value }))}
                />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-bold">I.3 Lệnh hoàn — Số / Ngày</span>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded border border-slate-200 px-2 py-1 text-[11px] print:hidden"
                  value={khbs.recoverOrderNo}
                  onChange={e => setKhbs(p => ({ ...p, recoverOrderNo: e.target.value }))}
                  placeholder="Số"
                />
                <input
                  type="date"
                  className="rounded border border-slate-200 px-2 py-1 text-[11px] print:hidden"
                  value={khbs.recoverOrderDate}
                  onChange={e => setKhbs(p => ({ ...p, recoverOrderDate: e.target.value }))}
                />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-bold">II.1 Số ngày từ khi nhận tiền hoàn</span>
              <input
                className="w-28 rounded border border-slate-200 px-2 py-1 print:hidden"
                value={khbs.refundRecvDays}
                onChange={e => setKhbs(p => ({ ...p, refundRecvDays: e.target.value.replace(/\D/g, '') }))}
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="font-bold">II.2 Số lãi chậm nộp (theo công thức tại mẫu)</span>
              {moneyInput(khbs.refundLateInterest, v => setKhbs(p => ({ ...p, refundLateInterest: v })))}
            </label>
          </div>
        </div>
      </div>

      {/* ——— 01-1/KHBS ——— */}
      <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm md:p-6">
        <div className="relative mb-6">
          <div className="mx-auto max-w-2xl text-center md:pr-[232px]">
            <p className="text-[11px] font-bold uppercase leading-snug text-slate-900 sm:text-xs">
              Cộng hòa xã hội chủ nghĩa Việt Nam
            </p>
            <p className="mt-0.5 text-[11px] font-bold text-slate-900 sm:text-xs">Độc lập - Tự do - Hạnh phúc</p>
            <div className="mx-auto my-2 w-28 border-t border-dashed border-slate-500" />
            <h3 className="text-base font-black uppercase tracking-tight text-slate-900 sm:text-lg">
              Bản giải trình khai bổ sung
            </h3>
            <p className="mt-1 text-[10px] italic text-slate-700 sm:text-[11px]">
              (Kèm theo Tờ khai bổ sung mẫu số 01/KHBS)
            </p>
          </div>
          <div className="mx-auto mt-4 max-w-[280px] border-2 border-slate-800 bg-white p-2 text-[9px] leading-snug text-slate-800 md:absolute md:right-0 md:top-0 md:mx-0 md:mt-0 md:w-[230px]">
            <p className="font-bold">Mẫu số: 01-1/KHBS</p>
            <p className="mt-1 italic text-slate-700">
              (Ban hành kèm theo Thông tư số 80/2021/TT-BTC ngày 29 tháng 9 năm 2021 của Bộ trưởng Bộ Tài chính)
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-2.5 text-[11px] leading-relaxed text-slate-900">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[01] Mẫu tờ khai:</span>
            <span className="font-bold uppercase">
              Tờ khai thuế giá trị gia tăng (Mẫu số 01/GTGT)
            </span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[02] Mã giao dịch điện tử:</span>
            <input
              className="min-h-[28px] flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-[11px] print:hidden"
              value={khbs.transactionCode}
              onChange={e => setKhbs(p => ({ ...p, transactionCode: e.target.value }))}
              placeholder="Nhập mã giao dịch (nếu có)"
            />
            <span className="hidden font-mono text-[10px] print:inline">{khbs.transactionCode || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[03] Kỳ tính thuế:</span>
            <span className="font-semibold">{periodLabel}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[04] Bổ sung lần thứ:</span>
            <span className="font-semibold">{supplementaryNo || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[05] Tên người nộp thuế:</span>
            <input
              className="min-h-[28px] flex-1 rounded border border-slate-300 px-2 py-1 font-bold uppercase print:hidden"
              value={taxpayerName}
              onChange={e => setTaxpayerName(e.target.value)}
            />
            <span className="hidden font-bold uppercase print:inline">{taxpayerName || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 font-black text-slate-800">[06] Mã số thuế:</span>
            <input
              className="min-h-[28px] w-full max-w-xs rounded border border-slate-300 px-2 py-1 font-mono print:hidden"
              value={taxpayerTaxCode}
              onChange={e => setTaxpayerTaxCode(e.target.value)}
            />
            <span className="hidden font-mono print:inline">{taxpayerTaxCode || '—'}</span>
          </div>
        </div>

        <p className="mt-4 text-right text-[10px] italic text-slate-600">Đơn vị tiền: Đồng Việt Nam</p>

        <h4 className="mt-6 border-t border-slate-200 pt-4 text-[11px] font-black text-slate-900 sm:text-xs">
          A. Thông tin khai bổ sung
        </h4>
        <div className="overflow-x-auto border border-slate-200">
          <table className="w-full min-w-[960px] border-collapse text-[10px]">
            <thead className="bg-slate-100">
              <tr>
                <th className="border px-1 py-1 text-center align-middle">STT</th>
                <th className="border px-1 py-1 text-left">Tên chỉ tiêu / HHDV (2)</th>
                <th className="border px-1 py-1">Mã chỉ tiêu (3)</th>
                <th className="border px-1 py-1">Đã kê khai (4)</th>
                <th className="border px-1 py-1">Điều chỉnh (5)</th>
                <th className="border px-1 py-1">(6)=(5)-(4)</th>
                <th className="border px-1 py-1">Nghĩa vụ (7)</th>
                <th className="border px-1 py-1 text-left">Lý do (8)</th>
                <th className="border px-1 py-1">Nhóm</th>
                <th className="border px-0 print:hidden" />
              </tr>
            </thead>
            <tbody>
              {khbs.lines.map((l, idx) => {
                const d = parseNum(l.adjusted) - parseNum(l.reported);
                return (
                  <tr key={l.id}>
                    <td className="border px-1 text-center align-middle tabular-nums">{idx + 1}</td>
                    <td className="border px-1">
                      <input
                        className="w-full border-0 bg-transparent print:hidden"
                        value={l.itemName}
                        onChange={e => updateLine(l.id, { itemName: e.target.value })}
                      />
                      {printVal(l.itemName)}
                    </td>
                    <td className="border px-1">
                      <input
                        className="w-full border-0 bg-transparent font-mono print:hidden"
                        value={l.itemCode}
                        onChange={e => updateLine(l.id, { itemCode: e.target.value })}
                        placeholder="[40]…"
                      />
                      {printVal(l.itemCode)}
                    </td>
                    <td className="border px-1 text-right">
                      {moneyInput(l.reported, v => updateLine(l.id, { reported: v }), true)}
                      <span className="hidden print:inline">{formatCurrency(parseNum(l.reported))}</span>
                    </td>
                    <td className="border px-1 text-right">
                      {moneyInput(l.adjusted, v => updateLine(l.id, { adjusted: v }), true)}
                      <span className="hidden print:inline">{formatCurrency(parseNum(l.adjusted))}</span>
                    </td>
                    <td className="border px-1 text-right font-mono">{formatCurrency(d)}</td>
                    <td className="border px-1 text-right">
                      {moneyInput(l.liabilityAdj, v => updateLine(l.id, { liabilityAdj: v }), true)}
                      <span className="hidden print:inline">{formatCurrency(parseNum(l.liabilityAdj))}</span>
                    </td>
                    <td className="border px-1">
                      <input
                        className="w-full border-0 bg-transparent print:hidden"
                        value={l.reason}
                        onChange={e => updateLine(l.id, { reason: e.target.value })}
                      />
                      {printVal(l.reason)}
                    </td>
                    <td className="border px-1">
                      <select
                        className="w-full border-0 bg-transparent text-[10px] print:hidden"
                        value={l.category}
                        onChange={e =>
                          updateLine(l.id, { category: e.target.value as KhbsLineCategory })
                        }
                      >
                        <option value="PAYABLE">Phải nộp</option>
                        <option value="DEDUCTIBLE">Khấu trừ</option>
                        <option value="REFUND">ĐN hoàn</option>
                      </select>
                      <span className="hidden print:inline">{CAT_LABEL[l.category]}</span>
                    </td>
                    <td className="border print:hidden">
                      <button
                        type="button"
                        className="p-1 text-rose-600"
                        onClick={() => setKhbs(p => ({ ...p, lines: p.lines.filter(x => x.id !== l.id) }))}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 font-bold">
              <tr>
                <td colSpan={6} className="border px-2 text-right">
                  Tổng (7) phải nộp [07]
                </td>
                <td className="border px-2 text-right font-mono">{formatCurrency(totals111.t7)}</td>
                <td colSpan={3} className="border" />
              </tr>
              <tr>
                <td colSpan={6} className="border px-2 text-right">
                  Tổng (7) khấu trừ [08]
                </td>
                <td className="border px-2 text-right font-mono">{formatCurrency(totals111.t8)}</td>
                <td colSpan={3} className="border" />
              </tr>
              <tr>
                <td colSpan={6} className="border px-2 text-right">
                  Tổng (7) đề nghị hoàn [09]
                </td>
                <td className="border px-2 text-right font-mono">{formatCurrency(totals111.t9)}</td>
                <td colSpan={3} className="border" />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 print:hidden">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[10px] font-bold"
            onClick={() => setKhbs(p => ({ ...p, lines: [...p.lines, newKhbsLine('PAYABLE')] }))}
          >
            <Plus className="h-3 w-3" /> Dòng phải nộp
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[10px] font-bold"
            onClick={() => setKhbs(p => ({ ...p, lines: [...p.lines, newKhbsLine('DEDUCTIBLE')] }))}
          >
            <Plus className="h-3 w-3" /> Dòng khấu trừ
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[10px] font-bold"
            onClick={() => setKhbs(p => ({ ...p, lines: [...p.lines, newKhbsLine('REFUND')] }))}
          >
            <Plus className="h-3 w-3" /> Dòng hoàn
          </button>
        </div>

        <h4 className="mt-6 text-xs font-black uppercase text-slate-800">B. Tài liệu kèm theo (nếu có)</h4>
        <table className="mt-2 w-full border-collapse border border-slate-200 text-[11px]">
          <thead className="bg-slate-100">
            <tr>
              <th className="border px-2 py-1 text-center align-middle">STT</th>
              <th className="border px-2 py-1 text-left">Tên tài liệu / chỉ tiêu</th>
              <th className="border px-0 print:hidden" />
            </tr>
          </thead>
          <tbody>
            {khbs.documents.map((d, i) => (
              <tr key={d.id}>
                <td className="border px-2 text-center align-middle tabular-nums">{i + 1}</td>
                <td className="border px-2">
                  <input
                    className="w-full border-0 print:hidden"
                    value={d.title}
                    onChange={e =>
                      setKhbs(p => ({
                        ...p,
                        documents: p.documents.map(x => (x.id === d.id ? { ...x, title: e.target.value } : x)),
                      }))
                    }
                  />
                  <span className="hidden print:inline">{d.title}</span>
                </td>
                <td className="border print:hidden">
                  <button
                    type="button"
                    className="p-1 text-rose-600"
                    onClick={() =>
                      setKhbs(p => ({ ...p, documents: p.documents.filter(x => x.id !== d.id) }))
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="mt-1 text-[10px] font-bold text-indigo-600 print:hidden hover:underline"
          onClick={() => setKhbs(p => ({ ...p, documents: [...p.documents, newKhbsDocRow()] }))}
        >
          + Thêm tài liệu
        </button>

        <p className="mt-6 text-[11px] leading-relaxed text-slate-700">
          Tôi cam đoan số liệu khai trên là đúng và chịu trách nhiệm trước pháp luật về những số liệu đã khai…
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 text-[11px]">
          <div className="rounded border border-dashed border-slate-200 p-3">
            <p className="font-black uppercase">Nhân viên đại lý thuế</p>
            <input
              className="mt-2 w-full rounded border border-slate-200 px-2 py-1 print:hidden"
              placeholder="Họ tên"
              value={khbs.khbs111AgentName}
              onChange={e => setKhbs(p => ({ ...p, khbs111AgentName: e.target.value }))}
            />
            <input
              className="mt-2 w-full rounded border border-slate-200 px-2 py-1 print:hidden"
              placeholder="Chứng chỉ hành nghề số"
              value={khbs.khbs111AgentCert}
              onChange={e => setKhbs(p => ({ ...p, khbs111AgentCert: e.target.value }))}
            />
          </div>
          <div className="rounded border border-dashed border-slate-200 p-3 text-right">
            <input
              className="mb-2 w-full rounded border border-slate-200 px-2 py-1 text-right print:hidden"
              placeholder="Ngày … tháng … năm …"
              value={khbs.khbs111PlaceDate}
              onChange={e => setKhbs(p => ({ ...p, khbs111PlaceDate: e.target.value }))}
            />
            <p className="font-black uppercase">Người nộp thuế / Đại diện hợp pháp</p>
            <input
              className="mt-2 w-full rounded border border-slate-200 px-2 py-1 text-right print:hidden"
              placeholder="Họ tên, ký ghi rõ họ tên"
              value={khbs.khbs111TaxpayerSigner}
              onChange={e => setKhbs(p => ({ ...p, khbs111TaxpayerSigner: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          @media print {
            .khbs-supplementary input, .khbs-supplementary select { display: none !important; }
            .khbs-supplementary .print\\:inline { display: inline !important; }
            .khbs-supplementary .print\\:block { display: block !important; }
          }
        `,
        }}
      />
    </div>
  );
};
