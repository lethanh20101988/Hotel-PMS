
import React from 'react';
import { RefreshCw, Eye, Edit, Trash2, Camera, MapPin, History } from 'lucide-react';
import { Device, DeviceStatus, DeviceType } from '@shared/types';
import { calculateRemainingDays, formatCurrency } from '@shared/utils/format';

interface DeviceTableProps {
  devices: Device[];
  onRenew: (device: Device) => void;
  onHistory: (device: Device) => void;
  onView: (device: Device) => void;
  onEdit: (device: Device) => void;
  onDelete: (device: Device) => void;
}

export const DeviceTable: React.FC<DeviceTableProps> = ({ devices, onRenew, onHistory, onView, onEdit, onDelete }) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse bg-white">
        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold tracking-tight text-slate-600">
          <tr>
            <th className="p-4 text-center w-[80px]">ID</th>
            <th className="p-4 text-center w-[120px]">Loại thiết bị</th>
            <th className="p-4 text-center w-[150px]">Số Serial</th>
            <th className="p-4 text-center w-[160px]">Mã IMEI</th>
            <th className="p-4 text-center w-[150px]">Nhà cung cấp</th>
            <th className="p-4 text-center w-[110px]">Biển số</th>
            <th className="p-4 text-left min-w-[200px]">Khách hàng / Tài khoản</th>
            <th className="p-4 text-center w-[110px]">Ngày hết hạn</th>
            <th className="p-4 text-center w-[100px]">Trạng thái</th>
            <th className="p-4 text-center w-[120px]">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {devices.map((device: Device) => {
            const remainingDays = calculateRemainingDays(device.expiryDate);

            return (
              <tr
                key={device.id}
                className="hover:bg-blue-50/30 transition-colors group cursor-pointer"
                onClick={() => onView(device)}
                title="Click để xem chi tiết"
              >
                {/* 1. ID */}
                <td className="p-4 text-center">
                  <span className="font-mono text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">
                    {device.id.slice(-6)}
                  </span>
                </td>

                {/* 2. Loại */}
                <td className="p-4 text-center">
                  <div className="flex flex-col items-center justify-center">
                    {device.type === DeviceType.CAMERA ? (
                      <Camera className="w-4 h-4 text-indigo-500 mb-1" />
                    ) : (
                      <MapPin className="w-4 h-4 text-emerald-500 mb-1" />
                    )}
                    <span className={`text-[9px] font-medium tracking-tight ${device.type === DeviceType.CAMERA ? 'text-indigo-600' : 'text-emerald-600'}`}>
                      {device.type === DeviceType.CAMERA ? 'Camera' : 'GPS Tracker'}
                    </span>
                  </div>
                </td>

                {/* 3. Serial */}
                <td className="p-4 text-center font-mono text-[11px] text-slate-600 font-bold bg-slate-50/50">
                  {device.serial || '---'}
                </td>

                {/* 4. IMEI */}
                <td className="p-4 text-center font-mono text-[12px] font-semibold tracking-tight text-blue-700">
                  {device.imei}
                </td>

                {/* 5. Nhà cung cấp */}
                <td className="p-4 text-center">
                  <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 truncate block">
                    {device.provider || 'Victory Tech'}
                  </span>
                </td>

                {/* 6. Biển số */}
                <td className="p-4 text-center font-semibold tracking-tight whitespace-nowrap text-slate-700">
                  {device.licensePlate || '---'}
                </td>

                {/* 7. Khách hàng */}
                <td className="p-4 text-left">
                  <div className="font-bold text-slate-800 text-[13px] truncate">{device.customerName}</div>
                  <div className="flex items-center gap-1.5 mt-0.5 overflow-hidden">
                    <span className="text-[10px] text-blue-600 font-bold lowercase bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 truncate max-w-[120px]">@{device.username}</span>
                  </div>
                </td>

                {/* 8. Ngày hết hạn */}
                <td className="p-4 text-center whitespace-nowrap">
                  <div className={`text-[12px] font-bold ${remainingDays < 0 ? 'text-red-500' : 'text-slate-700'}`}>
                    {new Date(device.expiryDate).toLocaleDateString('vi-VN')}
                  </div>
                  <div className={`mt-0.5 text-[9px] font-medium ${
                    remainingDays < 0 ? 'text-red-600' : 
                    remainingDays < 30 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {remainingDays < 0 ? 'Hết hạn' : `Còn ${remainingDays} ngày`}
                  </div>
                </td>

                {/* 9. Trạng thái */}
                <td className="p-4 text-center">
                  <span className={`inline-flex w-full items-center justify-center rounded border px-2 py-1 text-[10px] font-medium tracking-tight shadow-sm ${
                    device.status === DeviceStatus.ACTIVE ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    device.status === DeviceStatus.EXPIRED ? 'bg-red-50 text-red-700 border-red-200' :
                    'bg-slate-50 text-slate-600 border-slate-200'
                  }`}>
                    {device.status}
                  </span>
                </td>

                {/* 10. Thao tác */}
                <td className="p-4 text-center">
                  <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => { e.stopPropagation(); onRenew(device); }}
                        className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-md transition-all" 
                        title="Gia hạn"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onHistory(device); }}
                        className="p-1.5 text-violet-600 hover:bg-violet-100 rounded-md transition-all"
                        title={`Lịch sử gia hạn (${device.renewalHistory?.length || 0})`}
                      >
                        <History className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onView(device); }}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-all" 
                        title="Xem"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onEdit(device); }}
                        className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-100 rounded-md transition-all" 
                        title="Sửa"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onDelete(device); }}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-100 rounded-md transition-all" 
                        title="Xóa"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {devices.length === 0 && (
            <tr>
              <td colSpan={10} className="p-16 text-center text-slate-400 font-medium">
                Chưa có dữ liệu thiết bị.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
