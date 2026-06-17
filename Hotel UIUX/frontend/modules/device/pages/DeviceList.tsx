
import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Search, Plus, Upload, Download, RefreshCw, Calendar, X, Clock, ShieldCheck, ChevronDown, Filter } from 'lucide-react';
import { Device, DeviceStatus } from '@shared/types';
import { DeviceTable } from '../components/DeviceTable';
import { useApp } from '../../../app/store';
import { Pagination } from '@shared/components/Pagination';
import { downloadDeviceImportTemplate, parseDeviceImportFile } from '../utils/deviceImport';

interface DeviceListProps {
  devices: Device[];
  onAdd: () => void;
  onRenew: (device: Device) => void;
  onHistory: (device: Device) => void;
  onView: (device: Device) => void;
  onEdit: (device: Device) => void;
  onDelete: (device: Device) => void;
}

type TimeFilterType = 'ALL' | 'TODAY' | 'MONTH' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'YEAR' | 'CUSTOM';
type DateCriteria = 'EXPIRY' | 'ACTIVATION';
type StandardPageSize = 10 | 20 | 50 | 100;

const TIME_FILTER_OPTIONS: { id: TimeFilterType; label: string }[] = [
  { id: 'ALL', label: 'Tất cả' },
  { id: 'TODAY', label: 'Hôm nay' },
  { id: 'MONTH', label: 'Tháng này' },
  { id: 'Q1', label: 'Quý 1' },
  { id: 'Q2', label: 'Quý 2' },
  { id: 'Q3', label: 'Quý 3' },
  { id: 'Q4', label: 'Quý 4' },
  { id: 'YEAR', label: 'Cả năm' },
  { id: 'CUSTOM', label: 'Khoảng tùy chọn' },
];

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

