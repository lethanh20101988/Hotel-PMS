import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  Plus,
  Search,
  Eye,
  Edit,
  Trash2,
  Lock,
  FileText,
  CheckCircle2,
  XCircle,
  Calendar,
  X,
  ChevronDown,
} from 'lucide-react';
import { useApp } from '../../../app/store';
import { formatCurrency } from '@shared/utils/format';
import { AccountingVoucher, VoucherType, FundTransaction, InventoryTransaction } from '@shared/types';
import { VoucherForm } from '../components/VoucherForm';
import { Pagination } from '@shared/components/Pagination';

// Mapping tab ID to Voucher Type or Feature
const TAB_MAP: Record<string, { type: VoucherType | 'LINKED', title: string }> = {
  'doc_receipt': { type: 'RECEIPT', title: 'Phiếu thu' },
  'doc_payment': { type: 'PAYMENT', title: 'Phiếu chi' },
  'doc_bank': { type: 'PAYMENT_ORDER', title: 'Ủy nhiệm chi / Chuyển khoản' },
  'doc_debit_credit': { type: 'BANK_DEBIT', title: 'Giấy báo Nợ / Có' }, 
  'doc_import': { type: 'IMPORT', title: 'Phiếu nhập kho' },
  'doc_export': { type: 'EXPORT', title: 'Phiếu xuất kho' },
  'doc_adjust': { type: 'ADJUSTMENT', title: 'Phiếu điều chỉnh' },
  'doc_general': { type: 'GENERAL', title: 'Phiếu kế toán tổng hợp' },
};

type TimeFilterType = 'ALL' | 'TODAY' | 'MONTH' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'YEAR' | 'CUSTOM';
type StandardPageSize = 10 | 20 | 50 | 100;

function clampPageSize(n: number): StandardPageSize {
  if (n <= 10) return 10;
  if (n <= 20) return 20;
  if (n <= 50) return 50;
  return 100;
}

function logSlowQuery(label: string, ms: number, meta: Record<string, unknown>) {
  if (ms <= 200) return;
  // eslint-disable-next-line no-console
  console.warn(`[PERF] ${label} took ${Math.round(ms)}ms`, meta);
}

const TIME_FILTER_OPTIONS: { id: TimeFilterType; label: string }[] = [
  { id: 'ALL', label: 'Tất cả trong niên độ' },
  { id: 'TODAY', label: 'Hôm nay' },
  { id: 'MONTH', label: 'Tháng này' },
  { id: 'Q1', label: 'Quý 1' },
  { id: 'Q2', label: 'Quý 2' },
  { id: 'Q3', label: 'Quý 3' },
  { id: 'Q4', label: 'Quý 4' },
  { id: 'YEAR', label: 'Năm nay' },
  { id: 'CUSTOM', label: 'Tùy chọn khoảng ngày' },
];

