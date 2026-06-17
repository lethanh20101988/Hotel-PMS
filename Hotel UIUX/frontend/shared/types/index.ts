
export enum DeviceType {
  GPS = 'GPS',
  CAMERA = 'CAMERA'
}

export enum DeviceStatus {
  ACTIVE = 'Hoạt động',
  EXPIRED = 'Hết hạn'
}

export interface DeviceRenewalHistoryItem {
  id: string;
  renewedAt: string;
  oldExpiryDate: string;
  newExpiryDate: string;
  durationMonths: number;
  fee: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  paymentStatus: 'PAID' | 'DEBT';
  paymentMethod: string;
  salesDescription?: string;
  salesUnit?: string;
  salesInvoiceNumber?: string;
  purchaseInvoiceNumber?: string;
  inputCostSupplier?: string;
  inputCostPrice?: number;
  inputCostVatRate?: number;
  inputCostVatAmount?: number;
  inputCostTotal?: number;
  inputCostPaymentMethod?: string;
  inputCostDescription?: string;
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  imei: string;
  serial: string;
  licensePlate: string;
  phoneNumber: string;
  provider: string;
  telecomPlan: string;
  activationDate: string;
  expiryDate: string;
  status: DeviceStatus;
  customerName: string;
  customerPhone: string;
  username: string;
  planName: string;
  renewalFee: number;
  vatRate: number;
  renewalHistory?: DeviceRenewalHistoryItem[];
}

/** Hóa đơn phát sinh kỳ trước, ghi nhận tại kỳ hiện tại (khác niên độ / phát hiện trễ). */
export interface InvoiceCrossPeriodMeta {
  discoveryPostingDate: string;
  materiality: 'IMMATERIAL' | 'MATERIAL';
  supplementaryVat: boolean;
  originalPeriodName?: string;
  discoveryPeriodName?: string;
  auditTrail: { at: string; action: string; detail?: string }[];
}

/** Tách kỳ kế toán vs kỳ kê khai GTGT; gợi ý điều chỉnh [37]/[38]. */
export interface InvoiceTaxFilingMeta {
  supplementaryFromPriorPeriod: boolean;
  invoicePeriodKey?: string;
  filingAnchorDate?: string;
  originPeriodLabel?: string;
  filingPeriodLabel?: string;
  /** Sổ theo ngày HĐ, thuế theo kỳ phát hiện (cùng niên độ). */
  accountingTaxSplit?: 'SAME_FY_LATE_TAX' | 'CROSS_FY_OR_LOCKED';
  /** Mốc thuế so sánh với lần lưu trước (hoặc 0 khi tạo mới); khi có khóa kê khai dùng declaredVatAmount trên lock. */
  filingAdjustmentPriorVat?: number;
  /** Chênh lệch có dấu (đầu ra − đầu vào) lần lưu gần nhất: dương → [37], âm → [38]. */
  filingAdjustmentNetDelta?: number;
  /** Điều chỉnh tăng nghĩa vụ / giảm khấu trừ → chỉ tiêu [37] (luôn ≥ 0). */
  suggestedCt37Delta?: number;
  /** Điều chỉnh giảm nghĩa vụ / tăng khấu trừ → chỉ tiêu [38] (luôn ≥ 0). */
  suggestedCt38Delta?: number;
  auditTrail: { at: string; action: string; detail?: string }[];
}

/** Tránh kê khai trùng khi đã đánh dấu nộp tờ khai (tùy chọn). */
export interface InvoiceVatDeclarationLock {
  status: 'OPEN' | 'DECLARED';
  periodKey?: string;
  snapshotId?: string;
  updatedAt?: string;
  /** Thuế GTGT đã phản ánh trên tờ khai đã nộp (mốc cố định cho điều chỉnh sau này). */
  declaredVatAmount?: number;
}

