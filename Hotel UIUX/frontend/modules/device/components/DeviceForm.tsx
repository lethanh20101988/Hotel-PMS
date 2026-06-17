
import React, { useState, useEffect } from 'react';
import { Plus, X, Edit } from 'lucide-react';
import { Device, DeviceType, DeviceStatus } from '@shared/types';
import { VAT_RATE_NOT_SUBJECT } from '@shared/utils/vatRate';

interface DeviceFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (device: Partial<Device>) => void;
  device?: Device; // If present, edit mode
}

export const DeviceForm: React.FC<DeviceFormProps> = ({ isOpen, onClose, onSave, device }) => {
  if (!isOpen) return null;

  const [formData, setFormData] = useState<Partial<Device>>({
    name: '', type: DeviceType.GPS, imei: '', serial: '', provider: '',
    activationDate: new Date().toISOString().split('T')[0],
    expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
    status: DeviceStatus.ACTIVE, phoneNumber: '', licensePlate: '',
    customerName: '', customerPhone: '', username: '',
    planName: 'Gói Gia hạn Tiêu chuẩn (1 Năm)', telecomPlan: '', renewalFee: 0, vatRate: 10
  });

  useEffect(() => {
    if (device) {
      setFormData(device);
    }
  }, [device]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    let parsedValue: any = value;
    if (type === 'number') {
      parsedValue = parseFloat(value) || 0;
    } else if (name === 'vatRate') {
      parsedValue = parseInt(value, 10);
    }

    setFormData(prev => ({ ...prev, [name]: parsedValue }));
  };

  const isEdit = !!device;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        <div className={`${isEdit ? 'bg-amber-500' : 'bg-blue-600'} p-4 text-white flex justify-between items-center`}>
          <h3 className="font-bold flex items-center gap-2">
            {isEdit ? <Edit className="w-5 h-5" /> : <Plus className="w-5 h-5" />} 
            {isEdit ? 'Sửa thông tin thiết bị' : 'Thêm Thiết bị Mới'}
          </h3>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 gap-4">
             <input name="name" value={formData.name} placeholder="Tên thiết bị / Khách hàng" className="p-2 border rounded" onChange={handleChange} />
             <select name="type" className="p-2 border rounded" onChange={handleChange} value={formData.type}>
                <option value={DeviceType.GPS}>GPS Tracker</option>
                <option value={DeviceType.CAMERA}>Camera</option>
             </select>
             <input name="imei" value={formData.imei} placeholder="IMEI" className="p-2 border rounded" onChange={handleChange} />
             <input name="serial" value={formData.serial} placeholder="Serial Number" className="p-2 border rounded" onChange={handleChange} />
             <input name="licensePlate" value={formData.licensePlate} placeholder="Biển số xe" className="p-2 border rounded" onChange={handleChange} />
             <input name="phoneNumber" value={formData.phoneNumber} placeholder="SĐT Thiết bị" className="p-2 border rounded" onChange={handleChange} />
             <input name="provider" value={formData.provider} placeholder="Nhà cung cấp" className="p-2 border rounded" onChange={handleChange} />
             <input name="telecomPlan" value={formData.telecomPlan} placeholder="Gói cước viễn thông (VD: B2VIP)" className="p-2 border rounded" onChange={handleChange} />
          </div>
          <div className="border-t pt-4 grid grid-cols-2 gap-4">
             <input name="customerName" value={formData.customerName} placeholder="Tên khách hàng" className="p-2 border rounded" onChange={handleChange} />
             <input name="customerPhone" value={formData.customerPhone} placeholder="SĐT Khách hàng" className="p-2 border rounded" onChange={handleChange} />
             <input name="username" value={formData.username} placeholder="Tên đăng nhập" className="p-2 border rounded" onChange={handleChange} />
          </div>
          <div className="border-t pt-4 grid grid-cols-2 gap-4">
             <div><label className="text-xs text-slate-500">Ngày kích hoạt</label><input type="date" name="activationDate" className="w-full p-2 border rounded" value={formData.activationDate} onChange={handleChange} /></div>
             <div><label className="text-xs text-slate-500">Ngày hết hạn</label><input type="date" name="expiryDate" className="w-full p-2 border rounded" value={formData.expiryDate} onChange={handleChange} /></div>
             <input type="number" name="renewalFee" value={formData.renewalFee} placeholder="Phí gia hạn (VNĐ)" className="p-2 border rounded" onChange={handleChange} />
             <select name="vatRate" className="p-2 border rounded" value={formData.vatRate ?? 10} onChange={handleChange}>
                <option value={VAT_RATE_NOT_SUBJECT}>Không chịu thuế</option>
                <option value={0}>VAT 0%</option>
                <option value={5}>VAT 5%</option>
                <option value={8}>VAT 8%</option>
                <option value={10}>VAT 10%</option>
             </select>
          </div>
        </div>
        <div className="p-4 border-t bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded">Hủy</button>
          <button onClick={() => onSave(formData)} className={`px-6 py-2 text-white rounded font-bold ${isEdit ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {isEdit ? 'Lưu thay đổi' : 'Lưu thiết bị'}
          </button>
        </div>
      </div>
    </div>
  );
};
