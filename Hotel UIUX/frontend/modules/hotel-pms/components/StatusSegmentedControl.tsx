import React from 'react';
import { fd, RoomStatusFilter, STATUS_SEGMENTS } from './frontDeskTheme';

interface StatusSegmentedControlProps {
  value: RoomStatusFilter;
  counts: Record<string, number>;
  onChange: (value: RoomStatusFilter) => void;
}

export const StatusSegmentedControl: React.FC<StatusSegmentedControlProps> = ({
  value,
  counts,
  onChange,
}) => (
  <div className={`${fd.segmentedWrap} overflow-x-auto`}>
    {STATUS_SEGMENTS.map(({ id, label }) => {
      const active = value === id;
      const count = counts[id] ?? 0;
      return (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`
            flex-1 min-w-fit whitespace-nowrap px-2 py-1 rounded-md
            text-[10px] font-medium transition-all duration-200
            ${active ? fd.segmentedActive : fd.segmentedInactive}
          `}
        >
          {label}
          <span className="ml-1 text-gray-400">{count}</span>
        </button>
      );
    })}
  </div>
);
