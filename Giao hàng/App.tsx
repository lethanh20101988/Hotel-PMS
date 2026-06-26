
import React, { useState } from 'react';
import { ModuleName, Distributor, Product, Order, Vehicle, Trip, OrderStatus, CostRecord, TripStatus, AdvanceRecord, SalaryRecord, WarehouseReceipt, ReturnLog } from './types';
import { MOCK_DISTRIBUTORS, MOCK_PRODUCTS, MOCK_VEHICLES, MOCK_ORDERS, MOCK_COSTS, MOCK_ADVANCES } from './constants';

import Distributors from './components/Distributors';
import Dispatch from './components/Dispatch';
import Fleet from './components/Fleet';
import Dashboard from './components/Dashboard';
import Orders from './components/Orders';
import Products from './components/Products';

import { 
  LayoutDashboard, 
  Users, 
  Package, 
  ShoppingCart, 
  Truck, 
  ClipboardList, 
  Menu,
  Bell,
  Search
} from 'lucide-react';

// Simple placeholder components for modules not fully detailed in the strict file limit
const PlaceholderModule = ({ title }: { title: string }) => (
  <div className="p-10 text-center bg-white rounded-xl shadow-sm border border-dashed border-slate-300">
    <h2 className="text-2xl font-bold text-slate-300 mb-2">{title}</h2>
    <p className="text-slate-500">Module này đang được cập nhật.</p>
  </div>
);

const App: React.FC = () => {
  const [activeModule, setActiveModule] = useState<ModuleName>(ModuleName.DASHBOARD);
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  // Global State
  const [distributors, setDistributors] = useState<Distributor[]>(MOCK_DISTRIBUTORS);
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [orders, setOrders] = useState<Order[]>(MOCK_ORDERS);
  const [vehicles, setVehicles] = useState<Vehicle[]>(MOCK_VEHICLES);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [costs, setCosts] = useState<CostRecord[]>(MOCK_COSTS);
  const [advances, setAdvances] = useState<AdvanceRecord[]>(MOCK_ADVANCES);
  const [salaries, setSalaries] = useState<SalaryRecord[]>([]);
  
  // NEW STATE: Warehouse Receipts for Returns & Return Logs
  const [warehouseReceipts, setWarehouseReceipts] = useState<WarehouseReceipt[]>([]);
  const [returnLogs, setReturnLogs] = useState<ReturnLog[]>([]);

  // Handlers
  const handleAddDistributor = (d: Distributor) => setDistributors(prev => [...prev, d]);
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
  const handleDeleteVehicle = (id: string) => setVehicles(prev => prev.filter(v => v.id !== id));

  // Cost Handlers
  const handleAddCost = (c: CostRecord) => setCosts(prev => [c, ...prev]);
  const handleUpdateCost = (c: CostRecord) => setCosts(prev => prev.map(item => item.id === c.id ? c : item));
  const handleDeleteCost = (id: string) => setCosts(prev => prev.filter(c => c.id !== id));

  // Advance Handlers
  const handleAddAdvance = (a: AdvanceRecord) => setAdvances(prev => [a, ...prev]);
  const handleUpdateAdvance = (a: AdvanceRecord) => setAdvances(prev => prev.map(item => item.id === a.id ? a : item));
  const handleDeleteAdvance = (id: string) => setAdvances(prev => prev.filter(a => a.id !== id));

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

  const menuItems = [
    { id: ModuleName.DASHBOARD, label: 'Tổng quan', icon: LayoutDashboard },
    { id: ModuleName.DISTRIBUTORS, label: 'Nhà phân phối', icon: Users },
    { id: ModuleName.PRODUCTS, label: 'Sản phẩm', icon: Package },
    { id: ModuleName.ORDERS, label: 'Đơn hàng', icon: ShoppingCart },
    { id: ModuleName.DISPATCH, label: 'Điều phối', icon: Truck },
    { id: ModuleName.FLEET, label: 'Đội xe & Tài xế', icon: ClipboardList },
  ];

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
        return <Distributors distributors={distributors} onAdd={handleAddDistributor} onDelete={handleDeleteDistributor} />;
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
        return <PlaceholderModule title={menuItems.find(m => m.id === activeModule)?.label || 'Module'} />;
    }
  };

  return (
    <div className="min-h-screen flex text-slate-800">
      {/* Sidebar */}
      <aside 
        className={`${isSidebarOpen ? 'w-64' : 'w-20'} bg-slate-900 text-white transition-all duration-300 fixed h-full z-20 flex flex-col`}
      >
        <div className="h-16 flex items-center justify-center border-b border-slate-800">
          {isSidebarOpen ? (
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 text-transparent bg-clip-text">LogiSmart</h1>
          ) : (
            <span className="font-bold text-xl text-blue-400">LS</span>
          )}
        </div>

        <nav className="flex-1 py-6 space-y-2 px-3">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveModule(item.id)}
                className={`w-full flex items-center gap-4 px-3 py-3 rounded-lg transition-colors ${
                  activeModule === item.id 
                    ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 min-w-[20px]" />
                {isSidebarOpen && <span className="font-medium whitespace-nowrap">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
           <button 
             onClick={() => setSidebarOpen(!isSidebarOpen)}
             className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition"
           >
             <Menu className="w-5 h-5" />
           </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 flex flex-col transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-20'}`}>
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-10 px-6 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
             <h2 className="text-lg font-semibold text-slate-700">
               {menuItems.find(m => m.id === activeModule)?.label}
             </h2>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-slate-400 hover:text-brand-600 transition">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
            <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
              <div className="text-right hidden md:block">
                <p className="text-sm font-medium text-slate-800">Admin Kho</p>
                <p className="text-xs text-slate-500">Quản lý vận hành</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold border border-brand-200">
                A
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="p-6">
          {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default App;
