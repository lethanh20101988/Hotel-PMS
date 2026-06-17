
import { Room, RoomStatus, InventoryItem, ServiceItem, RoomTypeConfig, Expense } from './types';

export const MOCK_ROOM_TYPES: RoomTypeConfig[] = [
  {
    id: 'rt1',
    name: 'Phòng Đơn',
    code: 'Standard',
    image: 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&q=80&w=600',
    priceHourly: 50000,
    priceDaily: 300000,
    priceOvernight: 200000,
    amenities: ['Wifi', 'TV', 'Máy sấy']
  },
  {
    id: 'rt2',
    name: 'Phòng Đôi',
    code: 'Double',
    image: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&q=80&w=600',
    priceHourly: 70000,
    priceDaily: 400000,
    priceOvernight: 250000,
    amenities: ['Wifi', 'TV', 'Minibar', 'Bàn làm việc']
  },
  {
    id: 'rt3',
    name: 'Suite Gia Đình',
    code: 'VIP', // Mapping to 'VIP' in MOCK_ROOMS
    image: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&q=80&w=600',
    priceHourly: 100000,
    priceDaily: 800000,
    priceOvernight: 500000,
    amenities: ['Wifi', 'TV', 'Bếp', 'Bồn tắm', 'View biển']
  }
];

export const MOCK_ROOMS: Room[] = [
  { id: '101', number: '101', floor: 1, type: 'Standard', status: RoomStatus.AVAILABLE, priceHourly: 50000, priceDaily: 300000, priceOvernight: 200000, inventory: {} },
  { id: '102', number: '102', floor: 1, type: 'Standard', status: RoomStatus.OCCUPIED, priceHourly: 50000, priceDaily: 300000, priceOvernight: 200000, inventory: {} },
  { id: '103', number: '103', floor: 1, type: 'Standard', status: RoomStatus.DIRTY, priceHourly: 50000, priceDaily: 300000, priceOvernight: 200000, inventory: {} },
  { id: '104', number: '104', floor: 1, type: 'Double', status: RoomStatus.AVAILABLE, priceHourly: 70000, priceDaily: 400000, priceOvernight: 250000, inventory: {} },
  { id: '105', number: '105', floor: 1, type: 'VIP', status: RoomStatus.MAINTENANCE, priceHourly: 100000, priceDaily: 800000, priceOvernight: 500000, inventory: {} },
  { id: '201', number: '201', floor: 2, type: 'Standard', status: RoomStatus.AVAILABLE, priceHourly: 50000, priceDaily: 300000, priceOvernight: 200000, inventory: {} },
  { id: '202', number: '202', floor: 2, type: 'Standard', status: RoomStatus.BOOKED, priceHourly: 50000, priceDaily: 300000, priceOvernight: 200000, inventory: {} },
  { id: '203', number: '203', floor: 2, type: 'Double', status: RoomStatus.OCCUPIED, priceHourly: 70000, priceDaily: 400000, priceOvernight: 250000, inventory: {} },
  { id: '204', number: '204', floor: 2, type: 'Double', status: RoomStatus.AVAILABLE, priceHourly: 70000, priceDaily: 400000, priceOvernight: 250000, inventory: {} },
  { id: '205', number: '205', floor: 2, type: 'VIP', status: RoomStatus.AVAILABLE, priceHourly: 100000, priceDaily: 800000, priceOvernight: 500000, inventory: {} },
];

// Dịch vụ tĩnh (Không phải hàng hóa tồn kho)
export const MOCK_SERVICES: ServiceItem[] = [
  { id: 's4', name: 'Giặt ủi (kg)', price: 30000, category: 'LAUNDRY' },
  { id: 's5', name: 'Thuê xe máy (ngày)', price: 150000, category: 'OTHER' },
  { id: 's6', name: 'Dọn phòng thêm', price: 50000, category: 'OTHER' },
];

export const MOCK_INVENTORY: InventoryItem[] = [
  { id: 'i1', name: 'Nước suối Aquafina', quantity: 120, minThreshold: 24, unit: 'Chai', costPrice: 5000 },
  { id: 'i2', name: 'Bia Heineken', quantity: 45, minThreshold: 24, unit: 'Lon', costPrice: 18000 },
  { id: 'i3', name: 'Mì ly Modern', quantity: 50, minThreshold: 10, unit: 'Ly', costPrice: 8000 },
  { id: 'i4', name: 'Snack khoai tây', quantity: 30, minThreshold: 5, unit: 'Gói', costPrice: 6000 },
  { id: 'i5', name: 'Nước ngọt Coca', quantity: 200, minThreshold: 50, unit: 'Lon', costPrice: 8000 },
];

export const MOCK_EXPENSES: Expense[] = [
  { id: 'e1', name: 'Nhập Bia Heineken (5 thùng)', amount: 2500000, category: 'IMPORT', date: '2023-10-23' },
  { id: 'e2', name: 'Tiền điện tháng 10', amount: 5400000, category: 'UTILITY', date: '2023-10-25' },
  { id: 'e3', name: 'Sửa điều hòa P.201', amount: 800000, category: 'MAINTENANCE', date: '2023-10-26' },
  { id: 'e4', name: 'Nhập Nước suối', amount: 500000, category: 'IMPORT', date: '2023-10-27' },
];