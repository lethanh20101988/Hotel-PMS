
export enum RoomStatus {
  AVAILABLE = 'AVAILABLE', // Trống
  OCCUPIED = 'OCCUPIED',   // Có khách
  BOOKED = 'BOOKED',       // Đặt trước
  DIRTY = 'DIRTY',         // Dơ (cần dọn)
  MAINTENANCE = 'MAINTENANCE' // Bảo trì
}

export enum BookingType {
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  OVERNIGHT = 'OVERNIGHT'
}

export interface Room {
  id: string;
  number: string;
  floor: number;
  type: string; // e.g. 'Standard', 'Double', 'VIP' - This links to RoomTypeConfig.code
  status: RoomStatus;
  priceHourly: number;
  priceDaily: number;
  priceOvernight: number;
  inventory: { [key: string]: number }; // InventoryItemId -> Quantity in Room
}

export interface RoomTypeConfig {
  id: string;
  name: string; // Display name: 'Phòng Đơn'
  code: string; // Logical code: 'Standard' (Links to Room.type)
  image: string;
  priceHourly: number;
  priceDaily: number;
  priceOvernight: number;
  amenities: string[];
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone: string;
  identityCard: string; // CMND/CCCD/Passport
  notes?: string;
}

/** TK doanh thu khi check-out: 5111 hàng hóa / 5113 dịch vụ. */
export type HotelPmsRevenueAccount = '5111' | '5113';

export interface ServiceItem {
  id: string;
  name: string;
  price: number;
  category: 'MINIBAR' | 'LAUNDRY' | 'FOOD' | 'OTHER';
  inventoryId?: string; // Optional link to InventoryItem.id
  /** Mặc định: Minibar → 5111, dịch vụ → 5113 */
  revenueAccount?: HotelPmsRevenueAccount;
}

export interface BookingService {
  serviceId: string;
  name: string;
  quantity: number;
  price: number;
  vatRate?: number; // Thuế suất VAT của dịch vụ
  /** TK ghi nhận doanh thu dòng này */
  revenueAccount?: HotelPmsRevenueAccount;
  timestamp: string;
}

export interface Booking {
  id: string;
  roomId: string;
  customer: Customer;
  checkIn: string; // ISO String
  checkOutExpected: string; // ISO String
  checkOutActual?: string; // ISO String
  bookingType: BookingType;
  status: 'active' | 'completed' | 'cancelled' | 'pending';
  services: BookingService[];
  
  // Financial History (Snapshot when checked out)
  totalRoomCharge: number; // Tiền phòng trước thuế
  roomVatRate?: number;    // % Thuế phòng đã áp dụng
  roomVatAmount?: number;  // Tiền thuế phòng
  
  totalServiceCharge: number; // Tiền dịch vụ trước thuế
  totalServiceVatAmount?: number; // Tổng tiền thuế dịch vụ

  discount: number;
  deposit: number;
  paidAmount: number;
  finalTotal: number; // Tổng cộng sau cùng (Gồm thuế)
  paymentMethod?: 'CASH' | 'TRANSFER' | 'CARD' | 'DEBT';
  bankAccountId?: string;
  bankLedgerAccountCode?: string;
  /** Đã hạch toán sang Sổ nhật ký chung / chứng từ VTR. */
  accountingPosted?: boolean;
  invoiceReferenceId?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  minThreshold: number;
  unit: string;
  costPrice: number; // Giá vốn nhập vào
  supplier?: string; // Nhà cung cấp
  invoiceRef?: string; // Chứng từ / Hóa đơn (Mới nhất)
  vatRate?: number; // Thuế suất VAT (0, 5, 8, 10)
  /** TK doanh thu khi bán Minibar — mặc định 5111 */
  revenueAccount?: HotelPmsRevenueAccount;
}

// New Interface for Import History Log
export interface ImportLog {
  id: string;
  inventoryId?: string; // Link to the InventoryItem.id to allow sync updates/deletes
  importDate: string; // ISO Date
  itemName: string;
  quantity: number;
  unit: string;
  costPrice: number; // Đơn giá lúc nhập
  supplier?: string;
  invoiceRef?: string;
  vatRate?: number;
  preTaxTotal: number;
  totalAmount: number; // Sau thuế
}

export interface Expense {
  id: string;
  name: string;
  amount: number;
  category: 'IMPORT' | 'UTILITY' | 'SALARY' | 'MAINTENANCE' | 'OTHER';
  date: string; // ISO Date
  notes?: string;
  /** Tiền trước thuế (nếu có VAT). */
  preTaxAmount?: number;
  vatRate?: number;
  vatAmount?: number;
  supplierName?: string;
  invoiceRef?: string;
  paymentMethod?: 'CASH' | 'TRANSFER' | 'CARD' | 'DEBT';
  bankAccountId?: string;
  bankLedgerAccountCode?: string;
  /** Đã hạch toán sang Sổ nhật ký chung / Hóa đơn / Chứng từ VTR. */
  accountingPosted?: boolean;
  invoiceReferenceId?: string;
  voucherReferenceId?: string;
}
