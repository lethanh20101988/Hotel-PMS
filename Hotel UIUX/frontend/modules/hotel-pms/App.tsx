
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, CalendarDays, Settings, Search, Bell, Menu, Brush, DollarSign, ShoppingBag } from 'lucide-react';
import { BookingModal, type BookingModalMode } from './components/BookingModal';
import { RoomDetailModal, type CheckoutPaymentOptions } from './components/RoomDetailModal';
import { HousekeepingGrid } from './components/HousekeepingGrid';
import { FrontDesk } from './components/FrontDesk';
import { RoomMapPanel } from './components/RoomMapPanel';
import { fd } from './components/frontDeskTheme';
import { RoomManageModal } from './components/RoomManageModal'; 
import { RateManagement } from './components/RateManagement';
import { ServiceMinibarSettings } from './components/ServiceMinibarSettings';
import { MOCK_SERVICES } from './constants';
import { Room, RoomStatus, Booking, BookingService, InventoryItem, BookingType, RoomTypeConfig, Expense, ImportLog, ServiceItem } from './types';
import { calculateRoomCharge } from './utils';
import { getDefaultHotelPmsState } from './hotelPmsStorage';
import {
  buildHotelPmsInvoiceId,
} from './hotelPmsAccounting';
import { useApp } from '../../app/store';
import { useBookingOrderRealtime } from './useBookingOrderRealtime';
import { TabKeepAlive } from '@shared/components/TabKeepAlive';
import type { LucideIcon } from 'lucide-react';

export type AppTab = 'frontdesk' | 'housekeeping' | 'rates' | 'services';

type HotelPmsPageProps = {
  initialTab?: AppTab;
  embedded?: boolean;
  visible?: boolean;
};

