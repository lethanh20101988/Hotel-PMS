import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Printer, RefreshCw, Trash2 } from 'lucide-react';
import type { CompanyInfo, FinancialYear, Invoice } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { monthRange, quarterRange, type Gtgt01PeriodRange } from '../utils/gtgt01Aggregation';
import { suggestPl204RowsFromInvoices } from '../utils/vatPl204Aggregation';
import {
  emptyPl204AnnexState,
  newPl204PuRow,
  newPl204SaRow,
  type Pl204AnnexFormState,
  type VatPl204LinkedMode,
} from '../utils/vatPl204AnnexState';

export type { Pl204AnnexFormState, VatPl204LinkedMode } from '../utils/vatPl204AnnexState';
export { emptyPl204AnnexState } from '../utils/vatPl204AnnexState';

type PeriodKind = 'MONTH' | 'QUARTER';

function parseNum(v: string): number {
  const n = Number(String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parseRate(v: string): number {
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export interface VatPl204ReductionAnnexProps {
  invoices: Invoice[];
  companyInfo: CompanyInfo;
  financialYear: FinancialYear;
  /** Gắn với 01/GTGT: cùng tháng/quý, dữ liệu phụ lục theo từng kỳ kê khai */
  linkedMode?: VatPl204LinkedMode;
}

export const VatPl204ReductionAnnex: React.FC<VatPl204ReductionAnnexProps> = ({
  invoices,
  companyInfo,
  financialYear,
  linkedMode,
}) => {
  const fyYear = useMemo(() => new Date(financialYear.startDate).getFullYear(), [financialYear.startDate]);

  const invoicesInFy = useMemo(
    () => invoices.filter(inv => inv.date >= financialYear.startDate && inv.date <= financialYear.endDate),
    [invoices, financialYear.startDate, financialYear.endDate],
  );

  const [periodKind, setPeriodKind] = useState<PeriodKind>('QUARTER');
  const [year, setYear] = useState(fyYear);
  const [month, setMonth] = useState(1);
  const [quarter, setQuarter] = useState(1);

  const [taxpayerName, setTaxpayerName] = useState(companyInfo.name || '');
  const [taxpayerTaxCode, setTaxpayerTaxCode] = useState(companyInfo.taxCode || '');

  const [standaloneAnnex, setStandaloneAnnex] = useState<Pl204AnnexFormState>(() => emptyPl204AnnexState());

  const annex = linkedMode ? linkedMode.annexState : standaloneAnnex;
  const { puRows, saRows, agentName, agentTaxCode } = annex;

  const setAnnexFull = useCallback(
    (next: Pl204AnnexFormState | ((prev: Pl204AnnexFormState) => Pl204AnnexFormState)) => {
      if (linkedMode) {
        const prev = linkedMode.annexState;
        const resolved = typeof next === 'function' ? (next as (p: Pl204AnnexFormState) => Pl204AnnexFormState)(prev) : next;
        linkedMode.onAnnexChange(resolved);
      } else {
        setStandaloneAnnex(next);
      }
    },
    [linkedMode],
  );

  const periodRange: Gtgt01PeriodRange = useMemo(() => {
    if (linkedMode) return linkedMode.periodRange;
    if (periodKind === 'MONTH') return monthRange(year, month);
    return quarterRange(year, quarter);
  }, [linkedMode, periodKind, year, month, quarter]);

  const displayTaxpayerName = linkedMode ? linkedMode.taxpayerName : taxpayerName;
  const displayTaxpayerTaxCode = linkedMode ? linkedMode.taxpayerTaxCode : taxpayerTaxCode;

  React.useEffect(() => {
    if (linkedMode) return;
    if (companyInfo.name) setTaxpayerName(companyInfo.name);
    if (companyInfo.taxCode) setTaxpayerTaxCode(companyInfo.taxCode);
  }, [companyInfo.name, companyInfo.taxCode, linkedMode]);

  const reducedRate = useCallback((prescribedStr: string) => {
    const p = parseRate(prescribedStr);
    if (p <= 0) return 0;
    return Math.round(p * 80) / 100;
  }, []);

  const salesCol6 = useCallback(
    (c3: string, c4: string) => {
      const v3 = parseNum(c3);
      const p4 = parseRate(c4);
      const p5 = reducedRate(c4);
      return Math.round((v3 * (p4 - p5)) / 100);
    },
    [reducedRate],
  );

  const totals = useMemo(() => {
    let sumI3 = 0;
    let sumI4PurchaseVat = 0;
    for (const r of puRows) {
      sumI3 += parseNum(r.c3);
      sumI4PurchaseVat += parseNum(r.c4);
    }
    let sumII3 = 0;
    let sumII6Reduction = 0;
    for (const r of saRows) {
      sumII3 += parseNum(r.c3);
      sumII6Reduction += salesCol6(r.c3, r.c4);
    }
    const v08 = sumI4PurchaseVat;
    const v06 = sumII6Reduction;
    const v09 = v08 - v06;
    return { sumI3, sumI4: v08, sumII3, sumII6: v06, v09 };
  }, [puRows, saRows, salesCol6]);

  const applyFromInvoices = useCallback(() => {
    const { purchases, sales } = suggestPl204RowsFromInvoices(invoicesInFy, periodRange);
    setAnnexFull(prev => ({
      ...prev,
      puRows:
        purchases.length > 0
          ? purchases.map(p => ({
              id: p.id,
              name: p.name,
              c3: p.valueExVat ? String(p.valueExVat) : '',
              c4: p.vatDeductible ? String(p.vatDeductible) : '',
            }))
          : [newPl204PuRow()],
      saRows:
        sales.length > 0
          ? sales.map(s => ({
              id: s.id,
              name: s.name,
              c3: s.valueExVat ? String(s.valueExVat) : '',
              c4: String(s.ratePrescribed),
            }))
          : [newPl204SaRow()],
    }));
  }, [invoicesInFy, periodRange, setAnnexFull]);

  const moneyInput = (val: string, setVal: (s: string) => void) => (
    <input
      className="w-full min-w-[100px] rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs print:hidden"
      value={val}
      onChange={e => setVal(e.target.value.replace(/[^\d]/g, ''))}
      placeholder="0"
    />
  );

  const rateInput = (val: string, setVal: (s: string) => void) => (
    <input
      className="w-full min-w-[56px] rounded border border-slate-200 px-2 py-1 text-center font-mono text-xs print:hidden"
      value={val}
      onChange={e => setVal(e.target.value.replace(/[^\d.]/g, ''))}
      placeholder="10"
    />
  );

  const textInput = (val: string, setVal: (s: string) => void) => (
    <input
      className="w-full rounded border border-slate-200 px-2 py-1 text-xs print:hidden"
      value={val}
      onChange={e => setVal(e.target.value)}
    />
  );

  const printMoney = (n: number) => (
    <span className="hidden text-right font-mono text-xs print:inline">{formatCurrency(n)}</span>
  );

  const printText = (s: string) => (
    <span className="hidden text-xs print:inline">{s || '—'}</span>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-start gap-2 text-teal-900">
          <div>
            <p className="text-[11px] font-bold leading-tight text-slate-600">
              PL 142/2024/QH15 — 174/2024/QH15 — 204/2025/QH15
            </p>
            <h2 className="text-lg font-black tracking-tight">Bảng kê giảm thuế GTGT (thuế suất 8%)</h2>
            {linkedMode && (
              <p className="mt-1 text-[10px] font-bold text-teal-800">
                Phụ lục gắn với tờ khai 01/GTGT cùng kỳ: {linkedMode.periodRange.label}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyFromInvoices}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white shadow hover:bg-teal-700"
          >
            <RefreshCw className="h-4 w-4" /> Trích xuất từ hóa đơn
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white shadow hover:bg-slate-900"
          >
            <Printer className="h-4 w-4" /> In
          </button>
        </div>
      </div>

      <div className="pl204-annex-print rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4 border-b border-slate-200 pb-4 text-center print:border-slate-300">
          <h1 className="text-sm font-black uppercase leading-snug text-slate-900 md:text-base">
            Giảm thuế giá trị gia tăng theo Nghị quyết số 204/2025/QH15
          </h1>
          <p className="text-xs font-semibold text-slate-700">
            (Kèm theo Tờ khai thuế GTGT kỳ tính thuế {periodRange.label})
          </p>
          <p className="text-[10px] font-bold text-slate-500">
            Bảng kê: PL 142/2024/QH15 — 174/2024/QH15 — 204/2025/QH15
          </p>
        </div>

        {!linkedMode && (
          <div className="mt-4 grid gap-3 text-sm print:hidden md:grid-cols-2">
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-400">Kỳ bảng kê</span>
              <div className="mt-1 flex flex-wrap gap-2">
                <select
                  className="rounded-lg border border-slate-200 px-2 py-2 text-xs font-bold"
                  value={periodKind}
                  onChange={e => setPeriodKind(e.target.value as PeriodKind)}
                >
                  <option value="MONTH">Theo tháng</option>
                  <option value="QUARTER">Theo quý</option>
                </select>
                <input
                  type="number"
                  className="w-24 rounded-lg border border-slate-200 px-2 py-2 text-center font-mono text-xs font-bold"
                  value={year}
                  onChange={e => setYear(Number(e.target.value) || fyYear)}
                  min={2000}
                  max={2100}
                />
                {periodKind === 'MONTH' ? (
                  <select
                    className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-xs font-bold"
                    value={month}
                    onChange={e => setMonth(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                      <option key={m} value={m}>
                        Tháng {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-xs font-bold"
                    value={quarter}
                    onChange={e => setQuarter(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4].map(q => (
                      <option key={q} value={q}>
                        Quý {q}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>
            <p className="flex items-end text-xs font-bold text-teal-800">{periodRange.label}</p>
          </div>
        )}

        {linkedMode && (
          <div className="mt-4 rounded-lg border border-teal-100 bg-teal-50/50 px-3 py-2 text-center print:hidden">
            <p className="text-xs font-bold text-teal-900">Kỳ bảng kê trùng với mục [01b] tờ khai 01/GTGT phía trên</p>
            <p className="text-[11px] font-black text-teal-800">{periodRange.label}</p>
          </div>
        )}

        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <label className="block">
            <span className="text-[10px] font-black uppercase text-slate-400">[01] Tên người nộp thuế</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold uppercase print:border-0 disabled:bg-slate-50"
              value={displayTaxpayerName}
              onChange={e => (linkedMode ? undefined : setTaxpayerName(e.target.value))}
              disabled={Boolean(linkedMode)}
              readOnly={Boolean(linkedMode)}
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black uppercase text-slate-400">[02] Mã số thuế</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs print:border-0 disabled:bg-slate-50"
              value={displayTaxpayerTaxCode}
              onChange={e => (linkedMode ? undefined : setTaxpayerTaxCode(e.target.value))}
              disabled={Boolean(linkedMode)}
              readOnly={Boolean(linkedMode)}
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black uppercase text-slate-400">[03] Tên đại lý thuế (nếu có)</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs print:border-0"
              value={agentName}
              onChange={e => setAnnexFull(p => ({ ...p, agentName: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black uppercase text-slate-400">[04] Mã số thuế đại lý thuế</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs print:border-0"
              value={agentTaxCode}
              onChange={e => setAnnexFull(p => ({ ...p, agentTaxCode: e.target.value }))}
            />
          </label>
        </div>

        <p className="mt-3 text-right text-xs font-bold text-slate-600">Đơn vị tiền: Đồng Việt Nam</p>

        <div className="mt-6 hidden text-xs font-bold text-slate-800 print:block">
          Kỳ: {periodRange.label} — [01] {displayTaxpayerName} — [02] {displayTaxpayerTaxCode}
        </div>

        <section className="mt-8">
          <h3 className="mb-2 text-xs font-black uppercase leading-snug text-slate-900">
            I. Hàng hóa, dịch vụ mua vào trong kỳ được áp dụng mức thuế suất thuế giá trị gia tăng 8% (áp dụng
            cho người nộp thuế kê khai theo phương pháp khấu trừ thuế)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse border border-slate-300 text-xs">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="border border-slate-300 px-2 py-2 font-black">STT (1)</th>
                  <th className="border border-slate-300 px-2 py-2 font-black">Tên hàng hóa, dịch vụ (2)</th>
                  <th className="border border-slate-300 px-2 py-2 font-black text-right">
                    Giá trị HHDV mua vào chưa có thuế GTGT được khấu trừ trong kỳ (3)
                  </th>
                  <th className="border border-slate-300 px-2 py-2 font-black text-right">
                    Thuế GTGT mua vào được khấu trừ trong kỳ (4)
                  </th>
                  <th className="border border-slate-300 px-1 py-2 w-10 print:hidden" />
                </tr>
              </thead>
              <tbody>
                {puRows.map((r, idx) => (
                  <tr key={r.id}>
                    <td className="border border-slate-300 px-2 py-1 text-center font-mono">{idx + 1}</td>
                    <td className="border border-slate-300 px-1 py-1">
                      {textInput(r.name, v =>
                        setAnnexFull(p => ({
                          ...p,
                          puRows: p.puRows.map(x => (x.id === r.id ? { ...x, name: v } : x)),
                        })),
                      )}
                      {printText(r.name)}
                    </td>
                    <td className="border border-slate-300 px-1 py-1">
                      {moneyInput(r.c3, v =>
                        setAnnexFull(p => ({
                          ...p,
                          puRows: p.puRows.map(x => (x.id === r.id ? { ...x, c3: v } : x)),
                        })),
                      )}
                      {printMoney(parseNum(r.c3))}
                    </td>
                    <td className="border border-slate-300 px-1 py-1">
                      {moneyInput(r.c4, v =>
                        setAnnexFull(p => ({
                          ...p,
                          puRows: p.puRows.map(x => (x.id === r.id ? { ...x, c4: v } : x)),
                        })),
                      )}
                      {printMoney(parseNum(r.c4))}
                    </td>
                    <td className="border border-slate-300 px-1 print:hidden">
                      <button
                        type="button"
                        className="rounded p-1 text-rose-600 hover:bg-rose-50"
                        title="Xóa dòng"
                        onClick={() =>
                          setAnnexFull(p => ({
                            ...p,
                            puRows: p.puRows.length <= 1 ? p.puRows : p.puRows.filter(x => x.id !== r.id),
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td className="border border-slate-300 px-2 py-2" colSpan={2}>
                    Tổng cộng
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-right font-mono">{formatCurrency(totals.sumI3)}</td>
                  <td className="border border-slate-300 px-2 py-2 text-right font-mono">
                    <span className="mr-1 text-[10px] font-black text-slate-500">[08]</span>
                    {formatCurrency(totals.sumI4)}
                  </td>
                  <td className="print:hidden" />
                </tr>
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-teal-700 print:hidden hover:underline"
            onClick={() => setAnnexFull(p => ({ ...p, puRows: [...p.puRows, newPl204PuRow()] }))}
          >
            <Plus className="h-4 w-4" /> Thêm dòng mua vào
          </button>
        </section>

        <section className="mt-10">
          <h3 className="mb-2 text-xs font-black uppercase text-slate-900">II. Hàng hóa, dịch vụ bán ra trong kỳ</h3>
          <p className="mb-2 text-[11px] leading-relaxed text-slate-600">
            (5) = (4) × 80%. &nbsp; (6) = (3) × [(4) − (5)] ÷ 100 — phần thuế GTGT được giảm do áp dụng mức 8%
            (không phải khai thêm như thuế suất riêng).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse border border-slate-300 text-xs">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="border border-slate-300 px-2 py-2 font-black">STT (1)</th>
                  <th className="border border-slate-300 px-2 py-2 font-black">Tên hàng hóa, dịch vụ (2)</th>
                  <th className="border border-slate-300 px-2 py-2 font-black text-right">
                    Giá trị HHDV bán ra chưa có thuế GTGT (3)
                  </th>
                  <th className="border border-slate-300 px-2 py-2 font-black text-center">
                    Thuế suất GTGT theo quy định % (4)
                  </th>
                  <th className="border border-slate-300 px-2 py-2 font-black text-center">
                    Thuế suất GTGT sau giảm % (5)=(4)×80%
                  </th>
                  <th className="border border-slate-300 px-2 py-2 font-black text-right">
                    Thuế GTGT được giảm (6)=(3)×[(4)−(5)]/100
                  </th>
                  <th className="border border-slate-300 px-1 py-2 w-10 print:hidden" />
                </tr>
              </thead>
              <tbody>
                {saRows.map((r, idx) => {
                  const p5 = reducedRate(r.c4);
                  const p6 = salesCol6(r.c3, r.c4);
                  return (
                    <tr key={r.id}>
                      <td className="border border-slate-300 px-2 py-1 text-center font-mono">{idx + 1}</td>
                      <td className="border border-slate-300 px-1 py-1">
                        {textInput(r.name, v =>
                          setAnnexFull(p => ({
                            ...p,
                            saRows: p.saRows.map(x => (x.id === r.id ? { ...x, name: v } : x)),
                          })),
                        )}
                        {printText(r.name)}
                      </td>
                      <td className="border border-slate-300 px-1 py-1">
                        {moneyInput(r.c3, v =>
                          setAnnexFull(p => ({
                            ...p,
                            saRows: p.saRows.map(x => (x.id === r.id ? { ...x, c3: v } : x)),
                          })),
                        )}
                        {printMoney(parseNum(r.c3))}
                      </td>
                      <td className="border border-slate-300 px-1 py-1">
                        {rateInput(r.c4, v =>
                          setAnnexFull(p => ({
                            ...p,
                            saRows: p.saRows.map(x => (x.id === r.id ? { ...x, c4: v } : x)),
                          })),
                        )}
                        <span className="hidden text-center font-mono text-xs print:inline">{r.c4 || '—'}</span>
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-center font-mono">{p5 || '—'}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right font-mono">
                        <span className="print:hidden">{formatCurrency(p6)}</span>
                        {printMoney(p6)}
                      </td>
                      <td className="border border-slate-300 px-1 print:hidden">
                        <button
                          type="button"
                          className="rounded p-1 text-rose-600 hover:bg-rose-50"
                          title="Xóa dòng"
                          onClick={() =>
                            setAnnexFull(p => ({
                              ...p,
                              saRows: p.saRows.length <= 1 ? p.saRows : p.saRows.filter(x => x.id !== r.id),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50 font-bold">
                  <td className="border border-slate-300 px-2 py-2" colSpan={2}>
                    Tổng cộng
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-right font-mono">{formatCurrency(totals.sumII3)}</td>
                  <td className="border border-slate-300 px-2 py-2 text-center text-slate-400">—</td>
                  <td className="border border-slate-300 px-2 py-2 text-center text-slate-400">—</td>
                  <td className="border border-slate-300 px-2 py-2 text-right font-mono">
                    <span className="mr-1 text-[10px] font-black text-slate-500">[06]</span>
                    {formatCurrency(totals.sumII6)}
                  </td>
                  <td className="print:hidden" />
                </tr>
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-teal-700 print:hidden hover:underline"
            onClick={() => setAnnexFull(p => ({ ...p, saRows: [...p.saRows, newPl204SaRow()] }))}
          >
            <Plus className="h-4 w-4" /> Thêm dòng bán ra
          </button>
        </section>

        <section className="mt-10 rounded-xl border border-teal-100 bg-teal-50/40 p-4">
          <h3 className="text-xs font-black uppercase leading-snug text-teal-950">
            III. Chênh lệch thuế GTGT của hàng hóa, dịch vụ bán ra và mua vào trong kỳ được áp dụng mức thuế suất
            thuế giá trị gia tăng 8%
          </h3>
          <p className="mt-2 text-sm font-bold text-slate-800">
            [09] = [08] − [06] = {formatCurrency(totals.sumI4)} − {formatCurrency(totals.sumII6)} ={' '}
            <span className="text-lg text-teal-900">{formatCurrency(totals.v09)}</span>
          </p>
        </section>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          @media print {
            @page { size: A4 landscape; margin: 10mm; }
            .pl204-annex-print input { display: none !important; }
            .pl204-annex-print .rounded-xl { box-shadow: none !important; }
          }
        `,
        }}
      />
    </div>
  );
};
