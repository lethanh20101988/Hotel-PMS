
import React from 'react';
import { Trash2, X, AlertTriangle } from 'lucide-react';
import { Invoice } from '@shared/types';

interface DeleteInvoiceModalProps {
  invoice: Invoice | null;
  onClose: () => void;
  onConfirm: (invoice: Invoice) => void;
}

export const DeleteInvoiceModal: React.FC<DeleteInvoiceModalProps> = ({ invoice, onClose, onConfirm }) => {
  if (!invoice) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-fade-in">
        <div className="bg-red-600 p-4 text-white flex justify-between items-center">
          <h3 className="font-bold flex items-center gap-2">
            <Trash2 className="w-5 h-5" /> Xóa Hóa đơn?
          </h3>
          <button onClick={onClose} className="hover:bg-red-700 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 text-center space-y-4">
           <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
           <p className="text-slate-600">Bạn có chắc chắn muốn xóa hóa đơn số <b>{invoice.invoiceNumber || invoice.id}</b>?</p>
           <p className="text-xs text-slate-400">Hành động này không thể hoàn tác và có thể ảnh hưởng đến báo cáo thuế.</p>
        </div>
        <div className="p-4 bg-slate-50 border-t flex justify-end gap-2">
           <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded">Hủy</button>
           <button onClick={() => onConfirm(invoice)} className="px-6 py-2 bg-red-600 text-white rounded font-bold hover:bg-red-700">Xóa</button>
        </div>
      </div>
    </div>
  );
};
