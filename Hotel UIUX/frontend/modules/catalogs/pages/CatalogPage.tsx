import React, { useRef, useState } from 'react';
import {
  Users,
  UserCheck,
  ShoppingBag,
  Truck,
  Building,
  CreditCard,
  Percent,
  FileText,
  Layers,
  Archive,
  Plus,
  X,
  Edit,
  Trash2,
  AlertTriangle,
  Upload,
  Download,
  FileDown,
} from 'lucide-react';
import { useApp } from '../../../app/store';
import { formatCurrency } from '@shared/utils/format';
import {
  exportAssetsExcel,
  exportCustomersExcel,
  exportInventoryExcel,
  exportInventoryItemTemplateExcel,
  exportSuppliersExcel,
  exportWarehousesExcel,
  parseCatalogExcelFile,
  rowToAssetPartial,
  rowToCustomer,
  rowToSupplier,
  rowToWarehouse,
} from '../utils/catalogExcelIO';
import { BomCatalogManager } from '../components/BomCatalogManager';

type CatalogType = 
  | 'ACCOUNTS' 
  | 'CUSTOMERS' 
  | 'SUPPLIERS' 
  | 'ITEMS' 
  | 'BOMS'
  | 'ASSETS' 
  | 'WAREHOUSES' 
  | 'EMPLOYEES' 
  | 'EXPENSES' 
  | 'TAXES' 
  | 'PAYMENT_METHODS';

