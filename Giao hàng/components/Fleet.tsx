
import React, { useState, useEffect } from 'react';
import { Vehicle, CostRecord, Trip, Order, AdvanceRecord, SalaryRecord, CostType, SalaryMethod, TripStatus, ReturnLog, InsuranceMode } from '../types';
import { Truck, Wrench, DollarSign, Calendar, Plus, Search, Trash2, Edit2, Coins, FileText, User, Phone, MapPin, AlertCircle, CheckCircle2, FileSpreadsheet, Calculator, Printer, TrendingUp, AlertOctagon, CheckSquare, RefreshCw, Wallet, Settings, Eye, AlertTriangle, ArrowRightLeft, Warehouse, RotateCcw, Navigation, PlayCircle, Loader2, ChevronRight, History, Package, ShieldCheck, Scale, Banknote, Lock, Unlock, FileCheck, UserPlus, CreditCard, ScrollText } from 'lucide-react';

interface Props {
  vehicles: Vehicle[];
  costs: CostRecord[];
  trips: Trip[];
  orders: Order[];
  advances: AdvanceRecord[];
  salaries: SalaryRecord[];
  returnLogs?: ReturnLog[]; // New prop
  onAdd: (v: Vehicle) => void;
  onUpdate: (v: Vehicle) => void;
  onDelete: (id: string) => void;
  onAddCost: (c: CostRecord) => void;
  onUpdateCost: (c: CostRecord) => void;
  onDeleteCost: (id: string) => void;
  onConfirmDelivery: (tripId: string, orderId: string) => void;
  onAddAdvance: (a: AdvanceRecord) => void;
  onUpdateAdvance: (a: AdvanceRecord) => void;
  onDeleteAdvance: (id: string) => void;
  onAddSalary: (s: SalaryRecord) => void;
  onDeleteSalary: (id: string) => void;
  onUpdateSalary: (s: SalaryRecord) => void;
  onTripReturnAction: (tripId: string, action: 'REQUEST' | 'APPROVE', returnWarehouse?: string) => void;
  onDriverSubmitReturn?: (tripId: string, returnData: { orderId: string, productId: string, quantity: number }[], warehouseName: string, warehouseAddress: string, note: string, receiver: string, receiverPhone: string) => void; // Updated handler
  onUpdateTripStatus: (tripId: string, status: TripStatus) => void; 
}

