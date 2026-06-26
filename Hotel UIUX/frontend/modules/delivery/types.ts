
// Enum for Module Names
export enum ModuleName {
  DASHBOARD = 'DASHBOARD',
  DISTRIBUTORS = 'DISTRIBUTORS',
  PRODUCTS = 'PRODUCTS',
  ORDERS = 'ORDERS',
  DISPATCH = 'DISPATCH',
  FLEET = 'FLEET',
  REPORTS = 'REPORTS'
}

// Module 1: Nhà Phân Phối (NPP)
export interface Distributor {
  id: string;
  name: string;
  address: string;
  region: string; // Khu vực / Tuyến
  phone: string;
  operator: string; // Người phụ trách vận hành
  deliveryType: 'PICKUP' | 'DELIVERY' | 'INTERNAL'; // Đến kho nhận / Giao tận nơi / Giao nội bộ
}

// Module 2: Sản phẩm
export interface Product {
  id: string;
  name: string;
  category: string; // 85g, Đã nem 20, Lá...
  unit: string; // ĐVT
  price: number;
  weightKg: number; // For load calculation
  /** Liên kết Danh mục → Hàng hóa - Vật tư (inventoryCatalog) */
  catalogItemId?: string;
  sku?: string;
  // === Kích thước kiện (tùy chọn) cho 3D Bin Packing ===
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  fragile?: boolean;
  stackable?: boolean;
  allowRotation?: boolean;
}

// Module 3: Đơn hàng
export enum OrderType {
  DISTRIBUTOR = 'Giao NPP',
  INTERNAL = 'Giao nội bộ'
}

export enum OrderStatus {
  CREATED = 'Khởi tạo',
  WAREHOUSE_DISPATCH = 'Duyệt kho - Xuất hàng',
  IN_TRANSIT = 'Đang vận chuyển',
  DELIVERED = 'Đã giao',
  RETURNED = 'Đã hoàn/Trả lại',
  PARTIAL_RETURNED = 'Hoàn một phần', // New Status
  RECONCILED = 'Đối soát xong'
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  returnedQuantity?: number; // New field for partial returns
}

export interface Order {
  id: string; // Mã đơn giao
  type: OrderType; // Loại đơn
  distributorId?: string; // Optional if internal
  distributorName: string; // Denormalized for display (or Destination Name for internal)
  
  fromWarehouse: string; // Kho xuất
  toWarehouse?: string; // Kho nhập (if internal)
  
  requestDate: string;
  returnDate?: string; // New field for Return Date
  month: string; // YYYY-MM
  items: OrderItem[];
  totalQuantity: number;
  totalWeight: number; // Calculated
  note: string;
  status: OrderStatus;
  tripId?: string; // Assigned trip

  // === Tối ưu điều phối (tùy chọn) ===
  cbm?: number; // Thể tích m³ (nếu trống sẽ ước lượng từ trọng lượng)
  pallets?: number; // Số pallet
  priority?: number; // 1 (thấp) → 5 (cao)
  isVip?: boolean; // Khách VIP
  fragile?: boolean; // Hàng dễ vỡ
  requiresCooling?: boolean; // Cần xe lạnh
  isDangerous?: boolean; // Hàng nguy hiểm
  destinationLat?: number;
  destinationLng?: number;
  distanceKm?: number; // Khoảng cách giao (nếu trống sẽ ước lượng)
}

// Module 3 Extended: Nhập kho (Hàng hoàn)
export interface WarehouseReceipt {
  id: string; // Mã phiếu nhập
  date: string;
  type: 'RETURN'; // Nhập hàng hoàn
  orderId: string; // Từ đơn hàng nào
  receiver?: string; // Người nhận hàng (Thủ kho/Admin)
  receiverPhone?: string; // SĐT người nhận
  returnWarehouse?: string; // NEW: Kho nhận hàng hoàn
  returnWarehouseAddress?: string; // NEW: Địa chỉ kho nhận hàng hoàn
  items: { 
    productId: string; 
    productName: string; 
    quantity: number;
  }[];
  note: string;
}

// Module 3 Extended: Lịch sử hoàn hàng (Log)
export interface ReturnLog {
  id: string;
  date: string;
  vehicleId: string;
  vehiclePlate: string;
  tripId: string;
  returnWarehouse: string;
  returnWarehouseAddress?: string; // NEW FIELD
  receiver?: string; // Người nhận hàng hoàn
  receiverPhone?: string; // SĐT người nhận
  items: {
    orderId: string;
    distributorName: string;
    productName: string;
    quantity: number;
  }[];
  note: string;
}

// Module 5: Salary Calculation Methods
export enum SalaryMethod {
  TRIP = 'TRIP', // Đơn giá/chuyến * số chuyến
  TON = 'TON',   // Đơn giá/tấn * số tấn hàng
  TON_KM = 'TON_KM', // Tấn * số km * đơn giá
  POINT = 'POINT', // Đơn giá/điểm giao * số điểm giao
  KM = 'KM', // Default old method: Km * Price
  BOX = 'BOX', // Đơn giá * Số thùng
  ORDER = 'ORDER', // Đơn giá * Số đơn hàng
  DAY = 'DAY' // Lương ngày * Số ngày công
}

