
import React, { useState } from 'react';
import { User, LogIn, LogOut, Mail, Trash2, Calendar, CheckCircle, AlertTriangle, X, Pencil, Receipt } from 'lucide-react';
import { formatCurrency, formatDate } from '../utils';
import { Booking, Room } from '../types';

interface FrontDeskProps {
  bookings: Booking[];
  rooms: Room[];
  onNewBooking: () => void;
  onCheckOut: (bookingId: string) => void;
  onCheckIn: (bookingId: string) => void;
  onEditBooking: (booking: Booking) => void;
  onDeleteBooking: (bookingId: string) => void;
  onSendEmail: (booking: Booking) => void;
}

export const FrontDesk: React.FC<FrontDeskProps> = ({ 
  bookings, 
  rooms,
  onNewBooking,
  onCheckOut,
  onCheckIn,
  onEditBooking,
  onDeleteBooking,
  onSendEmail
}) => {
  const [filter, setFilter] = useState('Tất cả');
  const [deleteModal, setDeleteModal] = useState<{isOpen: boolean, bookingId: string | null}>({
    isOpen: false,
    bookingId: null
  });

  // Helper to get room details
  const getRoom = (roomId: string) => rooms.find(r => r.id === roomId);

  // Filter logic
  const filteredBookings = bookings.filter(b => {
    if (filter === 'Tất cả') return true;
    if (filter === 'Chờ xử lý') return b.status === 'pending';
    if (filter === 'Đã xác nhận') return b.status === 'pending'; 
    if (filter === 'Đã Check-in') return b.status === 'active';
    if (filter === 'Đã Check-out') return b.status === 'completed';
    return true;
  });

  // Sort by date (newest first)
  const sortedBookings = [...filteredBookings].sort((a, b) => 
    new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime()
  );

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
      // Ngăn chặn sự kiện click lan ra ngoài
      e.preventDefault();
      e.stopPropagation();
      setDeleteModal({ isOpen: true, bookingId: id });
  };

  const confirmDelete = () => {
      if (deleteModal.bookingId) {
          onDeleteBooking(deleteModal.bookingId);
      }
      setDeleteModal({ isOpen: false, bookingId: null });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Lễ Tân</h1>
          <p className="text-slate-500 mt-1">Quản lý đặt phòng, check-in, và giao tiếp với khách.</p>
        </div>
        <button 
          onClick={onNewBooking}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-lg shadow-indigo-200 transition-colors"
        >
          <Calendar size={18} /> Đặt phòng mới
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {['Tất cả', 'Chờ xử lý', 'Đã Check-in', 'Đã Check-out'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              filter === tab 
                ? 'bg-slate-800 text-white shadow-md' 
                : 'bg-white text-slate-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          {sortedBookings.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center text-gray-500">
               <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-400">
                  <Calendar size={32}/>
               </div>
               <p className="text-lg font-medium">Chưa có dữ liệu đặt phòng.</p>
               <p className="text-sm">Hãy nhấn "Đặt phòng mới" để bắt đầu.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[1000px]">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-bold tracking-wider border-b border-gray-100 text-center">
                <tr>
                  <th className="px-6 py-4 text-left">Khách hàng</th>
                  <th className="px-6 py-4 text-left">Phòng / Thời gian</th>
                  <th className="px-6 py-4 text-left">Trạng thái</th>
                  <th className="px-6 py-4 text-left">Thanh toán</th>
                  <th className="px-6 py-4">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedBookings.map((item) => {
                  const room = getRoom(item.roomId);
                  const isPaid = item.paidAmount >= item.finalTotal;
                  const isDeposit = item.deposit > 0 && item.paidAmount < item.finalTotal;

                  return (
                    <tr key={item.id} className="hover:bg-indigo-50/30 transition-colors group relative">
                      {/* Customer Column */}
                      <td className="px-6 py-4 align-top">
                        <div className="flex gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-lg shrink-0">
                            {item.customer.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900">{item.customer.name}</div>
                            <div className="text-xs text-gray-500">{item.customer.email || 'No email'}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{item.customer.phone}</div>
                          </div>
                        </div>
                      </td>

                      {/* Room / Time Column */}
                      <td className="px-6 py-4 align-top">
                        <div className="font-bold text-slate-800">
                          P. {room?.number} <span className="text-gray-500 font-normal">({room?.type})</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1 flex flex-col gap-1">
                          <span>{formatDate(item.checkIn)}</span> 
                          <span className="text-gray-400">đến</span>
                          <span>{formatDate(item.checkOutActual || item.checkOutExpected)}</span>
                        </div>
                      </td>

                      {/* Status Column */}
                      <td className="px-6 py-4 align-top">
                        {item.status === 'active' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            Đã Check-in
                          </span>
                        )}
                        {item.status === 'completed' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-800 border border-gray-200">
                            Đã Check-out
                          </span>
                        )}
                         {item.status === 'pending' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                            Chờ nhận phòng
                          </span>
                        )}
                      </td>

                      {/* Payment Column */}
                      <td className="px-6 py-4 align-top">
                        <div className="space-y-1">
                          {isPaid ? (
                             <div className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Đã thanh toán
                            </div>
                          ) : isDeposit ? (
                            <div className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              Đã cọc {formatCurrency(item.deposit)}
                            </div>
                          ) : (
                            <div className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              Chưa thanh toán
                            </div>
                          )}
                          
                          <div className="text-xs text-gray-500">
                            Tổng: <span className="font-medium text-slate-700">{formatCurrency(item.finalTotal)}</span>
                          </div>
                        </div>
                      </td>

                      {/* Actions Column - 2x2 Layout - Centered */}
                      <td className="px-6 py-4 align-top">
                        <div className="flex justify-center gap-2">
                          
                          {/* Cột 1: Check-in/out và Email */}
                          <div className="flex flex-col gap-2 w-28">
                             {/* Nút Check Action */}
                             {item.status === 'active' ? (
                               <button 
                                 onClick={(e) => { e.stopPropagation(); onCheckOut(item.id); }}
                                 className="w-full px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 transition-colors text-xs font-bold flex items-center justify-center gap-1 shadow-sm"
                                 title="Check-out"
                               >
                                 <LogOut size={14} /> Check-out
                               </button>
                             ) : item.status === 'pending' ? (
                               <button 
                                 onClick={(e) => { e.stopPropagation(); onCheckIn(item.id); }}
                                 className="w-full px-2 py-1.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors text-xs font-bold flex items-center justify-center gap-1 shadow-sm"
                                 title="Check-in"
                               >
                                 <LogIn size={14} /> Check-in
                               </button>
                             ) : (
                               /* Nút Xem HĐ cho đơn đã hoàn thành */
                               <button 
                                 onClick={(e) => { e.stopPropagation(); onCheckOut(item.id); }}
                                 className="w-full px-2 py-1.5 rounded bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors text-xs font-bold flex items-center justify-center gap-1 shadow-sm"
                                 title="Xem lịch sử thanh toán"
                               >
                                 <Receipt size={14} /> Xem HĐ
                               </button>
                             )}

                             {/* Nút Email */}
                             <button 
                               onClick={(e) => { e.stopPropagation(); onSendEmail(item); }}
                               className="w-full px-2 py-1.5 rounded hover:bg-blue-50 text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-200 transition-colors text-xs font-bold flex items-center justify-center gap-1 bg-white"
                               title="Gửi email xác nhận"
                             >
                               <Mail size={14} /> Email
                             </button>
                          </div>

                          {/* Cột 2: Sửa và Xóa */}
                          <div className="flex flex-col gap-2 w-20">
                             {/* Nút Sửa */}
                             <button 
                               onClick={(e) => { e.stopPropagation(); onEditBooking(item); }}
                               className="w-full px-2 py-1.5 rounded hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 border border-gray-200 hover:border-indigo-200 transition-colors text-xs font-bold flex items-center justify-center gap-1 bg-white"
                               title="Sửa thông tin"
                             >
                               <Pencil size={14} /> Sửa
                             </button>
                             
                             {/* Nút Xóa */}
                             <button 
                               type="button"
                               onClick={(e) => handleDeleteClick(e, item.id)}
                               title="Xóa đơn đặt phòng" 
                               className="w-full px-2 py-1.5 rounded bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 transition-colors text-xs font-bold flex items-center justify-center gap-1"
                             >
                               <Trash2 size={14} /> Xóa
                             </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* DELETE CONFIRMATION MODAL */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 z-[999] flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden transform scale-100 transition-transform">
              <div className="bg-rose-50 p-6 flex flex-col items-center text-center border-b border-rose-100">
                  <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 mb-3">
                      <AlertTriangle size={24} />
                  </div>
                  <h3 className="text-lg font-bold text-rose-700">Xác nhận xoá đơn</h3>
                  <p className="text-sm text-gray-600 mt-2">
                      Bạn có chắc chắn muốn xoá đơn đặt phòng này? Hành động này không thể hoàn tác và phòng sẽ được trả về trạng thái TRỐNG.
                  </p>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3 bg-white">
                  <button 
                      onClick={() => setDeleteModal({isOpen: false, bookingId: null})}
                      className="py-2.5 px-4 rounded-lg border border-gray-300 font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                      Huỷ bỏ
                  </button>
                  <button 
                      onClick={confirmDelete}
                      className="py-2.5 px-4 rounded-lg bg-rose-600 font-bold text-white hover:bg-rose-700 shadow-md transition-colors flex items-center justify-center gap-2"
                  >
                      <Trash2 size={16} /> Xoá ngay
                  </button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
};
