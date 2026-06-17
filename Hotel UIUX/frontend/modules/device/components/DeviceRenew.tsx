
import React, { useState, useEffect } from 'react';
import { RefreshCw, X, AlertTriangle, ArrowRight, Wallet, Clock, CheckCircle2, Download, ShoppingCart } from 'lucide-react';
import { Device } from '@shared/types';
import { formatCurrency, diffDays, normalizeDate } from '@shared/utils/format';
import { VAT_RATE_NOT_SUBJECT, computeVatAmount } from '@shared/utils/vatRate';
import { useApp } from '../../../app/store';
import { paymentSegmentSoftUi } from '@shared/ui/paymentSegmentSoftUi';

interface DeviceRenewProps {
  device: Device | null;
  onClose: () => void;
  onConfirm: (
    fee: number, 
    vatRate: number, 
    newExpiry: Date, 
    durationMonths: number, 
    paymentMethod: string, 
    paymentStatus: 'PAID' | 'DEBT',
    inputCostInfo?: {
      supplier: string,
      invoiceNo: string,
      costPrice: number,
      vatRate: number,
      paymentMethod: string,
      description?: string,
      unit?: string,
      bankAccountId?: string
    },
    salesInfo?: {
      description?: string,
      unit?: string,
      bankAccountId?: string
    }
  ) => void;
}

