
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { Plus, X, Edit, Trash2, Eye, AlertTriangle, Download, Upload, BookOpen, Printer, Search } from 'lucide-react';
import { InventoryItem, InventoryTransaction } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { formatVatRateLabel, vatAmountUnrounded } from '@shared/utils/vatRate';
import { roundInvoiceTotalsFromSums } from '@shared/utils/vndMoney';
import {
  getBom154CategoryLabel,
  getBomDefinitionForParent,
  resolveBomDefinitionComponents,
} from '@shared/utils/bom';
import { useApp } from '../../../app/store';
import { WarehouseVoucherTT133Print } from './WarehouseVoucherTT133Print';
import { WarehouseVoucherTT58ImportPrint } from './WarehouseVoucherTT58ImportPrint';
import { WarehouseVoucherTT58ExportPrint } from './WarehouseVoucherTT58ExportPrint';

/** Serial/IMEI trên phiếu: ưu tiên chuỗi lưu, fallback snapshot. */
export function collectTransactionSerialList(trx: InventoryTransaction): string[] {
  const fromText = (trx.serials || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromText.length > 0) return fromText;
  return (trx.serialInfoSnapshot || [])
    .map((si) => String(si.serial || '').trim())
    .filter(Boolean);
}

// Add Item Modal
export const AddInventoryItemModal = ({ isOpen, onClose, onSave }: any) => {
  const { accounts } = useApp();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [quantity, setQuantity] = useState('');
  const [minStock, setMinStock] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [accountCode, setAccountCode] = useState('156');
  const [costAccount, setCostAccount] = useState('632');

  const assetAccounts = accounts.filter(acc => acc.code.startsWith('15'));
  const costAccounts = accounts.filter(acc => acc.code.startsWith('632') || acc.code.startsWith('63'));

  useEffect(() => {
    if (!isOpen) return;
    setName(''); setSku(''); setCategory(''); setUnit('');
    setQuantity(''); setMinStock(''); setCostPrice(''); setSellingPrice('');
    setAccountCode('156'); setCostAccount('632');
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave({
       name, sku, category, unit, 
       quantity: Number(quantity), 
       minStock: Number(minStock), 
       costPrice: Number(costPrice), 
       sellingPrice: Number(sellingPrice),
       accountCode, costAccount
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        <div className="bg-blue-600 p-4 text-white flex justify-between items-center">
          <h3 className="font-bold flex items-center gap-2">
            <Plus className="w-5 h-5" /> Thêm Hàng hóa Mới
          </h3>
          <button onClick={onClose} className="hover:bg-blue-700 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
           <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Tên sản phẩm</label><input className="w-full p-2 border rounded" value={name} onChange={e => setName(e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Mã SKU</label><input className="w-full p-2 border rounded" value={sku} onChange={e => setSku(e.target.value)} /></div>
           </div>
           <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Danh mục</label><input className="w-full p-2 border rounded" value={category} onChange={e => setCategory(e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Đơn vị tính</label><input className="w-full p-2 border rounded" value={unit} onChange={e => setUnit(e.target.value)} /></div>
           </div>
           
           {/* Accounting Section */}
           <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <h4 className="mb-2 text-xs font-semibold tracking-tight text-slate-500">Thiết lập tài khoản (TT133)</h4>
              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">TK Kho</label>
                    <select 
                      className="w-full h-[44px] px-3 border border-slate-300 rounded-xl bg-white text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" 
                      value={accountCode} 
                      onChange={e => setAccountCode(e.target.value)}
                    >
                      {assetAccounts.map(acc => (
                        <option key={acc.code} value={acc.code}>{acc.code} - {acc.name}</option>
                      ))}
                      {assetAccounts.length === 0 && <option value="156">156 - Hàng hóa (Mặc định)</option>}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">TK Giá vốn</label>
                    <select 
                      className="w-full h-[44px] px-3 border border-slate-300 rounded-xl bg-white text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" 
                      value={costAccount} 
                      onChange={e => setCostAccount(e.target.value)}
                    >
                       {costAccounts.map(acc => (
                        <option key={acc.code} value={acc.code}>{acc.code} - {acc.name}</option>
                      ))}
                      {costAccounts.length === 0 && <option value="632">632 - Giá vốn hàng bán (Mặc định)</option>}
                    </select>
                  </div>
              </div>
           </div>

           <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Số dư ban đầu</label><input type="number" className="w-full p-2 border rounded font-bold" value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Cảnh báo tối thiểu</label><input type="number" className="w-full p-2 border rounded text-red-600" value={minStock} onChange={e => setMinStock(e.target.value)} /></div>
           </div>
           <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Giá vốn</label><input type="number" className="w-full p-2 border rounded" value={costPrice} onChange={e => setCostPrice(e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Giá bán</label><input type="number" className="w-full p-2 border rounded text-blue-600 font-bold" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} /></div>
           </div>
        </div>
        <div className="p-4 border-t bg-slate-50 flex justify-end gap-2">
           <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded">Hủy</button>
           <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700">Lưu</button>
        </div>
      </div>
    </div>
  );
};

// Edit Item Modal
export const EditInventoryItemModal = ({ item, onClose, onSave }: any) => {
  const { accounts } = useApp();
  const [formData, setFormData] = useState<Partial<InventoryItem>>({});
  useLayoutEffect(() => {
    if (item) setFormData(item);
  }, [item]);

  const assetAccounts = accounts.filter(acc => acc.code.startsWith('15'));
  const costAccounts = accounts.filter(acc => acc.code.startsWith('632') || acc.code.startsWith('63'));

  if (!item) return null;

  const handleChange = (field: string, value: any) => {
      setFormData({...formData, [field]: value});
  }

  const handleSave = () => {
    onSave({
       ...formData,
       quantity: Number(formData.quantity),
       minStock: Number(formData.minStock),
       costPrice: Number(formData.costPrice),
       sellingPrice: Number(formData.sellingPrice)
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        <div className="bg-amber-500 p-4 text-white flex justify-between items-center">
          <h3 className="font-bold flex items-center gap-2">
            <Edit className="w-5 h-5" /> Sửa thông tin hàng hóa
          </h3>
          <button onClick={onClose} className="hover:bg-amber-600 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Tên sản phẩm</label><input className="w-full p-2 border rounded" value={formData.name} onChange={e => handleChange('name', e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Mã SKU</label><input className="w-full p-2 border rounded" value={formData.sku} onChange={e => handleChange('sku', e.target.value)} /></div>
           </div>
           
           <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Danh mục</label><input className="w-full p-2 border rounded" value={formData.category} onChange={e => handleChange('category', e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Đơn vị tính</label><input className="w-full p-2 border rounded" value={formData.unit} onChange={e => handleChange('unit', e.target.value)} /></div>
           </div>

           {/* Accounting Section */}
           <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <h4 className="mb-2 text-xs font-semibold tracking-tight text-slate-500">Thiết lập tài khoản (TT133)</h4>
              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">TK Kho</label>
                    <select 
                      className="w-full h-[44px] px-3 border border-slate-300 rounded-xl bg-white text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" 
                      value={formData.accountCode || '156'} 
                      onChange={e => handleChange('accountCode', e.target.value)}
                    >
                      {assetAccounts.map(acc => (
                        <option key={acc.code} value={acc.code}>{acc.code} - {acc.name}</option>
                      ))}
                      {assetAccounts.length === 0 && <option value="156">156 - Hàng hóa (Mặc định)</option>}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">TK Giá vốn</label>
                    <select 
                      className="w-full h-[44px] px-3 border border-slate-300 rounded-xl bg-white text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" 
                      value={formData.costAccount || '632'} 
                      onChange={e => handleChange('costAccount', e.target.value)}
                    >
                       {costAccounts.map(acc => (
                        <option key={acc.code} value={acc.code}>{acc.code} - {acc.name}</option>
                      ))}
                      {costAccounts.length === 0 && <option value="632">632 - Giá vốn hàng bán (Mặc định)</option>}
                    </select>
                  </div>
              </div>
           </div>

            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Cảnh báo tối thiểu</label><input type="number" className="w-full p-2 border rounded text-red-600" value={formData.minStock} onChange={e => handleChange('minStock', e.target.value)} /></div>
           </div>
           <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Giá vốn</label><input type="number" className="w-full p-2 border rounded" value={formData.costPrice} onChange={e => handleChange('costPrice', e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Giá bán</label><input type="number" className="w-full p-2 border rounded text-blue-600 font-bold" value={formData.sellingPrice} onChange={e => handleChange('sellingPrice', e.target.value)} /></div>
           </div>
        </div>
        <div className="p-4 border-t bg-slate-50 flex justify-end gap-2">
           <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded">Hủy</button>
           <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700">Lưu</button>
        </div>
      </div>
    </div>
  );
};

// ... (Rest of file unchanged: ViewInventoryItemModal, DeleteInventoryItemModal, DeleteTransactionModal, ViewTransactionModal, StockLedgerModal)
// View Item Modal
export const ViewInventoryItemModal = ({ item, onClose }: any) => {
  const { bomDefinitions, inventoryCatalog } = useApp();
  const [activeTab, setActiveTab] = useState<'INFO' | 'BOM'>('INFO');
  const bomDefinition = useMemo(
    () => getBomDefinitionForParent(bomDefinitions, item?.id),
    [bomDefinitions, item?.id],
  );
  const bomComponents = useMemo(
    () => resolveBomDefinitionComponents(bomDefinition, inventoryCatalog, 1),
    [bomDefinition, inventoryCatalog],
  );

  useEffect(() => {
    setActiveTab('INFO');
  }, [item?.id]);

  if (!item) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        <div className="bg-slate-100 p-4 flex justify-between items-center border-b">
          <h3 className="font-bold text-slate-700 flex items-center gap-2">
            <Eye className="w-5 h-5" /> Chi tiết Hàng hóa
          </h3>
          <button onClick={onClose} className="hover:bg-slate-200 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="border-b border-slate-200 bg-white px-4 pt-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('INFO')}
              className={`rounded-t-lg px-3 py-2 text-sm font-semibold ${
                activeTab === 'INFO'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200 border-b-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              Thông tin chung
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('BOM')}
              className={`rounded-t-lg px-3 py-2 text-sm font-semibold ${
                activeTab === 'BOM'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200 border-b-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              Định mức cấu thành
            </button>
          </div>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          {activeTab === 'INFO' ? (
            <>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Tên sản phẩm:</span>
                <span className="font-bold">{item.name}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Mã SKU:</span>
                <span className="font-mono text-blue-600 font-bold">{item.sku}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Danh mục:</span>
                <span>{item.category}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Đơn vị tính:</span>
                <span>{item.unit}</span>
              </div>

              <div className="grid grid-cols-2 gap-4 border-b pb-2 bg-slate-50 p-2 rounded">
                <div>
                  <span className="text-slate-500 text-xs block">TK Kho</span>
                  <span className="font-bold text-slate-700">{item.accountCode || '156'}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-xs block">TK Giá vốn</span>
                  <span className="font-bold text-slate-700">{item.costAccount || '632'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-b pb-2">
                <div>
                  <span className="text-slate-500 text-xs block">Giá vốn</span>
                  <span className="font-bold">{formatCurrency(item.costPrice)}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-xs block">Giá bán</span>
                  <span className="font-bold text-blue-600">{formatCurrency(item.sellingPrice)}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-slate-500 text-xs block">Tồn</span>
                  <span className={`font-bold text-lg ${item.quantity <= item.minStock ? 'text-red-600' : 'text-emerald-600'}`}>
                    {item.quantity}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 text-xs block">Cảnh báo tối thiểu</span>
                  <span className="font-bold">{item.minStock}</span>
                </div>
              </div>
              {item.serials && item.serials.length > 0 && (
                <div className="pt-2">
                  <span className="text-slate-500 text-xs block mb-1">Danh sách Serial (FIFO)</span>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {item.serials.map((s: string, i: number) => (
                      <span key={i} className="text-xs bg-slate-100 border px-2 py-0.5 rounded text-slate-600">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {!bomDefinition && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Mã hàng này chưa có BOM trong `Danh mục`.
                </div>
              )}
              {bomDefinition && (
                <>
                  <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">BOM đang áp dụng</p>
                        <h4 className="mt-1 text-base font-bold text-slate-800">
                          {bomComponents.length} thành phần cho 1 {item.unit || 'đơn vị'}
                        </h4>
                      </div>
                      <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        Cập nhật: {new Date(bomDefinition.updatedAt).toLocaleString('vi-VN')}
                      </div>
                    </div>
                    {bomDefinition.note && (
                      <p className="mt-3 text-sm text-slate-600">{bomDefinition.note}</p>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Thành phần</th>
                          <th className="px-3 py-2 text-left">Phân loại</th>
                          <th className="px-3 py-2 text-right">Định mức</th>
                          <th className="px-3 py-2 text-right">Hao hụt</th>
                          <th className="px-3 py-2 text-right">Thực xuất theo BOM</th>
                          <th className="px-3 py-2 text-left">Bàn giao/Kích hoạt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bomComponents.map((entry) => (
                          <tr key={entry.component.id}>
                            <td className="px-3 py-2">
                              <div className="font-semibold text-slate-800">
                                {entry.item?.sku || 'N/A'} - {entry.item?.name || 'Không còn trong danh mục'}
                              </div>
                              <div className="text-xs text-slate-500">
                                ĐVT: {entry.item?.unit || '---'} | TK kho: {entry.item?.accountCode || '---'}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {getBom154CategoryLabel(entry.component.account154Category)}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">{entry.component.quantity}</td>
                            <td className="px-3 py-2 text-right">{entry.component.lossRate}%</td>
                            <td className="px-3 py-2 text-right font-semibold text-blue-700">{entry.requiredQuantity}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                  entry.isStockTracked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {entry.isStockTracked ? 'Tự ghi bàn giao/kích hoạt 154' : 'Chỉ theo dõi cấu thành'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="p-4 bg-slate-50 border-t text-right">
           <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-bold">Đóng</button>
        </div>
      </div>
    </div>
  );
};

// Delete Item Modal — xóa theo số hóa đơn / theo IMEI / theo số lượng
type DeleteMode = 'INVOICE' | 'SERIAL' | 'QUANTITY';

export const DeleteInventoryItemModal = ({ item, onClose, onConfirm }: any) => {
  const {
    transactions,
    allTransactionsAcrossYears,
    inventory,
    allInvoicesAcrossYears,
    validateDeleteInventoryItemAdvanced,
  } = useApp();
  const [mode, setMode] = useState<DeleteMode>('INVOICE');
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [selectedSerials, setSelectedSerials] = useState<Set<string>>(new Set());
  const [qtyInput, setQtyInput] = useState('');
  const [serialSearch, setSerialSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const itemId = item?.id ? String(item.id) : '';

  useEffect(() => {
    setMode('INVOICE');
    setSelectedInvoices(new Set());
    setSelectedSerials(new Set());
    setQtyInput('');
    setSerialSearch('');
    setBusy(false);
  }, [itemId]);

  const liveItem = useMemo(
    () => (inventory || []).find((i) => String(i.id) === itemId) || item,
    [inventory, itemId, item],
  );
  const onHand = Number(liveItem?.quantity || 0);
  const inStockSerials = useMemo(
    () => [...new Set((liveItem?.serials || []).map((s: string) => String(s).trim()).filter(Boolean))],
    [liveItem],
  );

  const invoiceList = useMemo(() => {
    const map = new Map<string, { id: string; number: string; qty: number; date: string; voucher: string }>();
    const invoiceById = new Map((allInvoicesAcrossYears || []).map((i: any) => [String(i.id), i]));
    const sourceTransactions =
      Array.isArray(allTransactionsAcrossYears) && allTransactionsAcrossYears.length > 0
        ? allTransactionsAcrossYears
        : transactions || [];
    for (const t of sourceTransactions || []) {
      if (String(t.itemId || '') !== itemId || t.type !== 'IMPORT') continue;
      if (Number(t.quantity || 0) <= 0) continue;
      const bid = String((t as any).batchId || '').trim();
      const invId = bid ? `INV-PUR-BATCH-${bid}` : `INV-PUR-${String(t.id)}`;
      const linked = invoiceById.get(invId);
      if (!linked) continue;
      const number = String(linked.invoiceNumber || '').trim();
      if (!number) continue;
      const cur = map.get(invId) || {
        id: invId,
        number,
        qty: 0,
        date: String(t.date || ''),
        voucher: String(t.voucherNumber || t.documentRef || ''),
      };
      cur.qty += Number(t.quantity || 0);
      if (String(t.date || '') < cur.date || !cur.date) cur.date = String(t.date || '');
      map.set(invId, cur);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [transactions, allTransactionsAcrossYears, allInvoicesAcrossYears, itemId]);

  const filteredSerials = useMemo(() => {
    const q = serialSearch.trim().toLowerCase();
    if (!q) return inStockSerials;
    return inStockSerials.filter((s) => s.toLowerCase().includes(q));
  }, [inStockSerials, serialSearch]);

  if (!item) return null;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const qtyNum = Math.floor(Number(qtyInput) || 0);
  const canConfirm =
    !busy &&
    ((mode === 'INVOICE' && selectedInvoices.size > 0) ||
      (mode === 'SERIAL' && selectedSerials.size > 0) ||
      (mode === 'QUANTITY' && qtyNum > 0 && qtyNum <= onHand));

  const handleConfirm = async () => {
    if (!canConfirm) return;
    let options: any;
    if (mode === 'INVOICE') options = { mode: 'INVOICE', invoiceIds: [...selectedInvoices] };
    else if (mode === 'SERIAL') options = { mode: 'SERIAL', serials: [...selectedSerials] };
    else options = { mode: 'QUANTITY', quantity: qtyNum };
    if (!validateDeleteInventoryItemAdvanced(itemId, options)) return;
    setBusy(true);
    onClose();
    try {
      const ok = await onConfirm(itemId, options);
      if (!ok) {
        window.alert('Không thể hoàn tất thao tác xóa. Dữ liệu đã được giữ nguyên hoặc được đồng bộ lại theo trạng thái an toàn.');
      }
    } catch (err: unknown) {
      console.error('[DeleteInventoryItemModal]', err);
      window.alert(`Không thể xóa: ${(err as Error)?.message || String(err)}`);
    }
  };

  const TabButton = ({ value, label }: { value: DeleteMode; label: string }) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
        mode === value
          ? 'bg-red-600 text-white border-red-600'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-fade-in">
        <div className="bg-red-600 p-4 text-white flex justify-between items-center">
          <h3 className="font-bold flex items-center gap-2">
            <Trash2 className="w-5 h-5" /> Xóa hàng hóa
          </h3>
          <button onClick={onClose} className="hover:bg-red-700 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-red-500 shrink-0" />
            <div>
              <p className="text-slate-700 text-sm font-semibold">{item.name}</p>
              <p className="text-xs text-slate-400">
                Tồn hiện tại: <b>{onHand}</b>
                {inStockSerials.length > 0 ? ` · ${inStockSerials.length} IMEI/serial` : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <TabButton value="INVOICE" label="Theo số HĐ" />
            <TabButton value="SERIAL" label="Theo IMEI" />
            <TabButton value="QUANTITY" label="Theo số lượng" />
          </div>

          {mode === 'INVOICE' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">Chọn số hóa đơn cần gỡ khỏi sản phẩm:</p>
              <div className="border rounded-lg divide-y max-h-56 overflow-y-auto">
                {invoiceList.length === 0 && (
                  <p className="text-xs text-slate-400 p-3">Không có phiếu nhập gắn hóa đơn cho sản phẩm này.</p>
                )}
                {invoiceList.map((inv) => (
                  <label key={inv.id} className="flex items-center gap-3 p-2.5 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedInvoices.has(inv.id)}
                      onChange={() => toggle(selectedInvoices, setSelectedInvoices, inv.id)}
                      className="w-4 h-4 accent-red-600"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">HĐ {inv.number}</p>
                      <p className="text-[11px] text-slate-400">
                        {inv.date} · SL: {inv.qty}{inv.voucher ? ` · Phiếu kho: ${inv.voucher}` : ''}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {mode === 'SERIAL' && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  value={serialSearch}
                  onChange={(e) => setSerialSearch(e.target.value)}
                  placeholder="Tìm IMEI/serial…"
                  className="w-full pl-9 p-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Đã chọn: {selectedSerials.size}</span>
                <button
                  type="button"
                  className="text-red-600 hover:underline"
                  onClick={() =>
                    setSelectedSerials(
                      selectedSerials.size === filteredSerials.length
                        ? new Set()
                        : new Set(filteredSerials),
                    )
                  }
                >
                  {selectedSerials.size === filteredSerials.length && filteredSerials.length > 0
                    ? 'Bỏ chọn tất cả'
                    : 'Chọn tất cả'}
                </button>
              </div>
              <div className="border rounded-lg max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2">
                {filteredSerials.length === 0 && (
                  <p className="text-xs text-slate-400 p-3 col-span-full">Không có IMEI/serial trong kho.</p>
                )}
                {filteredSerials.map((s) => (
                  <label key={s} className="flex items-center gap-2 p-2 hover:bg-slate-50 cursor-pointer border-b">
                    <input
                      type="checkbox"
                      checked={selectedSerials.has(s)}
                      onChange={() => toggle(selectedSerials, setSelectedSerials, s)}
                      className="w-4 h-4 accent-red-600"
                    />
                    <span className="text-xs font-mono text-slate-700 truncate">{s}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {mode === 'QUANTITY' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                Nhập số lượng cần xóa (tối đa {onHand}). Hệ thống trừ theo phiếu nhập cũ nhất trước (FIFO).
              </p>
              <input
                type="number"
                min={1}
                max={onHand}
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                placeholder="Số lượng cần xóa"
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
              />
              {qtyNum > onHand && (
                <p className="text-[11px] text-red-600">Số lượng vượt quá tồn hiện tại ({onHand}).</p>
              )}
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            Sau khi xóa, hệ thống tự điều chỉnh số lượng, IMEI, số hóa đơn và cập nhật Sổ Nhật Ký Chung,
            Tổng quan, Báo cáo, Kế toán tổng hợp.
          </p>
        </div>

        <div className="p-4 bg-slate-50 border-t flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded disabled:opacity-50">Hủy</button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-6 py-2 bg-red-600 text-white rounded font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Đang xóa…' : 'Xóa'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Delete Transaction Modal
export const DeleteTransactionModal = ({ transaction, onClose, onConfirm }: any) => {
  if (!transaction) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-fade-in">
        <div className="bg-red-600 p-4 text-white flex justify-between items-center">
          <h3 className="font-bold flex items-center gap-2">
            <Trash2 className="w-5 h-5" /> Xóa lịch sử?
          </h3>
          <button onClick={onClose} className="hover:bg-red-700 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 text-center space-y-4">
           <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
           <p className="text-slate-600">
             Bạn có chắc chắn muốn xóa giao dịch <b>{transaction.type === 'IMPORT' ? 'Nạp tài nguyên' : 'Bàn giao/Kích hoạt'} {transaction.itemName}</b>?
           </p>
           <p className="text-xs text-slate-400">
             Hệ thống sẽ <b>tự động xóa bút toán kế toán</b> tương ứng trong Sổ Nhật Ký Chung.
           </p>
        </div>
        <div className="p-4 bg-slate-50 border-t flex justify-end gap-2">
           <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded">Hủy</button>
           <button onClick={() => onConfirm(transaction.id)} className="px-6 py-2 bg-red-600 text-white rounded font-bold hover:bg-red-700">Xóa</button>
        </div>
      </div>
    </div>
  );
};

// View Transaction Modal
export const ViewTransactionModal = ({
  transaction,
  onClose,
  compact = false,
  readOnly = false,
}: {
  transaction: InventoryTransaction | null;
  onClose: () => void;
  compact?: boolean;
  /** true = chỉ xem (vd: mở từ Lịch sử Sản phẩm & Bản quyền); không sửa chứng từ tại đây. */
  readOnly?: boolean;
}) => {
   if (!transaction) return null;
   const { handleUpdateInventoryTransactionMeta, companyInfo, journalEntries, inventory, systemConfig } = useApp();
   const isImport = transaction.type === 'IMPORT';
   const isTt58Regime = systemConfig.accountingRegime?.standard === 'TT58_2026';
   const useTt58ImportPrint = isImport && isTt58Regime;
   const useTt58ExportPrint = !isImport && isTt58Regime;
   const subTotal = transaction.quantity * transaction.price;
   const { totalAmount: total, vatAmount } = roundInvoiceTotalsFromSums(
     subTotal,
     vatAmountUnrounded(subTotal, Number(transaction.vatRate)),
   );

   const serialList = useMemo(() => collectTransactionSerialList(transaction), [transaction]);
   const trxParsedDate = useMemo(() => new Date(transaction.date), [transaction.date]);
   const dateCaptionVi = useMemo(() => {
     if (Number.isNaN(trxParsedDate.getTime())) return transaction.date;
     return trxParsedDate.toLocaleDateString('vi-VN', {
       weekday: 'long',
       day: 'numeric',
       month: 'long',
       year: 'numeric',
     });
   }, [trxParsedDate, transaction.date]);
   const timeCaptionVi = useMemo(() => {
     if (Number.isNaN(trxParsedDate.getTime())) return '—';
     return trxParsedDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
   }, [trxParsedDate]);
   const ymdParts = useMemo(() => {
     if (Number.isNaN(trxParsedDate.getTime())) return { d: '—', m: '—', y: '—' };
     return {
       d: String(trxParsedDate.getDate()),
       m: String(trxParsedDate.getMonth() + 1),
       y: String(trxParsedDate.getFullYear()),
     };
   }, [trxParsedDate]);

   const [isEditing, setIsEditing] = useState(false);
   const [docRef, setDocRef] = useState(transaction.documentRef || '');
   const [formNo, setFormNo] = useState((transaction as any).formNo || '');
   const [symbolCode, setSymbolCode] = useState((transaction as any).symbolCode || '');
   const [printUnit, setPrintUnit] = useState(companyInfo.name || '');
   const [printDepartment, setPrintDepartment] = useState('');
   const [printOrientation, setPrintOrientation] = useState<'portrait' | 'landscape'>('portrait');

   useEffect(() => {
     if (!transaction) return;
     setPrintUnit(companyInfo.name || '');
     setPrintDepartment('');
     setDocRef(transaction.documentRef || '');
     setFormNo((transaction as any).formNo || '');
     setSymbolCode((transaction as any).symbolCode || '');
     if (readOnly) setIsEditing(false);
   }, [transaction.id, companyInfo.name, readOnly]);

   const canEdit = !readOnly;

   const invItem = inventory.find(i => i.id === transaction.itemId);
   const itemSku = invItem?.sku || '—';
   const itemUnit = invItem?.unit || '—';

   const relatedJe = journalEntries.find(
     j => j.referenceId === transaction.voucherNumber || j.referenceId === transaction.id,
   );
   let debitAccount = isImport ? '156' : '632';
   let creditAccount = isImport ? '331' : '156';
   if (relatedJe?.details?.length) {
     const dLine = relatedJe.details.find(d => d.debit > 0);
     const cLine = relatedJe.details.find(d => d.credit > 0);
     if (dLine?.account) debitAccount = dLine.account;
     if (cLine?.account) creditAccount = cLine.account;
   }

   const handleSaveMeta = () => {
     if (!canEdit || !handleUpdateInventoryTransactionMeta) return;
     handleUpdateInventoryTransactionMeta(transaction.id, {
       documentRef: docRef,
       formNo: formNo,
       symbolCode: symbolCode,
     } as any);
     setIsEditing(false);
   };

   const printSurfaceRef = useRef<HTMLDivElement>(null);

   const preparePrintClone = (source: HTMLElement): HTMLElement => {
     const clone = source.cloneNode(true) as HTMLElement;
     clone.classList.remove('sr-only', 'hidden');
     clone.removeAttribute('aria-hidden');
     clone.classList.add('inventory-voucher-print-surface');
     clone.style.cssText =
       'display:block;position:static;width:auto;height:auto;overflow:visible;opacity:1;clip:auto;clip-path:none;margin:0;padding:0;border:0;white-space:normal;';
     clone.querySelectorAll<HTMLElement>('.sr-only, [aria-hidden="true"]').forEach((el) => {
       if (el === clone) return;
       el.classList.remove('sr-only');
       el.removeAttribute('aria-hidden');
       el.style.cssText =
         'position:static;width:auto;height:auto;overflow:visible;opacity:1;clip:auto;clip-path:none;margin:0;padding:0;';
     });
     clone.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((ta) => {
       ta.readOnly = true;
       ta.style.resize = 'none';
     });
     return clone;
   };

   /** In qua iframe chỉ chứa phiếu — tránh in cả SPA (nhiều trang trống). */
   const handlePrint = () => {
     const source = printSurfaceRef.current;
     if (!source) return;

     const iframe = document.createElement('iframe');
     iframe.setAttribute('title', 'inventory-voucher-print');
     iframe.setAttribute('aria-hidden', 'true');
     iframe.style.cssText =
       'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
     document.body.appendChild(iframe);

     const doc = iframe.contentDocument!;
     const win = iframe.contentWindow!;

     const headAssets = Array.from(
       document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style'),
     )
       .map((n) => n.outerHTML)
       .join('\n');

     const pageSize = printOrientation === 'landscape' ? 'A4 landscape' : 'A4 portrait';

     doc.open();
     doc.write(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"/>
${headAssets}
<style>
  @page { size: ${pageSize}; margin: 12mm; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    height: auto !important;
    min-height: 0 !important;
    color: #000 !important;
    font-family: 'Times New Roman', Times, serif !important;
  }
  .inventory-voucher-print-surface,
  .inventory-voucher-print-surface * {
    visibility: visible !important;
  }
  .inventory-voucher-print-surface {
    position: static !important;
    overflow: visible !important;
    max-height: none !important;
    min-height: 0 !important;
    width: auto !important;
    height: auto !important;
    opacity: 1 !important;
    box-shadow: none !important;
  }
  .inventory-voucher-tt133-wrap,
  .inventory-voucher-tt58-wrap {
    page-break-after: avoid;
    page-break-inside: avoid;
    max-width: ${printOrientation === 'landscape' ? '297mm' : '210mm'} !important;
    width: 100% !important;
    margin: 0 auto !important;
    font-family: 'Times New Roman', Times, serif !important;
    color: #000 !important;
  }
  .inventory-voucher-tt58-signatures .voucher-sign-col-hint {
    margin-top: 2px !important;
  }
  .inventory-voucher-tt58-signatures .voucher-sign-col > div[aria-hidden] {
    min-height: 2.75rem !important;
    margin-top: 4px !important;
  }
  textarea { border-color: #000 !important; }
</style></head><body></body></html>`);
     doc.close();

     doc.body.appendChild(preparePrintClone(source));

     const removeFrame = () => {
       iframe.remove();
     };

     let printed = false;
     const runPrintOnce = () => {
       if (printed) return;
       printed = true;
       try {
         win.focus();
         win.print();
       } finally {
         win.addEventListener('afterprint', removeFrame, { once: true });
         setTimeout(removeFrame, 2500);
       }
     };

     const links = doc.querySelectorAll('link[rel="stylesheet"]');
     if (links.length === 0) {
       requestAnimationFrame(() => setTimeout(runPrintOnce, 80));
     } else {
       let pending = links.length;
       const onSheet = () => {
         pending -= 1;
         if (pending <= 0) requestAnimationFrame(() => setTimeout(runPrintOnce, 80));
       };
       links.forEach((l) => {
         l.addEventListener('load', onSheet);
         l.addEventListener('error', onSheet);
       });
       setTimeout(runPrintOnce, 2000);
     }
   };

   const voucherTitle = isImport ? 'Phiếu nhập kho' : 'Phiếu xuất kho';

   if (compact) {
     return (
       <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
         <div className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl animate-fade-in font-sans">
           <div className={`${isImport ? 'bg-emerald-600' : 'bg-red-600'} flex shrink-0 items-center justify-between gap-2 px-3 py-2.5 text-white`}>
             <h3 className="flex items-center gap-1.5 text-sm font-bold">
               <Eye className="h-4 w-4 shrink-0" aria-hidden />
               {voucherTitle}
             </h3>
             <div className="flex items-center gap-1.5">
               <select
                 value={printOrientation}
                 onChange={(e) => setPrintOrientation(e.target.value as 'portrait' | 'landscape')}
                 className="max-w-[6.5rem] cursor-pointer rounded border border-white/40 bg-white/15 px-1.5 py-1 text-[10px] font-semibold text-white outline-none hover:bg-white/25"
                 title="Khổ giấy A4"
               >
                 <option value="portrait" className="text-slate-900">A4 dọc</option>
                 <option value="landscape" className="text-slate-900">A4 ngang</option>
               </select>
               <button
                 type="button"
                 onClick={handlePrint}
                 className="flex items-center gap-1 rounded bg-white/20 px-2 py-1 text-[11px] font-semibold hover:bg-white/30"
                 title="In phiếu theo mẫu Thông tư Bộ Tài chính"
               >
                 <Printer className="h-3.5 w-3.5" /> In
               </button>
               {canEdit && (
               <button
                 type="button"
                 onClick={() => setIsEditing((v) => !v)}
                 className="rounded bg-white/15 px-2 py-1 text-[11px] font-semibold hover:bg-white/20"
               >
                 {isEditing ? 'Hủy' : 'Sửa'}
               </button>
               )}
               <button type="button" onClick={onClose} className="rounded p-1 hover:bg-white/20">
                 <X className="h-4 w-4" />
               </button>
             </div>
           </div>

           <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 text-sm">
             <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
               <span className="font-mono font-bold text-blue-700">{transaction.voucherNumber || '—'}</span>
               <span className="text-slate-400">·</span>
               <span className="text-slate-600">{new Date(transaction.date).toLocaleString('vi-VN')}</span>
             </div>

             <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
               <p className="font-semibold text-slate-800">{transaction.itemName}</p>
               <p className="mt-0.5 text-xs text-slate-500">
                 SKU: <span className="font-mono font-semibold">{itemSku}</span> · ĐVT: {itemUnit}
               </p>
             </div>

             <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
               <div>
                 <dt className="text-slate-500">Số lượng</dt>
                 <dd className="font-bold text-slate-900">{transaction.quantity}</dd>
               </div>
               <div className="text-right">
                 <dt className="text-slate-500">Đơn giá</dt>
                 <dd className="font-semibold text-slate-800">{formatCurrency(transaction.price)}</dd>
               </div>
               <div>
                 <dt className="text-slate-500">Thành tiền</dt>
                 <dd className="font-medium text-slate-700">{formatCurrency(subTotal)}</dd>
               </div>
               <div className="text-right">
                 <dt className="text-slate-500">VAT ({formatVatRateLabel(Number(transaction.vatRate))})</dt>
                 <dd className="font-medium text-slate-700">{formatCurrency(vatAmount)}</dd>
               </div>
               <div className="col-span-2 border-t border-slate-200 pt-2">
                 <dt className="text-slate-500">Tổng cộng</dt>
                 <dd className={`text-base font-bold tabular-nums ${isImport ? 'text-emerald-600' : 'text-red-600'}`}>
                   {formatCurrency(total)}
                 </dd>
               </div>
             </dl>

             <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs">
               {isImport ? (
                 <>
                   <div className="flex justify-between gap-2">
                     <span className="shrink-0 text-slate-500">Nhà cung cấp</span>
                     <span className="text-right font-medium text-slate-800">{transaction.supplier || '—'}</span>
                   </div>
                   {transaction.supplierPhone && (
                     <div className="flex justify-between gap-2">
                       <span className="text-slate-500">SĐT NCC</span>
                       <span className="font-medium">{transaction.supplierPhone}</span>
                     </div>
                   )}
                 </>
               ) : (
                 <>
                   <div className="flex justify-between gap-2">
                     <span className="shrink-0 text-slate-500">Khách hàng</span>
                     <span className="text-right font-medium text-slate-800">{transaction.customer || '—'}</span>
                   </div>
                   {transaction.exportPurpose && (
                     <div className="flex justify-between gap-2">
                       <span className="text-slate-500">Mục đích xuất</span>
                       <span className="max-w-[55%] text-right font-medium">{transaction.exportPurpose}</span>
                     </div>
                   )}
                 </>
               )}
               <div className="flex justify-between gap-2">
                 <span className="text-slate-500">Chứng từ gốc</span>
                 {isEditing ? (
                   <input
                     value={docRef}
                     onChange={(e) => setDocRef(e.target.value)}
                     className="w-36 rounded border border-slate-200 p-1 text-right font-mono text-[11px]"
                   />
                 ) : (
                   <span className="font-mono font-semibold text-blue-700">{transaction.documentRef || '—'}</span>
                 )}
               </div>
               <div className="flex justify-between gap-2">
                 <span className="text-slate-500">Mẫu số / Ký hiệu</span>
                 {isEditing ? (
                   <div className="flex flex-col items-end gap-1">
                     <input
                       value={formNo}
                       onChange={(e) => setFormNo(e.target.value)}
                       className="w-36 rounded border border-slate-200 p-1 text-right font-mono text-[11px]"
                       placeholder="Mẫu số"
                     />
                     <input
                       value={symbolCode}
                       onChange={(e) => setSymbolCode(e.target.value)}
                       className="w-36 rounded border border-slate-200 p-1 text-right font-mono text-[11px] uppercase"
                       placeholder="Ký hiệu"
                     />
                   </div>
                 ) : (
                   <span className="font-mono text-slate-700">
                     {transaction.formNo || '—'} / {transaction.symbolCode || '—'}
                   </span>
                 )}
               </div>
               {(transaction.paymentStatus || transaction.paymentMethod) && (
                 <div className="flex justify-between gap-2">
                   <span className="text-slate-500">Thanh toán</span>
                   <span className="text-right font-medium text-slate-700">
                     {transaction.paymentStatus === 'PAID' ? 'Đã thanh toán' : transaction.paymentStatus === 'PENDING' ? 'Công nợ' : (transaction.paymentStatus || '—')}
                   </span>
                 </div>
               )}
               {transaction.note && (
                 <div className="rounded border border-slate-100 bg-slate-50 p-2 italic text-slate-600">
                   {transaction.note}
                 </div>
               )}
               <div className="text-right text-[11px] text-slate-400">
                 Người thực hiện: {transaction.performer || '—'}
               </div>
             </div>

             {serialList.length > 0 && (
               <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
                 <p className="text-[10px] font-semibold text-slate-500">Serial / IMEI ({serialList.length})</p>
                 <ul className="mt-1 max-h-24 overflow-y-auto text-[11px] font-mono text-slate-700">
                   {serialList.map((s, idx) => (
                     <li key={`${s}-${idx}`} className="truncate py-0.5">
                       {s}
                     </li>
                   ))}
                 </ul>
               </div>
             )}
           </div>

           <div ref={printSurfaceRef} className="inventory-voucher-print-surface hidden" aria-hidden>
             {useTt58ImportPrint ? (
               <WarehouseVoucherTT58ImportPrint
                 transaction={transaction}
                 itemSku={itemSku}
                 itemUnit={itemUnit}
                 printUnit={printUnit}
                 onPrintUnitChange={setPrintUnit}
                 printDepartment={printDepartment}
                 onPrintDepartmentChange={setPrintDepartment}
                 printLandscape={printOrientation === 'landscape'}
               />
             ) : useTt58ExportPrint ? (
               <WarehouseVoucherTT58ExportPrint
                 transaction={transaction}
                 itemSku={itemSku}
                 itemUnit={itemUnit}
                 printUnit={printUnit}
                 onPrintUnitChange={setPrintUnit}
                 printDepartment={printDepartment}
                 onPrintDepartmentChange={setPrintDepartment}
                 printLandscape={printOrientation === 'landscape'}
               />
             ) : (
               <WarehouseVoucherTT133Print
                 transaction={transaction}
                 itemSku={itemSku}
                 itemUnit={itemUnit}
                 printUnit={printUnit}
                 onPrintUnitChange={setPrintUnit}
                 printDepartment={printDepartment}
                 onPrintDepartmentChange={setPrintDepartment}
                 debitAccount={debitAccount}
                 creditAccount={creditAccount}
                 printLandscape={printOrientation === 'landscape'}
               />
             )}
           </div>

           <div className="flex shrink-0 justify-end gap-2 border-t bg-slate-50 px-3 py-2.5">
             {canEdit && isEditing ? (
               <>
                 <button
                   type="button"
                   onClick={() => setIsEditing(false)}
                   className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                 >
                   Hủy
                 </button>
                 <button
                   type="button"
                   onClick={handleSaveMeta}
                   className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                 >
                   Cập nhật
                 </button>
               </>
             ) : (
               <button
                 type="button"
                 onClick={onClose}
                 className="rounded bg-slate-200 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-300"
               >
                 Đóng
               </button>
             )}
           </div>
         </div>
       </div>
     );
   }

   return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl animate-fade-in font-sans">
        <div className={`${isImport ? 'bg-emerald-600' : 'bg-red-600'} flex shrink-0 items-center justify-between p-4 text-white print:hidden`}>
          <h3 className="flex items-center gap-2 font-bold">
            <Eye className="h-5 w-5" aria-hidden /> Chi tiết{' '}
            {useTt58ImportPrint
              ? 'phiếu nhập kho'
              : useTt58ExportPrint
                ? 'phiếu xuất kho'
                : isImport
                  ? 'nạp tài nguyên'
                  : 'bàn giao/kích hoạt'}
          </h3>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-white/95">
              <span className="whitespace-nowrap">Khổ giấy:</span>
              <select
                value={printOrientation}
                onChange={(e) => setPrintOrientation(e.target.value as 'portrait' | 'landscape')}
                className="max-w-[11rem] cursor-pointer rounded border border-white/40 bg-white/15 px-2 py-1 text-[10px] font-semibold text-white outline-none hover:bg-white/25"
                title="Dọc: chuẩn A4. Ngang: nhiều chỗ cho tên đơn vị dài."
              >
                <option value="portrait" className="text-slate-900">A4 dọc</option>
                <option value="landscape" className="text-slate-900">A4 ngang</option>
              </select>
            </label>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded bg-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/30"
              title="In phiếu (mẫu TT 133)"
            >
              <Printer className="h-4 w-4" /> In phiếu
            </button>
            {canEdit && (
            <button
              onClick={() => setIsEditing(v => !v)}
              className="rounded bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
              title="Sửa Mẫu số / Ký hiệu / Số HĐ để đồng bộ Hoá đơn & VAT"
            >
              {isEditing ? 'Hủy sửa' : 'Sửa'}
            </button>
            )}
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-white/20"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="print:hidden border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4 shadow-inner">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-[10px] font-semibold tracking-tight ${
                isImport ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200' : 'bg-red-100 text-red-800 ring-1 ring-red-200'
              }`}
            >
              {isImport ? 'Chứng từ nạp tài nguyên' : 'Chứng từ bàn giao/kích hoạt'}
            </span>
            {serialList.length > 0 && (
              <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-medium tracking-tight text-slate-600 ring-1 ring-slate-200">
                {serialList.length} serial / IMEI
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm">
              <p className="text-[10px] font-medium tracking-tight text-slate-400">Thời điểm hạch toán</p>
              <p className="mt-1 text-sm font-semibold capitalize leading-snug text-slate-800">{dateCaptionVi}</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">Giờ: {timeCaptionVi}</p>
              <p className="mt-2 text-[11px] text-slate-500">
                Ngày <span className="font-mono font-bold text-slate-700">{ymdParts.d}</span> · Tháng{' '}
                <span className="font-mono font-bold text-slate-700">{ymdParts.m}</span> · Năm{' '}
                <span className="font-mono font-bold text-slate-700">{ymdParts.y}</span>
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm">
              <p className="text-[10px] font-medium tracking-tight text-slate-400">Hóa đơn / Chứng từ gốc</p>
              <p className="mt-1 font-mono text-sm font-semibold text-blue-700">{transaction.documentRef || '—'}</p>
              <p className="mt-1 text-[11px] text-slate-600">
                Mẫu số: <span className="font-mono font-semibold">{transaction.formNo || '—'}</span>
              </p>
              <p className="text-[11px] text-slate-600">
                Ký hiệu: <span className="font-mono font-semibold uppercase">{transaction.symbolCode || '—'}</span>
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm">
              <p className="text-[10px] font-medium tracking-tight text-slate-400">{'Phiếu & hàng'}</p>
              <p className="mt-1 text-xs text-slate-500">
                Số phiếu nội bộ:{' '}
                <span className="font-mono font-semibold text-slate-800">{transaction.voucherNumber || '—'}</span>
              </p>
              <p className="mt-1 text-sm font-bold text-slate-800">{transaction.itemName}</p>
              <p className="text-[11px] text-slate-500">
                SKU: <span className="font-mono font-semibold">{itemSku}</span> · ĐVT: {itemUnit}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm">
              <p className="text-[10px] font-medium tracking-tight text-slate-400">{'Số lượng & tiền'}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{transaction.quantity}</p>
              <p className="text-xs text-slate-500">
                Đơn giá <span className="font-semibold text-slate-700">{formatCurrency(transaction.price)}</span>
              </p>
              <p className={`mt-1 text-sm font-semibold tabular-nums ${isImport ? 'text-emerald-600' : 'text-red-600'}`}>
                Tổng: {formatCurrency(total)}
              </p>
            </div>
          </div>
          {serialList.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-[10px] font-semibold tracking-tight text-slate-500">Danh sách Serial / IMEI</p>
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200/80 bg-white pr-1 [scrollbar-color:rgba(148,163,184,0.85)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
                <ul className="divide-y divide-slate-100 text-xs">
                  {serialList.map((s, idx) => {
                    const snap = transaction.serialInfoSnapshot?.find((x) => String(x.serial || '').trim() === s);
                    return (
                      <li key={`${s}-${idx}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 font-mono text-slate-800">
                        <span className="break-all">{s}</span>
                        {snap != null && (
                          <span className="shrink-0 text-[10px] font-sans font-semibold text-slate-400">
                            VAT nhập: {formatVatRateLabel(Number(snap.inboundVatRate))}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div
          ref={printSurfaceRef}
          className="inventory-voucher-print-surface min-h-0 flex-1 overflow-y-auto bg-white"
        >
          {useTt58ImportPrint ? (
            <WarehouseVoucherTT58ImportPrint
              transaction={transaction}
              itemSku={itemSku}
              itemUnit={itemUnit}
              printUnit={printUnit}
              onPrintUnitChange={setPrintUnit}
              printDepartment={printDepartment}
              onPrintDepartmentChange={setPrintDepartment}
              printLandscape={printOrientation === 'landscape'}
            />
          ) : useTt58ExportPrint ? (
            <WarehouseVoucherTT58ExportPrint
              transaction={transaction}
              itemSku={itemSku}
              itemUnit={itemUnit}
              printUnit={printUnit}
              onPrintUnitChange={setPrintUnit}
              printDepartment={printDepartment}
              onPrintDepartmentChange={setPrintDepartment}
              printLandscape={printOrientation === 'landscape'}
            />
          ) : (
            <WarehouseVoucherTT133Print
              transaction={transaction}
              itemSku={itemSku}
              itemUnit={itemUnit}
              printUnit={printUnit}
              onPrintUnitChange={setPrintUnit}
              printDepartment={printDepartment}
              onPrintDepartmentChange={setPrintDepartment}
              debitAccount={debitAccount}
              creditAccount={creditAccount}
              printLandscape={printOrientation === 'landscape'}
            />
          )}
        </div>

        <div className="space-y-4 border-t border-slate-200 p-6 print:hidden">
            <div className="border-b pb-4 text-center">
               <div className={`mb-1 text-xs font-semibold tracking-tight ${isImport ? 'text-emerald-600' : 'text-red-600'}`}>
                  {isImport ? 'Phiếu nạp tài nguyên' : 'Phiếu bàn giao/kích hoạt'}
               </div>
               <div className="text-2xl font-bold text-slate-800">{transaction.itemName}</div>
               <div className="mt-1 text-sm text-slate-500">{new Date(transaction.date).toLocaleString('vi-VN')}</div>
            </div>
            
            <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b border-slate-100 pb-2">
                   <span className="text-slate-500">Mã giao dịch:</span>
                   <span className="font-mono text-slate-700">{transaction.id}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2">
                   <span className="text-slate-500">Số phiếu nội bộ:</span>
                   <span className="font-mono font-bold text-blue-700">{transaction.voucherNumber || '---'}</span>
                </div>
                {isImport ? (
                   <>
                     <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Nhà cung cấp:</span>
                        <span className="font-medium">{transaction.supplier || '---'}</span>
                     </div>
                     <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">SĐT NCC:</span>
                        <span className="font-medium">{transaction.supplierPhone || '---'}</span>
                     </div>
                     <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Địa chỉ:</span>
                        <span className="font-medium text-right max-w-[200px] truncate">{transaction.supplierAddress || '---'}</span>
                     </div>
                   </>
                ) : (
                   <>
                     <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Khách hàng:</span>
                        <span className="font-medium">{transaction.customer || '---'}</span>
                     </div>
                     <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">SĐT Khách:</span>
                        <span className="font-medium">{transaction.customerPhone || '---'}</span>
                     </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Địa chỉ:</span>
                        <span className="font-medium text-right max-w-[200px] truncate">{transaction.customerAddress || '---'}</span>
                     </div>
                   </>
                )}
                
                <div className="flex justify-between border-b border-slate-100 pb-2">
                   <span className="text-slate-500">Chứng từ gốc:</span>
                   {isEditing ? (
                     <input
                       value={docRef}
                       onChange={(e) => setDocRef(e.target.value)}
                       className="w-48 p-1.5 border border-slate-200 rounded text-xs font-mono font-bold text-blue-700 text-right"
                       placeholder="Số HĐ / CT..."
                     />
                   ) : (
                   <span className="font-medium text-blue-600">{transaction.documentRef || '---'}</span>
                   )}
                </div>

                <div className="flex justify-between border-b border-slate-100 pb-2">
                   <span className="text-slate-500">Mẫu số:</span>
                   {isEditing ? (
                     <input
                       value={formNo}
                       onChange={(e) => setFormNo(e.target.value)}
                       className="w-48 p-1.5 border border-slate-200 rounded text-xs font-mono font-bold text-slate-700 text-right"
                       placeholder="01GTKT0/001..."
                     />
                   ) : (
                     <span className="font-medium">{(transaction as any).formNo || '---'}</span>
                   )}
                </div>

                <div className="flex justify-between border-b border-slate-100 pb-2">
                   <span className="text-slate-500">Ký hiệu:</span>
                   {isEditing ? (
                     <input
                       value={symbolCode}
                       onChange={(e) => setSymbolCode(e.target.value)}
                       className="w-48 p-1.5 border border-slate-200 rounded text-xs font-mono font-bold uppercase text-slate-700 text-right"
                       placeholder="1C23TYY..."
                     />
                   ) : (
                     <span className="font-medium">{(transaction as any).symbolCode || '---'}</span>
                   )}
                </div>

                {(transaction.paymentStatus || transaction.paymentMethod) && (
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <span className="text-slate-500">Thanh toán:</span>
                    <span className="text-right text-xs font-semibold text-slate-700">
                      {transaction.paymentStatus === 'PAID' ? 'Đã thanh toán' : transaction.paymentStatus === 'PENDING' ? 'Công nợ / Chưa thu đủ' : (transaction.paymentStatus || '—')}
                      {transaction.paymentMethod ? (
                        <span className="block font-mono text-[10px] text-slate-500">
                          {transaction.paymentMethod === 'BANK' ? 'Chuyển khoản' : 'Tiền mặt'}
                        </span>
                      ) : null}
                    </span>
                  </div>
                )}

                {!isImport && transaction.exportPurpose && (
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <span className="text-slate-500">Mục đích xuất:</span>
                    <span className="max-w-[220px] text-right text-xs font-bold text-slate-700">{transaction.exportPurpose}</span>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg mt-2">
                   <div>
                      <span className="text-xs text-slate-500 block">Số lượng</span>
                      <span className="font-bold text-lg">{transaction.quantity}</span>
                   </div>
                   <div className="text-right">
                      <span className="text-xs text-slate-500 block">Đơn giá</span>
                      <span className="font-medium">{formatCurrency(transaction.price)}</span>
                   </div>
                   <div>
                      <span className="text-xs text-slate-500 block">Thành tiền</span>
                      <span className="font-medium">{formatCurrency(subTotal)}</span>
                   </div>
                   <div className="text-right">
                      <span className="text-xs text-slate-500 block">Thuế VAT ({formatVatRateLabel(Number(transaction.vatRate))})</span>
                      <span className="font-medium">{formatCurrency(vatAmount)}</span>
                   </div>
                   <div className="col-span-2 border-t pt-2 flex justify-between items-center">
                      <span className="font-bold text-slate-700">Tổng cộng</span>
                      <span className={`font-bold text-lg ${isImport ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(total)}</span>
                   </div>
                </div>

                <div className="pt-2">
                   <span className="text-slate-500 block mb-1">Ghi chú:</span>
                   <div className="bg-slate-50 p-2 rounded border border-slate-100 text-slate-700 italic text-xs">
                      {transaction.note || 'Không có ghi chú'}
                   </div>
                </div>

                {serialList.length > 0 && (
                  <p className="pt-2 text-center text-[11px] italic text-slate-400">
                    Danh sách Serial/IMEI đầy đủ nằm ở khung tóm tắt phía trên (có thanh cuộn).
                  </p>
                )}
                
                <div className="text-right text-xs text-slate-400 pt-2">
                   Người thực hiện: {transaction.performer}
                </div>
            </div>
        </div>
        <div className="flex justify-end border-t bg-slate-50 p-4 print:hidden">
           {canEdit && isEditing ? (
             <div className="flex gap-2">
               <button type="button" onClick={() => setIsEditing(false)} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Hủy</button>
               <button type="button" onClick={handleSaveMeta} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Cập nhật</button>
             </div>
           ) : (
           <button type="button" onClick={onClose} className="rounded bg-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-300">Đóng</button>
           )}
        </div>
      </div>
    </div>
   );
};

function ledgerDayOnly(iso: string) {
  return String(iso || '').split('T')[0];
}

type LedgerRow = InventoryTransaction & { isImport: boolean; balance: number };

// Stock Ledger Modal
export const StockLedgerModal = ({
  item,
  transactions,
  onClose,
}: {
  item: InventoryItem | null;
  transactions: InventoryTransaction[];
  onClose: () => void;
}) => {
  if (!item) return null;

  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [serialSearch, setSerialSearch] = useState('');

  const serialRows = useMemo(() => {
    const serials = item.serials || [];
    const details = item.serialDetails || [];
    const rateBySerial = new Map(
      details.map((d: { serial: string; inboundVatRate: number }) => [String(d.serial).trim(), d.inboundVatRate]),
    );
    return serials
      .map((serial: string) => {
        const s = String(serial).trim();
        return {
          serial: s,
          inboundVatRate: rateBySerial.has(s) ? rateBySerial.get(s)! : null,
        };
      })
      .filter((r: { serial: string }) => r.serial.length > 0);
  }, [item.serials, item.serialDetails]);

  const filteredSerialRows = useMemo(() => {
    const q = serialSearch.trim().toLowerCase().replace(/\s+/g, '');
    if (!q) return serialRows;
    return serialRows.filter((r: { serial: string }) =>
      r.serial.toLowerCase().replace(/\s+/g, '').includes(q),
    );
  }, [serialRows, serialSearch]);

  const {
    openingBalance,
    periodImport,
    periodExport,
    closingBalance,
    rowsWithBalance,
  } = useMemo(() => {
    const start = startDate;
    const end = endDate;
    const sorted = (transactions || [])
      .filter((t) => t.itemId === item.id)
      .sort((a, b) => {
        const ca = ledgerDayOnly(a.date).localeCompare(ledgerDayOnly(b.date));
        if (ca !== 0) return ca;
        return String(a.id).localeCompare(String(b.id));
      });

    let ob = 0;
    let pi = 0;
    let pe = 0;
    const rows: Array<InventoryTransaction & { isImport: boolean }> = [];

    for (const t of sorted) {
      const d = ledgerDayOnly(t.date);
      const isImport = t.type === 'IMPORT';
      if (d < start) {
        ob += isImport ? t.quantity : -t.quantity;
      } else if (d <= end) {
        rows.push({ ...t, isImport });
        if (isImport) pi += t.quantity;
        else pe += t.quantity;
      }
    }

    let running = ob;
    const withBal: LedgerRow[] = rows.map((r) => {
      running += r.isImport ? r.quantity : -r.quantity;
      return { ...r, balance: running };
    });

    return {
      openingBalance: ob,
      periodImport: pi,
      periodExport: pe,
      closingBalance: ob + pi - pe,
      rowsWithBalance: withBal,
    };
  }, [item.id, transactions, startDate, endDate]);

  const openingRowDateLabel = new Date(startDate + 'T12:00:00').toLocaleDateString('vi-VN');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-3">
      <div className="flex max-h-[min(94vh,100dvh)] w-full max-w-[min(56rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl bg-white shadow-xl animate-fade-in">
        <div className="flex shrink-0 items-center justify-between bg-blue-600 p-3 text-white sm:p-3.5">
          <h3 className="flex items-center gap-2 text-sm font-bold sm:text-base">
            <BookOpen className="h-5 w-5 shrink-0" /> Sổ Chi Tiết Vật Tư (Sổ Kho)
          </h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-blue-700" aria-label="Đóng">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b bg-slate-50 p-3 sm:p-3.5">
          <div className="min-w-0">
            <h4 className="truncate text-base font-bold text-slate-800 sm:text-lg">{item.name}</h4>
            <p className="text-xs text-slate-500 sm:text-sm">Mã: {item.sku} | ĐVT: {item.unit}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Từ ngày</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded border border-slate-200 bg-white p-1.5 text-xs sm:p-2 sm:text-sm"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Đến ngày</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded border border-slate-200 bg-white p-1.5 text-xs sm:p-2 sm:text-sm"
              />
            </div>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 border-b bg-white p-2.5 sm:grid-cols-4 sm:gap-2.5 sm:p-3">
          <div className="rounded bg-slate-100 p-2 text-center sm:p-2.5">
            <div className="text-[10px] font-medium text-slate-500">Số dư đầu kỳ</div>
            <div className="text-base font-bold text-slate-700 sm:text-lg">{openingBalance}</div>
          </div>
          <div className="rounded bg-emerald-50 p-2 text-center sm:p-2.5">
            <div className="text-[9px] font-medium leading-tight text-emerald-600 sm:text-[10px]">Nạp tài nguyên trong kỳ</div>
            <div className="text-base font-bold text-emerald-700 sm:text-lg">+{periodImport}</div>
          </div>
          <div className="rounded bg-red-50 p-2 text-center sm:p-2.5">
            <div className="text-[9px] font-medium leading-tight text-red-600 sm:text-[10px]">Bàn giao/Kích hoạt trong kỳ</div>
            <div className="text-base font-bold text-red-700 sm:text-lg">-{periodExport}</div>
          </div>
          <div className="rounded bg-blue-50 p-2 text-center sm:p-2.5">
            <div className="text-[10px] font-medium text-blue-600">Số dư cuối kỳ</div>
            <div className="text-base font-bold text-blue-700 sm:text-lg">{closingBalance}</div>
          </div>
        </div>

        {/* Chi tiết chiếm phần lớn modal — cuộn toàn bộ dòng trong kỳ theo thời gian */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-slate-200">
          <div className="shrink-0 border-b border-slate-200 bg-slate-100/90 px-2 py-2 text-center sm:px-3">
            <p className="text-[10px] font-semibold tracking-tight text-slate-600">
              Chi tiết nạp tài nguyên — bàn giao/kích hoạt — số dư
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 py-2 sm:px-3 sm:py-3">
            <table className="w-full table-fixed text-left text-xs sm:text-sm">
              <thead className="sticky top-0 z-[1] bg-slate-100 text-[10px] font-semibold text-slate-600 shadow-sm sm:text-xs">
                <tr>
                  <th className="w-[5.5rem] p-1.5 sm:w-24 sm:p-2">Ngày CT</th>
                  <th className="w-[6.5rem] p-1.5 sm:w-36 sm:p-2">Số CT / Số HĐ</th>
                  <th className="min-w-0 p-1.5 sm:p-2">Diễn giải</th>
                  <th className="w-[3.25rem] p-1.5 text-right sm:w-20 sm:p-2">
                    <span className="block leading-tight">Nạp</span>
                    <span className="block text-[9px] font-normal opacity-80">tài nguyên</span>
                  </th>
                  <th className="w-[3.25rem] p-1.5 text-right sm:w-[4.5rem] sm:p-2">
                    <span className="block text-[9px] leading-tight sm:text-[10px]">Bàn giao/</span>
                    <span className="block text-[9px] leading-tight sm:text-[10px]">Kích hoạt</span>
                  </th>
                  <th className="w-16 p-1.5 text-right sm:w-[4.25rem] sm:p-2">Tồn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-amber-50/90 font-semibold text-slate-800">
                  <td className="p-1.5 sm:p-2">{openingRowDateLabel}</td>
                  <td className="p-1.5 text-slate-500 sm:p-2">
                    <div className="flex flex-col gap-0.5 text-left text-[10px] sm:text-xs">
                      <span>CT: —</span>
                      <span>Số HĐ: —</span>
                    </div>
                  </td>
                  <td className="p-1.5 sm:p-2">Số dư đầu kỳ (trước {startDate})</td>
                  <td className="p-1.5 text-right sm:p-2">—</td>
                  <td className="p-1.5 text-right sm:p-2">—</td>
                  <td className="p-1.5 text-right font-bold sm:p-2">{openingBalance}</td>
                </tr>
                {rowsWithBalance.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">
                      Không có phát sinh nạp tài nguyên / bàn giao/kích hoạt trong kỳ đã chọn.
                    </td>
                  </tr>
                ) : (
                  rowsWithBalance.map((r) => {
                    const desc = String(
                      r.note ||
                        (r.isImport ? `Nạp tài nguyên từ ${r.supplier || ''}` : `Bàn giao/Kích hoạt cho ${r.customer || ''}`) ||
                        '—',
                    );
                    const soPhieu = String(r.voucherNumber || '').trim() || '—';
                    const soHd = String(r.documentRef || '').trim() || '—';
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="p-1.5 align-middle whitespace-nowrap text-slate-800 sm:p-2">
                          {new Date(r.date + (r.date.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('vi-VN')}
                        </td>
                        <td className="p-1.5 align-middle sm:p-2">
                          <div className="flex flex-col gap-0.5 break-all text-left">
                            <span className="font-medium text-blue-600" title="Số chứng từ / phiếu kho">
                              CT: {soPhieu}
                            </span>
                            <span className="text-[10px] font-medium text-slate-600 sm:text-[11px]" title="Số hóa đơn">
                              Số HĐ: {soHd}
                            </span>
                          </div>
                        </td>
                        <td className="max-w-0 min-w-0 p-1.5 align-middle text-slate-600 sm:p-2">
                          <span className="block break-words text-left" title={desc}>
                            {desc}
                          </span>
                        </td>
                        <td className="p-1.5 align-middle text-right font-medium text-emerald-600 sm:p-2">
                          {r.isImport ? r.quantity : '—'}
                        </td>
                        <td className="p-1.5 align-middle text-right font-medium text-red-600 sm:p-2">
                          {!r.isImport ? r.quantity : '—'}
                        </td>
                        <td className="p-1.5 align-middle text-right font-bold text-slate-800 sm:p-2">{r.balance}</td>
                      </tr>
                    );
                  })
                )}
                {rowsWithBalance.length > 0 && (
                  <tr className="border-t-2 border-slate-200 bg-blue-50/80 font-bold text-slate-900">
                    <td className="p-1.5 sm:p-2" colSpan={3}>
                      Cộng cuối kỳ ({endDate})
                    </td>
                    <td className="p-1.5 text-right text-emerald-700 sm:p-2">+{periodImport}</td>
                    <td className="p-1.5 text-right text-red-700 sm:p-2">−{periodExport}</td>
                    <td className="p-1.5 text-right sm:p-2">{closingBalance}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="shrink-0 bg-slate-50/80 px-3 py-2 sm:px-3.5">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[10px] font-semibold tracking-tight text-slate-700">Serial / IMEI đang tồn</h4>
            <span className="text-[10px] text-slate-500 sm:text-[11px]">
              {serialRows.length > 0
                ? `${serialRows.length} mã · SL số dư: ${item.quantity}`
                : `SL số dư hiện tại: ${item.quantity}`}
            </span>
          </div>
          <div className="relative mb-1.5">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={serialSearch}
              onChange={(e) => setSerialSearch(e.target.value)}
              placeholder="Tìm Serial / IMEI..."
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 sm:py-2 sm:pl-9 sm:text-sm"
              disabled={serialRows.length === 0}
            />
          </div>
          <div className="max-h-24 overflow-auto rounded-lg border border-slate-200 bg-white sm:max-h-28">
            {serialRows.length === 0 ? null : filteredSerialRows.length === 0 ? (
              <p className="p-3 text-center text-xs text-amber-700">
                Không có Serial/IMEI khớp &quot;{serialSearch.trim()}&quot;.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-100 text-[10px] font-semibold text-slate-600">
                  <tr>
                    <th className="w-12 p-1.5 text-center sm:p-2">STT</th>
                    <th className="p-1.5 sm:p-2">Serial / IMEI</th>
                    <th className="w-32 p-1.5 text-right sm:w-36 sm:p-2">Thuế GTGT nhập</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-xs">
                  {filteredSerialRows.map(
                    (r: { serial: string; inboundVatRate: number | null }, idx: number) => (
                      <tr key={`${r.serial}-${idx}`} className="hover:bg-slate-50">
                        <td className="p-1.5 text-center text-slate-500 sm:p-2">{idx + 1}</td>
                        <td className="p-1.5 font-semibold text-slate-800 break-all sm:p-2">{r.serial}</td>
                        <td className="p-1.5 text-right text-slate-600 sm:p-2">
                          {r.inboundVatRate != null ? formatVatRateLabel(r.inboundVatRate) : '—'}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
