
import React, { useState, useEffect } from 'react';
import { Room, BookingType, Customer, RoomStatus, Booking } from '../types';
import { calculateRoomCharge, formatCurrency, formatNumber, parseNumber } from '../utils';
import { X, Calendar, User, Wallet, Clock, CheckCircle, CalendarClock } from 'lucide-react';

export type BookingModalMode = 'create' | 'edit' | 'extend';

interface BookingModalProps {
  room: Room;
  rooms: Room[];
  isOpen: boolean;
  mode?: BookingModalMode;
  initialBooking?: Booking | null;
  onClose: () => void;
  onSubmit: (bookingData: any) => void;
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export const BookingModal: React.FC<BookingModalProps> = ({
  room,
  rooms,
  isOpen,
  mode = 'create',
  initialBooking = null,
  onClose,
  onSubmit,
}) => {
  const [currentRoom, setCurrentRoom] = useState<Room>(room);

  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [idCard, setIdCard] = useState('');
  const [phone, setPhone] = useState('');
  const [bookingType, setBookingType] = useState<BookingType>(BookingType.DAILY);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [estimatedTotal, setEstimatedTotal] = useState(0);

  const [paymentMode, setPaymentMode] = useState<'LATER' | 'DEPOSIT' | 'FULL'>('LATER');
  const [depositAmount, setDepositAmount] = useState<number>(0);

  const getStatusText = (status: RoomStatus) => {
    switch (status) {
      case RoomStatus.AVAILABLE: return 'Sẵn sàng';
      case RoomStatus.OCCUPIED: return 'Đang có khách';
      case RoomStatus.DIRTY: return 'Chưa dọn';
      case RoomStatus.BOOKED: return 'Đã đặt';
      case RoomStatus.MAINTENANCE: return 'Bảo trì';
      default: return status;
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    if (mode === 'edit' || mode === 'extend') {
      const b = initialBooking;
      if (!b) return;
      const bookingRoom = rooms.find((r) => r.id === b.roomId) || room;
      setCurrentRoom(bookingRoom);
      setCustomerName(b.customer.name);
      setEmail(b.customer.email || '');
      setIdCard(b.customer.identityCard || '');
      setPhone(b.customer.phone || '');
      setBookingType(b.bookingType);
      setCheckIn(toLocalInput(b.checkIn));

      if (mode === 'extend') {
        const extendDate = new Date(b.checkOutExpected || b.checkIn);
        extendDate.setDate(extendDate.getDate() + 1);
        setCheckOut(toLocalInput(extendDate.toISOString()));
      } else {
        setCheckOut(toLocalInput(b.checkOutExpected));
      }

      setPaymentMode(b.deposit > 0 ? (b.deposit >= b.finalTotal ? 'FULL' : 'DEPOSIT') : 'LATER');
      setDepositAmount(b.deposit || 0);
      return;
    }

    setCurrentRoom(room);
    const now = new Date();
    const nowStr = toLocalInput(now.toISOString());
    setCheckIn(nowStr);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setCheckOut(toLocalInput(tomorrow.toISOString()));
    setCustomerName('');
    setEmail('');
    setIdCard('');
    setPhone('');
    setBookingType(BookingType.DAILY);
    setPaymentMode('LATER');
    setDepositAmount(0);
  }, [isOpen, room, mode, initialBooking, rooms]);

  useEffect(() => {
    if (checkIn && checkOut && currentRoom) {
      const price = calculateRoomCharge(checkIn, checkOut, bookingType, {
        hourly: currentRoom.priceHourly,
        daily: currentRoom.priceDaily,
        overnight: currentRoom.priceOvernight
      });
      setEstimatedTotal(price);

      if (paymentMode === 'FULL') {
        setDepositAmount(price);
      }
    }
  }, [checkIn, checkOut, bookingType, currentRoom, paymentMode]);

  const handleAction = (status: 'active' | 'pending') => {
    if (!customerName || !checkIn || !checkOut) {
      alert('Vui lòng điền tên khách hàng và thời gian thuê!');
      return;
    }

    if (mode === 'extend' && new Date(checkOut) <= new Date(initialBooking?.checkOutExpected || checkIn)) {
      alert('Ngày trả phòng mới phải sau ngày trả phòng hiện tại.');
      return;
    }

    const customer: Customer = {
      id: initialBooking?.customer.id || Date.now().toString(),
      name: customerName,
      email: email,
      identityCard: idCard,
      phone,
    };

    const finalDeposit = paymentMode === 'LATER' ? 0 : depositAmount;
    const resolvedStatus =
      mode === 'create' ? status : (initialBooking?.status === 'pending' ? 'pending' : 'active');

    onSubmit({
      bookingId: initialBooking?.id,
      mode,
      roomId: currentRoom.id,
      customer,
      checkIn,
      checkOut,
      bookingType,
      estimatedTotal,
      deposit: mode === 'extend' ? initialBooking?.deposit ?? 0 : finalDeposit,
      paidAmount: mode === 'extend' ? initialBooking?.paidAmount ?? 0 : finalDeposit,
      status: resolvedStatus,
    });
  };

  const headerTitle =
    mode === 'extend'
      ? `Gia hạn lưu trú — Phòng ${currentRoom.number}`
      : mode === 'edit'
        ? `Sửa đặt phòng — Phòng ${currentRoom.number}`
        : `Đặt phòng mới — Phòng ${currentRoom.number}`;

  const lockedRoomId = mode === 'extend' ? initialBooking?.roomId : null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden transform transition-all flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-indigo-600 px-6 py-3 flex justify-between items-center text-white shrink-0">
          <h2 className="text-base font-bold flex items-center gap-2">
            {mode === 'extend' ? <CalendarClock className="w-4 h-4" /> : <Calendar className="w-4 h-4" />}
            {headerTitle}
          </h2>
          <button onClick={onClose} className="hover:bg-indigo-700 p-1.5 rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body — 2 cột ngang */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
          {/* Cột trái: Thông tin khách */}
          <div className="md:w-[42%] p-5 border-b md:border-b-0 md:border-r border-gray-100 bg-slate-50/60 overflow-y-auto">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <User size={13} /> Thông tin khách
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Họ và tên *</label>
                <input
                  type="text"
                  required
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-2.5 bg-white"
                  placeholder="Họ và tên khách hàng"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-2.5 bg-white"
                  placeholder="Email khách hàng"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">CMND/CCCD</label>
                  <input
                    type="text"
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-2.5 bg-white"
                    placeholder="Số giấy tờ"
                    value={idCard}
                    onChange={(e) => setIdCard(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Điện thoại</label>
                  <input
                    type="tel"
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-2.5 bg-white"
                    placeholder="Số điện thoại"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Cột phải: Phòng, thời gian, thanh toán */}
          <div className="md:flex-1 p-5 overflow-y-auto">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Calendar size={13} /> Phòng & thời gian
            </h3>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Chọn phòng</label>
                <select
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-2.5 bg-white disabled:bg-gray-100 disabled:text-gray-500"
                  value={currentRoom.id}
                  disabled={mode === 'extend'}
                  onChange={(e) => {
                    const selected = rooms.find(r => r.id === e.target.value);
                    if (selected) setCurrentRoom(selected);
                  }}
                >
                  {rooms.map(r => (
                    <option
                      key={r.id}
                      value={r.id}
                      disabled={r.status === RoomStatus.OCCUPIED && r.id !== lockedRoomId && r.id !== initialBooking?.roomId}
                    >
                      Phòng {r.number} — {r.type} ({getStatusText(r.status)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Loại thuê</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: BookingType.HOURLY, label: 'Theo giờ' },
                    { id: BookingType.DAILY, label: 'Theo ngày' },
                    { id: BookingType.OVERNIGHT, label: 'Qua đêm' }
                  ].map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      disabled={mode === 'extend'}
                      onClick={() => setBookingType(type.id)}
                      className={`
                        py-2 px-2 text-xs font-semibold rounded-lg border transition-all duration-200
                        ${bookingType === type.id
                          ? 'bg-indigo-50 border-indigo-600 text-indigo-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }
                      `}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Nhận phòng</label>
                <input
                  type="datetime-local"
                  required
                  disabled={mode === 'extend'}
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xs border p-2.5 disabled:bg-gray-100"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Trả phòng (dự kiến)</label>
                <input
                  type="datetime-local"
                  required
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xs border p-2.5"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </div>
            </div>

            {/* Thanh toán */}
            {mode !== 'extend' && (
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1">
                  <Wallet size={12} /> Thanh toán
                </span>
                <span className="text-base font-bold text-indigo-700">
                  {formatCurrency(estimatedTotal)}
                </span>
              </div>

              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => { setPaymentMode('LATER'); setDepositAmount(0); }}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border ${paymentMode === 'LATER' ? 'bg-white border-indigo-600 text-indigo-700 shadow-sm' : 'border-transparent text-gray-500 hover:bg-gray-200'}`}
                >
                  Trả sau
                </button>
                <button
                  type="button"
                  onClick={() => { setPaymentMode('DEPOSIT'); setDepositAmount(estimatedTotal * 0.3); }}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border ${paymentMode === 'DEPOSIT' ? 'bg-white border-indigo-600 text-indigo-700 shadow-sm' : 'border-transparent text-gray-500 hover:bg-gray-200'}`}
                >
                  Đặt cọc
                </button>
                <button
                  type="button"
                  onClick={() => { setPaymentMode('FULL'); setDepositAmount(estimatedTotal); }}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border ${paymentMode === 'FULL' ? 'bg-white border-indigo-600 text-indigo-700 shadow-sm' : 'border-transparent text-gray-500 hover:bg-gray-200'}`}
                >
                  T.Toán hết
                </button>
              </div>

              {paymentMode !== 'LATER' && (
                <div className="grid grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">Số tiền cọc</label>
                    <input
                      type="text"
                      value={formatNumber(depositAmount)}
                      onChange={(e) => {
                        const val = parseNumber(e.target.value);
                        if (!isNaN(val) && val <= estimatedTotal) setDepositAmount(val);
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                  <div className="text-right pt-4">
                    <span className="text-xs text-gray-500 block">Còn lại cần thu</span>
                    <span className="text-sm font-bold text-rose-600">
                      {formatCurrency(Math.max(0, estimatedTotal - depositAmount))}
                    </span>
                  </div>
                </div>
              )}
            </div>
            )}

            {mode === 'extend' && initialBooking && (
              <div className="bg-amber-50 p-4 rounded-lg border border-amber-200 text-sm text-amber-900">
                <p>
                  Trả phòng hiện tại:{' '}
                  <span className="font-semibold">{new Date(initialBooking.checkOutExpected).toLocaleString('vi-VN')}</span>
                </p>
                <p className="mt-1 text-xs text-amber-800/80">
                  Chọn ngày trả phòng mới để gia hạn. Tiền phòng sẽ được tính lại theo thời gian mới.
                </p>
                <p className="mt-2 text-sm font-bold text-amber-950">
                  Tiền phòng sau gia hạn: {formatCurrency(estimatedTotal)}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer — nút hành động ngang */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 shrink-0 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Hủy
          </button>
          {mode === 'create' && (
            <>
              <button
                type="button"
                onClick={() => handleAction('pending')}
                className="px-5 py-2.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-sm font-bold hover:bg-amber-200 transition-colors flex items-center gap-2"
              >
                <Clock size={16} />
                Lưu Đặt Trước
              </button>
              <button
                type="button"
                onClick={() => handleAction('active')}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 shadow-md transition-colors flex items-center gap-2"
              >
                <CheckCircle size={16} />
                Check-in Ngay
              </button>
            </>
          )}
          {mode === 'edit' && (
            <button
              type="button"
              onClick={() => handleAction('active')}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 shadow-md transition-colors flex items-center gap-2"
            >
              <CheckCircle size={16} />
              Lưu thay đổi
            </button>
          )}
          {mode === 'extend' && (
            <button
              type="button"
              onClick={() => handleAction('active')}
              className="px-5 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-bold hover:bg-teal-700 shadow-md transition-colors flex items-center gap-2"
            >
              <CalendarClock size={16} />
              Xác nhận gia hạn
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
