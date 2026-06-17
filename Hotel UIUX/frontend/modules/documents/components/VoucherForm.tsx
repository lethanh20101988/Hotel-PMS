
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Plus, Trash2, Save, CheckCircle2, FileText, AlertCircle } from 'lucide-react';
import { AccountingVoucher, VoucherType, VoucherStatus, AccountingVoucherDetail, AccountDefinition } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { useApp } from '../../../app/store';
import { getVoucherDocumentPrefix } from '@shared/utils/documentNumbering';
import { CORE_CASH_BANK_ACCOUNT_CODES } from '@shared/utils/coreCashBankAccounts';
import {
  PURCHASE_SERVICE_DEBIT_ACCOUNT_CODES,
  buildBankDebitNoticeScenarios,
  buildBankCreditNoticeScenarios,
} from '@shared/utils/invoicePurchaseServiceAccounts';
import { isBankLedgerChildAccountCode, resolveBankAccountFromSnapshot } from '@shared/utils/bankAccountPayments';
import { mergePartnerNameSuggestions } from '@shared/utils/partnerNameMemory';
import { validateCashNotOverdraft, validateVoucherBalanced } from '@shared/utils/voucherSaveGuards';
import { buildPartyDebtPairs } from '@shared/utils/arApSubledger';
import { PartyDebtHintPanel } from '@shared/components/PartyDebtHintPanel';

const sortAccountCode = (a: string, b: string) => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, 'vi', { numeric: true });
};

/** Gợi ý TK Nợ — Ủy nhiệm chi (TT58 / chung) */
const UNC_QUICK_DEBIT_ACCOUNTS: ReadonlyArray<{ code: string; hint: string }> = [
  { code: '331', hint: 'Phải trả người bán' },
  { code: '3388', hint: 'Phải trả, phải nộp khác' },
  { code: '6421', hint: 'Chi phí bán hàng' },
  { code: '6422', hint: 'Chi phí quản lý doanh nghiệp' },
  { code: '3338', hint: 'Thuế và các khoản phải nộp NN khác' },
];

interface VoucherFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (voucher: AccountingVoucher) => void;
  initialVoucher: AccountingVoucher | null;
  type: VoucherType;
}