export interface InvoiceDetail {
  id: string;
  productName: string;
  type: 'GOODS' | 'SERVICE' | 'MATERIAL' | 'PRODUCT';
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  vatRate: number;
  vatAmount: number;
  isPromotion?: boolean;
  account?: string;
  /** Link back to warehouse inventory item (for syncing multi-line stock invoices) */
  inventoryItemId?: string;
  /** Line-level description/notes */
  note?: string;
  /** % thuế TNDN trên doanh thu dòng HĐ (TT58 S3a). */
  citRevenueRatePercent?: number;
  /** Ngành nghề TT58 (id trong bảng ngành nghề DNSN). */
  tt58IndustryId?: string;
  /** % thuế GTGT trên doanh thu (TT58 S1/S2a — tỷ lệ %). */
  vatRevenueRatePercent?: number;
}

export interface Invoice extends BankAccountSnapshot {
  id: string;
  relatedId?: string;
  previousExpiryDate?: string;
  /** Mẫu số hóa đơn (VD: 01GTKT0/001) */
  formNo?: string;
  invoiceNumber: string;
  /** Ký hiệu hóa đơn (VD: 1C23TYY) */
  symbolCode?: string;
  date: string;
  customerName: string;
  buyerUnitName?: string;
  buyerTaxCode?: string;
  buyerAddress?: string;
  buyerLegalName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  description?: string;
  amount: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  type: 'SALES' | 'PURCHASE';
  category: 'DEVICE' | 'SERVICE';
  status: 'PAID' | 'PENDING';
  paymentMethod: string;
  paymentPostingMode?: 'DIRECT' | 'RECEIVABLE';
  paymentDate?: string;
  paymentVoucherNumber?: string;
  deferredRevenueEnabled?: boolean;
  deferredRevenueAccount?: string;
  revenueRecognitionAccount?: string;
  serviceStartDate?: string;
  serviceEndDate?: string;
  currency?: string;
  exchangeRate?: number;
  discountAmount?: number;
  sourceInvoiceStatus?: string;
  sourceCheckResult?: string;
  /** Hóa đơn tạo từ nhập Excel — dùng để tránh ghi chồng chứng từ thu/chi khi sửa sau import. */
  importedFromExcel?: boolean;
  details: InvoiceDetail[];
  /** % thuế TNDN trên doanh thu (TT58 S3a) — theo ngành nghề/nhóm. */
  citRevenueRatePercent?: number;
  /** Ngành nghề TT58 chính của hóa đơn. */
  tt58IndustryId?: string;
  /** Nhóm A/B/C/D (TT58). */
  tt58IndustryGroup?: 'A' | 'B' | 'C' | 'D';
  unit?: string;
  quantity?: number;
  /**
   * Ngày ghi sổ NKC / chứng từ / quỹ tại kỳ phát hiện (HĐ khác niên độ).
   * Khi có giá trị, khác với `date` (ngày trên hóa đơn — kỳ gốc).
   */
  accountingPostingDate?: string;
  /**
   * Neo kỳ tổng hợp GTGT (kỳ phát hiện / kê khai bổ sung).
   * Khi có: [23]–[33] theo ngày này; có thể khác ngày HĐ (cùng niên độ, kê khai chậm).
   */
  vatFilingAnchorDate?: string;
  /** Theo dõi HĐ khác niên độ, mức trọng yếu, kê khai bổ sung, audit. */
  crossPeriodMeta?: InvoiceCrossPeriodMeta;
  /** Theo dõi kỳ phát sinh vs kỳ kê khai, gợi ý CT37/CT38. */
  taxFilingMeta?: InvoiceTaxFilingMeta;
  vatDeclarationLock?: InvoiceVatDeclarationLock;
}

export type Bom154Category = 'DIRECT_MATERIAL' | 'DIRECT_LABOR' | 'OVERHEAD';

export type BomVersionStatus = 'DRAFT' | 'APPROVED' | 'OBSOLETE';
export type BomCostMethod = 'STANDARD' | 'ACTUAL' | 'AVERAGE';
export type BomAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type BomAlertStatus = 'NEW' | 'SEEN' | 'RESOLVED';

