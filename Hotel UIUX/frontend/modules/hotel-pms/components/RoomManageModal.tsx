
import React, { useState, useEffect } from 'react';
import { Room } from '../types';
import { X } from 'lucide-react';
import { formatNumber, parseNumber } from '../utils';

interface RoomManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (roomData: Partial<Room>) => void;
  initialData?: Room | null;
}

export const RoomManageModal: React.FC<RoomManageModalProps> = ({ isOpen, onClose, onSubmit, initialData }) => {
  const [number, setNumber] = useState('');
  const [type, setType] = useState('Standard');
  const [floor, setFloor] = useState(1);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setNumber(initialData.number);
        setType(initialData.type);
        setFloor(initialData.floor);
      } else {
        setNumber('');
        setType('Standard');
        setFloor(1);
      }
    } else {
        setNumber('');
        setType('Standard');
        setFloor(1);
    }
  }, [isOpen, initialData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      number,
      type,
      floor: Number(floor),
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden transform transition-all">
        <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center">
          <h2 className="text-lg font-bold">{initialData ? 'Sửa thông tin phòng' : 'Thêm phòng mới'}</h2>
          <button onClick={onClose} className="hover:bg-slate-700 p-1 rounded-full"><X size={20}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Số phòng</label>
            <input 
              type="text" 
              required
              className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              value={number}
              onChange={(e) => {
                  setNumber(e.target.value);
                  // Auto-detect floor from first digit if adding new
                  if(!initialData && e.target.value) {
                      const firstDigit = parseInt(e.target.value.charAt(0));
                      if(!isNaN(firstDigit)) setFloor(firstDigit);
                  }
              }}
              placeholder="VD: 101, 205..."
              disabled={!!initialData} // Prevent changing ID/Number when editing
            />
            {initialData && <p className="text-xs text-gray-500 mt-1">Không thể thay đổi số phòng khi đang sửa.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Loại phòng</label>
            <select 
              className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="Standard">Standard (Tiêu chuẩn)</option>
              <option value="Double">Double (Đôi)</option>
              <option value="VIP">VIP (Cao cấp)</option>
              <option value="Family">Family (Gia đình)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tầng</label>
            <input 
              type="text" 
              required
              className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
              value={formatNumber(floor)}
              onChange={(e) => {
                  const val = parseNumber(e.target.value);
                  if(!isNaN(val)) setFloor(val);
              }}
            />
          </div>
          <div className="pt-4 flex gap-3">
             <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-300 rounded-lg font-bold text-gray-700 hover:bg-gray-50 transition-colors">Hủy</button>
             <button type="submit" className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-colors">Lưu thông tin</button>
          </div>
        </form>
      </div>
    </div>
  );
};