function hashString(input: string) {
  // Lightweight stable hash for sessionStorage keys (no crypto dependency)
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export const DocumentPage = () => {
  const { 
    activeTab, 
    setActiveTab,
    accountingVouchers, 
    handleSaveVoucher, 
    handleDeleteVoucher, 
    handlePostVoucher, 
    handleUnpostVoucher, 
    fundTransactions, 
    transactions, 
    modals, 
    setModals,
    financialYear 
  } = useApp();
  
  const config = TAB_MAP[activeTab] || { type: 'GENERAL', title: 'Chứng từ' };
  
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<AccountingVoucher | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // States cho lọc thời gian
  const [timeFilter, setTimeFilter] = useState<TimeFilterType>('ALL');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const timeMenuRef = useRef<HTMLDivElement>(null);

  const timeFilterLabel = useMemo(
    () => TIME_FILTER_OPTIONS.find((o) => o.id === timeFilter)?.label ?? 'Tất cả trong niên độ',
    [timeFilter],
  );

  const closeTimeMenu = useCallback(() => setTimeMenuOpen(false), []);

  useEffect(() => {
    if (!timeMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = timeMenuRef.current;
      if (el && !el.contains(e.target as Node)) closeTimeMenu();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [timeMenuOpen, closeTimeMenu]);

  // --- PAGINATION (remember per tab + per filter signature) ---
  const baseStorageKey = `docs_pagination_${activeTab}`;
  const filterSignature = useMemo(() => {
    return JSON.stringify({
      q: (searchTerm || '').trim().toLowerCase(),
      timeFilter,
      from: customRange.from || '',
      to: customRange.to || '',
      fyStart: financialYear.startDate,
      fyEnd: financialYear.endDate,
    });
  }, [customRange.from, customRange.to, financialYear.endDate, financialYear.startDate, searchTerm, timeFilter]);
  const filterKey = useMemo(() => `f_${hashString(filterSignature)}`, [filterSignature]);

  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<StandardPageSize>(20);

  const fiscalYearLabel = new Date(financialYear.startDate).getFullYear();
  const isLinkedModule = ['doc_receipt', 'doc_payment', 'doc_import', 'doc_export'].includes(activeTab);

  // Load remembered pagination for the current (tab + filter) combo.
  // If combo hasn't been seen before, default page=1 but keep last pageSize if available.
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
  }, [baseStorageKey, filterKey]);

  // Remember page/pageSize per filter, and keep last pageSize as a tab-wide preference.
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
  }, [baseStorageKey, filterKey, page, pageSize]);

  // Cross-module trigger: allow other pages (e.g. Hoá đơn & VAT) to jump here and open a draft voucher (Ủy nhiệm chi)
  useEffect(() => {
    const draft = modals?.prefillVoucherDraft || null;
    const open = Boolean(modals?.openVoucherEditor);
    if (!open) return;

    // Ensure we're on the bank payment tab by default for this flow
    if (activeTab !== 'doc_bank') {
      setActiveTab('doc_bank');
    }

    setEditingVoucher(draft);
    setIsEditorOpen(true);
    setModals((m: any) => ({ ...m, openVoucherEditor: false, prefillVoucherDraft: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modals?.openVoucherEditor]);

  // --- LOGIC LỌC THỜI GIAN CHUNG ---
  const filterByTime = (dateStr: string) => {
    if (timeFilter === 'ALL') return true;
    
    const date = new Date(dateStr);
    const now = new Date();
    const currentYear = now.getFullYear();
    
    switch (timeFilter) {
      case 'TODAY':
        return dateStr.split('T')[0] === now.toISOString().split('T')[0];
      case 'MONTH':
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      case 'Q1':
        return date.getMonth() >= 0 && date.getMonth() <= 2 && date.getFullYear() === currentYear;
      case 'Q2':
        return date.getMonth() >= 3 && date.getMonth() <= 5 && date.getFullYear() === currentYear;
      case 'Q3':
        return date.getMonth() >= 6 && date.getMonth() <= 8 && date.getFullYear() === currentYear;
      case 'Q4':
        return date.getMonth() >= 9 && date.getMonth() <= 11 && date.getFullYear() === currentYear;
      case 'YEAR':
        return date.getFullYear() === currentYear;
      case 'CUSTOM':
        if (!customRange.from && !customRange.to) return true;
        const from = customRange.from ? new Date(customRange.from) : new Date(0);
        const to = customRange.to ? new Date(customRange.to) : new Date(8640000000000000);
        to.setHours(23, 59, 59, 999);
        return date >= from && date <= to;
      default:
        return true;
    }
  };

  const handleCreate = () => {
     if (isLinkedModule) {
        if (activeTab === 'doc_receipt') setModals(m => ({ ...m, showFundTransaction: true }));
        if (activeTab === 'doc_payment') setModals(m => ({ ...m, showFundTransaction: true }));
        if (activeTab === 'doc_import') setModals(m => ({ ...m, showStockAction: true, stockActionType: 'IMPORT' }));
        if (activeTab === 'doc_export') setModals(m => ({ ...m, showStockAction: true, stockActionType: 'EXPORT' }));
     } else {
        setEditingVoucher(null);
        setIsEditorOpen(true);
     }
  };

  const handleEdit = (voucher: AccountingVoucher) => {
     setEditingVoucher(voucher);
     setIsEditorOpen(true);
  };

  // Build active list (filter/sort only once per render) + performance log
  const activeList = useMemo(() => {
    const t0 = performance.now();

    // Linked modules: Quỹ (phiếu thu/chi)
     if (activeTab === 'doc_receipt' || activeTab === 'doc_payment') {
        const type = activeTab === 'doc_receipt' ? 'RECEIPT' : 'PAYMENT';
        const q = (searchTerm || '').toLowerCase();
      const rows = fundTransactions.filter(t =>
           t.type === type &&
           t.date >= financialYear.startDate &&
           t.date <= financialYear.endDate &&
           filterByTime(t.date) &&
           (
             (t.description || '').toLowerCase().includes(q) ||
             (t.payerReceiver || '').toLowerCase().includes(q) ||
             (t.voucherNumber || '').toLowerCase().includes(q) ||
             (t.referenceDoc || '').toLowerCase().includes(q)
           )
        );

      const ms = performance.now() - t0;
      logSlowQuery('DocumentPage.filter(fundTransactions)', ms, { activeTab, rows: rows.length });
      return { kind: 'FUND' as const, rows };
    }

    // Linked modules: Kho (phiếu nhập/xuất)
    if (activeTab === 'doc_import' || activeTab === 'doc_export') {
      const type = activeTab === 'doc_import' ? 'IMPORT' : 'EXPORT';
      const q = (searchTerm || '').toLowerCase();
      const rows = transactions.filter(t =>
        t.type === type &&
        t.date >= financialYear.startDate &&
        t.date <= financialYear.endDate &&
        filterByTime(t.date) &&
        (
          (t.itemName || '').toLowerCase().includes(q) ||
          (t.voucherNumber || '').toLowerCase().includes(q) ||
          (t.documentRef || '').toLowerCase().includes(q)
        )
      );

      const ms = performance.now() - t0;
      logSlowQuery('DocumentPage.filter(inventoryTransactions)', ms, { activeTab, rows: rows.length });
      return { kind: 'WAREHOUSE' as const, rows };
    }

    // Accounting vouchers
    const q = (searchTerm || '').toLowerCase();
    let rows = accountingVouchers.filter(v =>
      v.date >= financialYear.startDate &&
      v.date <= financialYear.endDate &&
      filterByTime(v.date) &&
      ((v.description || '').toLowerCase().includes(q) || (v.voucherNumber || '').toLowerCase().includes(q))
    );

    if (activeTab === 'doc_debit_credit') {
      rows = rows.filter(v => v.voucherType === 'BANK_DEBIT' || v.voucherType === 'BANK_CREDIT');
    } else {
      rows = rows.filter(v => v.voucherType === config.type);
    }

    const ms = performance.now() - t0;
    logSlowQuery('DocumentPage.filter(accountingVouchers)', ms, { activeTab, rows: rows.length });
    return { kind: 'VOUCHER' as const, rows };
  }, [
    activeTab,
    accountingVouchers,
    config.type,
    customRange.from,
    customRange.to,
    financialYear.endDate,
    financialYear.startDate,
    fundTransactions,
    searchTerm,
    timeFilter,
    transactions,
  ]);

  const totalItems = activeList.rows.length;
  const safePageSize = clampPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, totalPages]);

  const pagedRows = useMemo(() => {
    // Hard rule: never render > 100 rows
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return activeList.rows.slice(from, to);
  }, [activeList.rows, safePage, safePageSize]);

  const renderList = () => {
    if (activeList.kind === 'FUND') {
      const data = pagedRows as FundTransaction[];
        return (
        <>
           <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                 <tr>
                    <th className="p-3">Ngày CT</th>
                    <th className="p-3">Số CT</th>
                    <th className="p-3">Đối tượng</th>
                    <th className="p-3">Diễn giải</th>
                    <th className="p-3 text-right">Số tiền</th>
                    <th className="p-3 text-center">Trạng thái</th>
                    <th className="p-3 text-right">Thao tác</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                 {data.map(item => (
                <tr
                  key={item.id}
                  className="hover:bg-slate-50 group cursor-pointer"
                  onClick={() => setModals(m => ({ ...m, viewFundTransaction: item }))}
                >
                       <td className="p-3">{new Date(item.date).toLocaleDateString('vi-VN')}</td>
                       <td className="p-3 font-bold text-blue-600 font-mono text-xs">{item.voucherNumber || item.referenceDoc || item.id.split('-').pop()}</td>
                       <td className="p-3 font-medium">{item.payerReceiver}</td>
                       <td className="p-3 text-slate-500 text-xs italic">{item.description}</td>
                       <td className="p-3 text-right font-bold text-slate-700">{formatCurrency(item.amount)}</td>
                  <td className="p-3 text-center">
                    <span className="rounded bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">Đã ghi sổ</span>
                  </td>
                  <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                             <button onClick={() => setModals(m => ({ ...m, viewFundTransaction: item }))} className="p-1.5 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded" title="Xem">
                                <Eye className="w-4 h-4" />
                             </button>
                             <button onClick={() => setModals(m => ({ ...m, deleteFundTransaction: item }))} className="p-1.5 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded" title="Xóa">
                                <Trash2 className="w-4 h-4" />
                             </button>
                          </div>
                       </td>
                    </tr>
                 ))}
              {totalItems === 0 && (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">Không có chứng từ phù hợp trong năm {fiscalYearLabel}</td>
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
        </>
      );
    }

    if (activeList.kind === 'WAREHOUSE') {
      const data = pagedRows as InventoryTransaction[];
        return (
        <>
           <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                 <tr>
                    <th className="p-3">Ngày CT</th>
                    <th className="p-3">Số chứng từ</th>
                    <th className="p-3">Tên hàng / Vật tư</th>
                    <th className="p-3 text-right">Số lượng</th>
                    <th className="p-3 text-right">Đơn giá</th>
                    <th className="p-3 text-right">Thành tiền</th>
                    <th className="p-3 text-right">Thao tác</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                 {data.map(item => (
                <tr
                  key={item.id}
                  className="hover:bg-slate-50 group cursor-pointer"
                  onClick={() => setModals(m => ({ ...m, viewTransaction: item, viewTransactionCompact: true }))}
                >
                       <td className="p-3 text-slate-500">{new Date(item.date).toLocaleDateString('vi-VN')}</td>
                       <td className="p-3 font-bold text-blue-600 font-mono text-xs">{item.voucherNumber || item.documentRef || item.id.split('-').pop()}</td>
                       <td className="p-3 font-medium text-slate-800">{item.itemName}</td>
                       <td className="p-3 text-right font-bold">{item.quantity}</td>
                       <td className="p-3 text-right">{formatCurrency(item.price)}</td>
                       <td className="p-3 text-right font-bold text-slate-700">{formatCurrency(item.quantity * item.price)}</td>
                  <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                             <button onClick={() => setModals(m => ({ ...m, viewTransaction: item, viewTransactionCompact: true }))} className="p-1.5 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded" title="Xem">
                                <Eye className="w-4 h-4" />
                             </button>
                             <button onClick={() => setModals(m => ({ ...m, deleteTransaction: item }))} className="p-1.5 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded" title="Xóa">
                                <Trash2 className="w-4 h-4" />
                             </button>
                          </div>
                       </td>
                    </tr>
                 ))}
              {totalItems === 0 && (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">Không có chứng từ phù hợp trong năm {fiscalYearLabel}</td>
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
        </>
      );
    }

    const data = pagedRows as AccountingVoucher[];
     return (
      <>
        <table className="w-full text-sm text-left">
           <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
              <tr>
                 <th className="p-3">Số chứng từ</th>
                 <th className="p-3">Ngày CT</th>
                 <th className="p-3">Ngày HT</th>
                 <th className="p-3">Diễn giải</th>
                 <th className="p-3 text-right">Tổng tiền</th>
                 <th className="p-3 text-center">Trạng thái</th>
                 <th className="p-3 text-right">Thao tác</th>
              </tr>
           </thead>
           <tbody className="divide-y divide-slate-100">
            {data.map(v => (
              <tr
                key={v.id}
                className="hover:bg-slate-50 cursor-pointer"
                onClick={() => handleEdit(v)}
              >
                    <td className="p-3 font-bold text-blue-600 font-mono text-xs">{v.voucherNumber}</td>
                    <td className="p-3">{new Date(v.date).toLocaleDateString('vi-VN')}</td>
                    <td className="p-3">{new Date(v.postingDate).toLocaleDateString('vi-VN')}</td>
                    <td className="p-3 max-w-xs truncate font-medium text-slate-700">{v.description}</td>
                    <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(v.totalAmount)}</td>
                    <td className="p-3 text-center">
                  {v.status === 'POSTED' && (
                    <span className="flex items-center justify-center gap-1 rounded bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> Đã ghi sổ
                    </span>
                  )}
                  {v.status === 'DRAFT' && (
                    <span className="rounded bg-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600">Nháp</span>
                  )}
                  {v.status === 'LOCKED' && (
                    <span className="flex items-center justify-center gap-1 rounded bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">
                      <Lock className="h-3 w-3" aria-hidden /> Đã khóa
                    </span>
                  )}
                    </td>
                <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                       <div className="flex justify-end gap-1">
                          {v.status === 'DRAFT' ? (
                             <button onClick={() => handlePostVoucher(v.id)} className="p-1.5 text-slate-400 hover:text-emerald-600 bg-slate-50 hover:bg-emerald-50 rounded" title="Ghi sổ">
                                <CheckCircle2 className="w-4 h-4" />
                             </button>
                          ) : (
                             <button onClick={() => handleUnpostVoucher(v.id)} className="p-1.5 text-emerald-600 hover:text-amber-600 bg-emerald-50 hover:bg-amber-50 rounded" title="Bỏ ghi sổ">
                                <XCircle className="w-4 h-4" />
                             </button>
                          )}
                          <button onClick={() => handleEdit(v)} className="p-1.5 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded" title="Sửa">
                             <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteVoucher(v.id)} className="p-1.5 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded" title="Xóa">
                             <Trash2 className="w-4 h-4" />
                          </button>
                       </div>
                    </td>
                 </tr>
              ))}
            {totalItems === 0 && (
              <tr>
                <td colSpan={7} className="p-12 text-center text-slate-400">Không có chứng từ phù hợp trong năm {fiscalYearLabel}</td>
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
      </>
     );
  };

  return (
    <div className="space-y-4 animate-fade-in">
       <div className="bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-xl flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2 text-indigo-700">
             <Calendar className="w-4 h-4 shrink-0" aria-hidden />
             <span className="text-xs font-semibold text-indigo-800">
               Đang xem dữ liệu niên độ: <span className="font-bold text-indigo-950 tabular-nums">{fiscalYearLabel}</span>
             </span>
          </div>
          <div className="text-[10px] text-indigo-400 font-medium italic">
             Từ {new Date(financialYear.startDate).toLocaleDateString('vi-VN')} đến {new Date(financialYear.endDate).toLocaleDateString('vi-VN')}
          </div>
       </div>

       <div className="flex min-h-[500px] flex-col rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="p-4 border-b flex flex-wrap justify-between items-center bg-slate-50 gap-4">
             <h3 className="font-bold text-slate-700 text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" /> {config.title}
             </h3>
             <div className="flex gap-2 items-center">
                <div className="relative">
                   <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                   <input 
                      placeholder="Tìm số CT, nội dung..." 
                      className="pl-9 p-2 border rounded-lg text-sm w-64 focus:ring-2 focus:ring-blue-500 outline-none bg-white shadow-sm" 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                   />
                </div>
                <button 
                  onClick={handleCreate}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-md transition-all active:scale-95"
                >
                   <Plus className="w-4 h-4" /> Tạo mới
                </button>
             </div>
          </div>

          {/* --- TIME FILTER: dropdown + scrollbar --- */}
          <div className="border-b bg-white p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-0 items-center gap-2 border-r border-slate-200 pr-3 text-slate-600">
                <Calendar className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                <span className="text-xs font-semibold">Lọc thời gian</span>
              </div>

              <div className="relative" ref={timeMenuRef}>
                <button
                  type="button"
                  onClick={() => setTimeMenuOpen((o) => !o)}
                  aria-expanded={timeMenuOpen}
                  aria-haspopup="listbox"
                  className="flex min-w-[14rem] max-w-[min(100vw-2rem,20rem)] items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <span className="truncate">{timeFilterLabel}</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${timeMenuOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>

                {timeMenuOpen && (
                  <div
                    className="absolute left-0 top-full z-50 mt-1 w-[min(100vw-2rem,18rem)] rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
                    role="listbox"
                  >
                    <div
                      className="max-h-60 overflow-y-auto overscroll-contain py-0.5 [scrollbar-width:thin] [scrollbar-color:rgb(203_213_225)_rgb(248_250_252)] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-50"
                    >
                      {TIME_FILTER_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          role="option"
                          aria-selected={timeFilter === opt.id}
                          onClick={() => {
                            setTimeFilter(opt.id);
                            closeTimeMenu();
                          }}
                          className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
                            timeFilter === opt.id
                              ? 'bg-blue-50 font-semibold text-blue-800'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {timeFilter === 'CUSTOM' && (
                <div className="flex flex-wrap items-center gap-2 animate-fade-in">
                  <div className="relative">
                    <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="date"
                      className="rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/25"
                      value={customRange.from}
                      onChange={(e) => setCustomRange({ ...customRange, from: e.target.value })}
                    />
                  </div>
                  <span className="font-medium text-slate-400">→</span>
                  <div className="relative">
                    <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="date"
                      className="rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/25"
                      value={customRange.to}
                      onChange={(e) => setCustomRange({ ...customRange, to: e.target.value })}
                    />
                  </div>
                  {(customRange.from || customRange.to) && (
                    <button
                      type="button"
                      onClick={() => setCustomRange({ from: '', to: '' })}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Xóa khoảng ngày"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {isLinkedModule && (
             <div className="p-3 bg-blue-50/50 border-b border-blue-100 text-blue-800 text-[11px] flex items-center gap-2 font-medium">
                <Search className="w-3.5 h-3.5" /> Dữ liệu được liên kết tự động từ module {activeTab.includes('doc_import') || activeTab.includes('doc_export') ? 'Kho' : 'Quỹ'}.
             </div>
          )}

          <div className="flex-1 overflow-x-auto rounded-b-xl">
            {renderList()}
          </div>

          <VoucherForm 
             isOpen={isEditorOpen}
             onClose={() => setIsEditorOpen(false)}
             onSave={(v) => { if (!handleSaveVoucher(v).ok) return; setIsEditorOpen(false); }}
             initialVoucher={editingVoucher}
             type={isLinkedModule ? 'GENERAL' : (activeTab === 'doc_debit_credit' ? 'BANK_DEBIT' : (config.type as VoucherType))}
          />
       </div>
    </div>
  );
};