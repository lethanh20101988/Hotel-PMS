
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Room, Booking, ServiceItem, BookingService, InventoryItem, HotelPmsRevenueAccount } from '../types';
import { formatCurrency, formatDate, calculateRoomCharge, formatNumber, parseNumber } from '../utils';
import {
  defaultRevenueAccountForServiceItem,
  resolveBookingServiceRevenueAccount,
  sumServicesByRevenueAccount,
} from '../hotelPmsAccounting';
import { X, Plus, Trash2, ShoppingBag, LogOut, Clock, Receipt, CheckCircle2, Pencil, BedDouble, Save, Wallet } from 'lucide-react';
import type { BankAccount } from '@shared/types';

export type CheckoutPaymentMethod = 'CASH' | 'TRANSFER' | 'DEBT';

export type CheckoutPaymentOptions = {
  paymentMethod: CheckoutPaymentMethod;
  bankAccountId?: string;
  bankLedgerAccountCode?: string;
};

interface RoomDetailModalProps {
  room: Room;
  booking: Booking | undefined;
  inventory: InventoryItem[];
  services: ServiceItem[];
  bankAccounts: BankAccount[];
  isOpen: boolean;
  onClose: () => void;
  onAddService: (service: BookingService) => void;
  onEditService: (index: number, service: BookingService) => void;
  onDeleteService: (index: number) => void;
  onCheckout: (checkoutTime: string, roomVatRate: number, payment: CheckoutPaymentOptions) => void;
}

