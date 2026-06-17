
import React, { useState, useMemo, useEffect } from 'react';
import { 
  PieChart, FileText, TrendingDown, AlertTriangle, ShieldCheck, 
  Filter, Calendar, DollarSign, Calculator, ChevronRight, Save
} from 'lucide-react';
import { useApp } from '../../../app/store';
import { formatCurrency } from '@shared/utils/format';
import { JournalEntry, CITLossRecord } from '@shared/types';
import { Pagination } from '@shared/components/Pagination';
import { formatCitVoucherNoForDisplay, resolveCitExpenseVoucherDisplay } from '../utils/citExpenseDisplay';

type TabType = 'EXPENSE' | 'QUARTERLY' | 'LOSS' | 'WARNING';

type StandardPageSize = 10 | 20 | 50 | 100;

function clampPageSize(n: number): StandardPageSize {
  if (n <= 10) return 10;
  if (n <= 20) return 20;
  if (n <= 50) return 50;
  return 100;
}

function hashString(input: string) {
  // Lightweight stable hash for sessionStorage keys (no crypto dependency)
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function logSlowQuery(label: string, ms: number, meta: Record<string, unknown>) {
  if (ms <= 200) return;
  // eslint-disable-next-line no-console
  console.warn(`[PERF] ${label} took ${Math.round(ms)}ms`, meta);
}

// --- SUB-COMPONENTS ---

// 1. Expense Classification View
const ExpenseClassificationView = () => {
  const { journalEntries, citExpenseMeta, handleUpdateCITMeta, financialYear, fundTransactions, transactions } = useApp();
  const [filter, setFilter] = useState<'ALL' | 'DEDUCTIBLE' | 'NON_DEDUCTIBLE'>('ALL');
  const [selected, setSelected] = useState<any>(null);

  // Pagination (remember per filter)
  const baseStorageKey = 'cit_expense_pagination';
  const filterSignature = useMemo(() => JSON.stringify({
    filter,
    fyStart: financialYear.startDate,
    fyEnd: financialYear.endDate,
  }), [filter, financialYear.endDate, financialYear.startDate]);
  const filterKey = useMemo(() => `f_${hashString(filterSignature)}`, [filterSignature]);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<StandardPageSize>(20);
  
  // Filter expenses (Debits to 6xx, 8xx) and bind to Financial Year
  const expenseEntries = useMemo(() => {
     const t0 = performance.now();
     const rows = journalEntries.flatMap(entry => {
        // Lọc bút toán thuộc niên độ
        if (entry.date < financialYear.startDate || entry.date > financialYear.endDate) return [];

        return entry.details
          .filter(d => ['632', '641', '642', '635', '811', '154', '627'].some(prefix => d.account.startsWith(prefix)) && d.debit > 0)
          .map(d => {
            const disp = resolveCitExpenseVoucherDisplay(entry, fundTransactions, transactions);
            const voucherShort = formatCitVoucherNoForDisplay(disp.voucherNo, entry);
            return {
              ...entry,
              expenseDetail: d,
              citMeta: citExpenseMeta[entry.id] || { journalEntryId: entry.id, isDeductible: true },
              citDisplayVoucherNo: voucherShort,
              citVoucherNoResolved: disp.voucherNo,
              citDocDescription: disp.docDescription,
            };
          });
     }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
     const ms = performance.now() - t0;
     logSlowQuery('CIT.ExpenseClassification.buildList', ms, { rows: rows.length });
     return rows;
  }, [journalEntries, citExpenseMeta, financialYear, fundTransactions, transactions]);

  const filteredData = expenseEntries.filter(item => {
     if (filter === 'ALL') return true;
     if (filter === 'DEDUCTIBLE') return item.citMeta.isDeductible;
     return !item.citMeta.isDeductible;
  });

  // Load remembered page/pageSize for this filter
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(baseStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      const saved = map?.[filterKey] || null;
      const lastSize = clampPageSize(Number(map?.__lastPageSize || 20));
      const p = Number(saved?.page || 1);
      const s = clampPageSize(Number(saved?.pageSize || lastSize));
      setPage(Number.isFinite(p) && p >= 1 ? p : 1);
      setPageSize(s);
    } catch {
      setPage(1);
      setPageSize(20);
    }
  }, [filterKey]);

  // Save remembered page/pageSize per filter
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(baseStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      map[filterKey] = { page, pageSize, updatedAt: Date.now() };
      map.__lastPageSize = pageSize;
      sessionStorage.setItem(baseStorageKey, JSON.stringify(map));
    } catch {
      // ignore
    }
  }, [filterKey, page, pageSize]);

  const totalItems = filteredData.length;
  const safePageSize = clampPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  useEffect(() => { if (safePage !== page) setPage(safePage); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [safePage, totalPages]);
  const pagedData = useMemo(() => {
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return filteredData.slice(from, to);
  }, [filteredData, safePage, safePageSize]);

  const fiscalYearLabel = new Date(financialYear.startDate).getFullYear();

  return (
    <div className="space-y-4 animate-fade-in">
       <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4">
             <div className="flex gap-2">
                <button 
                  onClick={() => setFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === 'ALL' ? 'bg-blue-100 text-blue-700' : 'bg-slate-50 text-slate-600'}`}
                >
                   Tất cả
                </button>
                <button 
                  onClick={() => setFilter('DEDUCTIBLE')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === 'DEDUCTIBLE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-slate-600'}`}
                >
                   Được trừ
                </button>
                <button 
                  onClick={() => setFilter('NON_DEDUCTIBLE')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === 'NON_DEDUCTIBLE' ? 'bg-red-100 text-red-700' : 'bg-slate-50 text-slate-600'}`}
                >
                   Không được trừ
                </button>
             </div>
             <span className="h-6 w-px bg-slate-200"></span>
             <span className="text-xs font-semibold text-blue-600">Niên độ: {fiscalYearLabel}</span>
          </div>
          <div className="text-sm text-slate-500 italic">
             * Phân loại chi phí để tính thuế TNDN (TT96/TT78)
          </div>
       </div>

       <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          {selected && (
            <div className="p-4 bg-slate-50 border-b">
              <div className="text-[10px] font-semibold text-slate-500 tracking-tight">Chi tiết</div>
              <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                <div className="bg-white rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold text-slate-500">Số chứng từ (gốc)</div>
                  <div className="font-mono font-bold text-slate-800">{selected.citDisplayVoucherNo}</div>
                  {selected.citVoucherNoResolved &&
                    selected.citVoucherNoResolved !== selected.citDisplayVoucherNo && (
                      <div className="text-[10px] text-slate-500 mt-1 font-mono break-all" title={selected.citVoucherNoResolved}>
                        Đầy đủ: {selected.citVoucherNoResolved}
                      </div>
                    )}
                  <div className="text-[10px] text-slate-400 mt-1 font-mono">Bút sổ: {selected.id}</div>
                  <div className="text-xs text-slate-500 mt-1">{new Date(selected.date).toLocaleDateString('vi-VN')}</div>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold text-slate-500">Tài khoản</div>
                  <div className="font-mono font-bold text-slate-800">{selected.expenseDetail?.account}</div>
                  <div className="text-[10px] font-semibold text-slate-500 mt-2">Diễn giải (phiếu thu/chi)</div>
                  <div className="text-xs text-slate-600 mt-1 line-clamp-2">{selected.citDocDescription}</div>
                  {String(selected.description || '').trim() !== String(selected.citDocDescription || '').trim() && (
                    <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">Sổ NK: {selected.description}</div>
                  )}
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-3 text-right">
                  <div className="text-[10px] font-semibold text-slate-500">Số tiền</div>
                  <div className="font-black text-slate-800">{formatCurrency(selected.expenseDetail?.debit || 0)}</div>
                  <div className={`text-xs font-bold mt-1 ${selected.citMeta?.isDeductible ? 'text-emerald-700' : 'text-red-700'}`}>
                    {selected.citMeta?.isDeductible ? 'Được trừ' : 'Không được trừ'}
                  </div>
                </div>
              </div>
            </div>
          )}
          <table className="w-full text-sm text-left">
             <thead className="border-b bg-slate-50 text-[10px] font-semibold tracking-tight text-slate-600">
                <tr>
                   <th className="p-3">Ngày</th>
                   <th className="p-3">Số CT / diễn giải</th>
                   <th className="p-3">Tài khoản</th>
                   <th className="p-3 text-right">Số tiền</th>
                   <th className="p-3 text-center">Trạng thái</th>
                   <th className="p-3">Lý do (nếu không được trừ)</th>
                </tr>
             </thead>
             <tbody className="divide-y divide-slate-100">
                {pagedData.map((item, idx) => (
                   <tr
                     key={`${item.id}-${item.expenseDetail?.account}-${idx}`}
                     className="hover:bg-slate-50 cursor-pointer"
                     onClick={() => setSelected(item)}
                     title="Click để xem chi tiết"
                   >
                      <td className="p-3 text-slate-600">{new Date(item.date).toLocaleDateString('vi-VN')}</td>
                      <td className="p-3">
                         <div
                           className="font-bold text-blue-600"
                           title={
                             [item.citVoucherNoResolved, item.id].filter(Boolean).join(' | ')
                           }
                         >
                           {item.citDisplayVoucherNo}
                         </div>
                         <div className="text-slate-500 truncate max-w-xs">{item.citDocDescription}</div>
                      </td>
                      <td className="p-3 font-mono font-bold">{item.expenseDetail.account}</td>
                      <td className="p-3 text-right font-medium">{formatCurrency(item.expenseDetail.debit)}</td>
                      <td className="p-3 text-center">
                         <select 
                           onClick={(e) => e.stopPropagation()}
                           className={`p-1.5 rounded text-xs font-bold border outline-none ${item.citMeta.isDeductible ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}
                           value={item.citMeta.isDeductible ? 'TRUE' : 'FALSE'}
                           onChange={(e) => handleUpdateCITMeta(item.id, e.target.value === 'TRUE', item.citMeta.reason)}
                         >
                            <option value="TRUE">Được trừ</option>
                            <option value="FALSE">Không được trừ</option>
                         </select>
                      </td>
                      <td className="p-3">
                         {!item.citMeta.isDeductible && (
                            <select 
                              onClick={(e) => e.stopPropagation()}
                              className="w-full p-1.5 border rounded text-xs bg-slate-50"
                              value={item.citMeta.reason || ''}
                              onChange={(e) => handleUpdateCITMeta(item.id, false, e.target.value)}
                            >
                               <option value="">-- Chọn lý do --</option>
                               <option value="KHONG_CO_HD">Không có hóa đơn chứng từ</option>
                               <option value="VUOT_DINH_MUC">Vượt định mức quy định</option>
                               <option value="KHONG_LIEN_QUAN">Không phục vụ SXKD</option>
                               <option value="TIEN_MAT_LON">TT tiền mặt &gt; 20 triệu</option>
                               <option value="TIEN_LUONG_KHONG_THUC_CHI">Tiền lương không thực chi</option>
                            </select>
                         )}
                      </td>
                   </tr>
                ))}
                {filteredData.length === 0 && (
                   <tr>
                      <td colSpan={6} className="p-12 text-center text-slate-400 font-medium italic">
                         Không có dữ liệu chi phí trong niên độ {fiscalYearLabel}.
                      </td>
                   </tr>
                )}
             </tbody>
          </table>
          <Pagination
            page={safePage}
            totalItems={totalItems}
            pageSize={safePageSize}
            onChangePage={setPage}
            onChangePageSize={(s) => setPageSize(clampPageSize(s))}
          />
       </div>
    </div>
  );
};

