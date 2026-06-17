
import React from 'react';
import { useApp } from '../store';
import { CatalogHeaderMegaMenu } from './CatalogHeaderMegaMenu';

export const Header: React.FC = () => {
  const { activeTab } = useApp();

  if (activeTab === 'catalogs') {
    return <CatalogHeaderMegaMenu />;
  }

  const hidePageHeading =
    activeTab === 'accounting' ||
    activeTab === 'dashboard' ||
    activeTab === 'devices' ||
    activeTab === 'inventory' ||
    activeTab === 'invoices' ||
    activeTab === 'fund' ||
    activeTab === 'cit' ||
    activeTab === 'assets' ||
    activeTab === 'business_result' ||
    activeTab === 'settings' ||
    activeTab.startsWith('doc_') ||
    activeTab.startsWith('hotel_pms_');

  if (hidePageHeading) {
    return null;
  }

  const getTitle = () => {
    switch (activeTab) {
      case 'dashboard':
        return 'Tổng quan hệ thống';
      case 'devices':
        return 'Quản lý Thiết bị & Gia hạn';
      case 'inventory':
        return 'Quản lý Sản phẩm & Bản quyền';
      case 'invoices':
        return 'Hóa đơn & Thuế VAT';
      case 'fund':
        return 'Quỹ Tiền mặt & Ngân hàng';
      case 'catalogs':
        return 'Danh mục Từ điển';
      case 'cit':
        return 'Quản lý Thuế Thu nhập Doanh nghiệp';
      case 'assets':
        return 'Tài sản Cố định & Công cụ Dụng cụ';
      case 'business_result':
        return 'Báo cáo';
      case 'sys_company':
        return 'Hệ thống - Thông tin Doanh nghiệp';
      case 'sys_users':
        return 'Hệ thống - Người dùng & Phân quyền';
      case 'sys_year':
        return 'Hệ thống - Năm tài chính';
      case 'sys_initial':
        return 'Hệ thống - Thiết lập ban đầu';
      case 'sys_status':
        return 'Hệ thống - Trạng thái hệ thống';
      case 'sys_logs':
        return 'Hệ thống - Nhật ký hệ thống';
      case 'sys_backup':
        return 'Hệ thống - Sao lưu & Phục hồi';

      default:
        return 'Hệ thống';
    }
  };

  return (
    <header className="vtr-no-print mb-8 print:hidden">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">{getTitle()}</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cập nhật lúc: {new Date().toLocaleString('vi-VN')}
        </p>
      </div>
    </header>
  );
};
