import type { BankAccount, BankAccountSnapshot } from '@shared/types';

const trimValue = (value?: string) => String(value || '').trim();

/** Mã con của 1121: bắt đầu 1121, sau đó ít nhất một ký tự chữ/số (vd. 112101, 112101MB). Không phải 1121 tổng hợp. */
export const isBankLedgerChildAccountCode = (code?: string) => /^1121[A-Za-z0-9]+$/.test(trimValue(code));

export const extractBankAccountSnapshot = (bank?: BankAccount | null): BankAccountSnapshot => ({
  bankAccountId: bank?.id,
  bankName: bank?.bankName,
  bankAccountNumber: bank?.accountNumber,
  bankAccountHolder: bank?.accountHolder,
  bankBranch: bank?.branch,
  bankLedgerAccountCode: bank?.linkedAccountCode,
});

export const clearBankAccountSnapshot = (): BankAccountSnapshot => ({
  bankAccountId: undefined,
  bankName: undefined,
  bankAccountNumber: undefined,
  bankAccountHolder: undefined,
  bankBranch: undefined,
  bankLedgerAccountCode: undefined,
});

export const resolveBankAccountFromSnapshot = (
  bankAccounts: BankAccount[],
  snapshot?: BankAccountSnapshot | null,
): BankAccount | null => {
  const bankAccountId = trimValue(snapshot?.bankAccountId);
  const bankLedgerAccountCode = trimValue(snapshot?.bankLedgerAccountCode);
  const bankAccountNumber = trimValue(snapshot?.bankAccountNumber);
  const bankName = trimValue(snapshot?.bankName).toLowerCase();

  if (bankAccountId) {
    const byId = bankAccounts.find((bank) => bank.id === bankAccountId);
    if (byId) return byId;
  }

  if (bankLedgerAccountCode) {
    const byLedger = bankAccounts.find((bank) => trimValue(bank.linkedAccountCode) === bankLedgerAccountCode);
    if (byLedger) return byLedger;
  }

  if (bankAccountNumber) {
    const byNumber = bankAccounts.find((bank) => {
      if (trimValue(bank.accountNumber) !== bankAccountNumber) return false;
      if (!bankName) return true;
      return trimValue(bank.bankName).toLowerCase() === bankName;
    });
    if (byNumber) return byNumber;
  }

  return null;
};

const isBankPaymentMethodText = (paymentMethod?: string) => {
  const raw = trimValue(paymentMethod);
  const lower = raw.toLowerCase();
  return (
    lower.includes('chuyển khoản') ||
    lower.includes('chuyen khoan') ||
    lower.includes('ngân hàng') ||
    lower.includes('ngan hang') ||
    lower.includes('bank') ||
    lower.includes('ck') ||
    /\b1121\b/.test(raw) ||
    /\b1122\b/.test(raw) ||
    /\b1121[A-Za-z0-9]+\b/.test(raw)
  );
};

const isCashPaymentMethodText = (paymentMethod?: string) => {
  const raw = trimValue(paymentMethod);
  const lower = raw.toLowerCase();
  return (
    lower.includes('tiền mặt') ||
    lower.includes('tien mat') ||
    lower.includes('cash') ||
    /\b1111\b/.test(raw) ||
    /\b1112\b/.test(raw)
  );
};

export const resolveCashBankAccountCode = (paymentMethod?: string, bankLedgerAccountCode?: string) => {
  const explicitLedger = trimValue(bankLedgerAccountCode);
  if (isBankLedgerChildAccountCode(explicitLedger)) return explicitLedger;

  const raw = trimValue(paymentMethod);
  const lower = raw.toLowerCase();

  if (lower.includes('3388') || lower.includes('chi hộ') || lower.includes('chi ho')) return '3388';

  const explicitBankChild = raw.match(/\b(1121[A-Za-z0-9]+)\b/);
  if (explicitBankChild?.[1]) return explicitBankChild[1];
  if (/\b1122\b/.test(raw)) return '1122';
  if (isBankPaymentMethodText(raw)) return '1121';
  if (/\b1112\b/.test(raw)) return '1112';
  if (isCashPaymentMethodText(raw)) return '1111';
  return '1111';
};

export const resolveFundMethodFromPayment = (
  paymentMethod?: string,
  bankLedgerAccountCode?: string,
): 'BANK' | 'CASH' | null => {
  const explicitLedger = trimValue(bankLedgerAccountCode);
  if (isBankLedgerChildAccountCode(explicitLedger)) return 'BANK';

  const raw = trimValue(paymentMethod);
  const lower = raw.toLowerCase();
  if (lower.includes('3388') || lower.includes('chi hộ') || lower.includes('chi ho')) return null;
  if (isBankPaymentMethodText(raw)) return 'BANK';
  if (isCashPaymentMethodText(raw)) return 'CASH';
  return 'CASH';
};
