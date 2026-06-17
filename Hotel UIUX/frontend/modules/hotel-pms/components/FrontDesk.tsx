import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  LogIn,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { formatCurrency, formatDate } from '../utils';
import { Booking, Room, RoomStatus, RoomTypeConfig } from '../types';
import { fd, ROOM_STATUS_META } from './frontDeskTheme';
import { BookingListSkeleton, DetailPanelSkeleton } from './FrontDeskSkeleton';

type SideTab = 'detail' | 'bookings';

interface FrontDeskProps {
  bookings: Booking[];
  rooms: Room[];
  roomTypes: RoomTypeConfig[];
  selectedRoom: Room | null;
  isLoading?: boolean;
  onNewBooking: () => void;
  onCheckOut: (bookingId: string) => void;
  onCheckIn: (bookingId: string) => void;
  onEditBooking: (booking: Booking) => void;
  onExtendBooking: (booking: Booking) => void;
  onDeleteBooking: (bookingId: string) => void | Promise<void>;
  onSelectRoom: (room: Room, booking?: Booking | null) => void;
  onBookRoom: () => void;
}

const BOOKING_FILTERS = ['Tất cả', 'Chờ xử lý', 'Đã Check-in', 'Đã Check-out'] as const;
const DETAIL_LOAD_MS = 160;

