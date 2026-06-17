
import React, { useState } from 'react';
import { LayoutGrid, CalendarDays, BarChart3, Package, Settings, Search, Bell, Menu, Brush, DollarSign, History, Layers } from 'lucide-react';
import { BookingModal } from './components/BookingModal';
import { RoomDetailModal } from './components/RoomDetailModal';
import { Reports } from './components/Reports';
import { InventoryTable } from './components/InventoryTable';
import { ImportHistoryTable } from './components/ImportHistoryTable';
import { InventoryModal } from './components/InventoryModal';
import { HousekeepingGrid } from './components/HousekeepingGrid';
import { FrontDesk } from './components/FrontDesk';
import { RoomManageModal } from './components/RoomManageModal'; 
import { RateManagement } from './components/RateManagement'; 
import { MOCK_ROOMS, MOCK_ROOM_TYPES, MOCK_SERVICES } from './constants';
import { Room, RoomStatus, Booking, InventoryItem, BookingType, RoomTypeConfig, Expense, ImportLog } from './types';
import { calculateRoomCharge } from './utils';
import type { LucideIcon } from 'lucide-react';

type AppTab = 'frontdesk' | 'housekeeping' | 'reports' | 'inventory' | 'rates';

const NAV_ITEMS: { id: AppTab; label: string; icon: LucideIcon }[] = [
  { id: 'frontdesk', label: 'Lễ Tân', icon: LayoutGrid },
  { id: 'housekeeping', label: 'Buồng phòng', icon: Brush },
  { id: 'inventory', label: 'Kho hàng', icon: Package },
  { id: 'reports', label: 'Báo cáo', icon: BarChart3 },
  { id: 'rates', label: 'Cấu hình Giá', icon: DollarSign },
];

const navButtonClass = (isActive: boolean, compact = false) =>
  [
    compact
      ? 'flex flex-col items-center justify-center gap-0.5 py-2 px-0.5 rounded-lg text-[10px] sm:text-xs font-medium leading-tight text-center min-h-[3.25rem] transition-all'
      : 'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2',
    isActive
      ? 'bg-indigo-600 text-white shadow-md'
      : compact
        ? 'text-slate-300 active:bg-slate-700'
        : 'text-slate-300 hover:text-white hover:bg-slate-700',
  ].join(' ');

