import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Briefcase,
  Clock3,
  Download,
  Printer,
  FileDown,
  FileText,
  FileSpreadsheet,
  Scale,
  Banknote,
  FileCode,
  BarChart3,
  PieChart,
  TrendingUp,
  Calendar,
  Calculator,
  Activity,
  Table,
  Users,
  Truck,
  ChevronDown,
  Landmark,
  Gauge,
  History,
  X,
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart as RePieChart, Pie, Cell 
} from 'recharts';
import { loadXlsx } from '@shared/utils/lazyXlsx';
import { JournalEntry, Invoice, Device, CompanyInfo, AccountDefinition, FinancialYear, Customer, Supplier, FundTransaction, DeviceRenewalHistoryItem } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { computeB01bTotals } from '@shared/utils/accounting';
import { computeB09FinancialMetrics } from '@shared/utils/b09FinancialMetrics';
import { journalEntryDetailsArray } from '@shared/utils/journalEntryDetails';
import {
  buildApSummaryRowsByInvoice,
  buildArApMovementLines,
  buildArApSummaryRows,
  buildArApSummaryRowsByInvoice,
  resolveArApNavTarget,
  type ArApMovementLine,
  type ArApSubledgerRow,
} from '@shared/utils/arApSubledger';
import { triggerArApReportNavigation } from '@shared/utils/arApReportNavigate';
import { normalizeLedgerAccountCode } from '@shared/utils/ledgerAccountCode';
import { useApp } from '../../../app/store';
import { exportRenewalReportPdf } from '../utils/renewalReportPdfExport';
import { exportFinancialReport } from '../utils/financialReportExport';
import type { FinancialExportReportType } from '../utils/financialReportData';
import { Pagination } from '@shared/components/Pagination';

const FINANCIAL_EXPORT_REPORT_IDS: FinancialExportReportType[] = [
  'BALANCE_SHEET',
  'INCOME_STATEMENT',
  'TRIAL_BALANCE',
  'NOTES',
];

function isFinancialExportReport(id: ReportType): id is FinancialExportReportType {
  return FINANCIAL_EXPORT_REPORT_IDS.includes(id as FinancialExportReportType);
}

type CashFlowReportMeta = {
  openingCash60: number;
  closingCash70: number;
  expectedOpeningCash60: number;
  isOpeningCrossCheckMismatch: boolean;
  isClosingCashNegative: boolean;
  requiresZeroOpeningConfirmation: boolean;
  systemNote?: string;
};

type ReportType = 
  | 'INCOME_STATEMENT' 
  | 'BALANCE_SHEET'    
  | 'CASH_FLOW'        
  | 'TRIAL_BALANCE'
  | 'NOTES'            
  | 'MGMT_REVENUE'     
  | 'MGMT_PROFIT'      
  | 'MGMT_PERFORMANCE'
  | 'MGMT_AR'
  | 'MGMT_AP'
  | 'MGMT_RENEWALS';

type RenewalPeriodMode = 'MONTH' | 'QUARTER' | 'YEAR';

type RenewalPeriodSelection =
  | { mode: 'YEAR'; year: number }
  | { mode: 'QUARTER'; year: number; quarter: number }
  | { mode: 'MONTH'; year: number; month: number };

type ReportTablePageSize = 10 | 20 | 30 | 40 | 50 | 100;

const REPORT_TABLE_PAGE_SIZE_OPTIONS: ReportTablePageSize[] = [10, 20, 30, 40, 50, 100];

function clampReportTablePageSize(value: number): ReportTablePageSize {
  if (REPORT_TABLE_PAGE_SIZE_OPTIONS.includes(value as ReportTablePageSize)) {
    return value as ReportTablePageSize;
  }
  return 10;
}

function useReportTablePagination<T>(items: T[], resetKey: string) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ReportTablePageSize>(10);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const safePageSize = clampReportTablePageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * safePageSize;
    return items.slice(start, start + safePageSize);
  }, [items, safePage, safePageSize]);

  const rowOffset = (safePage - 1) * safePageSize;

  return {
    page: safePage,
    pageSize: safePageSize,
    setPage,
    setPageSize: (size: number) => {
      setPageSize(clampReportTablePageSize(size));
      setPage(1);
    },
    pagedItems,
    rowOffset,
    totalItems: items.length,
  };
}

type RenewalReportRow = DeviceRenewalHistoryItem & {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  customerName: string;
  customerPhone: string;
  imei: string;
  serial: string;
  licensePlate: string;
  renewedDay: number;
  renewedMonth: number;
  renewedYear: number;
  renewedQuarter: number;
  renewedAtTime: number;
};

/** Dữ liệu từ store/API đôi khi không phải mảng — `.filter` sẽ làm crash cả ứng dụng (root trắng). */
const asArray = <T,>(v: readonly T[] | T[] | undefined | null | unknown): T[] =>
  Array.isArray(v) ? (v as T[]) : [];

