
import React, { useState, useEffect, useRef } from 'react';
import { ModuleName, Distributor, Product, Order, Vehicle, Trip, OrderStatus, CostRecord, TripStatus, AdvanceRecord, SalaryRecord, WarehouseReceipt, ReturnLog } from './types';
import { useApp } from '../../app/store';
import type { DispatchConfig } from './services/dispatchEngine';
import { buildAdvanceVoucher, advanceVoucherId } from './services/advanceAccounting';

import Distributors from './components/Distributors';
import Dispatch from './components/Dispatch';
import Fleet from './components/Fleet';
import Dashboard from './components/Dashboard';
import Orders from './components/Orders';
import Products from './components/Products';

const MODULE_LABELS: Record<ModuleName, string> = {
  [ModuleName.DASHBOARD]: 'Tổng quan',
  [ModuleName.DISTRIBUTORS]: 'Nhà phân phối',
  [ModuleName.PRODUCTS]: 'Sản phẩm',
  [ModuleName.ORDERS]: 'Đơn hàng',
  [ModuleName.DISPATCH]: 'Điều phối',
  [ModuleName.FLEET]: 'Đội xe & Tài xế',
  [ModuleName.REPORTS]: 'Báo cáo',
};

const toModuleName = (value: string): ModuleName => {
  const normalized = String(value || '').trim().toUpperCase();
  if ((Object.values(ModuleName) as string[]).includes(normalized)) {
    return normalized as ModuleName;
  }
  return ModuleName.DASHBOARD;
};

type DeliveryPageProps = {
  initialModule?: ModuleName | string;
  embedded?: boolean;
  visible?: boolean;
};

// Simple placeholder components for modules not fully detailed in the strict file limit
const PlaceholderModule = ({ title }: { title: string }) => (
  <div className="p-10 text-center bg-white rounded-xl shadow-sm border border-dashed border-slate-300">
    <h2 className="text-2xl font-bold text-slate-300 mb-2">{title}</h2>
    <p className="text-slate-500">Module này đang được cập nhật.</p>
  </div>
);

