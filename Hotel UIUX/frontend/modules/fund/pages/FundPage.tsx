
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ArrowUpCircle,
  Search,
  Filter,
  Eye,
  Trash2,
  Calendar,
  ChevronDown,
  Landmark,
  Pencil,
  Power,
  Plus,
  Building2,
  CreditCard,
  Link2,
} from 'lucide-react';
import { useApp } from '../../../app/store';
import { SESSION_OPEN_FUND_ID } from '@shared/utils/arApReportNavigate';
import { FundStats } from '../components/FundStats';
import { FundDetailModal } from '../components/FundDetailModal';
import { DeleteFundModal } from '../components/DeleteFundModal';
import { BankAccount, FundTransaction } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { Pagination } from '@shared/components/Pagination';
import { BankAccountModal } from '../components/BankAccountModal';

type TimeFilterType = 'ALL' | 'TODAY' | 'MONTH' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'YEAR' | 'CUSTOM';
type StandardPageSize = 10 | 20 | 50 | 100;

const TIME_FILTER_OPTIONS: { id: TimeFilterType; label: string }[] = [
  { id: 'ALL', label: 'Tất cả niên độ' },
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

export const FundPage: React.FC = () => {
  const {
    fundTransactions,
    journalEntries,
    setModals,
    handleDeleteFundTransaction,
    handleDeleteBankAccount,
    handleToggleBankAccountStatus,
    financialYear,
    bankAccounts,
  } = useApp();
  
  // States cho tìm kiếm và lọc
  const [filterType, setFilterType] = useState<'ALL' | 'CASH' | 'BANK'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilterType>('ALL');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [bankAccountFilter, setBankAccountFilter] = useState('ALL');
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
  const baseStorageKey = 'fund_pagination';
  const filterSignature = useMemo(() => {
    return JSON.stringify({
      filterType,
      q: (searchTerm || '').trim().toLowerCase(),
      timeFilter,
      bankAccountFilter,
      from: customRange.from || '',
      to: customRange.to || '',
      fyStart: financialYear.startDate,
      fyEnd: financialYear.endDate,
    });
  }, [bankAccountFilter, customRange.from, customRange.to, financialYear.endDate, financialYear.startDate, filterType, searchTerm, timeFilter]);
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
  
  // Local state for view/delete modals
  const [viewTransaction, setViewTransaction] = useState<FundTransaction | null>(null);
  const [deleteTransaction, setDeleteTransaction] = useState<FundTransaction | null>(null);
  const [showBankAccountModal, setShowBankAccountModal] = useState(false);
  const [editingBankAccount, setEditingBankAccount] = useState<BankAccount | null>(null);

  useEffect(() => {
    try {
      const id = sessionStorage.getItem(SESSION_OPEN_FUND_ID);
      if (!id) return;
      const t = fundTransactions.find(x => String(x.id) === id);
      if (!t) return;
      sessionStorage.removeItem(SESSION_OPEN_FUND_ID);
      setViewTransaction(t);
    } catch {
      // ignore
    }
  }, [fundTransactions]);

  useEffect(() => {
    if (bankAccountFilter === 'ALL') return;
    if (bankAccounts.some((bank) => bank.id === bankAccountFilter)) return;
    setBankAccountFilter('ALL');
  }, [bankAccountFilter, bankAccounts]);

  // --- LOGIC LỌC DỮ LIỆU THEO NIÊN ĐỘ ---
  const filteredTransactions = useMemo(() => {
    const t0 = performance.now();
    const normalizedSearch = searchTerm.toLowerCase();
    const rows = fundTransactions.filter(t => {
      // 1. Ràng buộc cứng theo Năm tài chính
      if (t.date < financialYear.startDate || t.date > financialYear.endDate) return false;

      // 2. Lọc theo loại (Tiền mặt/Ngân hàng)
      if (filterType !== 'ALL' && t.method !== filterType) return false;

      if (bankAccountFilter !== 'ALL' && t.bankAccountId !== bankAccountFilter) return false;

      // 3. Lọc theo từ khóa
      const matchesSearch = 
        t.description.toLowerCase().includes(normalizedSearch) ||
        t.payerReceiver.toLowerCase().includes(normalizedSearch) ||
        (t.voucherNumber || '').toLowerCase().includes(normalizedSearch) ||
        (t.referenceDoc || '').toLowerCase().includes(normalizedSearch) ||
        (t.bankName || '').toLowerCase().includes(normalizedSearch) ||
        (t.bankAccountNumber || '').toLowerCase().includes(normalizedSearch) ||
        (t.bankLedgerAccountCode || '').toLowerCase().includes(normalizedSearch);

      if (!matchesSearch) return false;

      // 4. Lọc theo thời gian chi tiết
      if (timeFilter === 'ALL') return true;

      const trxDate = new Date(t.date);
      const now = new Date();
      const currentYear = new Date(financialYear.startDate).getFullYear();

      switch (timeFilter) {
        case 'TODAY':
          return t.date.split('T')[0] === now.toISOString().split('T')[0];
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
          return t.date >= (customRange.from || '0000') && t.date <= (customRange.to || '9999');
        default:
          return true;
      }
    });
    const sorted = rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const ms = performance.now() - t0;
    logSlowQuery('FundPage.filter(fundTransactions)', ms, { rows: sorted.length });
    return sorted;
  }, [bankAccountFilter, fundTransactions, filterType, searchTerm, timeFilter, customRange, financialYear]);

  const activeBankAccounts = useMemo(
    () => bankAccounts.filter((bank) => bank.status === 'ACTIVE'),
    [bankAccounts],
  );

  const bankBalanceByLedgerCode = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of journalEntries) {
      for (const detail of entry.details || []) {
        const code = String(detail.account || '').trim();
        if (!code) continue;
        map.set(code, (map.get(code) || 0) + Number(detail.debit || 0) - Number(detail.credit || 0));
      }
    }
    return map;
  }, [journalEntries]);

  const bankTransactionUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const transaction of fundTransactions) {
      if (!transaction.bankAccountId) continue;
      map.set(transaction.bankAccountId, (map.get(transaction.bankAccountId) || 0) + 1);
    }
    return map;
  }, [fundTransactions]);

  const bankAccountSummaries = useMemo(
    () =>
      bankAccounts.map((bank) => {
        const balance = bankBalanceByLedgerCode.get(bank.linkedAccountCode) || 0;
        const transactionCount = bankTransactionUsage.get(bank.id) || 0;
        const hasLedgerActivity = journalEntries.some((entry) =>
          (entry.details || []).some((detail) => String(detail.account || '').trim() === bank.linkedAccountCode),
        );
        return {
          ...bank,
          balance,
          transactionCount,
          deleteBlocked: transactionCount > 0 || hasLedgerActivity,
        };
      }),
    [bankAccounts, bankBalanceByLedgerCode, bankTransactionUsage, journalEntries],
  );

  const groupedBankSummaries = useMemo(() => {
    const grouped = new Map<string, { bankName: string; count: number; balance: number }>();
    for (const bank of bankAccountSummaries) {
      const key = bank.bankName.trim().toLowerCase();
      const prev = grouped.get(key) || { bankName: bank.bankName, count: 0, balance: 0 };
      grouped.set(key, {
        bankName: prev.bankName,
        count: prev.count + 1,
        balance: prev.balance + bank.balance,
      });
    }
    return Array.from(grouped.values()).sort((a, b) => a.bankName.localeCompare(b.bankName, 'vi'));
  }, [bankAccountSummaries]);

  const totalItems = filteredTransactions.length;
  const safePageSize = clampPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, totalPages]);

  const pagedTransactions = useMemo(() => {
    const size = Math.min(100, safePageSize);
    const from = (safePage - 1) * size;
    const to = from + size;
    return filteredTransactions.slice(from, to);
  }, [filteredTransactions, safePage, safePageSize]);

  // --- TÍNH TOÁN BIẾN ĐỘNG THỰC TẾ ---
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const getMetrics = (method: 'CASH' | 'BANK', month: number, year: number) => {
      const filtered = fundTransactions.filter(t => {
        const d = new Date(t.date);
        return t.method === method && d.getMonth() === month && d.getFullYear() === year;
      });
      return {
        receipt: filtered.filter(t => t.type === 'RECEIPT').reduce((s, t) => s + t.amount, 0),
        payment: filtered.filter(t => t.type === 'PAYMENT').reduce((s, t) => s + t.amount, 0)
      };
    };

    const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
    const prevMonth = prevMonthDate.getMonth();
    const prevYear = prevMonthDate.getFullYear();

    const cashNow = getMetrics('CASH', currentMonth, currentYear);
    const cashPrev = getMetrics('CASH', prevMonth, prevYear);
    const bankNow = getMetrics('BANK', currentMonth, currentYear);
    const bankPrev = getMetrics('BANK', prevMonth, prevYear);

    const calcChange = (now: number, prev: number) => {
      if (prev === 0) return now > 0 ? 100 : 0;
      return ((now - prev) / prev) * 100;
    };

    return {
      cashTrend: {
        receipt: calcChange(cashNow.receipt, cashPrev.receipt),
        payment: calcChange(cashNow.payment, cashPrev.payment)
      },
      bankTrend: {
        receipt: calcChange(bankNow.receipt, bankPrev.receipt),
        payment: calcChange(bankNow.payment, bankPrev.payment)
      }
    };
  }, [fundTransactions]);

  // --- TÍNH SỐ DƯ HIỆN TẠI (Lọc theo Niên độ) ---
  // IMPORTANT: Opening balances are stored in Journal Entries (OPENING) when user enters "Số dư đầu kỳ TK".
  // Therefore balances must be computed from `journalEntries` (111/112), not only from `fundTransactions`.
  const { cashBalance, bankBalance } = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const asOf = today < financialYear.startDate ? financialYear.startDate : (today > financialYear.endDate ? financialYear.endDate : today);

    const sumAccount = (prefix: string) => {
      return journalEntries
        .filter(e => e.date <= asOf)
        .reduce((acc, e) => {
          return acc + e.details.reduce((s, d) => {
            const accCode = String(d.account || '');
            if (!accCode.startsWith(prefix)) return s;
            return s + (Number(d.debit || 0) - Number(d.credit || 0));
          }, 0);
        }, 0);
    };

    const cash = sumAccount('111');
    const bank = sumAccount('1121');
    return { cashBalance: cash, bankBalance: bank };
  }, [journalEntries, financialYear.startDate, financialYear.endDate]);

  const linkedBankBalanceTotal = useMemo(
    () => bankAccountSummaries.reduce((sum, bank) => sum + bank.balance, 0),
    [bankAccountSummaries],
  );

  const unassignedBankBalance = bankBalance - linkedBankBalanceTotal;

  const handleConfirmDelete = (id: string) => {
    handleDeleteFundTransaction(id);
    setDeleteTransaction(null);
  };

  const handleEditBankAccount = (bank: BankAccount) => {
    setEditingBankAccount(bank);
    setShowBankAccountModal(true);
  };

  const handleDeleteBankAccountClick = (bank: BankAccount & { deleteBlocked?: boolean }) => {
    if (bank.deleteBlocked) {
      window.alert('Không thể xóa tài khoản ngân hàng đã phát sinh giao dịch.');
      return;
    }
    if (!window.confirm(`Xóa tài khoản ${bank.bankName} - ${bank.accountNumber}?`)) return;
    const result = handleDeleteBankAccount(bank.id);
    if (!result.ok) window.alert(result.error || 'Không thể xóa tài khoản ngân hàng.');
  };

  const fiscalYearLabel = new Date(financialYear.startDate).getFullYear();

  return (
    <div className="space-y-4">
      {/* Thông báo niên độ */}
      <div className="flex items-center justify-between rounded-xl border border-indigo-100/90 bg-indigo-50/90 px-3 py-1.5 shadow-[0_1px_2px_rgba(79,70,229,0.08)]">
          <div className="flex items-center gap-2 text-indigo-700">
             <Calendar className="w-4 h-4" />
             <span className="text-xs font-semibold tracking-tight">Đang hạch toán niên độ: <span className="text-indigo-900 font-bold">{fiscalYearLabel}</span></span>
          </div>
          <div className="text-[10px] text-indigo-400 font-medium italic">
             Mọi giao dịch sẽ được ghi sổ vào năm {fiscalYearLabel}
          </div>
      </div>

      <FundStats 
        cashBalance={cashBalance} 
        bankBalance={bankBalance} 
        cashTrend={stats.cashTrend}
        bankTrend={stats.bankTrend}
      />

      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2.5">
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold tracking-tight text-slate-700">
              <Landmark className="h-4 w-4 shrink-0 text-sky-600" />
              Danh mục tài khoản ngân hàng
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingBankAccount(null);
              setShowBankAccountModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(37,99,235,0.25)] transition-colors hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm tài khoản ngân hàng
          </button>
        </div>

        <div className="space-y-3 p-3 sm:p-3.5">
          <div className="-mx-0.5 flex flex-nowrap gap-3 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
            {/* Card 1 */}
            <div className="flex h-[104px] w-[260px] shrink-0 flex-row overflow-hidden rounded-lg border border-slate-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] border-l-[3px] border-l-slate-400">
              <div className="flex min-w-0 flex-1 flex-row items-center gap-2.5 px-2.5 py-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600 ring-1 ring-slate-100">
                  <CreditCard className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tài khoản ngân hàng</p>
                  <p className="truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">
                    {bankAccountSummaries.length}
                  </p>
                  <p className="truncate text-[10px] text-slate-500">Đang sử dụng: {activeBankAccounts.length}</p>
                </div>
              </div>
            </div>
            {/* Card 2 */}
            <div className="flex h-[104px] w-[260px] shrink-0 flex-row overflow-hidden rounded-lg border border-slate-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] border-l-[3px] border-l-emerald-500">
              <div className="flex min-w-0 flex-1 flex-row items-center gap-2.5 px-2.5 py-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100/80">
                  <Landmark className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">1121 tổng hợp</p>
                  <p className="truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">
                    {formatCurrency(bankBalance)}
                  </p>
                  <p className="truncate text-[10px] text-slate-500">Số dư TK tổng hợp</p>
                </div>
              </div>
            </div>
            {/* Card 3 */}
            <div className="flex h-[104px] w-[260px] shrink-0 flex-row overflow-hidden rounded-lg border border-slate-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] border-l-[3px] border-l-sky-500">
              <div className="flex min-w-0 flex-1 flex-row items-center gap-2.5 px-2.5 py-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700 ring-1 ring-sky-100/80">
                  <Link2 className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">Chi tiết đã gắn TK</p>
                  <p className="truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">
                    {formatCurrency(linkedBankBalanceTotal)}
                  </p>
                  <p className="truncate text-[10px] text-slate-500">Theo TK con 1121xxx</p>
                </div>
              </div>
            </div>
            {groupedBankSummaries.map((group) => (
              <div
                key={group.bankName}
                className="flex h-[104px] w-[260px] shrink-0 flex-row overflow-hidden rounded-lg border border-slate-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] border-l-[3px] border-l-indigo-500"
              >
                <div className="flex min-w-0 flex-1 flex-row items-center gap-2.5 px-2.5 py-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100/80">
                    <Building2 className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500" title={group.bankName}>
                      {group.bankName}
                    </p>
                    <p className="truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">
                      {formatCurrency(group.balance)}
                    </p>
                    <p className="truncate text-[10px] text-slate-500">{group.count} TK đang theo dõi</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {Math.abs(unassignedBankBalance) > 0.5 && (
            <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-3 text-[13px] leading-snug text-amber-950 shadow-[0_1px_2px_rgba(180,83,9,0.08)] border-l-[3px] border-l-amber-400">
              Hiện còn <strong>{formatCurrency(unassignedBankBalance)}</strong> đang nằm trên 1121 nhưng chưa gắn vào tài khoản ngân hàng
              chi tiết. Đây thường là dữ liệu cũ trước khi thiết kế danh mục ngân hàng.
            </div>
          )}

          {bankAccountSummaries.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="p-3 text-left">Ngân hàng</th>
                    <th className="p-3 text-left">Số tài khoản</th>
                    <th className="p-3 text-left">Chủ tài khoản</th>
                    <th className="p-3 text-left">Chi nhánh</th>
                    <th className="p-3 text-left">TK kế toán liên kết</th>
                    <th className="p-3 text-right">Số dư</th>
                    <th className="p-3 text-center">Trạng thái</th>
                    <th className="p-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bankAccountSummaries.map((bank) => (
                    <tr key={bank.id} className="hover:bg-slate-50">
                      <td className="p-3">
                        <div className="font-semibold text-slate-800">{bank.bankName}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">{bank.transactionCount} giao dịch quỹ đã gắn</div>
                      </td>
                      <td className="p-3 font-mono text-xs text-blue-700">{bank.accountNumber}</td>
                      <td className="p-3 text-slate-700">{bank.accountHolder}</td>
                      <td className="p-3 text-slate-500">{bank.branch || '---'}</td>
                      <td className="p-3">
                        <div className="font-mono text-xs font-bold text-slate-800">{bank.linkedAccountCode}</div>
                      </td>
                      <td className="p-3 text-right font-semibold tabular-nums text-slate-800">{formatCurrency(bank.balance)}</td>
                      <td className="p-3 text-center">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${
                            bank.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {bank.status === 'ACTIVE' ? 'Đang dùng' : 'Ngừng dùng'}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditBankAccount(bank)}
                            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                            title="Sửa"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleBankAccountStatus(bank.id)}
                            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                            title={bank.status === 'ACTIVE' ? 'Ngừng sử dụng' : 'Mở lại sử dụng'}
                          >
                            <Power className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteBankAccountClick(bank)}
                            disabled={bank.deleteBlocked}
                            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                            title={bank.deleteBlocked ? 'Đã phát sinh giao dịch, không thể xóa' : 'Xóa'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b flex flex-wrap justify-between items-center bg-slate-50 gap-4">
           <div className="flex gap-4 items-center">
              <h3 className="font-semibold text-slate-700 tracking-tight">Giao dịch quỹ & ngân hàng</h3>
              <div className="flex bg-slate-200/70 p-1 rounded-lg">
                <button 
                  onClick={() => setFilterType('ALL')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${filterType === 'ALL' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Tất cả
                </button>
                <button 
                  onClick={() => setFilterType('CASH')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${filterType === 'CASH' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Tiền mặt
                </button>
                <button 
                  onClick={() => setFilterType('BANK')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${filterType === 'BANK' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Ngân hàng
                </button>
              </div>
           </div>

           <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input 
                  placeholder="Tìm nội dung, đối tượng..." 
                  className="pl-9 p-2 border rounded-lg text-sm w-64 focus:ring-2 focus:ring-blue-500 outline-none bg-white shadow-sm" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button 
                onClick={() => setModals(m => ({ ...m, showFundTransaction: true }))}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 shadow-md transition-all active:scale-95"
              >
                 <ArrowUpCircle className="w-4 h-4" /> Lập phiếu thu / chi
              </button>
           </div>
        </div>

        <div className="p-3 bg-white border-b flex flex-wrap items-center gap-4">
           <div className="flex items-center gap-2 text-slate-500 mr-2 border-r pr-4 border-slate-200">
              <Filter className="w-4 h-4" />
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
                  {TIME_FILTER_OPTIONS.find((o) => o.id === timeFilter)?.label ?? 'Tất cả niên độ'}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${timeMenuOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
              {timeMenuOpen ? (
                <ul
                  className="absolute left-0 top-full z-30 mt-1 max-h-64 min-w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                  role="listbox"
                >
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
                          timeFilter === opt.id
                            ? 'bg-blue-50 font-medium text-blue-800'
                            : 'text-slate-700 hover:bg-slate-50'
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
                      className="pl-8 p-1.5 border rounded-lg text-xs font-medium text-slate-600 outline-none focus:ring-1 focus:ring-blue-400"
                      value={customRange.from}
                      onChange={e => setCustomRange({...customRange, from: e.target.value})}
                    />
                 </div>
                 <span className="text-slate-300 font-medium">→</span>
                 <div className="relative">
                    <Calendar className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input 
                      type="date" 
                      className="pl-8 p-1.5 border rounded-lg text-xs font-medium text-slate-600 outline-none focus:ring-1 focus:ring-blue-400"
                      value={customRange.to}
                      onChange={e => setCustomRange({...customRange, to: e.target.value})}
                    />
                 </div>
              </div>
           )}

           <div className="flex items-center gap-2">
              <span className="text-xs font-medium tracking-tight text-slate-500">Tài khoản NH</span>
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:ring-1 focus:ring-blue-400"
                value={bankAccountFilter}
                onChange={(e) => setBankAccountFilter(e.target.value)}
              >
                <option value="ALL">Tất cả tài khoản ngân hàng</option>
                {bankAccounts.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.bankName} - {bank.accountNumber}
                  </option>
                ))}
              </select>
           </div>
           
           <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Đã lọc:</span>
              <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{filteredTransactions.length} giao dịch</span>
           </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse table-fixed">
            <thead className="border-b bg-slate-50 text-[11px] font-semibold tracking-tight text-slate-600">
              <tr>
                <th className="p-4 text-center w-[120px]">Ngày chứng từ</th>
                <th className="p-4 text-center w-[180px]">Số phiếu</th>
                <th className="p-4 text-center w-[100px]">Loại</th>
                <th className="p-4 text-center w-[180px]">Hình thức / TK NH</th>
                <th className="p-4 text-center w-[220px]">Đối tượng / hạng mục</th>
                <th className="p-4 text-center min-w-[200px]">Nội dung diễn giải</th>
                <th className="p-4 text-center w-[160px]">Số tiền</th>
                <th className="p-4 text-center w-[100px]">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedTransactions.map((trx) => (
                <tr
                  key={trx.id}
                  className="hover:bg-blue-50/30 transition-colors group cursor-pointer"
                  onClick={() => setViewTransaction(trx)}
                  title="Click để xem chi tiết"
                >
                  <td className="p-4 text-center">
                    <div className="font-semibold text-slate-700 whitespace-nowrap">{new Date(trx.date).toLocaleDateString('vi-VN')}</div>
                  </td>
                  <td className="p-4 text-center">
                    <div className="font-mono text-xs font-semibold text-blue-700 whitespace-nowrap">{trx.voucherNumber || trx.referenceDoc || trx.id.split('-').pop()}</div>
                  </td>
                  <td className="p-4 text-center">
                    <span className={`mx-auto inline-flex w-full max-w-[60px] items-center justify-center rounded-full border px-2 py-1 text-[10px] font-medium tracking-tight shadow-sm ${trx.type === 'RECEIPT' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                      {trx.type === 'RECEIPT' ? 'Thu' : 'Chi'}
                    </span>
                  </td>
                  <td className="p-4 text-center">
                    <div className="space-y-1">
                      <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium tracking-tight text-slate-600">
                         {trx.method === 'CASH' ? 'Tiền mặt' : 'Ngân hàng'}
                      </span>
                      {trx.method === 'BANK' && (
                        <div className="mx-auto max-w-[160px] truncate text-[10px] font-medium text-slate-500">
                          {trx.bankName ? `${trx.bankName} · ${trx.bankAccountNumber || '---'}` : (trx.bankLedgerAccountCode || 'Chưa gắn TK NH')}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-center">
                     <div className="truncate mx-auto max-w-[200px] text-xs font-semibold text-slate-800">{trx.payerReceiver}</div>
                     <div className="text-[10px] text-slate-400 font-medium truncate mt-0.5 max-w-[200px] mx-auto">{trx.category}</div>
                  </td>
                  <td className="p-4 text-center">
                    <div className="text-slate-600 text-xs font-medium italic truncate max-w-[300px] mx-auto" title={trx.description}>
                      {trx.description}
                    </div>
                  </td>
                  <td className={`p-4 text-center text-sm font-semibold tabular-nums ${trx.type === 'RECEIPT' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(trx.amount)}
                  </td>
                  <td className="p-4 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <button 
                          onClick={() => setViewTransaction(trx)}
                          className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-md transition-all" 
                          title="Xem chi tiết"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setDeleteTransaction(trx)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-100 rounded-md transition-all" 
                          title="Xóa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-20 text-center text-slate-400 font-medium italic">
                    Không có giao dịch nào trong niên độ {fiscalYearLabel}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={safePage}
          totalItems={totalItems}
          pageSize={safePageSize}
          onChangePage={setPage}
          onChangePageSize={(s) => setPageSize(clampPageSize(s))}
        />
        
        <div className="flex items-center justify-between border-t bg-slate-50 p-3 px-6 text-xs font-medium tracking-tight text-slate-500">
           <div>Tổng số phiếu: <span className="font-semibold text-slate-700">{filteredTransactions.length}</span></div>
           <div className="flex gap-6">
              <span>Tổng thu: <span className="font-semibold text-emerald-600">{formatCurrency(filteredTransactions.filter(t => t.type === 'RECEIPT').reduce((s, t) => s + t.amount, 0))}</span></span>
              <span>Tổng chi: <span className="font-semibold text-red-600">{formatCurrency(filteredTransactions.filter(t => t.type === 'PAYMENT').reduce((s, t) => s + t.amount, 0))}</span></span>
           </div>
        </div>
      </div>

      <BankAccountModal
        isOpen={showBankAccountModal}
        item={editingBankAccount}
        onClose={() => {
          setShowBankAccountModal(false);
          setEditingBankAccount(null);
        }}
      />
      <FundDetailModal transaction={viewTransaction} onClose={() => setViewTransaction(null)} />
      <DeleteFundModal transaction={deleteTransaction} onClose={() => setDeleteTransaction(null)} onConfirm={handleConfirmDelete} />
    </div>
  );
};
