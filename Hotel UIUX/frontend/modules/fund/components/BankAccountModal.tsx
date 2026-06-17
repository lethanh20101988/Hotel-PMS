import React, { useEffect, useMemo, useState } from 'react';
import { Info, Landmark, Link2, X } from 'lucide-react';
import { BankAccount } from '@shared/types';
import { isBankLedgerChildAccountCode } from '@shared/utils/bankAccountPayments';
import { useApp } from '../../../app/store';

interface BankAccountModalProps {
  isOpen: boolean;
  item?: BankAccount | null;
  onClose: () => void;
}

/** Gợi ý mã số tiếp theo (112102…); mã có chữ (112101MB) không dùng để tính max. */
function suggestNext1121ChildCode(
  accounts: { code?: string }[],
  bankAccounts: BankAccount[],
  excludeBankId?: string,
): string {
  const used = new Set<string>();
  for (const b of bankAccounts) {
    if (excludeBankId && b.id === excludeBankId) continue;
    const c = String(b.linkedAccountCode || '').trim();
    if (isBankLedgerChildAccountCode(c)) used.add(c);
  }
  for (const a of accounts) {
    const c = String(a.code || '').trim();
    if (isBankLedgerChildAccountCode(c)) used.add(c);
  }
  let maxNum = 112100;
  for (const c of used) {
    if (/^1121\d+$/.test(c)) {
      const n = parseInt(c, 10);
      if (!Number.isNaN(n)) maxNum = Math.max(maxNum, n);
    }
  }
  let candidate = maxNum + 1;
  while (used.has(String(candidate)) && candidate < 999999999) {
    candidate += 1;
  }
  return String(candidate);
}

const inputClass =
  'h-8 w-full rounded border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 placeholder:font-normal focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20';
const labelClass = 'mb-0.5 block text-[12px] font-medium text-slate-600';

