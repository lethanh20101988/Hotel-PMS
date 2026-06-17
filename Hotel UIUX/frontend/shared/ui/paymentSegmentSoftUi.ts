/**
 * Soft UI — phân cấc nghiệp vụ thanh toán (331 / 1111 / 1121).
 * Nền pastel, chữ đậm cùng tông, bóng nhẹ khi active.
 */
export const paymentSegmentSoftUi = {
  tablist:
    'flex h-7 min-w-0 shrink flex-1 rounded-lg border border-slate-200/90 bg-white/95 p-0.5 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] sm:max-w-md',
  /** Phiếu nhập/xuất kho — 3 cột đều, nhãn xuống dòng, không đè chữ */
  tablistWarehouse:
    'grid w-full min-w-0 grid-cols-3 gap-1 rounded-lg border border-slate-200/90 bg-white/95 p-1 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)]',
  /** Ghi nợ / Công nợ — hồng nhạt */
  debtActive:
    'bg-rose-50 text-rose-900 shadow-[0_1px_4px_rgba(225,29,72,0.12)] ring-1 ring-rose-200/60',
  debtInactive: 'text-slate-600 hover:bg-rose-50/60',
  /** Tiền mặt 1111 — xanh lá nhạt */
  cashActive:
    'bg-emerald-50 text-emerald-900 shadow-[0_1px_4px_rgba(5,150,105,0.12)] ring-1 ring-emerald-200/60',
  cashInactive: 'text-slate-600 hover:bg-emerald-50/60',
  /** Chuyển khoản 1121 — xanh dương nhạt */
  bankActive:
    'bg-sky-50 text-sky-900 shadow-[0_1px_4px_rgba(2,132,199,0.12)] ring-1 ring-sky-200/60',
  bankInactive: 'text-slate-600 hover:bg-sky-50/60',
  buttonBase:
    'flex min-w-0 flex-1 items-center justify-center rounded-md px-1 text-[9px] font-semibold leading-tight transition-colors sm:text-[10px]',
  buttonBaseWarehouse:
    'flex min-h-9 w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-center text-[10px] font-semibold leading-snug whitespace-normal transition-colors sm:px-2 sm:text-[11px]',
  bankSelect:
    'h-9 w-full min-w-0 rounded-md border border-sky-200/90 bg-sky-50/50 px-2 text-[11px] font-semibold text-sky-950 outline-none focus:border-sky-300 focus:ring-1 focus:ring-sky-400/35 sm:max-w-md',
  /** Cùng tông sky, chiều cao h-9 (modal HĐ) */
  bankSelectMd:
    'h-9 min-w-0 max-w-full flex-1 rounded-md border border-sky-200/90 bg-sky-50/50 px-2.5 text-[11px] font-semibold leading-snug text-sky-950 outline-none focus:border-sky-300 focus:ring-1 focus:ring-sky-400/35 sm:basis-[14rem]',
} as const;
