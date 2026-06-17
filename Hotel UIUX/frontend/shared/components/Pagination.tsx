import React, { useMemo } from 'react';

type PageSize = 10 | 20 | 30 | 40 | 50 | 100;

function buildPageModel(page: number, totalPages: number, maxButtons = 7) {
  const safeTotal = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotal);

  // Always show first + last, with a moving window in the middle.
  if (safeTotal <= maxButtons) {
    return { safePage, safeTotal, pages: Array.from({ length: safeTotal }, (_, i) => i + 1), showLeftEllipsis: false, showRightEllipsis: false };
  }

  const windowSize = maxButtons - 2; // excluding first/last
  let start = Math.max(2, safePage - Math.floor(windowSize / 2));
  let end = start + windowSize - 1;

  if (end >= safeTotal) {
    end = safeTotal - 1;
    start = end - windowSize + 1;
  }

  const middle = [];
  for (let i = start; i <= end; i++) middle.push(i);

  return {
    safePage,
    safeTotal,
    pages: [1, ...middle, safeTotal],
    showLeftEllipsis: start > 2,
    showRightEllipsis: end < safeTotal - 1,
  };
}

export function Pagination({
  page,
  totalItems,
  pageSize,
  onChangePage,
  onChangePageSize,
  pageSizeOptions = [10, 20, 50, 100],
  maxButtons = 7,
  className = '',
  variant = 'default',
}: {
  page: number;
  totalItems: number;
  pageSize: PageSize;
  onChangePage: (next: number) => void;
  onChangePageSize: (next: PageSize) => void;
  pageSizeOptions?: PageSize[];
  maxButtons?: number;
  className?: string;
  variant?: 'default' | 'compact';
}) {
  const safePageSize = (Math.min(100, Math.max(10, pageSize)) as PageSize);
  const totalPages = Math.max(1, Math.ceil((totalItems || 0) / safePageSize));

  const compactMaxButtons = Math.min(maxButtons, 5);
  const effectiveMax = variant === 'compact' ? compactMaxButtons : maxButtons;
  const model = useMemo(() => buildPageModel(page, totalPages, effectiveMax), [page, totalPages, effectiveMax]);

  const canPrev = model.safePage > 1;
  const canNext = model.safePage < model.safeTotal;

  const fromItem = totalItems === 0 ? 0 : (model.safePage - 1) * safePageSize + 1;
  const toItem = Math.min(totalItems, model.safePage * safePageSize);

  if (variant === 'compact') {
    return (
      <div
        className={`flex min-w-0 max-w-full flex-nowrap items-center justify-between gap-2 overflow-x-hidden border-t border-slate-200/70 bg-white px-2 py-1.5 ${className}`}
      >
        <span className="shrink-0 tabular-nums text-[11px] font-semibold text-slate-500">
          {totalItems === 0 ? '0' : `${fromItem}–${toItem}`} / {totalItems}
        </span>

        <div className="flex min-w-0 shrink items-center gap-0.5">
          <button
            type="button"
            onClick={() => onChangePage(model.safePage - 1)}
            disabled={!canPrev}
            className="h-7 min-w-[28px] shrink-0 rounded border border-slate-200 bg-white px-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
            title="Trang trước"
          >
            ‹
          </button>
          <div className="flex min-w-0 max-w-[min(220px,42vw)] shrink flex-wrap items-center justify-center gap-0.5 px-0.5">
            {model.pages.map((p, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === model.pages.length - 1;
              const showEllipsisBefore = isFirst ? false : (p === 1 ? false : model.showLeftEllipsis && p === model.pages[1] && p > 2);
              const showEllipsisAfter = isLast
                ? false
                : (p === model.safeTotal ? false : model.showRightEllipsis && p === model.pages[model.pages.length - 2] && p < model.safeTotal - 1);

              return (
                <React.Fragment key={p}>
                  {showEllipsisBefore && <span className="shrink-0 px-0.5 text-[10px] text-slate-400">…</span>}
                  <button
                    type="button"
                    onClick={() => onChangePage(p)}
                    className={`h-7 min-w-[26px] shrink-0 rounded px-1.5 text-[11px] font-bold ${
                      p === model.safePage ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {p}
                  </button>
                  {showEllipsisAfter && <span className="shrink-0 px-0.5 text-[10px] text-slate-400">…</span>}
                </React.Fragment>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => onChangePage(model.safePage + 1)}
            disabled={!canNext}
            className="h-7 min-w-[28px] shrink-0 rounded border border-slate-200 bg-white px-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
            title="Trang sau"
          >
            ›
          </button>
        </div>

        <label className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500">
          <span className="hidden sm:inline">/trang</span>
          <select
            value={safePageSize}
            onChange={(e) => onChangePageSize(Number(e.target.value) as PageSize)}
            className="h-7 max-w-[4.5rem] rounded border border-slate-200 bg-white px-1 text-[11px] font-bold text-slate-700 outline-none focus:ring-1 focus:ring-blue-500"
          >
            {pageSizeOptions
              .filter((n) => n <= 100)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
        </label>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 p-3 border-t bg-slate-50 ${className}`}>
      <div className="text-[11px] font-bold text-slate-500">
        Trang <b className="text-slate-700">{model.safePage}</b> / <b className="text-slate-700">{model.safeTotal}</b> – Tổng <b className="text-slate-700">{totalItems}</b> chứng từ
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
          Hiển thị
          <select
            value={safePageSize}
            onChange={(e) => onChangePageSize(Number(e.target.value) as PageSize)}
            className="h-[32px] rounded-lg border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
          >
            {pageSizeOptions
              .filter((n) => n <= 100)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onChangePage(1)}
            disabled={!canPrev}
            className="h-[32px] px-2 rounded-lg border border-slate-300 bg-white text-slate-600 font-black text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100"
            title="Trang đầu"
          >
            {'<<'}
          </button>
          <button
            onClick={() => onChangePage(model.safePage - 1)}
            disabled={!canPrev}
            className="h-[32px] rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            title="Trang trước"
          >
            {'<'}
          </button>

          <div className="flex items-center gap-1 px-1">
            {model.pages.map((p, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === model.pages.length - 1;
              const showEllipsisBefore = isFirst ? false : (p === 1 ? false : model.showLeftEllipsis && p === model.pages[1] && p > 2);
              const showEllipsisAfter = isLast ? false : (p === model.safeTotal ? false : model.showRightEllipsis && p === model.pages[model.pages.length - 2] && p < model.safeTotal - 1);

              return (
                <React.Fragment key={p}>
                  {showEllipsisBefore && <span className="px-1 font-semibold text-slate-400">…</span>}
                  <button
                    onClick={() => onChangePage(p)}
                    className={`h-[32px] min-w-[32px] rounded-lg border px-2 text-xs font-semibold transition-all ${
                      p === model.safePage ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {p}
                  </button>
                  {showEllipsisAfter && <span className="px-1 font-semibold text-slate-400">…</span>}
                </React.Fragment>
              );
            })}
          </div>

          <button
            onClick={() => onChangePage(model.safePage + 1)}
            disabled={!canNext}
            className="h-[32px] rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            title="Trang sau"
          >
            {'>'}
          </button>
          <button
            onClick={() => onChangePage(model.safeTotal)}
            disabled={!canNext}
            className="h-[32px] rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            title="Trang cuối"
          >
            {'>>'}
          </button>
        </div>
      </div>
    </div>
  );
}