export const FrontDesk: React.FC<FrontDeskProps> = ({
  bookings,
  rooms,
  roomTypes,
  selectedRoom,
  isLoading = false,
  onNewBooking,
  onCheckOut,
  onCheckIn,
  onEditBooking,
  onExtendBooking,
  onDeleteBooking,
  onSelectRoom,
  onBookRoom,
}) => {
  const [sideTab, setSideTab] = useState<SideTab>('detail');
  const [detailLoading, setDetailLoading] = useState(false);
  const [bookingFilter, setBookingFilter] = useState<string>('Tất cả');
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; bookingId: string | null }>({
    isOpen: false,
    bookingId: null,
  });

  const typeName = (code: string) =>
    roomTypes.find((rt) => rt.code === code)?.name || code;

  useEffect(() => {
    if (!selectedRoom) return;
    setSideTab('detail');
    setDetailLoading(true);
    const t = window.setTimeout(() => setDetailLoading(false), DETAIL_LOAD_MS);
    return () => window.clearTimeout(t);
  }, [selectedRoom?.id]);

  const roomBooking = useMemo(() => {
    if (!selectedRoom) return null;
    return (
      bookings.find((b) => b.roomId === selectedRoom.id && b.status === 'active') ||
      bookings.find((b) => b.roomId === selectedRoom.id && b.status === 'pending') ||
      bookings.find((b) => b.roomId === selectedRoom.id && b.status === 'completed')
    );
  }, [bookings, selectedRoom]);

  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (bookingFilter === 'Tất cả') return true;
      if (bookingFilter === 'Chờ xử lý') return b.status === 'pending';
      if (bookingFilter === 'Đã Check-in') return b.status === 'active';
      if (bookingFilter === 'Đã Check-out') return b.status === 'completed';
      return true;
    });
  }, [bookings, bookingFilter]);

  const sortedBookings = [...filteredBookings].sort(
    (a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime(),
  );

  const getRoom = (roomId: string) => rooms.find((r) => r.id === roomId);

  const confirmDelete = async () => {
    if (deleteModal.bookingId) await onDeleteBooking(deleteModal.bookingId);
    setDeleteModal({ isOpen: false, bookingId: null });
  };

  const pendingDeleteBooking = deleteModal.bookingId
    ? bookings.find((b) => b.id === deleteModal.bookingId)
    : null;

  const handleBookingCardClick = (item: Booking) => {
    const room = getRoom(item.roomId);
    if (room) onSelectRoom(room, item);
  };

  const statusMeta = selectedRoom ? ROOM_STATUS_META[selectedRoom.status] : null;

  return (
    <div className={`flex flex-col h-full overflow-hidden ${fd.panel} ${fd.font}`}>
      <div className="shrink-0 px-3 pt-3 pb-0">
        <div className={fd.segmentedWrap}>
          <button
            type="button"
            onClick={() => setSideTab('detail')}
            className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-all duration-200 ${
              sideTab === 'detail' ? fd.segmentedActive : fd.segmentedInactive
            }`}
          >
            Chi tiết phòng
          </button>
          <button
            type="button"
            onClick={() => setSideTab('bookings')}
            className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-all duration-200 ${
              sideTab === 'bookings' ? fd.segmentedActive : fd.segmentedInactive
            }`}
          >
            Đặt phòng gần đây
            {sortedBookings.length > 0 && (
              <span className="ml-1 text-[10px] text-gray-400">{sortedBookings.length}</span>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col mt-3">
        {sideTab === 'detail' ? (
          <div className="flex-1 overflow-y-auto px-4 pb-5">
            {isLoading ? (
              <DetailPanelSkeleton />
            ) : !selectedRoom ? (
              <div className="flex flex-col items-center justify-center min-h-[220px] text-center px-3">
                <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center mb-3">
                  <MapPin size={16} className="text-gray-400" />
                </div>
                <p className={`${fd.body} font-medium text-gray-600`}>Chưa chọn phòng</p>
                <p className={`${fd.caption} mt-1.5 max-w-[220px]`}>
                  Click phòng trên sơ đồ để xem chi tiết · Double-click để thao tác nhanh
                </p>
              </div>
            ) : detailLoading ? (
              <DetailPanelSkeleton />
            ) : (
              <div className="space-y-5 animate-in fade-in duration-200">
                <div>
                  <p className={fd.label}>Phòng</p>
                  <div className="flex items-start justify-between gap-3 mt-1">
                    <div>
                      <h2 className={fd.heading}>{selectedRoom.number}</h2>
                      <p className={`${fd.caption} mt-1`}>
                        Tầng {selectedRoom.floor} · {typeName(selectedRoom.type)}
                      </p>
                    </div>
                    {statusMeta && (
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${statusMeta.badge}`}
                      >
                        {statusMeta.label}
                      </span>
                    )}
                  </div>
                </div>

                {roomBooking ? (
                  <div className="rounded-lg border border-gray-100 bg-gray-50/40 p-3 space-y-3">
                    <div>
                      <p className={fd.label}>Tên khách</p>
                      <p className={`${fd.body} font-medium mt-1`}>
                        {roomBooking.customer.name}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                        <p className={fd.label}>Check-in</p>
                        <p className={`${fd.body} font-medium mt-1`}>
                          {formatDate(roomBooking.checkIn)}
                        </p>
                      </div>
                      <div className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                        <p className={fd.label}>Check-out</p>
                        <p className={`${fd.body} font-medium mt-1`}>
                          {formatDate(roomBooking.checkOutActual || roomBooking.checkOutExpected)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <span className={fd.muted}>Tổng tiền</span>
                      <span className={`text-sm font-medium ${fd.accent}`}>
                        {formatCurrency(roomBooking.finalTotal)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/30 px-3 py-5 text-center">
                    <p className={fd.muted}>Phòng chưa có khách hoặc đặt phòng.</p>
                  </div>
                )}

                <div className="space-y-2">
                  {roomBooking?.status === 'active' && (
                    <>
                      <button
                        type="button"
                        onClick={() => onCheckOut(roomBooking.id)}
                        className={`w-full ${fd.btnPrimary}`}
                      >
                        <LogOut size={14} />
                        Check-out
                      </button>
                      <button
                        type="button"
                        onClick={() => onExtendBooking(roomBooking)}
                        className={`w-full ${fd.btnOutline}`}
                      >
                        <CalendarClock size={14} />
                        Gia hạn
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => onEditBooking(roomBooking)}
                          className={fd.btnOutline}
                        >
                          <Pencil size={13} />
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteModal({ isOpen: true, bookingId: roomBooking.id })}
                          className={fd.btnDanger}
                        >
                          <Trash2 size={13} />
                          Xóa
                        </button>
                      </div>
                    </>
                  )}

                  {roomBooking?.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        onClick={() => onCheckIn(roomBooking.id)}
                        className={`w-full ${fd.btnSuccess}`}
                      >
                        <LogIn size={14} />
                        Check-in
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => onEditBooking(roomBooking)}
                          className={fd.btnOutline}
                        >
                          <Pencil size={13} />
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteModal({ isOpen: true, bookingId: roomBooking.id })}
                          className={fd.btnDanger}
                        >
                          <Trash2 size={13} />
                          Xóa
                        </button>
                      </div>
                    </>
                  )}

                  {(selectedRoom.status === RoomStatus.AVAILABLE ||
                    selectedRoom.status === RoomStatus.DIRTY) &&
                    !roomBooking && (
                      <button type="button" onClick={onBookRoom} className={`w-full ${fd.btnPrimary}`}>
                        <Calendar size={14} />
                        Đặt / Nhận phòng
                      </button>
                    )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="shrink-0 px-4 pb-2.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className={fd.label}>Danh sách đặt phòng</p>
                <button
                  type="button"
                  onClick={onNewBooking}
                  className={`inline-flex items-center gap-1 text-xs font-medium ${fd.accent} ${fd.accentHover} transition-colors`}
                >
                  <Plus size={13} />
                  Thêm mới
                </button>
              </div>
              <div className={fd.segmentedWrap}>
                {BOOKING_FILTERS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setBookingFilter(tab)}
                    className={`flex-1 min-w-fit whitespace-nowrap px-1.5 py-1 rounded-md text-[10px] font-medium transition-all duration-200 ${
                      bookingFilter === tab ? fd.segmentedActive : fd.segmentedInactive
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-5 space-y-2">
              {isLoading ? (
                <BookingListSkeleton />
              ) : sortedBookings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-9 h-9 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center mb-2.5">
                    <Calendar size={16} className="text-gray-400" />
                  </div>
                  <p className={`${fd.body} font-medium text-gray-600`}>Chưa có đặt phòng</p>
                  <button
                    type="button"
                    onClick={onNewBooking}
                    className={`mt-2.5 text-xs font-medium ${fd.accent} ${fd.accentHover}`}
                  >
                    + Tạo đặt phòng mới
                  </button>
                </div>
              ) : (
                sortedBookings.map((item) => {
                  const room = getRoom(item.roomId);
                  const isSelected = selectedRoom?.id === item.roomId;
                  const statusCls =
                    item.status === 'active'
                      ? 'bg-emerald-50/70 text-emerald-600/90 border-emerald-100/80'
                      : item.status === 'pending'
                        ? 'bg-amber-50/70 text-amber-600/90 border-amber-100/80'
                        : 'bg-gray-50 text-gray-500 border-gray-100';

                  return (
                    <div
                      key={item.id}
                      className={`
                        w-full rounded-lg border bg-white
                        shadow-sm transition-all duration-200 ease-out
                        hover:shadow hover:-translate-y-px hover:border-gray-200
                        ${isSelected ? `ring-2 ${fd.accentRing} ${fd.accentBorder} shadow -translate-y-px` : 'border-gray-100'}
                      `}
                    >
                      <div className="flex items-start gap-1 p-2.5">
                        <button
                          type="button"
                          onClick={() => handleBookingCardClick(item)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className={`${fd.body} font-semibold`}>P.{room?.number}</span>
                                <span
                                  className={`text-[10px] font-medium px-1.5 py-px rounded-md border ${statusCls}`}
                                >
                                  {item.status === 'active'
                                    ? 'Đang ở'
                                    : item.status === 'pending'
                                      ? 'Chờ'
                                      : 'Đã trả'}
                                </span>
                              </div>
                              <p className={`${fd.body} font-medium truncate text-gray-600`}>
                                {item.customer.name}
                              </p>
                              <p className={`${fd.label} mt-1`}>
                                {formatDate(item.checkIn)} →{' '}
                                {formatDate(item.checkOutActual || item.checkOutExpected)}
                              </p>
                            </div>
                            <p className={`text-xs font-medium ${fd.accent} shrink-0`}>
                              {formatCurrency(item.finalTotal)}
                            </p>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteModal({ isOpen: true, bookingId: item.id })}
                          className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Xóa đặt phòng"
                          aria-label="Xóa đặt phòng"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {deleteModal.isOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-gray-100 shadow-xl max-w-sm w-full overflow-hidden">
            <div className="p-5 flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center text-red-400 mb-3">
                <AlertTriangle size={18} />
              </div>
              <h3 className="text-base font-medium text-gray-700">Xác nhận xoá đơn</h3>
              <p className={`${fd.muted} mt-1.5`}>
                {pendingDeleteBooking?.status === 'completed'
                  ? 'Đơn đã check-out sẽ bị xóa khỏi Hotel PMS. Hóa đơn & VAT, Sổ nhật ký chung và chứng từ liên kết cũng được gỡ.'
                  : 'Bạn có chắc muốn xoá đơn đặt phòng này? Phòng sẽ trả về trạng thái trống.'}
              </p>
            </div>
            <div className="px-4 pb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDeleteModal({ isOpen: false, bookingId: null })}
                className={fd.btnOutline}
              >
                Huỷ bỏ
              </button>
              <button type="button" onClick={confirmDelete} className={fd.btnDanger}>
                <Trash2 size={13} />
                Xoá ngay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