export const VoucherForm: React.FC<VoucherFormProps> = ({ isOpen, onClose, onSave, initialVoucher, type }) => {
  const {
    accounts,
    customers,
    suppliers,
    employees,
    assets,
    bankAccounts,
    financialYear,
    accountingVouchers,
    allJournalEntriesAcrossYears,
    invoices,
    previewDocumentNumber,
    partnerNameHistory,
    rememberPartnerName,
  } = useApp();
  
  const [formData, setFormData] = useState<Partial<AccountingVoucher>>({
     voucherNumber: '',
     date: '',
     postingDate: '',
     description: '',
     contactName: '',
     details: [],
     status: 'DRAFT'
  });

  const [localType, setLocalType] = useState<VoucherType>(type);
  const [bankNoticeScenarioFilter, setBankNoticeScenarioFilter] = useState('');
  const [bankNoticeScenarioCode, setBankNoticeScenarioCode] = useState('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const isPersistedInitialVoucher = !!initialVoucher && accountingVouchers.some(v => v.id === initialVoucher.id);
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
  const defaultBankLedgerCode = activeBankAccounts[0]?.linkedAccountCode || '1121';
  const selectedBankLedgerCode = selectedBankAccount?.linkedAccountCode || '1121';
  const bankNoticeScenarios = useMemo(
    () => ({
      debit: buildBankDebitNoticeScenarios(),
      credit: buildBankCreditNoticeScenarios(),
    }),
    [],
  );
  const inferVoucherBankLedgerCode = useCallback(
    (voucherType: VoucherType, details: AccountingVoucherDetail[] | undefined) => {
      if (!Array.isArray(details)) return '';
      if (voucherType === 'BANK_CREDIT') {
        return details.map((d) => String(d.debitAccount || '').trim()).find((code) => isBankLedgerChildAccountCode(code)) || '';
      }
      if (voucherType === 'PAYMENT_ORDER' || voucherType === 'BANK_DEBIT') {
        return details.map((d) => String(d.creditAccount || '').trim()).find((code) => isBankLedgerChildAccountCode(code)) || '';
      }
      return '';
    },
    [],
  );

  useEffect(() => {
     if (!isOpen) return;
     const persisted =
       Boolean(initialVoucher?.id) &&
       accountingVouchers.some((v) => String(v.id) === String(initialVoucher?.id));
     if (initialVoucher && persisted) {
        setFormData(initialVoucher);
        setLocalType(initialVoucher.voucherType);
        const matchedBankAccount = resolveBankAccountFromSnapshot(bankAccounts, {
          ...initialVoucher,
          bankLedgerAccountCode:
            initialVoucher.bankLedgerAccountCode ||
            inferVoucherBankLedgerCode(initialVoucher.voucherType, initialVoucher.details),
        });
        setSelectedBankAccountId(matchedBankAccount?.id || '');
     } else {
        const seedType = initialVoucher?.voucherType || type;
        setLocalType(seedType);

        // LOGIC GỢI Ý NGÀY THEO NIÊN ĐỘ
        const today = new Date().toISOString().split('T')[0];
        const defaultDate = (today >= financialYear.startDate && today <= financialYear.endDate) 
           ? today 
           : financialYear.startDate;
        const seedDate = initialVoucher?.date || defaultDate;
        const seedPostingDate = initialVoucher?.postingDate || seedDate;
        const seedDetails = initialVoucher?.details?.length
          ? initialVoucher.details
          : [{
              id: '1',
              description: '',
              account: '',
              debitAccount: seedType === 'BANK_CREDIT' ? defaultBankLedgerCode : '',
              creditAccount: seedType === 'PAYMENT_ORDER' || seedType === 'BANK_DEBIT' ? defaultBankLedgerCode : '',
              amount: 0,
            }];

        setFormData({
           ...initialVoucher,
           id: initialVoucher?.id || Date.now().toString(),
           voucherType: seedType,
           voucherNumber: previewDocumentNumber(getVoucherDocumentPrefix(seedType), seedDate),
           date: seedDate,
           postingDate: seedPostingDate,
           description: initialVoucher?.description || '',
           details: seedDetails,
           status: initialVoucher?.status || 'DRAFT',
           totalAmount: initialVoucher?.totalAmount ?? seedDetails.reduce((sum, detail) => sum + Number(detail.amount || 0), 0)
        });
        const matchedBankAccount = resolveBankAccountFromSnapshot(bankAccounts, {
          ...initialVoucher,
          bankLedgerAccountCode:
            initialVoucher?.bankLedgerAccountCode ||
            inferVoucherBankLedgerCode(seedType, seedDetails),
        });
        setSelectedBankAccountId(matchedBankAccount?.id || (!initialVoucher ? activeBankAccounts[0]?.id || '' : ''));
     }
  }, [isOpen, initialVoucher?.id, type, financialYear.startDate, financialYear.endDate]);

  useEffect(() => {
    setBankNoticeScenarioFilter('');
    setBankNoticeScenarioCode('');
  }, [localType]);

  useEffect(() => {
    if (!isOpen) setBankNoticeScenarioCode('');
  }, [isOpen]);

  useEffect(() => {
    const isBankVoucher =
      localType === 'PAYMENT_ORDER' ||
      localType === 'BANK_DEBIT' ||
      localType === 'BANK_CREDIT';
    if (!isBankVoucher) {
      setSelectedBankAccountId('');
      return;
    }
    if (!initialVoucher && !selectedBankAccountId && activeBankAccounts.length > 0) {
      setSelectedBankAccountId(activeBankAccounts[0].id);
      return;
    }
    if (selectedBankAccountId && !selectedBankAccount && activeBankAccounts.length > 0) {
      setSelectedBankAccountId(activeBankAccounts[0].id);
    }
  }, [activeBankAccounts, initialVoucher, localType, selectedBankAccount, selectedBankAccountId]);

  useEffect(() => {
    const isBankVoucher =
      localType === 'PAYMENT_ORDER' ||
      localType === 'BANK_DEBIT' ||
      localType === 'BANK_CREDIT';
    if (!isBankVoucher || !selectedBankAccount) return;
    setFormData((prev) => {
      const details = (prev.details || []).map((detail) => {
        if (localType === 'BANK_CREDIT') {
          const debitAccount = String(detail.debitAccount || '').trim();
          if (!debitAccount || debitAccount === '1121' || isBankLedgerChildAccountCode(debitAccount)) {
            return { ...detail, debitAccount: selectedBankAccount.linkedAccountCode };
          }
          return detail;
        }
        const creditAccount = String(detail.creditAccount || '').trim();
        if (!creditAccount || creditAccount === '1121' || isBankLedgerChildAccountCode(creditAccount)) {
          return { ...detail, creditAccount: selectedBankAccount.linkedAccountCode };
        }
        return detail;
      });
      return {
        ...prev,
        bankAccountId: selectedBankAccount.id,
        bankName: selectedBankAccount.bankName,
        bankAccountNumber: selectedBankAccount.accountNumber,
        bankAccountHolder: selectedBankAccount.accountHolder,
        bankBranch: selectedBankAccount.branch,
        bankLedgerAccountCode: selectedBankAccount.linkedAccountCode,
        details,
      };
    });
  }, [localType, selectedBankAccount]);

  useEffect(() => {
     if (!isOpen) return;
     if (initialVoucher && isPersistedInitialVoucher) return;
     const nextDate = formData.date || financialYear.startDate;
     const nextVoucherNumber = previewDocumentNumber(getVoucherDocumentPrefix(localType), nextDate);
     if (formData.voucherNumber === nextVoucherNumber) return;
     setFormData(prev => ({ ...prev, voucherType: localType, voucherNumber: nextVoucherNumber }));
  }, [financialYear.startDate, formData.date, formData.voucherNumber, initialVoucher, isOpen, isPersistedInitialVoucher, localType, previewDocumentNumber]);

  /** TK 1111/1112/1121/1122 lên đầu — Phiếu kế toán tổng hợp, Phiếu điều chỉnh, Ủy nhiệm chi (Nợ/Có đầy đủ) */
  const accountsOrderedCoreCashBankFirst = useMemo(() => {
    const coreSet = new Set<string>(CORE_CASH_BANK_ACCOUNT_CODES as readonly string[]);
    const core: AccountDefinition[] = [];
    for (const code of CORE_CASH_BANK_ACCOUNT_CODES) {
      const row = accounts.find((a) => a.code === code);
      if (row) core.push(row);
    }
    const rest = accounts.filter((a) => !coreSet.has(a.code));
    return [...core, ...rest];
  }, [accounts]);

  const isCoreCashBank = (code: string) =>
    (CORE_CASH_BANK_ACCOUNT_CODES as readonly string[]).includes(code);

  /** Ủy nhiệm chi: Có TK tiền — 1111, 1112, 1121, 1122, 112*, + 3338 (nộp thuế) */
  const accountsPaymentOrderCredit = useMemo(
    () =>
      accounts.filter(
        (a) => isCoreCashBank(a.code) || a.code.startsWith('112') || a.code === '3338',
      ),
    [accounts],
  );

  const purchaseServiceAccountCodeSet = useMemo(
    () => new Set(PURCHASE_SERVICE_DEBIT_ACCOUNT_CODES),
    [],
  );

  /** Giấy báo Nợ / Có: tiền gửi/tiền mặt (111*, 112*) + danh mục TT133 (bảng ảnh) cho TK đối ứng. */
  const accountsBankDebitCreditNotice = useMemo(() => {
    const coreSet = new Set<string>(CORE_CASH_BANK_ACCOUNT_CODES as readonly string[]);
    const core: AccountDefinition[] = [];
    for (const code of CORE_CASH_BANK_ACCOUNT_CODES) {
      const row = accounts.find((a) => a.code === code);
      if (row) core.push(row);
    }
    const rest = accounts.filter(
      (a) =>
        !coreSet.has(a.code) &&
        (a.code.startsWith('111') ||
          a.code.startsWith('112') ||
          purchaseServiceAccountCodeSet.has(a.code)),
    );
    rest.sort((a, b) => sortAccountCode(a.code, b.code));
    return [...core, ...rest];
  }, [accounts, purchaseServiceAccountCodeSet]);

  const bankNoticeScenariosFiltered = useMemo(() => {
    const list =
      localType === 'BANK_DEBIT'
        ? bankNoticeScenarios.debit
        : localType === 'BANK_CREDIT'
          ? bankNoticeScenarios.credit
          : [];
    const q = bankNoticeScenarioFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.debitAccount.includes(q) ||
        s.creditAccount.includes(q),
    );
  }, [localType, bankNoticeScenarioFilter, bankNoticeScenarios]);

  /** Phải gọi trước `if (!isOpen) return null` — không được đặt hook sau early return. */
  const voucherContactNameOptions = useMemo(
    () =>
      mergePartnerNameSuggestions(
        'contact',
        [...customers.map((c) => c.name), ...suppliers.map((s) => s.name)].filter(Boolean) as string[],
        partnerNameHistory,
      ),
    [customers, suppliers, partnerNameHistory],
  );

  const detailsForValidation = useMemo((): AccountingVoucherDetail[] => {
    const norm = (account?: string) => {
      const code = String(account || '').trim();
      if (code === '111') return '1111';
      if (code === '112') return '1121';
      return code;
    };
    const isBankVoucher =
      localType === 'PAYMENT_ORDER' ||
      localType === 'BANK_DEBIT' ||
      localType === 'BANK_CREDIT';
    const bankCode = selectedBankAccount?.linkedAccountCode;
    return (formData.details || []).map((d) => ({
      ...d,
      debitAccount:
        isBankVoucher && localType === 'BANK_CREDIT' && bankCode
          ? (() => {
              const normalized = norm(d.debitAccount);
              if (!normalized || normalized === '1121' || isBankLedgerChildAccountCode(normalized)) {
                return String(bankCode);
              }
              return normalized;
            })()
          : norm(d.debitAccount),
      creditAccount:
        isBankVoucher &&
        (localType === 'PAYMENT_ORDER' || localType === 'BANK_DEBIT') &&
        bankCode
          ? (() => {
              const normalized = norm(d.creditAccount);
              if (!normalized || normalized === '1121' || isBankLedgerChildAccountCode(normalized)) {
                return String(bankCode);
              }
              return normalized;
            })()
          : norm(d.creditAccount),
    }));
  }, [formData.details, localType, selectedBankAccount]);

  const voucherSaveBlockedReason = useMemo(() => {
    const isBankVoucher =
      localType === 'PAYMENT_ORDER' ||
      localType === 'BANK_DEBIT' ||
      localType === 'BANK_CREDIT';
    if (isBankVoucher && (!selectedBankAccount || selectedBankAccount.status !== 'ACTIVE')) {
      return 'Chọn ngân hàng đang hoạt động.';
    }
    const bal = validateVoucherBalanced(detailsForValidation);
    if (bal) return bal;
    const postingDate = String(formData.postingDate || formData.date || '').split('T')[0];
    return validateCashNotOverdraft({
      details: detailsForValidation,
      postingDate,
      journalEntries: allJournalEntriesAcrossYears,
      voucherId: String(formData.id || ''),
      voucherWasPosted: isPersistedInitialVoucher && initialVoucher?.status === 'POSTED',
    });
  }, [
    detailsForValidation,
    localType,
    selectedBankAccount,
    formData.postingDate,
    formData.date,
    formData.id,
    allJournalEntriesAcrossYears,
    isPersistedInitialVoucher,
    initialVoucher?.status,
  ]);

  const canSaveVoucher = voucherSaveBlockedReason === null;

  const uncQuickDebitActiveCode = useMemo(() => {
    if (localType !== 'PAYMENT_ORDER') return null;
    const quickCodes = UNC_QUICK_DEBIT_ACCOUNTS.map((a) => a.code);
    const debits = (formData.details || [])
      .map((d) => String(d.debitAccount || '').trim())
      .filter(Boolean);
    if (debits.length === 0) return null;
    const unique = new Set(debits);
    if (unique.size !== 1) return null;
    const only = debits[0];
    return quickCodes.includes(only) ? only : null;
  }, [formData.details, localType]);

  const partyDebtPairsUnc = useMemo(() => {
    if (localType !== 'PAYMENT_ORDER') return null;
    const contact = String(formData.contactName || '').trim();
    if (contact.length < 2) return null;
    const asOf = String(formData.postingDate || formData.date || '').split('T')[0];
    if (!asOf) return null;
    return buildPartyDebtPairs({
      kind: 'AP',
      partyName: contact,
      asOfDate: asOf,
      financialYear,
      entries: allJournalEntriesAcrossYears,
      invoices,
      customers,
      suppliers,
    });
  }, [
    localType,
    formData.contactName,
    formData.postingDate,
    formData.date,
    financialYear,
    allJournalEntriesAcrossYears,
    invoices,
    customers,
    suppliers,
  ]);

  const detailDebitListId =
    localType === 'BANK_DEBIT' || localType === 'BANK_CREDIT'
      ? 'accountListBankNotice'
      : localType === 'GENERAL' || localType === 'ADJUSTMENT' || localType === 'PAYMENT_ORDER'
        ? 'accountListOrderedCore'
        : 'accountListAll';

  const detailCreditListId =
    localType === 'PAYMENT_ORDER'
      ? 'accountListUncPayment'
      : localType === 'BANK_DEBIT' || localType === 'BANK_CREDIT'
        ? 'accountListBankNotice'
        : localType === 'GENERAL' || localType === 'ADJUSTMENT'
          ? 'accountListOrderedCore'
          : 'accountListAll';

  if (!isOpen) return null;

  const isDateInvalid = (dateStr: string | undefined) => {
     if (!dateStr) return false;
     return dateStr < financialYear.startDate || dateStr > financialYear.endDate;
  };

  const updateDetail = (id: string, field: keyof AccountingVoucherDetail, value: any) => {
     setFormData(prev => {
        const newDetails = prev.details?.map(d => d.id === id ? { ...d, [field]: value } : d) || [];
        const total = newDetails.reduce((sum, d) => sum + (d.amount || 0), 0);
        return { ...prev, details: newDetails, totalAmount: total };
     });
  };

  const addLine = () => {
     setFormData(prev => ({
        ...prev,
        details: [...(prev.details || []), { 
           id: Date.now().toString(), 
           description: prev.description || '', 
           account: '', 
           debitAccount: localType === 'BANK_CREDIT' ? selectedBankLedgerCode : '', 
           creditAccount: (localType === 'PAYMENT_ORDER' || localType === 'BANK_DEBIT') ? selectedBankLedgerCode : '', 
           amount: 0 
        }]
     }));
  };

  const applyQuickDebit = (debitAccount: string) => {
     setFormData((prev) => {
        const details = (prev.details || []).map((d) => ({
           ...d,
           debitAccount,
           creditAccount:
             localType === 'PAYMENT_ORDER' || localType === 'BANK_DEBIT'
               ? d.creditAccount || selectedBankLedgerCode
               : d.creditAccount,
        }));
        const total = details.reduce((sum, d) => sum + (d.amount || 0), 0);
        return { ...prev, details, totalAmount: total };
     });
  };

  const removeLine = (id: string) => {
     setFormData(prev => {
        const newDetails = prev.details?.filter(d => d.id !== id) || [];
        const total = newDetails.reduce((sum, d) => sum + (d.amount || 0), 0);
        return { ...prev, details: newDetails, totalAmount: total };
     });
  };

  const applyBankNoticeScenario = (scenarioCode: string) => {
    const list =
      localType === 'BANK_DEBIT' ? bankNoticeScenarios.debit : bankNoticeScenarios.credit;
    const s = list.find((x) => x.code === scenarioCode);
    if (!s || !formData.details?.length) return;
    setFormData((prev) => {
      const details = prev.details || [];
      if (!details.length) return prev;
      const newDetails = details.map((d, i) =>
        i === 0
          ? {
              ...d,
              debitAccount: localType === 'BANK_CREDIT' ? selectedBankLedgerCode : s.debitAccount,
              creditAccount:
                localType === 'BANK_DEBIT' ? selectedBankLedgerCode : s.creditAccount,
            }
          : d,
      );
      const total = newDetails.reduce((sum, d) => sum + (d.amount || 0), 0);
      return { ...prev, details: newDetails, totalAmount: total };
    });
  };

  const handleSave = (status: VoucherStatus) => {
     const isBankVoucher =
       localType === 'PAYMENT_ORDER' ||
       localType === 'BANK_DEBIT' ||
       localType === 'BANK_CREDIT';
     if (!formData.details?.length) {
        alert("Vui lòng nhập ít nhất 1 dòng định khoản.");
        return;
     }
     if (isBankVoucher && (!selectedBankAccount || selectedBankAccount.status !== 'ACTIVE')) {
        alert("Vui lòng chọn tài khoản ngân hàng đang sử dụng để hệ thống gắn đúng TK 1121xxx.");
        return;
     }

     if (isDateInvalid(formData.date) || isDateInvalid(formData.postingDate)) {
        const confirmForce = window.confirm("Ngày chứng từ nằm ngoài Năm tài chính đã chọn. Bạn vẫn muốn lưu?");
        if (!confirmForce) return;
     }

     rememberPartnerName('contact', formData.contactName || '');
     
     onSave({
        ...formData as AccountingVoucher,
        voucherType: localType,
        status: status,
        ...(isBankVoucher
          ? {
              bankAccountId: selectedBankAccount?.id,
              bankName: selectedBankAccount?.bankName,
              bankAccountNumber: selectedBankAccount?.accountNumber,
              bankAccountHolder: selectedBankAccount?.accountHolder,
              bankBranch: selectedBankAccount?.branch,
              bankLedgerAccountCode: selectedBankAccount?.linkedAccountCode,
            }
          : {}),
        createdBy: 'Admin',
        createdAt: new Date().toISOString()
     });
  };

  const getObjects = (objType: string | undefined) => {
     if (!objType) return [];
     if (objType === 'CUSTOMER') return customers.map(c => ({ id: c.id, name: c.name }));
     if (objType === 'SUPPLIER') return suppliers.map(s => ({ id: s.id, name: s.name }));
     if (objType === 'EMPLOYEE') return employees.map(e => ({ id: e.id, name: e.name }));
     if (objType === 'ASSET') return assets.map(a => ({ id: a.id, name: a.name }));
     return [];
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col animate-fade-in border border-slate-300">
         <div className="bg-indigo-700 p-4 text-white flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-white/20 rounded-lg">
                  <FileText className="w-6 h-6" />
               </div>
               <div>
                  <h3 className="font-bold text-lg leading-none">
                     {initialVoucher ? `Sửa chứng từ ${initialVoucher.voucherNumber}` : 'Tạo chứng từ mới'}
                  </h3>
                  <p className="mt-1 text-[10px] font-medium text-indigo-200">
                     Niên độ kế toán: {new Date(financialYear.startDate).getFullYear()}
                  </p>
               </div>
            </div>
            <button onClick={onClose} className="hover:bg-white/20 p-2 rounded-full transition-all"><X className="w-5 h-5" /></button>
         </div>

         <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar">
            {(isDateInvalid(formData.date) || isDateInvalid(formData.postingDate)) && (
               <div className="mb-6 bg-red-50 border border-red-200 p-3 rounded-lg flex items-center gap-3 text-red-700 animate-pulse">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <div className="text-xs">
                     <p className="font-bold">Cảnh báo phạm vi ngày!</p>
                     <p>Ngày nhập liệu không thuộc năm tài chính <span className="font-bold underline">{new Date(financialYear.startDate).getFullYear()}</span>.</p>
                  </div>
               </div>
            )}

            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 mb-6 grid grid-cols-4 gap-6">
               <div className="col-span-1 space-y-4">
                  <div>
                     <label className="mb-1 block text-[10px] font-semibold text-slate-500">Loại chứng từ</label>
                     <select 
                        className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={localType}
                        onChange={e => setLocalType(e.target.value as any)}
                        disabled={!!initialVoucher}
                     >
                        <option value="GENERAL">Phiếu kế toán tổng hợp</option>
                        <option value="ADJUSTMENT">Phiếu điều chỉnh</option>
                        <option value="PAYMENT_ORDER">Ủy nhiệm chi</option>
                        <option value="BANK_DEBIT">Giấy báo Nợ</option>
                        <option value="BANK_CREDIT">Giấy báo Có</option>
                     </select>
                  </div>
                  {(localType === 'BANK_DEBIT' || localType === 'BANK_CREDIT') && (
                     <div className="bg-indigo-50/90 p-3 rounded-lg border border-indigo-100">
                        <div className="mb-2 text-[10px] font-semibold text-indigo-900/90">
                           Loại nghiệp vụ (hạch toán tự động)
                        </div>
                        <input
                           type="search"
                           className="w-full mb-2 p-2 rounded-lg border border-indigo-100 text-xs bg-white placeholder:text-slate-400"
                           placeholder="Tìm theo tên hoặc mã TK..."
                           value={bankNoticeScenarioFilter}
                           onChange={(e) => setBankNoticeScenarioFilter(e.target.value)}
                        />
                        <select
                           className="w-full p-2 border border-indigo-100 rounded-lg bg-white text-xs font-semibold text-slate-800"
                           value={bankNoticeScenarioCode}
                           onChange={(e) => {
                              const v = e.target.value;
                              setBankNoticeScenarioCode(v);
                              if (v) applyBankNoticeScenario(v);
                           }}
                        >
                           <option value="">— Chọn nghiệp vụ (ghi vào dòng 1) —</option>
                           {bankNoticeScenariosFiltered.map((s) => (
                              <option key={s.code} value={s.code}>
                                 {s.label}
                              </option>
                           ))}
                        </select>
                        <p className="mt-1.5 text-[10px] text-indigo-700/80 leading-snug">
                           {localType === 'BANK_DEBIT'
                              ? 'Giấy báo Nợ: Nợ TK nghiệp vụ, Có tiền gửi theo tài khoản ngân hàng đã chọn.'
                              : 'Giấy báo Có: Nợ tiền gửi theo tài khoản ngân hàng đã chọn, Có TK nghiệp vụ.'}
                        </p>
                     </div>
                  )}
                  {(localType === 'PAYMENT_ORDER' || localType === 'BANK_DEBIT' || localType === 'BANK_CREDIT') && (
                     <div className="bg-blue-50/90 p-3 rounded-lg border border-blue-100">
                        <div className="mb-2 text-[10px] font-semibold text-blue-900/90">
                           Tài khoản ngân hàng liên kết
                        </div>
                        <select
                           className="w-full p-2 border border-blue-100 rounded-lg bg-white text-xs font-semibold text-slate-800"
                           value={selectedBankAccountId}
                           onChange={(e) => setSelectedBankAccountId(e.target.value)}
                        >
                           <option value="">-- Chọn tài khoản ngân hàng --</option>
                           {activeBankAccounts.map((bank) => (
                              <option key={bank.id} value={bank.id}>
                                 {bank.bankName} - {bank.accountNumber}
                              </option>
                           ))}
                        </select>
                        {localType !== 'PAYMENT_ORDER' && (
                           <p className="mt-1.5 text-[10px] text-blue-700/80 leading-snug">
                              {selectedBankAccount
                                 ? `Các dòng tiền sẽ tự dùng TK ${selectedBankAccount.linkedAccountCode}.`
                                 : 'Chọn tài khoản thực tế để hệ thống không hạch toán trực tiếp vào 1121 tổng hợp.'}
                           </p>
                        )}
                     </div>
                  )}
                  <div>
                     <label className="mb-1 block text-[10px] font-semibold text-slate-500">Số chứng từ</label>
                     <input 
                        className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-indigo-50/80 p-2 text-sm font-bold text-indigo-700"
                        value={formData.voucherNumber}
                        readOnly
                     />
                     {localType !== 'PAYMENT_ORDER' && (
                        <p className="mt-1 text-[10px] text-slate-400">
                           Tự sinh theo loại chứng từ, mã chi nhánh và tháng hạch toán.
                        </p>
                     )}
                  </div>
               </div>
               
               <div className="col-span-1 space-y-4">
                  <div>
                     <label className="mb-1 block text-[10px] font-semibold text-slate-500">Ngày chứng từ</label>
                     <input 
                        type="date" 
                        className={`w-full p-2 border rounded-lg text-sm font-bold outline-none transition-all ${isDateInvalid(formData.date) ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 focus:ring-2 focus:ring-indigo-500'}`} 
                        value={formData.date} 
                        onChange={e => setFormData({...formData, date: e.target.value})} 
                     />
                  </div>
                  <div>
                     <label className="mb-1 block text-[10px] font-semibold text-slate-500">Ngày hạch toán</label>
                     <input 
                        type="date" 
                        className={`w-full p-2 border rounded-lg text-sm font-bold outline-none transition-all ${isDateInvalid(formData.postingDate) ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 focus:ring-2 focus:ring-indigo-500'}`}
                        value={formData.postingDate} 
                        onChange={e => setFormData({...formData, postingDate: e.target.value})} 
                     />
                  </div>
               </div>

               <div className="col-span-2 space-y-4">
                  <div>
                     <label className="mb-1 block text-[10px] font-semibold text-slate-500">Đối tượng / Người nộp, nhận</label>
                     <input
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        list="voucherContactNameList"
                        value={formData.contactName}
                        onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                        onBlur={() => rememberPartnerName('contact', formData.contactName || '')}
                        placeholder="Gõ để gợi ý từ danh mục và tên đã nhập..."
                     />
                  </div>
                  <div>
                     <label className="mb-1 block text-[10px] font-semibold text-slate-500">Diễn giải chung</label>
                     <input className="w-full p-2 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Ví dụ: Thu tiền dịch vụ phần mềm tháng..." />
                  </div>
                  {localType === 'PAYMENT_ORDER' && (
                    <PartyDebtHintPanel data={partyDebtPairsUnc} accent="indigo" />
                  )}
               </div>

               {localType === 'PAYMENT_ORDER' && (
                  <div className="col-span-4 rounded-lg border border-slate-200/90 bg-gradient-to-r from-slate-50/95 to-white px-3 py-2.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                     <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Gợi ý nhanh (Ủy nhiệm chi) — Tài khoản Nợ
                     </p>
                     <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2">
                        {UNC_QUICK_DEBIT_ACCOUNTS.map(({ code, hint }) => (
                           <button
                              key={code}
                              type="button"
                              aria-pressed={uncQuickDebitActiveCode === code}
                              onClick={() => applyQuickDebit(code)}
                              title={hint}
                              className={`flex min-h-[2.75rem] w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border px-1.5 py-1 text-center transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-indigo-400/35 ${
                                 uncQuickDebitActiveCode === code
                                    ? 'border-emerald-300 bg-emerald-50 shadow-[0_1px_4px_rgba(5,150,105,0.12)] ring-1 ring-emerald-200/60'
                                    : 'border-slate-200/90 bg-white hover:border-emerald-200/80 hover:bg-emerald-50/40'
                              }`}
                           >
                              <span className="text-[8px] font-medium uppercase leading-none tracking-wide text-slate-400">
                                 TK Nợ
                              </span>
                              <span className="font-mono text-[11px] font-bold leading-none text-emerald-700 sm:text-xs">
                                 {code}
                              </span>
                           </button>
                        ))}
                     </div>
                  </div>
               )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
               <table className="w-full text-sm text-left">
                  <thead className="border-b bg-slate-100 text-[10px] font-semibold text-slate-600">
                     <tr>
                        <th className="p-3 w-10 text-center">#</th>
                        <th className="p-3">Diễn giải chi tiết</th>
                        <th className="p-3 w-28 text-center">TK Nợ</th>
                        <th className="p-3 w-28 text-center">TK Có</th>
                        <th className="p-3 w-36 text-right">Số tiền</th>
                        <th className="p-3 w-28 text-center">Đối tượng</th>
                        <th className="p-3 w-40">Chi tiết đối tượng</th>
                        <th className="p-3 w-10"></th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                     {formData.details?.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-slate-50/50">
                           <td className="p-2 text-center text-slate-400 font-mono text-xs">{idx + 1}</td>
                           <td className="p-2">
                              <input className="w-full p-1.5 border border-slate-100 rounded text-xs focus:border-indigo-300 outline-none" value={item.description} onChange={e => updateDetail(item.id, 'description', e.target.value)} />
                           </td>
                           <td className="p-2">
                              <input 
                                 className="w-full p-1.5 border border-slate-100 rounded text-xs font-mono font-bold text-emerald-600 text-center focus:border-emerald-300 outline-none" 
                                 value={item.debitAccount} 
                                 onChange={e => updateDetail(item.id, 'debitAccount', e.target.value)} 
                                 list={detailDebitListId}
                                 placeholder="---"
                              />
                           </td>
                           <td className="p-2">
                              <input 
                                 className="w-full p-1.5 border border-slate-100 rounded text-xs font-mono font-bold text-blue-600 text-center focus:border-blue-300 outline-none" 
                                 value={item.creditAccount} 
                                 onChange={e => updateDetail(item.id, 'creditAccount', e.target.value)}
                                 list={detailCreditListId}
                                 placeholder="---"
                              />
                           </td>
                           <td className="p-2">
                              <input 
                                 type="number"
                                 className="w-full rounded border border-slate-100 p-1.5 text-right text-xs font-semibold text-slate-700 outline-none focus:bg-white" 
                                 value={item.amount} 
                                 onChange={e => updateDetail(item.id, 'amount', Number(e.target.value))} 
                              />
                           </td>
                           <td className="p-2">
                              <select 
                                 className="w-full p-1.5 border border-slate-100 rounded text-[10px] font-bold bg-slate-50"
                                 value={item.objectType || ''}
                                 onChange={e => updateDetail(item.id, 'objectType', e.target.value)}
                              >
                                 <option value="">--</option>
                                 <option value="CUSTOMER">K.Hàng</option>
                                 <option value="SUPPLIER">N.C.C</option>
                                 <option value="EMPLOYEE">N.Viên</option>
                                 <option value="ASSET">Tài sản</option>
                              </select>
                           </td>
                           <td className="p-2">
                              {item.objectType && (
                                 <select 
                                    className="w-full p-1.5 border border-slate-100 rounded text-[10px] max-w-[150px]"
                                    value={item.objectId || ''}
                                    onChange={e => {
                                       updateDetail(item.id, 'objectId', e.target.value);
                                       const obj = getObjects(item.objectType).find(o => o.id === e.target.value);
                                       if(obj) updateDetail(item.id, 'objectName', obj.name);
                                    }}
                                 >
                                    <option value="">-- Chọn --</option>
                                    {getObjects(item.objectType).map(o => (
                                       <option key={o.id} value={o.id}>{o.name}</option>
                                    ))}
                                 </select>
                              )}
                           </td>
                           <td className="p-2 text-center">
                              <button onClick={() => removeLine(item.id)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                           </td>
                        </tr>
                     ))}
                  </tbody>
                  <tfoot>
                     <tr className="bg-slate-50/50">
                        <td colSpan={8} className="p-3 border-t">
                           <button onClick={addLine} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                              <Plus className="w-4 h-4" /> Thêm dòng nghiệp vụ
                           </button>
                        </td>
                     </tr>
                  </tfoot>
               </table>
            </div>
            
            <div className="flex justify-end mt-6 gap-3 items-end">
               <span className="mb-1.5 text-xs font-semibold text-slate-500">Tổng cộng chứng từ:</span>
               <span className="text-3xl font-bold text-indigo-700 tabular-nums">{formatCurrency(formData.totalAmount || 0)}</span>
            </div>
         </div>

         <div
            className={`p-4 bg-white border-t flex items-center shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] ${
               localType === 'PAYMENT_ORDER' ? 'justify-end' : 'justify-between'
            }`}
         >
            {localType !== 'PAYMENT_ORDER' && (
               <div className="text-[10px] text-slate-400 font-medium italic">
                  * Lưu ý: Mọi thay đổi sẽ được ghi trực tiếp vào Nhật ký chung sau khi nhấn &quot;Lưu và Ghi sổ&quot;.
               </div>
            )}
            <div className="flex gap-3">
               <button onClick={onClose} className="px-6 py-2 bg-white border border-slate-300 text-slate-600 font-bold rounded-lg shadow-sm hover:bg-slate-50 transition-all">Đóng</button>
               <button
                  type="button"
                  disabled={!canSaveVoucher}
                  onClick={() => handleSave('DRAFT')}
                  title={voucherSaveBlockedReason || undefined}
                  className={`px-6 py-2 font-bold rounded-lg shadow-md flex items-center gap-2 transition-all ${
                    canSaveVoucher
                      ? 'bg-slate-500 text-white hover:bg-slate-600'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-60'
                  }`}
               >
                  <Save className="w-4 h-4" /> Lưu nháp
               </button>
               <button
                  type="button"
                  disabled={!canSaveVoucher}
                  onClick={() => handleSave('POSTED')}
                  title={voucherSaveBlockedReason || undefined}
                  className={`flex transform items-center gap-2 rounded-lg px-8 py-2 font-bold shadow-lg transition-all ${
                    canSaveVoucher
                      ? 'bg-indigo-600 text-white shadow-indigo-200 hover:bg-indigo-700 active:scale-95'
                      : 'bg-indigo-300 text-indigo-100 cursor-not-allowed opacity-60 shadow-none'
                  }`}
               >
                  <CheckCircle2 className="w-5 h-5" /> Lưu và Ghi sổ
               </button>
            </div>
         </div>
      </div>

      {/* Toàn bộ danh mục */}
      <datalist id="accountListAll">
         {accounts.map(acc => (
            <option key={acc.code} value={acc.code}>{acc.name}</option>
         ))}
      </datalist>

      {/* 1111, 1112, 1121, 1122 đứng đầu — Phiếu kế toán tổng hợp / Điều chỉnh / UNC (đủ TK Nợ) */}
      <datalist id="accountListOrderedCore">
         {accountsOrderedCoreCashBankFirst.map(acc => (
            <option key={acc.code} value={acc.code}>{acc.name}</option>
         ))}
      </datalist>

      {/* Ủy nhiệm chi — Có: 1111, 1112, 1121, 1122, 112*, 3338 */}
      <datalist id="accountListUncPayment">
         {accountsPaymentOrderCredit.map(acc => (
            <option key={acc.code} value={acc.code}>{acc.name}</option>
         ))}
      </datalist>

      {/* Giấy báo Nợ / Có — TK tiền & tiền gửi (111*, 112* + 4 TK chi tiết) */}
      <datalist id="accountListBankNotice">
         {accountsBankDebitCreditNotice.map(acc => (
            <option key={acc.code} value={acc.code}>{acc.name}</option>
         ))}
      </datalist>

      <datalist id="voucherContactNameList">
         {voucherContactNameOptions.map((name) => (
            <option key={name} value={name} />
         ))}
      </datalist>
    </div>
  );
};
