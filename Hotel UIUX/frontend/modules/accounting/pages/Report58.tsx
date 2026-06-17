import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, Printer, X } from 'lucide-react';
import { Pagination } from '@shared/components/Pagination';
import { loadXlsx } from '@shared/utils/lazyXlsx';
import { useApp } from '../../../app/store';
import type {
  AccountingRegimeConfig,
  Asset,
  BankAccount,
  CompanyInfo,
  FinancialYear,
  FundTransaction,
  InventoryItem,
  InventoryTransaction,
  Invoice,
  JournalEntry,
  OpeningBalanceAccountRecord,
  Tt58TaxBookProfile,
} from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { saveBlobWithPicker } from '@shared/utils/saveFileWithPicker';
import {
  computeTt58B01DnsnData,
  computeTt58B02DnsnRows,
  type Tt58ReportRow,
} from '@shared/regulations/tt58_2026/financialStatements';
import { computeTt58S1DnsnLedger, tt58S1DnsnRowsToTable } from '@shared/regulations/tt58_2026/s1DnsnLedger';
import { computeTt58S2aDnsnLedger, tt58S2aDnsnRowsToTable } from '@shared/regulations/tt58_2026/s2aDnsnLedger';
import { computeTt58S2bDnsnLedger, tt58S2bDnsnRowsToTable } from '@shared/regulations/tt58_2026/s2bDnsnLedger';
import { computeTt58S3aDnsnLedger, tt58S3aDnsnRowsToTable } from '@shared/regulations/tt58_2026/s3aDnsnLedger';
import {
  computeTt58S2cDnsnLedger,
  TT58_S2C_COLUMN_LABELS,
  TT58_S2C_HEADERS,
  tt58S2cRowToTableRow,
  type Tt58S2cItemLedger,
} from '@shared/regulations/tt58_2026/s2cDnsnLedger';
import {
  computeTt58S2dDnsnLedger,
  TT58_S2D_HEADER_DISPLAY,
  TT58_S2D_HEADERS,
  tt58S2dRowsToTable,
} from '@shared/regulations/tt58_2026/s2dDnsnLedger';
import {
  computeTt58S4aDnsnLedger,
  TT58_S4A_HEADERS,
  tt58S4aRowsToTable,
} from '@shared/regulations/tt58_2026/s4aDnsnLedger';
import {
  computeTt58S4bDnsnLedger,
  TT58_S4B_HEADERS,
  tt58S4bRowsToTable,
} from '@shared/regulations/tt58_2026/s4bDnsnLedger';
import {
  computeTt58S4dDnsnLedger,
  TT58_S4D_HEADERS,
  tt58S4dRowsToTable,
} from '@shared/regulations/tt58_2026/s4dDnsnLedger';
import {
  computeTt58S3bDnsnLedger,
  TT58_S3B_HEADERS,
  tt58S3bRowsToTable,
} from '@shared/regulations/tt58_2026/s3bDnsnLedger';
import {
  computeTt58S4cDnsnLedger,
  TT58_S4C_COL_WIDTHS,
  TT58_S4C_HEADER_DISPLAY,
  TT58_S4C_HEADERS,
  tt58S4cRowsToTable,
} from '@shared/regulations/tt58_2026/s4cDnsnLedger';
type Tt58ReportType =
  | 'B01_DNSN'
  | 'B02_DNSN'
  | 'S1_DNSN'
  | 'S2A_DNSN'
  | 'S2B_DNSN'
  | 'S2C_DNSN'
  | 'S2D_DNSN'
  | 'S3A_DNSN'
  | 'S3B_DNSN'
  | 'S4A_DNSN'
  | 'S4B_DNSN'
  | 'S4C_DNSN'
  | 'S4D_DNSN';

type Tt58DropdownGroupId = 'bctc' | 'tax' | 'detail' | 'taxOther';

const DROPDOWN_GROUPS: {
  id: Tt58DropdownGroupId;
  title: string;
  placeholder: string;
  reportGroup: string;
}[] = [
  { id: 'bctc', title: 'Báo cáo tài chính', placeholder: 'Chọn báo cáo tài chính', reportGroup: 'Báo cáo tài chính' },
  { id: 'tax', title: 'Sổ theo thuế', placeholder: 'Chọn sổ theo thuế', reportGroup: 'Sổ theo thuế' },
  { id: 'detail', title: 'Sổ chi tiết', placeholder: 'Chọn sổ chi tiết', reportGroup: 'Sổ chi tiết' },
  { id: 'taxOther', title: 'Sổ thuế', placeholder: 'Chọn sổ thuế khác', reportGroup: 'Sổ thuế' },
];

const REPORT_ITEMS: { id: Tt58ReportType; label: string; group: string }[] = [
  { id: 'B01_DNSN', label: 'B01-DNSN: Tình hình tài chính', group: 'Báo cáo tài chính' },
  { id: 'B02_DNSN', label: 'B02-DNSN: Kết quả hoạt động kinh doanh', group: 'Báo cáo tài chính' },
  { id: 'S1_DNSN', label: 'S1-DNSN: Sổ doanh thu bán hàng hóa, dịch vụ', group: 'Sổ theo thuế' },
  { id: 'S2A_DNSN', label: 'S2a-DNSN: Sổ doanh thu bán hàng hóa, dịch vụ', group: 'Sổ theo thuế' },
  { id: 'S2B_DNSN', label: 'S2b-DNSN: Sổ chi tiết doanh thu, chi phí', group: 'Sổ theo thuế' },
  { id: 'S2C_DNSN', label: 'S2c-DNSN: Sổ vật liệu, dụng cụ, sản phẩm, hàng hóa', group: 'Sổ chi tiết' },
  { id: 'S2D_DNSN', label: 'S2d-DNSN: Sổ chi tiết tiền', group: 'Sổ chi tiết' },
  { id: 'S3A_DNSN', label: 'S3a-DNSN: Sổ doanh thu và TNDN', group: 'Sổ theo thuế' },
  { id: 'S3B_DNSN', label: 'S3b-DNSN: Sổ theo dõi nghĩa vụ thuế GTGT', group: 'Sổ thuế' },
  { id: 'S4A_DNSN', label: 'S4a-DNSN: Sổ chi tiết thanh toán công nợ', group: 'Sổ chi tiết' },
  { id: 'S4B_DNSN', label: 'S4b-DNSN: Sổ tài sản cố định', group: 'Sổ chi tiết' },
  { id: 'S4C_DNSN', label: 'S4c-DNSN: Sổ theo dõi nghĩa vụ thuế khác', group: 'Sổ thuế' },
  { id: 'S4D_DNSN', label: 'S4d-DNSN: Sổ theo dõi vốn chủ sở hữu', group: 'Sổ chi tiết' },
];

const asArray = <T,>(value: T[] | undefined | null | unknown): T[] => (Array.isArray(value) ? value as T[] : []);

const fmt = (value: number | null | undefined) =>
  formatCurrency(Number(value || 0)).replace('₫', '').trim();

const getYear = (financialYear: FinancialYear) =>
  Number(String(financialYear.startDate || '').slice(0, 4)) || new Date().getFullYear();

type LedgerPageSize = 10 | 20 | 30 | 40 | 50 | 100;
const LEDGER_PAGE_SIZE_OPTIONS: LedgerPageSize[] = [10, 20, 30, 50, 100];

const isTt58LedgerReport = (report: Tt58ReportType) => report !== 'B01_DNSN' && report !== 'B02_DNSN';

type LedgerTableKind = 'ledger' | 's2c' | 's2d' | 's4c';

type LedgerViewConfig = {
  formNo: string;
  title: string;
  subtitle?: string;
  wideLayout?: boolean;
  printLayout?: 'a4-portrait' | 'a4-landscape';
  tableKind: LedgerTableKind;
  headers?: string[];
  amountColumnIndex?: number;
  amountColumnIndexes?: number[];
  allRows: (string | number)[][];
  emptyMessage?: string;
  s2cItems?: Tt58S2cItemLedger[];
};

type S2cFlatEntry =
  | { type: 'item-header'; key: string; label: string }
  | { type: 'row'; key: string; row: (string | number)[] };

function flattenS2cEntries(items: Tt58S2cItemLedger[]): S2cFlatEntry[] {
  const out: S2cFlatEntry[] = [];
  for (const item of items) {
    if (items.length > 1) {
      out.push({
        type: 'item-header',
        key: `h-${item.itemId}`,
        label: `Tên vật liệu, dụng cụ, sản phẩm, hàng hóa: ${item.itemName}${item.sku ? ` — Mã: ${item.sku}` : ''} — ĐVT: ${item.unit || '...'}`,
      });
    }
    item.rows.forEach((r, i) => {
      out.push({
        type: 'row',
        key: `r-${item.itemId}-${i}`,
        row: tt58S2cRowToTableRow(r, (v) => fmt(v)),
      });
    });
  }
  return out;
}

