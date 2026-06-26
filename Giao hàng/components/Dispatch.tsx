
import React, { useState, useEffect } from 'react';
import { Order, Trip, Vehicle, OrderStatus, TripStatus } from '../types';
import { getSmartDispatchSuggestion, DispatchSuggestion } from '../services/geminiService';
import { Truck, Package, BrainCircuit, AlertCircle, Map, ChevronRight, PlayCircle, Loader2, Navigation, CheckCircle2, ArrowRightLeft, Scale, ArrowRight, PlusCircle, RotateCcw, FileWarning, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  pendingOrders: Order[];
  vehicles: Vehicle[];
  trips: Trip[];
  onCreateTrip: (trip: Trip) => void;
  onUpdateTrip: (trip: Trip) => void;
  onUpdateOrder: (order: Order) => void;
  onUpdateTripStatus: (tripId: string, status: TripStatus) => void;
  onMoveOrder: (orderId: string, fromTripId: string, targetVehicleId: string) => void;
  // Updated signature for partial returns
  onReturnOrders: (tripId: string, returnData: { orderId: string, items: { productId: string, quantity: number }[] }[], reason: string) => void;
}

const Dispatch: React.FC<Props> = ({ pendingOrders, vehicles, trips, onCreateTrip, onUpdateTrip, onUpdateOrder, onUpdateTripStatus, onMoveOrder, onReturnOrders }) => {
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<DispatchSuggestion[]>([]);

  // Reallocate Modal State
  const [isReallocateModalOpen, setIsReallocateModalOpen] = useState(false);
  const [reallocateSourceTrip, setReallocateSourceTrip] = useState<Trip | null>(null);
  const [selectedOrderToMove, setSelectedOrderToMove] = useState<string>('');
  const [selectedTargetVehicle, setSelectedTargetVehicle] = useState<string>('');

  // Return Modal State
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnTrip, setReturnTrip] = useState<Trip | null>(null);
  const [returnReason, setReturnReason] = useState('');
  
  // Detailed Return State: Map of OrderID -> { ProductID: ReturnedQty }
  const [returnDetails, setReturnDetails] = useState<Record<string, Record<string, number>>>({});
  const [expandedOrders, setExpandedOrders] = useState<string[]>([]);

  // Effect to clean up selections and suggestions if orders are removed (e.g. assigned elsewhere)
  useEffect(() => {
    // 1. Clean selectedOrders
    setSelectedOrders(prev => prev.filter(id => pendingOrders.some(o => o.id === id)));

    // 2. Clean AI Suggestions that are no longer valid (contain orders that are gone)
    setAiSuggestions(prev => prev.filter(sug => 
      sug.orderIds.every(id => pendingOrders.some(o => o.id === id))
    ));
  }, [pendingOrders]);

  // Simple stats
  const totalWeightPending = pendingOrders.reduce((sum, o) => sum + o.totalWeight, 0);
  const totalReturnedInTrips = trips.reduce((acc, t) => acc + t.orders.filter(o => o.status === OrderStatus.RETURNED || o.status === OrderStatus.PARTIAL_RETURNED).length, 0);

  const toggleSelectOrder = (id: string) => {
    if (selectedOrders.includes(id)) {
      setSelectedOrders(selectedOrders.filter(o => o !== id));
    } else {
      setSelectedOrders([...selectedOrders, id]);
    }
  };

  const handleManualCreateTrip = (vehicleId: string) => {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return;

    const ordersToAdd = pendingOrders.filter(o => selectedOrders.includes(o.id));
    const addedLoad = ordersToAdd.reduce((sum, o) => sum + o.totalWeight, 0);

    // Check if vehicle has an existing trip with status PLANNED or WAITING_LOAD
    const existingTrip = trips.find(t => 
        t.vehicleId === vehicleId && 
        (t.status === TripStatus.PLANNED || t.status === TripStatus.WAITING_LOAD)
    );

    let finalTripId = '';

    if (existingTrip) {
      // MERGE into existing trip
      const updatedTrip: Trip = {
        ...existingTrip,
        currentLoad: existingTrip.currentLoad + addedLoad,
        orders: [...existingTrip.orders, ...ordersToAdd],
      };
      
      onUpdateTrip(updatedTrip);
      finalTripId = existingTrip.id;
    } else {
      // CREATE new trip
      const newTrip: Trip = {
        id: `TRIP-${Date.now()}`,
        code: `CX-${Math.floor(Math.random() * 1000)}`,
        date: new Date().toISOString().split('T')[0],
        vehicleId: vehicle.id,
        vehiclePlate: vehicle.plateNumber,
        driverName: vehicle.driverName,
        route: vehicle.preferredRoute || 'Tùy chọn',
        maxCapacity: vehicle.capacityKg,
        currentLoad: addedLoad,
        orders: ordersToAdd,
        note: 'Điều phối thủ công',
        status: TripStatus.PLANNED
      };

      onCreateTrip(newTrip);
      finalTripId = newTrip.id;
    }
    
    // Update orders status
    ordersToAdd.forEach(o => {
      onUpdateOrder({ ...o, status: OrderStatus.WAREHOUSE_DISPATCH, tripId: finalTripId });
    });

    setSelectedOrders([]);
  };

  const handleSmartDispatch = async () => {
    setIsThinking(true);
    setAiSuggestions([]);
    
    // Filter vehicles that are AVAILABLE
    const available = vehicles.filter(v => v.status === 'AVAILABLE');
    
    const suggestions = await getSmartDispatchSuggestion(pendingOrders, available);
    setAiSuggestions(suggestions);
    setIsThinking(false);
  };

  const applySuggestion = (sug: DispatchSuggestion) => {
    const vehicle = vehicles.find(v => v.id === sug.vehicleId);
    if (!vehicle) return;

    const ordersToAdd = pendingOrders.filter(o => sug.orderIds.includes(o.id));
    const currentLoad = ordersToAdd.reduce((sum, o) => sum + o.totalWeight, 0);

    const newTrip: Trip = {
      id: `TRIP-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      code: `AI-${Math.floor(Math.random() * 1000)}`,
      date: new Date().toISOString().split('T')[0],
      vehicleId: vehicle.id,
      vehiclePlate: vehicle.plateNumber,
      driverName: vehicle.driverName,
      route: vehicle.preferredRoute || 'AI Suggested',
      maxCapacity: vehicle.capacityKg,
      currentLoad,
      orders: ordersToAdd,
      note: `AI: ${sug.reasoning}`,
      status: TripStatus.PLANNED
    };

    onCreateTrip(newTrip);

     // Update orders status
     ordersToAdd.forEach(o => {
      onUpdateOrder({ ...o, status: OrderStatus.WAREHOUSE_DISPATCH, tripId: newTrip.id });
    });

    // Remove applied suggestion
    setAiSuggestions(prev => prev.filter(s => s !== sug));
  };

  // Reallocate Handlers
  const openReallocateModal = (trip: Trip) => {
    setReallocateSourceTrip(trip);
    setSelectedOrderToMove('');
    setSelectedTargetVehicle('');
    setIsReallocateModalOpen(true);
  };

  const submitReallocation = () => {
    if (selectedOrderToMove && reallocateSourceTrip && selectedTargetVehicle) {
      onMoveOrder(selectedOrderToMove, reallocateSourceTrip.id, selectedTargetVehicle);
      setIsReallocateModalOpen(false);
      setReallocateSourceTrip(null);
    }
  };

  // Return Handlers
  const openReturnModal = (trip: Trip, initialOrderId?: string) => {
    setReturnTrip(trip);
    setReturnDetails({}); // Reset
    setReturnReason('');
    
    // Auto-expand the initial order if provided
    if (initialOrderId) {
        setExpandedOrders([initialOrderId]);
    } else {
        setExpandedOrders([]);
    }
    
    setIsReturnModalOpen(true);
  };

  const toggleExpandOrder = (orderId: string) => {
      if (expandedOrders.includes(orderId)) {
          setExpandedOrders(prev => prev.filter(id => id !== orderId));
      } else {
          setExpandedOrders(prev => [...prev, orderId]);
      }
  };

  const updateReturnQuantity = (orderId: string, productId: string, qty: number) => {
      setReturnDetails(prev => {
          const orderReturns = prev[orderId] || {};
          // If qty is 0, remove the entry to keep state clean, otherwise set it
          if (qty <= 0) {
              const { [productId]: _, ...rest } = orderReturns;
              return { ...prev, [orderId]: rest };
          }
          return {
              ...prev,
              [orderId]: { ...orderReturns, [productId]: qty }
          };
      });
  };

  const submitReturn = () => {
      if (!returnTrip) return;

      // Transform state map to expected array format
      const returnData = Object.entries(returnDetails).map(([orderId, products]) => ({
          orderId,
          items: Object.entries(products).map(([productId, quantity]) => ({
              productId,
              quantity
          }))
      })).filter(o => o.items.length > 0);

      if (returnData.length > 0) {
          onReturnOrders(returnTrip.id, returnData, returnReason);
          setIsReturnModalOpen(false);
          setReturnTrip(null);
      }
  };

  // Status Progress Visualizer
  const getStatusProgress = (status: TripStatus) => {
    const steps = [
      TripStatus.PLANNED,
      TripStatus.WAITING_LOAD,
      TripStatus.LOADING,
      TripStatus.IN_TRANSIT,
      TripStatus.DELIVERING,
      TripStatus.COMPLETED
    ];
    if (status === TripStatus.RETURNING) {
        return { currentIndex: 4, total: steps.length, isReturning: true };
    }
    const currentIndex = steps.indexOf(status);
    return { currentIndex, total: steps.length, isReturning: false };
  };

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-orange-100 text-orange-600 rounded-lg">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Đơn chưa giao</p>
            <p className="text-2xl font-bold">{pendingOrders.length}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Trọng lượng chờ</p>
            <p className="text-2xl font-bold">{totalWeightPending.toLocaleString()} kg</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="p-3 bg-red-100 text-red-600 rounded-lg">
                <FileWarning className="w-6 h-6" />
            </div>
            <div>
                <p className="text-sm text-slate-500">Đơn hoàn / Sự cố</p>
                <p className="text-2xl font-bold">{totalReturnedInTrips}</p>
            </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
           <button 
             onClick={handleSmartDispatch}
             disabled={isThinking || pendingOrders.length === 0}
             className="w-full h-full flex items-center justify-center gap-2 bg-gradient-to-r from-brand-600 to-indigo-600 text-white rounded-lg hover:shadow-lg transition disabled:opacity-50"
           >
             {isThinking ? (
               <>
                 <BrainCircuit className="w-5 h-5 animate-spin" /> Đang tính toán...
               </>
             ) : (
               <>
                 <BrainCircuit className="w-5 h-5" /> Gợi ý Điều Phối AI
               </>
             )}
           </button>
        </div>
      </div>

      {/* AI Suggestions Panel */}
      {aiSuggestions.length > 0 && (
        <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 animate-fade-in">
          <h3 className="font-bold text-indigo-900 mb-3 flex items-center gap-2">
            <BrainCircuit className="w-5 h-5" /> Đề xuất từ Gemini
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {aiSuggestions.map((sug, idx) => {
               const v = vehicles.find(vh => vh.id === sug.vehicleId);
               const w = pendingOrders.filter(o => sug.orderIds.includes(o.id)).reduce((a,b) => a + b.totalWeight, 0);
               return (
                 <div key={idx} className="bg-white p-4 rounded-lg shadow-sm border border-indigo-100">
                   <div className="flex justify-between mb-2">
                     <span className="font-bold text-slate-800">{v?.plateNumber} ({v?.type})</span>
                     <span className="text-sm font-medium text-slate-600">Tải: {w}kg / {v?.capacityKg}kg</span>
                   </div>
                   <p className="text-xs text-slate-500 italic mb-3">"{sug.reasoning}"</p>
                   <div className="flex gap-2">
                     <div className="flex-1 text-xs bg-slate-100 p-2 rounded">
                       {sug.orderIds.length} đơn hàng
                     </div>
                     <button 
                       onClick={() => applySuggestion(sug)}
                       className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700"
                     >
                       Chấp nhận
                     </button>
                   </div>
                 </div>
               )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[600px]">
        {/* Left: Pending Orders */}
        <div className="lg:col-span-5 flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <h3 className="font-semibold text-slate-800">Đơn hàng chờ ({pendingOrders.length})</h3>
            <span className="text-xs text-slate-500">{selectedOrders.length} đã chọn</span>
          </div>
          <div className="overflow-y-auto flex-1 p-2 space-y-2 custom-scrollbar">
            {pendingOrders.length === 0 ? (
              <div className="text-center p-8 text-slate-400">Không có đơn hàng chờ</div>
            ) : (
              pendingOrders.map(order => (
                <div 
                  key={order.id}
                  onClick={() => toggleSelectOrder(order.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition relative ${selectedOrders.includes(order.id) ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-brand-300'}`}
                >
                  <div className="flex justify-between items-start">
                     <div>
                        <div className="font-medium text-slate-800">{order.distributorName}</div>
                        <div className="text-xs text-slate-500">{order.id} • {order.requestDate}</div>
                     </div>
                     <div className="text-right">
                        <div className="font-bold text-slate-700">{order.totalWeight} kg</div>
                        <div className="text-xs text-slate-500">{order.items.length} SP</div>
                     </div>
                  </div>
                  {order.note && (
                    <div className="mt-2 text-xs bg-orange-50 text-orange-700 p-1 rounded inline-block">
                       {order.note}
                    </div>
                  )}
                  {selectedOrders.includes(order.id) && (
                    <div className="absolute top-2 right-2 text-brand-600">
                      <CheckCircle2 className="w-5 h-5 fill-brand-100" />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          
          {selectedOrders.length > 0 && (
            <div className="p-4 border-t border-slate-100 bg-slate-50">
              <p className="text-sm font-medium mb-2">Gán vào xe:</p>
              <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                {vehicles
                    .filter(v => {
                        // Allow if Available
                        if (v.status === 'AVAILABLE') return true;
                        // Allow if Busy but trip is Planned or Waiting Load
                        const activeTrip = trips.find(t => t.vehicleId === v.id && t.status !== TripStatus.COMPLETED);
                        if (activeTrip && (activeTrip.status === TripStatus.PLANNED || activeTrip.status === TripStatus.WAITING_LOAD)) {
                            return true;
                        }
                        return false;
                    })
                    .map(v => {
                        const existingTrip = trips.find(t => t.vehicleId === v.id && t.status !== TripStatus.COMPLETED);
                        return (
                            <button 
                                key={v.id}
                                onClick={() => handleManualCreateTrip(v.id)}
                                className="flex-shrink-0 bg-white border border-slate-200 hover:border-brand-500 rounded-lg p-2 min-w-[120px] text-left group transition shadow-sm"
                            >
                                <div className="font-bold text-sm text-slate-800 group-hover:text-brand-600">{v.plateNumber}</div>
                                <div className="text-xs text-slate-500">{v.type}</div>
                                
                                {/* Visual indicator if vehicle already has a planned/waiting trip */}
                                {existingTrip && existingTrip.status === TripStatus.PLANNED && (
                                <div className="mt-1 text-[10px] text-blue-600 bg-blue-50 px-1 rounded inline-flex items-center gap-1 font-medium border border-blue-100">
                                    <PlusCircle className="w-3 h-3"/> Ghép chuyến
                                </div>
                                )}
                                {existingTrip && existingTrip.status === TripStatus.WAITING_LOAD && (
                                <div className="mt-1 text-[10px] text-orange-600 bg-orange-50 px-1 rounded inline-flex items-center gap-1 font-medium border border-orange-100">
                                    <PlusCircle className="w-3 h-3"/> Đang chờ bốc
                                </div>
                                )}
                            </button>
                        );
                    })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Active Trips */}
        <div className="lg:col-span-7 flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <h3 className="font-semibold text-slate-800">Kế hoạch vận chuyển ({trips.length})</h3>
          </div>
          <div className="overflow-y-auto flex-1 p-4 space-y-4 custom-scrollbar">
            {trips.length === 0 ? (
               <div className="text-center p-10 text-slate-400">Chưa có chuyến xe nào được tạo</div>
            ) : (
              trips.map(trip => {
                const loadPercentage = Math.round((trip.currentLoad / trip.maxCapacity) * 100);
                const isOverloaded = loadPercentage > 100;
                const progress = getStatusProgress(trip.status);
                const isReturning = trip.status === TripStatus.RETURNING;

                // Return Stats Logic
                const isPartialReturn = trip.orders.some(o => o.status === OrderStatus.PARTIAL_RETURNED);
                const isFullReturn = trip.orders.every(o => o.status === OrderStatus.RETURNED);
                
                return (
                  <div key={trip.id} className={`border rounded-xl p-4 bg-slate-50 relative overflow-hidden transition-all ${
                        isOverloaded ? 'border-red-300 ring-2 ring-red-100' : 
                        isReturning ? 'border-orange-300 bg-orange-50 ring-2 ring-orange-100' :
                        'border-slate-200'
                    }`}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full border ${isReturning ? 'bg-orange-100 border-orange-200' : 'bg-white border-slate-200'}`}>
                          {isReturning ? <RotateCcw className="w-5 h-5 text-orange-600 animate-spin-slow" /> : <Truck className="w-5 h-5 text-slate-600" />}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-800 flex items-center gap-2">
                            {trip.vehiclePlate} 
                            <span className="text-slate-400 font-normal text-sm">| {trip.code}</span>
                            {/* Tags for Partial / Full Return on Trip Header */}
                            {isPartialReturn && (
                                <span className="text-[10px] uppercase font-bold text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded border border-yellow-200">
                                    Hoàn 1 phần
                                </span>
                            )}
                            {isFullReturn && (
                                <span className="text-[10px] uppercase font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded border border-red-200">
                                    Hoàn toàn bộ
                                </span>
                            )}
                          </h4>
                          <p className="text-sm text-slate-500">{trip.driverName} • {trip.route}</p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${
                          trip.status === TripStatus.PLANNED ? 'bg-blue-100 text-blue-700 border-blue-200' : 
                          isReturning ? 'bg-orange-100 text-orange-700 border-orange-200' :
                          'bg-green-100 text-green-700 border-green-200'
                      }`}>
                        {trip.status}
                      </span>
                    </div>
                    
                    {/* Load Bar */}
                    <div className="mb-4">
                      <div className="flex justify-between text-xs mb-1">
                        <span>Tải trọng: {trip.currentLoad.toLocaleString()} / {trip.maxCapacity.toLocaleString()} kg</span>
                        <span className={isOverloaded ? 'text-red-600 font-bold' : 'text-slate-600'}>{loadPercentage}%</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                        <div 
                          className={`h-2.5 rounded-full ${isOverloaded ? 'bg-red-500' : isReturning ? 'bg-orange-500' : 'bg-green-500'}`} 
                          style={{ width: `${Math.min(loadPercentage, 100)}%` }}
                        ></div>
                      </div>
                      {isOverloaded && (
                          <div className="flex items-center justify-between mt-1">
                              <div className="text-red-500 text-xs flex items-center gap-1 font-bold animate-pulse">
                                  <AlertCircle className="w-3 h-3"/> Quá tải trọng!
                              </div>
                              {(trip.status === TripStatus.PLANNED || trip.status === TripStatus.WAITING_LOAD) && (
                                <button 
                                    onClick={() => openReallocateModal(trip)}
                                    className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 font-medium flex items-center gap-1 border border-red-200"
                                >
                                    <ArrowRightLeft className="w-3 h-3" /> San tải
                                </button>
                              )}
                          </div>
                      )}
                    </div>

                    {/* Orders List in Trip */}
                    <div className="bg-white rounded-lg border border-slate-200 p-2 mb-4">
                       <div className="flex justify-between items-center mb-2">
                           <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Danh sách đơn hàng ({trip.orders.length})</p>
                       </div>
                       <div className="space-y-1">
                          {trip.orders.map(o => (
                            <div key={o.id} className="flex justify-between text-sm py-1 border-b border-slate-50 last:border-0 items-center">
                               <div className="flex items-center gap-2">
                                  <span>{o.distributorName} <span className="text-xs text-slate-400">({o.id})</span></span>
                                  {o.status === OrderStatus.RETURNED && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-bold">Hoàn toàn bộ</span>
                                  )}
                                  {o.status === OrderStatus.PARTIAL_RETURNED && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded font-bold">Hoàn 1 phần</span>
                                  )}
                                   {o.status === OrderStatus.DELIVERED && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold">OK</span>
                                  )}
                               </div>
                               <div className="flex items-center gap-2">
                                    <span className="text-slate-500">{o.totalWeight}kg</span>
                                    {/* Quick Return Action */}
                                    {(trip.status === TripStatus.DELIVERING || trip.status === TripStatus.RETURNING) && o.status !== OrderStatus.DELIVERED && o.status !== OrderStatus.RETURNED && (
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); openReturnModal(trip, o.id); }}
                                            className="text-orange-400 hover:text-orange-600 p-1 hover:bg-orange-50 rounded transition"
                                            title="Báo hoàn đơn hàng này"
                                        >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                               </div>
                            </div>
                          ))}
                       </div>
                    </div>

                    {/* Workflow Status View (Read Only for Dispatcher) */}
                    <div className="bg-white rounded-lg border border-slate-200 p-3">
                         <div className="flex justify-between items-center mb-3">
                             <div className="flex space-x-1">
                                 {[0, 1, 2, 3, 4, 5].map(step => (
                                     <div key={step} className={`h-1.5 w-6 rounded-full ${
                                         step <= progress.currentIndex ? (progress.isReturning ? 'bg-orange-500' : 'bg-brand-500') : 'bg-slate-200'
                                     }`}></div>
                                 ))}
                             </div>
                             
                             <span className="text-xs text-slate-400 italic">Trạng thái: {trip.status}</span>
                         </div>
                    </div>

                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Reallocate Modal */}
      {isReallocateModalOpen && reallocateSourceTrip && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
                 <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <ArrowRightLeft className="w-6 h-6 text-brand-600" /> Điều chuyển đơn hàng (San tải)
                    </h3>
                    <button onClick={() => setIsReallocateModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-3xl leading-none">&times;</button>
                 </div>
                 
                 <div className="p-6 overflow-y-auto">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start relative">
                         {/* Left: Source Trip */}
                         <div className="space-y-4">
                             <h4 className="font-bold text-red-600 flex items-center gap-2 border-b pb-2">
                                 <AlertCircle className="w-5 h-5"/> Từ: {reallocateSourceTrip.vehiclePlate}
                                 <span className="text-xs bg-red-100 px-2 py-0.5 rounded-full ml-auto">Quá tải</span>
                             </h4>
                             <p className="text-sm text-slate-500">Chọn 1 đơn hàng để chuyển đi:</p>
                             
                             <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                 {reallocateSourceTrip.orders.map(order => (
                                     <div 
                                        key={order.id}
                                        onClick={() => setSelectedOrderToMove(order.id)}
                                        className={`p-3 border rounded-lg cursor-pointer transition flex justify-between items-center ${
                                            selectedOrderToMove === order.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-brand-300'
                                        }`}
                                     >
                                         <div>
                                             <div className="font-bold text-slate-700">{order.distributorName}</div>
                                             <div className="text-xs text-slate-500">{order.items.length} SP</div>
                                         </div>
                                         <div className="text-right">
                                             <div className="font-bold text-brand-600">{order.totalWeight} kg</div>
                                         </div>
                                     </div>
                                 ))}
                             </div>
                         </div>

                         {/* Arrow Center (Desktop) */}
                         <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-white p-2 rounded-full shadow border border-slate-200">
                             <ArrowRight className="w-6 h-6 text-slate-400" />
                         </div>

                         {/* Right: Target Vehicle */}
                         <div className="space-y-4">
                             <h4 className="font-bold text-green-600 flex items-center gap-2 border-b pb-2">
                                 <Truck className="w-5 h-5"/> Đến xe: 
                             </h4>
                             <p className="text-sm text-slate-500">Chọn xe đích để nhận hàng:</p>

                             <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                 {vehicles.filter(v => v.id !== reallocateSourceTrip.vehicleId).map(v => {
                                     // Check eligibility (Available or Active & Planned/Waiting)
                                     const existingTrip = trips.find(t => t.vehicleId === v.id && t.status !== TripStatus.COMPLETED);
                                     
                                     // Prevent assignment if vehicle is busy with non-mergeable trip
                                     if (existingTrip && existingTrip.status !== TripStatus.PLANNED && existingTrip.status !== TripStatus.WAITING_LOAD) {
                                         return null;
                                     }
                                     
                                     // Calculate potential load
                                     const currentLoad = existingTrip ? existingTrip.currentLoad : 0;
                                     const addedWeight = selectedOrderToMove 
                                        ? (reallocateSourceTrip.orders.find(o => o.id === selectedOrderToMove)?.totalWeight || 0) 
                                        : 0;
                                     const newLoad = currentLoad + addedWeight;
                                     const percent = Math.min((newLoad / v.capacityKg) * 100, 100);
                                     const isFull = newLoad > v.capacityKg;

                                     return (
                                         <div 
                                            key={v.id}
                                            onClick={() => !isFull && setSelectedTargetVehicle(v.id)}
                                            className={`p-3 border rounded-lg cursor-pointer transition ${
                                                selectedTargetVehicle === v.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 
                                                isFull ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed' : 'border-slate-200 hover:border-brand-300'
                                            }`}
                                         >
                                             <div className="flex justify-between mb-2">
                                                 <span className="font-bold text-slate-700">{v.plateNumber}</span>
                                                 <span className="text-xs text-slate-500">{v.type}</span>
                                             </div>
                                             
                                             {/* Visual Load Bar Preview */}
                                             <div className="w-full bg-slate-200 rounded-full h-2 mb-1">
                                                 <div className={`h-2 rounded-full transition-all ${isFull ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${percent}%` }}></div>
                                             </div>
                                             <div className="flex justify-between text-xs">
                                                 <span className="text-slate-500">
                                                     {currentLoad} {addedWeight > 0 && <span className="text-brand-600 font-bold">+{addedWeight}</span>} / {v.capacityKg} kg
                                                 </span>
                                                 {existingTrip && (
                                                     <span className="text-blue-600 font-bold">
                                                         {existingTrip.status === TripStatus.PLANNED ? 'Gộp chuyến' : 'Đang chờ bốc'}
                                                     </span>
                                                 )}
                                             </div>
                                         </div>
                                     );
                                 })}
                             </div>
                         </div>
                     </div>
                 </div>

                 <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                     <button 
                        onClick={() => setIsReallocateModalOpen(false)}
                        className="px-6 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 font-medium"
                     >
                         Hủy bỏ
                     </button>
                     <button 
                        onClick={submitReallocation}
                        disabled={!selectedOrderToMove || !selectedTargetVehicle}
                        className="px-6 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                     >
                         <ArrowRightLeft className="w-4 h-4" /> Xác nhận điều chuyển
                     </button>
                 </div>
             </div>
          </div>
      )}

      {/* Return/Fail Modal with Partial Return Support */}
      {isReturnModalOpen && returnTrip && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
                 <div className="bg-orange-50 px-6 py-4 border-b border-orange-200 flex justify-between items-center flex-shrink-0">
                    <h3 className="text-xl font-bold text-orange-800 flex items-center gap-2">
                        <RotateCcw className="w-6 h-6" /> Hoàn hàng / Trả hàng 1 phần
                    </h3>
                    <button onClick={() => setIsReturnModalOpen(false)} className="text-orange-400 hover:text-orange-600 text-3xl leading-none">&times;</button>
                 </div>
                 
                 <div className="p-6 overflow-y-auto flex-1">
                    <p className="text-sm text-slate-600 mb-4 bg-orange-50 p-3 rounded-lg border border-orange-100">
                        Chọn số lượng hàng bị hoàn trả. Đơn hàng sẽ được chuyển sang trạng thái <b>Hoàn 1 phần</b> hoặc <b>Hoàn toàn bộ</b>.
                    </p>
                    
                    <div className="space-y-3 mb-5">
                        {returnTrip.orders.filter(o => o.status !== OrderStatus.DELIVERED && o.status !== OrderStatus.RETURNED).map(order => {
                             const isExpanded = expandedOrders.includes(order.id);
                             const hasReturns = returnDetails[order.id] && Object.values(returnDetails[order.id]).some((v: number) => v > 0);
                             
                             return (
                                <div key={order.id} className={`border rounded-xl overflow-hidden ${hasReturns ? 'border-orange-300 bg-orange-50/50' : 'border-slate-200'}`}>
                                     {/* Order Header */}
                                     <div 
                                        className="p-3 bg-white flex justify-between items-center cursor-pointer hover:bg-slate-50"
                                        onClick={() => toggleExpandOrder(order.id)}
                                     >
                                         <div className="flex items-center gap-3">
                                             {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400"/> : <ChevronDown className="w-4 h-4 text-slate-400"/>}
                                             <div>
                                                 <div className="font-bold text-slate-700">{order.distributorName}</div>
                                                 <div className="text-xs text-slate-500">{order.id} • {order.items.length} loại sản phẩm</div>
                                             </div>
                                         </div>
                                         {hasReturns && (
                                             <span className="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-1 rounded">
                                                 Có hoàn trả
                                             </span>
                                         )}
                                     </div>
                                     
                                     {/* Product List (Collapsible) */}
                                     {isExpanded && (
                                         <div className="bg-slate-50 p-3 border-t border-slate-100 space-y-2">
                                             <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-500 mb-2 px-1">
                                                 <div className="col-span-6">Sản phẩm</div>
                                                 <div className="col-span-3 text-right">Đã gửi</div>
                                                 <div className="col-span-3 text-right">Hoàn lại</div>
                                             </div>
                                             {order.items.map(item => {
                                                 const currentReturnQty = returnDetails[order.id]?.[item.productId] || 0;
                                                 return (
                                                     <div key={item.productId} className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded border border-slate-200">
                                                         <div className="col-span-6 text-sm text-slate-700 font-medium">
                                                             {item.productName}
                                                         </div>
                                                         <div className="col-span-3 text-right text-sm text-slate-500">
                                                             {item.quantity}
                                                         </div>
                                                         <div className="col-span-3 flex justify-end">
                                                             <input 
                                                                type="number"
                                                                min="0"
                                                                max={item.quantity}
                                                                className={`w-20 p-1 text-right text-sm border rounded focus:ring-2 outline-none ${currentReturnQty > 0 ? 'border-orange-400 ring-orange-200 font-bold text-orange-700' : 'border-slate-300'}`}
                                                                value={currentReturnQty || ''}
                                                                placeholder="0"
                                                                onClick={(e) => e.stopPropagation()}
                                                                onChange={(e) => {
                                                                    const val = parseInt(e.target.value) || 0;
                                                                    const safeVal = Math.min(Math.max(0, val), item.quantity);
                                                                    updateReturnQuantity(order.id, item.productId, safeVal);
                                                                }}
                                                             />
                                                         </div>
                                                     </div>
                                                 );
                                             })}
                                         </div>
                                     )}
                                </div>
                             );
                        })}
                        
                        {returnTrip.orders.filter(o => o.status !== OrderStatus.DELIVERED && o.status !== OrderStatus.RETURNED).length === 0 && (
                            <div className="text-center text-slate-400 text-sm">Tất cả đơn hàng đã được giao hoặc xử lý.</div>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Lý do hoàn hàng / Sự cố chung</label>
                        <textarea 
                            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                            rows={3}
                            placeholder="VD: Khách đóng cửa, hàng hỏng, khách từ chối nhận..."
                            value={returnReason}
                            onChange={(e) => setReturnReason(e.target.value)}
                        ></textarea>
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <button 
                            onClick={() => setIsReturnModalOpen(false)}
                            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                        >
                            Hủy
                        </button>
                        <button 
                            onClick={submitReturn}
                            disabled={Object.keys(returnDetails).length === 0}
                            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-2"
                        >
                            <RotateCcw className="w-4 h-4"/> Xác nhận Hoàn
                        </button>
                    </div>
                 </div>
             </div>
          </div>
      )}
    </div>
  );
};

export default Dispatch;