export const DeviceList: React.FC<DeviceListProps> = ({ devices, onAdd, onRenew, onHistory, onView, onEdit, onDelete }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { handleBulkAddDevices } = useApp();
  const [importing, setImporting] = useState(false);
  
  // States cho tìm kiếm và lọc
  const [searchTerm, setSearchTerm] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilterType>('ALL');
  const [dateCriteria, setDateCriteria] = useState<DateCriteria>('EXPIRY');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const timeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!timeMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (timeMenuRef.current && !timeMenuRef.current.contains(e.target as Node)) setTimeMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTimeMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [timeMenuOpen]);

  // --- PAGINATION (remember per filter signature) ---
  const baseStorageKey = 'device_list_pagination';
  const filterSignature = useMemo(() => {
    return JSON.stringify({
      q: (searchTerm || '').trim().toLowerCase(),
      timeFilter,
      dateCriteria,
      from: customRange.from || '',
      to: customRange.to || '',
    });
  }, [customRange.from, customRange.to, dateCriteria, searchTerm, timeFilter]);
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

  // --- LOGIC LỌC DỮ LIỆU (with perf log) ---
  const filteredDevices = useMemo(() => {
    const t0 = performance.now();
    const rows = devices.filter(dev => {
      // 1. Lọc theo từ khóa (IMEI, Biển số, Tên khách)
      const matchesSearch = 
        dev.imei.toLowerCase().includes(searchTerm.toLowerCase()) ||
        dev.licensePlate.toLowerCase().includes(searchTerm.toLowerCase()) ||
        dev.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        dev.username.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      // 2. Lọc theo thời gian
      if (timeFilter === 'ALL') return true;

      const targetDateStr = dateCriteria === 'EXPIRY' ? dev.expiryDate : dev.activationDate;
      if (!targetDateStr) return false;

      const targetDate = new Date(targetDateStr);
      const now = new Date();
      const currentYear = now.getFullYear();
      now.setHours(0, 0, 0, 0);

      switch (timeFilter) {
        case 'TODAY':
          const todayStr = now.toISOString().split('T')[0];
          return targetDateStr === todayStr;
        case 'MONTH':
          return targetDate.getMonth() === now.getMonth() && targetDate.getFullYear() === now.getFullYear();
        case 'Q1':
          return targetDate.getMonth() >= 0 && targetDate.getMonth() <= 2 && targetDate.getFullYear() === currentYear;
        case 'Q2':
          return targetDate.getMonth() >= 3 && targetDate.getMonth() <= 5 && targetDate.getFullYear() === currentYear;
        case 'Q3':
          return targetDate.getMonth() >= 6 && targetDate.getMonth() <= 8 && targetDate.getFullYear() === currentYear;
        case 'Q4':
          return targetDate.getMonth() >= 9 && targetDate.getMonth() <= 11 && targetDate.getFullYear() === currentYear;
        case 'YEAR':
          return targetDate.getFullYear() === now.getFullYear();
        case 'CUSTOM':
          if (!customRange.from && !customRange.to) return true;
          const from = customRange.from ? new Date(customRange.from) : new Date(0);
          const to = customRange.to ? new Date(customRange.to) : new Date(8640000000000000);
          to.setHours(23, 59, 59, 999);
          return targetDate >= from && targetDate <= to;
        default:
          return true;
      }
    });
    const ms = performance.now() - t0;
    logSlowQuery('DeviceList.filter(devices)', ms, { rows: rows.length });
    return rows;
  }, [devices, searchTerm, timeFilter, dateCriteria, customRange]);

  const totalItems = filteredDevices.length;
  const safePageSize = clampPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, totalPages]);

  const pagedDevices = useMemo(() => {
    // Hard rule: never render > 100 rows
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return filteredDevices.slice(from, to);
  }, [filteredDevices, safePage, safePageSize]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const { devices: importedDevices, skippedRows } = await parseDeviceImportFile(file);

      if (importedDevices.length > 0) {
        handleBulkAddDevices(importedDevices);
        const skippedLabel = skippedRows.length > 0 ? `\nBỏ qua ${skippedRows.length} dòng trống hoặc không hợp lệ.` : '';
        alert(`Thành công! Đã nhập ${importedDevices.length} thiết bị.${skippedLabel}`);
      } else {
        alert('Không tìm thấy dữ liệu hợp lệ trong file. Vui lòng dùng đúng mẫu Excel thiết bị.');
      }
    } catch (err) {
      alert('Lỗi khi đọc file. Vui lòng dùng file .xlsx, .xls hoặc .csv theo đúng mẫu import.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Search and Main Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b flex flex-wrap justify-between items-center bg-slate-50 gap-4">
          <div className="flex items-center gap-4">
             <h3 className="font-semibold text-slate-700 whitespace-nowrap">Quản lý thiết bị</h3>
             <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input 
                  placeholder="IMEI, Biển số, Khách hàng..." 
                  className="pl-9 p-2 border rounded-lg text-sm w-80 focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-white" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
             </div>
          </div>

          <div className="flex gap-2">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx,.xls,.csv" />
            <button onClick={onAdd} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 shadow-md transition-all active:scale-95">
              <Plus className="w-4 h-4" /> Thêm mới
            </button>
          </div>
        </div>

        <div className="p-4 border-b bg-white">
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-slate-50 via-white to-blue-50 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { void downloadDeviceImportTemplate(); }}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <Download className="w-4 h-4 text-blue-600" /> Tải mẫu Excel
                </button>
                <button
                  type="button"
                  onClick={handleImportClick}
                  disabled={importing}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold shadow-sm ${
                    importing
                      ? 'bg-slate-100 border-slate-200 text-slate-400'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {importing ? 'Đang nhập file...' : 'Nhập Excel'}
                </button>
            </div>
          </div>
        </div>

        {/* --- DÒNG BỘ LỌC THỜI GIAN NÂNG CAO --- */}
        <div className="p-3 bg-white border-b flex flex-wrap items-center gap-4">
           <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-200">
              <button 
                onClick={() => setDateCriteria('EXPIRY')}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-medium transition-all ${dateCriteria === 'EXPIRY' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <Clock className="w-3 h-3" /> Theo ngày hết hạn
              </button>
              <button 
                onClick={() => setDateCriteria('ACTIVATION')}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-medium transition-all ${dateCriteria === 'ACTIVATION' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <ShieldCheck className="w-3 h-3" /> Theo ngày kích hoạt
              </button>
           </div>

           <div className="h-6 w-px bg-slate-200" />

           <div className="flex items-center gap-2 text-slate-500">
              <Filter className="h-4 w-4 shrink-0" />
              <span className="text-xs font-medium tracking-tight">Lọc thời gian</span>
           </div>

           <div className="relative min-w-[200px]" ref={timeMenuRef}>
              <button
                type="button"
                onClick={() => setTimeMenuOpen((o) => !o)}
                aria-expanded={timeMenuOpen}
                aria-haspopup="listbox"
                className="flex w-full min-w-[200px] max-w-sm items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 shadow-sm outline-none transition-colors hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <span className="truncate">
                  {TIME_FILTER_OPTIONS.find((o) => o.id === timeFilter)?.label ?? 'Tất cả'}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${timeMenuOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {timeMenuOpen ? (
                <ul className="absolute left-0 top-full z-30 mt-1 max-h-64 min-w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg" role="listbox">
                  {TIME_FILTER_OPTIONS.map((opt) => (
                    <li key={opt.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={timeFilter === opt.id}
                        onClick={() => {
                          setTimeFilter(opt.id);
                          setTimeMenuOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                          timeFilter === opt.id ? 'bg-blue-50 font-medium text-blue-800' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
           </div>

           {timeFilter === 'CUSTOM' && (
              <div className="flex items-center gap-2 animate-fade-in">
                 <div className="relative">
                    <Calendar className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input 
                      type="date" 
                      className="rounded-lg border p-1.5 pl-8 text-xs font-medium text-slate-600 outline-none focus:ring-1 focus:ring-blue-400"
                      value={customRange.from}
                      onChange={e => setCustomRange({...customRange, from: e.target.value})}
                    />
                 </div>
                 <span className="font-medium text-slate-300">→</span>
                 <div className="relative">
                    <Calendar className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input 
                      type="date" 
                      className="rounded-lg border p-1.5 pl-8 text-xs font-medium text-slate-600 outline-none focus:ring-1 focus:ring-blue-400"
                      value={customRange.to}
                      onChange={e => setCustomRange({...customRange, to: e.target.value})}
                    />
                 </div>
                 {(customRange.from || customRange.to) && (
                    <button 
                      onClick={() => setCustomRange({ from: '', to: '' })}
                      className="p-1.5 text-slate-400 hover:text-red-500"
                    >
                       <X className="w-4 h-4" />
                    </button>
                 )}
              </div>
           )}
           
           <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Đã lọc:</span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{filteredDevices.length}</span>
           </div>
        </div>
        
        <DeviceTable 
          devices={pagedDevices}
          onRenew={onRenew}
          onHistory={onHistory}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
        />

        <Pagination
          page={safePage}
          totalItems={totalItems}
          pageSize={safePageSize}
          onChangePage={setPage}
          onChangePageSize={(s) => setPageSize(clampPageSize(s))}
        />
        
        <div className="p-3 bg-slate-50 border-t flex justify-between items-center text-xs text-slate-500 px-6">
           <div className="flex items-center gap-2">
              <span>Đang hiển thị: <b>{filteredDevices.length}</b> / {devices.length} thiết bị</span>
           </div>
           <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                 <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                 Hoạt động: <b className="text-slate-700">{filteredDevices.filter(d => d.status === DeviceStatus.ACTIVE).length}</b>
              </span>
              <span className="flex items-center gap-1.5">
                 <div className="w-2 h-2 rounded-full bg-red-500"></div>
                 Hết hạn: <b className="text-slate-700">{filteredDevices.filter(d => d.status === DeviceStatus.EXPIRED).length}</b>
              </span>
           </div>
        </div>
      </div>
    </div>
  );
};