type ReportMenuLeaf = {
  id: ReportType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const FINANCIAL_REPORT_ITEMS: ReportMenuLeaf[] = [
  { id: 'BALANCE_SHEET', label: 'B01b-DNN: Tình hình tài chính', icon: Scale },
  { id: 'INCOME_STATEMENT', label: 'B02-DNN: Kết quả HĐ SXKD', icon: TrendingUp },
  { id: 'CASH_FLOW', label: 'B03-DNN: Lưu chuyển tiền tệ', icon: Banknote },
  { id: 'TRIAL_BALANCE', label: 'Bảng cân đối tài khoản', icon: Table },
  { id: 'NOTES', label: 'B09-DNN: Thuyết minh BCTC', icon: FileText },
];

const MANAGEMENT_REPORT_ITEMS: ReportMenuLeaf[] = [
  { id: 'MGMT_REVENUE', label: 'Doanh thu theo Thiết bị', icon: BarChart3 },
  { id: 'MGMT_RENEWALS', label: 'Báo cáo gia hạn', icon: History },
  { id: 'MGMT_AR', label: 'Nợ phải thu theo Khách hàng', icon: Users },
  { id: 'MGMT_AP', label: 'Nợ phải trả theo Nhà cung cấp', icon: Truck },
  { id: 'MGMT_PROFIT', label: 'Lợi nhuận Hợp đồng', icon: Briefcase },
  { id: 'MGMT_PERFORMANCE', label: 'Hiệu suất Thiết bị', icon: PieChart },
];

function reportLabelById(id: ReportType): string {
  const a = [...FINANCIAL_REPORT_ITEMS, ...MANAGEMENT_REPORT_ITEMS].find((x) => x.id === id);
  return a?.label ?? id;
}

class ReportContentErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 m-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-sm">
          <p className="font-bold text-base mb-2">Không thể hiển thị báo cáo</p>
          <p className="mb-2 opacity-90">
            Đã xảy ra lỗi khi vẽ báo cáo. Mở tab Console (F12) để xem chi tiết, hoặc tải lại trang.
          </p>
          <pre className="text-xs whitespace-pre-wrap bg-white/80 p-3 rounded border border-rose-100 overflow-auto max-h-48 font-mono">
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export const Report133 = () => {
  const {
    journalEntries,
    invoices,
    devices,
    financialYear,
    companyInfo,
    cashFlowOpening,
    accounts,
    customers,
    suppliers,
    fundTransactions,
  } = useApp();

  const safeEntries = asArray<JournalEntry>(journalEntries);
  const safeInvoices = asArray<Invoice>(invoices);
  const safeCustomers = asArray<Customer>(customers);
  const safeSuppliers = asArray<Supplier>(suppliers);
  const safeDevices = asArray<Device>(devices);
  const safeAccounts = asArray<AccountDefinition>(accounts);
  const safeFund = asArray<FundTransaction>(fundTransactions);

  const safeFY = useMemo((): FinancialYear => {
    const s = financialYear?.startDate;
    const e = financialYear?.endDate;
    if (typeof s === 'string' && s.length >= 8 && typeof e === 'string' && e.length >= 8) {
      return { startDate: s, endDate: e };
    }
    const y = new Date().getFullYear();
    return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
  }, [financialYear?.startDate, financialYear?.endDate]);
  
  const [activeReport, setActiveReport] = useState<ReportType>('BALANCE_SHEET');
  const [navDropdown, setNavDropdown] = useState<null | 'fin' | 'mgmt'>(null);
  const [finExportMenuOpen, setFinExportMenuOpen] = useState(false);
  const [showB01bDetailModal, setShowB01bDetailModal] = useState(false);
  const reportNavRef = useRef<HTMLDivElement>(null);
  const finExportMenuRef = useRef<HTMLDivElement>(null);

  const selectReport = useCallback((id: ReportType) => {
    setActiveReport(id);
    setNavDropdown(null);
  }, []);

  useEffect(() => {
    if (!navDropdown) return;
    const onDoc = (e: MouseEvent) => {
      const el = reportNavRef.current;
      if (el && !el.contains(e.target as Node)) setNavDropdown(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [navDropdown]);

  useEffect(() => {
    setFinExportMenuOpen(false);
  }, [activeReport]);

  useEffect(() => {
    if (!finExportMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = finExportMenuRef.current;
      if (el && !el.contains(e.target as Node)) setFinExportMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [finExportMenuOpen]);

  const mgmtHasData = useMemo(
    () => ({
      MGMT_REVENUE: safeInvoices.length > 0,
      MGMT_RENEWALS: safeDevices.some((device) => Array.isArray(device.renewalHistory) && device.renewalHistory.length > 0),
      MGMT_AR: safeInvoices.length > 0 || safeCustomers.length > 0,
      MGMT_AP: safeInvoices.length > 0 || safeSuppliers.length > 0,
      MGMT_PROFIT: safeInvoices.length > 0,
      MGMT_PERFORMANCE: safeDevices.length > 0,
    }),
    [safeInvoices.length, safeCustomers.length, safeSuppliers.length, safeDevices],
  );

  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const s = financialYear?.startDate;
    if (typeof s === 'string' && /^\d{4}/.test(s)) return Number(s.slice(0, 4));
    return new Date().getFullYear();
  });

  useEffect(() => {
    const s = safeFY.startDate;
    if (typeof s === 'string' && /^\d{4}/.test(s)) setSelectedYear(Number(s.slice(0, 4)));
  }, [safeFY.startDate]);

  const b01bCheck = useMemo(() => {
    try {
      return computeB01bTotals(safeEntries, safeFY.endDate);
    } catch (e) {
      console.error('[Report133] computeB01bTotals', e);
      return {
        assets100: 0,
        assets300: 0,
        sources600: 0,
        diff: 0,
        isBalanced: true,
      };
    }
  }, [safeEntries, safeFY.endDate]);

  const cashFlowMeta = useMemo(() => {
    try {
      return getCashFlowReportMeta(safeEntries, safeFY, cashFlowOpening);
    } catch (e) {
      console.error('[Report133] getCashFlowReportMeta', e);
      return {
        openingCash60: 0,
        closingCash70: 0,
        expectedOpeningCash60: 0,
        isOpeningCrossCheckMismatch: false,
        isClosingCashNegative: false,
        requiresZeroOpeningConfirmation: false,
      };
    }
  }, [safeEntries, safeFY, cashFlowOpening]);

  const blockFinancialOutputs = !b01bCheck.isBalanced;

  const ensureCanIssueCashFlowReport = (actionLabel: 'in' | 'xuất') => {
    if (activeReport !== 'CASH_FLOW') return true;
    if (cashFlowMeta.isClosingCashNegative) {
      window.alert('Tiền cuối kỳ không được phép âm. Vui lòng kiểm tra lại số dư đầu kỳ hoặc các bút toán chi tiền.');
      return false;
    }
    if (cashFlowMeta.requiresZeroOpeningConfirmation) {
      return window.confirm('Bạn xác nhận doanh nghiệp bắt đầu kỳ này với 0 đồng tiền mặt/tiền gửi?');
    }
    return true;
  };

  const handlePrint = () => {
    if (blockFinancialOutputs) return;
    if (!ensureCanIssueCashFlowReport('in')) return;
    window.print();
  };

  const canExportFinancialReport = isFinancialExportReport(activeReport);

  const runFinancialExport = useCallback(
    async (format: 'excel' | 'pdf' | 'xml') => {
      if (!isFinancialExportReport(activeReport)) return;
      if (blockFinancialOutputs) return;
      try {
        await exportFinancialReport(format, {
          reportType: activeReport,
          entries: safeEntries,
          financialYear: safeFY,
          year: selectedYear,
          companyInfo,
          accounts: safeAccounts,
        });
      } catch (error) {
        console.error('[Report133] export', error);
        window.alert(error instanceof Error ? error.message : 'Không thể xuất báo cáo.');
      }
    },
    [activeReport, blockFinancialOutputs, companyInfo, safeAccounts, safeEntries, safeFY, selectedYear],
  );

  const printButtonTitle = blockFinancialOutputs
    ? 'Không thể in khi B01b lệch (Tổng tài sản ≠ Tổng nguồn vốn).'
    : (activeReport === 'CASH_FLOW' && cashFlowMeta.isClosingCashNegative)
      ? 'Tiền cuối kỳ không được phép âm. Vui lòng kiểm tra lại số dư đầu kỳ hoặc các bút toán chi tiền.'
      : (activeReport === 'CASH_FLOW' && cashFlowMeta.requiresZeroOpeningConfirmation)
        ? 'Hệ thống sẽ yêu cầu xác nhận vì Mã số 60 đang bằng 0.'
        : 'In ấn';

  const exportButtonTitle = blockFinancialOutputs
    ? 'Không thể xuất file khi B01b lệch (Tổng tài sản ≠ Tổng nguồn vốn).'
    : canExportFinancialReport
      ? 'Xuất Excel, PDF hoặc XML HTKK'
      : 'Chọn báo cáo B01b, B02, F01 hoặc B09 để xuất';

  const renderContent = () => {
    switch (activeReport) {
      case 'INCOME_STATEMENT': return <IncomeStatement entries={safeEntries} year={selectedYear} companyInfo={companyInfo} />;
      case 'BALANCE_SHEET': return <BalanceSheet entries={safeEntries} financialYear={safeFY} companyInfo={companyInfo} />;
      case 'CASH_FLOW': return <CashFlow entries={safeEntries} year={selectedYear} financialYear={safeFY} companyInfo={companyInfo} cashFlowOpening={cashFlowOpening} reportMeta={cashFlowMeta} />;
      case 'TRIAL_BALANCE': return <TrialBalance entries={safeEntries} year={selectedYear} financialYear={safeFY} companyInfo={companyInfo} accounts={safeAccounts} />;
      case 'NOTES': return (
        <FinancialNotes
          year={selectedYear}
          journalEntries={safeEntries}
          financialYear={safeFY}
          companyInfo={companyInfo}
          cashFlowMeta={cashFlowMeta}
          invoices={safeInvoices}
          customers={safeCustomers}
          suppliers={safeSuppliers}
        />
      );
      case 'MGMT_REVENUE': return <RevenueByDeviceReport invoices={safeInvoices} />;
      case 'MGMT_RENEWALS': return <RenewalReport devices={safeDevices} defaultYear={selectedYear} companyInfo={companyInfo} />;
      case 'MGMT_AR':
        return (
          <ReceivablesByCustomerReport
            entries={safeEntries}
            financialYear={safeFY}
            invoices={safeInvoices}
            customers={safeCustomers}
            suppliers={safeSuppliers}
            fundTransactions={safeFund}
            companyInfo={companyInfo}
          />
        );
      case 'MGMT_AP':
        return (
          <PayablesBySupplierReport
            entries={safeEntries}
            financialYear={safeFY}
            invoices={safeInvoices}
            suppliers={safeSuppliers}
            customers={safeCustomers}
            fundTransactions={safeFund}
            companyInfo={companyInfo}
          />
        );
      case 'MGMT_PROFIT': return <ProfitByContractReport invoices={safeInvoices} />;
      case 'MGMT_PERFORMANCE': return <DevicePerformanceReport devices={safeDevices} />;
      default: return null;
    }
  };

  /** B01b: cao gần full viewport, chừa ~4.75rem (header main + lề + vùng nút chat AI fixed bottom-6 h-14). */
  const reportViewportClass =
    activeReport === 'BALANCE_SHEET'
      ? 'h-[calc(100dvh-4.75rem)] max-h-[calc(100dvh-4rem)]'
      : 'h-[min(90vh,calc(100vh-140px))] max-h-[calc(100vh-120px)]';

  const renderDropdownItem = (item: ReportMenuLeaf, opts?: { muted?: boolean }) => {
    const isActive = activeReport === item.id;
    const Icon = item.icon;
    const muted = opts?.muted ?? false;
    return (
      <button
        type="button"
        title={muted ? 'Ít hoặc chưa có dữ liệu — vẫn có thể mở báo cáo' : undefined}
        onClick={() => selectReport(item.id)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-bold leading-snug transition-all duration-150 ${
          muted ? 'opacity-55' : ''
        } ${
          isActive
            ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 ring-1 ring-blue-500/40'
            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
            isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">{item.label}</span>
      </button>
    );
  };

  const finMenuActive = FINANCIAL_REPORT_ITEMS.some((x) => x.id === activeReport);
  const mgmtMenuActive = MANAGEMENT_REPORT_ITEMS.some((x) => x.id === activeReport);

  /** Nút dropdown menu báo cáo — một style xanh dương thống nhất; active: nền + gạch dưới đậm; hover: nền xanh nhạt. */
  const reportTabBtnClass = (isOpen: boolean, sectionActive: boolean) => {
    const on = isOpen || sectionActive;
    return [
      'inline-flex items-center gap-1.5 rounded-lg border-x border-t border-slate-200/90 px-2.5 py-1.5 text-left text-xs font-extrabold shadow-sm transition-all duration-150',
      'border-b-[3px]',
      on
        ? 'border-blue-400 bg-blue-50 text-blue-950 shadow-md ring-1 ring-blue-200/60 border-b-blue-700'
        : 'border-b-transparent bg-white text-slate-800 hover:border-blue-200 hover:bg-blue-50/95 hover:text-blue-900 hover:shadow',
    ].join(' ');
  };

  return (
    <div
      className={`report133-root flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100/60 shadow-sm print:h-auto print:max-h-none print:overflow-visible print:rounded-none print:border-none print:bg-white print:shadow-none ${reportViewportClass}`}
    >
      <header
        ref={reportNavRef}
        className="relative z-[60] shrink-0 border-b border-slate-200/90 bg-white/95 shadow-md backdrop-blur-md print:hidden"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2.5 sm:px-4">
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Báo cáo</span>

          <div className="relative">
            <button
              type="button"
              onClick={() => setNavDropdown((d) => (d === 'fin' ? null : 'fin'))}
              className={reportTabBtnClass(navDropdown === 'fin', finMenuActive)}
              aria-expanded={navDropdown === 'fin'}
              aria-haspopup="menu"
            >
              <Landmark className="h-3.5 w-3.5 shrink-0 text-blue-600" strokeWidth={2} />
              <span className="hidden sm:inline">Tài chính (TT133)</span>
              <span className="sm:hidden">TT133</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${navDropdown === 'fin' ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setNavDropdown((d) => (d === 'mgmt' ? null : 'mgmt'))}
              className={reportTabBtnClass(navDropdown === 'mgmt', mgmtMenuActive)}
              aria-expanded={navDropdown === 'mgmt'}
              aria-haspopup="menu"
            >
              <Gauge className="h-3.5 w-3.5 shrink-0 text-blue-600" strokeWidth={2} />
              <span>Quản trị</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${navDropdown === 'mgmt' ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          <div className="hidden min-h-[1px] flex-1 sm:block" aria-hidden />

          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="max-w-[7rem] cursor-pointer border-none bg-transparent text-xs font-bold text-slate-600 outline-none"
              >
                {[2023, 2024, 2025, 2026].map((y) => (
                  <option key={y} value={y}>
                    Niên độ {y}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handlePrint}
              disabled={blockFinancialOutputs}
              title={printButtonTitle}
              className={`flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition-colors ${
                blockFinancialOutputs ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-50'
              }`}
            >
              <Printer className="h-3.5 w-3.5 text-blue-500" /> In ấn
            </button>
            {canExportFinancialReport && (
              <div className="relative" ref={finExportMenuRef}>
                <button
                  type="button"
                  onClick={() => setFinExportMenuOpen((prev) => !prev)}
                  disabled={blockFinancialOutputs}
                  title={exportButtonTitle}
                  className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all ${
                    blockFinancialOutputs ? 'cursor-not-allowed bg-emerald-600/50' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  <Download className="h-3.5 w-3.5" />
                  Xuất báo cáo
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${finExportMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {finExportMenuOpen && !blockFinancialOutputs && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-[70] min-w-[11rem] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setFinExportMenuOpen(false);
                        void runFinancialExport('excel');
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                      Xuất Excel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFinExportMenuOpen(false);
                        void runFinancialExport('pdf');
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <FileDown className="h-3.5 w-3.5 text-slate-500" />
                      Xuất PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFinExportMenuOpen(false);
                        void runFinancialExport('xml');
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <FileCode className="h-3.5 w-3.5 text-blue-600" />
                      Xuất XML (HTKK)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {navDropdown === 'fin' && (
          <div
            role="menu"
            className="border-t border-slate-200/90 bg-white px-3 py-2 shadow-inner sm:px-4"
          >
            <p className="pb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
              Báo cáo tài chính
            </p>
            <div className="grid max-h-[min(50vh,16rem)] grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {FINANCIAL_REPORT_ITEMS.map((it) => (
                <div key={it.id}>{renderDropdownItem(it)}</div>
              ))}
            </div>
          </div>
        )}

        {navDropdown === 'mgmt' && (
          <div
            role="menu"
            className="border-t border-slate-200/90 bg-white px-3 py-2 shadow-inner sm:px-4"
          >
            <p className="pb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
              Báo cáo quản trị
            </p>
            <div className="grid max-h-[min(50vh,16rem)] grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {MANAGEMENT_REPORT_ITEMS.map((it) => (
                <div key={it.id}>
                  {renderDropdownItem(it, { muted: !mgmtHasData[it.id as keyof typeof mgmtHasData] })}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-slate-100 bg-slate-50/90 px-3 py-1 sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700 sm:text-sm">
              <span className="text-slate-500">Đang xem: </span>
              {reportLabelById(activeReport)}
            </p>
            {!b01bCheck.isBalanced && (
              <div className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-amber-200/80 bg-amber-50/80 px-2 py-0.5 text-[11px] sm:text-xs">
                <span className="shrink-0 font-semibold text-amber-950">Dữ liệu chưa cân</span>
                <span className="font-bold tabular-nums text-amber-900">
                  (Lệch: {formatCurrency(b01bCheck.diff).replace('₫', '').trim()})
                </span>
                <button
                  type="button"
                  onClick={() => setShowB01bDetailModal(true)}
                  className="shrink-0 rounded border border-amber-300/80 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 shadow-sm transition-colors hover:bg-amber-100 sm:text-[11px]"
                >
                  Chi tiết
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto print:overflow-visible">
        {showB01bDetailModal && !b01bCheck.isBalanced && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-4 print:hidden"
            role="presentation"
            onClick={() => setShowB01bDetailModal(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="b01b-detail-title"
              className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <h4 id="b01b-detail-title" className="text-base font-extrabold text-slate-900">
                  Giải trình lệch B01b-DNN
                </h4>
                <button
                  type="button"
                  onClick={() => setShowB01bDetailModal(false)}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label="Đóng"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mb-4 text-sm text-slate-600">
                Tổng tài sản (mã <span className="font-mono font-bold">300</span>) phải khớp tổng nguồn vốn (mã{' '}
                <span className="font-mono font-bold">600</span>). Khi lệch, hệ thống không cho In / Xuất HTKK / Khóa sổ.
              </p>
              <dl className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-sm">
                <div className="flex justify-between gap-4 border-b border-slate-200/80 pb-2">
                  <dt className="font-bold text-slate-700">Mã 300 — Tổng tài sản</dt>
                  <dd className="font-mono font-bold tabular-nums text-slate-900">
                    {formatCurrency(b01bCheck.assets300).replace('₫', '').trim()}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-slate-200/80 pb-2">
                  <dt className="font-bold text-slate-700">Mã 600 — Tổng nguồn vốn</dt>
                  <dd className="font-mono font-bold tabular-nums text-slate-900">
                    {formatCurrency(b01bCheck.sources600).replace('₫', '').trim()}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 pt-1">
                  <dt className="font-bold text-amber-900">Chênh lệch (300 − 600)</dt>
                  <dd className="font-mono font-black tabular-nums text-amber-700">
                    {formatCurrency(b01bCheck.diff).replace('₫', '').trim()}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => setShowB01bDetailModal(false)}
                className="mt-5 w-full rounded-lg bg-slate-800 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-slate-900"
              >
                Đóng
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col px-3 pb-3 pt-0 print:p-0">
            <div
              id="printable-report-area"
              className="flex flex-col rounded-lg border border-slate-200/90 bg-white shadow-sm print:rounded-none print:border-none print:shadow-none"
            >
              <div className="p-5 md:p-6 print:p-0">
                <ReportContentErrorBoundary key={activeReport}>
                  {renderContent()}
                </ReportContentErrorBoundary>
              </div>
              <footer className="shrink-0 border-t border-slate-200/95 bg-gradient-to-b from-slate-50 to-slate-100/95 px-4 py-3 print:hidden">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Ghi chú nội bộ / Chữ ký điện tử (xem nhanh)
                </p>
                <p className="text-[11px] leading-snug text-slate-600">
                  Thanh menu và thao tác In / Xuất cố định phía trên; chỉ vùng này cuộn theo nội dung. Bản in dùng phần ký tên theo mẫu TT133 trong báo cáo.
                </p>
                <div
                  className="mt-2 h-10 rounded-md border border-dashed border-slate-300/90 bg-white/70"
                  aria-hidden
                />
              </footer>
            </div>
         </div>
      </div>
    </div>
  );
};

/** Ẩn mặc định phần định danh tĩnh; in ấn vẫn hiện đủ. */
function ReportTaxpayerInfoCollapse({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/80 print:border-black print:bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-slate-700 hover:bg-slate-100/90 print:hidden"
        aria-expanded={open}
      >
        <span>Thông tin đơn vị / người nộp thuế, MST, địa chỉ…</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      <div
        className={`space-y-1 px-3 pb-3 pt-0 text-[13px] leading-relaxed print:block ${open ? 'block' : 'hidden'}`}
      >
        {children}
      </div>
    </div>
  );
}

// --- SUB-COMPONENTS ---

const IncomeStatement = ({ entries, year, companyInfo }: { entries: JournalEntry[], year: number, companyInfo: CompanyInfo }) => {
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

    const revenue = calculateTurnoverInPeriod(entries, '511', 'CREDIT', startStr, endStr);
    const deductions = calculateTurnoverInPeriod(entries, '521', 'DEBIT', startStr, endStr);
    const netRevenue_10 = revenue - deductions;
    const cogs_11 = calculateTurnoverInPeriod(entries, '632', 'DEBIT', startStr, endStr);
    const grossProfit_20 = netRevenue_10 - cogs_11;
    
    const financialRevenue_21 = calculateTurnoverInPeriod(entries, '515', 'CREDIT', startStr, endStr);
    const financialExpense_22 = calculateTurnoverInPeriod(entries, '635', 'DEBIT', startStr, endStr);
    const interestExpense_23 = calculateTurnoverInPeriod(entries, '635', 'DEBIT', startStr, endStr); // Simplified, usually a sub-account
    const adminExpense_24 = calculateTurnoverInPeriod(entries, '642', 'DEBIT', startStr, endStr);

    const netOpProfit_30 = grossProfit_20 + financialRevenue_21 - financialExpense_22 - adminExpense_24;
    
    const otherIncome_31 = calculateTurnoverInPeriod(entries, '711', 'CREDIT', startStr, endStr);
    const otherExpense_32 = calculateTurnoverInPeriod(entries, '811', 'DEBIT', startStr, endStr);
    const otherProfit_40 = otherIncome_31 - otherExpense_32;
    
    const totalProfitBeforeTax_50 = netOpProfit_30 + otherProfit_40;
    const citTaxExpense_51 = calculateTurnoverInPeriod(entries, '821', 'DEBIT', startStr, endStr);
    const profitAfterTax_60 = totalProfitBeforeTax_50 - citTaxExpense_51;

    const rows = [
        { code: '01', label: '1. Doanh thu bán hàng và cung cấp dịch vụ', value: revenue },
        { code: '02', label: '2. Các khoản giảm trừ doanh thu', value: deductions },
        { code: '10', label: '3. Doanh thu thuần về bán hàng và cung cấp dịch vụ (10 = 01 - 02)', value: netRevenue_10, bold: true },
        { code: '11', label: '4. Giá vốn hàng bán', value: cogs_11 },
        { code: '20', label: '5. Lợi nhuận gộp về bán hàng và cung cấp dịch vụ (20 = 10 - 11)', value: grossProfit_20, bold: true },
        { code: '21', label: '6. Doanh thu hoạt động tài chính', value: financialRevenue_21 },
        { code: '22', label: '7. Chi phí tài chính', value: financialExpense_22 },
        { code: '23', label: '- Trong đó: Chi phí lãi vay', value: interestExpense_23, indent: 1, italic: true },
        { code: '24', label: '8. Chi phí quản lý kinh doanh', value: adminExpense_24 },
        { code: '30', label: '9. Lợi nhuận thuần từ hoạt động kinh doanh (30 = 20 + 21 - 22 - 24)', value: netOpProfit_30, bold: true },
        { code: '31', label: '10. Thu nhập khác', value: otherIncome_31 },
        { code: '32', label: '11. Chi phí khác', value: otherExpense_32 },
        { code: '40', label: '12. Lợi nhuận khác (40 = 31 - 32)', value: otherProfit_40, bold: true },
        { code: '50', label: '13. Tổng lợi nhuận kế toán trước thuế (50 = 30 + 40)', value: totalProfitBeforeTax_50, bold: true },
        { code: '51', label: '14. Chi phí thuế TNDN', value: citTaxExpense_51 },
        { code: '60', label: '15. Lợi nhuận sau thuế thu nhập doanh nghiệp (60 = 50 - 51)', value: profitAfterTax_60, bold: true },
    ];

    return (
        <div className="mx-auto w-full max-w-6xl text-black font-sans print:max-w-none">
            <div className="text-center mb-4">
                <h1 className="text-[24px] font-black uppercase tracking-tight leading-none text-blue-900">BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH</h1>
                <p className="italic text-[11px] mt-1 text-slate-600">(Ban hành theo Thông tư số 133/2016/TT-BTC ngày 26/8/2016 của Bộ Tài chính)</p>
                <p className="font-bold text-sm mt-4">Năm {year}</p>
            </div>

            <ReportTaxpayerInfoCollapse>
              <div className="space-y-1 text-[13px] leading-relaxed">
                <p>
                  <span className="font-bold">Người nộp thuế:</span>{' '}
                  <span className="uppercase">{companyInfo.name}</span>
                </p>
                <p>
                  <span className="font-bold">Mã số thuế:</span>{' '}
                  <span className="font-mono tracking-widest">{companyInfo.taxCode}</span>
                </p>
                <p>
                  <span className="font-bold">Tên đại lý thuế (nếu có):</span>{' '}
                  ........................................................................................
                </p>
                <p>
                  <span className="font-bold">Mã số thuế:</span>{' '}
                  ..................................................................................................................
                </p>
              </div>
            </ReportTaxpayerInfoCollapse>

            <div className="flex flex-col gap-2 mb-4">
                <div className="flex items-center gap-2 text-[12px]">
                    <div className="w-4 h-4 border border-black flex items-center justify-center font-bold text-[10px]">X</div>
                    <span>Hỗ trợ lấy dữ liệu năm trước</span>
                </div>
                <div className="flex items-center gap-2 text-[12px]">
                    <div className="w-4 h-4 border border-black flex items-center justify-center font-bold text-[10px]"> </div>
                    <span>Tích chọn để nhập cột Thuyết minh</span>
                </div>
            </div>

            <div className="flex justify-end mb-1">
                <p className="italic text-[12px]">Đơn vị tiền: Đồng Việt Nam</p>
            </div>

            <table className="w-full text-[13px] border-collapse border border-black">
                <thead className="font-bold text-center bg-slate-100">
                    <tr>
                        <th className="p-2 border border-black w-[50%]">CHỈ TIÊU</th>
                        <th className="p-2 border border-black w-16">Mã số</th>
                        <th className="p-2 border border-black w-20">Thuyết minh</th>
                        <th className="p-2 border border-black w-32">Năm nay</th>
                        <th className="p-2 border border-black w-32">Năm trước</th>
                    </tr>
                    <tr className="bg-slate-50 text-[11px] font-normal">
                        <th className="p-1 border border-black">1</th>
                        <th className="p-1 border border-black">2</th>
                        <th className="p-1 border border-black">3</th>
                        <th className="p-1 border border-black">4</th>
                        <th className="p-1 border border-black">5</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, idx) => (
                        <tr key={idx} className={`${row.bold ? 'bg-slate-50/50' : ''}`}>
                            <td
                              className={`border border-black p-2 ${row.bold ? 'font-bold' : ''} ${row.italic ? 'italic' : ''}`}
                              style={{ paddingLeft: `${(row.indent || 0) * 20 + 8}px` }}
                            >
                              {row.label}
                            </td>
                            <td className="border border-black p-2 text-center font-mono font-bold">{row.code}</td>
                            <td className="border border-black p-2"></td>
                            <td className={`border border-black p-2 text-right font-mono ${row.bold ? 'font-bold' : ''}`}>
                              {row.value !== null ? formatCurrency(row.value).replace('₫', '').trim() : '0'}
                            </td>
                            <td className="border border-black p-2 text-right font-mono text-slate-300">0</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            
            <div className="mt-10 grid grid-cols-3 gap-8 text-center text-sm font-bold">
                <div>
                    <p className="uppercase">NGƯỜI LẬP BIỂU</p>
                    <p className="mt-1 text-xs font-normal italic">(Ký, họ tên)</p>
                    <div className="h-16"></div>
                </div>
                <div>
                    <p className="uppercase">KẾ TOÁN TRƯỞNG</p>
                    <p className="mt-1 text-xs font-normal italic">(Ký, họ tên)</p>
                    <div className="h-16"></div>
                </div>
                <div>
                    <p className="uppercase">GIÁM ĐỐC</p>
                    <p className="mt-1 text-xs font-normal italic">(Ký, họ tên, đóng dấu)</p>
                    <div className="h-16"></div>
                </div>
            </div>
        </div>
    );
};

const BalanceSheet = ({
    entries,
    financialYear,
    companyInfo,
}: {
    entries: JournalEntry[];
    financialYear: FinancialYear;
    companyInfo: CompanyInfo;
}) => {
    const startOfYear = financialYear.startDate;
    const endOfYear = financialYear.endDate;
    const beginningCutoff = new Date(new Date(startOfYear).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const reportEndDate = new Date(`${endOfYear}T00:00:00`);
    const reportEndDay = reportEndDate.getDate();
    const reportEndMonth = reportEndDate.getMonth() + 1;
    const reportEndYear = reportEndDate.getFullYear();

    const getNetBalance = (prefixes: string[]) => {
      return prefixes.reduce((sum, prefix) => {
        const net = entries
          .filter(entry => entry.date <= endOfYear)
          .reduce((acc, entry) => {
            return acc + journalEntryDetailsArray(entry).reduce((s, d) => {
              if (d.account.toString().startsWith(prefix)) {
                 return s + (d.debit - d.credit);
              }
              return s;
            }, 0);
          }, 0);
        return sum + net;
      }, 0);
    };

    const getNetBalanceAt = (dateStr: string, prefixes: string[]) => {
      return prefixes.reduce((sum, prefix) => {
        const net = entries
          .filter(entry => entry.date <= dateStr)
          .reduce((acc, entry) => {
            return acc + journalEntryDetailsArray(entry).reduce((s, d) => {
              if (d.account.toString().startsWith(prefix)) {
                 return s + (d.debit - d.credit);
              }
              return s;
            }, 0);
          }, 0);
        return sum + net;
      }, 0);
    };

    const getAssetSideBalance = (prefixes: string[]) => {
        const net = getNetBalance(prefixes);
        return net > 0 ? net : 0;
    };

    const getLiabilitySideBalance = (prefixes: string[]) => {
        const net = getNetBalance(prefixes);
        return net < 0 ? Math.abs(net) : 0;
    };

    const getAssetSideBalanceAt = (dateStr: string, prefixes: string[]) => {
        const net = getNetBalanceAt(dateStr, prefixes);
        return net > 0 ? net : 0;
    };

    const getLiabilitySideBalanceAt = (dateStr: string, prefixes: string[]) => {
        const net = getNetBalanceAt(dateStr, prefixes);
        return net < 0 ? Math.abs(net) : 0;
    };

    // --- TÀI SẢN ---
    const ts_110 = ['111', '112', '113'].reduce((acc, p) => acc + getAssetSideBalance([p]), 0);
    const ts_121 = getAssetSideBalance(['121']);
    const ts_122 = 0;
    /** Toàn bộ nhóm 128* (TT133 mã 123; trước đây chỉ 1281 → lệch nếu có 1288…) */
    const ts_123 = getAssetSideBalance(['128']);
    const ts_120 = ts_121 + ts_122 + ts_123;
    
    const ts_131 = getAssetSideBalance(['131']);
    const ts_132 = getAssetSideBalance(['331']);
    const ts_133 = getAssetSideBalance(['138']) + getAssetSideBalance(['136']);
    const ts_134 = 0;
    const ts_135 = 0;
    const ts_130 = ts_131 + ts_132 + ts_133 + ts_134 + ts_135;

    const ts_141 = getAssetSideBalance(['151', '152', '153', '154', '155', '156']);
    const ts_142 = 0;
    const ts_140 = ts_141 + ts_142;

    // --- LOGIC BÙ TRỪ THUẾ GTGT RÒNG (MÃ 151 & 413) ---
    // VAT 133 ròng = Tổng Nợ - Tổng Có
    const net133 = entries
      .filter(e => e.date <= endOfYear)
      .reduce((sum, e) => sum + journalEntryDetailsArray(e).reduce((s, d) => String(d.account).startsWith('133') ? s + (d.debit - d.credit) : s, 0), 0);
    
    // VAT 3331 ròng = Tổng Có - Tổng Nợ (Số Nợ 3331 phát sinh từ phiếu chi nộp thuế sẽ làm giảm số này)
    const net3331 = entries
      .filter(e => e.date <= endOfYear)
      .reduce((sum, e) => sum + journalEntryDetailsArray(e).reduce((s, d) => String(d.account).startsWith('3331') ? s + (d.credit - d.debit) : s, 0), 0);
    
    // Kết quả bù trừ ròng cuối kỳ
    const netVatStatus = net133 - net3331;
    
    // Mã 151: Thuế GTGT được khấu trừ (Khi 133 ròng > 3331 ròng)
    const ts_151 = netVatStatus > 0 ? netVatStatus : 0;
    // Mã 413: Thuế GTGT ròng (133 vs 3331) + các thuế/khoản phải nộp khác trên 333* (không gộp 3331 — đã bù trừ ở trên)
    const nv_413_val = netVatStatus < 0 ? Math.abs(netVatStatus) : 0;
    const nv_413_otherTaxes = ['3332', '3333', '3334', '3335', '3336', '3337', '3338', '3339'].reduce(
      (acc, p) => acc + getLiabilitySideBalance([p]),
      0,
    );
    const nv_413 = nv_413_val + nv_413_otherTaxes;

    const ts_152 = getAssetSideBalance(['141', '242']);
    const ts_150 = ts_151 + ts_152;

    const totalAssetsShortTerm = ts_110 + ts_120 + ts_130 + ts_140 + ts_150; 

    const ts_221 = getAssetSideBalance(['211']) + getAssetSideBalance(['213']);
    const ts_222 = -getLiabilitySideBalance(['214']); 
    const ts_220 = ts_221 + ts_222;

    const ts_231 = getAssetSideBalance(['217']);
    const ts_232 = 0;
    const ts_230 = ts_231 + ts_232;

    const totalAssetsLongTerm =
      ts_220 +
      ts_230 +
      ['221', '228', '241'].reduce((acc, p) => acc + getAssetSideBalance([p]), 0);

    const totalAssets_300 = totalAssetsShortTerm + totalAssetsLongTerm;

    // --- NGUỒN VỐN ---
    const nv_411 = getLiabilitySideBalance(['331']);
    const nv_412 = getLiabilitySideBalance(['131']);
    const nv_414 = getLiabilitySideBalance(['334']);
    // 415: Phải trả ngắn hạn khác (338*) + chi phí phải trả / nội bộ ngắn hạn (335–337) — trước đây thiếu → lệch 300/600
    const nv_415 =
      getLiabilitySideBalance(['338']) +
      ['335', '336', '337'].reduce((acc, p) => acc + getLiabilitySideBalance([p]), 0);
    // 416: Vay ngắn hạn / nợ thuê TC (341* và các TK vay phổ biến 311, 312, 319, 320)
    const nv_416 = ['341', '311', '312', '319', '320'].reduce((acc, p) => acc + getLiabilitySideBalance([p]), 0);
    // 417: Dự phòng phải trả ngắn hạn => thường dùng 352*
    const nv_417 = getLiabilitySideBalance(['352']);
    // 418: Quỹ khen thưởng, phúc lợi => thường dùng 353*
    const nv_418 = getLiabilitySideBalance(['353']);
    const nv_410 = nv_411 + nv_412 + nv_413 + nv_414 + nv_415 + nv_416 + nv_417 + nv_418;
    const totalLiabilities_400 = nv_410;

    const nv_511 = getLiabilitySideBalance(['411']);
    // TK 421 (Lợi nhuận sau thuế chưa phân phối) là tài khoản lưỡng tính:
    // - Dư Có (net < 0) => tăng vốn CSH
    // - Dư Nợ (net > 0) => giảm vốn CSH (lỗ lũy kế)
    const net421 = getNetBalance(['421']);
    const nv_517 = net421 < 0 ? Math.abs(net421) : -net421;
    const totalEquity_500 = nv_511 + nv_517 + getLiabilitySideBalance(['412', '413', '418', '419']);

    const totalResources_600 = totalLiabilities_400 + totalEquity_500;

    // --- BEGINNING-OF-YEAR VALUES (Số đầu năm) ---
    const ts_110_begin = ['111', '112', '113'].reduce(
      (acc, p) => acc + getAssetSideBalanceAt(beginningCutoff, [p]),
      0,
    );
    const ts_121_begin = getAssetSideBalanceAt(beginningCutoff, ['121']);
    const ts_122_begin = 0;
    const ts_123_begin = getAssetSideBalanceAt(beginningCutoff, ['128']);
    const ts_120_begin = ts_121_begin + ts_122_begin + ts_123_begin;

    const ts_131_begin = getAssetSideBalanceAt(beginningCutoff, ['131']);
    const ts_132_begin = getAssetSideBalanceAt(beginningCutoff, ['331']);
    const ts_133_begin =
      getAssetSideBalanceAt(beginningCutoff, ['138']) + getAssetSideBalanceAt(beginningCutoff, ['136']);
    const ts_134_begin = 0;
    const ts_135_begin = 0;
    const ts_130_begin = ts_131_begin + ts_132_begin + ts_133_begin + ts_134_begin + ts_135_begin;

    const ts_141_begin = getAssetSideBalanceAt(beginningCutoff, ['151', '152', '153', '154', '155', '156']);
    const ts_142_begin = 0;
    const ts_140_begin = ts_141_begin + ts_142_begin;

    const net133_begin = entries
      .filter(e => e.date <= beginningCutoff)
      .reduce((sum, e) => sum + journalEntryDetailsArray(e).reduce((s, d) => String(d.account).startsWith('133') ? s + (d.debit - d.credit) : s, 0), 0);
    const net3331_begin = entries
      .filter(e => e.date <= beginningCutoff)
      .reduce((sum, e) => sum + journalEntryDetailsArray(e).reduce((s, d) => String(d.account).startsWith('3331') ? s + (d.credit - d.debit) : s, 0), 0);
    const netVatStatus_begin = net133_begin - net3331_begin;
    const ts_151_begin = netVatStatus_begin > 0 ? netVatStatus_begin : 0;
    const nv_413_val_begin = netVatStatus_begin < 0 ? Math.abs(netVatStatus_begin) : 0;
    const nv_413_otherTaxes_begin = ['3332', '3333', '3334', '3335', '3336', '3337', '3338', '3339'].reduce(
      (acc, p) => acc + getLiabilitySideBalanceAt(beginningCutoff, [p]),
      0,
    );
    const nv_413_begin = nv_413_val_begin + nv_413_otherTaxes_begin;

    const ts_152_begin = getAssetSideBalanceAt(beginningCutoff, ['141', '242']);
    const ts_150_begin = ts_151_begin + ts_152_begin;

    const totalAssetsShortTerm_begin = ts_110_begin + ts_120_begin + ts_130_begin + ts_140_begin + ts_150_begin;

    const ts_221_begin =
      getAssetSideBalanceAt(beginningCutoff, ['211']) + getAssetSideBalanceAt(beginningCutoff, ['213']);
    const ts_222_begin = -getLiabilitySideBalanceAt(beginningCutoff, ['214']);
    const ts_220_begin = ts_221_begin + ts_222_begin;

    const ts_231_begin = getAssetSideBalanceAt(beginningCutoff, ['217']);
    const ts_232_begin = 0;
    const ts_230_begin = ts_231_begin + ts_232_begin;

    const totalAssetsLongTerm_begin =
      ts_220_begin +
      ts_230_begin +
      ['221', '228', '241'].reduce((acc, p) => acc + getAssetSideBalanceAt(beginningCutoff, [p]), 0);
    const totalAssets_300_begin = totalAssetsShortTerm_begin + totalAssetsLongTerm_begin;

    const nv_411_begin = getLiabilitySideBalanceAt(beginningCutoff, ['331']);
    const nv_412_begin = getLiabilitySideBalanceAt(beginningCutoff, ['131']);
    const nv_414_begin = getLiabilitySideBalanceAt(beginningCutoff, ['334']);
    const nv_415_begin =
      getLiabilitySideBalanceAt(beginningCutoff, ['338']) +
      ['335', '336', '337'].reduce((acc, p) => acc + getLiabilitySideBalanceAt(beginningCutoff, [p]), 0);
    const nv_416_begin = ['341', '311', '312', '319', '320'].reduce(
      (acc, p) => acc + getLiabilitySideBalanceAt(beginningCutoff, [p]),
      0,
    );
    const nv_417_begin = getLiabilitySideBalanceAt(beginningCutoff, ['352']);
    const nv_418_begin = getLiabilitySideBalanceAt(beginningCutoff, ['353']);
    const nv_410_begin = nv_411_begin + nv_412_begin + nv_413_begin + nv_414_begin + nv_415_begin + nv_416_begin + nv_417_begin + nv_418_begin;
    const totalLiabilities_400_begin = nv_410_begin;

    const nv_511_begin = getLiabilitySideBalanceAt(beginningCutoff, ['411']);
    const net421_begin = getNetBalanceAt(beginningCutoff, ['421']);
    const nv_517_begin = net421_begin < 0 ? Math.abs(net421_begin) : -net421_begin;
    const totalEquity_500_begin = nv_511_begin + nv_517_begin + getLiabilitySideBalanceAt(beginningCutoff, ['412', '413', '418', '419']);
    const totalResources_600_begin = totalLiabilities_400_begin + totalEquity_500_begin;

    const beginByCode: Record<string, number | null> = {
      '100': totalAssetsShortTerm_begin,
      '110': ts_110_begin,
      '120': ts_120_begin,
      '121': ts_121_begin,
      '122': ts_122_begin,
      '123': ts_123_begin,
      '130': ts_130_begin,
      '131': ts_131_begin,
      '132': ts_132_begin,
      '133': ts_133_begin,
      '134': ts_134_begin,
      '135': ts_135_begin,
      '140': ts_140_begin,
      '141': ts_141_begin,
      '142': ts_142_begin,
      '150': ts_150_begin,
      '151': ts_151_begin,
      '152': ts_152_begin,

      '200': totalAssetsLongTerm_begin,
      '210': 0,
      '211': 0,
      '212': 0,
      '213': 0,
      '214': 0,
      '215': 0,
      '220': ts_220_begin,
      '221': ts_221_begin,
      '222': ts_222_begin,
      '230': ts_230_begin,
      '231': ts_231_begin,
      '232': ts_232_begin,
      '240': 0,
      '250': 0,
      '251': 0,
      '252': 0,
      '253': 0,
      '260': 0,
      '300': totalAssets_300_begin,

      '400': totalLiabilities_400_begin,
      '410': nv_410_begin,
      '411': nv_411_begin,
      '412': nv_412_begin,
      '413': nv_413_begin,
      '414': nv_414_begin,
      '415': nv_415_begin,
      '416': nv_416_begin,
      '417': nv_417_begin,
      '418': nv_418_begin,
      '420': 0,
      '421': 0,
      '422': 0,
      '423': 0,
      '424': 0,
      '425': 0,
      '426': 0,
      '427': 0,

      '500': totalEquity_500_begin,
      '511': nv_511_begin,
      '512': 0,
      '513': 0,
      '514': 0,
      '515': 0,
      '516': 0,
      '517': nv_517_begin,

      '600': totalResources_600_begin,
      '': null,
    };

    const sections = [
        { label: 'A – TÀI SẢN NGÂN HẠN (100 = 110+ 120 + 130 + 140 + 150)', code: '100', value: totalAssetsShortTerm, bold: true, bg: 'bg-slate-50' },
        { label: 'I. Tiền và các khoản tương đương tiền', code: '110', value: ts_110, indent: 0 },
        { label: 'II. Đầu tư tài chính ngắn hạn', code: '120', value: ts_120, indent: 0 },
        { label: '1. Chứng khoán kinh doanh', code: '121', value: ts_121, indent: 1 },
        { label: '2. Dự phòng giảm giá chứng khoán kinh doanh (*)', code: '122', value: ts_122, indent: 1, italic: true },
        { label: '3. Đầu tư nắm giữ đến ngày đáo hạn ngắn hạn', code: '123', value: ts_123, indent: 1 },
        { label: 'III. Các khoản phải thu ngắn hạn', code: '130', value: ts_130, indent: 0 },
        { label: '1. Phải thu ngắn hạn của khách hàng', code: '131', value: ts_131, indent: 1 },
        { label: '2. Trả trước cho người bán ngắn hạn', code: '132', value: ts_132, indent: 1 },
        { label: '3. Phải thu ngắn hạn khác', code: '133', value: ts_133, indent: 1 },
        { label: '4. Tài sản thiếu chờ xử lý', code: '134', value: ts_134, indent: 1 },
        { label: '5. Dự phòng phải thu ngắn hạn khó đòi (*)', code: '135', value: ts_135, indent: 1, italic: true },
        { label: 'IV. Hàng tồn kho', code: '140', value: ts_140, indent: 0 },
        { label: '1. Hàng tồn kho', code: '141', value: ts_141, indent: 1 },
        { label: '2. Dự phòng giảm giá hàng tồn kho (*)', code: '142', value: ts_142, indent: 1, italic: true },
        { label: 'V. Tài sản ngắn hạn khác', code: '150', value: ts_150, indent: 0 },
        { label: '1. Thuế GTGT được khấu trừ', code: '151', value: ts_151, indent: 1 },
        { label: '2. Tài sản ngắn hạn khác', code: '152', value: ts_152, indent: 1 },

        { label: 'B - TÀI SẢN DÀI HẠN (200=210+220+230+240+250+260)', code: '200', value: totalAssetsLongTerm, bold: true, bg: 'bg-slate-50' },
        { label: 'I. Các khoản phải thu dài hạn', code: '210', value: 0, indent: 0 },
        { label: '1. Phải thu dài hạn của khách hàng', code: '211', value: 0, indent: 1 },
        { label: '2. Trả trước cho người bán dài hạn', code: '212', value: 0, indent: 1 },
        { label: '3. Vốn kinh doanh ở đơn vị trực thuộc', code: '213', value: 0, indent: 1 },
        { label: '4. Phải thu dài hạn khác', code: '214', value: 0, indent: 1 },
        { label: '5. Dự phòng phải thu dài hạn khó đòi (*)', code: '215', value: 0, indent: 1, italic: true },
        { label: 'II. Tài sản cố định', code: '220', value: ts_220, indent: 0 },
        { label: '- Nguyên giá', code: '221', value: ts_221, indent: 1 },
        { label: '- Giá trị hao mòn lũy kế (*)', code: '222', value: ts_222, indent: 1, italic: true },
        { label: 'III. Bất động sản đầu tư', code: '230', value: ts_230, indent: 0 },
        { label: '- Nguyên giá', code: '231', value: ts_231, indent: 1 },
        { label: '- Giá trị hao mòn lũy kế (*)', code: '232', value: ts_232, indent: 1, italic: true },
        { label: 'IV. Xây dựng cơ bản dở dang', code: '240', value: 0, indent: 0 },
        { label: 'V. Đầu tư tài chính dài hạn', code: '250', value: 0, indent: 0 },
        { label: '1. Đầu tư góp vốn vào đơn vị khác', code: '251', value: 0, indent: 1 },
        { label: '2. Dự phòng tổn thất đầu tư vào đơn vị khác (*)', code: '252', value: 0, indent: 1, italic: true },
        { label: '3. Đầu tư nắm giữ đến ngày đáo hạn dài hạn', code: '253', value: 0, indent: 1 },
        { label: 'VI. Tài sản dài hạn khác', code: '260', value: 0, indent: 0 },
        { label: 'TỔNG CỘNG TÀI SẢN (300=100+200)', code: '300', value: totalAssets_300, bold: true, bg: 'bg-blue-100' },

        { label: 'NGUỒN VỐN', code: '', value: null, bold: true, center: true, bg: 'bg-slate-200' },
        { label: 'C - NỢ PHẢI TRẢ (400=410+420)', code: '400', value: totalLiabilities_400, bold: true, bg: 'bg-slate-50' },
        { label: 'I. Nợ ngắn hạn', code: '410', value: nv_410, indent: 0 },
        { label: '1. Phải trả người bán ngắn hạn', code: '411', value: nv_411, indent: 1 },
        { label: '2. Người mua trả tiền trước ngắn hạn', code: '412', value: nv_412, indent: 1 },
        { label: '3. Thuế và các khoản phải nộp Nhà nước', code: '413', value: nv_413, indent: 1 },
        { label: '4. Phải trả người lao động', code: '414', value: nv_414, indent: 1 },
        { label: '5. Phải trả ngắn hạn khác', code: '415', value: nv_415, indent: 1 },
        { label: '6. Vay và nợ thuê tài chính ngắn hạn', code: '416', value: nv_416, indent: 1 },
        { label: '7. Dự phòng phải trả ngắn hạn', code: '417', value: nv_417, indent: 1 },
        { label: '8. Quỹ khen thưởng, phúc lợi', code: '418', value: nv_418, indent: 1 },
        { label: 'II. Nợ dài hạn', code: '420', value: 0, indent: 0 },
        { label: '1. Phải trả người bán dài hạn', code: '421', value: 0, indent: 1 },
        { label: '2. Người mua trả tiền trước dài hạn', code: '422', value: 0, indent: 1 },
        { label: '3. Phải trả nội bộ về vốn kinh doanh', code: '423', value: 0, indent: 1 },
        { label: '4. Phải trả dài hạn khác', code: '424', value: 0, indent: 1 },
        { label: '5. Vay và nợ thuê tài chính dài hạn', code: '425', value: 0, indent: 1 },
        { label: '6. Dự phòng phải trả dài hạn', code: '426', value: 0, indent: 1 },
        { label: '7. Quỹ phát triển khoa học và công nghệ', code: '427', value: 0, indent: 1 },

        { label: 'D - VỐN CHỦ SỞ HỮU(500=511+512+513+514+515+516+517)', code: '500', value: totalEquity_500, bold: true, bg: 'bg-slate-50' },
        { label: '1. Vốn góp của chủ sở hữu', code: '511', value: nv_511, indent: 1 },
        { label: '2. Thặng dư vốn cổ phần', code: '512', value: 0, indent: 1 },
        { label: '3. Vốn khác của chủ sở hữu', code: '513', value: 0, indent: 1 },
        { label: '4. Cổ phiếu quỹ (*)', code: '514', value: 0, indent: 1, italic: true },
        { label: '5. Chênh lệch tỷ giá hối đoái', code: '515', value: 0, indent: 1 },
        { label: '6. Các quỹ thuộc vốn chủ sở hữu', code: '516', value: 0, indent: 1 },
        { label: '7. Lợi nhuận sau thuế chưa phân phối', code: '517', value: nv_517, indent: 1 },
        { label: 'TỔNG CỘNG NGUỒN VỐN(600=400+500)', code: '600', value: totalResources_600, bold: true, bg: 'bg-emerald-100' },
    ];

    return (
        <div className="mx-auto w-full max-w-6xl text-black font-sans print:max-w-none">
            <div className="mb-5 w-full">
                {/* Header layout: make the center column wider to prevent awkward word-wrapping (especially when printing) */}
                <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-12">
                    <div className="text-center md:col-span-12">
                        {/* National header: split into 2 deliberate lines for clean typography */}
                        <div className="space-y-1">
                            <p className="text-[18px] font-bold uppercase leading-tight tracking-normal">
                                CỘNG HÒA XÃ HỘI CHỦ NGHĨA
                            </p>
                            <p className="text-[18px] font-bold uppercase leading-tight tracking-normal">
                                VIỆT NAM
                            </p>
                        </div>

                        <p className="font-bold text-[16px] mt-2 leading-tight md:whitespace-nowrap">
                            Độc lập - Tự do - Hạnh phúc
                        </p>
                    <div className="w-44 border-b border-black mx-auto mt-2.5 mb-6"></div>
                    
                        <h1 className="text-[28px] md:text-[30px] font-black uppercase tracking-tight leading-[1.05] mx-auto max-w-[620px]">
                            BÁO CÁO TÌNH HÌNH TÀI CHÍNH
                        </h1>
                        <p className="font-bold text-lg md:text-xl mt-3 whitespace-normal md:whitespace-nowrap">
                            Tại ngày {reportEndDay} tháng {reportEndMonth} năm {reportEndYear}
                        </p>
                    </div>
                </div>
            </div>

            <ReportTaxpayerInfoCollapse>
              <div className="space-y-2 text-[14px] leading-relaxed">
                <p>
                  <span className="font-bold">[01] Tên người nộp thuế:</span> {companyInfo.name}
                </p>
                <p>
                  <span className="font-bold">[02] Mã số thuế:</span>{' '}
                  <span className="font-mono tracking-[0.2em]">{companyInfo.taxCode}</span>
                </p>
                <p>
                  <span className="font-bold">[03] Địa chỉ:</span> {companyInfo.address}
                </p>

                <div className="grid grid-cols-12 gap-x-4">
                  <div className="col-span-4">
                    <p>
                      <span className="font-bold">[04] Điện thoại:</span> {companyInfo.phone}
                    </p>
                  </div>
                  <div className="col-span-4">
                    <p>
                      <span className="font-bold">[05] Fax:</span> {companyInfo.fax || '...'}
                    </p>
                  </div>
                  <div className="col-span-4">
                    <p>
                      <span className="font-bold">[06] E-mail:</span> {companyInfo.email}
                    </p>
                  </div>
                </div>
                <p>
                  <span className="font-bold">Ý kiến kiểm toán:</span>
                </p>
              </div>
            </ReportTaxpayerInfoCollapse>

            <div className="flex justify-end mb-2">
                <p className="italic text-sm">Đơn vị tiền: đồng VN</p>
            </div>

            <table className="w-full text-[13px] border-collapse border border-black">
                <thead className="font-bold text-center bg-slate-100">
                    <tr>
                        <th className="p-2 border border-black w-[45%]">CHỈ TIÊU</th>
                        <th className="p-2 border border-black w-16">Mã số</th>
                        <th className="p-2 border border-black w-20">Thuyết minh</th>
                        <th className="p-2 border border-black w-32">Số cuối năm</th>
                        <th className="p-2 border border-black w-32">Số đầu năm</th>
                    </tr>
                </thead>
                <tbody>
                    {sections.map((row, idx) => (
                        <tr key={idx} className={`${row.bg || ''} ${row.center ? 'bg-slate-200' : ''}`}>
                            <td className={`p-2 border border-black ${row.bold ? 'font-bold uppercase' : ''} ${row.italic ? 'italic' : ''} ${row.center ? 'text-center' : ''}`} style={{ paddingLeft: row.center ? '0px' : `${(row.indent || 0) * 20 + 8}px` }}>
                                {row.label}
                            </td>
                            <td className="p-2 border border-black text-center font-mono font-bold">{row.code}</td>
                            <td className="p-2 border border-black"></td>
                            <td className={`p-2 border border-black text-right font-mono ${
                                row.code === '70' && reportMeta.isClosingCashNegative
                                    ? 'bg-rose-100 text-rose-700 font-black'
                                    : (row.bold ? 'font-bold' : '')
                            }`}>
                                {row.value !== null ? formatCurrency(row.value).replace('₫', '').trim() : ''}
                            </td>
                            <td className="p-2 border border-black text-right font-mono text-slate-500">
                                {row.code && beginByCode[row.code] !== null && beginByCode[row.code] !== undefined
                                  ? formatCurrency(beginByCode[row.code] as number).replace('₫', '').trim()
                                  : ''}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            
            <div className="mt-16 grid grid-cols-3 text-center text-sm font-bold gap-8">
                <div>
                    <p className="uppercase">NGƯỜI LẬP BIỂU</p>
                    <p className="italic font-normal text-xs mt-1">(Ký, họ tên)</p>
                    <div className="h-24"></div>
                </div>
                <div>
                    <p className="uppercase">KẾ TOÁN TRƯỞNG</p>
                    <p className="italic font-normal text-xs mt-1">(Ký, họ tên)</p>
                    <div className="h-24"></div>
                </div>
                <div>
                    <p className="uppercase">GIÁM ĐỐC</p>
                    <p className="italic font-normal text-xs mt-1">(Ký, họ tên, đóng dấu)</p>
                    <div className="h-24"></div>
                </div>
            </div>
        </div>
    );
};

const TrialBalance = ({
  entries,
  year,
  financialYear,
  companyInfo,
  accounts,
}: {
  entries: JournalEntry[];
  year: number;
  financialYear: FinancialYear;
  companyInfo: CompanyInfo;
  accounts: AccountDefinition[];
}) => {
  const startStr = financialYear.startDate;
  const endStr = financialYear.endDate;

  // Fixed account list for TT133 Trial Balance (as requested).
  // NOTE: Keep columns/layout unchanged; only the account rows are controlled here.
  const TRIAL_BALANCE_CODES: string[] = [
    '111', '1111', '1112',
    '112', '1121', '1122',
    '121',
    '128', '1281', '1288',
    '131',
    '133', '1331', '1332',
    '136', '1361', '1368',
    '138', '1381', '1386', '1388',
    '141',
    '151', '152', '153', '154', '155', '156', '157',
    '211', '2111', '2112', '2113',
    '214', '2141', '2142', '2143', '2147',
    '228', '2281', '2288',
    '229', '2291', '2292', '2293', '2294',
    '241', '2411', '2412', '2413',
    '242',
    '331',
    '333', '3331', '33311', '33312', '3332', '3333', '3334', '3335', '3336', '3337', '3338', '33381', '33382', '3339',
    '334', '335',
    '336', '3361', '3368',
    '338', '3381', '3382', '3383', '3384', '3385', '3386', '3387', '3388',
    '341', '3411', '3412',
    '352', '3521', '3522', '3524',
    '353', '3531', '3532', '3533', '3534',
    '356', '3561', '3562',
    '4111', '4112', '4118',
    '413', '418', '419',
    '421', '4211', '4212',
    '511', '5111', '5112', '5113', '5118',
    '515',
    // Nhóm 6 — chi phí SXKD: 611, 631, 632, 635 + 642 / 6421 / 6422
    '611', '631', '632', '635', '642', '6421', '6422',
    '711',
    '811', '821',
    '911',
  ];

  const TRIAL_BALANCE_NAME_BY_CODE: Record<string, string> = {
    '111': 'Tiền mặt',
    '1111': 'Tiền Việt Nam',
    '1112': 'Ngoại tệ',
    '112': 'Tiền gửi Ngân hàng',
    '1121': 'Tiền Việt Nam',
    '1122': 'Ngoại tệ',
    '121': 'Chứng khoán kinh doanh',
    '128': 'Đầu tư nắm giữ đến ngày đáo hạn',
    '1281': 'Tiền gửi có kỳ hạn',
    '1288': 'Các khoản đầu tư khác nắm giữ đến ngày đáo hạn',
    '131': 'Phải thu của Khách hàng',
    '133': 'Thuế GTGT được khấu trừ',
    '1331': 'Thuế GTGT được khấu trừ của hàng hoá, dịch vụ',
    '1332': 'Thuế GTGT được khấu trừ TSCĐ',
    '136': 'Phải thu nội bộ',
    '1361': 'Vốn kinh doanh ở đơn vị trực thuộc',
    '1368': 'Phải thu nội bộ khác',
    '138': 'Phải thu khác',
    '1381': 'Tài sản thiếu chờ xử lý',
    '1386': 'Cầm cố, thế chấp, ký quỹ, ký cược',
    '1388': 'Phải thu khác',
    '141': 'Tạm ứng',
    '151': 'Hàng mua đang đi đường',
    '152': 'Nguyên liệu, vật liệu',
    '153': 'Công cụ, dụng cụ',
    '154': 'Chi phí sản xuất, kinh doanh dở dang',
    '155': 'Thành phẩm',
    '156': 'Hàng hoá',
    '157': 'Hàng gửi đi bán',
    '211': 'Tài sản cố định',
    '2111': 'TSCĐ Hữu hình',
    '2112': 'TSCĐ thuê tài chính',
    '2113': 'TSCĐ Vô hình',
    '214': 'Hao mòn tài sản cố định',
    '2141': 'Hao mòn TSCĐ Hữu hình',
    '2142': 'Hao mòn TSCĐ thuê tài chính',
    '2143': 'Hao mòn TSCĐ vô hình',
    '2147': 'Hao mòn Bất động sản đầu tư',
    '228': 'Đầu tư góp vốn vào đơn vị khác',
    '2281': 'Đầu tư vào công ty liên doanh, liên kết',
    '2288': 'Đầu tư khác',
    '229': 'Dự phòng tổn thất tài sản',
    '2291': 'Dự phòng giảm giá chứng khoán kinh doanh',
    '2292': 'Dự phòng tổn thất đầu tư vào đơn vị khác',
    '2293': 'Dự phòng phải thu khó đòi',
    '2294': 'Dự phòng giảm giá hàng tồn kho',
    '241': 'Xây dựng cơ bản dở dang',
    '2411': 'Mua sắm TSCĐ',
    '2412': 'Xây dựng cơ bản',
    '2413': 'Sửa chữa lớn TSCĐ',
    '242': 'Chi phí trả trước',
    '331': 'Phải trả cho người bán',
    '333': 'Thuế và các khoản phải nộp nhà nước',
    '3331': 'Thuế GTGT phải nộp',
    '33311': 'Thuế GTGT đầu ra',
    '33312': 'Thuế GTGT hàng nhập khẩu',
    '3332': 'Thuế tiêu thụ đặc biệt',
    '3333': 'Thuế xuất, nhập khẩu',
    '3334': 'Thuế thu nhập doanh nghiệp',
    '3335': 'Thuế thu nhập cá nhân',
    '3336': 'Thuế tài nguyên',
    '3337': 'Thuế nhà đất, tiền thuê đất',
    '3338': 'Thuế bảo vệ môi trường và các loại thuế khác',
    '33381': 'Thuế bảo vệ môi trường',
    '33382': 'Các loại thuế khác',
    '3339': 'Phí, lệ phí và các khoản phải nộp khác',
    '334': 'Phải trả người lao động',
    '335': 'Chi phí phải trả',
    '336': 'Phải trả nội bộ',
    '3361': 'Phải trả nội bộ về vốn kinh doanh',
    '3368': 'Phải trả nội bộ khác',
    '338': 'Phải trả, phải nộp khác',
    '3381': 'Tài sản thừa chờ giải quyết',
    '3382': 'Kinh phí công đoàn',
    '3383': 'Bảo hiểm xã hội',
    '3384': 'Bảo hiểm y tế',
    '3385': 'Bảo hiểm thất nghiệp',
    '3386': 'Nhận ký quỹ, ký cược',
    '3387': 'Doanh thu chưa thực hiện',
    '3388': 'Phải trả, phải nộp khác',
    '341': 'Vay và nợ thuê tài chính',
    '3411': 'Các khoản đi vay',
    '3412': 'Nợ thuê tài chính',
    '352': 'Dự phòng phải trả',
    '3521': 'Dự phòng bảo hành sản phẩm hàng hoá',
    '3522': 'Dự phòng bảo hành công trình xây dựng',
    '3524': 'Dự phòng phải trả khác',
    '353': 'Quỹ khen thưởng Phúc Lợi',
    '3531': 'Quỹ khen thưởng',
    '3532': 'Quỹ phúc lợi',
    '3533': 'Quỹ phúc lợi đã hình thành TSCĐ',
    '3534': 'Quỹ thưởng ban quản lý điều hành công ty',
    '356': 'Quỹ phát triển khoa học và công nghệ',
    '3561': 'Quỹ phát triển khoa học và công nghệ',
    '3562': 'Quỹ phát triển khoa học và công nghệ đã hình thành TSCĐ',
    '4111': 'Vốn đầu tư của chủ sở hữu',
    '4112': 'Thặng dư vốn cổ phần',
    '4118': 'Vốn khác',
    '413': 'Chênh lệch tỷ giá hối đoái',
    '418': 'Các quỹ thuộc vốn chủ sở hữu',
    '419': 'Cổ phiếu quỹ',
    '421': 'Lợi nhuận sau thuế chưa phân phối',
    '4211': 'Lợi nhuận sau thuế chưa phân phối năm trước',
    '4212': 'Lợi nhuận sau thuế chưa phân phối năm nay',
    '511': 'Doanh thu bán hàng và cung cấp dịch vụ',
    '5111': 'Doanh thu bán hàng hoá',
    '5112': 'Doanh thu bán thành phẩm',
    '5113': 'Doanh thu cung cấp dịch vụ',
    '5118': 'Doanh thu khác',
    '515': 'Doanh thu hoạt động tài chính',
    '611': 'Mua hàng',
    '631': 'Giá thành sản xuất',
    '632': 'Giá vốn hàng bán',
    '635': 'Chi phí tài chính',
    '642': 'Chi phí quản lý doanh nghiệp',
    '6421': 'Chi phí bán hàng',
    '6422': 'Chi phí quản lý doanh nghiệp',
    '6423': 'Chi phí đồ dùng văn phòng',
    '6424': 'Chi phí khấu hao TSCĐ',
    '6425': 'Thuế, phí và lệ phí',
    '6426': 'Chi phí dự phòng',
    '6427': 'Chi phí dịch vụ mua ngoài',
    '6428': 'Chi phí bằng tiền khác',
    '711': 'Thu nhập khác',
    '811': 'Chi phí khác',
    '821': 'Chi phí thuế thu nhập doanh nghiệp',
    '911': 'Xác định kết quả kinh doanh',
  };

  const isOpeningEntry = (e: JournalEntry) => {
    const ref = String(e.referenceId || '').toUpperCase();
    const desc = String(e.description || '').toLowerCase();
    return ref.startsWith('OPENING') || desc.includes('số dư đầu kỳ');
  };

  const nameByCode = useMemo(() => {
    const map = new Map<string, string>();
    (accounts || []).forEach(a => map.set(String(a.code), String(a.name)));
    return map;
  }, [accounts]);

  const displayCodes = useMemo(() => {
    // "Xoá dữ liệu các tài khoản hiện có" => only show the requested list, in that exact order.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of TRIAL_BALANCE_CODES) {
      const code = String(c);
      if (!/^\d+$/.test(code)) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
    return out;
  }, []);

  const metricsByLeaf = useMemo(() => {
    type Metric = { openingNet: number; periodDebit: number; periodCredit: number };
    const map = new Map<string, Metric>();

    const ensure = (code: string) => {
      const k = String(code);
      if (!map.has(k)) map.set(k, { openingNet: 0, periodDebit: 0, periodCredit: 0 });
      return map.get(k)!;
    };

    for (const e of entries) {
      const openingWindow = e.date < startStr || (isOpeningEntry(e) && e.date <= startStr);
      const inPeriod = e.date >= startStr && e.date <= endStr && !isOpeningEntry(e);

      for (const d of journalEntryDetailsArray(e)) {
        const acc = normalizeLedgerAccountCode(d.account);
        if (!acc) continue;
        const debit = Number(d.debit || 0);
        const credit = Number(d.credit || 0);
        const m = ensure(acc);

        if (openingWindow) m.openingNet += debit - credit;
        if (inPeriod) {
          m.periodDebit += debit;
          m.periodCredit += credit;
        }
      }
    }

    return map;
  }, [entries, startStr, endStr]);

  const calcForCode = (code: string) => {
    let openingNet = 0;
    let periodDebit = 0;
    let periodCredit = 0;

    if (
      code === '111' ||
      code === '112' ||
      code === '242' ||
      code === '611' ||
      code === '631' ||
      code === '632' ||
      code === '635' ||
      code === '642' ||
      code === '6421' ||
      code === '6422'
    ) {
      for (const [accountCode, metric] of metricsByLeaf.entries()) {
        if (!accountCode.startsWith(code)) continue;
        openingNet += metric.openingNet;
        periodDebit += metric.periodDebit;
        periodCredit += metric.periodCredit;
      }
    } else {
      const m = metricsByLeaf.get(code) || { openingNet: 0, periodDebit: 0, periodCredit: 0 };
      openingNet = m.openingNet;
      periodDebit = m.periodDebit;
      periodCredit = m.periodCredit;
    }

    const closingNet = openingNet + (periodDebit - periodCredit);
    return {
      openingDebit: openingNet > 0 ? openingNet : 0,
      openingCredit: openingNet < 0 ? Math.abs(openingNet) : 0,
      periodDebit,
      periodCredit,
      closingDebit: closingNet > 0 ? closingNet : 0,
      closingCredit: closingNet < 0 ? Math.abs(closingNet) : 0,
    };
  };

  const totals = useMemo(() => {
    let openingDebit = 0;
    let openingCredit = 0;
    let periodDebit = 0;
    let periodCredit = 0;
    let closingDebit = 0;
    let closingCredit = 0;

    for (const code of displayCodes) {
      // Tổng cộng: chỉ cộng dồn tài khoản tổng hợp 3 chữ số — không cộng lại tài khoản con (4+ số).
      if (code.length !== 3) continue;
      const m = calcForCode(code);
      openingDebit += m.openingDebit;
      openingCredit += m.openingCredit;
      periodDebit += m.periodDebit;
      periodCredit += m.periodCredit;
      closingDebit += m.closingDebit;
      closingCredit += m.closingCredit;
    }

    return { openingDebit, openingCredit, periodDebit, periodCredit, closingDebit, closingCredit };
  }, [displayCodes, metricsByLeaf]);

  const groupLabelByFirstDigit: Record<string, string> = {
    '1': 'LOẠI TÀI KHOẢN TÀI SẢN NGẮN HẠN',
    '2': 'LOẠI TÀI KHOẢN TÀI SẢN DÀI HẠN',
    '3': 'LOẠI TÀI KHOẢN NỢ PHẢI TRẢ',
    '4': 'LOẠI TÀI KHOẢN VỐN CHỦ SỞ HỮU',
    '5': 'LOẠI TÀI KHOẢN DOANH THU',
    '6': 'LOẠI TÀI KHOẢN CHI PHÍ SẢN XUẤT, KINH DOANH',
    '7': 'LOẠI TÀI KHOẢN THU NHẬP KHÁC',
    '8': 'LOẠI TÀI KHOẢN CHI PHÍ KHÁC',
    '9': 'TÀI KHOẢN XÁC ĐỊNH KẾT QUẢ KINH DOANH',
  };

  const rows = useMemo(() => {
    const out: Array<
      | { kind: 'group'; label: string }
      | { kind: 'account'; code: string; name: string; level: number; isMajor: boolean; m: ReturnType<typeof calcForCode> }
      | { kind: 'total'; label: string }
    > = [];

    let lastGroup: string | null = null;

    for (const code of displayCodes) {
      if (!code || !/^\d+$/.test(code)) continue;
      const first = code[0];
      if (first !== lastGroup) {
        lastGroup = first;
        out.push({ kind: 'group', label: groupLabelByFirstDigit[first] || `NHÓM TÀI KHOẢN ${first}xx` });
      }

      // Ưu tiên tên chuẩn theo mẫu báo cáo TT133; danh mục user chỉ dùng khi không có trong bảng tên cố định.
      const name = TRIAL_BALANCE_NAME_BY_CODE[code] || nameByCode.get(code) || '';
      // Force major-level rows only
      const level = Math.max(0, code.length - 3);
      const isMajor = code.length === 3;
      out.push({ kind: 'account', code, name, level, isMajor, m: calcForCode(code) });
    }

    out.push({ kind: 'total', label: 'Tổng cộng' });
    return out;
  }, [displayCodes, nameByCode, metricsByLeaf]);

  const fmt = (n: number) => formatCurrency(n).replace('₫', '').trim();

  return (
    <div className="mx-auto w-full max-w-[1100px] text-black font-sans print:max-w-none">
      <div className="text-center mb-3">
        <h1 className="text-[22px] font-black uppercase tracking-tight leading-none text-blue-900">BẢNG CÂN ĐỐI TÀI KHOẢN</h1>
        <p className="italic text-[11px] mt-1 text-slate-600">(Ban hành theo Thông tư số 133/2016/TT-BTC ngày 26/8/2016 của Bộ Tài chính)</p>
        <p className="font-bold text-sm mt-3">Năm {year}</p>
      </div>

      <ReportTaxpayerInfoCollapse>
        <div className="space-y-1 text-[13px] leading-relaxed">
          <p>
            <span className="font-bold">Người nộp thuế:</span> <span className="uppercase">{companyInfo.name}</span>
          </p>
          <p>
            <span className="font-bold">Mã số thuế:</span>{' '}
            <span className="font-mono tracking-widest">{companyInfo.taxCode}</span>
          </p>
          <p>
            <span className="font-bold">Tên đại lý thuế (nếu có):</span>{' '}
            ........................................................................................
          </p>
          <p>
            <span className="font-bold">Mã số thuế:</span>{' '}
            ..................................................................................................................
          </p>
        </div>
      </ReportTaxpayerInfoCollapse>

      <div className="flex items-center gap-2 mb-3 text-[12px]">
        <div className="w-5 h-5 border border-black flex items-center justify-center font-bold text-[10px]"> </div>
        <span>Hỗ trợ lấy dữ liệu năm trước</span>
      </div>

      <div className="flex justify-end mb-2">
        <p className="italic text-[12px]">Đơn vị tiền: Đồng Việt Nam</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse border border-black min-w-[980px]">
          <thead className="font-bold text-center bg-slate-100">
            <tr>
              <th rowSpan={2} className="p-2 border border-black w-28">Số hiệu<br/>tài khoản</th>
              <th rowSpan={2} className="p-2 border border-black w-[320px]">Tên tài khoản</th>
              <th colSpan={2} className="p-2 border border-black">Số dư đầu kỳ</th>
              <th colSpan={2} className="p-2 border border-black">Số phát sinh trong kỳ</th>
              <th colSpan={2} className="p-2 border border-black">Số dư cuối kỳ</th>
            </tr>
            <tr className="bg-slate-50">
              <th className="p-2 border border-black w-28">Nợ</th>
              <th className="p-2 border border-black w-28">Có</th>
              <th className="p-2 border border-black w-28">Nợ</th>
              <th className="p-2 border border-black w-28">Có</th>
              <th className="p-2 border border-black w-28">Nợ</th>
              <th className="p-2 border border-black w-28">Có</th>
            </tr>
            <tr className="bg-slate-50 text-[11px] font-normal">
              <th className="p-1 border border-black">A</th>
              <th className="p-1 border border-black">B</th>
              <th className="p-1 border border-black">1</th>
              <th className="p-1 border border-black">2</th>
              <th className="p-1 border border-black">3</th>
              <th className="p-1 border border-black">4</th>
              <th className="p-1 border border-black">5</th>
              <th className="p-1 border border-black">6</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r.kind === 'group') {
                return (
                  <tr key={`g_${idx}`} className="bg-cyan-100">
                    <td className="p-2 border border-black font-bold text-center" colSpan={8}>{r.label}</td>
                  </tr>
                );
              }
              if (r.kind === 'total') {
                return (
                  <tr key={`t_${idx}`} className="bg-cyan-50 font-black">
                    <td className="p-2 border border-black text-center" colSpan={2}>{r.label}</td>
                    <td className="p-2 border border-black text-right font-mono">{fmt(totals.openingDebit)}</td>
                    <td className="p-2 border border-black text-right font-mono">{fmt(totals.openingCredit)}</td>
                    <td className="p-2 border border-black text-right font-mono">{fmt(totals.periodDebit)}</td>
                    <td className="p-2 border border-black text-right font-mono">{fmt(totals.periodCredit)}</td>
                    <td className="p-2 border border-black text-right font-mono">{fmt(totals.closingDebit)}</td>
                    <td className="p-2 border border-black text-right font-mono">{fmt(totals.closingCredit)}</td>
                  </tr>
                );
              }

              const { code, name, level, isMajor, m } = r;
              const rowCls = isMajor ? 'bg-cyan-50 font-bold' : '';
              const indentPx = Math.min(28, level * 14);

              return (
                <tr key={code} className={rowCls}>
                  <td className="p-2 border border-black text-center font-mono font-bold">{code}</td>
                  <td className="p-2 border border-black" style={{ paddingLeft: `${8 + indentPx}px` }}>
                    {name || <span className="text-slate-400 italic">(Chưa khai báo)</span>}
                  </td>
                  <td className="p-2 border border-black text-right font-mono">{m.openingDebit ? fmt(m.openingDebit) : '0'}</td>
                  <td className="p-2 border border-black text-right font-mono">{m.openingCredit ? fmt(m.openingCredit) : '0'}</td>
                  <td className="p-2 border border-black text-right font-mono">{m.periodDebit ? fmt(m.periodDebit) : '0'}</td>
                  <td className="p-2 border border-black text-right font-mono">{m.periodCredit ? fmt(m.periodCredit) : '0'}</td>
                  <td className="p-2 border border-black text-right font-mono">{m.closingDebit ? fmt(m.closingDebit) : '0'}</td>
                  <td className="p-2 border border-black text-right font-mono">{m.closingCredit ? fmt(m.closingCredit) : '0'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const CashFlow = ({
    entries,
    year,
    financialYear,
    companyInfo,
    cashFlowOpening,
    reportMeta,
}: {
    entries: JournalEntry[];
    year: number;
    financialYear: { startDate: string; endDate: string };
    companyInfo: CompanyInfo;
    cashFlowOpening: Record<string, number>;
    reportMeta: CashFlowReportMeta;
}) => {
    // Use the active financial year boundaries (multi-year), not hard-coded calendar year.
    const startStr = financialYear.startDate;
    const endStr = financialYear.endDate;

    const isOpeningEntry = (e: JournalEntry) => {
        const ref = (e.referenceId || '').toUpperCase();
        const desc = (e.description || '').toLowerCase();
        return ref.startsWith('OPENING') || desc.includes('số dư đầu kỳ');
    };

    const getDetailedFlow = (
        type: 'DEBIT' | 'CREDIT', 
        offsetPrefixes: string[] | null = null, 
        excludeOffsetPrefixes: string[] | null = null
    ) => {
        return entries
            // Exclude opening-balance entries so they don't show up as in-year cash flows
            .filter(e => e.date >= startStr && e.date <= endStr && !isOpeningEntry(e))
            .reduce((acc, entry) => {
                const details = journalEntryDetailsArray(entry);
                const moneyParts = details.filter(d => (String(d.account).startsWith('111') || String(d.account).startsWith('112')));
                
                return acc + moneyParts.reduce((sum, mp) => {
                    const isCorrectSide = type === 'DEBIT' ? mp.debit > 0 : mp.credit > 0;
                    if (!isCorrectSide) return sum;

                    const offsets = details.filter(d => d.account !== mp.account);
                    const matchesOffset = !offsetPrefixes || offsets.some(o => offsetPrefixes.some(p => o.account.startsWith(p)));
                    const isExcluded = excludeOffsetPrefixes && offsets.some(o => excludeOffsetPrefixes.some(p => o.account.startsWith(p)));

                    if (matchesOffset && !isExcluded) {
                        return sum + (type === 'DEBIT' ? mp.debit : mp.credit);
                    }
                    return sum;
                }, 0);
            }, 0);
    };

    const thu_01 = getDetailedFlow('DEBIT', ['511', '131', '515', '711']); 
    const chi_02 = getDetailedFlow('CREDIT', ['331', '152', '156', '641', '642'], ['211', '213', '241']);
    const chi_03 = getDetailedFlow('CREDIT', ['334']);
    // IMPORTANT: 06/07 are NOT a "bucket". We do not auto-fill them from inferred/uncategorized cash movements.
    // They must be explicitly classified by business logic (future: cash_flow_code).
    const thu_06 = 0;
    const chi_07 = 0;
    const lct_20 = thu_01 - chi_02 - chi_03;

    const chi_21 = getDetailedFlow('CREDIT', ['211', '213', '241']);
    const thu_22 = getDetailedFlow('DEBIT', ['711']); 
    const lct_30 = thu_22 - chi_21;

    const thu_31 = getDetailedFlow('DEBIT', ['411']);
    const chi_32 = getDetailedFlow('CREDIT', ['411', '421']);
    const lct_40 = thu_31 - chi_32;

    const netCash_50 = lct_20 + lct_30 + lct_40;

    const openingCash_60 = reportMeta.openingCash60;
    const closingCash_70 = reportMeta.closingCash70;
    const hasFxCash = entries
      .filter(e => e.date >= startStr && e.date <= endStr)
      .some(e => journalEntryDetailsArray(e).some(d => String(d.account).startsWith('1112') || String(d.account).startsWith('1122')));

    // If there is NO foreign currency cash (no 1112/1122), mã 61 must be 0.
    // We do NOT "auto-patch" differences into 06/07.
    const exchange_61 = hasFxCash ? (closingCash_70 - netCash_50 - openingCash_60) : 0;

    const rows = [
        { label: 'I. Lưu chuyển tiền từ hoạt động kinh doanh', code: '', value: null, bold: true },
        { label: '1. Tiền thu từ bán hàng, cung cấp dịch vụ và doanh thu khác', code: '01', value: thu_01, indent: 1 },
        { label: '2. Tiền chi trả cho người cung cấp hàng hóa, dịch vụ', code: '02', value: -chi_02, indent: 1 },
        { label: '3. Tiền chi trả cho người lao động', code: '03', value: -chi_03, indent: 1 },
        { label: '4. Tiền lãi vay đã trả', code: '04', value: 0, indent: 1 },
        { label: '5. Thuế thu nhập doanh nghiệp đã nộp', code: '05', value: 0, indent: 1 },
        { label: '6. Tiền thu khác từ hoạt động kinh doanh', code: '06', value: thu_06, indent: 1 },
        { label: '7. Tiền chi khác cho hoạt động kinh doanh', code: '07', value: -chi_07, indent: 1 },
        { label: 'Lưu chuyển tiền thuần từ hoạt động kinh doanh', code: '20', value: lct_20, bold: true, bg: 'bg-slate-50' },

        { label: 'II. Lưu chuyển tiền từ hoạt động đầu tư', code: '', value: null, bold: true, mt: 'mt-4' },
        { label: '1. Tiền chi để mua sắm, xây dựng TSCĐ, BĐSĐT và các tài sản dài hạn khác', code: '21', value: -chi_21, indent: 1 },
        { label: '2. Tiền thu từ thanh lý, nhượng bán TSCĐ, BĐSĐT và các tài sản dài hạn khác', code: '22', value: thu_22, indent: 1 },
        { label: '3. Tiền chi cho vay, đầu tư góp vốn vào đơn vị khác', code: '23', value: 0, indent: 1 },
        { label: '4. Tiền thu hồi cho vay, đầu tư góp vốn vào đơn vị khác', code: '24', value: 0, indent: 1 },
        { label: '5. Tiền thu lãi cho vay, cổ tức và lợi nhuận được chia', code: '25', value: 0, indent: 1 },
        { label: 'Lưu chuyển tiền thuần từ hoạt động đầu tư', code: '30', value: lct_30, bold: true, bg: 'bg-slate-50' },

        { label: 'III. Lưu chuyển tiền từ hoạt động tài chính', code: '', value: null, bold: true, mt: 'mt-4' },
        { label: '1. Tiền thu từ phát hành cổ phiếu, nhận vốn góp của chủ sở hữu', code: '31', value: thu_31, indent: 1 },
        { label: '2. Tiền trả lại vốn góp cho các chủ sở hữu, mua lại cổ phiếu của doanh nghiệp đã phát hành', code: '32', value: -chi_32, indent: 1 },
        { label: '3. Tiền thu từ đi vay', code: '33', value: 0, indent: 1 },
        { label: '4. Tiền trả nợ gốc vay và nợ thuê tài chính', code: '34', value: 0, indent: 1 },
        { label: '5. Cổ tức, lợi nhuận đã trả cho chủ sở hữu', code: '35', value: 0, indent: 1 },
        { label: 'Lưu chuyển tiền thuần từ hoạt động tài chính', code: '40', value: lct_40, bold: true, bg: 'bg-slate-50' },

        { label: 'Lưu chuyển tiền thuần trong kỳ (50 = 20 + 30 + 40)', code: '50', value: netCash_50, bold: true, bg: 'bg-blue-50' },
        // This is a beginning balance, show it in the "Số đầu năm" column (not "Năm nay")
        { label: 'Tiền và tương đương tiền đầu kỳ', code: '60', value: null, opening: openingCash_60, bold: true },
        { label: 'Ảnh hưởng của thay đổi tỷ giá hối đoái quy đổi ngoại tệ', code: '61', value: exchange_61, bold: true },
        { label: 'Tiền và tương đương tiền cuối kỳ (70 = 50 + 60 + 61)', code: '70', value: closingCash_70, bold: true, bg: 'bg-blue-100' },
    ];

    return (
        <div className="mx-auto w-full max-w-6xl text-black font-sans print:max-w-none">
            <div className="text-center mb-4">
                <h1 className="text-[24px] font-black uppercase tracking-tight leading-none text-blue-900">BÁO CÁO LƯU CHUYỂN TIỀN TỆ</h1>
                <p className="font-bold text-sm mt-1">(Theo phương pháp trực tiếp)</p>
                <p className="italic text-[11px] mt-1 text-slate-600">(Ban hành theo Thông tư số 133/2016/TT-BTC ngày 26/8/2016 của Bộ Tài chính)</p>
                <p className="font-bold text-sm mt-4">Năm {year}</p>
            </div>

            <div className="space-y-3 mb-5">
                {reportMeta.systemNote && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                        {reportMeta.systemNote}
                    </div>
                )}
                {reportMeta.isOpeningCrossCheckMismatch && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
                        Số dư đầu kỳ trên B03-DNN chưa khớp với sổ cái tài khoản tiền. Mã số 60 hiện là {formatCurrency(reportMeta.openingCash60).replace('₫', '').trim()}, trong khi số dư đầu kỳ đối chiếu từ sổ cái là {formatCurrency(reportMeta.expectedOpeningCash60).replace('₫', '').trim()}.
                    </div>
                )}
                {reportMeta.requiresZeroOpeningConfirmation && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                        Mã số 60 hiện đang bằng 0. Khi in hoặc xuất báo cáo, hệ thống sẽ yêu cầu bạn xác nhận doanh nghiệp bắt đầu kỳ này với 0 đồng tiền mặt/tiền gửi.
                    </div>
                )}
                {reportMeta.isClosingCashNegative && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
                        Tiền cuối kỳ không được phép âm. Vui lòng kiểm tra lại số dư đầu kỳ hoặc các bút toán chi tiền.
                    </div>
                )}
            </div>

            <table className="w-full text-[13px] border-collapse border border-black">
                <thead className="font-bold text-center bg-slate-100">
                    <tr>
                        <th className="p-2 border border-black w-[50%]">Chỉ tiêu</th>
                        <th className="p-2 border border-black w-16">Mã số</th>
                        <th className="p-2 border border-black w-20">Thuyết minh</th>
                        <th className="p-2 border border-black w-32">Năm nay</th>
                        <th className="p-2 border border-black w-32">Số đầu năm</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, idx) => (
                        <tr key={idx} className={`${row.bg || ''} ${row.mt || ''}`}>
                            <td
                              className={`border border-black p-2 ${row.bold ? 'font-bold' : ''}`}
                              style={{ paddingLeft: `${(row.indent || 0) * 20 + 8}px` }}
                            >
                              {row.label}
                            </td>
                            <td className="border border-black p-2 text-center font-mono font-bold">{row.code}</td>
                            <td className="border border-black p-2"></td>
                            <td className={`border border-black p-2 text-right font-mono ${row.bold ? 'font-bold' : ''}`}>
                                {row.value !== null ? formatCurrency(row.value).replace('₫', '').trim() : ''}
                            </td>
                            <td className={`border border-black p-2 text-right font-mono ${
                                row.code === '60' && reportMeta.isOpeningCrossCheckMismatch
                                    ? 'bg-rose-100 text-rose-700 font-black'
                                    : row.code === '60' && reportMeta.requiresZeroOpeningConfirmation
                                        ? 'bg-amber-50 text-amber-700 font-black'
                                        : 'text-slate-500'
                            }`}>
                                {row.code === '60'
                                  ? formatCurrency(reportMeta.openingCash60).replace('₫', '').trim()
                                  : (row.code && cashFlowOpening && typeof cashFlowOpening[row.code] === 'number'
                                      ? formatCurrency(cashFlowOpening[row.code]).replace('₫', '').trim()
                                      : ((row as any).opening !== undefined && (row as any).opening !== null
                                          ? formatCurrency((row as any).opening).replace('₫', '').trim()
                                          : ''))}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            
            <div className="mt-10 grid grid-cols-3 gap-8 text-center text-sm font-bold">
                <div>
                    <p className="uppercase">NGƯỜI LẬP BIỂU</p>
                    <p className="mt-1 text-xs font-normal italic">(Ký, họ tên)</p>
                    <div className="h-16"></div>
                </div>
                <div>
                    <p className="uppercase">KẾ TOÁN TRƯỞNG</p>
                    <p className="mt-1 text-xs font-normal italic">(Ký, họ tên)</p>
                    <div className="h-16"></div>
                </div>
                <div>
                    <p className="uppercase">GIÁM ĐỐC</p>
                    <p className="mt-1 text-xs font-normal italic">(Ký, họ tên, đóng dấu)</p>
                    <div className="h-16"></div>
                </div>
            </div>
        </div>
    );
};

const FinancialNotes = ({
  year,
  journalEntries,
  financialYear,
  companyInfo,
  cashFlowMeta,
  invoices,
  customers,
  suppliers,
}: {
  year: number;
  journalEntries: JournalEntry[];
  financialYear: FinancialYear;
  companyInfo: CompanyInfo;
  cashFlowMeta: CashFlowReportMeta;
  invoices: Invoice[];
  customers: { id: string; name?: string }[];
  suppliers: { id: string; name?: string }[];
}) => {
  const je = asArray(journalEntries);
  const inv = asArray(invoices);
  const cust = asArray(customers);
  const sup = asArray(suppliers);

  const m = useMemo(() => computeB09FinancialMetrics(je, financialYear), [je, financialYear]);
  const b01 = useMemo(() => computeB01bTotals(je, financialYear.endDate), [je, financialYear.endDate]);

  const periodLabel = useMemo(() => {
    const s = new Date(`${financialYear.startDate}T12:00:00`);
    const e = new Date(`${financialYear.endDate}T12:00:00`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '—';
    return `${s.toLocaleDateString('vi-VN')} đến ${e.toLocaleDateString('vi-VN')}`;
  }, [financialYear.startDate, financialYear.endDate]);

  const invoiceStats = useMemo(() => {
    const start = financialYear.startDate;
    const end = financialYear.endDate;
    const sales = inv.filter(
      i => i.type === 'SALES' && i.date >= start && i.date <= end,
    );
    const count = sales.length;
    const total = sales.reduce((s, i) => s + Number(i.totalAmount || 0), 0);
    return { count, total };
  }, [inv, financialYear.startDate, financialYear.endDate]);

  const fmt = (n: number) =>
    formatCurrency(Number.isFinite(n) ? n : 0)
      .replace('₫', '')
      .trim();

  return (
    <div className="mx-auto w-full max-w-5xl text-black font-sans print:max-w-none">
      <div className="text-center mb-4">
        <h2 className="text-[20px] font-black uppercase tracking-tight leading-none text-blue-900">THUYẾT MINH BÁO CÁO TÀI CHÍNH</h2>
        <p className="italic text-[11px] mt-1 text-slate-600">(Ban hành theo Thông tư số 133/2016/TT-BTC — B09-DNN)</p>
        <p className="font-bold text-sm mt-3">Niên độ kế toán năm {year}</p>
        <p className="text-xs text-slate-600 mt-1">Kỳ số liệu: {periodLabel}</p>
      </div>

      <div className="space-y-7 text-[13px] leading-relaxed">
        <ReportTaxpayerInfoCollapse>
          <section>
            <h3 className="mb-3 border-b border-slate-200 pb-1 font-bold text-blue-900">BÁO CÁO KÈM THEO</h3>
            <p>
              <span className="font-bold">Đơn vị:</span>{' '}
              <span className="uppercase">{companyInfo?.name || '—'}</span>
            </p>
            <p>
              <span className="font-bold">Mã số thuế:</span>{' '}
              <span className="font-mono tracking-widest">{companyInfo?.taxCode || '—'}</span>
            </p>
          </section>
        </ReportTaxpayerInfoCollapse>

        <section>
          <h3 className="font-bold border-b border-slate-200 pb-1 mb-3 text-blue-900">I. Đặc điểm hoạt động của doanh nghiệp</h3>
          <p>
            Doanh nghiệp hoạt động trong lĩnh vực thương mại dịch vụ và quản lý thiết bị công nghệ (phần mềm quản lý thiết bị, định vị
            GPS, camera…). Thuyết minh được lập trên cơ sở số liệu đã ghi nhận trên hệ thống kế toán của đơn vị.
          </p>
        </section>

        <section>
          <h3 className="font-bold border-b border-slate-200 pb-1 mb-3 text-blue-900">II. Kỳ kế toán, đơn vị tiền tệ</h3>
          <p>
            <span className="font-bold">Kỳ kế toán:</span> {periodLabel}.
          </p>
          <p>
            <span className="font-bold">Đơn vị tiền tệ:</span> Đồng Việt Nam (VND). Các số trình bày trong thuyết minh đồng nhất với
            B01b-DNN, B02-DNN, B03-DNN trên cùng niên độ.
          </p>
        </section>

        <section>
          <h3 className="font-bold border-b border-slate-200 pb-1 mb-3 text-blue-900">III. Cơ sở lập báo cáo và nguồn số liệu</h3>
          <p>
            <span className="font-bold">Nguồn dữ liệu:</span> Số liệu được tổng hợp tự động từ <b>Sổ nhật ký chung</b> và các bút toán
            phát sinh trên hệ thống (hóa đơn, chứng từ kho, quỹ, tài sản…). Các chỉ tiêu dưới đây phản ánh cùng logic mapping tài khoản
            với B01b/B02/B03 (TT133).
          </p>
          <p className="mt-2 text-slate-700">
            <span className="font-bold">Đối chiếu cân đối:</span> Tổng tài sản (mã 300) = {fmt(m.b01b.totalAssets_300)}; tổng nguồn vốn
            (mã 600) = {fmt(m.b01b.totalSources_600)}; chênh lệch = {fmt(m.b01b.totalAssets_300 - m.b01b.totalSources_600)}; trạng thái:{' '}
            {b01.isBalanced ? (
              <span className="text-emerald-700 font-bold">khớp cân đối</span>
            ) : (
              <span className="text-rose-700 font-bold">chưa khớp — cần rà soát bút toán trước khi lập báo cáo chính thức</span>
            )}
            .
          </p>
        </section>

        <section>
          <h3 className="font-bold border-b border-slate-200 pb-1 mb-3 text-blue-900">IV. Thuyết minh Bảng cân đối kế toán (B01b-DNN)</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <span className="font-bold">Tiền và tương đương tiền (nhóm 110):</span> Số dư cuối kỳ phản ánh tài khoản tiền mặt/tiền gửi
              (111*, 112…): <b>{fmt(m.b01b.cash_110)}</b> đồng.
            </li>
            <li>
              <span className="font-bold">Các khoản phải thu, phải trả ngắn hạn (nhóm 130):</span> Tổng <b>{fmt(m.b01b.group130)}</b>{' '}
              đồng, trong đó phải thu khách hàng (131) <b>{fmt(m.b01b.receivables131)}</b>, trả trước cho người bán (331) — đối chiếu
              phần tài sản <b>{fmt(m.b01b.prepaid331)}</b>, phải thu khác (136/138…) <b>{fmt(m.b01b.otherReceivables133)}</b>.
            </li>
            <li>
              <span className="font-bold">Hàng tồn kho (141):</span> Giá trị hàng tồn kho (151–156…): <b>{fmt(m.b01b.inventory_141)}</b>{' '}
              đồng.
            </li>
            <li>
              <span className="font-bold">Tài sản cố định và tài sản dài hạn khác (220):</span> Giá trị hợp nhất TSCĐ và khấu hao lũy kế
              (211/213/214…): <b>{fmt(m.b01b.fixedAssets_220)}</b> đồng.
            </li>
            <li>
              <span className="font-bold">Phải trả người bán (411):</span> <b>{fmt(m.b01b.payables411)}</b> đồng.{' '}
              <span className="font-bold">Phải trả khách hàng (412):</span> <b>{fmt(m.b01b.customerAdvances412)}</b> đồng.
            </li>
            <li>
              <span className="font-bold">Vay và nợ thuê tài chính ngắn hạn (416 — nhóm 341):</span> <b>{fmt(m.b01b.loans341_416)}</b>
              đồng.
            </li>
          </ul>
          <p className="mt-3 text-slate-600 text-[12px]">
            Chi tiết theo từng tài khoản có thể đối chiếu tại Sổ cái / Sổ chiết tài khoản và Bảng cân đối tài khoản trên hệ thống.
          </p>
        </section>

        <section>
          <h3 className="font-bold border-b border-slate-200 pb-1 mb-3 text-blue-900">V. Thuyết minh Báo cáo kết quả hoạt động kinh doanh (B02-DNN)</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <span className="font-bold">Doanh thu bán hàng và cung cấp dịch vụ (01):</span> Phát sinh Có TK 511 trong kỳ:{' '}
              <b>{fmt(m.b02.revenue01)}</b> đồng.
            </li>
            <li>
              <span className="font-bold">Giá vốn hàng bán (11):</span> Phát sinh Nợ TK 632: <b>{fmt(m.b02.cogs11)}</b> đồng.
            </li>
            <li>
              <span className="font-bold">Chi phí tài chính (22):</span> Phát sinh Nợ TK 635: <b>{fmt(m.b02.finExp22)}</b> đồng;{' '}
              <span className="font-bold">Doanh thu tài chính (21):</span> Có TK 515: <b>{fmt(m.b02.finRev21)}</b> đồng.
            </li>
            <li>
              <span className="font-bold">Chi phí quản lý doanh nghiệp (24):</span> Phát sinh Nợ TK 642: <b>{fmt(m.b02.admin24)}</b> đồng.
            </li>
            <li>
              <span className="font-bold">Lợi nhuận:</span> Lợi nhuận thuần từ HĐKD (30) = <b>{fmt(m.b02.netOp30)}</b>; lợi nhuận kế toán
              trước thuế (50) = <b>{fmt(m.b02.pbt50)}</b>; lợi nhuận sau thuế (60) = <b>{fmt(m.b02.pat60)}</b> đồng.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-bold border-b border-slate-200 pb-1 mb-3 text-blue-900">VI. Thuyết minh Báo cáo lưu chuyển tiền tệ (B03-DNN — phương pháp trực tiếp)</h3>
          <p>
            <span className="font-bold">Luồng tiền từ hoạt động kinh doanh (20):</span> Lưu chuyển tiền thuần = <b>{fmt(m.b03.lct20)}</b>{' '}
            đồng (đối chiếu mã 01–03, 20 trên B03).
          </p>
          <p>
            <span className="font-bold">Luồng tiền từ hoạt động đầu tư (30):</span> <b>{fmt(m.b03.lct30)}</b> đồng (mua TSCĐ, thanh lý…).
          </p>
          <p>
            <span className="font-bold">Luồng tiền từ hoạt động tài chính (40):</span> <b>{fmt(m.b03.lct40)}</b> đồng (góp vốn, trả vốn…).
          </p>
          <p>
            <span className="font-bold">Lưu chuyển tiền thuần trong kỳ (50):</span> <b>{fmt(m.b03.net50)}</b> đồng.
          </p>
          <p className="mt-2">
            <span className="font-bold">Tiền và tương đương tiền đầu kỳ (60):</span> <b>{fmt(cashFlowMeta.openingCash60)}</b> đồng;{' '}
            <span className="font-bold">cuối kỳ (70):</span> <b>{fmt(cashFlowMeta.closingCash70)}</b> đồng.
            {cashFlowMeta.isOpeningCrossCheckMismatch && (
              <span className="block text-rose-700 text-[12px] mt-1">
                Lưu ý: Số đầu kỳ B03 đang lệch so với sổ cái tiền — cần điều chỉnh trước khi ban hành báo cáo.
              </span>
            )}
          </p>
        </section>

        <section>
          <h3 className="font-bold border-b border-slate-200 pb-1 mb-3 text-blue-900">VII. Đối chiếu với chứng từ và danh mục</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <span className="font-bold">Hóa đơn bán hàng trong kỳ:</span> {invoiceStats.count} chứng từ, tổng giá trị thanh toán (gross){' '}
              <b>{fmt(invoiceStats.total)}</b> đồng (theo danh sách hóa đơn niên độ).
            </li>
            <li>
              <span className="font-bold">Danh mục khách hàng:</span> {cust.length} mã; <span className="font-bold">nhà cung cấp:</span>{' '}
              {sup.length} mã — dùng để đối chiếu công nợ 131/331.
            </li>
            <li>
              Khấu hao TSCĐ, chi phí trả trước, phân bổ doanh thu chưa thực hiện (3387) được phản ánh qua các tài khoản 214/242/3387 trên
              sổ chi tiết tương ứng (nếu phát sinh).
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-bold border-b border-slate-200 pb-1 mb-3 text-blue-900">VIII. Chính sách kế toán áp dụng (trích yếu)</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <span className="font-bold">Ghi nhận doanh thu:</span> Doanh thu bán hàng, cung cấp dịch vụ được ghi nhận khi phần lớn rủi ro
              và lợi ích đã chuyển giao cho người mua, đồng thời có khả năng thu được lợi ích kinh tế; phù hợp với hóa đơn và chứng từ
              trên hệ thống.
            </li>
            <li>
              <span className="font-bold">Hàng tồn kho:</span> Đồng nhất với phương pháp tính giá xuất kho đang áp dụng trên module Kho (giá
              bình quân gia quyền / giá trị theo từng lần nhập — phụ thuộc cấu hình nghiệp vụ).
            </li>
            <li>
              <span className="font-bold">Tài sản cố định và khấu hao:</span> TSCĐ được theo dõi theo nguyên giá, khấu hao theo phương pháp
              đường thẳng (tùy khai báo tài sản); khấu hao phân bổ vào tài khoản chi phí phù hợp (642, 627…).
            </li>
            <li>
              <span className="font-bold">Chi phí:</span> Ghi nhận theo nguyên tắc phù hợp doanh thu và kỳ kế toán; chi phí trả trước dài
              hạn được phân bổ dần.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-bold border-b border-slate-200 pb-1 mb-3 text-blue-900">IX. Thông tin bổ sung (mẫu)</h3>
          <ul className="list-disc pl-5 space-y-2 text-slate-600">
            <li>Các khoản cam kết, nghĩa vụ tiềm tàng: (ghi nhận thủ công khi có hợp đồng bảo lãnh, kiện tụ…).</li>
            <li>Sự kiện phát sinh sau ngày kết thúc kỳ kế toán: (không có / có — mô tả).</li>
            <li>Giao dịch với các bên liên quan: (không có / có — mô tả).</li>
            <li>Rủi ro tài chính — tín dụng, thanh khoản, tỷ giá: quản lý theo chính sách nội bộ; đơn vị chưa có công cụ phái sinh phức tạp.</li>
          </ul>
        </section>
      </div>

      <div className="mt-12 grid grid-cols-3 text-center text-sm font-bold gap-8 print:mt-8">
        <div>
          <p className="uppercase">NGƯỜI LẬP BIỂU</p>
          <p className="italic font-normal text-xs mt-1">(Ký, họ tên)</p>
          <div className="h-16" />
        </div>
        <div>
          <p className="uppercase">KẾ TOÁN TRƯỞNG</p>
          <p className="italic font-normal text-xs mt-1">(Ký, họ tên)</p>
          <div className="h-16" />
        </div>
        <div>
          <p className="uppercase">GIÁM ĐỐC</p>
          <p className="italic font-normal text-xs mt-1">(Ký, họ tên, đóng dấu)</p>
          <div className="h-16" />
        </div>
      </div>
    </div>
  );
};

const arApColMoney = (n: number, colorClass: string) =>
  !n ? (
    <span className="text-slate-300">—</span>
  ) : (
    <span className={`font-mono tabular-nums font-semibold ${colorClass}`}>{formatCurrency(n)}</span>
  );

const arApRunningBalClass = (bal: number) =>
  bal > 0 ? 'text-red-700 font-bold' : bal < 0 ? 'text-amber-700 font-semibold' : 'text-slate-500';

const ReceivablesByCustomerReport = ({
  entries,
  financialYear,
  invoices,
  customers,
  suppliers,
  fundTransactions,
  companyInfo,
}: {
  entries: JournalEntry[];
  financialYear: FinancialYear;
  invoices: Invoice[];
  customers: Customer[];
  suppliers: Supplier[];
  fundTransactions: FundTransaction[];
  companyInfo: CompanyInfo;
}) => {
  const [viewMode, setViewMode] = useState<'OUTSTANDING' | 'HISTORY'>('OUTSTANDING');
  const [historyFilter, setHistoryFilter] = useState('');

  const summaryAll = useMemo(
    () => buildArApSummaryRowsByInvoice('AR', entries, financialYear.endDate, invoices, customers, suppliers),
    [entries, financialYear.endDate, invoices, customers, suppliers],
  );
  const summaryRows = useMemo(() => summaryAll.filter((r) => r.balance > 0), [summaryAll]);

  const historyLines = useMemo(
    () => buildArApMovementLines(entries, financialYear.endDate, 'AR', invoices, customers, suppliers),
    [entries, financialYear.endDate, invoices, customers, suppliers],
  );
  const historyFiltered = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return historyLines;
    return historyLines.filter(
      (l) =>
        l.displayName.toLowerCase().includes(q) ||
        l.objectKey.toLowerCase().includes(q) ||
        String(l.invoiceNumber || '').toLowerCase().includes(q) ||
        l.referenceId.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q),
    );
  }, [historyLines, historyFilter]);

  const outstandingPagination = useReportTablePagination(summaryRows, `AR-OUTSTANDING:${viewMode}`);
  const historyPagination = useReportTablePagination(historyFiltered, `AR-HISTORY:${viewMode}:${historyFilter}`);

  const totalsOutstanding = useMemo(() => {
    const td = summaryRows.reduce((s, r) => s + r.totalDebt, 0);
    const tp = summaryRows.reduce((s, r) => s + r.totalPaid, 0);
    const bal = summaryRows.reduce((s, r) => s + r.balance, 0);
    return { td, tp, bal };
  }, [summaryRows]);

  const handleRowDoubleClick = useCallback(
    (row: ArApSubledgerRow) => {
      const target = resolveArApNavTarget('AR', row, entries, financialYear.endDate, invoices, fundTransactions);
      triggerArApReportNavigation(target);
    },
    [entries, financialYear.endDate, invoices, fundTransactions],
  );

  return (
    <div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-6 text-black shadow-sm sm:p-10 print:border-none print:shadow-none">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-black uppercase tracking-tight text-blue-900">Báo cáo Nợ phải thu theo Khách hàng</h1>
        <p className="mt-2 text-xs text-slate-500">
          Theo chi tiết TK 131 (và tài khoản con 131*) trên sổ nhật ký chung — số dư tính đến{' '}
          <span className="font-bold">{financialYear.endDate}</span> (cuối niên độ hiện tại)
        </p>
        <p className="mt-4 text-sm font-bold uppercase">{companyInfo.name}</p>
        <p className="font-mono text-xs">MST: {companyInfo.taxCode || '—'}</p>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => setViewMode('OUTSTANDING')}
            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
              viewMode === 'OUTSTANDING' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Chưa thanh toán
          </button>
          <button
            type="button"
            onClick={() => setViewMode('HISTORY')}
            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
              viewMode === 'HISTORY' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Lịch sử giao dịch
          </button>
        </div>
        {viewMode === 'HISTORY' && (
          <input
            type="search"
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value)}
            placeholder="Lọc theo đối tượng, số CT, diễn giải…"
            className="w-full min-w-[12rem] max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/35 sm:w-auto"
          />
        )}
      </div>

      {viewMode === 'OUTSTANDING' ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-center text-sm">
              <thead>
                <tr className="bg-slate-100 text-center text-xs font-black text-slate-600">
                  <th className="w-12 p-3">Stt</th>
                  <th className="w-28 p-3">Mã KH</th>
                  <th className="p-3">Tên khách hàng / Đối tượng</th>
                  <th className="w-36 p-3">MST (nếu có)</th>
                  <th className="w-36 p-3">Số hóa đơn</th>
                  <th className="w-36 p-3 text-center">Phát sinh nợ (Nợ 131)</th>
                  <th className="w-36 p-3 text-center">Đã thu (Có 131)</th>
                  <th className="w-36 p-3 text-center">Còn nợ</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400">
                      Không có đối tượng nào còn dư nợ TK 131 đến ngày chốt.
                    </td>
                  </tr>
                ) : (
                  outstandingPagination.pagedItems.map((r, i) => (
                    <tr
                      key={`${r.objectKey}-${outstandingPagination.rowOffset + i}`}
                      role="button"
                      tabIndex={0}
                      title="Double-click: mở hóa đơn bán / phiếu thu Quỹ hoặc lọc danh sách hóa đơn"
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/80"
                      onDoubleClick={() => handleRowDoubleClick(r)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRowDoubleClick(r);
                      }}
                    >
                      <td className="p-3 align-middle text-slate-500">{outstandingPagination.rowOffset + i + 1}</td>
                      <td className="p-3 align-middle font-mono text-xs">{r.code || '—'}</td>
                      <td className="p-3 align-middle font-medium text-slate-800">{r.displayName}</td>
                      <td className="p-3 align-middle font-mono text-xs">{r.taxCode || '—'}</td>
                      <td className="p-3 align-middle font-mono text-xs">{r.invoiceNumber || '—'}</td>
                      <td className="p-3 align-middle text-center">{arApColMoney(r.totalDebt, 'text-red-700')}</td>
                      <td className="p-3 align-middle text-center">{arApColMoney(r.totalPaid, 'text-emerald-700')}</td>
                      <td className="p-3 align-middle text-center">{arApColMoney(r.balance, 'text-red-800')}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {summaryRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-blue-200 bg-blue-50 font-black">
                    <td colSpan={5} className="p-3 text-center text-xs uppercase">
                      Tổng cộng
                    </td>
                    <td className="p-3 text-center font-mono tabular-nums text-red-800">
                      {formatCurrency(totalsOutstanding.td)}
                    </td>
                    <td className="p-3 text-center font-mono tabular-nums text-emerald-800">
                      {formatCurrency(totalsOutstanding.tp)}
                    </td>
                    <td className="p-3 text-center font-mono tabular-nums text-red-900">
                      {formatCurrency(totalsOutstanding.bal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {summaryRows.length > 0 && (
            <Pagination
              page={outstandingPagination.page}
              totalItems={outstandingPagination.totalItems}
              pageSize={outstandingPagination.pageSize}
              pageSizeOptions={REPORT_TABLE_PAGE_SIZE_OPTIONS}
              onChangePage={outstandingPagination.setPage}
              onChangePageSize={outstandingPagination.setPageSize}
              variant="compact"
              className="rounded-b-lg border border-t-0 border-slate-200"
            />
          )}
        </>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-center text-sm">
              <thead>
                <tr className="bg-slate-100 text-center text-xs font-black text-slate-600">
                  <th className="w-10 p-2">Stt</th>
                  <th className="w-28 p-2">Ngày</th>
                  <th className="min-w-[8rem] p-2">Đối tượng</th>
                  <th className="w-32 p-2">Số CT</th>
                  <th className="w-36 p-2">Số hóa đơn</th>
                  <th className="min-w-[10rem] p-2">Diễn giải</th>
                  <th className="w-32 p-2 text-center">Nợ TK 131</th>
                  <th className="w-32 p-2 text-center">Có TK 131</th>
                  <th className="w-36 p-2 text-center">Số dư lũy kế</th>
                </tr>
              </thead>
              <tbody>
                {historyFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-400">
                      {historyLines.length === 0
                        ? 'Chưa có dòng phát sinh TK 131 trong phạm vi niên độ.'
                        : 'Không có dòng nào khớp bộ lọc.'}
                    </td>
                  </tr>
                ) : (
                  historyPagination.pagedItems.map((l: ArApMovementLine, i: number) => (
                    <tr key={`${l.journalId}-${l.objectKey}-${historyPagination.rowOffset + i}`} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="p-2 align-middle text-slate-500">{historyPagination.rowOffset + i + 1}</td>
                      <td className="p-2 align-middle font-mono text-xs">{l.date}</td>
                      <td className="p-2 align-middle font-medium text-slate-800">{l.displayName}</td>
                      <td className="max-w-[8rem] truncate p-2 align-middle font-mono text-[11px]" title={l.referenceId}>
                        {l.referenceId || '—'}
                      </td>
                      <td className="max-w-[10rem] truncate p-2 align-middle font-mono text-[11px]" title={l.invoiceNumber || ''}>
                        {l.invoiceNumber || '—'}
                      </td>
                      <td className="max-w-[14rem] truncate p-2 align-middle text-xs text-slate-600" title={l.description}>
                        {l.description || '—'}
                      </td>
                      <td className="p-2 align-middle text-center">{arApColMoney(l.debtSide, 'text-red-700')}</td>
                      <td className="p-2 align-middle text-center">{arApColMoney(l.paySide, 'text-emerald-700')}</td>
                      <td className={`p-2 align-middle text-center font-mono tabular-nums ${arApRunningBalClass(l.runningBalance)}`}>
                        {formatCurrency(l.runningBalance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {historyFiltered.length > 0 && (
            <Pagination
              page={historyPagination.page}
              totalItems={historyPagination.totalItems}
              pageSize={historyPagination.pageSize}
              pageSizeOptions={REPORT_TABLE_PAGE_SIZE_OPTIONS}
              onChangePage={historyPagination.setPage}
              onChangePageSize={historyPagination.setPageSize}
              variant="compact"
              className="rounded-b-lg border border-t-0 border-slate-200"
            />
          )}
        </>
      )}
    </div>
  );
};

const PayablesBySupplierReport = ({
  entries,
  financialYear,
  invoices,
  suppliers,
  customers,
  fundTransactions,
  companyInfo,
}: {
  entries: JournalEntry[];
  financialYear: FinancialYear;
  invoices: Invoice[];
  suppliers: Supplier[];
  customers: Customer[];
  fundTransactions: FundTransaction[];
  companyInfo: CompanyInfo;
}) => {
  const [viewMode, setViewMode] = useState<'OUTSTANDING' | 'HISTORY'>('OUTSTANDING');
  const [historyFilter, setHistoryFilter] = useState('');

  const summaryAll = useMemo(
    () => buildArApSummaryRowsByInvoice('AP', entries, financialYear.endDate, invoices, customers, suppliers),
    [entries, financialYear.endDate, invoices, customers, suppliers],
  );
  const summaryRows = useMemo(() => summaryAll.filter((r) => r.balance > 0), [summaryAll]);

  const historyLines = useMemo(
    () => buildArApMovementLines(entries, financialYear.endDate, 'AP', invoices, customers, suppliers),
    [entries, financialYear.endDate, invoices, customers, suppliers],
  );
  const historyFiltered = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return historyLines;
    return historyLines.filter(
      (l) =>
        l.displayName.toLowerCase().includes(q) ||
        l.objectKey.toLowerCase().includes(q) ||
        String(l.invoiceNumber || '').toLowerCase().includes(q) ||
        l.referenceId.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q),
    );
  }, [historyLines, historyFilter]);

  const outstandingPagination = useReportTablePagination(summaryRows, `AP-OUTSTANDING:${viewMode}`);
  const historyPagination = useReportTablePagination(historyFiltered, `AP-HISTORY:${viewMode}:${historyFilter}`);

  const totalsOutstanding = useMemo(() => {
    const td = summaryRows.reduce((s, r) => s + r.totalDebt, 0);
    const tp = summaryRows.reduce((s, r) => s + r.totalPaid, 0);
    const bal = summaryRows.reduce((s, r) => s + r.balance, 0);
    return { td, tp, bal };
  }, [summaryRows]);

  const handleRowDoubleClick = useCallback(
    (row: ArApSubledgerRow) => {
      const target = resolveArApNavTarget('AP', row, entries, financialYear.endDate, invoices, fundTransactions);
      triggerArApReportNavigation(target);
    },
    [entries, financialYear.endDate, invoices, fundTransactions],
  );

  return (
    <div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-6 text-black shadow-sm sm:p-10 print:border-none print:shadow-none">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-black uppercase tracking-tight text-blue-900">Báo cáo Nợ phải trả theo Nhà cung cấp</h1>
        <p className="mt-2 text-xs text-slate-500">
          Theo chi tiết TK 331 (và tài khoản con 331*) trên sổ nhật ký chung — số dư tính đến{' '}
          <span className="font-bold">{financialYear.endDate}</span> (cuối niên độ hiện tại)
        </p>
        <p className="mt-4 text-sm font-bold uppercase">{companyInfo.name}</p>
        <p className="font-mono text-xs">MST: {companyInfo.taxCode || '—'}</p>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => setViewMode('OUTSTANDING')}
            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
              viewMode === 'OUTSTANDING' ? 'bg-emerald-700 text-white shadow' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Chưa thanh toán
          </button>
          <button
            type="button"
            onClick={() => setViewMode('HISTORY')}
            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
              viewMode === 'HISTORY' ? 'bg-emerald-700 text-white shadow' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Lịch sử giao dịch
          </button>
        </div>
        {viewMode === 'HISTORY' && (
          <input
            type="search"
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value)}
            placeholder="Lọc theo đối tượng, số CT, diễn giải…"
            className="w-full min-w-[12rem] max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500/35 sm:w-auto"
          />
        )}
      </div>

      {viewMode === 'OUTSTANDING' ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-center text-xs font-black text-slate-600">
                  <th className="w-12 p-3">Stt</th>
                  <th className="w-28 p-3">Mã NCC</th>
                  <th className="p-3">Tên nhà cung cấp / Đối tượng</th>
                  <th className="w-36 p-3">MST (nếu có)</th>
                  <th className="w-36 p-3">Số hóa đơn</th>
                  <th className="w-36 p-3 text-center">Phát sinh nợ (Có 331)</th>
                  <th className="w-36 p-3 text-center">Đã trả (Nợ 331)</th>
                  <th className="w-36 p-3 text-center">Còn nợ</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400">
                      Không có đối tượng nào còn dư nợ phải trả TK 331 đến ngày chốt.
                    </td>
                  </tr>
                ) : (
                  outstandingPagination.pagedItems.map((r, i) => (
                    <tr
                      key={`${r.objectKey}-${outstandingPagination.rowOffset + i}`}
                      role="button"
                      tabIndex={0}
                      title="Double-click: mở hóa đơn mua / phiếu chi Quỹ hoặc lọc danh sách hóa đơn"
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/80"
                      onDoubleClick={() => handleRowDoubleClick(r)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRowDoubleClick(r);
                      }}
                    >
                      <td className="p-3 text-slate-500">{outstandingPagination.rowOffset + i + 1}</td>
                      <td className="p-3 font-mono text-xs">{r.code || '—'}</td>
                      <td className="p-3 font-medium text-slate-800">{r.displayName}</td>
                      <td className="p-3 font-mono text-xs">{r.taxCode || '—'}</td>
                      <td className="p-3 font-mono text-xs">{r.invoiceNumber || '—'}</td>
                      <td className="p-3 text-right">{arApColMoney(r.totalDebt, 'text-red-700')}</td>
                      <td className="p-3 text-right">{arApColMoney(r.totalPaid, 'text-emerald-700')}</td>
                      <td className="p-3 text-right">{arApColMoney(r.balance, 'text-red-800')}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {summaryRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-emerald-200 bg-emerald-50 font-black">
                    <td colSpan={5} className="p-3 text-right text-xs uppercase">
                      Tổng cộng
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums text-red-800">
                      {formatCurrency(totalsOutstanding.td)}
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums text-emerald-800">
                      {formatCurrency(totalsOutstanding.tp)}
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums text-red-900">
                      {formatCurrency(totalsOutstanding.bal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {summaryRows.length > 0 && (
            <Pagination
              page={outstandingPagination.page}
              totalItems={outstandingPagination.totalItems}
              pageSize={outstandingPagination.pageSize}
              pageSizeOptions={REPORT_TABLE_PAGE_SIZE_OPTIONS}
              onChangePage={outstandingPagination.setPage}
              onChangePageSize={outstandingPagination.setPageSize}
              variant="compact"
              className="rounded-b-lg border border-t-0 border-slate-200"
            />
          )}
        </>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-center text-xs font-black text-slate-600">
                  <th className="w-10 p-2">Stt</th>
                  <th className="w-28 p-2">Ngày</th>
                  <th className="min-w-[8rem] p-2">Đối tượng</th>
                  <th className="w-32 p-2">Số CT</th>
                  <th className="w-36 p-2">Số hóa đơn</th>
                  <th className="min-w-[10rem] p-2">Diễn giải</th>
                  <th className="w-32 p-2 text-center">Có TK 331</th>
                  <th className="w-32 p-2 text-center">Nợ TK 331</th>
                  <th className="w-36 p-2 text-center">Số dư lũy kế</th>
                </tr>
              </thead>
              <tbody>
                {historyFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-400">
                      {historyLines.length === 0
                        ? 'Chưa có dòng phát sinh TK 331 trong phạm vi niên độ.'
                        : 'Không có dòng nào khớp bộ lọc.'}
                    </td>
                  </tr>
                ) : (
                  historyPagination.pagedItems.map((l: ArApMovementLine, i: number) => (
                    <tr key={`${l.journalId}-${l.objectKey}-${historyPagination.rowOffset + i}`} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="p-2 text-slate-500">{historyPagination.rowOffset + i + 1}</td>
                      <td className="p-2 font-mono text-xs">{l.date}</td>
                      <td className="p-2 font-medium text-slate-800">{l.displayName}</td>
                      <td className="max-w-[8rem] truncate p-2 font-mono text-[11px]" title={l.referenceId}>
                        {l.referenceId || '—'}
                      </td>
                      <td className="max-w-[10rem] truncate p-2 font-mono text-[11px]" title={l.invoiceNumber || ''}>
                        {l.invoiceNumber || '—'}
                      </td>
                      <td className="max-w-[14rem] truncate p-2 text-xs text-slate-600" title={l.description}>
                        {l.description || '—'}
                      </td>
                      <td className="p-2 text-right">{arApColMoney(l.debtSide, 'text-red-700')}</td>
                      <td className="p-2 text-right">{arApColMoney(l.paySide, 'text-emerald-700')}</td>
                      <td className={`p-2 text-right font-mono tabular-nums ${arApRunningBalClass(l.runningBalance)}`}>
                        {formatCurrency(l.runningBalance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {historyFiltered.length > 0 && (
            <Pagination
              page={historyPagination.page}
              totalItems={historyPagination.totalItems}
              pageSize={historyPagination.pageSize}
              pageSizeOptions={REPORT_TABLE_PAGE_SIZE_OPTIONS}
              onChangePage={historyPagination.setPage}
              onChangePageSize={historyPagination.setPageSize}
              variant="compact"
              className="rounded-b-lg border border-t-0 border-slate-200"
            />
          )}
        </>
      )}
    </div>
  );
};

const RevenueByDeviceReport = ({ invoices }: { invoices: Invoice[] }) => {
    const data = useMemo(() => {
        const map = new Map();
        invoices.filter(i => i.type === 'SALES').forEach(inv => {
            const cat = inv.category === 'DEVICE' ? 'Thiết bị' : 'Dịch vụ';
            map.set(cat, (map.get(cat) || 0) + inv.amount);
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
    }, [invoices]);

    const COLORS = ['#3b82f6', '#10b981'];

    return (
        <div className="grid grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl border">
                <h3 className="font-bold text-slate-700 mb-6">Cơ cấu doanh thu</h3>
                <ResponsiveContainer width="100%" height={300}>
                    <RePieChart>
                        <Pie data={data} innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                            {data.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Legend />
                    </RePieChart>
                </ResponsiveContainer>
            </div>
            <div className="bg-white p-6 rounded-xl border">
                <h3 className="font-bold text-slate-700 mb-6">Giá trị chi tiết</h3>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" />
                        <YAxis tickFormatter={(v) => `${v/1000000}M`} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

const getRenewalQuarter = (month: number) => Math.floor((month - 1) / 3) + 1;

const formatDateTimeVN = (value?: string) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '---';
  return date.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const formatDateVN = (value?: string) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '---';
  return date.toLocaleDateString('vi-VN');
};

const formatRenewalPaymentMethod = (value?: string) => {
  if (!value) return '---';
  if (value === 'BANK') return 'Chuyển khoản';
  if (value === 'CASH') return 'Tiền mặt';
  if (value === 'DEBT') return 'Ghi nợ';
  return value;
};

const formatRenewalPaymentStatus = (value?: 'PAID' | 'DEBT') => {
  if (value === 'PAID') return 'Đã thanh toán';
  if (value === 'DEBT') return 'Ghi nợ';
  return '---';
};

const downloadSpreadsheetBlob = (filename: string, buf: ArrayBuffer) => {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const RenewalReport = ({ devices, defaultYear, companyInfo }: { devices: Device[]; defaultYear: number; companyInfo: CompanyInfo }) => {
  const currentDate = new Date();
  const [periodMode, setPeriodMode] = useState<RenewalPeriodMode>('MONTH');
  const [filterYear, setFilterYear] = useState<number>(defaultYear || currentDate.getFullYear());
  const [filterMonth, setFilterMonth] = useState<number>(currentDate.getMonth() + 1);
  const [filterQuarter, setFilterQuarter] = useState<number>(getRenewalQuarter(currentDate.getMonth() + 1));
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [periodFilterMenuOpen, setPeriodFilterMenuOpen] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailPageSize, setDetailPageSize] = useState<ReportTablePageSize>(10);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const periodFilterRef = useRef<HTMLDivElement | null>(null);

  const renewalRows = useMemo<RenewalReportRow[]>(() => {
    return devices
      .flatMap((device) =>
        (Array.isArray(device.renewalHistory) ? device.renewalHistory : []).map((item) => {
          const renewedAt = new Date(item.renewedAt);
          const renewedAtTime = Number.isNaN(renewedAt.getTime()) ? 0 : renewedAt.getTime();
          const renewedYear = renewedAtTime ? renewedAt.getFullYear() : 0;
          const renewedMonth = renewedAtTime ? renewedAt.getMonth() + 1 : 0;
          const renewedDay = renewedAtTime ? renewedAt.getDate() : 0;
          return {
            ...item,
            deviceId: device.id,
            deviceName: device.name,
            deviceType: device.type,
            customerName: device.customerName,
            customerPhone: device.customerPhone,
            imei: device.imei,
            serial: device.serial,
            licensePlate: device.licensePlate,
            renewedDay,
            renewedMonth,
            renewedYear,
            renewedQuarter: renewedMonth ? getRenewalQuarter(renewedMonth) : 0,
            renewedAtTime,
          };
        }),
      )
      .sort((a, b) => b.renewedAtTime - a.renewedAtTime);
  }, [devices]);

  const availableYears = useMemo(() => {
    const years = Array.from(
      new Set(
        renewalRows
          .map((item) => item.renewedYear)
          .filter((year) => Number.isFinite(year) && year > 0),
      ),
    ).sort((a, b) => b - a);
    if (years.length === 0) return [defaultYear || new Date().getFullYear()];
    if (defaultYear && !years.includes(defaultYear)) return [defaultYear, ...years].sort((a, b) => b - a);
    return years;
  }, [defaultYear, renewalRows]);

  useEffect(() => {
    if (!availableYears.includes(filterYear)) {
      setFilterYear(availableYears[0]);
    }
  }, [availableYears, filterYear]);

  const filteredRows = useMemo(() => {
    return renewalRows.filter((item) => {
      if (item.renewedYear !== filterYear) return false;
      if (periodMode === 'YEAR') return true;
      if (periodMode === 'QUARTER') return item.renewedQuarter === filterQuarter;
      return item.renewedMonth === filterMonth;
    });
  }, [filterMonth, filterQuarter, filterYear, periodMode, renewalRows]);

  useEffect(() => {
    setDetailPage(1);
  }, [filterMonth, filterQuarter, filterYear, periodMode]);

  const safeDetailPageSize = clampReportTablePageSize(detailPageSize);
  const totalDetailPages = Math.max(1, Math.ceil(filteredRows.length / safeDetailPageSize));
  const safeDetailPage = Math.min(Math.max(1, detailPage), totalDetailPages);

  useEffect(() => {
    if (detailPage !== safeDetailPage) {
      setDetailPage(safeDetailPage);
    }
  }, [detailPage, safeDetailPage]);

  const pagedFilteredRows = useMemo(() => {
    const start = (safeDetailPage - 1) * safeDetailPageSize;
    return filteredRows.slice(start, start + safeDetailPageSize);
  }, [filteredRows, safeDetailPage, safeDetailPageSize]);

  const totalAmount = useMemo(
    () => filteredRows.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0),
    [filteredRows],
  );
  const totalFee = useMemo(
    () => filteredRows.reduce((sum, item) => sum + Number(item.fee || 0), 0),
    [filteredRows],
  );
  const totalVat = useMemo(
    () => filteredRows.reduce((sum, item) => sum + Number(item.vatAmount || 0), 0),
    [filteredRows],
  );
  const renewedDeviceCount = useMemo(
    () => new Set(filteredRows.map((item) => item.deviceId)).size,
    [filteredRows],
  );

  const filterLabel = useMemo(() => {
    if (periodMode === 'YEAR') return `Năm ${filterYear}`;
    if (periodMode === 'QUARTER') return `Quý ${filterQuarter}/${filterYear}`;
    return `Tháng ${String(filterMonth).padStart(2, '0')}/${filterYear}`;
  }, [filterMonth, filterQuarter, filterYear, periodMode]);

  const isPeriodSelectionActive = useCallback(
    (selection: RenewalPeriodSelection) => {
      if (selection.mode === 'YEAR') return periodMode === 'YEAR' && filterYear === selection.year;
      if (selection.mode === 'QUARTER') {
        return periodMode === 'QUARTER' && filterYear === selection.year && filterQuarter === selection.quarter;
      }
      return periodMode === 'MONTH' && filterYear === selection.year && filterMonth === selection.month;
    },
    [filterMonth, filterQuarter, filterYear, periodMode],
  );

  const applyPeriodSelection = useCallback((selection: RenewalPeriodSelection) => {
    setPeriodMode(selection.mode);
    setFilterYear(selection.year);
    if (selection.mode === 'QUARTER') setFilterQuarter(selection.quarter);
    if (selection.mode === 'MONTH') setFilterMonth(selection.month);
    setPeriodFilterMenuOpen(false);
  }, []);

  const latestRenewal = filteredRows[0]?.renewedAt;
  const generatedAtLabel = useMemo(() => formatDateTimeVN(new Date().toISOString()), []);
  const latestRenewalDateLabel = useMemo(() => (latestRenewal ? formatDateVN(latestRenewal) : 'Chưa có dữ liệu'), [latestRenewal]);
  const latestRenewalTimeLabel = useMemo(() => {
    if (!latestRenewal) return 'Chưa phát sinh giao dịch';
    const date = new Date(latestRenewal);
    if (Number.isNaN(date.getTime())) return 'Chưa phát sinh giao dịch';
    return date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }, [latestRenewal]);

  const detailExportRows = useMemo(
    () =>
      filteredRows.map((item, index) => ({
        STT: index + 1,
        'Thời gian gia hạn': formatDateTimeVN(item.renewedAt),
        Ngày: item.renewedDay || '',
        Tháng: item.renewedMonth || '',
        Quý: item.renewedQuarter || '',
        Năm: item.renewedYear || '',
        'Mã thiết bị': item.deviceId || '',
        'Tên thiết bị': item.deviceName || '',
        'Loại thiết bị': item.deviceType || '',
        'Khách hàng': item.customerName || '',
        'SĐT khách hàng': item.customerPhone || '',
        IMEI: item.imei || '',
        Serial: item.serial || '',
        'Biển số': item.licensePlate || '',
        'Hạn cũ': formatDateVN(item.oldExpiryDate),
        'Hạn mới': formatDateVN(item.newExpiryDate),
        'Số tháng gia hạn': Number(item.durationMonths || 0),
        'Doanh thu chưa thuế': Number(item.fee || 0),
        'VAT đầu ra (%)': Number(item.vatRate || 0),
        'VAT đầu ra': Number(item.vatAmount || 0),
        'Tổng thanh toán': Number(item.totalAmount || 0),
        'Trạng thái thanh toán': formatRenewalPaymentStatus(item.paymentStatus),
        'Phương thức thanh toán': formatRenewalPaymentMethod(item.paymentMethod),
        'Diễn giải bán ra': item.salesDescription || '',
        'Đơn vị tính bán ra': item.salesUnit || '',
        'Hóa đơn bán ra': item.salesInvoiceNumber || '',
        'Nhà cung cấp đầu vào': item.inputCostSupplier || '',
        'Chi phí đầu vào chưa thuế': Number(item.inputCostPrice || 0),
        'VAT đầu vào (%)': Number(item.inputCostVatRate || 0),
        'VAT đầu vào': Number(item.inputCostVatAmount || 0),
        'Tổng giá vốn đầu vào': Number(item.inputCostTotal || 0),
        'Phương thức thanh toán NCC': formatRenewalPaymentMethod(item.inputCostPaymentMethod),
        'Diễn giải đầu vào': item.inputCostDescription || '',
        'Hóa đơn đầu vào': item.purchaseInvoiceNumber || '',
        'Ghi chú': 'Lưu vết thời gian thực từ thẻ Thiết bị & Gia hạn',
      })),
    [filteredRows],
  );

  const exportBaseName = useMemo(() => {
    if (periodMode === 'YEAR') return `Bao_cao_gia_han_Nam_${filterYear}`;
    if (periodMode === 'QUARTER') return `Bao_cao_gia_han_Quy_${filterQuarter}_${filterYear}`;
    return `Bao_cao_gia_han_Thang_${String(filterMonth).padStart(2, '0')}_${filterYear}`;
  }, [filterMonth, filterQuarter, filterYear, periodMode]);

  const handleExportExcel = useCallback(async () => {
    if (detailExportRows.length === 0) {
      window.alert('Không có dữ liệu gia hạn trong kỳ đã chọn để xuất Excel.');
      return;
    }

    const XLSX = await loadXlsx();
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ['BÁO CÁO GIA HẠN'],
      ['Đơn vị', companyInfo.name || ''],
      ['Mã số thuế', companyInfo.taxCode || ''],
      ['Địa chỉ', companyInfo.address || ''],
      ['Thời gian tạo báo cáo', generatedAtLabel],
      ['Kỳ báo cáo', filterLabel],
      ['Chế độ lọc', periodMode === 'MONTH' ? 'Theo Tháng' : periodMode === 'QUARTER' ? 'Theo Quý' : 'Theo Năm'],
      ['Số lần gia hạn', filteredRows.length],
      ['Số thiết bị phát sinh', renewedDeviceCount],
      ['Doanh thu chưa thuế', totalFee],
      ['VAT đầu ra', totalVat],
      ['Tổng thanh toán', totalAmount],
      ['Gia hạn gần nhất', latestRenewal ? formatDateTimeVN(latestRenewal) : 'Chưa có dữ liệu'],
    ]);
    summarySheet['!cols'] = [{ wch: 26 }, { wch: 40 }];

    const detailSheet = XLSX.utils.json_to_sheet(detailExportRows);
    detailSheet['!cols'] = [
      { wch: 6 }, { wch: 22 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
      { wch: 18 }, { wch: 28 }, { wch: 14 }, { wch: 24 }, { wch: 18 }, { wch: 18 },
      { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
      { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 30 },
      { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 16 },
      { wch: 18 }, { wch: 22 }, { wch: 28 }, { wch: 18 }, { wch: 28 },
    ];

    XLSX.utils.book_append_sheet(workbook, summarySheet, 'TongHop');
    XLSX.utils.book_append_sheet(workbook, detailSheet, 'ChiTietGiaHan');
    downloadSpreadsheetBlob(`${exportBaseName}.xlsx`, XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));
  }, [
    companyInfo.address,
    companyInfo.name,
    companyInfo.taxCode,
    detailExportRows,
    exportBaseName,
    filterLabel,
    filteredRows.length,
    generatedAtLabel,
    latestRenewal,
    periodMode,
    renewedDeviceCount,
    totalAmount,
    totalFee,
    totalVat,
  ]);

  const handleExportPdf = useCallback(async () => {
    if (detailExportRows.length === 0) {
      window.alert('Không có dữ liệu gia hạn trong kỳ đã chọn để xuất PDF.');
      return;
    }

    try {
      await exportRenewalReportPdf({
        companyInfo,
        filterLabel,
        periodModeLabel: periodMode === 'MONTH' ? 'Theo Tháng' : periodMode === 'QUARTER' ? 'Theo Quý' : 'Theo Năm',
        filteredRowsCount: filteredRows.length,
        renewedDeviceCount,
        totalFee,
        totalVat,
        totalAmount,
        latestRenewalLabel: latestRenewal ? formatDateTimeVN(latestRenewal) : 'Chưa có dữ liệu',
        generatedAtLabel,
        exportBaseName,
        detailExportRows,
        formatCurrency,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('Export renewal report PDF failed:', error);
      window.alert('Không thể xuất báo cáo PDF. Vui lòng thử lại.');
    }
  }, [
    companyInfo.address,
    companyInfo.name,
    companyInfo.taxCode,
    detailExportRows,
    exportBaseName,
    filterLabel,
    filteredRows.length,
    generatedAtLabel,
    latestRenewal,
    periodMode,
    renewedDeviceCount,
    totalAmount,
    totalFee,
    totalVat,
  ]);

  useEffect(() => {
    if (!exportMenuOpen && !periodFilterMenuOpen) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (exportMenuRef.current && !exportMenuRef.current.contains(target)) {
        setExportMenuOpen(false);
      }
      if (periodFilterRef.current && !periodFilterRef.current.contains(target)) {
        setPeriodFilterMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [exportMenuOpen, periodFilterMenuOpen]);

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-stretch gap-2">
            <div className="flex w-[200px] shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
              <div className="text-3xl font-black tabular-nums leading-none text-slate-900">{filteredRows.length}</div>
              <div className="text-[11px] font-semibold leading-snug text-slate-500">
                <div>Số lần</div>
                <div>gia hạn</div>
              </div>
            </div>
            <div className="flex w-[200px] shrink-0 items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-3 shadow-sm">
              <div className="text-3xl font-black tabular-nums leading-none text-blue-700">{renewedDeviceCount}</div>
              <div className="text-[11px] font-semibold leading-snug text-blue-600">
                <div>Thiết bị</div>
                <div>phát sinh</div>
              </div>
            </div>
            <div className="flex w-[220px] shrink-0 items-center gap-3 rounded-xl border border-amber-200 bg-white px-3 py-3 shadow-sm">
              <div className="flex shrink-0 items-center justify-center">
                <Clock3 className="h-6 w-6 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black leading-tight text-slate-900">{latestRenewalDateLabel}</div>
                <div className="mt-0.5 text-[11px] font-semibold leading-snug text-slate-500">
                  <div>Gia hạn gần nhất</div>
                  <div className="truncate text-slate-400">{latestRenewalTimeLabel}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative shrink-0 lg:ml-auto" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setExportMenuOpen((prev) => !prev)}
              disabled={filteredRows.length === 0}
              title={`Xuất báo cáo theo ${filterLabel}`}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold shadow-sm transition-colors ${
                filteredRows.length === 0
                  ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              <Download className="h-4 w-4" />
              Xuất báo cáo
              <ChevronDown className={`h-4 w-4 transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {exportMenuOpen && filteredRows.length > 0 && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-20 min-w-[12rem] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    void handleExportExcel();
                    setExportMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  Xuất `.xlsx`
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportMenuOpen(false);
                    void handleExportPdf();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <FileDown className="h-4 w-4 text-slate-500" />
                  Xuất `.pdf`
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative shrink-0" ref={periodFilterRef}>
            <button
              type="button"
              onClick={() => setPeriodFilterMenuOpen((prev) => !prev)}
              aria-expanded={periodFilterMenuOpen}
              aria-haspopup="menu"
              className={`inline-flex min-w-[14rem] items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold shadow-sm transition-colors ${
                periodFilterMenuOpen
                  ? 'border-blue-400 bg-blue-50 text-blue-900 ring-2 ring-blue-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-slate-50'
              }`}
            >
              <Calendar className="h-4 w-4 shrink-0 text-blue-600" />
              <span className="min-w-0 truncate">
                Kỳ báo cáo: <span className="text-slate-900">{filterLabel}</span>
              </span>
              <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform ${periodFilterMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {periodFilterMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-[calc(100%+8px)] z-30 max-h-[min(70vh,28rem)] w-[min(calc(100vw-2rem),20rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-2 shadow-xl ring-1 ring-slate-900/5 custom-scrollbar"
              >
                <div className="px-3 pb-1 pt-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Theo năm</p>
                </div>
                <div className="space-y-0.5 px-2 pb-2">
                  {availableYears.map((year) => {
                    const selection: RenewalPeriodSelection = { mode: 'YEAR', year };
                    const active = isPeriodSelectionActive(selection);
                    return (
                      <button
                        key={`year-${year}`}
                        type="button"
                        role="menuitem"
                        onClick={() => applyPeriodSelection(selection)}
                        className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-bold transition-colors ${
                          active ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        Năm {year}
                      </button>
                    );
                  })}
                </div>

                {availableYears.map((year) => (
                  <div key={`quarter-group-${year}`} className="border-t border-slate-100 px-2 py-2">
                    <p className="px-1 pb-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                      Theo quý (Năm {year})
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      {[1, 2, 3, 4].map((quarter) => {
                        const selection: RenewalPeriodSelection = { mode: 'QUARTER', year, quarter };
                        const active = isPeriodSelectionActive(selection);
                        return (
                          <button
                            key={`quarter-${year}-${quarter}`}
                            type="button"
                            role="menuitem"
                            onClick={() => applyPeriodSelection(selection)}
                            className={`rounded-lg px-3 py-2 text-left text-xs font-bold transition-colors ${
                              active ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            Quý {quarter}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {availableYears.map((year) => (
                  <div key={`month-group-${year}`} className="border-t border-slate-100 px-2 py-2">
                    <p className="px-1 pb-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                      Theo tháng (Năm {year})
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
                        const selection: RenewalPeriodSelection = { mode: 'MONTH', year, month };
                        const active = isPeriodSelectionActive(selection);
                        const isCurrentMonth =
                          year === currentDate.getFullYear() && month === currentDate.getMonth() + 1;
                        return (
                          <button
                            key={`month-${year}-${month}`}
                            type="button"
                            role="menuitem"
                            onClick={() => applyPeriodSelection(selection)}
                            className={`rounded-lg px-3 py-2 text-left text-xs font-bold transition-colors ${
                              active
                                ? 'bg-blue-600 text-white'
                                : isCurrentMonth
                                  ? 'border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'
                                  : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            Tháng {String(month).padStart(2, '0')}
                            {isCurrentMonth ? ' (Hiện tại)' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm xl:justify-end">
            <span className="inline-flex flex-wrap items-center gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Doanh thu chưa thuế</span>
              <span className="font-bold tabular-nums text-emerald-700">{formatCurrency(totalFee)}</span>
            </span>
            <span className="hidden text-slate-300 sm:inline" aria-hidden>|</span>
            <span className="inline-flex flex-wrap items-center gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">VAT đầu ra</span>
              <span className="font-bold tabular-nums text-amber-700">{formatCurrency(totalVat)}</span>
            </span>
            <span className="hidden text-slate-300 sm:inline" aria-hidden>|</span>
            <span className="inline-flex flex-wrap items-center gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tổng thanh toán</span>
              <span className="font-bold tabular-nums text-blue-700">{formatCurrency(totalAmount)}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h4 className="text-sm font-black text-slate-900">Chi tiết giao dịch gia hạn</h4>
            <p className="text-xs text-slate-500">
              Hiển thị đầy đủ thời gian, ngày, tháng, năm gia hạn theo bộ lọc đã chọn.
            </p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            {filteredRows.length} giao dịch
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className="p-10 text-center">
            <History className="mx-auto h-12 w-12 text-slate-300" />
            <p className="mt-3 text-sm font-bold text-slate-700">Chưa có dữ liệu gia hạn trong kỳ đã chọn.</p>
            <p className="mt-1 text-xs text-slate-400">Thực hiện gia hạn ở thẻ Thiết bị & Gia hạn để hệ thống tự động ghi nhận tại đây.</p>
          </div>
        ) : (
          <>
            <div className="custom-scrollbar overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Thời gian gia hạn</th>
                  <th className="px-4 py-3 text-left">Ngày</th>
                  <th className="px-4 py-3 text-left">Tháng</th>
                  <th className="px-4 py-3 text-left">Năm</th>
                  <th className="px-4 py-3 text-left">Thiết bị / Khách hàng</th>
                  <th className="px-4 py-3 text-left">Nhận diện</th>
                  <th className="px-4 py-3 text-left">Hạn sử dụng</th>
                  <th className="px-4 py-3 text-left">Thời lượng</th>
                  <th className="px-4 py-3 text-right">Tổng thanh toán</th>
                  <th className="px-4 py-3 text-left">Thanh toán</th>
                  <th className="px-4 py-3 text-left">Hóa đơn</th>
                </tr>
              </thead>
              <tbody>
                {pagedFilteredRows.map((item, index) => (
                  <tr key={`${item.deviceId}-${item.id}`} className="border-t border-slate-100 align-top hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-slate-500">{(safeDetailPage - 1) * safeDetailPageSize + index + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{formatDateTimeVN(item.renewedAt)}</div>
                      <div className="mt-1 text-xs text-slate-400">Lưu vết thời gian thực</div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{item.renewedDay || '---'}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{item.renewedMonth || '---'}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{item.renewedYear || '---'}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{item.deviceName || '---'}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.customerName || 'Chưa có khách hàng'} · {item.deviceType}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>IMEI: <span className="font-semibold text-slate-800">{item.imei || '---'}</span></div>
                      <div className="mt-1">Biển số: <span className="font-semibold text-slate-800">{item.licensePlate || '---'}</span></div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>Cũ: <span className="font-semibold text-slate-800">{formatDateVN(item.oldExpiryDate)}</span></div>
                      <div className="mt-1">Mới: <span className="font-semibold text-blue-700">{formatDateVN(item.newExpiryDate)}</span></div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {item.durationMonths} tháng
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-bold text-emerald-700">{formatCurrency(item.totalAmount)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Thuần {formatCurrency(item.fee)} + VAT {formatCurrency(item.vatAmount)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div className="font-semibold text-slate-800">{formatRenewalPaymentStatus(item.paymentStatus)}</div>
                      <div className="mt-1">{formatRenewalPaymentMethod(item.paymentMethod)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>Bán ra: <span className="font-semibold text-slate-800">{item.salesInvoiceNumber || '---'}</span></div>
                      <div className="mt-1">Đầu vào: <span className="font-semibold text-slate-800">{item.purchaseInvoiceNumber || '---'}</span></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={safeDetailPage}
            totalItems={filteredRows.length}
            pageSize={safeDetailPageSize}
            pageSizeOptions={REPORT_TABLE_PAGE_SIZE_OPTIONS}
            onChangePage={setDetailPage}
            onChangePageSize={(size) => {
              setDetailPageSize(clampReportTablePageSize(size));
              setDetailPage(1);
            }}
            variant="compact"
          />
          </>
        )}
      </div>
    </div>
  );
};

const ProfitByContractReport = ({ invoices }: { invoices: Invoice[] }) => (
    <div className="p-20 text-center text-slate-400 bg-white rounded-xl border border-dashed">
        <Calculator className="w-16 h-16 mx-auto mb-4 opacity-20" />
        <h3 className="font-bold text-lg">Báo cáo lợi nhuận hợp đồng</h3>
        <p className="text-sm">Tính năng đang phát triển.</p>
    </div>
);

const DevicePerformanceReport = ({ devices }: { devices: Device[] }) => (
    <div className="p-20 text-center text-slate-400 bg-white rounded-xl border border-dashed">
        <Activity className="w-16 h-16 mx-auto mb-4 opacity-20" />
        <h3 className="font-bold text-lg">Báo cáo hiệu suất thiết bị</h3>
        <p className="text-sm">Tính năng đang phát triển.</p>
    </div>
);

// --- UTILS ---

const calculateTurnoverInPeriod = (entries: JournalEntry[], prefix: string, side: 'DEBIT' | 'CREDIT', start: string, end: string) => {
  return entries
    .filter(entry => entry.date >= start && entry.date <= end)
    .reduce((acc, entry) => {
        return acc + journalEntryDetailsArray(entry).reduce((sum, d) => {
            if (String(d.account).startsWith(prefix)) {
                return sum + (side === 'DEBIT' ? d.debit : d.credit);
            }
            return sum;
        }, 0);
    }, 0);
}

const calculateBalanceAtDate = (entries: JournalEntry[], prefix: string, dateStr: string) => {
  return entries
    .filter(entry => entry.date <= dateStr)
    .reduce((acc, entry) => {
      return acc + journalEntryDetailsArray(entry).reduce((sum, d) => {
        const acct = String(d.account);
        if (acct.startsWith(prefix)) {
           const isAsset = ['1', '2', '6', '8'].some(p => acct.startsWith(p));
           if (isAsset) return sum + (d.debit - d.credit);
           return sum + (d.credit - d.debit);
        }
        return sum;
      }, 0);
    }, 0);
};

const shiftDateString = (dateStr: string, days: number) => {
  const parts = String(dateStr || '').split('-').map(Number);
  if (parts.length < 3 || parts.some(n => !Number.isFinite(n))) return String(dateStr || '');
  const [year, month, day] = parts;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return String(dateStr || '');
  dt.setUTCDate(dt.getUTCDate() + days);
  try {
    return dt.toISOString().split('T')[0];
  } catch {
    return String(dateStr || '');
  }
};

const getTodayLocalDateString = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
};

const hasAnyAccountPrefixUsage = (entries: JournalEntry[], prefixes: string[]) => {
  return entries.some(entry =>
    journalEntryDetailsArray(entry).some(detail => prefixes.some(prefix => String(detail.account || '').startsWith(prefix)))
  );
};

const sumBalancesAtDate = (entries: JournalEntry[], prefixes: string[], dateStr: string) => {
  return prefixes.reduce((sum, prefix) => sum + calculateBalanceAtDate(entries, prefix, dateStr), 0);
};

const resolveCashEquivalentBalanceAtDate = (entries: JournalEntry[], dateStr: string) => {
  const preferredPrefixes = ['1111', '1121', '121'];
  const fallbackPrefixes = ['111', '112', '121'];
  const usePreferred = hasAnyAccountPrefixUsage(entries, preferredPrefixes);
  return sumBalancesAtDate(entries, usePreferred ? preferredPrefixes : fallbackPrefixes, dateStr);
};

const getCashFlowReportMeta = (
  entries: JournalEntry[],
  financialYear: { startDate: string; endDate: string },
  cashFlowOpening: Record<string, number> | undefined,
): CashFlowReportMeta => {
  const startStr = financialYear.startDate;
  const endStr = financialYear.endDate;
  const openingCutoff = shiftDateString(startStr, -1);
  const ledgerOpeningCash60 = resolveCashEquivalentBalanceAtDate(entries, openingCutoff);
  const ledgerClosingCash70 = resolveCashEquivalentBalanceAtDate(entries, endStr);
  const hasManual60 = typeof cashFlowOpening?.['60'] === 'number';
  const hasManual70 = typeof cashFlowOpening?.['70'] === 'number';
  const fallbackOpening60 = hasManual70 ? Number(cashFlowOpening?.['70'] || 0) : ledgerOpeningCash60;
  const openingCash60 = hasManual60 ? Number(cashFlowOpening?.['60'] || 0) : fallbackOpening60;
  const today = getTodayLocalDateString();
  const isActiveFinancialYear = today >= startStr && today <= endStr;
  let systemNote: string | undefined;

  if (!hasManual60) {
    if (fallbackOpening60 < 0) {
      systemNote = 'Dữ liệu chưa hoàn thiện do thiếu số dư đầu kỳ';
    } else if (hasManual70) {
      systemNote = 'Mã số 60 đang được tự động đồng bộ từ mã số 70 của kỳ trước.';
    } else if (ledgerOpeningCash60 !== 0) {
      systemNote = 'Mã số 60 đang được tự động lấy từ số dư cuối kỳ năm trước / sổ cái tiền.';
    } else {
      systemNote = 'Dữ liệu chưa hoàn thiện do thiếu số dư đầu kỳ';
    }
  }

  return {
    openingCash60,
    closingCash70: ledgerClosingCash70,
    expectedOpeningCash60: ledgerOpeningCash60,
    isOpeningCrossCheckMismatch: Math.round(openingCash60) !== Math.round(ledgerOpeningCash60),
    isClosingCashNegative: ledgerClosingCash70 < 0,
    requiresZeroOpeningConfirmation: isActiveFinancialYear && Math.round(openingCash60) === 0,
    systemNote,
  };
};