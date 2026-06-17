
import React, { useState, useEffect } from 'react';
import { Room, BookingType, Customer, RoomStatus } from '../types';
import { calculateRoomCharge, formatCurrency, formatNumber, parseNumber } from '../utils';
import { X, Calendar, User, Wallet, Clock, CheckCircle } from 'lucide-react';

interface BookingModalProps {
  room: Room;
  rooms: Room[]; 
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (bookingData: any) => void;
}

export const BookingModal: React.FC<BookingModalProps> = ({ room, rooms, isOpen, onClose, onSubmit }) => {
  const [currentRoom, setCurrentRoom] = useState<Room>(room);
  
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [idCard, setIdCard] = useState('');
  const [phone, setPhone] = useState('');
  const [bookingType, setBookingType] = useState<BookingType>(BookingType.DAILY);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [estimatedTotal, setEstimatedTotal] = useState(0);

  // Payment State
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
    if (isOpen) {
      setCurrentRoom(room);
      const now = new Date();
      const nowStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
      setCheckIn(nowStr);
      
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tmrStr = new Date(tomorrow.getTime() - (tomorrow.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
      setCheckOut(tmrStr);
      
      setPaymentMode('LATER');
      setDepositAmount(0);
    }
  }, [isOpen, room]);

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
        alert("Vui lòng điền tên khách hàng và thời gian thuê!");
        return;
    }

    const customer: Customer = {
      id: Date.now().toString(),
      name: customerName,
      email: email,
      identityCard: idCard,
      phone
    };
    
    const finalDeposit = paymentMode === 'LATER' ? 0 : depositAmount;

    onSubmit({
      roomId: currentRoom.id,
      customer,
      checkIn,
      checkOut,
      bookingType,
      estimatedTotal,
      deposit: finalDeposit,
      paidAmount: finalDeposit,
      status: status // Pass the status (active vs pending)
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden transform transition-all flex flex-col max-h-[95vh]">
        {/* Header */}
        <div className="bg-indigo-600 px-5 py-3 flex justify-between items-center text-white shrink-0">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Đặt phòng {currentRoom.number}
          </h2>
          <button onClick={onClose} className="hover:bg-indigo-700 p-1.5 rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {/* Customer Info Section */}
          <div className="mb-5">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
              <User size={12}/> Thông tin khách
            </h3>
            <div className="space-y-3">
              <div>
                <input
                  type="text"
                  required
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-2.5"
                  placeholder="Họ và tên khách hàng *"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              
              <div>
                <input
                  type="email"
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-2.5"
                  placeholder="Email khách hàng"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-2.5"
                  placeholder="CMND/CCCD"
                  value={idCard}
                  onChange={(e) => setIdCard(e.target.value)}
                />
                <input
                  type="tel"
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-2.5"
                  placeholder="Số điện thoại"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
          </div>

          <hr className="border-dashed border-gray-200 my-4" />

          {/* Booking Info Section */}
          <div className="mb-4">
            <div className="mb-3">
               <label className="block text-xs font-medium text-gray-500 mb-1">Chọn phòng</label>
               <select 
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-2.5 bg-white"
                  value={currentRoom.id}
                  onChange={(e) => {
                     const selected = rooms.find(r => r.id === e.target.value);
                     if (selected) setCurrentRoom(selected);
                  }}
               >
                  {rooms.map(r => (
                      <option key={r.id} value={r.id} disabled={r.status === RoomStatus.OCCUPIED}>
                          Phòng {r.number} - {r.type} ({getStatusText(r.status)})
                      </option>
                  ))}
               </select>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { id: BookingType.HOURLY, label: 'Theo giờ' },
                { id: BookingType.DAILY, label: 'Theo ngày' },
                { id: BookingType.OVERNIGHT, label: 'Qua đêm' }
              ].map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setBookingType(type.id)}
                  className={`
                    py-2 px-1 text-xs font-semibold rounded-lg border transition-all duration-200
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Nhận phòng</label>
                <input
                  type="datetime-local"
                  required
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xs border p-2"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Trả phòng (dự kiến)</label>
                <input
                  type="datetime-local"
                  required
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xs border p-2"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Payment Section */}
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 mb-5">
            <div className="flex justify-between items-center mb-2">
                 <span className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1">
                    <Wallet size={12}/> Thanh toán
                 </span>
                 <span className="text-sm font-bold text-indigo-700">
                    Tổng: {formatCurrency(estimatedTotal)}
                 </span>
            </div>

            <div className="flex gap-2 mb-3">
               <button
                 type="button"
                 onClick={() => { setPaymentMode('LATER'); setDepositAmount(0); }}
                 className={`flex-1 py-1.5 text-xs font-medium rounded border ${paymentMode === 'LATER' ? 'bg-white border-indigo-600 text-indigo-700 shadow-sm' : 'border-transparent text-gray-500 hover:bg-gray-200'}`}
               >
                 Trả sau
               </button>
               <button
                 type="button"
                 onClick={() => { setPaymentMode('DEPOSIT'); setDepositAmount(estimatedTotal * 0.3); }} 
                 className={`flex-1 py-1.5 text-xs font-medium rounded border ${paymentMode === 'DEPOSIT' ? 'bg-white border-indigo-600 text-indigo-700 shadow-sm' : 'border-transparent text-gray-500 hover:bg-gray-200'}`}
               >
                 Đặt cọc
               </button>
               <button
                 type="button"
                 onClick={() => { setPaymentMode('FULL'); setDepositAmount(estimatedTotal); }}
                 className={`flex-1 py-1.5 text-xs font-medium rounded border ${paymentMode === 'FULL' ? 'bg-white border-indigo-600 text-indigo-700 shadow-sm' : 'border-transparent text-gray-500 hover:bg-gray-200'}`}
               >
                 T.Toán hết
               </button>
            </div>

            {paymentMode !== 'LATER' && (
               <div className="space-y-2">
                   <div className="flex items-center gap-2">
                       <label className="text-xs text-gray-600 w-24">Số tiền cọc:</label>
                       <input 
                          type="text" 
                          value={formatNumber(depositAmount)}
                          onChange={(e) => {
                             const val = parseNumber(e.target.value);
                             if (!isNaN(val) && val <= estimatedTotal) setDepositAmount(val);
                          }}
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                       />
                   </div>
                   <div className="flex justify-between items-center pt-2 border-t border-dashed border-gray-300">
                       <span className="text-xs text-gray-500">Còn lại cần thu:</span>
                       <span className="text-sm font-bold text-rose-600">
                           {formatCurrency(Math.max(0, estimatedTotal - depositAmount))}
                       </span>
                   </div>
               </div>
            )}
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleAction('pending')}
              className="py-2.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-sm font-bold hover:bg-amber-200 transition-colors flex items-center justify-center gap-2"
            >
              <Clock size={16} />
              Lưu Đặt Trước
            </button>
            <button
              type="button"
              onClick={() => handleAction('active')}
              className="py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 shadow-md transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle size={16} />
              Check-in Ngay
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
