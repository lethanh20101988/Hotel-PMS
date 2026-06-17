import React from 'react';
import { Eye, Trash2, Pencil, CheckCircle2, Lock } from 'lucide-react';
import { Invoice } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { recomputeInvoiceHeaderTotals } from '@shared/utils/vatRate';
import { hasDeferredRevenueAllocationsPosted, isDeferredRevenueInvoice } from '@shared/utils/deferredRevenue';
import { useApp } from '../../../app/store';

interface InvoiceManagerViewProps {
  invoices: Invoice[];
  onView: (invoice: Invoice) => void;
  onEdit: (id: string) => void;
  onDelete: (invoice: Invoice) => void;
}

export const InvoiceManagerView: React.FC<InvoiceManagerViewProps> = ({
  invoices,
  onView,
  onEdit,
  onDelete,
}) => {
  const { allJournalEntriesAcrossYears } = useApp();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left min-w-[800px]">
          <thead className="bg-slate-100/90 text-slate-600 text-[11px] font-semibold tracking-tight border-b border-slate-200">
            <tr>
              <th className="px-4 py-3.5 align-bottom">Số HĐ</th>
              <th className="px-4 py-3.5 align-bottom">Ngày</th>
              <th className="px-4 py-3.5 align-bottom min-w-[10rem]">Khách hàng / Đối tác</th>
              <th className="px-4 py-3.5 align-bottom w-[8.5rem]">
                <span className="block leading-tight">Loại HĐ</span>
              </th>
              <th className="px-4 py-3.5 text-right align-bottom whitespace-nowrap">Tổng tiền</th>
              <th className="px-4 py-3.5 text-center align-bottom">Trạng thái</th>
              <th className="px-4 py-3.5 text-right align-bottom w-28">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((inv) => {
              const deferredRevenue = isDeferredRevenueInvoice(inv);
              const deferredLocked = deferredRevenue && hasDeferredRevenueAllocationsPosted(inv, allJournalEntriesAcrossYears);
              const hasSeparatePayment = deferredRevenue && inv.status === 'PAID' && !!inv.paymentVoucherNumber;
              return (
                <tr
                  key={`${inv.id}-${inv.invoiceNumber}-${inv.date}`}
                  className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                  onClick={() => onView(inv)}
                  title="Click để xem chi tiết"
                >
                  <td className="px-4 py-4 font-mono font-bold text-slate-800 align-top">{inv.invoiceNumber || inv.id}</td>
                  <td className="px-4 py-4 text-slate-600 tabular-nums align-top whitespace-nowrap">{inv.date}</td>
                  <td className="px-4 py-4 font-medium text-slate-800 align-top leading-snug">{inv.customerName}</td>
                  <td className="px-4 py-4 align-top">
                    <div className="flex flex-wrap gap-1">
                      <span
                        className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-md font-semibold ${
                          inv.type === 'SALES' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {inv.type === 'SALES' ? 'Bán ra' : 'Mua vào'}
                      </span>
                      {inv.category === 'SERVICE' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-black">DV</span>
                      )}
                      {deferredRevenue && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-black">3387</span>
                      )}
                      {deferredLocked && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-100 text-red-800 font-black">Đã khóa</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right font-bold text-slate-800 align-top tabular-nums whitespace-nowrap">
                    {formatCurrency(recomputeInvoiceHeaderTotals(inv).totalAmount)}
                  </td>
                  <td className="px-4 py-4 text-center align-top">
                    <div className="flex flex-col items-center gap-1.5">
                      <span
                        className={`text-[10px] px-2.5 py-1 rounded-md font-semibold inline-flex items-center justify-center gap-1 w-fit ${
                          inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {inv.status === 'PAID' ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : null}
                        {inv.status === 'PAID' ? 'Đã thanh toán' : 'Chưa thanh toán'}
                      </span>
                      {hasSeparatePayment && (
                        <span className="text-[9px] px-2 py-1 rounded-md font-semibold bg-indigo-100 text-indigo-800 max-w-[11rem] leading-tight">
                          Đã thu tiền riêng
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 align-top" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {deferredLocked ? (
                        <span
                          className="inline-flex items-center justify-center rounded-lg border border-red-100 bg-red-50 p-1.5 text-red-800"
                          title="Hóa đơn đã có kỳ phân bổ 3387 — bị khóa sửa/xóa"
                        >
                          <Lock className="w-4 h-4 shrink-0" aria-hidden />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onEdit(inv.id);
                          }}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-100"
                          title="Sửa hóa đơn"
                          aria-label="Sửa hóa đơn"
                        >
                          <Pencil className="w-4 h-4 shrink-0" aria-hidden />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onView(inv);
                        }}
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                        title="Xem"
                        aria-label="Xem"
                      >
                        <Eye className="w-4 h-4" aria-hidden />
                      </button>
                      {deferredLocked ? (
                        <span
                          className="inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-slate-100 bg-slate-50 p-1.5 text-slate-400"
                          title="Hóa đơn 3387 đã phân bổ — không xóa được"
                        >
                          <Lock className="w-4 h-4" aria-hidden />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onDelete(inv);
                          }}
                          className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                          title="Xóa"
                          aria-label="Xóa"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
