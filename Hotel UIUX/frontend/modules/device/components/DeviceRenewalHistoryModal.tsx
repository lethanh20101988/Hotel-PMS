import React from 'react';
import { Clock3, FileText, History, Receipt, Wallet, X } from 'lucide-react';
import { Device } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';

interface DeviceRenewalHistoryModalProps {
  device: Device | null;
  onClose: () => void;
}

export const DeviceRenewalHistoryModal: React.FC<DeviceRenewalHistoryModalProps> = ({ device, onClose }) => {
  if (!device) return null;

  const formatMethodLabel = (value?: string) => {
    if (!value) return '---';
    if (value === 'BANK') return 'Chuyển khoản';
    if (value === 'CASH') return 'Tiền mặt';
    if (value === 'DEBT') return 'Ghi nợ';
    return value;
  };

  const history = [...(device.renewalHistory || [])].sort(
    (a, b) => new Date(b.renewedAt).getTime() - new Date(a.renewedAt).getTime(),
  );
  const totalRenewals = history.length;
  const totalRevenue = history.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden animate-fade-in border border-slate-200 flex flex-col">
        <div className="bg-slate-900 p-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white/10">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-none">Lịch sử gia hạn thiết bị</h3>
              <p className="text-[11px] text-slate-300 mt-1">
                {device.customerName || device.name} · {device.imei || 'Không có IMEI'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 border-b bg-slate-50 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] font-medium tracking-tight text-slate-400">Số lần gia hạn</div>
            <div className="mt-2 text-2xl font-bold text-slate-800">{totalRenewals}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] font-medium tracking-tight text-slate-400">Tổng doanh thu gia hạn</div>
            <div className="mt-2 text-xl font-bold text-emerald-700">{formatCurrency(totalRevenue)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] font-medium tracking-tight text-slate-400">Hạn hiện tại</div>
            <div className="mt-2 text-xl font-bold text-blue-700">{new Date(device.expiryDate).toLocaleDateString('vi-VN')}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 bg-white space-y-4">
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
              <History className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="mt-3 text-sm font-bold text-slate-600">Thiết bị này chưa có lịch sử gia hạn.</p>
              <p className="mt-1 text-xs text-slate-400">Sau khi thực hiện gia hạn, hệ thống sẽ tự lưu vết tại đây.</p>
            </div>
          ) : (
            history.map((item, index) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden">
                <div className="px-4 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-medium tracking-tight text-slate-400">Lần gia hạn #{totalRenewals - index}</div>
                    <div className="mt-1 flex items-center gap-2 text-sm font-bold text-slate-800">
                      <Clock3 className="w-4 h-4 text-blue-600" />
                      {new Date(item.renewedAt).toLocaleString('vi-VN')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-medium tracking-tight ${
                      item.paymentStatus === 'PAID'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {item.paymentStatus === 'PAID' ? 'Đã thanh toán' : 'Ghi nợ'}
                    </span>
                    <span className="px-3 py-1 rounded-full text-[10px] font-medium tracking-tight bg-slate-200 text-slate-700">
                      {item.durationMonths} tháng
                    </span>
                  </div>
                </div>

                <div className="p-4 grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Hạn cũ</span>
                      <span className="font-bold text-slate-700">{new Date(item.oldExpiryDate).toLocaleDateString('vi-VN')}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Hạn mới</span>
                      <span className="font-bold text-blue-700">{new Date(item.newExpiryDate).toLocaleDateString('vi-VN')}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Doanh thu chưa thuế</span>
                      <span className="font-bold">{formatCurrency(item.fee)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">VAT đầu ra ({item.vatRate}%)</span>
                      <span className="font-bold">{formatCurrency(item.vatAmount)}</span>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-slate-200 pt-2">
                      <span className="text-slate-500">Tổng thanh toán</span>
                      <span className="font-semibold text-emerald-700">{formatCurrency(item.totalAmount)}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Wallet className="w-4 h-4 text-slate-400" />
                      <span className="font-medium">Phương thức thu: <b>{formatMethodLabel(item.paymentMethod)}</b></span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-700">
                      <Receipt className="w-4 h-4 text-slate-400" />
                      <span className="font-medium">HĐ bán ra: <b>{item.salesInvoiceNumber || '---'}</b></span>
                    </div>
                    {item.purchaseInvoiceNumber && (
                      <div className="flex items-center gap-2 text-slate-700">
                        <FileText className="w-4 h-4 text-slate-400" />
                        <span className="font-medium">HĐ đầu vào: <b>{item.purchaseInvoiceNumber}</b></span>
                      </div>
                    )}
                    {item.inputCostSupplier && (
                      <div className="rounded-xl border border-slate-200 bg-white p-3 mt-3">
                        <div className="text-[10px] font-medium tracking-tight text-slate-400 mb-2">Giá vốn ghi nhận</div>
                        <div className="space-y-1.5 text-xs text-slate-600">
                          <div className="flex justify-between gap-3">
                            <span>Nhà cung cấp</span>
                            <span className="font-bold text-slate-800 text-right">{item.inputCostSupplier}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span>Chi phí chưa thuế</span>
                            <span className="font-bold">{formatCurrency(item.inputCostPrice || 0)}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span>VAT đầu vào ({item.inputCostVatRate || 0}%)</span>
                            <span className="font-bold">{formatCurrency(item.inputCostVatAmount || 0)}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span>Tổng giá vốn</span>
                            <span className="font-semibold text-emerald-700">{formatCurrency(item.inputCostTotal || 0)}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span>Thanh toán NCC</span>
                            <span className="font-bold">{formatMethodLabel(item.inputCostPaymentMethod)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t bg-slate-50 text-right">
          <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
