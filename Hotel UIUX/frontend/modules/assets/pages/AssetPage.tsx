
import React, { useState, useMemo, useEffect } from 'react';
import { 
  Building, List, Calculator, Plus, Save, Clock, ArrowRight, Gavel, ArrowLeftRight,
  TrendingDown, FileText, CheckCircle2, AlertTriangle, Archive, Edit, Trash2, Info, Eye, X, DollarSign, Calendar, Truck, UserCircle, Receipt, Filter, Search, ChevronDown, HelpCircle, AlertCircle, History
} from 'lucide-react';
import { useApp } from '../../../app/store';
import { formatCurrency } from '@shared/utils/format';
import { roundInvoiceTotalsFromSums, roundVnd } from '@shared/utils/vndMoney';
import { VAT_RATE_NOT_SUBJECT, formatVatRateLabel, vatAmountUnrounded } from '@shared/utils/vatRate';
import {
  AllocationEngine,
  DepreciationEngine,
  countEligibleMonths,
  getAccumulatedLedgerAmount,
  getAccumulatedLedgerCap,
  getAssetScheduleBase,
  getOpeningCarryForwardAccumulated,
  getOpeningCarryForwardTargetAccumulated,
  resolveAssetExpenseAccount,
} from '@shared/assetScheduleEngine';
import { Asset, JournalEntry } from '@shared/types';
import { buildAssetLiquidationPreview, type AssetLiquidationReceiptMethod } from '@shared/utils/assetLiquidation';
import { EditAssetModal, DeleteAssetModal } from '../components/AssetModals';
import { TransferAssetModal, AssetBulkTransferForm } from '../components/AssetTransferModals';
import { buildAssetDepartmentTimeline } from '../constants';
import { Pagination } from '@shared/components/Pagination';
import { mergePartnerNameSuggestions } from '@shared/utils/partnerNameMemory';

type TabType = 'LIST' | 'DEPRECIATION' | 'INCREASE' | 'TRANSFER';
type TimeFilterType = 'ALL' | 'TODAY' | 'MONTH' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'YEAR' | 'CUSTOM';
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