const App: React.FC<DeliveryPageProps> = ({
  initialModule = ModuleName.DASHBOARD,
  embedded = false,
  visible = true,
}) => {
  const [activeModule, setActiveModule] = useState<ModuleName>(() => toModuleName(String(initialModule)));

  // Nguồn dữ liệu dùng chung — persist SQLite + đồng bộ realtime đa máy qua store.
  const { deliveryState, setDeliveryState, accountingVouchers, handleSaveVoucher, handleDeleteVoucher } = useApp();

  // Global State (khởi tạo từ dữ liệu đã lưu của store)
  const [distributors, setDistributors] = useState<Distributor[]>(deliveryState.distributors);
  const [products, setProducts] = useState<Product[]>(deliveryState.products);
  const [orders, setOrders] = useState<Order[]>(deliveryState.orders);
  const [vehicles, setVehicles] = useState<Vehicle[]>(deliveryState.vehicles);
  const [trips, setTrips] = useState<Trip[]>(deliveryState.trips);
  const [costs, setCosts] = useState<CostRecord[]>(deliveryState.costs);
  const [advances, setAdvances] = useState<AdvanceRecord[]>(deliveryState.advances);
  const [salaries, setSalaries] = useState<SalaryRecord[]>(deliveryState.salaries);
  
  // NEW STATE: Warehouse Receipts for Returns & Return Logs
  const [warehouseReceipts, setWarehouseReceipts] = useState<WarehouseReceipt[]>(deliveryState.warehouseReceipts);
  const [returnLogs, setReturnLogs] = useState<ReturnLog[]>(deliveryState.returnLogs);

  // Cấu hình Bộ máy điều phối (thuật toán + Rule Engine), persist & realtime
  const [dispatchConfig, setDispatchConfig] = useState<DispatchConfig>(deliveryState.dispatchConfig);

  // --- Đồng bộ 2 chiều state cục bộ <-> store (persist + realtime) ---
  // lastSyncedRef giữ JSON của lần đồng bộ gần nhất để tránh vòng lặp push/apply.
  // Khởi tạo bằng snapshot ban đầu để KHÔNG ghi persist thừa ngay khi mở tab.
  const lastSyncedRef = useRef<string>(JSON.stringify(deliveryState));

  // Local -> store: khi người dùng thao tác, đẩy snapshot lên store để persist.
  useEffect(() => {
    const snapshot = {
      distributors,
      products,
      orders,
      vehicles,
      trips,
      costs,
      advances,
      salaries,
      warehouseReceipts,
      returnLogs,
      dispatchConfig,
    };
    const body = JSON.stringify(snapshot);
    if (body === lastSyncedRef.current) return;
    lastSyncedRef.current = body;
    setDeliveryState(snapshot);
  }, [distributors, products, orders, vehicles, trips, costs, advances, salaries, warehouseReceipts, returnLogs, dispatchConfig, setDeliveryState]);

  // Store -> local: khi có thay đổi từ máy khác (realtime) hoặc tải lại từ server.
  useEffect(() => {
    const body = JSON.stringify(deliveryState);
    if (body === lastSyncedRef.current) return; // chính echo của mình -> bỏ qua
    lastSyncedRef.current = body;
    setDistributors(deliveryState.distributors);
    setProducts(deliveryState.products);
    setOrders(deliveryState.orders);
    setVehicles(deliveryState.vehicles);
    setTrips(deliveryState.trips);
    setCosts(deliveryState.costs);
    setAdvances(deliveryState.advances);
    setSalaries(deliveryState.salaries);
    setWarehouseReceipts(deliveryState.warehouseReceipts);
    setReturnLogs(deliveryState.returnLogs);
    setDispatchConfig(deliveryState.dispatchConfig);
  }, [deliveryState]);

  useEffect(() => {
    setActiveModule(toModuleName(String(initialModule)));
  }, [initialModule]);

  // Handlers
  const handleAddDistributor = (d: Distributor) => setDistributors(prev => [...prev, d]);
  const handleUpdateDistributor = (d: Distributor) =>
    setDistributors(prev => prev.map(item => item.id === d.id ? d : item));
  const handleDeleteDistributor = (id: string) => setDistributors(prev => prev.filter(d => d.id !== id));
  
  // Product Handlers
  const handleAddProduct = (p: Product) => setProducts(prev => [...prev, p]);
  const handleUpdateProduct = (p: Product) => setProducts(prev => prev.map(item => item.id === p.id ? p : item));
  const handleDeleteProduct = (id: string) => setProducts(prev => prev.filter(p => p.id !== id));

  const handleCreateTrip = (trip: Trip) => setTrips(prev => [...prev, trip]);
  const handleUpdateTrip = (updatedTrip: Trip) => setTrips(prev => prev.map(t => t.id === updatedTrip.id ? updatedTrip : t));
  
  const handleUpdateTripStatus = (tripId: string, status: TripStatus) => {
    // 1. Find the trip to get vehicle ID and Orders
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;

    // 2. Determine corresponding Order Status
    let newOrderStatus: OrderStatus | null = null;
    if (status === TripStatus.IN_TRANSIT || status === TripStatus.DELIVERING) {
        newOrderStatus = OrderStatus.IN_TRANSIT;
    } else if (status === TripStatus.COMPLETED) {
        // Only set pending orders to DELIVERED. Returned orders should stay RETURNED.
        newOrderStatus = OrderStatus.DELIVERED;
    }

    // 3. Update Trips State (and the orders inside the trip object)
    setTrips(prev => prev.map(t => {
      if (t.id === tripId) {
        const updatedOrders = t.orders.map(o => {
            // Do not override Return status when completing trip
            if (o.status === OrderStatus.RETURNED || o.status === OrderStatus.PARTIAL_RETURNED) return o;
            
            if (newOrderStatus) return { ...o, status: newOrderStatus };
            return o;
        });
        return { ...t, status: status, orders: updatedOrders };
      }
      return t;
    }));

    // 4. Update Global Orders State
    if (newOrderStatus) {
        const orderIds = trip.orders.map(o => o.id);
        setOrders(prev => prev.map(o => {
            if (orderIds.includes(o.id)) {
                 // Do not override Return status when completing trip
                if (o.status === OrderStatus.RETURNED || o.status === OrderStatus.PARTIAL_RETURNED) return o;
                return { ...o, status: newOrderStatus! };
            }
            return o;
        }));
    }

    // 5. Update Vehicle Status (Side Effects)
    if (status === TripStatus.WAITING_LOAD || status === TripStatus.LOADING) {
        // Lock vehicle
        setVehicles(prev => prev.map(v => v.id === trip.vehicleId ? { ...v, status: 'BUSY' } : v));
    } else if (status === TripStatus.COMPLETED) {
        // Release vehicle
        setVehicles(prev => prev.map(v => v.id === trip.vehicleId ? { ...v, status: 'AVAILABLE' } : v));
    }
    // Note: RETURNING status keeps vehicle BUSY, which is correct.
  };

  // Deprecated: Old Request/Approve flow (Kept for compatibility if needed, but superseded by handleDriverSubmitReturn)
  const handleTripReturnAction = (tripId: string, action: 'REQUEST' | 'APPROVE', returnWarehouse?: string) => {
      setTrips(prev => prev.map(t => {
          if (t.id === tripId) {
              if (action === 'REQUEST') {
                  return { ...t, returnStatus: 'REQUESTED' };
              } else if (action === 'APPROVE') {
                  return { 
                      ...t, 
                      returnStatus: 'APPROVED', 
                      returnWarehouse: returnWarehouse,
                      status: TripStatus.RETURNING 
                  };
              }
          }
          return t;
      }));
  };

  // NEW: Driver Direct Input & Warehouse Selection
  const handleDriverSubmitReturn = (tripId: string, returnData: { orderId: string, productId: string, quantity: number }[], warehouseName: string, warehouseAddress: string, note: string, receiver: string, receiverPhone: string) => {
      const trip = trips.find(t => t.id === tripId);
      if (!trip) return;

      // 1. Create Log Entry
      const logEntry: ReturnLog = {
          id: `LOG-${Date.now()}`,
          date: new Date().toISOString(),
          vehicleId: trip.vehicleId,
          vehiclePlate: trip.vehiclePlate,
          tripId: tripId,
          returnWarehouse: warehouseName,
          returnWarehouseAddress: warehouseAddress, // NEW
          receiver: receiver, 
          receiverPhone: receiverPhone, 
          items: returnData.map(item => {
              const order = trip.orders.find(o => o.id === item.orderId);
              const product = order?.items.find(i => i.productId === item.productId);
              return {
                  orderId: item.orderId,
                  distributorName: order?.distributorName || 'Unknown',
                  productName: product?.productName || 'Unknown',
                  quantity: item.quantity
              };
          }),
          note: note
      };
      setReturnLogs(prev => [logEntry, ...prev]);

      // 2. Reuse logic to update Orders and Warehouse Receipts
      // Transform flat returnData to structure expected by handleReturnOrders
      const groupedData = returnData.reduce((acc, curr) => {
          const existing = acc.find(x => x.orderId === curr.orderId);
          if (existing) {
              existing.items.push({ productId: curr.productId, quantity: curr.quantity });
          } else {
              acc.push({ orderId: curr.orderId, items: [{ productId: curr.productId, quantity: curr.quantity }] });
          }
          return acc;
      }, [] as { orderId: string, items: { productId: string, quantity: number }[] }[]);

      handleReturnOrders(tripId, groupedData, note, receiver, receiverPhone, warehouseName, warehouseAddress);

      // 3. Explicitly set Trip Return Warehouse and Status
      setTrips(prev => prev.map(t => {
          if (t.id === tripId) {
              return { 
                  ...t, 
                  status: TripStatus.RETURNING,
                  returnStatus: 'APPROVED', // Skip approval, direct entry
                  returnWarehouse: warehouseName
              };
          }
          return t;
      }));
  };

  const handleReturnOrders = (
      tripId: string, 
      returnData: { orderId: string, items: { productId: string, quantity: number }[] }[], 
      reason: string, 
      receiver?: string, 
      receiverPhone?: string,
      returnWarehouse?: string, // Added param
      returnWarehouseAddress?: string // Added param
  ) => {
      const updateOrderLogic = (order: Order) => {
           const instructions = returnData.find(d => d.orderId === order.id);
           
           if (instructions) {
               const updatedItems = order.items.map(item => {
                   const returned = instructions.items.find(ri => ri.productId === item.productId);
                   return returned ? { ...item, returnedQuantity: returned.quantity } : item;
               });

               const totalQty = updatedItems.reduce((acc, i) => acc + i.quantity, 0);
               const totalReturned = updatedItems.reduce((acc, i) => acc + (i.returnedQuantity || 0), 0);

               let newStatus = order.status;
               if (totalReturned === 0) {
                   newStatus = OrderStatus.DELIVERED;
               } else if (totalReturned >= totalQty) {
                   newStatus = OrderStatus.RETURNED; 
               } else {
                   newStatus = OrderStatus.PARTIAL_RETURNED; 
               }

               if (totalReturned > 0) {
                   const receipt: WarehouseReceipt = {
                       id: `PNK-HOAN-${Date.now()}-${order.id.split('-').pop()}`,
                       date: new Date().toISOString().split('T')[0],
                       type: 'RETURN',
                       orderId: order.id,
                       receiver: receiver,
                       receiverPhone: receiverPhone,
                       returnWarehouse: returnWarehouse, // Pass data
                       returnWarehouseAddress: returnWarehouseAddress, // Pass data
                       items: updatedItems
                           .filter(i => (i.returnedQuantity || 0) > 0)
                           .map(i => ({
                               productId: i.productId,
                               productName: i.productName,
                               quantity: i.returnedQuantity || 0
                           })),
                       note: `Nhập kho hàng hoàn từ đơn ${order.id}. Lý do: ${reason}`
                   };
                   
                   setWarehouseReceipts(prev => [...prev, receipt]);
               }

               return { 
                   ...order, 
                   items: updatedItems,
                   status: newStatus,
                   note: order.note ? `${order.note} | Hoàn: ${reason}` : `Hoàn: ${reason}`,
                   returnDate: new Date().toISOString().split('T')[0] 
               };
           }
           return order;
      };

      setOrders(prev => prev.map(o => {
          if (returnData.some(d => d.orderId === o.id)) {
              return updateOrderLogic(o);
          }
          return o;
      }));

      setTrips(prev => prev.map(t => {
          if (t.id === tripId) {
              const updatedOrders = t.orders.map(o => {
                  if (returnData.some(d => d.orderId === o.id)) {
                       return updateOrderLogic(o);
                  }
                  return o;
              });
              
              return { 
                  ...t, 
                  orders: updatedOrders,
                  status: t.status === TripStatus.DELIVERING ? TripStatus.RETURNING : t.status 
              };
          }
          return t;
      }));
  };

  const handleMoveOrder = (orderId: string, fromTripId: string, targetVehicleId: string) => {
    // 1. Find the order info
    const orderToMove = orders.find(o => o.id === orderId);
    if (!orderToMove) return;

    setTrips(currentTrips => {
      const tripsCopy = [...currentTrips];
      
      // 2. Remove from Source Trip
      const sourceTripIndex = tripsCopy.findIndex(t => t.id === fromTripId);
      if (sourceTripIndex === -1) return currentTrips;

      const sourceTrip = { ...tripsCopy[sourceTripIndex] };
      sourceTrip.orders = sourceTrip.orders.filter(o => o.id !== orderId);
      sourceTrip.currentLoad -= orderToMove.totalWeight;
      
      // If source trip becomes empty, we could delete it, but let's keep it for now or delete if needed
      if (sourceTrip.orders.length === 0) {
        tripsCopy.splice(sourceTripIndex, 1);
      } else {
        tripsCopy[sourceTripIndex] = sourceTrip;
      }

      // 3. Add to Target Trip (Merge or Create)
      const targetTripIndex = tripsCopy.findIndex(t => t.vehicleId === targetVehicleId && t.status === TripStatus.PLANNED);
      
      if (targetTripIndex > -1) {
        // Merge into existing planned trip
        const targetTrip = { ...tripsCopy[targetTripIndex] };
        targetTrip.orders = [...targetTrip.orders, orderToMove];
        targetTrip.currentLoad += orderToMove.totalWeight;
        tripsCopy[targetTripIndex] = targetTrip;
        
        // Update Order Ref
        handleUpdateOrder({ ...orderToMove, tripId: targetTrip.id });
      } else {
        // Create new trip
        const targetVehicle = vehicles.find(v => v.id === targetVehicleId);
        if (targetVehicle) {
           const newTrip: Trip = {
            id: `TRIP-${Date.now()}`,
            code: `CX-${Math.floor(Math.random() * 1000)}`,
            date: new Date().toISOString().split('T')[0],
            vehicleId: targetVehicle.id,
            vehiclePlate: targetVehicle.plateNumber,
            driverName: targetVehicle.driverName,
            route: targetVehicle.preferredRoute || 'Tùy chọn',
            maxCapacity: targetVehicle.capacityKg,
            currentLoad: orderToMove.totalWeight,
            orders: [orderToMove],
            note: 'Đã điều chuyển hàng',
            status: TripStatus.PLANNED
          };
          tripsCopy.push(newTrip);
          // Update Order Ref
          handleUpdateOrder({ ...orderToMove, tripId: newTrip.id });
        }
      }

      return tripsCopy;
    });
  };
  
  const handleUpdateOrder = (updatedOrder: Order) => {
    setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
  };

  const handleAddOrder = (newOrder: Order) => {
    setOrders(prev => [newOrder, ...prev]);
  };

  const handleDeleteOrder = (id: string) => {
    if (!id) return;
    setOrders(current => current.filter(o => o.id !== id));
    setTrips(currentTrips => currentTrips.map(trip => {
      const hasOrder = trip.orders.some(o => o.id === id);
      if (hasOrder) {
        const updatedOrders = trip.orders.filter(o => o.id !== id);
        const newLoad = updatedOrders.reduce((sum, o) => sum + o.totalWeight, 0);
        return {
          ...trip,
          orders: updatedOrders,
          currentLoad: newLoad
        };
      }
      return trip;
    }));
  };

  // Fleet Handlers
  const handleAddVehicle = (v: Vehicle) => setVehicles(prev => [...prev, v]);
  const handleUpdateVehicle = (v: Vehicle) => setVehicles(prev => prev.map(item => item.id === v.id ? v : item));
  const handleDeleteVehicle = (id: string) => {
    const hasDispatchTrips = trips.some((t) => t.vehicleId === id);
    if (hasDispatchTrips) {
      window.alert('Xe đã được điều phối — không thể xóa. Vui lòng chỉ sửa thông tin xe.');
      return;
    }
    setVehicles((prev) => prev.filter((v) => v.id !== id));
  };

  // Cost Handlers
  const handleAddCost = (c: CostRecord) => setCosts(prev => [c, ...prev]);
  const handleUpdateCost = (c: CostRecord) => setCosts(prev => prev.map(item => item.id === c.id ? c : item));
  const handleDeleteCost = (id: string) => setCosts(prev => prev.filter(c => c.id !== id));

  // Advance Handlers — đồng bộ Chứng từ + Nhật ký chung + Báo cáo (TT133/2016 & TT58/2026)
  const syncAdvanceVoucher = (a: AdvanceRecord) => {
    const voucher = buildAdvanceVoucher(a);
    if (voucher) {
      handleSaveVoucher(voucher, { skipCashCheck: true });
    }
  };
  const removeAdvanceVoucher = (id: string) => {
    const voucherId = advanceVoucherId(id);
    if (accountingVouchers.some((v) => v.id === voucherId)) {
      void handleDeleteVoucher(voucherId);
    }
  };
  const handleAddAdvance = (a: AdvanceRecord) => {
    setAdvances(prev => [a, ...prev]);
    syncAdvanceVoucher(a);
  };
  const handleUpdateAdvance = (a: AdvanceRecord) => {
    setAdvances(prev => prev.map(item => item.id === a.id ? a : item));
    syncAdvanceVoucher(a);
  };
  const handleDeleteAdvance = (id: string) => {
    setAdvances(prev => prev.filter(a => a.id !== id));
    removeAdvanceVoucher(id);
  };

  // Salary Handlers
  const handleAddSalary = (s: SalaryRecord) => setSalaries(prev => [s, ...prev]);
  const handleUpdateSalary = (s: SalaryRecord) => setSalaries(prev => prev.map(item => item.id === s.id ? s : item));
  const handleDeleteSalary = (id: string) => setSalaries(prev => prev.filter(s => s.id !== id));

  // Delivery Logic (For Fleet "Confirm Delivery" action)
  const handleConfirmDelivery = (tripId: string, orderId: string) => {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: OrderStatus.DELIVERED } : o));
      let vehicleIdToRelease: string | null = null;

      setTrips(prevTrips => {
          return prevTrips.map(trip => {
              if (trip.id === tripId) {
                  const updatedOrders = trip.orders.map(o => o.id === orderId ? { ...o, status: OrderStatus.DELIVERED } : o);
                  const allProcessed = updatedOrders.every(o => 
                      o.status === OrderStatus.DELIVERED || 
                      o.status === OrderStatus.RETURNED || 
                      o.status === OrderStatus.PARTIAL_RETURNED
                  );
                  
                  if (allProcessed) {
                      vehicleIdToRelease = trip.vehicleId; 
                      return {
                          ...trip,
                          orders: updatedOrders,
                          status: TripStatus.COMPLETED
                      };
                  } else {
                      return {
                          ...trip,
                          orders: updatedOrders
                      };
                  }
              }
              return trip;
          });
      });

      if (vehicleIdToRelease) {
          setVehicles(prev => prev.map(v => v.id === vehicleIdToRelease ? { ...v, status: 'AVAILABLE' } : v));
      }
  };

  const renderContent = () => {
    switch (activeModule) {
      case ModuleName.DASHBOARD:
        return (
          <Dashboard 
            orders={orders} 
            vehicles={vehicles} 
            trips={trips}
            distributors={distributors}
          />
        );
      case ModuleName.DISTRIBUTORS:
        return (
          <Distributors
            distributors={distributors}
            onAdd={handleAddDistributor}
            onUpdate={handleUpdateDistributor}
            onDelete={handleDeleteDistributor}
          />
        );
      case ModuleName.DISPATCH:
        return (
          <Dispatch 
            pendingOrders={orders.filter(o => o.status === OrderStatus.CREATED)}
            vehicles={vehicles}
            trips={trips.filter(t => t.status !== TripStatus.COMPLETED)} 
            onCreateTrip={handleCreateTrip}
            onUpdateTrip={handleUpdateTrip}
            onUpdateOrder={handleUpdateOrder}
            onUpdateTripStatus={handleUpdateTripStatus}
            onMoveOrder={handleMoveOrder}
            onReturnOrders={handleReturnOrders}
            dispatchConfig={dispatchConfig}
            onUpdateDispatchConfig={setDispatchConfig}
          />
        );
      case ModuleName.FLEET:
        return (
          <Fleet 
            vehicles={vehicles}
            costs={costs}
            trips={trips}
            orders={orders}
            advances={advances}
            salaries={salaries}
            returnLogs={returnLogs} // Pass return logs
            onAdd={handleAddVehicle}
            onUpdate={handleUpdateVehicle}
            onDelete={handleDeleteVehicle}
            onAddCost={handleAddCost}
            onUpdateCost={handleUpdateCost}
            onDeleteCost={handleDeleteCost}
            onConfirmDelivery={handleConfirmDelivery}
            onAddAdvance={handleAddAdvance}
            onUpdateAdvance={handleUpdateAdvance}
            onDeleteAdvance={handleDeleteAdvance}
            onAddSalary={handleAddSalary}
            onDeleteSalary={handleDeleteSalary}
            onUpdateSalary={handleUpdateSalary}
            onTripReturnAction={handleTripReturnAction} 
            onDriverSubmitReturn={handleDriverSubmitReturn} // Pass new handler
            onUpdateTripStatus={handleUpdateTripStatus} 
          />
        );
      case ModuleName.ORDERS:
        return (
          <Orders 
            orders={orders}
            trips={trips}
            distributors={distributors}
            products={products}
            onAdd={handleAddOrder}
            onUpdate={handleUpdateOrder}
            onDelete={handleDeleteOrder}
            warehouseReceipts={warehouseReceipts} 
          />
        );
      case ModuleName.PRODUCTS:
        return (
          <Products 
            products={products}
            onAdd={handleAddProduct}
            onUpdate={handleUpdateProduct}
            onDelete={handleDeleteProduct}
          />
        );
      default:
        return <PlaceholderModule title={MODULE_LABELS[activeModule] || 'Module'} />;
    }
  };

  return (
    <div
      className={`delivery-module min-h-full text-slate-800 ${embedded ? 'rounded-2xl' : ''} ${visible ? '' : 'hidden'}`}
    >
      <div className="min-h-[60vh]">
        {renderContent()}
      </div>
    </div>
  );
};

export default App;
