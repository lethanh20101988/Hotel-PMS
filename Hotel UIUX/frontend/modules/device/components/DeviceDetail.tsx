
import React from 'react';
import { Eye, X } from 'lucide-react';
import { Device } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';

interface DeviceDetailProps {
  device: Device | null;
  onClose: () => void;
}

export const DeviceDetail: React.FC<DeviceDetailProps> = ({ device, onClose }) => {
  if (!device) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-fade-in">
        <div className="bg-slate-100 p-4 flex justify-between items-center border-b">
          <h3 className="font-bold text-slate-700 flex items-center gap-2">
            <Eye className="w-5 h-5" /> Chi tiết thiết bị
          </h3>
          <button onClick={onClose} className="hover:bg-slate-200 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
           <div className="flex justify-between">
              <span className="text-slate-500">Tên/Khách hàng:</span>
              <span className="font-bold">{device.customerName || device.name}</span>
           </div>
           <div className="flex justify-between">
              <span className="text-slate-500">Biển số:</span>
              <span className="font-bold">{device.licensePlate}</span>
           </div>
           <div className="flex justify-between">
              <span className="text-slate-500">IMEI:</span>
              <span className="font-mono">{device.imei}</span>
           </div>
           <div className="flex justify-between">
              <span className="text-slate-500">Gói cước:</span>
              <span className="font-bold text-blue-600">{device.telecomPlan}</span>
           </div>
           <div className="flex justify-between">
              <span className="text-slate-500">Ngày hết hạn:</span>
              <span className={`font-bold ${new Date(device.expiryDate) < new Date() ? 'text-red-600' : 'text-emerald-600'}`}>
                 {new Date(device.expiryDate).toLocaleDateString('vi-VN')}
              </span>
           </div>
           <div className="flex justify-between pt-2 border-t">
              <span className="text-slate-500">Phí gia hạn (Năm):</span>
              <span className="font-bold">{formatCurrency(device.renewalFee)}</span>
           </div>
           <div className="flex justify-between">
              <span className="text-slate-500">Số lần gia hạn:</span>
              <span className="font-bold text-blue-600">{device.renewalHistory?.length || 0}</span>
           </div>
        </div>
        <div className="p-4 bg-slate-50 border-t text-right">
           <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-bold">Đóng</button>
        </div>
      </div>
    </div>
  );
};
