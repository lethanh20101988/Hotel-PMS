import { MOCK_INVENTORY, MOCK_ROOM_TYPES, MOCK_ROOMS, MOCK_SERVICES } from './constants';
import type { Booking, Expense, ImportLog, InventoryItem, Room, RoomTypeConfig, ServiceItem } from './types';
import { RoomStatus } from './types';

const STORAGE_KEY = 'vtr_hotel_pms_state_v1';

export type HotelPmsPersistedState = {
  rooms: Room[];
  bookings: Booking[];
  inventory: InventoryItem[];
  importLogs: ImportLog[];
  roomTypes: RoomTypeConfig[];
  expenses: Expense[];
  /** Dịch vụ không gắn tồn kho (giặt ủi, thuê xe…) — hiện ở checkout. */
  services: ServiceItem[];
};

export function getDefaultHotelPmsState(): HotelPmsPersistedState {
  return {
    rooms: MOCK_ROOMS.map(room => ({
      ...room,
      status: RoomStatus.AVAILABLE,
      inventory: {},
    })),
    bookings: [],
    inventory: MOCK_INVENTORY.map((i) => ({ ...i })),
    importLogs: [],
    roomTypes: MOCK_ROOM_TYPES,
    expenses: [],
    services: MOCK_SERVICES.map((s) => ({ ...s })),
  };
}

export function normalizeHotelPmsState(raw: unknown): HotelPmsPersistedState {
  const parsed = raw as Partial<HotelPmsPersistedState> | null | undefined;
  if (!parsed || !Array.isArray(parsed.rooms) || !Array.isArray(parsed.bookings)) {
    return getDefaultHotelPmsState();
  }
  return {
    rooms: parsed.rooms,
    bookings: parsed.bookings,
    inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
    importLogs: Array.isArray(parsed.importLogs) ? parsed.importLogs : [],
    roomTypes: Array.isArray(parsed.roomTypes) ? parsed.roomTypes : MOCK_ROOM_TYPES,
    expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
    services: Array.isArray(parsed.services) ? parsed.services : MOCK_SERVICES.map((s) => ({ ...s })),
  };
}

/** Đọc bản sao legacy từ localStorage (chỉ dùng một lần khi migrate lên SQLite). */
export function loadHotelPmsState(): HotelPmsPersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HotelPmsPersistedState>;
    if (!parsed || !Array.isArray(parsed.rooms) || !Array.isArray(parsed.bookings)) {
      return null;
    }
    return normalizeHotelPmsState(parsed);
  } catch {
    return null;
  }
}

/** @deprecated PMS lưu qua SQLite — chỉ dùng khi migrate legacy localStorage. */
export function saveHotelPmsState(state: HotelPmsPersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota / private mode errors.
  }
}

/** Xóa bản legacy localStorage sau khi đã đồng bộ lên DB. */
export function clearHotelPmsState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore private mode errors.
  }
}
