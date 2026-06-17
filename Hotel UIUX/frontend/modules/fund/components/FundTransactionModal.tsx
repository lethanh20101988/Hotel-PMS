
import React, { useState, useEffect, useMemo } from 'react';
import { X, ArrowDownCircle, ArrowUpCircle, Calendar, CreditCard, User, FileText, AlignLeft, AlertCircle, Sparkles } from 'lucide-react';
import { FundTransaction } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { useApp } from '../../../app/store';
import { getFundDocumentPrefix } from '@shared/utils/documentNumbering';
import {
  buildPaymentFundScenariosFromCatalog,
  buildReceiptFundScenariosFromCatalog,
} from '@shared/utils/invoicePurchaseServiceAccounts';
import {
  buildPartyDebtPairs,
  suggestPurchaseInvoicesForPayment,
  suggestSalesInvoicesForReceipt,
} from '@shared/utils/arApSubledger';
import { PartyDebtHintPanel } from '@shared/components/PartyDebtHintPanel';

interface FundTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<FundTransaction>) => void;
}

const RECEIPT_SCENARIOS_BASE: Array<{ code: string; label: string; contraAccount: string }> = [
  { code: 'COLLECT_DEBT', label: 'Thu hồi công nợ khách hàng (Có 131)', contraAccount: '131' },
  { code: 'SALES_GOODS', label: 'Thu bán hàng trực tiếp (Có 511, 3331)', contraAccount: '5111' },
  { code: 'SALES_SERVICE', label: 'Thu dịch vụ trực tiếp (Có 5113, 3331)', contraAccount: '5113' },
  { code: 'ADVANCE_REFUND', label: 'Thu hồi tạm ứng (Có 141)', contraAccount: '141' },
  { code: 'BANK_WITHDRAW', label: 'Rút tiền gửi về nhập quỹ (Có 1121)', contraAccount: '1121' },
  { code: 'FINANCE_INCOME', label: 'Thu lãi tiền gửi, tài chính (Có 515)', contraAccount: '515' },
  { code: 'CAPITAL', label: 'Thu vốn góp kinh doanh (Có 411)', contraAccount: '411' },
  { code: 'OTHER_INCOME', label: 'Thu nhập khác (Có 711)', contraAccount: '711' },
];

/** Tất cả loại Phiếu thu: mẫu cũ + danh mục TT133 (mã RCPT_xxx → TK Có). */
const RECEIPT_SCENARIOS = [...RECEIPT_SCENARIOS_BASE, ...buildReceiptFundScenariosFromCatalog()];

const PAYMENT_SCENARIOS_BASE: Array<{ code: string; label: string; contraAccount: string }> = [
  { code: 'BUY_MATERIAL', label: 'Chi mua nguyên vật liệu (Nợ 152)', contraAccount: '152' },
  { code: 'BUY_MERCHANDISE', label: 'Chi mua hàng hóa (Nợ 156)', contraAccount: '156' },
  { code: 'COST_WIP', label: 'Chi phí SXKD dở dang (Nợ 154)', contraAccount: '154' },
  { code: 'EXPENSE_MGMT', label: 'Chi phí quản lý doanh nghiệp (Nợ 642)', contraAccount: '642' },
  { code: 'EXPENSE_OVERHEAD', label: 'Chi phí sản xuất chung (Nợ 627)', contraAccount: '627' },
  { code: 'EXPENSE_SALES', label: 'Chi phí bán hàng (Nợ 641)', contraAccount: '641' },
  { code: 'VAT_INPUT', label: 'Thuế GTGT đầu vào (Nợ 1331)', contraAccount: '1331' },
  { code: 'PAY_SUPPLIER', label: 'Chi thanh toán người bán (Nợ 331)', contraAccount: '331' },
  { code: 'ADVANCE_EMPLOYEE', label: 'Chi tạm ứng nhân viên (Nợ 141)', contraAccount: '141' },
  { code: 'PAY_SALARY', label: 'Chi trả lương nhân viên (Nợ 334)', contraAccount: '334' },
  { code: 'TAX_VAT_OUT', label: 'Nộp thuế GTGT đầu ra (Nợ 3331)', contraAccount: '3331' },
  { code: 'TAX_PIT', label: 'Nộp thuế TNCN (Nợ 3335)', contraAccount: '3335' },
  { code: 'TAX_CIT', label: 'Nộp thuế TNDN (Nợ 3334)', contraAccount: '3334' },
  { code: 'TAX_OTHER', label: 'Nộp thuế khác (Nợ 3338)', contraAccount: '3338' },
  { code: 'LOAN_REPAY', label: 'Chi trả nợ vay (Nợ 341)', contraAccount: '341' },
  { code: 'EXPENSE_FINANCE', label: 'Chi phí tài chính (Nợ 635)', contraAccount: '635' },
  { code: 'EXPENSE_OTHER', label: 'Chi phí khác (Nợ 811)', contraAccount: '811' },
  { code: 'REIMBURSE_PROXY', label: 'Hoàn tiền cá nhân chi hộ (Nợ 3388)', contraAccount: '3388' },
  { code: 'DEPOSIT_BANK', label: 'Nộp tiền vào ngân hàng (Nợ 1121)', contraAccount: '1121' },
  { code: 'CASH_TRANSIT', label: 'Tiền đang chuyển (Nợ 113)', contraAccount: '113' },
];