export interface BomAuditEntry {
  id: string;
  action: 'CREATED' | 'UPDATED' | 'CLONED' | 'APPROVED' | 'OBSOLETED' | 'ALERT_STATUS_CHANGED';
  actor: string;
  timestamp: string;
  note?: string;
}

export interface BomAlertOverride {
  key: string;
  status: BomAlertStatus;
  updatedAt: string;
  updatedBy?: string;
  note?: string;
}

export interface BomComponentLine {
  id: string;
  componentItemId: string;
  quantity: number;
  lossRate: number;
  /** Hao hụt cố định theo số lượng trên mỗi đơn vị cha. */
  lossQuantity?: number;
  account154Category: Bom154Category;
  note?: string;
}

export interface BomDefinition {
  id: string;
  parentItemId: string;
  versionNumber?: number;
  versionCode?: string;
  status?: BomVersionStatus;
  effectiveDate?: string;
  expiryDate?: string;
  approvedAt?: string;
  approvedBy?: string;
  obsoleteAt?: string;
  clonedFromId?: string;
  changeSummary?: string;
  defaultCostMethod?: BomCostMethod;
  note?: string;
  components: BomComponentLine[];
  auditTrail?: BomAuditEntry[];
  alertOverrides?: BomAlertOverride[];
  updatedAt: string;
}

export interface BomMrpPlanLine {
  id: string;
  parentItemId: string;
  quantity: number;
  planDate: string;
  warehouseId?: string;
  note?: string;
}

export interface JournalEntryDetail {
  account: string;
  debit: number;
  credit: number;
  objectType?: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'ASSET';
  objectId?: string;
  objectName?: string;
  costObjectType?: 'BOM_PARENT';
  costObjectId?: string;
  costObjectName?: string;
  costObjectSku?: string;
  sourceInvoiceId?: string;
  sourceInvoiceNumber?: string;
  /** Ký hiệu HĐ (VD: 1C23TYY) — đối chiếu khi lập phiếu thu/chi */
  invoiceSymbolCode?: string;
  openingRevenueType?: OpeningDebtRevenueType;
  openingDueDate?: string;
  openingNote?: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  referenceId: string;
  description: string;
  details: JournalEntryDetail[];
}

export interface SerialInfo {
  serial: string;
  inboundVatRate: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  quantity: number;
  minStock: number;
  costPrice: number;
  sellingPrice: number;
  accountCode?: string;
  costAccount?: string;
  /** NONE | SERIAL | LOT — dùng pipeline import / kiểm soát IMEI-lô */
  trackingType?: 'NONE' | 'SERIAL' | 'LOT';
  serials?: string[];
  serialDetails?: SerialInfo[]; // Chi tiết thuế suất từng serial
  warehouseBalances?: InventoryWarehouseBalance[];
}

