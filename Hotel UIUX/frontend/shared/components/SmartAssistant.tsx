
import React, { useState } from 'react';
import { MessageSquare, ArrowRight, RefreshCw, Minus } from 'lucide-react';

export const SmartAssistant = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAsk = async () => {
    if (!query.trim()) return;
    setLoading(true);
    // Simulation
    setTimeout(() => {
       setResponse("Dựa trên dữ liệu hiện tại, doanh thu tháng này tăng 8% so với tháng trước. Có 3 thiết bị sắp hết hạn cần chú ý gia hạn.");
       setLoading(false);
    }, 1500);
  };

  if (!isOpen) {
     return (
        <button 
          onClick={() => setIsOpen(true)}
          className="vtr-no-print fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-purple-600 text-white shadow-lg transition-all hover:scale-105 hover:bg-purple-700 print:hidden"
        >
           <MessageSquare className="w-6 h-6" />
        </button>
     );
  }

  return (
    <div className="vtr-no-print fixed bottom-6 right-6 z-40 flex max-h-[500px] w-96 animate-fade-in flex-col overflow-hidden rounded-xl border border-purple-100 bg-white shadow-2xl print:hidden">
      <div className="bg-purple-600 p-4 flex justify-between items-center text-white">
        <h3 className="font-bold flex items-center gap-2">
           <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div> Trợ lý AI Kế toán
        </h3>
        <button onClick={() => setIsOpen(false)} className="hover:bg-purple-700 p-1 rounded"><Minus className="w-5 h-5" /></button>
      </div>
      <div className="p-4 flex-1 overflow-y-auto bg-slate-50 space-y-4">
        <div className="bg-white p-3 rounded-lg rounded-tl-none shadow-sm text-sm text-slate-700 border border-slate-100">
          Xin chào! Tôi có thể giúp gì về số liệu tài chính hoặc tình trạng thiết bị hôm nay?
        </div>
        {response && (
           <div className="bg-white p-3 rounded-lg rounded-tl-none shadow-sm text-sm text-slate-700 border border-slate-100">
              {response}
           </div>
        )}
      </div>
      <div className="p-3 bg-white border-t flex gap-2">
        <input 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          placeholder="Hỏi về doanh thu, công nợ..." 
          className="flex-1 text-sm p-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-500"
        />
        <button 
          onClick={handleAsk}
          disabled={loading}
          className="bg-purple-600 hover:bg-purple-700 text-white p-2 rounded-lg transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
