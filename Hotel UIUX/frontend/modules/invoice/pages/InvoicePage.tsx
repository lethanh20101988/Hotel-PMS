
import React, { Suspense, lazy, useState, useMemo, useEffect, useRef } from 'react';
import { 
  FileText, Download, AlertTriangle, Printer, FileCode, 
  TrendingUp, TrendingDown, ShieldCheck, Search, Filter, Calendar, X,
  CheckCircle2, FileSpreadsheet, Plus, Briefcase, ListChecks, ScanLine
} from 'lucide-react';

const InvoiceVatComparisonChart = lazy(() =>
  import('../components/InvoiceVatComparisonChart').then((m) => ({ default: m.InvoiceVatComparisonChart })),
);
import { InvoiceManagerView } from '../components/InvoiceManagerView';
import { InvoiceCreationModal } from '../components/InvoiceCreationModal';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import { DeleteInvoiceModal } from '../components/DeleteInvoiceModal';
import { InvoiceImportWarningsModal, type InvoiceImportWarningItem } from '../components/InvoiceImportWarningsModal';
import { downloadInvoiceImportTemplate, parseInvoiceImportFile, type InvoiceImportDraft } from '../utils/invoiceImport';
import { Invoice, InvoiceDetail } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { roundVnd } from '@shared/utils/vndMoney';
import { formatVatRateLabel, recomputeInvoiceHeaderTotals } from '@shared/utils/vatRate';
import { isDeferredRevenueInvoice } from '@shared/utils/deferredRevenue';
import { strictInvoiceDuplicateKey } from '@shared/utils/invoiceDuplicateIdentity';
import { getInvoiceTaxDeclarationDate } from '@shared/utils/crossPeriodInvoice';
import { resolveCashBankAccountCode } from '@shared/utils/bankAccountPayments';
import { useApp } from '../../../app/store';
import { SESSION_INVOICE_NAV_HINT, SESSION_OPEN_INVOICE_PAYLOAD } from '@shared/utils/arApReportNavigate';
import { Pagination } from '@shared/components/Pagination';
import { VatGtgt01Declaration } from '../components/VatGtgt01Declaration';
import { EInvoiceElectronicPanel } from '../components/EInvoiceElectronicPanel';

interface InvoicePageProps {
  invoices: Invoice[];
  onCreate: (invoiceData: any) => boolean;
  onUpdate: (invoiceData: any) => boolean;
  onDelete: (invoice: Invoice) => boolean | Promise<boolean>;
}

type TabType = 'GENERAL' | 'INPUT_LIST' | 'OUTPUT_LIST' | 'GTGT_01' | 'VAT_REPORT' | 'E_INVOICE';
type TimeFilterType = 'ALL' | 'TODAY' | 'MONTH' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'YEAR' | 'CUSTOM';
type DeferredInvoiceFilter = 'ALL' | 'ONLY_3387';
/** Lọc theo chiều hóa đơn trên thanh tìm kiếm */
type InvoiceDirectionFilter = 'ALL' | 'PURCHASE' | 'SALES';
/** Lọc theo TK tiền thanh toán (chỉ HĐ đã thu/chi, không gồm công nợ) */
type InvoiceCashAccountFilter = 'ALL' | '1111' | '1121';
type StandardPageSize = 10 | 20 | 50 | 100;

interface PendingImportReview {
  importLabel: string;
  acceptedDrafts: InvoiceImportDraft[];
  importErrors: string[];
  importWarnings: InvoiceImportWarningItem[];
}

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

/** Số tiền báo cáo VAT: cỡ 24–28px, font-medium, ký hiệu đ nhỏ hơn (font-sans = system UI stack). */
function VatReportAmount({
  value,
  tone = 'default',
}: {
  value: number;
  tone?: 'default' | 'danger' | 'success' | 'muted';
}) {
  const num = new Intl.NumberFormat('vi-VN').format(Math.round(Math.max(0, value)));
  const color =
    tone === 'danger'
      ? 'text-red-600'
      : tone === 'success'
        ? 'text-emerald-700'
        : tone === 'muted'
          ? 'text-slate-500'
          : 'text-slate-800';
  return (
    <span
      className={`inline-flex items-baseline gap-x-1.5 font-sans font-medium tabular-nums tracking-tight text-2xl leading-none md:text-[28px] ${color}`}
    >
      <span>{num}</span>
      <span className="text-sm font-medium text-slate-400 md:text-[15px]">đ</span>
    </span>
  );
}