export interface InventoryTransaction extends BankAccountSnapshot {
  id: string;
  voucherNumber?: string;
  itemId: string;
  itemName: string;
  type: 'IMPORT' | 'EXPORT';
  quantity: number;
  price: number;
  date: string;
  warehouseId?: string;
  warehouseName?: string;
  performer: string;
  note: string;
  vatRate: number;
  supplier?: string;
  /** Mã số thuế / CCCD của nhà cung cấp (snapshot tại thời điểm lập phiếu) */
  supplierTaxCode?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  customer?: string;
  /** Mã số thuế / CCCD của khách hàng (snapshot tại thời điểm lập phiếu) */
  customerTaxCode?: string;
  customerPhone?: string;
  customerAddress?: string;
  /** Mẫu số hóa đơn (đồng bộ với Hoá đơn & VAT) */
  formNo?: string;
  /** Ký hiệu hóa đơn (đồng bộ với Hoá đơn & VAT) */
  symbolCode?: string;
  /** Group multiple lines that belong to the same voucher/invoice */
  batchId?: string;
  documentRef?: string;
  serials?: string;
  /**
   * Snapshot serial info at the time of posting, used to rollback precisely when deleting a history row.
   * - IMPORT: serials added with inbound VAT rate
   * - EXPORT: serials removed (captured from inventory at export time)
   */
  serialInfoSnapshot?: SerialInfo[];
  exportPurpose?: string;
  costObjectType?: 'BOM_PARENT';
  costObjectId?: string;
  costObjectName?: string;
  costObjectSku?: string;
  bomDefinitionId?: string;
  bomComponentCategory?: Bom154Category;
  bomPlannedQuantity?: number;
  bomLossRate?: number;
  bomVarianceReason?: string;
  productionOrderId?: string;
  productionOrderCode?: string;
  postingMode?: 'STANDARD' | 'PRODUCTION_RECEIPT' | 'PRODUCTION_ISSUE';
  // Optional: record payment selection used when auto-posting invoice/fund entries
  paymentStatus?: 'PAID' | 'PENDING';
  paymentMethod?: 'CASH' | 'BANK';
}

export interface InventoryWarehouseBalance {
  warehouseId: string;
  quantity: number;
  serials?: string[];
  serialDetails?: SerialInfo[];
  updatedAt?: string;
}

export interface FundTransaction extends BankAccountSnapshot {
  id: string;
  voucherNumber?: string;
  date: string;
  type: 'RECEIPT' | 'PAYMENT';
  method: 'CASH' | 'BANK';
  amount: number;
  payerReceiver: string;
  description: string;
  category: string;
  status: 'COMPLETED' | 'PENDING' | 'CANCELLED';
  referenceDoc?: string;
  accountingType?: string;
}

export interface AccountDefinition {
  id: string;
  code: string;
  name: string;
  type: 'Dư Nợ' | 'Dư Có' | 'Lưỡng tính';
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  taxCode?: string;
  address?: string;
  phone?: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  taxCode?: string;
  address?: string;
  phone?: string;
}

export type OpeningDebtKind = 'CUSTOMER_DEBT' | 'SUPPLIER_DEBT';

export type OpeningDebtRevenueType =
  | 'BAN_HANG_HOA'
  | 'CUNG_CAP_DICH_VU'
  | 'XAY_LAP_DU_AN'
  | 'MUA_HANG_HOA'
  | 'MUA_DICH_VU'
  | 'TAI_SAN_CCDC'
  | 'KHAC';

export interface OpeningBalanceDebtDetail {
  id: string;
  kind: OpeningDebtKind;
  partnerId?: string;
  partnerCode?: string;
  partnerName: string;
  /** Ký hiệu hóa đơn (theo HĐ gốc / TT32), VD: 1C23TYY — dùng khi lập phiếu thu/chi đúng đối tượng */
  invoiceSymbolCode?: string;
  invoiceNo: string;
  revenueType: OpeningDebtRevenueType;
  amount: number;
  dueDate?: string;
  note?: string;
  accountCode?: '131' | '331';
  sourceInvoiceId?: string;
  sourceInvoiceNumber?: string;
  sourceInvoiceDate?: string;
  sourceYearKey?: string;
  openingYearKey?: string;
  originMode?: 'MANUAL' | 'ROLLOVER';
  readOnly?: boolean;
  lockReason?: string;
  syncStatus?: 'MATCHED' | 'MISMATCHED' | 'STALE';
}

export interface OpeningBalanceAccountRecord {
  accountCode: string;
  debit: number;
  credit: number;
  originMode?: 'MANUAL' | 'ROLLOVER' | 'SYNC_FROM_DEBT';
  readOnly?: boolean;
  lockReason?: string;
}

export interface OpeningBalanceRolloverMeta {
  sourceYearKey: string;
  generatedAt: string;
  lockedAccountCodes?: string[];
  lockedDebtKinds?: OpeningDebtKind[];
}

