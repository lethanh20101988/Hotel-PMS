import React from 'react';
import { Room, RoomStatus } from '../types';
import { BedDouble, User, Brush, Wrench, Clock } from 'lucide-react';

interface RoomGridProps {
  rooms: Room[];
  onRoomClick: (room: Room) => void;
}

const getStatusColor = (status: RoomStatus) => {
  switch (status) {
    case RoomStatus.AVAILABLE: return 'bg-emerald-100 border-emerald-300 text-emerald-800 hover:bg-emerald-200';
    case RoomStatus.OCCUPIED: return 'bg-rose-100 border-rose-300 text-rose-800 hover:bg-rose-200';
    case RoomStatus.BOOKED: return 'bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200';
    case RoomStatus.DIRTY: return 'bg-gray-200 border-gray-400 text-gray-700 hover:bg-gray-300';
    case RoomStatus.MAINTENANCE: return 'bg-slate-800 border-slate-900 text-slate-100 hover:bg-slate-700';
    default: return 'bg-white';
  }
};

const getStatusIcon = (status: RoomStatus) => {
  switch (status) {
    case RoomStatus.AVAILABLE: return <BedDouble size={20} />;
    case RoomStatus.OCCUPIED: return <User size={20} />;
    case RoomStatus.BOOKED: return <Clock size={20} />;
    case RoomStatus.DIRTY: return <Brush size={20} />;
    case RoomStatus.MAINTENANCE: return <Wrench size={20} />;
  }
};

export const RoomGrid: React.FC<RoomGridProps> = ({ rooms, onRoomClick }) => {
  // Group rooms by floor
  const floors = Array.from(new Set(rooms.map(r => r.floor))).sort();

  return (
    <div className="space-y-6">
      {floors.map(floor => (
        <div key={floor}>
          <h3 className="text-lg font-bold text-slate-700 mb-3 flex items-center gap-2">
            <span className="w-2 h-6 bg-indigo-600 rounded-sm inline-block"></span>
            Tầng {floor}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {rooms.filter(r => r.floor === floor).map(room => (
              <div
                key={room.id}
                onClick={() => onRoomClick(room)}
                className={`
                  relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 shadow-sm
                  flex flex-col justify-between h-32
                  ${getStatusColor(room.status)}
                `}
              >
                <div className="flex justify-between items-start">
                  <span className="text-2xl font-bold">{room.number}</span>
                  {getStatusIcon(room.status)}
                </div>
                <div className="text-sm font-medium opacity-90">
                  {room.type}
                </div>
                <div className="text-xs font-semibold uppercase tracking-wider opacity-75">
                  {room.status === RoomStatus.AVAILABLE ? 'Sẵn sàng' : 
                   room.status === RoomStatus.OCCUPIED ? 'Có khách' : 
                   room.status === RoomStatus.DIRTY ? 'Cần dọn' : 
                   room.status === RoomStatus.BOOKED ? 'Đã đặt' : 'Bảo trì'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};