/** Cùng ngày → so sánh số HĐ (số học); cuối cùng theo id — ổn định cho bảng kê / phân trang. */
function compareInvoicesChronological(a: Invoice, b: Invoice): number {
  const da = String(a.date || '').split('T')[0];
  const db = String(b.date || '').split('T')[0];
  const byDate = da.localeCompare(db);
  if (byDate !== 0) return byDate;
  const byNo = String(a.invoiceNumber || '').localeCompare(String(b.invoiceNumber || ''), 'vi', { numeric: true });
  if (byNo !== 0) return byNo;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Suy ra TK tiền từ paymentMethod (khớp hướng xử lý trong store), hoặc null nếu công nợ / chưa thu chi.
 */
function resolveInvoicePaymentAccount(inv: Invoice): '1111' | '1121' | '3388' | null {
  if (inv.status === 'PENDING') return null;
  const pm = String(inv.paymentMethod || '');
  const pl = pm.toLowerCase();
  if (pl.includes('công nợ') || pl.includes('ghi nợ') || pl.includes('cong no')) return null;
  const resolved = resolveCashBankAccountCode(inv.paymentMethod, inv.bankLedgerAccountCode);
  if (resolved === '3388') return '3388';
  if (resolved.startsWith('112')) return '1121';
  if (resolved.startsWith('111')) return '1111';
  return null;
}

export const InvoicePage: React.FC<InvoicePageProps> = ({ invoices, onCreate, onUpdate, onDelete }) => {
  const {
    financialYear,
    journalEntries,
    setModals,
    setActiveTab: setActiveTabGlobal,
    accountingPeriods,
    companyInfo,
    previewDocumentNumber,
    allInvoicesAcrossYears,
    misplacedYearDataTotal,
    handleReconcileInvoicesForActiveFiscalYear,
  } = useApp();
  const [activeTab, setActiveTab] = useState<TabType>('GENERAL');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [directionFilter, setDirectionFilter] = useState<InvoiceDirectionFilter>('ALL');
  const [cashAccountFilter, setCashAccountFilter] = useState<InvoiceCashAccountFilter>('ALL');
  const [timeFilter, setTimeFilter] = useState<TimeFilterType>('ALL');
  const [deferredInvoiceFilter, setDeferredInvoiceFilter] = useState<DeferredInvoiceFilter>('ALL');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  // --- PAGINATION (remember per tab + per filter signature) ---
  const baseStorageKey = useMemo(() => `invoice_pagination_${activeTab}`, [activeTab]);
  const filterSignature = useMemo(() => {
    return JSON.stringify({
      q: (searchTerm || '').trim().toLowerCase(),
      directionFilter,
      cashAccountFilter,
      timeFilter,
      deferredInvoiceFilter,
      from: customRange.from || '',
      to: customRange.to || '',
      fyStart: financialYear.startDate,
      fyEnd: financialYear.endDate,
    });
  }, [
    cashAccountFilter,
    customRange.from,
    customRange.to,
    deferredInvoiceFilter,
    directionFilter,
    financialYear.endDate,
    financialYear.startDate,
    searchTerm,
    timeFilter,
  ]);
  const filterKey = useMemo(() => `f_${hashString(filterSignature)}`, [filterSignature]);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<StandardPageSize>(20);
  const hasMountedFilterResetRef = useRef(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [mode, setMode] = useState<'SALES' | 'PURCHASE'>('SALES');
  const [category, setCategory] = useState<'DEVICE' | 'SERVICE'>('DEVICE');
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [pendingImportReview, setPendingImportReview] = useState<PendingImportReview | null>(null);
  
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [deleteInvoice, setDeleteInvoice] = useState<Invoice | null>(null);

  /** Mở từ báo cáo Nợ phải thu/trả (double-click). */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_OPEN_INVOICE_PAYLOAD);
      if (!raw) return;
      const p = JSON.parse(raw) as { invoiceId?: string; listTab?: TabType };
      const id = String(p.invoiceId || '').trim();
      if (!id) return;
      const inv = invoices.find(i => String(i.id) === id);
      if (!inv) return;
      sessionStorage.removeItem(SESSION_OPEN_INVOICE_PAYLOAD);
      if (p.listTab === 'OUTPUT_LIST' || p.listTab === 'INPUT_LIST' || p.listTab === 'GENERAL') {
        setActiveTab(p.listTab);
      } else {
        setActiveTab(inv.type === 'PURCHASE' ? 'INPUT_LIST' : 'OUTPUT_LIST');
      }
      setViewInvoice(inv);
    } catch {
      // ignore
    }
  }, [invoices]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_INVOICE_NAV_HINT);
      if (!raw) return;
      const h = JSON.parse(raw) as {
        searchTerm?: string;
        directionFilter?: string;
        listTab?: string;
      };
      sessionStorage.removeItem(SESSION_INVOICE_NAV_HINT);
      if (typeof h.searchTerm === 'string') setSearchTerm(h.searchTerm);
      if (h.directionFilter === 'SALES' || h.directionFilter === 'PURCHASE') {
        setDirectionFilter(h.directionFilter);
      }
      if (h.listTab === 'OUTPUT_LIST' || h.listTab === 'INPUT_LIST' || h.listTab === 'GENERAL') {
        setActiveTab(h.listTab as TabType);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ khi vừa chuyển sang tab Hóa đơn
  }, []);

  const fiscalYearLabel = useMemo(() => new Date(financialYear.startDate).getFullYear(), [financialYear]);

  /** Không có HĐ nào có ngày trong niên độ đang mở nhưng vẫn có HĐ ở niên độ khác → nhắc chọn đúng năm. */
  const invoiceYearTrace = useMemo(() => {
    const fs = financialYear.startDate;
    const fe = financialYear.endDate;
    const inFyAll = allInvoicesAcrossYears.filter((inv) => {
      const d = getInvoiceTaxDeclarationDate(inv);
      return d >= fs && d <= fe;
    });
    const hasAnyInvoiceOtherFy =
      allInvoicesAcrossYears.length > 0 && inFyAll.length === 0;
    return { hasAnyInvoiceOtherFy };
  }, [allInvoicesAcrossYears, financialYear]);

  const handlePrintList = () => {
    window.print();
  };

  // --- LOGIC LỌC DỮ LIỆU CHÍNH (Đã sửa đổi để khớp với Năm tài chính) ---
  const filteredInvoices = useMemo(() => {
    const t0 = performance.now();
    const rows = invoices.filter(inv => {
      // 1. RÀNG BUỘC THEO NĂM TÀI CHÍNH (ngày kê khai/hạch toán — gồm HĐ khác niên độ)
      const fyDate = getInvoiceTaxDeclarationDate(inv);
      if (fyDate < financialYear.startDate || fyDate > financialYear.endDate) return false;

      // 2. Lọc theo từ khóa tìm kiếm
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        (inv.invoiceNumber || '').toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q) ||
        (inv.buyerTaxCode || '').toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (directionFilter === 'PURCHASE' && inv.type !== 'PURCHASE') return false;
      if (directionFilter === 'SALES' && inv.type !== 'SALES') return false;

      if (cashAccountFilter !== 'ALL') {
        const acc = resolveInvoicePaymentAccount(inv);
        if (acc !== cashAccountFilter) return false;
      }
      if (deferredInvoiceFilter === 'ONLY_3387' && !isDeferredRevenueInvoice(inv)) return false;

      // 3. Lọc theo thời gian chi tiết bên trong niên độ
      if (timeFilter === 'ALL') return true;

      const invDate = new Date(inv.date);
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      switch (timeFilter) {
        case 'TODAY': 
          return inv.date.split('T')[0] === now.toISOString().split('T')[0];
        case 'MONTH': 
          return invDate.getMonth() === now.getMonth() && invDate.getFullYear() === now.getFullYear();
        case 'Q1': return invDate.getMonth() >= 0 && invDate.getMonth() <= 2;
        case 'Q2': return invDate.getMonth() >= 3 && invDate.getMonth() <= 5;
        case 'Q3': return invDate.getMonth() >= 6 && invDate.getMonth() <= 8;
        case 'Q4': return invDate.getMonth() >= 9 && invDate.getMonth() <= 11;
        case 'YEAR': return true; // Vì bước 1 đã lọc theo năm rồi
        case 'CUSTOM':
          if (!customRange.from && !customRange.to) return true;
          const from = customRange.from ? customRange.from : '0000-01-01';
          const to = customRange.to ? customRange.to : '9999-12-31';
          return inv.date >= from && inv.date <= to;
        default: return true;
      }
    });
    rows.sort(compareInvoicesChronological);
    const ms = performance.now() - t0;
    logSlowQuery('InvoicePage.filter(invoices)', ms, { rows: rows.length, activeTab });
    return rows;
  }, [
    invoices,
    searchTerm,
    directionFilter,
    cashAccountFilter,
    timeFilter,
    deferredInvoiceFilter,
    customRange,
    financialYear,
    activeTab,
  ]);

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

  useEffect(() => {
    if (!hasMountedFilterResetRef.current) {
      hasMountedFilterResetRef.current = true;
      return;
    }
    setPage(1);
  }, [searchTerm, directionFilter, cashAccountFilter, timeFilter, deferredInvoiceFilter, customRange.from, customRange.to]);

  const vatCalculations = useMemo(() => {
    const entriesInYear = journalEntries.filter(e => e.date >= financialYear.startDate && e.date <= financialYear.endDate);
    const net133 = entriesInYear.reduce((sum, e) => 
      sum + e.details.reduce((s, d) => d.account.startsWith('133') ? s + (d.debit - d.credit) : s, 0)
    , 0);
    const net3331 = entriesInYear.reduce((sum, e) => 
      sum + e.details.reduce((s, d) => d.account.startsWith('3331') ? s + (d.credit - d.debit) : s, 0)
    , 0);

    return {
      inputVAT: Math.max(0, net133),
      outputVAT: Math.max(0, net3331),
      vatToPay: net3331 - net133
    };
  }, [journalEntries, financialYear]);

  const inputInvoices = useMemo(() => filteredInvoices.filter(i => i.type === 'PURCHASE'), [filteredInvoices]);
  const outputInvoices = useMemo(() => filteredInvoices.filter(i => i.type === 'SALES'), [filteredInvoices]);

  const totalItems = useMemo(() => {
    if (activeTab === 'GENERAL') return filteredInvoices.length;
    if (activeTab === 'INPUT_LIST') return inputInvoices.length;
    if (activeTab === 'OUTPUT_LIST') return outputInvoices.length;
    return 0;
  }, [activeTab, filteredInvoices.length, inputInvoices.length, outputInvoices.length]);
  const safePageSize = clampPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, totalPages]);

  const pagedGeneral = useMemo(() => {
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return filteredInvoices.slice(from, to);
  }, [filteredInvoices, safePage, safePageSize]);
  const pagedInput = useMemo(() => {
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return inputInvoices.slice(from, to);
  }, [inputInvoices, safePage, safePageSize]);
  const pagedOutput = useMemo(() => {
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return outputInvoices.slice(from, to);
  }, [outputInvoices, safePage, safePageSize]);

  const handleOpenCreate = (m: 'SALES' | 'PURCHASE', c: 'DEVICE' | 'SERVICE') => {
    setMode(m);
    setCategory(c);
    setEditInvoice(null);
    setShowCreateModal(true);
  };

  const handleDownloadTemplate = (importMode: 'SALES' | 'PURCHASE', importCategory: 'DEVICE' | 'SERVICE') => {
    void downloadInvoiceImportTemplate({
      mode: importMode,
      category: importCategory,
      companyInfo,
    });
  };

  const finalizeImportedInvoices = ({
    importLabel,
    acceptedDrafts,
    importErrors,
    importWarnings,
  }: PendingImportReview) => {
    const warningMessages = importWarnings.map((warning) => warning.message);

    let createdCount = 0;
    acceptedDrafts.forEach((draft) => {
      const success = onCreate({
        ...draft,
        details: (draft.details || []).map((detail) => ({ ...detail })),
      });
      if (success) createdCount += 1;
    });

    if (createdCount > 0) {
      setShowCreateModal(false);
      setEditInvoice(null);
    }

    const summary: string[] = [];
    summary.push(`Đã nhập ${createdCount}/${acceptedDrafts.length} hóa đơn ${importLabel}.`);
    summary.push(
      'Trạng thái thanh toán: ưu tiên cột TK thanh toán (1111/1121 = đã thu/chi TM/CK; 131/331 = công nợ); nếu trống thì suy từ cột Trạng thái / Kết quả kiểm tra.',
    );
    if (warningMessages.length > 0) {
      summary.push(`Cảnh báo ${warningMessages.length} chứng từ cần rà soát.`);
      summary.push(warningMessages.slice(0, 10).join('\n'));
    }
    if (importErrors.length > 0) {
      summary.push(`Bỏ qua ${importErrors.length} dòng/chứng từ không hợp lệ.`);
      summary.push(importErrors.slice(0, 10).join('\n'));
    }
    window.alert(summary.join('\n\n'));
  };

  const handleImportInvoices = async (
    importMode: 'SALES' | 'PURCHASE',
    importCategory: 'DEVICE' | 'SERVICE',
    file: File,
  ) => {
    const actionKey = `${importMode}_${importCategory}`;
    const normalizeKey = (value?: string) => (value || '').trim().toLowerCase();
    const roundMoneyDiff = (value: number) => roundVnd(Number(value) || 0);
    const normalizeStatusText = (value?: string) =>
      (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    const hasStatusKeyword = (text: string, keywords: string[]) => keywords.some((keyword) => text.includes(keyword));
    const importLabel = `${importMode === 'PURCHASE' ? 'mua' : 'bán'} ${importCategory === 'SERVICE' ? 'dịch vụ' : 'thiết bị'}`;

    setPendingImportReview(null);
    setImportingKey(actionKey);
    try {
      const { drafts, skippedRows } = await parseInvoiceImportFile(file, {
        mode: importMode,
        category: importCategory,
      });

      if (drafts.length === 0) {
        const errorLines = skippedRows.slice(0, 10);
        window.alert([
          `Không tìm thấy hóa đơn hợp lệ trong file ${importLabel}.`,
          errorLines.length > 0 ? errorLines.join('\n') : 'Vui lòng kiểm tra lại đúng mẫu Excel.',
        ].join('\n\n'));
        return;
      }

      const scopeInvoices = invoices.filter(
        (inv) => inv.type === importMode && inv.category === importCategory,
      );
      const existingStrictKeys = new Set(scopeInvoices.map((inv) => strictInvoiceDuplicateKey(inv)));
      const batchStrictKeys = new Set<string>();
      const importErrors = [...skippedRows];
      const importWarnings: InvoiceImportWarningItem[] = [];
      const acceptedDrafts: typeof drafts = [];
      let warningIndex = 0;
      const pushImportWarning = (kind: InvoiceImportWarningItem['kind'], message: string) => {
        warningIndex += 1;
        importWarnings.push({
          id: `${kind}-${warningIndex}`,
          kind,
          message,
        });
      };

      drafts.forEach((draft, index) => {
        const postingDate = String(draft.date || '').split('T')[0];
        const invoiceNo = normalizeKey(draft.invoiceNumber);
        const rowRef = `Chứng từ ${index + 1} (${draft.invoiceNumber || 'không số'})`;

        if (!invoiceNo) {
          importErrors.push(`${rowRef}: thiếu số hóa đơn.`);
          return;
        }
        if (!postingDate || postingDate < financialYear.startDate || postingDate > financialYear.endDate) {
          importErrors.push(`${rowRef}: ngày ${postingDate || 'trống'} nằm ngoài niên độ ${financialYear.startDate} - ${financialYear.endDate}.`);
          return;
        }

        const lockedPeriod = accountingPeriods.find(
          (period) => period.status === 'CLOSED' && postingDate >= period.startDate && postingDate <= period.endDate,
        );
        if (lockedPeriod) {
          importErrors.push(`${rowRef}: ngày hạch toán thuộc kỳ đã khóa (${lockedPeriod.name}).`);
          return;
        }

        const strictKey = strictInvoiceDuplicateKey({
          symbolCode: draft.symbolCode,
          invoiceNumber: draft.invoiceNumber,
          buyerTaxCode: draft.buyerTaxCode,
          date: postingDate,
        });
        if (existingStrictKeys.has(strictKey) || batchStrictKeys.has(strictKey)) {
          importErrors.push(
            `${rowRef}: trùng số hóa đơn, ký hiệu và mã số thuế đối tác — không cho import.`,
          );
          return;
        }

        const combinedStatusText = [draft.sourceInvoiceStatus || '', draft.sourceCheckResult || '']
          .filter(Boolean)
          .join(' | ');
        const normalizedCombinedStatus = normalizeStatusText(combinedStatusText);
        const isCancelledOrDeleted = hasStatusKeyword(normalizedCombinedStatus, [
          'huy',
          'xoa',
          'deleted',
          'cancelled',
          'canceled',
          'khong con hieu luc',
          'huy bo',
          'xoa bo',
        ]);

        const sameNumberSoft = scopeInvoices.some((inv) => {
          if (normalizeKey(inv.invoiceNumber) !== invoiceNo) return false;
          return strictInvoiceDuplicateKey(inv) !== strictKey;
        });
        if (sameNumberSoft) {
          pushImportWarning(
            'DUPLICATE_NUMBER',
            `${rowRef}: cùng số HĐ "${draft.invoiceNumber}" với chứng từ khác nhưng khác ký hiệu hoặc MST — có thể import, cần rà soát.`,
          );
        }

        if (isCancelledOrDeleted) {
          pushImportWarning(
            'STATUS',
            `${rowRef}: trạng thái hóa đơn cho thấy chứng từ bị hủy/xóa (${combinedStatusText}).`,
          );
        }

        const roundingDiff = Math.abs(roundMoneyDiff(
          Number(draft.amount || 0) + Number(draft.vatAmount || 0) - Number(draft.totalAmount || 0),
        ));
        if (roundingDiff > 0) {
          pushImportWarning(
            'ROUNDING',
            `${rowRef}: Hóa đơn có chênh lệch làm tròn ${roundingDiff.toLocaleString('vi-VN')}. Hệ thống đã tự cân bút toán nhưng giữ nguyên số gốc từ Excel.`,
          );
        }

        batchStrictKeys.add(strictKey);
        acceptedDrafts.push(draft);
      });

      if (importWarnings.length > 0) {
        setPendingImportReview({
          importLabel,
          acceptedDrafts,
          importErrors,
          importWarnings,
        });
        return;
      }

      finalizeImportedInvoices({
        importLabel,
        acceptedDrafts,
        importErrors,
        importWarnings,
      });
    } catch (error: any) {
      window.alert(error?.message || `Không thể nhập file Excel cho hóa đơn ${importLabel}.`);
    } finally {
      setImportingKey(null);
    }
  };

  const handleOpenEdit = (id: string) => {
     const inv = invoices.find(i => i.id === id);
     if (inv) {
        setEditInvoice(inv);
        setShowCreateModal(true);
     }
  };

  const handleSave = (data: any) => {
    let success = false;
    if (editInvoice) {
       success = onUpdate({
         ...editInvoice,
         ...data,
         id: editInvoice.id,
         type: editInvoice.type,
         category: editInvoice.category,
       });
    } else {
       success = onCreate({ ...data, type: mode, category });
    }
    if (success) {
      setShowCreateModal(false);
      setEditInvoice(null);
    }
  };

  const handleConfirmDelete = (invoice: Invoice) => {
    // Đóng modal ngay — store đã cập nhật danh sách đồng bộ trước khi gọi lifecycle API.
    setDeleteInvoice(null);
    void onDelete(invoice);
  };

  const getVatRateLabel = (inv: Invoice) => {
    const ratesFromDetails = Array.from(
      new Set((inv.details || []).map(d => Number(d.vatRate)).filter(n => Number.isFinite(n)))
    ).sort((a, b) => a - b);
    if (ratesFromDetails.length === 1) return formatVatRateLabel(ratesFromDetails[0]);
    if (ratesFromDetails.length > 1) return ratesFromDetails.map(formatVatRateLabel).join(' / ');
    if (typeof (inv as any).vatRate === 'number') return formatVatRateLabel((inv as any).vatRate);
    return '—';
  };

  const renderVatTable = (list: Invoice[], title: string, color: string) => (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden animate-fade-in print:shadow-none print:border-slate-300">
       <div className={`p-4 border-b bg-${color}-50 flex justify-between items-center print:bg-white`}>
          <div className="flex items-center gap-3">
             <h3 className={`text-xs font-bold tracking-tight print:text-black text-${color}-800`}>{title}</h3>
             <div className="flex gap-2">
                <span className="text-[10px] font-semibold text-slate-400 bg-white px-2 py-1 rounded border print:hidden">Số lượng: {list.length}</span>
                <span className="rounded border bg-white px-2 py-1 text-[10px] font-medium text-blue-600 print:hidden">Niên độ: {fiscalYearLabel}</span>
             </div>
          </div>
          <button 
            onClick={handlePrintList}
            className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all print:hidden"
          >
            <Printer className="w-4 h-4 text-blue-500" /> In bảng kê
          </button>
       </div>
       <table className="w-full text-sm text-left print:text-[12px]">
          <thead className="bg-slate-50 text-[11px] font-semibold tracking-tight text-slate-600 print:bg-white print:text-black">
             <tr>
                <th className="p-3 border-b print:border-black">Ngày HĐ</th>
                <th className="p-3 border-b print:border-black">Số HĐ</th>
                <th className="p-3 border-b print:border-black">Đối tác / MST</th>
                <th className="p-3 text-right border-b print:border-black">Doanh số chưa thuế</th>
                <th className="p-3 text-center border-b print:border-black">Thuế suất</th>
                <th className="p-3 text-right border-b print:border-black">Tiền thuế VAT</th>
                <th className="p-3 text-right border-b print:border-black">Tổng thanh toán</th>
             </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 print:divide-black">
             {list.map((inv) => {
                const rowT = recomputeInvoiceHeaderTotals(inv);
                return (
                <tr
                  key={`${inv.id}-${inv.invoiceNumber}-${inv.date}`}
                  className="hover:bg-slate-50 print:hover:bg-transparent cursor-pointer"
                  onClick={() => setViewInvoice(inv)}
                  title="Click để xem chi tiết"
                >
                   <td className="p-3 text-slate-500 print:text-black">{new Date(inv.date).toLocaleDateString('vi-VN')}</td>
                   <td className="p-3">
                      <div className="font-mono font-bold text-blue-600 print:text-black">{inv.invoiceNumber || '---'}</div>
                      <div className="mt-1 flex flex-wrap gap-1 print:hidden">
                        {isDeferredRevenueInvoice(inv) && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">3387</span>
                        )}
                        {isDeferredRevenueInvoice(inv) && inv.status === 'PAID' && !!inv.paymentVoucherNumber && (
                          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-700">Đã thu tiền riêng</span>
                        )}
                      </div>
                   </td>
                   <td className="p-3">
                      <div className="font-bold text-slate-700 print:text-black">{inv.customerName}</div>
                      <div className="text-[10px] text-slate-400 font-mono print:text-black">{inv.buyerTaxCode || '---'}</div>
                   </td>
                   <td className="p-3 text-right font-medium print:text-black">{formatCurrency(rowT.amount)}</td>
                   <td className="p-3 text-center"><span className="bg-slate-100 px-2 py-0.5 rounded font-bold text-[10px] print:bg-transparent print:border print:border-black">{getVatRateLabel(inv)}</span></td>
                   <td className={`p-3 text-right font-semibold text-${color}-600 print:text-black`}>{formatCurrency(rowT.vatAmount)}</td>
                   <td className="p-3 text-right font-bold text-slate-800 print:text-black">{formatCurrency(rowT.totalAmount)}</td>
                </tr>
                );
             })}
             {list.length === 0 && (
                <tr><td colSpan={7} className="p-12 text-center text-slate-400 italic">Không có dữ liệu hóa đơn nào trong niên độ {fiscalYearLabel}.</td></tr>
             )}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold border-t-2 print:bg-white print:border-t-black">
             <tr>
                <td colSpan={3} className="p-3 text-right text-[10px] font-medium tracking-tight text-slate-500 print:text-black">Tổng cộng bảng kê:</td>
                <td className="p-3 text-right print:text-black">{formatCurrency(list.reduce((s, i) => s + recomputeInvoiceHeaderTotals(i).amount, 0))}</td>
                <td></td>
                <td className={`p-3 text-right text-${color}-600 text-base print:text-black`}>{formatCurrency(list.reduce((s, i) => s + recomputeInvoiceHeaderTotals(i).vatAmount, 0))}</td>
                <td className="p-3 text-right text-slate-800 print:text-black">{formatCurrency(list.reduce((s, i) => s + recomputeInvoiceHeaderTotals(i).totalAmount, 0))}</td>
             </tr>
          </tfoot>
       </table>

       <div className="print:hidden">
         <Pagination
           page={safePage}
           totalItems={totalItems}
           pageSize={safePageSize}
           onChangePage={setPage}
           onChangePageSize={(s) => setPageSize(clampPageSize(s))}
         />
       </div>
       
       <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: landscape; margin: 10mm; }
          body * { visibility: hidden; }
          .animate-fade-in { visibility: visible; position: absolute; left: 0; top: 0; width: 100%; }
          .animate-fade-in * { visibility: visible; }
          .print\\:hidden { display: none !important; }
          header, aside, .SmartAssistant { display: none !important; }
          main { margin-left: 0 !important; padding: 0 !important; }
        }
      `}} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="print:hidden space-y-2.5">
        {misplacedYearDataTotal > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <p>
                Phát hiện <b>{misplacedYearDataTotal}</b> bản ghi liên quan niên độ này (hóa đơn, NKC, chứng từ, kho, quỹ,
                CIT…) đang sai bucket hoặc trùng id giữa các năm — báo cáo / sổ sách có thể lệch cho đến khi hợp nhất.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const r = handleReconcileInvoicesForActiveFiscalYear();
                if (r.message) window.alert(r.message);
              }}
              className="shrink-0 rounded-lg bg-amber-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-800"
            >
              Hợp nhất toàn bộ vào niên độ đang mở
            </button>
          </div>
        )}
        {misplacedYearDataTotal === 0 &&
          invoices.length === 0 &&
          invoiceYearTrace.hasAnyInvoiceOtherFy && (
            <div className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden />
              <p>
                Không có hóa đơn nào có ngày lập trong niên độ hiện tại, trong khi hệ thống vẫn có{' '}
                <b>{allInvoicesAcrossYears.length}</b> hóa đơn ở các niên độ khác. Hãy chọn đúng niên độ tại{' '}
                <b>Hệ thống → Năm tài chính → Cập nhật niên độ</b> để truy vết.
              </p>
            </div>
          )}
        <div className="overflow-hidden rounded-xl bg-white shadow-[0_1px_3px_rgba(15,23,42,0.07)]">
          <div className="flex min-w-0 flex-wrap border-b border-slate-200/80 px-1">
            <button
              type="button"
              onClick={() => setActiveTab('GENERAL')}
              className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px ${activeTab === 'GENERAL' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50/90 hover:text-slate-800'}`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
              Quản lý Hóa đơn
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('INPUT_LIST')}
              className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px ${activeTab === 'INPUT_LIST' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50/90 hover:text-slate-800'}`}
            >
              <Download className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
              Bảng kê Đầu vào
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('OUTPUT_LIST')}
              className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px ${activeTab === 'OUTPUT_LIST' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50/90 hover:text-slate-800'}`}
            >
              <TrendingUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
              Bảng kê Đầu ra
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('GTGT_01')}
              className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px ${activeTab === 'GTGT_01' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50/90 hover:text-slate-800'}`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
              Tờ khai 01/GTGT
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('VAT_REPORT')}
              className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px ${activeTab === 'VAT_REPORT' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50/90 hover:text-slate-800'}`}
            >
              <FileCode className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
              Tờ khai & Cảnh báo
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('E_INVOICE')}
              className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px ${activeTab === 'E_INVOICE' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50/90 hover:text-slate-800'}`}
            >
              <ScanLine className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
              HĐ điện tử (XML)
            </button>
          </div>
        </div>

        {activeTab !== 'GTGT_01' && activeTab !== 'VAT_REPORT' && activeTab !== 'E_INVOICE' && (
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 overflow-x-auto rounded-xl border border-slate-200/90 bg-slate-50/50 px-2.5 py-2 shadow-inner">
            <div className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50/80 px-2">
              <span className="text-[9px] font-medium tracking-tight text-slate-500">Niên độ</span>
              <span className="text-[11px] font-semibold tabular-nums text-blue-700">{fiscalYearLabel}</span>
            </div>
            {deferredInvoiceFilter === 'ONLY_3387' && (
              <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
                3387
              </span>
            )}
            <div className="flex h-10 shrink-0 items-center gap-1.5 text-slate-500">
              <Filter className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden text-[9px] font-medium tracking-tight text-slate-500 sm:inline">Thời gian</span>
            </div>
            <label htmlFor="invoice-time-filter" className="sr-only">
              Khoảng thời gian lọc
            </label>
            <select
              id="invoice-time-filter"
              value={timeFilter}
              onChange={(e) => {
                setTimeFilter(e.target.value as TimeFilterType);
                setPage(1);
              }}
              className="h-10 min-w-[10.5rem] shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 pr-8 text-xs font-bold text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
            >
              <optgroup label="Niên độ đang chọn">
                <option value="ALL">Tất cả trong niên độ</option>
              </optgroup>
              <optgroup label="Nhanh">
                <option value="TODAY">Hôm nay</option>
                <option value="MONTH">Tháng này</option>
                <option value="YEAR">Cả năm (niên độ)</option>
              </optgroup>
              <optgroup label="Theo quý (trong niên độ)">
                <option value="Q1">Quý 1</option>
                <option value="Q2">Quý 2</option>
                <option value="Q3">Quý 3</option>
                <option value="Q4">Quý 4</option>
              </optgroup>
              <optgroup label="Tùy chỉnh">
                <option value="CUSTOM">Tùy chọn khoảng ngày…</option>
              </optgroup>
            </select>
            <label htmlFor="invoice-deferred-filter" className="sr-only">
              Lọc hóa đơn doanh thu chưa thực hiện
            </label>
            <select
              id="invoice-deferred-filter"
              value={deferredInvoiceFilter}
              onChange={(e) => {
                setDeferredInvoiceFilter(e.target.value as DeferredInvoiceFilter);
                setPage(1);
              }}
              className="h-10 min-w-[10.5rem] shrink-0 rounded-lg border border-amber-200/90 bg-amber-50/80 px-2.5 pr-8 text-xs font-bold text-slate-800 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            >
              <option value="ALL">Hóa đơn: Tất cả</option>
              <option value="ONLY_3387">Hóa đơn: Chỉ 3387</option>
            </select>
            <label htmlFor="invoice-direction-filter" className="sr-only">
              Chiều hóa đơn
            </label>
            <select
              id="invoice-direction-filter"
              value={directionFilter}
              onChange={(e) => {
                setDirectionFilter(e.target.value as InvoiceDirectionFilter);
                setPage(1);
              }}
              className="h-10 min-w-[9.5rem] shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 pr-8 text-xs font-bold text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
              title="Mua vào / Bán ra"
            >
              <option value="ALL">Chiều: Tất cả</option>
              <option value="PURCHASE">Mua vào</option>
              <option value="SALES">Bán ra</option>
            </select>
            <label htmlFor="invoice-cash-account-filter" className="sr-only">
              Tài khoản tiền thanh toán
            </label>
            <select
              id="invoice-cash-account-filter"
              value={cashAccountFilter}
              onChange={(e) => {
                setCashAccountFilter(e.target.value as InvoiceCashAccountFilter);
                setPage(1);
              }}
              className="h-10 min-w-[11rem] shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 pr-8 text-xs font-bold text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
              title="Lọc HĐ đã thanh toán qua TK 1111 hoặc 1121 (không gồm công nợ)"
            >
              <option value="ALL">TK tiền: Tất cả</option>
              <option value="1111">1111 — Tiền mặt</option>
              <option value="1121">1121 — Tiền gửi NH</option>
            </select>
            <div className="relative min-w-[12rem] flex-1 basis-[14rem]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="invoice-search-q"
                placeholder="Tìm số HĐ, tên đối tác, MST…"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white py-0 pl-9 pr-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        )}
      </div>

      {activeTab !== 'GTGT_01' && activeTab !== 'VAT_REPORT' && activeTab !== 'E_INVOICE' && (activeTab === 'GENERAL' || timeFilter === 'CUSTOM') && (
        <>
          {activeTab === 'GENERAL' ? (
            <div className="flex flex-col gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-sm print:hidden sm:p-3.5">
              <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5">
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenCreate('SALES', 'DEVICE')}
                    className="inline-flex shrink-0 items-center justify-center gap-0.5 rounded-md bg-blue-600 px-2 py-1.5 text-[10px] font-semibold leading-none text-white shadow-sm transition-colors hover:bg-blue-700"
                    title="Bán hàng thiết bị"
                  >
                    <Plus className="h-3 w-3 shrink-0" />
                    Bán thiết bị
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenCreate('SALES', 'SERVICE')}
                    className="inline-flex shrink-0 items-center justify-center gap-0.5 rounded-md bg-indigo-600 px-2 py-1.5 text-[10px] font-semibold leading-none text-white shadow-sm transition-colors hover:bg-indigo-700"
                    title="Bán hàng dịch vụ"
                  >
                    <Briefcase className="h-3 w-3 shrink-0" />
                    Bán dịch vụ
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenCreate('PURCHASE', 'DEVICE')}
                    className="inline-flex shrink-0 items-center justify-center gap-0.5 rounded-md bg-emerald-600 px-2 py-1.5 text-[10px] font-semibold leading-none text-white shadow-sm transition-colors hover:bg-emerald-700"
                    title="Mua hàng thiết bị"
                  >
                    <Download className="h-3 w-3 shrink-0" />
                    Mua thiết bị
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenCreate('PURCHASE', 'SERVICE')}
                    className="inline-flex shrink-0 items-center justify-center gap-0.5 rounded-md bg-teal-600 px-2 py-1.5 text-[10px] font-semibold leading-none text-white shadow-sm transition-colors hover:bg-teal-700"
                    title="Mua hàng dịch vụ"
                  >
                    <Briefcase className="h-3 w-3 shrink-0" />
                    Mua dịch vụ
                  </button>
                </div>
              </div>
              {timeFilter === 'CUSTOM' && (
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 sm:pl-1">
                  <Calendar className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="text-xs font-bold text-slate-500">Từ ngày</span>
                  <input
                    type="date"
                    value={customRange.from}
                    onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-bold text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                  />
                  <span className="text-xs font-bold text-slate-400">đến</span>
                  <input
                    type="date"
                    value={customRange.to}
                    onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-bold text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-sm print:hidden sm:p-3.5">
              {timeFilter === 'CUSTOM' && (
                <div className="flex flex-wrap items-center gap-2 sm:pl-1">
                  <Calendar className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="text-xs font-bold text-slate-500">Từ ngày</span>
                  <input
                    type="date"
                    value={customRange.from}
                    onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-bold text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                  />
                  <span className="text-xs font-bold text-slate-400">đến</span>
                  <input
                    type="date"
                    value={customRange.to}
                    onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-bold text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'E_INVOICE' && <EInvoiceElectronicPanel />}

      {activeTab === 'GENERAL' && (
        <InvoiceManagerView 
          invoices={pagedGeneral}
          onView={setViewInvoice}
          onEdit={handleOpenEdit}
          onDelete={setDeleteInvoice}
        />
      )}

      {activeTab === 'GENERAL' && (
        <Pagination
          page={safePage}
          totalItems={totalItems}
          pageSize={safePageSize}
          onChangePage={setPage}
          onChangePageSize={(s) => setPageSize(clampPageSize(s))}
        />
      )}

      {activeTab === 'INPUT_LIST' && renderVatTable(pagedInput, "Bảng kê hóa đơn, chứng từ hàng hóa dịch vụ MUA VÀO (01-2/GTGT)", "emerald")}
      {activeTab === 'OUTPUT_LIST' && renderVatTable(pagedOutput, "Bảng kê hóa đơn, chứng từ hàng hóa dịch vụ BÁN RA (01-1/GTGT)", "blue")}

      {activeTab === 'GTGT_01' && (
        <VatGtgt01Declaration invoices={invoices} companyInfo={companyInfo} financialYear={financialYear} />
      )}

      {activeTab === 'VAT_REPORT' && (
        <div className="grid grid-cols-1 gap-6 animate-fade-in print:hidden lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="overflow-hidden rounded-xl bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
              <div className="flex flex-col gap-3 border-b border-slate-100/90 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <FileCode className="h-4 w-4 text-violet-600" aria-hidden />
                  Tờ khai Thuế GTGT ròng thực tế
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => alert('Xuất XML')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 shadow-sm transition-colors hover:bg-violet-50"
                  >
                    <FileCode className="h-3.5 w-3.5" aria-hidden />
                    XML HTKK
                  </button>
                </div>
              </div>
              <div className="space-y-6 p-6 sm:p-7">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
                  <div className="rounded-xl border-l-4 border-emerald-500 bg-white py-5 pl-5 pr-4 shadow-[0_1px_4px_rgba(15,23,42,0.05)]">
                    <p className="mb-3 text-[12px] font-medium tracking-tight text-slate-500">
                      VAT đầu vào được khấu trừ (133 ròng)
                    </p>
                    <VatReportAmount value={vatCalculations.inputVAT} />
                  </div>
                  <div className="rounded-xl border-l-4 border-violet-500 bg-white py-5 pl-5 pr-4 shadow-[0_1px_4px_rgba(15,23,42,0.05)]">
                    <p className="mb-3 text-[12px] font-medium tracking-tight text-slate-500">
                      VAT đầu ra còn nộp (3331 ròng)
                    </p>
                    <VatReportAmount value={vatCalculations.outputVAT} />
                  </div>
                </div>

                <div
                  className={`rounded-xl border border-slate-100/80 bg-white py-6 text-center shadow-[0_1px_4px_rgba(15,23,42,0.05)] sm:py-7 ${
                    vatCalculations.vatToPay > 0 ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-emerald-500'
                  }`}
                >
                  <p className="mb-3 text-[12px] font-medium tracking-tight text-slate-500">
                    {vatCalculations.vatToPay > 0
                      ? 'Số thuế GTGT còn phải nộp sau đối soát'
                      : 'Đã tất toán thuế / Còn được khấu trừ'}
                  </p>
                  <div className="flex justify-center">
                    <VatReportAmount
                      value={Math.max(0, vatCalculations.vatToPay)}
                      tone={vatCalculations.vatToPay > 0 ? 'danger' : 'success'}
                    />
                  </div>
                  {vatCalculations.vatToPay <= 0 && (
                    <div className="mx-auto mt-4 inline-flex max-w-md items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/80 px-3 py-1.5 text-xs font-medium text-emerald-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                      Nghĩa vụ thuế đã hoàn tất
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="h-fit overflow-hidden rounded-xl bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between border-b border-slate-100/90 bg-white px-4 py-3">
              <h3 className="flex items-center gap-2 text-[12px] font-semibold tracking-tight text-slate-500">
                <ListChecks className="h-4 w-4 text-amber-500" aria-hidden />
                Kiểm tra rà soát ({vatCalculations.vatToPay > 0 ? '1' : '2'})
              </h3>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              {vatCalculations.vatToPay > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-xl border-l-4 border-red-400 bg-white py-3 pl-4 pr-3 shadow-[0_1px_4px_rgba(15,23,42,0.05)]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
                    <div>
                      <p className="text-[12px] font-semibold tracking-tight text-red-800">Cảnh báo nộp chậm</p>
                      <p className="mt-1 text-[12px] leading-snug text-red-600/90">
                        Thuế đầu ra (3331) còn dư chưa được triệt tiêu bởi phiếu chi nộp thuế.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const amount = Math.max(0, vatCalculations.vatToPay);
                      const today = new Date().toISOString().split('T')[0];
                      const id = `VOU-TAX-${Date.now()}`;
                      const voucherNumber = previewDocumentNumber('UNC', today);

                      setActiveTabGlobal('doc_bank');
                      setModals((m: any) => ({
                        ...m,
                        openVoucherEditor: true,
                        prefillVoucherDraft: {
                          id,
                          voucherType: 'PAYMENT_ORDER',
                          voucherNumber,
                          date: today,
                          postingDate: today,
                          description: 'Nộp thuế GTGT (Nợ 3331)',
                          contactName: 'Cơ quan thuế',
                          totalAmount: amount,
                          status: 'DRAFT',
                          details: [
                            {
                              id: '1',
                              description: 'Nộp thuế GTGT',
                              debitAccount: '3331',
                              creditAccount: '1121',
                              amount,
                            },
                          ],
                        },
                      }));
                    }}
                    className="w-full rounded-xl border border-violet-200 bg-violet-600 px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-700"
                  >
                    Lập Ủy nhiệm chi nộp thuế
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-8 w-8 shrink-0 text-emerald-500" aria-hidden />
                    <div className="min-w-0 pt-0.5">
                      <p className="text-sm font-semibold text-slate-800">Dữ liệu an toàn</p>
                      <p className="mt-0.5 text-[12px] text-slate-500">Số dư TK thuế đã khớp với sổ cái trong niên độ.</p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50/90 px-2 py-3">
                    <p className="mb-2 px-1 text-[11px] font-medium tracking-tight text-slate-500">So sánh nhanh</p>
                    <div className="h-[112px] w-full">
                      <Suspense fallback={<div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />}>
                        <InvoiceVatComparisonChart
                          data={[
                            { name: 'Đầu vào', v: vatCalculations.inputVAT },
                            { name: 'Đầu ra', v: vatCalculations.outputVAT },
                          ]}
                        />
                      </Suspense>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <InvoiceCreationModal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); setEditInvoice(null); }}
        onSave={handleSave}
        mode={editInvoice ? editInvoice.type : mode}
        category={editInvoice ? editInvoice.category : category}
        invoice={editInvoice}
        onDownloadTemplate={handleDownloadTemplate}
        onImport={handleImportInvoices}
        importing={!editInvoice && importingKey === `${mode}_${category}`}
      />
      <InvoiceDetailModal invoice={viewInvoice} onClose={() => setViewInvoice(null)} />
      <DeleteInvoiceModal invoice={deleteInvoice} onClose={() => setDeleteInvoice(null)} onConfirm={handleConfirmDelete} />
      <InvoiceImportWarningsModal
        isOpen={!!pendingImportReview}
        importLabel={pendingImportReview?.importLabel || ''}
        warnings={pendingImportReview?.importWarnings || []}
        onClose={() => setPendingImportReview(null)}
        onConfirm={() => {
          if (!pendingImportReview) return;
          const nextImport = pendingImportReview;
          setPendingImportReview(null);
          finalizeImportedInvoices(nextImport);
        }}
      />
    </div>
  );
};