export interface Employee {
  id: string;
  code: string;
  name: string;
  position?: string;
  department?: string;
}

/** Một lần điều chuyển tài sản giữa các bộ phận. */
export interface AssetTransferRecord {
  id: string;
  transferDate: string;
  fromDepartment: string;
  toDepartment: string;
  responsiblePersonId?: string;
  responsiblePersonName?: string;
  reason?: string;
  /** Số phiếu điều chuyển (hàng loạt). */
  slipNumber?: string;
  createdAt: string;
  createdBy?: string;
}

export interface Asset {
  id: string;
  code: string;
  name: string;
  type: 'TSCĐ' | 'CCDC';
  assetGroup: string;
  assetAccount: string;
  depreciationAccount: string;
  cost: number;
  vatRate?: number;
  vatAmount?: number;
  /** Thông tin hóa đơn mua tài sản/CCDC (snapshot) */
  purchaseInvoiceNumber?: string;
  /** Mẫu số hóa đơn */
  purchaseFormNo?: string;
  /** Ký hiệu hóa đơn */
  purchaseSymbolCode?: string;
  buyDate: string;
  useDate: string;
  usefulLife: number;
  /** TSCĐ: hao mòn lũy kế (TK 214). Luôn 0 với CCDC. */
  accumulatedDepreciation: number;
  /** CCDC: phân bổ lũy kế (TK 242). Luôn 0 với TSCĐ. */
  accumulatedAllocation: number;
  residualValue: number;
  department: string;
  /** Người chịu trách nhiệm hiện tại (sau điều chuyển gần nhất). */
  responsiblePersonId?: string;
  responsiblePersonName?: string;
  /** Lịch sử điều chuyển bộ phận. */
  transferHistory?: AssetTransferRecord[];
  status: 'ACTIVE' | 'LIQUIDATED';
  supplierName?: string;
  supplierAddress?: string;
  supplierTaxCode?: string;
  supplierPhone?: string;
  /** TSCĐ: giá trị thu hồi dự kiến cuối kỳ (khấu hao trên phần NG − giá trị này). */
  salvageValue?: number;
  /** TK chi phí phân bổ/khấu hao: 6421 (CPBH) | 6422 (CPQLDN) | 641 | 627 */
  expenseAccount?: string;
  /**
   * CCDC: STOCK_153 = TK 153 chờ đưa vào SD; IN_USE = đã chuyển 242.
   * Không set = IN_USE (tương thích dữ liệu cũ ghi thẳng 242).
   */
  ccdcLifecycle?: 'STOCK_153' | 'IN_USE';
  /**
   * Tài sản tổng hợp chuyển kỳ: vẫn giữ `cost` là nguyên giá gốc,
   * nhưng phần khấu hao/phân bổ tiếp chỉ chạy trên GTCL mang sang.
   */
  openingCarryForwardResidualBase?: number;
  /** Hao mòn / phân bổ lũy kế đã có ở ngày đầu kỳ. */
  openingCarryForwardAccumulated?: number;
  /** Tổng số tháng khấu hao/phân bổ của lịch gốc để giữ nguyên mức trích khi chuyển kỳ. */
  openingCarryForwardTotalUsefulLifeMonths?: number;
  /** Ngày thanh lý thực tế do người dùng chọn. */
  liquidationDate?: string;
  /** Ngày ghi sổ thực tế sau khi clamp theo niên độ đang mở. */
  liquidationPostingDate?: string;
  /** TSCĐ: phần khấu hao bổ sung đến ngày thanh lý (nếu có). */
  liquidationAdditionalDepreciation?: number;
  /** Giá trị kết chuyển chi phí khi thanh lý: TSCĐ vào 811, CCDC nhiều kỳ vào 627/641/642. */
  liquidationWriteoffAmount?: number;
  /** Giá bán/chuyển nhượng chưa VAT (nếu có). */
  liquidationProceedsAmount?: number;
  liquidationVatRate?: number;
  liquidationVatAmount?: number;
  /** Tổng thu về đã gồm VAT. */
  liquidationTotalAmount?: number;
  /** TK nhận tiền / công nợ cho nghiệp vụ thanh lý (1111 / 112x / 131). */
  liquidationReceiptAccount?: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address?: string;
  isDefault?: boolean;
}