function groupS2cSlice(entries: S2cFlatEntry[]): Array<{ key: string; header?: string; rows: (string | number)[][] }> {
  const groups: Array<{ key: string; header?: string; rows: (string | number)[][] }> = [];
  let current: { key: string; header?: string; rows: (string | number)[][] } = { key: 'g-0', rows: [] };

  for (const entry of entries) {
    if (entry.type === 'item-header') {
      if (current.rows.length > 0 || current.header) groups.push(current);
      current = { key: entry.key, header: entry.label, rows: [] };
    } else {
      current.rows.push(entry.row);
    }
  }
  if (current.rows.length > 0 || current.header) groups.push(current);
  return groups;
}

function buildLedgerViewConfig(
  report: Tt58ReportType,
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
  invoices: Invoice[],
  profile?: Tt58TaxBookProfile,
  regime?: AccountingRegimeConfig,
  inventory?: InventoryItem[],
  inventoryCatalog?: InventoryItem[],
  warehouseTransactions?: InventoryTransaction[],
  fundTransactions?: FundTransaction[],
  bankAccounts?: BankAccount[],
  openingBalanceAccounts?: OpeningBalanceAccountRecord[],
  cashFlowOpening?: Record<string, number>,
  assets?: Asset[],
): LedgerViewConfig | null {
  const year = getYear(financialYear);

  if (report === 'S1_DNSN') {
    const s1 = computeTt58S1DnsnLedger(invoices, entries, financialYear, profile, regime);
    return {
      formNo: 'S1-DNSN',
      title: 'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
      subtitle: `Năm: ${year}`,
      tableKind: 'ledger',
      headers: ['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền'],
      amountColumnIndex: 3,
      allRows: tt58S1DnsnRowsToTable(s1, (v) => fmt(v)),
    };
  }
  if (report === 'S2A_DNSN') {
    const s2a = computeTt58S2aDnsnLedger(invoices, entries, financialYear, profile, regime);
    return {
      formNo: 'S2a-DNSN',
      title: 'DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
      subtitle: `Năm: ${year}`,
      tableKind: 'ledger',
      headers: ['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền'],
      amountColumnIndex: 3,
      allRows: tt58S2aDnsnRowsToTable(s2a, (v) => fmt(v)),
    };
  }
  if (report === 'S2B_DNSN') {
    const s2b = computeTt58S2bDnsnLedger(invoices, entries, financialYear);
    return {
      formNo: 'S2b-DNSN',
      title: 'SỔ CHI TIẾT DOANH THU, CHI PHÍ',
      subtitle: `Năm: ${year}`,
      tableKind: 'ledger',
      headers: ['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền'],
      amountColumnIndex: 3,
      allRows: tt58S2bDnsnRowsToTable(s2b, (v) => fmt(v)),
    };
  }
  if (report === 'S3A_DNSN') {
    const s3a = computeTt58S3aDnsnLedger(invoices, entries, financialYear, profile, regime);
    return {
      formNo: 'S3a-DNSN',
      title: 'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
      subtitle: `Năm: ${year}`,
      tableKind: 'ledger',
      headers: ['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền'],
      amountColumnIndex: 3,
      allRows: tt58S3aDnsnRowsToTable(s3a, (v) => fmt(v)),
    };
  }
  if (report === 'S2C_DNSN') {
    const data = computeTt58S2cDnsnLedger(inventory || [], inventoryCatalog || [], warehouseTransactions || [], financialYear);
    const subtitle =
      data.items.length === 1
        ? `${data.items[0].itemName}${data.items[0].sku ? ` (${data.items[0].sku})` : ''} — Năm ${year}`
        : `Năm ${year}${data.items.length > 0 ? ` — ${data.items.length} mặt hàng` : ''}`;
    return {
      formNo: 'S2c-DNSN',
      title: 'SỔ CHI TIẾT VẬT LIỆU, DỤNG CỤ, SẢN PHẨM, HÀNG HÓA',
      subtitle,
      tableKind: 's2c',
      allRows: [],
      s2cItems: data.items,
      emptyMessage: data.items.length === 0 ? 'Chưa có phát sinh nhập, xuất, tồn kho trong kỳ.' : undefined,
    };
  }
  if (report === 'S2D_DNSN') {
    const s2d = computeTt58S2dDnsnLedger(
      fundTransactions || [],
      bankAccounts || [],
      openingBalanceAccounts || [],
      cashFlowOpening || {},
      financialYear,
    );
    return {
      formNo: 'S2d-DNSN',
      title: 'SỔ CHI TIẾT TIỀN',
      subtitle: `Năm: ${year}`,
      printLayout: 'a4-portrait',
      tableKind: 's2d',
      allRows: tt58S2dRowsToTable(s2d, (v) => fmt(v)),
    };
  }
  if (report === 'S3B_DNSN') {
    const s3b = computeTt58S3bDnsnLedger(entries, financialYear);
    const detailCount = s3b.rows.filter((r) => r.kind === 'detail').length;
    const subtitle =
      detailCount > 0 ? `Năm ${year} — ${detailCount} chứng từ phát sinh` : `Năm ${year}`;
    return {
      formNo: 'S3b-DNSN',
      title: 'SỔ THEO DÕI NGHĨA VỤ THUẾ GTGT',
      subtitle,
      tableKind: 'ledger',
      headers: TT58_S3B_HEADERS,
      amountColumnIndexes: [3, 4],
      allRows: tt58S3bRowsToTable(s3b, (v) => fmt(v)),
    };
  }
  if (report === 'S4A_DNSN') {
    const s4a = computeTt58S4aDnsnLedger(entries, fundTransactions || [], financialYear);
    const partnerCount = s4a.sections.filter((s) => s.sectionId !== 'empty').length;
    const subtitle =
      partnerCount > 0 ? `Năm ${year} — ${partnerCount} đối tượng công nợ` : `Năm ${year}`;
    return {
      formNo: 'S4a-DNSN',
      title: 'SỔ CHI TIẾT THANH TOÁN CÔNG NỢ',
      subtitle,
      tableKind: 'ledger',
      headers: TT58_S4A_HEADERS,
      amountColumnIndexes: [3, 4, 5, 6, 7, 8],
      allRows: tt58S4aRowsToTable(s4a, (v) => fmt(v)),
    };
  }
  if (report === 'S4B_DNSN') {
    const s4b = computeTt58S4bDnsnLedger(assets || [], entries, financialYear);
    const groupCount = s4b.groups.filter((g) => g.groupId !== 'empty').length;
    const assetCount = (assets || []).filter((a) => a.type === 'TSCĐ' || String(a.assetAccount || '').startsWith('211')).length;
    const subtitle =
      groupCount > 0
        ? `Năm ${year} — ${groupCount} loại TSCĐ${assetCount > 0 ? ` (${assetCount} tài sản)` : ''}`
        : `Năm ${year}`;
    return {
      formNo: 'S4b-DNSN',
      title: 'SỔ TÀI SẢN CỐ ĐỊNH',
      subtitle,
      tableKind: 'ledger',
      headers: TT58_S4B_HEADERS,
      amountColumnIndexes: [4, 5, 6, 7],
      allRows: tt58S4bRowsToTable(s4b, (v) => fmt(v)),
    };
  }
  if (report === 'S4C_DNSN') {
    const s4c = computeTt58S4cDnsnLedger(entries, financialYear, invoices);
    const lineCount = s4c.sections.reduce((n, s) => n + s.rows.filter((r) => r.kind === 'detail').length, 0);
    const subtitle = lineCount > 0 ? `Năm ${year} — ${lineCount} dòng phát sinh` : `Năm ${year}`;
    return {
      formNo: 'S4c-DNSN',
      title: 'SỔ THEO DÕI NGHĨA VỤ THUẾ KHÁC',
      subtitle,
      wideLayout: true,
      printLayout: 'a4-landscape',
      tableKind: 's4c',
      allRows: tt58S4cRowsToTable(s4c, (v) => fmt(v)),
    };
  }
  if (report === 'S4D_DNSN') {
    const s4d = computeTt58S4dDnsnLedger(entries, financialYear);
    const sectionCount = s4d.sections.filter((s) => s.sectionId !== 'empty').length;
    const subtitle = sectionCount > 0 ? `Năm ${year} — ${sectionCount} nhóm vốn chủ sở hữu` : `Năm ${year}`;
    return {
      formNo: 'S4d-DNSN',
      title: 'SỔ THEO DÕI VỐN CHỦ SỞ HỮU',
      subtitle,
      tableKind: 'ledger',
      headers: TT58_S4D_HEADERS,
      amountColumnIndexes: [3, 4, 5],
      allRows: tt58S4dRowsToTable(s4d, (v) => fmt(v)),
    };
  }
  return null;
}