const NAV_ITEMS: { id: AppTab; label: string; icon: LucideIcon }[] = [
  { id: 'frontdesk', label: 'Lễ Tân', icon: LayoutGrid },
  { id: 'housekeeping', label: 'Buồng phòng', icon: Brush },
  { id: 'rates', label: 'Cấu hình Giá', icon: DollarSign },
  { id: 'services', label: 'Dịch vụ & Minibar', icon: ShoppingBag },
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

function App({ initialTab = 'frontdesk', embedded = false, visible = true }: HotelPmsPageProps = {}) {
  const {
    handlePostHotelPmsCheckout,
    handleDeleteInvoice,
    invoices,
    journalEntries,
    bankAccounts,
    hotelPmsState,
    setHotelPmsState,
    hydrated,
    hotelPmsResetNonce,
    refreshHotelPmsFromBackend,
  } = useApp();
  const skipHotelPmsPersistRef = useRef(true);

  const [activeTab, setActiveTab] = useState<AppTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);
  
  
  const [rooms, setRooms] = useState<Room[]>(() => getDefaultHotelPmsState().rooms);
  const [inventory, setInventory] = useState<InventoryItem[]>(() => getDefaultHotelPmsState().inventory);
  const [importLogs, setImportLogs] = useState<ImportLog[]>(() => getDefaultHotelPmsState().importLogs);
  const [bookings, setBookings] = useState<Booking[]>(() => getDefaultHotelPmsState().bookings);
  const [roomTypes, setRoomTypes] = useState<RoomTypeConfig[]>(() => getDefaultHotelPmsState().roomTypes);
  const [expenses, setExpenses] = useState<Expense[]>(() => getDefaultHotelPmsState().expenses);
  const [services, setServices] = useState<ServiceItem[]>(() => getDefaultHotelPmsState().services);

  // Nạp từ SQLite khi hydrate / reset hệ thống.
  useEffect(() => {
    if (!hydrated) return;
    skipHotelPmsPersistRef.current = true;
    setRooms(hotelPmsState.rooms);
    setBookings(hotelPmsState.bookings);
    setInventory(hotelPmsState.inventory);
    setImportLogs(hotelPmsState.importLogs);
    setRoomTypes(hotelPmsState.roomTypes);
    setExpenses(hotelPmsState.expenses);
    setServices(hotelPmsState.services?.length ? hotelPmsState.services : MOCK_SERVICES.map((s) => ({ ...s })));
    const t = window.setTimeout(() => {
      skipHotelPmsPersistRef.current = false;
    }, 0);
    return () => window.clearTimeout(t);
    // Chỉ đồng bộ từ DB khi mở app / reset.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- hotelPmsState đọc khi hydrated/nonce đổi
  }, [hydrated, hotelPmsResetNonce]);

  // Ghi ngược lên store → PUT /api/state (debounce 600ms ở store).
  useEffect(() => {
    if (!hydrated || skipHotelPmsPersistRef.current) return;
    setHotelPmsState({
      rooms,
      bookings,
      inventory,
      importLogs,
      roomTypes,
      expenses,
      services,
    });
  }, [rooms, bookings, inventory, importLogs, roomTypes, expenses, services, hydrated, setHotelPmsState]);
  
  // Modal States
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null); // Specific booking to view
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [bookingModalMode, setBookingModalMode] = useState<BookingModalMode>('create');
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  
  // Room Management States
  const [isRoomManageModalOpen, setIsRoomManageModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);

  /** Booking đang xem chi tiết → join room order:{id} cho realtime. */
  const realtimeBookingId = useMemo(() => {
    if (isDetailModalOpen && selectedBooking?.id) return selectedBooking.id;
    if (selectedBooking?.id) return selectedBooking.id;
    if (selectedRoom) {
      const live =
        bookings.find((b) => b.roomId === selectedRoom.id && b.status === 'active') ||
        bookings.find((b) => b.roomId === selectedRoom.id && b.status === 'pending');
      return live?.id ?? null;
    }
    return null;
  }, [isDetailModalOpen, selectedBooking?.id, selectedRoom?.id, bookings]);

  const handleRemoteBookingUpdate = useCallback(
    (_orderId: string) => {
      void refreshHotelPmsFromBackend();
    },
    [refreshHotelPmsFromBackend],
  );

  useBookingOrderRealtime(realtimeBookingId, handleRemoteBookingUpdate);

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
        setEditingBooking(null);
        setBookingModalMode('create');
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
    setEditingBooking(null);
    setBookingModalMode('create');
  };

  const updateBooking = (bookingId: string, bookingData: any) => {
    const prevBooking = bookings.find((b) => b.id === bookingId);
    if (!prevBooking) return;

    const roomCharge = bookingData.estimatedTotal ?? prevBooking.totalRoomCharge;
    const serviceCharge = prevBooking.totalServiceCharge ?? 0;
    const serviceVat = prevBooking.totalServiceVatAmount ?? 0;
    const discount = prevBooking.discount ?? 0;
    const finalTotal = roomCharge + serviceCharge + serviceVat - discount;

    setBookings((prev) =>
      prev.map((b) => {
        if (b.id !== bookingId) return b;
        return {
          ...b,
          roomId: bookingData.roomId,
          customer: bookingData.customer,
          checkIn: bookingData.checkIn,
          checkOutExpected: bookingData.checkOut,
          bookingType: bookingData.bookingType,
          status: bookingData.status ?? b.status,
          totalRoomCharge: roomCharge,
          deposit: bookingData.deposit ?? b.deposit,
          paidAmount: bookingData.paidAmount ?? b.paidAmount,
          finalTotal,
        };
      }),
    );

    if (prevBooking.roomId !== bookingData.roomId) {
      updateRoomStatus(prevBooking.roomId, RoomStatus.AVAILABLE);
      const newStatus =
        (bookingData.status ?? prevBooking.status) === 'active'
          ? RoomStatus.OCCUPIED
          : RoomStatus.BOOKED;
      updateRoomStatus(bookingData.roomId, newStatus);
    }
  };

  const handleBookingModalSubmit = (bookingData: any) => {
    if (bookingData.bookingId) {
      updateBooking(bookingData.bookingId, bookingData);
    } else {
      createBooking(bookingData);
      return;
    }
    setIsBookingModalOpen(false);
    setEditingBooking(null);
    setBookingModalMode('create');
  };

  const openBookingModal = (mode: BookingModalMode, booking?: Booking | null, room?: Room | null) => {
    if (booking) {
      const bookingRoom = rooms.find((r) => r.id === booking.roomId);
      if (bookingRoom) setSelectedRoom(bookingRoom);
      setSelectedBooking(booking);
      setEditingBooking(booking);
    } else if (room) {
      setSelectedRoom(room);
    }
    setBookingModalMode(mode);
    setIsBookingModalOpen(true);
  };

  const resolveActiveBookingId = () => {
    let targetBookingId = selectedBooking?.id;
    if (!targetBookingId && selectedRoom) {
      const activeBooking = bookings.find(
        (b) => b.roomId === selectedRoom.id && b.status === 'active',
      );
      targetBookingId = activeBooking?.id;
    }
    return targetBookingId;
  };

  const addServiceToBooking = (serviceItem: BookingService) => {
    const targetBookingId = resolveActiveBookingId();
    if (!targetBookingId) return;

    const currentBooking = bookings.find((b) => b.id === targetBookingId);
    if (!currentBooking) return;
    const updatedBooking = { ...currentBooking, services: [...currentBooking.services, serviceItem] };
    setSelectedBooking(updatedBooking);
    const liveRoom = rooms.find((room) => room.id === updatedBooking.roomId);
    if (liveRoom) setSelectedRoom(liveRoom);
    setBookings((prevBookings) => prevBookings.map((b) => (b.id === targetBookingId ? updatedBooking : b)));
  };

  const updateServiceInBooking = (serviceIndex: number, serviceItem: BookingService) => {
    const targetBookingId = resolveActiveBookingId();
    if (!targetBookingId) return;

    const currentBooking = bookings.find((b) => b.id === targetBookingId);
    if (!currentBooking) return;
    const nextServices = [...currentBooking.services];
    if (serviceIndex < 0 || serviceIndex >= nextServices.length) return;
    nextServices[serviceIndex] = serviceItem;
    const updatedBooking = { ...currentBooking, services: nextServices };
    setSelectedBooking(updatedBooking);
    setBookings((prevBookings) => prevBookings.map((b) => (b.id === targetBookingId ? updatedBooking : b)));
  };

  const removeServiceFromBooking = (serviceIndex: number) => {
    const targetBookingId = resolveActiveBookingId();
    if (!targetBookingId) return;

    const currentBooking = bookings.find((b) => b.id === targetBookingId);
    if (!currentBooking) return;
    const updatedBooking = {
      ...currentBooking,
      services: currentBooking.services.filter((_, idx) => idx !== serviceIndex),
    };
    setSelectedBooking(updatedBooking);
    setBookings((prevBookings) => prevBookings.map((b) => (b.id === targetBookingId ? updatedBooking : b)));
  };

  const checkoutRoom = (
    checkOutDate: string,
    roomVatRate: number,
    payment: CheckoutPaymentOptions = { paymentMethod: 'CASH' },
  ) => {
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

    const checkoutInvoiceId = buildHotelPmsInvoiceId(activeBooking.id);
    const checkoutJournalId = `JE-INV-${checkoutInvoiceId}`;
    const accountingComplete =
      activeBooking.accountingPosted &&
      invoices.some((inv) => String(inv.id) === checkoutInvoiceId) &&
      journalEntries.some((je) => String(je.id) === checkoutJournalId);

    if (!accountingComplete) {
      const posted = handlePostHotelPmsCheckout({
        bookingId: activeBooking.id,
        roomNumber: room.number,
        checkoutDate: checkOutDate,
        customerName: activeBooking.customer.name,
        customerPhone: activeBooking.customer.phone,
        customerIdentityCard: activeBooking.customer.identityCard,
        roomChargePreTax,
        roomVatRate,
        roomVatAmount,
        services: activeBooking.services,
        servicesPreTax,
        servicesVatAmount: totalServiceVatAmount,
        grandTotal,
        paymentMethod: payment.paymentMethod,
        bankAccountId: payment.bankAccountId,
        bankLedgerAccountCode: payment.bankLedgerAccountCode,
        inventoryItemIds: inventory.map((i) => i.id),
      });
      if (!posted) {
        window.alert('Không thể ghi nhận thanh toán vào Sổ nhật ký chung. Vui lòng kiểm tra ngày hạch toán hoặc cấu hình năm tài chính.');
        return;
      }
    }

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
                paidAmount:
                  payment.paymentMethod === 'DEBT'
                    ? activeBooking!.paidAmount || activeBooking!.deposit || 0
                    : grandTotal,
                paymentMethod: payment.paymentMethod,
                bankAccountId: payment.paymentMethod === 'TRANSFER' ? payment.bankAccountId : undefined,
                bankLedgerAccountCode:
                  payment.paymentMethod === 'TRANSFER' ? payment.bankLedgerAccountCode : undefined,
                accountingPosted: true,
                invoiceReferenceId: buildHotelPmsInvoiceId(activeBooking.id),
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

  const handleEditBooking = (booking: Booking) => {
    openBookingModal('edit', booking);
  };

  const handleExtendBooking = (booking: Booking) => {
    openBookingModal('extend', booking);
  };

  const handleDeleteBooking = async (bookingId: string) => {
      const bookingToDelete = bookings.find(b => b.id === bookingId);
      if (!bookingToDelete) return;

      const linkedInvoiceId =
        bookingToDelete.invoiceReferenceId || buildHotelPmsInvoiceId(bookingId);

      if (bookingToDelete.accountingPosted || bookingToDelete.invoiceReferenceId) {
        const deleted = await handleDeleteInvoice(linkedInvoiceId);
        if (!deleted) {
          setBookings((prev) => prev.filter((b) => b.id !== bookingId));
        }
        return;
      }

      setBookings(prev => prev.filter(b => b.id !== bookingId));

      if (bookingToDelete.status === 'active' || bookingToDelete.status === 'pending') {
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

  const handleFrontDeskRoomSelect = (room: Room, booking?: Booking | null) => {
      setSelectedRoom(room);
      const activeBooking =
        booking ??
        bookings.find(
          (b) => b.roomId === room.id && (b.status === 'active' || b.status === 'pending'),
        );
      setSelectedBooking(activeBooking || null);
  };

  /** Double-click phòng → mở form nhanh theo trạng thái */
  const handleFrontDeskRoomDoubleClick = (room: Room) => {
      handleFrontDeskRoomSelect(room);
      if (
        room.status === RoomStatus.AVAILABLE ||
        room.status === RoomStatus.DIRTY
      ) {
        setEditingBooking(null);
        setBookingModalMode('create');
        setIsBookingModalOpen(true);
        return;
      }
      if (room.status === RoomStatus.BOOKED) {
        const pending = bookings.find(
          (b) => b.roomId === room.id && b.status === 'pending',
        );
        if (pending) {
          handleEditBooking(pending);
        } else {
          setEditingBooking(null);
          setBookingModalMode('create');
          setIsBookingModalOpen(true);
        }
        return;
      }
      if (room.status === RoomStatus.OCCUPIED) {
        const active = bookings.find(
          (b) => b.roomId === room.id && b.status === 'active',
        );
        if (active) {
          setSelectedBooking(active);
          setIsDetailModalOpen(true);
        }
      }
  };

  const handleFrontDeskBookRoom = () => {
      if (!selectedRoom) return;
      if (
        selectedRoom.status === RoomStatus.AVAILABLE ||
        selectedRoom.status === RoomStatus.DIRTY
      ) {
        setEditingBooking(null);
        setBookingModalMode('create');
        setIsBookingModalOpen(true);
      }
  };

  const handleFrontDeskOpenRoomDetail = () => {
      if (!selectedRoom) return;
      setSelectedBooking(null);
      setIsDetailModalOpen(true);
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
  const modalRoom = selectedRoom ?? rooms.find((r) => r.id === selectedBooking?.roomId);

  return (
    <div className={`${embedded ? 'min-h-full rounded-2xl border border-slate-200' : 'min-h-screen'} ${visible ? '' : 'hidden'} bg-slate-50 flex flex-col font-sans text-slate-900 overflow-hidden`}>
      {/* Navbar */}
      {!embedded && <nav className="bg-slate-900 text-white shadow-lg sticky top-0 z-40">
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
          <div className="md:hidden grid grid-cols-4 gap-1 pb-2 pt-1 border-t border-slate-800">
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
      </nav>}

      {/* Main Content */}
      <main className="flex-1 max-w-[1920px] w-full mx-auto p-3 sm:p-4 md:p-6 overflow-x-hidden">
        <div className={embedded ? '' : 'animate-in fade-in slide-in-from-bottom-4 duration-500'}>
          
          {/* TAB: FRONT DESK */}
          <TabKeepAlive active={activeTab === 'frontdesk'} suspense={false}>
            <div className={`flex flex-col gap-4 min-h-[calc(100vh-10rem)] lg:min-h-[calc(100vh-8rem)] ${fd.font}`}>
              <div className="shrink-0">
                <h1 className="text-lg font-semibold text-gray-700 tracking-tight">Lễ Tân</h1>
                <p className={`${fd.caption} mt-1`}>
                  Click phòng xem chi tiết · Double-click thao tác nhanh
                </p>
              </div>

              <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
                <div className="w-full lg:w-[70%] lg:flex-none min-w-0 min-h-[400px] lg:min-h-0">
                  <RoomMapPanel
                    rooms={rooms}
                    roomTypes={roomTypes}
                    selectedRoomId={selectedRoom?.id ?? null}
                    isLoading={!hydrated}
                    onRoomSelect={(room) => handleFrontDeskRoomSelect(room)}
                    onRoomDoubleClick={handleFrontDeskRoomDoubleClick}
                    onNewBooking={handleNewBooking}
                  />
                </div>

                <div className="w-full lg:w-[30%] lg:flex-none min-h-[360px] lg:min-h-0 flex flex-col">
                  <FrontDesk
                    bookings={bookings}
                    rooms={rooms}
                    roomTypes={roomTypes}
                    selectedRoom={selectedRoom}
                    isLoading={!hydrated}
                    onNewBooking={handleNewBooking}
                    onCheckOut={handleFrontDeskCheckOut}
                    onCheckIn={handleFrontDeskCheckIn}
                    onEditBooking={handleEditBooking}
                    onExtendBooking={handleExtendBooking}
                    onDeleteBooking={handleDeleteBooking}
                    onSelectRoom={handleFrontDeskRoomSelect}
                    onBookRoom={handleFrontDeskBookRoom}
                  />
                </div>
              </div>
            </div>
          </TabKeepAlive>

          {/* TAB: HOUSEKEEPING */}
          <TabKeepAlive active={activeTab === 'housekeeping'} suspense={false}>
             <HousekeepingGrid 
                rooms={rooms} 
                onUpdateStatus={updateRoomStatus}
                onAddRoom={handleAddRoom}
                onEditRoom={handleEditRoom}
                onDeleteRoom={handleDeleteRoom}
             />
          </TabKeepAlive>

          {/* TAB: RATES */}
          <TabKeepAlive active={activeTab === 'rates'} suspense={false}>
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
          </TabKeepAlive>

          {/* TAB: DỊCH VỤ & MINIBAR */}
          <TabKeepAlive active={activeTab === 'services'} suspense={false}>
              <ServiceMinibarSettings
                  inventory={inventory}
                  services={services}
                  onInventoryChange={setInventory}
                  onServicesChange={setServices}
              />
          </TabKeepAlive>

        </div>
      </main>

      {/* MODALS */}
      {selectedRoom && (
        <BookingModal
          room={selectedRoom}
          rooms={rooms}
          isOpen={isBookingModalOpen}
          mode={bookingModalMode}
          initialBooking={editingBooking}
          onClose={() => {
              setIsBookingModalOpen(false);
              setEditingBooking(null);
              setBookingModalMode('create');
          }}
          onSubmit={handleBookingModalSubmit}
        />
      )}

      {/* Room Detail Modal (Check-out & Services) */}
      {modalRoom && (selectedRoom || selectedBooking) && (
        <RoomDetailModal
          room={modalRoom}
          // Pass the LIVE booking object from state, not the stale snapshot
          booking={bookingForModal}
          inventory={inventory}
          services={services}
          bankAccounts={bankAccounts}
          isOpen={isDetailModalOpen}
          onClose={() => {
              setIsDetailModalOpen(false);
              setSelectedRoom(null);
              setSelectedBooking(null);
          }}
          onAddService={addServiceToBooking}
          onEditService={updateServiceInBooking}
          onDeleteService={removeServiceFromBooking}
          onCheckout={checkoutRoom}
        />
      )}

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
