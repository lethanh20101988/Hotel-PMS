import React from 'react';
import { fd } from './frontDeskTheme';

export const RoomGridSkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className={`min-h-[68px] p-2.5 rounded-lg border border-gray-100 ${fd.skeleton}`}
        style={{ animationDelay: `${(i % 6) * 80}ms` }}
      />
    ))}
  </div>
);

export const DetailPanelSkeleton: React.FC = () => (
  <div className="space-y-4 animate-in fade-in duration-200">
    <div className="space-y-2">
      <div className={`h-2.5 w-10 ${fd.skeleton}`} />
      <div className={`h-6 w-16 ${fd.skeleton}`} />
      <div className={`h-3 w-28 ${fd.skeleton}`} />
    </div>
    <div className="rounded-lg border border-gray-100 p-3 space-y-3">
      <div className={`h-3 w-20 ${fd.skeleton}`} />
      <div className={`h-4 w-full ${fd.skeleton}`} />
      <div className="grid grid-cols-2 gap-2">
        <div className={`h-12 rounded-lg ${fd.skeleton}`} />
        <div className={`h-12 rounded-lg ${fd.skeleton}`} />
      </div>
      <div className={`h-4 w-24 ml-auto ${fd.skeleton}`} />
    </div>
    <div className={`h-8 w-full rounded-lg ${fd.skeleton}`} />
  </div>
);

export const BookingListSkeleton: React.FC = () => (
  <div className="space-y-2">
    {Array.from({ length: 4 }).map((_, i) => (
      <div
        key={i}
        className={`h-[68px] rounded-lg border border-gray-100 ${fd.skeleton}`}
        style={{ animationDelay: `${i * 100}ms` }}
      />
    ))}
  </div>
);

export const ToolbarSkeleton: React.FC = () => (
  <div className="space-y-3">
    <div className="flex justify-between">
      <div className={`h-5 w-28 ${fd.skeleton}`} />
      <div className={`h-7 w-28 rounded-lg ${fd.skeleton}`} />
    </div>
    <div className={`h-7 w-full max-w-sm rounded-lg ${fd.skeleton}`} />
    <div className={`h-7 w-full rounded-lg ${fd.skeleton}`} />
  </div>
);
