import { RoomStatus } from '../types';

/** Design tokens — Hotel PMS Lễ tân (minimal / compact) */
export const fd = {
  font: 'font-sans antialiased',
  panel: 'bg-white rounded-lg border border-gray-100 shadow-sm',
  title: 'text-lg font-semibold text-gray-700 tracking-tight',
  heading: 'text-xl font-medium text-gray-700 tracking-tight',
  body: 'text-xs text-gray-700 leading-snug',
  label: 'text-[10px] font-medium text-gray-500 tracking-wide',
  muted: 'text-xs text-gray-500 leading-snug',
  caption: 'text-[10px] text-gray-400 leading-snug',
  accent: 'text-violet-400',
  accentHover: 'hover:text-violet-500',
  accentBg: 'bg-violet-400',
  accentBgHover: 'hover:bg-violet-500',
  accentRing: 'ring-violet-50',
  accentBorder: 'border-violet-300',
  btnPrimary:
    'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-400 text-white hover:bg-violet-500 shadow-sm transition-all duration-200',
  btnSuccess:
    'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm transition-all duration-200',
  btnOutline:
    'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all duration-200',
  btnDanger:
    'inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-red-100 text-red-500 bg-red-50/60 hover:bg-red-50 transition-all duration-200',
  input:
    'w-full px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg bg-gray-50/40 focus:outline-none focus:ring-2 focus:ring-violet-50 focus:border-violet-300 focus:bg-white transition-all',
  segmentedWrap: 'flex p-0.5 bg-gray-50 rounded-lg gap-0.5 border border-gray-100',
  segmentedActive: 'bg-white text-gray-700 shadow-sm border border-gray-100',
  segmentedInactive: 'text-gray-500 hover:text-gray-600 hover:bg-gray-100/80',
  skeleton: 'animate-pulse bg-gray-100 rounded-md',
  floorActive: 'bg-violet-400 text-white shadow-sm',
  floorInactive: 'bg-gray-50 text-gray-500 border border-gray-100 hover:bg-gray-100',
} as const;

export const ROOM_STATUS_META: Record<
  RoomStatus,
  { label: string; badge: string; dot: string; cardTint: string }
> = {
  [RoomStatus.AVAILABLE]: {
    label: 'Trống',
    badge: 'bg-emerald-50/70 text-emerald-600/90 border-emerald-100/80',
    dot: 'bg-emerald-400',
    cardTint: 'hover:border-emerald-200',
  },
  [RoomStatus.OCCUPIED]: {
    label: 'Có khách',
    badge: 'bg-rose-50/70 text-rose-600/90 border-rose-100/80',
    dot: 'bg-rose-400',
    cardTint: 'hover:border-rose-200',
  },
  [RoomStatus.BOOKED]: {
    label: 'Đặt trước',
    badge: 'bg-amber-50/70 text-amber-600/90 border-amber-100/80',
    dot: 'bg-amber-400',
    cardTint: 'hover:border-amber-200',
  },
  [RoomStatus.DIRTY]: {
    label: 'Cần dọn',
    badge: 'bg-gray-50 text-gray-500 border-gray-100',
    dot: 'bg-gray-300',
    cardTint: 'hover:border-gray-300',
  },
  [RoomStatus.MAINTENANCE]: {
    label: 'Bảo trì',
    badge: 'bg-violet-50/70 text-violet-500/90 border-violet-100/80',
    dot: 'bg-violet-300',
    cardTint: 'hover:border-violet-200',
  },
};

export type RoomStatusFilter = 'ALL' | RoomStatus;

export const STATUS_SEGMENTS: { id: RoomStatusFilter; label: string }[] = [
  { id: 'ALL', label: 'Tất cả' },
  { id: RoomStatus.AVAILABLE, label: 'Trống' },
  { id: RoomStatus.OCCUPIED, label: 'Có khách' },
  { id: RoomStatus.BOOKED, label: 'Đặt trước' },
  { id: RoomStatus.MAINTENANCE, label: 'Bảo trì' },
];
