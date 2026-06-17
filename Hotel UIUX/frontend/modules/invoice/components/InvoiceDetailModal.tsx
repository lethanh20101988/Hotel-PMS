
import React, { useMemo } from 'react';
import { Eye, X, Printer, Download, Clock, Lock } from 'lucide-react';
import { Invoice } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { formatVatRateLabel, recomputeInvoiceHeaderTotals } from '@shared/utils/vatRate';
import {
  buildDeferredRevenueScheduleWithStatus,
  getDeferredRevenueRecognitionAccount,
  getDeferredRevenueRemainingBalance,
  hasDeferredRevenueAllocationsPosted,
  isDeferredRevenueInvoice,
} from '@shared/utils/deferredRevenue';
import { useApp } from '../../../app/store';

interface InvoiceDetailModalProps {
  invoice: Invoice | null;
  onClose: () => void;
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({ invoice, onClose }) => {
  const { allJournalEntriesAcrossYears } = useApp();

  const getVatRateLabel = () => {
    const ratesFromDetails = Array.from(
      new Set((invoice.details || []).map((d) => Number((d as any).vatRate)).filter((n) => Number.isFinite(n)))
    ).sort((a, b) => a - b);
    if (ratesFromDetails.length === 1) return formatVatRateLabel(ratesFromDetails[0]);
    if (ratesFromDetails.length > 1) return ratesFromDetails.map(formatVatRateLabel).join(' / ');
    if (typeof (invoice as any).vatRate === 'number') return formatVatRateLabel((invoice as any).vatRate);
    return '—';
  };

  const deferredRevenueSchedule = useMemo(
    () => buildDeferredRevenueScheduleWithStatus(invoice, allJournalEntriesAcrossYears),
    [invoice, allJournalEntriesAcrossYears],
  );
  const deferredRevenueRemaining = useMemo(
    () => getDeferredRevenueRemainingBalance(invoice, allJournalEntriesAcrossYears),
    [invoice, allJournalEntriesAcrossYears],
  );
  const deferredRevenueLocked = useMemo(
    () => hasDeferredRevenueAllocationsPosted(invoice, allJournalEntriesAcrossYears),
    [invoice, allJournalEntriesAcrossYears],
  );

  if (!invoice) return null;

  const hdrTotals = recomputeInvoiceHeaderTotals(invoice);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        <div className="bg-slate-800 p-4 text-white flex justify-between items-center">
          <h3 className="font-bold flex items-center gap-2">
            <Eye className="w-5 h-5" /> Chi tiết Hóa đơn #{invoice.invoiceNumber || invoice.id}
          </h3>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="p-8 overflow-y-auto flex-1 bg-white">
          <div className="flex justify-between items-start mb-8">
             <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-800">Hóa đơn {invoice.type === 'SALES' ? 'bán hàng' : 'mua hàng'}</h1>
                <p className="text-slate-500">
                  Ngày trên HĐ: {new Date(invoice.date).toLocaleDateString('vi-VN')}
                  {invoice.accountingPostingDate && invoice.accountingPostingDate !== String(invoice.date).split('T')[0] && (
                    <span className="block text-amber-800 font-medium">
                      Ngày hạch toán (kỳ phát hiện): {new Date(invoice.accountingPostingDate).toLocaleDateString('vi-VN')}
                    </span>
                  )}
                </p>
                {invoice.crossPeriodMeta && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
                    <p className="font-bold">Hóa đơn khác niên độ</p>
                    <p>
                      Mức: {invoice.crossPeriodMeta.materiality === 'MATERIAL' ? 'Trọng yếu (TK 421)' : 'Không trọng yếu (DT/CP kỳ hiện tại)'}
                      {invoice.crossPeriodMeta.supplementaryVat ? ' · Thuế: kê khai tại kỳ phát hiện (bổ sung nếu cần)' : ''}
                    </p>
                    {invoice.crossPeriodMeta.auditTrail?.length ? (
                      <ul className="mt-1 list-disc pl-4 text-[10px] text-amber-900/90">
                        {invoice.crossPeriodMeta.auditTrail.slice(-5).map((e, i) => (
                          <li key={i}>
                            {new Date(e.at).toLocaleString('vi-VN')}: {e.action}
                            {e.detail ? ` — ${e.detail}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
                {invoice.taxFilingMeta && (
                  <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-950">
                    <p className="font-bold">Kỳ kê khai GTGT</p>
                    <p>
                      Tách sổ / thuế:{' '}
                      {invoice.taxFilingMeta.accountingTaxSplit === 'SAME_FY_LATE_TAX'
                        ? 'Cùng niên độ — sổ theo ngày HĐ, thuế neo kỳ phát hiện'
                        : 'Khác niên độ hoặc kỳ khóa cứng'}
                    </p>
                    {invoice.vatFilingAnchorDate && (
                      <p>
                        Neo kỳ tổng hợp thuế: <b>{invoice.vatFilingAnchorDate}</b>
                        {invoice.taxFilingMeta.invoicePeriodKey ? ` · Kỳ phát sinh (tháng): ${invoice.taxFilingMeta.invoicePeriodKey}` : ''}
                      </p>
                    )}
                    {(invoice.taxFilingMeta.suggestedCt37Delta ||
                      invoice.taxFilingMeta.suggestedCt38Delta ||
                      invoice.taxFilingMeta.filingAdjustmentNetDelta) ? (
                      <p>
                        Gợi ý lần lưu gần nhất:{' '}
                        {invoice.taxFilingMeta.suggestedCt37Delta
                          ? `[37] +${formatCurrency(invoice.taxFilingMeta.suggestedCt37Delta)}`
                          : null}
                        {invoice.taxFilingMeta.suggestedCt37Delta && invoice.taxFilingMeta.suggestedCt38Delta
                          ? ' · '
                          : null}
                        {invoice.taxFilingMeta.suggestedCt38Delta
                          ? `[38] +${formatCurrency(invoice.taxFilingMeta.suggestedCt38Delta)}`
                          : null}
                        {invoice.taxFilingMeta.filingAdjustmentNetDelta ? (
                          <span className="block text-[10px] text-sky-800/90 mt-0.5">
                            Chênh có dấu (đầu ra − đầu vào):{' '}
                            {invoice.taxFilingMeta.filingAdjustmentNetDelta > 0 ? '+' : ''}
                            {formatCurrency(invoice.taxFilingMeta.filingAdjustmentNetDelta)}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    {invoice.taxFilingMeta.filingAdjustmentPriorVat != null &&
                    invoice.taxFilingMeta.filingAdjustmentPriorVat > 0 ? (
                      <p className="text-[10px] text-sky-800/80">
                        Mốc thuế trước lần lưu: {formatCurrency(invoice.taxFilingMeta.filingAdjustmentPriorVat)}
                      </p>
                    ) : null}
                    {invoice.taxFilingMeta.auditTrail?.length ? (
                      <ul className="mt-1 list-disc pl-4 text-[10px] text-sky-900/90">
                        {invoice.taxFilingMeta.auditTrail.slice(-5).map((e, i) => (
                          <li key={i}>
                            {new Date(e.at).toLocaleString('vi-VN')}: {e.action}
                            {e.detail ? ` — ${e.detail}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
                <p className="text-slate-500">Số: <span className="text-red-600 font-bold">{invoice.invoiceNumber}</span></p>
                <p className="text-slate-500">Ký hiệu: {invoice.symbolCode || '---'}</p>
                <p className="text-slate-500">Mẫu số: {invoice.formNo || '---'}</p>
             </div>
             <div className="text-right">
                <h2 className="text-lg font-bold tracking-tight text-slate-800">Công ty TNHH TMDV và Công nghệ Victory</h2>
                <p className="text-sm text-slate-500">MST: 0109238339</p>
                <p className="text-sm text-slate-500">Địa chỉ: Số 5, tổ 4, phường Phúc Lợi, TP Hà Nội, Việt Nam</p>
                <p className="text-sm text-slate-500">Email: Hanoivictory@gmail.com</p>
                <p className="text-sm text-slate-500">Di động: 0922248868</p>
             </div>
          </div>

          <div className="grid grid-cols-2 gap-8 mb-8">
             <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                <h3 className="font-bold text-slate-700 mb-2 border-b pb-1">Thông tin Người mua</h3>
                <div className="space-y-1 text-sm">
                   <p><span className="text-slate-500 w-24 inline-block">Đơn vị:</span> <span className="font-medium">{invoice.buyerUnitName || invoice.customerName}</span></p>
                   <p><span className="text-slate-500 w-24 inline-block">Người mua:</span> <span className="font-medium">{invoice.buyerLegalName || '---'}</span></p>
                   <p><span className="text-slate-500 w-24 inline-block">MST:</span> <span className="font-medium">{invoice.buyerTaxCode || '---'}</span></p>
                   <p><span className="text-slate-500 w-24 inline-block">Địa chỉ:</span> <span className="font-medium">{invoice.buyerAddress || '---'}</span></p>
                </div>
             </div>
             <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                <h3 className="font-bold text-slate-700 mb-2 border-b pb-1">Thông tin Thanh toán</h3>
                <div className="space-y-1 text-sm">
                   <p><span className="text-slate-500 w-32 inline-block">Hình thức:</span> <span className="font-medium">{invoice.paymentMethod || 'Tiền mặt/Chuyển khoản'}</span></p>
                   <p><span className="text-slate-500 w-32 inline-block">Trạng thái:</span> <span className="font-medium text-emerald-600">{invoice.status}</span></p>
                   <p><span className="text-slate-500 w-32 inline-block">Cách ghi nhận:</span> <span className="font-medium">{invoice.paymentPostingMode === 'DIRECT' ? 'Thanh toán ngay trên hóa đơn' : 'Qua công nợ / thu sau'}</span></p>
                   <p><span className="text-slate-500 w-32 inline-block">Ngày thanh toán:</span> <span className="font-medium">{invoice.paymentDate || (invoice.status === 'PAID' ? invoice.date : '---')}</span></p>
                   <p><span className="text-slate-500 w-32 inline-block">Số phiếu thu/báo có:</span> <span className="font-medium">{invoice.paymentVoucherNumber || '---'}</span></p>
                   <p><span className="text-slate-500 w-32 inline-block">Loại tiền:</span> <span className="font-medium">{invoice.currency || 'VND'}</span></p>
                </div>
             </div>
          </div>

          {isDeferredRevenueInvoice(invoice) && (
            <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
              <div className="flex items-center justify-between border-b border-amber-200 pb-3">
                <div>
                  <h3 className="font-bold text-amber-900 flex items-center gap-2">
                    <Clock className="w-4 h-4" /> Bảng kê phân bổ doanh thu chưa thực hiện 3387
                  </h3>
                  <p className="text-xs text-amber-800 mt-1">
                    Theo dõi theo Khách hàng <b>{invoice.customerName}</b> và Mã hóa đơn <b>{invoice.invoiceNumber}</b>.
                  </p>
                </div>
                {deferredRevenueLocked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-[11px] font-bold text-red-700">
                    <Lock className="w-3 h-3" /> Đã khóa hóa đơn gốc
                  </span>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div className="rounded-xl border border-white/70 bg-white/80 p-4">
                  <div className="text-[10px] font-medium text-slate-500 text-[10px]">TK treo / TK ghi nhận</div>
                  <div className="mt-1 font-bold text-slate-800">3387{' -> '}{getDeferredRevenueRecognitionAccount(invoice)}</div>
                  <div className="mt-1 text-xs text-slate-500">VAT đầu ra vẫn ghi nhận ngay vào 3331 tại thời điểm xuất hóa đơn.</div>
                </div>
                <div className="rounded-xl border border-white/70 bg-white/80 p-4">
                  <div className="text-[10px] font-medium text-slate-500 text-[10px]">Kỳ thực hiện dịch vụ</div>
                  <div className="mt-1 font-bold text-slate-800">{invoice.serviceStartDate}{' -> '}{invoice.serviceEndDate}</div>
                  <div className="mt-1 text-xs text-slate-500">Số dư 3387 còn lại: <b>{formatCurrency(deferredRevenueRemaining)}</b></div>
                </div>
              </div>
              <div className="mt-4 overflow-hidden rounded-xl border border-amber-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-amber-50 text-[10px] font-medium text-slate-500">
                    <tr>
                      <th className="p-3 text-left border-b border-amber-100">Kỳ phân bổ</th>
                      <th className="p-3 text-left border-b border-amber-100">Khoảng ngày</th>
                      <th className="p-3 text-center border-b border-amber-100">Số ngày</th>
                      <th className="p-3 text-right border-b border-amber-100">Số tiền</th>
                      <th className="p-3 text-right border-b border-amber-100">Số dư còn lại</th>
                      <th className="p-3 text-center border-b border-amber-100">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deferredRevenueSchedule.map((row) => (
                      <tr key={row.period} className="border-b border-amber-50 last:border-b-0">
                        <td className="p-3 font-bold text-slate-800">{row.periodLabel}</td>
                        <td className="p-3 text-slate-600">{row.startDate}{' -> '}{row.endDate}</td>
                        <td className="p-3 text-center text-slate-600">{row.days}</td>
                        <td className="p-3 text-right font-bold text-amber-700">{formatCurrency(row.amount)}</td>
                        <td className="p-3 text-right font-medium text-slate-700">{formatCurrency(row.remainingBalance)}</td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${row.posted ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {row.posted ? 'Đã phân bổ' : 'Chưa phân bổ'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <table className="w-full text-sm mb-8">
             <thead className="bg-slate-100 text-slate-700 text-xs font-semibold tracking-tight">
                <tr>
                   <th className="p-3 text-center border">STT</th>
                   <th className="p-3 text-left border">Tên hàng hóa, dịch vụ</th>
                   <th className="p-3 text-center border">ĐVT</th>
                   <th className="p-3 text-right border">Số lượng</th>
                   <th className="p-3 text-right border">Đơn giá</th>
                   <th className="p-3 text-right border">Thành tiền</th>
                   <th className="p-3 text-center border">VAT</th>
                </tr>
             </thead>
             <tbody className="text-slate-700">
                {invoice.details && invoice.details.length > 0 ? (
                   invoice.details.map((item, idx) => (
                      <tr key={idx}>
                         <td className="p-3 text-center border">{idx + 1}</td>
                         <td className="p-3 border font-medium">
                           <div className="font-medium">{item.productName}</div>
                           {(item as any).note && <div className="text-[11px] text-slate-500 mt-1">{(item as any).note}</div>}
                         </td>
                         <td className="p-3 text-center border">{item.unit}</td>
                         <td className="p-3 text-right border">{item.quantity}</td>
                         <td className="p-3 text-right border">{formatCurrency(item.price)}</td>
                         <td className="p-3 text-right border font-bold">{formatCurrency(item.amount)}</td>
                         <td className="p-3 text-center border">{formatVatRateLabel(Number((item as any).vatRate))}</td>
                      </tr>
                   ))
                ) : (
                   <tr>
                      <td className="p-3 text-center border">1</td>
                      <td className="p-3 border font-medium">{invoice.description}</td>
                      <td className="p-3 text-center border">{invoice.unit || 'Lần'}</td>
                      <td className="p-3 text-right border">{invoice.quantity || 1}</td>
                      <td className="p-3 text-right border">{formatCurrency(invoice.amount)}</td>
                      <td className="p-3 text-right border font-bold">{formatCurrency(invoice.amount)}</td>
                      <td className="p-3 text-center border">{getVatRateLabel()}</td>
                   </tr>
                )}
             </tbody>
             <tfoot className="bg-slate-50 font-bold">
                <tr>
                   <td colSpan={5} className="p-3 text-right border">Cộng tiền hàng:</td>
                   <td className="p-3 text-right border">{formatCurrency(hdrTotals.amount)}</td>
                   <td className="border"></td>
                </tr>
                <tr>
                   <td colSpan={5} className="p-3 text-right border">Tiền thuế VAT:</td>
                   <td className="p-3 text-right border">{formatCurrency(hdrTotals.vatAmount)}</td>
                   <td className="border"></td>
                </tr>
                <tr className="bg-slate-100 text-blue-800">
                   <td colSpan={5} className="border p-3 text-right">Tổng thanh toán:</td>
                   <td className="p-3 text-right border text-lg">{formatCurrency(hdrTotals.totalAmount)}</td>
                   <td className="border"></td>
                </tr>
             </tfoot>
          </table>

          <div className="grid grid-cols-2 gap-10 text-center mt-12">
             <div>
                <p className="font-bold text-slate-700">Người mua hàng</p>
                <p className="text-xs text-slate-400 italic">(Ký, ghi rõ họ tên)</p>
             </div>
             <div>
                <p className="font-bold text-slate-700">Người bán hàng</p>
                <p className="text-xs text-slate-400 italic">(Ký, ghi rõ họ tên, đóng dấu)</p>
             </div>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t flex justify-between items-center">
           <button className="flex items-center gap-2 text-slate-600 hover:text-blue-600 font-medium px-4 py-2">
              <Printer className="w-4 h-4" /> In hóa đơn
           </button>
           <div className="flex gap-2">
               <button className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded shadow-sm">
                  <Download className="w-4 h-4" /> Tải PDF
               </button>
               <button onClick={onClose} className="bg-white border hover:bg-slate-50 text-slate-700 font-medium px-4 py-2 rounded shadow-sm">
                  Đóng
               </button>
           </div>
        </div>
      </div>
    </div>
  );
};
