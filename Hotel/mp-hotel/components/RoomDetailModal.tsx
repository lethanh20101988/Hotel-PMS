
import React, { useState, useEffect } from 'react';
import { Room, Booking, ServiceItem, BookingService, InventoryItem } from '../types';
import { MOCK_SERVICES } from '../constants';
import { formatCurrency, formatDate, calculateRoomCharge, formatNumber, parseNumber } from '../utils';
import { X, Plus, Trash2, ShoppingBag, LogOut, Clock, Receipt, Percent, CheckCircle2 } from 'lucide-react';

interface RoomDetailModalProps {
  room: Room;
  booking: Booking | undefined;
  inventory: InventoryItem[];
  isOpen: boolean;
  onClose: () => void;
  onAddService: (service: BookingService) => void;
  onCheckout: (checkoutTime: string, roomVatRate: number) => void;
}

export const RoomDetailModal: React.FC<RoomDetailModalProps> = ({ 
  room, booking, inventory, isOpen, onClose, onAddService, onCheckout 
}) => {
  // Combine Inventory Items (Minibar) with Static Services (Laundry, etc.)
  const inventoryAsServices: ServiceItem[] = inventory.map(item => ({
    id: item.id,
    name: item.name,
    price: item.costPrice, // Use costPrice as reference base, can be overridden
    category: 'MINIBAR',
    inventoryId: item.id
  }));

  const availableServices = [...inventoryAsServices, ...MOCK_SERVICES.filter(s => s.category !== 'MINIBAR')];

  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [customPrice, setCustomPrice] = useState(0); 
  const [serviceVat, setServiceVat] = useState(0); 
  
  // Checkout States
  const [checkoutTime, setCheckoutTime] = useState('');
  const [roomVatRate, setRoomVatRate] = useState(0);

  // Determine if this is historical view (Completed) or Active
  const isCompleted = booking?.status === 'completed';

  // Initialize state
  useEffect(() => {
    if (isOpen && booking) {
      if (isCompleted) {
          // If completed, load stored data (if available) or fallback
          setCheckoutTime(booking.checkOutActual || booking.checkOutExpected);
          setRoomVatRate(booking.roomVatRate || 0);
      } else {
          // If active, default to NOW
          const now = new Date();
          const nowStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
          setCheckoutTime(nowStr);
          setRoomVatRate(0);
      }

      if (availableServices.length > 0) {
        setSelectedServiceId(availableServices[0].id);
        setCustomPrice(availableServices[0].price);
        setServiceVat(0);
      }
    }
  }, [isOpen, booking, isCompleted]); 

  const handleServiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newId = e.target.value;
      setSelectedServiceId(newId);
      const service = availableServices.find(s => s.id === newId);
      if (service) {
          setCustomPrice(service.price);
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
        timestamp: new Date().toISOString()
      });
      setQuantity(1);
    }
  };

  const handleCheckout = () => {
      onCheckout(checkoutTime, roomVatRate);
  };

  const getRoomStockLabel = (service: ServiceItem) => {
      if(!service.inventoryId) return '';
      const qty = room.inventory[service.inventoryId] || 0;
      return `(Còn: ${qty})`;
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      {/* Reduced max-w from 6xl to 5xl, reduced max-h to 90vh */}
      <div className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[90vh]">
        
        {/* Left Side: Services Management */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="bg-slate-800 text-white p-4 flex justify-between items-center md:hidden">
             <span className="font-bold">Phòng {room.number}</span>
             <button onClick={onClose}><X/></button>
          </div>
          
          <div className="p-5 overflow-y-auto">
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

                    <div className="flex gap-2 items-end">
                        <div className="w-14">
                            <label className="block text-[10px] text-gray-500 font-bold uppercase mb-0.5">SL</label>
                            <input 
                                type="text" 
                                value={formatNumber(quantity)} 
                                onChange={(e) => {
                                    const val = parseNumber(e.target.value);
                                    if (!isNaN(val)) setQuantity(val);
                                }}
                                className="w-full border-gray-300 rounded-md border p-2 text-sm text-center outline-none focus:border-indigo-500"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="block text-[10px] text-gray-500 font-bold uppercase mb-0.5">Đơn giá bán</label>
                            <input 
                                type="text"
                                value={formatNumber(customPrice)} 
                                onChange={(e) => {
                                    const val = parseNumber(e.target.value);
                                    if (!isNaN(val)) setCustomPrice(val);
                                }}
                                className="w-full border-gray-300 rounded-md border p-2 text-sm text-right font-medium text-slate-700 outline-none focus:border-indigo-500"
                            />
                        </div>
                        <div className="w-20">
                            <label className="block text-[10px] text-gray-500 font-bold uppercase mb-0.5">VAT</label>
                            <select 
                                className="w-full border-gray-300 rounded-md border p-2 text-sm bg-white outline-none focus:border-indigo-500"
                                value={serviceVat}
                                onChange={(e) => setServiceVat(Number(e.target.value))}
                            >
                                <option value={0}>0%</option>
                                <option value={5}>5%</option>
                                <option value={8}>8%</option>
                                <option value={10}>10%</option>
                            </select>
                        </div>
                        <div className="flex-none">
                            <button 
                                onClick={handleAddService}
                                className="bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center justify-center h-[38px] w-[38px] mt-auto transition-colors"
                            >
                                <Plus size={20} />
                            </button>
                        </div>
                    </div>
                </div>
                </div>
            )}

            {/* Used Services List */}
            <div>
                <h3 className="font-bold text-gray-700 mb-2 text-xs uppercase tracking-wider">Dịch vụ đã dùng</h3>
                <div className="space-y-2">
                    {booking.services.length === 0 && <p className="text-gray-400 text-xs italic py-4 text-center border border-dashed border-gray-200 rounded">Chưa sử dụng dịch vụ nào.</p>}
                    {booking.services.map((s, idx) => {
                        const lineTotal = s.price * s.quantity;
                        const lineVat = lineTotal * ((s.vatRate || 0)/100);
                        return (
                            <div key={idx} className="flex justify-between items-center text-sm bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm hover:border-indigo-300 transition-colors">
                                <div>
                                    <div className="font-bold text-slate-800 text-sm">{s.name}</div>
                                    <div className="text-gray-500 text-xs mt-0.5 flex gap-2">
                                        <span>SL: {s.quantity}</span>
                                        <span>x {formatCurrency(s.price)}</span>
                                        <span className="text-indigo-600 font-medium bg-indigo-50 px-1 rounded">VAT {s.vatRate}%</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="font-medium text-slate-700">{formatCurrency(lineTotal + lineVat)}</div>
                                    <div className="text-[10px] text-gray-400">
                                        (Thuế: {formatCurrency(lineVat)})
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
          </div>
        </div>

        {/* Right Side: Detailed Bill & Actions - Reduced width from 480px to 380px */}
        <div className="w-full md:w-[380px] bg-slate-50 flex flex-col h-full border-l border-gray-200">
           <div className="hidden md:flex justify-end p-3 pb-0">
             <button onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 p-1 rounded-full"><X size={20}/></button>
           </div>
           
           <div className="flex-1 p-5 flex flex-col overflow-y-auto">
             <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Receipt className="text-indigo-600" size={20}/> 
                {isCompleted ? 'Lịch sử thanh toán' : 'Chi tiết thanh toán'}
             </h3>
             
             {/* Checkout Time Selector (Only if Active) */}
             {!isCompleted ? (
                 <div className="mb-4 bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                     <label className="block text-xs font-bold text-gray-500 mb-1 flex items-center gap-1">
                         <Clock size={12}/> Thời gian Trả phòng
                     </label>
                     <input 
                        type="datetime-local"
                        className="w-full border-gray-300 rounded border p-1.5 text-xs font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={checkoutTime}
                        onChange={(e) => setCheckoutTime(e.target.value)}
                     />
                 </div>
             ) : (
                 <div className="mb-4 bg-gray-100 p-3 rounded-lg border border-gray-200">
                     <label className="block text-xs font-bold text-gray-500 mb-1">Thời gian đã trả phòng</label>
                     <div className="text-sm font-bold text-slate-800">{formatDate(checkoutTime)}</div>
                 </div>
             )}

             {/* INVOICE TABLE */}
             <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden text-sm mb-4">
                 {/* 1. ROOM CHARGE */}
                 <div className="p-3 border-b border-gray-100">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-gray-600 font-bold text-xs uppercase">Tiền phòng (Trước thuế)</span>
                        <span className="font-bold text-slate-900">{formatCurrency(roomChargePreTax)}</span>
                    </div>
                    
                    <div className="flex justify-between items-center bg-gray-50 p-2 rounded">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-medium">VAT Phòng</span>
                            {!isCompleted ? (
                                <div className="flex bg-white rounded border border-gray-200">
                                    {[0, 5, 8, 10].map(r => (
                                        <button 
                                            key={r}
                                            onClick={() => setRoomVatRate(r)}
                                            className={`px-1.5 py-0.5 text-[10px] font-bold ${roomVatRate === r ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'} first:rounded-l last:rounded-r border-r last:border-r-0 border-gray-200`}
                                        >
                                            {r}%
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{roomVatRate}%</span>
                            )}
                        </div>
                        <span className="font-medium text-indigo-600">{formatCurrency(roomVatAmount)}</span>
                    </div>
                 </div>

                 {/* 2. SERVICES CHARGE */}
                 <div className="p-3 border-b border-gray-100">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-gray-600 font-bold text-xs uppercase">Dịch vụ (Trước thuế)</span>
                        <span className="font-medium text-slate-900">{formatCurrency(servicesPreTax)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-gray-500">
                        <span>Tổng VAT Dịch vụ</span>
                        <span className="font-medium text-indigo-600">{formatCurrency(servicesVatAmount)}</span>
                    </div>
                 </div>

                 {/* 3. SUB TOTALS */}
                 <div className="p-3 bg-gray-50 space-y-1.5">
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

             {/* GRAND TOTAL */}
             <div className="bg-slate-900 text-white p-4 rounded-xl shadow-lg mt-auto">
                 <div className="flex justify-between items-center mb-1 text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                     Tổng thanh toán
                 </div>
                 <div className="flex justify-between items-end">
                     <div className="text-2xl font-bold">{formatCurrency(Math.max(0, grandTotal - booking.deposit))}</div>
                     {isCompleted && <div className="text-emerald-400 flex items-center gap-1 text-xs font-bold"><CheckCircle2 size={14}/> Đã thanh toán</div>}
                 </div>
             </div>

             {/* CHECKOUT BUTTON */}
             {!isCompleted && (
                 <button 
                    onClick={handleCheckout}
                    className="w-full mt-4 py-3 px-4 bg-rose-600 text-white rounded-xl font-bold shadow-md hover:bg-rose-700 flex justify-center items-center gap-2 transition-transform active:scale-95 text-sm"
                 >
                    <LogOut size={18} />
                    Xác nhận & Hoàn tất
                 </button>
             )}
           </div>
        </div>

      </div>
    </div>
  );
};
