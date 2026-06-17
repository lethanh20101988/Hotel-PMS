import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Home,
  LayoutGrid,
  Smartphone,
  Box,
  FileText,
  BookOpen,
  Settings,
  Briefcase,
  Wallet,
  List,
  PieChart,
  Building,
  FileInput,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Users,
  Calendar,
  Flag,
  Activity,
  FileClock,
  Database,
  MonitorCog,
  ChevronsLeft,
  ChevronsRight,
  PanelLeftClose,
  Package,
  Hotel,
  Trash2,
} from 'lucide-react';
import { useApp } from '../store';
import { preloadTab } from '../routeModules';
import { useSidebarLayout } from './sidebarLayoutContext';
import { OverviewHubModal } from '../../modules/dashboard/components/OverviewHubModal';

const SIDEBAR_HUB_API = String((import.meta as any).env?.VITE_API_URL || '/api').replace(/\/$/, '');
const HUB_ICON_STROKE = 1.75;

const DOCUMENT_TAB_IDS = [
  'doc_receipt',
  'doc_payment',
  'doc_bank',
  'doc_debit_credit',
  'doc_import',
  'doc_export',
  'doc_adjust',
  'doc_general',
] as const;

const HOTEL_PMS_TAB_IDS = [
  'hotel_pms_frontdesk',
  'hotel_pms_housekeeping',
  'hotel_pms_rates',
  'hotel_pms_services',
] as const;

const SYSTEM_TAB_IDS = [
  'sys_company',
  'sys_users',
  'sys_year',
  'sys_initial',
  'sys_status',
  'sys_logs',
  'sys_backup',
] as const;

const isDocumentTab = (tab: string) => (DOCUMENT_TAB_IDS as readonly string[]).includes(tab);

const isHotelPmsTab = (tab: string) => (HOTEL_PMS_TAB_IDS as readonly string[]).includes(tab);

const isSystemTab = (tab: string) => (SYSTEM_TAB_IDS as readonly string[]).includes(tab);

type SidebarAuthProfile = {
  role?: string | null;
  permissions?: string[];
  email?: string | null;
  phone?: string | null;
};

const TAB_ACCESS_PERMISSION: Record<string, string> = {
  dashboard: 'access_dashboard',
  catalogs: 'access_inventory',
  devices: 'access_devices',
  inventory: 'access_inventory',
  invoices: 'access_invoices',
  fund: 'access_fund',
  cit: 'access_cit',
  assets: 'access_assets',
  accounting: 'access_accounting',
  business_result: 'access_reports',
  settings: 'access_settings',
  lifecycle: 'access_system',
};

const getAccessPermissionForTab = (tab: string) => {
  if (isDocumentTab(tab)) return 'access_documents';
  if (isHotelPmsTab(tab)) return 'access_hotel_pms';
  if (isSystemTab(tab)) return 'access_system';
  return TAB_ACCESS_PERMISSION[tab];
};