export type ProductionOrderStatus = 'DRAFT' | 'RELEASED' | 'COMPLETED' | 'CANCELLED';

export interface ProductionOrderMaterialLine {
  id: string;
  itemId: string;
  itemName: string;
  itemSku?: string;
  unit?: string;
  requiredQuantity: number;
  actualQuantity: number;
  sourceWarehouseId: string;
  sourceWarehouseName?: string;
  bomComponentCategory?: Bom154Category;
  bomLossRate?: number;
  bomPlannedQuantity?: number;
  note?: string;
}

export interface ProductionOrderOutputLine {
  itemId: string;
  itemName: string;
  itemSku?: string;
  unit?: string;
  quantity: number;
  targetWarehouseId: string;
  targetWarehouseName?: string;
  unitCost?: number;
  totalCost?: number;
}

export interface ProductionOrder {
  id: string;
  orderNumber: string;
  parentItemId: string;
  parentItemName: string;
  parentItemSku?: string;
  bomDefinitionId: string;
  bomVersionCode?: string;
  quantity: number;
  startDate: string;
  dueDate?: string;
  completionDate?: string;
  sourceWarehouseId: string;
  sourceWarehouseName?: string;
  targetWarehouseId: string;
  targetWarehouseName?: string;
  status: ProductionOrderStatus;
  note?: string;
  materials: ProductionOrderMaterialLine[];
  output: ProductionOrderOutputLine;
  shortageCount?: number;
  totalPlannedCost?: number;
  unitPlannedCost?: number;
  releasedAt?: string;
  releasedBy?: string;
  completedAt?: string;
  completedBy?: string;
  linkedIssueTransactionIds?: string[];
  linkedReceiptTransactionIds?: string[];
  linkedJournalEntryIds?: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
}

export interface TaxRate {
  id: string;
  code: string;
  name: string;
  rate: number;
}

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  branch?: string;
  linkedAccountCode: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface BankAccountSnapshot {
  bankAccountId?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  bankBranch?: string;
  bankLedgerAccountCode?: string;
}

export type VoucherType = 'RECEIPT' | 'PAYMENT' | 'PAYMENT_ORDER' | 'BANK_DEBIT' | 'BANK_CREDIT' | 'IMPORT' | 'EXPORT' | 'ADJUSTMENT' | 'GENERAL';
export type VoucherStatus = 'DRAFT' | 'POSTED' | 'LOCKED';

export interface AccountingVoucherDetail {
  id: string;
  description: string;
  account?: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  objectType?: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'ASSET';
  objectId?: string;
  objectName?: string;
}

export interface AccountingVoucher extends BankAccountSnapshot {
  id: string;
  voucherType: VoucherType;
  voucherNumber: string;
  date: string;
  postingDate: string;
  description: string;
  contactName?: string;
  totalAmount: number;
  status: VoucherStatus;
  details: AccountingVoucherDetail[];
  createdBy?: string;
  createdAt?: string;
}

export interface AccountingPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
  lockType?: 'SOFT' | 'HARD';
  lockedBy?: string;
  lockedAt?: string;
}

export interface FinancialYear {
  startDate: string;
  endDate: string;
}

export interface CompanyInfo {
  name: string;
  taxCode: string;
  phone: string;
  fax?: string;
  branchCode?: string;
  address: string;
  city: string;
  country: string;
  email: string;
}

export type AccountingStandard = 'TT133' | 'TT58_2026';

export type Tt58TaxBookProfile =
  | 'GTGT_RATE_TNDN_RATE'
  | 'GTGT_DEDUCT_TNDN_RATE'
  | 'GTGT_RATE_TNDN_INCOME'
  | 'GTGT_DEDUCT_TNDN_INCOME';