// Module 5: Insurance Calculation Mode
export enum InsuranceMode {
  NONE = 'NONE',
  EMPLOYEE = 'EMPLOYEE', // NLĐ (10.5%)
  EMPLOYER = 'EMPLOYER'  // NSDLĐ (21.5%)
}

// Module 5: Xe và Tài xế
export interface Vehicle {
  id: string;
  plateNumber: string; // Biển số
  internalCode: string; // Số xe nội bộ
  type: string; // 3.5t, 5t...
  capacityKg: number; // Tải trọng
  preferredRoute: string; // Tuyến ưu tiên
  status: 'AVAILABLE' | 'MAINTENANCE' | 'BUSY';
  
  // Compliance & Maintenance
  registrationExpiry?: string; // Hạn đăng ký
  inspectionExpiry?: string; // Hạn đăng kiểm
  insuranceExpiry?: string; // Hạn bảo hiểm
  nextMaintenanceDate?: string; // Lịch bảo dưỡng tiếp theo

  // Driver Info (Updated)
  driverName: string;
  driverPhone: string;
  driverIdCard?: string; // CCCD
  driverDob?: string; // Ngày sinh
  driverGender?: 'Nam' | 'Nữ'; // Giới tính
  driverLicenseNumber?: string; // Số GPLX
  driverLicenseExpiry?: string; // Ngày hết hạn GPLX
  driverContractInfo?: string; // Thông tin HĐLĐ (Số HĐ, Ngày ký...)
  
  // Salary Config (Cấu hình lương)
  baseSalary?: number; // Lương cơ bản
  insuranceAmount?: number; // Mức đóng bảo hiểm (Calculated result)
  
  // Insurance Config Details
  insuranceMode?: InsuranceMode; // Phương án tính BH
  insuranceBaseType?: 'ACTUAL' | 'CEILING'; // Phương pháp tính lương đóng BHXH: Thực tế vs Mức trần
  baseSalaryRate?: number; // Mức lương cơ sở (để tính mức trần)
  fixedOtherAllowance?: number; // Phụ cấp khác (Cố định)
  fixedSupplement?: number; // Khoản bổ sung khác (Cố định)
  
  // PIT Config (Thuế TNCN)
  enablePIT?: boolean; // Bật tính thuế TNCN
  numberOfDependents?: number; // Số người phụ thuộc
  charitableContributions?: number; // Đóng góp từ thiện, nhân đạo, khuyến học

  standardAllowance?: number; // Phụ cấp cố định (Ăn trưa/Điện thoại)
  responsibilityAllowance?: number; // Phụ cấp trách nhiệm
  positionAllowance?: number; // Phụ cấp chức vụ
  hazardousAllowance?: number; // Phụ cấp độc hại
  
  // Salary Method Config
  salaryMethods?: SalaryMethod[]; // UPDATED: Array of methods
  pricePerKm?: number; // Đơn giá theo Km
  pricePerTrip?: number; // Đơn giá theo Chuyến
  pricePerTon?: number; // Đơn giá theo Tấn
  pricePerTonKm?: number; // Đơn giá Tấn*Km
  tonKmCoefficient?: number; // Hệ số Tấn*Km
  pricePerPoint?: number; // Đơn giá điểm giao
  pricePerBox?: number; // Đơn giá theo thùng
  pricePerOrder?: number; // Đơn giá theo đơn hàng
  pricePerDay?: number; // Lương ngày

  // New field for Grouping
  category?: 'TRUCK' | 'COACH' | 'CONTRACT'; // Xe tải, Xe khách, Xe hợp đồng

  // === Tối ưu điều phối: kích thước thùng & sức chứa (tùy chọn) ===
  cargoLengthCm?: number; // Dài lòng thùng
  cargoWidthCm?: number; // Rộng lòng thùng
  cargoHeightCm?: number; // Cao lòng thùng
  volumeCapacityCbm?: number; // Sức chứa thể tích m³ (nếu trống sẽ ước lượng)
  palletCapacity?: number; // Số pallet tối đa
  frontAxleMaxKg?: number; // Tải trọng trục trước tối đa
  rearAxleMaxKg?: number; // Tải trọng trục sau tối đa
  doorPosition?: 'REAR' | 'SIDE'; // Vị trí cửa
  cooling?: boolean; // Xe lạnh
  allowDangerousGoods?: boolean; // Cho phép chở hàng nguy hiểm
  fuelConsumption?: number; // Mức tiêu hao nhiên liệu (L/100km)
  fuelPrice?: number; // Giá nhiên liệu (đồng/L)
  gpsLat?: number; // Vị trí GPS hiện tại
  gpsLng?: number;
}

// Module 5 Extended: Chi phí & Bảo trì
export enum CostType {
  FUEL = 'Nhiên liệu',
  MAINTENANCE = 'Bảo dưỡng/Sửa chữa',
  TOLL = 'Phí cầu đường',
  INSURANCE = 'Phí bảo hiểm',
  REGISTRATION = 'Phí đăng kiểm/ĐK',
  OTHER = 'Khác'
}