export const BankAccountModal: React.FC<BankAccountModalProps> = ({ isOpen, item, onClose }) => {
  const { accounts, bankAccounts, handleSaveBankAccount } = useApp();

  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [linkMode, setLinkMode] = useState<'EXISTING' | 'NEW'>('EXISTING');
  const [existingLinkedAccountCode, setExistingLinkedAccountCode] = useState('');
  const [newLinkedAccountCode, setNewLinkedAccountCode] = useState('');

  const usedLinkedCodes = useMemo(
    () =>
      new Set(
        bankAccounts
          .filter((bank) => bank.id !== item?.id)
          .map((bank) => String(bank.linkedAccountCode || '').trim())
          .filter(Boolean),
      ),
    [bankAccounts, item?.id],
  );

  const eligibleLinkedAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        const code = String(account.code || '').trim();
        if (!code.startsWith('1121') || code === '1121') return false;
        if (code === String(item?.linkedAccountCode || '').trim()) return true;
        return !usedLinkedCodes.has(code);
      }),
    [accounts, item?.linkedAccountCode, usedLinkedCodes],
  );

  const suggestedNewCode = useMemo(
    () => suggestNext1121ChildCode(accounts, bankAccounts, item?.id),
    [accounts, bankAccounts, item?.id],
  );

  useEffect(() => {
    if (!isOpen) return;
    const currentLinkedCode = String(item?.linkedAccountCode || '').trim();
    const canUseExisting =
      !!currentLinkedCode && eligibleLinkedAccounts.some((account) => String(account.code) === currentLinkedCode);

    setBankName(item?.bankName || '');
    setAccountNumber(item?.accountNumber || '');
    setAccountHolder(item?.accountHolder || '');
    setBranch(item?.branch || '');
    setStatus(item?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE');
    setExistingLinkedAccountCode(canUseExisting ? currentLinkedCode : eligibleLinkedAccounts[0]?.code || '');
    if (canUseExisting) {
      setLinkMode('EXISTING');
      setNewLinkedAccountCode('');
    } else {
      setLinkMode('NEW');
      setNewLinkedAccountCode(
        currentLinkedCode && isBankLedgerChildAccountCode(currentLinkedCode) ? currentLinkedCode : suggestedNewCode,
      );
    }
    // Chỉ khởi tạo form khi MỞ modal (hoặc đổi bản ghi đang sửa). KHÔNG phụ thuộc
    // eligibleLinkedAccounts/suggestedNewCode vì chúng đổi tham chiếu mỗi lần đồng bộ realtime
    // (WebSocket) → sẽ reset form khi người dùng đang nhập, gây "không nhập được".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);

  const setLinkModeTab = (mode: 'EXISTING' | 'NEW') => {
    if (mode === linkMode) return;
    setLinkMode(mode);
    if (mode === 'NEW') {
      setNewLinkedAccountCode(suggestNext1121ChildCode(accounts, bankAccounts, item?.id));
    }
  };

  if (!isOpen) return null;

  const currentLinkedAccountCode =
    linkMode === 'NEW' ? newLinkedAccountCode.trim() : existingLinkedAccountCode.trim();
  const selectedExistingAccount = eligibleLinkedAccounts.find(
    (account) => String(account.code) === existingLinkedAccountCode,
  );
  const previewAccountName = `Tiền gửi ${bankName.trim() || 'ngân hàng'}${
    accountNumber.trim() ? ` - ${accountNumber.trim()}` : ''
  }`;

  const handleSubmit = () => {
    const result = handleSaveBankAccount({
      id: item?.id,
      bankName,
      accountNumber,
      accountHolder,
      branch,
      linkedAccountCode: currentLinkedAccountCode,
      status,
    });
    if (!result.ok) {
      window.alert(result.error || 'Không thể lưu tài khoản ngân hàng.');
      return;
    }
    onClose();
  };

  const previewLabel =
    linkMode === 'EXISTING' ? selectedExistingAccount?.name || 'Chọn tài khoản con' : previewAccountName;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.12)] animate-fade-in">
        <div className="flex items-center justify-between bg-blue-700 px-4 py-3 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
              <Landmark className="h-4 w-4" strokeWidth={2} />
            </div>
            <h3 className="text-[15px] font-semibold tracking-tight">
              {item ? 'Cập nhật tài khoản ngân hàng' : 'Thêm tài khoản ngân hàng'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Đóng">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Tên ngân hàng</label>
              <input
                className={inputClass}
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Vietcombank, BIDV, MB…"
              />
            </div>
            <div>
              <label className={labelClass}>Số tài khoản</label>
              <input
                className={`${inputClass} font-mono`}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="Số TK"
              />
            </div>
            <div>
              <label className={labelClass}>Chi nhánh</label>
              <input
                className={inputClass}
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="CN Hà Nội, Hoàn Kiếm…"
              />
            </div>
            <div>
              <label className={labelClass}>Chủ tài khoản</label>
              <input
                className={inputClass}
                value={accountHolder}
                onChange={(e) => setAccountHolder(e.target.value)}
                placeholder="Tên DN / cá nhân đứng tên"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
              <span className="text-[12px] font-semibold text-slate-800">Tài khoản kế toán liên kết</span>
              <span
                className="group relative inline-flex"
                title="Tiền gửi ngân hàng phải gắn TK con 1121 (theo TT133). Hệ thống dùng mã này khi hạch toán thu/chi."
              >
                <Info className="h-3.5 w-3.5 cursor-help text-slate-400 hover:text-slate-600" aria-hidden />
                <span className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-1 w-64 max-w-[85vw] -translate-x-1/2 rounded border border-slate-200 bg-white px-2 py-1.5 text-left text-[11px] font-normal leading-snug text-slate-600 shadow-lg group-hover:visible">
                  Tiền gửi ngân hàng phải gắn TK con 1121 (theo TT133). Chọn TK có sẵn hoặc tạo mã mới; hệ thống dùng khi hạch toán.
                </span>
              </span>
            </div>

            <div className="mb-2 flex flex-wrap gap-3 border-b border-slate-100 pb-2" role="tablist" aria-label="Cách chọn tài khoản 1121">
              <button
                type="button"
                role="tab"
                aria-selected={linkMode === 'EXISTING'}
                onClick={() => setLinkModeTab('EXISTING')}
                className={`text-[12px] font-medium transition-colors ${
                  linkMode === 'EXISTING' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                TK con có sẵn
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={linkMode === 'NEW'}
                onClick={() => setLinkModeTab('NEW')}
                className={`text-[12px] font-medium transition-colors ${
                  linkMode === 'NEW' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Tạo mã 1121 mới
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                {linkMode === 'EXISTING' ? (
                  <>
                    <label className={labelClass}>Tài khoản 1121</label>
                    <select className={inputClass} value={existingLinkedAccountCode} onChange={(e) => setExistingLinkedAccountCode(e.target.value)}>
                      <option value="">Chọn tài khoản con</option>
                      {eligibleLinkedAccounts.map((account) => (
                        <option key={account.code} value={account.code}>
                          {account.code} — {account.name}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <input
                    className={`${inputClass} font-mono`}
                    value={newLinkedAccountCode}
                    onChange={(e) => setNewLinkedAccountCode(e.target.value.replace(/\s+/g, '').replace(/[^A-Za-z0-9]/g, ''))}
                    placeholder={`Mã tài khoản 1121 mới (vd: ${suggestedNewCode})`}
                    title="Mã TK con 1121"
                  />
                )}
              </div>
              <div className="w-full sm:w-44">
                <label className={labelClass}>Trạng thái</label>
                <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')}>
                  <option value="ACTIVE">Đang sử dụng</option>
                  <option value="INACTIVE">Ngừng sử dụng</option>
                </select>
              </div>
            </div>

            <p className="mt-2 text-[11px] text-slate-500">
              Hạch toán:{' '}
              <span className="font-mono font-medium text-slate-800">{currentLinkedAccountCode || '—'}</span>
              <span className="text-slate-400"> · </span>
              <span className="text-slate-600">{previewLabel}</span>
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-2">
          <button type="button" onClick={onClose} className="h-8 rounded border border-transparent px-3 text-[13px] font-medium text-slate-600 hover:bg-slate-100">
            Hủy
          </button>
          <button type="button" onClick={handleSubmit} className="h-8 rounded bg-blue-600 px-3 text-[13px] font-semibold text-white shadow-sm hover:bg-blue-700">
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
};
