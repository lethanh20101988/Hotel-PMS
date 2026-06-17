
import React, { useState, useEffect, useMemo } from 'react';
// Added Save to lucide-react imports
import { Edit, Trash2, X, AlertTriangle, Calculator, Save, Truck } from 'lucide-react';
import { Asset } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { useApp } from '../../../app/store';
import { mergePartnerNameSuggestions } from '@shared/utils/partnerNameMemory';

interface EditAssetModalProps {
  asset: Asset | null;
  onClose: () => void;
  onSave: (asset: Asset) => void;
}

export const EditAssetModal: React.FC<EditAssetModalProps> = ({ asset, onClose, onSave }) => {
  const { suppliers, partnerNameHistory, rememberPartnerName } = useApp();
  const editAssetSupplierOptions = useMemo(
    () =>
      mergePartnerNameSuggestions(
        'supplier',
        (suppliers || []).map((s) => s.name).filter(Boolean) as string[],
        partnerNameHistory,
      ),
    [suppliers, partnerNameHistory],
  );

  const [formData, setFormData] = useState<Partial<Asset>>({});

  useEffect(() => {
    if (asset) {
      setFormData({
        ...asset,
        cost: Number(asset.cost || 0),
        usefulLife: Number(asset.usefulLife || 1),
        accumulatedDepreciation: Number(asset.accumulatedDepreciation || 0),
        accumulatedAllocation: Number(asset.accumulatedAllocation || 0),
        residualValue: Number(asset.residualValue || 0)
      });
    }
  }, [asset]);

  if (!asset) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'number' ? Number(value) : value;
    
    setFormData(prev => {
        const next = { ...prev, [name]: val };
        // Nếu thay đổi cost thì cập nhật lại residualValue ngay lập tức để đồng bộ UI
        if (name === 'cost') {
            const acc =
              prev.type === 'CCDC'
                ? Number(prev.accumulatedAllocation) || 0
                : Number(prev.accumulatedDepreciation) || 0;
            next.residualValue = Number(val) - acc;
        }
        return next;
    });
  };

  const handleSave = () => {
    rememberPartnerName('supplier', String(formData.supplierName || ''));
    onSave(formData as Asset);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        <div className="bg-amber-500 p-4 text-white flex justify-between items-center shrink-0">
          <h3 className="font-bold flex items-center gap-2">
            <Edit className="w-5 h-5" /> Sửa thông tin tài sản
          </h3>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-6 overflow-y-auto">
           {/* Section 1: Thông tin tài sản */}
           <div className="space-y-4">
              <h4 className="text-xs border-b pb-2 text-xs font-semibold tracking-tight text-slate-500">1. Thông tin tài sản</h4>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Mã tài sản</label>
                    <input className="w-full p-2 border rounded bg-slate-100 font-mono text-blue-700" value={formData.code} disabled />
                 </div>
                 <div>
                    <label className="block text-xs mb-1 font-medium tracking-tight text-slate-500">Tên tài sản</label>
                    <input name="name" className="w-full p-2 border rounded font-bold text-slate-800" value={formData.name || ''} onChange={handleChange} />
                 </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Loại</label>
                    <select name="type" className="w-full p-2 border rounded font-medium" value={formData.type} onChange={handleChange}>
                       <option value="TSCĐ">Tài sản cố định (TK 211)</option>
                       <option value="CCDC">Công cụ dụng cụ (TK 242)</option>
                    </select>
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Bộ phận sử dụng</label>
                    <select name="department" className="w-full p-2 border rounded" value={formData.department} onChange={handleChange}>
                        <option value="Bộ phận Quản lý">Bộ phận Quản lý</option>
                        <option value="Bộ phận Bán hàng">Bộ phận Bán hàng</option>
                        <option value="Bộ phận Kỹ thuật">Bộ phận Kỹ thuật</option>
                     </select>
                 </div>
              </div>
           </div>

           {/* Section 2: Thông tin Nhà cung cấp */}
           <div className="space-y-4 bg-purple-50/30 p-4 rounded-xl border border-purple-100">
              <h4 className="text-xs flex items-center gap-2 text-xs font-semibold tracking-tight text-purple-600">
                 <Truck className="w-4 h-4" /> 2. Thông tin Nhà cung cấp
              </h4>
              <div className="grid grid-cols-3 gap-4">
                 <div>
                    <label className="block text-[10px] mb-1 font-medium text-slate-500">Mẫu số</label>
                    <input name="purchaseFormNo" className="w-full p-2 border rounded text-sm font-bold" value={(formData as any).purchaseFormNo || ''} onChange={handleChange} />
                 </div>
                 <div>
                    <label className="block text-[10px] mb-1 font-medium text-slate-500">Ký hiệu</label>
                    <input name="purchaseSymbolCode" className="w-full p-2 border rounded text-sm font-bold" value={(formData as any).purchaseSymbolCode || ''} onChange={handleChange} />
                 </div>
                 <div>
                    <label className="block text-[10px] mb-1 font-medium text-slate-500">Số hoá đơn</label>
                    <input name="purchaseInvoiceNumber" className="w-full p-2 border rounded text-sm font-bold" value={(formData as any).purchaseInvoiceNumber || ''} onChange={handleChange} />
                 </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="col-span-2">
                    <label className="block text-[10px] mb-1 font-medium text-slate-500">Tên đơn vị bán hàng</label>
                    <input
                      name="supplierName"
                      list="editAssetSupplierNameList"
                      className="w-full p-2 border rounded text-sm"
                      value={formData.supplierName || ''}
                      onChange={handleChange}
                      onBlur={() => rememberPartnerName('supplier', String(formData.supplierName || ''))}
                      placeholder="Gõ để gợi ý từ danh mục và tên đã nhập..."
                    />
                 </div>
                 <div>
                    <label className="block text-[10px] mb-1 font-medium text-slate-500">Mã số thuế</label>
                    <input name="supplierTaxCode" className="w-full p-2 border rounded text-sm font-mono" value={formData.supplierTaxCode || ''} onChange={handleChange} />
                 </div>
                 <div>
                    <label className="block text-[10px] mb-1 font-medium text-slate-500">Số điện thoại</label>
                    <input name="supplierPhone" className="w-full p-2 border rounded text-sm" value={formData.supplierPhone || ''} onChange={handleChange} />
                 </div>
                 <div className="col-span-2">
                    <label className="block text-[10px] mb-1 font-medium text-slate-500">Địa chỉ</label>
                    <input name="supplierAddress" className="w-full p-2 border rounded text-sm" value={formData.supplierAddress || ''} onChange={handleChange} />
                 </div>
              </div>
           </div>

           <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
              <div>
                 <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px]">Ngày mua</label>
                 <input type="date" name="buyDate" className="w-full p-2 border rounded text-sm" value={formData.buyDate} onChange={handleChange} />
              </div>
              <div>
                 <label className="block text-[10px] mb-1 font-medium text-blue-600 text-[10px]">Ngày bắt đầu SD</label>
                 <input type="date" name="useDate" className="w-full p-2 border border-blue-200 rounded text-sm bg-blue-50 focus:bg-white" value={formData.useDate} onChange={handleChange} />
              </div>
              <div>
                 <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px]">Thời gian SD (Tháng)</label>
                 <input type="number" name="usefulLife" className="w-full p-2 border rounded text-sm font-bold" value={formData.usefulLife} onChange={handleChange} />
              </div>
           </div>

           <div className="grid grid-cols-2 gap-6 pt-2">
              <div className="space-y-4">
                 <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Nguyên giá (VNĐ)</label>
                    <input type="number" name="cost" className="w-full p-3 border-2 border-slate-200 rounded-lg font-semibold text-xl text-blue-700" value={formData.cost} onChange={handleChange} />
                    <p className="text-[10px] text-slate-400 mt-1 italic">{formatCurrency(Number(formData.cost || 0))}</p>
                 </div>
                <div>
                   <label className="block text-sm font-bold text-slate-700 mb-1">Trạng thái tài sản</label>
                   <div className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                      {formData.status === 'LIQUIDATED' ? 'Đã thanh lý' : 'Đang sử dụng'}
                   </div>
                   <p className="mt-1 text-[10px] text-slate-500">
                      Muốn đổi sang trạng thái thanh lý, hãy dùng nút <b>Thanh lý</b> trong danh sách để hệ thống tự sinh bút toán đúng nghiệp vụ.
                   </p>
                </div>
              </div>

              <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 space-y-3">
                 <div className="flex items-center gap-2 text-amber-800 mb-1 text-xs font-medium">
                    <Calculator className="w-4 h-4" /> {formData.type === 'CCDC' ? 'Phân bổ lũy kế' : 'Khấu hao lũy kế'}
                 </div>
                 <div className="flex justify-between items-center text-sm">
                    <span className="text-amber-700">{formData.type === 'CCDC' ? 'Đã ghi sổ (Có 242):' : 'Đã ghi sổ (Có 214):'}</span>
                    <span className="font-bold text-amber-900">{formatCurrency(Number(formData.type === 'CCDC' ? (formData.accumulatedAllocation || 0) : (formData.accumulatedDepreciation || 0)))}</span>
                 </div>
                 <div className="flex justify-between items-center text-base border-t border-amber-200 pt-2">
                    <span className="text-amber-800 font-bold">Giá trị còn lại:</span>
                    <span className="font-semibold text-emerald-600">{formatCurrency(Number(formData.residualValue || 0))}</span>
                 </div>
                 <p className="text-[9px] text-amber-600 leading-tight italic pt-2">
                    * Số liệu đồng bộ từ các bút trích khấu hao / phân bổ trên Nhật ký chung (Nợ chi phí — Có 242 hoặc Có 214). Chạy &quot;Trích khấu hao&quot; để cập nhật sổ.
                 </p>
              </div>
           </div>
        </div>
        <div className="p-4 bg-slate-50 border-t flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded font-bold">Hủy</button>
          <button onClick={handleSave} className="px-8 py-2 bg-amber-500 text-white rounded-lg font-semibold shadow-lg shadow-amber-200 hover:bg-amber-600 transition-all active:scale-95 flex items-center gap-2">
              <Save className="w-4 h-4" /> Cập nhật tài sản
           </button>
        </div>

        <datalist id="editAssetSupplierNameList">
          {editAssetSupplierOptions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
    </div>
  );
};

interface DeleteAssetModalProps {
  asset: Asset | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
}

export const DeleteAssetModal: React.FC<DeleteAssetModalProps> = ({ asset, onClose, onConfirm }) => {
  if (!asset) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-fade-in">
        <div className="bg-red-600 p-4 text-white flex justify-between items-center">
          <h3 className="font-bold flex items-center gap-2">
            <Trash2 className="w-5 h-5" /> Xóa tài sản?
          </h3>
          <button onClick={onClose} className="hover:bg-red-700 p-1 rounded transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 text-center space-y-4">
           <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
           <p className="text-slate-600">Bạn có chắc chắn muốn xóa tài sản <b>{asset.name}</b> ({asset.code})?</p>
           <p className="text-xs text-slate-400">Hành động này không thể hoàn tác.</p>
        </div>
        <div className="p-4 bg-slate-50 border-t flex justify-end gap-2">
           <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded">Hủy</button>
           <button onClick={() => onConfirm(asset.id)} className="px-6 py-2 bg-red-600 text-white rounded font-bold hover:bg-red-700">Xóa</button>
        </div>
      </div>
    </div>
  );
};
