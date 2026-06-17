
import React, { useState, useMemo } from 'react';
import { InventoryItem } from '../types';
import { AlertTriangle, Package, Plus, ArrowUpCircle, ArrowDownCircle, Pencil, Trash2 } from 'lucide-react';
import { formatCurrency } from '../utils';

interface InventoryProps {
  items: InventoryItem[];
  onAddInventory: () => void;
  onExportInventory: () => void;
  onEditInventory: (item: InventoryItem) => void;
  onDeleteInventory: (id: string) => void;
}

export const InventoryTable: React.FC<InventoryProps> = ({ items, onAddInventory, onExportInventory, onEditInventory, onDeleteInventory }) => {
  const [deleteModal, setDeleteModal] = useState<{isOpen: boolean, itemId: string | null}>({
    isOpen: false,
    itemId: null
  });

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteModal({ isOpen: true, itemId: id });
  };

  const confirmDelete = () => {
    if (deleteModal.itemId) {
      onDeleteInventory(deleteModal.itemId);
    }
    setDeleteModal({ isOpen: false, itemId: null });
  };

  // Calculate Totals
  const totals = useMemo(() => {
    return items.reduce((acc, item) => {
        const preTax = item.costPrice * item.quantity;
        const vat = preTax * ((item.vatRate || 0) / 100);
        const total = preTax + vat;
        
        return {
            quantity: acc.quantity + item.quantity,
            preTax: acc.preTax + preTax,
            vat: acc.vat + vat,
            total: acc.total + total
        };
    }, { quantity: 0, preTax: 0, vat: 0, total: 0 });
  }, [items]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Package className="text-indigo-600"/> Tồn kho hiện tại
        </h3>
        <div className="flex gap-3">
            <button 
                onClick={onExportInventory}
                className="bg-orange-100 text-orange-700 border border-orange-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-200 flex items-center gap-2 transition-colors"
            >
                <ArrowDownCircle size={18}/> Xuất kho
            </button>
            <button 
                onClick={onAddInventory}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 shadow-md shadow-indigo-100 flex items-center gap-2 transition-colors"
            >
                <ArrowUpCircle size={18}/> Nhập kho
            </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-semibold">
            <tr>
              <th className="px-6 py-4 text-center">Tên vật tư</th>
              <th className="px-6 py-4 text-center">SL Tồn</th>
              <th className="px-6 py-4 text-center">Đơn giá</th>
              <th className="px-6 py-4 text-center">Thành tiền (Trước thuế)</th>
              <th className="px-6 py-4 text-center">Thuế GTGT</th>
              <th className="px-6 py-4 text-center">Tổng giá trị</th>
              <th className="px-6 py-4 text-center">Trạng thái</th>
              <th className="px-6 py-4 text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item) => {
              // Calculate Financials
              const vatRate = item.vatRate || 0;
              const preTaxTotal = item.costPrice * item.quantity; // Thành tiền trước thuế
              const vatAmount = preTaxTotal * (vatRate / 100);    // Tiền thuế
              const totalAmount = preTaxTotal + vatAmount;        // Tổng thanh toán

              return (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{item.name}</div>
                      <div className="text-xs text-gray-500">{item.supplier || '-'}</div>
                  </td>
                  <td className="px-6 py-4 text-center">
                      <span className="text-lg font-semibold">{item.quantity}</span>
                      <span className="text-xs text-gray-500 ml-1">{item.unit}</span>
                  </td>
                  <td className="px-6 py-4 text-right text-slate-600">{formatCurrency(item.costPrice)}</td>
                  
                  {/* Cột Thành tiền (Trước thuế) */}
                  <td className="px-6 py-4 text-right font-medium text-slate-700">
                      {formatCurrency(preTaxTotal)}
                  </td>

                  {/* Cột Thuế GTGT (Hiển thị số tiền thuế) */}
                  <td className="px-6 py-4 text-right">
                      <div className="text-slate-700 font-medium">{formatCurrency(vatAmount)}</div>
                      <div className="text-[10px] text-gray-400">({vatRate}%)</div>
                  </td>

                  {/* Cột Tổng thanh toán (Sau thuế) */}
                  <td className="px-6 py-4 text-right text-indigo-700 font-bold text-lg">
                      {formatCurrency(totalAmount)}
                  </td>

                  <td className="px-6 py-4 text-center">
                    {item.quantity <= item.minThreshold ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-red-100 text-red-800">
                        <AlertTriangle size={12} /> Sắp hết
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        Ổn định
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                          <button 
                              onClick={() => onEditInventory(item)}
                              className="p-2 rounded bg-white border border-gray-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 text-gray-500 transition-colors shadow-sm"
                              title="Sửa thông tin"
                          >
                              <Pencil size={14}/>
                          </button>
                          <button 
                              type="button"
                              onClick={(e) => handleDeleteClick(e, item.id)}
                              className="p-2 rounded bg-white border border-gray-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-gray-500 transition-colors shadow-sm"
                              title="Xóa vật tư"
                          >
                              <Trash2 size={14}/>
                          </button>
                      </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
                <tr>
                    <td colSpan={8} className="text-center py-8 text-gray-400">Kho hàng trống. Hãy nhập kho.</td>
                </tr>
            )}
          </tbody>
          {/* Footer Total Row */}
          {items.length > 0 && (
             <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                    <td className="px-6 py-4 font-bold text-slate-900 uppercase">Tổng cộng</td>
                    <td className="px-6 py-4 text-center font-bold text-slate-900">{totals.quantity}</td>
                    <td className="px-6 py-4 text-center text-gray-400">-</td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900">{formatCurrency(totals.preTax) }</td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900">{formatCurrency(totals.vat)}</td>
                    <td className="px-6 py-4 text-right font-bold text-indigo-700 text-lg">{formatCurrency(totals.total)}</td>
                    <td className="px-6 py-4"></td>
                    <td className="px-6 py-4"></td>
                </tr>
             </tfoot>
          )}
        </table>
      </div>

      {/* DELETE CONFIRMATION MODAL */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 z-[999] flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden transform scale-100 transition-transform">
              <div className="bg-rose-50 p-6 flex flex-col items-center text-center border-b border-rose-100">
                  <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 mb-3">
                      <AlertTriangle size={24} />
                  </div>
                  <h3 className="text-lg font-bold text-rose-700">Xác nhận xoá vật tư</h3>
                  <p className="text-sm text-gray-600 mt-2">
                      Bạn có chắc chắn muốn xoá vật tư này khỏi kho? Hành động này không thể hoàn tác.
                  </p>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3 bg-white">
                  <button 
                      onClick={() => setDeleteModal({isOpen: false, itemId: null})}
                      className="py-2.5 px-4 rounded-lg border border-gray-300 font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                      Huỷ bỏ
                  </button>
                  <button 
                      onClick={confirmDelete}
                      className="py-2.5 px-4 rounded-lg bg-rose-600 font-bold text-white hover:bg-rose-700 shadow-md transition-colors flex items-center justify-center gap-2"
                  >
                      <Trash2 size={16} /> Xoá ngay
                  </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};
