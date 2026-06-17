
import React, { useState, useEffect, useMemo } from 'react';
import { InventoryItem, Room } from '../types';
import { X, PackagePlus, PackageMinus, BedDouble, Pencil, Calculator, Building2, Receipt, FileText } from 'lucide-react';
import { formatCurrency, formatNumber, parseNumber } from '../utils';

interface InventoryModalProps {
  isOpen: boolean;
  mode: 'IN' | 'OUT' | 'EDIT';
  items: InventoryItem[];
  rooms: Room[];
  editingItem?: InventoryItem | null;
  onClose: () => void;
  onSubmit: (data: any) => void;
}

export const InventoryModal: React.FC<InventoryModalProps> = ({ isOpen, mode, items, rooms, editingItem, onClose, onSubmit }) => {
  const [isNewItem, setIsNewItem] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  
  // OUT Mode: Target selection
  const [exportTarget, setExportTarget] = useState<'EXTERNAL' | 'ROOM'>('EXTERNAL');
  const [targetRoomId, setTargetRoomId] = useState('');

  // Fields for Transaction
  const [quantity, setQuantity] = useState(1);
  
  // Fields for Item Properties
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('Cái');
  const [newThreshold, setNewThreshold] = useState(10);
  const [newCostPrice, setNewCostPrice] = useState(0);

  // New Fields: Supplier & VAT & Financials
  const [supplier, setSupplier] = useState('');
  const [invoiceRef, setInvoiceRef] = useState(''); // Chứng từ / Hóa đơn
  const [vatRate, setVatRate] = useState(0); // 0, 5, 8, 10

  useEffect(() => {
    if (isOpen) {
      if (mode === 'EDIT' && editingItem) {
          setIsNewItem(false);
          setSelectedId(editingItem.id);
          // Populate ALL fields from existing item
          setNewName(editingItem.name);
          setQuantity(editingItem.quantity); // Load current quantity
          setNewUnit(editingItem.unit);
          setNewThreshold(editingItem.minThreshold);
          setNewCostPrice(editingItem.costPrice);
          setSupplier(editingItem.supplier || ''); 
          setVatRate(editingItem.vatRate || 0);    
          setInvoiceRef(editingItem.invoiceRef || ''); // Load invoice ref
      } else {
          // Reset states for IN/OUT
          setQuantity(1);
          setIsNewItem(false);
          setNewName('');
          setNewUnit('Cái');
          setNewThreshold(10);
          setNewCostPrice(0);
          setExportTarget('EXTERNAL');
          
          // Reset Financials
          setSupplier('');
          setInvoiceRef('');
          setVatRate(0);

          if (items.length > 0) setSelectedId(items[0].id);
          if (rooms.length > 0) setTargetRoomId(rooms[0].id);
      }
    }
  }, [isOpen, items, rooms, mode, editingItem]);

  // Calculate Total Amount
  const transactionData = useMemo(() => {
      let price = 0;
      if (mode === 'IN') {
          if (isNewItem) {
              price = newCostPrice;
          } else {
              const item = items.find(i => i.id === selectedId);
              price = item ? item.costPrice : 0;
          }
      } else if (mode === 'EDIT') {
          // In Edit mode, we recalculate based on the input price to show what it would look like
          price = newCostPrice;
      } else if (mode === 'OUT') {
           const item = items.find(i => i.id === selectedId);
           price = item ? item.costPrice : 0;
      }
      
      const preTaxTotal = price * quantity;
      const vatAmount = preTaxTotal * (vatRate / 100);
      const totalAmount = preTaxTotal + vatAmount;

      return { preTaxTotal, totalAmount };
  }, [mode, isNewItem, selectedId, newCostPrice, quantity, vatRate, items]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (mode === 'EDIT') {
         if (!newName) return alert("Vui lòng nhập tên vật tư");
         onSubmit({
             mode: 'EDIT',
             id: editingItem?.id,
             name: newName,
             quantity: Number(quantity), // Submit editable quantity
             unit: newUnit,
             minThreshold: Number(newThreshold),
             costPrice: Number(newCostPrice),
             supplier,
             invoiceRef,
             vatRate
         });
    } else if (mode === 'IN' && isNewItem) {
      if (!newName) return alert("Vui lòng nhập tên vật tư");
      onSubmit({
        mode: 'IN',
        isNew: true,
        name: newName,
        quantity: Number(quantity),
        unit: newUnit,
        minThreshold: Number(newThreshold),
        costPrice: Number(newCostPrice),
        supplier,
        invoiceRef,
        vatRate,
        preTaxTotal: transactionData.preTaxTotal,
        totalAmount: transactionData.totalAmount
      });
    } else {
      if (!selectedId) return alert("Vui lòng chọn vật tư");
      
      const currentItem = items.find(i => i.id === selectedId);
      if (mode === 'OUT' && currentItem && quantity > currentItem.quantity) {
          return alert(`Không thể xuất quá số lượng tồn kho (${currentItem.quantity})`);
      }

      onSubmit({
        mode: mode,
        isNew: false,
        id: selectedId,
        name: currentItem?.name, // Pass name for expense logging
        quantity: Number(quantity),
        exportTarget,
        targetRoomId,
        supplier,
        invoiceRef,
        vatRate,
        preTaxTotal: transactionData.preTaxTotal,
        totalAmount: transactionData.totalAmount
      });
    }
    onClose();
  };

  if (!isOpen) return null;

  const isImport = mode === 'IN';
  const isEdit = mode === 'EDIT';

  let title = 'Nhập Kho';
  let icon = <PackagePlus size={20}/>;
  let colorClass = 'bg-indigo-600';

  if (mode === 'OUT') {
      title = 'Xuất Kho';
      icon = <PackageMinus size={20}/>;
      colorClass = 'bg-orange-600';
  } else if (mode === 'EDIT') {
      title = 'Sửa Thông Tin Vật Tư & Tồn Kho';
      icon = <Pencil size={20}/>;
      colorClass = 'bg-slate-700';
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl overflow-hidden transform transition-all flex flex-col max-h-[90vh]">
        <div className={`${colorClass} text-white px-6 py-4 flex justify-between items-center shrink-0`}>
          <h2 className="text-lg font-bold flex items-center gap-2">
            {icon} {title}
          </h2>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full"><X size={20}/></button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          
          {/* Toggle for New Item */}
          {isImport && (
            <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
              <button
                type="button"
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${!isNewItem ? 'bg-white shadow text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setIsNewItem(false)}
              >
                Vật tư có sẵn
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${isNewItem ? 'bg-white shadow text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setIsNewItem(true)}
              >
                + Tạo mới
              </button>
            </div>
          )}

          {/* ITEM SELECTION (Only for Existing Import or Output) */}
          {!isNewItem && !isEdit && (
             <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chọn vật tư</label>
                <select 
                  className="w-full border border-gray-300 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  {items.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} (Kho: {item.quantity} {item.unit}) - Vốn: {formatCurrency(item.costPrice)}
                    </option>
                  ))}
                </select>
             </div>
          )}

          {/* MAIN EDITABLE FIELDS (New Item OR Edit Mode) */}
          {(isNewItem || isEdit) && (
            <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tên vật tư</label>
                  <input 
                    type="text" 
                    required
                    className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="VD: Nước giặt..."
                  />
               </div>
               <div className="grid grid-cols-2 gap-3">
                  <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Đơn vị</label>
                      <input 
                        type="text" 
                        className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        value={newUnit}
                        onChange={(e) => setNewUnit(e.target.value)}
                        placeholder="VD: Chai"
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cảnh báo tồn</label>
                      <input 
                        type="text" 
                        className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        value={formatNumber(newThreshold)}
                        onChange={(e) => {
                             const val = parseNumber(e.target.value);
                             if(!isNaN(val)) setNewThreshold(val);
                        }}
                      />
                  </div>
               </div>
               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Đơn giá vốn</label>
                  <input 
                    type="text" 
                    className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium"
                    value={formatNumber(newCostPrice)}
                    onChange={(e) => {
                        const val = parseNumber(e.target.value);
                        if(!isNaN(val)) setNewCostPrice(val);
                    }}
                    placeholder="0"
                  />
               </div>
            </div>
          )}

          {/* QUANTITY (For Transaction OR Edit) */}
          {/* Always show Quantity unless it is existing item selection in IN/OUT (which is handled above, but here we mean the quantity input box) */}
          <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                 {isEdit ? 'Số lượng tồn kho' : `Số lượng ${isImport ? 'nhập' : 'xuất'}`}
              </label>
              <input 
                type="text" 
                required
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-lg text-center"
                value={formatNumber(quantity)}
                onChange={(e) => {
                    const val = parseNumber(e.target.value);
                    if(!isNaN(val)) setQuantity(val);
                }}
              />
          </div>

          {/* ADDITIONAL INFO (Supplier, VAT) - Show for Import OR Edit */}
          {(isImport || isEdit) && (
             <div className="space-y-3 pt-2 border-t border-dashed border-gray-300">
                 <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm">
                    <Receipt size={16}/> Thông tin hóa đơn & NCC
                 </div>
                 
                 <div className="grid grid-cols-2 gap-3">
                    <div className={isEdit ? "" : ""}>
                        <label className="block text-xs font-bold text-gray-500 mb-1 flex items-center gap-1">
                            <Building2 size={12}/> Nhà cung cấp
                        </label>
                        <input 
                            type="text" 
                            className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={supplier}
                            onChange={(e) => setSupplier(e.target.value)}
                            placeholder="VD: Công ty ABC"
                        />
                    </div>
                    {/* Invoice field (Show for Edit now too) */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1 flex items-center gap-1">
                            <FileText size={12}/> Chứng từ / Hóa đơn
                        </label>
                        <input 
                            type="text" 
                            className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={invoiceRef}
                            onChange={(e) => setInvoiceRef(e.target.value)}
                            placeholder="VD: HD00123"
                        />
                    </div>
                 </div>

                 <div>
                    <label className="block text-xs font-bold text-gray-500 mb-2">Thuế VAT</label>
                    <div className="flex gap-2">
                        {[0, 5, 8, 10].map(rate => (
                            <label key={rate} className={`flex-1 border rounded-lg py-1.5 px-2 text-center text-sm cursor-pointer transition-colors ${vatRate === rate ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-bold' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                                <input 
                                    type="radio" 
                                    name="vat" 
                                    className="hidden" 
                                    checked={vatRate === rate} 
                                    onChange={() => setVatRate(rate)}
                                />
                                {rate}%
                            </label>
                        ))}
                    </div>
                 </div>

                 {/* Show Total Amount for both Import and Edit (Value Estimation) */}
                 <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100 flex justify-between items-center">
                    <div className="flex items-center gap-2 text-indigo-800">
                        <Calculator size={18} />
                        <span className="font-bold text-sm">
                            {isEdit ? 'Tổng giá trị tồn (Sau VAT):' : 'Thành tiền (Sau VAT):'}
                        </span>
                    </div>
                    <div className="text-xl font-bold text-indigo-700">
                        {formatCurrency(transactionData.totalAmount)}
                    </div>
                 </div>
             </div>
          )}

          {/* EXPORT OPTIONS */}
          {mode === 'OUT' && (
            <div className="bg-orange-50 p-3 rounded-lg border border-orange-100 space-y-3">
               <div>
                  <label className="block text-xs font-bold text-orange-800 mb-1">Mục đích xuất</label>
                  <div className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input 
                             type="radio" 
                             name="exportTarget" 
                             value="EXTERNAL" 
                             checked={exportTarget === 'EXTERNAL'} 
                             onChange={() => setExportTarget('EXTERNAL')}
                             className="text-orange-600 focus:ring-orange-500"
                          />
                          <span>Xuất hủy / Khác</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input 
                             type="radio" 
                             name="exportTarget" 
                             value="ROOM" 
                             checked={exportTarget === 'ROOM'} 
                             onChange={() => setExportTarget('ROOM')}
                             className="text-orange-600 focus:ring-orange-500"
                          />
                          <span>Cấp cho phòng</span>
                      </label>
                  </div>
               </div>

               {exportTarget === 'ROOM' && (
                   <div className="animate-in fade-in zoom-in duration-200">
                      <label className="block text-xs font-bold text-orange-800 mb-1 flex items-center gap-1">
                          <BedDouble size={12}/> Chọn phòng nhận
                      </label>
                      <select 
                          className="w-full border border-orange-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-orange-500 outline-none"
                          value={targetRoomId}
                          onChange={(e) => setTargetRoomId(e.target.value)}
                      >
                          {rooms.map(room => (
                              <option key={room.id} value={room.id}>
                                  Phòng {room.number} ({room.type})
                              </option>
                          ))}
                      </select>
                   </div>
               )}
            </div>
          )}

          <div className="pt-2 flex gap-3">
             <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-300 rounded-lg font-bold text-gray-700 hover:bg-gray-50 transition-colors">Hủy</button>
             <button 
                type="submit" 
                className={`flex-1 py-2.5 text-white rounded-lg font-bold shadow-lg transition-colors ${
                    isEdit ? 'bg-slate-800 hover:bg-slate-900 shadow-slate-200' :
                    isImport ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200' : 'bg-orange-600 hover:bg-orange-700 shadow-orange-200'
                }`}
             >
                {isEdit ? 'Lưu & Đồng bộ' : (isImport ? 'Xác nhận Nhập' : 'Xác nhận Xuất')}
             </button>
          </div>
        </form>
      </div>
    </div>
  );
};