export interface CostRecord {
  id: string;
  vehicleId: string;
  vehiclePlate: string;
  date: string;
  type: CostType;
  amount: number;
  note: string;
  
  // Detailed cost breakdown
  quantity?: number; // Số lượng (lít, lần, cái...)
  unitPrice?: number; // Đơn giá
  vat?: number; // % VAT
}

// Module 5 Extended: Tạm ứng & Quyết toán
export interface AdvanceRecord {
  id: string;
  vehicleId: string; // Linked to vehicle/driver
  vehiclePlate: string;
  date: string;
  amount: number;
  note: string;
  type?: 'ADVANCE' | 'REFUND'; // Tạm ứng hoặc Hoàn ứng
  
  // Settlement Details (Calculated fields for Refund)
  totalAdvanceAmount?: number; // Số tiền đã tạm ứng
  costFuel?: number; // Chi phí xăng dầu
  costToll?: number; // Chi phí cầu đường
  costOther?: number; // Chi phí khác
  
  settlementMode?: 'CASH' | 'SALARY'; // NEW: Hình thức quyết toán (Tiền mặt / Lương)
  status?: 'OPEN' | 'LOCKED' | 'REFUNDED' | 'ADVANCED'; // UPDATED: Trạng thái phiếu (Added ADVANCED)
}

// Module 5 Extended: Quản lý lương (Updated)
export interface SalaryRecord {
  id: string;
  vehicleId: string;
  driverName: string;
  month: string; // YYYY-MM
  
  // 1. Công & Lương cứng
  workDays: number | string; // Số ngày công (String allows partial typing)
  
  // Input vars for calculation (String allows decimal typing like "0.")
  startKm?: number | string; // Km đầu kỳ
  endKm?: number | string; // Km cuối kỳ
  totalKm?: number | string; // Tổng số Km trong tháng
  totalTrips?: number | string; // Tổng số chuyến
  totalTons?: number | string; // Tổng sản lượng (Tấn)
  totalPoints?: number | string; // Tổng điểm giao
  totalBoxes?: number | string; // Tổng số thùng
  totalOrders?: number | string; // Tổng số đơn hàng
  
  salaryMethods?: SalaryMethod[]; // Các phương pháp áp dụng trong tháng này
  tonKmCoefficient?: number; // Hệ số Tấn*Km áp dụng

  baseSalary: number; // Lương cơ bản
  
  // 2. Thu nhập biến đổi
  tripAllowance: number; // Tiền chuyến / Doanh số / Tiền Km (Calculated Result)
  kpiScore: number; // Điểm KPI (0-100)
  kpiBonus: number; // Thưởng KPI
  mealAllowance: number; // Phụ cấp ăn/điện thoại
  responsibilityAllowance: number; // Phụ cấp trách nhiệm
  positionAllowance: number; // Phụ cấp chức vụ
  hazardousAllowance: number; // Phụ cấp độc hại
  otherBonus: number; // Thưởng khác (Thưởng nóng)
  
  // 3. Khấu trừ
  advances: number; // Trừ tạm ứng
  insurance: number; // Trừ bảo hiểm
  otherDeductions: number; // Phạt/Khác
  personalIncomeTax: number; // Thuế TNCN (New Field)
  
  totalIncome: number; // Tổng thu nhập (Chưa trừ)
  totalReceived: number; // Thực lĩnh (Calculated)
  
  status: 'DRAFT' | 'PAID';
  attendanceStatus?: 'DRAFT' | 'CONFIRMED' | 'LOCKED'; // NEW FIELD: Trạng thái bảng công
  paymentDate?: string;
  note?: string;
}

// Module 4: Chuyến xe (Trip)
export enum TripStatus {
  PLANNED = 'Lên kế hoạch',
  WAITING_LOAD = 'Chờ bốc xếp',
  LOADING = 'Đang bốc hàng',
  IN_TRANSIT = 'Đang vận chuyển',
  DELIVERING = 'Đang trả hàng',
  RETURNING = 'Đang hoàn hàng', // New Status
  COMPLETED = 'Hoàn thành'
}

export interface Trip {
  id: string;
  code: string;
  date: string;
  vehicleId: string;
  vehiclePlate: string;
  driverName: string;
  route: string;
  maxCapacity: number;
  currentLoad: number;
  orders: Order[]; // Phân đơn vào chuyến
  note: string;
  status: TripStatus;
  distanceKm?: number; // Khoảng cách chuyến (NEW)
  
  // Return Workflow
  returnStatus?: 'NONE' | 'REQUESTED' | 'APPROVED'; // Trạng thái yêu cầu hoàn
  returnWarehouse?: string; // Kho nhận hàng hoàn
}

// Module 6: Nhật ký giao hàng
export interface DeliveryLog {
  id: string;
  tripId: string;
  orderId: string;
  timestamp: string;
  receiver: string;
  photoUrl?: string;
  note: string;
}
