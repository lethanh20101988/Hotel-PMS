
import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, Line, ComposedChart } from 'recharts';
import { Expense, Booking, Room, RoomStatus, ImportLog } from '../types';
import { formatCurrency, formatDate, formatNumber, parseNumber } from '../utils';
import { TrendingUp, TrendingDown, DollarSign, Plus, Receipt, Pencil, Trash2, X, Save, CalendarRange, Filter, FileSpreadsheet, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

interface ReportsProps {
  expenses: Expense[];
  bookings: Booking[];
  rooms: Room[];
  importLogs: ImportLog[]; // For Input VAT
  onAddExpense: (expense: Expense) => void;
  onEditExpense: (expense: Expense) => void;
  onDeleteExpense: (id: string) => void;
}

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444'];

type SubTab = 'GENERAL' | 'TAX';
type DateRangeType = 'CUSTOM' | 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_QUARTER' | 'THIS_YEAR';

export const Reports: React.FC<ReportsProps> = ({ expenses, bookings, rooms, importLogs, onAddExpense, onEditExpense, onDeleteExpense }) => {
  const [activeTab, setActiveTab] = useState<SubTab>('GENERAL');

  // Expense Form State
  const [newExpense, setNewExpense] = useState<{name: string, amount: string, category: string, date: string, vatRate: number}>({
      name: '', amount: '', category: 'IMPORT', date: new Date().toISOString().split('T')[0], vatRate: 0
  });
  
  const [editingId, setEditingId] = useState<string | null>(null);

  // --- CHART DATE RANGE STATE ---
  // Default: Last 7 days
  const defaultEnd = new Date();
  const defaultStart = new Date();
  defaultStart.setDate(defaultEnd.getDate() - 6);

  const [chartStart, setChartStart] = useState(defaultStart.toISOString().split('T')[0]);
  const [chartEnd, setChartEnd] = useState(defaultEnd.toISOString().split('T')[0]);
  const [dateRangeType, setDateRangeType] = useState<DateRangeType>('CUSTOM');

  // Helper to set date range
  const handleSetDateRange = (type: DateRangeType) => {
      setDateRangeType(type);
      const now = new Date();
      let start = new Date();
      let end = new Date();

      switch (type) {
          case 'THIS_MONTH':
              start = new Date(now.getFullYear(), now.getMonth(), 1);
              end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
              break;
          case 'LAST_MONTH':
              start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
              end = new Date(now.getFullYear(), now.getMonth(), 0);
              break;
          case 'THIS_QUARTER':
              const quarter = Math.floor(now.getMonth() / 3);
              start = new Date(now.getFullYear(), quarter * 3, 1);
              end = new Date(now.getFullYear(), quarter * 3 + 3, 0);
              break;
          case 'THIS_YEAR':
              start = new Date(now.getFullYear(), 0, 1);
              end = new Date(now.getFullYear(), 11, 31);
              break;
          case 'CUSTOM':
              return; // Do nothing, let user pick
      }
      
      // Adjust timezone offset
      const toLocalISO = (d: Date) => {
          const offset = d.getTimezoneOffset() * 60000;
          return new Date(d.getTime() - offset).toISOString().split('T')[0];
      };

      setChartStart(toLocalISO(start));
      setChartEnd(toLocalISO(end));
  };


  // Handle Add/Edit Expense
  const handleAddClick = () => {
    if(!newExpense.name.trim()) {
        alert("Vui lòng nhập tên khoản chi!");
        return;
    }
    const amountVal = parseNumber(newExpense.amount);
    if(!newExpense.amount || amountVal <= 0) {
        alert("Vui lòng nhập số tiền hợp lệ!");
        return;
    }

    // Calculate Taxed Amount based on User selection
    const preTax = amountVal;
    const vat = preTax * (newExpense.vatRate / 100);
    const finalAmount = preTax + vat;

    if (editingId) {
        // Edit mode
        onEditExpense({
            id: editingId,
            name: newExpense.name,
            amount: finalAmount, // Store total amount
            category: newExpense.category as any,
            date: newExpense.date,
            notes: `VAT ${newExpense.vatRate}%` // Simple note for now
        });
        setEditingId(null);
    } else {
        // Add mode
        onAddExpense({
            id: Date.now().toString(),
            name: newExpense.name,
            amount: finalAmount,
            category: newExpense.category as any,
            date: newExpense.date,
            notes: `VAT ${newExpense.vatRate}%`
        });
    }
    
    // Reset inputs
    setNewExpense({
        name: '', amount: '', category: 'IMPORT', date: new Date().toISOString().split('T')[0], vatRate: 0
    });
  };

  const startEditing = (exp: Expense) => {
      setNewExpense({
          name: exp.name,
          amount: exp.amount.toString(),
          category: exp.category,
          date: exp.date,
          vatRate: 0 // Reset visual selector, amount is already total
      });
      setEditingId(exp.id);
  };

  const cancelEditing = () => {
      setEditingId(null);
      setNewExpense({
          name: '', amount: '', category: 'IMPORT', date: new Date().toISOString().split('T')[0], vatRate: 0
      });
  };

  // --- CALCULATIONS BASED ON REAL DATA ---
  
  const completedBookings = bookings.filter(b => b.status === 'completed');
  const totalRevenue = completedBookings.reduce((acc, curr) => acc + curr.finalTotal, 0);
  const totalCost = expenses.reduce((acc, curr) => acc + curr.amount, 0);
  const netProfit = totalRevenue - totalCost;

  // 4. Chart Data: Dynamic Range
  const getChartData = () => {
    const data = [];
    const start = new Date(chartStart);
    const end = new Date(chartEnd);
    
    // Reset hours to ensure clean loop
    start.setHours(0,0,0,0);
    end.setHours(0,0,0,0);

    const current = new Date(start);

    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`; // YYYY-MM-DD for matching
      const displayDate = `${day}/${month}`;     // DD/MM for display

      // Sum Revenue for this day based on CHECKOUT DATE
      const dayRevenue = completedBookings
        .filter(b => {
            const checkoutDate = b.checkOutActual ? b.checkOutActual.split('T')[0] : b.checkOutExpected.split('T')[0];
            return checkoutDate === dateStr;
        })
        .reduce((sum, b) => sum + b.finalTotal, 0);

      // Sum Expense for this day
      const dayCost = expenses
        .filter(e => e.date === dateStr)
        .reduce((sum, e) => sum + e.amount, 0);

      data.push({
        name: displayDate,
        revenue: dayRevenue,
        cost: dayCost,
        profit: dayRevenue - dayCost
      });

      // Move to next day
      current.setDate(current.getDate() + 1);
    }
    return data;
  };

  const combinedData = getChartData();

  // 5. Occupancy Data (Real-time from Rooms)
  const getOccupancyData = () => {
    const occupied = rooms.filter(r => r.status === RoomStatus.OCCUPIED).length;
    const available = rooms.filter(r => r.status === RoomStatus.AVAILABLE).length;
    const booked = rooms.filter(r => r.status === RoomStatus.BOOKED).length;
    const maintenance = rooms.filter(r => r.status === RoomStatus.MAINTENANCE || r.status === RoomStatus.DIRTY).length;

    if (rooms.length === 0) return [{ name: 'Chưa có dữ liệu', value: 1 }];

    return [
      { name: 'Đang ở', value: occupied },
      { name: 'Trống', value: available },
      { name: 'Đặt trước', value: booked },
      { name: 'Bảo trì/Dọn', value: maintenance },
    ];
  };

  const dataOccupancy = getOccupancyData();

  // --- TAX REPORT CALCULATIONS ---
  const taxReportData = useMemo(() => {
      const start = new Date(chartStart).getTime();
      const end = new Date(chartEnd).getTime();
      const endOfDay = end + (24*60*60*1000) - 1; // End of selected day

      // 1. INPUT VAT (From Inventory Imports)
      const inputInvoices = importLogs.filter(log => {
          const logTime = new Date(log.importDate).getTime();
          return logTime >= start && logTime <= endOfDay;
      });

      const totalInputPreTax = inputInvoices.reduce((sum, i) => sum + i.preTaxTotal, 0);
      const totalInputVAT = inputInvoices.reduce((sum, i) => sum + (i.totalAmount - i.preTaxTotal), 0);
      const totalInputTotal = inputInvoices.reduce((sum, i) => sum + i.totalAmount, 0);

      // 2. OUTPUT VAT (From Completed Bookings)
      const outputInvoices = completedBookings.filter(b => {
          const time = new Date(b.checkOutActual || b.checkOutExpected).getTime();
          return time >= start && time <= endOfDay;
      });

      const totalOutputPreTax = outputInvoices.reduce((sum, b) => sum + (b.totalRoomCharge + b.totalServiceCharge), 0);
      const totalOutputVAT = outputInvoices.reduce((sum, b) => sum + ((b.roomVatAmount || 0) + (b.totalServiceVatAmount || 0)), 0);
      const totalOutputTotal = outputInvoices.reduce((sum, b) => sum + b.finalTotal, 0);

      return {
          inputInvoices,
          outputInvoices,
          summary: {
              totalInputVAT,
              totalOutputVAT,
              taxPayable: totalOutputVAT - totalInputVAT
          }
      };

  }, [importLogs, completedBookings, chartStart, chartEnd]);

  return (
    <div className="space-y-6">
      
      {/* HEADER WITH TABS & DATE FILTER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-gray-200 pb-4">
          <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
             <button 
                onClick={() => setActiveTab('GENERAL')}
                className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'GENERAL' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
             >
                <TrendingUp size={16} className="inline mr-2"/> Tổng quan
             </button>
             <button 
                onClick={() => setActiveTab('TAX')}
                className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'TAX' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
             >
                <FileSpreadsheet size={16} className="inline mr-2"/> Báo cáo Thuế
             </button>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
              <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <button onClick={() => handleSetDateRange('THIS_MONTH')} className={`px-3 py-1.5 text-xs font-medium border-r border-gray-100 hover:bg-gray-50 ${dateRangeType === 'THIS_MONTH' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600'}`}>Tháng này</button>
                  <button onClick={() => handleSetDateRange('THIS_QUARTER')} className={`px-3 py-1.5 text-xs font-medium border-r border-gray-100 hover:bg-gray-50 ${dateRangeType === 'THIS_QUARTER' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600'}`}>Quý này</button>
                  <button onClick={() => handleSetDateRange('THIS_YEAR')} className={`px-3 py-1.5 text-xs font-medium hover:bg-gray-50 ${dateRangeType === 'THIS_YEAR' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600'}`}>Năm nay</button>
              </div>
              
              <div className="flex items-center gap-2 bg-white p-1.5 rounded-lg border border-gray-200 shadow-sm">
                <CalendarRange size={16} className="text-gray-500 ml-1"/>
                <input 
                   type="date" 
                   value={chartStart}
                   onChange={(e) => { setChartStart(e.target.value); setDateRangeType('CUSTOM'); }}
                   className="bg-transparent text-sm border-none focus:ring-0 text-slate-700 outline-none w-32"
                />
                <span className="text-gray-400">-</span>
                <input 
                   type="date" 
                   value={chartEnd}
                   onChange={(e) => { setChartEnd(e.target.value); setDateRangeType('CUSTOM'); }}
                   className="bg-transparent text-sm border-none focus:ring-0 text-slate-700 outline-none w-32"
                />
             </div>
          </div>
      </div>

      {/* --- GENERAL REPORT TAB --- */}
      {activeTab === 'GENERAL' && (
        <div className="animate-in fade-in duration-300 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-emerald-100 flex items-center justify-between">
                    <div>
                        <p className="text-gray-500 text-sm font-medium uppercase tracking-wider">Tổng Doanh Thu (Đã thu)</p>
                        <h3 className="text-2xl font-bold text-emerald-600 mt-1">{formatCurrency(totalRevenue)}</h3>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                        <TrendingUp size={24} />
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-rose-100 flex items-center justify-between">
                    <div>
                        <p className="text-gray-500 text-sm font-medium uppercase tracking-wider">Tổng Chi Phí</p>
                        <h3 className="text-2xl font-bold text-rose-600 mt-1">{formatCurrency(totalCost)}</h3>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center text-rose-600">
                        <TrendingDown size={24} />
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-indigo-100 flex items-center justify-between">
                    <div>
                        <p className="text-gray-500 text-sm font-medium uppercase tracking-wider">Lợi Nhuận Ròng</p>
                        <h3 className={`text-2xl font-bold mt-1 ${netProfit >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>
                            {formatCurrency(netProfit)}
                        </h3>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                        <DollarSign size={24} />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Profit Chart */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">Biểu đồ Doanh Thu - Chi Phí</h3>
                    <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={combinedData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="name" />
                            <YAxis tickFormatter={(val) => `${val/1000}k`}/>
                            <Tooltip formatter={(value) => formatCurrency(value as number)} />
                            <Legend />
                            <Bar dataKey="revenue" name="Doanh thu" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
                            <Bar dataKey="cost" name="Chi phí" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={20} />
                            <Line type="monotone" dataKey="profit" name="Lợi nhuận" stroke="#4f46e5" strokeWidth={3} dot={{r: 4}} />
                        </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Occupancy Chart */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">Tỷ lệ lấp đầy hôm nay</h3>
                    <div className="h-80 flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                            data={dataOccupancy}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            fill="#8884d8"
                            paddingAngle={5}
                            dataKey="value"
                            label
                            >
                            {dataOccupancy.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                            </Pie>
                            <Tooltip />
                            <Legend verticalAlign="bottom" height={36}/>
                        </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* EXPENSE MANAGEMENT SECTION */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Receipt className="text-rose-500"/> Quản lý Chi Phí
                    </h3>
                </div>
                
                {/* Horizontal Input Grid */}
                <div className="p-4 bg-gray-50 border-b border-gray-200">
                   <div className="grid grid-cols-12 gap-4 items-end">
                        {/* Date */}
                        <div className="col-span-12 md:col-span-2">
                            <label className="block text-xs font-bold text-gray-500 mb-1">Ngày chi</label>
                            <input 
                                type="date" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
                                value={newExpense.date}
                                onChange={(e) => setNewExpense({...newExpense, date: e.target.value})}
                            />
                        </div>
                        
                        {/* Name */}
                        <div className="col-span-12 md:col-span-3">
                            <label className="block text-xs font-bold text-gray-500 mb-1">Tên khoản chi</label>
                            <input 
                                type="text" 
                                placeholder="VD: Tiền điện tháng 10..." 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
                                value={newExpense.name}
                                onChange={(e) => setNewExpense({...newExpense, name: e.target.value})}
                            />
                        </div>

                        {/* Category */}
                        <div className="col-span-12 md:col-span-2">
                             <label className="block text-xs font-bold text-gray-500 mb-1">Danh mục</label>
                             <select 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 bg-white"
                                value={newExpense.category}
                                onChange={(e) => setNewExpense({...newExpense, category: e.target.value})}
                            >
                                <option value="IMPORT">Nhập hàng</option>
                                <option value="UTILITY">Điện/Nước</option>
                                <option value="SALARY">Lương NV</option>
                                <option value="MAINTENANCE">Bảo trì</option>
                                <option value="OTHER">Khác</option>
                            </select>
                        </div>

                        {/* Amount */}
                        <div className="col-span-12 md:col-span-2">
                             <label className="block text-xs font-bold text-gray-500 mb-1">Số tiền</label>
                             <input 
                                type="text" 
                                placeholder="0" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
                                value={formatNumber(newExpense.amount)}
                                onChange={(e) => {
                                    const raw = e.target.value.replace(/\./g, '');
                                    if(!isNaN(Number(raw))) {
                                        setNewExpense({...newExpense, amount: raw})
                                    }
                                }}
                            />
                        </div>

                        {/* VAT */}
                        <div className="col-span-12 md:col-span-1">
                            <label className="block text-xs font-bold text-gray-500 mb-1">VAT</label>
                            <select
                                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm outline-none bg-white focus:border-indigo-500"
                                value={newExpense.vatRate}
                                onChange={(e) => setNewExpense({...newExpense, vatRate: Number(e.target.value)})}
                            >
                                <option value={0}>0%</option>
                                <option value={5}>5%</option>
                                <option value={8}>8%</option>
                                <option value={10}>10%</option>
                            </select>
                        </div>

                        {/* Actions */}
                        <div className="col-span-12 md:col-span-2">
                            {editingId ? (
                                <div className="flex gap-2">
                                    <button 
                                        type="button"
                                        onClick={handleAddClick} 
                                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg font-medium text-sm transition-colors active:scale-95"
                                    >
                                        Lưu
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={cancelEditing} 
                                        className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 py-2 rounded-lg font-medium text-sm transition-colors active:scale-95"
                                    >
                                        Hủy
                                    </button>
                                </div>
                            ) : (
                                <button 
                                    type="button"
                                    onClick={handleAddClick} 
                                    className="w-full bg-rose-600 hover:bg-rose-700 text-white py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-1 transition-colors active:scale-95 shadow-lg shadow-rose-100"
                                >
                                    <Plus size={16}/> Thêm mới
                                </button>
                            )}
                        </div>
                   </div>
                </div>

                {/* Expense List */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-bold border-b border-gray-100">
                            <tr>
                                <th className="px-6 py-4">Ngày</th>
                                <th className="px-6 py-4">Khoản chi</th>
                                <th className="px-6 py-4">Danh mục</th>
                                <th className="px-6 py-4 text-right">Số tiền (Sau VAT)</th>
                                <th className="px-6 py-4 text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {expenses.map((exp) => (
                                <tr key={exp.id} className={`hover:bg-gray-50 transition-colors ${editingId === exp.id ? 'bg-indigo-50' : ''}`}>
                                    <td className="px-6 py-4 text-sm text-gray-600">{exp.date.split('-').reverse().join('/')}</td>
                                    <td className="px-6 py-4 font-medium text-slate-800">
                                        {exp.name}
                                        {exp.notes && <span className="block text-xs text-gray-400 font-normal">{exp.notes}</span>}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-gray-100 text-gray-600 uppercase">
                                            {exp.category === 'IMPORT' ? 'Nhập hàng' : 
                                            exp.category === 'UTILITY' ? 'Điện/Nước' :
                                            exp.category === 'SALARY' ? 'Lương' :
                                            exp.category === 'MAINTENANCE' ? 'Bảo trì' : 'Khác'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right font-bold text-rose-600">
                                        {formatCurrency(exp.amount)}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button 
                                                onClick={() => startEditing(exp)}
                                                className="p-1.5 rounded-full hover:bg-indigo-100 text-gray-400 hover:text-indigo-600 transition-colors"
                                                title="Sửa"
                                            >
                                                <Pencil size={16} />
                                            </button>
                                            <button 
                                                onClick={() => onDeleteExpense(exp.id)}
                                                className="p-1.5 rounded-full hover:bg-rose-100 text-gray-400 hover:text-rose-600 transition-colors"
                                                title="Xóa"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {expenses.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-gray-400 italic">Chưa có dữ liệu chi phí.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      )}

      {/* --- TAX REPORT TAB --- */}
      {activeTab === 'TAX' && (
          <div className="animate-in fade-in duration-300 space-y-8">
              {/* TAX SUMMARY CARDS */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-6 rounded-xl shadow-sm border border-indigo-100 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-3 opacity-10">
                          <ArrowDownCircle size={80} className="text-indigo-600"/>
                      </div>
                      <p className="text-gray-500 text-sm font-bold uppercase tracking-wider mb-2">Hóa đơn Mua vào (Input)</p>
                      <h3 className="text-2xl font-bold text-slate-800">{formatCurrency(taxReportData.summary.totalInputVAT)}</h3>
                      <p className="text-xs text-gray-400 mt-1">Tổng thuế GTGT đầu vào được khấu trừ</p>
                  </div>
                  
                  <div className="bg-white p-6 rounded-xl shadow-sm border border-orange-100 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-3 opacity-10">
                          <ArrowUpCircle size={80} className="text-orange-600"/>
                      </div>
                      <p className="text-gray-500 text-sm font-bold uppercase tracking-wider mb-2">Hóa đơn Bán ra (Output)</p>
                      <h3 className="text-2xl font-bold text-slate-800">{formatCurrency(taxReportData.summary.totalOutputVAT)}</h3>
                      <p className="text-xs text-gray-400 mt-1">Tổng thuế GTGT đầu ra phải thu</p>
                  </div>

                  <div className={`bg-white p-6 rounded-xl shadow-sm border-l-4 relative overflow-hidden flex flex-col justify-center ${taxReportData.summary.taxPayable >= 0 ? 'border-rose-500' : 'border-emerald-500'}`}>
                      <p className="text-gray-500 text-sm font-bold uppercase tracking-wider mb-2">Thuế GTGT Phải nộp</p>
                      <h3 className={`text-3xl font-bold ${taxReportData.summary.taxPayable >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {formatCurrency(taxReportData.summary.taxPayable)}
                      </h3>
                      <p className="text-xs text-gray-400 mt-1">
                          {taxReportData.summary.taxPayable >= 0 ? '(Phải nộp nhà nước)' : '(Được khấu trừ chuyển kỳ sau)'}
                      </p>
                  </div>
              </div>

              {/* INPUT INVOICES TABLE */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-5 border-b border-gray-100 bg-gray-50/50">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                          <ArrowDownCircle className="text-indigo-600" size={20}/> Bảng kê Hóa đơn Mua vào (Từ Kho hàng)
                      </h3>
                  </div>
                  <div className="max-h-[400px] overflow-y-auto">
                      <table className="w-full text-left text-sm">
                          <thead className="bg-white text-xs uppercase text-gray-500 font-bold border-b border-gray-200 sticky top-0 z-10">
                              <tr>
                                  <th className="px-6 py-3 bg-gray-50">Ngày HĐ</th>
                                  <th className="px-6 py-3 bg-gray-50">Số HĐ</th>
                                  <th className="px-6 py-3 bg-gray-50">Diễn giải</th>
                                  <th className="px-6 py-3 bg-gray-50 text-right">Doanh số mua</th>
                                  <th className="px-6 py-3 bg-gray-50 text-right">Thuế suất</th>
                                  <th className="px-6 py-3 bg-gray-50 text-right">Tiền thuế</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {taxReportData.inputInvoices.length === 0 ? (
                                  <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400 italic">Không có hóa đơn đầu vào trong khoảng thời gian này.</td></tr>
                              ) : (
                                  taxReportData.inputInvoices.map(log => (
                                      <tr key={log.id} className="hover:bg-gray-50">
                                          <td className="px-6 py-3">{formatDate(log.importDate).split(' ')[0]}</td>
                                          <td className="px-6 py-3 font-medium text-indigo-700">{log.invoiceRef || 'N/A'}</td>
                                          <td className="px-6 py-3 text-gray-600">{log.itemName} ({log.quantity} {log.unit})</td>
                                          <td className="px-6 py-3 text-right">{formatCurrency(log.preTaxTotal)}</td>
                                          <td className="px-6 py-3 text-right">{log.vatRate}%</td>
                                          <td className="px-6 py-3 text-right font-medium text-slate-800">{formatCurrency(log.totalAmount - log.preTaxTotal)}</td>
                                      </tr>
                                  ))
                              )}
                          </tbody>
                      </table>
                  </div>
              </div>

              {/* OUTPUT INVOICES TABLE */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-5 border-b border-gray-100 bg-gray-50/50">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                          <ArrowUpCircle className="text-orange-600" size={20}/> Bảng kê Hóa đơn Bán ra (Từ Lễ tân)
                      </h3>
                  </div>
                  <div className="max-h-[400px] overflow-y-auto">
                      <table className="w-full text-left text-sm">
                          <thead className="bg-white text-xs uppercase text-gray-500 font-bold border-b border-gray-200 sticky top-0 z-10">
                              <tr>
                                  <th className="px-6 py-3 bg-gray-50">Ngày HĐ</th>
                                  <th className="px-6 py-3 bg-gray-50">Khách hàng</th>
                                  <th className="px-6 py-3 bg-gray-50">Chi tiết phòng</th>
                                  <th className="px-6 py-3 bg-gray-50 text-right">Doanh số bán</th>
                                  <th className="px-6 py-3 bg-gray-50 text-right">Tiền thuế</th>
                                  <th className="px-6 py-3 bg-gray-50 text-right">Tổng thanh toán</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {taxReportData.outputInvoices.length === 0 ? (
                                  <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400 italic">Không có hóa đơn đầu ra trong khoảng thời gian này.</td></tr>
                              ) : (
                                  taxReportData.outputInvoices.map(booking => {
                                      const vatAmount = (booking.roomVatAmount || 0) + (booking.totalServiceVatAmount || 0);
                                      const revenuePreTax = booking.finalTotal - vatAmount;
                                      return (
                                          <tr key={booking.id} className="hover:bg-gray-50">
                                              <td className="px-6 py-3">{formatDate(booking.checkOutActual || booking.checkOutExpected).split(' ')[0]}</td>
                                              <td className="px-6 py-3 font-medium text-slate-800">{booking.customer.name}</td>
                                              <td className="px-6 py-3 text-gray-500 text-xs">Phòng {rooms.find(r=>r.id===booking.roomId)?.number}</td>
                                              <td className="px-6 py-3 text-right">{formatCurrency(revenuePreTax)}</td>
                                              <td className="px-6 py-3 text-right font-medium text-slate-800">{formatCurrency(vatAmount)}</td>
                                              <td className="px-6 py-3 text-right text-indigo-700 font-bold">{formatCurrency(booking.finalTotal)}</td>
                                          </tr>
                                      );
                                  })
                              )}
                          </tbody>
                      </table>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};