const RAIL_W = 'w-[72px]';
const EXPANDED_W = 'w-64';

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab } = useApp();
  const { mode, toggleExpandedIcons, hideSidebar } = useSidebarLayout();
  const [documentsExpanded, setDocumentsExpanded] = useState(false);
  const [hotelPmsExpanded, setHotelPmsExpanded] = useState(false);
  const [systemExpanded, setSystemExpanded] = useState(false);
  const [flyout, setFlyout] = useState<'system' | 'documents' | 'hotelPms' | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [overviewHubOpen, setOverviewHubOpen] = useState(false);
  const [hubUnread, setHubUnread] = useState(0);
  const [authProfile, setAuthProfile] = useState<SidebarAuthProfile | null>(null);

  const expanded = mode === 'expanded';
  const iconsOnly = mode === 'icons';
  const hidden = mode === 'hidden';

  const loadAuthProfile = useCallback(async () => {
    const token = (() => {
      try {
        return localStorage.getItem('auth_token') || '';
      } catch {
        return '';
      }
    })();
    if (!token) {
      setAuthProfile(null);
      return;
    }
    const res = await fetch(`${SIDEBAR_HUB_API}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    setAuthProfile(await res.json());
  }, []);

  useEffect(() => {
    setSystemExpanded(isSystemTab(activeTab));
    setDocumentsExpanded(isDocumentTab(activeTab));
    setHotelPmsExpanded(isHotelPmsTab(activeTab));
  }, [activeTab]);

  useEffect(() => {
    if (!flyout) return;
    const onDoc = (e: MouseEvent) => {
      const el = flyoutRef.current;
      if (el && !el.contains(e.target as Node)) setFlyout(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [flyout]);

  useEffect(() => {
    if (expanded) setFlyout(null);
  }, [expanded]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (!cancelled) await loadAuthProfile();
      } catch {
        if (!cancelled) setAuthProfile(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadAuthProfile]);

  useEffect(() => {
    const onRemoteUpdate = (event: Event) => {
      const kinds = ((event as CustomEvent<{ kinds?: string[] }>).detail?.kinds || []) as string[];
      if (kinds.includes('rbac')) {
        void loadAuthProfile().catch(() => setAuthProfile(null));
      }
    };
    window.addEventListener('vtr:state-remote-update', onRemoteUpdate);
    return () => window.removeEventListener('vtr:state-remote-update', onRemoteUpdate);
  }, [loadAuthProfile]);

  useEffect(() => {
    const token = (() => {
      try {
        return localStorage.getItem('auth_token') || '';
      } catch {
        return '';
      }
    })();
    if (!token) {
      setHubUnread(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${SIDEBAR_HUB_API}/notifications/summary`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const n = Number(data?.unreadNotifications);
        if (!cancelled) setHubUnread(Number.isFinite(n) ? n : 0);
      } catch {
        if (!cancelled) setHubUnread(0);
      }
    };
    const onRemoteUpdate = (event: Event) => {
      const kinds = ((event as CustomEvent<{ kinds?: string[] }>).detail?.kinds || []) as string[];
      if (kinds.includes('notification')) void load();
    };
    void load();
    window.addEventListener('vtr:state-remote-update', onRemoteUpdate);
    const id = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      window.removeEventListener('vtr:state-remote-update', onRemoteUpdate);
      window.clearInterval(id);
    };
  }, []);

  const handleDocumentClick = (tab: string) => {
    preloadTab(tab);
    setActiveTab(tab);
    setFlyout(null);
  };

  const handleHotelPmsClick = (tab: string) => {
    preloadTab(tab);
    setActiveTab(tab);
    setFlyout(null);
  };

  const handleSystemClick = (tab: string) => {
    preloadTab(tab);
    setActiveTab(tab);
    setFlyout(null);
  };

  const navigateTab = (tab: string) => {
    preloadTab(tab);
    setActiveTab(tab);
  };

  const menuItems = [{ id: 'dashboard', label: 'Tổng quan', icon: Home }];

  const systemItems = [
    { id: 'sys_company', label: 'Thông tin doanh nghiệp', icon: Building },
    { id: 'sys_users', label: 'Người dùng & phân quyền', icon: Users },
    { id: 'sys_year', label: 'Năm tài chính', icon: Calendar },
    { id: 'sys_initial', label: 'Thiết lập ban đầu', icon: Flag },
    { id: 'sys_status', label: 'Trạng thái hệ thống', icon: Activity },
    { id: 'sys_logs', label: 'Nhật ký hệ thống', icon: FileClock },
    { id: 'sys_backup', label: 'Sao lưu / phục hồi', icon: Database },
  ];

  const catalogItem = { id: 'catalogs', label: 'Danh mục', icon: List };

  const documentItems = [
    { id: 'doc_receipt', label: 'Phiếu thu' },
    { id: 'doc_payment', label: 'Phiếu chi' },
    { id: 'doc_bank', label: 'Ủy nhiệm chi' },
    { id: 'doc_debit_credit', label: 'Giấy báo Nợ / Có' },
    { id: 'doc_import', label: 'Phiếu nhập kho' },
    { id: 'doc_export', label: 'Phiếu xuất kho' },
    { id: 'doc_adjust', label: 'Phiếu điều chỉnh' },
    { id: 'doc_general', label: 'Phiếu kế toán tổng hợp' },
  ];

  const hotelPmsItems = [
    { id: 'hotel_pms_frontdesk', label: 'Lễ Tân' },
    { id: 'hotel_pms_housekeeping', label: 'Buồng Phòng' },
    { id: 'hotel_pms_rates', label: 'Cấu hình giá' },
    { id: 'hotel_pms_services', label: 'Dịch vụ & Minibar' },
  ];

  const bottomItems = [
    { id: 'devices', label: 'Thiết bị & Gia hạn', icon: Smartphone },
    { id: 'inventory', label: 'Sản phẩm & Bản quyền', icon: Package },
    { id: 'invoices', label: 'Hóa đơn & VAT', icon: FileText },
    { id: 'fund', label: 'Quỹ & ngân hàng', icon: Wallet },
    { id: 'cit', label: 'Thuế TNDN', icon: PieChart },
    { id: 'assets', label: 'TSCĐ & CCDC', icon: Building },
    { id: 'accounting', label: 'Kế toán tổng hợp', icon: BookOpen },
    { id: 'business_result', label: 'Báo cáo', icon: Briefcase },
    { id: 'settings', label: 'Cấu hình', icon: Settings },
    { id: 'lifecycle', label: 'Vòng đời dữ liệu', icon: Trash2 },
  ];

  const hasAccess = (permission?: string) => {
    if (!permission) return true;
    if (!authProfile) return true;
    if (authProfile?.role === 'super_admin') return true;
    return Boolean(authProfile?.permissions?.includes(permission));
  };

  const canOpenTab = (tab: string) => hasAccess(getAccessPermissionForTab(tab));
  const menuItemsAllowed = menuItems.filter((item) => canOpenTab(item.id));
  const systemItemsAllowed = systemItems.filter((item) => canOpenTab(item.id));
  const documentItemsAllowed = documentItems.filter((item) => canOpenTab(item.id));
  const hotelPmsItemsAllowed = hotelPmsItems.filter((item) => canOpenTab(item.id));
  const bottomItemsAllowed = bottomItems.filter((item) => canOpenTab(item.id));
  const canOpenSystem = systemItemsAllowed.length > 0;
  const canOpenDocuments = documentItemsAllowed.length > 0;
  const canOpenHotelPms = hotelPmsItemsAllowed.length > 0;
  const canOpenCatalogs = canOpenTab(catalogItem.id);
  const firstAllowedTab =
    menuItemsAllowed[0]?.id ||
    (canOpenSystem ? systemItemsAllowed[0]?.id : undefined) ||
    (canOpenCatalogs ? catalogItem.id : undefined) ||
    (canOpenDocuments ? documentItemsAllowed[0]?.id : undefined) ||
    (canOpenHotelPms ? hotelPmsItemsAllowed[0]?.id : undefined) ||
    bottomItemsAllowed[0]?.id ||
    'dashboard';

  useEffect(() => {
    if (!authProfile) return;
    if (!canOpenTab(activeTab)) {
      preloadTab(firstAllowedTab);
      setActiveTab(firstAllowedTab);
      setFlyout(null);
    }
  }, [activeTab, authProfile, firstAllowedTab, setActiveTab]);

  const FlyoutPanel = ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
  }) =>
    open ? (
      <div
        ref={flyoutRef}
        className="absolute left-full top-0 z-[60] ml-1 w-56 rounded-xl border border-slate-700 bg-slate-900 py-2 shadow-2xl"
      >
        {children}
      </div>
    ) : null;

  if (hidden) {
    return null;
  }

  return (
    <aside
      data-vtr-sidebar
      className={`${expanded ? EXPANDED_W : RAIL_W} relative z-10 flex min-h-screen shrink-0 flex-col self-stretch bg-slate-900 text-slate-300 shadow-xl transition-[width] duration-200 ease-out print:hidden`}
    >
      {/* Brand */}
      <div
        className={`border-b border-slate-800 shrink-0 ${expanded ? 'p-4' : 'p-2'} flex ${expanded ? 'flex-row items-center gap-3' : 'flex-col items-center gap-2'}`}
      >
        <div className="p-2 bg-gradient-to-tr from-blue-500 to-purple-600 rounded-lg shadow-lg shrink-0">
          <Box className={`${expanded ? 'w-6 h-6' : 'w-5 h-5'} text-white`} />
        </div>
        {expanded && (
          <div className="min-w-0 flex-1">
            <h1 className="font-bold text-base leading-tight text-white truncate">VTR Manager</h1>
            <p className="text-[10px] text-slate-400 truncate">Device & Accounting</p>
          </div>
        )}
      </div>

      {/* Điều khiển thu gọn / ẩn */}
      <div
        className={`border-b border-slate-800 shrink-0 flex ${expanded ? 'flex-row justify-end gap-1 px-2 py-2' : 'flex-col items-center gap-1 px-1 py-2'}`}
      >
        {expanded ? (
          <>
            <button
              type="button"
              title="Thu gọn — chỉ hiện icon"
              onClick={toggleExpandedIcons}
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Ẩn sidebar"
              onClick={hideSidebar}
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-rose-300 transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              title="Mở rộng sidebar"
              onClick={toggleExpandedIcons}
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Ẩn sidebar"
              onClick={hideSidebar}
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-rose-300 transition-colors"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      <nav
        className={`min-h-0 flex-1 overflow-y-auto custom-scrollbar ${expanded ? 'p-4 space-y-1' : 'p-2 space-y-1'}`}
      >
        {menuItemsAllowed.map(item => (
          <button
            key={item.id}
            title={item.label}
            onMouseEnter={() => preloadTab(item.id)}
            onClick={() => navigateTab(item.id)}
            className={`w-full flex items-center ${expanded ? 'gap-3 px-4 py-3 rounded-xl' : 'justify-center px-0 py-3 rounded-xl'} transition-all ${
              activeTab === item.id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50 font-medium'
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {expanded && <span className="text-left truncate">{item.label}</span>}
          </button>
        ))}

        {/* Hệ thống */}
        {canOpenSystem && <div className={`pt-2 relative ${iconsOnly ? '' : ''}`}>
          {expanded ? (
            <>
              <button
                type="button"
                onMouseEnter={() => preloadTab(systemItemsAllowed[0]?.id || 'sys_company')}
                onClick={() => setSystemExpanded(!systemExpanded)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all hover:bg-slate-800 hover:text-white ${isSystemTab(activeTab) ? 'text-white' : ''}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <MonitorCog className="w-5 h-5 shrink-0" />
                  <span className="truncate">Hệ thống</span>
                </div>
                {systemExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
              </button>
              {systemExpanded && (
                <div className="space-y-1 pl-4 mt-1 border-l-2 border-slate-800 ml-6">
                  {systemItemsAllowed.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => preloadTab(item.id)}
                      onClick={() => handleSystemClick(item.id)}
                      className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all ${
                        activeTab === item.id
                          ? 'bg-blue-600/20 text-blue-400 font-medium'
                          : 'hover:text-white text-slate-400'
                      }`}
                    >
                      <item.icon className={`w-3.5 h-3.5 shrink-0 ${activeTab === item.id ? 'text-blue-400' : 'text-slate-500'}`} />
                      <span className="text-left truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="relative flex justify-center">
              <button
                type="button"
                title="Hệ thống"
                onMouseEnter={() => preloadTab(systemItemsAllowed[0]?.id || 'sys_company')}
                onClick={() => setFlyout(f => (f === 'system' ? null : 'system'))}
                className={`w-full flex justify-center px-0 py-3 rounded-xl transition-all ${
                  isSystemTab(activeTab) || flyout === 'system'
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'hover:bg-slate-800 hover:text-white'
                }`}
              >
                <MonitorCog className="w-5 h-5" />
              </button>
              <FlyoutPanel open={flyout === 'system'}>
                <div className="px-2 text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-800 pb-2 mb-1">
                  Hệ thống
                </div>
                {systemItemsAllowed.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => preloadTab(item.id)}
                    onClick={() => handleSystemClick(item.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-all ${
                      activeTab === item.id ? 'bg-blue-600/30 text-blue-300' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <item.icon className="w-4 h-4 shrink-0 opacity-80" />
                    <span className="text-left">{item.label}</span>
                  </button>
                ))}
              </FlyoutPanel>
            </div>
          )}
        </div>}

        {/* Danh mục */}
        {canOpenCatalogs && <button
          type="button"
          title={catalogItem.label}
          onMouseEnter={() => preloadTab(catalogItem.id)}
          onClick={() => navigateTab(catalogItem.id)}
          className={`w-full flex items-center ${expanded ? 'gap-3 px-4 py-3 rounded-xl' : 'justify-center px-0 py-3 rounded-xl'} transition-all ${
            activeTab === catalogItem.id
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50 font-medium'
              : 'hover:bg-slate-800 hover:text-white'
          }`}
        >
          <catalogItem.icon className="w-5 h-5 shrink-0" />
          {expanded && <span className="truncate">{catalogItem.label}</span>}
        </button>}

        {/* Chứng từ */}
        {canOpenDocuments && <div className="pt-2 relative">
          {expanded ? (
            <>
              <button
                type="button"
                onMouseEnter={() => preloadTab(documentItemsAllowed[0]?.id || 'doc_receipt')}
                onClick={() => setDocumentsExpanded(!documentsExpanded)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all hover:bg-slate-800 hover:text-white ${isDocumentTab(activeTab) ? 'text-white' : ''}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileInput className="w-5 h-5 shrink-0" />
                  <span className="truncate">Chứng từ</span>
                </div>
                {documentsExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
              </button>
              {documentsExpanded && (
                <div className="space-y-1 pl-4 mt-1 border-l-2 border-slate-800 ml-6">
                  {documentItemsAllowed.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => preloadTab(item.id)}
                      onClick={() => handleDocumentClick(item.id)}
                      className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all ${
                        activeTab === item.id
                          ? 'bg-blue-600/20 text-blue-400 font-medium'
                          : 'hover:text-white text-slate-400'
                      }`}
                    >
                      <CircleDot className={`w-2 h-2 shrink-0 ${activeTab === item.id ? 'fill-blue-400' : 'fill-slate-500'}`} />
                      <span className="text-left truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="relative flex justify-center">
              <button
                type="button"
                title="Chứng từ"
                onMouseEnter={() => preloadTab(documentItemsAllowed[0]?.id || 'doc_receipt')}
                onClick={() => setFlyout(f => (f === 'documents' ? null : 'documents'))}
                className={`w-full flex justify-center px-0 py-3 rounded-xl transition-all ${
                  isDocumentTab(activeTab) || flyout === 'documents'
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'hover:bg-slate-800 hover:text-white'
                }`}
              >
                <FileInput className="w-5 h-5" />
              </button>
              <FlyoutPanel open={flyout === 'documents'}>
                <div className="px-2 text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-800 pb-2 mb-1">
                  Chứng từ
                </div>
                {documentItemsAllowed.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => preloadTab(item.id)}
                    onClick={() => handleDocumentClick(item.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-all ${
                      activeTab === item.id ? 'bg-blue-600/30 text-blue-300' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <CircleDot className={`w-2 h-2 shrink-0 ${activeTab === item.id ? 'fill-blue-300' : 'fill-slate-500'}`} />
                    <span className="text-left">{item.label}</span>
                  </button>
                ))}
              </FlyoutPanel>
            </div>
          )}
        </div>}

        {/* Hotel PMS */}
        {canOpenHotelPms && <div className="pt-2 relative">
          {expanded ? (
            <>
              <button
                type="button"
                onMouseEnter={() => preloadTab(hotelPmsItemsAllowed[0]?.id || 'hotel_pms_frontdesk')}
                onClick={() => setHotelPmsExpanded(!hotelPmsExpanded)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all hover:bg-slate-800 hover:text-white ${isHotelPmsTab(activeTab) ? 'text-white' : ''}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Hotel className="w-5 h-5 shrink-0" />
                  <span className="truncate">Hotel PMS</span>
                </div>
                {hotelPmsExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
              </button>
              {hotelPmsExpanded && (
                <div className="space-y-1 pl-4 mt-1 border-l-2 border-slate-800 ml-6">
                  {hotelPmsItemsAllowed.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => preloadTab(item.id)}
                      onClick={() => handleHotelPmsClick(item.id)}
                      className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all ${
                        activeTab === item.id
                          ? 'bg-blue-600/20 text-blue-400 font-medium'
                          : 'hover:text-white text-slate-400'
                      }`}
                    >
                      <CircleDot className={`w-2 h-2 shrink-0 ${activeTab === item.id ? 'fill-blue-400' : 'fill-slate-500'}`} />
                      <span className="text-left truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="relative flex justify-center">
              <button
                type="button"
                title="Hotel PMS"
                onMouseEnter={() => preloadTab(hotelPmsItemsAllowed[0]?.id || 'hotel_pms_frontdesk')}
                onClick={() => setFlyout(f => (f === 'hotelPms' ? null : 'hotelPms'))}
                className={`w-full flex justify-center px-0 py-3 rounded-xl transition-all ${
                  isHotelPmsTab(activeTab) || flyout === 'hotelPms'
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Hotel className="w-5 h-5" />
              </button>
              <FlyoutPanel open={flyout === 'hotelPms'}>
                <div className="px-2 text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-800 pb-2 mb-1">
                  Hotel PMS
                </div>
                {hotelPmsItemsAllowed.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => preloadTab(item.id)}
                    onClick={() => handleHotelPmsClick(item.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-all ${
                      activeTab === item.id ? 'bg-blue-600/30 text-blue-300' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <CircleDot className={`w-2 h-2 shrink-0 ${activeTab === item.id ? 'fill-blue-300' : 'fill-slate-500'}`} />
                    <span className="text-left">{item.label}</span>
                  </button>
                ))}
              </FlyoutPanel>
            </div>
          )}
        </div>}

        {bottomItemsAllowed.map(item => (
          <button
            key={item.id}
            type="button"
            title={item.label}
            onMouseEnter={() => preloadTab(item.id)}
            onClick={() => navigateTab(item.id)}
            className={`w-full flex items-center ${expanded ? 'gap-3 px-4 py-3 rounded-xl' : 'justify-center px-0 py-3 rounded-xl'} transition-all ${
              activeTab === item.id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50 font-medium'
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {expanded && <span className="text-left truncate">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* User block — ẩn khi chỉ icon để gọn */}
      {expanded && (
        <div className="p-4 border-t border-slate-800 shrink-0">
          <div className="bg-slate-800/50 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold shrink-0">
                A
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">Admin User</div>
                <div className="text-xs text-slate-400 truncate">admin@vtr.vn</div>
              </div>
            </div>
          </div>
        </div>
      )}
      {iconsOnly && (
        <div className="p-2 border-t border-slate-800 flex justify-center shrink-0">
          <div
            className="w-9 h-9 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold"
            title="Admin User"
          >
            A
          </div>
        </div>
      )}

      <div className={`border-t border-slate-800 shrink-0 ${expanded ? 'p-3' : 'p-2 pb-3'}`}>
        <OverviewHubModal
          open={overviewHubOpen}
          onClose={() => setOverviewHubOpen(false)}
          onUnreadChange={setHubUnread}
        />
        <button
          type="button"
          title="Thông báo · QR · Đổi mật khẩu · Đăng xuất"
          onClick={() => setOverviewHubOpen(true)}
          className={`relative flex w-full items-center rounded-xl border border-slate-600/90 bg-slate-800/90 text-slate-100 shadow-sm transition-colors hover:border-slate-500 hover:bg-slate-800 ${
            expanded ? 'gap-2 px-3 py-2.5 pr-9 text-sm font-medium' : 'justify-center px-0 py-2.5'
          }`}
        >
          <LayoutGrid className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={HUB_ICON_STROKE} aria-hidden />
          {expanded ? (
            <span className="min-w-0 truncate text-left text-xs leading-tight">
              Thông báo · QR · Đổi MK · Đăng xuất
            </span>
          ) : null}
          {hubUnread > 0 ? (
            <span className="absolute -right-1 -top-1 flex min-h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-slate-900">
              {hubUnread > 99 ? '99+' : hubUnread}
            </span>
          ) : null}
        </button>
      </div>
    </aside>
  );
};

/** Nút nổi khi sidebar bị ẩn — export để MainLayout dùng */
export function SidebarRevealTab({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Hiện menu"
      className="fixed left-0 top-24 z-30 flex h-14 w-9 items-center justify-center rounded-r-xl border border-slate-200 border-l-0 bg-white text-slate-600 shadow-md hover:bg-slate-50 hover:text-blue-600 print:hidden"
    >
      <ChevronRight className="w-5 h-5" />
    </button>
  );
}