type ProvisionalPeriodKind = 'month' | 'quarter';

// 2. Provisional CIT calculation (by month or quarter)
const QuarterlyCalculationView = () => {
  const { journalEntries, citExpenseMeta, citLossRecords, financialYear } = useApp();
  const fiscalYearValue = useMemo(() => new Date(financialYear.startDate).getFullYear(), [financialYear]);
  
  const [year, setYear] = useState(fiscalYearValue);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [periodKind, setPeriodKind] = useState<ProvisionalPeriodKind>('quarter');
  const [taxRate, setTaxRate] = useState<number>(20);

  // Sync year when financialYear changes
  useEffect(() => {
    setYear(fiscalYearValue);
  }, [fiscalYearValue]);

  // Determine date range: either one calendar month or one quarter within `year`, clamped to fiscal year
  const startDate = useMemo(() => {
     let start: string;
     if (periodKind === 'month') {
       start = new Date(year, month - 1, 1).toISOString().split('T')[0];
     } else {
       start = new Date(year, (quarter - 1) * 3, 1).toISOString().split('T')[0];
     }
     return start < financialYear.startDate ? financialYear.startDate : start;
  }, [year, month, quarter, periodKind, financialYear]);

  const endDate = useMemo(() => {
     let end: string;
     if (periodKind === 'month') {
       end = new Date(year, month, 0).toISOString().split('T')[0];
     } else {
       end = new Date(year, quarter * 3, 0).toISOString().split('T')[0];
     }
     return end > financialYear.endDate ? financialYear.endDate : end;
  }, [year, month, quarter, periodKind, financialYear]);

  const periodLabelShort = periodKind === 'month'
    ? `Tháng ${month}/${year}`
    : `Quý ${quarter}/${year}`;

  // Aggregations within limited range
  const revenue = useMemo(() => {
    return journalEntries.reduce((sum, entry) => {
       if (entry.date >= startDate && entry.date <= endDate) {
          return sum + entry.details.reduce((s, d) => {
             if (['511', '515', '711'].some(p => d.account.startsWith(p))) return s + d.credit;
             return s;
          }, 0);
       }
       return sum;
    }, 0);
  }, [journalEntries, startDate, endDate]);

  const totalExpense = useMemo(() => {
    return journalEntries.reduce((sum, entry) => {
       if (entry.date >= startDate && entry.date <= endDate) {
          return sum + entry.details.reduce((s, d) => {
             if (['632', '635', '641', '642', '811'].some(p => d.account.startsWith(p))) return s + d.debit;
             return s;
          }, 0);
       }
       return sum;
    }, 0);
  }, [journalEntries, startDate, endDate]);

  const nonDeductible = useMemo(() => {
    return journalEntries.reduce((sum, entry) => {
       if (entry.date >= startDate && entry.date <= endDate) {
          const meta = citExpenseMeta[entry.id];
          if (meta && !meta.isDeductible) {
             return sum + entry.details.reduce((s, d) => {
                if (['632', '635', '641', '642', '811'].some(p => d.account.startsWith(p))) return s + d.debit;
                return s;
             }, 0);
          }
       }
       return sum;
    }, 0);
  }, [journalEntries, citExpenseMeta, startDate, endDate]);

  const deductibleExpense = totalExpense - nonDeductible;
  const operationalProfit = revenue - deductibleExpense;

  const availableLoss = useMemo(() => citLossRecords.reduce((sum, r) => sum + r.remainingAmount, 0), [citLossRecords]);
  const lossUsed = operationalProfit > 0 ? Math.min(operationalProfit, availableLoss) : 0;
  
  const taxableIncome = Math.max(0, operationalProfit - lossUsed);
  const taxDue = taxableIncome * (taxRate / 100);

  const taxPaid = useMemo(() => {
    return journalEntries.reduce((sum, entry) => {
      if (entry.date >= startDate && entry.date <= endDate) {
         return sum + entry.details.reduce((s, d) => d.account.startsWith('3334') ? s + d.debit : s, 0);
      }
      return sum;
    }, 0);
  }, [journalEntries, startDate, endDate]);

  const remainingTax = taxDue - taxPaid;

  return (
    <div className="space-y-6 animate-fade-in">
       <div className="flex flex-wrap gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-100 items-center">
          <div className="font-bold text-slate-700 flex items-center gap-2">
             <Calculator className="w-5 h-5 text-blue-600" /> Tạm tính thuế TNDN
          </div>
          <div className="flex flex-wrap items-center gap-3">
             <div className="flex items-center gap-2">
                <label htmlFor="cit-prov-month" className="text-xs font-semibold text-slate-500 whitespace-nowrap">Tháng</label>
                <select
                   id="cit-prov-month"
                   value={month}
                   onChange={(e) => {
                      const m = Number(e.target.value);
                      setMonth(m);
                      setQuarter(Math.ceil(m / 3));
                      setPeriodKind('month');
                   }}
                   className="min-w-[9.5rem] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-400 outline-none cursor-pointer"
                >
                   {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>Tháng {m}</option>
                   ))}
                </select>
             </div>
             <div className="flex items-center gap-2">
                <label htmlFor="cit-prov-quarter" className="text-xs font-semibold text-slate-500 whitespace-nowrap">Quý</label>
                <select
                   id="cit-prov-quarter"
                   value={quarter}
                   onChange={(e) => {
                      const q = Number(e.target.value);
                      setQuarter(q);
                      setMonth((q - 1) * 3 + 1);
                      setPeriodKind('quarter');
                   }}
                   className="min-w-[8.5rem] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-400 outline-none cursor-pointer"
                >
                   {[1, 2, 3, 4].map((q) => (
                      <option key={q} value={q}>Quý {q}</option>
                   ))}
                </select>
             </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
             <span className="text-xs font-semibold text-slate-500">Niên độ kế toán:</span>
             <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-black border border-blue-100">{year}</span>
          </div>
       </div>

       <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
             <div className="p-4 bg-slate-50 font-bold border-b text-slate-700 flex justify-between items-center flex-wrap gap-2">
                <span>Bảng tính chi tiết {periodLabelShort}</span>
                <span className="text-[10px] font-semibold text-slate-500">Phạm vi: {new Date(startDate).toLocaleDateString('vi-VN')} — {new Date(endDate).toLocaleDateString('vi-VN')}</span>
             </div>
             <div className="p-6 space-y-4">
                <div className="flex justify-between border-b pb-2">
                   <span className="text-slate-600">1. Tổng Doanh thu & Thu nhập (511, 515, 711)</span>
                   <span className="font-bold">{formatCurrency(revenue)}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                   <span className="text-slate-600">2. Tổng Chi phí phát sinh</span>
                   <span className="font-medium text-slate-800">({formatCurrency(totalExpense)})</span>
                </div>
                <div className="flex justify-between border-b pb-2 pl-4">
                   <span className="text-slate-500 italic">- Chi phí không được trừ (Bị loại)</span>
                   <span className="font-medium text-red-600">({formatCurrency(nonDeductible)})</span>
                </div>
                 <div className="flex justify-between border-b pb-2 pl-4">
                   <span className="text-emerald-700 font-bold">= Chi phí được trừ hợp lệ</span>
                   <span className="font-bold text-emerald-700">({formatCurrency(deductibleExpense)})</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                   <span className="text-slate-600">3. Thu nhập trước thuế (1 - 2)</span>
                   <span className={`font-bold ${operationalProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      {formatCurrency(operationalProfit)}
                   </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                   <span className="text-slate-600">4. Lỗ kết chuyển từ năm trước</span>
                   <span className="font-medium text-slate-800">({formatCurrency(lossUsed)})</span>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                   <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold text-blue-800">Thu nhập tính thuế</span>
                      <span className="font-bold text-xl text-blue-700">{formatCurrency(taxableIncome)}</span>
                   </div>
                   <div className="flex justify-between items-center border-t border-blue-200 pt-2">
                      <span className="text-xs font-semibold text-slate-600">Thuế suất áp dụng (%)</span>
                      <div className="relative">
                         <input 
                           type="number" 
                           className="w-20 p-1 border rounded font-black text-right pr-6 focus:ring-1 focus:ring-blue-500 outline-none" 
                           value={taxRate} 
                           onChange={(e) => setTaxRate(Number(e.target.value))}
                         />
                         <span className="absolute right-2 top-1 text-xs font-bold text-slate-400">%</span>
                      </div>
                   </div>
                </div>
             </div>
          </div>

          <div className="flex flex-col gap-6">
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 flex flex-col items-center justify-center text-center flex-1">
                 <p className="mb-2 text-xs font-semibold tracking-tight text-slate-600">
                    Thuế TNDN phải nộp {periodKind === 'month' ? `tháng ${month}/${year}` : `quý ${quarter}/${year}`}
                 </p>
                 <div className="text-4xl font-black text-red-600 mb-2 tracking-tighter">{formatCurrency(taxDue)}</div>
                 <p className="text-xs text-slate-400">
                    {periodKind === 'month'
                       ? 'Hạn nộp: theo thời hạn tạm nộp theo tháng (thường là cuối tháng kế tiếp)'
                       : 'Hạn nộp: ngày 30 tháng đầu quý sau'}
                 </p>
                 <div className="mt-4 text-[10px] text-slate-400 italic bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
                    (Cơ sở tính: {taxRate}% trên thu nhập tính thuế ròng)
                 </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
                 <div className="flex justify-between items-center mb-2">
                    <span className="text-slate-600 font-medium">
                       Đã tạm nộp {periodKind === 'month' ? 'trong tháng' : 'trong quý'}:
                    </span>
                    <span className="font-bold text-emerald-600">{formatCurrency(taxPaid)}</span>
                 </div>
                 <div className="border-t pt-2 flex justify-between items-center">
                    <span className="text-slate-800 font-bold">Còn phải nộp:</span>
                    <span className={`font-black text-lg ${remainingTax > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                       {formatCurrency(Math.max(0, remainingTax))}
                    </span>
                 </div>
                 {remainingTax < 0 && (
                    <p className="text-xs text-emerald-500 mt-2 italic">
                       * Đã nộp thừa {formatCurrency(Math.abs(remainingTax))}{' '}
                       {periodKind === 'month' ? 'trong tháng này' : 'trong quý này'}
                    </p>
                 )}
              </div>
          </div>
       </div>
    </div>
  );
};

