import React, { useState } from 'react';
import { Plus, Pencil, Trash2, ShoppingBag, Wine, X } from 'lucide-react';
import type { InventoryItem, ServiceItem, HotelPmsRevenueAccount } from '../types';
import { HOTEL_PMS_REVENUE_ACCOUNT_LABELS } from '../hotelPmsAccounting';
import { formatCurrency, formatNumber, parseNumber } from '../utils';

interface ServiceMinibarSettingsProps {
  inventory: InventoryItem[];
  services: ServiceItem[];
  onInventoryChange: (items: InventoryItem[]) => void;
  onServicesChange: (items: ServiceItem[]) => void;
}

const SERVICE_CATEGORIES: ServiceItem['category'][] = ['LAUNDRY', 'FOOD', 'OTHER'];

const categoryLabel: Record<ServiceItem['category'], string> = {
  MINIBAR: 'Minibar',
  LAUNDRY: 'Giặt ủi',
  FOOD: 'Ăn uống',
  OTHER: 'Khác',
};

export const ServiceMinibarSettings: React.FC<ServiceMinibarSettingsProps> = ({
  inventory,
  services,
  onInventoryChange,
  onServicesChange,
}) => {
  const [invForm, setInvForm] = useState<Partial<InventoryItem> | null>(null);
  const [svcForm, setSvcForm] = useState<Partial<ServiceItem> | null>(null);

  const openNewMinibar = () =>
    setInvForm({ name: '', unit: 'Chai', costPrice: 0, quantity: 0, minThreshold: 0, vatRate: 10, revenueAccount: '5111' });
  const openEditMinibar = (item: InventoryItem) => setInvForm({ ...item });
  const saveMinibar = () => {
    if (!invForm?.name?.trim()) {
      alert('Vui lòng nhập tên hàng Minibar.');
      return;
    }
    const payload: InventoryItem = {
      id: invForm.id || `inv-${Date.now()}`,
      name: invForm.name.trim(),
      unit: invForm.unit?.trim() || 'Cái',
      costPrice: Number(invForm.costPrice) || 0,
      quantity: Number(invForm.quantity) || 0,
      minThreshold: Number(invForm.minThreshold) || 0,
      vatRate: Number(invForm.vatRate) || 0,
      revenueAccount: (invForm.revenueAccount as HotelPmsRevenueAccount) || '5111',
      supplier: invForm.supplier,
      invoiceRef: invForm.invoiceRef,
    };
    if (invForm.id) {
      onInventoryChange(inventory.map((i) => (i.id === payload.id ? payload : i)));
    } else {
      onInventoryChange([payload, ...inventory]);
    }
    setInvForm(null);
  };
  const deleteMinibar = (id: string) => {
    if (!window.confirm('Xóa mặt hàng Minibar khỏi danh mục?')) return;
    onInventoryChange(inventory.filter((i) => i.id !== id));
  };

  const openNewService = () =>
    setSvcForm({ name: '', price: 0, category: 'OTHER', revenueAccount: '5113' });
  const openEditService = (item: ServiceItem) => setSvcForm({ ...item });
  const saveService = () => {
    if (!svcForm?.name?.trim()) {
      alert('Vui lòng nhập tên dịch vụ.');
      return;
    }
    const payload: ServiceItem = {
      id: svcForm.id || `svc-${Date.now()}`,
      name: svcForm.name.trim(),
      price: Number(svcForm.price) || 0,
      category: (svcForm.category as ServiceItem['category']) || 'OTHER',
      revenueAccount: (svcForm.revenueAccount as HotelPmsRevenueAccount) || '5113',
    };
    if (svcForm.id) {
      onServicesChange(services.map((s) => (s.id === payload.id ? payload : s)));
    } else {
      onServicesChange([payload, ...services]);
    }
    setSvcForm(null);
  };
  const deleteService = (id: string) => {
    if (!window.confirm('Xóa dịch vụ khỏi danh mục?')) return;
    onServicesChange(services.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-lg font-semibold text-slate-800">Dịch vụ & Minibar</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cấu hình danh mục hiển thị khi <b>Check-out → Thêm dịch vụ / Minibar</b> tại Lễ tân.
          Minibar dùng giá bán (đơn giá); tồn kho tổng cập nhật khi nhập hàng / trừ khi khách dùng.
        </p>
      </header>

      {/* Minibar */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <Wine size={16} className="text-amber-600" /> Minibar (hàng trong phòng)
          </h2>
          <button
            type="button"
            onClick={openNewMinibar}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
          >
            <Plus size={14} /> Thêm
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Tên</th>
                <th className="px-3 py-2">ĐVT</th>
                <th className="px-3 py-2 text-right">Giá bán</th>
                <th className="px-3 py-2 text-right">Tồn kho</th>
                <th className="px-3 py-2 text-right">VAT %</th>
                <th className="px-3 py-2">TK DT</th>
                <th className="px-3 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {inventory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400 text-sm">
                    Chưa có mặt hàng Minibar — bấm Thêm để cấu hình.
                  </td>
                </tr>
              ) : (
                inventory.map((item) => (
                  <tr key={item.id} className="border-t border-slate-50 hover:bg-slate-50/80">
                    <td className="px-4 py-2 font-medium text-slate-800">{item.name}</td>
                    <td className="px-3 py-2 text-slate-600">{item.unit}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCurrency(item.costPrice)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.vatRate ?? 0}%</td>
                    <td className="px-3 py-2 text-xs font-mono text-slate-600">{item.revenueAccount || '5111'}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => openEditMinibar(item)} className="p-1 text-slate-400 hover:text-indigo-600" title="Sửa">
                          <Pencil size={14} />
                        </button>
                        <button type="button" onClick={() => deleteMinibar(item.id)} className="p-1 text-slate-400 hover:text-rose-600" title="Xóa">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Dịch vụ */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <ShoppingBag size={16} className="text-indigo-600" /> Dịch vụ (không trừ tồn phòng)
          </h2>
          <button
            type="button"
            onClick={openNewService}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
          >
            <Plus size={14} /> Thêm
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Tên dịch vụ</th>
                <th className="px-3 py-2">Loại</th>
                <th className="px-3 py-2">TK DT</th>
                <th className="px-3 py-2 text-right">Giá</th>
                <th className="px-3 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">
                    Chưa có dịch vụ — bấm Thêm (vd: Giặt ủi, Thuê xe).
                  </td>
                </tr>
              ) : (
                services.map((svc) => (
                  <tr key={svc.id} className="border-t border-slate-50 hover:bg-slate-50/80">
                    <td className="px-4 py-2 font-medium text-slate-800">{svc.name}</td>
                    <td className="px-3 py-2 text-slate-600">{categoryLabel[svc.category] || svc.category}</td>
                    <td className="px-3 py-2 text-xs font-mono text-slate-600">{svc.revenueAccount || '5113'}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCurrency(svc.price)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => openEditService(svc)} className="p-1 text-slate-400 hover:text-indigo-600" title="Sửa">
                          <Pencil size={14} />
                        </button>
                        <button type="button" onClick={() => deleteService(svc.id)} className="p-1 text-slate-400 hover:text-rose-600" title="Xóa">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal Minibar */}
      {invForm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-bold text-slate-800">{invForm.id ? 'Sửa Minibar' : 'Thêm Minibar'}</h3>
              <button type="button" onClick={() => setInvForm(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div>
                <label className="text-xs font-medium text-slate-500">Tên hàng *</label>
                <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={invForm.name || ''} onChange={(e) => setInvForm({ ...invForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">ĐVT</label>
                  <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={invForm.unit || ''} onChange={(e) => setInvForm({ ...invForm, unit: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Giá bán</label>
                  <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right" value={formatNumber(invForm.costPrice || 0)} onChange={(e) => setInvForm({ ...invForm, costPrice: parseNumber(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">Tồn kho</label>
                  <input type="number" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={invForm.quantity ?? 0} onChange={(e) => setInvForm({ ...invForm, quantity: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Cảnh báo</label>
                  <input type="number" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={invForm.minThreshold ?? 0} onChange={(e) => setInvForm({ ...invForm, minThreshold: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">VAT %</label>
                  <input type="number" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={invForm.vatRate ?? 0} onChange={(e) => setInvForm({ ...invForm, vatRate: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">TK doanh thu</label>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={invForm.revenueAccount || '5111'}
                  onChange={(e) => setInvForm({ ...invForm, revenueAccount: e.target.value as HotelPmsRevenueAccount })}
                >
                  {(Object.entries(HOTEL_PMS_REVENUE_ACCOUNT_LABELS) as [HotelPmsRevenueAccount, string][]).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <button type="button" onClick={() => setInvForm(null)} className="rounded-lg border px-4 py-2 text-sm font-medium text-slate-600">Hủy</button>
              <button type="button" onClick={saveMinibar} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Lưu</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dịch vụ */}
      {svcForm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-bold text-slate-800">{svcForm.id ? 'Sửa dịch vụ' : 'Thêm dịch vụ'}</h3>
              <button type="button" onClick={() => setSvcForm(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div>
                <label className="text-xs font-medium text-slate-500">Tên dịch vụ *</label>
                <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={svcForm.name || ''} onChange={(e) => setSvcForm({ ...svcForm, name: e.target.value })} placeholder="vd: Giặt ủi (kg)" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">Loại</label>
                  <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={svcForm.category || 'OTHER'} onChange={(e) => setSvcForm({ ...svcForm, category: e.target.value as ServiceItem['category'] })}>
                    {SERVICE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{categoryLabel[c]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Giá</label>
                  <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right" value={formatNumber(svcForm.price || 0)} onChange={(e) => setSvcForm({ ...svcForm, price: parseNumber(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">TK doanh thu</label>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={svcForm.revenueAccount || '5113'}
                  onChange={(e) => setSvcForm({ ...svcForm, revenueAccount: e.target.value as HotelPmsRevenueAccount })}
                >
                  {(Object.entries(HOTEL_PMS_REVENUE_ACCOUNT_LABELS) as [HotelPmsRevenueAccount, string][]).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <button type="button" onClick={() => setSvcForm(null)} className="rounded-lg border px-4 py-2 text-sm font-medium text-slate-600">Hủy</button>
              <button type="button" onClick={saveService} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
