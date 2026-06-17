import React, { useMemo, useState } from 'react';
import { CalendarPlus, LayoutGrid, Search } from 'lucide-react';
import { Room, RoomStatus, RoomTypeConfig } from '../types';
import { fd, ROOM_STATUS_META, RoomStatusFilter } from './frontDeskTheme';
import { RoomCard } from './RoomCard';
import { StatusSegmentedControl } from './StatusSegmentedControl';
import { RoomGridSkeleton, ToolbarSkeleton } from './FrontDeskSkeleton';

interface RoomMapPanelProps {
  rooms: Room[];
  roomTypes: RoomTypeConfig[];
  selectedRoomId: string | null;
  isLoading?: boolean;
  onRoomSelect: (room: Room) => void;
  onRoomDoubleClick: (room: Room) => void;
  onNewBooking: () => void;
}

export const RoomMapPanel: React.FC<RoomMapPanelProps> = ({
  rooms,
  roomTypes,
  selectedRoomId,
  isLoading = false,
  onRoomSelect,
  onRoomDoubleClick,
  onNewBooking,
}) => {
  const [statusFilter, setStatusFilter] = useState<RoomStatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const floors = useMemo(
    () => Array.from(new Set(rooms.map((r) => r.floor))).sort((a, b) => a - b),
    [rooms],
  );
  const [activeFloor, setActiveFloor] = useState<number | 'ALL'>('ALL');

  const typeName = (code: string) =>
    roomTypes.find((rt) => rt.code === code)?.name || code;

  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      if (statusFilter !== 'ALL' && room.status !== statusFilter) return false;
      if (activeFloor !== 'ALL' && room.floor !== activeFloor) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!room.number.toLowerCase().includes(q) && !room.type.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [rooms, statusFilter, activeFloor, search]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: rooms.length };
    for (const s of Object.values(RoomStatus)) counts[s] = 0;
    for (const r of rooms) counts[r.status] = (counts[r.status] || 0) + 1;
    return counts;
  }, [rooms]);

  const roomsByFloor = useMemo(() => {
    const grouped = new Map<number, Room[]>();
    for (const room of filteredRooms) {
      const list = grouped.get(room.floor) || [];
      list.push(room);
      grouped.set(room.floor, list);
    }
    for (const [, list] of grouped) {
      list.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    }
    return grouped;
  }, [filteredRooms]);

  const displayFloors =
    activeFloor === 'ALL' ? floors.filter((f) => roomsByFloor.has(f)) : [activeFloor];

  return (
    <div className={`flex flex-col h-full overflow-hidden ${fd.panel} ${fd.font}`}>
      <div className="shrink-0 border-b border-gray-100 px-4 py-3 space-y-3">
        {isLoading ? (
          <ToolbarSkeleton />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <LayoutGrid size={16} className="text-violet-300" />
                <h2 className={fd.title}>Sơ đồ phòng</h2>
                <span className={`${fd.label} bg-gray-50 px-1.5 py-0.5 rounded-md border border-gray-100`}>
                  {filteredRooms.length}/{rooms.length}
                </span>
              </div>
              <button type="button" onClick={onNewBooking} className={fd.btnPrimary}>
                <CalendarPlus size={14} />
                Đặt phòng mới
              </button>
            </div>

            <div className="relative max-w-sm">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Tìm số phòng..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${fd.input} pl-8`}
              />
            </div>

            <StatusSegmentedControl
              value={statusFilter}
              counts={statusCounts}
              onChange={setStatusFilter}
            />

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setActiveFloor('ALL')}
                className={`text-[10px] font-medium px-2 py-1 rounded-lg transition-all duration-200 ${
                  activeFloor === 'ALL' ? fd.floorActive : fd.floorInactive
                }`}
              >
                Tất cả tầng
              </button>
              {floors.map((floor) => (
                <button
                  key={floor}
                  type="button"
                  onClick={() => setActiveFloor(floor)}
                  className={`text-[10px] font-medium px-2 py-1 rounded-lg transition-all duration-200 ${
                    activeFloor === floor ? fd.floorActive : fd.floorInactive
                  }`}
                >
                  Tầng {floor}
                  <span className="ml-0.5 opacity-70">
                    ({rooms.filter((r) => r.floor === floor).length})
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {!isLoading && (
        <div className="shrink-0 flex flex-wrap gap-3 px-4 py-2 border-b border-gray-100">
          {Object.values(RoomStatus).map((status) => {
            const meta = ROOM_STATUS_META[status];
            return (
              <span key={status} className={`inline-flex items-center gap-1.5 ${fd.label}`}>
                <span className={`w-1 h-1 rounded-full ${meta.dot}`} />
                {meta.label}
              </span>
            );
          })}
          <span className={`${fd.caption} ml-auto hidden sm:inline`}>
            Double-click phòng để thao tác nhanh
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-5 min-h-0">
        {isLoading ? (
          <RoomGridSkeleton count={18} />
        ) : displayFloors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <LayoutGrid size={28} className="mb-3 opacity-30" />
            <p className={fd.body}>Không có phòng phù hợp bộ lọc.</p>
          </div>
        ) : (
          displayFloors.map((floor) => {
            const floorRooms = roomsByFloor.get(floor) || [];
            if (floorRooms.length === 0) return null;
            return (
              <section key={floor}>
                {activeFloor === 'ALL' && (
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`${fd.label} uppercase tracking-wider`}>Tầng {floor}</span>
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className={fd.label}>{floorRooms.length} phòng</span>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                  {floorRooms.map((room) => (
                    <RoomCard
                      key={room.id}
                      room={room}
                      typeLabel={typeName(room.type)}
                      selected={selectedRoomId === room.id}
                      onSelect={() => onRoomSelect(room)}
                      onDoubleClick={() => onRoomDoubleClick(room)}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
};