// 3. Loss Tracking View (Chuyển lỗ 5 năm - Không ràng buộc Năm tài chính hiện tại vì tính chất lũy kế)
const LossTrackingView = () => {
  const { citLossRecords, handleUpdateLossRecord } = useApp();
  const [newYear, setNewYear] = useState(new Date().getFullYear() - 1);
  const [newLoss, setNewLoss] = useState('');
  const [selected, setSelected] = useState<CITLossRecord | null>(null);

  const baseStorageKey = 'cit_loss_pagination';
  const filterKey = 'default';
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<StandardPageSize>(20);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(baseStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      const saved = map?.[filterKey] || null;
      const lastSize = clampPageSize(Number(map?.__lastPageSize || 20));
      const p = Number(saved?.page || 1);
      const s = clampPageSize(Number(saved?.pageSize || lastSize));
      setPage(Number.isFinite(p) && p >= 1 ? p : 1);
      setPageSize(s);
    } catch {
      setPage(1);
      setPageSize(20);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(baseStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      map[filterKey] = { page, pageSize, updatedAt: Date.now() };
      map.__lastPageSize = pageSize;
      sessionStorage.setItem(baseStorageKey, JSON.stringify(map));
    } catch {
      // ignore
    }
  }, [page, pageSize]);

  const sortedLossRecords = useMemo(() => {
    const t0 = performance.now();
    const rows = [...citLossRecords].sort((a, b) => a.year - b.year);
    const ms = performance.now() - t0;
    logSlowQuery('CIT.LossTracking.sort', ms, { rows: rows.length });
    return rows;
  }, [citLossRecords]);

  const totalItems = sortedLossRecords.length;
  const safePageSize = clampPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, totalPages]);

  const pagedLossRecords = useMemo(() => {
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return sortedLossRecords.slice(from, to);
  }, [safePage, safePageSize, sortedLossRecords]);

  const handleAdd = () => {
     if (!newLoss) return;
     const amount = parseFloat(newLoss);
     handleUpdateLossRecord({
        id: Date.now().toString(), year: newYear, lossAmount: amount, transferredAmount: 0, remainingAmount: amount
     });
     setNewLoss('');
  };

  return (
    <div className="space-y-6 animate-fade-in">
       <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
             <TrendingDown className="w-5 h-5 text-red-500" /> Theo dõi lỗ lũy kế (Quy định 5 năm)
          </h3>
          
          <div className="flex gap-4 items-end mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-inner">
             <div>
                <label className="mb-1.5 block text-[10px] font-semibold tracking-tight text-slate-600">Năm phát sinh lỗ</label>
                <input 
                  type="number" 
                  value={newYear} 
                  onChange={e => setNewYear(Number(e.target.value))}
                  className="p-2 border rounded-lg w-32 font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                />
             </div>
             <div>
                <label className="mb-1.5 block text-[10px] font-semibold tracking-tight text-slate-600">Số tiền lỗ (VNĐ)</label>
                <input 
                  type="number" 
                  value={newLoss} 
                  onChange={e => setNewLoss(e.target.value)}
                  placeholder="Nhập số tiền..."
                  className="p-2 border rounded-lg w-64 font-bold text-red-600 focus:ring-2 focus:ring-red-500 outline-none"
                />
             </div>
             <button 
               onClick={handleAdd}
               className="px-6 py-2 bg-blue-600 text-white rounded-lg font-black hover:bg-blue-700 flex items-center gap-2 shadow-lg shadow-blue-100 transition-all active:scale-95"
             >
                <Save className="w-4 h-4" /> Lưu hồ sơ lỗ
             </button>
          </div>

          {selected && (
            <div className="mb-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="text-[10px] font-semibold tracking-tight text-slate-600">Chi tiết hồ sơ lỗ</div>
              <div className="mt-2 grid grid-cols-4 gap-3 text-sm">
                <div className="bg-white rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold text-slate-500">Năm</div>
                  <div className="font-black text-slate-800">{selected.year}</div>
                  <div className="text-xs text-slate-500 mt-1">Hết hạn: {selected.year + 5}</div>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-3 text-right">
                  <div className="text-[10px] font-semibold text-slate-500">Lỗ gốc</div>
                  <div className="font-black text-red-600">{formatCurrency(selected.lossAmount)}</div>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-3 text-right">
                  <div className="text-[10px] font-semibold text-slate-500">Đã chuyển</div>
                  <div className="font-bold text-slate-600">{formatCurrency(selected.transferredAmount)}</div>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-3 text-right">
                  <div className="text-[10px] font-semibold text-slate-500">Còn lại</div>
                  <div className="font-black text-blue-600">{formatCurrency(selected.remainingAmount)}</div>
                </div>
              </div>
            </div>
          )}

          <table className="w-full text-sm text-left">
             <thead className="border-b bg-slate-100 text-[10px] font-semibold tracking-tight text-slate-600">
                <tr>
                   <th className="p-3">Năm phát sinh</th>
                   <th className="p-3 text-right">Số lỗ nguyên gốc</th>
                   <th className="p-3 text-right">Đã chuyển lỗ</th>
                   <th className="p-3 text-right">Số lỗ còn lại</th>
                   <th className="p-3 text-right">Năm hết hạn</th>
                   <th className="p-3 text-center">Trạng thái</th>
                </tr>
             </thead>
             <tbody className="divide-y divide-slate-100">
                {pagedLossRecords.map((record) => (
                  <tr
                    key={record.year}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setSelected(record)}
                    title="Click để xem chi tiết"
                  >
                      <td className="p-3 font-black text-slate-700">{record.year}</td>
                      <td className="p-3 text-right font-medium text-red-600">{formatCurrency(record.lossAmount)}</td>
                      <td className="p-3 text-right text-slate-400">{formatCurrency(record.transferredAmount)}</td>
                      <td className="p-3 text-right font-black text-blue-600">{formatCurrency(record.remainingAmount)}</td>
                      <td className="p-3 text-right text-slate-500 font-mono">{record.year + 5}</td>
                      <td className="p-3 text-center">
                         {record.remainingAmount > 0 
                            ? <span className="rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-semibold tracking-tight text-red-800">Đang chuyển</span>
                            : <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold tracking-tight text-emerald-800">Đã tất toán</span>
                         }
                      </td>
                   </tr>
                ))}
                {citLossRecords.length === 0 && (
                   <tr>
                      <td colSpan={6} className="p-12 text-center text-slate-400 font-medium italic">Chưa ghi nhận hồ sơ lỗ từ các năm trước.</td>
                   </tr>
                )}
             </tbody>
          </table>

          {totalItems > 0 && (
            <Pagination
              page={safePage}
              totalItems={totalItems}
              pageSize={safePageSize}
              onChangePage={setPage}
              onChangePageSize={(s) => setPageSize(clampPageSize(s))}
            />
          )}
       </div>
    </div>
  );
};