export const CatalogPage = () => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [deletingItem, setDeletingItem] = useState<any>(null);

  const {
    catalogSection,
    setCatalogSection,
    inventoryCatalog,
    accounts,
    customers,
    suppliers,
    employees,
    assets,
    warehouses,
    expenseCategories,
    taxRates,
    paymentMethods,
    setModals,
    handleAddCatalogItem,
    handleUpdateCatalogItem,
    handleDeleteCatalogItem,
    handleImportInventoryCatalogFromExcel,
    handleDeleteAsset,
    backendAvailable,
    persistStatus,
    retryLoadState,
    hydrated,
  } = useApp();
  const activeCatalog = catalogSection as CatalogType;
  const [retrying, setRetrying] = useState(false);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const excelCatalogTypes: CatalogType[] = ['CUSTOMERS', 'SUPPLIERS', 'WAREHOUSES', 'ITEMS', 'ASSETS'];
  const showExcelTools = excelCatalogTypes.includes(activeCatalog);

  const handleExportExcel = () => {
    switch (activeCatalog) {
      case 'CUSTOMERS':
        void exportCustomersExcel(customers);
        break;
      case 'SUPPLIERS':
        void exportSuppliersExcel(suppliers);
        break;
      case 'WAREHOUSES':
        void exportWarehousesExcel(warehouses);
        break;
      case 'ITEMS':
        void exportInventoryExcel(inventoryCatalog);
        break;
      case 'ASSETS':
        void exportAssetsExcel(assets);
        break;
      default:
        break;
    }
  };

  const handleImportExcel = async (file: File) => {
      const rows = await parseCatalogExcelFile(file);
    let added = 0;
    let updated = 0;
    const errors: string[] = [];
    try {
      switch (activeCatalog) {
        case 'CUSTOMERS': {
          for (let i = 0; i < rows.length; i++) {
            const p = rowToCustomer(rows[i]);
            if (!p.code?.trim() && !p.name?.trim()) continue;
            const byId = p.id ? customers.find((c) => c.id === p.id) : undefined;
            const byCode = customers.find((c) => c.code === p.code);
            try {
              if (byId) {
                handleUpdateCatalogItem('CUSTOMERS', { ...byId, ...p, id: byId.id });
                updated += 1;
              } else if (byCode) {
                handleUpdateCatalogItem('CUSTOMERS', { ...byCode, ...p, id: byCode.id });
                updated += 1;
              } else {
                handleAddCatalogItem('CUSTOMERS', {
                  code: p.code || `KH${Date.now()}`,
                  name: p.name || p.code || 'Khách hàng',
                  taxCode: p.taxCode,
                  address: p.address,
                  phone: p.phone,
                });
                added += 1;
              }
            } catch (e: any) {
              errors.push(`Dòng ${i + 2}: ${e?.message || e}`);
            }
          }
          break;
        }
        case 'SUPPLIERS': {
          for (let i = 0; i < rows.length; i++) {
            const p = rowToSupplier(rows[i]);
            if (!p.code?.trim() && !p.name?.trim()) continue;
            const byId = p.id ? suppliers.find((c) => c.id === p.id) : undefined;
            const byCode = suppliers.find((c) => c.code === p.code);
            try {
              if (byId) {
                handleUpdateCatalogItem('SUPPLIERS', { ...byId, ...p, id: byId.id });
                updated += 1;
              } else if (byCode) {
                handleUpdateCatalogItem('SUPPLIERS', { ...byCode, ...p, id: byCode.id });
                updated += 1;
              } else {
                handleAddCatalogItem('SUPPLIERS', {
                  code: p.code || `NCC${Date.now()}`,
                  name: p.name || p.code || 'Nhà cung cấp',
                  taxCode: p.taxCode,
                  address: p.address,
                  phone: p.phone,
                });
                added += 1;
              }
            } catch (e: any) {
              errors.push(`Dòng ${i + 2}: ${e?.message || e}`);
            }
          }
          break;
        }
        case 'WAREHOUSES': {
          for (let i = 0; i < rows.length; i++) {
            const p = rowToWarehouse(rows[i]);
            if (!p.code?.trim() && !p.name?.trim()) continue;
            const byId = p.id ? warehouses.find((w) => w.id === p.id) : undefined;
            const byCode = warehouses.find((w) => w.code === p.code);
            try {
              if (byId) {
                handleUpdateCatalogItem('WAREHOUSES', { ...byId, ...p, id: byId.id });
                updated += 1;
              } else if (byCode) {
                handleUpdateCatalogItem('WAREHOUSES', { ...byCode, ...p, id: byCode.id });
                updated += 1;
              } else {
                handleAddCatalogItem('WAREHOUSES', {
                  code: p.code || `KHO${Date.now()}`,
                  name: p.name || p.code || 'Kho',
                  address: p.address,
                });
                added += 1;
              }
            } catch (e: any) {
              errors.push(`Dòng ${i + 2}: ${e?.message || e}`);
            }
          }
          break;
        }
        case 'ITEMS': {
          const r = handleImportInventoryCatalogFromExcel(rows);
          added += r.added;
          updated += r.updated;
          errors.push(...r.errors);
          break;
        }
        case 'ASSETS': {
          for (let i = 0; i < rows.length; i++) {
            const p = rowToAssetPartial(rows[i]);
            if (!p.code?.trim() && !p.name?.trim()) continue;
            const byId = p.id ? assets.find((a) => a.id === p.id) : undefined;
            const byCode = p.code ? assets.find((a) => a.code === p.code) : undefined;
            try {
              if (byId) {
                handleUpdateCatalogItem('ASSETS', { ...byId, ...p, id: byId.id });
                updated += 1;
              } else if (byCode) {
                handleUpdateCatalogItem('ASSETS', { ...byCode, ...p, id: byCode.id });
                updated += 1;
              } else {
                handleAddCatalogItem('ASSETS', {
                  ...p,
                  code: p.code || `TS${Date.now()}`,
                  name: p.name || p.code || 'Tài sản',
                });
                added += 1;
              }
            } catch (e: any) {
              errors.push(`Dòng ${i + 2}: ${e?.message || e}`);
            }
          }
          break;
        }
        default:
          break;
      }
    } catch (e: any) {
      window.alert(`Lỗi đọc file: ${e?.message || e}`);
      return;
    }
    const msg = `Import xong: thêm ${added}, cập nhật ${updated}.${errors.length ? `\nLỗi:\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? '\n…' : ''}` : ''}`;
    window.alert(msg);
  };

  const menuItems = [
    { id: 'ACCOUNTS', label: 'Tài khoản kế toán', icon: FileText, sub: 'Theo TT133 / TT200' },
    { id: 'CUSTOMERS', label: 'Khách hàng', icon: Users, sub: 'Người mua hàng' },
    { id: 'SUPPLIERS', label: 'Nhà cung cấp', icon: Truck, sub: 'Đối tác cung ứng' },
    { id: 'ITEMS', label: 'Hàng hóa - Vật tư', icon: ShoppingBag, sub: 'Sản phẩm, Dịch vụ' },
    { id: 'BOMS', label: 'Định mức sản phẩm/dịch vụ (BOM)', icon: Layers, sub: 'Liên kết cấu thành 154' },
    { id: 'ASSETS', label: 'Tài sản', icon: Building, sub: 'TSCĐ, CCDC' },
    { id: 'WAREHOUSES', label: 'Kho bãi', icon: Archive, sub: 'Danh sách kho' },
    { id: 'EMPLOYEES', label: 'Nhân viên', icon: UserCheck, sub: 'Nhân sự' },
    { id: 'EXPENSES', label: 'Khoản mục chi phí', icon: Layers, sub: 'Phân loại chi phí' },
    { id: 'TAXES', label: 'Thuế suất', icon: Percent, sub: 'VAT, TNDN...' },
    { id: 'PAYMENT_METHODS', label: 'Hình thức thanh toán', icon: CreditCard, sub: 'Tiền mặt, CK...' },
  ];

  const handleAddNew = () => {
    if (activeCatalog === 'BOMS') return;
    if (activeCatalog === 'ITEMS') {
      setModals(m => ({ ...m, showAddInventory: true }));
    } else {
      setEditingItem(null);
      setShowAddModal(true);
    }
  };

  const handleEdit = (item: any) => {
    if (activeCatalog === 'ITEMS') {
      setModals(m => ({ ...m, editInventory: item }));
    } else {
      setEditingItem(item);
      setShowAddModal(true);
    }
  };

  const handleDelete = (item: any) => {
    setDeletingItem(item);
  };

  const confirmDelete = () => {
    if (!deletingItem) return;
    if (activeCatalog === 'ASSETS') {
      handleDeleteAsset(deletingItem.id);
    } else {
      handleDeleteCatalogItem(activeCatalog, deletingItem.id);
    }
    setDeletingItem(null);
  };

  const renderContent = () => {
    switch (activeCatalog) {
      case 'ACCOUNTS':
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
                <tr>
                  <th className="p-3">Số hiệu</th>
                  <th className="p-3">Tên tài khoản</th>
                  <th className="p-3">Tính chất</th>
                  <th className="p-3 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((acc, i) => (
                   <tr key={acc.id || i} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-blue-600">{acc.code}</td>
                      <td className="p-3">{acc.name}</td>
                      <td className="p-3">{acc.type}</td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => handleEdit(acc)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Sửa">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(acc)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Xóa">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                   </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'CUSTOMERS':
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
                <tr>
                  <th className="p-3">Mã KH</th>
                  <th className="p-3">Tên khách hàng</th>
                  <th className="p-3">MST</th>
                  <th className="p-3">Địa chỉ</th>
                  <th className="p-3">Điện thoại</th>
                  <th className="p-3 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((c, i) => (
                  <tr key={c.id || i} className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-500">{c.code}</td>
                    <td className="p-3 font-bold text-slate-700">{c.name}</td>
                    <td className="p-3">{c.taxCode || '---'}</td>
                    <td className="p-3">{c.address || '---'}</td>
                    <td className="p-3">{c.phone || '---'}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(c)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Sửa">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(c)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Xóa">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'SUPPLIERS':
        return (
           <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
                <tr>
                  <th className="p-3">Mã NCC</th>
                  <th className="p-3">Tên nhà cung cấp</th>
                  <th className="p-3">MST</th>
                  <th className="p-3">Địa chỉ</th>
                  <th className="p-3">Điện thoại</th>
                  <th className="p-3 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((c, i) => (
                  <tr key={c.id || i} className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-500">{c.code}</td>
                    <td className="p-3 font-bold text-slate-700">{c.name}</td>
                    <td className="p-3">{c.taxCode || '---'}</td>
                    <td className="p-3">{c.address || '---'}</td>
                    <td className="p-3">{c.phone || '---'}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(c)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Sửa">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(c)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Xóa">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'ITEMS':
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
                <tr>
                  <th className="p-3">Mã SKU</th>
                  <th className="p-3">Tên hàng hóa</th>
                  <th className="p-3">ĐVT</th>
                  <th className="p-3">Danh mục</th>
                  <th className="p-3 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventoryCatalog.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-blue-600">{item.sku}</td>
                    <td className="p-3 font-medium">{item.name}</td>
                    <td className="p-3">{item.unit}</td>
                    <td className="p-3"><span className="bg-slate-100 px-2 py-0.5 rounded text-xs">{item.category}</span></td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(item)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Sửa">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(item)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Xóa">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'BOMS':
        return <BomCatalogManager />;
      case 'ASSETS':
        return (
           <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
                <tr>
                  <th className="p-3">Mã</th>
                  <th className="p-3">Tên tài sản</th>
                  <th className="p-3">Loại</th>
                  <th className="p-3">Ngày ghi nhận</th>
                  <th className="p-3 text-right">Nguyên giá</th>
                  <th className="p-3 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assets.map((a, i) => (
                  <tr key={a.id || i} className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-500">{a.code}</td>
                    <td className="p-3 font-bold text-slate-700">{a.name}</td>
                    <td className="p-3"><span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-xs font-bold">{a.type}</span></td>
                    <td className="p-3">{a.buyDate}</td>
                    <td className="p-3 text-right font-medium">{formatCurrency(a.cost)}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(a)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Sửa">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(a)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Xóa">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'WAREHOUSES':
        return (
           <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
                <tr>
                  <th className="p-3">Mã Kho</th>
                  <th className="p-3">Tên Kho</th>
                  <th className="p-3">Địa chỉ</th>
                  <th className="p-3 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {warehouses.map((w, i) => (
                  <tr key={w.id || i} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-blue-600">{w.code}</td>
                    <td className="p-3 font-medium">{w.name}</td>
                    <td className="p-3 text-slate-500">{w.address}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(w)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Sửa">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(w)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Xóa">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'EMPLOYEES':
        return (
           <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
                <tr>
                  <th className="p-3">Mã NV</th>
                  <th className="p-3">Họ và tên</th>
                  <th className="p-3">Chức vụ</th>
                  <th className="p-3">Phòng ban</th>
                  <th className="p-3 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((e, i) => (
                  <tr key={e.id || i} className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-500">{e.code}</td>
                    <td className="p-3 font-bold text-slate-700">{e.name}</td>
                    <td className="p-3">{e.position}</td>
                    <td className="p-3">{e.department}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(e)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Sửa">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(e)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Xóa">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'EXPENSES':
        return (
           <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
                <tr>
                  <th className="p-3">Mã CP</th>
                  <th className="p-3">Tên khoản mục chi phí</th>
                  <th className="p-3 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenseCategories.map((e, i) => (
                  <tr key={e.id || i} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-blue-600">{e.code}</td>
                    <td className="p-3">{e.name}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(e)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Sửa">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(e)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Xóa">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'TAXES':
        return (
           <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
                <tr>
                  <th className="p-3">Mã Thuế</th>
                  <th className="p-3">Tên loại thuế</th>
                  <th className="p-3">Thuế suất (%)</th>
                  <th className="p-3 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {taxRates.map((t, i) => (
                  <tr key={t.id || i} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-blue-600">{t.code}</td>
                    <td className="p-3">{t.name}</td>
                    <td className="p-3 font-bold">{t.rate}%</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(t)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Sửa">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(t)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Xóa">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'PAYMENT_METHODS':
         return (
           <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-xs">
                <tr>
                  <th className="p-3">Mã HT</th>
                  <th className="p-3">Tên hình thức thanh toán</th>
                  <th className="p-3 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paymentMethods.map((p, i) => (
                  <tr key={p.id || i} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-blue-600">{p.code}</td>
                    <td className="p-3">{p.name}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(p)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Sửa">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(p)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Xóa">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
         {hydrated && (!backendAvailable || persistStatus?.lastError) && (
           <div className="px-4 py-3 border-b bg-amber-50 text-amber-800 text-sm font-bold flex flex-wrap items-center gap-2">
             <span className="flex-1">
               Dữ liệu danh mục có thể <span className="underline">chưa được lưu</span> do lỗi đồng bộ với backend.
               {persistStatus?.lastError ? <span className="font-mono text-[11px] block mt-1 opacity-80">Lỗi: {persistStatus.lastError}</span> : null}
             </span>
             {persistStatus?.lastError && (
               <button
                 type="button"
                 onClick={async () => { setRetrying(true); await retryLoadState(); setRetrying(false); }}
                 disabled={retrying}
                 className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold"
               >
                 {retrying ? 'Đang tải…' : 'Thử tải lại'}
               </button>
             )}
           </div>
         )}
         {activeCatalog !== 'BOMS' ? (
         <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
               {menuItems.find(m => m.id === activeCatalog)?.icon && React.createElement(menuItems.find(m => m.id === activeCatalog)!.icon, { className: 'w-5 h-5 text-blue-600' })}
               {menuItems.find(m => m.id === activeCatalog)?.label}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {showExcelTools && (
                <>
                  <button
                    type="button"
                    onClick={handleExportExcel}
                    disabled={!backendAvailable}
                    className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" /> Xuất Excel
                  </button>
                  {activeCatalog === 'ITEMS' && (
                    <button
                      type="button"
                      onClick={() => { void exportInventoryItemTemplateExcel(); }}
                      disabled={!backendAvailable}
                      className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                      title="File mẫu đồng bộ Danh mục và màn Kho"
                    >
                      <FileDown className="w-4 h-4" /> Mẫu Excel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => excelInputRef.current?.click()}
                    disabled={!backendAvailable}
                    className="border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" /> Nhập Excel
                  </button>
                  <input
                    ref={excelInputRef}
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) await handleImportExcel(f);
                    }}
                  />
                </>
              )}
              {activeCatalog !== 'BOMS' && (
                <button
                  onClick={handleAddNew}
                  disabled={!backendAvailable}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1 shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" /> Thêm mới
                </button>
              )}
            </div>
         </div>
         ) : null}
         <div className="min-h-0 flex-1 overflow-y-auto">
            {renderContent()}
         </div>
      </div>

      <CatalogModal 
        isOpen={showAddModal}
        type={activeCatalog}
        item={editingItem}
        onClose={() => { setShowAddModal(false); setEditingItem(null); }}
        onSave={(item) => {
          if (editingItem) {
            handleUpdateCatalogItem(activeCatalog, item);
          } else {
            handleAddCatalogItem(activeCatalog, item);
          }
          setShowAddModal(false);
          setEditingItem(null);
        }}
      />

      {deletingItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-fade-in">
            <div className="bg-red-600 p-4 text-white flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2">
                <Trash2 className="w-5 h-5" /> Xóa mục danh mục?
              </h3>
              <button onClick={() => setDeletingItem(null)} className="hover:bg-red-700 p-1 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 text-center space-y-4">
               <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
               <p className="text-slate-600">Bạn có chắc chắn muốn xóa <b>{deletingItem.name || deletingItem.code}</b>?</p>
               <p className="text-xs text-slate-400">Hành động này không thể hoàn tác.</p>
            </div>
            <div className="p-4 bg-slate-50 border-t flex justify-end gap-2">
               <button onClick={() => setDeletingItem(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded text-sm">Hủy</button>
               <button onClick={confirmDelete} className="px-6 py-2 bg-red-600 text-white rounded font-bold hover:bg-red-700 text-sm">Xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Generic Modal for Adding Catalog Items ---
const CatalogModal = ({ isOpen, type, item, onClose, onSave }: { isOpen: boolean, type: string, item?: any, onClose: () => void, onSave: (data: any) => void }) => {
  const [formData, setFormData] = useState<any>({});

  React.useEffect(() => {
    setFormData(item || {}); 
  }, [isOpen, type, item]);

  if (!isOpen) return null;

  const handleChange = (e: any) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const getTitle = () => {
    const action = item ? 'Sửa' : 'Thêm';
    switch(type) {
      case 'ACCOUNTS': return `${action} Tài khoản kế toán`;
      case 'CUSTOMERS': return `${action} Khách hàng`;
      case 'SUPPLIERS': return `${action} Nhà cung cấp`;
      case 'EMPLOYEES': return `${action} Nhân viên`;
      case 'ASSETS': return `${action} Tài sản`;
      case 'WAREHOUSES': return `${action} Kho bãi`;
      case 'EXPENSES': return `${action} Khoản mục chi phí`;
      case 'TAXES': return `${action} Loại thuế`;
      case 'PAYMENT_METHODS': return `${action} Hình thức thanh toán`;
      default: return `${action} mới`;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-fade-in">
         <div className="bg-blue-600 p-4 text-white flex justify-between items-center">
            <h3 className="font-bold">{getTitle()}</h3>
            <button onClick={onClose}><X className="w-5 h-5" /></button>
         </div>
         <div className="p-6 space-y-4">
            {/* COMMON FIELDS: Code, Name */}
            <div className="grid grid-cols-3 gap-4">
               <div className="col-span-1">
                  <label className="block text-xs font-bold text-slate-500 mb-1">Mã (Code)</label>
                  <input
                    name="code"
                    className="w-full p-2 border rounded text-sm uppercase"
                    value={formData.code || ''}
                    onChange={handleChange}
                    autoFocus={!item}
                    disabled={!!item && type !== 'WAREHOUSES'}
                  />
               </div>
               <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 mb-1">Tên hiển thị</label>
                  <input name="name" className="w-full p-2 border rounded text-sm" value={formData.name || ''} onChange={handleChange} />
               </div>
            </div>
            
            {/* DYNAMIC FIELDS */}
            {type === 'ACCOUNTS' && (
              <div>
                 <label className="block text-xs font-bold text-slate-500 mb-1">Tính chất</label>
                 <select name="type" className="w-full p-2 border rounded text-sm" value={formData.type || 'Dư Nợ'} onChange={handleChange}>
                    <option value="Dư Nợ">Dư Nợ</option>
                    <option value="Dư Có">Dư Có</option>
                    <option value="Lưỡng tính">Lưỡng tính</option>
                 </select>
              </div>
            )}

            {(type === 'CUSTOMERS' || type === 'SUPPLIERS') && (
              <>
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1">Mã số thuế</label>
                       <input name="taxCode" className="w-full p-2 border rounded text-sm" value={formData.taxCode || ''} onChange={handleChange} />
                    </div>
                    <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1">Điện thoại</label>
                       <input name="phone" className="w-full p-2 border rounded text-sm" value={formData.phone || ''} onChange={handleChange} />
                    </div>
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Địa chỉ</label>
                    <input name="address" className="w-full p-2 border rounded text-sm" value={formData.address || ''} onChange={handleChange} />
                 </div>
              </>
            )}

            {type === 'EMPLOYEES' && (
               <div className="grid grid-cols-2 gap-4">
                  <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1">Chức vụ</label>
                     <input name="position" className="w-full p-2 border rounded text-sm" value={formData.position || ''} onChange={handleChange} />
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1">Phòng ban</label>
                     <input name="department" className="w-full p-2 border rounded text-sm" value={formData.department || ''} onChange={handleChange} />
                  </div>
               </div>
            )}

            {type === 'ASSETS' && (
               <>
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1">Loại tài sản</label>
                       <select name="type" className="w-full p-2 border rounded text-sm" value={formData.type || 'TSCĐ'} onChange={handleChange}>
                          <option value="TSCĐ">Tài sản cố định</option>
                          <option value="CCDC">Công cụ dụng cụ</option>
                       </select>
                    </div>
                    <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1">Nguyên giá</label>
                       <input name="cost" type="number" className="w-full p-2 border rounded text-sm" value={formData.cost || ''} onChange={handleChange} />
                    </div>
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Ngày ghi nhận</label>
                    <input name="buyDate" type="date" className="w-full p-2 border rounded text-sm" value={formData.buyDate || ''} onChange={handleChange} />
                 </div>
               </>
            )}

            {type === 'WAREHOUSES' && (
               <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Địa chỉ kho</label>
                  <input name="address" className="w-full p-2 border rounded text-sm" value={formData.address || ''} onChange={handleChange} />
               </div>
            )}
            
            {type === 'TAXES' && (
               <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Thuế suất (%)</label>
                  <input name="rate" type="number" className="w-full p-2 border rounded text-sm" value={formData.rate || ''} onChange={handleChange} />
               </div>
            )}
         </div>
         <div className="p-4 bg-slate-50 border-t flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded text-sm">Hủy</button>
            <button 
               onClick={() => onSave(formData)} 
               className="px-6 py-2 bg-blue-600 text-white rounded font-bold text-sm hover:bg-blue-700"
            >
               Lưu
            </button>
         </div>
      </div>
    </div>
  );
};
