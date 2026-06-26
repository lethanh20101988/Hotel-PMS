
import React, { useState, useMemo, useEffect } from 'react';
import { Order, OrderStatus, OrderType, Distributor, Product, OrderItem, Trip, WarehouseReceipt } from '../types';
import { Search, Plus, Calendar, Package, ShoppingCart, Trash2, User, FileText, Building2, Warehouse, Hash, MapPin, Info, ArrowRight, CheckCircle2, Edit2, AlertTriangle, X, Lock, Truck, Eye, RotateCcw, Printer, FileCheck, Upload, Download } from 'lucide-react';
import { Pagination } from '@shared/components/Pagination';
import { buildOrdersFromCsvFile } from '../ordersCsvImport';

type OrdersPageSize = 10 | 20 | 30 | 50 | 100;
const ORDERS_PAGE_SIZE_OPTIONS: OrdersPageSize[] = [10, 20, 30, 50, 100];

interface Props {
  orders: Order[];
  distributors: Distributor[];
  products: Product[];
  trips: Trip[];
  warehouseReceipts?: WarehouseReceipt[]; // New optional prop
  onAdd: (order: Order) => void;
  onUpdate: (order: Order) => void;
  onDelete: (id: string) => void;
}

const Orders: React.FC<Props> = ({ orders, distributors, products, trips, warehouseReceipts = [], onAdd, onUpdate, onDelete }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false); // State for Import Modal
  const [importFile, setImportFile] = useState<File | null>(null); // State for Selected File
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isViewMode, setIsViewMode] = useState(false); // New state for View Mode
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPageSize, setOrdersPageSize] = useState<OrdersPageSize>(10);

  // Form State
  const [orderId, setOrderId] = useState('');
  const [orderType, setOrderType] = useState<OrderType>(OrderType.DISTRIBUTOR);
  const [selectedDistributorId, setSelectedDistributorId] = useState('');
  const [fromWarehouse, setFromWarehouse] = useState('Kho Tổng Huế');
  const [toWarehouse, setToWarehouse] = useState(''); // Only for Internal
  const [requestDate, setRequestDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(OrderStatus.CREATED);
  const [returnDate, setReturnDate] = useState<string | undefined>(undefined);
  
  const [cartItems, setCartItems] = useState<OrderItem[]>([]);
  
  // Temporary item adding state
  const [currentProductId, setCurrentProductId] = useState('');
  const [currentQuantity, setCurrentQuantity] = useState<number>(1);

  const filteredOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
          o.distributorName.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [orders, searchTerm],
  );

  const ordersTotalPages = Math.max(1, Math.ceil(filteredOrders.length / ordersPageSize));
  const safeOrdersPage = Math.min(ordersPage, ordersTotalPages);

  const paginatedOrders = useMemo(() => {
    const start = (safeOrdersPage - 1) * ordersPageSize;
    return filteredOrders.slice(start, start + ordersPageSize);
  }, [filteredOrders, safeOrdersPage, ordersPageSize]);

  useEffect(() => {
    setOrdersPage(1);
  }, [searchTerm]);

  useEffect(() => {
    if (ordersPage > ordersTotalPages) {
      setOrdersPage(ordersTotalPages);
    }
  }, [ordersPage, ordersTotalPages]);

  const openCreateModal = () => {
    setEditingId(null);
    setIsViewMode(false);
    setOrderId(`DH-${Date.now()}`); // Auto-gen ID
    setOrderType(OrderType.DISTRIBUTOR);
    setSelectedDistributorId('');
    setFromWarehouse('Kho Tổng Huế');
    setToWarehouse('');
    setRequestDate(new Date().toISOString().split('T')[0]);
    setNote('');
    setOrderStatus(OrderStatus.CREATED);
    setReturnDate(undefined);
    setCartItems([]);
    setIsModalOpen(true);
  };

  const openEditModal = (order: Order) => {
    setEditingId(order.id);
    setIsViewMode(false);
    populateForm(order);
    setIsModalOpen(true);
  };

  const openViewModal = (order: Order) => {
    setEditingId(order.id);
    setIsViewMode(true);
    populateForm(order);
    setIsModalOpen(true);
  };

  const populateForm = (order: Order) => {
    setOrderId(order.id);
    setOrderType(order.type);
    setSelectedDistributorId(order.distributorId || '');
    setFromWarehouse(order.fromWarehouse);
    setToWarehouse(order.toWarehouse || '');
    setRequestDate(order.requestDate);
    setNote(order.note);
    setOrderStatus(order.status);
    setReturnDate(order.returnDate);
    setCartItems([...order.items]);
  };

  const handleDeleteRequest = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const confirmDelete = () => {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) {
        alert("Vui lòng chọn file để import");
        return;
    }

    try {
      const imported = await buildOrdersFromCsvFile(importFile, distributors, products);
      if (imported.length === 0) {
        alert('Không đọc được đơn hàng hợp lệ từ file. Kiểm tra định dạng CSV (tải file mẫu để tham khảo cột).');
        return;
      }
      imported.forEach((order) => onAdd(order));
      alert(`Đã xử lý file "${importFile.name}" thành công!\nĐã thêm ${imported.length} đơn hàng.`);
      setIsImportModalOpen(false);
      setImportFile(null);
    } catch {
      alert('Không đọc được file. Vui lòng dùng file CSV theo mẫu.');
    }
  };

  const handleDownloadTemplate = (e: React.MouseEvent) => {
      e.preventDefault();
      const headers = [
          "Ma_Don_Tham_Chieu(Gom_Nhom_SP)",
          "Loai_Don(NPP/NOIBO)",
          "Ma_NPP_Hoac_Kho_Dich",
          "Kho_Xuat_Hang",
          "Ngay_Yeu_Cau(YYYY-MM-DD)",
          "Ma_San_Pham",
          "So_Luong",
          "Ghi_Chu_Don_Hang",
      ];
      const csvContent = "\uFEFF" + headers.join(",") + "\n";
      
      // Create Blob and Download Link
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", "Mau_Import_Don_Hang_Chi_Tiet.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  // --- PRINT FUNCTIONALITY ---
  const handlePrintOrder = (e: React.MouseEvent, order: Order) => {
    e.stopPropagation();

    // 1. Prepare Data
    const distributor = distributors.find(d => d.id === order.distributorId);
    
    // Determine Customer Name/Address
    const customerName = order.type === OrderType.DISTRIBUTOR ? order.distributorName : order.toWarehouse;
    const customerAddress = order.type === OrderType.DISTRIBUTOR ? distributor?.address || '' : (order.toWarehouse || 'Nội bộ');
    const customerPhone = order.type === OrderType.DISTRIBUTOR ? distributor?.phone || '' : '';
    const region = order.type === OrderType.DISTRIBUTOR ? distributor?.region || '' : '';

    // Find Receipt and Return Info
    const receipt = warehouseReceipts.find(r => r.orderId === order.id);
    const hasReturns = order.items.some(i => (i.returnedQuantity || 0) > 0);

    // 2. Open Print Window
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    // 3. Construct HTML
    const htmlContent = `
        <html>
            <head>
                <title>Phiếu Xuất Kho - ${order.id}</title>
                <style>
                    body { font-family: 'Times New Roman', serif; padding: 20px; color: #000; }
                    .header { text-align: center; margin-bottom: 25px; border-bottom: 2px solid #000; padding-bottom: 15px; }
                    .company-name { font-size: 16px; font-weight: bold; text-transform: uppercase; margin-bottom: 5px; }
                    .company-info { font-size: 13px; font-style: italic; }
                    .title { font-size: 24px; font-weight: bold; margin: 15px 0 5px 0; text-transform: uppercase; }
                    .sub-title { font-size: 14px; margin-bottom: 20px; }
                    
                    .info-section { width: 100%; margin-bottom: 20px; font-size: 14px; }
                    .info-section td { padding: 4px 0; vertical-align: top; }
                    .label { font-weight: bold; width: 130px; }
                    
                    .product-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px; }
                    .product-table th, .product-table td { border: 1px solid #000; padding: 8px; }
                    .product-table th { background-color: #f0f0f0; text-align: center; font-weight: bold; }
                    .text-center { text-align: center; }
                    .text-right { text-align: right; }
                    .text-bold { font-weight: bold; }
                    
                    .footer { display: flex; justify-content: space-between; margin-top: 50px; text-align: center; font-size: 14px; }
                    .signature-box { width: 30%; }
                    .signature-place { height: 100px; }

                    .return-section { margin-top: 30px; border-top: 2px dashed #999; padding-top: 20px; }
                    .return-title { font-size: 18px; font-weight: bold; margin-bottom: 15px; text-transform: uppercase; }
                    
                    @media print {
                        @page { margin: 10mm; size: A4; }
                        body { padding: 0; }
                        button { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="company-name">HỆ THỐNG LOGISMART</div>
                    <div class="company-info">Địa chỉ kho xuất: ${order.fromWarehouse}</div>
                    <div class="title">PHIẾU XUẤT KHO</div>
                    <div class="sub-title">Số phiếu: ${order.id} | Ngày yêu cầu: ${new Date(order.requestDate).toLocaleDateString('vi-VN')}</div>
                </div>

                <table class="info-section">
                    <tr>
                        <td class="label">Khách hàng / Kho:</td>
                        <td class="text-bold">${customerName}</td>
                    </tr>
                    <tr>
                        <td class="label">Địa chỉ nhận:</td>
                        <td>${customerAddress}</td>
                    </tr>
                    ${region ? `<tr><td class="label">Tuyến/Khu vực:</td><td>${region}</td></tr>` : ''}
                    ${customerPhone ? `<tr><td class="label">Điện thoại:</td><td>${customerPhone}</td></tr>` : ''}
                    <tr>
                        <td class="label">Loại đơn:</td>
                        <td>${order.type}</td>
                    </tr>
                    <tr>
                        <td class="label">Ghi chú xuất:</td>
                        <td>${order.note || '---'}</td>
                    </tr>
                </table>

                <table class="product-table">
                    <thead>
                        <tr>
                            <th style="width: 50px;">STT</th>
                            <th>Tên sản phẩm</th>
                            <th style="width: 80px;">ĐVT</th>
                            <th style="width: 100px;">Số lượng</th>
                            <th style="width: 150px;">Ghi chú</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${order.items.map((item, index) => {
                            const product = products.find(p => p.id === item.productId);
                            return `
                                <tr>
                                    <td class="text-center">${index + 1}</td>
                                    <td>${item.productName}</td>
                                    <td class="text-center">${product?.unit || '-'}</td>
                                    <td class="text-right text-bold">${item.quantity}</td>
                                    <td></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="3" class="text-right text-bold">TỔNG CỘNG:</td>
                            <td class="text-right text-bold">${order.totalQuantity}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>

                ${(hasReturns || receipt) ? `
                <div class="return-section">
                    <div class="return-title">THÔNG TIN HÀNG HOÀN / NHẬP KHO</div>
                    ${receipt ? `
                        <table class="info-section">
                            <tr><td class="label">Mã phiếu nhập:</td><td><b>${receipt.id}</b></td></tr>
                            <tr><td class="label">Ngày nhập:</td><td>${new Date(receipt.date).toLocaleDateString('vi-VN')}</td></tr>
                            ${receipt.returnWarehouse ? `<tr><td class="label">Kho trả hàng:</td><td>${receipt.returnWarehouse}</td></tr>` : ''}
                            ${receipt.returnWarehouseAddress ? `<tr><td class="label">Địa chỉ kho hoàn:</td><td>${receipt.returnWarehouseAddress}</td></tr>` : ''}
                            ${receipt.receiver ? `<tr><td class="label">Người nhận:</td><td>${receipt.receiver} ${receipt.receiverPhone ? `(${receipt.receiverPhone})` : ''}</td></tr>` : ''}
                            <tr><td class="label">Ghi chú hoàn:</td><td>${receipt.note}</td></tr>
                        </table>
                    ` : ''}

                    ${hasReturns ? `
                        <table class="product-table">
                            <thead>
                                <tr>
                                    <th style="width: 50px;">STT</th>
                                    <th>Sản phẩm hoàn</th>
                                    <th style="width: 100px;">SL Giao</th>
                                    <th style="width: 100px;">SL Hoàn</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${order.items.filter(i => (i.returnedQuantity || 0) > 0).map((item, idx) => `
                                    <tr>
                                        <td class="text-center">${idx + 1}</td>
                                        <td>${item.productName}</td>
                                        <td class="text-center">${item.quantity}</td>
                                        <td class="text-center text-bold" style="color: black;">${item.returnedQuantity}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    ` : ''}
                </div>
                ` : ''}

                <div class="footer">
                    <div class="signature-box">
                        <strong>Người lập phiếu</strong>
                        <div class="signature-place"></div>
                        <div>(Ký, họ tên)</div>
                    </div>
                    <div class="signature-box">
                        <strong>Người giao hàng</strong>
                        <div class="signature-place"></div>
                        <div>(Ký, họ tên)</div>
                    </div>
                    <div class="signature-box">
                        <strong>Người nhận hàng</strong>
                        <div class="signature-place"></div>
                        <div>(Ký, họ tên)</div>
                    </div>
                </div>
                
                <script>
                    window.onload = function() { window.print(); }
                </script>
            </body>
        </html>
    `;

    // 4. Write & Print
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handleAddItem = () => {
    if (!currentProductId || currentQuantity <= 0) return;
    
    const product = products.find(p => p.id === currentProductId);
    if (!product) return;

    const existingItem = cartItems.find(item => item.productId === currentProductId);
    if (existingItem) {
      setCartItems(cartItems.map(item => 
        item.productId === currentProductId 
          ? { ...item, quantity: item.quantity + currentQuantity }
          : item
      ));
    } else {
      setCartItems([...cartItems, {
        productId: product.id,
        productName: product.name,
        quantity: currentQuantity
      }]);
    }
    
    // Reset selection
    setCurrentProductId('');
    setCurrentQuantity(1);
  };

  const handleRemoveItem = (productId: string) => {
    setCartItems(cartItems.filter(item => item.productId !== productId));
  };

  const calculateTotalWeight = () => {
    return cartItems.reduce((total, item) => {
      const product = products.find(p => p.id === item.productId);
      return total + (item.quantity * (product?.weightKg || 0));
    }, 0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewMode) return; // Should not happen but safe guard
    
    // Validation
    if (cartItems.length === 0) return;
    if (orderType === OrderType.DISTRIBUTOR && !selectedDistributorId) return;
    if (orderType === OrderType.INTERNAL && !toWarehouse) return;

    let distName = '';
    if (orderType === OrderType.DISTRIBUTOR) {
        const d = distributors.find(d => d.id === selectedDistributorId);
        distName = d ? d.name : 'Unknown';
    } else {
        distName = toWarehouse; // Use Warehouse name as destination name
    }

    const orderData: Order = {
      id: orderId,
      type: orderType,
      distributorId: orderType === OrderType.DISTRIBUTOR ? selectedDistributorId : undefined,
      distributorName: distName,
      fromWarehouse: fromWarehouse,
      toWarehouse: orderType === OrderType.INTERNAL ? toWarehouse : undefined,
      requestDate: requestDate,
      month: requestDate.substring(0, 7), // YYYY-MM
      items: cartItems,
      totalQuantity: cartItems.reduce((sum, item) => sum + item.quantity, 0),
      totalWeight: calculateTotalWeight(),
      note: note,
      status: orderStatus,
      returnDate: returnDate,
      tripId: editingId ? orders.find(o => o.id === editingId)?.tripId : undefined // Preserve tripId on edit
    };

    if (editingId) {
      onUpdate(orderData);
    } else {
      onAdd(orderData);
    }
    
    setIsModalOpen(false);
  };

  const currentTotalWeight = useMemo(() => calculateTotalWeight(), [cartItems, products]);

  const getStatusBadge = (status: OrderStatus) => {
      switch(status) {
          case OrderStatus.CREATED: return 'bg-slate-100 text-slate-700 border-slate-200';
          case OrderStatus.WAREHOUSE_DISPATCH: return 'bg-orange-100 text-orange-700 border-orange-200';
          case OrderStatus.IN_TRANSIT: return 'bg-blue-100 text-blue-700 border-blue-200';
          case OrderStatus.DELIVERED: return 'bg-green-100 text-green-700 border-green-200';
          case OrderStatus.RECONCILED: return 'bg-purple-100 text-purple-700 border-purple-200';
          case OrderStatus.RETURNED: return 'bg-red-100 text-red-700 border-red-200';
          case OrderStatus.PARTIAL_RETURNED: return 'bg-yellow-100 text-yellow-700 border-yellow-200';
          default: return 'bg-slate-100 text-slate-700';
      }
  };

  // Find receipt for current order
  const currentReceipt = warehouseReceipts.find(r => r.orderId === orderId);

  // Shared Styles
  const inputContainerClass = "relative";
  const iconClass = "absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 z-10";
  const inputClass = "w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-sm transition-all shadow-sm disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed";
  const selectClass = "w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none bg-white text-sm appearance-none transition-all shadow-sm cursor-pointer disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed";

  // Large input style for Product section
  const largeInputClass = "w-full border border-slate-300 rounded-lg py-2.5 px-3 text-base h-11 bg-white focus:ring-2 focus:ring-brand-500 outline-none shadow-sm transition-all";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
           <h2 className="text-2xl font-bold text-slate-800">Quản lý Đơn Hàng</h2>
           <p className="text-slate-500 text-sm">Tạo và theo dõi đơn hàng, đối soát trạng thái.</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Tìm mã đơn, NPP..." 
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 hover:text-brand-600 transition shadow-sm"
          >
            <Upload className="w-4 h-4" /> Import Excel
          </button>
          <button 
            onClick={openCreateModal}
            className="bg-brand-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-brand-700 transition shadow-sm"
          >
            <Plus className="w-4 h-4" /> Tạo đơn hàng
          </button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-200px)] min-h-[360px]">
        <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-sm text-left min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 font-medium border-b border-slate-200 shadow-sm">
                <tr>
                <th className="p-4">Mã ĐH</th>
                <th className="p-4">Nơi nhận / Loại</th>
                <th className="p-4">Vận chuyển</th>
                <th className="p-4">Ngày yêu cầu</th>
                <th className="p-4">Ngày giao (KH)</th>
                <th className="p-4">Chi tiết hàng</th>
                <th className="p-4">Trạng thái</th>
                <th className="p-4 text-center">Thao tác</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {filteredOrders.length === 0 ? (
                    <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400">Không tìm thấy đơn hàng nào</td>
                    </tr>
                ) : (
                    paginatedOrders.map(order => {
                        const isLocked = order.status === OrderStatus.DELIVERED || 
                                         order.status === OrderStatus.RECONCILED ||
                                         order.status === OrderStatus.RETURNED ||
                                         order.status === OrderStatus.PARTIAL_RETURNED;
                        
                        // Find Trip
                        const trip = trips.find(t => t.id === order.tripId);
                        
                        // Check for returned items
                        const returnedItems = order.items.filter(i => (i.returnedQuantity || 0) > 0);
                        const hasReturns = returnedItems.length > 0;

                        return (
                        <tr key={order.id} className="hover:bg-slate-50 transition">
                            <td className="p-4 font-bold text-slate-700">{order.id}</td>
                            <td className="p-4">
                                <div className="font-medium text-slate-800 flex flex-col">
                                <span>{order.distributorName}</span>
                                <span className="text-[10px] text-slate-400 uppercase font-semibold">{order.type}</span>
                                </div>
                                {order.note && <div className="text-xs text-orange-600 mt-1 italic flex items-center gap-1"><FileText className="w-3 h-3"/> {order.note}</div>}
                            </td>
                            <td className="p-4">
                                {trip ? (
                                    <div className="flex flex-col">
                                        <div className="font-bold text-slate-700 flex items-center gap-1">
                                            <Truck className="w-3.5 h-3.5 text-brand-600" />
                                            {trip.vehiclePlate}
                                        </div>
                                        <div className="text-xs text-slate-500 flex items-center gap-1">
                                            <User className="w-3 h-3" />
                                            {trip.driverName}
                                        </div>
                                    </div>
                                ) : (
                                    <span className="text-slate-400 text-xs italic bg-slate-100 px-2 py-0.5 rounded">Chưa gán xe</span>
                                )}
                            </td>
                            <td className="p-4 text-slate-600">{order.requestDate}</td>
                            <td className="p-4 text-slate-600 font-medium">
                                {trip ? (
                                    <span className="text-brand-600">{trip.date}</span>
                                ) : (
                                    <span className="text-slate-300">-</span>
                                )}
                            </td>
                            <td className="p-4">
                                <div className="text-slate-600">{order.items.length} loại sản phẩm</div>
                                <div className="text-xs text-slate-400">
                                    {order.totalQuantity} SP | <b>{order.totalWeight.toLocaleString()} kg</b>
                                </div>
                                {/* explicit visual for returns */}
                                {hasReturns && (
                                    <div className="mt-1 text-xs text-red-600 font-bold bg-red-50 p-1 rounded border border-red-100">
                                        {returnedItems.map(i => (
                                            <div key={i.productId}>Hoàn: {i.productName} ({i.returnedQuantity})</div>
                                        ))}
                                    </div>
                                )}
                            </td>
                            <td className="p-4">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${getStatusBadge(order.status)}`}>
                                {order.status}
                            </span>
                            {/* Display return date if available */}
                            {order.returnDate && (order.status === OrderStatus.RETURNED || order.status === OrderStatus.PARTIAL_RETURNED) && (
                                <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                                    <RotateCcw className="w-3 h-3"/> {order.returnDate}
                                </div>
                            )}
                            </td>
                            <td className="p-4 text-center">
                                <div className="flex items-center justify-center gap-2 relative z-10">
                                <button 
                                    type="button"
                                    onClick={(e) => handlePrintOrder(e, order)}
                                    className="p-2 border rounded transition shadow-sm flex items-center justify-center bg-white border-slate-200 hover:bg-slate-50 hover:text-slate-700 hover:border-slate-300 cursor-pointer"
                                    title="In phiếu xuất kho"
                                >
                                    <Printer className="w-4 h-4 pointer-events-none" />
                                </button>
                                <button 
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openViewModal(order);
                                    }}
                                    className="p-2 border rounded transition shadow-sm flex items-center justify-center bg-white border-slate-200 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-200 cursor-pointer"
                                    title="Xem chi tiết"
                                >
                                    <Eye className="w-4 h-4 pointer-events-none" />
                                </button>
                                <button 
                                    type="button"
                                    onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isLocked) openEditModal(order);
                                    }}
                                    disabled={isLocked}
                                    className={`p-2 border rounded transition shadow-sm flex items-center justify-center ${
                                        isLocked 
                                            ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed' 
                                            : 'bg-white border-slate-200 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-200 cursor-pointer'
                                    }`}
                                    title={isLocked ? "Đơn hàng đã xử lý (Giao/Hoàn), không thể chỉnh sửa" : "Sửa đơn hàng"}
                                >
                                    {isLocked ? <Lock className="w-4 h-4 pointer-events-none" /> : <Edit2 className="w-4 h-4 pointer-events-none" />}
                                </button>
                                <button 
                                    type="button"
                                    onClick={(e) => !isLocked && handleDeleteRequest(e, order.id)}
                                    disabled={isLocked}
                                    className={`p-2 border rounded transition shadow-sm flex items-center justify-center ${
                                        isLocked 
                                        ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed' 
                                        : 'bg-white border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 cursor-pointer'
                                    }`}
                                    title={isLocked ? "Đơn hàng đã xử lý (Giao/Hoàn), không thể xóa" : "Xóa đơn hàng"}
                                >
                                    <Trash2 className="w-4 h-4 pointer-events-none" />
                                </button>
                                </div>
                            </td>
                        </tr>
                        );
                    })
                )}
            </tbody>
            </table>
        </div>
        <Pagination
          page={safeOrdersPage}
          totalItems={filteredOrders.length}
          pageSize={ordersPageSize}
          onChangePage={setOrdersPage}
          onChangePageSize={(size) => {
            setOrdersPageSize(size as OrdersPageSize);
            setOrdersPage(1);
          }}
          pageSizeOptions={ORDERS_PAGE_SIZE_OPTIONS}
          className="flex-shrink-0 border-t border-slate-200"
        />
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 transform transition-all scale-100">
                <div className="flex items-center gap-3 text-red-600 mb-4">
                    <div className="bg-red-100 p-3 rounded-full">
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-bold">Xóa đơn hàng?</h3>
                </div>
                <p className="text-slate-600 mb-6 leading-relaxed">
                    Bạn có chắc chắn muốn xóa đơn hàng <span className="font-bold text-slate-800 bg-slate-100 px-1 rounded">{deleteConfirmId}</span> không? 
                    <br/><span className="text-sm text-red-500 italic">Hành động này không thể hoàn tác.</span>
                </p>
                <div className="flex justify-end gap-3">
                    <button 
                        onClick={() => setDeleteConfirmId(null)}
                        className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition"
                    >
                        Hủy bỏ
                    </button>
                    <button 
                        onClick={confirmDelete}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium shadow-md transition flex items-center gap-2"
                    >
                        <Trash2 className="w-4 h-4" /> Xóa ngay
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in">
             <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                   <Upload className="w-5 h-5 text-brand-600" /> Import Đơn hàng từ Excel
                </h3>
                <button onClick={() => { setIsImportModalOpen(false); setImportFile(null); }} className="text-slate-400 hover:text-slate-600 text-3xl leading-none">&times;</button>
             </div>
             <div className="p-6">
                <form onSubmit={handleImportSubmit} className="space-y-6">
                   <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center bg-slate-50 hover:bg-slate-100 transition cursor-pointer relative h-48 flex items-center justify-center">
                      <input 
                        type="file" 
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" 
                        accept=".xlsx, .xls, .csv" 
                        onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                                setImportFile(e.target.files[0]);
                            }
                        }}
                      />
                      {importFile ? (
                          <div className="flex flex-col items-center justify-center gap-2 text-brand-600 relative z-0">
                              <FileCheck className="w-10 h-10" />
                              <p className="font-bold text-lg">{importFile.name}</p>
                              <p className="text-xs text-slate-500">(Click hoặc kéo thả để đổi file khác)</p>
                          </div>
                      ) : (
                          <div className="flex flex-col items-center justify-center gap-2 text-slate-500 relative z-0">
                              <Upload className="w-10 h-10 text-slate-400" />
                              <p className="font-medium">Kéo thả file vào đây hoặc click để chọn</p>
                              <p className="text-xs text-slate-400">Hỗ trợ định dạng: .xlsx, .xls, .csv</p>
                          </div>
                      )}
                   </div>

                   <div className="flex flex-col text-sm bg-blue-50 p-3 rounded-lg text-blue-800 border border-blue-100 gap-2">
                      <div className="flex items-center gap-2">
                         <Info className="w-4 h-4 flex-shrink-0" />
                         <span>Vui lòng sử dụng file mẫu chuẩn. File mẫu hỗ trợ <b>nhập nhiều sản phẩm</b> cho 1 đơn hàng (bằng cách lặp lại mã tham chiếu).</span>
                      </div>
                      <div className="flex justify-end">
                         <button 
                            type="button"
                            onClick={handleDownloadTemplate} 
                            className="flex items-center gap-1 font-bold hover:underline cursor-pointer bg-transparent border-0 text-blue-800 p-0"
                         >
                            <Download className="w-4 h-4" /> Tải file mẫu chi tiết
                         </button>
                      </div>
                   </div>

                   <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                       <button type="button" onClick={() => { setIsImportModalOpen(false); setImportFile(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Hủy</button>
                       <button type="submit" disabled={!importFile} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                           <Upload className="w-4 h-4" /> Tiến hành Import
                       </button>
                   </div>
                </form>
             </div>
          </div>
        </div>
      )}

      {/* Create/Edit/View Order Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden animate-fade-in flex flex-col max-h-[95vh]">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center flex-shrink-0">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                {isViewMode ? (
                    <Eye className="w-5 h-5 text-sky-600" /> 
                ) : (
                    <ShoppingCart className="w-5 h-5 text-brand-600" />
                )}
                {isViewMode ? 'Chi tiết đơn hàng' : (editingId ? 'Cập nhật đơn hàng' : 'Tạo đơn hàng mới')}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-3xl leading-none">&times;</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                <form id="create-order-form" onSubmit={handleSubmit} className="space-y-6">
                    
                    {/* SECTION: WAREHOUSE RECEIPT & STATUS COMPLETION (IF RETURNED) */}
                    {isViewMode && currentReceipt && (
                        <div className="bg-green-50 p-5 rounded-xl border border-green-200 shadow-sm animate-fade-in">
                             <div className="flex items-start gap-4">
                                <div className="p-3 bg-green-100 rounded-full text-green-700">
                                    <FileCheck className="w-6 h-6" />
                                </div>
                                <div className="flex-1">
                                    <h4 className="text-lg font-bold text-green-800 uppercase flex items-center gap-2 mb-1">
                                        QUY TRÌNH HOÀN TẤT
                                    </h4>
                                    <p className="text-green-700 text-sm mb-3">
                                        Đơn hàng đã được xử lý hoàn trả và nhập kho thành công.
                                    </p>
                                    
                                    <div className="bg-white p-3 rounded-lg border border-green-100 text-sm space-y-2">
                                        <div className="flex justify-between border-b border-green-50 pb-2">
                                            <span className="text-slate-500">Mã phiếu nhập kho:</span>
                                            <span className="font-bold text-slate-800">{currentReceipt.id}</span>
                                        </div>
                                        <div className="flex justify-between border-b border-green-50 pb-2">
                                            <span className="text-slate-500">Ngày nhập:</span>
                                            <span className="font-medium text-slate-800">{currentReceipt.date}</span>
                                        </div>
                                        {currentReceipt.receiver && (
                                            <div className="flex justify-between border-b border-green-50 pb-2">
                                                <span className="text-slate-500">Người nhận:</span>
                                                <span className="font-medium text-slate-800">
                                                    {currentReceipt.receiver} 
                                                    {currentReceipt.receiverPhone && ` - ${currentReceipt.receiverPhone}`}
                                                </span>
                                            </div>
                                        )}
                                        {currentReceipt.returnWarehouse && (
                                            <div className="flex justify-between border-b border-green-50 pb-2">
                                                <span className="text-slate-500">Kho trả hàng:</span>
                                                <span className="font-medium text-slate-800">
                                                    {currentReceipt.returnWarehouse}
                                                </span>
                                            </div>
                                        )}
                                        {currentReceipt.returnWarehouseAddress && (
                                            <div className="flex justify-between border-b border-green-50 pb-2">
                                                <span className="text-slate-500">Địa chỉ kho:</span>
                                                <span className="font-medium text-slate-800">
                                                    {currentReceipt.returnWarehouseAddress}
                                                </span>
                                            </div>
                                        )}
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Ghi chú:</span>
                                            <span className="text-slate-800 italic">{currentReceipt.note}</span>
                                        </div>
                                    </div>
                                </div>
                             </div>
                        </div>
                    )}

                    {/* SECTION 1: GENERAL INFO */}
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-slate-100">
                            <Info className="w-4 h-4 text-brand-500" /> Thông tin cơ bản
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            {/* Field 1: Order ID */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Mã đơn giao</label>
                                <div className={inputContainerClass}>
                                    <Hash className={iconClass} />
                                    <input 
                                        type="text"
                                        required
                                        disabled={!!editingId || isViewMode} // Disable if editing or viewing
                                        className={`${inputClass} ${editingId ? 'bg-slate-100 text-slate-500' : ''}`}
                                        value={orderId}
                                        onChange={e => setOrderId(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Field 2: Date */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Ngày yêu cầu <span className="text-red-500">*</span></label>
                                <div className={inputContainerClass}>
                                    <Calendar className={iconClass} />
                                    <input 
                                        type="date"
                                        required
                                        disabled={isViewMode}
                                        className={inputClass}
                                        value={requestDate}
                                        onChange={e => setRequestDate(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Field 3: Type */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Loại đơn hàng</label>
                                <div className={inputContainerClass}>
                                    <Info className={iconClass} />
                                    <select 
                                        className={selectClass}
                                        value={orderType}
                                        disabled={isViewMode}
                                        onChange={e => {
                                            setOrderType(e.target.value as OrderType);
                                            if(e.target.value === OrderType.INTERNAL) setSelectedDistributorId('');
                                            else setToWarehouse('');
                                        }}
                                    >
                                        <option value={OrderType.DISTRIBUTOR}>Giao NPP (Nhà phân phối)</option>
                                        <option value={OrderType.INTERNAL}>Giao nội bộ</option>
                                    </select>
                                </div>
                            </div>

                            {/* Field 4: Status */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Trạng thái</label>
                                <div className={inputContainerClass}>
                                    <CheckCircle2 className={iconClass} />
                                    <select 
                                        className={selectClass}
                                        value={orderStatus}
                                        disabled={isViewMode}
                                        onChange={e => setOrderStatus(e.target.value as OrderStatus)}
                                    >
                                        {Object.values(OrderStatus).map(s => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* SECTION 2: LOGISTICS */}
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-slate-100">
                            <MapPin className="w-4 h-4 text-brand-500" /> Lộ trình vận chuyển
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
                            {/* Source */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Kho xuất (Nguồn)</label>
                                <div className={inputContainerClass}>
                                    <Warehouse className={iconClass} />
                                    <input 
                                        type="text"
                                        disabled={isViewMode}
                                        className={inputClass}
                                        value={fromWarehouse}
                                        onChange={e => setFromWarehouse(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Destination */}
                            <div>
                                {orderType === OrderType.DISTRIBUTOR ? (
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nhà Phân Phối (Đích) <span className="text-red-500">*</span></label>
                                        <div className={inputContainerClass}>
                                            <User className={iconClass} />
                                            <select 
                                                required={orderType === OrderType.DISTRIBUTOR}
                                                disabled={isViewMode}
                                                className={selectClass}
                                                value={selectedDistributorId}
                                                onChange={e => setSelectedDistributorId(e.target.value)}
                                            >
                                                <option value="">-- Chọn Nhà Phân Phối --</option>
                                                {distributors.map(d => (
                                                    <option key={d.id} value={d.id}>{d.name} - {d.region}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Kho nhập (Đích) <span className="text-red-500">*</span></label>
                                        <div className={inputContainerClass}>
                                            <Building2 className={iconClass} />
                                            <input 
                                                type="text"
                                                disabled={isViewMode}
                                                required={orderType === OrderType.INTERNAL}
                                                placeholder="Nhập tên kho nhập..."
                                                className={inputClass}
                                                value={toWarehouse}
                                                onChange={e => setToWarehouse(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* SECTION 3: PRODUCTS */}
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-slate-100">
                             <Package className="w-4 h-4 text-brand-500" /> Chi tiết hàng hóa
                        </h4>
                        
                        {/* New Grid Layout for Product Entry - Hidden in View Mode */}
                        {!isViewMode && (
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-4">
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                                {/* Product Selector */}
                                <div className="md:col-span-5">
                                    <label className="text-xs font-bold text-slate-500 mb-1.5 block uppercase">Sản phẩm</label>
                                    <div className="relative">
                                        <select 
                                            className={largeInputClass}
                                            value={currentProductId}
                                            onChange={e => setCurrentProductId(e.target.value)}
                                        >
                                            <option value="">-- Chọn sản phẩm --</option>
                                            {products.map(p => (
                                                <option key={p.id} value={p.id}>{p.name} ({p.weightKg}kg/{p.unit})</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                
                                {/* Quantity Input */}
                                <div className="md:col-span-5">
                                    <label className="text-xs font-bold text-slate-500 mb-1.5 block uppercase">Số lượng</label>
                                    <input 
                                        type="number" 
                                        min="1"
                                        className={largeInputClass}
                                        value={currentQuantity}
                                        onChange={e => setCurrentQuantity(parseInt(e.target.value) || 0)}
                                    />
                                </div>

                                {/* Add Button */}
                                <div className="md:col-span-2">
                                    <button 
                                        type="button"
                                        onClick={handleAddItem}
                                        disabled={!currentProductId}
                                        className="w-full bg-brand-600 text-white h-11 rounded-lg text-base hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm font-medium transition"
                                    >
                                        <Plus className="w-5 h-5" /> Thêm
                                    </button>
                                </div>
                            </div>
                        </div>
                        )}

                        {/* Cart Items List */}
                        {cartItems.length > 0 ? (
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-slate-600 font-semibold">
                                        <tr>
                                            <th className="p-3 text-left">Sản phẩm</th>
                                            <th className="p-3 text-right">Số lượng</th>
                                            <th className="p-3 text-right">Trọng lượng (Kg)</th>
                                            {!isViewMode && <th className="p-3 text-center">Xóa</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {cartItems.map((item, idx) => {
                                            const product = products.find(p => p.id === item.productId);
                                            const weight = (product?.weightKg || 0) * item.quantity;
                                            return (
                                                <tr key={idx} className="hover:bg-slate-50">
                                                    <td className="p-3">{item.productName}</td>
                                                    <td className="p-3 text-right font-medium">{item.quantity}</td>
                                                    <td className="p-3 text-right text-slate-600">{weight.toLocaleString()}</td>
                                                    {!isViewMode && (
                                                    <td className="p-3 text-center">
                                                        <button 
                                                            type="button"
                                                            onClick={() => handleRemoveItem(item.productId)}
                                                            className="text-slate-400 hover:text-red-500 transition"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                    )}
                                                </tr>
                                            );
                                        })}
                                        <tr className="bg-slate-50 font-bold text-slate-800">
                                            <td className="p-3 text-right" colSpan={2}>Tổng cộng:</td>
                                            <td className="p-3 text-right text-brand-600">{currentTotalWeight.toLocaleString()} kg</td>
                                            {!isViewMode && <td></td>}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-center p-8 border border-dashed border-slate-300 rounded-lg bg-slate-50">
                                <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                <p className="text-slate-500 italic">Chưa có sản phẩm nào được chọn</p>
                            </div>
                        )}
                    </div>
                    
                    {/* RETURN DETAILS SECTION (Only if has returns) */}
                    {(orderStatus === OrderStatus.RETURNED || orderStatus === OrderStatus.PARTIAL_RETURNED) && (
                        <div className="bg-orange-50 p-5 rounded-xl border border-orange-200 shadow-sm">
                             <h4 className="text-sm font-bold text-orange-700 uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-orange-200">
                                <RotateCcw className="w-4 h-4" /> Biên bản hoàn hàng / Sự cố
                             </h4>
                             <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="flex flex-col">
                                        <span className="text-slate-500">Ngày hoàn hàng</span>
                                        <span className="font-bold text-slate-800">{returnDate || '---'}</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-slate-500">Trạng thái</span>
                                        <span className="font-bold text-orange-600">
                                            {orderStatus === OrderStatus.RETURNED ? 'Hoàn toàn bộ' : 'Hoàn 1 phần'}
                                        </span>
                                    </div>
                                </div>
                                <div className="bg-white rounded border border-orange-100 p-3">
                                    <p className="text-xs font-bold text-slate-500 mb-2 uppercase">Danh sách sản phẩm hoàn</p>
                                    <div className="space-y-1">
                                        {cartItems.filter(i => (i.returnedQuantity || 0) > 0).map((item, idx) => (
                                            <div key={idx} className="flex justify-between text-sm">
                                                <span>{item.productName}</span>
                                                <span className="font-bold text-red-600">{item.returnedQuantity} / {item.quantity}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                             </div>
                        </div>
                    )}

                    {/* Note */}
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                         <label className="block text-sm font-semibold text-slate-700 mb-2">Ghi chú vận hành</label>
                         <textarea 
                            rows={3}
                            disabled={isViewMode}
                            className={`w-full border border-slate-300 p-3 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none text-sm shadow-sm transition ${isViewMode ? 'bg-slate-50' : ''}`}
                            placeholder="VD: Giao buổi sáng, đường hẹp, cần xe cẩu..."
                            value={note}
                            onChange={e => setNote(e.target.value)}
                         ></textarea>
                    </div>
                </form>
            </div>

            <div className="p-6 border-t border-slate-200 bg-white flex justify-end gap-3 flex-shrink-0 z-20">
                {isViewMode && editingId && (
                     <button 
                        type="button"
                        onClick={(e) => {
                            const order = orders.find(o => o.id === editingId);
                            if (order) handlePrintOrder(e, order);
                        }}
                        className="px-6 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition shadow-sm flex items-center gap-2"
                    >
                        <Printer className="w-5 h-5" /> In phiếu
                    </button>
                )}

                <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-6 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition"
                >
                    {isViewMode ? 'Đóng' : 'Hủy bỏ'}
                </button>
                {!isViewMode && (
                <button 
                    type="submit"
                    form="create-order-form"
                    className="px-6 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium transition shadow-md hover:shadow-lg flex items-center gap-2"
                >
                    <CheckCircle2 className="w-5 h-5" /> 
                    {editingId ? 'Cập nhật' : 'Lưu đơn hàng'}
                </button>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Orders;