const Fleet: React.FC<Props> = ({ 
  vehicles, costs, trips, orders, advances, salaries, returnLogs = [],
  onAdd, onUpdate, onDelete, 
  onAddCost, onUpdateCost, onDeleteCost,
  onConfirmDelivery,
  onAddAdvance, onUpdateAdvance, onDeleteAdvance,
  onAddSalary, onDeleteSalary, onUpdateSalary,
  onTripReturnAction, onDriverSubmitReturn, onUpdateTripStatus
}) => {
  const [activeTab, setActiveTab] = useState<'VEHICLES' | 'COSTS' | 'SALARIES'>('VEHICLES');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Salary State
  const [salaryTab, setSalaryTab] = useState<'CONFIG' | 'ATTENDANCE' | 'KPI' | 'BONUS' | 'ADVANCES' | 'SUMMARY' | 'PAYSLIP'>('CONFIG');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));

  // Modal States
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [vehicleModalTab, setVehicleModalTab] = useState<'INFO' | 'DRIVER' | 'SALARY'>('INFO'); // New Tab state for Vehicle Modal

  // Cost Modal States
  const [isCostModalOpen, setIsCostModalOpen] = useState(false);
  const [isCostViewMode, setIsCostViewMode] = useState(false);
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [costDeleteId, setCostDeleteId] = useState<string | null>(null);

  // Advance Modal States
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [editingAdvanceId, setEditingAdvanceId] = useState<string | null>(null);
  const [isAdvanceViewMode, setIsAdvanceViewMode] = useState(false);
  
  // Return Modal States (Driver Input)
  const [isReturnInputModalOpen, setIsReturnInputModalOpen] = useState(false);
  const [selectedTripForReturn, setSelectedTripForReturn] = useState<Trip | null>(null);
  const [returnWarehouseInput, setReturnWarehouseInput] = useState(''); // Changed to empty string for manual input
  const [returnWarehouseAddressInput, setReturnWarehouseAddressInput] = useState(''); // NEW STATE
  const [returnReceiver, setReturnReceiver] = useState(''); // New State
  const [returnReceiverPhone, setReturnReceiverPhone] = useState(''); // New State for Phone
  const [returnNote, setReturnNote] = useState('');
  const [returnItemsInput, setReturnItemsInput] = useState<Record<string, Record<string, number>>>({}); // OrderId -> ProductId -> Qty

  // Return History Modal
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [historyVehicleId, setHistoryVehicleId] = useState<string | null>(null);

  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);

  // Forms
  const initialVehicleState: Partial<Vehicle> = {
    plateNumber: '', internalCode: '', type: 'Truck', capacityKg: 0, preferredRoute: '', status: 'AVAILABLE',
    driverName: '', driverPhone: '', driverIdCard: '', driverDob: '', driverGender: 'Nam', driverLicenseNumber: '', driverLicenseExpiry: '', driverContractInfo: '',
    baseSalary: 0, standardAllowance: 0, responsibilityAllowance: 0, positionAllowance: 0, hazardousAllowance: 0,
    salaryMethods: [SalaryMethod.KM], // Default array
    pricePerKm: 0, pricePerTrip: 0, pricePerTon: 0, pricePerTonKm: 0, tonKmCoefficient: 1, pricePerPoint: 0, pricePerBox: 0, pricePerOrder: 0, pricePerDay: 0,
    category: 'TRUCK',
    insuranceMode: InsuranceMode.NONE, insuranceAmount: 0, 
    insuranceBaseType: 'ACTUAL', baseSalaryRate: 2340000,
    fixedOtherAllowance: 0, fixedSupplement: 0,
    enablePIT: false, numberOfDependents: 0, charitableContributions: 0
  };
  const [vehicleForm, setVehicleForm] = useState<Partial<Vehicle>>(initialVehicleState);

  const [costForm, setCostForm] = useState<Partial<CostRecord>>({
    type: CostType.FUEL, amount: 0, quantity: 1, unitPrice: 0, vat: 0, date: new Date().toISOString().split('T')[0]
  });

  const [advanceForm, setAdvanceForm] = useState<Partial<AdvanceRecord>>({
    amount: 0, date: new Date().toISOString().split('T')[0], type: 'ADVANCE',
    totalAdvanceAmount: 0, costFuel: 0, costToll: 0, costOther: 0,
    settlementMode: 'CASH', status: 'OPEN'
  });

  // Styles
  const inputClass = "w-full border border-slate-300 rounded-lg px-3 outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all shadow-sm text-sm disabled:bg-slate-100 disabled:text-slate-500 h-10 bg-white";
  const labelClass = "block text-sm font-semibold text-slate-700 mb-1";

  // -- Helper for Trip Status Workflow (Simulating Driver Actions) --
  const getNextStatusConfig = (currentStatus: TripStatus): { label: string; next: TripStatus; icon: React.ReactNode; color: string } | null => {
    switch (currentStatus) {
      case TripStatus.PLANNED:
        return { label: 'Nhận chuyến & Chờ bốc', next: TripStatus.WAITING_LOAD, icon: <CheckCircle2 className="w-4 h-4"/>, color: 'bg-blue-600 hover:bg-blue-700' };
      case TripStatus.WAITING_LOAD:
        return { label: 'Bắt đầu bốc hàng', next: TripStatus.LOADING, icon: <Loader2 className="w-4 h-4"/>, color: 'bg-orange-600 hover:bg-orange-700' };
      case TripStatus.LOADING:
        return { label: 'Xuất phát (Đi giao)', next: TripStatus.IN_TRANSIT, icon: <PlayCircle className="w-4 h-4"/>, color: 'bg-indigo-600 hover:bg-indigo-700' };
      case TripStatus.IN_TRANSIT:
        return { label: 'Đến điểm trả hàng', next: TripStatus.DELIVERING, icon: <Navigation className="w-4 h-4"/>, color: 'bg-purple-600 hover:bg-purple-700' };
      case TripStatus.DELIVERING:
        return { label: 'Hoàn thành chuyến', next: TripStatus.COMPLETED, icon: <CheckCircle2 className="w-4 h-4"/>, color: 'bg-green-600 hover:bg-green-700' };
      case TripStatus.RETURNING:
        return { label: 'Nhập kho hoàn & Kết thúc', next: TripStatus.COMPLETED, icon: <RotateCcw className="w-4 h-4"/>, color: 'bg-slate-600 hover:bg-slate-700' };
      default:
        return null;
    }
  };

  // Helper function to calculate Progressive Tax (Vietnam Personal Income Tax)
  const calculateProgressiveTax = (assessableIncome: number) => {
    if (assessableIncome <= 0) return 0;
    
    // Brackets (Million VND): 0-5, 5-10, 10-18, 18-32, 32-52, 52-80, >80
    // Rates: 5%, 10%, 15%, 20%, 25%, 30%, 35%
    if (assessableIncome <= 5000000) {
        return assessableIncome * 0.05;
    } else if (assessableIncome <= 10000000) {
        return (assessableIncome * 0.1) - 250000;
    } else if (assessableIncome <= 18000000) {
        return (assessableIncome * 0.15) - 750000;
    } else if (assessableIncome <= 32000000) {
        return (assessableIncome * 0.2) - 1650000;
    } else if (assessableIncome <= 52000000) {
        return (assessableIncome * 0.25) - 3250000;
    } else if (assessableIncome <= 80000000) {
        return (assessableIncome * 0.3) - 5850000;
    } else {
        return (assessableIncome * 0.35) - 9850000;
    }
  };

  // Helper for numeric input with dot separator
  const handleNumericInput = (val: string, field: keyof Vehicle) => {
      // Remove all non-digit characters
      const rawValue = val.replace(/\./g, '');
      if (rawValue === '') {
          setVehicleForm(prev => ({ ...prev, [field]: 0 }));
          return;
      }
      if (/^\d*$/.test(rawValue)) {
          setVehicleForm(prev => ({ ...prev, [field]: Number(rawValue) }));
      }
  };

  const formatNumber = (num: number | undefined) => {
      if (num === undefined || num === null) return '';
      return num.toLocaleString('vi-VN');
  };

  // -- Handlers --

  const handleOpenVehicleModal = (v?: Vehicle, startTab: 'INFO' | 'DRIVER' | 'SALARY' = 'INFO') => {
    setVehicleModalTab(startTab);
    if (v) {
      setEditingVehicleId(v.id);
      // Ensure salaryMethods is initialized
      setVehicleForm({ 
          ...v,
          salaryMethods: v.salaryMethods || [SalaryMethod.KM],
          insuranceBaseType: v.insuranceBaseType || 'ACTUAL',
          baseSalaryRate: v.baseSalaryRate || 2340000,
          enablePIT: v.enablePIT || false,
          numberOfDependents: v.numberOfDependents || 0,
          charitableContributions: v.charitableContributions || 0,
          tonKmCoefficient: v.tonKmCoefficient || 1
      });
    } else {
      setEditingVehicleId(null);
      setVehicleForm(initialVehicleState);
    }
    setIsVehicleModalOpen(true);
  };
  
  // ... (Keep existing handlers for Costs, Advances, Return Logic) ...
  const handleOpenCostModal = (record?: CostRecord, viewMode = false) => {
      setIsCostViewMode(viewMode);
      if (record) {
          setEditingCostId(record.id);
          setCostForm({ 
            ...record,
            quantity: record.quantity !== undefined ? record.quantity : 1,
            unitPrice: record.unitPrice !== undefined ? record.unitPrice : record.amount,
            vat: record.vat || 0
          });
      } else {
          setEditingCostId(null);
          setCostForm({ 
            type: CostType.FUEL, 
            amount: 0,
            quantity: 1,
            unitPrice: 0,
            vat: 0,
            date: new Date().toISOString().split('T')[0],
            vehicleId: '',
            note: ''
          });
      }
      setIsCostModalOpen(true);
  };
  
  const confirmDeleteCost = () => {
      if (costDeleteId) {
          onDeleteCost(costDeleteId);
          setCostDeleteId(null);
      }
  };

  const handleOpenAdvanceModal = (type: 'ADVANCE' | 'REFUND', record?: AdvanceRecord, viewMode = false) => {
      setIsAdvanceViewMode(viewMode);
      if (record) {
          setEditingAdvanceId(record.id);
          setAdvanceForm({ ...record, settlementMode: record.settlementMode || 'CASH' });
      } else {
          setEditingAdvanceId(null);
          setAdvanceForm({
              amount: 0,
              date: new Date().toISOString().split('T')[0],
              type: type,
              vehicleId: '',
              note: '',
              totalAdvanceAmount: 0, costFuel: 0, costToll: 0, costOther: 0,
              settlementMode: 'CASH',
              status: 'OPEN'
          });
      }
      setIsAdvanceModalOpen(true);
  };

  const openReturnInputModal = (trip: Trip) => {
      setSelectedTripForReturn(trip);
      setReturnWarehouseInput(''); // Reset to empty for manual input
      setReturnWarehouseAddressInput(''); // Reset address
      setReturnNote('');
      setReturnReceiver(''); // Reset
      setReturnReceiverPhone(''); // Reset Phone
      setReturnItemsInput({});
      setIsReturnInputModalOpen(true);
  };

  const submitDriverReturn = () => {
      if (!selectedTripForReturn || !onDriverSubmitReturn) return;

      if (!returnWarehouseInput.trim()) {
          alert("Vui lòng nhập tên kho trả hàng hoàn");
          return;
      }

      const flatItems: { orderId: string, productId: string, quantity: number }[] = [];
      Object.keys(returnItemsInput).forEach(orderId => {
          const products = returnItemsInput[orderId];
          Object.keys(products).forEach(prodId => {
              if (products[prodId] > 0) {
                  flatItems.push({
                      orderId: orderId,
                      productId: prodId,
                      quantity: products[prodId]
                  });
              }
          });
      });

      if (flatItems.length === 0) {
          alert("Vui lòng nhập số lượng hàng hoàn ít nhất cho 1 sản phẩm");
          return;
      }

      onDriverSubmitReturn(
          selectedTripForReturn.id,
          flatItems,
          returnWarehouseInput,
          returnWarehouseAddressInput,
          returnNote,
          returnReceiver,
          returnReceiverPhone
      );
      
      setIsReturnInputModalOpen(false);
      setSelectedTripForReturn(null);
  };

  const openHistoryModal = (vehicleId: string) => {
      setHistoryVehicleId(vehicleId);
      setIsHistoryModalOpen(true);
  };

  // ... (Print Handlers) ...
  const handlePrintCost = (record: CostRecord) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const htmlContent = `
        <html><head><title>Phiếu Chi</title>
        <style>
            body { font-family: 'Times New Roman', serif; padding: 20px; }
            .header { text-align: center; margin-bottom: 20px; }
            .title { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
            .sub-title { font-style: italic; font-size: 14px; }
            .content { margin-bottom: 30px; line-height: 1.6; }
            .row { display: flex; margin-bottom: 8px; }
            .label { font-weight: bold; width: 150px; }
            .value { flex: 1; border-bottom: 1px dotted #ccc; }
            .footer { display: flex; justify-content: space-between; text-align: center; margin-top: 50px; }
            .sign-box { width: 30%; }
            .sign-space { height: 80px; }
            @media print { button { display: none; } }
        </style>
        </head><body>
            <div class="header">
                <div class="title">PHIẾU CHI</div>
                <div class="sub-title">Ngày ... tháng ... năm ...</div>
            </div>
            <div class="content">
                <div class="row"><div class="label">Người nhận tiền:</div><div class="value"></div></div>
                <div class="row"><div class="label">Địa chỉ/Bộ phận:</div><div class="value">${record.vehiclePlate}</div></div>
                <div class="row"><div class="label">Lý do chi:</div><div class="value">${record.type} - ${record.note}</div></div>
                <div class="row"><div class="label">Số tiền:</div><div class="value"><b>${record.amount.toLocaleString()} VNĐ</b></div></div>
                <div class="row"><div class="label">Bằng chữ:</div><div class="value"></div></div>
                <div class="row"><div class="label">Kèm theo:</div><div class="value">01 chứng từ gốc</div></div>
            </div>
            <div class="footer">
                <div class="sign-box"><strong>Giám đốc</strong><div class="sign-space"></div></div>
                <div class="sign-box"><strong>Kế toán trưởng</strong><div class="sign-space"></div></div>
                <div class="sign-box"><strong>Người lập phiếu</strong><div class="sign-space"></div></div>
            </div>
            <script>window.print();</script>
        </body></html>
    `;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };
  
  const handlePrintAdvance = (record: AdvanceRecord) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const isRefund = record.type === 'REFUND';

    // Text for settlement mode
    let settlementText = "";
    if (isRefund && record.settlementMode) {
        if (record.settlementMode === 'CASH') settlementText = "Tiền mặt (Hoàn lại/Chi bù)";
        else if (record.settlementMode === 'SALARY') settlementText = "Trừ/Cộng vào lương";
    }

    const htmlContent = `
        <html><head><title>${isRefund ? 'Phiếu Hoàn Ứng' : 'Phiếu Tạm Ứng'}</title>
        <style>
            body { font-family: 'Times New Roman', serif; padding: 20px; }
            .header { text-align: center; margin-bottom: 20px; }
            .title { font-size: 24px; font-weight: bold; margin-bottom: 5px; text-transform: uppercase; }
            .sub-title { font-style: italic; font-size: 14px; }
            .content { margin-bottom: 30px; line-height: 1.6; }
            .row { display: flex; margin-bottom: 8px; }
            .label { font-weight: bold; width: 160px; }
            .value { flex: 1; border-bottom: 1px dotted #ccc; }
            .footer { display: flex; justify-content: space-between; text-align: center; margin-top: 50px; }
            .sign-box { width: 30%; }
            .sign-space { height: 80px; }
            .breakdown { margin-top: 10px; border: 1px solid #ddd; width: 100%; border-collapse: collapse; }
            .breakdown th, .breakdown td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            @media print { button { display: none; } }
        </style>
        </head><body>
            <div class="header">
                <div class="title">${isRefund ? 'PHIẾU HOÀN ỨNG' : 'PHIẾU ĐỀ NGHỊ TẠM ỨNG'}</div>
                <div class="sub-title">Ngày ${new Date(record.date).getDate()} tháng ${new Date(record.date).getMonth() + 1} năm ${new Date(record.date).getFullYear()}</div>
            </div>
            <div class="content">
                <div class="row"><div class="label">Họ tên người đề nghị:</div><div class="value">Lái xe ${record.vehiclePlate}</div></div>
                <div class="row"><div class="label">Bộ phận:</div><div class="value">Đội xe</div></div>
                <div class="row"><div class="label">Số tiền:</div><div class="value"><b>${record.amount.toLocaleString()} VNĐ</b></div></div>
                <div class="row"><div class="label">Lý do:</div><div class="value">${record.note}</div></div>
                
                ${isRefund ? `
                <br/>
                <div class="label" style="width:100%">Chi tiết quyết toán:</div>
                <table class="breakdown">
                    <tr><td>Tổng tiền đã ứng:</td><td align="right">${(record.totalAdvanceAmount || 0).toLocaleString()}</td></tr>
                    <tr><td>Chi phí Xăng/Dầu:</td><td align="right">${(record.costFuel || 0).toLocaleString()}</td></tr>
                    <tr><td>Chi phí Cầu đường:</td><td align="right">${(record.costToll || 0).toLocaleString()}</td></tr>
                    <tr><td>Chi phí Khác:</td><td align="right">${(record.costOther || 0).toLocaleString()}</td></tr>
                    <tr><td><b>Số tiền chênh lệch:</b></td><td align="right"><b>${record.amount.toLocaleString()}</b></td></tr>
                </table>
                <div class="row" style="margin-top:10px;"><div class="label">Hình thức xử lý:</div><div class="value">${settlementText || '---'}</div></div>
                ` : ''}

            </div>
            <div class="footer">
                <div class="sign-box"><strong>Giám đốc</strong><div class="sign-space"></div></div>
                <div class="sign-box"><strong>Kế toán trưởng</strong><div class="sign-space"></div></div>
                <div class="sign-box"><strong>Người đề nghị</strong><div class="sign-space"></div></div>
            </div>
            <script>window.print();</script>
        </body></html>
    `;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handlePrintReturnLog = (log: ReturnLog) => {
      const printWindow = window.open('', '_blank');
      if (!printWindow) return;
  
      const htmlContent = `
          <html><head><title>Biên bản hoàn hàng</title>
          <style>
              body { font-family: 'Times New Roman', serif; padding: 20px; }
              .header { text-align: center; margin-bottom: 20px; border-bottom: 1px solid #000; padding-bottom: 10px; }
              .title { font-size: 20px; font-weight: bold; margin-bottom: 5px; text-transform: uppercase; }
              .table { width: 100%; border-collapse: collapse; margin-top: 15px; }
              .table th, .table td { border: 1px solid #000; padding: 8px; text-align: left; }
              .footer { display: flex; justify-content: space-between; text-align: center; margin-top: 50px; }
              @media print { button { display: none; } }
          </style>
          </head><body>
              <div class="header">
                  <div class="title">BIÊN BẢN BÀN GIAO HÀNG HOÀN</div>
                  <div>Ngày: ${new Date(log.date).toLocaleString('vi-VN')}</div>
              </div>
              <div>
                  <p><b>Xe vận chuyển:</b> ${log.vehiclePlate}</p>
                  <p><b>Kho nhận hàng:</b> ${log.returnWarehouse}</p>
                  <p><b>Người nhận:</b> ${log.receiver || '---'} - SĐT: ${log.receiverPhone || '---'}</p>
                  <p><b>Ghi chú:</b> ${log.note}</p>
              </div>
              <table class="table">
                  <thead>
                      <tr>
                          <th>STT</th>
                          <th>Khách hàng / NPP</th>
                          <th>Sản phẩm</th>
                          <th style="text-align: right">Số lượng</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${log.items.map((item, idx) => `
                          <tr>
                              <td style="text-align: center">${idx + 1}</td>
                              <td>${item.distributorName}</td>
                              <td>${item.productName}</td>
                              <td style="text-align: right; font-weight: bold">${item.quantity}</td>
                          </tr>
                      `).join('')}
                  </tbody>
              </table>
              <div class="footer">
                  <div style="width: 40%"><strong>Người bàn giao</strong><br/>(Lái xe)</div>
                  <div style="width: 40%"><strong>Người nhận hàng</strong><br/>(Thủ kho)</div>
              </div>
              <script>window.print();</script>
          </body></html>
      `;
      printWindow.document.write(htmlContent);
      printWindow.document.close();
  };

  const handlePrintAttendance = (title: string, groupVehicles: Vehicle[]) => {
      const printWindow = window.open('', '_blank');
      if (!printWindow) return;
  
      const htmlContent = `
          <html><head><title>Bảng tính công</title>
          <style>
              @page { size: landscape; margin: 10mm; }
              body { font-family: 'Times New Roman', serif; padding: 0; margin: 0; }
              .header { text-align: center; margin-bottom: 20px; }
              .title { font-size: 20px; font-weight: bold; text-transform: uppercase; }
              .table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 9px; }
              .table th, .table td { border: 1px solid #000; padding: 4px; vertical-align: middle; }
              .table th { background-color: #f0f0f0; text-align: center; }
              .text-right { text-align: right; }
              .text-center { text-align: center; }
              .font-bold { font-weight: bold; }
              .footer { display: flex; justify-content: space-between; margin-top: 30px; text-align: center; font-size: 11px; page-break-inside: avoid; }
              .sign-box { width: 20%; }
              .sign-space { height: 80px; }
              @media print { button { display: none; } }
          </style>
          </head><body>
              <div class="header">
                  <div class="title">BẢNG TÍNH CÔNG LÁI XE - ${title.toUpperCase()}</div>
                  <div>Tháng: ${selectedMonth}</div>
              </div>
              <table class="table">
                  <thead>
                      <tr>
                          <th rowspan="2" style="width: 30px">STT</th>
                          <th rowspan="2" style="width: 70px">Biển số</th>
                          <th rowspan="2" style="width: 120px">Tài xế</th>
                          <th colspan="3">Theo Km</th>
                          <th colspan="2">Theo Chuyến</th>
                          <th colspan="2">Theo Tấn</th>
                          <th colspan="3">Tấn x Km (Hệ số)</th>
                          <th colspan="2">Điểm giao</th>
                          <th colspan="2">Theo Thùng</th>
                          <th colspan="2">Theo Đơn</th>
                          <th colspan="2">Ngày công</th>
                          <th rowspan="2" style="width: 80px">Thành tiền</th>
                      </tr>
                      <tr>
                          <th style="width: 50px">Tổng Km</th>
                          <th style="width: 50px">Đơn giá</th>
                          <th style="width: 50px">Thành tiền</th>

                          <th style="width: 40px">SL</th>
                          <th style="width: 40px">Đ.Giá</th>
                          
                          <th style="width: 40px">SL</th>
                          <th style="width: 40px">Đ.Giá</th>

                          <th style="width: 40px">Hệ số</th>
                          <th style="width: 40px">Tổng</th>
                          <th style="width: 40px">Đ.Giá</th>

                          <th style="width: 40px">SL</th>
                          <th style="width: 40px">Đ.Giá</th>

                          <th style="width: 40px">SL</th>
                          <th style="width: 40px">Đ.Giá</th>

                          <th style="width: 40px">SL</th>
                          <th style="width: 40px">Đ.Giá</th>

                          <th style="width: 40px">SL</th>
                          <th style="width: 40px">Đ.Giá</th>

                          <th style="width: 40px">SL</th>
                          <th style="width: 40px">Đ.Giá</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${groupVehicles.map((v, idx) => {
                          const r = getSalaryRecord(v.id);
                          return `
                          <tr>
                              <td class="text-center">${idx + 1}</td>
                              <td>${v.plateNumber}</td>
                              <td>${v.driverName}</td>
                              
                              <td class="text-right">${Number(r?.totalKm || 0).toLocaleString()}</td>
                              <td class="text-right">${(v.pricePerKm || 0).toLocaleString()}</td>
                              <td class="text-right font-bold">${(Number(r?.totalKm || 0) * (v.pricePerKm || 0)).toLocaleString()}</td>

                              <td class="text-right">${Number(r?.totalTrips || 0).toLocaleString()}</td>
                              <td class="text-right">${(v.pricePerTrip || 0).toLocaleString()}</td>

                              <td class="text-right">${Number(r?.totalTons || 0).toLocaleString()}</td>
                              <td class="text-right">${(v.pricePerTon || 0).toLocaleString()}</td>

                              <td class="text-right">${(v.tonKmCoefficient || 1)}</td>
                              <td class="text-right">${(Number(r?.totalTons || 0) * Number(r?.totalKm || 0)).toLocaleString()}</td>
                              <td class="text-right">${(v.pricePerTonKm || 0).toLocaleString()}</td>

                              <td class="text-right">${Number(r?.totalPoints || 0).toLocaleString()}</td>
                              <td class="text-right">${(v.pricePerPoint || 0).toLocaleString()}</td>

                              <td class="text-right">${Number(r?.totalBoxes || 0).toLocaleString()}</td>
                              <td class="text-right">${(v.pricePerBox || 0).toLocaleString()}</td>

                              <td class="text-right">${Number(r?.totalOrders || 0).toLocaleString()}</td>
                              <td class="text-right">${(v.pricePerOrder || 0).toLocaleString()}</td>

                              <td class="text-right">${Number(r?.workDays || 0).toLocaleString()}</td>
                              <td class="text-right">${(v.pricePerDay || 0).toLocaleString()}</td>
                              
                              <td class="text-right font-bold">${(r?.tripAllowance || 0).toLocaleString()}</td>
                          </tr>
                          `;
                      }).join('')}
                  </tbody>
              </table>
              <div class="footer">
                  <div class="sign-box"><strong>Lái xe</strong><br/>(Ký, họ tên)<div class="sign-space"></div></div>
                  <div class="sign-box"><strong>Phụ trách Đội xe</strong><br/>(Ký, họ tên)<div class="sign-space"></div></div>
                  <div class="sign-box"><strong>Kế toán</strong><br/>(Ký, họ tên)<div class="sign-space"></div></div>
                  <div class="sign-box"><strong>Giám đốc</strong><br/>(Ký, đóng dấu)<div class="sign-space"></div></div>
              </div>
              <script>window.print();</script>
          </body></html>
      `;
      printWindow.document.write(htmlContent);
      printWindow.document.close();
  };

  const handlePrintPayslip = (v: Vehicle, r: SalaryRecord) => {
      const printWindow = window.open('', '_blank');
      if (!printWindow) return;

      const allowances = (r.mealAllowance||0)+(r.responsibilityAllowance||0)+(r.positionAllowance||0)+(r.hazardousAllowance||0);
      const bonus = (r.kpiBonus||0)+(r.otherBonus||0);
      const deductions = (r.insurance||0)+(r.otherDeductions||0)+(r.advances||0);
      const tax = (r.personalIncomeTax||0);

      const htmlContent = `
          <html><head><title>Phiếu lương ${v.driverName}</title>
          <style>
              body { font-family: 'Times New Roman', serif; padding: 20px; color: #000; }
              .header { text-align: center; margin-bottom: 25px; border-bottom: 2px solid #000; padding-bottom: 15px; }
              .title { font-size: 22px; font-weight: bold; text-transform: uppercase; margin-bottom: 5px; }
              .sub-title { font-size: 14px; margin-bottom: 10px; }
              .info { margin-bottom: 20px; font-weight: bold; }
              .section-title { font-weight: bold; text-transform: uppercase; margin-top: 15px; margin-bottom: 5px; background: #eee; padding: 5px; }
              .row { display: flex; justify-content: space-between; border-bottom: 1px dotted #ccc; padding: 5px 0; }
              .row.total { font-weight: bold; border-top: 1px solid #000; border-bottom: none; padding-top: 10px; margin-top: 5px; }
              .net-pay { font-size: 20px; font-weight: bold; text-align: center; margin-top: 20px; border: 2px solid #000; padding: 10px; }
              .footer { display: flex; justify-content: space-between; margin-top: 40px; text-align: center; }
          </style>
          </head><body>
              <div class="header">
                  <div class="title">PHIẾU LƯƠNG</div>
                  <div class="sub-title">Tháng: ${r.month}</div>
              </div>
              <div class="info">
                  <div>Họ tên: ${v.driverName}</div>
                  <div>Biển số: ${v.plateNumber}</div>
                  <div>Bộ phận: Đội xe</div>
              </div>

              <div class="section-title">I. CÁC KHOẢN THU NHẬP</div>
              <div class="row"><span>1. Lương cơ bản:</span><span>${(r.baseSalary||0).toLocaleString()}</span></div>
              <div class="row"><span>2. Lương theo doanh số/Km/Chuyến:</span><span>${(r.tripAllowance||0).toLocaleString()}</span></div>
              <div class="row"><span>3. Thưởng KPI & Khác:</span><span>${bonus.toLocaleString()}</span></div>
              <div class="row"><span>4. Tổng phụ cấp (Ăn/ĐT/CV/TN/ĐH):</span><span>${allowances.toLocaleString()}</span></div>
              <div class="row total"><span>TỔNG THU NHẬP (I):</span><span>${(r.totalIncome + deductions + tax).toLocaleString()}</span></div>

              <div class="section-title">II. CÁC KHOẢN KHẤU TRỪ</div>
              <div class="row"><span>1. Bảo hiểm (BHXH, BHYT, BHTN):</span><span>${(r.insurance||0).toLocaleString()}</span></div>
              <div class="row"><span>2. Thuế TNCN:</span><span>${tax.toLocaleString()}</span></div>
              <div class="row"><span>3. Tạm ứng / Phạt / Khác:</span><span>${((r.advances||0) + (r.otherDeductions||0)).toLocaleString()}</span></div>
              <div class="row total"><span>TỔNG KHẤU TRỪ (II):</span><span>${(deductions + tax).toLocaleString()}</span></div>

              <div class="net-pay">
                  THỰC LĨNH: ${(r.totalReceived||0).toLocaleString()} VNĐ
              </div>

              <div class="footer">
                  <div style="width: 30%"><strong>Người lập phiếu</strong><br/><br/><br/></div>
                  <div style="width: 30%"><strong>Kế toán trưởng</strong><br/><br/><br/></div>
                  <div style="width: 30%"><strong>Người nhận tiền</strong><br/>(Ký, ghi rõ họ tên)</div>
              </div>
              <script>window.print();</script>
          </body></html>
      `;
      printWindow.document.write(htmlContent);
      printWindow.document.close();
  };

  const toggleSalaryMethod = (method: SalaryMethod) => {
    const currentMethods = vehicleForm.salaryMethods || [];
    if (currentMethods.includes(method)) {
        setVehicleForm({
            ...vehicleForm,
            salaryMethods: currentMethods.filter(m => m !== method)
        });
    } else {
        setVehicleForm({
            ...vehicleForm,
            salaryMethods: [...currentMethods, method]
        });
    }
  };

  // Helper to calculate insurance based on form state
  const calculateInsurance = (form: Partial<Vehicle>) => {
      const mode = form.insuranceMode || InsuranceMode.NONE;
      if (mode === InsuranceMode.NONE) return 0;

      let insuranceBase = 0;

      // Check Calculation Method (Actual vs Ceiling)
      if (form.insuranceBaseType === 'CEILING') {
          // Method: Ceiling = Base Salary Rate * 20
          insuranceBase = (Number(form.baseSalaryRate) || 0) * 20;
      } else {
          // Method: Actual = Base Salary + Responsibility + Position + Hazardous + Fixed Supplement
          // Updated formula as per user request
          insuranceBase = (Number(form.baseSalary) || 0) + 
                          (Number(form.responsibilityAllowance) || 0) + 
                          (Number(form.positionAllowance) || 0) + 
                          (Number(form.hazardousAllowance) || 0) + 
                          (Number(form.fixedSupplement) || 0);
      }
      
      let rate = 0;
      if (mode === InsuranceMode.EMPLOYEE) {
          // BHXH 8% + BHYT 1.5% + BHTN 1% = 10.5%
          rate = 0.105;
      } else if (mode === InsuranceMode.EMPLOYER) {
          // BHXH 17.5% + BHYT 3% + BHTN 1% = 21.5%
          rate = 0.215;
      }
      
      return Math.round(insuranceBase * rate);
  };

  // Effect to auto-update insuranceAmount in form when dependencies change
  useEffect(() => {
      if (isVehicleModalOpen) {
          const amount = calculateInsurance(vehicleForm);
          setVehicleForm(prev => ({ ...prev, insuranceAmount: amount }));
      }
  }, [
      vehicleForm.baseSalary, vehicleForm.responsibilityAllowance, vehicleForm.positionAllowance, vehicleForm.hazardousAllowance, 
      vehicleForm.fixedSupplement, // Removed fixedOtherAllowance from dependency based on new formula
      vehicleForm.insuranceMode, vehicleForm.insuranceBaseType, vehicleForm.baseSalaryRate,
      isVehicleModalOpen
  ]);


  const submitVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleForm.plateNumber) return;
    
    const v = {
       ...vehicleForm,
       id: editingVehicleId || `V${Date.now()}`,
       capacityKg: Number(vehicleForm.capacityKg),
       baseSalary: Number(vehicleForm.baseSalary),
       standardAllowance: Number(vehicleForm.standardAllowance),
       responsibilityAllowance: Number(vehicleForm.responsibilityAllowance),
       positionAllowance: Number(vehicleForm.positionAllowance),
       hazardousAllowance: Number(vehicleForm.hazardousAllowance),
       fixedOtherAllowance: Number(vehicleForm.fixedOtherAllowance),
       fixedSupplement: Number(vehicleForm.fixedSupplement),
       insuranceAmount: Number(vehicleForm.insuranceAmount), // This is now calculated
       baseSalaryRate: Number(vehicleForm.baseSalaryRate), // New field
       
       enablePIT: Boolean(vehicleForm.enablePIT),
       numberOfDependents: Number(vehicleForm.numberOfDependents),
       charitableContributions: Number(vehicleForm.charitableContributions),

       pricePerKm: Number(vehicleForm.pricePerKm),
       pricePerTrip: Number(vehicleForm.pricePerTrip),
       pricePerTon: Number(vehicleForm.pricePerTon),
       pricePerTonKm: Number(vehicleForm.pricePerTonKm),
       tonKmCoefficient: Number(vehicleForm.tonKmCoefficient), // New Coefficient
       pricePerPoint: Number(vehicleForm.pricePerPoint),
       pricePerBox: Number(vehicleForm.pricePerBox),
       pricePerOrder: Number(vehicleForm.pricePerOrder),
       pricePerDay: Number(vehicleForm.pricePerDay),
    } as Vehicle;

    if (editingVehicleId) onUpdate(v);
    else onAdd(v);
    
    setIsVehicleModalOpen(false);
  };

  // ... (Other submit functions remain the same)
  const submitCost = (e: React.FormEvent) => {
      e.preventDefault();
      if (isCostViewMode) return;
      if (!costForm.vehicleId || !costForm.amount) return;
      const vehicle = vehicles.find(v => v.id === costForm.vehicleId);
      
      const record = {
          ...costForm,
          id: editingCostId || `C${Date.now()}`,
          amount: Number(costForm.amount),
          quantity: Number(costForm.quantity),
          unitPrice: Number(costForm.unitPrice),
          vat: Number(costForm.vat),
          vehiclePlate: vehicle?.plateNumber || ''
      } as CostRecord;

      if (editingCostId) {
          onUpdateCost(record);
      } else {
          onAddCost(record);
      }
      setIsCostModalOpen(false);
      setCostForm({ type: CostType.FUEL, amount: 0, quantity: 1, unitPrice: 0, vat: 0, date: new Date().toISOString().split('T')[0] });
  };

  useEffect(() => {
    if (advanceForm.type === 'REFUND' && advanceForm.vehicleId && !editingAdvanceId) {
        const currentMonthAdvances = advances.filter(a => 
            a.vehicleId === advanceForm.vehicleId && 
            a.date.startsWith(selectedMonth) && 
            (!a.type || a.type === 'ADVANCE')
        );
        const total = currentMonthAdvances.reduce((sum, a) => sum + a.amount, 0);
        setAdvanceForm(prev => ({ ...prev, totalAdvanceAmount: total }));
    }
  }, [advanceForm.vehicleId, advanceForm.type, selectedMonth, advances, editingAdvanceId]);

  useEffect(() => {
    if (advanceForm.type === 'REFUND' && !isAdvanceViewMode) {
        const totalAdv = Number(advanceForm.totalAdvanceAmount) || 0;
        const expenses = (Number(advanceForm.costFuel) || 0) + (Number(advanceForm.costToll) || 0) + (Number(advanceForm.costOther) || 0);
        const balance = totalAdv - expenses; 
        setAdvanceForm(prev => ({ ...prev, amount: Math.abs(balance) }));
    }
  }, [advanceForm.totalAdvanceAmount, advanceForm.costFuel, advanceForm.costToll, advanceForm.costOther, advanceForm.type, isAdvanceViewMode]);

  useEffect(() => {
    if (isCostModalOpen && !isCostViewMode) {
        const qty = Number(costForm.quantity) || 0;
        const price = Number(costForm.unitPrice) || 0;
        const vat = Number(costForm.vat) || 0;
        const total = (qty * price) * (1 + vat / 100);
        setCostForm(prev => ({ ...prev, amount: Math.round(total) }));
    }
  }, [costForm.quantity, costForm.unitPrice, costForm.vat]);

  const submitAdvance = (e: React.FormEvent, isLocked: boolean = false) => {
      e.preventDefault();
      if (isAdvanceViewMode) return;

      if (!advanceForm.vehicleId || advanceForm.amount === undefined) return;
      const vehicle = vehicles.find(v => v.id === advanceForm.vehicleId);
      
      const isRefund = advanceForm.type === 'REFUND';
      let newStatus: 'OPEN' | 'LOCKED' | 'REFUNDED' | 'ADVANCED' = advanceForm.status || 'OPEN';

      if (isLocked) {
         if (isRefund) newStatus = 'REFUNDED';
         else newStatus = 'ADVANCED';
      }

      const record = {
          ...advanceForm,
          id: editingAdvanceId || `A${Date.now()}`,
          amount: Number(advanceForm.amount),
          vehiclePlate: vehicle?.plateNumber || '',
          type: advanceForm.type || 'ADVANCE',
          totalAdvanceAmount: Number(advanceForm.totalAdvanceAmount) || 0,
          costFuel: Number(advanceForm.costFuel) || 0,
          costToll: Number(advanceForm.costToll) || 0,
          costOther: Number(advanceForm.costOther) || 0,
          settlementMode: advanceForm.settlementMode || 'CASH',
          status: newStatus
      } as AdvanceRecord;

      if (editingAdvanceId) {
          onUpdateAdvance(record);
      } else {
          onAddAdvance(record);
      }
      setIsAdvanceModalOpen(false);
  };

  const handleUpdateSalary = (vehicleId: string, updates: Partial<SalaryRecord>) => {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return;

    const existing = salaries.find(s => s.vehicleId === vehicleId && s.month === selectedMonth);
    const methods = vehicle.salaryMethods || [SalaryMethod.KM];

    // Re-calculate insurance based on latest vehicle config
    let insuranceBase = 0;
    if (vehicle.insuranceBaseType === 'CEILING') {
        insuranceBase = (vehicle.baseSalaryRate || 0) * 20;
    } else {
        // Updated formula for Salary Update Logic too
        insuranceBase = (vehicle.baseSalary || 0) + 
                        (vehicle.responsibilityAllowance || 0) + 
                        (vehicle.positionAllowance || 0) + 
                        (vehicle.hazardousAllowance || 0) +
                        (vehicle.fixedSupplement || 0);
    }
    
    let insuranceRate = 0;
    if (vehicle.insuranceMode === InsuranceMode.EMPLOYEE) insuranceRate = 0.105;
    else if (vehicle.insuranceMode === InsuranceMode.EMPLOYER) insuranceRate = 0.215;

    const insuranceDeduction = Math.round(insuranceBase * insuranceRate);

    // Calculate Advance Deductions automatically based on Refunds with SALARY settlement
    const monthAdvances = advances.filter(a => 
        a.vehicleId === vehicleId && 
        a.date.startsWith(selectedMonth)
    );

    let settlementDeduction = 0;
    monthAdvances.forEach(a => {
        // Only calculate for Refunds that are settled via Salary
        if (a.type === 'REFUND' && a.settlementMode === 'SALARY') {
            const expenses = (a.costFuel || 0) + (a.costToll || 0) + (a.costOther || 0);
            const balance = (a.totalAdvanceAmount || 0) - expenses;
            // Balance > 0: Driver owes company (Positive Deduction)
            // Balance < 0: Company owes driver (Negative Deduction = Addition)
            settlementDeduction += balance;
        }
    });

    const base: SalaryRecord = existing || {
        id: `SAL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        vehicleId: vehicleId,
        driverName: vehicle.driverName,
        month: selectedMonth,
        workDays: 0,
        baseSalary: vehicle.baseSalary || 0,
        tripAllowance: 0,
        kpiScore: 100,
        kpiBonus: 0,
        mealAllowance: vehicle.standardAllowance || 0,
        responsibilityAllowance: vehicle.responsibilityAllowance || 0,
        positionAllowance: vehicle.positionAllowance || 0,
        hazardousAllowance: vehicle.hazardousAllowance || 0,
        otherBonus: 0,
        advances: settlementDeduction, // Init with calculated value
        insurance: insuranceDeduction, // Auto-calculated
        personalIncomeTax: 0,
        otherDeductions: 0,
        totalIncome: 0,
        totalReceived: 0,
        status: 'DRAFT',
        attendanceStatus: 'DRAFT', // Init status
        startKm: 0, endKm: 0, totalKm: 0,
        totalTrips: 0, totalTons: 0, totalPoints: 0,
        totalBoxes: 0, totalOrders: 0,
        salaryMethods: methods,
        tonKmCoefficient: vehicle.tonKmCoefficient || 1
    };

    const updated = { ...base, ...updates };
    
    if (updates.insurance === undefined) {
        updated.insurance = insuranceDeduction;
    }

    if (updates.advances === undefined) {
        updated.advances = settlementDeduction;
    }

    // Auto calculate Total KM if Start/End provided (handling String Input)
    if (updates.startKm !== undefined || updates.endKm !== undefined) {
        const s = Number(updated.startKm || 0);
        const e = Number(updated.endKm || 0);
        updated.totalKm = Math.max(0, e - s);
    }

    // Calculate Trip Allowance based on ALL selected methods (Casting inputs to Number)
    let totalAllowance = 0;
    const activeMethods = updated.salaryMethods || methods;

    if (activeMethods.includes(SalaryMethod.KM)) {
        totalAllowance += Number(updated.totalKm || 0) * (vehicle.pricePerKm || 0);
    }
    if (activeMethods.includes(SalaryMethod.TRIP)) {
        totalAllowance += Number(updated.totalTrips || 0) * (vehicle.pricePerTrip || 0);
    }
    if (activeMethods.includes(SalaryMethod.TON)) {
        totalAllowance += Number(updated.totalTons || 0) * (vehicle.pricePerTon || 0);
    }
    if (activeMethods.includes(SalaryMethod.TON_KM)) {
        // New Formula: Tấn * Km * Đơn giá * Hệ số
        const coeff = updated.tonKmCoefficient || vehicle.tonKmCoefficient || 1;
        totalAllowance += Number(updated.totalTons || 0) * Number(updated.totalKm || 0) * (vehicle.pricePerTonKm || 0) * coeff;
    }
    if (activeMethods.includes(SalaryMethod.POINT)) {
        totalAllowance += Number(updated.totalPoints || 0) * (vehicle.pricePerPoint || 0);
    }
    if (activeMethods.includes(SalaryMethod.BOX)) {
        totalAllowance += Number(updated.totalBoxes || 0) * (vehicle.pricePerBox || 0);
    }
    if (activeMethods.includes(SalaryMethod.ORDER)) {
        totalAllowance += Number(updated.totalOrders || 0) * (vehicle.pricePerOrder || 0);
    }
    if (activeMethods.includes(SalaryMethod.DAY)) {
        totalAllowance += Number(updated.workDays || 0) * (vehicle.pricePerDay || 0);
    }

    updated.tripAllowance = totalAllowance;
    updated.totalIncome = (updated.baseSalary || 0) + (updated.tripAllowance || 0) + (updated.kpiBonus || 0) + (updated.mealAllowance || 0) + (updated.responsibilityAllowance || 0) + (updated.positionAllowance || 0) + (updated.hazardousAllowance || 0) + (updated.otherBonus || 0) - (updated.insurance || 0) - (updated.otherDeductions || 0);

    // --- PERSONAL INCOME TAX CALCULATION ---
    if (vehicle.enablePIT) {
        const incomeForTax = (updated.baseSalary || 0) + 
                             (updated.tripAllowance || 0) + 
                             (updated.kpiBonus || 0) + 
                             (updated.mealAllowance || 0) + 
                             (updated.responsibilityAllowance || 0) + 
                             (updated.positionAllowance || 0) + 
                             (updated.hazardousAllowance || 0) +
                             (updated.otherBonus || 0);

        const personalDeduction = 11000000;
        const dependentDeduction = (vehicle.numberOfDependents || 0) * 4400000;
        const insuranceDeduct = updated.insurance || 0;
        const charitable = vehicle.charitableContributions || 0;
        
        const totalDeductions = personalDeduction + dependentDeduction + insuranceDeduct + charitable;

        const assessableIncome = Math.max(0, incomeForTax - totalDeductions);

        updated.personalIncomeTax = Math.round(calculateProgressiveTax(assessableIncome));
    } else {
        updated.personalIncomeTax = 0;
    }

    updated.totalReceived = updated.totalIncome - (updated.personalIncomeTax || 0) - (updated.advances || 0);

    if (existing) onUpdateSalary(updated);
    else onAddSalary(updated);
  };

  // ... (getSalaryRecord, renderVehicles, renderCosts, renderSalaryAttendance - Keep as is)
  const getSalaryRecord = (vehicleId: string) => {
      return salaries.find(s => s.vehicleId === vehicleId && s.month === selectedMonth);
  };
  
  const renderVehicles = () => ( 
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vehicles.filter(v => v.plateNumber.toLowerCase().includes(searchTerm.toLowerCase()) || v.driverName.toLowerCase().includes(searchTerm.toLowerCase())).map(v => {
              const activeTrip = trips.find(t => t.vehicleId === v.id && t.status !== TripStatus.COMPLETED);
              const nextAction = activeTrip ? getNextStatusConfig(activeTrip.status) : null;
              
              return (
              <div key={v.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition">
                  {/* ... Vehicle Card Content ... */}
                  <div className="flex justify-between items-start mb-3">
                      <div>
                          <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                              {v.plateNumber}
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                  v.status === 'AVAILABLE' ? 'bg-green-100 text-green-700 border-green-200' :
                                  v.status === 'MAINTENANCE' ? 'bg-red-100 text-red-700 border-red-200' :
                                  'bg-blue-100 text-blue-700 border-blue-200'
                              }`}>{v.status}</span>
                          </h3>
                          <p className="text-sm text-slate-500">{v.type} • {v.capacityKg} kg</p>
                      </div>
                      <div className="flex gap-1">
                          <button onClick={() => openHistoryModal(v.id)} className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-orange-600" title="Lịch sử hoàn"><History className="w-4 h-4"/></button>
                          <button onClick={() => handleOpenVehicleModal(v)} className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-brand-600"><Edit2 className="w-4 h-4"/></button>
                          <button onClick={() => onDelete(v.id)} className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>
                      </div>
                  </div>
                  <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-slate-600">
                          <User className="w-4 h-4 text-slate-400"/> {v.driverName}
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                          <Phone className="w-4 h-4 text-slate-400"/> {v.driverPhone}
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                          <MapPin className="w-4 h-4 text-slate-400"/> {v.preferredRoute || 'Chưa có tuyến'}
                      </div>
                  </div>
                  
                  {activeTrip && (
                      <div className="mt-4 pt-3 border-t border-slate-100 bg-slate-50 p-2 rounded-lg">
                          <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-bold text-blue-700 flex items-center gap-1">
                                  <Truck className="w-3 h-3" /> Đang chạy: {activeTrip.code}
                              </span>
                              <span className="text-[10px] text-slate-500 font-bold uppercase">{activeTrip.status}</span>
                          </div>
                           <div className="mb-2">
                             {nextAction ? (
                                <button 
                                    onClick={() => onUpdateTripStatus(activeTrip.id, nextAction.next)}
                                    className={`w-full text-xs text-white py-2 rounded border font-bold flex items-center justify-center gap-2 shadow-sm ${nextAction.color}`}
                                >
                                    {nextAction.icon} {nextAction.label}
                                </button>
                             ) : (
                                <div className="text-center text-xs text-green-600 font-bold p-1 bg-green-50 rounded border border-green-100 flex items-center justify-center gap-2">
                                     <CheckCircle2 className="w-4 h-4"/> Chuyến xe đã hoàn thành
                                </div>
                             )}
                          </div>
                          <div className="mt-2 border-t border-slate-200 pt-2">
                             {!activeTrip.returnStatus || activeTrip.returnStatus === 'NONE' ? (
                                 <button 
                                    onClick={() => openReturnInputModal(activeTrip)}
                                    className="w-full text-xs bg-orange-100 text-orange-700 py-1.5 rounded border border-orange-200 hover:bg-orange-200 font-medium flex items-center justify-center gap-1"
                                 >
                                     <AlertTriangle className="w-3 h-3" /> Xử lý hàng hoàn / Sự cố
                                 </button>
                             ) : (
                                 <div className="bg-green-100 text-green-800 p-2 rounded border border-green-200 text-xs">
                                     <div className="font-bold flex items-center gap-1 mb-1">
                                         <Warehouse className="w-3 h-3" /> Kho trả hàng:
                                     </div>
                                     <div className="font-medium text-green-900">{activeTrip.returnWarehouse}</div>
                                 </div>
                             )}
                          </div>
                      </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                       <span className="text-slate-500">Lương cơ bản:</span>
                       <span className="font-bold text-slate-700">{(v.baseSalary || 0).toLocaleString()}đ</span>
                  </div>
              </div>
          )})}
      </div>
  );

  const renderCosts = () => ( <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"><table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200"><tr><th className="p-3">Ngày</th><th className="p-3">Xe</th><th className="p-3">Loại chi phí</th><th className="p-3">Số tiền</th><th className="p-3">Ghi chú</th><th className="p-3 text-center">Thao tác</th></tr></thead><tbody className="divide-y divide-slate-100">{costs.length===0?<tr><td colSpan={6} className="p-8 text-center text-slate-400">Chưa có dữ liệu chi phí</td></tr>:costs.map(c=>(<tr key={c.id} className="hover:bg-slate-50"><td className="p-3">{c.date}</td><td className="p-3 font-medium">{c.vehiclePlate}</td><td className="p-3"><span className="px-2 py-1 rounded bg-slate-100 text-slate-600 text-xs">{c.type}</span></td><td className="p-3 font-bold text-slate-700">{c.amount.toLocaleString()}</td><td className="p-3 text-slate-500">{c.note}</td><td className="p-3 text-center"><div className="flex items-center justify-center gap-2"><button onClick={()=>handlePrintCost(c)} className="text-slate-400 hover:text-slate-600"><Printer className="w-4 h-4"/></button><button onClick={()=>handleOpenCostModal(c,true)} className="text-slate-400 hover:text-blue-600"><Eye className="w-4 h-4"/></button><button onClick={()=>handleOpenCostModal(c,false)} className="text-slate-400 hover:text-brand-600"><Edit2 className="w-4 h-4"/></button><button onClick={()=>setCostDeleteId(c.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button></div></td></tr>))}</tbody></table></div>);
  
  const renderSalaryAttendance = () => { /* ... existing ... */
    const trucks = vehicles.filter(v => !v.category || v.category === 'TRUCK');
    const coaches = vehicles.filter(v => v.category === 'COACH');
    const contracts = vehicles.filter(v => v.category === 'CONTRACT');
    
    const renderTable = (title: string, groupVehicles: Vehicle[]) => {
      if (groupVehicles.length === 0) return null;
      return (
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-bold text-slate-700 flex items-center gap-2">
              <Truck className="w-4 h-4" /> {title}
            </h4>
            <button 
                onClick={() => handlePrintAttendance(title, groupVehicles)}
                className="text-slate-500 hover:text-brand-600 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded text-sm flex items-center gap-2 transition shadow-sm"
            >
                <Printer className="w-4 h-4" /> In bảng công
            </button>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 font-medium">
                <tr>
                  <th className="p-3 text-center">Trạng thái</th>
                  <th className="p-3 text-center">Xe / Tài xế</th>
                  <th className="p-3 text-center">Phương pháp</th>
                  <th className="p-3 text-center">Chi tiết thực hiện<div className="text-xs font-normal text-slate-400 mt-0.5">(Nhập các chỉ số tương ứng)</div></th>
                  <th className="p-3 text-right">Đơn giá áp dụng</th>
                  <th className="p-3 text-right">Thành tiền công</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupVehicles.map(v => {
                  const record = getSalaryRecord(v.id);
                  const methods = v.salaryMethods || [SalaryMethod.KM];
                  const status = record?.attendanceStatus || 'DRAFT';
                  const isLocked = status === 'LOCKED';

                  return (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="p-3 text-center">
                         <div className="flex flex-col items-center gap-2">
                            {/* Status Badge */}
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${
                                status === 'LOCKED' ? 'bg-red-100 text-red-700 border-red-200' :
                                status === 'CONFIRMED' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                                {status === 'LOCKED' ? 'Đã khoá' : status === 'CONFIRMED' ? 'Đã chốt' : 'Chưa chốt'}
                            </span>

                            {/* Actions */}
                            <div className="flex items-center gap-1">
                                {status === 'DRAFT' && (
                                    <button 
                                        onClick={() => handleUpdateSalary(v.id, { attendanceStatus: 'CONFIRMED' })}
                                        className="p-1.5 bg-white border border-slate-200 rounded hover:bg-blue-50 text-blue-600"
                                        title="Chốt bảng công"
                                    >
                                        <FileCheck className="w-3.5 h-3.5" />
                                    </button>
                                )}
                                {status === 'CONFIRMED' && (
                                    <>
                                    <button 
                                        onClick={() => handleUpdateSalary(v.id, { attendanceStatus: 'DRAFT' })}
                                        className="p-1.5 bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-500"
                                        title="Hủy chốt"
                                    >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                        onClick={() => handleUpdateSalary(v.id, { attendanceStatus: 'LOCKED' })}
                                        className="p-1.5 bg-white border border-slate-200 rounded hover:bg-red-50 text-red-600"
                                        title="Khoá bảng công"
                                    >
                                        <Lock className="w-3.5 h-3.5" />
                                    </button>
                                    </>
                                )}
                                {status === 'LOCKED' && (
                                    <button 
                                        onClick={() => handleUpdateSalary(v.id, { attendanceStatus: 'CONFIRMED' })}
                                        className="p-1.5 bg-white border border-slate-200 rounded hover:bg-red-50 text-red-400"
                                        title="Mở khoá (Về đã chốt)"
                                    >
                                        <Unlock className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                         </div>
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-slate-700">{v.plateNumber}</div>
                        <div className="text-xs text-slate-500">{v.driverName}</div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col gap-1">
                          {methods.map(m => (
                            <span key={m} className="text-xs px-2 py-1 bg-slate-100 rounded text-slate-600 font-medium border border-slate-200 w-fit">
                              {m === SalaryMethod.KM && 'Theo Km'}
                              {m === SalaryMethod.TRIP && 'Theo Chuyến'}
                              {m === SalaryMethod.TON && 'Theo Tấn'}
                              {m === SalaryMethod.TON_KM && 'Tấn x Km'}
                              {m === SalaryMethod.POINT && 'Điểm giao'}
                              {m === SalaryMethod.BOX && 'Theo Thùng'}
                              {m === SalaryMethod.ORDER && 'Theo Đơn'}
                              {m === SalaryMethod.DAY && 'Theo Ngày công'}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex flex-col gap-2 items-center justify-center">
                          {(methods.includes(SalaryMethod.KM) || methods.includes(SalaryMethod.TON_KM)) && (
                            <div className="flex items-center gap-2 w-full justify-center bg-slate-50 p-1 rounded">
                              <span className="text-xs text-slate-500 w-16 text-right">Km:</span>
                              <input disabled={isLocked} type="number" className="w-16 border border-slate-300 rounded px-1 text-right text-xs disabled:bg-slate-100" placeholder="Đầu" value={record?.startKm || ''} onChange={e => handleUpdateSalary(v.id, { startKm: e.target.value })} />
                              <input disabled={isLocked} type="number" className="w-16 border border-slate-300 rounded px-1 text-right text-xs disabled:bg-slate-100" placeholder="Cuối" value={record?.endKm || ''} onChange={e => handleUpdateSalary(v.id, { endKm: e.target.value })} />
                              <span className="text-xs font-bold text-slate-700 bg-white px-1 border rounded ml-1 min-w-[50px]">{(Number(record?.totalKm || 0)).toLocaleString()}</span>
                            </div>
                          )}
                          {/* ... Other inputs */}
                          {methods.includes(SalaryMethod.TRIP) && (
                            <div className="flex items-center gap-2 w-full justify-center">
                              <span className="text-xs text-slate-500 w-16 text-right">Chuyến:</span>
                              <input disabled={isLocked} type="number" className="w-20 border border-slate-300 rounded px-1 text-right text-sm disabled:bg-slate-100" value={record?.totalTrips || ''} onChange={e => handleUpdateSalary(v.id, { totalTrips: e.target.value })} />
                            </div>
                          )}
                          {(methods.includes(SalaryMethod.TON) || methods.includes(SalaryMethod.TON_KM)) && (
                            <div className="flex items-center gap-2 w-full justify-center">
                              <span className="text-xs text-slate-500 w-16 text-right">Tấn:</span>
                              <input 
                                disabled={isLocked}
                                type="number" 
                                step="0.001"
                                className="w-20 border border-slate-300 rounded px-1 text-right text-sm disabled:bg-slate-100" 
                                value={record?.totalTons || ''} 
                                onChange={e => handleUpdateSalary(v.id, { totalTons: e.target.value })} 
                              />
                            </div>
                          )}
                          {methods.includes(SalaryMethod.POINT) && (
                            <div className="flex items-center gap-2 w-full justify-center">
                              <span className="text-xs text-slate-500 w-16 text-right">Điểm:</span>
                              <input disabled={isLocked} type="number" className="w-20 border border-slate-300 rounded px-1 text-right text-sm disabled:bg-slate-100" value={record?.totalPoints || ''} onChange={e => handleUpdateSalary(v.id, { totalPoints: e.target.value })} />
                            </div>
                          )}
                          {methods.includes(SalaryMethod.BOX) && (
                            <div className="flex items-center gap-2 w-full justify-center">
                              <span className="text-xs text-slate-500 w-16 text-right">Thùng:</span>
                              <input disabled={isLocked} type="number" className="w-20 border border-slate-300 rounded px-1 text-right text-sm disabled:bg-slate-100" value={record?.totalBoxes || ''} onChange={e => handleUpdateSalary(v.id, { totalBoxes: e.target.value })} />
                            </div>
                          )}
                          {methods.includes(SalaryMethod.ORDER) && (
                            <div className="flex items-center gap-2 w-full justify-center">
                              <span className="text-xs text-slate-500 w-16 text-right">Đơn:</span>
                              <input disabled={isLocked} type="number" className="w-20 border border-slate-300 rounded px-1 text-right text-sm disabled:bg-slate-100" value={record?.totalOrders || ''} onChange={e => handleUpdateSalary(v.id, { totalOrders: e.target.value })} />
                            </div>
                          )}
                          {methods.includes(SalaryMethod.DAY) && (
                            <div className="flex items-center gap-2 w-full justify-center">
                              <span className="text-xs text-slate-500 w-16 text-right">Ngày công:</span>
                              <input disabled={isLocked} type="number" step="0.5" className="w-20 border border-slate-300 rounded px-1 text-right text-sm disabled:bg-slate-100" value={record?.workDays || ''} onChange={e => handleUpdateSalary(v.id, { workDays: e.target.value })} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right text-slate-500 text-xs">
                        <div className="flex flex-col gap-1 items-end">
                          {methods.map(m => (
                            <div key={m}>
                              {m === SalaryMethod.KM && (v.pricePerKm || 0).toLocaleString()}
                              {m === SalaryMethod.TRIP && (v.pricePerTrip || 0).toLocaleString()}
                              {m === SalaryMethod.TON && (v.pricePerTon || 0).toLocaleString()}
                              {m === SalaryMethod.TON_KM && `${(v.pricePerTonKm || 0).toLocaleString()} x ${v.tonKmCoefficient || 1}`}
                              {m === SalaryMethod.POINT && (v.pricePerPoint || 0).toLocaleString()}
                              {m === SalaryMethod.BOX && (v.pricePerBox || 0).toLocaleString()}
                              {m === SalaryMethod.ORDER && (v.pricePerOrder || 0).toLocaleString()}
                              {m === SalaryMethod.DAY && (v.pricePerDay || 0).toLocaleString()}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-right font-bold text-brand-600">{(record?.tripAllowance || 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    };
    
    return (
      <div className="animate-fade-in">
        <div className="p-4 bg-blue-50 text-blue-800 rounded-lg mb-4 text-sm flex items-center gap-2 border border-blue-100">
          <AlertCircle className="w-4 h-4" /> Nhập số liệu thực tế theo các phương pháp tính lương đã cấu hình. Hệ thống sẽ cộng dồn thành tiền.
        </div>
        {renderTable('Đội xe tải', trucks)}
        {renderTable('Đội xe khách', coaches)}
        {renderTable('Xe hợp đồng', contracts)}
      </div>
    );
  };
  
  const renderSalaries = () => ( 
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {[{id:'CONFIG',label:'Cấu hình lương',icon:Coins},{id:'ATTENDANCE',label:'Công lái xe',icon:Calendar},{id:'KPI',label:'KPI lái xe',icon:TrendingUp},{id:'BONUS',label:'Thưởng - Phạt',icon:AlertOctagon},{id:'ADVANCES',label:'Tạm ứng & Hoàn ứng',icon:Wallet},{id:'SUMMARY',label:'Tổng hợp lương',icon:FileSpreadsheet},{id:'PAYSLIP',label:'Phiếu lương',icon:Printer},].map(tab=>(<button key={tab.id} onClick={()=>setSalaryTab(tab.id as any)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${salaryTab===tab.id?'bg-brand-50 text-brand-700 ring-1 ring-brand-200':'text-slate-600 hover:bg-slate-100'}`}><tab.icon className="w-4 h-4"/> {tab.label}</button>))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-slate-500">Tháng:</span>
          <input type="month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm outline-none focus:ring-1"/>
        </div>
      </div>
      <div className="min-h-[400px]">
        {salaryTab==='CONFIG'&&( 
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-fade-in">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 font-medium">
                <tr>
                  <th className="p-3">Biển số</th>
                  <th className="p-3">Tài xế</th>
                  <th className="p-3 text-right">Lương cơ bản</th>
                  <th className="p-3 text-center">Phương pháp tính</th>
                  <th className="p-3 text-right">Đơn giá áp dụng</th>
                  <th className="p-3 text-right">Phụ cấp (Ăn/ĐT/TN/CV/ĐH)</th>
                  <th className="p-3 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vehicles.map(v=>{
                  const methods = v.salaryMethods || [SalaryMethod.KM];
                  const methodLabels = { [SalaryMethod.KM]: 'Km', [SalaryMethod.TRIP]: 'Chuyến', [SalaryMethod.TON]: 'Tấn', [SalaryMethod.TON_KM]: 'Tấn.Km', [SalaryMethod.POINT]: 'Điểm', [SalaryMethod.BOX]: 'Thùng', [SalaryMethod.ORDER]: 'Đơn', [SalaryMethod.DAY]: 'Ngày công' };
                  return(
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="p-3 font-medium">{v.plateNumber}</td>
                      <td className="p-3 text-slate-600">{v.driverName}</td>
                      <td className="p-3 text-right">{(v.baseSalary||0).toLocaleString()}</td>
                      <td className="p-3 text-center">
                        <div className="flex flex-wrap gap-1 justify-center">{methods.map(m => (<span key={m} className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200">{methodLabels[m]}</span>))}</div>
                      </td>
                      <td className="p-3 text-right font-medium text-brand-600 text-xs">
                        <div className="flex flex-col gap-1 items-end">
                          {methods.map(m => (
                            <div key={m}>{methodLabels[m]}: {m===SalaryMethod.KM&&(v.pricePerKm||0).toLocaleString()}{m===SalaryMethod.TRIP&&(v.pricePerTrip||0).toLocaleString()}{m===SalaryMethod.TON&&(v.pricePerTon||0).toLocaleString()}{m===SalaryMethod.TON_KM&&`${(v.pricePerTonKm||0).toLocaleString()} x ${v.tonKmCoefficient||1}`}{m===SalaryMethod.POINT&&(v.pricePerPoint||0).toLocaleString()}{m===SalaryMethod.BOX&&(v.pricePerBox||0).toLocaleString()}{m===SalaryMethod.ORDER&&(v.pricePerOrder||0).toLocaleString()}{m===SalaryMethod.DAY&&(v.pricePerDay||0).toLocaleString()}</div>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-right">{((v.standardAllowance||0)+(v.responsibilityAllowance||0)+(v.positionAllowance||0)+(v.hazardousAllowance||0)).toLocaleString()}</td>
                      <td className="p-3 text-center"><button onClick={()=>handleOpenVehicleModal(v)} className="text-brand-600 hover:underline flex items-center justify-center gap-1 mx-auto"><Settings className="w-3 h-3"/> Cấu hình</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {salaryTab==='ATTENDANCE'&&renderSalaryAttendance()}
        {salaryTab==='KPI'&&(<div className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-fade-in"><table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-600 font-medium"><tr><th className="p-3">Tài xế</th><th className="p-3 text-center">Điểm KPI</th><th className="p-3 text-right">Thưởng KPI</th></tr></thead><tbody className="divide-y divide-slate-100">{vehicles.map(v=>{const record=getSalaryRecord(v.id);return(<tr key={v.id} className="hover:bg-slate-50"><td className="p-3">{v.driverName} ({v.plateNumber})</td><td className="p-3 text-center"><input type="number" max="100" min="0" className="w-16 border border-slate-300 rounded px-2 py-1 text-center" value={record?.kpiScore||100} onChange={e=>handleUpdateSalary(v.id,{kpiScore:Number(e.target.value)})}/></td><td className="p-3 text-right"><input type="number" className="w-28 border border-slate-300 rounded px-2 py-1 text-right" value={record?.kpiBonus||0} onChange={e=>handleUpdateSalary(v.id,{kpiBonus:Number(e.target.value)})}/></td></tr>)})}</tbody></table></div>)}
        {salaryTab==='BONUS'&&(<div className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-fade-in"><table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-600 font-medium"><tr><th className="p-3">Tài xế</th><th className="p-3 text-right">Thưởng khác</th><th className="p-3 text-right text-red-600">Phạt / Khấu trừ khác</th><th className="p-3 text-right text-orange-600">Trừ tạm ứng (Lương)</th></tr></thead><tbody className="divide-y divide-slate-100">{vehicles.map(v=>{const record=getSalaryRecord(v.id);return(<tr key={v.id} className="hover:bg-slate-50"><td className="p-3">{v.driverName} ({v.plateNumber})</td><td className="p-3 text-right"><input type="number" className="w-28 border border-slate-300 rounded px-2 py-1 text-right" value={record?.otherBonus||0} onChange={e=>handleUpdateSalary(v.id,{otherBonus:Number(e.target.value)})}/></td><td className="p-3 text-right"><input type="number" className="w-28 border border-slate-300 rounded px-2 py-1 text-right text-red-600" value={record?.otherDeductions||0} onChange={e=>handleUpdateSalary(v.id,{otherDeductions:Number(e.target.value)})}/></td><td className="p-3 text-right"><input type="number" className="w-28 border border-slate-300 rounded px-2 py-1 text-right text-orange-600" value={record?.advances||0} onChange={e=>handleUpdateSalary(v.id,{advances:Number(e.target.value)})}/></td></tr>)})}</tbody></table></div>)}
        {salaryTab==='ADVANCES'&&(<div className="space-y-6 animate-fade-in">
            {/* ... Keep advances existing content ... */}
            <div className="grid grid-cols-2 gap-4"><div className="bg-orange-50 p-4 rounded-xl border border-orange-100 flex justify-between items-center"><div><p className="text-orange-600 text-sm font-semibold mb-1">Tổng Tạm Ứng (Tháng {selectedMonth})</p><h3 className="text-2xl font-bold text-orange-700">{advances.filter(a=>a.date.startsWith(selectedMonth)&&(!a.type||a.type==='ADVANCE')).reduce((sum,a)=>sum+a.amount,0).toLocaleString()}</h3></div><div className="p-3 bg-white rounded-lg shadow-sm"><Wallet className="w-6 h-6 text-orange-500"/></div></div><div className="bg-teal-50 p-4 rounded-xl border border-teal-100 flex justify-between items-center"><div><p className="text-teal-600 text-sm font-semibold mb-1">Tổng Hoàn Ứng (Tháng {selectedMonth})</p><h3 className="text-2xl font-bold text-teal-700">{advances.filter(a=>a.date.startsWith(selectedMonth)&&a.type==='REFUND').reduce((sum,a)=>sum+a.amount,0).toLocaleString()}</h3></div><div className="p-3 bg-white rounded-lg shadow-sm"><RefreshCw className="w-6 h-6 text-teal-500"/></div></div></div><div className="flex justify-end gap-2"><button onClick={()=>handleOpenAdvanceModal('REFUND')} className="bg-teal-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-teal-700 transition shadow-sm"><RefreshCw className="w-4 h-4"/> Thêm hoàn ứng</button><button onClick={()=>handleOpenAdvanceModal('ADVANCE')} className="bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-orange-700 transition shadow-sm"><Plus className="w-4 h-4"/> Thêm tạm ứng</button></div><div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"><table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200"><tr><th className="p-3">Ngày</th><th className="p-3">Loại phiếu</th><th className="p-3">Xe / Tài xế</th><th className="p-3">Số tiền</th><th className="p-3">Ghi chú</th><th className="p-3 text-center">Thao tác</th></tr></thead><tbody className="divide-y divide-slate-100">{advances.filter(a=>a.date.startsWith(selectedMonth)).length===0?<tr><td colSpan={6} className="p-8 text-center text-slate-400">Chưa có dữ liệu tạm ứng / hoàn ứng trong tháng {selectedMonth}</td></tr>:advances.filter(a=>a.date.startsWith(selectedMonth)).map(a=>(<tr key={a.id} className="hover:bg-slate-50"><td className="p-3">{a.date}</td><td className="p-3">{a.type==='REFUND'?<span className="px-2 py-1 bg-teal-100 text-teal-700 rounded text-xs font-bold flex items-center w-fit gap-1"><RefreshCw className="w-3 h-3"/> Hoàn ứng</span>:<span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-bold flex items-center w-fit gap-1"><Wallet className="w-3 h-3"/> Tạm ứng</span>}</td><td className="p-3 font-medium">{a.vehiclePlate}</td><td className={`p-3 font-bold ${a.type==='REFUND'?'text-teal-600':'text-orange-600'}`}>{a.type==='REFUND'?'+':'-'}{a.amount.toLocaleString()}</td><td className="p-3 text-slate-500">{a.note}</td><td className="p-3 text-center"><div className="flex items-center justify-center gap-2"><button onClick={()=>handlePrintAdvance(a)} className="text-slate-400 hover:text-slate-600" title="In phiếu"><Printer className="w-4 h-4"/></button><button onClick={()=>handleOpenAdvanceModal(a.type||'ADVANCE',a,true)} className="text-slate-400 hover:text-blue-600" title="Xem chi tiết"><Eye className="w-4 h-4"/></button>
            {a.status === 'REFUNDED' ? (
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold border border-green-200 whitespace-nowrap">Đã Hoàn ứng</span>
            ) : a.status === 'ADVANCED' ? (
                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold border border-blue-200 whitespace-nowrap">Đã tạm ứng</span>
            ) : a.status === 'LOCKED' ? (
                <span className="p-1.5 text-slate-300 cursor-not-allowed" title="Đã khóa"><Lock className="w-4 h-4"/></span>
            ) : (
                <>
                <button onClick={()=>handleOpenAdvanceModal(a.type||'ADVANCE',a,false)} className="text-slate-400 hover:text-brand-600" title="Sửa"><Edit2 className="w-4 h-4"/></button><button onClick={()=>onDeleteAdvance(a.id)} className="text-slate-400 hover:text-red-600" title="Xóa"><Trash2 className="w-4 h-4"/></button>
                </>
            )}
            </div></td></tr>))}</tbody></table></div>
        </div>)}
        {salaryTab==='SUMMARY'&&(<div className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-fade-in"><table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-600 font-medium"><tr><th className="p-3">Tài xế</th><th className="p-3 text-right">Lương cơ bản</th><th className="p-3 text-right">Lương chuyến/Km/Ngày</th><th className="p-3 text-right">Phụ cấp</th><th className="p-3 text-right">Thưởng</th><th className="p-3 text-right text-red-600">Thuế TNCN</th><th className="p-3 text-right text-red-600">Khấu trừ khác</th><th className="p-3 text-right font-bold text-lg text-brand-700">Thực lĩnh</th></tr></thead><tbody className="divide-y divide-slate-100">{vehicles.map(v=>{const r=getSalaryRecord(v.id)||{baseSalary:v.baseSalary||0,tripAllowance:0,mealAllowance:v.standardAllowance||0,responsibilityAllowance:v.responsibilityAllowance||0,positionAllowance:v.positionAllowance||0,hazardousAllowance:v.hazardousAllowance||0,kpiBonus:0,otherBonus:0,insurance:v.insuranceAmount||0,personalIncomeTax:0,otherDeductions:0,advances:0,totalReceived:0};const allowances=(r.mealAllowance||0)+(r.responsibilityAllowance||0)+(r.positionAllowance||0)+(r.hazardousAllowance||0);const bonus=(r.kpiBonus||0)+(r.otherBonus||0);const deductions=(r.insurance||0)+(r.otherDeductions||0)+(r.advances||0);const tax=(r.personalIncomeTax||0);const total=(r.baseSalary||0)+(r.tripAllowance||0)+allowances+bonus-deductions-tax;return(<tr key={v.id} className="hover:bg-slate-50"><td className="p-3 font-medium">{v.driverName}</td><td className="p-3 text-right">{(r.baseSalary||0).toLocaleString()}</td><td className="p-3 text-right font-medium">{(r.tripAllowance||0).toLocaleString()}</td><td className="p-3 text-right">{allowances.toLocaleString()}</td><td className="p-3 text-right text-green-600">{bonus.toLocaleString()}</td><td className="p-3 text-right text-red-600">{tax.toLocaleString()}</td><td className="p-3 text-right text-red-600">-{deductions.toLocaleString()}</td><td className="p-3 text-right font-bold text-brand-700 text-base">{total.toLocaleString()}</td></tr>)})}</tbody></table></div>)}
        {salaryTab==='PAYSLIP'&&(<div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">{vehicles.map(v=>{const r=getSalaryRecord(v.id);if(!r)return null;return(<div key={v.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative"><div className="absolute top-4 right-4 flex gap-2"><button onClick={() => handlePrintPayslip(v, r)} className="p-2 bg-slate-100 rounded-full hover:bg-brand-100 text-slate-500 hover:text-brand-600 transition" title="In phiếu lương"><Printer className="w-5 h-5" /></button></div><div className="absolute top-14 right-4 opacity-10"><DollarSign className="w-24 h-24"/></div><div className="text-center border-b border-slate-100 pb-4 mb-4"><h3 className="text-lg font-bold text-slate-800">PHIẾU LƯƠNG THÁNG {selectedMonth}</h3><p className="text-slate-500">{v.driverName} - {v.plateNumber}</p></div><div className="space-y-2 text-sm"><div className="flex justify-between"><span className="text-slate-600">Lương cơ bản:</span><span className="font-medium">{(r.baseSalary||0).toLocaleString()}</span></div><div className="flex justify-between"><span className="text-slate-600">Thành tiền Công/Chuyến/Ngày:</span><span className="font-medium">{(r.tripAllowance||0).toLocaleString()}</span></div><div className="flex justify-between"><span className="text-slate-600">Phụ cấp (Ăn/ĐT/TN/CV/ĐH):</span><span className="font-medium">{((r.mealAllowance||0)+(r.responsibilityAllowance||0)+(r.positionAllowance||0)+(r.hazardousAllowance||0)).toLocaleString()}</span></div><div className="flex justify-between text-green-600"><span>Thưởng (KPI/Khác):</span><span className="font-medium">{((r.kpiBonus||0)+(r.otherBonus||0)).toLocaleString()}</span></div><div className="flex justify-between text-red-600"><span>Thuế TNCN (Tạm tính):</span><span className="font-medium">-{((r.personalIncomeTax||0)).toLocaleString()}</span></div><div className="flex justify-between text-red-600"><span>Khấu trừ (BH/Phạt/Ứng):</span><span className="font-medium">-{((r.insurance||0)+(r.otherDeductions||0)+(r.advances||0)).toLocaleString()}</span></div><div className="border-t border-slate-200 pt-3 mt-2 flex justify-between items-center"><span className="font-bold text-lg text-slate-800">THỰC LĨNH:</span><span className="font-bold text-xl text-brand-600">{(r.totalReceived||0).toLocaleString()} VNĐ</span></div></div></div>)})}</div>)}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ... Header & Tabs (Existing) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
         <div className="flex gap-4">
             <button 
                onClick={() => setActiveTab('VEHICLES')}
                className={`px-4 py-2 rounded-lg font-medium transition ${activeTab === 'VEHICLES' ? 'bg-brand-600 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
             >
                 Danh sách xe
             </button>
             <button 
                onClick={() => setActiveTab('COSTS')}
                className={`px-4 py-2 rounded-lg font-medium transition ${activeTab === 'COSTS' ? 'bg-brand-600 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
             >
                 Chi phí
             </button>
             <button 
                onClick={() => setActiveTab('SALARIES')}
                className={`px-4 py-2 rounded-lg font-medium transition ${activeTab === 'SALARIES' ? 'bg-brand-600 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
             >
                 Quản lý lương
             </button>
         </div>
         
         {activeTab === 'VEHICLES' && (
             <div className="flex gap-2">
                 <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input 
                    type="text" 
                    placeholder="Tìm xe, tài xế..." 
                    className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    />
                 </div>
                 {/* New "Add Driver" Button next to Add Vehicle */}
                 <button onClick={() => handleOpenVehicleModal(undefined, 'DRIVER')} className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 hover:text-brand-600 transition">
                     <UserPlus className="w-4 h-4" /> Thêm lái xe
                 </button>
                 <button onClick={() => handleOpenVehicleModal()} className="bg-brand-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-brand-700 transition">
                     <Plus className="w-4 h-4" /> Thêm xe
                 </button>
             </div>
         )}
         {activeTab === 'COSTS' && (
             <button onClick={() => setIsCostModalOpen(true)} className="bg-brand-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-brand-700 transition">
                <Plus className="w-4 h-4" /> Thêm chi phí
            </button>
         )}
      </div>

      {/* Content */}
      <div className="animate-fade-in">
          {activeTab === 'VEHICLES' && renderVehicles()}
          {activeTab === 'COSTS' && renderCosts()}
          {activeTab === 'SALARIES' && renderSalaries()}
      </div>

      {/* Vehicle Modal with Tabs */}
      {isVehicleModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center flex-shrink-0">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Truck className="w-5 h-5 text-brand-600" />
                {editingVehicleId ? 'Cập nhật thông tin xe / Tài xế' : 'Thêm mới Xe & Tài xế'}
              </h3>
              <button onClick={() => setIsVehicleModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-3xl leading-none">&times;</button>
            </div>
            
            {/* Modal Tabs */}
            <div className="flex border-b border-slate-200 bg-slate-50/50">
                <button 
                    type="button"
                    onClick={() => setVehicleModalTab('INFO')} 
                    className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${vehicleModalTab === 'INFO' ? 'border-brand-600 text-brand-600 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
                >
                    <Truck className="w-4 h-4"/> Thông tin Xe
                </button>
                <button 
                    type="button"
                    onClick={() => setVehicleModalTab('DRIVER')} 
                    className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${vehicleModalTab === 'DRIVER' ? 'border-brand-600 text-brand-600 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
                >
                    <User className="w-4 h-4"/> Thông tin Tài xế
                </button>
                <button 
                    type="button"
                    onClick={() => setVehicleModalTab('SALARY')} 
                    className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${vehicleModalTab === 'SALARY' ? 'border-brand-600 text-brand-600 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
                >
                    <Coins className="w-4 h-4"/> Cấu hình Lương
                </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
                <form onSubmit={submitVehicle} className="space-y-6">
                    {/* TAB 1: VEHICLE INFO */}
                    {vehicleModalTab === 'INFO' && (
                    <div className="space-y-4 animate-fade-in">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelClass}>Biển số xe <span className="text-red-500">*</span></label>
                                <input required className={inputClass} value={vehicleForm.plateNumber} onChange={e => setVehicleForm({...vehicleForm, plateNumber: e.target.value})} placeholder="VD: 75C-123.45" />
                            </div>
                            <div>
                                <label className={labelClass}>Mã nội bộ</label>
                                <input className={inputClass} value={vehicleForm.internalCode} onChange={e => setVehicleForm({...vehicleForm, internalCode: e.target.value})} placeholder="VD: XE-01" />
                            </div>
                            <div>
                                <label className={labelClass}>Loại xe</label>
                                <input className={inputClass} value={vehicleForm.type} onChange={e => setVehicleForm({...vehicleForm, type: e.target.value})} placeholder="VD: 1.5 Tấn" />
                            </div>
                            <div>
                                <label className={labelClass}>Tải trọng (kg)</label>
                                <input type="number" required className={inputClass} value={vehicleForm.capacityKg} onChange={e => setVehicleForm({...vehicleForm, capacityKg: Number(e.target.value)})} />
                            </div>
                            <div>
                                <label className={labelClass}>Nhóm xe</label>
                                <select className={inputClass} value={vehicleForm.category || 'TRUCK'} onChange={e => setVehicleForm({...vehicleForm, category: e.target.value as any})}>
                                    <option value="TRUCK">Xe tải</option>
                                    <option value="COACH">Xe khách</option>
                                    <option value="CONTRACT">Xe hợp đồng</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClass}>Trạng thái</label>
                                <select className={inputClass} value={vehicleForm.status || 'AVAILABLE'} onChange={e => setVehicleForm({...vehicleForm, status: e.target.value as any})}>
                                    <option value="AVAILABLE">Sẵn sàng (Available)</option>
                                    <option value="BUSY">Đang chạy (Busy)</option>
                                    <option value="MAINTENANCE">Bảo trì (Maintenance)</option>
                                </select>
                            </div>
                             <div className="col-span-2">
                                <label className={labelClass}>Tuyến ưu tiên</label>
                                <input className={inputClass} value={vehicleForm.preferredRoute} onChange={e => setVehicleForm({...vehicleForm, preferredRoute: e.target.value})} placeholder="VD: Huế - Đà Nẵng" />
                            </div>
                        </div>
                    </div>
                    )}

                    {/* TAB 2: DRIVER INFO (EXPANDED) */}
                    {vehicleModalTab === 'DRIVER' && (
                    <div className="space-y-4 animate-fade-in">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2 md:col-span-1">
                                <label className={labelClass}>Họ tên tài xế <span className="text-red-500">*</span></label>
                                <input required className={inputClass} value={vehicleForm.driverName} onChange={e => setVehicleForm({...vehicleForm, driverName: e.target.value})} placeholder="Nhập họ tên..." />
                            </div>
                            <div className="col-span-2 md:col-span-1">
                                <label className={labelClass}>Số điện thoại</label>
                                <input className={inputClass} value={vehicleForm.driverPhone} onChange={e => setVehicleForm({...vehicleForm, driverPhone: e.target.value})} placeholder="Nhập SĐT..." />
                            </div>
                            
                            {/* New Fields */}
                            <div>
                                <label className={labelClass}>Số CCCD / CMND</label>
                                <input className={inputClass} value={vehicleForm.driverIdCard} onChange={e => setVehicleForm({...vehicleForm, driverIdCard: e.target.value})} placeholder="Số căn cước công dân" />
                            </div>
                            <div>
                                <label className={labelClass}>Ngày sinh</label>
                                <input type="date" className={inputClass} value={vehicleForm.driverDob} onChange={e => setVehicleForm({...vehicleForm, driverDob: e.target.value})} />
                            </div>
                            <div>
                                <label className={labelClass}>Giới tính</label>
                                <select className={inputClass} value={vehicleForm.driverGender || 'Nam'} onChange={e => setVehicleForm({...vehicleForm, driverGender: e.target.value as any})}>
                                    <option value="Nam">Nam</option>
                                    <option value="Nữ">Nữ</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClass}>Số Giấy phép lái xe</label>
                                <input className={inputClass} value={vehicleForm.driverLicenseNumber} onChange={e => setVehicleForm({...vehicleForm, driverLicenseNumber: e.target.value})} placeholder="Số GPLX" />
                            </div>
                            <div>
                                <label className={labelClass}>Hạn GPLX</label>
                                <input type="date" className={inputClass} value={vehicleForm.driverLicenseExpiry} onChange={e => setVehicleForm({...vehicleForm, driverLicenseExpiry: e.target.value})} />
                            </div>
                            <div className="col-span-2">
                                <label className={labelClass}>Thông tin Hợp đồng lao động</label>
                                <textarea 
                                    className={`${inputClass} h-20 py-2`} 
                                    value={vehicleForm.driverContractInfo} 
                                    onChange={e => setVehicleForm({...vehicleForm, driverContractInfo: e.target.value})} 
                                    placeholder="Số hợp đồng, ngày ký, loại hợp đồng..."
                                ></textarea>
                            </div>
                        </div>
                    </div>
                    )}

                    {/* TAB 3: SALARY CONFIG */}
                    {vehicleModalTab === 'SALARY' && (
                    <div className="animate-fade-in -mx-2">
                        {/* Salary Config Content */}
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                         <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Coins className="w-4 h-4"/> Thiết lập thu nhập</h4>
                         <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label className={labelClass}>Lương cơ bản</label>
                                <input 
                                    type="text" 
                                    className={inputClass} 
                                    value={formatNumber(vehicleForm.baseSalary)} 
                                    onChange={e => handleNumericInput(e.target.value, 'baseSalary')} 
                                    placeholder="0"
                                />
                            </div>
                             <div className="row-span-2">
                                <label className={labelClass}>Phương pháp tính lương (Chọn nhiều)</label>
                                <div className="space-y-2 max-h-40 overflow-y-auto bg-white border border-slate-300 rounded-lg p-3">
                                    {[
                                        { val: SalaryMethod.KM, label: 'Theo Km' },
                                        { val: SalaryMethod.TRIP, label: 'Theo Chuyến' },
                                        { val: SalaryMethod.TON, label: 'Theo Tấn' },
                                        { val: SalaryMethod.TON_KM, label: 'Tấn x Km' },
                                        { val: SalaryMethod.POINT, label: 'Điểm giao' },
                                        { val: SalaryMethod.BOX, label: 'Theo Thùng' },
                                        { val: SalaryMethod.ORDER, label: 'Theo Đơn' },
                                        { val: SalaryMethod.DAY, label: 'Theo Ngày công' },
                                    ].map(method => (
                                        <div key={method.val} className="flex items-center gap-2">
                                            <input 
                                                type="checkbox" 
                                                id={`method-${method.val}`}
                                                checked={(vehicleForm.salaryMethods || []).includes(method.val)}
                                                onChange={() => toggleSalaryMethod(method.val)}
                                                className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
                                            />
                                            <label htmlFor={`method-${method.val}`} className="text-sm text-slate-700 cursor-pointer">{method.label}</label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            
                            {/* Conditional Price Inputs */}
                            <div className="col-span-2 grid grid-cols-2 gap-4">
                            {(vehicleForm.salaryMethods || []).includes(SalaryMethod.KM) && (
                                 <div>
                                    <label className={labelClass}>Đơn giá / Km</label>
                                    <input 
                                        type="text" 
                                        className={inputClass} 
                                        value={formatNumber(vehicleForm.pricePerKm)} 
                                        onChange={e => handleNumericInput(e.target.value, 'pricePerKm')} 
                                        placeholder="0"
                                    />
                                </div>
                            )}
                            {(vehicleForm.salaryMethods || []).includes(SalaryMethod.TRIP) && (
                                 <div>
                                    <label className={labelClass}>Đơn giá / Chuyến</label>
                                    <input 
                                        type="text" 
                                        className={inputClass} 
                                        value={formatNumber(vehicleForm.pricePerTrip)} 
                                        onChange={e => handleNumericInput(e.target.value, 'pricePerTrip')} 
                                        placeholder="0"
                                    />
                                </div>
                            )}
                            {(vehicleForm.salaryMethods || []).includes(SalaryMethod.TON) && (
                                 <div>
                                    <label className={labelClass}>Đơn giá / Tấn</label>
                                    <input 
                                        type="text" 
                                        className={inputClass} 
                                        value={formatNumber(vehicleForm.pricePerTon)} 
                                        onChange={e => handleNumericInput(e.target.value, 'pricePerTon')} 
                                        placeholder="0"
                                    />
                                </div>
                            )}
                            {(vehicleForm.salaryMethods || []).includes(SalaryMethod.TON_KM) && (
                                 <>
                                 <div>
                                    <label className={labelClass}>Đơn giá / Tấn*Km</label>
                                    <input 
                                        type="text" 
                                        className={inputClass} 
                                        value={formatNumber(vehicleForm.pricePerTonKm)} 
                                        onChange={e => handleNumericInput(e.target.value, 'pricePerTonKm')} 
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>Hệ số điều chỉnh (Tấn*Km)</label>
                                    <input 
                                        type="number"
                                        step="0.01"
                                        className={inputClass} 
                                        value={vehicleForm.tonKmCoefficient || 1} 
                                        onChange={e => setVehicleForm({...vehicleForm, tonKmCoefficient: Number(e.target.value)})} 
                                        placeholder="1"
                                    />
                                </div>
                                </>
                            )}
                            {(vehicleForm.salaryMethods || []).includes(SalaryMethod.POINT) && (
                                 <div>
                                    <label className={labelClass}>Đơn giá / Điểm giao</label>
                                    <input 
                                        type="text" 
                                        className={inputClass} 
                                        value={formatNumber(vehicleForm.pricePerPoint)} 
                                        onChange={e => handleNumericInput(e.target.value, 'pricePerPoint')} 
                                        placeholder="0"
                                    />
                                </div>
                            )}
                            {(vehicleForm.salaryMethods || []).includes(SalaryMethod.BOX) && (
                                 <div>
                                    <label className={labelClass}>Đơn giá / Thùng</label>
                                    <input 
                                        type="text" 
                                        className={inputClass} 
                                        value={formatNumber(vehicleForm.pricePerBox)} 
                                        onChange={e => handleNumericInput(e.target.value, 'pricePerBox')} 
                                        placeholder="0"
                                    />
                                </div>
                            )}
                            {(vehicleForm.salaryMethods || []).includes(SalaryMethod.ORDER) && (
                                 <div>
                                    <label className={labelClass}>Đơn giá / Đơn hàng</label>
                                    <input 
                                        type="text" 
                                        className={inputClass} 
                                        value={formatNumber(vehicleForm.pricePerOrder)} 
                                        onChange={e => handleNumericInput(e.target.value, 'pricePerOrder')} 
                                        placeholder="0"
                                    />
                                </div>
                            )}
                            {(vehicleForm.salaryMethods || []).includes(SalaryMethod.DAY) && (
                                 <div>
                                    <label className={labelClass}>Lương / Ngày</label>
                                    <input 
                                        type="text" 
                                        className={inputClass} 
                                        value={formatNumber(vehicleForm.pricePerDay)} 
                                        onChange={e => handleNumericInput(e.target.value, 'pricePerDay')} 
                                        placeholder="0"
                                    />
                                </div>
                            )}
                            </div>

                            {/* Allowances Section */}
                            <div className="col-span-2 mt-4 pt-4 border-t border-slate-200">
                                 <h5 className="font-bold text-slate-700 mb-2 flex items-center gap-2">
                                    <Wallet className="w-4 h-4"/> Chi tiết các phụ cấp
                                 </h5>
                                 <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm grid grid-cols-2 gap-4">
                                     <div>
                                        <label className={labelClass}>Phu cấp (ĐT/ăn ca)</label>
                                        <input 
                                            type="text" 
                                            className={inputClass} 
                                            value={formatNumber(vehicleForm.standardAllowance)} 
                                            onChange={e => handleNumericInput(e.target.value, 'standardAllowance')} 
                                            placeholder="0"
                                        />
                                    </div>
                                     <div>
                                        <label className={labelClass}>Phụ cấp trách nhiệm</label>
                                        <input 
                                            type="text" 
                                            className={inputClass} 
                                            value={formatNumber(vehicleForm.responsibilityAllowance)} 
                                            onChange={e => handleNumericInput(e.target.value, 'responsibilityAllowance')} 
                                            placeholder="0"
                                        />
                                    </div>
                                     <div>
                                        <label className={labelClass}>Phụ cấp chức vụ</label>
                                        <input 
                                            type="text" 
                                            className={inputClass} 
                                            value={formatNumber(vehicleForm.positionAllowance)} 
                                            onChange={e => handleNumericInput(e.target.value, 'positionAllowance')} 
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Phụ cấp độc hại</label>
                                        <input 
                                            type="text" 
                                            className={inputClass} 
                                            value={formatNumber(vehicleForm.hazardousAllowance)} 
                                            onChange={e => handleNumericInput(e.target.value, 'hazardousAllowance')} 
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Phụ cấp khác</label>
                                        <input 
                                            type="text" 
                                            className={inputClass} 
                                            value={formatNumber(vehicleForm.fixedOtherAllowance)} 
                                            onChange={e => handleNumericInput(e.target.value, 'fixedOtherAllowance')} 
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Khoản bổ sung khác (Cố định)</label>
                                        <input 
                                            type="text" 
                                            className={inputClass} 
                                            value={formatNumber(vehicleForm.fixedSupplement)} 
                                            onChange={e => handleNumericInput(e.target.value, 'fixedSupplement')} 
                                            placeholder="0"
                                        />
                                    </div>
                                 </div>
                            </div>

                        </div>
                        
                        {/* New Insurance Configuration Section */}
                        <div className="mt-4 pt-4 border-t border-slate-200">
                             <h5 className="font-bold text-slate-700 mb-2 flex items-center gap-2"><ShieldCheck className="w-4 h-4"/> Cấu hình Bảo hiểm (BHXH/BHYT/BHTN)</h5>
                             <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm space-y-3">
                                {/* ... Insurance UI ... */}
                                <div>
                                    <label className={labelClass}>Căn cứ đóng BHXH</label>
                                    <div className="flex gap-4 mb-2">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input 
                                                type="radio" 
                                                name="insuranceBaseType"
                                                checked={!vehicleForm.insuranceBaseType || vehicleForm.insuranceBaseType === 'ACTUAL'}
                                                onChange={() => setVehicleForm({...vehicleForm, insuranceBaseType: 'ACTUAL'})}
                                                className="text-brand-600 focus:ring-brand-500"
                                            />
                                            <span className="text-sm">Theo tổng thu nhập cố định</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input 
                                                type="radio" 
                                                name="insuranceBaseType"
                                                checked={vehicleForm.insuranceBaseType === 'CEILING'}
                                                onChange={() => setVehicleForm({...vehicleForm, insuranceBaseType: 'CEILING'})}
                                                className="text-brand-600 focus:ring-brand-500"
                                            />
                                            <span className="text-sm">Theo mức trần (Lương cơ sở x 20)</span>
                                        </label>
                                    </div>
                                </div>

                                {vehicleForm.insuranceBaseType === 'CEILING' && (
                                    <div>
                                        <label className={labelClass}>Mức lương cơ sở (VNĐ)</label>
                                        <input 
                                            type="text" 
                                            className={inputClass} 
                                            value={formatNumber(vehicleForm.baseSalaryRate)} 
                                            onChange={e => handleNumericInput(e.target.value, 'baseSalaryRate')} 
                                            placeholder="0"
                                        />
                                        <div className="text-xs text-slate-500 mt-1 italic">
                                            * Lương đóng BHXH = {((vehicleForm.baseSalaryRate || 0) * 20).toLocaleString()} đ
                                        </div>
                                    </div>
                                )}

                                <div className="flex justify-between items-center bg-slate-50 p-2 rounded text-sm text-slate-600">
                                    <span>Lương đóng BHXH:</span>
                                    <span className="font-bold text-slate-800">
                                        {vehicleForm.insuranceBaseType === 'CEILING' 
                                            ? ((Number(vehicleForm.baseSalaryRate) || 0) * 20).toLocaleString()
                                            : ((Number(vehicleForm.baseSalary) || 0) + 
                                              (Number(vehicleForm.responsibilityAllowance) || 0) + 
                                              (Number(vehicleForm.positionAllowance) || 0) + 
                                              (Number(vehicleForm.hazardousAllowance) || 0) +
                                              (Number(vehicleForm.fixedSupplement) || 0)).toLocaleString()
                                        } đ
                                    </span>
                                </div>
                                
                                <div>
                                    <label className={labelClass}>Phương án tính bảo hiểm</label>
                                    <div className="grid grid-cols-1 gap-2">
                                        <label className="flex items-center gap-2 cursor-pointer border p-2 rounded hover:bg-slate-50">
                                            <input 
                                                type="radio" 
                                                name="insuranceMode"
                                                checked={vehicleForm.insuranceMode === InsuranceMode.EMPLOYEE}
                                                onChange={() => setVehicleForm({...vehicleForm, insuranceMode: InsuranceMode.EMPLOYEE})}
                                                className="text-brand-600 focus:ring-brand-500"
                                            />
                                            <div className="flex-1">
                                                <div className="font-medium text-sm">Phương án 1: Tính cho NLĐ (10.5%)</div>
                                                <div className="text-xs text-slate-500">BHXH 8% + BHYT 1.5% + BHTN 1%</div>
                                            </div>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer border p-2 rounded hover:bg-slate-50">
                                            <input 
                                                type="radio" 
                                                name="insuranceMode"
                                                checked={vehicleForm.insuranceMode === InsuranceMode.EMPLOYER}
                                                onChange={() => setVehicleForm({...vehicleForm, insuranceMode: InsuranceMode.EMPLOYER})}
                                                className="text-brand-600 focus:ring-brand-500"
                                            />
                                            <div className="flex-1">
                                                <div className="font-medium text-sm">Phương án 2: Tính cho NSDLĐ (21.5%)</div>
                                                <div className="text-xs text-slate-500">BHXH 17.5% + BHYT 3% + BHTN 1%</div>
                                            </div>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer border p-2 rounded hover:bg-slate-50">
                                            <input 
                                                type="radio" 
                                                name="insuranceMode"
                                                checked={!vehicleForm.insuranceMode || vehicleForm.insuranceMode === InsuranceMode.NONE}
                                                onChange={() => setVehicleForm({...vehicleForm, insuranceMode: InsuranceMode.NONE})}
                                                className="text-brand-600 focus:ring-brand-500"
                                            />
                                            <span className="text-sm">Không tính / Nhập tay</span>
                                        </label>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center border-t border-slate-100 pt-2">
                                    <span className="text-sm font-semibold text-slate-700">Số tiền trích đóng dự kiến:</span>
                                    <span className="font-bold text-red-600 text-lg">
                                        {(vehicleForm.insuranceAmount || 0).toLocaleString()} đ
                                    </span>
                                </div>
                             </div>
                        </div>

                        {/* New PIT Configuration Section */}
                        <div className="mt-4 pt-4 border-t border-slate-200">
                             <h5 className="font-bold text-slate-700 mb-2 flex items-center gap-2"><Scale className="w-4 h-4"/> Cấu hình Thuế TNCN</h5>
                             <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm space-y-3">
                                 <label className="flex items-center gap-2 cursor-pointer mb-2">
                                     <input 
                                         type="checkbox"
                                         checked={vehicleForm.enablePIT || false}
                                         onChange={(e) => setVehicleForm({...vehicleForm, enablePIT: e.target.checked})}
                                         className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
                                     />
                                     <span className="font-bold text-sm text-slate-800">Tính thuế TNCN (Biểu lũy tiến từng phần)</span>
                                 </label>
                                 
                                 {vehicleForm.enablePIT && (
                                     <div className="grid grid-cols-2 gap-4 animate-fade-in">
                                         <div>
                                             <label className={labelClass}>Giảm trừ bản thân (Mặc định: 11tr)</label>
                                             <input type="text" disabled className={`${inputClass} bg-slate-100`} value="11.000.000" />
                                         </div>
                                         <div>
                                             <label className={labelClass}>Số người phụ thuộc</label>
                                             <input 
                                                type="number" 
                                                min="0"
                                                className={inputClass} 
                                                value={vehicleForm.numberOfDependents} 
                                                onChange={e => setVehicleForm({...vehicleForm, numberOfDependents: Number(e.target.value)})} 
                                             />
                                             <div className="text-xs text-slate-500 mt-1">
                                                 Giảm trừ: {((vehicleForm.numberOfDependents || 0) * 4400000).toLocaleString()} đ
                                             </div>
                                         </div>
                                         <div className="col-span-2">
                                             <label className={labelClass}>Các khoản đóng góp được trừ (Từ thiện/Nhân đạo)</label>
                                             <input 
                                                type="text" 
                                                className={inputClass} 
                                                value={formatNumber(vehicleForm.charitableContributions)} 
                                                onChange={e => handleNumericInput(e.target.value, 'charitableContributions')} 
                                                placeholder="0"
                                             />
                                         </div>
                                         <div className="col-span-2 bg-slate-50 p-2 rounded text-xs text-slate-600 italic">
                                             * Thuế TNCN = (Tổng thu nhập chịu thuế - Các khoản giảm trừ) x Thuế suất lũy tiến
                                         </div>
                                     </div>
                                 )}
                             </div>
                        </div>
                    </div>
                    </div>
                    )}

                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                        <button type="button" onClick={() => setIsVehicleModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Hủy</button>
                        <button type="submit" className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium">Lưu thông tin</button>
                    </div>
                </form>
            </div>
          </div>
        </div>
      )}

      {/* ... (Keep existing Driver Return Input Modal and History Modal) ... */}
      {isReturnInputModalOpen && selectedTripForReturn && ( /* ... */ <div className="hidden">Placeholder to maintain structure if truncated</div>)}
      {/* For brevity, assuming other modals are preserved as they were since no changes requested inside them. */}
      {/* ... Copying back critical modals for functionality ... */}

       {/* Driver Return Input Modal */}
      {isReturnInputModalOpen && selectedTripForReturn && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                 <div className="bg-orange-50 px-6 py-4 border-b border-orange-200 flex justify-between items-center">
                     <h3 className="text-lg font-bold text-orange-900 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5"/> Nhập hàng hoàn & Sự cố
                     </h3>
                     <button onClick={() => setIsReturnInputModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-3xl leading-none">&times;</button>
                 </div>
                 <div className="p-6 overflow-y-auto">
                     {/* ... Content ... */}
                     <div className="mb-4 p-3 bg-blue-50 text-blue-800 text-sm rounded border border-blue-100">
                         Vui lòng kiểm đếm và nhập số lượng hàng trả về kho. Hệ thống sẽ lưu lại lịch sử.
                     </div>
                     <div className="space-y-4 mb-6">
                         {selectedTripForReturn.orders.map(order => (
                             <div key={order.id} className="border border-slate-200 rounded-lg overflow-hidden">
                                 <div className="bg-slate-50 p-2 font-bold text-slate-700 text-sm flex justify-between">
                                     <span>{order.distributorName}</span>
                                     <span className="text-slate-500 font-normal">{order.id}</span>
                                 </div>
                                 <div className="p-2 space-y-2">
                                     {order.items.map(item => (
                                         <div key={item.productId} className="flex items-center justify-between text-sm">
                                             <span className="flex-1">{item.productName} (SL: {item.quantity})</span>
                                             <div className="flex items-center gap-2">
                                                 <span className="text-xs text-slate-500">Hoàn:</span>
                                                 <input 
                                                    type="number" 
                                                    min="0"
                                                    max={item.quantity}
                                                    className="w-20 border border-slate-300 rounded px-2 py-1 text-center"
                                                    placeholder="0"
                                                    value={returnItemsInput[order.id]?.[item.productId] || ''}
                                                    onChange={(e) => {
                                                        const val = parseInt(e.target.value) || 0;
                                                        setReturnItemsInput(prev => ({
                                                            ...prev,
                                                            [order.id]: {
                                                                ...(prev[order.id] || {}),
                                                                [item.productId]: Math.min(val, item.quantity)
                                                            }
                                                        }));
                                                    }}
                                                 />
                                             </div>
                                         </div>
                                     ))}
                                 </div>
                             </div>
                         ))}
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                             <label className={labelClass}>Kho trả hàng hoàn</label>
                             <input 
                                className={inputClass}
                                placeholder="Nhập tên kho trả hàng..."
                                value={returnWarehouseInput}
                                onChange={(e) => setReturnWarehouseInput(e.target.value)}
                             />
                         </div>
                         <div>
                             <label className={labelClass}>Địa chỉ kho hàng hoàn</label>
                             <input 
                                className={inputClass}
                                placeholder="Nhập địa chỉ kho..."
                                value={returnWarehouseAddressInput}
                                onChange={(e) => setReturnWarehouseAddressInput(e.target.value)}
                             />
                         </div>
                         <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelClass}>Người nhận (Kho)</label>
                                <input className={inputClass} placeholder="Tên thủ kho" value={returnReceiver} onChange={(e) => setReturnReceiver(e.target.value)} />
                            </div>
                            <div>
                                <label className={labelClass}>Số điện thoại</label>
                                <input className={inputClass} placeholder="SĐT người nhận" value={returnReceiverPhone} onChange={(e) => setReturnReceiverPhone(e.target.value)} />
                            </div>
                         </div>
                         <div className="col-span-1 md:col-span-2">
                             <label className={labelClass}>Ghi chú sự cố / Lý do</label>
                             <input className={inputClass} placeholder="VD: Khách đóng cửa..." value={returnNote} onChange={(e) => setReturnNote(e.target.value)} />
                         </div>
                     </div>
                     <div className="flex justify-end gap-3 mt-6 border-t border-slate-100 pt-4">
                         <button onClick={() => setIsReturnInputModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Hủy bỏ</button>
                         <button onClick={submitDriverReturn} className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium flex items-center gap-2"><RotateCcw className="w-4 h-4"/> Xác nhận Hoàn</button>
                     </div>
                 </div>
             </div>
          </div>
       )}
       
       {/* History Modal */}
       {isHistoryModalOpen && historyVehicleId && (
           <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                 <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                     <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <History className="w-5 h-5 text-brand-600"/> Lịch sử hoàn hàng
                     </h3>
                     <button onClick={() => setIsHistoryModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-3xl leading-none">&times;</button>
                 </div>
                 <div className="p-6 overflow-y-auto">
                     {returnLogs.filter(log => log.vehicleId === historyVehicleId).length === 0 ? (
                         <div className="text-center text-slate-400 py-10 border border-dashed rounded-lg">Chưa có lịch sử hoàn hàng nào.</div>
                     ) : (
                         <div className="space-y-4">
                             {returnLogs.filter(log => log.vehicleId === historyVehicleId).map(log => (
                                 <div key={log.id} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                     <div className="bg-slate-50 p-3 flex justify-between items-start text-sm border-b border-slate-100">
                                         <div>
                                            <div className="font-bold text-slate-700 mb-1">{new Date(log.date).toLocaleString('vi-VN')}</div>
                                            <div className="text-slate-500">Kho: <span className="font-medium text-slate-800">{log.returnWarehouse}</span></div>
                                         </div>
                                         <button onClick={() => handlePrintReturnLog(log)} className="text-slate-400 hover:text-slate-700 p-1"><Printer className="w-4 h-4" /></button>
                                     </div>
                                     <div className="p-3">
                                         {log.note && <div className="text-xs text-orange-600 mb-2 italic">"{log.note}"</div>}
                                         <table className="w-full text-sm">
                                             <tbody>
                                                 {log.items.map((item, idx) => (
                                                     <tr key={idx} className="border-b border-slate-50 last:border-0">
                                                         <td className="py-2 text-slate-600">{item.distributorName}</td>
                                                         <td className="py-2 text-slate-800 font-medium">{item.productName}</td>
                                                         <td className="py-2 text-right font-bold text-red-600">{item.quantity}</td>
                                                     </tr>
                                                 ))}
                                             </tbody>
                                         </table>
                                     </div>
                                 </div>
                             ))}
                         </div>
                     )}
                 </div>
             </div>
           </div>
       )}

      {/* Cost Delete Confirmation Modal */}
      {costDeleteId && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                <h3 className="text-xl font-bold text-red-600 mb-4 flex items-center gap-2"><AlertTriangle className="w-6 h-6"/> Xóa chi phí?</h3>
                <p className="text-slate-600 mb-6">Bạn có chắc chắn muốn xóa khoản chi phí này không?</p>
                <div className="flex justify-end gap-3">
                    <button onClick={() => setCostDeleteId(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Hủy bỏ</button>
                    <button onClick={confirmDeleteCost} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Xóa ngay</button>
                </div>
            </div>
        </div>
      )}

      {/* Advance Modal */}
      {isAdvanceModalOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                 <div className={`px-6 py-4 border-b border-slate-200 ${advanceForm.type === 'REFUND' ? 'bg-teal-50' : 'bg-orange-50'} flex justify-between items-center`}>
                     <h3 className={`font-bold ${advanceForm.type === 'REFUND' ? 'text-teal-800' : 'text-orange-800'} flex items-center gap-2`}>
                         {advanceForm.type === 'REFUND' ? <RefreshCw className="w-5 h-5"/> : <Wallet className="w-5 h-5"/>}
                         {isAdvanceViewMode ? 'Chi tiết phiếu' : (editingAdvanceId ? 'Cập nhật phiếu' : (advanceForm.type === 'REFUND' ? 'Tạo phiếu Hoàn ứng' : 'Tạo phiếu Tạm ứng'))}
                     </h3>
                     <button onClick={() => setIsAdvanceModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-3xl leading-none">&times;</button>
                 </div>
                 <div className="p-6">
                     <form onSubmit={(e) => submitAdvance(e, false)} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div>
                             <label className={labelClass}>Chọn xe / Tài xế</label>
                             <select required disabled={isAdvanceViewMode} className={inputClass} value={advanceForm.vehicleId || ''} onChange={e => setAdvanceForm({...advanceForm, vehicleId: e.target.value})}>
                                 <option value="">-- Chọn xe --</option>
                                 {vehicles.map(v => <option key={v.id} value={v.id}>{v.plateNumber} ({v.driverName})</option>)}
                             </select>
                         </div>
                         <div>
                             <label className={labelClass}>Ngày ghi nhận</label>
                             <input type="date" disabled={isAdvanceViewMode} required className={inputClass} value={advanceForm.date} onChange={e => setAdvanceForm({...advanceForm, date: e.target.value})} />
                         </div>
                         {advanceForm.type === 'REFUND' && (
                            <div className="col-span-1 md:col-span-2 bg-slate-50 p-4 rounded-lg border border-slate-200 grid grid-cols-2 gap-4 relative">
                                <div className="col-span-2 text-sm font-bold text-slate-700 uppercase border-b border-slate-200 pb-2 mb-2 flex items-center gap-2">
                                    <Calculator className="w-4 h-4"/> Tính toán quyết toán
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Tổng tiền đã ứng</label>
                                    <input type="number" disabled className={`${inputClass} bg-white font-bold text-orange-600`} value={advanceForm.totalAdvanceAmount} readOnly />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Chi phí Xăng / Dầu</label>
                                    <input type="number" disabled={isAdvanceViewMode} className={inputClass} value={advanceForm.costFuel} onChange={e => setAdvanceForm({...advanceForm, costFuel: Number(e.target.value)})} placeholder="0" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Chi phí Cầu đường</label>
                                    <input type="number" disabled={isAdvanceViewMode} className={inputClass} value={advanceForm.costToll} onChange={e => setAdvanceForm({...advanceForm, costToll: Number(e.target.value)})} placeholder="0" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Chi phí Khác</label>
                                    <input type="number" disabled={isAdvanceViewMode} className={inputClass} value={advanceForm.costOther} onChange={e => setAdvanceForm({...advanceForm, costOther: Number(e.target.value)})} placeholder="0" />
                                </div>
                                <div className="col-span-2 mt-2 pt-2 border-t border-slate-200 flex justify-between items-center bg-white p-2 rounded border">
                                    <span className="text-sm font-semibold text-slate-600">Tổng chi phí:</span>
                                    <span className="font-bold text-slate-800">
                                        {((Number(advanceForm.costFuel)||0) + (Number(advanceForm.costToll)||0) + (Number(advanceForm.costOther)||0)).toLocaleString()}
                                    </span>
                                </div>
                                {(() => {
                                    const totalAdv = Number(advanceForm.totalAdvanceAmount) || 0;
                                    const expenses = (Number(advanceForm.costFuel) || 0) + (Number(advanceForm.costToll) || 0) + (Number(advanceForm.costOther) || 0);
                                    const balance = totalAdv - expenses;
                                    const isRefund = balance >= 0;
                                    return (
                                        <div className={`col-span-2 mt-2 p-2 rounded text-center text-sm font-bold border ${isRefund ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                            {isRefund ? (
                                                <div className="flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4"/> Dư tiền ứng: {Math.abs(balance).toLocaleString()}</div>
                                            ) : (
                                                <div className="flex items-center justify-center gap-2"><AlertTriangle className="w-4 h-4"/> Thiếu tiền chi: {Math.abs(balance).toLocaleString()}</div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                         )}
                         {/* Settlement Mode Selection (Only for Refund) */}
                         {advanceForm.type === 'REFUND' && (
                            <div className="col-span-1 md:col-span-2 p-3 bg-white border border-slate-200 rounded-lg">
                               <label className="block text-sm font-semibold text-slate-700 mb-2">Hình thức xử lý chênh lệch</label>
                               <div className="flex gap-6">
                                   <label className="flex items-center gap-2 cursor-pointer">
                                       <input 
                                           type="radio" 
                                           disabled={isAdvanceViewMode}
                                           checked={!advanceForm.settlementMode || advanceForm.settlementMode === 'CASH'}
                                           onChange={() => setAdvanceForm({...advanceForm, settlementMode: 'CASH'})}
                                           className="text-brand-600 focus:ring-brand-500"
                                       />
                                       <div className="text-sm">
                                            <div className="font-medium">Tiền mặt</div>
                                            <div className="text-xs text-slate-500">
                                                {(() => {
                                                    const balance = (Number(advanceForm.totalAdvanceAmount) || 0) - ((Number(advanceForm.costFuel)||0)+(Number(advanceForm.costToll)||0)+(Number(advanceForm.costOther)||0));
                                                    return balance >= 0 ? "(Tài xế đã nộp lại tiền thừa)" : "(Công ty đã chi bù tiền thiếu)";
                                                })()}
                                            </div>
                                       </div>
                                   </label>
                                   <label className="flex items-center gap-2 cursor-pointer">
                                       <input 
                                           type="radio" 
                                           disabled={isAdvanceViewMode}
                                           checked={advanceForm.settlementMode === 'SALARY'}
                                           onChange={() => setAdvanceForm({...advanceForm, settlementMode: 'SALARY'})}
                                           className="text-brand-600 focus:ring-brand-500"
                                       />
                                       <div className="text-sm">
                                            <div className="font-medium">Trừ / Cộng lương</div>
                                            <div className="text-xs text-slate-500">
                                                {(() => {
                                                    const balance = (Number(advanceForm.totalAdvanceAmount) || 0) - ((Number(advanceForm.costFuel)||0)+(Number(advanceForm.costToll)||0)+(Number(advanceForm.costOther)||0));
                                                    return balance >= 0 ? "(Trừ tiền thừa vào kỳ lương)" : "(Cộng tiền bù vào kỳ lương)";
                                                })()}
                                            </div>
                                       </div>
                                   </label>
                               </div>
                            </div>
                         )}
                         <div>
                             <label className={labelClass}>
                                 {advanceForm.type === 'REFUND' ? 
                                    ((Number(advanceForm.totalAdvanceAmount) || 0) - ((Number(advanceForm.costFuel)||0)+(Number(advanceForm.costToll)||0)+(Number(advanceForm.costOther)||0)) >= 0 ? 'Số tiền hoàn lại (Dư)' : 'Số tiền bù / Ghi nợ (Âm)') 
                                    : 'Số tiền ứng'}
                             </label>
                             <input type="number" disabled={isAdvanceViewMode || (advanceForm.type === 'REFUND' && !isAdvanceViewMode)} required className={`${inputClass} font-bold`} value={advanceForm.amount} onChange={e => setAdvanceForm({...advanceForm, amount: Number(e.target.value)})} />
                         </div>
                         <div>
                             <label className={labelClass}>Lý do / Ghi chú</label>
                             <input disabled={isAdvanceViewMode} className={inputClass} value={advanceForm.note || ''} onChange={e => setAdvanceForm({...advanceForm, note: e.target.value})} />
                         </div>
                         <div className="col-span-1 md:col-span-2 flex justify-end gap-3 pt-4 border-t border-slate-100">
                             <button type="button" onClick={() => setIsAdvanceModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                                 {isAdvanceViewMode ? 'Đóng' : 'Hủy'}
                             </button>
                             {!isAdvanceViewMode && (
                                <button type="submit" className={`px-4 py-2 text-white rounded-lg font-medium shadow-sm ${advanceForm.type === 'REFUND' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-orange-600 hover:bg-orange-700'}`}>
                                    {editingAdvanceId ? 'Cập nhật' : 'Lưu phiếu'}
                                </button>
                             )}
                         </div>
                     </form>
                 </div>
             </div>
          </div>
      )}

      {/* Cost Modal */}
       {isCostModalOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
                 <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                     <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        {isCostViewMode ? <Eye className="w-5 h-5 text-blue-600"/> : <Plus className="w-5 h-5 text-brand-600"/>}
                        {isCostViewMode ? 'Chi tiết chi phí' : (editingCostId ? 'Cập nhật chi phí' : 'Thêm chi phí vận hành')}
                     </h3>
                     <button onClick={() => setIsCostModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-3xl leading-none">&times;</button>
                 </div>
                 <div className="p-6">
                     <form onSubmit={submitCost} className="space-y-4">
                         <div className="grid grid-cols-2 gap-4">
                             <div className="col-span-2">
                                 <label className={labelClass}>Chọn xe</label>
                                 <select required disabled={isCostViewMode} className={inputClass} value={costForm.vehicleId || ''} onChange={e => setCostForm({...costForm, vehicleId: e.target.value})}>
                                     <option value="">-- Chọn xe --</option>
                                     {vehicles.map(v => <option key={v.id} value={v.id}>{v.plateNumber} ({v.driverName})</option>)}
                                 </select>
                             </div>
                             <div className="col-span-2">
                                 <label className={labelClass}>Loại chi phí</label>
                                 <select disabled={isCostViewMode} className={inputClass} value={costForm.type} onChange={e => setCostForm({...costForm, type: e.target.value as CostType})}>
                                     {Object.values(CostType).map(t => <option key={t} value={t}>{t}</option>)}
                                 </select>
                             </div>
                             <div>
                                 <label className={labelClass}>Số lượng</label>
                                 <input type="number" min="0" step="0.01" disabled={isCostViewMode} required className={inputClass} value={costForm.quantity} onChange={e => setCostForm({...costForm, quantity: Number(e.target.value)})} />
                             </div>
                             <div>
                                 <label className={labelClass}>Đơn giá</label>
                                 <input type="number" min="0" disabled={isCostViewMode} required className={inputClass} value={costForm.unitPrice} onChange={e => setCostForm({...costForm, unitPrice: Number(e.target.value)})} />
                             </div>
                             <div>
                                 <label className={labelClass}>VAT (%)</label>
                                 <input type="number" min="0" max="100" disabled={isCostViewMode} className={inputClass} value={costForm.vat} onChange={e => setCostForm({...costForm, vat: Number(e.target.value)})} />
                             </div>
                             <div>
                                 <label className={labelClass}>Thành tiền</label>
                                 <input type="number" disabled className={`${inputClass} font-bold text-brand-700 bg-slate-50`} value={costForm.amount} readOnly />
                             </div>
                             <div>
                                 <label className={labelClass}>Ngày phát sinh</label>
                                 <input type="date" disabled={isCostViewMode} required className={inputClass} value={costForm.date} onChange={e => setCostForm({...costForm, date: e.target.value})} />
                             </div>
                             <div>
                                 <label className={labelClass}>Ghi chú</label>
                                 <input disabled={isCostViewMode} className={inputClass} value={costForm.note || ''} onChange={e => setCostForm({...costForm, note: e.target.value})} />
                             </div>
                         </div>
                         <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                             <button type="button" onClick={() => setIsCostModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                                 {isCostViewMode ? 'Đóng' : 'Hủy'}
                             </button>
                             {!isCostViewMode && (
                                <button type="submit" className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium">
                                    {editingCostId ? 'Cập nhật' : 'Lưu'}
                                </button>
                             )}
                         </div>
                     </form>
                 </div>
             </div>
          </div>
      )}

    </div>
  );
};

export default Fleet;
