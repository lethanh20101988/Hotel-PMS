import React from 'react';
import { Room, RoomStatus } from '../types';
import { Pencil, Trash2, User, Bell, Ban, Check, X, Eye, AlertTriangle, Plus } from 'lucide-react';

interface HousekeepingGridProps {
  rooms: Room[];
  onUpdateStatus: (roomId: string, status: RoomStatus) => void;
  onAddRoom: () => void;
  onEditRoom: (room: Room) => void;
  onDeleteRoom: (roomId: string) => void;
}

const RoomCard: React.FC<{ 
  room: Room; 
  onUpdateStatus: (id: string, s: RoomStatus) => void;
  onEditRoom: (room: Room) => void;
  onDeleteRoom: (id: string) => void;
}> = ({ room, onUpdateStatus, onEditRoom, onDeleteRoom }) => {
  // Determine color theme based on status
  const getTheme = (status: RoomStatus) => {
    switch (status) {
      case RoomStatus.AVAILABLE:
        return {
          border: 'border-l-emerald-500',
          text: 'text-emerald-700',
          badge: 'border-emerald-500 text-emerald-600 bg-emerald-50',
          btnActive: 'bg-emerald-500 text-white border-emerald-500',
          statusText: 'Phòng trống - Sẵn sàng đón khách'
        };
      case RoomStatus.DIRTY:
        return {
          border: 'border-l-rose-500',
          text: 'text-rose-700',
          badge: 'border-rose-500 text-rose-600 bg-rose-50',
          btnActive: 'bg-rose-500 text-white border-rose-500',
          statusText: 'Phòng dơ - Cần dọn dẹp ngay'
        };
      case RoomStatus.OCCUPIED:
        return {
          border: 'border-l-blue-600',
          text: 'text-blue-700',
          badge: 'border-blue-600 text-blue-600 bg-blue-50',
          btnActive: 'bg-blue-600 text-white border-blue-600',
          statusText: 'Phòng đang có khách - Chờ Check-out'
        };
      case RoomStatus.BOOKED:
        return {
          border: 'border-l-amber-500',
          text: 'text-amber-700',
          badge: 'border-amber-500 text-amber-600 bg-amber-50',
          btnActive: 'bg-amber-500 text-white border-amber-500',
          statusText: 'Đang kiểm tra phòng'
        };
      case RoomStatus.MAINTENANCE:
        return {
          border: 'border-l-slate-500',
          text: 'text-slate-700',
          badge: 'border-slate-500 text-slate-600 bg-slate-50',
          btnActive: 'bg-slate-600 text-white border-slate-600',
          statusText: 'Phòng đang bảo trì'
        };
      default:
        return {
          border: 'border-l-gray-300',
          text: 'text-gray-700',
          badge: 'border-gray-300 bg-gray-50',
          btnActive: 'bg-gray-500 text-white',
          statusText: ''
        };
    }
  };

  const theme = getTheme(room.status);

  // Status Badge Label
  const getStatusLabel = (status: RoomStatus) => {
    switch (status) {
      case RoomStatus.AVAILABLE: return 'SẠCH';
      case RoomStatus.DIRTY: return 'CHƯA DỌN';
      case RoomStatus.OCCUPIED: return 'ĐANG CÓ KHÁCH';
      case RoomStatus.BOOKED: return 'ĐANG KIỂM TRA';
      case RoomStatus.MAINTENANCE: return 'BẢO TRÌ';
      default: return '';
    }
  };

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 ${theme.border} border-l-4 p-4 flex flex-col gap-3 transition-transform hover:-translate-y-1 relative group`}>
      {/* Header Row 1: Room Info + Edit Button AND Delete Button at far right */}
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
           <h3 className={`text-xl font-bold ${theme.text}`}>
             Phòng {room.number}
           </h3>
           <button 
             onClick={(e) => { e.stopPropagation(); onEditRoom(room); }}
             className="text-gray-400 hover:text-indigo-600 p-1.5 rounded-full hover:bg-indigo-50 transition-colors"
             title="Sửa thông tin phòng"
           >
             <Pencil size={14} />
           </button>
        </div>
        
        <button 
          onClick={(e) => { e.stopPropagation(); onDeleteRoom(room.id); }}
          className="text-gray-300 hover:text-rose-500 p-1.5 rounded-full hover:bg-rose-50 transition-colors"
          title="Xóa phòng"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Header Row 2: Type AND Status Badge */}
      <div className="flex justify-between items-center mb-1 pb-2 border-b border-dashed border-gray-100">
         <span className="text-sm font-medium text-gray-500">{room.type}</span>
         <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${theme.badge} uppercase tracking-wide whitespace-nowrap`}>
           {getStatusLabel(room.status)}
         </span>
      </div>

      {/* Middle Indicators */}
      <div className="flex gap-2">
        <div className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium border ${room.status === RoomStatus.OCCUPIED ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-400 border-gray-100 bg-gray-50'}`}>
          <User size={14} /> Đang ở
        </div>
        <div className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium border ${room.status === RoomStatus.DIRTY ? 'bg-rose-500 text-white border-rose-500' : 'text-gray-400 border-gray-100 bg-gray-50'}`}>
          <Bell size={14} /> Cần dọn
        </div>
        <div className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium border text-gray-400 border-gray-100 bg-gray-50">
          <Ban size={14} /> DND
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-4 gap-2 mt-1">
        <button 
          onClick={() => onUpdateStatus(room.id, RoomStatus.AVAILABLE)}
          className={`flex flex-col items-center justify-center py-2 rounded-lg border text-xs font-semibold transition-colors ${room.status === RoomStatus.AVAILABLE ? theme.btnActive : 'text-emerald-600 border-gray-100 bg-white hover:bg-emerald-50'}`}
        >
          <Check size={16} className="mb-1" /> Sạch
        </button>
        <button 
           onClick={() => onUpdateStatus(room.id, RoomStatus.DIRTY)}
           className={`flex flex-col items-center justify-center py-2 rounded-lg border text-xs font-semibold transition-colors ${room.status === RoomStatus.DIRTY ? theme.btnActive : 'text-rose-600 border-gray-100 bg-white hover:bg-rose-50'}`}
        >
          <X size={16} className="mb-1" /> Dọn
        </button>
        <button 
           onClick={() => onUpdateStatus(room.id, RoomStatus.BOOKED)}
           className={`flex flex-col items-center justify-center py-2 rounded-lg border text-xs font-semibold transition-colors ${room.status === RoomStatus.BOOKED ? theme.btnActive : 'text-amber-600 border-gray-100 bg-white hover:bg-amber-50'}`}
        >
          <Eye size={16} className="mb-1" /> K.Tra
        </button>
        <button 
           onClick={() => onUpdateStatus(room.id, RoomStatus.MAINTENANCE)}
           className={`flex flex-col items-center justify-center py-2 rounded-lg border text-xs font-semibold transition-colors ${room.status === RoomStatus.MAINTENANCE ? theme.btnActive : 'text-slate-600 border-gray-100 bg-white hover:bg-slate-50'}`}
        >
          <AlertTriangle size={16} className="mb-1" /> B.Trì
        </button>
      </div>

      {/* Footer Text */}
      <div className="text-center h-4">
        <span className={`text-xs italic font-medium ${theme.text} opacity-80`}>
          {theme.statusText}
        </span>
      </div>
    </div>
  );
};

export const HousekeepingGrid: React.FC<HousekeepingGridProps> = ({ rooms, onUpdateStatus, onAddRoom, onEditRoom, onDeleteRoom }) => {
  return (
    <div className="">
       {/* Header with Title and Legend */}
       <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Buồng Phòng</h1>
            <div className="flex flex-wrap gap-6 mt-3 text-sm font-medium text-slate-600">
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Sạch</div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span> Chưa dọn</div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span> Có khách</div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span> K.L.Phiền</div>
            </div>
          </div>
          <button 
            onClick={onAddRoom}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-lg shadow-indigo-200 transition-colors active:scale-95"
          >
            <Plus size={20} /> Thêm phòng
          </button>
       </div>

       {/* Grid */}
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {rooms.map(room => (
             <RoomCard 
                key={room.id} 
                room={room} 
                onUpdateStatus={onUpdateStatus} 
                onEditRoom={onEditRoom}
                onDeleteRoom={onDeleteRoom}
             />
          ))}
       </div>
    </div>
  );
};