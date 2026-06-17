
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Download, Upload, Plus, Eye, Edit, Trash2, BookOpen, Search, Filter, Calendar, ChevronDown, X, FileDown, FileUp } from 'lucide-react';
import { InventoryItem, InventoryTransaction } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { roundInvoiceTotalsFromSums } from '@shared/utils/vndMoney';
import { vatAmountUnrounded } from '@shared/utils/vatRate';
import { useApp } from '../../../app/store'; 
import { StockLedgerModal } from '../components/InventoryModals'; 
import { Pagination } from '@shared/components/Pagination';
import {
  applyInventoryExcelImport,
  exportInventoryItemTemplateExcel,
  parseCatalogExcelFile,
} from '../../catalogs/utils/catalogExcelIO';
import { getDefaultWarehouseId, mapItemsToWarehouseScope } from '@shared/utils/warehouseInventory';

interface WarehousePageProps {
  items: InventoryItem[];
  transactions: InventoryTransaction[];
  onStockAction: (item: any, type: any) => void;
  onAddItem: () => void;
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (item: InventoryItem) => void;
  onViewItem: (item: InventoryItem) => void;
}

type TimeFilterType = 'ALL' | 'TODAY' | 'MONTH' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'YEAR' | 'CUSTOM';
type HistoryTrxFilter = 'ALL' | 'IMPORT' | 'EXPORT';
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

function formatViShortDate(ymd: string) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd;
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function timeMilestoneTriggerLabel(
  timeFilter: TimeFilterType,
  customRange: { from: string; to: string },
): string {
  if (timeFilter === 'CUSTOM') {
    if (customRange.from || customRange.to) {
      const a = customRange.from ? formatViShortDate(customRange.from) : '…';
      const b = customRange.to ? formatViShortDate(customRange.to) : '…';
      return `${a} – ${b}`;
    }
    return 'Tùy chọn khoảng ngày…';
  }
  switch (timeFilter) {
    case 'ALL':
      return 'Tất cả trong niên độ';
    case 'TODAY':
      return 'Hôm nay';
    case 'MONTH':
      return 'Tháng này';
    case 'YEAR':
      return 'Cả năm (niên độ)';
    case 'Q1':
      return 'Quý 1';
    case 'Q2':
      return 'Quý 2';
    case 'Q3':
      return 'Quý 3';
    case 'Q4':
      return 'Quý 4';
    default:
      return 'Tất cả trong niên độ';
  }
}