export const DeviceRenew: React.FC<DeviceRenewProps> = ({ device, onClose, onConfirm }) => {
  const { bankAccounts } = useApp();
  if (!device) return null;

  const [activeSubTab, setActiveSubTab] = useState<'SALES' | 'COST'>('SALES');
  const [mode, setMode] = useState<'MONTH' | 'DATE'>('MONTH');
  const [durationMonths, setDurationMonths] = useState(12);
  const [targetDate, setTargetDate] = useState('');
  const [vatRate, setVatRate] = useState(device.vatRate || 10);
  const [customFee, setCustomFee] = useState<number | string>(device.renewalFee || 0);
  
  // Sales Payment State
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'DEBT'>('PAID');
  const [paymentMethod, setPaymentMethod] = useState('BANK');
  const [selectedSalesBankAccountId, setSelectedSalesBankAccountId] = useState('');
  const [salesDescription, setSalesDescription] = useState(`Gia hạn ${device.name} - 12 tháng`);
  const [salesUnit, setSalesUnit] = useState('Lần');

  // Input Cost (Giá vốn thực tế) State
  const [hasInputCost, setHasInputCost] = useState(true);
  const [inputSupplier, setInputSupplier] = useState('');
  const [inputInvoiceNo, setInputInvoiceNo] = useState('');
  const [inputCostPrice, setInputCostPrice] = useState<number>(0);
  const [inputVatRate, setInputVatRate] = useState(10);
  const [inputPaymentMethod, setInputPaymentMethod] = useState('BANK');
  const [selectedInputBankAccountId, setSelectedInputBankAccountId] = useState('');
  const [inputDescription, setInputDescription] = useState(`Giá vốn gia hạn thiết bị ${device.imei}`);
  const [inputUnit, setInputUnit] = useState('Lần');
  const activeBankAccounts = bankAccounts.filter((bank) => bank.status === 'ACTIVE');
  const selectedSalesBankAccount = activeBankAccounts.find((bank) => bank.id === selectedSalesBankAccountId) || null;
  const selectedInputBankAccount = activeBankAccounts.find((bank) => bank.id === selectedInputBankAccountId) || null;

  const isExpired = new Date(device.expiryDate) < new Date();
  const startDate = isExpired ? normalizeDate(new Date()) : normalizeDate(device.expiryDate);

  useEffect(() => {
    if (mode === 'DATE' && !targetDate) {
      const d = new Date(startDate);
      d.setFullYear(d.getFullYear() + 1);
      setTargetDate(d.toISOString().split('T')[0]);
    }
  }, [mode, startDate]);

  useEffect(() => {
    const baseAnnualFee = device.renewalFee || 0;
    const dailyRate = baseAnnualFee / 365;

    if (mode === 'MONTH') {
      const calculated = Math.round((baseAnnualFee / 12) * durationMonths);
      setCustomFee(calculated);
      setSalesDescription(`Gia hạn ${device.name} - ${durationMonths} tháng`);
      // Mặc định giá vốn bằng 50% nếu chưa nhập
      if (inputCostPrice === 0) setInputCostPrice(Math.round(calculated * 0.5));
    } else if (mode === 'DATE' && targetDate) {
      const days = diffDays(startDate, targetDate);
      if (days > 0) {
        const calculated = Math.round(days * dailyRate);
        setCustomFee(calculated);
        setSalesDescription(`Gia hạn ${device.name} - ${durationMonths} tháng`);
        if (inputCostPrice === 0) setInputCostPrice(Math.round(calculated * 0.5));
      }
    }
  }, [mode, durationMonths, targetDate, device.renewalFee, startDate]);

  useEffect(() => {
    if (paymentStatus !== 'PAID' || paymentMethod !== 'BANK') {
      setSelectedSalesBankAccountId('');
      return;
    }
    if (!selectedSalesBankAccountId && activeBankAccounts.length > 0) {
      setSelectedSalesBankAccountId(activeBankAccounts[0].id);
    }
  }, [paymentMethod, paymentStatus, selectedSalesBankAccountId, activeBankAccounts]);

  useEffect(() => {
    if (inputPaymentMethod !== 'BANK') {
      setSelectedInputBankAccountId('');
      return;
    }
    if (!selectedInputBankAccountId && activeBankAccounts.length > 0) {
      setSelectedInputBankAccountId(activeBankAccounts[0].id);
    }
  }, [inputPaymentMethod, selectedInputBankAccountId, activeBankAccounts]);

  const calculateNewExpiry = () => {
    const d = new Date(startDate);
    if (mode === 'MONTH') {
      d.setMonth(d.getMonth() + durationMonths);
    } else {
      return new Date(targetDate);
    }
    return d;
  };

  const newExpiry = calculateNewExpiry();
  const feeValue = typeof customFee === 'number' ? customFee : Number(customFee) || 0;
  const vatAmount = computeVatAmount(feeValue, vatRate);
  const totalAmount = feeValue + vatAmount;

  const handleConfirm = () => {
    if (paymentStatus === 'PAID' && paymentMethod === 'BANK' && !selectedSalesBankAccount) {
      window.alert('Vui lòng chọn tài khoản ngân hàng cho phần thu tiền gia hạn.');
      return;
    }
    if (hasInputCost && inputPaymentMethod === 'BANK' && !selectedInputBankAccount) {
      window.alert('Vui lòng chọn tài khoản ngân hàng cho phần thanh toán NCC.');
      return;
    }
    const inputCostInfo = hasInputCost ? {
      supplier: inputSupplier || 'Nhà cung cấp dịch vụ',
      invoiceNo: inputInvoiceNo,
      costPrice: inputCostPrice,
      vatRate: inputVatRate,
      paymentMethod: inputPaymentMethod,
      description: inputDescription,
      unit: inputUnit,
      bankAccountId: inputPaymentMethod === 'BANK' ? selectedInputBankAccount?.id : undefined,
    } : undefined;

    onConfirm(
      feeValue,
      vatRate,
      newExpiry,
      durationMonths,
      paymentMethod,
      paymentStatus,
      inputCostInfo,
      { description: salesDescription, unit: salesUnit, bankAccountId: paymentMethod === 'BANK' ? selectedSalesBankAccount?.id : undefined }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-fade-in flex flex-col max-h-[95vh]">
        <div className="bg-blue-600 p-4 text-white flex justify-between items-center shrink-0">
          <h3 className="font-bold flex items-center gap-2">
            <RefreshCw className="w-5 h-5" /> Gia hạn thiết bị & Hạch toán thực tế
          </h3>
          <button onClick={onClose} className="hover:bg-blue-700 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
        
        {/* Sub-tabs */}
        <div className="flex bg-slate-100 border-b shrink-0">
           <button 
            onClick={() => setActiveSubTab('SALES')}
            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeSubTab === 'SALES' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:bg-slate-200'}`}
           >
              <CheckCircle2 className="w-4 h-4" /> 1. Hoá đơn Bán ra (Doanh thu)
           </button>
           <button 
            onClick={() => setActiveSubTab('COST')}
            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeSubTab === 'COST' ? 'bg-white text-emerald-600 border-b-2 border-emerald-600' : 'text-slate-500 hover:bg-slate-200'}`}
           >
              <Download className="w-4 h-4" /> 2. Hoá đơn Đầu vào (Giá vốn)
           </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeSubTab === 'SALES' ? (
            <div className="space-y-5 animate-fade-in">
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-blue-900 text-lg">{device.customerName}</div>
                    <div className="text-sm text-blue-700">{device.name} - {device.licensePlate} ({device.imei})</div>
                  </div>
                  <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full font-bold">
                    {device.telecomPlan || 'N/A'}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-4 text-sm bg-white/50 p-2 rounded-lg border border-blue-200/50">
                  <div className="text-center flex-1">
                      <div className="text-[10px] font-medium text-slate-500">Hết hạn cũ</div>
                      <div className={`font-mono font-bold ${isExpired ? 'text-red-500 line-through' : 'text-slate-700'}`}>
                        {new Date(device.expiryDate).toLocaleDateString('vi-VN')}
                      </div>
                  </div>
                  <ArrowRight className="text-blue-300" />
                  <div className="text-center flex-1">
                      <div className="text-[10px] font-medium text-slate-500">Hết hạn mới</div>
                      <div className="font-mono font-bold text-blue-600">
                        {newExpiry.toLocaleDateString('vi-VN')}
                      </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-4">
                    <label className="block text-sm font-bold text-slate-700">Thông tin gia hạn</label>
                    <div className="flex bg-slate-100 p-1 rounded-lg text-xs mb-3">
                        <button onClick={() => setMode('MONTH')} className={`flex-1 py-1.5 rounded-md ${mode === 'MONTH' ? 'bg-white shadow text-blue-600 font-bold' : 'text-slate-50'}`}>Theo Tháng</button>
                        <button onClick={() => setMode('DATE')} className={`flex-1 py-1.5 rounded-md ${mode === 'DATE' ? 'bg-white shadow text-blue-600 font-bold' : 'text-slate-50'}`}>Chọn Ngày</button>
                    </div>
                    {mode === 'MONTH' ? (
                      <div className="grid grid-cols-3 gap-2">
                        {[6, 12, 24].map(m => (
                          <button key={m} onClick={() => setDurationMonths(m)} className={`py-2 rounded-lg border text-xs font-bold transition-all ${durationMonths === m ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>{m}T</button>
                        ))}
                      </div>
                    ) : (
                      <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
                    )}
                 </div>

                 <div className="space-y-4">
                    <label className="block text-sm font-bold text-slate-700">Giá bán & Thuế</label>
                    <input type="number" value={customFee} onChange={(e) => setCustomFee(e.target.value)} className="w-full p-2 border rounded-lg text-sm font-bold text-blue-600" placeholder="Giá bán" />
                    <div className="flex bg-slate-100 p-1 rounded-lg flex-wrap gap-y-1 gap-x-0.5">
                      {[0, 5, 8, 10].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setVatRate(r)}
                          className={`flex-1 min-w-[3.25rem] text-xs py-1.5 rounded ${vatRate === r ? 'bg-white shadow text-blue-600 font-bold' : 'text-slate-500'}`}
                        >
                          {r}%
                        </button>
                      ))}
                      <button
                        type="button"
                        title="HHDV không chịu thuế GTGT"
                        onClick={() => setVatRate(VAT_RATE_NOT_SUBJECT)}
                        className={`flex-1 min-w-[4.5rem] text-[10px] py-1.5 px-1 rounded leading-tight ${vatRate === VAT_RATE_NOT_SUBJECT ? 'bg-white shadow text-blue-600 font-bold' : 'text-slate-500'}`}
                      >
                        Không chịu thuế
                      </button>
                    </div>
                 </div>
              </div>

              <div className="border-t pt-4">
                <label className="block text-sm font-bold text-slate-700 mb-3">Thông tin hoá đơn bán ra</label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold tracking-tight text-slate-500">Diễn giải</label>
                    <input
                      value={salesDescription}
                      onChange={e => setSalesDescription(e.target.value)}
                      className="w-full p-2 border rounded-lg text-sm"
                      placeholder="VD: Gia hạn dịch vụ tháng 01/2026..."
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold tracking-tight text-slate-500">Đơn vị tính</label>
                    <input
                      value={salesUnit}
                      onChange={e => setSalesUnit(e.target.value)}
                      className="w-full p-2 border rounded-lg text-sm"
                      placeholder="VD: Lần, Tháng..."
                    />
                    </div>
                 </div>
              </div>

              <div className="border-t pt-4">
                <label className="block text-sm font-bold text-slate-700 mb-3">Thanh toán đầu ra</label>
                <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentStatus('PAID')}
                      className={`flex flex-col items-center gap-1 rounded-xl border p-3 transition-all ${
                        paymentStatus === 'PAID'
                          ? `border-emerald-200 ${paymentSegmentSoftUi.cashActive}`
                          : 'border-slate-200/90 bg-white text-slate-500 hover:bg-emerald-50/40'
                      }`}
                    >
                      <CheckCircle2 className="h-5 w-5" /> <span className="text-xs font-bold">Thu tiền ngay</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentStatus('DEBT')}
                      className={`flex flex-col items-center gap-1 rounded-xl border p-3 transition-all ${
                        paymentStatus === 'DEBT'
                          ? `border-rose-200 ${paymentSegmentSoftUi.debtActive}`
                          : 'border-slate-200/90 bg-white text-slate-500 hover:bg-rose-50/40'
                      }`}
                    >
                      <Clock className="h-5 w-5" /> <span className="text-xs font-bold">Ghi nợ (131)</span>
                    </button>
                </div>
                {paymentStatus === 'PAID' && (
                  <div className="mt-3 space-y-2">
                      <label className="block text-[10px] font-semibold text-slate-600">Hình thức thu</label>
                      <select
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-sky-400/40"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                      >
                        <option value="BANK">Chuyển khoản (chọn TK NH)</option>
                        <option value="CASH">Tiền mặt (TK 1111)</option>
                      </select>
                      {paymentMethod === 'BANK' && (
                        <>
                          <label className="block text-[10px] font-semibold text-sky-900">Tài khoản ngân hàng thu tiền</label>
                          <select
                            className={`${paymentSegmentSoftUi.bankSelect} w-full`}
                            value={selectedSalesBankAccountId}
                            onChange={(e) => setSelectedSalesBankAccountId(e.target.value)}
                          >
                            <option value="">— Chọn tài khoản ngân hàng —</option>
                            {activeBankAccounts.map((bank) => (
                              <option key={bank.id} value={bank.id}>
                                {bank.bankName} - {bank.accountNumber}
                              </option>
                            ))}
                          </select>
                          <p className="text-[10px] leading-snug text-sky-900/85">
                            {selectedSalesBankAccount
                              ? `Hệ thống sẽ dùng TK ${selectedSalesBankAccount.linkedAccountCode} khi ghi nhận thu tiền.`
                              : 'Chọn tài khoản thực tế để không hạch toán trực tiếp vào 1121 tổng hợp.'}
                          </p>
                        </>
                      )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5 animate-fade-in">
               <div className="flex items-center justify-between bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                  <div className="flex items-center gap-3">
                     <ShoppingCart className="w-6 h-6 text-emerald-600" />
                     <div>
                        <h4 className="font-bold text-emerald-900">Chi phí đầu vào thực tế</h4>
                        <p className="text-xs text-emerald-700">Dịch vụ gia hạn: tập hợp vào 154, sau đó kết chuyển 154 → 632 trong “Kế toán tổng hợp → Kết chuyển cuối kỳ”</p>
                     </div>
                  </div>
                  <div className="flex items-center gap-2">
                     <label className="text-xs font-bold text-slate-500">Kích hoạt</label>
                     <input type="checkbox" checked={hasInputCost} onChange={e => setHasInputCost(e.target.checked)} className="w-5 h-5 accent-emerald-600" />
                  </div>
               </div>

               {hasInputCost ? (
                  <div className="space-y-4">
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="mb-1 block text-xs font-semibold tracking-tight text-slate-500">Nhà cung cấp (NCC)</label>
                           <input value={inputSupplier} onChange={e => setInputSupplier(e.target.value)} className="w-full p-2 border rounded-lg text-sm" placeholder="VD: Viettel, Mobifone..." />
                        </div>
                        <div>
                           <label className="mb-1 block text-xs font-semibold tracking-tight text-slate-500">Số hoá đơn đầu vào</label>
                           <input value={inputInvoiceNo} onChange={e => setInputInvoiceNo(e.target.value)} className="w-full p-2 border rounded-lg text-sm font-mono" placeholder="Số hoá đơn GTGT..." />
                        </div>
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="mb-1 block text-xs font-semibold tracking-tight text-slate-500">Diễn giải</label>
                           <input value={inputDescription} onChange={e => setInputDescription(e.target.value)} className="w-full p-2 border rounded-lg text-sm" placeholder="VD: Chi phí NCC gia hạn..." />
                        </div>
                        <div>
                           <label className="mb-1 block text-xs font-semibold tracking-tight text-slate-500">Đơn vị tính</label>
                           <input value={inputUnit} onChange={e => setInputUnit(e.target.value)} className="w-full p-2 border rounded-lg text-sm" placeholder="VD: Lần, Tháng..." />
                        </div>
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="mb-1 block text-xs font-semibold tracking-tight text-slate-500">Giá vốn đầu vào (chưa VAT)</label>
                           <input type="number" value={inputCostPrice} onChange={e => setInputCostPrice(Number(e.target.value))} className="w-full p-2 border rounded-lg text-sm font-bold text-emerald-600" />
                           <p className="text-[10px] text-slate-400 mt-1 italic">* Tập hợp: Nợ 154 / Có 331 (hoặc tiền). Cuối kỳ: hệ thống sẽ kết chuyển 154 → 632 trong mục Kết chuyển cuối kỳ.</p>
                        </div>
                        <div>
                           <label className="mb-1 block text-xs font-semibold tracking-tight text-slate-500">Thuế VAT đầu vào (%)</label>
                           <div className="flex bg-slate-100 p-1 rounded-lg flex-wrap gap-y-1 gap-x-0.5">
                              {[0, 5, 8, 10].map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => setInputVatRate(r)}
                                  className={`flex-1 min-w-[3.25rem] text-xs py-1.5 rounded ${inputVatRate === r ? 'bg-white shadow text-emerald-600 font-bold' : 'text-slate-500'}`}
                                >
                                  {r}%
                                </button>
                              ))}
                              <button
                                type="button"
                                title="HHDV không chịu thuế GTGT"
                                onClick={() => setInputVatRate(VAT_RATE_NOT_SUBJECT)}
                                className={`flex-1 min-w-[4.5rem] text-[10px] py-1.5 px-1 rounded leading-tight ${inputVatRate === VAT_RATE_NOT_SUBJECT ? 'bg-white shadow text-emerald-600 font-bold' : 'text-slate-500'}`}
                              >
                                Không chịu thuế
                              </button>
                           </div>
                        </div>
                     </div>

                     <div>
                        <label className="mb-1 block text-xs font-semibold tracking-tight text-slate-500">Hình thức thanh toán cho NCC</label>
                        <select className="w-full p-2 border rounded-lg text-sm" value={inputPaymentMethod} onChange={e => setInputPaymentMethod(e.target.value)}>
                           <option value="DEBT">Ghi nhận Công nợ phải trả (TK 331)</option>
                           <option value="BANK">Chuyển khoản ngay (chọn TK NH)</option>
                           <option value="CASH">Tiền mặt ngay (TK 1111)</option>
                        </select>
                        {inputPaymentMethod === 'BANK' && (
                          <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50/80 p-3">
                            <label className="mb-1 block text-xs font-semibold tracking-tight text-emerald-700">Tài khoản ngân hàng thanh toán NCC</label>
                            <select
                              className="w-full rounded-lg border border-emerald-200 p-2 text-sm font-semibold text-slate-700"
                              value={selectedInputBankAccountId}
                              onChange={(e) => setSelectedInputBankAccountId(e.target.value)}
                            >
                              <option value="">-- Chọn tài khoản ngân hàng --</option>
                              {activeBankAccounts.map((bank) => (
                                <option key={bank.id} value={bank.id}>
                                  {bank.bankName} - {bank.accountNumber}
                                </option>
                              ))}
                            </select>
                            <p className="mt-2 text-[10px] text-emerald-700">
                              {selectedInputBankAccount
                                ? `Hệ thống sẽ dùng TK ${selectedInputBankAccount.linkedAccountCode} khi hạch toán thanh toán NCC.`
                                : 'Chọn tài khoản thực tế để hệ thống dùng đúng TK 1121xxx.'}
                            </p>
                          </div>
                        )}
                     </div>

                     <div className="bg-slate-50 p-3 rounded-lg border border-dashed border-slate-300">
                        <div className="flex justify-between text-xs mb-1">
                           <span className="text-slate-500">Thành tiền đầu vào:</span>
                           <span className="font-bold">{formatCurrency(inputCostPrice)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                           <span className="text-slate-500">Tiền thuế (khấu trừ):</span>
                           <span className="font-bold">{formatCurrency(computeVatAmount(inputCostPrice, inputVatRate))}</span>
                        </div>
                        <div className="flex justify-between text-sm mt-2 pt-2 border-t font-bold text-emerald-700">
                           <span>Tổng thanh toán NCC:</span>
                           <span>{formatCurrency(inputCostPrice + computeVatAmount(inputCostPrice, inputVatRate))}</span>
                        </div>
                     </div>
                  </div>
               ) : (
                  <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                     <AlertTriangle className="w-10 h-10 mx-auto mb-2 opacity-20" />
                     <p>Đã tắt nhập thông tin giá vốn đầu vào.</p>
                     <p className="text-xs">Bút toán giá vốn sẽ không được sinh ra tự động.</p>
                  </div>
               )}
            </div>
          )}
        </div>

        <div className="bg-slate-50 p-4 border-t shrink-0 flex items-center justify-between">
          <div className="text-sm">
             <div className="text-[10px] font-medium text-slate-500">Tổng doanh thu bán ra</div>
             <div className="font-bold text-xl text-blue-600">{formatCurrency(totalAmount)}</div>
          </div>
          <div className="flex gap-2">
             <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-bold">Hủy</button>
             <button 
               onClick={handleConfirm}
               className="px-8 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-200 transform active:scale-95 transition-all"
             >
               Xác nhận Ghi sổ
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};
