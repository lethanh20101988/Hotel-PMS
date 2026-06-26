
import React, { useEffect } from 'react';
import { useApp } from './store';
import { REGULATION_REGISTRY } from '../shared/regulations/registry';
import { TabKeepAlive } from '@shared/components/TabKeepAlive';
import {
  AssetPage,
  CatalogPage,
  CITPage,
  DashboardPage,
  DeviceList,
  DeliveryPage,
  DocumentPage,
  FundPage,
  HotelPmsPage,
  InvoicePage,
  prefetchAllRoutes,
  SettingsPage,
  SummaryAccounting,
  SystemPage,
  WarehousePage,
  LifecyclePage,
} from './routeModules';

const HOTEL_PMS_TAB_MAP = {
  hotel_pms_frontdesk: 'frontdesk',
  hotel_pms_housekeeping: 'housekeeping',
  hotel_pms_rates: 'rates',
  hotel_pms_services: 'services',
} as const;

const DELIVERY_TAB_MAP = {
  delivery_dashboard: 'DASHBOARD',
  delivery_distributors: 'DISTRIBUTORS',
  delivery_products: 'PRODUCTS',
  delivery_orders: 'ORDERS',
  delivery_dispatch: 'DISPATCH',
  delivery_fleet: 'FLEET',
} as const;

// Modals
import { DeviceRenew } from '../modules/device/components/DeviceRenew';
import { DeviceForm } from '../modules/device/components/DeviceForm';
import { DeviceDetail } from '../modules/device/components/DeviceDetail';
import { DeviceRenewalHistoryModal } from '../modules/device/components/DeviceRenewalHistoryModal';
import { DeleteDeviceModal } from '../modules/device/components/DeleteDeviceModal';
import { StockActionModal } from '../modules/warehouse/components/StockActionModal';
import { AddInventoryItemModal, EditInventoryItemModal, ViewInventoryItemModal, DeleteInventoryItemModal, ViewTransactionModal, DeleteTransactionModal } from '../modules/warehouse/components/InventoryModals';
import { FundTransactionModal } from '../modules/fund/components/FundTransactionModal';
import { FundDetailModal } from '../modules/fund/components/FundDetailModal';
import { DeleteFundModal } from '../modules/fund/components/DeleteFundModal';

