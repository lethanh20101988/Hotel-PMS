
import React, { useState } from 'react';
import { RoomTypeConfig } from '../types';
import { 
  DollarSign, CalendarRange, TrendingUp, 
  Pencil, Trash2, Plus, Info, 
  X
} from 'lucide-react';
import { formatNumber, parseNumber } from '../utils';

interface Season {
  id: number;
  name: string;
  start: string;
  end: string;
  adjustment: string;
  value: number;
}

interface AIRule {
  id: number;
  name: string;
  condition: string;
  action: string;
  active: boolean;
}

interface RateManagementProps {
    roomTypes: RoomTypeConfig[];
    onSaveRoomType: (config: RoomTypeConfig) => void;
    onDeleteRoomType: (id: string) => void;
}

export const RateManagement: React.FC<RateManagementProps> = ({ roomTypes, onSaveRoomType, onDeleteRoomType }) => {
  const [activeTab, setActiveTab] = useState<'types' | 'seasons' | 'ai'>('types');

  const [seasons, setSeasons] = useState<Season[]>([
    { id: 1, name: 'Mùa Cao Điểm Hè', start: '2024-06-01', end: '2024-08-31', adjustment: '+25%', value: 1.25 },
    { id: 2, name: 'Tết Nguyên Đán', start: '2024-02-08', end: '2024-02-15', adjustment: '+50%', value: 1.5 },
    { id: 3, name: 'Mùa Thấp Điểm', start: '2024-09-01', end: '2024-11-30', adjustment: '-15%', value: 0.85 },
  ]);

  const [aiRules, setAiRules] = useState<AIRule[]>([
    { id: 1, name: 'Công suất cao (>80%)', condition: '> 80%', action: 'Giá tăng 15%', active: true },
    { id: 2, name: 'Công suất thấp (<30%)', condition: '< 30%', action: 'Giá giảm 10%', active: true },
    { id: 3, name: 'Đặt trước 30 ngày', condition: '> 30 ngày', action: 'Giảm 5%', active: false },
  ]);

  // --- ROOM TYPE EDITING STATE ---
  const [isRoomTypeModalOpen, setIsRoomTypeModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rtForm, setRtForm] = useState({ 
    name: '', 
    code: 'Standard', 
    priceHourly: 0,
    priceDaily: 0,
    priceOvernight: 0,
    amenities: '', 
    image: '' 
  });

  // --- SEASON EDITING STATE ---
  const [newSeason, setNewSeason] = useState({
    name: '', start: '', end: '', adjustment: '', value: ''
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
  };

  // --- HANDLERS: ROOM TYPES ---
  const handleOpenRoomTypeModal = (roomType?: RoomTypeConfig) => {
    if (roomType) {
      setEditingId(roomType.id);
      setRtForm({
        name: roomType.name,
        code: roomType.code,
        priceHourly: roomType.priceHourly,
        priceDaily: roomType.priceDaily,
        priceOvernight: roomType.priceOvernight,
        amenities: roomType.amenities.join(', '),
        image: roomType.image
      });
    } else {
      setEditingId(null);
      setRtForm({ 
        name: '', 
        code: 'Standard', 
        priceHourly: 50000,
        priceDaily: 300000,
        priceOvernight: 200000,
        amenities: '', 
        image: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&q=80&w=600' 
      });
    }
    setIsRoomTypeModalOpen(true);
  };

  const handleSaveRoomTypeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rtForm.name || !rtForm.code) return;

    const newItem: RoomTypeConfig = {
      id: editingId || Date.now().toString(),
      name: rtForm.name,
      code: rtForm.code,
      priceHourly: Number(rtForm.priceHourly),
      priceDaily: Number(rtForm.priceDaily),
      priceOvernight: Number(rtForm.priceOvernight),
      image: rtForm.image,
      amenities: rtForm.amenities.split(',').map(s => s.trim()).filter(Boolean)
    };

    onSaveRoomType(newItem);
    setIsRoomTypeModalOpen(false);
  };

  const handleDeleteRoomTypeSubmit = (id: string) => {
      if(confirm("Bạn có chắc chắn muốn xóa cấu hình loại phòng này?")) {
          onDeleteRoomType(id);
      }
  }

  // --- HANDLERS: SEASONS ---
  const handleAddSeason = () => {
    if (!newSeason.name || !newSeason.start || !newSeason.end || !newSeason.value) {
        alert("Vui lòng điền đầy đủ thông tin mùa/sự kiện");
        return;
    }

    const val = parseFloat(newSeason.value);
    const adjustment = val > 1 
        ? `+${Math.round((val - 1) * 100)}%` 
        : val < 1 
            ? `-${Math.round((1 - val) * 100)}%` 
            : '0%';

    const item: Season = {
        id: Date.now(),
        name: newSeason.name,
        start: newSeason.start,
        end: newSeason.end,
        value: val,
        adjustment: adjustment
    };

    setSeasons([...seasons, item]);
    setNewSeason({ name: '', start: '', end: '', adjustment: '', value: '' });
  };

  const handleDeleteSeason = (id: number) => {
    if(confirm("Xóa mùa này?")) {
        setSeasons(seasons.filter(s => s.id !== id));
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Quản lý Giá & Phòng</h1>
        <p className="text-slate-500 mt-1">Thiết lập giá cơ bản, hình ảnh, tiện ích phòng, chương trình theo mùa và định giá động.</p>
      </div>

      {/* Tabs Header */}
      <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
        <button
          onClick={() => setActiveTab('types')}
          className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'types'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <DollarSign size={18} /> Cấu hình Loại Phòng
        </button>
        <button
          onClick={() => setActiveTab('seasons')}
          className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'seasons'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <CalendarRange size={18} /> Giá Theo Mùa
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'ai'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <TrendingUp size={18} /> Định Giá Động (AI)
        </button>
      </div>

      {/* Content */}
      <div className="animate-in fade-in duration-300">
        
        {/* --- TAB 1: ROOM TYPES --- */}
        {activeTab === 'types' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {roomTypes.map((room) => (
              <div key={room.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden group hover:shadow-md transition-shadow relative">
                <div className="h-48 overflow-hidden relative">
                  <img src={room.image} alt={room.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                  <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                     <button 
                        onClick={() => handleOpenRoomTypeModal(room)}
                        className="bg-white p-2 rounded-full shadow-sm hover:text-indigo-600 transition-colors"
                     >
                       <Pencil size={16} />
                     </button>
                     <button 
                        onClick={() => handleDeleteRoomTypeSubmit(room.id)}
                        className="bg-white p-2 rounded-full shadow-sm hover:text-rose-600 transition-colors"
                     >
                       <Trash2 size={16} />
                     </button>
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-bold text-slate-800">{room.name}</h3>
                    <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded">{room.code}</span>
                  </div>
                  
                  <div className="mb-4 space-y-1">
                    <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Giá niêm yết (VNĐ)</p>
                    <div className="flex justify-between text-sm">
                        <span>Giờ:</span> <span className="font-bold text-indigo-600">{formatCurrency(room.priceHourly)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span>Ngày:</span> <span className="font-bold text-indigo-600">{formatCurrency(room.priceDaily)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span>Đêm:</span> <span className="font-bold text-indigo-600">{formatCurrency(room.priceOvernight)}</span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-2">Tiện ích phòng</p>
                    <div className="flex flex-wrap gap-2">
                      {room.amenities.map((item, idx) => (
                        <span key={idx} className="px-3 py-1 bg-gray-50 border border-gray-100 rounded text-xs font-medium text-gray-600">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Add New Room Type Card */}
            <div 
                onClick={() => handleOpenRoomTypeModal()}
                className="bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-6 text-gray-400 hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50/50 transition-all cursor-pointer min-h-[300px]"
            >
              <div className="w-12 h-12 rounded-full bg-white border border-current flex items-center justify-center mb-3 shadow-sm">
                <Plus size={24} />
              </div>
              <span className="font-semibold">Thêm cấu hình loại phòng mới</span>
            </div>
          </div>
        )}

        {/* --- TAB 2: SEASONAL RATES --- */}
        {activeTab === 'seasons' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            {/* Add Form */}
            <div className="p-6 border-b border-gray-100 bg-gray-50/50">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                <div className="md:col-span-3">
                  <label className="block text-xs font-bold text-gray-500 mb-1">Tên mùa/Sự kiện</label>
                  <input 
                    type="text" 
                    placeholder="VD: Hè 2024" 
                    className="w-full border-gray-300 rounded-lg p-2.5 text-sm border focus:ring-indigo-500 outline-none"
                    value={newSeason.name}
                    onChange={(e) => setNewSeason({...newSeason, name: e.target.value})}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs font-bold text-gray-500 mb-1">Bắt đầu</label>
                  <input 
                    type="date" 
                    className="w-full border-gray-300 rounded-lg p-2.5 text-sm border focus:ring-indigo-500 outline-none" 
                    value={newSeason.start}
                    onChange={(e) => setNewSeason({...newSeason, start: e.target.value})}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs font-bold text-gray-500 mb-1">Kết thúc</label>
                  <input 
                    type="date" 
                    className="w-full border-gray-300 rounded-lg p-2.5 text-sm border focus:ring-indigo-500 outline-none" 
                    value={newSeason.end}
                    onChange={(e) => setNewSeason({...newSeason, end: e.target.value})}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 mb-1">Hệ số giá (x)</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    placeholder="1.2" 
                    className="w-full border-gray-300 rounded-lg p-2.5 text-sm border focus:ring-indigo-500 outline-none" 
                    value={newSeason.value}
                    onChange={(e) => setNewSeason({...newSeason, value: e.target.value})}
                  />
                </div>
                <div className="md:col-span-1">
                  <button 
                    onClick={handleAddSeason}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-2.5 rounded-lg flex items-center justify-center transition-colors"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>
            </div>

            {/* List */}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-white text-xs uppercase text-gray-500 font-bold tracking-wider border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-4">Tên</th>
                    <th className="px-6 py-4">Thời gian</th>
                    <th className="px-6 py-4">Điều chỉnh giá</th>
                    <th className="px-6 py-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {seasons.map((season) => (
                    <tr key={season.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-bold text-slate-800">{season.name}</td>
                      <td className="px-6 py-4 text-gray-600 text-sm">
                        {season.start} đến {season.end}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`font-bold ${season.value >= 1 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {season.adjustment}
                        </span>
                        <span className="text-gray-400 text-xs ml-2">(x{season.value})</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                            onClick={() => handleDeleteSeason(season.id)}
                            className="text-gray-400 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {seasons.length === 0 && (
                      <tr>
                          <td colSpan={4} className="px-6 py-8 text-center text-gray-400 italic">Chưa có dữ liệu mùa</td>
                      </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- TAB 3: AI DYNAMIC PRICING --- */}
        {activeTab === 'ai' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-3 text-blue-800 items-start">
              <Info className="shrink-0 mt-0.5" size={20} />
              <p className="text-sm">
                Giá động cho phép hệ thống tự động điều chỉnh giá phòng dựa trên công suất thực tế. 
                Quy tắc sẽ được áp dụng khi khách tìm kiếm phòng.
              </p>
            </div>

            {/* Rule Config Form (Mock Only) */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 opacity-75 pointer-events-none">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                <div className="md:col-span-4">
                  <label className="block text-xs font-bold text-gray-500 mb-1">Tên Quy Tắc</label>
                  <input type="text" placeholder="VD: Tăng khi full phòng" className="w-full border-gray-300 rounded-lg p-2.5 text-sm border focus:ring-indigo-500 outline-none" disabled/>
                </div>
                <div className="md:col-span-4">
                  <label className="block text-xs font-bold text-gray-500 mb-1">Ngưỡng Công Suất (%)</label>
                  <input type="number" placeholder="80" className="w-full border-gray-300 rounded-lg p-2.5 text-sm border focus:ring-indigo-500 outline-none" disabled/>
                </div>
                <div className="md:col-span-3">
                   <label className="block text-xs font-bold text-gray-500 mb-1">Hệ số giá (x)</label>
                   <input type="number" step="0.1" placeholder="1.1" className="w-full border-gray-300 rounded-lg p-2.5 text-sm border focus:ring-indigo-500 outline-none" disabled/>
                </div>
                <div className="md:col-span-1">
                  <button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-2.5 rounded-lg flex items-center justify-center transition-colors">
                    <Plus size={20} />
                  </button>
                </div>
              </div>
            </div>

            {/* Rules List */}
            <div className="space-y-4">
              {aiRules.map((rule) => (
                <div key={rule.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                      <TrendingUp size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800">{rule.name}</h4>
                      <div className="text-sm text-gray-500 flex gap-4 mt-0.5">
                        <span>Khi công suất: <span className="font-medium text-slate-700">{rule.condition}</span></span>
                        <span>&rarr;</span>
                        <span>{rule.action}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${rule.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {rule.active ? 'Đang bật' : 'Đã tắt'}
                    </span>
                    <button className="text-indigo-600 hover:underline text-sm font-medium">
                      {rule.active ? 'Tắt' : 'Bật'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* --- MODAL: EDIT/ADD ROOM TYPE --- */}
      {isRoomTypeModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl overflow-hidden transform transition-all">
              <div className="bg-indigo-600 px-6 py-4 flex justify-between items-center text-white">
                <h2 className="text-lg font-bold">{editingId ? 'Sửa Loại Phòng' : 'Thêm Loại Phòng'}</h2>
                <button onClick={() => setIsRoomTypeModalOpen(false)} className="hover:bg-indigo-700 p-2 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveRoomTypeSubmit} className="p-6 space-y-4">
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tên loại phòng (Hiển thị)</label>
                      <input 
                        required
                        className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={rtForm.name}
                        onChange={(e) => setRtForm({...rtForm, name: e.target.value})}
                        placeholder="VD: Phòng Đơn VIP"
                      />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Mã loại phòng (System)</label>
                          <select 
                            className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={rtForm.code}
                            onChange={(e) => setRtForm({...rtForm, code: e.target.value})}
                          >
                            <option value="Standard">Standard</option>
                            <option value="Double">Double</option>
                            <option value="VIP">VIP</option>
                            <option value="Family">Family</option>
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Link Ảnh</label>
                          <input 
                            className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={rtForm.image}
                            onChange={(e) => setRtForm({...rtForm, image: e.target.value})}
                            placeholder="https://..."
                          />
                      </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3">
                      <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1">Giá Giờ</label>
                          <input 
                            type="text"
                            required
                            className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={formatNumber(rtForm.priceHourly)}
                            onChange={(e) => {
                                const val = parseNumber(e.target.value);
                                if (!isNaN(val)) setRtForm({...rtForm, priceHourly: val});
                            }}
                          />
                      </div>
                       <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1">Giá Ngày</label>
                          <input 
                            type="text"
                            required
                            className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={formatNumber(rtForm.priceDaily)}
                            onChange={(e) => {
                                const val = parseNumber(e.target.value);
                                if (!isNaN(val)) setRtForm({...rtForm, priceDaily: val});
                            }}
                          />
                      </div>
                       <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1">Giá Đêm</label>
                          <input 
                            type="text"
                            required
                            className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={formatNumber(rtForm.priceOvernight)}
                            onChange={(e) => {
                                const val = parseNumber(e.target.value);
                                if (!isNaN(val)) setRtForm({...rtForm, priceOvernight: val});
                            }}
                          />
                      </div>
                  </div>

                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tiện ích (phân cách bằng dấu phẩy)</label>
                      <textarea 
                        className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={rtForm.amenities}
                        onChange={(e) => setRtForm({...rtForm, amenities: e.target.value})}
                        placeholder="VD: Wifi, TV, Tủ lạnh..."
                        rows={3}
                      />
                  </div>
                  <div className="pt-2 flex gap-3">
                     <button type="button" onClick={() => setIsRoomTypeModalOpen(false)} className="flex-1 py-2.5 border border-gray-300 rounded-lg font-bold text-gray-700 hover:bg-gray-50 transition-colors">Hủy</button>
                     <button type="submit" className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-colors">Lưu</button>
                  </div>
              </form>
           </div>
        </div>
      )}
    </div>
  );
};
