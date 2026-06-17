import type { BookingService, Expense, HotelPmsRevenueAccount, ServiceItem } from './types';

export const HOTEL_PMS_REVENUE_ACCOUNT_LABELS: Record<HotelPmsRevenueAccount, string> = {
  '5111': '5111 — Bán hàng hóa',
  '5113': '5113 — Cung cấp dịch vụ',
};

export const defaultRevenueAccountForServiceItem = (
  item: Pick<ServiceItem, 'category' | 'revenueAccount'>,
): HotelPmsRevenueAccount => {
  if (item.revenueAccount === '5111' || item.revenueAccount === '5113') return item.revenueAccount;
  return item.category === 'MINIBAR' ? '5111' : '5113';
};

export const resolveBookingServiceRevenueAccount = (
  service: BookingService,
  inventoryIds?: Set<string>,
): HotelPmsRevenueAccount => {
  if (service.revenueAccount === '5111' || service.revenueAccount === '5113') return service.revenueAccount;
  if (inventoryIds?.has(service.serviceId)) return '5111';
  return '5113';
};

export const invoiceLineTypeForRevenueAccount = (account: HotelPmsRevenueAccount): 'GOODS' | 'SERVICE' =>
  account === '5111' ? 'GOODS' : 'SERVICE';

export const sumServicesByRevenueAccount = (
  services: BookingService[],
  inventoryIds?: Set<string>,
) => {
  const buckets = {
    '5111': { preTax: 0, vat: 0 },
    '5113': { preTax: 0, vat: 0 },
  } satisfies Record<HotelPmsRevenueAccount, { preTax: number; vat: number }>;

  services.forEach((service) => {
    const account = resolveBookingServiceRevenueAccount(service, inventoryIds);
    const preTax = Number(service.price || 0) * Number(service.quantity || 0);
    const vatRate = Number(service.vatRate || 0);
    const vat = preTax * (vatRate / 100);
    buckets[account].preTax += preTax;
    buckets[account].vat += vat;
  });

  return buckets;
};

export type HotelPmsCheckoutPostingPayload = {
  bookingId: string;
  roomNumber: string;
  checkoutDate: string;
  customerName: string;
  customerPhone?: string;
  customerIdentityCard?: string;
  roomChargePreTax: number;
  roomVatRate: number;
  roomVatAmount: number;
  services: import('./types').BookingService[];
  servicesPreTax: number;
  servicesVatAmount: number;
  grandTotal: number;
  paymentMethod?: 'CASH' | 'TRANSFER' | 'CARD' | 'DEBT';
  bankAccountId?: string;
  bankLedgerAccountCode?: string;
  /** Id mặt hàng Minibar — dùng suy ra TK 5111 khi dòng chưa có revenueAccount */
  inventoryItemIds?: string[];
};

export type HotelPmsExpensePostingPayload = {
  expenseId: string;
  name: string;
  category: Expense['category'];
  date: string;
  preTaxAmount: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  notes?: string;
  supplierName?: string;
  invoiceRef?: string;
  paymentMethod?: 'CASH' | 'TRANSFER' | 'CARD';
};

export const buildHotelPmsInvoiceId = (bookingId: string) => `INV-HTL-${bookingId}`;

export const buildHotelPmsExpenseInvoiceId = (expenseId: string) => `INV-HTL-EXP-${expenseId}`;

/** Trích bookingId từ hóa đơn check-out PMS (INV-HTL-*, không bao gồm INV-HTL-EXP-*). */
export const parseHotelPmsCheckoutBookingId = (invoiceId: string): string | null => {
  const id = String(invoiceId || '').trim();
  if (!id.startsWith('INV-HTL-') || id.startsWith('INV-HTL-EXP-')) return null;
  const bookingId = id.slice('INV-HTL-'.length);
  return bookingId || null;
};

/** Trích expenseId từ hóa đơn chi phí PMS. */
export const parseHotelPmsExpenseId = (invoiceId: string): string | null => {
  const m = String(invoiceId || '').trim().match(/^INV-HTL-EXP-(.+)$/);
  return m?.[1] || null;
};

/** Phân loại chi phí PMS → TK hạch toán (TT133 / TT58/2026). */
export const resolveHotelPmsExpenseAccount = (category: Expense['category']): string => {
  switch (category) {
    case 'IMPORT':
      return '156';
    case 'SALARY':
      return '6422';
    case 'UTILITY':
      return '6422';
    case 'MAINTENANCE':
      return '627';
    case 'OTHER':
    default:
      return '6422';
  }
};

/** Loại hóa đơn mua vào theo danh mục chi phí. */
export const resolveHotelPmsExpenseInvoiceCategory = (
  category: Expense['category'],
): 'DEVICE' | 'SERVICE' => (category === 'IMPORT' ? 'DEVICE' : 'SERVICE');

export const parseExpenseVatRateFromNotes = (notes?: string): number => {
  const match = String(notes || '').match(/VAT\s*(\d+(?:\.\d+)?)\s*%/i);
  if (!match) return 0;
  const rate = Number(match[1]);
  return Number.isFinite(rate) ? rate : 0;
};

/** Tách tiền trước thuế / thuế từ khoản chi PMS (amount lưu tổng sau thuế). */
export const splitHotelPmsExpenseAmounts = (expense: Pick<Expense, 'amount' | 'vatRate' | 'preTaxAmount' | 'vatAmount' | 'notes'>) => {
  if (Number.isFinite(expense.preTaxAmount) && expense.preTaxAmount! > 0) {
    const preTax = Number(expense.preTaxAmount);
    const vatRate = Number(expense.vatRate ?? 0);
    const vatAmount = Number.isFinite(expense.vatAmount)
      ? Number(expense.vatAmount)
      : preTax * (vatRate / 100);
    return {
      preTaxAmount: preTax,
      vatRate,
      vatAmount,
      totalAmount: preTax + vatAmount,
    };
  }

  const vatRate = Number.isFinite(expense.vatRate) ? Number(expense.vatRate) : parseExpenseVatRateFromNotes(expense.notes);
  const totalAmount = Number(expense.amount || 0);
  if (vatRate <= 0) {
    return { preTaxAmount: totalAmount, vatRate: 0, vatAmount: 0, totalAmount };
  }
  const preTaxAmount = totalAmount / (1 + vatRate / 100);
  const vatAmount = totalAmount - preTaxAmount;
  return { preTaxAmount, vatRate, vatAmount, totalAmount };
};

export const buildHotelPmsExpensePostingPayload = (
  expense: Expense,
  overrides?: Partial<HotelPmsExpensePostingPayload>,
): HotelPmsExpensePostingPayload => {
  const amounts = splitHotelPmsExpenseAmounts(expense);
  return {
    expenseId: expense.id,
    name: expense.name,
    category: expense.category,
    date: String(expense.date || '').split('T')[0],
    preTaxAmount: amounts.preTaxAmount,
    vatRate: amounts.vatRate,
    vatAmount: amounts.vatAmount,
    totalAmount: amounts.totalAmount,
    notes: expense.notes,
    supplierName: expense.supplierName,
    invoiceRef: expense.invoiceRef,
    paymentMethod: expense.paymentMethod || 'CASH',
    ...overrides,
  };
};