/** Tránh lệch ngày khi `new Date('YYYY-MM-DD')` theo UTC (ảnh hưởng so sánh tháng / hồi ký). */
function parseLocalDateOnly(iso: string): Date {
  const raw = String(iso || '').split('T')[0];
  const [y, m, d] = raw.split('-').map((x) => Number(x));
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function logSlowQuery(label: string, ms: number, meta: Record<string, unknown>) {
  if (ms <= 200) return;
  // eslint-disable-next-line no-console
  console.warn(`[PERF] ${label} took ${Math.round(ms)}ms`, meta);
}

export const AssetPage = () => {
  const [activeTab, setActiveTab] = useState<TabType>('LIST');
  const {
    assets,
    employees,
    handleAddAsset,
    handleUpdateAsset,
    handleDeleteAsset,
    handlePutCcdcIntoUse,
    handleLiquidateAsset,
    handleTransferAssets,
    handleRunDepreciation,
    financialYear,
  } = useApp();

  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
  const [viewingAsset, setViewingAsset] = useState<Asset | null>(null);
  const [transferringAsset, setTransferringAsset] = useState<Asset | null>(null);
  const [bulkTransferAssetIds, setBulkTransferAssetIds] = useState<string[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [liquidatingAsset, setLiquidatingAsset] = useState<Asset | null>(null);
  const [ccdcPutUse, setCcdcPutUse] = useState<Asset | null>(null);
  const [putIntoUseDate, setPutIntoUseDate] = useState('');
  useEffect(() => {
    if (ccdcPutUse) setPutIntoUseDate(new Date().toISOString().split('T')[0]);
  }, [ccdcPutUse]);

  const [searchTerm, setSearchTerm] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilterType>('ALL');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });

  // --- PAGINATION (remember per tab + per filter signature) ---
  const baseStorageKey = useMemo(() => `asset_pagination_${activeTab}`, [activeTab]);
  const filterSignature = useMemo(() => {
    return JSON.stringify({
      q: (searchTerm || '').trim().toLowerCase(),
      timeFilter,
      from: customRange.from || '',
      to: customRange.to || '',
      fyStart: financialYear.startDate,
      fyEnd: financialYear.endDate
    });
  }, [customRange.from, customRange.to, financialYear.endDate, financialYear.startDate, searchTerm, timeFilter]);
  const filterKey = useMemo(() => `f_${hashString(filterSignature)}`, [filterSignature]);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<StandardPageSize>(20);

  const filteredAssets = useMemo(() => {
    const t0 = performance.now();
    const rows = assets.filter(asset => {
      const matchesSearch = 
        asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        asset.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        asset.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (asset.supplierName || '').toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;
      if (timeFilter === 'ALL') return true;

      const assetDate = new Date(asset.useDate);
      const now = new Date();
      const currentYear = now.getFullYear();
      now.setHours(0, 0, 0, 0);

      switch (timeFilter) {
        case 'TODAY': return asset.useDate === now.toISOString().split('T')[0];
        case 'MONTH': return assetDate.getMonth() === now.getMonth() && assetDate.getFullYear() === now.getFullYear();
        case 'Q1': return assetDate.getMonth() >= 0 && assetDate.getMonth() <= 2 && assetDate.getFullYear() === currentYear;
        case 'Q2': return assetDate.getMonth() >= 3 && assetDate.getMonth() <= 5 && assetDate.getFullYear() === currentYear;
        case 'Q3': return assetDate.getMonth() >= 6 && assetDate.getMonth() <= 8 && assetDate.getFullYear() === currentYear;
        case 'Q4': return assetDate.getMonth() >= 9 && assetDate.getMonth() <= 11 && assetDate.getFullYear() === currentYear;
        case 'YEAR': return assetDate.getFullYear() === now.getFullYear();
        case 'CUSTOM':
          if (!customRange.from && !customRange.to) return true;
          const from = customRange.from ? new Date(customRange.from) : new Date(0);
          const to = customRange.to ? new Date(customRange.to) : new Date(8640000000000000);
          to.setHours(23, 59, 59, 999);
          return assetDate >= from && assetDate <= to;
        default: return true;
      }
    });
    const ms = performance.now() - t0;
    logSlowQuery('AssetPage.filter(assets)', ms, { rows: rows.length, activeTab });
    return rows;
  }, [assets, searchTerm, timeFilter, customRange, activeTab]);

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

  const totalItems = filteredAssets.length;
  const safePageSize = clampPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, totalPages]);

  const pagedAssets = useMemo(() => {
    // Hard rule: never render > 100 rows
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return filteredAssets.slice(from, to);
  }, [filteredAssets, safePage, safePageSize]);

  const stats = useMemo(() => {
    const cost = filteredAssets.reduce((sum, a) => sum + (Number(a.cost) || 0), 0);
    const deprTsc = filteredAssets
      .filter((a) => a.type === 'TSCĐ')
      .reduce((sum, a) => sum + (Number(a.accumulatedDepreciation) || 0), 0);
    const allocCcdc = filteredAssets
      .filter((a) => a.type === 'CCDC')
      .reduce((sum, a) => sum + (Number(a.accumulatedAllocation) || 0), 0);
    const residual = filteredAssets.reduce((sum, a) => sum + (Number(a.residualValue) || 0), 0);
    return { cost, deprTsc, allocCcdc, ledgerTotal: deprTsc + allocCcdc, residual };
  }, [filteredAssets]);

  const handleEdit = (asset: Asset) => setEditingAsset(asset);
  const handleDelete = (asset: Asset) => setDeletingAsset(asset);
  const handleView = (asset: Asset) => setViewingAsset(asset);

  const bulkTransferAssets = useMemo(
    () => assets.filter((a) => bulkTransferAssetIds.includes(a.id)),
    [assets, bulkTransferAssetIds],
  );

  const selectedActiveCount = useMemo(
    () => assets.filter((a) => selectedAssetIds.has(a.id) && a.status === 'ACTIVE').length,
    [assets, selectedAssetIds],
  );

  const toggleAssetSelection = (id: string) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pagedActiveIds = useMemo(
    () => pagedAssets.filter((a) => a.status === 'ACTIVE').map((a) => a.id),
    [pagedAssets],
  );

  const allPagedActiveSelected =
    pagedActiveIds.length > 0 && pagedActiveIds.every((id) => selectedAssetIds.has(id));

  const toggleSelectAllOnPage = () => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (allPagedActiveSelected) {
        pagedActiveIds.forEach((id) => next.delete(id));
      } else {
        pagedActiveIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const openBulkTransfer = () => {
    const ids = assets
      .filter((a) => selectedAssetIds.has(a.id) && a.status === 'ACTIVE')
      .map((a) => a.id);
    if (ids.length < 2) return;
    setBulkTransferAssetIds(ids);
    setActiveTab('TRANSFER');
  };

  const handleTransferConfirm = (payload: Parameters<typeof handleTransferAssets>[0]) => {
    if (handleTransferAssets(payload)) {
      setTransferringAsset(null);
      setBulkTransferAssetIds([]);
      setSelectedAssetIds(new Set());
      setActiveTab('LIST');
    }
  };

  return (
    <div className="space-y-6">
       <div className="grid grid-cols-3 gap-6">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition-shadow">
             <div>
                <p className="text-slate-500 text-[10px] font-medium tracking-tight text-blue-400">Nguyên giá (Kỳ lọc)</p>
                <p className="text-xl font-semibold text-slate-800 tracking-tight">{formatCurrency(stats.cost)}</p>
             </div>
             <div className="p-3 bg-blue-50 text-blue-600 rounded-lg shadow-inner"><Building className="w-5 h-5"/></div>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition-shadow">
             <div>
                <p className="text-slate-500 text-[10px] font-medium tracking-tight text-amber-400">KH / Phân bổ lũy kế</p>
                <p className="text-xl font-semibold text-amber-600 tracking-tight">{formatCurrency(stats.ledgerTotal)}</p>
                <p className="text-[9px] text-slate-400 mt-1">211: {formatCurrency(stats.deprTsc)} · 242: {formatCurrency(stats.allocCcdc)}</p>
             </div>
             <div className="p-3 bg-amber-50 text-amber-600 rounded-lg shadow-inner"><TrendingDown className="w-5 h-5"/></div>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition-shadow">
             <div>
                <p className="text-slate-500 text-[10px] font-medium tracking-tight text-emerald-400">Giá trị còn lại</p>
                <p className="text-xl font-semibold text-emerald-600 tracking-tight">{formatCurrency(stats.residual)}</p>
             </div>
             <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg shadow-inner"><CheckCircle2 className="w-5 h-5"/></div>
          </div>
       </div>

       <div className="flex flex-wrap justify-between items-center gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-white p-1 rounded-xl border border-slate-200 inline-flex shadow-sm">
              <button onClick={() => { setActiveTab('LIST'); setBulkTransferAssetIds([]); }} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'LIST' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}><List className="w-4 h-4" /> Danh sách Tài sản</button>
              <button onClick={() => { setActiveTab('DEPRECIATION'); setBulkTransferAssetIds([]); }} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'DEPRECIATION' ? 'bg-amber-600 text-white shadow' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}><Calculator className="w-4 h-4" /> Tính Khấu hao / Phân bổ</button>
              <button onClick={() => { setActiveTab('INCREASE'); setBulkTransferAssetIds([]); }} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'INCREASE' ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}><Plus className="w-4 h-4" /> Ghi tăng Mới</button>
            </div>
            {activeTab === 'LIST' && selectedActiveCount >= 2 && (
              <button
                type="button"
                onClick={openBulkTransfer}
                className="px-4 py-2 text-sm font-bold rounded-xl bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 transition-all flex items-center gap-2 animate-fade-in"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Điều chuyển hàng loạt ({selectedActiveCount})
              </button>
            )}
          </div>
          <div className="relative">
             <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
             <input placeholder="Tìm mã, tên tài sản, nhà cung cấp..." className="pl-9 p-2 border rounded-lg text-sm w-80 focus:ring-2 focus:ring-blue-500 outline-none bg-white shadow-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
       </div>

       <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden min-h-[500px]">
          {activeTab === 'LIST' && (
             <div className="animate-fade-in overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse min-w-[1200px]">
                   <thead className="bg-slate-50 text-slate-500 border-b text-[11px] font-semibold tracking-tight">
                      <tr>
                         <th className="p-4 w-10 text-center">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              checked={allPagedActiveSelected}
                              onChange={toggleSelectAllOnPage}
                              title="Chọn tất cả tài sản đang SD trên trang này"
                            />
                         </th>
                         <th className="p-4 text-center">Mã tài sản</th>
                         <th className="p-4 text-center">Tên tài sản</th>
                         <th className="p-4 text-center">Nhà cung cấp</th>
                         <th className="p-4 text-center">MST</th>
                         <th className="p-4 text-center">Loại</th>
                         <th className="p-4 text-center">Ngày bắt đầu SD</th>
                         <th className="p-4 text-center">Nguyên giá</th>
                         <th className="p-4 text-center">Giá trị còn lại</th>
                         <th className="p-4 text-center">Bộ phận</th>
                         <th className="p-4 text-center">Hành động</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                      {pagedAssets.map(asset => (
                        <tr
                          key={asset.id}
                          className={`hover:bg-slate-50 transition-colors group cursor-pointer ${asset.status === 'LIQUIDATED' ? 'bg-slate-50/80' : ''}`}
                           onClick={() => handleView(asset)}
                           title="Click để xem chi tiết"
                         >
                            <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                               <input
                                 type="checkbox"
                                 className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-30"
                                 checked={selectedAssetIds.has(asset.id)}
                                 disabled={asset.status !== 'ACTIVE'}
                                 onChange={() => toggleAssetSelection(asset.id)}
                                 title={asset.status === 'ACTIVE' ? 'Chọn để điều chuyển hàng loạt' : 'Tài sản đã thanh lý'}
                               />
                            </td>
                            <td className="p-4 text-center font-mono font-bold text-blue-600">{asset.code}</td>
                            <td className="p-4 text-center font-bold text-slate-700">{asset.name}</td>
                            <td className="p-4 text-center">
                               <div className="text-slate-800 font-medium">{asset.supplierName || '---'}</div>
                               <div className="text-[10px] text-slate-400">{asset.supplierPhone || ''}</div>
                            </td>
                            <td className="p-4 text-center font-mono text-[11px] text-slate-500">{asset.supplierTaxCode || '---'}</td>
                            <td className="p-4 text-center">
                               <div className="flex flex-col items-center gap-1">
                                  <span className={`px-2 py-1 rounded text-[10px] font-medium ${asset.type === 'TSCĐ' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-orange-50 text-orange-700 border border-orange-100'}`}>{asset.type}</span>
                                  <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border ${asset.status === 'LIQUIDATED' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                                    {asset.status === 'LIQUIDATED' ? 'Đã thanh lý' : 'Đang SD'}
                                  </span>
                                  {asset.ccdcLifecycle === 'STOCK_153' && (
                                     <span className="text-[9px] font-medium tracking-tight text-slate-500">TK 153</span>
                                  )}
                               </div>
                            </td>
                            <td className="p-4 text-center text-slate-500">{new Date(asset.useDate).toLocaleDateString('vi-VN')}</td>
                            <td className="p-4 text-center font-bold text-slate-700 tabular-nums">{formatCurrency(asset.cost)}</td>
                            <td className="p-4 text-center font-semibold text-emerald-600 tabular-nums">{formatCurrency(asset.residualValue)}</td>
                            <td className="p-4 text-center text-slate-600 font-medium">{asset.department}</td>
                            <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                               <div className="flex justify-center flex-wrap gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {asset.ccdcLifecycle === 'STOCK_153' && (
                                     <button
                                        type="button"
                                        onClick={() => setCcdcPutUse(asset)}
                                        className="px-2 py-1 text-[10px] font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-lg shadow-sm"
                                        title="Nợ 242 / Có 153"
                                     >
                                        Đưa vào SD
                                     </button>
                                  )}
                                  <button type="button" onClick={() => handleView(asset)} className="p-1.5 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded" title="Xem"><Eye className="w-4 h-4"/></button>
                                  {asset.status === 'ACTIVE' && (
                                    <button
                                      type="button"
                                      onClick={() => setTransferringAsset(asset)}
                                      className="p-1.5 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded"
                                      title="Điều chuyển tài sản"
                                    >
                                      <ArrowLeftRight className="w-4 h-4" />
                                    </button>
                                  )}
                                  {asset.status === 'ACTIVE' && (
                                    <button
                                      type="button"
                                      onClick={() => setLiquidatingAsset(asset)}
                                      className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded"
                                      title="Thanh lý — tính khấu hao/phân bổ đến ngày thanh lý và tự sinh bút toán"
                                    >
                                      <Gavel className="w-4 h-4" />
                                    </button>
                                  )}
                                  <button type="button" onClick={() => handleEdit(asset)} className="p-1.5 hover:bg-amber-50 text-slate-400 hover:text-amber-600 rounded" title="Sửa"><Edit className="w-4 h-4"/></button>
                                  <button type="button" onClick={() => handleDelete(asset)} className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded" title="Xóa"><Trash2 className="w-4 h-4"/></button>
                               </div>
                            </td>
                         </tr>
                      ))}
                      {filteredAssets.length === 0 && (
                        <tr>
                          <td colSpan={11} className="p-20 text-center text-slate-400 font-medium italic">
                            Không có tài sản phù hợp.
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
          )}
          {activeTab === 'DEPRECIATION' && <DepreciationView handleRunDepreciation={handleRunDepreciation} assets={assets} />}
          {activeTab === 'INCREASE' && <AssetIncreaseForm onAdd={handleAddAsset} onCancel={() => setActiveTab('LIST')} />}
          {activeTab === 'TRANSFER' && bulkTransferAssets.length >= 2 && (
            <AssetBulkTransferForm
              assets={bulkTransferAssets}
              employees={employees}
              onCancel={() => {
                setBulkTransferAssetIds([]);
                setActiveTab('LIST');
              }}
              onConfirm={handleTransferConfirm}
            />
          )}
          {activeTab === 'TRANSFER' && bulkTransferAssets.length < 2 && (
            <div className="p-12 text-center text-slate-500">
              <p className="font-medium">Chưa có tài sản được chọn cho phiếu điều chuyển.</p>
              <button type="button" onClick={() => setActiveTab('LIST')} className="mt-4 text-sm font-bold text-blue-600 hover:underline">Quay lại danh sách</button>
            </div>
          )}
       </div>

       <EditAssetModal asset={editingAsset} onClose={() => setEditingAsset(null)} onSave={handleUpdateAsset} />
       <DeleteAssetModal asset={deletingAsset} onClose={() => setDeletingAsset(null)} onConfirm={(id) => { handleDeleteAsset(id); setDeletingAsset(null); }} />
       <ViewAssetModal asset={viewingAsset ? assets.find((a) => a.id === viewingAsset.id) || viewingAsset : null} onClose={() => setViewingAsset(null)} />
       <TransferAssetModal
          asset={transferringAsset}
          employees={employees}
          onClose={() => setTransferringAsset(null)}
          onConfirm={handleTransferConfirm}
       />
       <LiquidateAssetModal
          asset={liquidatingAsset}
          onClose={() => setLiquidatingAsset(null)}
          onConfirm={(assetId, payload) => {
            if (handleLiquidateAsset(assetId, payload)) {
              setLiquidatingAsset(null);
            }
          }}
       />
       {ccdcPutUse && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4 animate-fade-in">
             <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100">
                <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
                   <h4 className="text-sm font-bold text-slate-800">Đưa CCDC vào sử dụng</h4>
                   <button type="button" onClick={() => setCcdcPutUse(null)} className="p-1 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-4 space-y-3 text-sm text-slate-600">
                   <p><span className="font-semibold text-slate-800">{ccdcPutUse.name}</span> — Bút toán: Nợ <b>242</b> / Có <b>153</b> ({formatCurrency(ccdcPutUse.cost)}).</p>
                   <label className="block text-[10px] font-medium text-slate-500">Ngày đưa vào sử dụng</label>
                   <input
                      type="date"
                      className="w-full p-2 border rounded-lg font-mono"
                      value={putIntoUseDate}
                      onChange={(e) => setPutIntoUseDate(e.target.value)}
                   />
                </div>
                <div className="px-4 py-3 bg-slate-50 flex justify-end gap-2">
                   <button type="button" onClick={() => setCcdcPutUse(null)} className="px-4 py-2 text-sm font-semibold text-slate-600 rounded-lg hover:bg-slate-100">Hủy</button>
                   <button
                      type="button"
                      onClick={() => {
                         handlePutCcdcIntoUse(ccdcPutUse.id, putIntoUseDate);
                         setCcdcPutUse(null);
                      }}
                      className="px-4 py-2 text-sm font-bold text-white bg-orange-500 rounded-lg hover:bg-orange-600"
                   >
                      Ghi sổ
                   </button>
                </div>
             </div>
          </div>
       )}
    </div>
  );
};