export const WarehousePage: React.FC<WarehousePageProps> = ({ items, transactions, onStockAction, onAddItem, onEditItem, onDeleteItem, onViewItem }) => {
  const [tab, setTab] = useState<'STOCK' | 'HISTORY'>('STOCK');
  const {
    modals,
    setModals,
    financialYear,
    backendAvailable,
    inventory,
    inventoryCatalog,
    warehouses,
    handleAddCatalogItem,
    handleUpdateCatalogItem,
  } = useApp();
  const warehouseExcelInputRef = useRef<HTMLInputElement>(null);

  const handleWarehouseImportExcel = async (file: File) => {
    try {
      const rows = await parseCatalogExcelFile(file);
      const { added, updated, errors } = applyInventoryExcelImport(
        rows,
        inventoryCatalog,
        inventory,
        handleAddCatalogItem,
        handleUpdateCatalogItem,
      );
      const msg = `Import Kho / Danh mục xong: thêm ${added}, cập nhật ${updated}.${errors.length ? `\nLỗi:\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? '\n…' : ''}` : ''}`;
      window.alert(msg);
    } catch (e: any) {
      window.alert(`Lỗi đọc file: ${e?.message || e}`);
    }
  };
  
  // States cho tìm kiếm và lọc lịch sử
  const [searchTerm, setSearchTerm] = useState('');
  const [warehouseFilterId, setWarehouseFilterId] = useState<'ALL' | string>('ALL');
  const [timeFilter, setTimeFilter] = useState<TimeFilterType>('ALL');
  const [historyTrxFilter, setHistoryTrxFilter] = useState<HistoryTrxFilter>('ALL');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [timeMilestoneOpen, setTimeMilestoneOpen] = useState(false);
  const timeMilestoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!timeMilestoneOpen) return;
    const onDocDown = (e: MouseEvent) => {
      const el = timeMilestoneRef.current;
      if (el && !el.contains(e.target as Node)) setTimeMilestoneOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTimeMilestoneOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [timeMilestoneOpen]);

  // --- PAGINATION (remember per sub-tab + per filter signature) ---
  const baseStorageKey = useMemo(() => `warehouse_pagination_${tab}`, [tab]);
  const filterSignature = useMemo(() => {
    return JSON.stringify({
      q: (searchTerm || '').trim().toLowerCase(),
      warehouseFilterId,
      timeFilter,
      historyTrxFilter,
      from: customRange.from || '',
      to: customRange.to || '',
      fyStart: financialYear.startDate,
      fyEnd: financialYear.endDate,
    });
  }, [customRange.from, customRange.to, financialYear.endDate, financialYear.startDate, historyTrxFilter, searchTerm, timeFilter, warehouseFilterId]);
  const filterKey = useMemo(() => `f_${hashString(filterSignature)}`, [filterSignature]);

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
  }, [baseStorageKey, filterKey]);

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

  /** SKU hiện tại theo itemId — để lọc lịch sử theo mã SKU (phiếu chỉ có itemId + tên snapshot). */
  const skuLowerByItemId = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) {
      m.set(String(it.id), String(it.sku || '').trim().toLowerCase());
    }
    return m;
  }, [items]);
  const defaultWarehouseId = useMemo(() => getDefaultWarehouseId(warehouses), [warehouses]);
  const warehouseScopedItems = useMemo(
    () =>
      warehouseFilterId === 'ALL'
        ? items
        : mapItemsToWarehouseScope(items, warehouseFilterId, defaultWarehouseId),
    [items, warehouseFilterId, defaultWarehouseId],
  );

  // --- LOGIC LỌC DỮ LIỆU THEO NIÊN ĐỘ ---
  const filteredTransactions = useMemo(() => {
    const t0 = performance.now();
    const rows = transactions.filter(trx => {
      // 1. Ràng buộc theo Năm tài chính
      if (trx.date < financialYear.startDate || trx.date > financialYear.endDate) return false;
      if (
        warehouseFilterId !== 'ALL' &&
        String(trx.warehouseId || defaultWarehouseId).trim() !== String(warehouseFilterId).trim()
      ) {
        return false;
      }

      if (tab === 'HISTORY' && historyTrxFilter !== 'ALL' && trx.type !== historyTrxFilter) return false;

      const q = (searchTerm || '').trim().toLowerCase();
      const serialHaystack = [
        trx.serials || '',
        ...(trx.serialInfoSnapshot || []).map((s) => String(s.serial || '')),
      ]
        .join(' ')
        .toLowerCase();

      const skuLower = skuLowerByItemId.get(String(trx.itemId)) || '';
      const matchesSearch =
        !q ||
        trx.itemName.toLowerCase().includes(q) ||
        (skuLower && skuLower.includes(q)) ||
        (trx.voucherNumber || '').toLowerCase().includes(q) ||
        (trx.documentRef || '').toLowerCase().includes(q) ||
        (trx.supplier || '').toLowerCase().includes(q) ||
        (trx.customer || '').toLowerCase().includes(q) ||
        (trx.note || '').toLowerCase().includes(q) ||
        (trx.formNo || '').toLowerCase().includes(q) ||
        (trx.symbolCode || '').toLowerCase().includes(q) ||
        serialHaystack.includes(q);

      if (!matchesSearch) return false;

      if (tab !== 'HISTORY' || timeFilter === 'ALL') return true;

      const trxDate = new Date(trx.date);
      const now = new Date();
      const currentYear = new Date(financialYear.startDate).getFullYear();
      
      switch (timeFilter) {
        case 'TODAY':
          return trx.date.split('T')[0] === now.toISOString().split('T')[0];
        case 'MONTH':
          return trxDate.getMonth() === now.getMonth() && trxDate.getFullYear() === now.getFullYear();
        case 'Q1':
          return trxDate.getMonth() >= 0 && trxDate.getMonth() <= 2 && trxDate.getFullYear() === currentYear;
        case 'Q2':
          return trxDate.getMonth() >= 3 && trxDate.getMonth() <= 5 && trxDate.getFullYear() === currentYear;
        case 'Q3':
          return trxDate.getMonth() >= 6 && trxDate.getMonth() <= 8 && trxDate.getFullYear() === currentYear;
        case 'Q4':
          return trxDate.getMonth() >= 9 && trxDate.getMonth() <= 11 && trxDate.getFullYear() === currentYear;
        case 'YEAR':
          return trxDate.getFullYear() === currentYear;
        case 'CUSTOM':
          if (!customRange.from && !customRange.to) return true;
          const from = customRange.from ? customRange.from : '0000-01-01';
          const to = customRange.to ? customRange.to : '9999-12-31';
          return trx.date >= from && trx.date <= to;
        default:
          return true;
      }
    });

    const ms = performance.now() - t0;
    logSlowQuery('WarehousePage.filter(transactions)', ms, { rows: rows.length, tab });
    return rows;
  }, [transactions, searchTerm, timeFilter, customRange, tab, financialYear, historyTrxFilter, skuLowerByItemId, warehouseFilterId, defaultWarehouseId]);

  const filteredItems = useMemo(() => {
    const t0 = performance.now();
    const q = (searchTerm || '').trim().toLowerCase();
    const rows = warehouseScopedItems.filter((i) => {
      const name = String(i.name || '').toLowerCase();
      const sku = String(i.sku || '').toLowerCase();
      return name.includes(q) || sku.includes(q);
    });
    const ms = performance.now() - t0;
    logSlowQuery('WarehousePage.filter(items)', ms, { rows: rows.length, tab });
    return rows;
  }, [warehouseScopedItems, searchTerm, tab]);

  const totalItems = tab === 'STOCK' ? filteredItems.length : filteredTransactions.length;
  const safePageSize = clampPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, totalPages]);

  const pagedItems = useMemo(() => {
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return filteredItems.slice(from, to);
  }, [filteredItems, safePage, safePageSize]);

  const pagedTransactions = useMemo(() => {
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    // Keep sort stable and only for the subset being displayed
    const sorted = [...filteredTransactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return sorted.slice(from, to);
  }, [filteredTransactions, safePage, safePageSize]);

  const historyStats = useMemo(() => {
    return filteredTransactions.reduce((acc, trx) => {
      const subTotal = trx.quantity * trx.price;
      const { totalAmount: total } = roundInvoiceTotalsFromSums(subTotal, vatAmountUnrounded(subTotal, Number(trx.vatRate)));
      if (trx.type === 'IMPORT') acc.import += total;
      else acc.export += total;
      return acc;
    }, { import: 0, export: 0 });
  }, [filteredTransactions]);

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden animate-fade-in">
        <div className="border-b border-slate-100 bg-slate-50/90 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h3 className="text-[15px] font-medium leading-snug tracking-tight text-slate-800">
                Sản phẩm & Bản quyền ({new Date(financialYear.startDate).getFullYear()})
              </h3>
              <div className="flex rounded-lg bg-slate-200/70 p-0.5" role="tablist" aria-label="Chế độ xem kho">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'STOCK'}
                  onClick={() => setTab('STOCK')}
                  className={`h-9 rounded-md px-3.5 text-[13px] font-medium transition-colors ${
                    tab === 'STOCK'
                      ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200/80'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  Số dư
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'HISTORY'}
                  onClick={() => setTab('HISTORY')}
                  className={`h-9 rounded-md px-3.5 text-[13px] font-medium transition-colors ${
                    tab === 'HISTORY'
                      ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200/80'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  Lịch sử
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {tab === 'STOCK' && (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                    <input
                      placeholder="Tìm mã SKU, tên vật tư..."
                      className="h-9 w-[min(100%,16rem)] rounded-lg border border-slate-200 bg-white py-0 pl-9 pr-3 text-[13px] font-medium text-slate-800 placeholder:text-slate-400 shadow-sm outline-none transition-[box-shadow] focus:ring-2 focus:ring-blue-500/25 sm:w-64"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <span className="hidden h-7 w-px shrink-0 self-center bg-slate-200 sm:block" aria-hidden />
                </>
              )}

              <div className="min-w-[12rem]">
                <select
                  value={warehouseFilterId}
                  onChange={(e) => setWarehouseFilterId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 shadow-sm outline-none transition-[box-shadow] focus:ring-2 focus:ring-blue-500/25"
                >
                  <option value="ALL">Số dư khả dụng</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.code ? `${warehouse.code} - ` : ''}{warehouse.name}
                    </option>
                  ))}
                </select>
              </div>

              {tab === 'STOCK' && (
                <>
                  <span className="hidden h-7 w-px shrink-0 self-center bg-slate-200 sm:block" aria-hidden />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => { void exportInventoryItemTemplateExcel(); }}
                      disabled={!backendAvailable}
                      title="Tải mẫu Excel (cùng định dạng Danh mục Hàng hóa)"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200/90 bg-white text-slate-700 shadow-sm outline-none transition-colors hover:border-slate-300 hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:pointer-events-none disabled:opacity-45"
                    >
                      <FileDown className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                      <span className="sr-only">Tải mẫu Excel</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => warehouseExcelInputRef.current?.click()}
                      disabled={!backendAvailable}
                      title="Import Excel — cùng định dạng Danh mục Hàng hóa"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200/80 bg-emerald-50/80 text-emerald-800 shadow-sm outline-none transition-colors hover:border-emerald-600 hover:bg-emerald-600 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-500/35 disabled:pointer-events-none disabled:opacity-45"
                    >
                      <FileUp className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                      <span className="sr-only">Import Excel</span>
                    </button>
                    <input
                      ref={warehouseExcelInputRef}
                      type="file"
                      accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) await handleWarehouseImportExcel(f);
                      }}
                    />
                  </div>
                </>
              )}

              {tab === 'STOCK' && (
                <>
                  <span className="hidden h-7 w-px shrink-0 self-center bg-slate-200 sm:block" aria-hidden />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onStockAction(null, 'IMPORT')}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200/80 bg-emerald-50/90 px-3.5 text-[13px] font-medium text-emerald-800 shadow-sm outline-none transition-colors hover:border-emerald-600 hover:bg-emerald-600 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-500/35"
                    >
                      <Download className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                      Nạp tài nguyên
                    </button>
                    <button
                      type="button"
                      onClick={() => onStockAction(null, 'EXPORT')}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200/80 bg-red-50/90 px-3.5 text-[13px] font-medium text-red-800 shadow-sm outline-none transition-colors hover:border-red-600 hover:bg-red-600 hover:text-white focus-visible:ring-2 focus-visible:ring-red-500/35"
                    >
                      <Upload className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                      Bàn giao/Kích hoạt
                    </button>
                    <button
                      type="button"
                      onClick={onAddItem}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue-200/80 bg-blue-50/90 px-3.5 text-[13px] font-medium text-blue-800 shadow-sm outline-none transition-colors hover:border-blue-600 hover:bg-blue-600 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/35"
                    >
                      <Plus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                      Thêm mới
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* --- FILTER BAR (Số dư / Lịch sử + mốc thời gian dropdown) --- */}
        <div
          className={`border-b ${
            tab === 'HISTORY'
              ? 'bg-gradient-to-br from-slate-50 via-white to-slate-50/90'
              : 'bg-white'
          }`}
        >
          {tab === 'STOCK' ? (
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex items-center gap-2 border-r border-slate-200 pr-4 text-slate-500">
                <Filter className="h-4 w-4 shrink-0" />
                <span className="text-xs font-medium tracking-tight text-slate-500">Lọc: hàng hoá</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Số dư là nơi quản lý tồn kho: nạp/xuất, sửa, xóa. Thay đổi tự đồng bộ Chứng từ, Sổ NKC, Hóa đơn & VAT, Quỹ. Mục Lịch sử chỉ xem.
              </p>
            </div>
          ) : (
            <div className="space-y-3 px-4 py-3">
              {/* Một hàng: Lọc thời gian | Loại phiếu | ô mốc thời gian (gọn) | Tìm kiếm */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex shrink-0 items-center gap-2 border-slate-200 sm:border-r sm:pr-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-white shadow-sm">
                    <Filter className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium tracking-tight text-slate-500">Lọc thời gian</p>
                    <p className="text-[11px] font-medium leading-tight text-slate-400">SKU · Serial · HĐ · Phiếu</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium tracking-tight text-slate-500">Loại phiếu</span>
                  <div className="inline-flex rounded-xl border border-slate-200/80 bg-white p-0.5 shadow-sm ring-1 ring-slate-100">
                    {(
                      [
                        { id: 'ALL' as const, label: 'Tất cả' },
                        { id: 'IMPORT' as const, label: 'Nạp tài nguyên' },
                        { id: 'EXPORT' as const, label: 'Bàn giao/Kích hoạt' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setHistoryTrxFilter(opt.id)}
                        className={`rounded-lg px-2 py-1 text-[9px] font-medium leading-tight tracking-tight transition-all sm:px-2.5 sm:text-[10px] ${
                          historyTrxFilter === opt.id
                            ? opt.id === 'IMPORT'
                              ? 'bg-emerald-600 text-white shadow'
                              : opt.id === 'EXPORT'
                                ? 'bg-red-600 text-white shadow'
                                : 'bg-slate-800 text-white shadow'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div ref={timeMilestoneRef} className="relative w-[10.5rem] shrink-0 sm:w-[12rem]">
                    <button
                      type="button"
                      id="warehouse-time-milestone-trigger"
                      aria-haspopup="menu"
                      aria-expanded={timeMilestoneOpen}
                      aria-label="Chọn mốc thời gian lọc lịch sử"
                      title={timeMilestoneTriggerLabel(timeFilter, customRange)}
                      onClick={() => setTimeMilestoneOpen((o) => !o)}
                      className={`flex w-full items-center gap-1.5 rounded-lg border bg-white py-1.5 pl-2 pr-1.5 text-left text-xs font-semibold text-slate-800 shadow-sm outline-none transition hover:border-slate-300 ${
                        timeMilestoneOpen
                          ? 'border-blue-500 ring-2 ring-blue-100'
                          : 'border-slate-200'
                      }`}
                    >
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate leading-tight">{timeMilestoneTriggerLabel(timeFilter, customRange)}</span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${timeMilestoneOpen ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    </button>

                    {timeMilestoneOpen && (
                    <div
                      role="menu"
                      aria-labelledby="warehouse-time-milestone-trigger"
                      className="absolute left-0 top-full z-40 mt-1 w-[min(100vw-2rem,17.5rem)] max-w-[17.5rem] max-h-[min(70vh,28rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-2 shadow-xl ring-1 ring-slate-900/5"
                    >
                      <div className="px-2 pb-1 pt-1">
                        <p className="px-2 pb-1 text-xs font-medium tracking-tight text-slate-500">
                          Niên độ đang chọn
                        </p>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setTimeFilter('ALL');
                            setTimeMilestoneOpen(false);
                          }}
                          className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                            timeFilter === 'ALL'
                              ? 'bg-slate-700 font-medium text-white'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          Tất cả trong niên độ
                        </button>
                      </div>

                      <div className="mt-1 border-t border-slate-100 px-2 pt-2">
                        <p className="px-2 pb-1 text-xs font-medium tracking-tight text-slate-500">Nhanh</p>
                        {(
                          [
                            { id: 'TODAY' as const, label: 'Hôm nay' },
                            { id: 'MONTH' as const, label: 'Tháng này' },
                            { id: 'YEAR' as const, label: 'Cả năm (niên độ)' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setTimeFilter(opt.id);
                              setTimeMilestoneOpen(false);
                            }}
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                              timeFilter === opt.id
                                ? 'bg-slate-700 font-medium text-white'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      <div className="mt-1 border-t border-slate-100 px-2 pt-2">
                        <p className="px-2 pb-1 text-xs font-medium tracking-tight text-slate-500">
                          Theo quý (trong niên độ)
                        </p>
                        {(
                          [
                            { id: 'Q1' as const, label: 'Quý 1' },
                            { id: 'Q2' as const, label: 'Quý 2' },
                            { id: 'Q3' as const, label: 'Quý 3' },
                            { id: 'Q4' as const, label: 'Quý 4' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setTimeFilter(opt.id);
                              setTimeMilestoneOpen(false);
                            }}
                            className={`w-full rounded-lg px-3 py-2 pl-4 text-left text-sm transition ${
                              timeFilter === opt.id
                                ? 'bg-slate-700 font-medium text-white'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      <div className="mt-1 border-t border-slate-100 px-2 pt-2">
                        <p className="px-2 pb-1 text-xs font-medium tracking-tight text-slate-500">Tùy chỉnh</p>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setTimeFilter('CUSTOM');
                            setTimeMilestoneOpen(false);
                          }}
                          className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                            timeFilter === 'CUSTOM'
                              ? 'bg-slate-700 font-medium text-white'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          Tùy chọn khoảng ngày…
                        </button>
                      </div>
                    </div>
                    )}
                </div>

                <div className="relative min-w-0 flex-1 basis-[min(100%,14rem)]">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    placeholder="SKU, serial, HĐ, phiếu, đối tác, tên hàng…"
                    className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs shadow-sm outline-none ring-slate-200/60 transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    aria-label="Tìm trong lịch sử kho"
                  />
                </div>
              </div>

              {timeFilter === 'CUSTOM' && (
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/60 pt-2 animate-fade-in">
                  <span className="text-xs font-medium tracking-tight text-slate-500">Khoảng tùy chọn</span>
                  <div className="relative">
                    <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="date"
                      className="rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-xs font-bold text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-blue-100"
                      value={customRange.from}
                      onChange={(e) => setCustomRange({ ...customRange, from: e.target.value })}
                    />
                  </div>
                  <span className="font-bold text-slate-300">→</span>
                  <div className="relative">
                    <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="date"
                      className="rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-xs font-bold text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-blue-100"
                      value={customRange.to}
                      onChange={(e) => setCustomRange({ ...customRange, to: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-4 border-t border-slate-200/80 pt-3 sm:gap-6">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/40" />
                    <span className="text-xs font-medium text-slate-500">Tổng nạp tài nguyên (đang lọc)</span>
                    <span className="text-xs font-semibold tabular-nums text-emerald-600">{formatCurrency(historyStats.import)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-red-500 shadow-sm shadow-red-500/40" />
                    <span className="text-xs font-medium text-slate-500">Tổng bàn giao/kích hoạt (đang lọc)</span>
                    <span className="text-xs font-semibold tabular-nums text-red-600">{formatCurrency(historyStats.export)}</span>
                  </div>
              </div>
            </div>
          )}
        </div>

        {tab === 'STOCK' ? (
          <table className="w-full text-sm text-left border-collapse">
            <thead className="border-b bg-slate-100 text-[11px] font-semibold tracking-tight text-slate-600">
              <tr>
                <th className="p-4 text-center w-56">Mã SKU / Tên Vật tư</th>
                <th className="p-4 text-center w-36">Danh mục</th>
                <th className="p-4 text-center w-24">Đơn vị</th>
                <th className="p-4 text-center w-24">TK Kho</th>
                <th className="p-4 text-center w-32">Tồn</th>
                <th className="p-4 text-center w-36">Giá vốn</th>
                <th className="p-4 text-center w-36">Giá bán</th>
                <th className="p-4 text-center w-32">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedItems.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => onViewItem(item)}
                  title="Click để xem chi tiết"
                >
                  <td className="p-4 text-center">
                    <div className="font-bold text-slate-800 leading-tight">{item.name}</div>
                    <div className="text-[11px] text-slate-400 font-mono mt-1">{item.sku}</div>
                  </td>
                  <td className="p-4 text-center">
                    <span className="rounded border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-600">{item.category}</span>
                  </td>
                  <td className="p-4 text-center text-slate-600 font-medium">{item.unit}</td>
                  <td className="p-4 text-center font-bold font-mono text-slate-500 text-xs">{item.accountCode || '156'}</td>
                  <td className="p-4">
                    <div className="flex flex-col items-center justify-center">
                        <span className={`text-base font-semibold ${item.quantity <= item.minStock ? 'text-red-600' : 'text-slate-800'}`}>{item.quantity}</span>
                        <div className="w-16 h-1 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${item.quantity <= item.minStock ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} 
                            style={{ width: `${Math.min(100, (item.quantity / (item.minStock * 4 || 10)) * 100)}%` }}
                          ></div>
                        </div>
                    </div>
                  </td>
                  <td className="p-4 text-right pr-6 font-medium text-slate-600 tabular-nums">{formatCurrency(item.costPrice)}</td>
                  <td className="p-4 text-right pr-6 font-bold text-blue-600 tabular-nums">{formatCurrency(item.sellingPrice)}</td>
                  <td className="p-4 text-center">
                    <div className="flex justify-center gap-1">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setModals((m: any) => ({ ...m, viewLedgerItem: item })); }}
                        className="p-1.5 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-lg transition-colors"
                        title="Xem Sổ Kho"
                      >
                         <BookOpen className="w-4 h-4" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onViewItem(item); }} className="p-1.5 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded-lg transition-colors" title="Xem chi tiết">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onEditItem(item); }} className="p-1.5 hover:bg-amber-50 text-slate-400 hover:text-amber-600 rounded-lg transition-colors" title="Sửa">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onDeleteItem(item); }} className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors" title="Xóa">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-20 text-center text-slate-400 font-medium italic">
                    Không tìm thấy mặt hàng nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="border-b bg-slate-100 text-[11px] font-semibold tracking-tight text-slate-600">
                <tr>
                  <th className="p-4 text-center w-28">Ngày CT</th>
                  <th className="p-4 text-center w-24">Loại</th>
                  <th className="p-4 text-center w-36">Kho</th>
                  <th className="p-4 text-center w-48">Sản phẩm / Vật tư</th>
                  <th className="p-4 text-center w-48">Đối tác / Chứng từ</th>
                  <th className="p-4 text-center w-24">Số lượng</th>
                  <th className="p-4 text-center w-36">Đơn giá</th>
                  <th className="p-4 text-center w-36">Tiền thuế</th>
                  <th className="p-4 text-center w-40">Tổng tiền</th>
                  <th className="p-4 text-center w-28">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedTransactions.map((trx) => {
                    const subTotal = trx.quantity * trx.price;
                    const vatAmount = vatAmountUnrounded(subTotal, Number(trx.vatRate));
                    const { totalAmount: total } = roundInvoiceTotalsFromSums(subTotal, vatAmount);
                    
                    return (
                      <tr
                        key={trx.id}
                        className="hover:bg-blue-50/30 transition-colors group cursor-pointer"
                        onClick={() => setModals((m: any) => ({ ...m, viewTransaction: trx }))}
                        title="Click để xem chi tiết"
                      >
                        <td className="p-4 text-center">
                          <div className="font-bold text-slate-700 whitespace-nowrap">{new Date(trx.date).toLocaleDateString('vi-VN')}</div>
                          <div className="text-[10px] text-slate-400 font-medium">{new Date(trx.date).toLocaleTimeString('vi-VN')}</div>
                        </td>
                        <td className="p-4 text-center">
                          <span className={`mx-auto inline-flex w-full max-w-[9.5rem] items-center justify-center gap-1 rounded-full border px-2 py-1 text-[9px] font-medium leading-tight tracking-tight shadow-sm sm:text-[10px] ${trx.type === 'IMPORT' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                            {trx.type === 'IMPORT' ? 'Nạp tài nguyên' : 'Bàn giao/Kích hoạt'}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <div className="font-semibold text-slate-700">
                            {trx.warehouseName || warehouses.find((warehouse) => warehouse.id === trx.warehouseId)?.name || 'Kho tong'}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {trx.warehouseId || defaultWarehouseId}
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <div className="font-bold text-slate-800 leading-tight">{trx.itemName}</div>
                          {trx.serials && <div className="text-[9px] text-blue-500 font-mono mt-0.5 truncate max-w-[150px] mx-auto">SN: {trx.serials.split('\n')[0]}...</div>}
                        </td>
                        <td className="p-4 text-center">
                           <div className="text-xs">
                              <div className="font-bold text-slate-700 truncate max-w-[180px] mx-auto">{trx.type === 'IMPORT' ? (trx.supplier || 'NCC lẻ') : (trx.customer || 'Khách lẻ')}</div>
                              <div className="mt-1 font-mono text-[10px] font-semibold text-blue-600">
                                {trx.voucherNumber ? `Số phiếu: ${trx.voucherNumber}` : ''}
                                {trx.documentRef ? `${trx.voucherNumber ? ' · ' : ''}Số HĐ: ${trx.documentRef}` : ''}
                                {(trx as any).symbolCode ? ` · KH: ${(trx as any).symbolCode}` : ''}
                                {(trx as any).formNo ? ` · MS: ${(trx as any).formNo}` : ''}
                              </div>
                           </div>
                        </td>
                        <td className="p-4 text-center font-semibold text-slate-800">{trx.quantity}</td>
                        <td className="p-4 text-right pr-6 font-medium text-slate-600 tabular-nums">{formatCurrency(trx.price)}</td>
                        <td className="p-4 text-right pr-6 text-slate-400 tabular-nums">{formatCurrency(vatAmount)}</td>
                        <td className={`p-4 pr-6 text-right text-sm font-semibold tabular-nums ${trx.type === 'IMPORT' ? 'text-emerald-600' : 'text-blue-600'}`}>
                          {formatCurrency(total)}
                        </td>
                        <td className="p-4 text-center">
                            <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                               <button 
                                  type="button"
                                  onClick={() => setModals((m: any) => ({ ...m, viewTransaction: trx }))}
                                  className="rounded-md p-1.5 text-slate-500 transition-all hover:bg-blue-50 hover:text-blue-600"
                                  title="Xem chi tiết chứng từ"
                               >
                                  <Eye className="h-4 w-4" />
                               </button>
                            </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredTransactions.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-20 text-center text-slate-400 font-medium italic">
                        Không tìm thấy giao dịch nào trong niên độ {new Date(financialYear.startDate).getFullYear()}.
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={safePage}
          totalItems={totalItems}
          pageSize={safePageSize}
          onChangePage={setPage}
          onChangePageSize={(s) => setPageSize(clampPageSize(s))}
        />
        
        <div className="flex items-center justify-between border-t bg-slate-50 p-3 px-6 text-xs font-medium tracking-tight text-slate-500">
           <div>
             So luong mat hang: <b className="text-slate-600">{warehouseScopedItems.length}</b>
             {warehouseFilterId !== 'ALL' ? (
               <span className="ml-2 text-slate-400">
                 ({warehouses.find((warehouse) => warehouse.id === warehouseFilterId)?.name || warehouseFilterId})
               </span>
             ) : null}
           </div>
           <div className="flex gap-6">
              <span>Can nhap them: <b className="text-red-500">{warehouseScopedItems.filter(i => i.quantity <= i.minStock).length}</b></span>
              <span>Tong gia tri ton: <b className="text-blue-600">{formatCurrency(warehouseScopedItems.reduce((s, i) => s + (i.quantity * i.costPrice), 0))}</b></span>
           </div>
        </div>
      </div>

      {/* --- MODALS (xem phiếu kho: routes.tsx) --- */}
      <StockLedgerModal 
         item={modals.viewLedgerItem}
         transactions={
           warehouseFilterId === 'ALL'
             ? transactions
             : transactions.filter((trx) => String(trx.warehouseId || defaultWarehouseId).trim() === String(warehouseFilterId).trim())
         }
         onClose={() => setModals((m: any) => ({ ...m, viewLedgerItem: null }))}
      />
    </>
  );
};
