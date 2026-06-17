
import React, { useMemo } from 'react';
import { ImportLog } from '../types';
import { formatCurrency, formatDate } from '../utils';
import { History, FileText } from 'lucide-react';

interface ImportHistoryTableProps {
  logs: ImportLog[];
}

export const ImportHistoryTable: React.FC<ImportHistoryTableProps> = ({ logs }) => {
  // Calculate Totals
  const totals = useMemo(() => {
    return logs.reduce((acc, log) => {
        const vatAmount = log.totalAmount - log.preTaxTotal;
        return {
            quantity: acc.quantity + log.quantity,
            preTax: acc.preTax + log.preTaxTotal,
            vat: acc.vat + vatAmount,
            total: acc.total + log.totalAmount
        };
    }, { quantity: 0, preTax: 0, vat: 0, total: 0 });
  }, [logs]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 border-b border-gray-100">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <History className="text-blue-600"/> Lịch sử Nhập kho
        </h3>
        <p className="text-xs text-gray-500 mt-1">Ghi nhận thông tin lúc nhập hàng. Số liệu tại đây là cố định để đối chiếu.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-semibold">
            <tr>
              <th className="px-6 py-4 text-center">Ngày nhập</th>
              <th className="px-6 py-4 text-center">Chứng từ</th>
              <th className="px-6 py-4 text-center">Tên vật tư / NCC</th>
              <th className="px-6 py-4 text-center">SL Nhập</th>
              <th className="px-6 py-4 text-center">Đơn giá</th>
              <th className="px-6 py-4 text-center">Thành tiền (Trước thuế)</th>
              <th className="px-6 py-4 text-center">VAT</th>
              <th className="px-6 py-4 text-center">Tổng thanh toán</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 text-center text-sm text-gray-600">
                    {formatDate(log.importDate)}
                </td>
                <td className="px-6 py-4 text-center">
                    {log.invoiceRef ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 text-xs font-medium text-gray-700">
                            <FileText size={10}/> {log.invoiceRef}
                        </span>
                    ) : (
                        <span className="text-gray-400 text-xs">-</span>
                    )}
                </td>
                <td className="px-6 py-4">
                    <div className="font-medium text-slate-900">{log.itemName}</div>
                    <div className="text-xs text-gray-500">{log.supplier || '-'}</div>
                </td>
                <td className="px-6 py-4 text-center">
                    <span className="font-bold text-blue-700">+{log.quantity}</span>
                    <span className="text-xs text-gray-500 ml-1">{log.unit}</span>
                </td>
                <td className="px-6 py-4 text-right text-slate-600">
                    {formatCurrency(log.costPrice)}
                </td>
                <td className="px-6 py-4 text-right font-medium text-slate-700">
                    {formatCurrency(log.preTaxTotal)}
                </td>
                <td className="px-6 py-4 text-right">
                    <div className="text-slate-700">{formatCurrency(log.totalAmount - log.preTaxTotal)}</div>
                    <div className="text-[10px] text-gray-400">({log.vatRate}%)</div>
                </td>
                <td className="px-6 py-4 text-right font-bold text-slate-800">
                    {formatCurrency(log.totalAmount)}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
                <tr>
                    <td colSpan={8} className="text-center py-8 text-gray-400">Chưa có lịch sử nhập kho.</td>
                </tr>
            )}
          </tbody>
          {/* Footer Total Row */}
          {logs.length > 0 && (
             <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                    <td colSpan={3} className="px-6 py-4 font-bold text-slate-900 uppercase text-center">Tổng cộng</td>
                    <td className="px-6 py-4 text-center font-bold text-slate-900">{totals.quantity}</td>
                    <td className="px-6 py-4 text-center text-gray-400">-</td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900">{formatCurrency(totals.preTax)}</td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900">{formatCurrency(totals.vat)}</td>
                    <td className="px-6 py-4 text-right font-bold text-slate-800 text-lg">{formatCurrency(totals.total)}</td>
                </tr>
             </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
