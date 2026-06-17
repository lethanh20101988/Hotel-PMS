import type {
  AccountingVoucher,
  AccountingVoucherDetail,
  Customer,
  FundTransaction,
  Invoice,
  JournalEntryDetail,
  Supplier,
} from '../types';
import { coercePaidInvoicePaymentMethodFromDebtLabels } from './invoiceCoercion';
import {
  suggestPurchaseInvoicesForPayment,
  suggestSalesInvoicesForReceipt,
} from './arApSubledger';

const EPS = 0.005;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function findUniquePartyByName<T extends { id: string; name: string }>(
  rawName: string,
  parties: T[],
): T | null {
  const n = norm(rawName || '');
  if (n.length < 2) return null;

  const exact = parties.filter((p) => norm(String(p.name || '')) === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  let hit: T | null = null;
  for (const p of parties) {
    const pn = norm(String(p.name || ''));
    if (!pn) continue;
    if (!(pn.includes(n) || n.includes(pn))) continue;
    if (hit && hit.id !== p.id) return null;
    hit = p;
  }
  return hit;
}

function amountMatchesInvoice(inv: Invoice, amt: number): boolean {
  return Math.abs(Number(inv.totalAmount || 0) - amt) < EPS;
}

/** Phiếu thu quỹ — Có TK 131: khớp HĐ bán công nợ còn PENDING. */
export function matchPendingSalesInvoiceForFundReceipt(
  ft: FundTransaction,
  invoices: Invoice[],
  customers: Customer[],
): Invoice | null {
  if (ft.type !== 'RECEIPT') return null;
  if (!String(ft.accountingType || '').startsWith('131')) return null;
  const amt = Number(ft.amount || 0);
  if (!(amt > 0)) return null;

  const pool = invoices.filter((i) => i.type === 'SALES' && i.status === 'PENDING');
  const ref = String(ft.referenceDoc || '').trim();
  if (ref) {
    const byRef = pool.find(
      (i) =>
        String(i.invoiceNumber || '').trim() === ref ||
        String(i.id) === ref ||
        String(i.invoiceNumber || '').toLowerCase() === ref.toLowerCase(),
    );
    if (byRef && amountMatchesInvoice(byRef, amt)) return byRef;
  }

  const suggested = suggestSalesInvoicesForReceipt(String(ft.payerReceiver || ''), invoices, customers);
  const byAmt = suggested.filter((i) => i.status === 'PENDING' && amountMatchesInvoice(i, amt));
  if (byAmt.length === 1) return byAmt[0];

  const pn = norm(ft.payerReceiver || '');
  if (pn.length < 2) return null;
  const candidates = pool.filter((i) => {
    const n1 = norm(i.customerName || '');
    const n2 = norm(i.buyerUnitName || '');
    return (n1 && (n1.includes(pn) || pn.includes(n1))) || (n2 && (n2.includes(pn) || pn.includes(n2)));
  });
  const exact = candidates.filter((i) => amountMatchesInvoice(i, amt));
  return exact.length === 1 ? exact[0] : null;
}

/** Phiếu chi quỹ — Nợ TK 331: khớp HĐ mua công nợ còn PENDING. */
export function matchPendingPurchaseInvoiceForFundPayment(
  ft: FundTransaction,
  invoices: Invoice[],
  suppliers: Supplier[],
): Invoice | null {
  if (ft.type !== 'PAYMENT') return null;
  if (!String(ft.accountingType || '').startsWith('331')) return null;
  const amt = Number(ft.amount || 0);
  if (!(amt > 0)) return null;

  const pool = invoices.filter((i) => i.type === 'PURCHASE' && i.status === 'PENDING');
  const ref = String(ft.referenceDoc || '').trim();
  if (ref) {
    const byRef = pool.find(
      (i) =>
        String(i.invoiceNumber || '').trim() === ref ||
        String(i.id) === ref ||
        String(i.invoiceNumber || '').toLowerCase() === ref.toLowerCase(),
    );
    if (byRef && amountMatchesInvoice(byRef, amt)) return byRef;
  }

  const suggested = suggestPurchaseInvoicesForPayment(String(ft.payerReceiver || ''), invoices, suppliers);
  const byAmt = suggested.filter((i) => i.status === 'PENDING' && amountMatchesInvoice(i, amt));
  if (byAmt.length === 1) return byAmt[0];

  const pn = norm(ft.payerReceiver || '');
  if (pn.length < 2) return null;
  const candidates = pool.filter((i) => {
    const n1 = norm(i.customerName || '');
    return n1 && (n1.includes(pn) || pn.includes(n1));
  });
  const exact = candidates.filter((i) => amountMatchesInvoice(i, amt));
  return exact.length === 1 ? exact[0] : null;
}

function findSalesInvoiceFor131Line(
  d: AccountingVoucherDetail,
  invoices: Invoice[],
  customers: Customer[],
): Invoice | null {
  const amt = Number(d.amount || 0);
  if (!(amt > 0)) return null;
  const oid = String(d.objectId || '').trim();
  if (!oid) return null;

  const pool = invoices.filter((i) => i.type === 'SALES' && i.status === 'PENDING');
  const direct = pool.find((i) => i.id === oid);
  if (direct && amountMatchesInvoice(direct, amt)) return direct;

  const cust = customers.find((c) => c.id === oid);
  if (cust) {
    const cn = norm(cust.name || '');
    const cand = pool.filter((i) => {
      const n1 = norm(i.customerName || '');
      const n2 = norm(i.buyerUnitName || '');
      return (n1 && (n1.includes(cn) || cn.includes(n1))) || (n2 && (n2.includes(cn) || cn.includes(n2)));
    });
    const exact = cand.filter((i) => amountMatchesInvoice(i, amt));
    if (exact.length === 1) return exact[0];
  }
  return null;
}

function findPurchaseInvoiceFor331Line(
  d: AccountingVoucherDetail,
  invoices: Invoice[],
  suppliers: Supplier[],
): Invoice | null {
  const amt = Number(d.amount || 0);
  if (!(amt > 0)) return null;
  const oid = String(d.objectId || '').trim();
  if (!oid) return null;

  const pool = invoices.filter((i) => i.type === 'PURCHASE' && i.status === 'PENDING');
  const direct = pool.find((i) => i.id === oid);
  if (direct && amountMatchesInvoice(direct, amt)) return direct;

  const sup = suppliers.find((s) => s.id === oid);
  if (sup) {
    const sn = norm(sup.name || '');
    const cand = pool.filter((i) => norm(i.customerName || '') === sn);
    const exact = cand.filter((i) => amountMatchesInvoice(i, amt));
    if (exact.length === 1) return exact[0];
  }
  return null;
}

function buildPaidPatchFromVoucher(v: AccountingVoucher, inv: Invoice): Invoice {
  const postingDate = String(v.postingDate || v.date || '').split('T')[0];
  const vn = String(v.voucherNumber || '').trim();
  const hasBank = Boolean(
    v.bankLedgerAccountCode && String(v.bankLedgerAccountCode).length > 0 && v.bankAccountId,
  );
  const base: Invoice = {
    ...inv,
    status: 'PAID',
    paymentDate: postingDate,
    paymentVoucherNumber: vn || inv.paymentVoucherNumber,
    paymentMethod: hasBank ? 'Chuyển khoản' : inv.paymentMethod || 'Tiền mặt',
    ...(hasBank
      ? {
          bankAccountId: v.bankAccountId,
          bankName: v.bankName,
          bankAccountNumber: v.bankAccountNumber,
          bankAccountHolder: v.bankAccountHolder,
          bankBranch: v.bankBranch,
          bankLedgerAccountCode: v.bankLedgerAccountCode,
        }
      : {}),
  };
  return coercePaidInvoicePaymentMethodFromDebtLabels(base);
}

function buildPaidPatchFromFund(ft: FundTransaction, inv: Invoice): Invoice {
  const postingDate = String(ft.date || '').split('T')[0];
  const vn = String(ft.voucherNumber || '').trim();
  const hasBank = ft.method === 'BANK' && Boolean(ft.bankLedgerAccountCode);
  const base: Invoice = {
    ...inv,
    status: 'PAID',
    paymentDate: postingDate,
    paymentVoucherNumber: vn || inv.paymentVoucherNumber,
    paymentMethod: hasBank ? 'Chuyển khoản' : 'Tiền mặt',
    ...(hasBank
      ? {
          bankAccountId: ft.bankAccountId,
          bankName: ft.bankName,
          bankAccountNumber: ft.bankAccountNumber,
          bankAccountHolder: ft.bankAccountHolder,
          bankBranch: ft.bankBranch,
          bankLedgerAccountCode: ft.bankLedgerAccountCode,
        }
      : {}),
  };
  return coercePaidInvoicePaymentMethodFromDebtLabels(base);
}

/** Cập nhật danh sách hóa đơn sau khi lưu phiếu thu/chi quỹ. */
export function applyInvoicePaidSyncFromFundTransaction(
  prev: Invoice[],
  ft: FundTransaction,
  customers: Customer[],
  suppliers: Supplier[],
): Invoice[] {
  const sales = matchPendingSalesInvoiceForFundReceipt(ft, prev, customers);
  const pur = matchPendingPurchaseInvoiceForFundPayment(ft, prev, suppliers);
  const hit = sales || pur;
  if (!hit) return prev;
  return prev.map((i) => (i.id === hit.id ? buildPaidPatchFromFund(ft, i) : i));
}

/** Cập nhật hóa đơn khi ghi sổ chứng từ có đối trừ 131 / 331 đủ số tiền. */
export function applyInvoicePaidSyncFromPostedVoucher(
  prev: Invoice[],
  voucher: AccountingVoucher,
  customers: Customer[],
  suppliers: Supplier[],
): Invoice[] {
  if (voucher.status !== 'POSTED') return prev;
  const toMark = new Map<string, Invoice>();

  for (const d of voucher.details || []) {
    const credit = String(d.creditAccount || '').trim();
    const debit = String(d.debitAccount || '').trim();
    if (credit.startsWith('131')) {
      const inv = findSalesInvoiceFor131Line(d, prev, customers);
      if (inv) toMark.set(inv.id, inv);
    }
    if (debit.startsWith('331')) {
      const inv = findPurchaseInvoiceFor331Line(d, prev, suppliers);
      if (inv) toMark.set(inv.id, inv);
    }
  }

  if (toMark.size === 0) return prev;

  return prev.map((i) => {
    if (!toMark.has(i.id) || i.status !== 'PENDING') return i;
    return buildPaidPatchFromVoucher(voucher, i);
  });
}

/** Đối tượng chi tiết NKC cho dòng 131/331 trên bút JE-FT (khớp HĐ PENDING như đồng bộ PAID). */
export function resolveArApLedgerMetaForFundTransaction(
  ft: FundTransaction,
  invoices: Invoice[],
  customers: Customer[],
  suppliers: Supplier[],
): Pick<
  JournalEntryDetail,
  'objectId' | 'objectName' | 'objectType' | 'sourceInvoiceId' | 'sourceInvoiceNumber'
> | null {
  if (ft.type === 'RECEIPT' && String(ft.accountingType || '').startsWith('131')) {
    const inv = matchPendingSalesInvoiceForFundReceipt(ft, invoices, customers);
    const guessedCustomer =
      findUniquePartyByName(
        String(inv?.customerName || inv?.buyerUnitName || inv?.buyerLegalName || ft.payerReceiver || ''),
        customers,
      ) || findUniquePartyByName(String(ft.payerReceiver || ''), customers);
    const objectName = String(
      guessedCustomer?.name || inv?.customerName || inv?.buyerUnitName || ft.payerReceiver || '',
    ).trim();
    if (!objectName && !inv) return null;
    return {
      objectId: guessedCustomer?.id || inv?.id,
      objectName,
      objectType: 'CUSTOMER',
      sourceInvoiceId: inv?.id,
      sourceInvoiceNumber: inv?.invoiceNumber,
    };
  }
  if (ft.type === 'PAYMENT' && String(ft.accountingType || '').startsWith('331')) {
    const inv = matchPendingPurchaseInvoiceForFundPayment(ft, invoices, suppliers);
    const guessedSupplier =
      findUniquePartyByName(String(inv?.customerName || ft.payerReceiver || ''), suppliers) ||
      findUniquePartyByName(String(ft.payerReceiver || ''), suppliers);
    const objectName = String(guessedSupplier?.name || inv?.customerName || ft.payerReceiver || '').trim();
    if (!objectName && !inv) return null;
    return {
      objectId: guessedSupplier?.id || inv?.id,
      objectName,
      objectType: 'SUPPLIER',
      sourceInvoiceId: inv?.id,
      sourceInvoiceNumber: inv?.invoiceNumber,
    };
  }
  return null;
}

/**
 * Trước khi ghi sổ: bổ sung objectId/objectName trên dòng Có 131 / Nợ 331 nếu thiếu
 * (Ủy nhiệm chi / chứng từ tay) — để báo cáo Nợ phải thu/trả phản ánh đối trừ đúng khóa HĐ.
 */
export function enrichPostedVoucherArApObjects(
  voucher: AccountingVoucher,
  invoices: Invoice[],
  customers: Customer[],
  suppliers: Supplier[],
): AccountingVoucher {
  const contact = String(voucher.contactName || '').trim();
  let changed = false;
  const details = (voucher.details || []).map((d) => {
    const amt = Number(d.amount || 0);
    if (!(amt > 0)) return d;
    if (String(d.objectId || '').trim()) return d;
    const credit = String(d.creditAccount || '').trim();
    const debit = String(d.debitAccount || '').trim();

    if (credit.startsWith('131')) {
      const inv = matchPendingSalesInvoiceForFundReceipt(
        {
          type: 'RECEIPT',
          accountingType: '131',
          payerReceiver: contact,
          referenceDoc: '',
          amount: amt,
        } as FundTransaction,
        invoices,
        customers,
      );
      const guessedCustomer =
        findUniquePartyByName(
          String(inv?.customerName || inv?.buyerUnitName || inv?.buyerLegalName || contact || ''),
          customers,
        ) || findUniquePartyByName(contact, customers);
      if (inv || guessedCustomer || contact) {
        changed = true;
        return {
          ...d,
          objectId: guessedCustomer?.id || inv?.id,
          objectName: guessedCustomer?.name || inv?.customerName || inv?.buyerUnitName || contact,
          objectType: 'CUSTOMER' as const,
        };
      }
    }
    if (debit.startsWith('331')) {
      const inv = matchPendingPurchaseInvoiceForFundPayment(
        {
          type: 'PAYMENT',
          accountingType: '331',
          payerReceiver: contact,
          referenceDoc: '',
          amount: amt,
        } as FundTransaction,
        invoices,
        suppliers,
      );
      const guessedSupplier =
        findUniquePartyByName(String(inv?.customerName || contact || ''), suppliers) ||
        findUniquePartyByName(contact, suppliers);
      if (inv || guessedSupplier || contact) {
        changed = true;
        return {
          ...d,
          objectId: guessedSupplier?.id || inv?.id,
          objectName: guessedSupplier?.name || inv?.customerName || contact,
          objectType: 'SUPPLIER' as const,
        };
      }
    }
    return d;
  });
  if (!changed) return voucher;
  return { ...voucher, details };
}