// 4. Warning View (Cảnh báo rủi ro thuế)
const RiskWarningView = () => {
  const { journalEntries, financialYear } = useApp();
  const [selectedHighCash, setSelectedHighCash] = useState<JournalEntry | null>(null);
  const [selectedMissing, setSelectedMissing] = useState<JournalEntry | null>(null);

  const baseStorageKey = 'cit_warning_pagination';
  const highCashKey = useMemo(() => `high_${hashString(JSON.stringify({ fyStart: financialYear.startDate, fyEnd: financialYear.endDate }))}`, [financialYear.endDate, financialYear.startDate]);
  const missingKey = useMemo(() => `miss_${hashString(JSON.stringify({ fyStart: financialYear.startDate, fyEnd: financialYear.endDate }))}`, [financialYear.endDate, financialYear.startDate]);
  const [pageHigh, setPageHigh] = useState<number>(1);
  const [sizeHigh, setSizeHigh] = useState<StandardPageSize>(20);
  const [pageMiss, setPageMiss] = useState<number>(1);
  const [sizeMiss, setSizeMiss] = useState<StandardPageSize>(20);

  // Logic: Lọc bút toán rủi ro TRONG NIÊN ĐỘ
  const currentEntries = useMemo(() => 
    journalEntries.filter(e => e.date >= financialYear.startDate && e.date <= financialYear.endDate)
  , [journalEntries, financialYear]);

  // Cash payment > 20M
  const highCashTrans = currentEntries.filter(e => 
     e.details.some(d => d.account.startsWith('111') && d.credit > 20000000)
  );

  // Expense missing info (Simulated)
  const missingDocs = currentEntries.filter(e => 
     e.details.some(d => d.account.startsWith('6') || d.account.startsWith('8')) && 
     (!e.description.toLowerCase().includes('hđ') && !e.description.toLowerCase().includes('hóa đơn'))
  );

  // Load pagination memory
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(baseStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      const savedHigh = map?.[highCashKey] || null;
      const savedMiss = map?.[missingKey] || null;
      const lastSizeHigh = clampPageSize(Number(map?.__lastPageSizeHigh || 20));
      const lastSizeMiss = clampPageSize(Number(map?.__lastPageSizeMiss || 20));
      setPageHigh(Number(savedHigh?.page || 1));
      setSizeHigh(clampPageSize(Number(savedHigh?.pageSize || lastSizeHigh)));
      setPageMiss(Number(savedMiss?.page || 1));
      setSizeMiss(clampPageSize(Number(savedMiss?.pageSize || lastSizeMiss)));
    } catch {
      setPageHigh(1); setSizeHigh(20);
      setPageMiss(1); setSizeMiss(20);
    }
  }, [highCashKey, missingKey]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(baseStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      map[highCashKey] = { page: pageHigh, pageSize: sizeHigh, updatedAt: Date.now() };
      map[missingKey] = { page: pageMiss, pageSize: sizeMiss, updatedAt: Date.now() };
      map.__lastPageSizeHigh = sizeHigh;
      map.__lastPageSizeMiss = sizeMiss;
      sessionStorage.setItem(baseStorageKey, JSON.stringify(map));
    } catch {
      // ignore
    }
  }, [highCashKey, missingKey, pageHigh, sizeHigh, pageMiss, sizeMiss]);

  const highCashSorted = useMemo(() => {
    const t0 = performance.now();
    const rows = [...highCashTrans].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const ms = performance.now() - t0;
    logSlowQuery('CIT.Warning.sort(highCash)', ms, { rows: rows.length });
    return rows;
  }, [highCashTrans]);
  const missingSorted = useMemo(() => {
    const t0 = performance.now();
    const rows = [...missingDocs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const ms = performance.now() - t0;
    logSlowQuery('CIT.Warning.sort(missingDocs)', ms, { rows: rows.length });
    return rows;
  }, [missingDocs]);

  const highTotal = highCashSorted.length;
  const highPageSize = clampPageSize(sizeHigh);
  const highPages = Math.max(1, Math.ceil(highTotal / highPageSize));
  const highPage = Math.min(Math.max(1, pageHigh), highPages);
  useEffect(() => { if (highPage !== pageHigh) setPageHigh(highPage); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [highPage, highPages]);
  const highPaged = useMemo(() => {
    const size = Math.min(100, highPageSize);
    const from = (highPage - 1) * size;
    const to = from + size;
    return highCashSorted.slice(from, to);
  }, [highCashSorted, highPage, highPageSize]);

  const missTotal = missingSorted.length;
  const missPageSize = clampPageSize(sizeMiss);
  const missPages = Math.max(1, Math.ceil(missTotal / missPageSize));
  const missPage = Math.min(Math.max(1, pageMiss), missPages);
  useEffect(() => { if (missPage !== pageMiss) setPageMiss(missPage); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [missPage, missPages]);
  const missPaged = useMemo(() => {
    const size = Math.min(100, missPageSize);
    const from = (missPage - 1) * size;
    const to = from + size;
    return missingSorted.slice(from, to);
  }, [missingSorted, missPage, missPageSize]);

  const fiscalYearLabel = new Date(financialYear.startDate).getFullYear();

  return (
    <div className="space-y-6 animate-fade-in">
       <div className="bg-white p-3 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
           <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
              <ShieldCheck className="h-4 w-4 shrink-0" /> Rà soát rủi ro thuế niên độ {fiscalYearLabel}
           </div>
       </div>

       <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col overflow-hidden">
             <h3 className="p-4 font-bold text-slate-700 flex items-center gap-2 border-b bg-slate-50/50">
                <AlertTriangle className="w-5 h-5 text-amber-500" /> Chi tiền mặt trên 20 triệu
             </h3>
             <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                {selectedHighCash && (
                  <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
                    <div className="text-[10px] font-semibold tracking-tight text-amber-900">Chi tiết</div>
                    <div className="mt-1 text-xs text-amber-700">{selectedHighCash.description}</div>
                  </div>
                )}
                {highCashTrans.length === 0 ? (
                   <div className="py-10 flex flex-col items-center justify-center opacity-30">
                      <ShieldCheck className="w-12 h-12 text-emerald-500 mb-2"/>
                      <span className="text-xs font-semibold">An toàn</span>
                   </div>
                ) : (
                   highPaged.map(t => (
                      <div
                        key={t.id}
                        className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm transition-all hover:shadow-md cursor-pointer"
                        onClick={() => setSelectedHighCash(t)}
                        title="Click để xem chi tiết"
                      >
                         <div className="flex justify-between font-bold text-amber-800">
                            <span className="font-mono">{t.id}</span>
                            <span>{new Date(t.date).toLocaleDateString('vi-VN')}</span>
                         </div>
                         <div className="text-amber-700 mt-1 text-xs">{t.description}</div>
                         <div className="text-right font-black text-red-600 mt-2 text-lg">
                            {formatCurrency(t.details.find(d => d.account.startsWith('111'))?.credit || 0)}
                         </div>
                         <div className="text-[10px] text-amber-600 italic mt-2 p-1.5 bg-white/50 rounded border border-amber-200">
                            * Rủi ro: Loại chi phí này khi quyết toán thuế TNDN (Mã B4 trên tờ khai).
                         </div>
                      </div>
                   ))
                )}
             </div>
             {highCashTrans.length > 0 && (
               <Pagination
                 page={highPage}
                 totalItems={highTotal}
                 pageSize={highPageSize}
                 onChangePage={setPageHigh}
                 onChangePageSize={(s) => setSizeHigh(clampPageSize(s))}
               />
             )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col overflow-hidden">
             <h3 className="p-4 font-bold text-slate-700 flex items-center gap-2 border-b bg-slate-50/50">
                <FileText className="w-5 h-5 text-blue-500" /> Chi phí thiếu thông tin hóa đơn
             </h3>
             <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                {selectedMissing && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-[10px] font-semibold tracking-tight text-slate-700">Chi tiết</div>
                    <div className="mt-1 text-xs text-slate-700">{selectedMissing.description}</div>
                  </div>
                )}
                {missingDocs.length === 0 ? (
                   <div className="py-10 flex flex-col items-center justify-center opacity-30">
                      <ShieldCheck className="w-12 h-12 text-emerald-500 mb-2"/>
                      <span className="text-xs font-semibold">Hợp lệ</span>
                   </div>
                ) : (
                   missPaged.map(t => (
                      <div
                        key={t.id}
                        className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm hover:bg-white hover:shadow-md transition-all cursor-pointer"
                        onClick={() => setSelectedMissing(t)}
                        title="Click để xem chi tiết"
                      >
                          <div className="flex justify-between font-bold text-slate-700">
                            <span className="font-mono">{t.id}</span>
                            <span>{new Date(t.date).toLocaleDateString('vi-VN')}</span>
                         </div>
                         <div className="text-slate-600 mt-1 text-xs">{t.description}</div>
                         <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-100">
                            <span className="text-[10px] text-slate-400 italic">* Cần đối soát chứng từ gốc</span>
                            <span className="font-black text-slate-800">{formatCurrency(t.details.reduce((s,d) => s + d.debit, 0))}</span>
                         </div>
                      </div>
                   ))
                )}
             </div>
             {missingDocs.length > 0 && (
               <Pagination
                 page={missPage}
                 totalItems={missTotal}
                 pageSize={missPageSize}
                 onChangePage={setPageMiss}
                 onChangePageSize={(s) => setSizeMiss(clampPageSize(s))}
               />
             )}
          </div>
       </div>
    </div>
  );
};

export const CITPage = () => {
  const [activeTab, setActiveTab] = useState<TabType>('EXPENSE');

  return (
    <div className="space-y-6">
       {/* Sub Navigation */}
       <div className="bg-white p-1 rounded-xl border border-slate-200 inline-flex shadow-sm">
         <button 
           onClick={() => setActiveTab('EXPENSE')}
           className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'EXPENSE' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
         >
            <Filter className="h-4 w-4" /> Phân loại chi phí
         </button>
         <button 
           onClick={() => setActiveTab('QUARTERLY')}
           className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'QUARTERLY' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
         >
            <Calculator className="w-4 h-4" /> Tạm tính TNDN
         </button>
         <button 
           onClick={() => setActiveTab('LOSS')}
           className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'LOSS' ? 'bg-purple-600 text-white shadow' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
         >
            <TrendingDown className="h-4 w-4" /> Hồ sơ chuyển lỗ
         </button>
         <button 
           onClick={() => setActiveTab('WARNING')}
           className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'WARNING' ? 'bg-amber-500 text-white shadow' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
         >
            <AlertTriangle className="h-4 w-4" /> Kiểm tra & báo cáo
         </button>
      </div>

      {/* Content */}
      <div className="min-h-[500px]">
         {activeTab === 'EXPENSE' && <ExpenseClassificationView />}
         {activeTab === 'QUARTERLY' && <QuarterlyCalculationView />}
         {activeTab === 'LOSS' && <LossTrackingView />}
         {activeTab === 'WARNING' && <RiskWarningView />}
      </div>
    </div>
  );
};