/** Phiếu chi: mẫu cũ + danh mục TT133 (mã PMT_xxx → TK Nợ). */
const PAYMENT_SCENARIOS = [...PAYMENT_SCENARIOS_BASE, ...buildPaymentFundScenariosFromCatalog()];

export const FundTransactionModal: React.FC<FundTransactionModalProps> = ({ isOpen, onClose, onSave }) => {
  const {
    financialYear,
    activeTab,
    previewDocumentNumber,
    invoices,
    customers,
    suppliers,
    bankAccounts,
    allJournalEntriesAcrossYears,
  } = useApp();

  const [type, setType] = useState<'RECEIPT' | 'PAYMENT'>('RECEIPT');
  const [method, setMethod] = useState<'CASH' | 'BANK'>('CASH');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [payerReceiver, setPayerReceiver] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [referenceDoc, setReferenceDoc] = useState('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [scenarioCode, setScenarioCode] = useState('COLLECT_DEBT');
  const [receiptScenarioFilter, setReceiptScenarioFilter] = useState('');
  const [paymentScenarioFilter, setPaymentScenarioFilter] = useState('');

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

  // Khởi tạo ngày dựa trên niên độ
  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'doc_receipt') setType('RECEIPT');
      if (activeTab === 'doc_payment') setType('PAYMENT');
      // In "Chứng từ" tab, Phiếu thu/chi must be CASH only (TK 1111), not 1121.
      if (activeTab === 'doc_receipt' || activeTab === 'doc_payment') {
        setMethod('CASH');
      }
      const today = new Date().toISOString().split('T')[0];
      const defaultDate = (today >= financialYear.startDate && today <= financialYear.endDate)
        ? today
        : financialYear.startDate;
      
      setDate(defaultDate);
      setAmount('');
      setPayerReceiver('');
      setDescription('');
      setReferenceDoc('');
      setSelectedBankAccountId(activeBankAccounts[0]?.id || '');
      if (activeTab !== 'doc_receipt' && activeTab !== 'doc_payment') {
        setMethod('CASH'); // default: Tiền mặt (1111)
      }
      setReceiptScenarioFilter('');
      setPaymentScenarioFilter('');
    }
    // Chỉ khởi tạo lại form khi MỞ modal hoặc đổi loại tab chứng từ. KHÔNG phụ thuộc
    // financialYear / activeBankAccounts vì các giá trị này đổi tham chiếu mỗi lần đồng bộ
    // realtime (WebSocket) → sẽ reset form khi người dùng đang nhập, gây "không nhập được".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (type === 'RECEIPT') {
      setScenarioCode('COLLECT_DEBT');
    } else {
      setScenarioCode('BUY_MERCHANDISE');
    }
  }, [type]);

  useEffect(() => {
    let scenario;
    if (type === 'RECEIPT') {
      scenario = RECEIPT_SCENARIOS.find((s) => s.code === scenarioCode);
    } else {
      scenario = PAYMENT_SCENARIOS.find((s) => s.code === scenarioCode);
    }
    if (scenario) {
      setCategory(scenario.label.split('(')[0].trim());
    }
  }, [scenarioCode, type]);

  const receiptScenariosForSelect = useMemo(() => {
    const q = receiptScenarioFilter.trim().toLowerCase();
    if (!q) return RECEIPT_SCENARIOS;
    return RECEIPT_SCENARIOS.filter(
      (s) =>
        s.code.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.contraAccount.includes(q),
    );
  }, [receiptScenarioFilter]);

  const paymentScenariosForSelect = useMemo(() => {
    const q = paymentScenarioFilter.trim().toLowerCase();
    if (!q) return PAYMENT_SCENARIOS;
    return PAYMENT_SCENARIOS.filter(
      (s) =>
        s.code.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.contraAccount.includes(q),
    );
  }, [paymentScenarioFilter]);

  const activeContraAccount = useMemo(() => {
    const s =
      type === 'RECEIPT'
        ? RECEIPT_SCENARIOS.find((x) => x.code === scenarioCode)
        : PAYMENT_SCENARIOS.find((x) => x.code === scenarioCode);
    return String(s?.contraAccount || '');
  }, [type, scenarioCode]);

  const showInvoiceOffsetSuggest =
    (type === 'RECEIPT' && activeContraAccount.startsWith('131')) ||
    (type === 'PAYMENT' && activeContraAccount.startsWith('331'));

  const suggestedInvoices = useMemo(() => {
    if (!showInvoiceOffsetSuggest || payerReceiver.trim().length < 2) return [];
    if (type === 'RECEIPT') {
      return suggestSalesInvoicesForReceipt(payerReceiver, invoices, customers);
    }
    return suggestPurchaseInvoicesForPayment(payerReceiver, invoices, suppliers);
  }, [showInvoiceOffsetSuggest, type, payerReceiver, invoices, customers, suppliers]);

  const partyDebtPairs = useMemo(() => {
    if (!showInvoiceOffsetSuggest || payerReceiver.trim().length < 2) return null;
    const asOf = (date || financialYear.startDate || '').split('T')[0];
    if (!asOf) return null;
    const kind = type === 'RECEIPT' ? 'AR' : 'AP';
    return buildPartyDebtPairs({
      kind,
      partyName: payerReceiver.trim(),
      asOfDate: asOf,
      financialYear,
      entries: allJournalEntriesAcrossYears,
      invoices,
      customers,
      suppliers,
    });
  }, [
    showInvoiceOffsetSuggest,
    type,
    payerReceiver,
    date,
    financialYear,
    allJournalEntriesAcrossYears,
    invoices,
    customers,
    suppliers,
  ]);

  // Default method for reimbursing proxy payments: usually bank transfer
  useEffect(() => {
    if (type === 'PAYMENT' && scenarioCode === 'REIMBURSE_PROXY') setMethod('BANK');
  }, [type, scenarioCode]);

  useEffect(() => {
    if (method !== 'BANK') {
      setSelectedBankAccountId('');
      return;
    }
    if ((!selectedBankAccountId || selectedBankAccount?.status !== 'ACTIVE') && activeBankAccounts.length > 0) {
      setSelectedBankAccountId(activeBankAccounts[0].id);
    }
  }, [activeBankAccounts, method, selectedBankAccount, selectedBankAccountId]);

  const isDateInvalid = date < financialYear.startDate || date > financialYear.endDate;
  const isBankSelectionInvalid = method === 'BANK' && (!selectedBankAccount || selectedBankAccount.status !== 'ACTIVE');
  const voucherNumberPreview = previewDocumentNumber(
    getFundDocumentPrefix(type, method),
    date || financialYear.startDate,
  );

  const handleSubmit = () => {
     if (method === 'BANK' && (!selectedBankAccount || selectedBankAccount.status !== 'ACTIVE')) {
        window.alert('Vui lòng chọn tài khoản ngân hàng đang sử dụng.');
        return;
     }
     if (isDateInvalid) {
        const confirmMsg = `Ngày chứng từ (${date}) không thuộc niên độ ${new Date(financialYear.startDate).getFullYear()}. Bạn có chắc chắn muốn lưu?`;
        if (!window.confirm(confirmMsg)) return;
     }
     onSave({
        type, method, 
        amount: parseFloat(amount) || 0,
        date, payerReceiver, description, category, referenceDoc,
        bankAccountId: method === 'BANK' ? selectedBankAccount?.id : undefined,
        bankName: method === 'BANK' ? selectedBankAccount?.bankName : undefined,
        bankAccountNumber: method === 'BANK' ? selectedBankAccount?.accountNumber : undefined,
        bankAccountHolder: method === 'BANK' ? selectedBankAccount?.accountHolder : undefined,
        bankBranch: method === 'BANK' ? selectedBankAccount?.branch : undefined,
        bankLedgerAccountCode: method === 'BANK' ? selectedBankAccount?.linkedAccountCode : undefined,
        accountingType: (type === 'RECEIPT'
          ? (RECEIPT_SCENARIOS.find((s) => s.code === scenarioCode)?.contraAccount || scenarioCode)
          : (PAYMENT_SCENARIOS.find((s) => s.code === scenarioCode)?.contraAccount || scenarioCode)
        )
     });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className={`p-4 text-white flex justify-between items-center shadow-md ${type === 'RECEIPT' ? 'bg-gradient-to-r from-emerald-600 to-teal-600' : 'bg-gradient-to-r from-red-600 to-orange-600'}`}>
          <div className="flex items-center gap-3">
             <div className="p-2 bg-white/20 rounded-lg">
                {type === 'RECEIPT' ? <ArrowDownCircle className="w-6 h-6" /> : <ArrowUpCircle className="w-6 h-6" />} 
             </div>
             <div>
                <h3 className="text-lg font-bold leading-tight">
                  {type === 'RECEIPT' ? 'Lập phiếu thu' : 'Lập phiếu chi'}
                </h3>
                <p className="mt-1 text-[10px] font-medium opacity-90">
                  Niên độ tài chính: {new Date(financialYear.startDate).getFullYear()}
                </p>
             </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-2 rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>
        
        {/* Tab Switcher */}
        <div className="bg-slate-100 p-2 border-b border-slate-200 flex justify-center">
            <div className="flex bg-slate-200 p-1 rounded-lg w-full max-w-md">
              <button 
                onClick={() => setType('RECEIPT')} 
                className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all flex justify-center items-center gap-2 ${type === 'RECEIPT' ? 'bg-white shadow text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
              >
                 <ArrowDownCircle className="w-4 h-4" /> Thu tiền
              </button>
              <button 
                onClick={() => setType('PAYMENT')} 
                className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all flex justify-center items-center gap-2 ${type === 'PAYMENT' ? 'bg-white shadow text-red-700' : 'text-slate-500 hover:text-slate-700'}`}
              >
                 <ArrowUpCircle className="w-4 h-4" /> Chi tiền
              </button>
           </div>
        </div>

        {/* Body Form */}
        <div className="p-6 overflow-y-auto bg-slate-50 flex-1">
           {isDateInvalid && (
              <div className="mb-4 bg-red-50 border border-red-200 p-3 rounded-lg flex items-center gap-3 text-red-700 text-xs animate-pulse">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div>
                  <p className="font-bold">Cảnh báo ngày chứng từ!</p>
                  <p>Ngày hạch toán không nằm trong niên độ tài chính đang chọn.</p>
                </div>
              </div>
           )}

           <div className="grid grid-cols-12 gap-6">
              <div className="col-span-8 space-y-5">
                 <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                    <div className="grid grid-cols-1 min-[520px]:grid-cols-2 xl:grid-cols-4 gap-x-3 gap-y-3">
                       <div className="flex min-w-0 flex-col gap-1.5">
                          <label className="flex min-h-[2.25rem] items-start gap-1.5 text-[10px] font-bold leading-snug text-slate-500">
                             <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                             <span>Số phiếu nội bộ</span>
                          </label>
                          <input
                             className="h-10 w-full cursor-not-allowed rounded-lg border border-slate-300 bg-slate-100 px-3 font-mono text-xs font-semibold text-blue-700"
                             value={voucherNumberPreview}
                             readOnly
                          />
                       </div>
                       <div className="flex min-w-0 flex-col gap-1.5">
                          <label className="flex min-h-[2.25rem] items-start gap-1.5 text-[10px] font-bold leading-snug text-slate-500">
                             <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                             <span>Phương thức</span>
                          </label>
                          <select
                            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-blue-700 outline-none transition-all focus:ring-2 focus:ring-blue-500/40"
                            value={method}
                            onChange={e => setMethod(e.target.value as any)}
                            disabled={activeTab === 'doc_receipt' || activeTab === 'doc_payment'}
                          >
                             <option value="CASH">Tiền mặt (1111)</option>
                             {(activeTab !== 'doc_receipt' && activeTab !== 'doc_payment') && (
                               <option value="BANK">Ngân hàng (tự gán TK 1121xxx)</option>
                             )}
                          </select>
                       </div>
                       <div className="flex min-w-0 flex-col gap-1.5">
                          <label className="flex min-h-[2.25rem] items-start gap-1.5 text-[10px] font-bold leading-snug text-slate-500">
                             <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                             <span>Ngày chứng từ</span>
                          </label>
                          <input
                             type="date"
                             className={`h-10 w-full rounded-lg border px-3 text-xs font-medium outline-none transition-all focus:ring-2 focus:ring-blue-500/40 ${isDateInvalid ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-slate-50 focus:bg-white'}`}
                             value={date}
                             onChange={e => setDate(e.target.value)}
                          />
                       </div>
                       <div className="flex min-w-0 flex-col gap-1.5">
                          <label
                             className="flex min-h-[2.25rem] items-start gap-1.5 text-[10px] font-bold leading-snug text-slate-500"
                             title="Số chứng từ gốc / tham chiếu (HĐ, phiếu kho…)"
                          >
                             <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                             <span className="line-clamp-2">Số CT gốc / tham chiếu</span>
                          </label>
                          <input
                             className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-xs outline-none transition-all placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/40"
                             value={referenceDoc}
                             onChange={e => setReferenceDoc(e.target.value)}
                             placeholder="Số HĐ/Phiếu..."
                          />
                       </div>
                    </div>
                 </div>

                 {method === 'BANK' && (
                    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/80 p-4">
                       <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                             <label className="mb-1.5 block text-xs font-bold text-slate-600">Tài khoản ngân hàng</label>
                             <select
                               className="h-10 w-full rounded-lg border border-blue-200 bg-white px-3 text-sm font-medium text-blue-900 outline-none transition-all focus:ring-2 focus:ring-blue-500/30"
                               value={selectedBankAccountId}
                               onChange={e => setSelectedBankAccountId(e.target.value)}
                             >
                               <option value="">Chọn tài khoản ngân hàng</option>
                               {activeBankAccounts.map((bank) => (
                                 <option key={bank.id} value={bank.id}>
                                   {bank.bankName} - {bank.accountNumber}
                                 </option>
                               ))}
                             </select>
                             {activeBankAccounts.length === 0 && (
                               <p className="mt-2 text-xs font-medium text-amber-700">
                                 Chưa có tài khoản ngân hàng hoạt động trong danh mục Quỹ & ngân hàng.
                               </p>
                             )}
                          </div>
                          <div className="rounded-lg border border-blue-100 bg-white/70 p-3 text-xs text-slate-600">
                             <div className="font-bold text-slate-700">Hạch toán tự động</div>
                             <div className="mt-1">
                               TK tiền gửi: <span className="font-mono font-bold text-blue-700">{selectedBankAccount?.linkedAccountCode || '1121xxx'}</span>
                             </div>
                             <div className="mt-1">
                               Ngân hàng: <span className="font-semibold text-slate-800">{selectedBankAccount?.bankName || 'Chưa chọn'}</span>
                             </div>
                             <div className="mt-1">
                               Chủ tài khoản: <span className="font-semibold text-slate-800">{selectedBankAccount?.accountHolder || 'Chưa chọn'}</span>
                             </div>
                          </div>
                       </div>
                    </div>
                 )}

                 <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1.5">Loại nghiệp vụ (Hạch toán tự động)</label>
                        {type === 'RECEIPT' && (
                          <input
                            type="search"
                            value={receiptScenarioFilter}
                            onChange={(e) => setReceiptScenarioFilter(e.target.value)}
                            placeholder="Lọc theo mã TK, tên loại nghiệp vụ…"
                            className="mb-2 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs outline-none ring-emerald-500/20 focus:border-emerald-400 focus:ring-2"
                          />
                        )}
                        {type === 'PAYMENT' && (
                          <input
                            type="search"
                            value={paymentScenarioFilter}
                            onChange={(e) => setPaymentScenarioFilter(e.target.value)}
                            placeholder="Lọc theo mã TK, tên loại nghiệp vụ…"
                            className="mb-2 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs outline-none ring-red-500/20 focus:border-red-400 focus:ring-2"
                          />
                        )}
                        <select 
                            className={`w-full h-[44px] px-3 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none ${type === 'RECEIPT' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}
                            value={scenarioCode}
                            onChange={e => setScenarioCode(e.target.value)}
                        >
                            {type === 'RECEIPT' && scenarioCode && !receiptScenariosForSelect.some((s) => s.code === scenarioCode) && (
                              <option value={scenarioCode}>
                                {RECEIPT_SCENARIOS.find((s) => s.code === scenarioCode)?.label || scenarioCode} (đang chọn)
                              </option>
                            )}
                            {type === 'PAYMENT' && scenarioCode && !paymentScenariosForSelect.some((s) => s.code === scenarioCode) && (
                              <option value={scenarioCode}>
                                {PAYMENT_SCENARIOS.find((s) => s.code === scenarioCode)?.label || scenarioCode} (đang chọn)
                              </option>
                            )}
                            {type === 'RECEIPT' 
                              ? receiptScenariosForSelect.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)
                              : paymentScenariosForSelect.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)
                            }
                        </select>
                        {type === 'RECEIPT' && receiptScenarioFilter.trim() && receiptScenariosForSelect.length === 0 && (
                          <p className="mt-1 text-[11px] text-amber-700">Không có dòng khớp lọc — xóa ô tìm hoặc chọn lại từ danh sách đầy đủ.</p>
                        )}
                        {type === 'PAYMENT' && paymentScenarioFilter.trim() && paymentScenariosForSelect.length === 0 && (
                          <p className="mt-1 text-[11px] text-amber-700">Không có dòng khớp lọc — xóa ô tìm hoặc chọn lại từ danh sách đầy đủ.</p>
                        )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="flex items-center gap-1 text-xs font-bold text-slate-500 mb-1.5">
                              <User className="w-3 h-3" /> {type === 'RECEIPT' ? 'Người nộp tiền' : 'Người nhận tiền'}
                           </label>
                           <input 
                              className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                              value={payerReceiver} 
                              onChange={e => setPayerReceiver(e.target.value)}
                              placeholder="Nhập tên đối tượng..."
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1.5">Hạng mục / Lý do</label>
                           <input 
                              className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                              placeholder="VD: Thu tiền hàng..." 
                              value={category} 
                              onChange={e => setCategory(e.target.value)} 
                           />
                        </div>
                    </div>
                    {showInvoiceOffsetSuggest && suggestedInvoices.length > 0 && (
                      <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/95 p-3">
                        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-indigo-900">
                          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          Gợi ý đối trừ — chọn hóa đơn để điền số chứng từ gốc / diễn giải
                        </p>
                        <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-0.5 text-xs">
                          {suggestedInvoices.map((inv) => (
                            <li
                              key={inv.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/70 bg-white/90 px-2.5 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div>
                                  <span className="font-mono font-bold text-slate-800">{inv.invoiceNumber}</span>
                                  <span className="text-slate-500"> · {inv.date}</span>
                                  <span
                                    className={`ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                      inv.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {inv.status === 'PENDING' ? 'Chưa TT' : 'Đã TT'}
                                  </span>
                                </div>
                                <div className="text-[11px] font-semibold text-slate-700">{formatCurrency(inv.totalAmount)}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setReferenceDoc(inv.invoiceNumber);
                                  if (!description.trim()) {
                                    setDescription(
                                      type === 'RECEIPT'
                                        ? `Thu tiền theo HĐ bán ${inv.invoiceNumber}`
                                        : `Chi trả theo HĐ mua ${inv.invoiceNumber}`,
                                    );
                                  }
                                }}
                                className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-indigo-700"
                              >
                                Dùng HĐ này
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {showInvoiceOffsetSuggest && (
                      <PartyDebtHintPanel
                        data={partyDebtPairs}
                        accent={type === 'RECEIPT' ? 'emerald' : 'red'}
                      />
                    )}
                 </div>

                 <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                    <label className="flex items-center gap-1 text-xs font-bold text-slate-500 mb-1.5"><AlignLeft className="w-3 h-3" /> Diễn giải chi tiết</label>
                    <textarea 
                      className="w-full p-2 border border-slate-300 rounded-lg text-sm h-20 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Nhập nội dung chi tiết giao dịch..."
                    />
                 </div>
              </div>

              <div className="col-span-4 flex flex-col gap-4">
                 <div className={`p-6 rounded-xl border shadow-md flex flex-col justify-center items-center h-48 ${type === 'RECEIPT' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    <label className={`mb-2 text-sm font-bold ${type === 'RECEIPT' ? 'text-emerald-700' : 'text-red-700'}`}>Số tiền (VNĐ)</label>
                    <input 
                      type="number" 
                      className={`w-full bg-white border-2 text-center text-3xl font-bold rounded-lg p-3 outline-none transition-all shadow-inner ${type === 'RECEIPT' ? 'border-emerald-300 text-emerald-600 focus:border-emerald-500' : 'border-red-300 text-red-600 focus:border-red-500'}`}
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0"
                      autoFocus
                    />
                    {amount && (
                       <p className="mt-2 text-xs text-slate-500 font-medium italic">
                          {formatCurrency(parseFloat(amount))}
                       </p>
                    )}
                 </div>

                 <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex-1">
                    <h4 className="font-bold text-slate-700 text-sm mb-3 border-b pb-2">Tóm tắt giao dịch</h4>
                    <div className="space-y-3 text-sm">
                       <div className="flex justify-between">
                          <span className="text-slate-500">Loại:</span>
                          <span className={`font-bold ${type === 'RECEIPT' ? 'text-emerald-600' : 'text-red-600'}`}>
                             {type === 'RECEIPT' ? 'Phiếu thu' : 'Phiếu chi'}
                          </span>
                       </div>
                       <div className="flex justify-between">
                          <span className="text-slate-500">Hình thức:</span>
                          <span className="font-bold text-blue-700">
                            {method === 'BANK' ? (selectedBankAccount ? `${selectedBankAccount.bankName} (${selectedBankAccount.linkedAccountCode})` : 'Ngân hàng') : 'Tiền mặt (1111)'}
                          </span>
                       </div>
                       {method === 'BANK' && (
                         <div className="flex justify-between">
                            <span className="text-slate-500">Số tài khoản:</span>
                            <span className="font-medium truncate max-w-[150px] text-right">{selectedBankAccount?.accountNumber || '---'}</span>
                         </div>
                       )}
                       <div className="flex justify-between">
                          <span className="text-slate-500">Đối tượng:</span>
                          <span className="font-medium truncate max-w-[150px] text-right">{payerReceiver || '---'}</span>
                       </div>
                       <div className="flex justify-between items-center pt-3 border-t">
                          <span className="text-slate-700 font-bold">Tổng tiền:</span>
                          <span className={`text-lg font-bold ${type === 'RECEIPT' ? 'text-emerald-600' : 'text-red-600'}`}>
                             {formatCurrency(parseFloat(amount) || 0)}
                          </span>
                       </div>
                    </div>
                 </div>
              </div>
           </div>
        </div>

        <div className="p-4 border-t bg-slate-100 flex justify-between items-center">
           <div className="text-xs text-slate-500 italic max-w-[60%]">
              * Phiếu thu: Nợ 1111 hoặc TK ngân hàng liên kết, Có TK đối ứng. Phiếu chi: Nợ TK đối ứng, Có 1111 hoặc TK ngân hàng liên kết. Sổ chi tiết từng ngân hàng được tổng hợp về 1121.
           </div>
           <div className="flex gap-3">
              <button onClick={onClose} className="px-5 py-2.5 text-slate-600 hover:bg-slate-200 rounded-lg font-medium transition-colors">Hủy bỏ</button>
              <button 
                onClick={handleSubmit}
                disabled={isBankSelectionInvalid}
                className={`px-8 py-2.5 text-white rounded-lg font-bold shadow-lg transform active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${type === 'RECEIPT' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                Lưu phiếu
              </button>
           </div>
        </div>
      </div>
    </div>
  );
};