export const AppRoutes = () => {
  const { 
    activeTab, 
    devices, invoices, warehouseInventoryItems, transactions, 
    modals, setModals, 
    handleAddDevice, handleUpdateDevice, handleDeleteDevice, handleRenewConfirm,
    handleInventoryActions, handleCreateInvoice, handleUpdateInvoice, handleDeleteInvoice,
    handleFundAction, handleDeleteFundTransaction,
    handleDeleteInventoryTransaction,
    handleDeleteInventoryItemAdvanced,
    systemConfig,
    hotelPmsResetNonce,
  } = useApp();

  useEffect(() => {
    prefetchAllRoutes();
  }, []);

  const isDocumentRoute = activeTab.startsWith('doc_');
  const hotelPmsTab = HOTEL_PMS_TAB_MAP[activeTab as keyof typeof HOTEL_PMS_TAB_MAP];
  const deliveryModuleTab = DELIVERY_TAB_MAP[activeTab as keyof typeof DELIVERY_TAB_MAP];
  const isSystemRoute = activeTab.startsWith('sys_');
  const accountingStandard = systemConfig.accountingRegime?.standard === 'TT58_2026' ? 'TT58_2026' : 'TT133';
  const ReportPage = REGULATION_REGISTRY[accountingStandard].ReportPage;

  return (
    <>
      <TabKeepAlive active={activeTab === 'dashboard'}>
        <DashboardPage />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'devices'}>
        <DeviceList
          devices={devices}
          onAdd={() => setModals(m => ({ ...m, showAddDevice: true }))}
          onRenew={(d) => setModals(m => ({ ...m, renewDevice: d }))}
          onHistory={(d) => setModals(m => ({ ...m, viewDeviceRenewalHistory: d }))}
          onView={(d) => setModals(m => ({ ...m, viewDevice: d }))}
          onEdit={(d) => setModals(m => ({ ...m, editDevice: d }))}
          onDelete={(d) => setModals(m => ({ ...m, deleteDevice: d }))}
        />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'inventory'}>
        <WarehousePage
          items={warehouseInventoryItems}
          transactions={transactions}
          onStockAction={(item, type) => setModals(m => ({ ...m, stockActionItem: item, stockActionType: type, showStockAction: true }))}
          onAddItem={() => setModals(m => ({ ...m, showAddInventory: true }))}
          onEditItem={(i) => setModals(m => ({ ...m, editInventory: i }))}
          onDeleteItem={(i) => setModals(m => ({ ...m, deleteInventory: i }))}
          onViewItem={(i) => setModals(m => ({ ...m, viewInventory: i }))}
        />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'invoices'}>
        <InvoicePage
          invoices={invoices}
          onCreate={handleCreateInvoice}
          onUpdate={handleUpdateInvoice}
          onDelete={handleDeleteInvoice}
        />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'fund'}>
        <FundPage />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'cit'}>
        <CITPage />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'assets'}>
        <AssetPage />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'catalogs'}>
        <CatalogPage />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'accounting'}>
        <SummaryAccounting />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'business_result'} key={`report-${accountingStandard}`}>
        <ReportPage />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'settings'}>
        <SettingsPage />
      </TabKeepAlive>

      <TabKeepAlive active={isDocumentRoute}>
        <DocumentPage />
      </TabKeepAlive>

      <TabKeepAlive active={!!deliveryModuleTab}>
        <DeliveryPage
          initialModule={deliveryModuleTab ?? 'DASHBOARD'}
          embedded
          visible={!!deliveryModuleTab}
        />
      </TabKeepAlive>

      <TabKeepAlive active={!!hotelPmsTab}>
        <HotelPmsPage
          key={`hotel-pms-${hotelPmsResetNonce}`}
          initialTab={hotelPmsTab ?? 'frontdesk'}
          embedded
          visible={!!hotelPmsTab}
        />
      </TabKeepAlive>

      <TabKeepAlive active={isSystemRoute}>
        <SystemPage />
      </TabKeepAlive>

      <TabKeepAlive active={activeTab === 'lifecycle'}>
        <LifecyclePage />
      </TabKeepAlive>

      {/* --- Modals --- */}
      <DeviceRenew 
        device={modals.renewDevice} 
        onClose={() => setModals(m => ({ ...m, renewDevice: null }))}
        onConfirm={(fee, vat, expiry, duration, payment, status, costInfo, salesInfo) => {
           handleRenewConfirm(fee, vat, expiry, duration, payment, status, costInfo, salesInfo);
           setModals(m => ({ ...m, renewDevice: null }));
        }}
      />
      <DeviceForm
        isOpen={modals.showAddDevice || !!modals.editDevice}
        device={modals.editDevice || undefined}
        onClose={() => setModals(m => ({ ...m, showAddDevice: false, editDevice: null }))}
        onSave={(data) => {
            if (modals.editDevice) {
                handleUpdateDevice(data);
            } else {
                handleAddDevice(data);
            }
            setModals(m => ({ ...m, showAddDevice: false, editDevice: null }));
        }}
      />
      <DeviceDetail 
        device={modals.viewDevice}
        onClose={() => setModals(m => ({ ...m, viewDevice: null }))}
      />
      <DeviceRenewalHistoryModal
        device={modals.viewDeviceRenewalHistory}
        onClose={() => setModals(m => ({ ...m, viewDeviceRenewalHistory: null }))}
      />
      <DeleteDeviceModal 
        device={modals.deleteDevice}
        onClose={() => setModals(m => ({ ...m, deleteDevice: null }))}
        onConfirm={(id) => {
           handleDeleteDevice(id);
           setModals(m => ({ ...m, deleteDevice: null }));
        }}
      />
      <StockActionModal 
        isOpen={modals.showStockAction}
        type={modals.stockActionType}
        item={modals.stockActionItem}
        items={warehouseInventoryItems}
        onClose={() => setModals(m => ({ ...m, showStockAction: false }))}
        onConfirm={(payload) => {
           const success = handleInventoryActions.stockBatch(payload as any);
           if (success) {
             setModals(m => ({ ...m, showStockAction: false }));
           }
        }}
      />
      <AddInventoryItemModal 
        isOpen={modals.showAddInventory}
        onClose={() => setModals(m => ({ ...m, showAddInventory: false }))}
        onSave={(item: any) => {
           handleInventoryActions.add(item);
           setModals(m => ({ ...m, showAddInventory: false }));
        }}
      />
      <EditInventoryItemModal 
        item={modals.editInventory}
        onClose={() => setModals(m => ({ ...m, editInventory: null }))}
        onSave={(item: any) => {
           handleInventoryActions.update(item);
           setModals(m => ({ ...m, editInventory: null }));
        }}
      />
      <ViewInventoryItemModal 
        item={modals.viewInventory}
        onClose={() => setModals(m => ({ ...m, viewInventory: null }))}
      />
      <DeleteInventoryItemModal 
        item={modals.deleteInventory}
        onClose={() => setModals(m => ({ ...m, deleteInventory: null }))}
        onConfirm={async (id: string, options: any) => handleDeleteInventoryItemAdvanced(id, options)}
      />
      
      <FundTransactionModal 
         isOpen={modals.showFundTransaction}
         onClose={() => setModals(m => ({ ...m, showFundTransaction: false }))}
         onSave={(data) => {
            handleFundAction(data);
            setModals(m => ({ ...m, showFundTransaction: false }));
         }}
      />

      <FundDetailModal 
         transaction={modals.viewFundTransaction} 
         onClose={() => setModals(m => ({ ...m, viewFundTransaction: null }))} 
      />

      <DeleteFundModal 
         transaction={modals.deleteFundTransaction} 
         onClose={() => setModals(m => ({ ...m, deleteFundTransaction: null }))}
         onConfirm={(id) => {
            handleDeleteFundTransaction(id);
            setModals(m => ({ ...m, deleteFundTransaction: null }));
         }}
      />

      <ViewTransactionModal
        transaction={modals.viewTransaction}
        compact={Boolean(modals.viewTransactionCompact)}
        readOnly={activeTab === 'inventory' && Boolean(modals.viewTransaction) && !modals.viewTransactionCompact}
        onClose={() => setModals(m => ({ ...m, viewTransaction: null, viewTransactionCompact: false }))}
      />
      <DeleteTransactionModal
        transaction={modals.deleteTransaction}
        onClose={() => setModals(m => ({ ...m, deleteTransaction: null }))}
        onConfirm={(id: string) => {
          handleDeleteInventoryTransaction(id);
          setModals(m => ({ ...m, deleteTransaction: null }));
        }}
      />
    </>
  );
};