export const RoomDetailModal: React.FC<RoomDetailModalProps> = ({
  room, booking, inventory, services, bankAccounts = [], isOpen, onClose, onAddService, onEditService, onDeleteService, onCheckout,
}) => {
  // Combine Inventory Items (Minibar) with Static Services (Laundry, etc.)
  const inventoryAsServices = useMemo(
    () =>
      inventory.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.costPrice,
        category: 'MINIBAR' as const,
        inventoryId: item.id,
        revenueAccount: item.revenueAccount || '5111',
      })),
    [inventory],
  );

  const inventoryIdSet = useMemo(() => new Set(inventory.map((i) => i.id)), [inventory]);

  const availableServices = useMemo(
    () => [...inventoryAsServices, ...services.filter((s) => s.category !== 'MINIBAR')],
    [inventoryAsServices, services],
  );

  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [customPrice, setCustomPrice] = useState(0);
  const [serviceVat, setServiceVat] = useState(0);
  const [serviceRevenueAccount, setServiceRevenueAccount] = useState<HotelPmsRevenueAccount>('5113');

  const [editingServiceIndex, setEditingServiceIndex] = useState<number | null>(null);
  const [editQuantity, setEditQuantity] = useState(1);
  const [editPrice, setEditPrice] = useState(0);
  const [editVat, setEditVat] = useState(0);
  const [editRevenueAccount, setEditRevenueAccount] = useState<HotelPmsRevenueAccount>('5113');

  const [checkoutTime, setCheckoutTime] = useState('');
  const [roomVatRate, setRoomVatRate] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>('CASH');
  const [bankAccountId, setBankAccountId] = useState('');

  const activeBankAccounts = useMemo(
    () => bankAccounts.filter((b) => b.status === 'ACTIVE'),
    [bankAccounts],
  );

  const selectedBank = useMemo(
    () => activeBankAccounts.find((b) => b.id === bankAccountId) || null,
    [activeBankAccounts, bankAccountId],
  );

  // Determine if this is historical view (Completed) or Active
  const isCompleted = booking?.status === 'completed';

  /** Chỉ khởi tạo form khi mở modal / đổi booking — không reset khi cập nhật services. */
  const modalInitKeyRef = useRef<string | null>(null);

  const bookingId = booking?.id;

  useEffect(() => {
    if (!isOpen) {
      modalInitKeyRef.current = null;
      return;
    }
    if (!booking) return;

    const initKey = `${booking.id}:${isCompleted ? 'done' : 'active'}`;
    if (modalInitKeyRef.current === initKey) return;
    modalInitKeyRef.current = initKey;

    if (isCompleted) {
      setCheckoutTime(booking.checkOutActual || booking.checkOutExpected);
      setRoomVatRate(booking.roomVatRate || 0);
      setPaymentMethod(
        booking.paymentMethod === 'DEBT'
          ? 'DEBT'
          : booking.paymentMethod === 'TRANSFER' || booking.paymentMethod === 'CARD'
            ? 'TRANSFER'
            : 'CASH',
      );
      setBankAccountId(booking.bankAccountId || '');
    } else {
      const now = new Date();
      const nowStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setCheckoutTime(nowStr);
      setRoomVatRate(0);
      setPaymentMethod(
        booking.paymentMethod === 'DEBT'
          ? 'DEBT'
          : booking.paymentMethod === 'TRANSFER' || booking.paymentMethod === 'CARD'
            ? 'TRANSFER'
            : 'CASH',
      );
      const defaultBankId =
        booking.bankAccountId || activeBankAccounts.find((b) => b.status === 'ACTIVE')?.id || '';
      setBankAccountId(defaultBankId);
    }

    setEditingServiceIndex(null);

    if (availableServices.length > 0) {
      const first = availableServices[0];
      setSelectedServiceId(first.id);
      setCustomPrice(first.price);
      setServiceVat(0);
      setServiceRevenueAccount(defaultRevenueAccountForServiceItem(first));
      setQuantity(1);
    } else {
      setSelectedServiceId('');
      setCustomPrice(0);
      setServiceVat(0);
      setServiceRevenueAccount('5113');
      setQuantity(1);
    }
  }, [isOpen, bookingId, isCompleted, booking, availableServices, activeBankAccounts]);

  useEffect(() => {
    if (paymentMethod === 'TRANSFER' && !bankAccountId && activeBankAccounts.length > 0) {
      setBankAccountId(activeBankAccounts[0].id);
    }
  }, [paymentMethod, bankAccountId, activeBankAccounts]);

  const handleServiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newId = e.target.value;
      setSelectedServiceId(newId);
      const service = availableServices.find(s => s.id === newId);
      if (service) {
          setCustomPrice(service.price);
          setServiceRevenueAccount(defaultRevenueAccountForServiceItem(service));
          const invItem = service.inventoryId ? inventory.find((i) => i.id === service.inventoryId) : null;
          if (invItem?.vatRate != null) setServiceVat(invItem.vatRate);
      }
  };

  if (!isOpen || !booking) return null;

  // --- CALCULATION LOGIC ---
  
  let roomChargePreTax = 0;
  let roomVatAmount = 0;
  let servicesPreTax = 0;
  let servicesVatAmount = 0;
  let grandTotal = 0;

  if (isCompleted) {
      // USE STORED HISTORICAL DATA
      roomChargePreTax = booking.totalRoomCharge;
      roomVatAmount = booking.roomVatAmount || 0;
      servicesPreTax = booking.totalServiceCharge;
      servicesVatAmount = booking.totalServiceVatAmount || 0;
      grandTotal = booking.finalTotal;
  } else {
      // CALCULATE DYNAMICALLY
      roomChargePreTax = calculateRoomCharge(
        booking.checkIn, 
        checkoutTime || new Date().toISOString(), 
        booking.bookingType as any, 
        { hourly: room.priceHourly, daily: room.priceDaily, overnight: room.priceOvernight }
      );
      roomVatAmount = roomChargePreTax * (roomVatRate / 100);
      
      servicesPreTax = booking.services.reduce((acc, s) => acc + (s.price * s.quantity), 0);
      servicesVatAmount = booking.services.reduce((acc, s) => {
          const rate = s.vatRate || 0;
          return acc + (s.price * s.quantity * (rate / 100));
      }, 0);
      
      grandTotal = roomChargePreTax + roomVatAmount + servicesPreTax + servicesVatAmount;
  }

  const serviceRevenueBuckets = sumServicesByRevenueAccount(booking.services, inventoryIdSet);
  const goodsRevenuePreTax = serviceRevenueBuckets['5111'].preTax;
  const goodsRevenueVat = serviceRevenueBuckets['5111'].vat;
  const svcRevenuePreTax = serviceRevenueBuckets['5113'].preTax;
  const svcRevenueVat = serviceRevenueBuckets['5113'].vat;

  const handleAddService = () => {
    if(isCompleted) return; // Prevent editing history
    const serviceRef = availableServices.find(s => s.id === selectedServiceId);
    if (serviceRef) {
      if(serviceRef.inventoryId) {
          const inRoomQty = room.inventory[serviceRef.inventoryId] || 0;
          if (quantity > inRoomQty) {
              alert(`Phòng này chỉ còn ${inRoomQty} ${serviceRef.name} trong Minibar.`);
              return;
          }
      }

      onAddService({
        serviceId: serviceRef.id,
        name: serviceRef.name,
        price: customPrice, 
        quantity: quantity,
        vatRate: serviceVat,
        revenueAccount: serviceRevenueAccount,
        timestamp: new Date().toISOString()
      });
      setQuantity(1);
    }
  };

  const handleCheckout = () => {
    if (paymentMethod === 'TRANSFER' && activeBankAccounts.length > 0 && !bankAccountId) {
      alert('Vui lòng chọn tài khoản ngân hàng (Quỹ & Ngân hàng).');
      return;
    }
    onCheckout(checkoutTime, roomVatRate, {
      paymentMethod,
      bankAccountId: paymentMethod === 'TRANSFER' ? bankAccountId : undefined,
      bankLedgerAccountCode: paymentMethod === 'TRANSFER' ? selectedBank?.linkedAccountCode : undefined,
    });
  };

  const completedBank = booking?.bankAccountId
    ? bankAccounts.find((b) => b.id === booking.bankAccountId) || null
    : null;

  const paymentLabel =
    paymentMethod === 'DEBT'
      ? 'Công nợ'
      : paymentMethod === 'TRANSFER'
        ? completedBank
          ? completedBank.bankName
          : 'Chuyển khoản'
        : 'Tiền mặt';

  const startEditService = (idx: number, s: BookingService) => {
    setEditingServiceIndex(idx);
    setEditQuantity(s.quantity);
    setEditPrice(s.price);
    setEditVat(s.vatRate || 0);
    setEditRevenueAccount(resolveBookingServiceRevenueAccount(s, inventoryIdSet));
  };

  const cancelEditService = () => {
    setEditingServiceIndex(null);
  };

  const saveEditService = (idx: number, original: BookingService) => {
    if (editQuantity <= 0) {
      alert('Số lượng phải lớn hơn 0.');
      return;
    }
    if (editPrice < 0) {
      alert('Đơn giá không hợp lệ.');
      return;
    }
    onEditService(idx, {
      ...original,
      quantity: editQuantity,
      price: editPrice,
      vatRate: editVat,
      revenueAccount: editRevenueAccount,
    });
    setEditingServiceIndex(null);
  };

  const handleDeleteService = (idx: number, name: string) => {
    if (!window.confirm(`Xóa dịch vụ "${name}" khỏi hóa đơn?`)) return;
    if (editingServiceIndex === idx) setEditingServiceIndex(null);
    onDeleteService(idx);
  };

  const getRoomStockLabel = (service: ServiceItem) => {
      if(!service.inventoryId) return '';
      const qty = room.inventory[service.inventoryId] || 0;
      return `(Còn: ${qty})`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4 animate-in fade-in duration-200">
      <div className="flex h-[min(94vh,880px)] w-full max-w-5xl min-h-0 flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <span className="font-bold text-slate-800">Phòng {room.number}</span>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-500 hover:bg-slate-100" aria-label="Đóng">
            <X size={20} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left Side: Services Management */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:max-h-none max-h-[42vh] md:max-h-full">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
            <div className="mb-5">
               <div className="flex justify-between items-start">
                   <div>
                       <h2 className="text-xl font-bold text-slate-800 mb-1">
                           Phòng {room.number} <span className="text-base font-normal text-slate-500">({room.type})</span>
                       </h2>
                       <div className="text-sm text-slate-500">Khách: <span className="font-medium text-slate-900">{booking.customer.name}</span></div>
                   </div>
                   {isCompleted && (
                       <div className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-bold border border-gray-200">
                           LỊCH SỬ GIAO DỊCH
                       </div>
                   )}
               </div>
               
               <div className="grid grid-cols-2 gap-4 mt-3 text-sm bg-gray-50 p-3 rounded-lg border border-gray-100">
                   <div>
                       <p className="text-gray-500 text-xs">Check-in:</p>
                       <p className="font-medium">{formatDate(booking.checkIn)}</p>
                   </div>
                   <div>
                       <p className="text-gray-500 text-xs">{isCompleted ? 'Đã Check-out:' : 'Check-out (Dự kiến):'}</p>
                       <p className="font-medium">{formatDate(isCompleted ? booking.checkOutActual! : booking.checkOutExpected)}</p>
                   </div>
               </div>
            </div>

            {/* Service Adding Section - HIDDEN IF COMPLETED */}
            {!isCompleted && (
                <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 mb-5">
                <h3 className="font-semibold text-indigo-800 mb-2 flex items-center gap-2 text-sm">
                    <ShoppingBag size={16} /> Thêm dịch vụ / Minibar
                </h3>
                {availableServices.length === 0 ? (
                  <p className="text-xs text-indigo-700/80 leading-relaxed">
                    Chưa có danh mục. Cấu hình tại sidebar <b>Hotel PMS → Dịch vụ & Minibar</b>.
                  </p>
                ) : (
                <div className="flex flex-col gap-2">
                    <select 
                        className="w-full border-indigo-200 rounded-md border p-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={selectedServiceId}
                        onChange={handleServiceChange}
                    >
                        {availableServices.map(s => (
                        <option key={s.id} value={s.id}>
                            {s.name} {getRoomStockLabel(s)}
                        </option>
                        ))}
                    </select>

                    <div className="grid grid-cols-[minmax(52px,0.38fr)_minmax(0,1fr)_minmax(60px,0.42fr)_minmax(76px,0.55fr)_36px] gap-x-2 gap-y-1 items-center">
                        <label className="text-[10px] text-gray-500 font-bold uppercase leading-none">SL</label>
                        <label className="text-[10px] text-gray-500 font-bold uppercase leading-none truncate">Đơn giá bán</label>
                        <label className="text-[10px] text-gray-500 font-bold uppercase leading-none">VAT</label>
                        <label className="text-[10px] text-gray-500 font-bold uppercase leading-none truncate">TK doanh thu</label>
                        <span className="block" aria-hidden />
                        <input
                            type="text"
                            value={formatNumber(quantity)}
                            onChange={(e) => {
                                const val = parseNumber(e.target.value);
                                if (!isNaN(val)) setQuantity(val);
                            }}
                            className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm text-center font-medium text-slate-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                        />
                        <input
                            type="text"
                            value={formatNumber(customPrice)}
                            onChange={(e) => {
                                const val = parseNumber(e.target.value);
                                if (!isNaN(val)) setCustomPrice(val);
                            }}
                            className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm text-right font-medium text-slate-700 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                        />
                        <select
                            className="h-9 w-full rounded-md border border-gray-300 px-1.5 text-sm bg-white text-slate-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                            value={serviceVat}
                            onChange={(e) => setServiceVat(Number(e.target.value))}
                        >
                            <option value={0}>0%</option>
                            <option value={5}>5%</option>
                            <option value={8}>8%</option>
                            <option value={10}>10%</option>
                        </select>
                        <select
                            className="h-9 w-full rounded-md border border-gray-300 px-1 text-[11px] bg-white text-slate-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                            value={serviceRevenueAccount}
                            onChange={(e) => setServiceRevenueAccount(e.target.value as HotelPmsRevenueAccount)}
                        >
                            <option value="5111">5111 HH</option>
                            <option value="5113">5113 DV</option>
                        </select>
                        <button
                            type="button"
                            onClick={handleAddService}
                            className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-600 text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                            title="Thêm dịch vụ"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                </div>
                )}
                </div>
            )}

            {/* Used Services List — tách biệt với tiền phòng */}
            <div className="mt-2 pt-4 border-t-2 border-dashed border-indigo-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-indigo-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <ShoppingBag size={14} />
                    Dịch vụ đã dùng
                  </h3>
                  {!isCompleted && booking.services.length > 0 && (
                    <span className="text-[10px] text-indigo-500 font-medium">{booking.services.length} mục</span>
                  )}
                </div>
                <div className="space-y-2">
                    {booking.services.length === 0 && (
                      <p className="text-gray-400 text-xs italic py-4 text-center border border-dashed border-indigo-200 rounded-lg bg-indigo-50/30">
                        Chưa sử dụng dịch vụ nào.
                      </p>
                    )}
                    {booking.services.map((s, idx) => {
                        const lineTotal = s.price * s.quantity;
                        const lineVat = lineTotal * ((s.vatRate || 0) / 100);
                        const isEditing = editingServiceIndex === idx;

                        if (isEditing && !isCompleted) {
                          return (
                            <div key={idx} className="bg-indigo-50 p-2.5 rounded-lg border border-indigo-200 space-y-2">
                              <div className="font-bold text-slate-800 text-sm truncate">{s.name}</div>
                              <div className="grid grid-cols-[minmax(48px,0.35fr)_minmax(0,1fr)_minmax(56px,0.4fr)_minmax(72px,0.5fr)_auto_auto] gap-1.5 items-end">
                                <div>
                                  <label className="text-[9px] text-gray-500 font-bold uppercase">SL</label>
                                  <input
                                    type="text"
                                    value={formatNumber(editQuantity)}
                                    onChange={(e) => {
                                      const val = parseNumber(e.target.value);
                                      if (!isNaN(val)) setEditQuantity(val);
                                    }}
                                    className="w-full h-8 border border-indigo-200 rounded p-1.5 text-xs text-center"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-gray-500 font-bold uppercase">Giá</label>
                                  <input
                                    type="text"
                                    value={formatNumber(editPrice)}
                                    onChange={(e) => {
                                      const val = parseNumber(e.target.value);
                                      if (!isNaN(val)) setEditPrice(val);
                                    }}
                                    className="w-full h-8 border border-indigo-200 rounded p-1.5 text-xs text-right"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-gray-500 font-bold uppercase">VAT</label>
                                  <select
                                    className="w-full h-8 border border-indigo-200 rounded px-1 text-xs bg-white"
                                    value={editVat}
                                    onChange={(e) => setEditVat(Number(e.target.value))}
                                  >
                                    <option value={0}>0%</option>
                                    <option value={5}>5%</option>
                                    <option value={8}>8%</option>
                                    <option value={10}>10%</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[9px] text-gray-500 font-bold uppercase">TK DT</label>
                                  <select
                                    className="w-full h-8 border border-indigo-200 rounded px-1 text-[10px] bg-white"
                                    value={editRevenueAccount}
                                    onChange={(e) => setEditRevenueAccount(e.target.value as HotelPmsRevenueAccount)}
                                  >
                                    <option value="5111">5111</option>
                                    <option value="5113">5113</option>
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => saveEditService(idx, s)}
                                  className="p-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
                                  title="Lưu"
                                >
                                  <Save size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditService}
                                  className="p-1.5 rounded-md bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
                                  title="Hủy"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        }

                        return (
                            <div key={idx} className="flex items-center gap-2 text-sm bg-white p-2 rounded-lg border border-indigo-100 shadow-sm hover:border-indigo-300 transition-colors">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <div className="font-bold text-slate-800 text-sm truncate">{s.name}</div>
                                      <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold bg-slate-100 text-slate-600">
                                        {resolveBookingServiceRevenueAccount(s, inventoryIdSet)}
                                      </span>
                                    </div>
                                    <div className="text-gray-500 text-xs mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                                        <span>SL: {s.quantity}</span>
                                        <span>× {formatCurrency(s.price)}</span>
                                        <span className="text-indigo-600 font-medium bg-indigo-50 px-1 rounded">VAT {s.vatRate || 0}%</span>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="font-semibold text-slate-700 text-sm">{formatCurrency(lineTotal + lineVat)}</div>
                                    <div className="text-[10px] text-gray-400">Thuế: {formatCurrency(lineVat)}</div>
                                </div>
                                {!isCompleted && (
                                  <div className="flex flex-col gap-0.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => startEditService(idx, s)}
                                      className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                      title="Sửa dịch vụ"
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteService(idx, s.name)}
                                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                      title="Xóa dịch vụ"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
          </div>
        </div>

        {/* Right Side: Chi tiết thanh toán — footer cố định, nội dung cuộn */}
        <div className="flex min-h-0 w-full flex-1 flex-col border-t border-gray-200 bg-slate-50 md:w-[400px] md:flex-none md:shrink-0 md:border-l md:border-t-0">
           <div className="hidden shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 md:flex">
             <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
               <Receipt className="text-indigo-600" size={18} />
               {isCompleted ? 'Lịch sử thanh toán' : 'Chi tiết thanh toán'}
             </h3>
             <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600" aria-label="Đóng">
               <X size={20} />
             </button>
           </div>

           <div className="shrink-0 px-4 pt-3 md:hidden">
             <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
               <Receipt className="text-indigo-600" size={18} />
               {isCompleted ? 'Lịch sử thanh toán' : 'Chi tiết thanh toán'}
             </h3>
           </div>

           <div className="shrink-0 px-4 pb-2">
             {!isCompleted ? (
                 <div className="rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm space-y-2">
                   <div>
                     <label className="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-gray-500">
                       <Clock size={10} /> Trả phòng
                     </label>
                     <input
                       type="datetime-local"
                       className="w-full rounded border border-gray-300 px-2 py-1.5 text-[11px] font-medium text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                       value={checkoutTime}
                       onChange={(e) => setCheckoutTime(e.target.value)}
                     />
                   </div>
                   <div>
                     <label className="mb-1 flex items-center gap-1 text-[10px] font-bold text-gray-500">
                       <Wallet size={10} /> Thanh toán
                     </label>
                     <div className="flex gap-1">
                       {(
                         [
                           { id: 'CASH' as const, label: 'Tiền mặt' },
                           { id: 'TRANSFER' as const, label: 'Ngân hàng' },
                           { id: 'DEBT' as const, label: 'Công nợ' },
                         ] as const
                       ).map((opt) => (
                         <button
                           key={opt.id}
                           type="button"
                           onClick={() => setPaymentMethod(opt.id)}
                           className={`min-w-0 flex-1 rounded-md border px-1 py-1 text-center text-[10px] font-semibold leading-tight transition-colors ${
                             paymentMethod === opt.id
                               ? 'border-indigo-600 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-500'
                               : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                           }`}
                         >
                           {opt.label}
                         </button>
                       ))}
                     </div>
                     {paymentMethod === 'TRANSFER' && (
                       <select
                         className="mt-1.5 w-full h-7 rounded border border-gray-300 bg-white px-2 text-[11px] text-slate-700 outline-none focus:ring-1 focus:ring-indigo-500"
                         value={bankAccountId}
                         onChange={(e) => setBankAccountId(e.target.value)}
                       >
                         {activeBankAccounts.length === 0 ? (
                           <option value="">Chưa có TK ngân hàng — thêm tại Quỹ & Ngân hàng</option>
                         ) : (
                           activeBankAccounts.map((bank) => (
                             <option key={bank.id} value={bank.id}>
                               {bank.bankName} · {bank.accountNumber} ({bank.linkedAccountCode})
                             </option>
                           ))
                         )}
                       </select>
                     )}
                   </div>
                 </div>
             ) : (
                 <div className="space-y-2">
                 <div className="rounded-lg border border-gray-200 bg-gray-100 px-2.5 py-2">
                     <label className="mb-0.5 block text-[10px] font-bold text-gray-500">Thời gian đã trả phòng</label>
                     <div className="text-xs font-bold text-slate-800">{formatDate(checkoutTime)}</div>
                 </div>
                 <div className="rounded-lg border border-gray-200 bg-gray-100 px-2.5 py-2">
                     <label className="mb-0.5 block text-[10px] font-bold text-gray-500">Hình thức thanh toán</label>
                     <div className="text-xs font-bold text-slate-800">{paymentLabel}</div>
                     {completedBank && (
                       <div className="mt-0.5 text-[10px] text-gray-500">
                         {completedBank.accountNumber} · TK {completedBank.linkedAccountCode}
                       </div>
                     )}
                 </div>
                 </div>
             )}
           </div>

           <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2">
             <div className="space-y-3 text-sm">
                 {/* Khối 1: TIỀN PHÒNG */}
                 <div className="bg-white rounded-lg border-2 border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex items-center gap-2">
                      <BedDouble size={14} className="text-slate-600" />
                      <span className="text-xs font-black uppercase tracking-wide text-slate-700">Tiền phòng</span>
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600 text-xs">Trước thuế</span>
                        <span className="font-bold text-slate-900">{formatCurrency(roomChargePreTax)}</span>
                      </div>
                      <div className="flex justify-between items-center bg-slate-50 p-2 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 font-medium">VAT</span>
                          {!isCompleted ? (
                            <div className="flex bg-white rounded border border-gray-200">
                              {[0, 5, 8, 10].map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => setRoomVatRate(r)}
                                  className={`px-1.5 py-0.5 text-[10px] font-bold ${roomVatRate === r ? 'bg-slate-700 text-white' : 'text-gray-500 hover:bg-gray-100'} first:rounded-l last:rounded-r border-r last:border-r-0 border-gray-200`}
                                >
                                  {r}%
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs font-bold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">{roomVatRate}%</span>
                          )}
                        </div>
                        <span className="font-medium text-slate-700">{formatCurrency(roomVatAmount)}</span>
                      </div>
                      <div className="flex justify-between items-center pt-1 border-t border-dashed border-slate-200">
                        <span className="text-xs font-bold text-slate-600">Cộng tiền phòng</span>
                        <span className="font-bold text-slate-900">{formatCurrency(roomChargePreTax + roomVatAmount)}</span>
                      </div>
                    </div>
                 </div>

                 {/* Khối 2: DỊCH VỤ */}
                 <div className="bg-white rounded-lg border-2 border-indigo-200 shadow-sm overflow-hidden">
                    <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center gap-2">
                      <ShoppingBag size={14} className="text-indigo-600" />
                      <span className="text-xs font-black uppercase tracking-wide text-indigo-800">Dịch vụ & Minibar</span>
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600 text-xs">Trước thuế (tổng)</span>
                        <span className="font-bold text-slate-900">{formatCurrency(servicesPreTax)}</span>
                      </div>
                      {(goodsRevenuePreTax > 0 || goodsRevenueVat > 0) && (
                        <div className="rounded-md border border-amber-100 bg-amber-50/60 px-2 py-1.5 space-y-0.5 text-[11px]">
                          <div className="flex justify-between text-amber-900/80">
                            <span>5111 — Hàng hóa / Minibar</span>
                            <span className="font-semibold tabular-nums">{formatCurrency(goodsRevenuePreTax + goodsRevenueVat)}</span>
                          </div>
                          <div className="flex justify-between text-amber-800/70 text-[10px]">
                            <span>Trước thuế · VAT</span>
                            <span className="tabular-nums">{formatCurrency(goodsRevenuePreTax)} · {formatCurrency(goodsRevenueVat)}</span>
                          </div>
                        </div>
                      )}
                      {(svcRevenuePreTax > 0 || svcRevenueVat > 0) && (
                        <div className="rounded-md border border-indigo-100 bg-indigo-50/50 px-2 py-1.5 space-y-0.5 text-[11px]">
                          <div className="flex justify-between text-indigo-900/80">
                            <span>5113 — Dịch vụ</span>
                            <span className="font-semibold tabular-nums">{formatCurrency(svcRevenuePreTax + svcRevenueVat)}</span>
                          </div>
                          <div className="flex justify-between text-indigo-800/70 text-[10px]">
                            <span>Trước thuế · VAT</span>
                            <span className="tabular-nums">{formatCurrency(svcRevenuePreTax)} · {formatCurrency(svcRevenueVat)}</span>
                          </div>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-xs text-gray-500">
                        <span>Tổng VAT dịch vụ & Minibar</span>
                        <span className="font-medium text-indigo-600">{formatCurrency(servicesVatAmount)}</span>
                      </div>
                      <div className="flex justify-between items-center pt-1 border-t border-dashed border-indigo-200">
                        <span className="text-xs font-bold text-indigo-700">Cộng dịch vụ</span>
                        <span className="font-bold text-indigo-900">{formatCurrency(servicesPreTax + servicesVatAmount)}</span>
                      </div>
                    </div>
                 </div>

                 {/* Tổng hợp */}
                 <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-1.5">
                   <div className="flex justify-between text-gray-500 text-xs">
                     <span>Tổng trước thuế</span>
                     <span>{formatCurrency(roomChargePreTax + servicesPreTax)}</span>
                   </div>
                   <div className="flex justify-between text-indigo-600 text-xs">
                     <span>Tổng tiền thuế VAT</span>
                     <span>{formatCurrency(roomVatAmount + servicesVatAmount)}</span>
                   </div>
                   {booking.deposit > 0 && (
                     <div className="flex justify-between text-emerald-600 font-bold border-t border-dashed border-gray-300 pt-2 mt-2 text-xs">
                       <span>Đã đặt cọc</span>
                       <span>- {formatCurrency(booking.deposit)}</span>
                     </div>
                   )}
                 </div>
             </div>
           </div>

           <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)]">
             <div className="rounded-lg bg-slate-800 px-3 py-2.5 text-white shadow-sm">
                 <div className="flex items-center justify-between gap-2">
                   <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                     Tổng thanh toán
                   </span>
                   <span className="text-lg font-bold tabular-nums">
                     {formatCurrency(Math.max(0, grandTotal - booking.deposit))}
                   </span>
                 </div>
                 {isCompleted && (
                   <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] font-semibold text-emerald-400">
                     <CheckCircle2 size={11}/> Đã thanh toán
                   </div>
                 )}
             </div>

             {!isCompleted && (
                 <button
                    type="button"
                    onClick={handleCheckout}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-rose-700 active:scale-[0.98]"
                 >
                    <LogOut size={16} />
                    Xác nhận thanh toán & Check-out
                 </button>
             )}
           </div>
        </div>

        </div>
      </div>
    </div>
  );
};