const AssetIncreaseForm = ({ onAdd, onCancel }: { onAdd: (asset: Partial<Asset>, paymentMethod: string, opts?: { retroToPeriod?: string; retroPolicy?: 'DAY1_INCLUDES_MONTH' | 'FULL_MONTHS_ONLY'; bankAccountId?: string }) => void, onCancel: () => void }) => {
   const { suppliers, partnerNameHistory, rememberPartnerName, bankAccounts } = useApp();
   const assetIncreaseSupplierOptions = useMemo(
      () =>
         mergePartnerNameSuggestions(
            'supplier',
            (suppliers || []).map((s) => s.name).filter(Boolean) as string[],
            partnerNameHistory,
         ),
      [suppliers, partnerNameHistory],
   );

   const [formData, setFormData] = useState({
      code: '',
      name: '',
      type: 'TSCĐ',
      assetGroup: '1. TSCĐ Hữu hình (211)',
      assetAccount: '2112 - Máy móc, thiết bị',
      purchaseFormNo: '',
      purchaseSymbolCode: '',
      purchaseInvoiceNumber: '',
      buyDate: new Date().toISOString().split('T')[0],
      useDate: new Date().toISOString().split('T')[0],
      usefulLife: 36,
      cost: 0,
      vatRate: 10,
      paymentMethod: 'Chuyển khoản (TK NH 1121)',
      department: 'Bộ phận Quản lý',
      salvageValue: 0,
      expenseAccount: '6421',
      // Supplier fields
      supplierName: '',
      supplierTaxCode: '',
      supplierAddress: '',
      supplierPhone: ''
   });

   const [isConfirming, setIsConfirming] = useState(false);
   const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
   const [retroEnabled, setRetroEnabled] = useState(true);
   const [retroToPeriod, setRetroToPeriod] = useState(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
   });
   const [retroPolicy, setRetroPolicy] = useState<'DAY1_INCLUDES_MONTH' | 'FULL_MONTHS_ONLY'>('DAY1_INCLUDES_MONTH');

   // Logic tính toán hao mòn lũy kế tự động dựa trên thời gian sử dụng thực tế
   const calculations = useMemo(() => {
      const cost = Number(formData.cost) || 0;
      const { vatAmount: vat, totalAmount: total } = roundInvoiceTotalsFromSums(
        cost,
        vatAmountUnrounded(cost, Number(formData.vatRate)),
      );

      const accCode = String(formData.assetAccount || '').split(' - ')[0].trim();
      const effectiveType: 'TSCĐ' | 'CCDC' =
        accCode === '242' || accCode === '153' ? 'CCDC' : 'TSCĐ';

      const useDate = parseLocalDateOnly(formData.useDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Tính số THÁNG TRÒN đã trôi qua từ ngày bắt đầu SD đến hôm nay
      // (không làm tròn theo chênh lệch tháng đơn thuần để tránh sai khi lệch vài ngày).
      let monthsPassed = 0;
      if (!Number.isNaN(useDate.getTime())) {
        monthsPassed =
          (today.getFullYear() - useDate.getFullYear()) * 12 + (today.getMonth() - useDate.getMonth());
        if (today.getDate() < useDate.getDate()) monthsPassed -= 1;
      }
      // Chưa đến ngày đưa vào SD → không tích lũy đến "hôm nay"
      if (!Number.isNaN(useDate.getTime()) && useDate > today) {
        monthsPassed = 0;
      }

      monthsPassed = Math.max(0, Math.min(monthsPassed, formData.usefulLife));

      const depBase =
        effectiveType === 'TSCĐ'
          ? DepreciationEngine.getDepreciableBase({
              cost,
              salvageValue: Number(formData.salvageValue || 0),
            })
          : AllocationEngine.getAllocatableBase(cost);
      const monthlyDepr = formData.usefulLife > 0 ? depBase / formData.usefulLife : 0;
      const accumulated = roundVnd(monthlyDepr * monthsPassed);
      const residual = cost - accumulated;

      // Retro preview (hồi ký) up to a selected month (YYYY-MM) — cùng logic với store handleAddAsset
      let retroMonthsEligible = 0;
      let retroPeriodBeforeUse = false;
      try {
         const [ry, rm] = retroToPeriod.split('-').map(Number);
         const periodEnd = new Date(ry, rm, 0);
         if (!Number.isNaN(useDate.getTime()) && periodEnd >= useDate) {
            const monthDiff =
              (periodEnd.getFullYear() - useDate.getFullYear()) * 12 +
              (periodEnd.getMonth() - useDate.getMonth());
            const includeStartMonth =
              retroPolicy === 'DAY1_INCLUDES_MONTH' && useDate.getDate() === 1 ? 1 : 0;
            retroMonthsEligible = Math.max(0, monthDiff + includeStartMonth);
         } else if (!Number.isNaN(useDate.getTime()) && !Number.isNaN(periodEnd.getTime())) {
            retroPeriodBeforeUse = periodEnd < useDate;
         }
      } catch {
         retroMonthsEligible = 0;
      }
      retroMonthsEligible = Math.max(0, Math.min(retroMonthsEligible, formData.usefulLife));
      const retroAccumulated = Math.min(depBase, roundVnd(monthlyDepr * retroMonthsEligible));
      const retroResidual = cost - retroAccumulated;

      return {
        total,
        accumulated,
        residual,
        monthlyDepr,
        retroMonthsEligible,
        retroAccumulated,
        retroResidual,
        depBase,
        effectiveType,
        retroPeriodBeforeUse,
        useDateInFuture: !Number.isNaN(useDate.getTime()) && useDate > today,
      };
   }, [
      formData.cost,
      formData.vatRate,
      formData.useDate,
      formData.usefulLife,
      retroToPeriod,
      retroPolicy,
      formData.salvageValue,
      formData.assetAccount,
   ]);
   const activeBankAccounts = useMemo(
      () => bankAccounts.filter((bank) => bank.status === 'ACTIVE'),
      [bankAccounts],
   );
   const selectedBankAccount = useMemo(
      () =>
        activeBankAccounts.find((bank) => bank.id === selectedBankAccountId) ||
        bankAccounts.find((bank) => bank.id === selectedBankAccountId) ||
        null,
      [activeBankAccounts, bankAccounts, selectedBankAccountId],
   );
   const paymentAccountPreview = useMemo(() => {
      if (formData.paymentMethod.includes('331')) return '331';
      if (formData.paymentMethod.startsWith('Chuyển khoản')) {
        return selectedBankAccount?.linkedAccountCode || '1121xxx';
      }
      return '1111';
   }, [formData.paymentMethod, selectedBankAccount]);

   useEffect(() => {
      if (!formData.paymentMethod.startsWith('Chuyển khoản')) {
         setSelectedBankAccountId('');
         return;
      }
      if (!selectedBankAccountId && activeBankAccounts.length > 0) {
         setSelectedBankAccountId(activeBankAccounts[0].id);
      }
   }, [formData.paymentMethod, selectedBankAccountId, activeBankAccounts]);

   const handleChange = (e: any) => {
      const { name, value, type } = e.target;
      setFormData(prev => {
        const v = type === 'number' ? Number(value) : value;
        const next: any = { ...prev, [name]: v };

        // Keep asset type consistent:
        // - If user selects CCDC group or 242 account, force type=CCDC
        // - Otherwise force type=TSCĐ
        if (name === 'assetGroup') {
          const isCCDC = String(v).includes('CCDC') || String(v).includes('(242)') || String(v).includes('(153)');
          next.type = isCCDC ? 'CCDC' : 'TSCĐ';
          if (String(v).includes('(153)')) {
            next.assetAccount = '153 - Công cụ dụng cụ chờ phân bổ (CCDC)';
          } else if (isCCDC) {
            next.assetAccount = '242 - Chi phí trả trước (CCDC)';
          } else if (String(next.assetAccount || '').startsWith('242') || String(next.assetAccount || '').startsWith('153')) {
            next.assetAccount = '2112 - Máy móc, thiết bị';
          }
        }
        if (name === 'assetAccount') {
          const accCode = String(v).split(' - ')[0].trim();
          const isCCDC = accCode === '242' || accCode === '153';
          next.type = isCCDC ? 'CCDC' : 'TSCĐ';
          if (accCode === '153') next.assetGroup = '4. CCDC — TK 153 (chờ đưa vào SD)';
          else if (accCode === '242') next.assetGroup = '3. CCDC (242)';
          else if (String(next.assetGroup || '').includes('CCDC')) next.assetGroup = '1. TSCĐ Hữu hình (211)';
        }
        return next;
      });
   };

   const handleSubmit = () => {
      if (!formData.name || !formData.code) {
         alert("Vui lòng nhập Mã định danh và Tên tài sản!");
         return;
      }
      if (formData.paymentMethod.startsWith('Chuyển khoản') && !selectedBankAccount) {
         alert("Vui lòng chọn tài khoản ngân hàng liên kết trước khi ghi tăng.");
         return;
      }

      rememberPartnerName('supplier', formData.supplierName);

      const assetAccountCode = String(formData.assetAccount || '').split(' - ')[0].trim();
      const normalizedType = assetAccountCode === '242' || assetAccountCode === '153' ? 'CCDC' : 'TSCĐ';
      const ccdcLifecycle =
         normalizedType === 'CCDC' ? (assetAccountCode === '153' ? 'STOCK_153' : 'IN_USE') : undefined;

      const payload: Partial<Asset> = {
         code: formData.code,
         name: formData.name,
         // Derive from account to avoid mismatched type display (e.g. account 242 must be CCDC)
         type: normalizedType as any,
         assetGroup: formData.assetGroup,
         assetAccount: formData.assetAccount,
         ccdcLifecycle,
         salvageValue: normalizedType === 'TSCĐ' ? Math.max(0, Number(formData.salvageValue || 0)) : undefined,
         expenseAccount: formData.expenseAccount,
         purchaseFormNo: (formData.purchaseFormNo || '').trim() || undefined,
         purchaseSymbolCode: (formData.purchaseSymbolCode || '').trim() || undefined,
         purchaseInvoiceNumber: (formData.purchaseInvoiceNumber || '').trim() || undefined,
         cost: formData.cost,
         vatRate: formData.vatRate,
         buyDate: formData.buyDate,
         useDate: formData.useDate,
         usefulLife: formData.usefulLife,
         department: formData.department,
         // Always store initial accumulated as 0; if user enables "trích hồi ký", store will generate
         // the retro journal entries by useDate and then update accumulated accordingly (source of truth).
         accumulatedDepreciation: 0,
         accumulatedAllocation: 0,
         residualValue: Number(formData.cost || 0),
         status: 'ACTIVE',
         supplierName: formData.supplierName,
         supplierTaxCode: formData.supplierTaxCode,
         supplierAddress: formData.supplierAddress,
         supplierPhone: formData.supplierPhone
      };

      // Map payment method to internal format
      let method = 'DEBT';
      if (formData.paymentMethod.startsWith('Chuyển khoản')) method = 'BANK';
      else if (formData.paymentMethod.includes('111')) method = 'CASH';

      onAdd(
        payload,
        method,
        {
          retroToPeriod:
            retroEnabled && !String(formData.assetAccount || '').startsWith('153') ? retroToPeriod : undefined,
          retroPolicy,
          bankAccountId: method === 'BANK' ? selectedBankAccount?.id : undefined,
        }
      );
      setIsConfirming(false);
      onCancel(); 
   };

   return (
      <div className="p-5 sm:p-6 max-w-5xl mx-auto bg-white animate-fade-in relative">
         <div className="grid grid-cols-2 gap-x-5 sm:gap-x-8 gap-y-5">
            {/* Cột trái: Thông tin tài sản */}
            <div className="space-y-4">
               <h4 className="border-b border-blue-100 pb-1.5 text-[10px] font-semibold tracking-tight text-blue-600">1. Thông tin định danh</h4>
               <div className="grid grid-cols-2 gap-3">
                  <div>
                     <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Mã tài sản</label>
                     <input name="code" value={formData.code} onChange={handleChange} className="w-full py-2 px-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-slate-600 font-medium" />
                  </div>
                  <div>
                     <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Nhóm hạch toán</label>
                     <select name="assetGroup" value={formData.assetGroup} onChange={handleChange} className="w-full py-2 px-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 font-bold bg-slate-50/50">
                        <option>1. TSCĐ Hữu hình (211)</option>
                        <option>2. TSCĐ Vô hình (213)</option>
                        <option>3. CCDC (242)</option>
                        <option>4. CCDC — TK 153 (chờ đưa vào SD)</option>
                     </select>
                  </div>
               </div>
               <div>
                  <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Tên tài sản / CCDC</label>
                  <input name="name" value={formData.name} onChange={handleChange} className="w-full py-2 px-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-slate-600 font-medium" />
               </div>
               <div>
                  <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Tài khoản hạch toán</label>
                  <select name="assetAccount" value={formData.assetAccount} onChange={handleChange} className="w-full py-2 px-2.5 text-sm border border-emerald-100 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-emerald-700 font-bold bg-emerald-50/30">
                     <option>2112 - Máy móc, thiết bị</option>
                     <option>2111 - Nhà cửa, vật kiến trúc</option>
                     <option>2113 - Phương tiện vận tải</option>
                     <option>153 - Công cụ dụng cụ chờ phân bổ (CCDC)</option>
                     <option>242 - Chi phí trả trước (CCDC)</option>
                  </select>
               </div>
               <div className="grid grid-cols-2 gap-3">
                  <div>
                     <label className="block text-[9px] mb-1 font-medium text-slate-500 text-[10px] tracking-widest">Ngày mua</label>
                     <input type="date" name="buyDate" value={formData.buyDate} onChange={handleChange} className="w-full py-2 px-2 border border-slate-200 rounded-lg text-xs font-medium" />
                  </div>
                  <div>
                     <label className="block text-[9px] mb-1 font-medium text-slate-500 text-[10px] tracking-widest">Ngày bắt đầu SD</label>
                     <input type="date" name="useDate" value={formData.useDate} onChange={handleChange} className="w-full py-2 px-2 border border-blue-200 rounded-lg text-xs font-medium bg-blue-50/50" />
                  </div>
               </div>
               {calculations.effectiveType === 'TSCĐ' && (
                  <div className="grid grid-cols-2 gap-3">
                     <div>
                        <label className="block text-[9px] mb-1 font-medium text-slate-500 text-[10px]">Giá trị thu hồi cuối kỳ (dự kiến)</label>
                        <input type="number" name="salvageValue" min={0} value={formData.salvageValue} onChange={handleChange} className="w-full py-2 px-2.5 border border-slate-200 rounded-lg text-sm font-bold" />
                     </div>
                     <div>
                        <label className="block text-[9px] mb-1 font-medium text-slate-500 text-[10px]">Phần khấu hao (NG − thu hồi)</label>
                        <p className="text-xs font-semibold text-indigo-700 pt-1.5 tabular-nums">{formatCurrency(calculations.depBase)}</p>
                     </div>
                  </div>
               )}
               <div>
                  <label className="block text-[9px] mb-1 font-medium text-slate-500 text-[10px]">TK chi phí khấu hao / phân bổ</label>
                  <select name="expenseAccount" value={formData.expenseAccount} onChange={handleChange} className="w-full py-2 px-2.5 border border-slate-200 rounded-lg text-xs font-bold text-slate-800">
                     <option value="6421">6421 — Chi phí bán hàng</option>
                     <option value="6422">6422 — Chi phí quản lý doanh nghiệp</option>
                     <option value="641">641 — Chi phí bán hàng</option>
                     <option value="627">627 — Chi phí sản xuất chung</option>
                  </select>
               </div>
            </div>

            {/* Cột phải: Thông tin Nhà cung cấp */}
            <div className="space-y-4">
               <h4 className="border-b border-purple-100 pb-1.5 text-[10px] font-semibold tracking-tight text-purple-600">2. Thông tin nhà cung cấp</h4>
               <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div>
                     <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Mẫu số</label>
                     <input name="purchaseFormNo" value={(formData as any).purchaseFormNo} onChange={handleChange} className="w-full py-2 px-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-slate-700 font-bold" />
                  </div>
                  <div>
                     <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Ký hiệu</label>
                     <input name="purchaseSymbolCode" value={(formData as any).purchaseSymbolCode} onChange={handleChange} className="w-full py-2 px-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-slate-700 font-bold" />
                  </div>
                  <div>
                     <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Số hoá đơn</label>
                     <input name="purchaseInvoiceNumber" value={(formData as any).purchaseInvoiceNumber} onChange={handleChange} className="w-full py-2 px-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-slate-700 font-bold" />
                  </div>
               </div>
               <div>
                  <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Tên đơn vị bán hàng</label>
                  <input
                     name="supplierName"
                     list="assetIncreaseSupplierNameList"
                     value={formData.supplierName}
                     onChange={handleChange}
                     onBlur={() => rememberPartnerName('supplier', formData.supplierName)}
                     placeholder="Gõ để gợi ý từ danh mục và tên đã nhập..."
                     className="w-full py-2 px-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-slate-700"
                  />
               </div>
               <div className="grid grid-cols-2 gap-3">
                  <div>
                     <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Mã số thuế</label>
                     <input name="supplierTaxCode" value={formData.supplierTaxCode} onChange={handleChange} className="w-full py-2 px-2.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none font-mono" />
                  </div>
                  <div>
                     <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Di động / Liên hệ</label>
                     <input name="supplierPhone" value={formData.supplierPhone} onChange={handleChange} className="w-full py-2 px-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" />
                  </div>
               </div>
               <div>
                  <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Địa chỉ trụ sở</label>
                  <input name="supplierAddress" value={formData.supplierAddress} onChange={handleChange} className="w-full py-2 px-2.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" />
               </div>
               <div>
                  <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Thời gian SD (Tháng)</label>
                  <input type="number" name="usefulLife" value={formData.usefulLife} onChange={handleChange} className="w-full py-2 px-2.5 border border-slate-200 rounded-lg text-sm font-semibold text-slate-800" />
               </div>

               <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3">
                  <div className="flex items-start gap-3">
                     <input
                        type="checkbox"
                        className="mt-1"
                        checked={retroEnabled}
                        onChange={(e) => setRetroEnabled(e.target.checked)}
                     />
                     <div className="flex-1">
                        <div className="text-[11px] font-semibold tracking-tight text-slate-700">
                           Trích hồi ký khấu hao/phân bổ (theo ngày bắt đầu sử dụng)
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">
                           Hệ thống sẽ tự sinh bút toán theo <b>useDate</b> (không theo ngày nhập), đến tháng bạn chọn.
                        </div>
                     </div>
                  </div>

                  {retroEnabled && String(formData.assetAccount || '').startsWith('153') && (
                     <div className="mt-3 text-[11px] text-orange-800 font-medium">
                        Tài sản trên TK 153 chưa phân bổ. Hồi ký chỉ áp dụng sau khi <b>Đưa vào sử dụng</b> (chuyển 242).
                     </div>
                  )}
                  {retroEnabled && !String(formData.assetAccount || '').startsWith('153') && (
                     <div className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                           <label className="block text-[9px] mb-1 font-medium text-slate-500 text-[10px] tracking-widest">Hồi ký đến tháng</label>
                           <input
                              type="month"
                              value={retroToPeriod}
                              onChange={(e) => setRetroToPeriod(e.target.value)}
                              className="w-full py-1.5 px-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 bg-white"
                           />
                        </div>
                        <div>
                           <label className="block text-[9px] mb-1 font-medium text-slate-500 text-[10px] tracking-widest">Quy tắc tính tháng</label>
                           <select
                              value={retroPolicy}
                              onChange={(e) => setRetroPolicy(e.target.value as any)}
                              className="w-full py-1.5 px-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 bg-white"
                           >
                              <option value="DAY1_INCLUDES_MONTH">Nếu bắt đầu SD ngày 01 ⇒ tính luôn tháng đó</option>
                              <option value="FULL_MONTHS_ONLY">Luôn tính đủ tháng (bắt đầu từ tháng kế tiếp)</option>
                           </select>
                        </div>
                        {calculations.retroPeriodBeforeUse && (
                           <div className="col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                              <b>Hồi ký = 0 tháng:</b> tháng &quot;Hồi ký đến&quot; kết thúc <b>trước</b> ngày bắt đầu sử dụng. Hãy chọn tháng kết thúc <b>sau hoặc bằng</b> tháng của ngày bắt đầu SD (hoặc điều chỉnh ngày bắt đầu SD).
                           </div>
                        )}
                        {Number(formData.cost) > 0 && !calculations.retroPeriodBeforeUse && calculations.retroMonthsEligible === 0 && (
                           <div className="col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
                              Dự kiến hồi ký: <b>0</b> tháng (kiểm tra ngày bắt đầu SD, thời gian SD tháng và tháng hồi ký).
                           </div>
                        )}
                        <div className="col-span-2 text-[11px] text-slate-600">
                           Dự kiến hồi ký: <b>{calculations.retroMonthsEligible}</b> tháng · Lũy kế: <b>{formatCurrency(calculations.retroAccumulated)}</b> · Còn lại: <b>{formatCurrency(calculations.retroResidual)}</b>
                        </div>
                     </div>
                  )}
               </div>
            </div>

            {/* Khối giá trị & hạch toán */}
            <div className="col-span-2 grid grid-cols-2 gap-6 sm:gap-8 pt-3 border-t border-slate-100">
               <div className="max-w-md">
                  <div className="bg-blue-50/30 border border-blue-100 p-4 rounded-xl h-full flex flex-col justify-center">
                     <label className="mb-2 block text-[10px] font-semibold tracking-tight text-blue-800">Nguyên giá (chưa VAT)</label>
                     <input type="number" name="cost" value={formData.cost || ''} onChange={handleChange} className="bg-transparent border-none text-2xl sm:text-3xl font-semibold text-slate-600 p-0 outline-none w-full max-w-full" placeholder="0" />
                     <p className="text-[11px] text-blue-500 font-bold mt-1 italic tabular-nums">{formatCurrency(formData.cost)}</p>
                  </div>
               </div>
               <div className="space-y-4 min-w-0">
                  <div>
                     <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px] tracking-wider">Hình thức hạch toán / Thanh toán</label>
                     <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center">
                        <div className="flex bg-slate-100 p-0.5 rounded-lg gap-0.5 flex-1 flex-wrap">
                           {[0, 5, 8, 10, VAT_RATE_NOT_SUBJECT].map(rate => (
                              <button
                                key={rate}
                                type="button"
                                onClick={() => setFormData(p => ({...p, vatRate: rate}))}
                                className={`min-w-[44px] flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all leading-tight ${formData.vatRate === rate ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}
                              >
                                {formatVatRateLabel(rate)}
                              </button>
                           ))}
                        </div>
                        <select 
                           name="paymentMethod" 
                           value={formData.paymentMethod} 
                           onChange={handleChange} 
                           className={`flex-1 min-w-0 py-2 px-2.5 border rounded-lg text-xs font-bold outline-none transition-all ${formData.paymentMethod.includes('331') ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-700'}`}
                        >
                           <option>Chuyển khoản (TK NH 1121)</option>
                           <option>Tiền mặt (1111)</option>
                           <option>Ghi nợ NCC (Phải trả 331)</option>
                        </select>
                     </div>
                     {formData.paymentMethod.startsWith('Chuyển khoản') && (
                        <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                           <label className="mb-1 block text-[10px] font-semibold tracking-tight text-blue-700">Tài khoản ngân hàng thanh toán</label>
                           <select
                              value={selectedBankAccountId}
                              onChange={(e) => setSelectedBankAccountId(e.target.value)}
                              className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                           >
                              <option value="">-- Chọn tài khoản ngân hàng --</option>
                              {activeBankAccounts.map((bank) => (
                                 <option key={bank.id} value={bank.id}>
                                    {bank.bankName} - {bank.accountNumber}
                                 </option>
                              ))}
                           </select>
                           <p className="mt-2 text-[10px] text-blue-700">
                              {selectedBankAccount
                                 ? `Ghi Có tự động vào TK ${selectedBankAccount.linkedAccountCode}.`
                                 : 'Chọn tài khoản thực tế để không hạch toán trực tiếp vào 1121 tổng hợp.'}
                           </p>
                        </div>
                     )}
                  </div>
                  <div className="bg-emerald-50/50 py-2.5 px-3 rounded-lg border border-emerald-100 flex justify-between items-center gap-2">
                     <span className="text-[10px] font-semibold tracking-tight text-emerald-800">Tổng giá trị ghi tăng:</span>
                     <span className="text-lg font-semibold text-emerald-600 tabular-nums shrink-0">{formatCurrency(calculations.total)}</span>
                  </div>
               </div>
            </div>

            {/* Khối tính toán tự động */}
            <div className="col-span-2 bg-amber-50/40 border border-amber-100 p-4 rounded-2xl relative">
               <div className="grid grid-cols-12 gap-4 items-start">
                  <div className="col-span-12 lg:col-span-7 space-y-3">
                     <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-tight text-amber-800">
                        <Calculator className="w-4 h-4 text-amber-600 shrink-0" /> Hạch toán dự kiến (TT133)
                     </div>
                     <div className="space-y-2">
                        {calculations.useDateInFuture && (
                           <p className="text-[10px] text-amber-800 bg-amber-100/80 border border-amber-200 rounded-lg px-2 py-1.5">
                              Ngày bắt đầu SD còn ở <b>tương lai</b> so với hôm nay — lũy kế &quot;đến hôm nay&quot; = <b>0</b> (chưa phát sinh khấu hao/phân bổ thực tế).
                           </p>
                        )}
                        <div className="flex justify-between gap-2 border-b border-amber-200/50 pb-1.5">
                           <span className="text-amber-700 text-xs font-medium">Hao mòn lũy kế hạch toán:</span>
                           <span className="font-semibold text-slate-800 text-xs tabular-nums">{formatCurrency(calculations.accumulated)}</span>
                        </div>
                        <div className="flex justify-between gap-2 pt-0.5 items-baseline">
                           <span className="text-amber-900 text-sm font-semibold tracking-tight">Giá trị còn lại (Dư Nợ):</span>
                           <span className="font-semibold text-xl text-emerald-600 tabular-nums">{formatCurrency(calculations.residual)}</span>
                        </div>
                     </div>
                  </div>
                  
                  <div className="col-span-12 lg:col-span-5 flex gap-2 pl-0 lg:pl-4 pt-3 lg:pt-0 border-t lg:border-t-0 lg:border-l border-amber-200/50">
                     <Info className="w-7 h-7 text-amber-400 shrink-0 mt-0.5" />
                     <div className="text-[9px] leading-snug text-amber-800/80 min-w-0">
                        <p className="font-bold border-b border-amber-200 mb-1 pb-0.5">Hệ thống hạch toán:</p>
                        <p>- Nợ TK {formData.assetAccount.split(' - ')[0]}: {formatCurrency(formData.cost)}</p>
                        <p>- Nợ TK 1331: {formatCurrency(roundInvoiceTotalsFromSums(Number(formData.cost) || 0, vatAmountUnrounded(Number(formData.cost) || 0, Number(formData.vatRate))).vatAmount)}</p>
                        <p>- Có TK {paymentAccountPreview}: {formatCurrency(calculations.total)}</p>
                        {String(formData.assetAccount || '').startsWith('153') && (
                           <p className="text-orange-800 font-bold mt-1">CCDC kho 153: sau ghi tăng, dùng nút <b>Đưa vào sử dụng</b> để Nợ 242 / Có 153.</p>
                        )}
                        {formData.paymentMethod.includes('331') && <p className="text-red-600 font-semibold mt-1">* Treo công nợ 331 - Sẽ theo dõi tại Sổ chi tiết công nợ.</p>}
                     </div>
                  </div>
               </div>
            </div>

            {/* Nút thao tác */}
            <div className="col-span-2 flex justify-end gap-3 mt-3 relative">
               <button onClick={onCancel} className="px-5 py-2 text-sm text-slate-500 font-bold hover:bg-slate-50 rounded-lg transition-all">Hủy bỏ</button>
               <button onClick={() => setIsConfirming(true)} className="px-8 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-[0.98] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Ghi tăng ngay
               </button>
            </div>
         </div>

         {/* Modal xác nhận ghi tăng */}
         {isConfirming && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
               <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100">
                  <div className="p-8 text-center">
                     <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <AlertCircle className="w-10 h-10" />
                     </div>
                     <h4 className="mb-2 text-xl font-semibold tracking-tight text-slate-800">Xác nhận ghi sổ tài sản</h4>
                     <p className="text-slate-500 text-sm leading-relaxed mb-8">
                        {formData.paymentMethod.includes('331') 
                           ? "Bạn đã chọn hình thức Ghi nợ NCC. Hệ thống sẽ hạch toán treo nợ TK 331 và tạo hồ sơ tài sản. Bạn chắc chắn chứ?"
                           : "Hệ thống sẽ tạo chứng từ mua hàng và hạch toán khấu hao tự động vào Sổ nhật ký chung. Bạn chắc chắn chứ?"}
                     </p>
                     <div className="flex gap-3">
                        <button onClick={() => setIsConfirming(false)} className="flex-1 py-3 rounded-2xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all active:scale-95">Quay lại sửa</button>
                        <button onClick={handleSubmit} className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white text-sm font-medium shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95">Đồng ý ghi sổ</button>
                     </div>
                  </div>
               </div>
            </div>
         )}

         <datalist id="assetIncreaseSupplierNameList">
            {assetIncreaseSupplierOptions.map((name) => (
               <option key={name} value={name} />
            ))}
         </datalist>
      </div>
   );
};

const DepreciationView = ({ assets, handleRunDepreciation }: { assets: Asset[], handleRunDepreciation: (period: string, entries: any[]) => void }) => {
   const [period, setPeriod] = useState(() => {
      const now = new Date();
      return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
   });

   const [showConfirm, setShowConfirm] = useState(false);
   const [selected, setSelected] = useState<any>(null);

   const baseStorageKey = 'asset_depr_pagination';
   const filterSignature = useMemo(() => JSON.stringify({ period }), [period]);
   const filterKey = useMemo(() => `f_${hashString(filterSignature)}`, [filterSignature]);
   const [page, setPage] = useState<number>(1);
   const [pageSize, setPageSize] = useState<StandardPageSize>(20);

   const deprList = useMemo(() => {
      const t0 = performance.now();
      const [py, pm] = period.split('-').map(Number);
      const periodEnd = new Date(py, pm, 0); // last day of the selected month
      const rows = assets
        .filter((a) => a.status === 'ACTIVE' && a.ccdcLifecycle !== 'STOCK_153')
        .map((a) => {
         const lifeMonths = Number(a.usefulLife || 0);
         const monthsEligible = countEligibleMonths(a.useDate, periodEnd, lifeMonths, 'DAY1_INCLUDES_MONTH');
         const openingAccumulated = getOpeningCarryForwardAccumulated(a);
         const carryForwardTarget = getOpeningCarryForwardTargetAccumulated(a, monthsEligible);
         const scheduleBase = getAssetScheduleBase(a);
         const targetForCurrentSchedule =
           carryForwardTarget != null
             ? Math.max(0, carryForwardTarget - openingAccumulated)
             : a.type === 'TSCĐ'
               ? DepreciationEngine.computeTargetAccumulated(scheduleBase, lifeMonths, monthsEligible)
               : AllocationEngine.computeTargetAllocated(scheduleBase, lifeMonths, monthsEligible);
         const targetAccumulated = Math.min(
           getAccumulatedLedgerCap(a),
           openingAccumulated + targetForCurrentSchedule,
         );
         const currentAccumulated = getAccumulatedLedgerAmount(a);
         const amountThisPeriod = Math.max(0, targetAccumulated - currentAccumulated);

         return {
            assetId: a.id,
            assetCode: a.code,
            assetName: a.name,
            cost: a.cost,
            amount: roundVnd(amountThisPeriod),
            targetAccumulated,
            debitAccount: resolveAssetExpenseAccount(a),
            creditAccount: a.type === 'TSCĐ' ? '214' : '242'
         };
      });
      const ms = performance.now() - t0;
      logSlowQuery('AssetPage.Depreciation.buildList', ms, { rows: rows.length });
      return rows;
   }, [assets, period]);

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

   const totalItems = deprList.length;
   const safePageSize = clampPageSize(pageSize);
   const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
   const safePage = Math.min(Math.max(1, page), totalPages);
   useEffect(() => { if (safePage !== page) setPage(safePage); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [safePage, totalPages]);
   const pagedList = useMemo(() => {
     const size = Math.min(100, safePageSize);
     const from = (safePage - 1) * size;
     const to = from + size;
     return deprList.slice(from, to);
   }, [deprList, safePage, safePageSize]);

   const totalAmount = deprList.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

   const handleRun = () => {
      if (deprList.length === 0) return;
      handleRunDepreciation(period, deprList);
      setShowConfirm(false);
   };

   return (
      <div className="p-6 animate-fade-in relative h-full flex flex-col">
         <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-4">
               <h3 className="font-bold text-slate-700">Trích khấu hao tháng:</h3>
               <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input type="month" className="pl-9 p-2 border rounded font-bold text-blue-600 outline-none focus:ring-2 focus:ring-blue-500" value={period} onChange={e => setPeriod(e.target.value)} />
               </div>
            </div>
            
            <button 
               onClick={() => setShowConfirm(true)} 
               disabled={deprList.length === 0 || totalAmount <= 0} 
               className="bg-amber-500 hover:bg-amber-600 text-white px-8 py-2.5 rounded-xl font-semibold shadow-lg shadow-amber-100 flex items-center gap-2 transition-all disabled:opacity-50 active:scale-95"
            >
               <Calculator className="w-5 h-5" /> Thực hiện trích khấu hao
            </button>
         </div>

         {showConfirm && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
               <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100">
                  <div className="p-8 text-center">
                     <div className="w-20 h-20 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <Calculator className="w-10 h-10" />
                     </div>
                     <h4 className="mb-2 text-xl font-semibold tracking-tight text-slate-800">Xác nhận trích khấu hao</h4>
                     <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-8">
                        <div className="flex justify-between items-center mb-2 text-sm">
                           <span className="text-slate-500 font-medium">Kỳ kế toán:</span>
                           <span className="font-semibold text-blue-600">{period}</span>
                        </div>
                        <div className="flex justify-between items-center mb-2 text-sm">
                           <span className="text-slate-500 font-medium">Số lượng tài sản:</span>
                           <span className="font-semibold text-slate-700">{deprList.length}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                           <span className="text-slate-700 font-bold">Tổng tiền trích:</span>
                           <span className="font-semibold text-xl text-amber-600">{formatCurrency(totalAmount)}</span>
                        </div>
                     </div>
                     <div className="flex gap-3">
                        <button onClick={() => setShowConfirm(false)} className="flex-1 py-3 rounded-2xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all active:scale-95">Hủy bỏ</button>
                        <button onClick={handleRun} className="flex-1 py-3 rounded-2xl bg-amber-500 text-white text-sm font-medium shadow-xl shadow-amber-100 hover:bg-amber-600 transition-all active:scale-95">Xác nhận ghi sổ</button>
                     </div>
                  </div>
               </div>
            </div>
         )}

         <div className="border border-slate-200 rounded-2xl overflow-hidden flex-1 shadow-sm">
            {selected && (
               <div className="p-4 bg-slate-50 border-b">
                  <div className="text-[10px] font-medium tracking-tight text-slate-500">Chi tiết</div>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                     <div className="bg-white rounded-lg border border-slate-200 p-3">
                        <div className="text-[10px] font-medium text-slate-500">Tài sản</div>
                        <div className="font-mono font-bold text-slate-800">{selected.assetCode}</div>
                        <div className="text-xs text-slate-500 mt-1 truncate">{selected.assetName}</div>
                     </div>
                     <div className="bg-white rounded-lg border border-slate-200 p-3">
                        <div className="text-[10px] font-medium text-slate-500">Định khoản</div>
                        <div className="font-mono font-bold text-slate-800">Nợ {selected.debitAccount} / Có {selected.creditAccount}</div>
                        <div className="text-xs text-slate-500 mt-1">Kỳ: {period}</div>
                     </div>
                     <div className="bg-white rounded-lg border border-slate-200 p-3 text-right">
                        <div className="text-[10px] font-medium text-slate-500">Số tiền</div>
                        <div className="font-semibold text-amber-700">{formatCurrency(selected.amount)}</div>
                     </div>
                  </div>
               </div>
            )}
            <table className="w-full text-sm text-left">
               <thead className="bg-slate-100 text-slate-600 border-b text-[11px] font-semibold tracking-tight">
                  <tr>
                     <th className="p-4">Mã tài sản</th>
                     <th className="p-4">Tên tài sản</th>
                     <th className="p-4 text-center">Định khoản</th>
                     <th className="p-4 text-right">Giá trị trích kỳ này</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-100 bg-white">
                  {pagedList.map(item => (
                     <tr
                       key={item.assetId}
                       className="hover:bg-slate-50 transition-colors cursor-pointer"
                       onClick={() => setSelected(item)}
                       title="Click để xem chi tiết"
                     >
                        <td className="p-4 font-mono font-bold text-blue-600">{item.assetCode}</td>
                        <td className="p-4 font-medium text-slate-700">{item.assetName}</td>
                        <td className="p-4 text-center">
                           <span className="bg-slate-100 px-3 py-1 rounded-lg font-mono text-[11px] font-bold text-slate-500 border border-slate-200">Nợ {item.debitAccount} / Có {item.creditAccount}</span>
                        </td>
                        <td className="p-4 text-right font-semibold text-amber-600 tabular-nums">{formatCurrency(item.amount)}</td>
                     </tr>
                  ))}
                  {deprList.length === 0 && (
                     <tr>
                        <td colSpan={4} className="p-20 text-center text-slate-400 italic bg-slate-50/50">Không có tài sản nào đang hoạt động để thực hiện trích khấu hao.</td>
                     </tr>
                  )}
               </tbody>
               {deprList.length > 0 && (
                  <tfoot>
                     <tr className="bg-slate-50 font-semibold border-t-2">
                        <td colSpan={3} className="p-4 text-right text-xs font-medium tracking-tight text-slate-500">Tổng cộng phát sinh kỳ này</td>
                        <td className="p-4 text-right text-xl text-amber-700 tabular-nums">{formatCurrency(totalAmount)}</td>
                     </tr>
                  </tfoot>
               )}
            </table>
         </div>
         {deprList.length > 0 && (
            <Pagination
              page={safePage}
              totalItems={totalItems}
              pageSize={safePageSize}
              onChangePage={setPage}
              onChangePageSize={(s) => setPageSize(clampPageSize(s))}
            />
         )}
      </div>
   );
};

const LiquidateAssetModal = ({
  asset,
  onClose,
  onConfirm,
}: {
  asset: Asset | null;
  onClose: () => void;
  onConfirm: (
    assetId: string,
    payload: {
      liquidationDate: string;
      saleAmount?: number;
      saleVatRate?: number;
      receiptMethod?: AssetLiquidationReceiptMethod;
      bankAccountId?: string;
      contactName?: string;
    },
  ) => void;
}) => {
  const { bankAccounts } = useApp();
  const activeBankAccounts = useMemo(
    () => bankAccounts.filter((bank) => bank.status === 'ACTIVE'),
    [bankAccounts],
  );
  const [liquidationDate, setLiquidationDate] = useState('');
  const [saleAmount, setSaleAmount] = useState(0);
  const [saleVatRate, setSaleVatRate] = useState(10);
  const [receiptMethod, setReceiptMethod] = useState<AssetLiquidationReceiptMethod>('CASH');
  const [bankAccountId, setBankAccountId] = useState('');
  const [contactName, setContactName] = useState('');

  useEffect(() => {
    if (!asset) return;
    setLiquidationDate(new Date().toISOString().split('T')[0]);
    setSaleAmount(0);
    setSaleVatRate(10);
    setReceiptMethod('CASH');
    setBankAccountId(activeBankAccounts[0]?.id || '');
    setContactName('');
  }, [asset, activeBankAccounts]);

  const preview = useMemo(() => {
    if (!asset) return null;
    return buildAssetLiquidationPreview(asset, liquidationDate, saleAmount, saleVatRate);
  }, [asset, liquidationDate, saleAmount, saleVatRate]);

  const resolvedReceiptMethod: AssetLiquidationReceiptMethod =
    preview && preview.saleTotalAmount > 0 ? receiptMethod : 'NONE';
  const selectedBankAccount = useMemo(
    () => activeBankAccounts.find((bank) => bank.id === bankAccountId) || null,
    [activeBankAccounts, bankAccountId],
  );
  const receiptAccountPreview =
    resolvedReceiptMethod === 'RECEIVABLE'
      ? '131'
      : resolvedReceiptMethod === 'BANK'
        ? selectedBankAccount?.linkedAccountCode || '1121xxx'
        : resolvedReceiptMethod === 'CASH'
          ? '1111'
          : '---';
  const confirmDisabled =
    !asset ||
    !preview ||
    !preview.isValidDate ||
    preview.ccdcHandling === 'STOCK_153' ||
    (resolvedReceiptMethod === 'BANK' && !bankAccountId);

  if (!asset || !preview) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-sm z-[120] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-100 max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 bg-rose-50/80 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-rose-700 text-sm font-bold">
              <Gavel className="w-5 h-5" />
              Thanh lý {asset.type}
            </div>
            <p className="text-sm text-slate-600 mt-1">
              {asset.code} · <span className="font-semibold text-slate-800">{asset.name}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-white/70">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-slate-500 mb-1">Ngày thanh lý</label>
              <input
                type="date"
                value={liquidationDate}
                onChange={(e) => setLiquidationDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-slate-500 mb-1">Giá bán chưa VAT (nếu có)</label>
              <input
                type="number"
                min={0}
                value={saleAmount}
                onChange={(e) => setSaleAmount(Number(e.target.value || 0))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-slate-500 mb-1">VAT đầu ra</label>
              <div className="flex rounded-xl bg-slate-100 p-1 gap-1">
                {[0, 5, 8, 10].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setSaleVatRate(rate)}
                    className={`flex-1 rounded-lg px-2 py-2 text-xs font-bold ${saleVatRate === rate ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-500'}`}
                  >
                    {rate}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {preview.saleTotalAmount > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
              <div>
                <label className="block text-[10px] font-semibold tracking-wider text-emerald-700 mb-1">Hình thức thu</label>
                <select
                  value={receiptMethod}
                  onChange={(e) => setReceiptMethod(e.target.value as AssetLiquidationReceiptMethod)}
                  className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm font-semibold text-emerald-800"
                >
                  <option value="CASH">Tiền mặt (1111)</option>
                  <option value="BANK">Chuyển khoản</option>
                  <option value="RECEIVABLE">Ghi nhận phải thu 131</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold tracking-wider text-emerald-700 mb-1">Đối tượng mua / thu tiền</label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Ví dụ: Công ty ABC"
                  className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold tracking-wider text-emerald-700 mb-1">Tài khoản nhận</label>
                {receiptMethod === 'BANK' ? (
                  <select
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700"
                  >
                    <option value="">-- Chọn tài khoản ngân hàng --</option>
                    {activeBankAccounts.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.bankName} - {bank.accountNumber}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700">
                    {receiptAccountPreview}
                  </div>
                )}
              </div>
              <div className="lg:col-span-3 text-[11px] text-emerald-800">
                Dự kiến thu: <b>{formatCurrency(preview.saleTotalAmount)}</b> = chưa VAT <b>{formatCurrency(preview.saleAmount)}</b>
                {preview.saleVatAmount > 0 ? <> + VAT <b>{formatCurrency(preview.saleVatAmount)}</b></> : null}
              </div>
            </div>
          )}

          {!preview.isValidDate && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <b>Không thể thanh lý:</b> {preview.invalidReason}
            </div>
          )}

          {preview.ccdcHandling === 'STOCK_153' && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              CCDC này vẫn đang ở <b>TK 153</b> (chờ đưa vào sử dụng). Luồng thanh lý sớm hiện chỉ áp dụng cho TSCĐ hoặc CCDC đã vào sử dụng/phân bổ.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <div className="text-xs font-bold text-slate-700">Bước 1. Tính giá trị đến ngày thanh lý</div>
              {asset.type === 'TSCĐ' ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">KH đã ghi sổ đến hiện tại</span>
                    <span className="font-semibold text-slate-800">{formatCurrency(preview.currentAccumulated)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Khấu hao bổ sung đến ngày thanh lý</span>
                    <span className="font-semibold text-amber-700">{formatCurrency(preview.additionalDepreciation)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Hao mòn lũy kế tại ngày thanh lý</span>
                    <span className="font-semibold text-slate-900">{formatCurrency(preview.accumulatedAtLiquidation)}</span>
                  </div>
                  <div className="flex justify-between text-base border-t border-slate-200 pt-3">
                    <span className="font-semibold text-slate-700">Giá trị còn lại ghi Nợ 811</span>
                    <span className="font-bold text-rose-700">{formatCurrency(preview.remainingValue)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Phân bổ lũy kế hiện tại</span>
                    <span className="font-semibold text-slate-900">{formatCurrency(preview.currentAccumulated)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Phân loại xử lý</span>
                    <span className="font-semibold text-slate-800">
                      {preview.ccdcHandling === 'ONE_TIME' ? 'Phân bổ 1 lần (GTCL = 0)' : 'Phân bổ nhiều lần'}
                    </span>
                  </div>
                  <div className="flex justify-between text-base border-t border-slate-200 pt-3">
                    <span className="font-semibold text-slate-700">
                      {preview.ccdcHandling === 'ONE_TIME' ? 'Giá trị còn lại cần kết chuyển' : `Kết chuyển vào Nợ ${preview.expenseAccountCode}`}
                    </span>
                    <span className="font-bold text-rose-700">{formatCurrency(preview.ccdcWriteoffAmount)}</span>
                  </div>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="text-xs font-bold text-slate-700">Bước 2. Bút toán tự động sẽ sinh</div>
              {asset.type === 'TSCĐ' && preview.additionalDepreciation > 0 && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Bổ sung KH tháng cuối: <b>Nợ {preview.expenseAccountCode}</b> / <b>Có {preview.depreciationAccountCode}</b> = {formatCurrency(preview.additionalDepreciation)}
                </div>
              )}
              {asset.type === 'TSCĐ' ? (
                <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-900 space-y-1">
                  {preview.remainingValue > 0 && <div>Nợ <b>811</b>: {formatCurrency(preview.remainingValue)}</div>}
                  <div>Nợ <b>{preview.depreciationAccountCode}</b>: {formatCurrency(preview.accumulatedAtLiquidation)}</div>
                  <div>Có <b>{preview.assetAccountCode}</b>: {formatCurrency(asset.cost)}</div>
                </div>
              ) : preview.ccdcHandling === 'MULTI' ? (
                <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-900 space-y-1">
                  <div>Nợ <b>{preview.expenseAccountCode}</b>: {formatCurrency(preview.ccdcWriteoffAmount)}</div>
                  <div>Có <b>{preview.depreciationAccountCode}</b>: {formatCurrency(preview.ccdcWriteoffAmount)}</div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  Không cần bút toán kết chuyển giá trị còn lại vì CCDC đã được phân bổ hết.
                </div>
              )}
              {preview.saleTotalAmount > 0 && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 space-y-1">
                  <div>Nợ <b>{receiptAccountPreview}</b>: {formatCurrency(preview.saleTotalAmount)}</div>
                  <div>Có <b>711</b>: {formatCurrency(preview.saleAmount)}</div>
                  {preview.saleVatAmount > 0 && <div>Có <b>33311</b>: {formatCurrency(preview.saleVatAmount)}</div>}
                </div>
              )}
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-900">
                Sau khi xác nhận, tài sản sẽ chuyển sang trạng thái <b>Đã thanh lý</b> và không còn xuất hiện trong danh sách trích khấu hao/phân bổ các kỳ sau.
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 rounded-xl hover:bg-slate-200/70">
            Hủy
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={() =>
              onConfirm(asset.id, {
                liquidationDate,
                saleAmount,
                saleVatRate,
                receiptMethod: resolvedReceiptMethod,
                bankAccountId: resolvedReceiptMethod === 'BANK' ? bankAccountId : undefined,
                contactName,
              })
            }
            className="px-5 py-2.5 text-sm font-bold text-white bg-rose-600 rounded-xl hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Xác nhận thanh lý
          </button>
        </div>
      </div>
    </div>
  );
};

const ViewAssetModal = ({ asset, onClose }: { asset: Asset | null, onClose: () => void }) => {
   if (!asset) return null;
   const phone = (asset.supplierPhone || '').trim();
   const address = (asset.supplierAddress || '').trim();
   const departmentTimeline = buildAssetDepartmentTimeline(asset);
   const formatTimelineDate = (iso: string) => {
      if (iso === 'Hiện tại') return iso;
      const d = parseLocalDateOnly(iso);
      return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('vi-VN');
   };
   return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6 z-[100] animate-fade-in">
         <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="view-asset-title"
            className="bg-white rounded-xl shadow-xl border border-slate-200/80 w-full max-w-[720px] overflow-hidden flex flex-col max-h-[90vh]"
         >
            <div className="shrink-0 px-6 py-4 border-b border-slate-200 bg-slate-50/90 flex justify-between items-start gap-3">
               <div className="flex items-start gap-3 min-w-0">
                  <Archive className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                     <h3 id="view-asset-title" className="text-lg font-semibold text-slate-800 tracking-tight">
                        Hồ sơ tài sản
                     </h3>
                     <p className="text-sm text-slate-500 font-mono truncate mt-0.5">{asset.code}</p>
                  </div>
               </div>
               <button
                  type="button"
                  onClick={onClose}
                  className="text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 w-8 h-8 flex items-center justify-center rounded-md transition-colors shrink-0"
                  aria-label="Đóng"
               >
                  <X className="w-5 h-5" />
               </button>
            </div>
            <div className="px-6 py-6 space-y-5 overflow-y-auto text-slate-800">
               <div className="pb-4 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-4 mb-3">
                     <h4 className="text-xl font-bold text-slate-900 leading-snug flex-1 min-w-0">{asset.name}</h4>
                     <div className="shrink-0 text-right">
                        <p className="text-sm font-medium text-[#666666]">Ngày SD</p>
                        <p className="text-base font-semibold tabular-nums text-slate-800 mt-0.5">
                           {new Date(asset.useDate).toLocaleDateString('vi-VN')}
                        </p>
                     </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                     <span className="bg-slate-100 text-slate-700 text-sm font-bold px-2.5 py-0.5 rounded-md border border-slate-200/80">
                        {asset.type}
                     </span>
                     <span className="bg-white text-slate-600 text-sm font-semibold px-2.5 py-0.5 rounded-md border border-slate-200">
                        {asset.department}
                     </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-sm text-[#666666]">
                     {asset.ccdcLifecycle === 'STOCK_153' && (
                        <span className="font-semibold text-orange-700">CCDC — TK 153 (chờ SD)</span>
                     )}
                     {asset.expenseAccount && <span className="font-mono">KH/PB: {asset.expenseAccount}</span>}
                     {asset.type === 'TSCĐ' && Number(asset.salvageValue) > 0 && (
                        <span>Thu hồi CK: {formatCurrency(Number(asset.salvageValue))}</span>
                     )}
                  </div>
               </div>

               <div className="rounded-xl border border-violet-200/70 bg-violet-50/50 p-4">
                  <h5 className="text-sm mb-4 flex font-semibold text-violet-800 items-center gap-2">
                     <Truck className="w-4 h-4 shrink-0 opacity-80" />
                     Nhà cung cấp
                  </h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                     <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-2">
                           <div className="min-w-0 rounded-lg border border-white/80 bg-white/90 px-3 min-h-[44px] py-2 flex flex-col justify-center shadow-sm">
                              <span className="block text-[13px] leading-tight text-[#666666]">Mẫu số</span>
                              <span className="text-[15px] font-semibold tabular-nums text-slate-800 truncate">{asset.purchaseFormNo || '—'}</span>
                           </div>
                           <div className="min-w-0 rounded-lg border border-white/80 bg-white/90 px-3 min-h-[44px] py-2 flex flex-col justify-center shadow-sm">
                              <span className="block text-[13px] leading-tight text-[#666666]">Ký hiệu</span>
                              <span className="text-[15px] font-semibold font-mono text-slate-800 truncate">{asset.purchaseSymbolCode || '—'}</span>
                           </div>
                           <div className="min-w-0 rounded-lg border border-white/80 bg-white/90 px-3 min-h-[44px] py-2 flex flex-col justify-center shadow-sm">
                              <span className="block text-[13px] leading-tight text-[#666666]">Số HĐ</span>
                              <span className="text-[15px] font-semibold tabular-nums text-slate-800 truncate">{asset.purchaseInvoiceNumber || '—'}</span>
                           </div>
                        </div>
                        <dl className="space-y-3">
                           <div>
                              <dt className="text-[13px] font-medium text-[#666666]">Tên đơn vị</dt>
                              <dd className="text-[15px] font-medium text-slate-800 leading-snug mt-0.5">{asset.supplierName || '—'}</dd>
                           </div>
                           <div>
                              <dt className="text-[13px] font-medium text-[#666666]">Địa chỉ</dt>
                              <dd className="text-[15px] text-slate-700 leading-snug mt-0.5">{address || '—'}</dd>
                           </div>
                        </dl>
                     </div>
                     <div className="space-y-4">
                        <dl className="space-y-4">
                           <div>
                              <dt className="text-[13px] font-medium text-[#666666]">Mã số thuế</dt>
                              <dd className="text-[15px] font-mono text-slate-800 mt-0.5">{asset.supplierTaxCode || '—'}</dd>
                           </div>
                           <div>
                              <dt className="text-[13px] font-medium text-[#666666]">Điện thoại</dt>
                              <dd className={`text-[15px] mt-0.5 ${phone ? 'font-medium text-blue-700' : 'text-slate-400'}`}>{phone || '—'}</dd>
                           </div>
                        </dl>
                     </div>
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3">
                     <p className="text-sm font-medium text-[#666666]">Nguyên giá</p>
                     <p className="text-xl font-bold tabular-nums text-slate-900 leading-tight mt-1">{formatCurrency(asset.cost)}</p>
                  </div>
                  <div className="rounded-lg border border-amber-200/90 bg-amber-50/90 px-4 py-3">
                     <p className="text-sm font-medium text-amber-800">
                        {asset.type === 'CCDC' ? 'PB lũy kế' : 'HM lũy kế'}
                     </p>
                     <p className="text-xl font-bold tabular-nums text-amber-900 leading-tight mt-1">
                        {formatCurrency(
                           asset.type === 'CCDC'
                              ? Number(asset.accumulatedAllocation || 0)
                              : Number(asset.accumulatedDepreciation || 0)
                        )}
                     </p>
                  </div>
               </div>
               <div className="rounded-lg border border-slate-200 border-l-4 border-l-blue-600 bg-slate-50 px-4 py-3 flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-[#666666]">Giá trị còn lại</span>
                  <span className="text-xl font-bold tabular-nums text-slate-900 shrink-0">{formatCurrency(asset.residualValue)}</span>
               </div>

               <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/40 p-4">
                  <h5 className="text-sm mb-3 flex font-semibold text-indigo-800 items-center gap-2">
                     <History className="w-4 h-4 shrink-0" />
                     Lịch sử điều chuyển
                  </h5>
                  {asset.responsiblePersonName && (
                     <p className="text-sm text-slate-600 mb-3">
                        Người phụ trách hiện tại: <b className="text-slate-800">{asset.responsiblePersonName}</b>
                     </p>
                  )}
                  <div className="overflow-x-auto rounded-lg border border-indigo-100 bg-white">
                     <table className="w-full text-sm">
                        <thead className="bg-indigo-50/80 text-[#666666] text-xs">
                           <tr>
                              <th className="p-2.5 text-left font-medium">Từ ngày</th>
                              <th className="p-2.5 text-left font-medium">Đến ngày</th>
                              <th className="p-2.5 text-left font-medium">Bộ phận</th>
                              <th className="p-2.5 text-left font-medium">Người dùng</th>
                              <th className="p-2.5 text-left font-medium">Ghi chú</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                           {departmentTimeline.map((row, idx) => (
                              <tr key={`${row.fromDate}-${row.department}-${idx}`} className="hover:bg-slate-50/80">
                                 <td className="p-2.5 tabular-nums text-slate-700">{formatTimelineDate(row.fromDate)}</td>
                                 <td className="p-2.5 tabular-nums text-slate-700">{formatTimelineDate(row.toDate)}</td>
                                 <td className="p-2.5 font-medium text-slate-800">{row.department}</td>
                                 <td className="p-2.5 text-slate-600">{row.responsiblePerson || '—'}</td>
                                 <td className="p-2.5 text-slate-500 text-xs">
                                    {row.reason || row.slipNumber ? (
                                       <>
                                          {row.slipNumber && <span className="font-mono text-indigo-700">{row.slipNumber}</span>}
                                          {row.reason && <span>{row.slipNumber ? ' · ' : ''}{row.reason}</span>}
                                       </>
                                    ) : '—'}
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </div>

               {asset.status === 'LIQUIDATED' && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 space-y-3">
                     <div className="flex items-center gap-2 text-sm font-semibold text-rose-800">
                        <Gavel className="w-4 h-4" />
                        Thông tin thanh lý
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <div className="text-[13px] text-[#666666]">Ngày thanh lý</div>
                           <div className="text-[15px] font-semibold text-rose-900 mt-0.5">{asset.liquidationDate || '—'}</div>
                        </div>
                        <div>
                           <div className="text-[13px] text-[#666666]">TK nhận tiền / công nợ</div>
                           <div className="text-[15px] font-semibold text-rose-900 mt-0.5">{asset.liquidationReceiptAccount || '—'}</div>
                        </div>
                        <div>
                           <div className="text-[13px] text-[#666666]">Chi phí kết chuyển</div>
                           <div className="text-[15px] font-semibold text-rose-900 mt-0.5">{formatCurrency(Number(asset.liquidationWriteoffAmount || 0))}</div>
                        </div>
                        <div>
                           <div className="text-[13px] text-[#666666]">Thu về</div>
                           <div className="text-[15px] font-semibold text-rose-900 mt-0.5">{formatCurrency(Number(asset.liquidationTotalAmount || 0))}</div>
                        </div>
                     </div>
                     {Number(asset.liquidationAdditionalDepreciation || 0) > 0 && (
                        <div className="text-[15px] text-rose-900">
                           Khấu hao bổ sung đến ngày thanh lý: <b>{formatCurrency(Number(asset.liquidationAdditionalDepreciation || 0))}</b>
                        </div>
                     )}
                  </div>
               )}
            </div>
            <div className="shrink-0 px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex justify-end">
               <button
                  type="button"
                  onClick={onClose}
                  className="h-10 px-6 bg-slate-800 text-white text-sm font-bold rounded-lg hover:bg-slate-900 transition-colors"
               >
                  Đóng
               </button>
            </div>
         </div>
      </div>
   );
};