function renderLedgerTableBody(
  config: LedgerViewConfig,
  rows: (string | number)[][],
  s2cGroups?: Array<{ key: string; header?: string; rows: (string | number)[][] }>,
) {
  if (config.emptyMessage) {
    return <p className="text-sm italic">{config.emptyMessage}</p>;
  }
  if (config.tableKind === 's2c') {
    const groups =
      s2cGroups ||
      (config.s2cItems || []).map((item) => ({
        key: item.itemId,
        header:
          (config.s2cItems?.length || 0) > 1
            ? `Tên vật liệu, dụng cụ, sản phẩm, hàng hóa: ${item.itemName}${item.sku ? ` — Mã: ${item.sku}` : ''} — ĐVT: ${item.unit || '...'}`
            : undefined,
        rows: item.rows.map((r) => tt58S2cRowToTableRow(r, (v) => fmt(v))),
      }));
    return (
      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.key} className="break-inside-avoid">
            {group.header ? <p className="mb-2 font-bold">{group.header}</p> : null}
            <S2cLedgerTable rows={group.rows} />
          </div>
        ))}
      </div>
    );
  }
  if (config.tableKind === 's2d') {
    return <S2dLedgerTable rows={rows} />;
  }
  if (config.tableKind === 's4c') {
    return <S4cLedgerTemplate rows={rows} />;
  }
  return (
    <LedgerTemplate
      headers={config.headers || []}
      rows={rows}
      amountColumnIndex={config.amountColumnIndex}
      amountColumnIndexes={config.amountColumnIndexes}
    />
  );
}

function renderLedgerShellContent(
  config: LedgerViewConfig,
  rows: (string | number)[][],
  companyInfo: CompanyInfo,
  s2cGroups?: Array<{ key: string; header?: string; rows: (string | number)[][] }>,
) {
  return (
    <ReportShell
      formNo={config.formNo}
      title={config.title}
      subtitle={config.subtitle}
      companyInfo={companyInfo}
      wideLayout={config.wideLayout}
      printLayout={config.printLayout}
    >
      {renderLedgerTableBody(config, rows, s2cGroups)}
    </ReportShell>
  );
}

