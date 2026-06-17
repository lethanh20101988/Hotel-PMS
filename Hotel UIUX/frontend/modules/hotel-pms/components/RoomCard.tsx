import React, { useRef } from 'react';
import { Room } from '../types';
import { fd, ROOM_STATUS_META } from './frontDeskTheme';

const DBL_CLICK_MS = 250;

interface RoomCardProps {
  room: Room;
  typeLabel: string;
  selected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
}

export const RoomCard: React.FC<RoomCardProps> = ({
  room,
  typeLabel,
  selected,
  onSelect,
  onDoubleClick,
}) => {
  const meta = ROOM_STATUS_META[room.status];
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      onSelect();
      clickTimer.current = null;
    }, DBL_CLICK_MS);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onDoubleClick();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title="Click: xem chi tiết · Double-click: thao tác nhanh"
      className={`
        group flex flex-col items-start justify-between text-left
        w-full min-h-[68px] p-2.5 rounded-lg border bg-white
        shadow-sm transition-all duration-200 ease-out
        hover:shadow hover:-translate-y-px
        ${meta.cardTint}
        ${selected
          ? `${fd.accentBorder} ring-2 ${fd.accentRing} shadow -translate-y-px z-10`
          : 'border-gray-100 hover:border-gray-200'
        }
      `}
    >
      <div className="w-full flex items-start justify-between gap-1.5">
        <span className="text-lg font-semibold text-gray-700 leading-none tracking-tight">
          {room.number}
        </span>
        <span
          className={`shrink-0 text-[10px] font-medium px-1.5 py-px rounded-md border leading-tight ${meta.badge}`}
        >
          {meta.label}
        </span>
      </div>
      <p className={`${fd.caption} mt-1.5 truncate w-full`}>
        {typeLabel}
      </p>
    </button>
  );
};
