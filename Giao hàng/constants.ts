
import { Distributor, Product, Vehicle, Order, OrderStatus, OrderType, CostRecord, CostType, AdvanceRecord } from './types';

export const MOCK_DISTRIBUTORS: Distributor[] = [
  { id: 'NPP01', name: 'NPP Minh Long', address: '123 Nguyễn Huệ, Huế', region: 'Huế - Trung tâm', phone: '0905123456', operator: 'Nguyễn Văn A', deliveryType: 'DELIVERY' },
  { id: 'NPP02', name: 'NPP Hưng Thịnh', address: '45 Điện Biên Phủ, Đà Nẵng', region: 'Đà Nẵng', phone: '0905987654', operator: 'Trần Thị B', deliveryType: 'PICKUP' },
  { id: 'NPP03', name: 'NPP An Khang', address: 'QL1A, Quảng Trị', region: 'Quảng Trị', phone: '0912345678', operator: 'Lê Văn C', deliveryType: 'DELIVERY' },
  { id: 'NPP04', name: 'NPP Phát Đạt', address: 'Hương Sơ, Huế', region: 'Huế - Ngoại thành', phone: '0988776655', operator: 'Phạm Văn D', deliveryType: 'DELIVERY' },
];

export const MOCK_PRODUCTS: Product[] = [
  { id: 'SP01', name: 'Bột chiên giòn 85g', category: '85g', unit: 'Gói', price: 5000, weightKg: 0.085 },
  { id: 'SP02', name: 'Đã nem 20cm', category: 'Đã nem 20', unit: 'Gói', price: 12000, weightKg: 0.2 },
  { id: 'SP03', name: 'Bánh tráng lá', category: 'Lá', unit: 'Xấp', price: 15000, weightKg: 0.5 },
  { id: 'SP04', name: 'Bún khô 500g', category: 'Bún', unit: 'Gói', price: 20000, weightKg: 0.5 },
];

export const MOCK_VEHICLES: Vehicle[] = [
  { 
    id: 'V01', plateNumber: '75C-123.45', internalCode: 'XE-01', type: '3.5 Tấn', capacityKg: 3500, preferredRoute: 'Huế - Quảng Trị', status: 'AVAILABLE', 
    driverName: 'Trần Văn Kiên', driverPhone: '0909000111',
    registrationExpiry: '2024-12-01', inspectionExpiry: '2024-06-01', insuranceExpiry: '2024-12-01', nextMaintenanceDate: '2023-11-15'
  },
  { 
    id: 'V02', plateNumber: '43C-987.65', internalCode: 'XE-02', type: '5 Tấn', capacityKg: 5000, preferredRoute: 'Đà Nẵng', status: 'AVAILABLE', 
    driverName: 'Lê Văn Đức', driverPhone: '0909000222',
    registrationExpiry: '2025-01-15', inspectionExpiry: '2024-05-20', insuranceExpiry: '2025-01-15', nextMaintenanceDate: '2023-12-01'
  },
  { 
    id: 'V03', plateNumber: '75C-555.99', internalCode: 'XE-03', type: '1.5 Tấn', capacityKg: 1500, preferredRoute: 'Huế - Trung tâm', status: 'MAINTENANCE', 
    driverName: 'Nguyễn Văn Nam', driverPhone: '0909000333',
    registrationExpiry: '2023-10-30', inspectionExpiry: '2023-10-28', insuranceExpiry: '2023-11-01', nextMaintenanceDate: '2023-10-25'
  },
];

export const MOCK_ORDERS: Order[] = [
  {
    id: 'DH-1001',
    type: OrderType.DISTRIBUTOR,
    distributorId: 'NPP01',
    distributorName: 'NPP Minh Long',
    fromWarehouse: 'Kho Tổng Huế',
    requestDate: '2023-10-25',
    month: '2023-10',
    items: [
      { productId: 'SP01', productName: 'Bột chiên giòn 85g', quantity: 1000 },
      { productId: 'SP02', productName: 'Đã nem 20cm', quantity: 500 }
    ],
    totalQuantity: 1500,
    totalWeight: 1000 * 0.085 + 500 * 0.2, // 185kg
    note: 'Giao buổi sáng',
    status: OrderStatus.CREATED
  },
  {
    id: 'DH-1002',
    type: OrderType.DISTRIBUTOR,
    distributorId: 'NPP03',
    distributorName: 'NPP An Khang',
    fromWarehouse: 'Kho Tổng Huế',
    requestDate: '2023-10-26',
    month: '2023-10',
    items: [
      { productId: 'SP03', productName: 'Bánh tráng lá', quantity: 2000 },
       { productId: 'SP04', productName: 'Bún khô 500g', quantity: 1000 }
    ],
    totalQuantity: 3000,
    totalWeight: 2000 * 0.5 + 1000 * 0.5, // 1500kg
    note: 'Cần gấp',
    status: OrderStatus.CREATED
  },
   {
    id: 'DH-1003',
    type: OrderType.DISTRIBUTOR,
    distributorId: 'NPP04',
    distributorName: 'NPP Phát Đạt',
    fromWarehouse: 'Kho Tổng Huế',
    requestDate: '2023-10-26',
    month: '2023-10',
    items: [
      { productId: 'SP01', productName: 'Bột chiên giòn 85g', quantity: 5000 },
    ],
    totalQuantity: 5000,
    totalWeight: 5000 * 0.085, // 425kg
    note: 'Giao cùng đơn cũ',
    status: OrderStatus.WAREHOUSE_DISPATCH
  }
];

export const MOCK_COSTS: CostRecord[] = [
  { id: 'C01', vehicleId: 'V01', vehiclePlate: '75C-123.45', date: '2023-10-20', type: CostType.FUEL, amount: 1500000, note: 'Đổ dầu full bình', quantity: 70, unitPrice: 21428, vat: 0 },
  { id: 'C02', vehicleId: 'V01', vehiclePlate: '75C-123.45', date: '2023-10-22', type: CostType.TOLL, amount: 35000, note: 'Trạm Phú Bài', quantity: 1, unitPrice: 35000, vat: 0 },
  { id: 'C03', vehicleId: 'V02', vehiclePlate: '43C-987.65', date: '2023-10-18', type: CostType.MAINTENANCE, amount: 2500000, note: 'Thay nhớt, bảo dưỡng định kỳ', quantity: 1, unitPrice: 2272727, vat: 10 },
  { id: 'C04', vehicleId: 'V03', vehiclePlate: '75C-555.99', date: '2023-10-05', type: CostType.INSURANCE, amount: 4500000, note: 'Tái tục bảo hiểm thân vỏ', quantity: 1, unitPrice: 4500000, vat: 0 },
];

export const MOCK_ADVANCES: AdvanceRecord[] = [
  { id: 'A01', vehicleId: 'V01', vehiclePlate: '75C-123.45', date: '2023-10-01', amount: 5000000, note: 'Tạm ứng đầu tháng' },
  { id: 'A02', vehicleId: 'V02', vehiclePlate: '43C-987.65', date: '2023-10-05', amount: 3000000, note: 'Tạm ứng đi Đà Nẵng' },
];