const Tt58LedgerModal: React.FC<{
  open: boolean;
  onClose: () => void;
  config: LedgerViewConfig;
  companyInfo: CompanyInfo;
  reportLabel: string;
  page: number;
  pageSize: LedgerPageSize;
  onChangePage: (next: number) => void;
  onChangePageSize: (next: LedgerPageSize) => void;
  onPrint: () => void;
  onExportExcel: () => void;
}> = ({
  open,
  onClose,
  config,
  companyInfo,
  reportLabel,
  page,
  pageSize,
  onChangePage,
  onChangePageSize,
  onPrint,
  onExportExcel,
}) => {
  const s2cFlat = useMemo(
    () => (config.tableKind === 's2c' && config.s2cItems ? flattenS2cEntries(config.s2cItems) : []),
    [config],
  );

  const totalItems = config.tableKind === 's2c' ? s2cFlat.length : config.allRows.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  const pagedRows = config.tableKind === 's2c' ? [] : config.allRows.slice(start, end);
  const pagedS2cGroups =
    config.tableKind === 's2c' ? groupS2cSlice(s2cFlat.slice(start, end)) : undefined;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-end justify-center p-0 sm:items-center sm:p-4 print:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
        aria-label="Đóng sổ kế toán"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tt58-ledger-modal-title"
        className="relative flex h-[min(92vh,900px)] w-full max-w-[min(100vw,72rem)] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl animate-[tt58SlideUp_0.28s_ease-out] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <p id="tt58-ledger-modal-title" className="truncate text-sm font-black text-slate-900 sm:text-base">
              {reportLabel}
            </p>
            <p className="truncate text-[11px] font-semibold text-slate-500">{config.formNo}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onPrint}
              title="In sổ"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Printer className="h-3.5 w-3.5 text-sky-600" aria-hidden />
              In
            </button>
            <button
              type="button"
              onClick={onExportExcel}
              title="Xuất Excel"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
              Excel
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Đóng"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50/60 p-3 sm:p-4">
          {renderLedgerShellContent(config, pagedRows, companyInfo, pagedS2cGroups)}
        </div>

        {!config.emptyMessage && totalItems > 0 ? (
          <Pagination
            page={page}
            totalItems={totalItems}
            pageSize={pageSize}
            onChangePage={onChangePage}
            onChangePageSize={onChangePageSize}
            pageSizeOptions={LEDGER_PAGE_SIZE_OPTIONS}
            variant="compact"
            className="shrink-0"
          />
        ) : null}
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes tt58SlideUp {
              from { transform: translateY(100%); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
            }
            @media (min-width: 640px) {
              @keyframes tt58SlideUp {
                from { transform: translateY(16px) scale(0.98); opacity: 0; }
                to { transform: translateY(0) scale(1); opacity: 1; }
              }
            }
          `,
        }}
      />
    </div>
  );
};

type Tt58ReportSignatures = {
  preparerName: string;
  chiefAccountantName: string;
  legalRepresentativeName: string;
  signDay: string;
  signMonth: string;
  signYear: string;
};

const defaultSignatures = (): Tt58ReportSignatures => {
  const t = new Date();
  return {
    preparerName: '',
    chiefAccountantName: '',
    legalRepresentativeName: '',
    signDay: String(t.getDate()),
    signMonth: String(t.getMonth() + 1),
    signYear: String(t.getFullYear()),
  };
};

const tt58SignaturesStorageKey = (taxCode: string) =>
  `victory_tt58_report_signatures_${String(taxCode || '').replace(/\D/g, '') || 'default'}`;

const Tt58SignaturesContext = createContext<{
  signatures: Tt58ReportSignatures;
  updateSignatures: (patch: Partial<Tt58ReportSignatures>) => void;
} | null>(null);

const SIGN_NAME_INPUT_CLS =
  'w-full min-h-[2.25rem] border-0 border-b border-dotted border-slate-500 bg-slate-50/80 px-2 py-1 text-center text-[12px] font-bold text-black outline-none focus:border-blue-500 print:bg-transparent print:border-black print:placeholder:text-transparent';

const SIGN_DATE_INPUT_CLS =
  'inline-block w-8 shrink-0 border-0 border-b border-dotted border-slate-500 bg-slate-50/80 px-0.5 py-0.5 text-center text-[12px] font-bold leading-none text-black outline-none focus:border-blue-500 print:bg-transparent print:border-black print:placeholder:text-transparent';

const SIGN_DATE_YEAR_CLS = `${SIGN_DATE_INPUT_CLS} !w-12`;

const ReportShell: React.FC<{
  formNo: string;
  title: string;
  subtitle?: string;
  companyInfo: CompanyInfo;
  children: React.ReactNode;
  /** Bảng nhiều cột (S4c) — bỏ giới hạn 980px, cho phép cuộn ngang. */
  wideLayout?: boolean;
  /** Căn bố cục in theo khổ A4. */
  printLayout?: 'a4-portrait' | 'a4-landscape';
}> = ({ formNo, title, subtitle, companyInfo, children, wideLayout, printLayout }) => {
  const printCompact = printLayout != null;
  const printRootClass =
    printLayout === 'a4-landscape' ? 'tt58-s4c-a4' : printLayout === 'a4-portrait' ? 'tt58-s2d-a4' : '';
  return (
  <div
    className={`tt58-print mx-auto bg-white text-black font-['Times_New_Roman',_Times,_serif] text-[12px] leading-snug p-6 print:p-0 print:max-w-none ${
      wideLayout ? 'w-full max-w-none min-w-0' : 'max-w-[980px]'
    } ${printRootClass}`}
  >
    <div className={`grid grid-cols-2 gap-4 mb-8 ${printCompact ? 'print:mb-2 print:gap-2' : ''}`}>
      <div className="text-[12px]">
        <div><strong>Đơn vị:</strong> {companyInfo.name || '........................................'}</div>
        <div><strong>Địa chỉ:</strong> {companyInfo.address || '........................................'}</div>
      </div>
      <div className="text-center text-[12px]">
        <div className="font-bold">Mẫu số {formNo}</div>
        <div className="italic">(Kèm theo Thông tư số 58/2026/TT-BTC ngày 25 tháng 5 năm 2026 của Bộ trưởng Bộ Tài chính)</div>
      </div>
    </div>
    <h2
      className={`text-center font-bold uppercase text-[15px] mb-2 ${
        printCompact ? 'print:text-[13px] print:mb-1' : ''
      }`}
    >
      {title}
    </h2>
    {subtitle ? (
      <div className={`text-center mb-3 ${printCompact ? 'print:mb-1 print:text-[11px]' : ''}`}>
        {subtitle}
      </div>
    ) : null}
    <div className={`text-right italic mb-2 ${printCompact ? 'print:mb-1 print:text-[11px]' : ''}`}>
      Đơn vị tính: đồng
    </div>
    {children}
    <SignatureBlock />
  </div>
  );
};

const SignatureBlock = () => {
  const ctx = useContext(Tt58SignaturesContext);
  if (!ctx) return null;
  const { signatures, updateSignatures } = ctx;

  return (
    <div
      className="mt-10 grid grid-cols-3 gap-x-8 gap-y-1.5 text-center text-[12px] leading-snug"
    >
      {/* Hàng 1: cột 3 có ngày tháng năm; cột 1–2 giữ chiều cao đồng bộ */}
      <div className="min-h-[2.5rem]" aria-hidden />
      <div className="min-h-[2.5rem]" aria-hidden />
      <div className="flex min-h-[2.5rem] flex-nowrap items-end justify-center gap-1 italic">
        <span className="shrink-0">Ngày</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={signatures.signDay}
          onChange={(e) => updateSignatures({ signDay: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          placeholder=".."
          className={SIGN_DATE_INPUT_CLS}
          aria-label="Ngày ký"
        />
        <span className="shrink-0">tháng</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={signatures.signMonth}
          onChange={(e) => updateSignatures({ signMonth: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          placeholder=".."
          className={SIGN_DATE_INPUT_CLS}
          aria-label="Tháng ký"
        />
        <span className="shrink-0">năm</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={signatures.signYear}
          onChange={(e) => updateSignatures({ signYear: e.target.value.replace(/\D/g, '').slice(0, 4) })}
          placeholder="...."
          className={SIGN_DATE_YEAR_CLS}
          aria-label="Năm ký"
        />
      </div>

      {/* Hàng 2: chức danh */}
      <p className="font-bold uppercase tracking-tight">NGƯỜI LẬP BIỂU</p>
      <p className="font-bold uppercase tracking-tight">KẾ TOÁN TRƯỞNG</p>
      <p className="font-bold uppercase tracking-tight leading-tight">NGƯỜI ĐẠI DIỆN THEO PHÁP LUẬT</p>

      {/* Hàng 3: ghi chú ký */}
      <p className="italic">(Ký, ghi rõ họ tên)</p>
      <p className="italic">(Ký, ghi rõ họ tên)</p>
      <p className="italic">(Ký, ghi rõ họ tên, đóng dấu)</p>

      {/* Hàng 4: khoảng ký tay (3 cột đồng bộ) */}
      <div className="h-14 print:h-12" aria-hidden />
      <div className="h-14 print:h-12" aria-hidden />
      <div className="h-14 print:h-12" aria-hidden />

      {/* Hàng 5: ô họ tên — cùng một hàng lưới nên thẳng hàng */}
      <input
        type="text"
        value={signatures.preparerName}
        onChange={(e) => updateSignatures({ preparerName: e.target.value })}
        placeholder="Họ và tên người lập biểu"
        className={SIGN_NAME_INPUT_CLS}
        aria-label="Họ tên người lập biểu"
      />
      <input
        type="text"
        value={signatures.chiefAccountantName}
        onChange={(e) => updateSignatures({ chiefAccountantName: e.target.value })}
        placeholder="Họ và tên kế toán trưởng"
        className={SIGN_NAME_INPUT_CLS}
        aria-label="Họ tên kế toán trưởng"
      />
      <input
        type="text"
        value={signatures.legalRepresentativeName}
        onChange={(e) => updateSignatures({ legalRepresentativeName: e.target.value })}
        placeholder="Họ và tên người đại diện"
        className={SIGN_NAME_INPUT_CLS}
        aria-label="Họ tên người đại diện theo pháp luật"
      />
    </div>
  );
};

const B02StatementTable: React.FC<{ rows: Tt58ReportRow[] }> = ({ rows }) => (
  <table className="w-full border-collapse text-[12px]">
    <thead>
      <tr>
        <th className="border border-black p-2 w-[52%]">Chỉ tiêu</th>
        <th className="border border-black p-2 w-[12%]">Mã số</th>
        <th className="border border-black p-2">Năm nay</th>
        <th className="border border-black p-2">Năm trước</th>
      </tr>
      <tr>
        <th className="border border-black p-1 text-center font-normal italic">1</th>
        <th className="border border-black p-1 text-center font-normal italic">2</th>
        <th className="border border-black p-1 text-center font-normal italic">3</th>
        <th className="border border-black p-1 text-center font-normal italic">4</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row, idx) => (
        <tr key={row.code || `b02-${idx}`} className={row.bold ? 'font-bold' : ''}>
          <td className="border border-black p-2 text-left">{row.label}</td>
          <td className="border border-black p-2 text-center">{row.code}</td>
          <td className="border border-black p-2 text-right">{fmt(row.value)}</td>
          <td className="border border-black p-2 text-right">{fmt(row.beginValue)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const StatementTable: React.FC<{ rows: Tt58ReportRow[]; hasBegin?: boolean }> = ({ rows, hasBegin }) => (
  <table className="w-full border-collapse text-[12px]">
    <thead>
      <tr>
        <th className="border border-black p-2 w-[52%]">Chỉ tiêu</th>
        <th className="border border-black p-2 w-[12%]">Mã số</th>
        <th className="border border-black p-2">Số cuối năm</th>
        {hasBegin ? <th className="border border-black p-2">Số đầu năm</th> : null}
      </tr>
    </thead>
    <tbody>
      {rows.map((row, idx) => (
        row.sectionHeader ? (
          <tr key={`section-${idx}`} className="font-bold">
            <td colSpan={hasBegin ? 4 : 3} className="border border-black p-2 text-center uppercase tracking-wide">
              {row.label}
            </td>
          </tr>
        ) : (
          <tr key={row.code || `row-${idx}`} className={row.bold ? 'font-bold' : ''}>
            <td className={`border border-black p-2 ${row.italic ? 'italic' : ''}`} style={{ paddingLeft: `${8 + (row.indent || 0) * 16}px` }}>{row.label}</td>
            <td className="border border-black p-2 text-center">{row.code}</td>
            <td className="border border-black p-2 text-right">{fmt(row.value)}</td>
            {hasBegin ? <td className="border border-black p-2 text-right">{fmt(row.beginValue)}</td> : null}
          </tr>
        )
      ))}
    </tbody>
  </table>
);

const S2cLedgerTable: React.FC<{ rows: (string | number)[][] }> = ({ rows }) => (
  <table className="w-full border-collapse text-[10px]">
    <thead>
      <tr>
        {TT58_S2C_HEADERS.map((h) => (
          <th key={h} className="border border-black p-1 text-center">
            {h}
          </th>
        ))}
      </tr>
      <tr>
        {TT58_S2C_COLUMN_LABELS.map((l) => (
          <th key={l} className="border border-black p-1 text-center font-normal italic">
            {l}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row, idx) => {
        const desc = String(row[2] ?? '');
        const bold = /Số dư|Cộng phát sinh/.test(desc);
        return (
          <tr key={idx} className={bold ? 'font-bold' : ''}>
            {TT58_S2C_HEADERS.map((_, i) => (
              <td
                key={i}
                className={`border border-black p-1 min-h-7 ${i >= 4 ? 'text-right' : i === 2 ? 'text-left' : 'text-center'}`}
              >
                {row[i] ?? ''}
              </td>
            ))}
          </tr>
        );
      })}
    </tbody>
  </table>
);

const LedgerTemplate: React.FC<{
  headers: string[];
  rows: (string | number)[][];
  amountColumnIndex?: number;
  amountColumnIndexes?: number[];
}> = ({ headers, rows, amountColumnIndex, amountColumnIndexes }) => (
  <table className="w-full border-collapse text-[11px]">
    <thead>
      <tr>{headers.map((h) => <th key={h} className="border border-black p-2 text-center">{h}</th>)}</tr>
      <tr>{headers.map((_, i) => <th key={i} className="border border-black p-1 text-center italic">{i < 2 ? String.fromCharCode(65 + i) : i - 1}</th>)}</tr>
    </thead>
    <tbody>
      {rows.map((row, idx) => (
        <tr key={idx}>
          {headers.map((_, i) => {
            const isAmountCol = amountColumnIndexes
              ? amountColumnIndexes.includes(i)
              : amountColumnIndex != null && i === amountColumnIndex;
            const cell = row[i] ?? '';
            const bold =
              typeof cell === 'string' &&
              /Tổng cộng|Cộng |Cộng phát sinh|Cộng —|Số dư đầu kỳ|Số dư cuối kỳ|Đối tượng:|Tổng số thuế|Số thuế GTGT|Số thuế TNDN|Số phát sinh|^1\. |^2\. |^3\. |^4\. |^5\. /.test(
                cell,
              );
            return (
              <td
                key={i}
                className={`border border-black p-2 min-h-8 ${isAmountCol ? 'text-right' : i === 2 ? 'text-left' : 'text-center'} ${bold ? 'font-bold' : ''}`}
              >
                {cell}
              </td>
            );
          })}
        </tr>
      ))}
    </tbody>
  </table>
);

const S2D_AMOUNT_COL_INDEXES = [3, 4];

const s2dDescBold = (desc: string) =>
  /Tổng tiền|tồn đầu kỳ|tồn cuối kỳ|^Tiền mặt$|^Tiền gửi không kỳ hạn|^Ngân hàng/i.test(desc);

const s2dDescItalic = (desc: string) =>
  /^Ngân hàng/.test(desc) || /^\.{4,}/.test(desc);

const S2dLedgerTable: React.FC<{ rows: (string | number)[][] }> = ({ rows }) => (
  <div className="tt58-s2d-table-wrap overflow-x-auto print:overflow-visible">
    <table className="tt58-s2d-table w-full border-collapse table-fixed text-[11px] leading-snug print:text-[9pt] print:leading-tight">
      <colgroup>
        <col className="w-[11%]" />
        <col className="w-[11%]" />
        <col className="w-[46%]" />
        <col className="w-[16%]" />
        <col className="w-[16%]" />
      </colgroup>
      <thead>
        <tr>
          <th
            colSpan={2}
            className="border border-black px-2 py-1.5 text-center align-middle font-semibold print:px-1 print:py-1"
          >
            Hóa đơn, Chứng từ
          </th>
          <th
            rowSpan={2}
            className="border border-black px-2 py-1.5 text-center align-middle font-semibold print:px-1 print:py-1"
          >
            Diễn giải
          </th>
          <th
            colSpan={2}
            className="border border-black px-2 py-1.5 text-center align-middle font-semibold print:px-1 print:py-1"
          >
            Số tiền
          </th>
        </tr>
        <tr>
          {TT58_S2D_HEADER_DISPLAY.map((h) => (
            <th
              key={h.code}
              className="border border-black px-2 py-1 text-center align-middle print:px-1 print:py-0.5"
            >
              <span className="block font-semibold leading-tight">{h.label}</span>
              <span className="mt-0.5 block text-[10px] font-normal italic print:text-[8pt]">
                ({h.code})
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const desc = String(row[2] ?? '');
          const bold = s2dDescBold(desc);
          const italic = s2dDescItalic(desc);
          return (
            <tr key={idx} className="print:break-inside-avoid">
              {TT58_S2D_HEADER_DISPLAY.map((_, i) => {
                const isAmountCol = S2D_AMOUNT_COL_INDEXES.includes(i);
                const isDescCol = i === 2;
                const cell = row[i] ?? '';
                return (
                  <td
                    key={i}
                    title={String(cell)}
                    className={[
                      'border border-black px-2 py-1.5 min-h-7 align-top overflow-hidden print:px-1 print:py-0.5 print:min-h-0',
                      isAmountCol ? 'text-right whitespace-nowrap print:text-[8.5pt]' : '',
                      isDescCol ? `text-left break-words whitespace-normal ${italic ? 'italic' : ''}` : 'text-center',
                      i < 2 ? 'whitespace-nowrap' : '',
                      bold ? 'font-bold' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {cell}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const S4C_AMOUNT_COL_INDEXES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const S4cLedgerTemplate: React.FC<{
  rows: (string | number)[][];
}> = ({ rows }) => (
  <div className="tt58-s4c-table-wrap overflow-x-auto print:overflow-visible">
    <table
      className="tt58-s4c-table w-full min-w-[72rem] border-collapse table-fixed text-[10px] leading-tight print:!min-w-0 print:!w-full print:text-[6.5pt] print:leading-[1.1]"
    >
      <colgroup>
        {TT58_S4C_COL_WIDTHS.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {TT58_S4C_HEADER_DISPLAY.map((h) => (
            <th
              key={h.code}
              className="border border-black px-1 py-1.5 text-center align-middle overflow-hidden print:px-0.5 print:py-0.5"
            >
              <span className="hidden print:block break-words font-semibold leading-[1.1]">
                {h.printLabel || h.label}
                <span className="block text-[5.5pt] font-normal italic">({h.code})</span>
              </span>
              <span className="block break-words hyphens-auto font-semibold leading-[1.2] print:hidden">
                {h.label}
              </span>
              <span className="mt-0.5 block text-[9px] font-normal italic print:hidden">
                ({h.code})
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx}>
            {TT58_S4C_HEADER_DISPLAY.map((_, i) => {
              const isAmountCol = S4C_AMOUNT_COL_INDEXES.includes(i);
              const isDescCol = i === 1;
              const cell = row[i] ?? '';
              const cellStr = String(cell);
              const bold =
                typeof cell === 'string' &&
                /Tổng cộng|Cộng |Cộng —|^1\. |^2\. |^3\. |^4\. |^5\. /.test(cellStr);
              return (
                <td
                  key={i}
                  title={cellStr}
                  className={[
                    'border border-black px-1 py-1.5 min-h-7 align-top overflow-hidden print:px-0.5 print:py-0.5 print:min-h-0',
                    isAmountCol ? 'text-right whitespace-nowrap text-ellipsis print:text-[6pt]' : '',
                    isDescCol ? 'text-left break-words whitespace-normal' : 'text-center',
                    i === 0 ? 'whitespace-nowrap' : '',
                    bold ? 'font-bold' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {cell}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

function renderS3bDnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
) {
  const year = getYear(financialYear);
  const s3b = computeTt58S3bDnsnLedger(entries, financialYear);
  const detailCount = s3b.rows.filter((r) => r.kind === 'detail').length;
  const subtitle =
    detailCount > 0
      ? `Năm ${year} — ${detailCount} chứng từ phát sinh`
      : `Năm ${year}`;

  return (
    <ReportShell
      formNo="S3b-DNSN"
      title="SỔ THEO DÕI NGHĨA VỤ THUẾ GTGT"
      subtitle={subtitle}
      companyInfo={companyInfo}
    >
      <LedgerTemplate
        headers={TT58_S3B_HEADERS}
        rows={tt58S3bRowsToTable(s3b, (v) => fmt(v))}
        amountColumnIndexes={[3, 4]}
      />
    </ReportShell>
  );
}

function renderS4cDnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
  invoices: Invoice[],
) {
  const year = getYear(financialYear);
  const s4c = computeTt58S4cDnsnLedger(entries, financialYear, invoices);
  const lineCount = s4c.sections.reduce(
    (n, s) => n + s.rows.filter((r) => r.kind === 'detail').length,
    0,
  );
  const subtitle =
    lineCount > 0 ? `Năm ${year} — ${lineCount} dòng phát sinh` : `Năm ${year}`;

  return (
    <ReportShell
      formNo="S4c-DNSN"
      title="SỔ THEO DÕI NGHĨA VỤ THUẾ KHÁC"
      subtitle={subtitle}
      companyInfo={companyInfo}
      wideLayout
      printLayout="a4-landscape"
    >
      <S4cLedgerTemplate rows={tt58S4cRowsToTable(s4c, (v) => fmt(v))} />
    </ReportShell>
  );
}

function renderS4dDnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
) {
  const year = getYear(financialYear);
  const s4d = computeTt58S4dDnsnLedger(entries, financialYear);
  const sectionCount = s4d.sections.filter((s) => s.sectionId !== 'empty').length;
  const subtitle =
    sectionCount > 0 ? `Năm ${year} — ${sectionCount} nhóm vốn chủ sở hữu` : `Năm ${year}`;

  return (
    <ReportShell
      formNo="S4d-DNSN"
      title="SỔ THEO DÕI VỐN CHỦ SỞ HỮU"
      subtitle={subtitle}
      companyInfo={companyInfo}
    >
      <LedgerTemplate
        headers={TT58_S4D_HEADERS}
        rows={tt58S4dRowsToTable(s4d, (v) => fmt(v))}
        amountColumnIndexes={[3, 4, 5]}
      />
    </ReportShell>
  );
}

function renderS4bDnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
  assets: Asset[],
) {
  const year = getYear(financialYear);
  const s4b = computeTt58S4bDnsnLedger(assets, entries, financialYear);
  const groupCount = s4b.groups.filter((g) => g.groupId !== 'empty').length;
  const assetCount = assets.filter((a) => a.type === 'TSCĐ' || String(a.assetAccount || '').startsWith('211')).length;
  const subtitle =
    groupCount > 0
      ? `Năm ${year} — ${groupCount} loại TSCĐ${assetCount > 0 ? ` (${assetCount} tài sản)` : ''}`
      : `Năm ${year}`;

  return (
    <ReportShell formNo="S4b-DNSN" title="SỔ TÀI SẢN CỐ ĐỊNH" subtitle={subtitle} companyInfo={companyInfo}>
      <LedgerTemplate
        headers={TT58_S4B_HEADERS}
        rows={tt58S4bRowsToTable(s4b, (v) => fmt(v))}
        amountColumnIndexes={[4, 5, 6, 7]}
      />
    </ReportShell>
  );
}

function renderS4aDnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
  fundTransactions: FundTransaction[],
) {
  const year = getYear(financialYear);
  const s4a = computeTt58S4aDnsnLedger(entries, fundTransactions, financialYear);
  const partnerCount = s4a.sections.filter((s) => s.sectionId !== 'empty').length;
  const subtitle =
    partnerCount > 0
      ? `Năm ${year} — ${partnerCount} đối tượng công nợ`
      : `Năm ${year}`;

  return (
    <ReportShell formNo="S4a-DNSN" title="SỔ CHI TIẾT THANH TOÁN CÔNG NỢ" subtitle={subtitle} companyInfo={companyInfo}>
      <LedgerTemplate
        headers={TT58_S4A_HEADERS}
        rows={tt58S4aRowsToTable(s4a, (v) => fmt(v))}
        amountColumnIndexes={[3, 4, 5, 6, 7, 8]}
      />
    </ReportShell>
  );
}

function renderS2dDnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  fundTransactions: FundTransaction[],
  bankAccounts: BankAccount[],
  openingBalanceAccounts: OpeningBalanceAccountRecord[],
  cashFlowOpening: Record<string, number>,
) {
  const year = getYear(financialYear);
  const s2d = computeTt58S2dDnsnLedger(
    fundTransactions,
    bankAccounts,
    openingBalanceAccounts,
    cashFlowOpening,
    financialYear,
  );
  return (
    <ReportShell
      formNo="S2d-DNSN"
      title="SỔ CHI TIẾT TIỀN"
      subtitle={`Năm: ${year}`}
      companyInfo={companyInfo}
      printLayout="a4-portrait"
    >
      <S2dLedgerTable rows={tt58S2dRowsToTable(s2d, (v) => fmt(v))} />
    </ReportShell>
  );
}

function renderS2cDnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  inventory: InventoryItem[],
  inventoryCatalog: InventoryItem[],
  transactions: InventoryTransaction[],
) {
  const year = getYear(financialYear);
  const data = computeTt58S2cDnsnLedger(inventory, inventoryCatalog, transactions, financialYear);
  const subtitle =
    data.items.length === 1
      ? `${data.items[0].itemName}${data.items[0].sku ? ` (${data.items[0].sku})` : ''} — Năm ${year}`
      : `Năm ${year}${data.items.length > 0 ? ` — ${data.items.length} mặt hàng` : ''}`;

  return (
    <ReportShell
      formNo="S2c-DNSN"
      title="SỔ CHI TIẾT VẬT LIỆU, DỤNG CỤ, SẢN PHẨM, HÀNG HÓA"
      subtitle={subtitle}
      companyInfo={companyInfo}
    >
      {data.items.length === 0 ? (
        <p className="text-sm italic">Chưa có phát sinh nhập, xuất, tồn kho trong kỳ.</p>
      ) : (
        data.items.map((item: Tt58S2cItemLedger) => (
          <div key={item.itemId} className="mb-10 break-inside-avoid">
            {data.items.length > 1 && (
              <p className="mb-2 font-bold">
                Tên vật liệu, dụng cụ, sản phẩm, hàng hóa: {item.itemName}
                {item.sku ? ` — Mã: ${item.sku}` : ''} — ĐVT: {item.unit || '...'}
              </p>
            )}
            <S2cLedgerTable rows={item.rows.map((r) => tt58S2cRowToTableRow(r, (v) => fmt(v)))} />
          </div>
        ))
      )}
    </ReportShell>
  );
}

function renderS3aDnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
  invoices: Invoice[],
  profile?: Tt58TaxBookProfile,
  regime?: AccountingRegimeConfig,
) {
  const year = getYear(financialYear);
  const s3a = computeTt58S3aDnsnLedger(invoices, entries, financialYear, profile, regime);
  return (
    <ReportShell formNo="S3a-DNSN" title="SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ" subtitle={`Năm: ${year}`} companyInfo={companyInfo}>
      <LedgerTemplate
        headers={['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền']}
        rows={tt58S3aDnsnRowsToTable(s3a, (v) => fmt(v))}
        amountColumnIndex={3}
      />
    </ReportShell>
  );
}

function renderS2bDnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
  invoices: Invoice[],
) {
  const year = getYear(financialYear);
  const s2b = computeTt58S2bDnsnLedger(invoices, entries, financialYear);
  return (
    <ReportShell formNo="S2b-DNSN" title="SỔ CHI TIẾT DOANH THU, CHI PHÍ" subtitle={`Năm: ${year}`} companyInfo={companyInfo}>
      <LedgerTemplate
        headers={['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền']}
        rows={tt58S2bDnsnRowsToTable(s2b, (v) => fmt(v))}
        amountColumnIndex={3}
      />
    </ReportShell>
  );
}

function renderS2aDnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
  invoices: Invoice[],
  profile?: Tt58TaxBookProfile,
  regime?: AccountingRegimeConfig,
) {
  const year = getYear(financialYear);
  const s2a = computeTt58S2aDnsnLedger(invoices, entries, financialYear, profile, regime);
  return (
    <ReportShell formNo="S2a-DNSN" title="DOANH THU BÁN HÀNG HÓA, DỊCH VỤ" subtitle={`Năm: ${year}`} companyInfo={companyInfo}>
      <LedgerTemplate
        headers={['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền']}
        rows={tt58S2aDnsnRowsToTable(s2a, (v) => fmt(v))}
        amountColumnIndex={3}
      />
    </ReportShell>
  );
}

function renderS1Dnsn(
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
  invoices: Invoice[],
  profile?: Tt58TaxBookProfile,
  regime?: AccountingRegimeConfig,
) {
  const year = getYear(financialYear);
  const s1 = computeTt58S1DnsnLedger(invoices, entries, financialYear, profile, regime);
  return (
    <ReportShell formNo="S1-DNSN" title="SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ" subtitle={`Năm: ${year}`} companyInfo={companyInfo}>
      <LedgerTemplate
        headers={['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền']}
        rows={tt58S1DnsnRowsToTable(s1, (v) => fmt(v))}
        amountColumnIndex={3}
      />
    </ReportShell>
  );
}

function renderLedger(
  report: Tt58ReportType,
  companyInfo: CompanyInfo,
  financialYear: FinancialYear,
  entries: JournalEntry[],
  invoices: Invoice[],
  profile?: Tt58TaxBookProfile,
  regime?: AccountingRegimeConfig,
  inventory?: InventoryItem[],
  inventoryCatalog?: InventoryItem[],
  warehouseTransactions?: InventoryTransaction[],
  fundTransactions?: FundTransaction[],
  bankAccounts?: BankAccount[],
  openingBalanceAccounts?: OpeningBalanceAccountRecord[],
  cashFlowOpening?: Record<string, number>,
  assets?: Asset[],
) {
  if (report === 'S1_DNSN') {
    return renderS1Dnsn(companyInfo, financialYear, entries, invoices, profile, regime);
  }
  if (report === 'S2A_DNSN') {
    return renderS2aDnsn(companyInfo, financialYear, entries, invoices, profile, regime);
  }
  if (report === 'S2B_DNSN') {
    return renderS2bDnsn(companyInfo, financialYear, entries, invoices);
  }
  if (report === 'S3A_DNSN') {
    return renderS3aDnsn(companyInfo, financialYear, entries, invoices, profile, regime);
  }

  if (report === 'S2C_DNSN') {
    return renderS2cDnsn(
      companyInfo,
      financialYear,
      inventory || [],
      inventoryCatalog || [],
      warehouseTransactions || [],
    );
  }

  if (report === 'S2D_DNSN') {
    return renderS2dDnsn(
      companyInfo,
      financialYear,
      fundTransactions || [],
      bankAccounts || [],
      openingBalanceAccounts || [],
      cashFlowOpening || {},
    );
  }

  if (report === 'S3B_DNSN') {
    return renderS3bDnsn(companyInfo, financialYear, entries);
  }

  if (report === 'S4A_DNSN') {
    return renderS4aDnsn(companyInfo, financialYear, entries, fundTransactions || []);
  }

  if (report === 'S4B_DNSN') {
    return renderS4bDnsn(companyInfo, financialYear, entries, assets || []);
  }

  if (report === 'S4C_DNSN') {
    return renderS4cDnsn(companyInfo, financialYear, entries, invoices);
  }

  if (report === 'S4D_DNSN') {
    return renderS4dDnsn(companyInfo, financialYear, entries);
  }

  return null;
}

async function exportRowsToExcel(activeReport: Tt58ReportType, rows: unknown[][], companyInfo: CompanyInfo, year: number) {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, activeReport);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const taxCode = String(companyInfo.taxCode || '').replace(/\D/g, '') || 'MST';
  await saveBlobWithPicker(blob, `${activeReport}_${taxCode}_${year}.xlsx`, [
    { description: 'Excel Spreadsheet', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } },
  ]);
}

function getExcelRows(
  activeReport: Tt58ReportType,
  entries: JournalEntry[],
  financialYear: FinancialYear,
  companyInfo: CompanyInfo,
  invoices: Invoice[],
  profile?: Tt58TaxBookProfile,
  regime?: AccountingRegimeConfig,
  inventory?: InventoryItem[],
  inventoryCatalog?: InventoryItem[],
  warehouseTransactions?: InventoryTransaction[],
  fundTransactions?: FundTransaction[],
  bankAccounts?: BankAccount[],
  openingBalanceAccounts?: OpeningBalanceAccountRecord[],
  cashFlowOpening?: Record<string, number>,
  assets?: Asset[],
): unknown[][] {
  const year = getYear(financialYear);
  if (activeReport === 'B01_DNSN') {
    const data = computeTt58B01DnsnData(entries, financialYear);
    return [['B01-DNSN: Báo cáo tình hình tài chính'], [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`], [`Năm: ${year}`], [], ['Chỉ tiêu', 'Mã số', 'Số cuối năm', 'Số đầu năm'], ...data.rows.map((r) => [r.label, r.code, r.value, r.beginValue || 0])];
  }
  if (activeReport === 'B02_DNSN') {
    const b02Rows = computeTt58B02DnsnRows(entries, financialYear);
    return [
      ['B02-DNSN: Báo cáo kết quả hoạt động kinh doanh'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      ['Chỉ tiêu', 'Mã số', 'Năm nay', 'Năm trước'],
      ...b02Rows.map((r) => [r.label, r.code, r.value, r.beginValue ?? 0]),
    ];
  }
  if (activeReport === 'S1_DNSN') {
    const s1 = computeTt58S1DnsnLedger(invoices, entries, financialYear, profile, regime);
    return [
      ['S1-DNSN: Sổ doanh thu bán hàng hóa, dịch vụ'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      ['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền'],
      ...tt58S1DnsnRowsToTable(s1, (v) => v),
    ];
  }
  if (activeReport === 'S2A_DNSN') {
    const s2a = computeTt58S2aDnsnLedger(invoices, entries, financialYear, profile, regime);
    return [
      ['S2a-DNSN: Doanh thu bán hàng hóa, dịch vụ'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      ['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền'],
      ...tt58S2aDnsnRowsToTable(s2a, (v) => v),
    ];
  }
  if (activeReport === 'S2B_DNSN') {
    const s2b = computeTt58S2bDnsnLedger(invoices, entries, financialYear);
    return [
      ['S2b-DNSN: Sổ chi tiết doanh thu, chi phí'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      ['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền'],
      ...tt58S2bDnsnRowsToTable(s2b, (v) => v),
    ];
  }
  if (activeReport === 'S3A_DNSN') {
    const s3a = computeTt58S3aDnsnLedger(invoices, entries, financialYear, profile, regime);
    return [
      ['S3a-DNSN: Sổ doanh thu và TNDN'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      ['Số hiệu', 'Ngày, tháng', 'Diễn giải', 'Số tiền'],
      ...tt58S3aDnsnRowsToTable(s3a, (v) => v),
    ];
  }
  if (activeReport === 'S2C_DNSN') {
    const s2c = computeTt58S2cDnsnLedger(inventory, inventoryCatalog, warehouseTransactions, financialYear);
    const rows: unknown[][] = [
      ['S2c-DNSN: Sổ chi tiết vật liệu, dụng cụ, sản phẩm, hàng hóa'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
    ];
    for (const item of s2c.items) {
      rows.push([`Mặt hàng: ${item.itemName}`, item.sku ? `Mã: ${item.sku}` : '', `ĐVT: ${item.unit}`]);
      rows.push(TT58_S2C_HEADERS);
      rows.push(TT58_S2C_COLUMN_LABELS);
      for (const r of item.rows) {
        rows.push(tt58S2cRowToTableRow(r, (v) => v));
      }
      rows.push([]);
    }
    return rows;
  }
  if (activeReport === 'S2D_DNSN') {
    const s2d = computeTt58S2dDnsnLedger(
      fundTransactions,
      bankAccounts,
      openingBalanceAccounts,
      cashFlowOpening,
      financialYear,
    );
    return [
      ['S2d-DNSN: Sổ chi tiết tiền'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      TT58_S2D_HEADERS,
      ...tt58S2dRowsToTable(s2d, (v) => v),
    ];
  }
  if (activeReport === 'S4A_DNSN') {
    const s4a = computeTt58S4aDnsnLedger(entries, fundTransactions, financialYear);
    return [
      ['S4a-DNSN: Sổ chi tiết thanh toán công nợ'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      TT58_S4A_HEADERS,
      ...tt58S4aRowsToTable(s4a, (v) => v),
    ];
  }
  if (activeReport === 'S4B_DNSN') {
    const s4b = computeTt58S4bDnsnLedger(assets, entries, financialYear);
    return [
      ['S4b-DNSN: Sổ tài sản cố định'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      TT58_S4B_HEADERS,
      ...tt58S4bRowsToTable(s4b, (v) => v),
    ];
  }
  if (activeReport === 'S4D_DNSN') {
    const s4d = computeTt58S4dDnsnLedger(entries, financialYear);
    return [
      ['S4d-DNSN: Sổ theo dõi vốn chủ sở hữu'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      TT58_S4D_HEADERS,
      ...tt58S4dRowsToTable(s4d, (v) => v),
    ];
  }
  if (activeReport === 'S3B_DNSN') {
    const s3b = computeTt58S3bDnsnLedger(entries, financialYear);
    return [
      ['S3b-DNSN: Sổ theo dõi nghĩa vụ thuế GTGT'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      TT58_S3B_HEADERS,
      ...tt58S3bRowsToTable(s3b, (v) => v),
    ];
  }
  if (activeReport === 'S4C_DNSN') {
    const s4c = computeTt58S4cDnsnLedger(entries, financialYear, invoices);
    return [
      ['S4c-DNSN: Sổ theo dõi nghĩa vụ thuế khác'],
      [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`],
      [`Năm: ${year}`],
      [],
      TT58_S4C_HEADERS,
      ...tt58S4cRowsToTable(s4c, (v) => v),
    ];
  }
  const label = REPORT_ITEMS.find((x) => x.id === activeReport)?.label || activeReport;
  return [[label], [`Đơn vị: ${companyInfo.name}`, `MST: ${companyInfo.taxCode}`], [`Năm: ${year}`]];
}

const reportTabBtnClass = (isOpen: boolean, sectionActive: boolean) => {
  const on = isOpen || sectionActive;
  return [
    'flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-bold shadow-sm transition-all duration-150',
    on
      ? 'border-blue-400 bg-blue-50 text-blue-950 ring-1 ring-blue-200/60'
      : 'border-slate-200 bg-white text-slate-800 hover:border-blue-200 hover:bg-blue-50/80',
  ].join(' ');
};

export const Report58: React.FC = () => {
  const {
    journalEntries,
    financialYear,
    companyInfo,
    invoices,
    systemConfig,
    inventory,
    inventoryCatalog,
    transactions: warehouseTransactions,
    fundTransactions,
    bankAccounts,
    openingBalanceAccounts,
    cashFlowOpening,
    assets,
  } = useApp();
  const assetList = asArray<Asset>(assets);
  const accountingRegime = systemConfig?.accountingRegime;
  const tt58Profile = accountingRegime?.tt58TaxBookProfile;
  const salesInvoices = asArray<Invoice>(invoices);
  const entries = asArray<JournalEntry>(journalEntries);
  const safeFY = useMemo<FinancialYear>(() => {
    if (financialYear?.startDate && financialYear?.endDate) return financialYear;
    const y = new Date().getFullYear();
    return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
  }, [financialYear]);
  const [activeReport, setActiveReport] = useState<Tt58ReportType>('B01_DNSN');
  const [openDropdown, setOpenDropdown] = useState<Tt58DropdownGroupId | null>(null);
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState<LedgerPageSize>(20);
  const navRef = useRef<HTMLDivElement>(null);
  const [signatures, setSignatures] = useState<Tt58ReportSignatures>(defaultSignatures);
  const b01 = useMemo(() => computeTt58B01DnsnData(entries, safeFY), [entries, safeFY]);
  const year = getYear(safeFY);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(tt58SignaturesStorageKey(companyInfo.taxCode));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Tt58ReportSignatures>;
        setSignatures((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      /* ignore */
    }
  }, [companyInfo.taxCode]);

  const updateSignatures = useCallback(
    (patch: Partial<Tt58ReportSignatures>) => {
      setSignatures((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(tt58SignaturesStorageKey(companyInfo.taxCode), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [companyInfo.taxCode],
  );

  const signaturesContextValue = useMemo(
    () => ({ signatures, updateSignatures }),
    [signatures, updateSignatures],
  );

  const activeReportLabel =
    REPORT_ITEMS.find((x) => x.id === activeReport)?.label || activeReport;

  const ledgerViewConfig = useMemo(
    () =>
      isTt58LedgerReport(activeReport)
        ? buildLedgerViewConfig(
            activeReport,
            companyInfo,
            safeFY,
            entries,
            salesInvoices,
            tt58Profile,
            accountingRegime,
            inventory,
            inventoryCatalog,
            warehouseTransactions,
            fundTransactions,
            bankAccounts,
            openingBalanceAccounts,
            cashFlowOpening,
            assetList,
          )
        : null,
    [
      activeReport,
      companyInfo,
      safeFY,
      entries,
      salesInvoices,
      tt58Profile,
      accountingRegime,
      inventory,
      inventoryCatalog,
      warehouseTransactions,
      fundTransactions,
      bankAccounts,
      openingBalanceAccounts,
      cashFlowOpening,
      assetList,
    ],
  );

  const selectReport = (id: Tt58ReportType) => {
    setActiveReport(id);
    setOpenDropdown(null);
    setLedgerPage(1);
    if (isTt58LedgerReport(id)) {
      setLedgerModalOpen(true);
    } else {
      setLedgerModalOpen(false);
    }
  };

  useEffect(() => {
    setLedgerPage(1);
  }, [activeReport, ledgerPageSize]);

  useEffect(() => {
    if (!openDropdown) return;
    const onPointerDown = (e: MouseEvent) => {
      const el = navRef.current;
      if (el && !el.contains(e.target as Node)) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [openDropdown]);

  const getDropdownButtonLabel = (group: (typeof DROPDOWN_GROUPS)[number]) => {
    const activeInGroup = REPORT_ITEMS.find(
      (item) => item.group === group.reportGroup && item.id === activeReport,
    );
    return activeInGroup?.label || group.placeholder;
  };

  const isGroupActive = (group: (typeof DROPDOWN_GROUPS)[number]) =>
    REPORT_ITEMS.some((item) => item.group === group.reportGroup && item.id === activeReport);

  const renderContent = () => {
    if (activeReport === 'B01_DNSN') {
      return (
        <ReportShell formNo="B01-DNSN" title="BÁO CÁO TÌNH HÌNH TÀI CHÍNH" subtitle={`Năm: ${year}`} companyInfo={companyInfo}>
          <StatementTable rows={b01.rows} hasBegin />
          {!b01.isBalanced && <div className="mt-3 text-sm font-bold text-red-700">Cảnh báo: Mã 200 chưa bằng Mã 500 (Tổng cộng nguồn vốn). Chênh lệch: {fmt(b01.diff)}</div>}
        </ReportShell>
      );
    }
    if (activeReport === 'B02_DNSN') {
      return (
        <ReportShell formNo="B02-DNSN" title="BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH" subtitle={`Năm: ${year}`} companyInfo={companyInfo}>
          <B02StatementTable rows={computeTt58B02DnsnRows(entries, safeFY)} />
        </ReportShell>
      );
    }
    if (isTt58LedgerReport(activeReport)) {
      return (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center print:hidden">
          <p className="max-w-md text-sm font-semibold text-slate-700">{activeReportLabel}</p>
          <p className="mt-2 max-w-md text-xs text-slate-500">
            Sổ kế toán hiển thị trong cửa sổ cuộn với phân trang 10, 20, 30, 50, 100 dòng.
          </p>
          <button
            type="button"
            onClick={() => setLedgerModalOpen(true)}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            Mở sổ kế toán
          </button>
        </div>
      );
    }
    return null;
  };

  const exportExcel = async () => {
    await exportRowsToExcel(
      activeReport,
      getExcelRows(
        activeReport,
        entries,
        safeFY,
        companyInfo,
        salesInvoices,
        tt58Profile,
        accountingRegime,
        inventory,
        inventoryCatalog,
        warehouseTransactions,
        fundTransactions,
        bankAccounts,
        openingBalanceAccounts,
        cashFlowOpening,
        assetList,
      ),
      companyInfo,
      year,
    );
  };

  const isS4cReport = activeReport === 'S4C_DNSN';
  const isS2dReport = activeReport === 'S2D_DNSN';

  return (
    <Tt58SignaturesContext.Provider value={signaturesContextValue}>
    {isS2dReport ? (
      <style
        dangerouslySetInnerHTML={{
          __html: `
          @media print {
            @page { size: A4 portrait; margin: 12mm; }
            html, body, #root { height: auto !important; overflow: visible !important; }
            .tt58-report-s2d, .tt58-report-s2d .flex-1, .tt58-report-s2d .h-full {
              height: auto !important; overflow: visible !important;
            }
            .tt58-s2d-a4 { width: 100% !important; max-width: 100% !important; }
            .tt58-s2d-table-wrap { overflow: visible !important; width: 100% !important; }
            .tt58-s2d-table {
              width: 100% !important; table-layout: fixed !important;
              font-size: 9pt !important; line-height: 1.2 !important;
            }
            .tt58-s2d-table col:nth-child(1) { width: 11% !important; }
            .tt58-s2d-table col:nth-child(2) { width: 11% !important; }
            .tt58-s2d-table col:nth-child(3) { width: 46% !important; }
            .tt58-s2d-table col:nth-child(4) { width: 16% !important; }
            .tt58-s2d-table col:nth-child(5) { width: 16% !important; }
            .tt58-s2d-table thead { display: table-header-group; }
            .tt58-s2d-table th, .tt58-s2d-table td {
              overflow: hidden !important;
              word-break: break-word !important;
            }
            .tt58-s2d-table tr { page-break-inside: avoid; }
            .tt58-s2d-a4 .h-14 { height: 2.5rem !important; }
          }
        `,
        }}
      />
    ) : null}
    {isS4cReport ? (
      <style
        dangerouslySetInnerHTML={{
          __html: `
          @media print {
            @page { size: A4 landscape; margin: 8mm; }
            html, body, #root { height: auto !important; overflow: visible !important; }
            .tt58-report-s4c, .tt58-report-s4c .flex-1, .tt58-report-s4c .h-full {
              height: auto !important; overflow: visible !important;
            }
            .tt58-s4c-a4 { width: 100% !important; max-width: 100% !important; }
            .tt58-s4c-table-wrap { overflow: visible !important; width: 100% !important; }
            .tt58-s4c-table {
              width: 100% !important; min-width: 0 !important; max-width: 100% !important;
              table-layout: fixed !important;
            }
            .tt58-s4c-table col:nth-child(1) { width: 5.5% !important; }
            .tt58-s4c-table col:nth-child(2) { width: 18% !important; }
            .tt58-s4c-table col:nth-child(3) { width: 5.5% !important; }
            .tt58-s4c-table col:nth-child(4) { width: 5.5% !important; }
            .tt58-s4c-table col:nth-child(5) { width: 6.5% !important; }
            .tt58-s4c-table col:nth-child(6) { width: 4.5% !important; }
            .tt58-s4c-table col:nth-child(7) { width: 6.5% !important; }
            .tt58-s4c-table col:nth-child(8) { width: 6.5% !important; }
            .tt58-s4c-table col:nth-child(9) { width: 6.5% !important; }
            .tt58-s4c-table col:nth-child(10) { width: 6% !important; }
            .tt58-s4c-table col:nth-child(11) { width: 6% !important; }
            .tt58-s4c-table col:nth-child(12) { width: 6.5% !important; }
            .tt58-s4c-table col:nth-child(13) { width: 6% !important; }
            .tt58-s4c-table thead { display: table-header-group; }
            .tt58-s4c-table th, .tt58-s4c-table td {
              overflow: hidden !important;
              word-break: break-word !important;
            }
            .tt58-s4c-a4 .h-14 { height: 2.5rem !important; }
          }
        `,
        }}
      />
    ) : null}
    <div
      className={`h-full flex flex-col bg-slate-50 text-slate-900 ${
        isS4cReport ? 'tt58-report-s4c' : isS2dReport ? 'tt58-report-s2d' : ''
      }`}
    >
      <div ref={navRef} className="bg-white border-b border-slate-200 px-5 py-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black tracking-tight text-slate-900 sm:text-xl">
              Báo cáo và sổ kế toán TT58/2026
            </h2>
          </div>
          <div
            role="toolbar"
            aria-label="In và xuất báo cáo TT58"
            className="inline-flex shrink-0 items-stretch overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.04]"
          >
            <button
              type="button"
              onClick={() => window.print()}
              title="In báo cáo"
              className="inline-flex items-center gap-1 border-r border-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              <Printer className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
              In
            </button>
            <button
              type="button"
              onClick={exportExcel}
              title="Xuất Excel"
              className="inline-flex items-center gap-1 border-r border-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 active:bg-emerald-100/80"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Excel
            </button>
            <button
              type="button"
              onClick={() =>
                window.alert(
                  'XML HTKK cho B01/B02-DNSN sẽ bật sau khi HTKK công bố schema TT58/2026 chính thức.',
                )
              }
              title="Xuất XML HTKK"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-50 active:bg-amber-100/80"
            >
              <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
              XML
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {DROPDOWN_GROUPS.map((group) => {
            const items = REPORT_ITEMS.filter((item) => item.group === group.reportGroup);
            const isOpen = openDropdown === group.id;
            const sectionActive = isGroupActive(group);
            return (
              <div key={group.id} className="relative min-w-0">
                <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                  {group.title}
                </p>
                <button
                  type="button"
                  onClick={() => setOpenDropdown((d) => (d === group.id ? null : group.id))}
                  className={reportTabBtnClass(isOpen, sectionActive)}
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                >
                  <span className="min-w-0 flex-1 truncate leading-snug">
                    {getDropdownButtonLabel(group)}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
                {isOpen && (
                  <div
                    role="menu"
                    className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[min(50vh,14rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
                  >
                    {items.map((item) => {
                      const isActive = activeReport === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          onClick={() => selectReport(item.id)}
                          className={`flex w-full rounded-lg px-3 py-2 text-left text-xs font-bold leading-snug transition-colors ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/90 px-3 py-2">
          <p className="truncate text-xs font-semibold text-slate-700 sm:text-sm">
            <span className="text-slate-500">Đang xem: </span>
            {activeReportLabel}
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 print:p-0 print:overflow-visible print:bg-white">
        {renderContent()}
        {ledgerViewConfig ? (
          <div className="hidden print:block">
            {renderLedgerShellContent(ledgerViewConfig, ledgerViewConfig.allRows, companyInfo)}
          </div>
        ) : null}
      </div>
    </div>
    {ledgerViewConfig ? (
      <Tt58LedgerModal
        open={ledgerModalOpen}
        onClose={() => setLedgerModalOpen(false)}
        config={ledgerViewConfig}
        companyInfo={companyInfo}
        reportLabel={activeReportLabel}
        page={ledgerPage}
        pageSize={ledgerPageSize}
        onChangePage={setLedgerPage}
        onChangePageSize={setLedgerPageSize}
        onPrint={() => window.print()}
        onExportExcel={exportExcel}
      />
    ) : null}
    </Tt58SignaturesContext.Provider>
  );
};
