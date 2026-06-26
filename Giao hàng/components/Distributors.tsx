import React, { useState } from 'react';
import { Distributor } from '../types';
import { Search, Plus, MapPin, Phone, User, Trash2, Edit } from 'lucide-react';

interface Props {
  distributors: Distributor[];
  onAdd: (d: Distributor) => void;
  onDelete: (id: string) => void;
}

const Distributors: React.FC<Props> = ({ distributors, onAdd, onDelete }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newNPP, setNewNPP] = useState<Partial<Distributor>>({
    deliveryType: 'DELIVERY'
  });

  const filtered = distributors.filter(d => 
    d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.region.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newNPP.name && newNPP.phone) {
      onAdd({
        id: `NPP${Date.now()}`,
        name: newNPP.name!,
        address: newNPP.address || '',
        region: newNPP.region || '',
        phone: newNPP.phone!,
        operator: newNPP.operator || '',
        deliveryType: newNPP.deliveryType as 'DELIVERY' | 'PICKUP' | 'INTERNAL'
      });
      setIsModalOpen(false);
      setNewNPP({ deliveryType: 'DELIVERY' });
    }
  };

  const getBadgeStyle = (type: string) => {
    switch (type) {
      case 'DELIVERY': return 'bg-green-100 text-green-700';
      case 'PICKUP': return 'bg-orange-100 text-orange-700';
      case 'INTERNAL': return 'bg-purple-100 text-purple-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  const getBadgeLabel = (type: string) => {
    switch (type) {
      case 'DELIVERY': return 'Giao tận nơi';
      case 'PICKUP': return 'Đến kho nhận';
      case 'INTERNAL': return 'Giao hàng nội bộ';
      default: return type;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold text-slate-800">Quản lý NPP</h2>
        <div className="flex gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Tìm tên hoặc tuyến..." 
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-brand-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-brand-700 transition"
          >
            <Plus className="w-4 h-4" /> Thêm NPP
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(d => (
          <div key={d.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-semibold text-lg text-slate-800">{d.name}</h3>
                <span className={`text-xs px-2 py-1 rounded-full ${getBadgeStyle(d.deliveryType)}`}>
                  {getBadgeLabel(d.deliveryType)}
                </span>
              </div>
              <div className="flex gap-1">
                 <button className="p-1 text-slate-400 hover:text-brand-600"><Edit className="w-4 h-4" /></button>
                 <button onClick={() => onDelete(d.id)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            
            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span>{d.address}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 flex items-center justify-center text-xs font-bold bg-slate-100 rounded text-slate-500">KV</div>
                <span>{d.region}</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                <span>VH: {d.operator}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400" />
                <span>{d.phone}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal - Simplified for brevity */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg">
            <h3 className="text-xl font-bold mb-4">Thêm Nhà Phân Phối</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input 
                required placeholder="Tên NPP" className="w-full border p-2 rounded" 
                value={newNPP.name || ''} onChange={e => setNewNPP({...newNPP, name: e.target.value})}
              />
              <input 
                placeholder="Địa chỉ" className="w-full border p-2 rounded"
                value={newNPP.address || ''} onChange={e => setNewNPP({...newNPP, address: e.target.value})}
              />
              <div className="grid grid-cols-2 gap-4">
                <input 
                   placeholder="Khu vực/Tuyến" className="w-full border p-2 rounded"
                   value={newNPP.region || ''} onChange={e => setNewNPP({...newNPP, region: e.target.value})}
                />
                 <input 
                   required placeholder="Số điện thoại" className="w-full border p-2 rounded"
                   value={newNPP.phone || ''} onChange={e => setNewNPP({...newNPP, phone: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input 
                   placeholder="Người vận hành" className="w-full border p-2 rounded"
                   value={newNPP.operator || ''} onChange={e => setNewNPP({...newNPP, operator: e.target.value})}
                />
                <select 
                  className="w-full border p-2 rounded"
                  value={newNPP.deliveryType} onChange={e => setNewNPP({...newNPP, deliveryType: e.target.value as any})}
                >
                  <option value="DELIVERY">Giao tận nơi</option>
                  <option value="PICKUP">Đến kho nhận</option>
                  <option value="INTERNAL">Giao hàng nội bộ</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded">Hủy</button>
                <button type="submit" className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">Lưu</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Distributors;