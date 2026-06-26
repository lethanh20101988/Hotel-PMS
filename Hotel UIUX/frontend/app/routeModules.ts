import { lazy } from 'react';

const dashboardImport = () => import('../modules/dashboard/pages/DashboardPage');
const deviceListImport = () => import('../modules/device/pages/DeviceList');
const warehouseImport = () => import('../modules/warehouse/pages/WarehousePage');
const invoiceImport = () => import('../modules/invoice/pages/InvoicePage');
const fundImport = () => import('../modules/fund/pages/FundPage');
const summaryAccountingImport = () => import('../modules/accounting/pages/SummaryAccounting');
const catalogImport = () => import('../modules/catalogs/pages/CatalogPage');
const citImport = () => import('../modules/cit/pages/CITPage');
const assetImport = () => import('../modules/assets/pages/AssetPage');
const documentImport = () => import('../modules/documents/pages/DocumentPage');
const systemImport = () => import('../modules/system/pages/SystemPage');
const settingsImport = () => import('../modules/settings/pages/SettingsPage');
const hotelPmsImport = () => import('../modules/hotel-pms/App');
const deliveryImport = () => import('../modules/delivery/App');
const report133Import = () => import('../modules/accounting/pages/Report133');
const report58Import = () => import('../modules/accounting/pages/Report58');
const lifecycleImport = () => import('../modules/lifecycle/LifecyclePage');

export const DashboardPage = lazy(() =>
  dashboardImport().then((m) => ({ default: m.DashboardPage })),
);
export const DeviceList = lazy(() =>
  deviceListImport().then((m) => ({ default: m.DeviceList })),
);
export const WarehousePage = lazy(() =>
  warehouseImport().then((m) => ({ default: m.WarehousePage })),
);
export const InvoicePage = lazy(() =>
  invoiceImport().then((m) => ({ default: m.InvoicePage })),
);
export const FundPage = lazy(() => fundImport().then((m) => ({ default: m.FundPage })));
export const SummaryAccounting = lazy(() =>
  summaryAccountingImport().then((m) => ({ default: m.SummaryAccounting })),
);
export const CatalogPage = lazy(() =>
  catalogImport().then((m) => ({ default: m.CatalogPage })),
);
export const CITPage = lazy(() => citImport().then((m) => ({ default: m.CITPage })));
export const AssetPage = lazy(() => assetImport().then((m) => ({ default: m.AssetPage })));
export const DocumentPage = lazy(() =>
  documentImport().then((m) => ({ default: m.DocumentPage })),
);
export const SystemPage = lazy(() =>
  systemImport().then((m) => ({ default: m.SystemPage })),
);
export const SettingsPage = lazy(() =>
  settingsImport().then((m) => ({ default: m.SettingsPage })),
);
export const HotelPmsPage = lazy(() => hotelPmsImport());
export const DeliveryPage = lazy(() => deliveryImport());
export const LifecyclePage = lazy(() =>
  lifecycleImport().then((m) => ({ default: m.LifecyclePage })),
);

const UNIQUE_ROUTE_IMPORTS = [
  dashboardImport,
  deviceListImport,
  warehouseImport,
  invoiceImport,
  fundImport,
  summaryAccountingImport,
  catalogImport,
  citImport,
  assetImport,
  documentImport,
  systemImport,
  settingsImport,
  hotelPmsImport,
  deliveryImport,
  report133Import,
  report58Import,
  lifecycleImport,
] as const;

/** Tải trước chunk theo tab sidebar — gọi khi hover hoặc trước khi mở tab. */
export function preloadTab(tabId: string): void {
  if (tabId.startsWith('doc_')) {
    void documentImport();
    return;
  }
  if (tabId.startsWith('sys_')) {
    void systemImport();
    return;
  }
  if (tabId.startsWith('hotel_pms_')) {
    void hotelPmsImport();
    return;
  }
  if (tabId.startsWith('delivery_')) {
    void deliveryImport();
    return;
  }
  if (tabId === 'business_result') {
    void report133Import();
    void report58Import();
    return;
  }

  const map: Record<string, () => Promise<unknown>> = {
    dashboard: dashboardImport,
    devices: deviceListImport,
    inventory: warehouseImport,
    invoices: invoiceImport,
    fund: fundImport,
    cit: citImport,
    assets: assetImport,
    catalogs: catalogImport,
    accounting: summaryAccountingImport,
    settings: settingsImport,
    lifecycle: lifecycleImport,
  };

  const loader = map[tabId];
  if (loader) void loader();
}

/** Tải song song mọi module sau khi đăng nhập để chuyển tab lần đầu cũng nhanh. */
export function prefetchAllRoutes(): void {
  for (const loader of UNIQUE_ROUTE_IMPORTS) {
    void loader();
  }
}
