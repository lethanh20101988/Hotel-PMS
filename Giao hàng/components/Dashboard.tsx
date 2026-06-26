
import React from 'react';
import { Order, Vehicle, Trip, Distributor, OrderStatus, TripStatus } from '../types';
import { 
  TrendingUp, 
  Package, 
  Truck, 
  AlertCircle, 
  Calendar, 
  MapPin, 
  ArrowRight,
  Activity,
  CheckCircle2,
  Clock
} from 'lucide-react';

interface Props {
  orders: Order[];
  vehicles: Vehicle[];
  trips: Trip[];
  distributors: Distributor[];
}

const Dashboard: React.FC<Props> = ({ orders, vehicles, trips, distributors }) => {
  // --- KPI CALCULATIONS ---
  // Pending = Created or Warehouse Dispatch (Not yet in transit or delivered)
  const pendingOrders = orders.filter(o => o.status === OrderStatus.CREATED || o.status === OrderStatus.WAREHOUSE_DISPATCH);
  const completedOrders = orders.filter(o => o.status === OrderStatus.DELIVERED || o.status === OrderStatus.RECONCILED);
  
  const totalPendingWeight = pendingOrders.reduce((sum, o) => sum + o.totalWeight, 0);
  
  const availableVehicles = vehicles.filter(v => v.status === 'AVAILABLE').length;
  const busyVehicles = vehicles.filter(v => v.status === 'BUSY').length;
  const maintenanceVehicles = vehicles.filter(v => v.status === 'MAINTENANCE').length;
  
  const activeTrips = trips.filter(t => t.status !== TripStatus.COMPLETED);
  
  // Calculate average fill rate for active trips (Efficiency)
  const fillRate = activeTrips.length > 0 
    ? Math.round(activeTrips.reduce((acc, trip) => acc + (trip.currentLoad / trip.maxCapacity), 0) / activeTrips.length * 100)
    : 0;

  // --- CHART DATA PREPARATION ---
  // Group pending weight by Region
  const regionStats: Record<string, number> = {};
  
  pendingOrders.forEach(order => {
    // Find distributor region if applicable, or use Warehouse name for Internal
    let region = 'Khác';
    if (order.distributorId) {
        const dist = distributors.find(d => d.id === order.distributorId);
        if (dist) region = dist.region.split('-')[0].trim();
    } else {
        region = 'Nội bộ';
    }
    
    regionStats[region] = (regionStats[region] || 0) + order.totalWeight;
  });

  // Convert to array and sort
  const dataPoints = Object.entries(regionStats).map(([region, weight]) => ({ region, weight }));
  const maxWeight = Math.max(...dataPoints.map(d => d.weight), 1); // Avoid div by 0

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Tổng quan vận hành</h2>
          <p className="text-slate-500 flex items-center gap-2 mt-1">
            <Calendar className="w-4 h-4" /> 
            {new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2">
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium flex items-center gap-1">
                <Activity className="w-3 h-3" /> Hệ thống ổn định
            </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Card 1: Pending Demand */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition group">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Đơn hàng chờ xử lý</p>
              <h3 className="text-3xl font-bold text-slate-800 mt-1">{pendingOrders.length}</h3>
            </div>
            <div className="p-3 bg-orange-50 text-orange-600 rounded-lg group-hover:bg-orange-100 transition">
              <Package className="w-6 h-6" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
             <span className="text-orange-600 font-semibold bg-orange-50 px-1.5 rounded">{(totalPendingWeight / 1000).toFixed(1)} tấn</span>
             <span>hàng đang đợi xe</span>
          </div>
        </div>

        {/* Card 2: Active Logistics */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition group">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Chuyến xe đang chạy</p>
              <h3 className="text-3xl font-bold text-slate-800 mt-1">{activeTrips.length}</h3>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition">
              <Truck className="w-6 h-6" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
             <span className="text-blue-600 font-semibold bg-blue-50 px-1.5 rounded">{busyVehicles}/{vehicles.length}</span>
             <span>xe đang hoạt động</span>
          </div>
        </div>

        {/* Card 3: Efficiency */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition group">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Hiệu suất lấp đầy</p>
              <h3 className="text-3xl font-bold text-slate-800 mt-1">{fillRate}%</h3>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg group-hover:bg-emerald-100 transition">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2">
            <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${fillRate}%` }}></div>
          </div>
          <p className="text-xs text-slate-400 mt-2">Trung bình tải trọng chuyến</p>
        </div>

        {/* Card 4: Issues/Alerts */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition group">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Cảnh báo / Bảo trì</p>
              <h3 className="text-3xl font-bold text-slate-800 mt-1">{maintenanceVehicles}</h3>
            </div>
            <div className="p-3 bg-red-50 text-red-600 rounded-lg group-hover:bg-red-100 transition">
              <AlertCircle className="w-6 h-6" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
             <span className="text-red-600 font-semibold bg-red-50 px-1.5 rounded">{maintenanceVehicles} xe</span>
             <span>đang bảo trì</span>
          </div>
        </div>
      </div>

      {/* Charts & Status Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Demand by Region (Bar Chart) */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-lg text-slate-800">Nhu cầu vận chuyển theo khu vực</h3>
            <button className="text-sm text-brand-600 hover:underline">Chi tiết</button>
          </div>
          
          {dataPoints.length > 0 ? (
            <div className="space-y-4">
              {dataPoints.map((item, index) => {
                const percentage = Math.round((item.weight / maxWeight) * 100);
                return (
                  <div key={index} className="group">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-slate-700">{item.region}</span>
                      <span className="text-slate-500">{(item.weight / 1000).toFixed(1)} tấn</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden relative">
                      <div 
                        className="bg-brand-500 h-3 rounded-full transition-all duration-1000 ease-out group-hover:bg-brand-400"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center text-slate-400 border border-dashed rounded-lg">
              Chưa có dữ liệu đơn hàng
            </div>
          )}
        </div>

        {/* Right: Fleet Status (Donut-like or List) */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
           <h3 className="font-bold text-lg text-slate-800 mb-6">Tình trạng đội xe</h3>
           
           <div className="flex justify-center mb-6 relative">
              {/* Simple Visual representation using concentric circles or simple CSS art */}
              <div className="relative w-32 h-32">
                 <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                    <path
                      className="text-slate-100"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.8"
                    />
                    <path
                      className="text-emerald-500"
                      strokeDasharray={`${(availableVehicles / vehicles.length) * 100}, 100`}
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.8"
                    />
                 </svg>
                 <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-slate-800">{vehicles.length}</span>
                    <span className="text-xs text-slate-400 uppercase">Tổng xe</span>
                 </div>
              </div>
           </div>

           <div className="space-y-3">
              <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50 border border-emerald-100">
                 <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                    <span className="text-sm font-medium text-emerald-900">Sẵn sàng</span>
                 </div>
                 <span className="font-bold text-emerald-700">{availableVehicles}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50 border border-blue-100">
                 <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <span className="text-sm font-medium text-blue-900">Đang chạy</span>
                 </div>
                 <span className="font-bold text-blue-700">{busyVehicles}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-red-50 border border-red-100">
                 <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <span className="text-sm font-medium text-red-900">Bảo trì</span>
                 </div>
                 <span className="font-bold text-red-700">{maintenanceVehicles}</span>
              </div>
           </div>
        </div>
      </div>

      {/* Bottom Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Orders List */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
               <Clock className="w-4 h-4 text-orange-500" /> Cần điều phối gấp
            </h3>
            <span className="text-xs text-slate-500">5 đơn mới nhất</span>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingOrders.length > 0 ? pendingOrders.slice(0, 5).map(order => (
              <div key={order.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition">
                 <div>
                    <div className="font-medium text-slate-800">{order.distributorName}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-2">
                       <span>{order.id}</span>
                       <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                       <span>{order.requestDate}</span>
                    </div>
                 </div>
                 <div className="text-right">
                    <div className="font-bold text-brand-600">{order.totalWeight} kg</div>
                    <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">Chờ xử lý</span>
                 </div>
              </div>
            )) : (
              <div className="p-8 text-center text-slate-400">Không có đơn hàng tồn đọng</div>
            )}
          </div>
        </div>

        {/* Active Trips List */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
             <h3 className="font-bold text-slate-800 flex items-center gap-2">
               <MapPin className="w-4 h-4 text-blue-500" /> Lộ trình đang chạy
            </h3>
             <span className="text-xs text-slate-500">Cập nhật thời gian thực</span>
          </div>
          <div className="divide-y divide-slate-100">
             {activeTrips.length > 0 ? activeTrips.slice(0, 5).map(trip => (
               <div key={trip.id} className="p-4 hover:bg-slate-50 transition">
                  <div className="flex justify-between items-start mb-2">
                     <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 bg-slate-100 px-2 py-1 rounded text-sm">{trip.vehiclePlate}</span>
                        <ArrowRight className="w-4 h-4 text-slate-300" />
                        <span className="text-sm font-medium text-slate-600 truncate max-w-[150px]">{trip.route}</span>
                     </div>
                     <span className={`text-xs px-2 py-1 rounded-full ${trip.status === TripStatus.PLANNED ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                        {trip.status}
                     </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                     <span className="flex items-center gap-1"><Truck className="w-3 h-3" /> {trip.driverName}</span>
                     <span className="flex items-center gap-1"><Package className="w-3 h-3" /> {trip.currentLoad}kg / {trip.maxCapacity}kg</span>
                  </div>
               </div>
             )) : (
               <div className="p-8 text-center text-slate-400">Chưa có chuyến xe nào đang chạy</div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