export interface AccountingRegimeConfig {
  standard: AccountingStandard;
  /** Ngày bắt đầu áp dụng chế độ kế toán; TT58/2026 có hiệu lực từ 2026-07-01. */
  effectiveFrom: string;
  /** Chọn sổ theo Điều 5-8 TT58/2026/TT-BTC. */
  tt58TaxBookProfile?: Tt58TaxBookProfile;
  /** % thuế TNDN trên doanh thu mặc định (S3a) khi HĐ chưa khai riêng. */
  tt58CitRevenueRatePercent?: number;
  /** @deprecated Dùng tt58PrimaryIndustryIds — giữ để đọc dữ liệu cũ. */
  tt58PrimaryIndustryId?: string;
  /** Ngành nghề kinh doanh của đơn vị (có thể nhiều nhóm A/B/C/D). */
  tt58PrimaryIndustryIds?: string[];
}

/**
 * Số dư đầu kỳ CCDC / TSCĐ khi chuyển kỳ: bước 1 chốt số; bước 2 ghi 1 bút toán Opening (không phải mua lại, không dòng tiền).
 * Báo cáo: Bảng cân đối (211/214 hoặc 242); KQKD qua khấu hao/phân bổ hàng tháng.
 */
export interface OpeningAssetToolCarryForward {
  id: string;
  code?: string;
  name?: string;
  originalCost: number;
  accumulatedDepreciation: number;
  residualCarriedForward: number;
  accountingNote: string;
  /** Thuế GTGT được khấu trừ mang sang đầu kỳ (TK 1331). */
  openingVat1331: number;
  /** TSCĐ: 211 + 214. CCDC: 242 (Nợ nguyên / Có lũy kế cùng 242, thuần = GTCL). */
  carryKind: 'TSCD' | 'CCDC';
  /** TK nợ ghi nguyên giá (vd. 2112, 242). */
  accountOriginal?: string;
  /** TSCĐ: TK có hao mòn (vd. 214). CCDC: thường 242 (cùng TK, dòng Có lũy kế). */
  accountAccumulated?: string;
  /** TK đối ứng nguồn vốn đầu kỳ (vd. 4111). */
  accountEquity?: string;
  /** Tổng số tháng KH/phân bổ theo quyết định (dùng để suy ra tháng còn lại = tổng − đã trích theo lũy kế). */
  totalUsefulLifeMonths?: number;
  /** Số tháng khấu hao/phân bổ còn lại — có thể tự điền từ tổng tháng + lũy kế. */
  usefulLifeMonths?: number;
  /** Đã ghi bút toán đầu kỳ (một lần / ghi đè khi bấm lại). */
  openingEntryPosted?: boolean;
  openingPostedAt?: string;
  /** ReferenceId bút Opening của riêng dòng này. */
  openingEntryReferenceId?: string;
  /** Tài sản tổng hợp để chạy khấu hao tiếp (không tính lại từ năm mua). */
  syntheticAssetId?: string;
}

export interface SystemConfig {
  initializationDate: string;
  accountingRegime?: AccountingRegimeConfig;
  // Backward compatible: older states used boolean `isOpeningBalanceLocked`.
  isOpeningBalanceLocked?: boolean;
  openingBalanceLock?: 'OPEN' | 'SOFT' | 'HARD';
  openingBalanceLockedBy?: string;
  openingBalanceLockedAt?: string;
  openingAssetToolCarryForwards?: OpeningAssetToolCarryForward[];
  openingAssetToolCarryForward?: OpeningAssetToolCarryForward;
}

export interface CITExpenseMeta {
  journalEntryId: string;
  isDeductible: boolean;
  reason?: string;
}

export interface CITLossRecord {
  id: string;
  year: number;
  lossAmount: number;
  transferredAmount: number;
  remainingAmount: number;
}
