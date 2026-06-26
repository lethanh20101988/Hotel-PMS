
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
  Clock,
} from 'lucide-react';

interface Props {
  orders: Order[];
  vehicles: Vehicle[];
  trips: Trip[];
  distributors: Distributor[];
}

const Dashboard: React.FC<Props> = ({ orders, vehicles, trips, distributors }) => {
  const pendingOrders = orders.filter(
    (o) => o.status === OrderStatus.CREATED || o.status === OrderStatus.WAREHOUSE_DISPATCH,
  );
  const totalPendingWeight = pendingOrders.reduce((sum, o) => sum + o.totalWeight, 0);

  const availableVehicles = vehicles.filter((v) => v.status === 'AVAILABLE').length;
  const busyVehicles = vehicles.filter((v) => v.status === 'BUSY').length;
  const maintenanceVehicles = vehicles.filter((v) => v.status === 'MAINTENANCE').length;

  const activeTrips = trips.filter((t) => t.status !== TripStatus.COMPLETED);

  const fillRate =
    activeTrips.length > 0
      ? Math.round(
          activeTrips.reduce((acc, trip) => acc + trip.currentLoad / trip.maxCapacity, 0) /
            activeTrips.length *
            100,
        )
      : 0;

  const regionStats: Record<string, number> = {};
  pendingOrders.forEach((order) => {
    let region = 'Khác';
    if (order.distributorId) {
      const dist = distributors.find((d) => d.id === order.distributorId);
      if (dist) region = dist.region.split('-')[0].trim();
    } else {
      region = 'Nội bộ';
    }
    regionStats[region] = (regionStats[region] || 0) + order.totalWeight;
  });

  const dataPoints = Object.entries(regionStats).map(([region, weight]) => ({ region, weight }));
  const maxWeight = Math.max(...dataPoints.map((d) => d.weight), 1);
  const fleetTotal = vehicles.length || 1;
  const readyPct = Math.round((availableVehicles / fleetTotal) * 100);

  const todayLabel = new Date().toLocaleDateString('vi-VN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const kpiCardClass =
    'bg-white rounded-lg border border-slate-200/90 px-3 py-2.5 shadow-sm hover:shadow transition';

  return (
    <div className="space-y-3 animate-fade-in text-sm">
      {/* Header — một dòng */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-lg font-bold text-slate-800">Tổng quan vận hành</h2>
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {todayLabel}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
          <Activity className="w-3 h-3" />
          Ổn định
        </span>
      </div>

      {/* KPI — 4 cột gọn */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className={kpiCardClass}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500 truncate">Đơn chờ xử lý</p>
              <p className="text-xl font-bold text-slate-800 leading-tight">{pendingOrders.length}</p>
            </div>
            <div className="shrink-0 rounded-md bg-orange-50 p-1.5 text-orange-600">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            <span className="font-semibold text-orange-600">{(totalPendingWeight / 1000).toFixed(1)} tấn</span> đợi xe
          </p>
        </div>

        <div className={kpiCardClass}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500 truncate">Chuyến đang chạy</p>
              <p className="text-xl font-bold text-slate-800 leading-tight">{activeTrips.length}</p>
            </div>
            <div className="shrink-0 rounded-md bg-blue-50 p-1.5 text-blue-600">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            <span className="font-semibold text-blue-600">{busyVehicles}/{vehicles.length}</span> xe hoạt động
          </p>
        </div>

        <div className={kpiCardClass}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500 truncate">Lấp đầy</p>
              <p className="text-xl font-bold text-slate-800 leading-tight">{fillRate}%</p>
            </div>
            <div className="shrink-0 rounded-md bg-emerald-50 p-1.5 text-emerald-600">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${fillRate}%` }} />
          </div>
        </div>

        <div className={kpiCardClass}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500 truncate">Bảo trì</p>
              <p className="text-xl font-bold text-slate-800 leading-tight">{maintenanceVehicles}</p>
            </div>
            <div className="shrink-0 rounded-md bg-red-50 p-1.5 text-red-600">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            <span className="font-semibold text-red-600">{maintenanceVehicles}</span> xe cần bảo trì
          </p>
        </div>
      </div>

      {/* Giữa: biểu đồ + đội xe — cùng hàng, padding nhỏ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
        <div className="lg:col-span-8 bg-white rounded-lg border border-slate-200/90 p-3 shadow-sm">
          <h3 className="text-sm font-bold text-slate-800 mb-2">Nhu cầu theo khu vực</h3>
          {dataPoints.length > 0 ? (
            <div className="space-y-2">
              {dataPoints.map((item, index) => {
                const percentage = Math.round((item.weight / maxWeight) * 100);
                return (
                  <div key={index} className="group">
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span className="font-medium text-slate-700 truncate pr-2">{item.region}</span>
                      <span className="text-slate-500 shrink-0">{(item.weight / 1000).toFixed(1)} t</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-500 transition-all group-hover:bg-brand-400"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-20 flex items-center justify-center text-xs text-slate-400 border border-dashed rounded-md">
              Chưa có dữ liệu
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-white rounded-lg border border-slate-200/90 p-3 shadow-sm">
          <h3 className="text-sm font-bold text-slate-800 mb-2">Đội xe</h3>
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 shrink-0">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <path
                  className="text-slate-100"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.8"
                />
                <path
                  className="text-emerald-500"
                  strokeDasharray={`${readyPct}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.8"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-slate-800 leading-none">{vehicles.length}</span>
                <span className="text-[9px] text-slate-400 uppercase">xe</span>
              </div>
            </div>
            <div className="flex-1 space-y-1 min-w-0">
              <div className="flex justify-between items-center text-[11px] px-2 py-1 rounded bg-emerald-50 border border-emerald-100">
                <span className="text-emerald-800 font-medium">Sẵn sàng</span>
                <span className="font-bold text-emerald-700">{availableVehicles}</span>
              </div>
              <div className="flex justify-between items-center text-[11px] px-2 py-1 rounded bg-blue-50 border border-blue-100">
                <span className="text-blue-800 font-medium">Đang chạy</span>
                <span className="font-bold text-blue-700">{busyVehicles}</span>
              </div>
              <div className="flex justify-between items-center text-[11px] px-2 py-1 rounded bg-red-50 border border-red-100">
                <span className="text-red-800 font-medium">Bảo trì</span>
                <span className="font-bold text-red-700">{maintenanceVehicles}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Danh sách — 2 cột, dòng gọn */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        <div className="bg-white rounded-lg border border-slate-200/90 overflow-hidden shadow-sm">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/80 flex justify-between items-center">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-orange-500" />
              Cần điều phối
            </h3>
            <span className="text-[10px] text-slate-500">{pendingOrders.length} đơn</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-[min(220px,28vh)] overflow-y-auto">
            {pendingOrders.length > 0 ? (
              pendingOrders.slice(0, 6).map((order) => (
                <div
                  key={order.id}
                  className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50/80"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-800 truncate">{order.distributorName}</div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {order.id} · {order.requestDate}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-brand-600">{order.totalWeight} kg</div>
                    <span className="text-[10px] px-1.5 py-0 rounded bg-orange-100 text-orange-700">Chờ</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-xs text-slate-400">Không có đơn tồn</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200/90 overflow-hidden shadow-sm">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/80 flex justify-between items-center">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-500" />
              Lộ trình đang chạy
            </h3>
            <span className="text-[10px] text-slate-500">{activeTrips.length} chuyến</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-[min(220px,28vh)] overflow-y-auto">
            {activeTrips.length > 0 ? (
              activeTrips.slice(0, 6).map((trip) => (
                <div key={trip.id} className="px-3 py-2 hover:bg-slate-50/80">
                  <div className="flex justify-between items-center gap-2 mb-0.5">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-xs font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                        {trip.vehiclePlate}
                      </span>
                      <ArrowRight className="w-3 h-3 text-slate-300 shrink-0" />
                      <span className="text-[11px] text-slate-600 truncate">{trip.route}</span>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0 rounded-full shrink-0 ${
                        trip.status === TripStatus.PLANNED
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {trip.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0 text-[10px] text-slate-500">
                    <span className="flex items-center gap-0.5">
                      <Truck className="w-3 h-3" />
                      {trip.driverName}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Package className="w-3 h-3" />
                      {trip.currentLoad}/{trip.maxCapacity} kg
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-xs text-slate-400">Chưa có chuyến</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
