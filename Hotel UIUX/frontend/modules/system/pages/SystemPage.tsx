
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Building, Calendar, Activity, FileClock, Database, 
  Save, CheckCircle2, Lock, Unlock, AlertCircle, RefreshCw, Upload, Download, X, HelpCircle, Wrench,
} from 'lucide-react';
import { UserManagementView } from '../components/UserManagementView';
import { useApp } from '../../../app/store';
import { formatCurrency } from '@shared/utils/format';
import { getDisplayArApFromGl } from '@shared/utils/glLedgerBalances';
import {
  AccountingVoucher,
  Customer,
  Supplier,
  Invoice,
  JournalEntry,
  OpeningBalanceAccountRecord,
  OpeningAssetToolCarryForward,
  OpeningBalanceDebtDetail,
  OpeningBalanceRolloverMeta,
  OpeningDebtKind,
  OpeningDebtRevenueType,
  FinancialYear,
} from '@shared/types';

export const SystemPage = () => {
  const { activeTab } = useApp();

  const renderContent = () => {
    switch (activeTab) {
      case 'sys_company': return <CompanyInfoView />;
      case 'sys_users': return <UserManagementView />;
      case 'sys_year': return <FinancialYearView />;
      case 'sys_initial': return <InitialSetupView />;
      case 'sys_status': return <SystemStatusView />;
      case 'sys_logs': return <SystemLogsView />;
      case 'sys_backup': return <BackupRestoreView />;
      default: return <SystemStatusView />;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 min-h-[600px]">
       {renderContent()}
    </div>
  );
};

// --- HELPERS FOR INPUT FORMATTING ---
const formatInputNumber = (val: number) => {
  if (val === 0) return '';
  return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const parseInputNumber = (val: string) => {
  return Number(val.replace(/\./g, ''));
};

const shiftDateString = (dateStr: string, days: number) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split('T')[0];
};

const calculateAccountBalanceAtDate = (entries: JournalEntry[], prefixes: string[], dateStr: string) => {
  return entries
    .filter(entry => entry.date <= dateStr)
    .reduce((acc, entry) => {
      return acc + entry.details.reduce((sum, detail) => {
        const account = String(detail.account || '');
        if (!prefixes.some(prefix => account.startsWith(prefix))) return sum;
        const isAsset = ['1', '2', '6', '8'].some(prefix => account.startsWith(prefix));
        return sum + (isAsset ? (Number(detail.debit || 0) - Number(detail.credit || 0)) : (Number(detail.credit || 0) - Number(detail.debit || 0)));
      }, 0);
    }, 0);
};

const resolveCashEquivalentOpening60 = (entries: JournalEntry[], startDate: string) => {
  const openingCutoff = shiftDateString(startDate, -1);
  const hasPreferredUsage = entries.some(entry =>
    (entry.details || []).some(detail =>
      ['1111', '1112', '1121', '1122', '121'].some(prefix => String(detail.account || '').startsWith(prefix)),
    )
  );
  const prefixes = hasPreferredUsage ? ['1111', '1112', '1121', '1122', '121'] : ['111', '112', '121'];
  return calculateAccountBalanceAtDate(entries, prefixes, openingCutoff);
};

const OPENING_DEBT_REVENUE_OPTIONS: Record<
  OpeningDebtKind,
  { value: OpeningDebtRevenueType; label: string }[]
> = {
  CUSTOMER_DEBT: [
    { value: 'BAN_HANG_HOA', label: 'Bán hàng hóa' },
    { value: 'CUNG_CAP_DICH_VU', label: 'Cung cấp dịch vụ' },
    { value: 'XAY_LAP_DU_AN', label: 'Xây lắp / dự án' },
    { value: 'KHAC', label: 'Khác' },
  ],
  SUPPLIER_DEBT: [
    { value: 'MUA_HANG_HOA', label: 'Mua hàng hóa' },
    { value: 'MUA_DICH_VU', label: 'Mua dịch vụ' },
    { value: 'TAI_SAN_CCDC', label: 'TSCĐ / CCDC' },
    { value: 'KHAC', label: 'Khác' },
  ],
};

const createOpeningDebtDraft = (kind: OpeningDebtKind): OpeningBalanceDebtDetail => ({
  id: `open-debt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  kind,
  partnerName: '',
  invoiceSymbolCode: '',
  invoiceNo: '',
  revenueType: kind === 'CUSTOMER_DEBT' ? 'BAN_HANG_HOA' : 'MUA_HANG_HOA',
  amount: 0,
  dueDate: '',
  note: '',
  accountCode: kind === 'CUSTOMER_DEBT' ? '131' : '331',
  originMode: 'MANUAL',
  readOnly: false,
  syncStatus: 'MATCHED',
});

const normalizeLookupText = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const normalizeTaxCode = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const resolveInvoicePartner = (
  kind: OpeningDebtKind,
  invoice: Invoice,
  partners: Array<Customer | Supplier>,
): Customer | Supplier | undefined => {
  const invoiceTaxCode = normalizeTaxCode(invoice.buyerTaxCode || '');
  if (invoiceTaxCode) {
    const sameTax = partners.filter((p) => normalizeTaxCode((p as Customer | Supplier).taxCode || '') === invoiceTaxCode);
    if (sameTax.length === 1) return sameTax[0];
  }

  const rawName =
    kind === 'CUSTOMER_DEBT'
      ? invoice.customerName || invoice.buyerUnitName || invoice.buyerLegalName || ''
      : invoice.customerName || invoice.buyerUnitName || '';
  const nameKey = normalizeLookupText(rawName);
  if (!nameKey) return undefined;

  const exact = partners.filter((p) => normalizeLookupText(p.name || '') === nameKey);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;

  let matched: Customer | Supplier | undefined;
  for (const partner of partners) {
    const pn = normalizeLookupText(partner.name || '');
    if (!pn) continue;
    if (!(pn.includes(nameKey) || nameKey.includes(pn))) continue;
    if (matched && matched.id !== partner.id) return undefined;
    matched = partner;
  }
  return matched;
};

const inferOpeningDebtRevenueFromInvoice = (
  kind: OpeningDebtKind,
  invoice: Invoice,
): OpeningDebtRevenueType =>
  kind === 'CUSTOMER_DEBT'
    ? invoice.category === 'SERVICE'
      ? 'CUNG_CAP_DICH_VU'
      : 'BAN_HANG_HOA'
    : invoice.category === 'SERVICE'
    ? 'MUA_DICH_VU'
    : 'MUA_HANG_HOA';

const computeLedgerOutstandingByInvoice = (
  entries: JournalEntry[],
  accountPrefix: '131' | '331',
  endDate: string,
  kind: OpeningDebtKind,
) => {
  const netByInvoice = new Map<string, number>();
  for (const entry of entries || []) {
    if (String(entry.date || '') > endDate) continue;
    for (const detail of entry.details || []) {
      const account = String(detail.account || '');
      if (!account.startsWith(accountPrefix)) continue;
      const key = String(detail.sourceInvoiceId || detail.sourceInvoiceNumber || detail.objectId || '').trim();
      if (!key) continue;
      const prev = netByInvoice.get(key) || 0;
      netByInvoice.set(key, prev + (Number(detail.debit || 0) - Number(detail.credit || 0)));
    }
  }

  const outstandingByInvoice = new Map<string, number>();
  for (const [key, net] of netByInvoice.entries()) {
    const amount = kind === 'CUSTOMER_DEBT' ? Math.round(net) : Math.round(-net);
    if (amount > 0) outstandingByInvoice.set(key, amount);
  }
  return outstandingByInvoice;
};

const buildLinkedOpeningDebtRowsFromInvoices = ({
  kind,
  invoices,
  journalEntries,
  financialYear,
  partners,
}: {
  kind: OpeningDebtKind;
  invoices: Invoice[];
  journalEntries: JournalEntry[];
  financialYear: FinancialYear;
  partners: Array<Customer | Supplier>;
}): OpeningBalanceDebtDetail[] => {
  const accountPrefix: '131' | '331' = kind === 'CUSTOMER_DEBT' ? '131' : '331';
  const cutoff = shiftDateString(financialYear.startDate, -1);
  const ledgerOutstanding = computeLedgerOutstandingByInvoice(journalEntries, accountPrefix, cutoff, kind);

  const expectedType = kind === 'CUSTOMER_DEBT' ? 'SALES' : 'PURCHASE';
  const fromPriorPeriod = invoices.filter((inv) => {
    if (inv.type !== expectedType) return false;
    const invoiceDate = String(inv.date || '').split('T')[0];
    const postingDate = String(inv.accountingPostingDate || inv.date || '').split('T')[0];
    return invoiceDate <= cutoff || postingDate <= cutoff;
  });

  const candidates = (fromPriorPeriod.length > 0
    ? fromPriorPeriod
    : invoices.filter((inv) => inv.type === expectedType && inv.status === 'PENDING')
  ).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  const rows: OpeningBalanceDebtDetail[] = [];
  const dedupe = new Set<string>();
  for (const invoice of candidates) {
    const byId = ledgerOutstanding.get(String(invoice.id || '').trim()) || 0;
    const byNo = ledgerOutstanding.get(String(invoice.invoiceNumber || '').trim()) || 0;
    const fallbackPending = invoice.status === 'PENDING' ? Math.round(Number(invoice.totalAmount || 0)) : 0;
    const amount = Math.max(0, byId || byNo || fallbackPending);
    if (!(amount > 0)) continue;

    const partner = resolveInvoicePartner(kind, invoice, partners);
    const partnerName =
      String(
        partner?.name ||
          invoice.customerName ||
          invoice.buyerUnitName ||
          invoice.buyerLegalName ||
          (kind === 'CUSTOMER_DEBT' ? 'Khách hàng chưa định danh' : 'Nhà cung cấp chưa định danh'),
      ).trim();
    const invoiceNo = String(invoice.invoiceNumber || '').trim();
    const key = `${kind}|${invoice.id || ''}|${invoiceNo}|${partner?.id || partnerName}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);

    rows.push({
      id: `open-debt-link-${invoice.id || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      partnerId: partner?.id,
      partnerCode: partner?.code,
      partnerName,
      invoiceSymbolCode: String(invoice.symbolCode || '').trim() || undefined,
      invoiceNo: invoiceNo || `INV-${String(invoice.id || '').slice(-6)}`,
      revenueType: inferOpeningDebtRevenueFromInvoice(kind, invoice),
      amount,
      dueDate: invoice.paymentDate ? String(invoice.paymentDate).split('T')[0] : undefined,
      note: `Liên kết tự động từ hóa đơn VAT ${invoiceNo || invoice.id} (TK ${accountPrefix})`,
      accountCode: accountPrefix,
      sourceInvoiceId: invoice.id,
      sourceInvoiceNumber: invoice.invoiceNumber,
      sourceInvoiceDate: String(invoice.date || '').split('T')[0] || undefined,
      originMode: 'MANUAL',
      readOnly: false,
      syncStatus: 'MATCHED',
    });
  }
  return rows;
};

const buildOpeningAccountDraft = (
  accounts: { code: string }[],
  openingBalanceAccounts: OpeningBalanceAccountRecord[],
) => {
  return accounts.map((account) => {
    const matched = openingBalanceAccounts.find((item) => item.accountCode === account.code);
    const debit = Number(matched?.debit || 0);
    const credit = Number(matched?.credit || 0);
    return {
      account: account.code,
      debit: Math.round(debit),
      credit: Math.round(credit),
    };
  });
};

const getOpeningAccountTotal = (
  openingBalanceAccounts: OpeningBalanceAccountRecord[],
  accountPrefix: string,
  side: 'DEBIT' | 'CREDIT',
) => {
  const value = openingBalanceAccounts
    .filter((entry) => String(entry.accountCode || '').startsWith(accountPrefix))
    .reduce(
      (sum, entry) => {
        if (side === 'DEBIT') return sum + Number(entry.debit || 0) - Number(entry.credit || 0);
        return sum + Number(entry.credit || 0) - Number(entry.debit || 0);
      },
      0,
    );
  return Math.round(value);
};

const getOpeningDebtTotal = (rows: OpeningBalanceDebtDetail[], kind: OpeningDebtKind) =>
  Math.round(
    rows
      .filter((row) => row.kind === kind)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0),
  );

const getOpeningConsistencySummary = (
  openingBalanceAccounts: OpeningBalanceAccountRecord[],
  rows: OpeningBalanceDebtDetail[],
  ledger?: {
    journalEntries: JournalEntry[];
    accountingVouchers?: AccountingVoucher[];
    financialYear: FinancialYear;
  },
) => {
  const customerDeclaredTotal = getOpeningAccountTotal(openingBalanceAccounts, '131', 'DEBIT');
  const supplierDeclaredTotal = getOpeningAccountTotal(openingBalanceAccounts, '331', 'CREDIT');
  const customerDetailTotal = getOpeningDebtTotal(rows, 'CUSTOMER_DEBT');
  const supplierDetailTotal = getOpeningDebtTotal(rows, 'SUPPLIER_DEBT');
  const customerDifference = customerDeclaredTotal - customerDetailTotal;
  const supplierDifference = supplierDeclaredTotal - supplierDetailTotal;

  let customerLedgerTotal = customerDeclaredTotal;
  let supplierLedgerTotal = supplierDeclaredTotal;
  if (ledger?.journalEntries && ledger?.financialYear) {
    const { ar, ap } = getDisplayArApFromGl(
      ledger.journalEntries,
      ledger.accountingVouchers,
      ledger.financialYear,
    );
    customerLedgerTotal = ar;
    supplierLedgerTotal = ap;
  }

  return {
    /** Khai báo đầu kỳ (snapshot) — dùng đối chiếu khóa */
    customerDeclaredTotal,
    supplierDeclaredTotal,
    /** Số dư lũy kế NKC + chứng từ trong niên độ (giảm sau phiếu thu/chi) */
    customerLedgerTotal,
    supplierLedgerTotal,
    /** Hiển thị chính: sổ cái */
    customerAccountTotal: customerLedgerTotal,
    supplierAccountTotal: supplierLedgerTotal,
    customerDetailTotal,
    supplierDetailTotal,
    customerDifference,
    supplierDifference,
    customerMatched: customerDifference === 0,
    supplierMatched: supplierDifference === 0,
    overallMatched: customerDifference === 0 && supplierDifference === 0,
  };
};

const isOpeningAccountReadOnly = (
  accountCode: string,
  openingBalanceAccounts: OpeningBalanceAccountRecord[],
  rolloverMeta?: OpeningBalanceRolloverMeta,
) => {
  const rowReadOnly = openingBalanceAccounts.find((row) => row.accountCode === accountCode)?.readOnly;
  if (rowReadOnly) return true;
  return Boolean(rolloverMeta?.lockedAccountCodes?.includes(accountCode));
};

// --- COMMON CONFIRM MODAL COMPONENT ---
const ConfirmActionModal = ({ isOpen, title, message, onConfirm, onClose, type = 'blue' }: any) => {
  if (!isOpen) return null;
  const colors: any = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    amber: 'bg-amber-500 hover:bg-amber-600',
    emerald: 'bg-emerald-600 hover:bg-emerald-700'
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60] animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-6 text-center">
          <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4 ${type === 'blue' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
             <HelpCircle className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">{title}</h3>
          <p className="text-slate-500 text-sm leading-relaxed whitespace-pre-line text-left">{message}</p>
        </div>
        <div className="bg-slate-50 p-4 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg font-bold text-slate-600 hover:bg-white transition-colors">Hủy bỏ</button>
          <button onClick={onConfirm} className={`flex-1 px-4 py-2 text-white rounded-lg font-bold shadow-md transition-all active:scale-95 ${colors[type]}`}>Xác nhận</button>
        </div>
      </div>
    </div>
  );
};

// --- SUB-COMPONENTS ---

const CompanyInfoView = () => {
  const { companyInfo, handleUpdateCompanyInfo } = useApp();
  const [info, setInfo] = useState(companyInfo);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleChange = (field: keyof typeof info, value: string) => {
    setInfo(prev => ({ ...prev, [field]: value }));
  };

  const handleRequestSave = () => {
    setShowConfirm(true);
  };

  const handleFinalConfirm = () => {
    handleUpdateCompanyInfo(info);
    setShowConfirm(false);
    // Có thể thêm toast thông báo ở đây nếu muốn
  };

  return (
    <div className="p-6 max-w-4xl">
      <h3 className="font-bold text-lg text-slate-800 mb-6 flex items-center gap-2">
        <Building className="w-5 h-5 text-blue-600" /> Thông tin Doanh nghiệp
      </h3>
      <div className="grid grid-cols-2 gap-6">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Tên doanh nghiệp</label>
          <input 
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none font-bold" 
            value={info.name} 
            onChange={e => handleChange('name', e.target.value)} 
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Mã số thuế</label>
          <input 
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none font-mono" 
            value={info.taxCode} 
            onChange={e => handleChange('taxCode', e.target.value)} 
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Mã chi nhánh / bộ phận</label>
          <input
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none font-mono font-bold uppercase"
            value={info.branchCode || ''}
            onChange={e => handleChange('branchCode', e.target.value.toUpperCase())}
            placeholder="VD: HN, HCM..."
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
           <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Điện thoại</label>
              <input 
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                value={info.phone} 
                onChange={e => handleChange('phone', e.target.value)} 
              />
           </div>
           <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Fax</label>
              <input 
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                value={info.fax || ''} 
                onChange={e => handleChange('fax', e.target.value)} 
                placeholder="Số Fax..."
              />
           </div>
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Địa chỉ đăng ký kinh doanh (Số nhà, đường...)</label>
          <input 
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none" 
            value={info.address} 
            onChange={e => handleChange('address', e.target.value)} 
          />
        </div>
        <div className="col-span-1">
          <label className="block text-sm font-medium text-slate-700 mb-1">Tỉnh / Thành phố</label>
          <input 
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-800" 
            value={info.city || ''} 
            placeholder="VD: Hà Nội"
            onChange={e => handleChange('city', e.target.value)} 
          />
        </div>
        <div className="col-span-1">
          <label className="block text-sm font-medium text-slate-700 mb-1">Quốc gia</label>
          <input 
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-800" 
            value={info.country || ''} 
            placeholder="VD: Việt Nam"
            onChange={e => handleChange('country', e.target.value)} 
          />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Email liên hệ</label>
          <input 
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none" 
            value={info.email} 
            onChange={e => handleChange('email', e.target.value)} 
          />
        </div>
        <div className="col-span-2 pt-4">
          <button 
            onClick={handleRequestSave}
            className="px-8 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 flex items-center gap-2 shadow-lg shadow-blue-100 transition-all active:scale-95"
          >
            <Save className="w-5 h-5" /> Lưu thông tin
          </button>
        </div>
      </div>

      <ConfirmActionModal 
        isOpen={showConfirm}
        title="Lưu thông tin?"
        message="Hệ thống sẽ cập nhật thông tin doanh nghiệp mới vào tất cả các chứng từ và báo cáo. Bạn có chắc chắn?"
        onConfirm={handleFinalConfirm}
        onClose={() => setShowConfirm(false)}
        type="blue"
      />
    </div>
  );
};

const FinancialYearView = () => {
  const { financialYear, financialYears, activeYearKey, handleUpsertFinancialYear, persistStatus, backendAvailable } = useApp();
  const [data, setData] = useState(financialYear);
  const [showConfirm, setShowConfirm] = useState(false);
  const [rollover, setRollover] = useState(true);
  const [rolloverFromKey, setRolloverFromKey] = useState<string>(activeYearKey);
  const [yearSelectHint, setYearSelectHint] = useState(false);

  useEffect(() => {
    setData(financialYear);
    setRolloverFromKey(activeYearKey);
  }, [financialYear, activeYearKey]);

  const selectedKey = `${data.startDate}..${data.endDate}`;
  const isPendingDifferentYear = selectedKey !== activeYearKey;

  const handleRequestUpdate = () => {
    if (rollover && selectedKey === activeYearKey) {
      window.alert(
        'Không thể kết chuyển số dư cuối kỳ: niên độ trong « Niên độ hiện có » vẫn trùng với niên độ đang làm việc.\n\n' +
          'Vui lòng chọn sang niên độ mới (kỳ sau) trước khi bấm « Cập nhật niên độ ». Nếu chỉ cần lưu dữ liệu hiện tại không kết chuyển, hãy bỏ chọn mục « Chuyển số dư & tồn kho sang năm mới ».',
      );
      return;
    }
    setShowConfirm(true);
  };

  const handleFinalConfirm = async () => {
    const ok = await handleUpsertFinancialYear(data, { rollover, rolloverFromKey });
    if (ok) {
      setShowConfirm(false);
      setYearSelectHint(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h3 className="font-bold text-lg text-slate-800 mb-6 flex items-center gap-2">
        <Calendar className="w-5 h-5 text-blue-600" /> Thiết lập Năm tài chính
      </h3>
      <div className="space-y-4">
        {rollover && selectedKey === activeYearKey && (
          <div className="bg-rose-50 p-3 rounded-xl border border-rose-200 text-sm text-rose-900 mb-4 flex gap-2">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
            <p>
              <b>Kết chuyển không hợp lệ:</b> « Niên độ hiện có » đang trùng với niên độ đang làm việc. Chọn <b>niên độ đích (kỳ mới)</b>{' '}
              rồi mới bấm <b>Cập nhật niên độ</b>, hoặc tắt « Chuyển số dư & tồn kho sang năm mới » nếu chỉ muốn lưu dữ liệu kỳ hiện tại.
            </p>
          </div>
        )}
        {yearSelectHint && isPendingDifferentYear && (
          <div className="bg-sky-50 p-3 rounded-xl border border-sky-200 text-sm text-sky-900 mb-4 flex gap-2">
            <AlertCircle className="w-5 h-5 shrink-0 text-sky-600" />
            <p>
              Bạn đã chọn niên độ khác với niên độ đang mở. Nhấn <b>Cập nhật niên độ</b> để lưu dữ liệu niên độ hiện tại và
              chuyển sang — nếu chỉ đổi lựa chọn mà không cập nhật, dữ liệu trên màn hình vẫn thuộc niên độ đang mở.
            </p>
          </div>
        )}
        <div className="bg-white border rounded-xl p-4">
          <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">Niên độ hiện có</div>
          <div className="flex items-center gap-3">
            <select
              className="w-full p-2.5 border rounded-lg font-bold text-slate-700 bg-white"
              value={selectedKey}
              onChange={(e) => {
                const key = e.target.value;
                const fy = financialYears.find(y => `${y.startDate}..${y.endDate}` === key);
                if (fy) {
                  setData(fy);
                  setYearSelectHint(key !== activeYearKey);
                }
              }}
            >
              {financialYears
                .slice()
                .sort((a, b) => a.startDate.localeCompare(b.startDate))
                .map(y => {
                  const key = `${y.startDate}..${y.endDate}`;
                  return (
                    <option key={key} value={key}>
                      {new Date(y.startDate).getFullYear()} ({y.startDate} → {y.endDate})
                    </option>
                  );
                })}
            </select>
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            Chọn niên độ đích rồi bấm <b>Cập nhật niên độ</b>. Hệ thống lưu dữ liệu niên độ đang làm việc vào bộ nhớ theo từng
            niên độ, sau đó đồng bộ máy chủ (khi có đăng nhập).
            {!backendAvailable && (
              <span className="block mt-1 text-amber-700 font-bold">Đang không có máy chủ — chỉ lưu trên trình duyệt.</span>
            )}
            {persistStatus?.lastError && (
              <span className="block mt-1 text-rose-600 font-bold">Lỗi lưu gần nhất: {persistStatus.lastError}</span>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Ngày bắt đầu năm tài chính</label>
          <input 
            type="date" 
            className="w-full p-2.5 border rounded-lg font-bold text-slate-700" 
            value={data.startDate} 
            onChange={e => {
              const next = { ...data, startDate: e.target.value };
              setData(next);
              setYearSelectHint(`${next.startDate}..${next.endDate}` !== activeYearKey);
            }} 
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Ngày kết thúc năm tài chính</label>
          <input 
            type="date" 
            className="w-full p-2.5 border rounded-lg font-bold text-slate-700" 
            value={data.endDate} 
            onChange={e => {
              const next = { ...data, endDate: e.target.value };
              setData(next);
              setYearSelectHint(`${next.startDate}..${next.endDate}` !== activeYearKey);
            }} 
          />
        </div>
        <div className="pt-4">
          <button 
            onClick={handleRequestUpdate}
            className="px-10 py-2.5 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600 shadow-lg shadow-amber-100 transition-all active:scale-95"
          >
            Cập nhật niên độ
          </button>
        </div>
      </div>

      <div className="mt-6 bg-white border rounded-xl p-4">
        <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3">Chuyển dữ liệu sang niên độ mới (Multi-year)</div>
        <div className="flex items-start gap-3">
          <input
            id="rollover"
            type="checkbox"
            className="mt-1"
            checked={rollover}
            onChange={(e) => setRollover(e.target.checked)}
          />
          <label htmlFor="rollover" className="text-sm text-slate-700 flex-1">
            <div className="font-bold">Chuyển số dư & tồn kho sang năm mới (tạo bút toán OPENING)</div>
            <div className="text-xs text-slate-500 mt-1">
              Khi bật, hệ thống sẽ lấy <b>số dư cuối kỳ</b> của niên độ nguồn để tạo <b>bút toán OPENING</b> ở ngày bắt đầu niên độ mới,
              đồng thời chuyển <b>tồn kho cuối kỳ</b> sang làm <b>tồn kho đầu kỳ</b>.
              Bắt buộc phải <b>chọn niên độ đích khác</b> với niên độ đang mở ở phần « Niên độ hiện có » phía trên — nếu không chọn kỳ mới, hệ thống sẽ từ chối thao tác để tránh ghi nhậm số vào cùng kỳ.
            </div>
          </label>
        </div>
        <div className="mt-3">
          <label className="block text-xs font-bold text-slate-500 mb-1">Niên độ nguồn để chuyển dữ liệu</label>
          <select
            className="w-full p-2.5 border rounded-lg font-bold text-slate-700 bg-white disabled:opacity-60"
            disabled={!rollover}
            value={rolloverFromKey}
            onChange={(e) => setRolloverFromKey(e.target.value)}
          >
            {financialYears
              .slice()
              .sort((a, b) => a.startDate.localeCompare(b.startDate))
              .map(y => {
                const key = `${y.startDate}..${y.endDate}`;
                return (
                  <option key={key} value={key}>
                    {new Date(y.startDate).getFullYear()} ({y.startDate} → {y.endDate})
                  </option>
                );
              })}
          </select>
        </div>
      </div>

      <ConfirmActionModal 
        isOpen={showConfirm}
        title="Xác nhận chuyển niên độ"
        message={rollover
          ? "Niên độ hiện tại sẽ được lưu (và gửi máy chủ nếu đang đăng nhập), sau đó hệ thống snapshot số dư đầu kỳ, tồn kho, công nợ 131/331 theo hóa đơn chưa tất toán sang niên độ đích. Các dữ liệu rollover tự động sẽ ở chế độ chỉ đọc.\n\nLưu ý: Doanh thu và chi phí (giá vốn) đã ghi ở kỳ phát sinh hóa đơn. Kỳ mới chỉ hạch toán thanh toán (131/331 ↔ tiền), không ghi lại DT/CP khi thu/chi công nợ đầu kỳ.\n\nTiếp tục?"
          : "Niên độ đang làm việc sẽ được lưu đầy đủ trước khi chuyển. Hệ thống tải bộ dữ liệu của niên độ đích (multi-year; không xóa niên độ cũ). Tiếp tục?"
        }
        onConfirm={handleFinalConfirm}
        onClose={() => setShowConfirm(false)}
        type="amber"
      />
    </div>
  );
};

// --- Initial Setup View & Modals ---

type ModalType = 'ACCOUNTS' | 'INVENTORY' | 'CUSTOMER_DEBT' | 'SUPPLIER_DEBT' | 'ASSET_CARRY' | null;

const InitialSetupView = () => {
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const {
    financialYear,
    journalEntries,
    accountingVouchers,
    openingBalanceAccounts,
    openingBalanceDebts,
    systemConfig,
    setOpeningBalanceLock,
  } = useApp();

  const consistency = useMemo(
    () =>
      getOpeningConsistencySummary(openingBalanceAccounts, openingBalanceDebts, {
        journalEntries,
        accountingVouchers,
        financialYear,
      }),
    [openingBalanceAccounts, openingBalanceDebts, journalEntries, accountingVouchers, financialYear],
  );
  const renderStatusBadge = (matched: boolean, difference: number) => (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${
        matched
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-rose-200 bg-rose-50 text-rose-700'
      }`}
    >
      {matched ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
      {matched ? 'Khớp' : `Lệch ${formatCurrency(Math.abs(difference))}`}
    </span>
  );

  const handleCheckConsistency = () => {
    const message = [
      `131 - Số dư trên sổ (lũy kế NKC + chứng từ): ${formatCurrency(consistency.customerLedgerTotal)}`,
      `131 - Khai báo đầu kỳ (snapshot): ${formatCurrency(consistency.customerDeclaredTotal)}`,
      `131 - Chi tiết công nợ KH (đầu kỳ): ${formatCurrency(consistency.customerDetailTotal)}`,
      `131 - Lệch khai báo vs chi tiết: ${formatCurrency(consistency.customerDifference)}`,
      '',
      `331 - Số dư trên sổ (lũy kế NKC + chứng từ): ${formatCurrency(consistency.supplierLedgerTotal)}`,
      `331 - Khai báo đầu kỳ (snapshot): ${formatCurrency(consistency.supplierDeclaredTotal)}`,
      `331 - Chi tiết công nợ NCC (đầu kỳ): ${formatCurrency(consistency.supplierDetailTotal)}`,
      `331 - Lệch khai báo vs chi tiết: ${formatCurrency(consistency.supplierDifference)}`,
      '',
      consistency.overallMatched
        ? 'Kết quả: Dữ liệu khớp 100%, có thể khóa dữ liệu.'
        : 'Kết quả: Còn lệch, vui lòng đồng bộ số tổng và số chi tiết trước khi khóa.',
    ].join('\n');
    window.alert(message);
  };

  const handleLockAction = () => {
    if (systemConfig.isOpeningBalanceLocked) {
      if (window.confirm('Bạn muốn mở khóa dữ liệu đầu kỳ để tiếp tục chỉnh sửa?')) {
        setOpeningBalanceLock('OPEN');
      }
      return;
    }
    if (!consistency.overallMatched) {
      window.alert('Không thể khóa dữ liệu vì số tổng 131/331 và chi tiết công nợ vẫn còn lệch.');
      return;
    }
    setShowLockConfirm(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <FileClock className="h-5 w-5 text-blue-600" />
            <h4 className="font-bold text-slate-800">Quy trình 4 bước khuyến nghị</h4>
          </div>
          <div className="mt-4 space-y-3">
            {[
              'Bước 1: Vào “Số dư đầu kỳ Tài khoản” để nhập các tài khoản không cần chi tiết. Với 131/331 có thể nhập số tổng trước để làm mục tiêu đối chiếu.',
              'Bước 2: Vào “Nhập công nợ khách hàng / NCC” để nhập chi tiết từng hóa đơn còn nợ (doanh thu/chi phí đã ghi ở kỳ phát sinh HĐ). Chọn loại doanh thu / nguồn nợ và hạn thanh toán để theo dõi — không thay cho bút ghi DT/CP kỳ mới.',
              'Bước 3: Nhấn “Kiểm tra đối chiếu” để hệ thống xác nhận số tổng và số chi tiết đã khớp 100% cho 131 và 331.',
              'Bước 4: Khi tất cả đều khớp, nhấn “Khóa dữ liệu” để chuyển sang giai đoạn vận hành chính thức.',
            ].map((step, index) => (
              <div key={step} className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">
                  {index + 1}
                </div>
                <p className="text-sm leading-relaxed text-slate-700">{step}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-indigo-600" />
            <h4 className="font-bold text-slate-800">Kiểm tra và khóa dữ liệu</h4>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Ngày bắt đầu nhập liệu: <span className="font-bold text-blue-700">{new Date(financialYear.startDate).toLocaleDateString('vi-VN')}</span>
          </p>
          <div className="mt-4 space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-600">Trạng thái 131</span>
              {renderStatusBadge(consistency.customerMatched, consistency.customerDifference)}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-600">Trạng thái 331</span>
              {renderStatusBadge(consistency.supplierMatched, consistency.supplierDifference)}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleCheckConsistency}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Kiểm tra đối chiếu
            </button>
            <button
              type="button"
              onClick={handleLockAction}
              className={`rounded-lg px-4 py-2.5 text-sm font-black text-white ${
                systemConfig.isOpeningBalanceLocked
                  ? 'bg-slate-700 hover:bg-slate-800'
                  : consistency.overallMatched
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-slate-300 cursor-not-allowed'
              }`}
              disabled={!systemConfig.isOpeningBalanceLocked && !consistency.overallMatched}
            >
              {systemConfig.isOpeningBalanceLocked ? 'Mở khóa dữ liệu' : 'Khóa dữ liệu'}
            </button>
          </div>
          {!consistency.overallMatched && !systemConfig.isOpeningBalanceLocked && (
            <p className="mt-3 text-xs font-semibold text-rose-600">
              Chỉ có thể khóa khi 131 và 331 đã khớp hoàn toàn với chi tiết công nợ.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Đối chiếu TK 131</p>
              <h4 className="mt-1 font-bold text-slate-800">Phải thu khách hàng đầu kỳ</h4>
            </div>
            {renderStatusBadge(consistency.customerMatched, consistency.customerDifference)}
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Số dư trên sổ (NKC + chứng từ)</span>
              <span className="font-black text-slate-800">{formatCurrency(consistency.customerLedgerTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Khai báo đầu kỳ (snapshot)</span>
              <span className="font-semibold text-slate-600">{formatCurrency(consistency.customerDeclaredTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Tổng chi tiết công nợ KH</span>
              <span className="font-bold text-slate-700">{formatCurrency(consistency.customerDetailTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
              <span className="font-semibold text-slate-600">Chênh lệch (khai báo ↔ chi tiết)</span>
              <span className={`font-black ${consistency.customerMatched ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatCurrency(consistency.customerDifference)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">Đối chiếu TK 331</p>
              <h4 className="mt-1 font-bold text-slate-800">Phải trả nhà cung cấp đầu kỳ</h4>
            </div>
            {renderStatusBadge(consistency.supplierMatched, consistency.supplierDifference)}
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Số dư trên sổ (NKC + chứng từ)</span>
              <span className="font-black text-slate-800">{formatCurrency(consistency.supplierLedgerTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Khai báo đầu kỳ (snapshot)</span>
              <span className="font-semibold text-slate-600">{formatCurrency(consistency.supplierDeclaredTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Tổng chi tiết công nợ NCC</span>
              <span className="font-bold text-slate-700">{formatCurrency(consistency.supplierDetailTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
              <span className="font-semibold text-slate-600">Chênh lệch (khai báo ↔ chi tiết)</span>
              <span className={`font-black ${consistency.supplierMatched ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatCurrency(consistency.supplierDifference)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <button
          onClick={() => setActiveModal('ACCOUNTS')}
          className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:bg-slate-50"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-bold text-slate-800">Nhập số dư đầu kỳ Tài khoản</h4>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                Bước 1. Nhập số tổng từ bảng cân đối cũ. Với 131 / 331 có thể nhập trước để làm mục tiêu và
                sau đó đồng bộ lại từ phần chi tiết công nợ.
              </p>
            </div>
            <Unlock className="h-4 w-4 shrink-0 text-slate-400" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
              131 mục tiêu (khai báo): {formatCurrency(consistency.customerDeclaredTotal)}
            </span>
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-700">
              331 mục tiêu (khai báo): {formatCurrency(consistency.supplierDeclaredTotal)}
            </span>
          </div>
        </button>

        <button
          onClick={() => setActiveModal('INVENTORY')}
          className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:bg-slate-50"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-bold text-slate-800">Nhập tồn kho đầu kỳ</h4>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                Nhập số lượng tồn thực tế để vận hành kho. Phần giá trị hàng tồn và các tài khoản kế toán vẫn
                được quản lý ở mục số dư đầu kỳ tài khoản.
              </p>
            </div>
            <Unlock className="h-4 w-4 shrink-0 text-slate-400" />
          </div>
        </button>

        <button
          onClick={() => setActiveModal('CUSTOMER_DEBT')}
          className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:bg-slate-50"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-bold text-slate-800">Nhập công nợ khách hàng đầu kỳ</h4>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                Bước 2. Nhập từng hóa đơn còn phải thu; doanh thu đã ghi ở kỳ cũ. « Loại doanh thu » chỉ để phân loại theo dõi.
                Khi KH trả nợ trong kỳ này, dùng phiếu thu: Nợ tiền / Có 131 — không ghi nhận lại doanh thu.
              </p>
            </div>
            {renderStatusBadge(consistency.customerMatched, consistency.customerDifference)}
          </div>
        </button>

        <button
          onClick={() => setActiveModal('SUPPLIER_DEBT')}
          className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:bg-slate-50"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-bold text-slate-800">Nhập công nợ nhà cung cấp đầu kỳ</h4>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                Bước 2. Nhập từng hóa đơn còn phải trả; giá vốn/chi phí đã ghi ở kỳ cũ. « Nguồn nợ » chỉ để phân loại theo dõi.
                Khi trả NCC trong kỳ này, dùng phiếu chi: Nợ 331 / Có tiền — không ghi lại chi phí hay doanh thu.
              </p>
            </div>
            {renderStatusBadge(consistency.supplierMatched, consistency.supplierDifference)}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveModal('ASSET_CARRY')}
          className="rounded-xl border border-violet-200 bg-violet-50/40 p-5 text-left shadow-sm transition-colors hover:bg-violet-50 lg:col-span-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-bold text-slate-800">Số dư đầu kỳ công cụ dụng cụ / Tài sản CĐ (tham chiếu)</h4>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                Ghi nhận nguyên giá, hao mòn lũy kế, GTCL và VAT đầu kỳ cho TSCĐ / CCDC chuyển sang để tiếp
                tục quản lý khấu hao, phân bổ ở niên độ mới.
              </p>
            </div>
            <Wrench className="w-4 h-4 text-violet-500 shrink-0" />
          </div>
        </button>
      </div>

      {activeModal === 'ACCOUNTS' && <AccountOpeningModal onClose={() => setActiveModal(null)} />}
      {activeModal === 'INVENTORY' && <InventoryOpeningModal onClose={() => setActiveModal(null)} />}
      {(activeModal === 'CUSTOMER_DEBT' || activeModal === 'SUPPLIER_DEBT') && (
         <DebtOpeningModal 
            type={activeModal} 
            onClose={() => setActiveModal(null)} 
         />
      )}
      {activeModal === 'ASSET_CARRY' && <AssetToolCarryForwardModal onClose={() => setActiveModal(null)} />}

      <ConfirmActionModal
        isOpen={showLockConfirm}
        title="Khóa dữ liệu đầu kỳ"
        message="Hệ thống sẽ khóa phần nhập số dư đầu kỳ và công nợ chi tiết. Chỉ nên khóa khi 131 và 331 đã khớp hoàn toàn với dữ liệu chi tiết."
        onConfirm={() => {
          setOpeningBalanceLock('SOFT');
          setShowLockConfirm(false);
        }}
        onClose={() => setShowLockConfirm(false)}
        type="emerald"
      />
    </div>
  );
};

const AssetToolCarryForwardModal = ({ onClose }: { onClose: () => void }) => {
  const {
    systemConfig,
    handleSaveOpeningAssetToolCarryForward,
    handleDeleteOpeningAssetToolCarryForward,
    handlePostOpeningAssetCarryJournal,
  } = useApp();
  const carryRows = useMemo(
    () =>
      systemConfig.openingAssetToolCarryForwards ||
      (systemConfig.openingAssetToolCarryForward ? [systemConfig.openingAssetToolCarryForward] : []),
    [systemConfig.openingAssetToolCarryForwards, systemConfig.openingAssetToolCarryForward],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowCode, setRowCode] = useState('');
  const [rowName, setRowName] = useState('');
  const [originalCost, setOriginalCost] = useState('');
  const [accumulated, setAccumulated] = useState('');
  const [residual, setResidual] = useState('');
  const [accountingNote, setAccountingNote] = useState('');
  const [openingVat1331, setOpeningVat1331] = useState('');
  const [carryKind, setCarryKind] = useState<'TSCD' | 'CCDC'>('TSCD');
  const [accountOriginal, setAccountOriginal] = useState('');
  const [accountAccumulated, setAccountAccumulated] = useState('');
  const [accountEquity, setAccountEquity] = useState('');
  const [totalUsefulLifeMonths, setTotalUsefulLifeMonths] = useState('');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('');

  const editingCarry = useMemo(
    () => carryRows.find((row) => row.id === editingId) || null,
    [carryRows, editingId],
  );
  const editingKey = editingCarry
    ? [
        editingCarry.id,
        editingCarry.code,
        editingCarry.name,
        editingCarry.originalCost,
        editingCarry.accumulatedDepreciation,
        editingCarry.residualCarriedForward,
        editingCarry.accountingNote,
        editingCarry.openingVat1331,
        editingCarry.carryKind,
        editingCarry.accountOriginal,
        editingCarry.accountAccumulated,
        editingCarry.accountEquity,
        editingCarry.totalUsefulLifeMonths,
        editingCarry.usefulLifeMonths,
        editingCarry.openingEntryPosted,
        editingCarry.openingPostedAt,
      ].join('|')
    : '__NEW__';

  useEffect(() => {
    if (editingId && !editingCarry) setEditingId(null);
  }, [editingId, editingCarry]);

  useEffect(() => {
    if (!editingCarry) {
      setRowCode('');
      setRowName('');
      setOriginalCost('');
      setAccumulated('');
      setResidual('');
      setAccountingNote('');
      setOpeningVat1331('');
      setCarryKind('TSCD');
      setAccountOriginal('');
      setAccountAccumulated('');
      setAccountEquity('');
      setTotalUsefulLifeMonths('');
      setUsefulLifeMonths('');
      return;
    }
    setRowCode(editingCarry.code || '');
    setRowName(editingCarry.name || '');
    setOriginalCost(formatInputNumber(editingCarry.originalCost));
    setAccumulated(formatInputNumber(editingCarry.accumulatedDepreciation));
    setResidual(formatInputNumber(editingCarry.residualCarriedForward));
    setAccountingNote(editingCarry.accountingNote || '');
    setOpeningVat1331(formatInputNumber(editingCarry.openingVat1331 || 0));
    setCarryKind(editingCarry.carryKind === 'CCDC' ? 'CCDC' : 'TSCD');
    setAccountOriginal(editingCarry.accountOriginal || '');
    setAccountAccumulated(editingCarry.accountAccumulated || '');
    setAccountEquity(editingCarry.accountEquity || '');
    setTotalUsefulLifeMonths(editingCarry.totalUsefulLifeMonths != null ? String(editingCarry.totalUsefulLifeMonths) : '');
    setUsefulLifeMonths(editingCarry.usefulLifeMonths != null ? String(editingCarry.usefulLifeMonths) : '');
  }, [editingKey, editingCarry]);

  const ocNum = parseInputNumber(originalCost || '0');
  const accNum = parseInputNumber(accumulated || '0');
  const resNum = parseInputNumber(residual || '0');
  const vatNum = parseInputNumber(openingVat1331 || '0');
  const impliedResidual = Math.max(0, ocNum - accNum);
  const residualMismatch =
    ocNum > 0 || accNum > 0 || resNum > 0
      ? Math.round(impliedResidual) !== Math.round(resNum)
      : false;
  const totalLifeParsed = useMemo(() => {
    const t = totalUsefulLifeMonths.trim().replace(/\./g, '');
    if (!t) return 0;
    const n = Math.round(Number(t));
    return Number.isFinite(n) && n >= 1 ? n : 0;
  }, [totalUsefulLifeMonths]);
  const tscdCount = carryRows.filter((row) => row.carryKind === 'TSCD').length;
  const ccdcCount = carryRows.filter((row) => row.carryKind === 'CCDC').length;
  const postedCount = carryRows.filter((row) => row.openingEntryPosted).length;

  useEffect(() => {
    if (!totalLifeParsed || ocNum <= 0) return;
    const monthly = ocNum / totalLifeParsed;
    if (monthly <= 0) return;
    const elapsed = Math.min(totalLifeParsed, Math.round(accNum / monthly));
    const remaining = Math.max(1, totalLifeParsed - elapsed);
    const next = String(remaining);
    setUsefulLifeMonths((prev) => (prev !== next ? next : prev));
  }, [totalLifeParsed, ocNum, accNum]);

  const lifeNum = usefulLifeMonths.trim() ? Math.max(1, Math.round(Number(usefulLifeMonths.replace(/\./g, '')))) : undefined;
  const totalM = totalUsefulLifeMonths.trim()
    ? Math.max(1, Math.round(Number(totalUsefulLifeMonths.replace(/\./g, ''))))
    : undefined;

  const buildPayload = (): OpeningAssetToolCarryForward => ({
    id: editingId || '',
    code: rowCode.trim() || undefined,
    name: rowName.trim() || undefined,
    originalCost: ocNum,
    accumulatedDepreciation: accNum,
    residualCarriedForward: resNum,
    accountingNote,
    openingVat1331: vatNum,
    carryKind,
    accountOriginal: accountOriginal.trim() || undefined,
    accountAccumulated: accountAccumulated.trim() || undefined,
    accountEquity: accountEquity.trim() || undefined,
    totalUsefulLifeMonths: totalM,
    usefulLifeMonths: lifeNum,
    openingEntryPosted: editingCarry?.openingEntryPosted,
    openingPostedAt: editingCarry?.openingPostedAt,
    openingEntryReferenceId: editingCarry?.openingEntryReferenceId,
    syntheticAssetId: editingCarry?.syntheticAssetId,
  });

  const handleNewRow = () => {
    setEditingId(null);
    setRowCode('');
    setRowName('');
    setOriginalCost('');
    setAccumulated('');
    setResidual('');
    setAccountingNote('');
    setOpeningVat1331('');
    setCarryKind('TSCD');
    setAccountOriginal('');
    setAccountAccumulated('');
    setAccountEquity('');
    setTotalUsefulLifeMonths('');
    setUsefulLifeMonths('');
  };

  const saveCurrentRow = () => {
    const savedId = handleSaveOpeningAssetToolCarryForward(buildPayload());
    if (!savedId) return null;
    setEditingId(savedId);
    return savedId;
  };

  const handleSaveAndClose = () => {
    if (saveCurrentRow()) onClose();
  };

  const handleSaveAndNew = () => {
    if (saveCurrentRow()) handleNewRow();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col animate-fade-in">
        <div className="bg-violet-600 p-4 text-white flex justify-between items-center shrink-0">
          <div>
            <h3 className="font-bold flex items-center gap-2">
              <Wrench className="w-5 h-5" />
              Số dư đầu kỳ CCDC / Tài sản CĐ
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-violet-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border bg-slate-50 p-3">
              <div className="text-[11px] font-bold text-slate-500 uppercase">Tổng số dòng</div>
              <div className="text-2xl font-black text-slate-800 mt-1">{carryRows.length}</div>
              <div className="text-xs text-slate-500 mt-1">Đã ghi bút toán: {postedCount}</div>
            </div>
            <div className="rounded-lg border bg-indigo-50 p-3">
              <div className="text-[11px] font-bold text-indigo-500 uppercase">TSCĐ</div>
              <div className="text-2xl font-black text-indigo-800 mt-1">{tscdCount}</div>
            </div>
            <div className="rounded-lg border bg-orange-50 p-3">
              <div className="text-[11px] font-bold text-orange-500 uppercase">CCDC</div>
              <div className="text-2xl font-black text-orange-800 mt-1">{ccdcCount}</div>
            </div>
          </div>
          {systemConfig.isOpeningBalanceLocked && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm font-bold p-3">
              Số dư đầu kỳ đang bị khóa. Vui lòng mở khóa trong Trạng thái hệ thống để chỉnh sửa.
            </div>
          )}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-800">Danh sách TSCĐ / CCDC đầu kỳ</div>
              </div>
              <button
                type="button"
                onClick={handleNewRow}
                disabled={systemConfig.isOpeningBalanceLocked}
                className="px-3 py-2 text-sm font-bold border rounded-lg bg-white hover:bg-slate-100 disabled:opacity-50"
              >
                Thêm dòng mới
              </button>
            </div>
            <div className="p-4 space-y-3">
              {carryRows.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  Chưa có dòng nào. Hãy nhập thông tin ở biểu mẫu bên dưới rồi chọn <strong>Lưu & đóng</strong> hoặc{' '}
                  <strong>Lưu & thêm mới</strong>.
                </div>
              )}
              {carryRows.map((row, index) => (
                <div
                  key={row.id}
                  className={`rounded-lg border p-3 ${editingId === row.id ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-white'}`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Dòng {index + 1}</span>
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${row.carryKind === 'CCDC' ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700'}`}>
                          {row.carryKind === 'CCDC' ? 'CCDC' : 'TSCĐ'}
                        </span>
                        {row.openingEntryPosted ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700">
                            Đã ghi bút toán
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700">
                            Chưa ghi bút toán
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-slate-800">{row.name || 'Chưa đặt tên dòng'}</div>
                      <div className="text-xs text-slate-500">
                        {row.code || 'Chưa có mã'}{row.accountingNote ? ` · ${row.accountingNote}` : ''}
                      </div>
                      <div className="text-xs text-slate-600">
                        NG {formatCurrency(row.originalCost)} · Lũy kế {formatCurrency(row.accumulatedDepreciation)} · GTCL {formatCurrency(row.residualCarriedForward)} · Còn lại {row.usefulLifeMonths || 0} tháng
                      </div>
                      {row.openingPostedAt && (
                        <div className="text-[11px] text-slate-500">
                          Ghi lúc: {new Date(row.openingPostedAt).toLocaleString('vi-VN')}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(row.id)}
                        className="px-3 py-2 text-sm font-semibold border rounded-lg hover:bg-slate-50"
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePostOpeningAssetCarryJournal(row.id)}
                        disabled={systemConfig.isOpeningBalanceLocked}
                        className="px-3 py-2 text-sm font-bold text-white bg-slate-800 rounded-lg hover:bg-slate-900 disabled:opacity-50"
                      >
                        Ghi bút toán
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Xóa dòng «${row.name || row.code || `Dòng ${index + 1}`}»?`)) {
                            handleDeleteOpeningAssetToolCarryForward(row.id);
                            if (editingId === row.id) handleNewRow();
                          }
                        }}
                        disabled={systemConfig.isOpeningBalanceLocked}
                        className="px-3 py-2 text-sm font-semibold border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-50 disabled:opacity-50"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-800">Cập nhật thông tin tài sản</div>
              </div>
              {editingCarry && (
                <button type="button" onClick={handleNewRow} className="px-3 py-2 text-sm font-semibold border rounded-lg hover:bg-slate-50">
                  Chuyển sang dòng mới
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mã TSCĐ / CCDC</label>
                <input
                  type="text"
                  disabled={systemConfig.isOpeningBalanceLocked}
                  className="w-full border rounded-lg p-2 font-mono text-sm disabled:bg-slate-100"
                  value={rowCode}
                  onChange={(e) => setRowCode(e.target.value)}
                  placeholder="VD: TSCD-001"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Tên / diễn giải dòng</label>
                <input
                  type="text"
                  disabled={systemConfig.isOpeningBalanceLocked}
                  className="w-full border rounded-lg p-2 text-sm disabled:bg-slate-100"
                  value={rowName}
                  onChange={(e) => setRowName(e.target.value)}
                  placeholder="VD: Máy in văn phòng / Bộ bàn ghế làm việc..."
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Loại</label>
              <select
                disabled={systemConfig.isOpeningBalanceLocked}
                className="w-full border rounded-lg p-2 disabled:bg-slate-100"
                value={carryKind}
                onChange={(e) => setCarryKind(e.target.value === 'CCDC' ? 'CCDC' : 'TSCD')}
              >
                <option value="TSCD">Tài sản cố định (211 / 214)</option>
                <option value="CCDC">Công cụ dụng cụ (242)</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">TK nguyên giá (tùy chọn)</label>
                <input
                  type="text"
                  disabled={systemConfig.isOpeningBalanceLocked}
                  className="w-full border rounded-lg p-2 font-mono text-sm disabled:bg-slate-100"
                  value={accountOriginal}
                  onChange={(e) => setAccountOriginal(e.target.value)}
                  placeholder={carryKind === 'CCDC' ? '242' : '2112'}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">TK lũy kế (tùy chọn)</label>
                <input
                  type="text"
                  disabled={systemConfig.isOpeningBalanceLocked}
                  className="w-full border rounded-lg p-2 font-mono text-sm disabled:bg-slate-100"
                  value={accountAccumulated}
                  onChange={(e) => setAccountAccumulated(e.target.value)}
                  placeholder={carryKind === 'CCDC' ? '242' : '214'}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">TK nguồn vốn (tùy chọn)</label>
                <input
                  type="text"
                  disabled={systemConfig.isOpeningBalanceLocked}
                  className="w-full border rounded-lg p-2 font-mono text-sm disabled:bg-slate-100"
                  value={accountEquity}
                  onChange={(e) => setAccountEquity(e.target.value)}
                  placeholder="4111"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nguyên giá (số dư Nợ đầu kỳ)</label>
                  <input
                    type="text"
                    disabled={systemConfig.isOpeningBalanceLocked}
                    className="w-full border rounded-lg p-2 text-right font-mono disabled:bg-slate-100"
                    value={originalCost}
                    onChange={(e) => setOriginalCost(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Hao mòn / phân bổ lũy kế</label>
                  <input
                    type="text"
                    disabled={systemConfig.isOpeningBalanceLocked}
                    className="w-full border rounded-lg p-2 text-right font-mono disabled:bg-slate-100"
                    value={accumulated}
                    onChange={(e) => setAccumulated(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Giá trị còn lại (GTCL)</label>
                  <input
                    type="text"
                    disabled={systemConfig.isOpeningBalanceLocked}
                    className="w-full border rounded-lg p-2 text-right font-mono disabled:bg-slate-100"
                    value={residual}
                    onChange={(e) => setResidual(e.target.value)}
                    placeholder="0"
                  />
                  {residualMismatch && (
                    <p className="text-xs text-amber-700 mt-1">
                      Gợi ý: Nguyên giá − Lũy kế = {formatInputNumber(impliedResidual) || '0'} (đang khác ô GTCL).
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">VAT đầu kỳ mang sang (TK 1331)</label>
                  <input
                    type="text"
                    disabled={systemConfig.isOpeningBalanceLocked}
                    className="w-full border rounded-lg p-2 text-right font-mono disabled:bg-slate-100"
                    value={openingVat1331}
                    onChange={(e) => setOpeningVat1331(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tổng số tháng KH / phân bổ (theo quyết định)</label>
                  <input
                    type="text"
                    disabled={systemConfig.isOpeningBalanceLocked}
                    className="w-full border rounded-lg p-2 text-right font-mono disabled:bg-slate-100"
                    value={totalUsefulLifeMonths}
                    onChange={(e) => setTotalUsefulLifeMonths(e.target.value)}
                    placeholder="vd. 60"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Số tháng KH / phân bổ còn lại
                    {totalLifeParsed > 0 && ocNum > 0 ? (
                      <span className="font-normal text-emerald-700"> — tự điền theo tổng tháng</span>
                    ) : null}
                  </label>
                  <input
                    type="text"
                    disabled={systemConfig.isOpeningBalanceLocked}
                    className="w-full border rounded-lg p-2 text-right font-mono disabled:bg-slate-100"
                    value={usefulLifeMonths}
                    onChange={(e) => setUsefulLifeMonths(e.target.value)}
                    placeholder={totalLifeParsed > 0 && ocNum > 0 ? '—' : '36'}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Ghi chú</label>
                  <textarea
                    disabled={systemConfig.isOpeningBalanceLocked}
                    className="w-full border rounded-lg p-2 text-sm min-h-[126px] disabled:bg-slate-100"
                    value={accountingNote}
                    onChange={(e) => setAccountingNote(e.target.value)}
                    placeholder="Diễn giải nội bộ / hồ sơ chuyển kỳ…"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="p-4 border-t flex flex-wrap justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-slate-700">
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSaveAndNew}
            disabled={systemConfig.isOpeningBalanceLocked}
            className="px-4 py-2 border border-slate-300 bg-slate-100 text-slate-800 rounded-lg font-semibold hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Lưu & thêm mới
          </button>
          <button
            type="button"
            onClick={handleSaveAndClose}
            disabled={systemConfig.isOpeningBalanceLocked}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Lưu & đóng
          </button>
        </div>
      </div>
    </div>
  );
};


const AccountOpeningModal = ({ onClose }: { onClose: () => void }) => {
   const {
      accounts,
      bankAccounts,
      cashFlowOpening,
      handleSaveOpeningBalanceAccounts,
      handleSaveCashFlowOpening,
      financialYear,
      systemConfig,
      journalEntries,
      accountingVouchers,
      openingBalanceAccounts,
      openingBalanceDebts,
      openingBalanceRolloverMeta,
   } = useApp();
   const [entries, setEntries] = useState<{account: string, debit: number, credit: number}[]>([]);
   const [tab, setTab] = useState<'ACCOUNTS' | 'CASHFLOW'>('ACCOUNTS');
   const [cfValues, setCfValues] = useState<Record<string, number>>({});
   const derivedOpening60 = useMemo(() => resolveCashEquivalentOpening60(journalEntries, financialYear.startDate), [journalEntries, financialYear.startDate]);
   const hasSavedOpening60 = typeof cashFlowOpening?.['60'] === 'number';
   const hasSavedClosing70 = typeof cashFlowOpening?.['70'] === 'number';
   const defaultOpening60 = hasSavedClosing70 ? Number(cashFlowOpening?.['70'] || 0) : derivedOpening60;
   const cashFlowSystemNote = !hasSavedOpening60
      ? (defaultOpening60 < 0
          ? 'Dữ liệu chưa hoàn thiện do thiếu số dư đầu kỳ'
          : hasSavedClosing70
          ? 'Mã số 60 đang được tự động đồng bộ từ mã số 70 của kỳ trước.'
          : derivedOpening60 !== 0
          ? 'Mã số 60 đang được tự động lấy từ số dư cuối kỳ năm trước / sổ cái tiền.'
          : 'Dữ liệu chưa hoàn thiện do thiếu số dư đầu kỳ')
      : '';

   const consistency = useMemo(
      () =>
         getOpeningConsistencySummary(openingBalanceAccounts, openingBalanceDebts, {
            journalEntries,
            accountingVouchers,
            financialYear,
         }),
      [openingBalanceAccounts, openingBalanceDebts, journalEntries, accountingVouchers, financialYear],
   );
   const customerFormNet = useMemo(() => {
      const row = entries.find((entry) => entry.account === '131');
      return Math.round(Number(row?.debit || 0) - Number(row?.credit || 0));
   }, [entries]);
   const supplierFormNet = useMemo(() => {
      const row = entries.find((entry) => entry.account === '331');
      return Math.round(Number(row?.credit || 0) - Number(row?.debit || 0));
   }, [entries]);
   const hasLockedRolloverAccounts = useMemo(
      () => openingBalanceAccounts.some((row) => row.readOnly),
      [openingBalanceAccounts],
   );
   const bankAccountsByLinkedCode = useMemo(() => {
      const out = new Map<string, { bankName: string; accountNumber: string; status: 'ACTIVE' | 'INACTIVE' }>();
      bankAccounts.forEach((bank) => {
         const code = String(bank.linkedAccountCode || '').trim();
         if (!code) return;
         out.set(code, {
            bankName: bank.bankName,
            accountNumber: bank.accountNumber,
            status: bank.status,
         });
      });
      return out;
   }, [bankAccounts]);
   const bankLinked1121Codes = useMemo(
      () =>
         Array.from(bankAccountsByLinkedCode.keys())
            .filter((code) => code.startsWith('1121') && code !== '1121')
            .sort((a, b) => a.localeCompare(b, 'vi')),
      [bankAccountsByLinkedCode],
   );
   const hasBankLinked1121 = bankLinked1121Codes.length > 0;

   useEffect(() => {
      setEntries(buildOpeningAccountDraft(accounts, openingBalanceAccounts));
   }, [accounts, openingBalanceAccounts]);

   useEffect(() => {
      const nextValues = { ...(cashFlowOpening || {}) };
      if (typeof nextValues['60'] !== 'number') {
         nextValues['60'] = defaultOpening60;
      }
      setCfValues(nextValues);
   }, [cashFlowOpening, defaultOpening60]);

   const handleChange = (index: number, field: 'debit' | 'credit', rawValue: string) => {
      const numericValue = parseInputNumber(rawValue);
      if (isNaN(numericValue)) return;
      
      const newEntries = [...entries];
      newEntries[index][field] = numericValue;
      setEntries(newEntries);
   };

   const handleSyncFromDetails = () => {
      setEntries((prev) =>
         prev.map((entry) => {
            if (entry.account === '131') {
               return { ...entry, debit: consistency.customerDetailTotal, credit: 0 };
            }
            if (entry.account === '331') {
               return { ...entry, debit: 0, credit: consistency.supplierDetailTotal };
            }
            return entry;
         }),
      );
   };

   const handleSave = () => {
      if (systemConfig.isOpeningBalanceLocked) {
        alert('Số dư đầu kỳ đang bị khóa. Vui lòng mở khóa để chỉnh sửa.');
        return;
      }

      if (tab === 'CASHFLOW') {
         const rows = getCashFlowRows();
         const cleaned: Record<string, number> = {};
         rows.forEach(r => {
            const v = Number(cfValues[r.code] || 0);
            const shouldKeepZero = (r.code === '60' || r.code === '70') && Object.prototype.hasOwnProperty.call(cfValues, r.code);
            if (v !== 0 || shouldKeepZero) cleaned[r.code] = v;
         });
         // Rule: "Tiền và tương đương tiền cuối kỳ năm trước" (mã 70) phải bằng
         // "Tiền và tương đương tiền đầu kỳ năm sau" (mã 60).
         // Người dùng thường nhập 70; hệ thống tự đồng bộ sang 60 để báo cáo không bị lệch.
         if (typeof cleaned['70'] === 'number' && typeof cleaned['60'] !== 'number') {
           cleaned['60'] = cleaned['70'];
         }
         handleSaveCashFlowOpening(cleaned);
         onClose();
         return;
      }

      const generic1121 = entries.find(
         (entry) =>
            entry.account === '1121' &&
            (Math.abs(Number(entry.debit || 0)) > 0 || Math.abs(Number(entry.credit || 0)) > 0),
      );
      if (generic1121) {
         if (!hasBankLinked1121) {
            alert(
               'TK 1121 phải nhập đích danh theo từng tài khoản ngân hàng. Vui lòng khai báo tài khoản ngân hàng trước, sau đó nhập số dư vào các TK con 1121xxx thay vì TK 1121 tổng hợp.',
            );
            return;
         }
         alert(
            `TK 1121 là tài khoản tổng hợp, không nhập trực tiếp số dư đầu kỳ. Vui lòng chuyển số dư sang đúng tài khoản ngân hàng liên kết: ${bankLinked1121Codes.join(', ')}.`,
         );
         return;
      }

      const details = entries.filter(e => e.debit > 0 || e.credit > 0).map(e => ({
         accountCode: e.account,
         debit: e.debit,
         credit: e.credit
      }));

      const ok = handleSaveOpeningBalanceAccounts(details);
      if (ok) onClose();
   };

   const getCashFlowRows = () => ([
      { code: '01', label: '1. Tiền thu từ bán hàng, cung cấp dịch vụ và doanh thu khác' },
      { code: '02', label: '2. Tiền chi trả cho người cung cấp hàng hóa, dịch vụ' },
      { code: '03', label: '3. Tiền chi trả cho người lao động' },
      { code: '04', label: '4. Tiền lãi vay đã trả' },
      { code: '05', label: '5. Thuế thu nhập doanh nghiệp đã nộp' },
      { code: '06', label: '6. Tiền thu khác từ hoạt động kinh doanh' },
      { code: '07', label: '7. Tiền chi khác cho hoạt động kinh doanh' },
      { code: '20', label: 'Lưu chuyển tiền thuần từ hoạt động kinh doanh' },
      { code: '21', label: '1. Tiền chi để mua sắm, xây dựng TSCĐ, BĐSĐT và các tài sản dài hạn khác' },
      { code: '22', label: '2. Tiền thu từ thanh lý, nhượng bán TSCĐ, BĐSĐT và các tài sản dài hạn khác' },
      { code: '23', label: '3. Tiền chi cho vay, đầu tư góp vốn vào đơn vị khác' },
      { code: '24', label: '4. Tiền thu hồi cho vay, đầu tư góp vốn vào đơn vị khác' },
      { code: '25', label: '5. Tiền thu lãi cho vay, cổ tức và lợi nhuận được chia' },
      { code: '30', label: 'Lưu chuyển tiền thuần từ hoạt động đầu tư' },
      { code: '31', label: '1. Tiền thu từ phát hành cổ phiếu, nhận vốn góp của chủ sở hữu' },
      { code: '32', label: '2. Tiền trả lại vốn góp cho các chủ sở hữu, mua lại cổ phiếu của DN đã phát hành' },
      { code: '33', label: '3. Tiền thu từ đi vay' },
      { code: '34', label: '4. Tiền trả nợ gốc vay và nợ thuê tài chính' },
      { code: '35', label: '5. Cổ tức, lợi nhuận đã trả cho chủ sở hữu' },
      { code: '40', label: 'Lưu chuyển tiền thuần từ hoạt động tài chính' },
      { code: '50', label: 'Lưu chuyển tiền thuần trong kỳ' },
      { code: '60', label: 'Tiền và tương đương tiền đầu kỳ' },
      { code: '61', label: 'Ảnh hưởng của thay đổi tỷ giá hối đoái' },
      { code: '70', label: 'Tiền và tương đương tiền cuối kỳ' },
   ]);

   const formatSignedInput = (val: number) => {
      if (val === 0) return '';
      const sign = val < 0 ? '-' : '';
      const abs = Math.abs(val);
      return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
   };

   const parseSignedInput = (val: string) => {
      const trimmed = (val || '').trim();
      const sign = trimmed.startsWith('-') ? -1 : 1;
      const cleaned = trimmed.replace(/[^0-9]/g, '');
      if (!cleaned) return 0;
      return sign * Number(cleaned);
   };

   return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
         <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl h-[80vh] flex flex-col animate-fade-in">
            <div className="bg-blue-600 p-4 text-white flex justify-between items-center">
               <div>
                  <h3 className="font-bold">Thiết lập ban đầu</h3>
                  <p className="text-xs opacity-90 mt-1">Nhập số dư đầu kỳ tài khoản & số liệu “Số đầu năm” của B03.</p>
               </div>
               <button onClick={onClose}><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 pt-4">
               <div className="inline-flex bg-slate-100 p-1 rounded-lg gap-1 border">
                  <button
                     onClick={() => setTab('ACCOUNTS')}
                     className={`px-4 py-2 rounded-md text-xs font-black uppercase tracking-wider transition-all ${
                       tab === 'ACCOUNTS' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                     }`}
                  >
                     Số dư đầu kỳ TK
                  </button>
                  <button
                     onClick={() => setTab('CASHFLOW')}
                     className={`px-4 py-2 rounded-md text-xs font-black uppercase tracking-wider transition-all ${
                       tab === 'CASHFLOW' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                     }`}
                  >
                     B03 - Số đầu năm
                  </button>
               </div>
               {systemConfig.isOpeningBalanceLocked && (
                  <div className="mt-3 p-3 rounded border border-amber-200 bg-amber-50 text-amber-800 text-sm font-bold">
                     Số dư đầu kỳ đang bị khóa. Vui lòng “Mở khóa để sửa” trong Trạng thái hệ thống.
                  </div>
               )}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
               {tab === 'ACCOUNTS' ? (
                  <div className="space-y-4">
                     <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                           <div>
                              <h4 className="font-bold text-slate-800">Đối soát 131 / 331 ngay trong màn hình nhập số tổng</h4>
                              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                                 131 và 331 có thể nhập trước để lấy mục tiêu. Sau khi nhập xong công nợ chi tiết, bấm
                                 <strong> Cập nhật từ chi tiết</strong> để lấy tổng chi tiết ghi đè vào số tổng.
                              </p>
                              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                                 Công nợ mang sang phản ánh đã ghi DT/CP ở kỳ trước. Khi vận hành kỳ mới, thanh toán chỉ làm đối
                                 trừ 131/331 với tiền — không ghi nhận lại doanh thu hay chi phí nếu chỉ thu/chi nợ cũ.
                              </p>
                              <p className="mt-2 text-xs leading-relaxed text-slate-700">
                                 Riêng <strong>TK 1121</strong>: không nhập trực tiếp vào tài khoản tổng hợp. Hãy nhập vào đúng
                                 tài khoản ngân hàng chi tiết `1121xxx` để phản ánh đúng nơi giữ tiền.
                              </p>
                           </div>
                           <button
                              type="button"
                              onClick={handleSyncFromDetails}
                                 disabled={systemConfig.isOpeningBalanceLocked || hasLockedRolloverAccounts}
                              className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                           >
                              Cập nhật từ chi tiết
                           </button>
                        </div>
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-xs leading-relaxed text-slate-700">
                           {hasBankLinked1121 ? (
                              <>
                                 Tài khoản ngân hàng đang khai báo cho `1121`: <strong>{bankLinked1121Codes.join(', ')}</strong>.
                                 Hệ thống sẽ chỉ chấp nhận số dư đầu kỳ trên các tài khoản chi tiết này, không lưu trực tiếp vào
                                 `1121`.
                              </>
                           ) : (
                              <>
                                 Chưa có tài khoản ngân hàng chi tiết cho `1121`. Nếu cần nhập tiền gửi ngân hàng đầu kỳ, hãy
                                 khai báo tài khoản ngân hàng trước để hệ thống tạo TK con `1121xxx`.
                              </>
                           )}
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                           <div className="rounded-lg border border-white/70 bg-white/90 p-3">
                              <div className="flex items-center justify-between gap-3">
                                 <span className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">TK 131</span>
                                 <span className={`text-xs font-black ${consistency.customerDifference === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {consistency.customerDifference === 0 ? 'Khớp' : 'Đang lệch'}
                                 </span>
                              </div>
                              <div className="mt-2 space-y-1 text-sm">
                                 <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-500">Số đang nhập</span>
                                    <span className="font-bold text-slate-800">{formatCurrency(customerFormNet)}</span>
                                 </div>
                                 <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-500">Tổng chi tiết khách hàng</span>
                                    <span className="font-bold text-blue-700">{formatCurrency(consistency.customerDetailTotal)}</span>
                                 </div>
                              </div>
                           </div>
                           <div className="rounded-lg border border-white/70 bg-white/90 p-3">
                              <div className="flex items-center justify-between gap-3">
                                 <span className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">TK 331</span>
                                 <span className={`text-xs font-black ${consistency.supplierDifference === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {consistency.supplierDifference === 0 ? 'Khớp' : 'Đang lệch'}
                                 </span>
                              </div>
                              <div className="mt-2 space-y-1 text-sm">
                                 <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-500">Số đang nhập</span>
                                    <span className="font-bold text-slate-800">{formatCurrency(supplierFormNet)}</span>
                                 </div>
                                 <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-500">Tổng chi tiết NCC</span>
                                    <span className="font-bold text-violet-700">{formatCurrency(consistency.supplierDetailTotal)}</span>
                                 </div>
                              </div>
                           </div>
                        </div>
                     </div>

                     <table className="w-full text-sm">
                        <thead className="bg-slate-100 font-bold sticky top-0">
                           <tr>
                              <th className="p-3 text-left">Số hiệu</th>
                              <th className="p-3 text-left">Tên tài khoản</th>
                              <th className="p-3 text-right w-40">Dư Nợ</th>
                              <th className="p-3 text-right w-40">Dư Có</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                           {entries.map((entry, idx) => {
                              const accName = accounts.find(a => a.code === entry.account)?.name;
                              const isDebtControlAccount = entry.account === '131' || entry.account === '331';
                              const isGenericBankControl = entry.account === '1121';
                              const bankLinkedInfo = bankAccountsByLinkedCode.get(entry.account);
                              const isReadOnlyRow = isOpeningAccountReadOnly(
                                 entry.account,
                                 openingBalanceAccounts,
                                 openingBalanceRolloverMeta,
                              );
                              return (
                                 <tr
                                    key={entry.account}
                                    className={
                                       isGenericBankControl
                                          ? 'bg-rose-50/70'
                                          : isDebtControlAccount
                                          ? 'bg-amber-50/60'
                                          : ''
                                    }
                                 >
                                    <td className="p-3 font-bold text-blue-600">
                                       <div className="flex items-center gap-2">
                                          <span>{entry.account}</span>
                                          {isReadOnlyRow && <Lock className="h-3.5 w-3.5 text-slate-500" />}
                                       </div>
                                    </td>
                                    <td className="p-3">
                                       <div className="font-medium text-slate-800">{accName}</div>
                                       {isReadOnlyRow && (
                                          <div className="mt-1 text-xs font-semibold text-slate-500">
                                             Dòng này được kết chuyển tự động từ niên độ trước và đang khóa chỉnh sửa trực tiếp.
                                          </div>
                                       )}
                                       {entry.account === '131' && (
                                          <div className="mt-1 text-xs font-semibold text-blue-700">
                                             Mục tiêu chi tiết KH: {formatCurrency(consistency.customerDetailTotal)}
                                          </div>
                                       )}
                                       {entry.account === '331' && (
                                          <div className="mt-1 text-xs font-semibold text-violet-700">
                                             Mục tiêu chi tiết NCC: {formatCurrency(consistency.supplierDetailTotal)}
                                          </div>
                                       )}
                                       {isGenericBankControl && (
                                          <div className="mt-1 text-xs font-semibold text-rose-700">
                                             TK tổng hợp. Không nhập trực tiếp số dư tại đây; hãy nhập vào đúng TK ngân hàng chi tiết
                                             `1121xxx`.
                                          </div>
                                       )}
                                       {bankLinkedInfo && (
                                          <div className="mt-1 text-xs font-semibold text-blue-700">
                                             {bankLinkedInfo.bankName} · {bankLinkedInfo.accountNumber}
                                             {bankLinkedInfo.status === 'INACTIVE' ? ' (đang ngưng sử dụng)' : ''}
                                          </div>
                                       )}
                                    </td>
                                    <td className="p-3">
                                       <input 
                                          type="text"
                                          disabled={systemConfig.isOpeningBalanceLocked || isReadOnlyRow}
                                          className={`w-full border rounded p-1 text-right font-mono disabled:bg-slate-100 disabled:text-slate-400 ${
                                             isGenericBankControl ? 'border-rose-300 bg-rose-50' : ''
                                          }`} 
                                          value={formatInputNumber(entry.debit)}
                                          onChange={e => handleChange(idx, 'debit', e.target.value)}
                                          placeholder="0"
                                       />
                                    </td>
                                    <td className="p-3">
                                       <input 
                                          type="text"
                                          disabled={systemConfig.isOpeningBalanceLocked || isReadOnlyRow}
                                          className={`w-full border rounded p-1 text-right font-mono disabled:bg-slate-100 disabled:text-slate-400 ${
                                             isGenericBankControl ? 'border-rose-300 bg-rose-50' : ''
                                          }`} 
                                          value={formatInputNumber(entry.credit)}
                                          onChange={e => handleChange(idx, 'credit', e.target.value)}
                                          placeholder="0"
                                       />
                                    </td>
                                 </tr>
                              );
                           })}
                        </tbody>
                     </table>
                  </div>
               ) : (
                  <div className="space-y-3">
                     {cashFlowSystemNote && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                           {cashFlowSystemNote}
                        </div>
                     )}
                     <table className="w-full text-sm">
                     <thead className="bg-slate-100 font-bold sticky top-0">
                        <tr>
                           <th className="p-3 text-left w-20">Mã số</th>
                           <th className="p-3 text-left">Chỉ tiêu (B03)</th>
                           <th className="p-3 text-right w-56">Số đầu năm</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                        {getCashFlowRows().map(r => (
                           <tr key={r.code} className="hover:bg-slate-50">
                              <td className="p-3 font-mono font-bold text-blue-700">{r.code}</td>
                              <td className="p-3 font-medium text-slate-700">{r.label}</td>
                              <td className="p-3">
                                 <input
                                    type="text"
                                    disabled={systemConfig.isOpeningBalanceLocked}
                                    className={`w-full border rounded p-2 text-right font-mono font-bold disabled:bg-slate-100 disabled:text-slate-400 ${
                                      r.code === '60' && Number(cfValues[r.code] || 0) !== Number(derivedOpening60 || 0)
                                        ? 'border-rose-300 bg-rose-50 text-rose-700'
                                        : ''
                                    }`}
                                    value={formatSignedInput(Number(cfValues[r.code] || 0))}
                                    onChange={e => setCfValues(prev => ({ ...prev, [r.code]: parseSignedInput(e.target.value) }))}
                                    placeholder="0"
                                 />
                              </td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
                  </div>
               )}
            </div>
            <div className="p-4 border-t flex justify-end gap-2 text-xs text-slate-500 italic">
               <span>* Hệ thống tự động phân cách hàng nghìn bằng dấu chấm.</span>
               <div className="flex-1"></div>
               <button onClick={onClose} className="px-4 py-2 border rounded text-slate-700">Hủy</button>
               <button
                  onClick={handleSave}
                  disabled={systemConfig.isOpeningBalanceLocked}
                  className="px-6 py-2 bg-blue-600 text-white rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed"
               >
                  {tab === 'ACCOUNTS' ? 'Lưu số dư' : 'Lưu số liệu B03'}
               </button>
            </div>
         </div>
      </div>
   );
};

const InventoryOpeningModal = ({ onClose }: { onClose: () => void }) => {
   const { inventory, handleSaveOpeningStock, systemConfig } = useApp();
   const [items, setItems] = useState<{itemId: string, name: string, sku: string, quantity: number, serials: string}[]>([]);

   useEffect(() => {
      setItems(inventory.map(i => ({ 
         itemId: i.id, name: i.name, sku: i.sku, 
         quantity: i.quantity,
         serials: (i.serials || []).join('\n')
      })));
   }, [inventory]);

   const handleChange = (index: number, field: 'quantity' | 'serials', rawValue: string) => {
      if (systemConfig.isOpeningBalanceLocked) return;
      if (field === 'serials') {
         const newItems = [...items];
         newItems[index].serials = rawValue;
         setItems(newItems);
         return;
      }
      const numericValue = parseInputNumber(rawValue);
      if (isNaN(numericValue)) return;

      const newItems = [...items];
      (newItems[index] as any)[field] = numericValue;
      setItems(newItems);
   };

   const handleSave = () => {
      if (systemConfig.isOpeningBalanceLocked) {
         alert('Tồn kho đầu kỳ đang bị khóa. Vui lòng mở khóa để chỉnh sửa.');
         return;
      }

      // --- VALIDATE SERIALS (opening stock is for serial detailization only) ---
      const parseSerials = (s: string) => (s || '').split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
      const all: { itemId: string, sku: string, serial: string }[] = [];
      for (const it of items) {
         const list = parseSerials(it.serials);
         const set = new Set(list);
         if (set.size !== list.length) {
            alert(`Serial bị trùng trong chính mặt hàng SKU ${it.sku}. Vui lòng kiểm tra lại.`);
            return;
         }
         list.forEach(sn => all.push({ itemId: it.itemId, sku: it.sku, serial: sn }));
         if (list.length > 0) {
            if (Number(it.quantity || 0) === 0) {
               // Auto-fill quantity = serial count if user leaves quantity empty
               it.quantity = list.length;
            }
            if (Number(it.quantity || 0) !== list.length) {
               alert(`Số lượng không khớp Serial (SKU ${it.sku}).\nSố lượng: ${it.quantity}\nSerial: ${list.length}`);
               return;
            }
         }
      }
      const dupGlobal = (() => {
         const seen = new Map<string, string>();
         for (const x of all) {
            const key = x.serial;
            if (seen.has(key)) return { serial: key, sku1: seen.get(key)!, sku2: x.sku };
            seen.set(key, x.sku);
         }
         return null;
      })();
      if (dupGlobal) {
         alert(`Serial bị trùng giữa 2 mặt hàng:\n- Serial: ${dupGlobal.serial}\n- SKU 1: ${dupGlobal.sku1}\n- SKU 2: ${dupGlobal.sku2}`);
         return;
      }

      // Save only quantity + serials into Warehouse module. No JE. No TK156 posting.
      handleSaveOpeningStock(items);
      onClose();
   };

   return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
         <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl h-[80vh] flex flex-col animate-fade-in">
            <div className="bg-blue-600 p-4 text-white flex justify-between items-center">
               <h3 className="font-bold">Nhập Tồn Kho Đầu Kỳ</h3>
               <button onClick={onClose}><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
               <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm font-bold">
                  Tồn kho đầu kỳ chỉ dùng để <b>chi tiết hoá số lượng & Serial</b> cho thẻ Sản phẩm & Bản quyền.
                  <br />- <b>KHÔNG</b> sinh bút toán
                  <br />- <b>KHÔNG</b> cộng thêm vào TK 156
               </div>
               {systemConfig.isOpeningBalanceLocked && (
                 <div className="mb-4 p-3 rounded border border-amber-200 bg-amber-50 text-amber-800 text-sm font-bold">
                    Tồn kho đầu kỳ đang bị khóa. Vui lòng “Mở khóa để sửa” trong Trạng thái hệ thống.
                 </div>
               )}
               <table className="w-full text-sm">
                  <thead className="bg-slate-100 font-bold sticky top-0">
                     <tr>
                        <th className="p-3 text-left">Mã SKU</th>
                        <th className="p-3 text-left">Tên hàng hóa</th>
                        <th className="p-3 text-right w-32">Số lượng</th>
                        <th className="p-3 text-left w-[420px]">Serial (mỗi dòng 1 serial)</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                     {items.map((item, idx) => (
                        <tr key={item.itemId}>
                           <td className="p-3 font-bold text-blue-600">{item.sku}</td>
                           <td className="p-3">{item.name}</td>
                           <td className="p-3">
                              <input 
                                 type="text" 
                                 disabled={systemConfig.isOpeningBalanceLocked}
                                 className="w-full border rounded p-1 text-right font-bold disabled:bg-slate-100 disabled:text-slate-400" 
                                 value={formatInputNumber(item.quantity)}
                                 onChange={e => handleChange(idx, 'quantity', e.target.value)}
                                 placeholder="0"
                              />
                           </td>
                           <td className="p-3">
                              <textarea
                                 disabled={systemConfig.isOpeningBalanceLocked}
                                 className="w-full min-h-[44px] max-h-[120px] border rounded p-2 font-mono text-xs leading-relaxed disabled:bg-slate-100 disabled:text-slate-400"
                                 value={item.serials}
                                 onChange={e => handleChange(idx, 'serials', e.target.value)}
                                 placeholder="VD:\n3579...\n3579..."
                              />
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
               <button onClick={onClose} className="px-4 py-2 border rounded">Hủy</button>
               <button
                  onClick={handleSave}
                  disabled={systemConfig.isOpeningBalanceLocked}
                  className="px-6 py-2 bg-blue-600 text-white rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed"
               >
                  Lưu tồn kho
               </button>
            </div>
         </div>
      </div>
   );
};

const DebtOpeningModal = ({ type, onClose }: { type: OpeningDebtKind, onClose: () => void }) => {
   const {
      customers,
      suppliers,
      invoices,
      journalEntries,
      financialYear,
      openingBalanceAccounts,
      openingBalanceDebts,
      handleSaveOpeningDebtDetails,
      systemConfig,
   } = useApp();
   const [entries, setEntries] = useState<OpeningBalanceDebtDetail[]>([]);

   const partnerSuggestions = type === 'CUSTOMER_DEBT' ? customers : suppliers;
   const revenueOptions = OPENING_DEBT_REVENUE_OPTIONS[type];
   const partyLabel = type === 'CUSTOMER_DEBT' ? 'khách hàng' : 'nhà cung cấp';
   const amountLabel = type === 'CUSTOMER_DEBT' ? 'Số tiền phải thu' : 'Số tiền phải trả';
   const debtTypeLabel = type === 'CUSTOMER_DEBT' ? 'Loại doanh thu' : 'Nguồn nợ';
   const listId = `opening-debt-partner-list-${type.toLowerCase()}`;
   const targetTotal = useMemo(
      () => (type === 'CUSTOMER_DEBT'
         ? getOpeningAccountTotal(openingBalanceAccounts, '131', 'DEBIT')
         : getOpeningAccountTotal(openingBalanceAccounts, '331', 'CREDIT')),
      [type, openingBalanceAccounts],
   );
   const enteredTotal = useMemo(
      () => getOpeningDebtTotal(entries, type),
      [entries, type],
   );
   const remainingTotal = targetTotal - enteredTotal;

   const openingDebtsFingerprintForKind = useMemo(
      () =>
         JSON.stringify(
            openingBalanceDebts
               .filter((row) => row.kind === type)
               .slice()
               .sort((a, b) => String(a.id).localeCompare(String(b.id))),
         ),
      [openingBalanceDebts, type],
   );

   useEffect(() => {
      const existing = openingBalanceDebts.filter((row) => row.kind === type).map((row) => ({ ...row }));
      setEntries(existing.length > 0 ? existing : [createOpeningDebtDraft(type)]);
      // Chỉ phụ thuộc fingerprint — khi mảng store đổi reference nhưng dữ liệu giống hệt thì không ghi đè chỉnh sửa trên modal.
   }, [type, openingDebtsFingerprintForKind]);

   const handleFieldChange = (
      id: string,
      field: 'partnerName' | 'invoiceSymbolCode' | 'invoiceNo' | 'revenueType' | 'dueDate' | 'note',
      value: string,
   ) => {
      setEntries((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
   };

   const handleAmountChange = (id: string, rawValue: string) => {
      const numericValue = parseInputNumber(rawValue);
      if (isNaN(numericValue)) return;
      setEntries((prev) =>
         prev.map((row) => (row.id === id ? { ...row, amount: numericValue } : row)),
      );
   };

   const handleAddRow = () => {
      setEntries((prev) => [...prev, createOpeningDebtDraft(type)]);
   };

   const handleLinkFromInvoiceVat = () => {
      if (systemConfig.isOpeningBalanceLocked) {
         alert('Công nợ đầu kỳ đang bị khóa. Vui lòng mở khóa để chỉnh sửa.');
         return;
      }
      const linkedRows = buildLinkedOpeningDebtRowsFromInvoices({
         kind: type,
         invoices,
         journalEntries,
         financialYear,
         partners: partnerSuggestions,
      });
      if (linkedRows.length === 0) {
         alert(
            `Không tìm thấy dữ liệu hóa đơn VAT còn công nợ TK ${type === 'CUSTOMER_DEBT' ? '131' : '331'} để liên kết.`,
         );
         return;
      }
      setEntries(linkedRows);
      alert(
         `Đã liên kết ${linkedRows.length} dòng công nợ từ Hóa đơn & VAT. Vui lòng kiểm tra thông tin rồi bấm "Lưu công nợ".`,
      );
   };

   const handleDeleteRow = (id: string) => {
      setEntries((prev) => {
         if (prev.length <= 1) return [createOpeningDebtDraft(type)];
         return prev.filter((row) => row.id !== id);
      });
   };

   const handleSave = () => {
      if (systemConfig.isOpeningBalanceLocked) {
         alert('Công nợ đầu kỳ đang bị khóa. Vui lòng mở khóa để chỉnh sửa.');
         return;
      }
      const confirmSave = window.confirm(
         `Xác nhận Lưu công nợ ${type === 'CUSTOMER_DEBT' ? 'khách hàng' : 'nhà cung cấp'} đầu kỳ?\n` +
            `Số dòng hiện có: ${entries.length}\n` +
            `Tổng tiền: ${formatCurrency(getOpeningDebtTotal(entries, type))}`,
      );
      if (!confirmSave) return;
      const ok = handleSaveOpeningDebtDetails(type, entries);
      if (ok) onClose();
   };

   return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
         <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl h-[85vh] flex flex-col animate-fade-in">
            <div className="bg-blue-600 p-4 text-white flex justify-between items-center">
               <div>
                  <h3 className="font-bold">
                     Nhập {type === 'CUSTOMER_DEBT' ? 'Công Nợ Khách Hàng' : 'Công Nợ Nhà Cung Cấp'} Đầu Kỳ
                  </h3>
                  <p className="text-xs opacity-90 mt-1">
                     Mỗi dòng nên có đủ <strong>ký hiệu</strong>, <strong>số hóa đơn</strong> và <strong>tên đối tượng</strong> (đã kết nối mã KH/NCC khi chọn từ danh bạ) để khi lập phiếu thu/chi/ủy nhiệm chi khớp đúng gốc.
                  </p>
               </div>
               <button onClick={onClose}><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
               <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                  <div className="font-bold">Ràng buộc bắt buộc</div>
                  <div className="mt-1">
                     Mỗi dòng công nợ phải có <strong>Số hóa đơn</strong>, <strong>{debtTypeLabel}</strong> và số tiền; nên điền <strong>Ký hiệu HĐ</strong> (theo hóa đơn gốc) để phân biệt đúng chứng từ.
                     Bạn có thể gõ tay tên {partyLabel} hoặc chọn nhanh từ danh sách gợi ý — hệ thống gắn mã đối tượng khi trùng tên.
                  </div>
               </div>
               <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-800">
                  <div className="font-bold">Nguyên tắc kế toán (công nợ từ kỳ trước)</div>
                  <p className="mt-1">
                     <strong>Doanh thu và giá vốn (chi phí)</strong> đã được ghi nhận ở kỳ phát sinh hóa đơn, không phải ở kỳ hiện tại
                     chỉ vì còn nợ mang sang. Trường « {debtTypeLabel} » chỉ phục vụ phân loại theo dõi, không thay thế bút ghi DT/CP kỳ cũ.
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                     Khi {type === 'CUSTOMER_DEBT' ? 'khách thanh toán' : 'bạn thanh toán'} trong kỳ hiện tại, hạch toán{' '}
                     {type === 'CUSTOMER_DEBT' ? 'Nợ tiền / Có 131' : 'Nợ 331 / Có tiền'} — không ghi lại doanh thu hay chi phí.
                  </p>
               </div>

               {systemConfig.isOpeningBalanceLocked && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                     Công nợ đầu kỳ đang bị khóa. Vui lòng “Mở khóa để sửa” trong Trạng thái hệ thống.
                  </div>
               )}

               <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                     <div>
                        <div className="text-sm font-bold text-slate-800">Tiến độ nhập chi tiết công nợ</div>
                        <div className="mt-1 text-sm text-slate-600">
                           Tổng nợ cần nhập: <span className="font-black text-slate-800">{formatCurrency(targetTotal)}</span>
                           {' '}· Đã nhập: <span className="font-black text-blue-700">{formatCurrency(enteredTotal)}</span>
                           {' '}· Còn lại:{' '}
                           <span className={`font-black ${remainingTotal === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {formatCurrency(remainingTotal)}
                           </span>
                        </div>
                     </div>
                    <div className="flex flex-wrap items-center gap-2">
                       <button
                          type="button"
                          onClick={handleLinkFromInvoiceVat}
                          disabled={systemConfig.isOpeningBalanceLocked}
                          className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                       >
                          Liên kết từ Hóa đơn & VAT
                       </button>
                       <button
                          type="button"
                          onClick={handleAddRow}
                          disabled={systemConfig.isOpeningBalanceLocked}
                          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                       >
                          + Thêm dòng
                       </button>
                    </div>
                  </div>
               </div>

               <datalist id={listId}>
                  {partnerSuggestions.map((partner) => (
                     <option key={partner.id} value={partner.name}>
                        {partner.code ? `${partner.code} - ${partner.name}` : partner.name}
                     </option>
                  ))}
               </datalist>

               <div className="overflow-x-auto rounded-lg border border-slate-200">
               <table className="w-full text-sm min-w-[960px]">
                  <thead className="bg-slate-100 font-bold sticky top-0">
                     <tr>
                        <th className="p-3 text-left w-[18%]">Tên {partyLabel}</th>
                        <th className="p-3 text-left w-[11%]">Ký hiệu HĐ</th>
                        <th className="p-3 text-left w-[11%]">Số hóa đơn</th>
                        <th className="p-3 text-left w-[14%]">{debtTypeLabel}</th>
                        <th className="p-3 text-left w-[11%]">Hạn thanh toán</th>
                        <th className="p-3 text-right w-[12%]">{amountLabel}</th>
                        <th className="p-3 text-left">Ghi chú</th>
                        <th className="p-3 text-center w-20">Thao tác</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                     {entries.map((row) => (
                        <tr key={row.id}>
                           {(() => {
                              const isReadOnlyRow = Boolean(row.readOnly);
                              const isStaleRow = row.syncStatus === 'STALE';
                              return (
                                 <>
                           <td className="p-3 align-top">
                              <input
                                 type="text"
                                 list={listId}
                                 disabled={systemConfig.isOpeningBalanceLocked || isReadOnlyRow}
                                 className="w-full border rounded p-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                 value={row.partnerName || ''}
                                 onChange={(e) => handleFieldChange(row.id, 'partnerName', e.target.value)}
                                 placeholder={`Nhập hoặc chọn ${partyLabel}`}
                              />
                              {row.partnerCode && (
                                 <div className="mt-1 text-[11px] font-mono text-slate-500">Mã ĐT: {row.partnerCode}</div>
                              )}
                              <div className="mt-1 flex flex-wrap gap-1">
                                 {isReadOnlyRow && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                       <Lock className="h-3 w-3" /> Kết chuyển tự động
                                    </span>
                                 )}
                                 {isStaleRow && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                                       <AlertCircle className="h-3 w-3" /> Cần đồng bộ lại
                                    </span>
                                 )}
                              </div>
                           </td>
                           <td className="p-3 align-top">
                              <input
                                 type="text"
                                 disabled={systemConfig.isOpeningBalanceLocked || isReadOnlyRow}
                                 className="w-full border rounded p-2 font-mono text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                 value={row.invoiceSymbolCode || ''}
                                 onChange={(e) => handleFieldChange(row.id, 'invoiceSymbolCode', e.target.value)}
                                 placeholder="VD: 1C23TYY"
                              />
                           </td>
                           <td className="p-3 align-top">
                              <input
                                 type="text"
                                 disabled={systemConfig.isOpeningBalanceLocked || isReadOnlyRow}
                                 className="w-full border rounded p-2 font-mono text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                 value={row.invoiceNo || ''}
                                 onChange={(e) => handleFieldChange(row.id, 'invoiceNo', e.target.value)}
                                 placeholder="VD: 000123"
                              />
                           </td>
                           <td className="p-3 align-top">
                              <select
                                 disabled={systemConfig.isOpeningBalanceLocked || isReadOnlyRow}
                                 className="w-full border rounded p-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                 value={row.revenueType || revenueOptions[0].value}
                                 onChange={(e) => handleFieldChange(row.id, 'revenueType', e.target.value)}
                              >
                                 {revenueOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                 ))}
                              </select>
                           </td>
                           <td className="p-3 align-top">
                              <input
                                 type="date"
                                 disabled={systemConfig.isOpeningBalanceLocked || isReadOnlyRow}
                                 className="w-full border rounded p-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                 value={row.dueDate || ''}
                                 onChange={(e) => handleFieldChange(row.id, 'dueDate', e.target.value)}
                              />
                           </td>
                           <td className="p-3 align-top">
                              <input
                                 type="text"
                                 disabled={systemConfig.isOpeningBalanceLocked || isReadOnlyRow}
                                 className="w-full border rounded p-2 text-right font-mono font-bold disabled:bg-slate-100 disabled:text-slate-400"
                                 value={formatInputNumber(row.amount || 0)}
                                 onChange={(e) => handleAmountChange(row.id, e.target.value)}
                                 placeholder="0"
                              />
                           </td>
                           <td className="p-3 align-top">
                              <input
                                 type="text"
                                 disabled={systemConfig.isOpeningBalanceLocked || isReadOnlyRow}
                                 className="w-full border rounded p-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                 value={row.note || ''}
                                 onChange={(e) => handleFieldChange(row.id, 'note', e.target.value)}
                                 placeholder="Diễn giải thêm (nếu có)"
                              />
                              {(row.sourceInvoiceNumber || row.sourceYearKey || row.invoiceSymbolCode) && (
                                 <div className="mt-1 text-[11px] text-slate-500">
                                    Nguồn: {row.invoiceSymbolCode ? `${row.invoiceSymbolCode} ` : ''}
                                    {row.sourceInvoiceNumber || row.invoiceNo || '—'}
                                    {row.sourceYearKey ? ` · ${row.sourceYearKey}` : ''}
                                 </div>
                              )}
                           </td>
                           <td className="p-3 align-top text-center">
                              <button
                                 type="button"
                                 onClick={() => handleDeleteRow(row.id)}
                                 disabled={systemConfig.isOpeningBalanceLocked || isReadOnlyRow}
                                 className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                 Xóa
                              </button>
                           </td>
                                 </>
                              );
                           })()}
                        </tr>
                     ))}
                  </tbody>
               </table>
               </div>
            </div>
            <div className="p-4 border-t flex justify-end gap-2 text-xs text-slate-500 italic">
               <span>* Hệ thống tự động phân cách hàng nghìn bằng dấu chấm.</span>
               <div className="flex-1"></div>
               <button onClick={onClose} className="px-4 py-2 border rounded text-slate-700">Hủy</button>
               <button
                  onClick={handleSave}
                  disabled={systemConfig.isOpeningBalanceLocked}
                  className="px-6 py-2 bg-blue-600 text-white rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed"
               >
                  Lưu công nợ
               </button>
            </div>
         </div>
      </div>
   );
};

const SystemStatusView = () => {
  const { systemConfig, handleToggleSystemLock, handleClearOpeningData, handleResetAllData, financialYear, setActiveTab } = useApp();

  return (
    <div className="p-6">
      <h3 className="font-bold text-lg text-slate-800 mb-6 flex items-center gap-2">
        <Activity className="w-5 h-5 text-blue-600" /> Trạng thái hệ thống
      </h3>
      <div className="grid grid-cols-3 gap-6">
          {/* Initialization Status */}
          <div className="p-6 rounded-xl border border-emerald-200 bg-emerald-50 flex flex-col items-center text-center">
              <div className="p-3 bg-white rounded-full mb-3 shadow-sm">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <h4 className="font-bold text-emerald-800 text-lg">Đã khởi tạo</h4>
              <p className="text-sm text-emerald-600 mt-1">Hệ thống đã sẵn sàng hoạt động</p>
              <p className="text-xs text-slate-500 mt-2">
                 Ngày: {new Date(systemConfig.initializationDate).toLocaleDateString('vi-VN')}
              </p>
          </div>

          {/* Opening Balance Lock Status */}
          <div className={`p-6 rounded-xl border flex flex-col items-center text-center transition-colors ${systemConfig.isOpeningBalanceLocked ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50'}`}>
              <div className="p-3 bg-white rounded-full mb-3 shadow-sm">
                  {systemConfig.isOpeningBalanceLocked ? <Lock className="w-8 h-8 text-blue-600" /> : <Unlock className="w-8 h-8 text-amber-600" />}
              </div>
              <h4 className={`font-bold text-lg ${systemConfig.isOpeningBalanceLocked ? 'text-blue-800' : 'text-amber-800'}`}>
                 {systemConfig.isOpeningBalanceLocked ? 'Đã khóa số dư đầu kỳ' : 'Số dư đầu kỳ MỞ'}
              </h4>
              <p className={`text-sm mt-1 ${systemConfig.isOpeningBalanceLocked ? 'text-blue-600' : 'text-amber-600'}`}>
                 {systemConfig.isOpeningBalanceLocked ? 'Dữ liệu đầu kỳ đã được chốt' : 'Có thể chỉnh sửa số dư'}
              </p>
              <button 
                 onClick={handleToggleSystemLock}
                 className={`mt-3 text-xs bg-white border px-3 py-1 rounded hover:opacity-80 font-bold ${systemConfig.isOpeningBalanceLocked ? 'border-blue-200 text-blue-600' : 'border-amber-200 text-amber-600'}`}
              >
                 {systemConfig.isOpeningBalanceLocked ? 'Mở khóa để sửa' : 'Khóa sổ ngay'}
              </button>

              <button
                 disabled={systemConfig.isOpeningBalanceLocked}
                 onClick={() => {
                    if (window.confirm('Bạn có chắc muốn XÓA toàn bộ dữ liệu thiết lập ban đầu (số dư đầu kỳ, tồn kho đầu kỳ & số dư CCDC/TSCĐ tham chiếu) để nhập lại không?')) {
                      handleClearOpeningData();
                    }
                 }}
                 className={`mt-2 text-xs px-3 py-1 rounded font-bold border ${
                    systemConfig.isOpeningBalanceLocked
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                 }`}
              >
                 Xóa dữ liệu đầu kỳ
              </button>

              <button
                 onClick={() => {
                    if (window.confirm('Bạn có chắc muốn RESET TOÀN BỘ dữ liệu (xóa sạch dữ liệu cũ trong DB và Hotel PMS) không? Hành động này không thể hoàn tác.')) {
                      handleResetAllData();
                    }
                 }}
                 className="mt-2 text-xs px-3 py-1 rounded font-black border bg-red-600 text-white border-red-700 hover:bg-red-700"
              >
                 Xóa sạch dữ liệu cũ (Reset)
              </button>
          </div>

          {/* Financial Year Status */}
          <div 
             onClick={() => setActiveTab('sys_year')}
             className="p-6 rounded-xl border border-purple-200 bg-purple-50 flex flex-col items-center text-center cursor-pointer hover:bg-purple-100 transition-colors"
          >
              <div className="p-3 bg-white rounded-full mb-3 shadow-sm">
                  <Calendar className="w-8 h-8 text-purple-600" />
              </div>
              <h4 className="font-bold text-purple-800 text-lg">
                 Năm TC {new Date(financialYear.startDate).getFullYear()}
              </h4>
              <p className="text-sm text-purple-600 mt-1">
                 {new Date(financialYear.startDate).toLocaleDateString('vi-VN')} - {new Date(financialYear.endDate).toLocaleDateString('vi-VN')}
              </p>
              <p className="text-xs text-slate-500 mt-2">Kỳ hiện tại: Tháng {new Date().getMonth() + 1}</p>
          </div>
      </div>
    </div>
  );
};

const SystemLogsView = () => (
  <div className="p-6">
    <h3 className="font-bold text-lg text-slate-800 mb-6 flex items-center gap-2">
      <FileClock className="w-5 h-5 text-blue-600" /> Nhật ký truy cập & Thao tác
    </h3>
    <table className="w-full text-sm text-left border rounded-lg">
        <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
            <tr>
                <th className="p-3">Thời gian</th>
                <th className="p-3">Người dùng</th>
                <th className="p-3">Hành động</th>
                <th className="p-3">Chi tiết</th>
                <th className="p-3 text-center">IP</th>
            </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
            {[1,2,3,4,5].map(i => (
                <tr key={i} className="hover:bg-slate-50">
                    <td className="p-3 text-slate-500">{new Date().toLocaleString('vi-VN')}</td>
                    <td className="p-3 font-bold">admin</td>
                    <td className="p-3 text-blue-600">Update Invoice</td>
                    <td className="p-3">Sửa hóa đơn #00123: Thay đổi trạng thái → PAID</td>
                    <td className="p-3 text-center font-mono text-xs">192.168.1.{i}</td>
                </tr>
            ))}
        </tbody>
    </table>
  </div>
);

const parseBackupApiError = async (res: Response): Promise<string> => {
  try {
    const d = await res.json();
    if (typeof d?.error === 'string') return d.error;
  } catch {
    // ignore
  }
  if (res.status === 401) return 'Hết phiên đăng nhập — vui lòng đăng nhập lại.';
  if (res.status === 403) return 'Không đủ quyền thực hiện thao tác này.';
  return `Lỗi máy chủ (${res.status}).`;
};

const BackupRestoreView = () => {
  const token = (() => {
    try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
  })();
  const localZipInputRef = useRef<HTMLInputElement>(null);

  const [info, setInfo] = useState<any>(null);
  const [list, setList] = useState<{ Weekly: any[]; Monthly: any[]; Yearly: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [autoWeekly, setAutoWeekly] = useState(false);
  const [maxWeeklyBackups, setMaxWeeklyBackups] = useState<2 | 4 | 8>(4);
  const [manualTags, setManualTags] = useState<{ FINAL: boolean; LOCKED: boolean; MANUAL: boolean }>({ FINAL: false, LOCKED: false, MANUAL: true });
  const [autoDownloadAfterCreate, setAutoDownloadAfterCreate] = useState(true);

  const supportsSavePicker = () => {
    try {
      return typeof (window as any).showSaveFilePicker === 'function';
    } catch {
      return false;
    }
  };

  const saveBlobWithPicker = async (blob: Blob, suggestedName: string) => {
    // Prefer File System Access API for "Save As" dialog (Chrome/Edge).
    const anyWindow = window as any;
    if (typeof anyWindow.showSaveFilePicker === 'function') {
      const handle = await anyWindow.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'ZIP archive',
            accept: { 'application/zip': ['.zip'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }

    // Fallback: trigger a normal browser download (no folder picker).
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadZip = async (tier: 'Weekly' | 'Monthly' | 'Yearly', filename: string) => {
    if (!token) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/backup/download?tier=${encodeURIComponent(tier)}&filename=${encodeURIComponent(filename)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Tải file thất bại');
      }
      const blob = await res.blob();
      await saveBlobWithPicker(blob, filename);
      if (!supportsSavePicker()) {
        setMsg('Trình duyệt hiện tại không hỗ trợ chọn thư mục lưu. File sẽ tải về theo cài đặt download mặc định.');
      }
    } catch (e: any) {
      // AbortError is a normal "user canceled" case for the save picker.
      if (String(e?.name || '') === 'AbortError') return;
      setMsg(e?.message || 'Tải file thất bại');
    } finally {
      setLoading(false);
    }
  };

  const loadAll = async () => {
    if (!token) return;
    setLoading(true);
    setMsg('');
    try {
      const infoRes = await fetch('/api/backup/info', { headers: { Authorization: `Bearer ${token}` } });
      const infoData = await infoRes.json();
      if (!infoRes.ok) throw new Error(infoData?.error || 'Không tải được thông tin backup');
      setInfo(infoData);
      setAutoWeekly(Boolean(infoData?.settings?.autoWeekly));
      setMaxWeeklyBackups((infoData?.settings?.maxWeeklyBackups || 4) as any);

      const listRes = await fetch('/api/backup/list', { headers: { Authorization: `Bearer ${token}` } });
      const listData = await listRes.json();
      if (!listRes.ok) throw new Error(listData?.error || 'Không tải được danh sách backup');
      setList(listData);
    } catch (e: any) {
      setMsg(e?.message || 'Lỗi tải dữ liệu backup');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSettings = async () => {
    if (!token) return;
    if (!window.confirm(`Xác nhận lưu cấu hình backup?\n\n- Auto weekly: ${autoWeekly ? 'BẬT' : 'TẮT'}\n- Giữ weekly: ${maxWeeklyBackups} tuần`)) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/backup/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ autoWeekly, maxWeeklyBackups }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Lưu cấu hình thất bại');
      setMsg('Đã lưu cấu hình backup.');
      await loadAll();
    } catch (e: any) {
      setMsg(e?.message || 'Lưu cấu hình thất bại');
    } finally {
      setLoading(false);
    }
  };

  const createBackup = async (tier: 'Weekly' | 'Monthly' | 'Yearly') => {
    if (!token) return;
    const label = tier === 'Weekly' ? 'tuần' : (tier === 'Monthly' ? 'tháng' : 'năm');
    if (!window.confirm(`Xác nhận sao lưu dữ liệu ${label} (${tier})?\n\nHệ thống sẽ tạo file .zip trong thư mục Backup/${tier}.`)) return;
    setLoading(true);
    setMsg('');
    try {
      const tags = Object.entries(manualTags).filter(([, v]) => v).map(([k]) => k);
      const res = await fetch('/api/backup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier, tags }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Tạo backup thất bại');
      if (tier === 'Weekly' && data?.cleanup?.cleaned > 0) {
        setMsg(`Đã tạo backup ${tier}. Đã dọn ${data.cleanup.cleaned} bản backup cũ.`);
      } else {
        setMsg(`Đã tạo backup ${tier} thành công.`);
      }
      await loadAll();

      // UX (optional): after creating, allow saving to local disk with a "Save As" dialog.
      if (autoDownloadAfterCreate) {
        const createdFilename = data?.backup?.filename;
        if (createdFilename && String(createdFilename).endsWith('.zip')) {
          await downloadZip(tier, String(createdFilename));
        }
      }
    } catch (e: any) {
      setMsg(e?.message || 'Tạo backup thất bại');
    } finally {
      setLoading(false);
    }
  };

  const restore = async (tier: 'Weekly' | 'Monthly' | 'Yearly', filename: string) => {
    if (!token) return;
    if (!window.confirm(`Phục hồi từ ${tier}/${filename}? Dữ liệu hiện tại sẽ bị ghi đè.`)) return;
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier, filename }),
      });
      if (!res.ok) throw new Error(await parseBackupApiError(res));
      setMsg('Phục hồi thành công. Đang tải lại trang…');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (e: any) {
      setMsg(e?.message || 'Phục hồi thất bại');
    } finally {
      setLoading(false);
    }
  };

  const restoreFromLocalZip = async () => {
    if (!token) return;
    const input = localZipInputRef.current;
    const file = input?.files?.[0];
    if (!file) {
      setMsg('Hãy chọn file .zip (backup Victory có chứa state.json).');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setMsg('Chỉ chấp nhận file .zip.');
      return;
    }
    if (!window.confirm(`Phục hồi từ file "${file.name}" trên máy bạn? Toàn bộ dữ liệu hiện tại trên máy chủ sẽ bị ghi đè.`)) return;
    setLoading(true);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/backup/restore-upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await parseBackupApiError(res));
      setMsg('Phục hồi từ file thành công. Đang tải lại trang…');
      if (input) input.value = '';
      window.setTimeout(() => window.location.reload(), 500);
    } catch (e: any) {
      setMsg(e?.message || 'Phục hồi từ file thất bại');
    } finally {
      setLoading(false);
    }
  };

  const download = (tier: 'Weekly' | 'Monthly' | 'Yearly', filename: string) => {
    downloadZip(tier, filename);
  };

  const renderSection = (tier: 'Weekly' | 'Monthly' | 'Yearly', rows: any[] = []) => (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
        <div className="font-black text-slate-700">{tier}</div>
        <button
          disabled={loading}
          onClick={() => createBackup(tier)}
          className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black disabled:opacity-50"
        >
          Tạo {tier} (.zip)
        </button>
      </div>
      <div className="p-4">
        {rows.length === 0 ? (
          <div className="text-sm text-slate-400 italic">Chưa có backup.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((b: any) => (
              <div key={`${tier}-${b.filename}`} className="p-3 rounded-lg border border-slate-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800 truncate">{b.filename}</div>
                  <div className="text-[11px] text-slate-500">
                    {b.createdAt ? `Tạo lúc: ${new Date(b.createdAt).toLocaleString('vi-VN')}` : ''}{' '}
                    {Array.isArray(b.tags) && b.tags.length ? `| Tags: ${b.tags.join(', ')}` : ''}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => download(tier, b.filename)} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-black">
                    Tải .zip
                  </button>
                  <button onClick={() => restore(tier, b.filename)} className="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-black">
                    Phục hồi
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
        <Database className="w-5 h-5 text-blue-600" /> Sao lưu & Phục hồi dữ liệu
      </h3>

      {msg && (
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-bold text-sm">
          {msg}
        </div>
      )}

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-black text-amber-900 mb-1">Cách phục hồi đúng</p>
        <ul className="list-disc pl-5 space-y-1 text-amber-900/90">
          <li>
            Nút <b>Phục hồi</b> dưới mỗi bản backup chỉ áp dụng cho file <b>.zip còn nằm trên máy chủ</b> (thư mục{' '}
            <span className="font-mono">Backup/Weekly|Monthly|Yearly</span> trên volume dữ liệu).
          </li>
          <li>
            Nếu bạn chỉ giữ bản <b>.zip đã tải về máy tính</b> (Downloads), hãy dùng mục <b>« Phục hồi từ file .zip trên máy »</b> bên dưới.
          </li>
          <li>
            Sau khi phục hồi thành công, trang sẽ <b>tự tải lại</b> để nạp dữ liệu mới từ máy chủ (trước đây cần F5 thủ công).
          </li>
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="font-black text-slate-700 mb-2 flex items-center gap-2">
          <Upload className="h-4 w-4 text-blue-600" aria-hidden />
          Phục hồi từ file .zip trên máy
        </div>
        <p className="text-xs text-slate-600 mb-3">
          Chọn đúng file backup Victory (bên trong có <span className="font-mono">state.json</span>). Dung lượng tối đa 200MB.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={localZipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-bold"
          />
          <button
            type="button"
            disabled={loading}
            onClick={restoreFromLocalZip}
            className="rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-red-700 disabled:opacity-50"
          >
            Phục hồi từ file đã chọn
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="font-black text-slate-700 mb-2">Đường dẫn lưu trữ</div>
        <div className="text-sm text-slate-600">
          <div><span className="font-bold">Container path</span>: <span className="font-mono">{info?.baseDir || '...'}</span></div>
          {info?.hostPathHint ? (
            <div className="mt-1"><span className="font-bold">Host path (gợi ý)</span>: <span className="font-mono">{info.hostPathHint}</span></div>
          ) : null}
          <div className="mt-2 text-[11px] text-slate-500">
            Cấu trúc: <span className="font-mono">Backup/Weekly</span> (xoá vòng lặp) · <span className="font-mono">Backup/Monthly</span> · <span className="font-mono">Backup/Yearly</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="font-black text-slate-700 mb-4">Cấu hình lưu vòng lặp (Weekly)</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5 ml-1">Giữ lại</label>
            <select
              value={maxWeeklyBackups}
              onChange={(e) => setMaxWeeklyBackups(Number(e.target.value) as any)}
              className="w-full h-[44px] px-3 bg-white border border-slate-300 rounded-xl outline-none text-sm font-bold"
            >
              <option value={2}>2 tuần</option>
              <option value={4}>4 tuần</option>
              <option value={8}>8 tuần</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5 ml-1">Auto weekly backup</label>
            <div className="flex items-center gap-3 h-[44px] px-3 bg-white border border-slate-300 rounded-xl">
              <input type="checkbox" checked={autoWeekly} onChange={(e) => setAutoWeekly(e.target.checked)} />
              <div className="text-sm font-bold text-slate-700">{autoWeekly ? 'Bật' : 'Tắt'}</div>
            </div>
          </div>
          <button
            disabled={loading}
            onClick={saveSettings}
            className="h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-wider disabled:opacity-50"
          >
            Lưu cấu hình
          </button>
        </div>

        <div className="mt-4 text-[11px] text-slate-500">
          ❗ Weekly sẽ tự dọn theo số lượng. Tuyệt đối không xoá nếu backup thuộc Monthly/Yearly hoặc có tag: FINAL/LOCKED/MANUAL.
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="font-black text-slate-700 mb-2">Lưu file về máy</div>
        <div className="flex items-center gap-3">
          <input
            id="autoDownloadAfterCreate"
            type="checkbox"
            checked={autoDownloadAfterCreate}
            onChange={(e) => setAutoDownloadAfterCreate(e.target.checked)}
          />
          <label htmlFor="autoDownloadAfterCreate" className="text-sm font-bold text-slate-700">
            Sau khi tạo backup, tự mở hộp thoại “Lưu về máy” để bạn chọn thư mục lưu (.zip)
          </label>
        </div>
        <div className="mt-2 text-[11px] text-slate-500">
          Ghi chú: Trình duyệt Chrome/Edge hỗ trợ chọn thư mục (Save As). Safari/Firefox có thể chỉ tải về thư mục Downloads mặc định.
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="font-black text-slate-700 mb-3">Tag khi tạo backup</div>
        <div className="flex flex-wrap gap-4 text-sm font-bold text-slate-700">
          {(['MANUAL', 'FINAL', 'LOCKED'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={(manualTags as any)[k]}
                onChange={(e) => setManualTags(prev => ({ ...prev, [k]: e.target.checked }))}
              />
              {k}
            </label>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-slate-500">
          Backup Weekly có tag MANUAL/FINAL/LOCKED sẽ <span className="font-black">không bị xoá</span> khi dọn vòng lặp.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {renderSection('Weekly', list?.Weekly || [])}
        {renderSection('Monthly', list?.Monthly || [])}
        {renderSection('Yearly', list?.Yearly || [])}
      </div>
    </div>
  );
};