// Xóa dữ liệu mẫu, bắt đầu với danh sách rỗng
const INITIAL_BOOKINGS: Booking[] = [];

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('frontdesk');
  
  // Inventory View Mode: Stock vs Import History
  const [inventoryView, setInventoryView] = useState<'STOCK' | 'HISTORY'>('STOCK');

  // Khởi tạo phòng và đặt tất cả về trạng thái Sẵn sàng (Trống)
  const [rooms, setRooms] = useState<Room[]>(() => {
    return MOCK_ROOMS.map(room => ({
       ...room,
       status: RoomStatus.AVAILABLE, // Reset status to Available
       inventory: {} // Initialize empty inventory
    }));
  });

  // Khởi tạo Tồn kho (Biến động)
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  
  // Khởi tạo Lịch sử Nhập kho (Cố định)
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);

  const [bookings, setBookings] = useState<Booking[]>(INITIAL_BOOKINGS);
  const [roomTypes, setRoomTypes] = useState<RoomTypeConfig[]>(MOCK_ROOM_TYPES);
  
  // Khởi tạo chi phí rỗng
  const [expenses, setExpenses] = useState<Expense[]>([]);
  
  // Modal States
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null); // Specific booking to view
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  
  // Room Management States
  const [isRoomManageModalOpen, setIsRoomManageModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);

  // Inventory Modal States
  const [isInventoryModalOpen, setIsInventoryModalOpen] = useState(false);
  const [inventoryMode, setInventoryMode] = useState<'IN' | 'OUT' | 'EDIT'>('IN');
  const [editingInventoryItem, setEditingInventoryItem] = useState<InventoryItem | null>(null);

  // --- ACTIONS ---

  const updateRoomStatus = (roomId: string, status: RoomStatus) => {
    // Use functional update to ensure we are working with latest state
    setRooms(prevRooms => prevRooms.map(r => r.id === roomId ? { ...r, status } : r));
  };

  const handleNewBooking = () => {
    // Try to find a completely available room first, then a dirty one (that can be cleaned), but NOT occupied.
    const defaultRoom = rooms.find(r => r.status === RoomStatus.AVAILABLE) || 
                        rooms.find(r => r.status === RoomStatus.DIRTY);
    
    if (defaultRoom) {
        setSelectedRoom(defaultRoom);
        setIsBookingModalOpen(true);
    } else {
        alert("Hiện không còn phòng trống nào để đặt!");
    }
  };

  const createBooking = (bookingData: any) => {
    const targetRoomId = bookingData.roomId; 
    const bookingStatus = bookingData.status || 'active'; // 'active' or 'pending'

    const newBooking: Booking = {
      id: Date.now().toString(),
      roomId: targetRoomId,
      customer: bookingData.customer,
      checkIn: bookingData.checkIn,
      checkOutExpected: bookingData.checkOut,
      bookingType: bookingData.bookingType,
      status: bookingStatus,
      services: [],
      totalRoomCharge: bookingData.estimatedTotal,
      totalServiceCharge: 0,
      discount: 0,
      deposit: bookingData.deposit || 0, 
      paidAmount: bookingData.paidAmount || 0,
      finalTotal: bookingData.estimatedTotal
    };

    setBookings(prev => [newBooking, ...prev]);
    
    // Update room status based on booking status
    if (bookingStatus === 'active') {
        updateRoomStatus(targetRoomId, RoomStatus.OCCUPIED);
    } else {
        // For reservations (pending), mark as BOOKED
        updateRoomStatus(targetRoomId, RoomStatus.BOOKED);
    }

    setIsBookingModalOpen(false);
    setSelectedRoom(null);
  };

  const addServiceToBooking = (serviceItem: any) => {
    // Determine which booking ID to update
    // If selectedBooking exists (Front Desk view), use that ID
    // If selectedRoom exists (Grid view), find the active booking for that room
    let targetBookingId = selectedBooking?.id;
    
    if (!targetBookingId && selectedRoom) {
        const activeBooking = bookings.find(b => b.roomId === selectedRoom.id && b.status === 'active');
        targetBookingId = activeBooking?.id;
    }

    if (!targetBookingId) return;
    
    setBookings(prevBookings => {
        return prevBookings.map(b => {
            if (b.id === targetBookingId) {
                return { ...b, services: [...b.services, serviceItem] };
            }
            return b;
        });
    });
  };

  const checkoutRoom = (checkOutDate: string, roomVatRate: number) => {
    // Determine the active booking to checkout
    let activeBooking = selectedBooking;
    
    if (!activeBooking && selectedRoom) {
        activeBooking = bookings.find(b => b.roomId === selectedRoom.id && b.status === 'active') || null;
    }

    if (!activeBooking) return;
    const currentRoomId = activeBooking.roomId;

    // 1. Calculate Financials Snapshot
    const room = rooms.find(r => r.id === currentRoomId);
    if (!room) return;

    const roomChargePreTax = calculateRoomCharge(
        activeBooking.checkIn, 
        checkOutDate, 
        activeBooking.bookingType as any, 
        { hourly: room.priceHourly, daily: room.priceDaily, overnight: room.priceOvernight }
    );
    const roomVatAmount = roomChargePreTax * (roomVatRate / 100);

    const servicesPreTax = activeBooking.services.reduce((acc, s) => acc + (s.price * s.quantity), 0);
    const totalServiceVatAmount = activeBooking.services.reduce((acc, s) => {
          const rate = s.vatRate || 0;
          return acc + (s.price * s.quantity * (rate / 100));
    }, 0);

    const grandTotal = roomChargePreTax + roomVatAmount + servicesPreTax + totalServiceVatAmount;

    // 2. Deduct Inventory from Room (Minibar consumption)
    if (activeBooking.services.length > 0) {
        setRooms(prevRooms => {
            return prevRooms.map(r => {
                if (r.id === currentRoomId) {
                    const updatedInventory = { ...r.inventory };
                    activeBooking!.services.forEach(s => {
                        // If service is linked to inventory
                        // Note: In real app we might store inventoryId in service item
                        // Here we match by name or passed inventoryId if we had it.
                        // Assuming serviceId might be inventoryId for Minibar items
                        const invItem = inventory.find(i => i.id === s.serviceId || i.name === s.name);
                        if (invItem) {
                             // Deduct from room inventory
                             if (updatedInventory[invItem.id]) {
                                 updatedInventory[invItem.id] = Math.max(0, updatedInventory[invItem.id] - s.quantity);
                             }
                        }
                    });
                    return { ...r, inventory: updatedInventory };
                }
                return r;
            });
        });
    }

    // 3. Update Booking Status & Financial Snapshot
    setBookings(prev => prev.map(b => {
        if (b.id === activeBooking!.id) {
            return { 
                ...b, 
                status: 'completed', 
                checkOutActual: checkOutDate,
                // Save Snapshot
                totalRoomCharge: roomChargePreTax,
                roomVatRate: roomVatRate,
                roomVatAmount: roomVatAmount,
                totalServiceCharge: servicesPreTax,
                totalServiceVatAmount: totalServiceVatAmount,
                finalTotal: grandTotal,
                paidAmount: grandTotal // Assume paid full
            };
        }
        return b;
    }));

    // 4. Set Room Status to DIRTY
    updateRoomStatus(currentRoomId, RoomStatus.DIRTY);

    setIsDetailModalOpen(false);
    setSelectedRoom(null);
    setSelectedBooking(null);
  };

  // --- HANDLERS: EXPENSES ---
  const handleAddExpense = (expense: Expense) => {
      setExpenses(prev => [expense, ...prev]);
  };
  const handleEditExpense = (expense: Expense) => {
      setExpenses(prev => prev.map(e => e.id === expense.id ? expense : e));
  };
  const handleDeleteExpense = (id: string) => {
      setExpenses(prev => prev.filter(e => e.id !== id));
  };

  // --- HANDLERS: INVENTORY ---
  const handleInventorySubmit = (data: any) => {
      const { mode, isNew, name, quantity, unit, minThreshold, costPrice, supplier, invoiceRef, vatRate, preTaxTotal, totalAmount } = data;
      
      const now = new Date().toISOString();

      if (mode === 'IN') {
          // 1. Log to History
          const newLog: ImportLog = {
              id: Date.now().toString(),
              inventoryId: isNew ? undefined : data.id, // Will be updated below if new
              importDate: now,
              itemName: name,
              quantity: quantity,
              unit: unit,
              costPrice: costPrice,
              supplier,
              invoiceRef,
              vatRate,
              preTaxTotal,
              totalAmount
          };

          let newInventoryId = data.id;

          // 2. Update Stock
          if (isNew) {
              const newItem: InventoryItem = {
                  id: Date.now().toString(),
                  name,
                  quantity, // New quantity
                  unit,
                  minThreshold,
                  costPrice,
                  supplier,
                  invoiceRef,
                  vatRate
              };
              setInventory(prev => [...prev, newItem]);
              newInventoryId = newItem.id;
              newLog.inventoryId = newItem.id; // Link log to new item
          } else {
              setInventory(prev => prev.map(item => {
                  if (item.id === data.id) {
                      return { 
                          ...item, 
                          quantity: item.quantity + quantity,
                          costPrice, // Update latest cost price
                          supplier,
                          invoiceRef,
                          vatRate
                      };
                  }
                  return item;
              }));
          }

          setImportLogs(prev => [newLog, ...prev]);

          // 3. Create Expense (Auto)
          const newExpense: Expense = {
              id: Date.now().toString(),
              name: `Nhập kho: ${name}`,
              amount: preTaxTotal, // Record Cost Price (Pre-tax) as Expense
              category: 'IMPORT',
              date: now.split('T')[0],
              notes: invoiceRef ? `Chứng từ: ${invoiceRef}` : ''
          };
          setExpenses(prev => [newExpense, ...prev]);

      } else if (mode === 'OUT') {
          // Deduct Stock
          setInventory(prev => prev.map(item => {
              if (item.id === data.id) {
                  return { ...item, quantity: Math.max(0, item.quantity - quantity) };
              }
              return item;
          }));

          // If transfer to Room
          if (data.exportTarget === 'ROOM' && data.targetRoomId) {
             setRooms(prevRooms => prevRooms.map(r => {
                 if (r.id === data.targetRoomId) {
                     const currentQty = r.inventory[data.id] || 0;
                     return {
                         ...r,
                         inventory: {
                             ...r.inventory,
                             [data.id]: currentQty + quantity
                         }
                     };
                 }
                 return r;
             }));
          }
      } else if (mode === 'EDIT') {
          // Update Inventory Item Details & Stock
          setInventory(prev => prev.map(item => {
              if (item.id === data.id) {
                  return {
                      ...item,
                      name,
                      unit,
                      quantity: quantity, // Direct update stock
                      minThreshold,
                      costPrice,
                      supplier,
                      invoiceRef,
                      vatRate
                  };
              }
              return item;
          }));

          // Sync updates to History Logs (Name, Unit, Supplier, VAT, Price)
          // We keep quantity and amount of logs as they were in history, but update reference info
          setImportLogs(prev => prev.map(log => {
              if (log.inventoryId === data.id) {
                  return {
                      ...log,
                      itemName: name,
                      unit: unit,
                      supplier: supplier, // Sync supplier
                      vatRate: vatRate,   // Sync VAT
                      // Optional: Do we sync price? usually history price should remain as it was at import time.
                      // But user might want to correct data. Let's sync Cost Price if it was wrong.
                      costPrice: costPrice, 
                      preTaxTotal: log.quantity * costPrice, // Recalculate totals
                      totalAmount: (log.quantity * costPrice) * (1 + (vatRate/100))
                  };
              }
              return log;
          }));
      }
  };

  const handleDeleteInventory = (id: string) => {
      // Delete from Stock
      setInventory(prev => prev.filter(i => i.id !== id));
      // Delete from History Logs
      setImportLogs(prev => prev.filter(log => log.inventoryId !== id));
  };

  const handleEditBooking = (booking: Booking) => {
      // In a real app, this would open a modal to edit booking details
      alert("Tính năng Sửa Booking đang phát triển (Cập nhật ngày, khách, phòng...)");
  };

  const handleDeleteBooking = (bookingId: string) => {
      // Find the booking to be deleted
      const bookingToDelete = bookings.find(b => b.id === bookingId);
      
      // Remove from list
      setBookings(prev => prev.filter(b => b.id !== bookingId));

      // If active/booked, free up the room
      if (bookingToDelete && (bookingToDelete.status === 'active' || bookingToDelete.status === 'pending')) {
          updateRoomStatus(bookingToDelete.roomId, RoomStatus.AVAILABLE);
      }
  };

  const handleSendEmail = (booking: Booking) => {
      alert(`Đã gửi email xác nhận tới: ${booking.customer.email || 'Khách không có email'}`);
  };

  const handleAddRoom = () => {
      setEditingRoom(null);
      setIsRoomManageModalOpen(true);
  };
  const handleEditRoom = (room: Room) => {
      setEditingRoom(room);
      setIsRoomManageModalOpen(true);
  };
  const handleDeleteRoom = (roomId: string) => {
      if(confirm("Xóa phòng này?")) {
          setRooms(prev => prev.filter(r => r.id !== roomId));
      }
  };
  const handleRoomSubmit = (roomData: Partial<Room>) => {
      if(editingRoom) {
          setRooms(prev => prev.map(r => r.id === editingRoom.id ? {...r, ...roomData} : r));
      } else {
          const newRoom: Room = {
              id: Date.now().toString(),
              number: roomData.number!,
              floor: roomData.floor!,
              type: roomData.type!,
              status: RoomStatus.AVAILABLE,
              priceHourly: 0, // Should come from config
              priceDaily: 0,
              priceOvernight: 0,
              inventory: {}
          };
          // Match prices from RoomTypeConfig
          const config = roomTypes.find(rt => rt.code === newRoom.type);
          if(config) {
              newRoom.priceHourly = config.priceHourly;
              newRoom.priceDaily = config.priceDaily;
              newRoom.priceOvernight = config.priceOvernight;
          }
          setRooms(prev => [...prev, newRoom]);
      }
  };

  // --- Front Desk Handlers ---
  const handleFrontDeskCheckOut = (bookingId: string) => {
      const booking = bookings.find(b => b.id === bookingId);
      if (booking) {
          setSelectedBooking(booking); // Set specific booking
          const room = rooms.find(r => r.id === booking.roomId);
          if (room) setSelectedRoom(room);
          setIsDetailModalOpen(true);
      }
  };

  const handleFrontDeskCheckIn = (bookingId: string) => {
      setBookings(prev => prev.map(b => b.id === bookingId ? {...b, status: 'active'} : b));
      // Update Room
      const booking = bookings.find(b => b.id === bookingId);
      if(booking) updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED);
  };

  // --- CRITICAL FIX: COMPUTE ACTIVE BOOKING FOR MODAL ---
  // Instead of passing `selectedBooking` (which is a snapshot), we find the live record
  const getBookingForModal = () => {
    if (selectedBooking) {
        // Find by ID to get the latest version (with added services)
        return bookings.find(b => b.id === selectedBooking.id) || selectedBooking;
    }
    if (selectedRoom) {
        // Find active booking for the room
        return bookings.find(b => b.roomId === selectedRoom.id && b.status === 'active');
    }
    return undefined;
  };

  const bookingForModal = getBookingForModal();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Navbar */}
      <nav className="bg-slate-900 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-[1920px] mx-auto px-3 sm:px-4">
          <div className="flex justify-between items-center h-14 md:h-16">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="bg-indigo-600 p-1.5 sm:p-2 rounded-lg shrink-0">
                <LayoutGrid size={22} className="text-white" />
              </div>
              <div className="min-w-0">
                <span className="text-base sm:text-xl font-bold tracking-tight truncate block">HotelPro PMS</span>
                <span className="text-xs text-slate-400 hidden sm:block -mt-1">Professional Management</span>
              </div>
            </div>

            <div className="hidden md:flex items-center space-x-1 bg-slate-800/50 p-1 rounded-xl">
              {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={navButtonClass(activeTab === id)}
                >
                  <Icon size={18} /> {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <button className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-full transition-colors relative">
                <Bell size={20} />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full border-2 border-slate-900"></span>
              </button>
              <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-sm font-bold border-2 border-slate-700">
                AD
              </div>
            </div>
          </div>

          {/* Mobile / portrait: always show all navigation tabs */}
          <div className="md:hidden grid grid-cols-5 gap-1 pb-2 pt-1 border-t border-slate-800">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={navButtonClass(activeTab === id, true)}
              >
                <Icon size={18} className="shrink-0" />
                <span className="px-0.5">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-[1920px] w-full mx-auto p-3 sm:p-4 md:p-6 overflow-x-hidden">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          {/* TAB: FRONT DESK */}
          {activeTab === 'frontdesk' && (
             <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                {/* Left: Room Grid */}
                <div className="xl:col-span-2 space-y-6">
                   <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                      <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                           <LayoutGrid className="text-indigo-600"/> Sơ đồ phòng
                        </h2>
                        <div className="flex gap-4 text-sm">
                           <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-white border-2 border-emerald-300"></span> Trống</div>
                           <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-rose-100 border-2 border-rose-300"></span> Có khách</div>
                           <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-gray-200 border-2 border-gray-400"></span> Dơ</div>
                        </div>
                      </div>
                      
                      {/* ROOM GRID COMPONENT */}
                      {(() => {
                        const floors = Array.from(new Set(rooms.map(r => r.floor))).sort();
                        return (
                          <div className="space-y-8">
                            {floors.map(floor => (
                              <div key={floor}>
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                  <span className="w-1.5 h-4 bg-slate-300 rounded-sm"></span> Tầng {floor}
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                  {rooms.filter(r => r.floor === floor).map(room => (
                                    <div
                                      key={room.id}
                                      onClick={() => {
                                        setSelectedRoom(room);
                                        // If room is Available or Dirty -> Open Booking Modal
                                        if (room.status === RoomStatus.AVAILABLE || room.status === RoomStatus.DIRTY) {
                                            setIsBookingModalOpen(true);
                                        } 
                                        // If room is Occupied -> Open Detail Modal
                                        else if (room.status === RoomStatus.OCCUPIED) {
                                            // Ensure selectedBooking is null so it finds the active one
                                            setSelectedBooking(null);
                                            setIsDetailModalOpen(true);
                                        }
                                      }}
                                      className={`
                                        relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md hover:-translate-y-1
                                        flex flex-col justify-between h-28
                                        ${room.status === RoomStatus.AVAILABLE ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-400 text-emerald-900' : ''}
                                        ${room.status === RoomStatus.OCCUPIED ? 'bg-rose-50 border-rose-200 hover:border-rose-400 text-rose-900' : ''}
                                        ${room.status === RoomStatus.BOOKED ? 'bg-amber-50 border-amber-200 hover:border-amber-400 text-amber-900' : ''}
                                        ${room.status === RoomStatus.DIRTY ? 'bg-gray-100 border-gray-300 hover:border-gray-400 text-gray-600' : ''}
                                        ${room.status === RoomStatus.MAINTENANCE ? 'bg-slate-100 border-slate-300 text-slate-500' : ''}
                                      `}
                                    >
                                      <div className="flex justify-between items-start">
                                        <span className="text-xl font-bold">{room.number}</span>
                                        {/* Icons based on status */}
                                      </div>
                                      <div className="flex justify-between items-end">
                                          <span className="text-xs font-semibold uppercase opacity-75">{room.type}</span>
                                          {room.status === RoomStatus.OCCUPIED && (
                                              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                                          )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                   </div>
                </div>

                {/* Right: Booking List & Actions */}
                <div className="xl:col-span-1">
                    <FrontDesk 
                        bookings={bookings}
                        rooms={rooms}
                        onNewBooking={handleNewBooking}
                        onCheckOut={handleFrontDeskCheckOut}
                        onCheckIn={handleFrontDeskCheckIn}
                        onEditBooking={handleEditBooking}
                        onDeleteBooking={handleDeleteBooking}
                        onSendEmail={handleSendEmail}
                    />
                </div>
             </div>
          )}

          {/* TAB: HOUSEKEEPING */}
          {activeTab === 'housekeeping' && (
             <HousekeepingGrid 
                rooms={rooms} 
                onUpdateStatus={updateRoomStatus}
                onAddRoom={handleAddRoom}
                onEditRoom={handleEditRoom}
                onDeleteRoom={handleDeleteRoom}
             />
          )}

          {/* TAB: REPORTS */}
          {activeTab === 'reports' && (
              <Reports 
                  expenses={expenses}
                  bookings={bookings}
                  rooms={rooms}
                  importLogs={importLogs}
                  onAddExpense={handleAddExpense}
                  onEditExpense={handleEditExpense}
                  onDeleteExpense={handleDeleteExpense}
              />
          )}

          {/* TAB: INVENTORY */}
          {activeTab === 'inventory' && (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold text-slate-800">Kho hàng & Vật tư</h1>
                    <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
                        <button 
                           onClick={() => setInventoryView('STOCK')}
                           className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors ${inventoryView === 'STOCK' ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:bg-gray-50'}`}
                        >
                           <Layers size={16}/> Tồn kho hiện tại
                        </button>
                        <button 
                           onClick={() => setInventoryView('HISTORY')}
                           className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors ${inventoryView === 'HISTORY' ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:bg-gray-50'}`}
                        >
                           <History size={16}/> Lịch sử Nhập kho
                        </button>
                    </div>
                </div>

                {inventoryView === 'STOCK' ? (
                    <InventoryTable 
                        items={inventory}
                        onAddInventory={() => {
                            setInventoryMode('IN');
                            setEditingInventoryItem(null);
                            setIsInventoryModalOpen(true);
                        }}
                        onExportInventory={() => {
                            setInventoryMode('OUT');
                            setEditingInventoryItem(null);
                            setIsInventoryModalOpen(true);
                        }}
                        onEditInventory={(item) => {
                            setInventoryMode('EDIT');
                            setEditingInventoryItem(item);
                            setIsInventoryModalOpen(true);
                        }}
                        onDeleteInventory={handleDeleteInventory}
                    />
                ) : (
                    <ImportHistoryTable logs={importLogs} />
                )}
            </div>
          )}

          {/* TAB: RATES */}
          {activeTab === 'rates' && (
              <RateManagement 
                  roomTypes={roomTypes}
                  onSaveRoomType={(config) => {
                      setRoomTypes(prev => {
                          const exists = prev.find(p => p.id === config.id);
                          if(exists) return prev.map(p => p.id === config.id ? config : p);
                          return [...prev, config];
                      });
                  }}
                  onDeleteRoomType={(id) => {
                      setRoomTypes(prev => prev.filter(p => p.id !== id));
                  }}
              />
          )}

        </div>
      </main>

      {/* MODALS */}
      {selectedRoom && (
        <BookingModal
          room={selectedRoom}
          rooms={rooms}
          isOpen={isBookingModalOpen}
          onClose={() => {
              setIsBookingModalOpen(false);
              setSelectedRoom(null);
          }}
          onSubmit={createBooking}
        />
      )}

      {/* Room Detail Modal (Check-out & Services) */}
      {(selectedRoom || selectedBooking) && (
        <RoomDetailModal
          room={selectedRoom || rooms.find(r => r.id === selectedBooking?.roomId)!}
          // Pass the LIVE booking object from state, not the stale snapshot
          booking={bookingForModal}
          inventory={inventory}
          isOpen={isDetailModalOpen}
          onClose={() => {
              setIsDetailModalOpen(false);
              setSelectedRoom(null);
              setSelectedBooking(null);
          }}
          onAddService={addServiceToBooking}
          onCheckout={checkoutRoom}
        />
      )}

      <InventoryModal
        isOpen={isInventoryModalOpen}
        mode={inventoryMode}
        items={inventory}
        rooms={rooms}
        editingItem={editingInventoryItem}
        onClose={() => setIsInventoryModalOpen(false)}
        onSubmit={handleInventorySubmit}
      />

      <RoomManageModal 
         isOpen={isRoomManageModalOpen}
         onClose={() => setIsRoomManageModalOpen(false)}
         onSubmit={handleRoomSubmit}
         initialData={editingRoom}
      />

    </div>
  );
}

export default App;
