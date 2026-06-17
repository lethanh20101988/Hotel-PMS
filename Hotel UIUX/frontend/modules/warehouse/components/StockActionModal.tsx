import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Download, Upload, X, Plus, ScanBarcode, AlertCircle, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { BankAccountSnapshot, Bom154Category, InventoryItem } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { VAT_RATE_NOT_SUBJECT, formatVatRateLabel, vatAmountUnrounded } from '@shared/utils/vatRate';
import { roundInvoiceTotalsFromSums } from '@shared/utils/vndMoney';
import {
  buildBomPlannedStockLines,
  getBom154CategoryLabel,
  getBomDefinitionForParent,
  getBomStockShortages,
  hasBomPlannedStockVariance,
  isProductionExportPurpose,
  resolveBomDefinitionComponents,
} from '@shared/utils/bom';
import { useApp, type WarehouseFormHintsState } from '../../../app/store';
import { getWarehouseDocumentPrefix } from '@shared/utils/documentNumbering';
import { downloadStockActionTemplate, parseStockActionImportFile, type StockActionImportDraft } from '../utils/stockActionImport';
import { mergePartnerNameSuggestions } from '@shared/utils/partnerNameMemory';
import { paymentSegmentSoftUi } from '@shared/ui/paymentSegmentSoftUi';
import { getDefaultWarehouseId, getWarehouseScopedItem, mapItemsToWarehouseScope } from '@shared/utils/warehouseInventory';

interface StockActionModalProps {
  isOpen: boolean;
  type: 'IMPORT' | 'EXPORT';
  item: InventoryItem | null;
  items: InventoryItem[];
  onClose: () => void;
  onConfirm: (payload: {
    actionType?: 'IMPORT' | 'EXPORT';
    date: string;
    warehouseId?: string;
    warehouseName?: string;
    performer: string;
    note: string;
    supplier: string;
    documentRef: string;
    customer?: string;
    customerPhone?: string;
    customerAddress?: string;
    supplierPhone?: string;
    supplierAddress?: string;
    exportPurpose?: string;
    paymentStatus?: 'PAID' | 'PENDING';
    paymentMethod?: string;
    supplierTaxCode?: string;
    customerTaxCode?: string;
    formNo?: string;
    symbolCode?: string;
    costObjectType?: 'BOM_PARENT';
    costObjectId?: string;
    costObjectName?: string;
    costObjectSku?: string;
    bomDefinitionId?: string;
    bomParentQuantity?: number;
    bomVarianceReason?: string;
    lines: Array<{
      itemId: string;
      qty: number;
      price: number;
      vat: number;
      note?: string;
      serials: string;
      bomPlannedQuantity?: number;
      bomLossRate?: number;
      bomAccount154Category?: Bom154Category;
    }>;
  } & BankAccountSnapshot) => void;
}

const EXPORT_PURPOSES = [
  { code: '632', label: 'Xuất kho bán hàng (632)' },
  { code: '641', label: 'Xuất dùng bộ phận bán hàng (641)' },
  { code: '642', label: 'Xuất dùng bộ phận quản lý (642)' },
  { code: '154', label: 'Xuất chi phí SXKD dở dang (154)' },
  { code: '1541', label: 'Xuất dùng Lắp đặt/Thi công (1541)' },
  { code: '1542', label: 'Xuất dùng dịch vụ GPS/Phần mềm (1542)' },
  { code: '811', label: 'Xuất hao hụt/Kiểm kê thiếu (811)' },
  { code: '331', label: 'Xuất trả lại Nhà cung cấp (331)' },
];

type StockActionLine = {
  id: string;
  itemId: string;
  quantity: string;
  price: string;
  vatRate: number;
  note: string;
  serialInput: string;
  selectedSerial: string[];
};

export const StockActionModal: React.FC<StockActionModalProps> = ({ isOpen, type, item, items, onClose, onConfirm }) => {
  const {
    financialYear,
    customers,
    suppliers,
    warehouses,
    bankAccounts,
    bomDefinitions,
    previewDocumentNumber,
    handleInventoryActions,
    warehouseFormHints,
    patchWarehouseFormHints,
    transactions,
    partnerNameHistory,
    rememberPartnerName,
  } = useApp();

  const supplierNameOptions = useMemo(
    () =>
      mergePartnerNameSuggestions(
        'supplier',
        (suppliers || []).map((s) => s.name).filter(Boolean) as string[],
        partnerNameHistory,
      ),
    [suppliers, partnerNameHistory],
  );
  const customerNameOptions = useMemo(
    () =>
      mergePartnerNameSuggestions(
        'customer',
        (customers || []).map((c) => c.name).filter(Boolean) as string[],
        partnerNameHistory,
      ),
    [customers, partnerNameHistory],
  );

  const [lines, setLines] = useState<StockActionLine[]>(() => [{
    id: '1',
    itemId: item?.id || '',
    quantity: '',
    price: '',
    vatRate: 0,
    note: '',
    serialInput: '',
    selectedSerial: []
  }]);
  const [activeLineId, setActiveLineId] = useState('1');

  const [performer, setPerformer] = useState('Admin');
  const [note, setNote] = useState('');
  const [trxDate, setTrxDate] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  
  const [scanCode, setScanCode] = useState('');
  const [supplier, setSupplier] = useState('');
  const [supplierTaxCode, setSupplierTaxCode] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'PENDING'>('PENDING');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [formNo, setFormNo] = useState('');
  const [symbolCode, setSymbolCode] = useState('');
  const [customer, setCustomer] = useState('');
  const [customerTaxCode, setCustomerTaxCode] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [exportPurpose, setExportPurpose] = useState('632');
  const [bomParentItemId, setBomParentItemId] = useState('');
  const [bomParentQuantity, setBomParentQuantity] = useState('1');
  const [bomVarianceReason, setBomVarianceReason] = useState('');
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Tránh reset lại toàn bộ form khi đổi kho (scopedItems / warehouseFormHints đổi) — ghi đè ô «Kho thực hiện». */
  const stockModalInitRef = useRef(false);
  const [importedBatches, setImportedBatches] = useState<StockActionImportDraft[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importSkippedRows, setImportSkippedRows] = useState<string[]>([]);
  const bomReferenceDate = String(trxDate || new Date().toISOString()).split('T')[0];
  const defaultWarehouseId = useMemo(() => getDefaultWarehouseId(warehouses), [warehouses]);
  const selectedWarehouseId = String(warehouseId || defaultWarehouseId).trim() || defaultWarehouseId;
  const selectedWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === selectedWarehouseId) || warehouses[0] || null,
    [warehouses, selectedWarehouseId],
  );
  const scopedItems = useMemo(
    () => mapItemsToWarehouseScope(items, selectedWarehouseId, defaultWarehouseId),
    [items, selectedWarehouseId, defaultWarehouseId],
  );
  /** Trùng tên → thêm SKU trong option để phân biệt; còn lại chỉ hiện tên (SKU nằm dưới ô chọn). */
  const scopedItemDuplicateNameKeys = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of scopedItems) {
      const k = String(i.name || '')
        .trim()
        .toLowerCase();
      const key = k || `__id__${i.id}`;
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [scopedItems]);
  const scopedItemOptionLabel = (i: InventoryItem) => {
    const k = String(i.name || '')
      .trim()
      .toLowerCase();
    const key = k || `__id__${i.id}`;
    const dup = (scopedItemDuplicateNameKeys.get(key) || 0) > 1;
    const name = String(i.name || '').trim() || '(Không tên)';
    if (dup) return `${name} (${String(i.sku || '').trim() || '—'})`;
    return name;
  };

  const findSupplierByName = (name: string) => {
    const n = (name || '').trim().toLowerCase();
    if (!n) return undefined;
    return (suppliers || []).find(s => (s.name || '').trim().toLowerCase() === n);
  };
  const findCustomerByName = (name: string) => {
    const n = (name || '').trim().toLowerCase();
    if (!n) return undefined;
    return (customers || []).find(c => (c.name || '').trim().toLowerCase() === n);
  };
  const resolveWarehouseId = (raw?: string) => {
    const normalized = String(raw || '').trim().toLowerCase();
    if (!normalized) return defaultWarehouseId;
    const matched = (warehouses || []).find((warehouse) => {
      const byId = String(warehouse.id || '').trim().toLowerCase();
      const byCode = String(warehouse.code || '').trim().toLowerCase();
      const byName = String(warehouse.name || '').trim().toLowerCase();
      return normalized === byId || normalized === byCode || normalized === byName;
    });
    return matched?.id || defaultWarehouseId;
  };
  const resolveWarehouseName = (raw?: string) => {
    const resolvedId = resolveWarehouseId(raw);
    return warehouses.find((warehouse) => warehouse.id === resolvedId)?.name || selectedWarehouse?.name || '';
  };
  const createEmptyLine = (id = '1'): StockActionLine => ({
    id,
    itemId: '',
    quantity: '',
    price: '',
    vatRate: 0,
    note: '',
    serialInput: '',
    selectedSerial: [],
  });
  const isProductionExport = type === 'EXPORT' && isProductionExportPurpose(exportPurpose);
  const getDefaultLinePrice = (inventoryItem?: InventoryItem | null) => {
    if (!inventoryItem) return '';
    const nextPrice = type === 'IMPORT' || isProductionExport ? inventoryItem.costPrice : inventoryItem.sellingPrice;
    return String(nextPrice ?? 0);
  };
  const bomParentOptions = useMemo(
    () =>
      Array.from(
        new Map(
          (bomDefinitions || [])
            .map((definition) =>
              getBomDefinitionForParent(bomDefinitions, definition.parentItemId, bomReferenceDate),
            )
            .filter((definition): definition is NonNullable<typeof definition> => Boolean(definition))
            .map((definition) => [definition.parentItemId, items.find((entry) => entry.id === definition.parentItemId)]),
        ).values(),
      )
        .filter((entry): entry is InventoryItem => Boolean(entry))
        .sort((a, b) => `${a.sku || ''} ${a.name || ''}`.localeCompare(`${b.sku || ''} ${b.name || ''}`, 'vi')),
    [bomDefinitions, bomReferenceDate, items],
  );
  const bomParentQuantityNumber = Math.max(0, Number(bomParentQuantity || 0));
  const selectedBomParentItem = useMemo(
    () => items.find((entry) => entry.id === bomParentItemId) || null,
    [items, bomParentItemId],
  );
  const activeBomDefinition = useMemo(
    () => getBomDefinitionForParent(bomDefinitions, bomParentItemId, bomReferenceDate),
    [bomDefinitions, bomParentItemId, bomReferenceDate],
  );
  const resolvedBomComponents = useMemo(
    () => resolveBomDefinitionComponents(activeBomDefinition, scopedItems, bomParentQuantityNumber),
    [activeBomDefinition, scopedItems, bomParentQuantityNumber],
  );
  const nonStockBomComponents = useMemo(
    () => resolvedBomComponents.filter((entry) => !entry.isStockTracked),
    [resolvedBomComponents],
  );
  const plannedBomStockLines = useMemo(
    () => buildBomPlannedStockLines(activeBomDefinition, scopedItems, bomParentQuantityNumber),
    [activeBomDefinition, scopedItems, bomParentQuantityNumber],
  );
  const plannedBomLineMap = useMemo(() => {
    const map = new Map<
      string,
      {
        requiredQuantity: number;
        lossRate: number;
        account154Category: Bom154Category;
        note?: string;
      }
    >();
    for (const line of plannedBomStockLines) {
      map.set(line.item.id, {
        requiredQuantity: line.requiredQuantity,
        lossRate: line.component.lossRate,
        account154Category: line.component.account154Category,
        note: line.component.note,
      });
    }
    return map;
  }, [plannedBomStockLines]);
  const actualBomLines = useMemo(
    () =>
      (lines || [])
        .filter((line) => line.itemId && (parseFloat(line.quantity) || 0) > 0)
        .map((line) => ({
          itemId: line.itemId,
          qty: parseFloat(line.quantity) || 0,
        })),
    [lines],
  );
  const hasBomVariance = useMemo(() => {
    if (!isProductionExport || !activeBomDefinition) return false;
    return hasBomPlannedStockVariance(
      plannedBomStockLines.map((line) => ({
        itemId: line.item.id,
        requiredQuantity: line.requiredQuantity,
      })),
      actualBomLines,
    );
  }, [isProductionExport, activeBomDefinition, plannedBomStockLines, actualBomLines]);
  const plannedBomShortages = useMemo(() => {
    if (!isProductionExport || !activeBomDefinition) return [];
    return getBomStockShortages(
      plannedBomStockLines.map((line) => ({
        itemId: line.item.id,
        qty: line.requiredQuantity,
      })),
      scopedItems,
    );
  }, [isProductionExport, activeBomDefinition, plannedBomStockLines, scopedItems]);

  const activeLine = lines.find(l => l.id === activeLineId) || lines[0];
  const currentItem = scopedItems.find((i) => i.id === (activeLine?.itemId || ''));
  const qtyNum = Math.round(parseFloat(activeLine?.quantity || '') || 0);

  const serialMatchValidation = useMemo(() => {
    if (type === 'EXPORT') {
      if (!currentItem) return { isValid: true };
      if (!currentItem.serials || currentItem.serials.length === 0) return { isValid: true };
      const selectedCount = (activeLine?.selectedSerial || []).length;
      if (qtyNum !== selectedCount) {
        return { isValid: false, message: `Số lượng xuất (${qtyNum}) không khớp với số lượng Serial đã chọn (${selectedCount}).` };
      }
    } else {
      // IMPORT: chỉ kiểm tra khớp SL ↔ serial khi dòng đó có nhập serial (hàng không serial vẫn nhập được; Excel thường không có cột serial)
      for (const line of lines || []) {
        const q = Math.round(parseFloat(line.quantity || '') || 0);
        if (q <= 0) continue;
        const inputSerialList = (line.serialInput || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        if (inputSerialList.length > 0 && q !== inputSerialList.length) {
          return {
            isValid: false,
            message: `Số lượng nhập (${q}) không khớp với danh sách Serial (${inputSerialList.length}) trên một dòng.`,
          };
        }
      }
    }
    return { isValid: true };
  }, [type, qtyNum, activeLine?.selectedSerial, activeLine?.serialInput, currentItem, lines]);

  const isDateInvalid = useMemo(() => {
    if (!trxDate) return false;
    const checkDate = trxDate.split('T')[0];
    return checkDate < financialYear.startDate || checkDate > financialYear.endDate;
  }, [trxDate, financialYear]);
  const voucherNumberPreview = previewDocumentNumber(
    getWarehouseDocumentPrefix(type),
    trxDate || financialYear.startDate,
  );

  const allSerials = useMemo(() => {
    const parse = (s: string) => s.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
    if (type === 'IMPORT') return (lines || []).flatMap(l => parse(l.serialInput || ''));
    return (lines || []).flatMap(l => (l.selectedSerial || []).map(x => x.trim()).filter(Boolean));
  }, [lines, type]);
  const hasDuplicates = useMemo(() => new Set(allSerials).size !== allSerials.length, [allSerials]);
  const importedBatchStats = useMemo(() => ({
    totalLines: importedBatches.reduce((sum, batch) => sum + (batch.lines?.length || 0), 0),
    totalSerials: importedBatches.reduce(
      (sum, batch) => sum + batch.lines.reduce((lineSum, line) => {
        const serialCount = type === 'IMPORT'
          ? (line.serialInput || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length
          : (line.selectedSerial || []).length;
        return lineSum + serialCount;
      }, 0),
      0,
    ),
  }), [importedBatches, type]);

  const vatValidation = useMemo(() => {
    if (type === 'IMPORT' || !currentItem || (activeLine?.selectedSerial || []).length === 0) return { isValid: true, mismatchSerials: [] };
    const mismatches: { serial: string, inboundRate: number }[] = [];
    (activeLine?.selectedSerial || []).forEach(s => {
      const detail = currentItem.serialDetails?.find(sd => sd.serial === s);
      if (detail && detail.inboundVatRate !== (activeLine?.vatRate || 0)) {
        mismatches.push({ serial: s, inboundRate: detail.inboundVatRate });
      }
    });
    return { isValid: mismatches.length === 0, mismatchSerials: mismatches };
  }, [type, currentItem, activeLine?.selectedSerial, activeLine?.vatRate]);
  const activeBankAccounts = useMemo(
    () => bankAccounts.filter((bank) => bank.status === 'ACTIVE'),
    [bankAccounts],
  );
  const selectedBankAccount = useMemo(
    () =>
      activeBankAccounts.find((bank) => bank.id === selectedBankAccountId) ||
      bankAccounts.find((bank) => bank.id === selectedBankAccountId) ||
      null,
    [activeBankAccounts, bankAccounts, selectedBankAccountId],
  );

  useEffect(() => {
    if (!isOpen) {
      stockModalInitRef.current = false;
      return;
    }
    if (stockModalInitRef.current) return;
    stockModalInitRef.current = true;

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    let defaultDate = (today >= financialYear.startDate && today <= financialYear.endDate)
      ? new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 19)
      : `${financialYear.startDate}T08:00:00`;
    
    setTrxDate(defaultDate);
    setWarehouseId(warehouseFormHints.warehouseId || defaultWarehouseId);
    setNote(''); setScanCode(''); setDocumentRef(''); setFormNo(''); setSymbolCode(''); setExportPurpose('632'); setSupplier(''); setSupplierTaxCode(''); setSupplierPhone(''); setSupplierAddress(''); setCustomer(''); setCustomerTaxCode(''); setCustomerPhone(''); setCustomerAddress(''); setPaymentStatus('PENDING'); setPaymentMethod('CASH'); setSelectedBankAccountId(activeBankAccounts[0]?.id || '');
    setBomParentItemId(
      type === 'EXPORT' && item?.id && getBomDefinitionForParent(bomDefinitions, item.id, today) ? item.id : '',
    );
    setBomParentQuantity('1');
    setBomVarianceReason('');
    setImportedBatches([]);
    setImportWarnings([]);
    setImportSkippedRows([]);
    // reset lines (default 1 line; preselect item if modal opened from a row)
    const firstItemId = item?.id || '';
    const firstItem = scopedItems.find(i => i.id === firstItemId);
    setLines([{
      ...createEmptyLine('1'),
      itemId: firstItemId,
      price: firstItem ? String(type === 'IMPORT' ? firstItem.costPrice : firstItem.sellingPrice) : '',
    }]);
    setActiveLineId('1');

    // Prefill từ gợi ý đã lưu (SQLite / VictoryData)
    try {
      const h = warehouseFormHints;
      if (type === 'IMPORT') {
        if (h.supplierName) setSupplier(h.supplierName);
        if (h.supplierTax) setSupplierTaxCode(h.supplierTax);
        if (h.formNo) setFormNo(h.formNo);
        if (h.symbolCode) setSymbolCode(h.symbolCode);
        if (h.supplierPhone) setSupplierPhone(h.supplierPhone);
        if (h.supplierAddress) setSupplierAddress(h.supplierAddress);
      } else {
        if (h.customerName) setCustomer(h.customerName);
        if (h.customerTax) setCustomerTaxCode(h.customerTax);
        if (h.formNo) setFormNo(h.formNo);
        if (h.symbolCode) setSymbolCode(h.symbolCode);
        if (h.customerPhone) setCustomerPhone(h.customerPhone);
        if (h.customerAddress) setCustomerAddress(h.customerAddress);
      }
      if (h.warehouseId) setWarehouseId(h.warehouseId);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ init khi mở modal; không liệt kê scopedItems/warehouseFormHints.warehouseId để tránh reset khi user đổi kho.
  }, [isOpen, type, financialYear, item?.id, activeBankAccounts, bomDefinitions, defaultWarehouseId]);

  // Gợi ý kho (SQLite) có thể load sau khi mở modal — điền một lần khi hints xuất hiện, không ghi đè nếu user/Excel đã nhập.
  const hintsAppliedRef = useRef<string>('');
  useEffect(() => {
    if (!isOpen) {
      hintsAppliedRef.current = '';
      return;
    }
    const key = `${type}:${warehouseFormHints.supplierName ?? ''}:${warehouseFormHints.customerName ?? ''}:${warehouseFormHints.formNo ?? ''}`;
    if (hintsAppliedRef.current === key) return;
    try {
      const h = warehouseFormHints;
      if (type === 'IMPORT') {
        if (h.supplierName) setSupplier(prev => prev || h.supplierName!);
        if (h.supplierTax) setSupplierTaxCode(prev => prev || h.supplierTax!);
        if (h.formNo) setFormNo(prev => prev || h.formNo!);
        if (h.symbolCode) setSymbolCode(prev => prev || h.symbolCode!);
        if (h.supplierPhone) setSupplierPhone(prev => prev || h.supplierPhone!);
        if (h.supplierAddress) setSupplierAddress(prev => prev || h.supplierAddress!);
      } else {
        if (h.customerName) setCustomer(prev => prev || h.customerName!);
        if (h.customerTax) setCustomerTaxCode(prev => prev || h.customerTax!);
        if (h.formNo) setFormNo(prev => prev || h.formNo!);
        if (h.symbolCode) setSymbolCode(prev => prev || h.symbolCode!);
        if (h.customerPhone) setCustomerPhone(prev => prev || h.customerPhone!);
        if (h.customerAddress) setCustomerAddress(prev => prev || h.customerAddress!);
      }
      if (h.warehouseId) setWarehouseId(prev => prev || h.warehouseId!);
      hintsAppliedRef.current = key;
    } catch {}
  }, [isOpen, type, warehouseFormHints]);

  useEffect(() => {
    if (!isOpen) return;
    if (type !== 'EXPORT') return;
    if (!isProductionExport) return;
    if (!bomParentItemId || !activeBomDefinition || bomParentQuantityNumber <= 0) return;

    const nextLines = plannedBomStockLines.map((line, index) => ({
      ...createEmptyLine(String(index + 1)),
      itemId: line.item.id,
      quantity: String(line.requiredQuantity),
      price: getDefaultLinePrice(line.item),
      note: String(line.component.note || '').trim(),
    }));

    setLines(nextLines.length > 0 ? nextLines : [createEmptyLine('1')]);
    setActiveLineId(nextLines[0]?.id || '1');
    setImportedBatches([]);
    setImportWarnings([]);
    setImportSkippedRows([]);
  }, [
    isOpen,
    type,
    isProductionExport,
    bomParentItemId,
    activeBomDefinition,
    bomParentQuantityNumber,
    plannedBomStockLines,
  ]);

  useEffect(() => {
    if (!isOpen || type !== 'EXPORT') return;
    if (!isProductionExport) {
      setBomVarianceReason('');
      return;
    }
    if (bomParentItemId) return;
    if (item?.id && getBomDefinitionForParent(bomDefinitions, item.id, bomReferenceDate)) {
      setBomParentItemId(item.id);
    }
  }, [isOpen, type, isProductionExport, bomParentItemId, item?.id, bomDefinitions, bomReferenceDate]);

  // When active line item changes, default its price if missing
  useEffect(() => {
    if (!isOpen) return;
    if (!activeLine) return;
    if (!activeLine.itemId) return;
    const it = scopedItems.find(i => i.id === activeLine.itemId);
    if (!it) return;
    if (activeLine.price) return;
    const defaultPrice = String((type === 'IMPORT' || isProductionExport ? it.costPrice : it.sellingPrice) ?? 0);
    setLines(prev => prev.map(l => l.id === activeLine.id ? { ...l, price: defaultPrice } : l));
  }, [isOpen, activeLine?.id, activeLine?.itemId, activeLine?.price, scopedItems, type, isProductionExport]);

  // Autocomplete sync: when supplier/customer matches a catalog item, auto-fill contact info.
  useEffect(() => {
    if (type !== 'IMPORT') return;
    const s = findSupplierByName(supplier);
    if (!s) return;
    if (s.taxCode) setSupplierTaxCode(s.taxCode);
    if (s.phone) setSupplierPhone(s.phone);
    if (s.address) setSupplierAddress(s.address);
  }, [type, supplier, suppliers]);

  useEffect(() => {
    if (type !== 'EXPORT') return;
    const c = findCustomerByName(customer);
    if (!c) return;
    if (c.taxCode) setCustomerTaxCode(c.taxCode);
    if (c.phone) setCustomerPhone(c.phone);
    if (c.address) setCustomerAddress(c.address);
  }, [type, customer, customers]);

  // Ghi gợi ý vào state → persist SQLite (VictoryData) — chỉ khi có giá trị (giống logic localStorage cũ)
  useEffect(() => {
    if (!isOpen) return;
    if (type !== 'IMPORT') return;
    const patch: Partial<WarehouseFormHintsState> = {};
    if (supplier) patch.supplierName = supplier;
    if (supplierTaxCode) patch.supplierTax = supplierTaxCode;
    if (formNo) patch.formNo = formNo;
    if (symbolCode) patch.symbolCode = symbolCode;
    if (supplierPhone) patch.supplierPhone = supplierPhone;
    if (supplierAddress) patch.supplierAddress = supplierAddress;
    if (selectedWarehouseId) patch.warehouseId = selectedWarehouseId;
    if (Object.keys(patch).length) patchWarehouseFormHints(patch);
  }, [isOpen, type, supplier, supplierTaxCode, supplierPhone, supplierAddress, formNo, symbolCode, patchWarehouseFormHints, selectedWarehouseId]);

  useEffect(() => {
    if (!isOpen) return;
    if (type !== 'EXPORT') return;
    const patch: Partial<WarehouseFormHintsState> = {};
    if (customer) patch.customerName = customer;
    if (customerTaxCode) patch.customerTax = customerTaxCode;
    if (formNo) patch.formNo = formNo;
    if (symbolCode) patch.symbolCode = symbolCode;
    if (customerPhone) patch.customerPhone = customerPhone;
    if (customerAddress) patch.customerAddress = customerAddress;
    if (selectedWarehouseId) patch.warehouseId = selectedWarehouseId;
    if (Object.keys(patch).length) patchWarehouseFormHints(patch);
  }, [isOpen, type, customer, customerTaxCode, customerPhone, customerAddress, formNo, symbolCode, patchWarehouseFormHints, selectedWarehouseId]);

  const handleConfirm = () => {
    if (isMultiBatchImportMode) {
      const sortedPayloads = importedBatches
        .map((draft, index) => ({ draft, index }))
        .sort((a, b) => {
          const byDate = String(a.draft.date || '').localeCompare(String(b.draft.date || ''));
          return byDate !== 0 ? byDate : a.index - b.index;
        })
        .map(entry => buildPayloadFromDraft(entry.draft))
        .filter(batch => batch.lines.length > 0);

      if (sortedPayloads.length === 0) return;
      for (const p of sortedPayloads) {
        if (p.supplier?.trim()) rememberPartnerName('supplier', p.supplier);
        if (p.customer?.trim()) rememberPartnerName('customer', p.customer);
      }
      const success = handleInventoryActions.stockBatches(sortedPayloads);
      if (success) onClose();
      return;
    }

    if (!activeLine || hasDuplicates || !vatValidation.isValid || !serialMatchValidation.isValid) return;
    if (paymentStatus === 'PAID' && paymentMethod === 'BANK' && !selectedBankAccount) {
      window.alert('Vui lòng chọn tài khoản ngân hàng đang sử dụng.');
      return;
    }
    if (isDateInvalid && !window.confirm(`Ngày giao dịch không thuộc niên độ ${new Date(financialYear.startDate).getFullYear()}. Tiếp tục?`)) return;
    if (isProductionExport) {
      if (!bomParentItemId) {
        window.alert('Vui lòng chọn sản phẩm hoặc dịch vụ cha để tập hợp chi phí 154.');
        return;
      }
      if (!activeBomDefinition || !selectedBomParentItem) {
        window.alert('Mã cha đang chọn chưa có BOM hợp lệ trong Danh mục.');
        return;
      }
      if (bomParentQuantityNumber <= 0) {
        window.alert('Số lượng sản phẩm/dịch vụ cha phải lớn hơn 0.');
        return;
      }
      if (plannedBomStockLines.length === 0) {
        window.alert('BOM này không có dòng vật tư kho hợp lệ để xuất 154.');
        return;
      }
      if (plannedBomShortages.length > 0) {
        window.alert(
          `Không thể ghi bàn giao/kích hoạt (154) vì BOM đang thiếu số dư:\n- ${plannedBomShortages
            .map(
              (entry) =>
                `${entry.item?.sku || entry.itemId}: cần ${entry.requiredQuantity}, tồn ${entry.availableQuantity}, thiếu ${entry.shortageQuantity}`,
            )
            .join('\n- ')}`,
        );
        return;
      }
      if (hasBomVariance && !String(bomVarianceReason || '').trim()) {
        window.alert('Vui lòng nhập lý do sai lệch BOM trước khi xác nhận.');
        return;
      }
    }
    const trimmedBomVarianceReason = String(bomVarianceReason || '').trim();
    const payload = {
      actionType: type,
      date: trxDate,
      warehouseId: selectedWarehouseId,
      warehouseName: selectedWarehouse?.name,
      performer,
      note, // header note (applies if a line doesn't provide its own note)
      supplier,
      documentRef,
      customer,
      customerPhone,
      customerAddress,
      supplierPhone,
      supplierAddress,
      exportPurpose: type === 'EXPORT' ? exportPurpose : undefined,
      paymentStatus,
      paymentMethod,
      supplierTaxCode,
      customerTaxCode,
      formNo,
      symbolCode,
      ...(isProductionExport && activeBomDefinition && selectedBomParentItem
        ? {
            costObjectType: 'BOM_PARENT' as const,
            costObjectId: selectedBomParentItem.id,
            costObjectName: selectedBomParentItem.name,
            costObjectSku: selectedBomParentItem.sku,
            bomDefinitionId: activeBomDefinition.id,
            bomParentQuantity: bomParentQuantityNumber,
            bomVarianceReason: hasBomVariance ? trimmedBomVarianceReason : undefined,
          }
        : {}),
      ...(paymentStatus === 'PAID' && paymentMethod === 'BANK'
        ? {
            bankAccountId: selectedBankAccount?.id,
            bankName: selectedBankAccount?.bankName,
            bankAccountNumber: selectedBankAccount?.accountNumber,
            bankAccountHolder: selectedBankAccount?.accountHolder,
            bankBranch: selectedBankAccount?.branch,
            bankLedgerAccountCode: selectedBankAccount?.linkedAccountCode,
          }
        : {}),
      lines: (lines || [])
        .filter(l => l.itemId && (parseFloat(l.quantity) || 0) > 0)
        .map(l => {
          const plannedMeta = plannedBomLineMap.get(l.itemId);
          return {
            itemId: l.itemId,
            qty: parseFloat(l.quantity) || 0,
            price: parseFloat(l.price) || 0,
            vat: Number(l.vatRate) || 0,
            note: (l.note || '').trim(),
            serials: type === 'IMPORT' ? (l.serialInput || '') : (l.selectedSerial || []).join(','),
            bomPlannedQuantity: isProductionExport ? plannedMeta?.requiredQuantity : undefined,
            bomLossRate: isProductionExport ? plannedMeta?.lossRate : undefined,
            bomAccount154Category: isProductionExport ? plannedMeta?.account154Category : undefined,
          };
        })
    };
    if (!payload.lines || payload.lines.length === 0) return;
    if (type === 'IMPORT' && supplier.trim()) rememberPartnerName('supplier', supplier);
    if (type === 'EXPORT' && customer.trim()) rememberPartnerName('customer', customer);
    onConfirm(payload);
  };

  const total = (() => {
    let net = 0;
    let vat = 0;
    for (const l of lines || []) {
      const q = parseFloat(l.quantity) || 0;
      const p = parseFloat(l.price) || 0;
      const sub = q * p;
      const vr = Number(l.vatRate);
      const vatR = Number.isFinite(vr) ? vr : 0;
      net += sub;
      vat += vatAmountUnrounded(sub, vatR);
    }
    return roundInvoiceTotalsFromSums(net, vat).totalAmount;
  })();
  const LARGE_PAYMENT_THRESHOLD = 5_000_000;
  const isLargePaid = paymentStatus === 'PAID' && total >= LARGE_PAYMENT_THRESHOLD;

  const warnLargeCash = () => {
    alert('Giao dịch từ 5.000.000đ trở lên: hệ thống không cho chọn tài khoản 1111. Vui lòng chọn tài khoản 1121.');
  };

  const setPaymentMethodGuarded = (next: 'CASH' | 'BANK') => {
    if (next === 'CASH' && isLargePaid) {
      warnLargeCash();
      setPaymentMethod('BANK');
      return;
    }
    setPaymentMethod(next);
  };

  /** Nhập kho: Ghi nợ 331 | 1111 | 1121 — map sang paymentStatus + paymentMethod */
  const setImportPaymentSegment = (segment: 'DEBT' | 'CASH' | 'BANK') => {
    if (segment === 'DEBT') {
      setPaymentStatus('PENDING');
      return;
    }
    setPaymentStatus('PAID');
    if (segment === 'CASH') {
      setPaymentMethodGuarded('CASH');
    } else {
      setPaymentMethodGuarded('BANK');
    }
  };

  const importPaymentSegment: 'DEBT' | 'CASH' | 'BANK' =
    paymentStatus === 'PENDING' ? 'DEBT' : paymentMethod === 'BANK' ? 'BANK' : 'CASH';

  /** Xuất bán 632: Công nợ 131 | 1111 | 1121 */
  const setExport632PaymentSegment = (segment: 'DEBT' | 'CASH' | 'BANK') => {
    if (segment === 'DEBT') {
      setPaymentStatus('PENDING');
      return;
    }
    setPaymentStatus('PAID');
    if (segment === 'CASH') {
      setPaymentMethodGuarded('CASH');
    } else {
      setPaymentMethodGuarded('BANK');
    }
  };

  const export632PaymentSegment: 'DEBT' | 'CASH' | 'BANK' =
    paymentStatus === 'PENDING' ? 'DEBT' : paymentMethod === 'BANK' ? 'BANK' : 'CASH';

  const showWarehousePaymentStrip =
    type === 'IMPORT' || (type === 'EXPORT' && exportPurpose === '632');
  const warehousePaymentSegment = type === 'IMPORT' ? importPaymentSegment : export632PaymentSegment;
  const setWarehousePaymentSegment = type === 'IMPORT' ? setImportPaymentSegment : setExport632PaymentSegment;
  const isProductionExportBlocked =
    isProductionExport &&
    (
      !bomParentItemId ||
      !activeBomDefinition ||
      bomParentQuantityNumber <= 0 ||
      plannedBomStockLines.length === 0 ||
      plannedBomShortages.length > 0 ||
      (hasBomVariance && !String(bomVarianceReason || '').trim())
    );

  // Enforce rule: if already marked PAID and total >= 5.000.000 then force BANK (1121)
  useEffect(() => {
    if (!isLargePaid) return;
    if (paymentMethod === 'CASH') {
      setPaymentMethod('BANK');
    }
  }, [isLargePaid, paymentMethod]);

  useEffect(() => {
    if (paymentStatus !== 'PAID' || paymentMethod !== 'BANK') {
      setSelectedBankAccountId('');
      return;
    }
    const hasActiveSelection = activeBankAccounts.some((bank) => bank.id === selectedBankAccountId);
    if (!hasActiveSelection && activeBankAccounts.length > 0) {
      setSelectedBankAccountId(activeBankAccounts[0].id);
    }
  }, [paymentMethod, paymentStatus, selectedBankAccountId, activeBankAccounts]);

  const applyDraftToForm = (draft: StockActionImportDraft) => {
    setTrxDate(draft.date || trxDate || new Date().toISOString().slice(0, 19));
    setPerformer(draft.performer || 'Admin');
    setWarehouseId(resolveWarehouseId(draft.warehouseName || warehouseFormHints.warehouseId || defaultWarehouseId));
    setDocumentRef(draft.documentRef || '');
    setFormNo(draft.formNo || '');
    setSymbolCode(draft.symbolCode || '');
    setPaymentStatus(draft.paymentStatus || 'PENDING');
    setPaymentMethod(draft.paymentMethod || 'CASH');
    setBomParentItemId('');
    setBomParentQuantity('1');
    setBomVarianceReason('');
    const nextLines = (draft.lines || []).map((line, index) => ({
      ...line,
      id: String(index + 1),
      selectedSerial: [...(line.selectedSerial || [])],
    }));
    setLines(nextLines.length > 0 ? nextLines : [{
      id: '1',
      itemId: '',
      quantity: '',
      price: '',
      vatRate: 0,
      note: '',
      serialInput: '',
      selectedSerial: [],
    }]);
    setActiveLineId(nextLines[0]?.id || '1');
    setScanCode('');
    setNote('');

    if (type === 'IMPORT') {
      setSupplier(draft.supplier || '');
      setSupplierTaxCode(draft.supplierTaxCode || '');
      setSupplierPhone(draft.supplierPhone || '');
      setSupplierAddress(draft.supplierAddress || '');
      setCustomer('');
      setCustomerTaxCode('');
      setCustomerPhone('');
      setCustomerAddress('');
    } else {
      setExportPurpose(draft.exportPurpose || '632');
      setCustomer(draft.customer || '');
      setCustomerTaxCode(draft.customerTaxCode || '');
      setCustomerPhone(draft.customerPhone || '');
      setCustomerAddress(draft.customerAddress || '');
      setSupplier('');
      setSupplierTaxCode('');
      setSupplierPhone('');
      setSupplierAddress('');
    }
  };

  const clearImportedBatchMode = () => {
    setImportedBatches([]);
    setImportWarnings([]);
    setImportSkippedRows([]);
  };

  const buildPayloadFromDraft = (draft: StockActionImportDraft) => ({
    actionType: type,
    date: draft.date,
    warehouseId: resolveWarehouseId(draft.warehouseName || selectedWarehouseId),
    warehouseName: resolveWarehouseName(draft.warehouseName || selectedWarehouseId),
    performer: draft.performer,
    note: '',
    supplier: draft.supplier,
    documentRef: draft.documentRef,
    customer: draft.customer,
    customerPhone: draft.customerPhone,
    customerAddress: draft.customerAddress,
    supplierPhone: draft.supplierPhone,
    supplierAddress: draft.supplierAddress,
    exportPurpose: type === 'EXPORT' ? draft.exportPurpose : undefined,
    paymentStatus: draft.paymentStatus,
    paymentMethod: draft.paymentMethod,
    supplierTaxCode: draft.supplierTaxCode,
    customerTaxCode: draft.customerTaxCode,
    formNo: draft.formNo,
    symbolCode: draft.symbolCode,
    lines: (draft.lines || [])
      .filter(line => line.itemId && (parseFloat(line.quantity) || 0) > 0)
      .map(line => ({
        itemId: line.itemId,
        qty: parseFloat(line.quantity) || 0,
        price: parseFloat(line.price) || 0,
        vat: Number(line.vatRate) || 0,
        note: (line.note || '').trim(),
        serials: type === 'IMPORT' ? (line.serialInput || '') : (line.selectedSerial || []).join(','),
      })),
  });

  const handleDownloadTemplate = () => {
    void downloadStockActionTemplate(type);
  };

  const handleImportExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImportingExcel(true);
    try {
      const { batches, skippedRows, warnings } = await parseStockActionImportFile(
        file,
        type,
        items,
        trxDate || new Date().toISOString().slice(0, 19),
        transactions || [],
      );

      if (!batches.length) {
        const errorSummary = skippedRows.length
          ? skippedRows.slice(0, 6).join('\n')
          : 'Không có dòng hàng hợp lệ để nạp vào modal.';
        alert(`Không thể import file Excel.\n\n${errorSummary}`);
        return;
      }

      const firstBatch = batches[0];
      applyDraftToForm(firstBatch);
      setImportWarnings(warnings);
      setImportSkippedRows(skippedRows);

      if (batches.length > 1) {
        setImportedBatches(batches);
      } else {
        setImportedBatches([]);
      }

      const totalLines = batches.reduce((sum, batch) => sum + (batch.lines?.length || 0), 0);
      const summaryParts = [
        `Đã nhận diện ${batches.length} phiếu / ${totalLines} dòng ${type === 'IMPORT' ? 'nạp tài nguyên' : 'bàn giao/kích hoạt'}.`,
      ];
      if (batches.length > 1) {
        summaryParts.push('Hệ thống sẽ tách file import thành nhiều phiếu riêng theo ngày giờ hạch toán, chứng từ gốc và thông tin đối tác để ghi sổ chính xác theo từng SKU/Serial.');
      }
      if (warnings.length > 0) {
        summaryParts.push(`Cảnh báo:\n- ${warnings.slice(0, 12).join('\n- ')}`);
      }
      if (skippedRows.length > 0) {
        summaryParts.push(`Dòng bị bỏ qua:\n- ${skippedRows.slice(0, 12).join('\n- ')}`);
      }
      if (warnings.length > 12 || skippedRows.length > 12) {
        summaryParts.push('Một số cảnh báo đã được rút gọn; danh sách đầy đủ hiển thị trong khung cảnh báo dưới đây.');
      }
      alert(summaryParts.join('\n\n'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể đọc file import.';
      alert(`Import Excel thất bại.\n\n${message}`);
    } finally {
      setIsImportingExcel(false);
      event.target.value = '';
    }
  };

  const isMultiBatchImportMode = importedBatches.length > 1;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl overflow-hidden animate-fade-in flex flex-col max-h-[95vh] border border-slate-200">
        {/* Header */}
        <div className={`px-4 py-2.5 text-white flex justify-between items-center ${type === 'IMPORT' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg shadow-inner">
              {type === 'IMPORT' ? <Download className="w-5 h-5" /> : <Upload className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-semibold leading-tight tracking-tight">{type === 'IMPORT' ? 'Chứng từ nạp tài nguyên' : 'Chứng từ bàn giao/kích hoạt'}</h3>
              <p className="text-[10px] opacity-80 mt-0.5 font-medium tracking-tight">Hệ thống quản lý vật tư VTR</p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-1.5 rounded-full transition-all"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportExcel}
            className="hidden"
          />

          {(importWarnings.length > 0 || importSkippedRows.length > 0) && (
            <div className="mb-4 max-h-56 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50/95 p-3 text-xs text-amber-950 shadow-sm">
              {importWarnings.length > 0 && (
                <div className="mb-3">
                  <p className="mb-2 font-semibold tracking-wide text-amber-900">Cảnh báo import ({importWarnings.length})</p>
                  <ul className="list-disc space-y-1.5 pl-4">
                    {importWarnings.map((w, i) => (
                      <li key={`w-${i}`} className="leading-snug">
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {importSkippedRows.length > 0 && (
                <div>
                  <p className="mb-2 font-semibold tracking-wide text-amber-900">Dòng bỏ qua ({importSkippedRows.length})</p>
                  <ul className="list-disc space-y-1.5 pl-4">
                    {importSkippedRows.map((s, i) => (
                      <li key={`s-${i}`} className="leading-snug">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {isMultiBatchImportMode && (
            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/80 p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold tracking-tight text-blue-700">Import nhiều phiếu</p>
                  <h4 className="mt-1 text-base font-semibold text-slate-800">
                    Đã nhận diện {importedBatches.length} phiếu / {importedBatchStats.totalLines} dòng / {importedBatchStats.totalSerials} serial
                  </h4>
                  <p className="mt-1 text-sm text-slate-600">
                    Khi bấm ghi sổ, hệ thống sẽ xử lý toàn bộ file theo đúng thứ tự ngày giờ hạch toán. Mỗi phiếu giữ riêng ngày, SKU, serial và chứng từ gốc, không còn bị gộp vào 1 dòng/ngày.
                  </p>
                  <p className="mt-2 text-xs font-medium text-blue-700">
                    Form bên dưới đang hiển thị phiếu đầu tiên để đối chiếu nhanh. Nếu bạn chỉ muốn giữ lại phiếu đang xem, hãy tắt chế độ import nhiều phiếu.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={clearImportedBatchMode}
                  className="rounded-xl border border-blue-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 shadow-sm transition-all hover:bg-blue-100"
                >
                  Chỉ giữ phiếu đang xem
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {importedBatches.slice(0, 4).map((batch, index) => {
                  const serialCount = batch.lines.reduce((sum, line) => {
                    const count = type === 'IMPORT'
                      ? (line.serialInput || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length
                      : (line.selectedSerial || []).length;
                    return sum + count;
                  }, 0);
                  const partnerLabel = type === 'IMPORT'
                    ? (batch.supplier || 'Nhà cung cấp')
                    : (batch.customer || 'Khách hàng / Bộ phận');
                  return (
                    <div key={`${batch.date}-${batch.documentRef}-${index}`} className="rounded-xl border border-blue-100 bg-white/90 p-4">
                      <p className="text-[10px] font-semibold tracking-tight text-slate-400">Phiếu {index + 1}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-800">{(batch.date || '').replace('T', ' ') || 'Chưa có ngày'}</p>
                      <p className="mt-1 text-sm text-slate-600">{partnerLabel}</p>
                      <p className="mt-2 text-xs font-medium text-slate-500">
                        Số CT gốc: {batch.documentRef || '---'} · {batch.lines.length} dòng · {serialCount} serial
                      </p>
                    </div>
                  );
                })}
              </div>

              {importedBatches.length > 4 && (
                <p className="mt-3 text-xs font-medium text-slate-500">
                  Còn {importedBatches.length - 4} phiếu khác trong file sẽ được ghi sổ khi xác nhận.
                </p>
              )}

              {(importWarnings.length > 0 || importSkippedRows.length > 0) && (
                <p className="mt-3 text-xs font-medium text-amber-700">
                  File import hiện có {importWarnings.length} cảnh báo và {importSkippedRows.length} dòng bị bỏ qua. Bạn nên rà lại file trước khi ghi sổ toàn bộ.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-12 gap-6">
            
            {/* Cột trái: Thông tin chính */}
            <div className="col-span-7 space-y-6">
              
              {/* Cảnh báo nếu có */}
              {(
                isDateInvalid ||
                !serialMatchValidation.isValid ||
                !vatValidation.isValid ||
                (isProductionExport && !bomParentItemId) ||
                (isProductionExport && !!bomParentItemId && !activeBomDefinition) ||
                (isProductionExport && plannedBomShortages.length > 0) ||
                (isProductionExport && hasBomVariance)
              ) && (
                <div className="space-y-2">
                  {isDateInvalid && (
                    <div className="bg-red-50 text-red-700 p-3 rounded-xl border border-red-100 text-xs font-bold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" /> Ngoài niên độ kế toán {financialYear.startDate.slice(0, 4)}
                    </div>
                  )}
                  {!serialMatchValidation.isValid && (
                    <div className="bg-amber-50 text-amber-700 p-3 rounded-xl border border-amber-100 text-xs font-bold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Số lượng không khớp với danh sách Serial
                    </div>
                  )}
                  {isProductionExport && !bomParentItemId && (
                    <div className="bg-blue-50 text-blue-700 p-3 rounded-xl border border-blue-100 text-xs font-bold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" /> Chọn sản phẩm hoặc dịch vụ cha để hệ thống tự bung BOM.
                    </div>
                  )}
                  {isProductionExport && !!bomParentItemId && !activeBomDefinition && (
                    <div className="bg-red-50 text-red-700 p-3 rounded-xl border border-red-100 text-xs font-bold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Mã cha đang chọn chưa có BOM hợp lệ trong Danh mục.
                    </div>
                  )}
                  {isProductionExport && plannedBomShortages.length > 0 && (
                    <div className="bg-red-50 text-red-700 p-3 rounded-xl border border-red-100 text-xs font-bold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> BOM đang thiếu số dư ở {plannedBomShortages.length} thành phần, chưa thể ghi sổ 154.
                    </div>
                  )}
                  {isProductionExport && hasBomVariance && (
                    <div className="bg-amber-50 text-amber-700 p-3 rounded-xl border border-amber-100 text-xs font-bold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Số lượng thực xuất đang lệch BOM, cần nhập lý do sai lệch.
                    </div>
                  )}
                </div>
              )}

              {/* Master: nhập kho — ngày + người lập (số phiếu ở khối NCC); xuất kho — đủ 3 ô */}
              <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-slate-200 pb-3">
                {type === 'EXPORT' && (
                  <div className="min-w-[9rem] flex-1 basis-[8rem]">
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Số phiếu nội bộ</label>
                    <input
                      value={voucherNumberPreview}
                      readOnly
                      className="h-8 w-full cursor-not-allowed rounded border border-slate-200 bg-slate-100 px-2 font-mono text-xs font-semibold text-blue-700"
                    />
                  </div>
                )}
                <div className="min-w-[11rem] flex-1 basis-[12rem]">
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Ngày giờ hạch toán</label>
                  <input
                    type="datetime-local"
                    step={1}
                    value={trxDate}
                    onChange={(e) => setTrxDate(e.target.value)}
                    className={`h-8 w-full rounded border px-2 text-xs font-bold outline-none focus:ring-1 focus:ring-blue-500/40 ${
                      isDateInvalid ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-200 bg-white'
                    }`}
                  />
                </div>
                <div className="min-w-[8rem] flex-1 basis-[9rem]">
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Người lập chứng từ</label>
                  <input
                    value={performer}
                    onChange={(e) => setPerformer(e.target.value)}
                    className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:ring-1 focus:ring-blue-500/40"
                  />
                </div>
                <div className="min-w-[10rem] flex-1 basis-[12rem]">
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Kho thực hiện</label>
                  <select
                    value={selectedWarehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:ring-1 focus:ring-blue-500/40"
                  >
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.code ? `${warehouse.code} - ` : ''}{warehouse.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Nhóm 1: Bảng hạch toán — danh sách mặt hàng */}
              <div className="border border-slate-200 bg-white shadow-sm">
                <div className="relative flex min-h-[2.25rem] flex-wrap items-center justify-center border-b border-slate-200 bg-slate-50/90 px-3 py-2 pr-[5.5rem] sm:pr-[5.75rem]">
                  <div className="flex items-center justify-center gap-2">
                    <span className="h-3.5 w-1 shrink-0 rounded-sm bg-blue-500" aria-hidden />
                    <h4 className="text-center text-[11px] font-semibold tracking-wide text-slate-600">
                      Danh sách mặt hàng trong phiếu
                    </h4>
                  </div>
                  <div className="absolute right-3 top-1/2 flex -translate-y-1/2 shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleDownloadTemplate}
                      title="Tải mẫu Excel"
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-100"
                    >
                      <Download className="h-4 w-4" />
                      <span className="sr-only">Tải mẫu Excel</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isImportingExcel}
                      title={isImportingExcel ? 'Đang đọc file…' : 'Nhập từ Excel'}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        type === 'IMPORT' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                      }`}
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      <span className="sr-only">{isImportingExcel ? 'Đang đọc file' : 'Nhập Excel'}</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="table-fixed w-full min-w-[920px] border-collapse text-xs">
                    <colgroup>
                      <col style={{ width: '3%' }} />
                      <col style={{ width: '22%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '9%' }} />
                      <col style={{ width: '13%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '12%' }} />
                      <col style={{ width: '19%' }} />
                      <col style={{ width: '8%' }} />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold tracking-tight text-slate-600">
                        <th className="border-b border-slate-200 px-1 py-1.5 text-center">Stt</th>
                        <th className="border-b border-slate-200 px-1.5 py-1.5 text-center">Mặt hàng</th>
                        <th className="border-b border-slate-200 px-1 py-1.5 text-center">Đơn vị tính</th>
                        <th className="border-b border-slate-200 px-1 py-1.5 text-center">Số lượng</th>
                        <th className="border-b border-slate-200 px-1.5 py-1.5 text-center">Đơn giá</th>
                        <th className="border-b border-slate-200 px-1 py-1.5 text-center">Vat</th>
                        <th className="border-b border-slate-200 px-1.5 py-1.5 text-center">Thành tiền</th>
                        <th className="border-b border-slate-200 px-1.5 py-1.5 text-center">Diễn giải</th>
                        <th className="border-b border-slate-200 px-1 py-1.5 text-center" />
                      </tr>
                    </thead>
                    <tbody className="text-slate-800">
                      {(lines || []).map((l, rowIdx) => {
                        const it = scopedItems.find((i) => i.id === l.itemId);
                        const q = parseFloat(l.quantity) || 0;
                        const p = parseFloat(l.price) || 0;
                        const sub = q * p;
                        const vr = Number(l.vatRate);
                        const vatR = Number.isFinite(vr) ? vr : 0;
                        const lineTotal = roundInvoiceTotalsFromSums(sub, vatAmountUnrounded(sub, vatR)).totalAmount;
                        const isActive = l.id === activeLineId;
                        return (
                          <tr
                            key={l.id}
                            className={`h-9 border-b border-slate-100 ${isActive ? 'bg-blue-50/70' : 'bg-white'}`}
                            onClick={() => setActiveLineId(l.id)}
                          >
                            <td className="border-b border-slate-100 px-1 py-0 align-middle">
                              <div className="flex h-9 items-center justify-center">
                                <span className="text-center text-[10px] font-semibold text-slate-500">{rowIdx + 1}</span>
                              </div>
                            </td>
                            <td className="border-b border-slate-100 px-1 py-0 align-middle">
                              <div className="flex h-9 min-h-[36px] items-center gap-1.5">
                                <select
                                  value={l.itemId}
                                  onChange={(e) => {
                                    const next = e.target.value;
                                    const it2 = scopedItems.find((i) => i.id === next) || items.find((i) => i.id === next);
                                    setLines((prev) =>
                                      prev.map((x) =>
                                        x.id === l.id
                                          ? {
                                              ...x,
                                              itemId: next,
                                              price: x.price || getDefaultLinePrice(it2),
                                            }
                                          : x,
                                      ),
                                    );
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 min-w-0 flex-1 truncate rounded border border-slate-200 bg-white px-1.5 text-[11px] font-medium leading-none text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30"
                                >
                                  <option value="">— Chọn —</option>
                                  {scopedItems.map((i) => (
                                    <option key={i.id} value={i.id} title={String(i.sku || '').trim() || undefined}>
                                      {scopedItemOptionLabel(i)}
                                    </option>
                                  ))}
                                </select>
                                {it ? (
                                  <>
                                    <span
                                      className="max-w-[3.5rem] shrink-0 truncate font-mono text-[9px] leading-none text-slate-400"
                                      title={`Mã SKU: ${it.sku || '—'}`}
                                    >
                                      {it.sku || '—'}
                                    </span>
                                    <span
                                      className="shrink-0 whitespace-nowrap font-mono text-[9px] leading-none text-slate-500"
                                      title={`Số dư ${selectedWarehouse?.name || 'kho'}: ${it.quantity} ${it.unit}`}
                                    >
                                      Số dư: {it.quantity}
                                    </span>
                                  </>
                                ) : null}
                              </div>
                            </td>
                            <td className="border-b border-slate-100 px-1 py-0 align-middle">
                              <div className="flex h-9 items-center justify-center">
                                <span className="text-center text-[10px] font-medium text-slate-600">{it?.unit ?? '—'}</span>
                              </div>
                            </td>
                            <td className="border-b border-slate-100 px-1 py-0 align-middle">
                              <div className="flex h-9 items-center justify-center">
                                <input
                                  type="number"
                                  value={l.quantity}
                                  onChange={(e) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, quantity: e.target.value } : x)))}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 w-full max-w-full rounded border border-slate-200 px-1 text-center text-[11px] font-semibold tabular-nums outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30"
                                />
                              </div>
                            </td>
                            <td className="border-b border-slate-100 px-1 py-0 align-middle">
                              <div className="flex h-9 items-center justify-center">
                                <input
                                  type="number"
                                  value={l.price}
                                  onChange={(e) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, price: e.target.value } : x)))}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 w-full max-w-full rounded border border-slate-200 px-1 text-center text-[11px] font-semibold tabular-nums outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30"
                                />
                              </div>
                            </td>
                            <td className="border-b border-slate-100 px-0.5 py-0 align-middle">
                              <div className="flex h-9 items-center justify-center">
                                <select
                                  value={l.vatRate}
                                  onChange={(e) =>
                                    setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, vatRate: Number(e.target.value) } : x)))
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 w-full max-w-full rounded border border-slate-200 bg-white px-0.5 text-center text-[10px] font-semibold outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30"
                                >
                                  {[0, 5, 8, 10, VAT_RATE_NOT_SUBJECT].map((r) => (
                                    <option key={r} value={r}>
                                      {formatVatRateLabel(r)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </td>
                            <td className="border-b border-slate-100 px-1 py-0 align-middle">
                              <div className="flex h-9 items-center justify-center">
                                <span className="text-center text-[11px] font-semibold tabular-nums">{formatCurrency(lineTotal)}</span>
                              </div>
                            </td>
                            <td className="border-b border-slate-100 px-1 py-0 align-middle">
                              <div className="flex h-9 items-center justify-center">
                                <input
                                  value={l.note}
                                  onChange={(e) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, note: e.target.value } : x)))}
                                  onClick={(e) => e.stopPropagation()}
                                  title={l.note || 'Diễn giải'}
                                  placeholder="Diễn giải…"
                                  className="h-7 w-full cursor-text rounded border border-slate-200 px-1.5 text-center text-[11px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30"
                                />
                              </div>
                            </td>
                            <td className="border-b border-slate-100 px-0.5 py-0 align-middle">
                              <div className="flex h-9 items-center justify-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLines((prev) => {
                                    const next = prev.filter((x) => x.id !== l.id);
                                    if (next.length === 0) return prev;
                                    return next;
                                  });
                                  if (activeLineId === l.id) {
                                    const nextId = lines.find((x) => x.id !== l.id)?.id || '1';
                                    setActiveLineId(nextId);
                                  }
                                }}
                                className="inline-flex rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                title="Xóa dòng"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      <tr
                        className="cursor-pointer border-b-0 bg-slate-50/50 transition-colors hover:bg-slate-100/80"
                        onClick={() => {
                          const nextId = String((lines?.length || 0) + 1);
                          setLines((prev) => [
                            ...prev,
                            createEmptyLine(nextId),
                          ]);
                          setActiveLineId(nextId);
                        }}
                      >
                        <td colSpan={9} className="px-3 py-2 text-center text-[11px] font-medium text-slate-400">
                          <span className="inline-flex items-center gap-1.5 text-slate-500">
                            <Plus className="h-3.5 w-3.5" /> Bấm vào đây để thêm dòng
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {showWarehousePaymentStrip && (
                <div className="mb-3 space-y-2 rounded-lg border border-slate-200/90 bg-gradient-to-r from-slate-50/95 to-white px-3 py-2.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    Trạng thái thanh toán
                  </span>
                  <div
                    role="tablist"
                    aria-label="Trạng thái thanh toán"
                    className={paymentSegmentSoftUi.tablistWarehouse}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={warehousePaymentSegment === 'DEBT'}
                      onClick={() => setWarehousePaymentSegment('DEBT')}
                      className={`${paymentSegmentSoftUi.buttonBaseWarehouse} ${
                        warehousePaymentSegment === 'DEBT'
                          ? paymentSegmentSoftUi.debtActive
                          : paymentSegmentSoftUi.debtInactive
                      }`}
                    >
                      <span>{type === 'IMPORT' ? 'Ghi nợ' : 'Công nợ'}</span>
                      <span className="text-[9px] font-medium opacity-80">
                        ({type === 'IMPORT' ? '331' : '131'})
                      </span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={warehousePaymentSegment === 'CASH'}
                      onClick={() => setWarehousePaymentSegment('CASH')}
                      disabled={isLargePaid}
                      title={
                        isLargePaid
                          ? 'Từ 5.000.000đ: bắt buộc ghi nhận qua tài khoản ngân hàng (1121)'
                          : 'Tiền mặt (1111)'
                      }
                      className={`${paymentSegmentSoftUi.buttonBaseWarehouse} ${
                        warehousePaymentSegment === 'CASH'
                          ? paymentSegmentSoftUi.cashActive
                          : paymentSegmentSoftUi.cashInactive
                      } ${isLargePaid ? 'cursor-not-allowed opacity-45' : ''}`}
                    >
                      <span>Tiền mặt</span>
                      <span className="text-[9px] font-medium opacity-80">(1111)</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={warehousePaymentSegment === 'BANK'}
                      onClick={() => setWarehousePaymentSegment('BANK')}
                      className={`${paymentSegmentSoftUi.buttonBaseWarehouse} ${
                        warehousePaymentSegment === 'BANK'
                          ? paymentSegmentSoftUi.bankActive
                          : paymentSegmentSoftUi.bankInactive
                      }`}
                    >
                      <span>Chuyển khoản</span>
                      <span className="text-[9px] font-medium opacity-80">(1121)</span>
                    </button>
                  </div>
                  {warehousePaymentSegment === 'BANK' && (
                    <select
                      value={selectedBankAccountId}
                      onChange={(e) => setSelectedBankAccountId(e.target.value)}
                      title={
                        selectedBankAccount
                          ? `${selectedBankAccount.bankName} — ${selectedBankAccount.accountNumber} (${selectedBankAccount.linkedAccountCode})`
                          : 'Chọn TK NH 1121xxx'
                      }
                      aria-label="Tài khoản ngân hàng thanh toán"
                      className={paymentSegmentSoftUi.bankSelect}
                    >
                      <option value="">— TK ngân hàng —</option>
                      {activeBankAccounts.map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.bankName} — {bank.accountNumber}
                        </option>
                      ))}
                    </select>
                  )}
                  {isLargePaid && (
                    <p className="rounded-md bg-amber-50/90 px-2 py-1 text-[10px] font-medium leading-snug text-amber-900 ring-1 ring-amber-200/60">
                      Từ 5.000.000đ: bắt buộc hạch toán qua ngân hàng (1121), không dùng tiền mặt (1111).
                    </p>
                  )}
                </div>
              )}

              {/* Nhóm 2: Thông tin Đối tác (Cân đối lại Grid cho Xuất kho) */}
              <div className={`p-4 rounded-xl border shadow-sm space-y-3 ${type === 'IMPORT' ? 'bg-emerald-50/30 border-emerald-100' : 'bg-red-50/30 border-red-100'}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-4 rounded-full ${type === 'IMPORT' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                    <h4 className={`text-[11px] font-semibold tracking-wider ${type === 'IMPORT' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {type === 'IMPORT' ? 'Thông tin Nhà cung cấp' : 'Thông tin Khách hàng / Mục đích'}
                    </h4>
                  </div>
                </div>

                {type === 'IMPORT' ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-end gap-2 border-b border-slate-200/80 pb-2">
                      <div className="min-w-[12rem] flex-[2] basis-[40%]">
                        <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Tên Nhà cung cấp</label>
                        <input
                          value={supplier}
                          onChange={(e) => setSupplier(e.target.value)}
                          onBlur={() => rememberPartnerName('supplier', supplier)}
                          list="warehouseSupplierList"
                          className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/25"
                          placeholder="Gõ để gợi ý từ danh mục…"
                        />
                      </div>
                      <div className="min-w-[6.5rem] flex-1 basis-[20%]">
                        <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Mã số thuế / CCCD</label>
                        <input
                          value={supplierTaxCode}
                          onChange={(e) => setSupplierTaxCode(e.target.value)}
                          className="h-8 w-full rounded border border-slate-200 bg-white px-2 font-mono text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-emerald-500/25"
                          placeholder="MST / CCCD"
                        />
                      </div>
                      <div className="min-w-[6.5rem] flex-1 basis-[20%]">
                        <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Số điện thoại</label>
                        <input
                          value={supplierPhone}
                          onChange={(e) => setSupplierPhone(e.target.value)}
                          className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-xs font-semibold outline-none focus:ring-1 focus:ring-emerald-500/25"
                          placeholder="09xx…"
                        />
                      </div>
                      <div className="min-w-[6.5rem] flex-1 basis-[20%]">
                        <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Số phiếu nội bộ</label>
                        <input
                          value={voucherNumberPreview}
                          readOnly
                          className="h-8 w-full cursor-not-allowed rounded border border-slate-200 bg-slate-100 px-2 font-mono text-xs font-semibold text-blue-700"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[14rem] flex-1 basis-1/2">
                        <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Địa chỉ NCC</label>
                        <input
                          value={supplierAddress}
                          onChange={(e) => setSupplierAddress(e.target.value)}
                          className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-xs outline-none focus:ring-1 focus:ring-emerald-500/25"
                        />
                      </div>
                      <div className="flex min-w-[14rem] flex-1 basis-1/2 flex-wrap gap-2 sm:flex-nowrap">
                        <div className="min-w-0 flex-1">
                          <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Số HĐ / CT gốc</label>
                          <input
                            value={documentRef}
                            onChange={(e) => setDocumentRef(e.target.value)}
                            className="h-8 w-full rounded border border-slate-200 bg-white px-2 font-mono text-xs font-semibold text-blue-700 outline-none focus:ring-1 focus:ring-emerald-500/25"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Mẫu số</label>
                          <input
                            value={formNo}
                            onChange={(e) => setFormNo(e.target.value)}
                            className="h-8 w-full rounded border border-slate-200 bg-white px-2 font-mono text-xs font-semibold outline-none focus:ring-1 focus:ring-emerald-500/25"
                            placeholder="01GTKT0/001…"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Ký hiệu</label>
                          <input
                            value={symbolCode}
                            onChange={(e) => setSymbolCode(e.target.value)}
                            className="h-8 w-full rounded border border-slate-200 bg-white px-2 font-mono text-xs font-semibold uppercase outline-none focus:ring-1 focus:ring-emerald-500/25"
                            placeholder="1C23TYY…"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <>
                      <div className="col-span-1">
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Mục đích bàn giao/kích hoạt</label>
                        <select 
                          value={exportPurpose} onChange={e => setExportPurpose(e.target.value)}
                          className="w-full h-[44px] px-3 bg-white border border-red-200 rounded-xl text-sm font-bold text-red-700 shadow-sm outline-none focus:ring-2 focus:ring-red-500"
                        >
                          {EXPORT_PURPOSES.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                        </select>
                      </div>
                      <div className="col-span-1">
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Số HĐ / Chứng từ gốc</label>
                        <input value={documentRef} onChange={e => setDocumentRef(e.target.value)} className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono font-bold text-blue-600 shadow-sm" placeholder="PX-xxxx" />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Mẫu số</label>
                        <input value={formNo} onChange={e => setFormNo(e.target.value)} className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono font-bold text-slate-700 shadow-sm" placeholder="01GTKT0/001..." />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Ký hiệu</label>
                        <input value={symbolCode} onChange={e => setSymbolCode(e.target.value)} className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm uppercase font-mono font-bold text-slate-700 shadow-sm" placeholder="1C23TYY..." />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Tên Khách hàng / Bộ phận</label>
                        <input
                          value={customer}
                          onChange={e => setCustomer(e.target.value)}
                          onBlur={() => rememberPartnerName('customer', customer)}
                          list="warehouseCustomerList"
                          className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-bold shadow-sm"
                          placeholder="Gõ để gợi ý từ danh mục và tên đã nhập..."
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Mã số thuế / CCCD</label>
                        <input
                          value={customerTaxCode}
                          onChange={e => setCustomerTaxCode(e.target.value)}
                          className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono font-bold text-slate-700 shadow-sm"
                          placeholder="MST hoặc CCCD..."
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Số điện thoại liên hệ</label>
                        <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-bold shadow-sm" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Địa chỉ nhận hàng / Lắp đặt</label>
                        <input value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm shadow-sm" />
                      </div>
                      {isProductionExport && (
                        <>
                          <div className="col-span-1">
                            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Sản phẩm / dịch vụ cha</label>
                            <select
                              value={bomParentItemId}
                              onChange={(e) => {
                                setBomParentItemId(e.target.value);
                                setBomVarianceReason('');
                              }}
                              className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-800 shadow-sm outline-none focus:ring-2 focus:ring-red-500"
                            >
                              <option value="">-- Chọn BOM --</option>
                              {bomParentOptions.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.sku} - {entry.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-1">
                            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Số lượng SP/DV cha</label>
                            <input
                              type="number"
                              min="0"
                              step="0.000001"
                              value={bomParentQuantity}
                              onChange={(e) => {
                                setBomParentQuantity(e.target.value);
                                setBomVarianceReason('');
                              }}
                              className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-800 shadow-sm outline-none focus:ring-2 focus:ring-red-500"
                            />
                          </div>
                          <div className="col-span-2 rounded-2xl border border-red-100 bg-white/80 p-4 shadow-sm">
                            {!bomParentItemId && (
                              <p className="text-sm text-slate-500">
                                Chọn mã cha để hệ thống tự gọi BOM và đổ các dòng vật tư cần xuất cho `154`.
                              </p>
                            )}
                            {bomParentItemId && !activeBomDefinition && (
                              <p className="text-sm font-semibold text-red-600">
                                Mã cha đang chọn chưa có BOM trong Danh mục, chưa thể tập hợp chi phí theo BOM.
                              </p>
                            )}
                            {bomParentItemId && activeBomDefinition && (
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-red-600">BOM 154 đang áp dụng</p>
                                    <h5 className="mt-1 text-sm font-bold text-slate-800">
                                      {selectedBomParentItem?.sku} - {selectedBomParentItem?.name}
                                    </h5>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {plannedBomStockLines.length} dòng vật tư kho tự động | {nonStockBomComponents.length} dòng nhân công/SXC chỉ theo dõi cấu thành
                                    </p>
                                  </div>
                                  <div className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                                    SL cha: {bomParentQuantityNumber || 0}
                                  </div>
                                </div>

                                {activeBomDefinition.note && (
                                  <p className="text-xs text-slate-600">{activeBomDefinition.note}</p>
                                )}

                                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200">
                                  <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-slate-500">
                                      <tr>
                                        <th className="px-3 py-2 text-left">Thành phần</th>
                                        <th className="px-3 py-2 text-left">Phân loại</th>
                                        <th className="px-3 py-2 text-right">Theo BOM</th>
                                        <th className="px-3 py-2 text-left">Bàn giao/Kích hoạt</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {resolvedBomComponents.map((entry) => (
                                        <tr key={entry.component.id}>
                                          <td className="px-3 py-2">
                                            <div className="font-semibold text-slate-800">
                                              {entry.item?.sku || 'N/A'} - {entry.item?.name || 'Không còn trong danh mục'}
                                            </div>
                                            <div className="text-[11px] text-slate-500">
                                              ĐVT: {entry.item?.unit || '---'} | Tồn: {entry.item?.quantity || 0}
                                            </div>
                                          </td>
                                          <td className="px-3 py-2 text-slate-600">
                                            {getBom154CategoryLabel(entry.component.account154Category)}
                                          </td>
                                          <td className="px-3 py-2 text-right font-semibold text-blue-700">
                                            {entry.requiredQuantity}
                                          </td>
                                          <td className="px-3 py-2">
                                            <span
                                              className={`inline-flex rounded-full px-2.5 py-1 font-semibold ${
                                                entry.isStockTracked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                                              }`}
                                            >
                                              {entry.isStockTracked ? 'Tự đổ vào phiếu bàn giao/kích hoạt' : 'Không ghi bàn giao/kích hoạt'}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>

                                {plannedBomShortages.length > 0 && (
                                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                                    <p className="font-semibold">Thiếu số dư BOM:</p>
                                    <ul className="mt-2 list-disc space-y-1 pl-4">
                                      {plannedBomShortages.map((entry) => (
                                        <li key={entry.itemId}>
                                          {entry.item?.sku || entry.itemId}: cần {entry.requiredQuantity}, số dư {entry.availableQuantity}, thiếu {entry.shortageQuantity}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {hasBomVariance && (
                                  <div>
                                    <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 ml-1">Lý do sai lệch BOM</label>
                                    <textarea
                                      value={bomVarianceReason}
                                      onChange={(e) => setBomVarianceReason(e.target.value)}
                                      rows={3}
                                      className="w-full rounded-xl border border-amber-300 bg-amber-50/40 px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-amber-500"
                                      placeholder="Ví dụ: xuất bù hao hụt thực tế, thay thế linh kiện tương đương, làm tròn định mức..."
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  </div>
                )}
              </div>

            </div>

            {/* Cột phải: Quản lý Serial/IMEI */}
            <div className="col-span-5 flex flex-col space-y-6">
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
                <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                   <h4 className="text-[11px] font-semibold text-slate-500 tracking-wider flex items-center gap-2">
                      <ScanBarcode className="w-4 h-4 text-blue-500" /> {type === 'IMPORT' ? 'Quản lý Serial nạp tài nguyên' : 'Chọn Serial theo số dư'}
                   </h4>
                   <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${serialMatchValidation.isValid ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                      {(type === 'IMPORT'
                        ? (activeLine?.serialInput || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length
                        : (activeLine?.selectedSerial || []).length)} / {qtyNum || 0}
                   </span>
                </div>

                <div className="p-4 flex-1 flex flex-col space-y-3 min-h-[320px]">
                  {type === 'IMPORT' ? (
                    <>
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <ScanBarcode className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                          <input 
                            className="w-full pl-9 p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono shadow-inner"
                            placeholder="Quét mã vạch..." value={scanCode} onChange={e => setScanCode(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && (
                              setLines(prev => prev.map(l => l.id === activeLineId ? { ...l, serialInput: (l.serialInput ? `${l.serialInput}\n${scanCode.trim()}` : scanCode.trim()) } : l)),
                              setScanCode('')
                            )}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const code = scanCode.trim();
                            if (!code) return;
                            setLines(prev => prev.map(l => l.id === activeLineId ? { ...l, serialInput: (l.serialInput ? `${l.serialInput}\n${code}` : code) } : l));
                            setScanCode('');
                          }}
                          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-900 shadow-[0_1px_4px_rgba(5,150,105,0.12)] transition-colors hover:bg-emerald-100"
                        >
                          THÊM
                        </button>
                      </div>
                      <textarea 
                        className={`w-full flex-1 p-4 border rounded-xl font-mono text-xs leading-relaxed focus:ring-2 outline-none shadow-inner resize-none ${hasDuplicates ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                        placeholder="Mỗi dòng một mã Serial/IMEI..." value={activeLine?.serialInput || ''} onChange={e => setLines(prev => prev.map(l => l.id === activeLineId ? { ...l, serialInput: e.target.value } : l))}
                      />
                    </>
                  ) : (
                    <>
                      {/* Export mode: add barcode scan box to quickly select serials */}
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <ScanBarcode className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                          <input
                            className="w-full pl-9 p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500 outline-none text-sm font-mono shadow-inner"
                            placeholder="Quét mã vạch Serial/IMEI để chọn..." value={scanCode} onChange={e => setScanCode(e.target.value)}
                            onKeyDown={e => {
                              if (e.key !== 'Enter') return;
                              const code = scanCode.trim();
                              if (!code) return;
                              const list = currentItem?.serials || [];
                              if (!list.includes(code)) {
                                alert('Không tìm thấy Serial/IMEI này trong kho của mặt hàng đang chọn.');
                                setScanCode('');
                                return;
                              }
                              setLines(prev => prev.map(l => {
                                if (l.id !== activeLineId) return l;
                                const cur = l.selectedSerial || [];
                                if (cur.includes(code)) return l;
                                return { ...l, selectedSerial: [...cur, code] };
                              }));
                              setScanCode('');
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const code = scanCode.trim();
                            if (!code) return;
                            const list = currentItem?.serials || [];
                            if (!list.includes(code)) {
                              alert('Không tìm thấy Serial/IMEI này trong kho của mặt hàng đang chọn.');
                              setScanCode('');
                              return;
                            }
                            setLines(prev => prev.map(l => {
                              if (l.id !== activeLineId) return l;
                              const cur = l.selectedSerial || [];
                              return cur.includes(code) ? l : { ...l, selectedSerial: [...cur, code] };
                            }));
                            setScanCode('');
                          }}
                          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-900 shadow-[0_1px_4px_rgba(225,29,72,0.1)] transition-colors hover:bg-rose-100"
                        >
                          THÊM
                        </button>
                      </div>

                    <div className="grid grid-cols-2 gap-2 overflow-y-auto max-h-[400px] pr-1 custom-scrollbar">
                      {currentItem?.serials?.map(sn => {
                        const isSelected = (activeLine?.selectedSerial || []).includes(sn);
                        const inboundRate = currentItem.serialDetails?.find(d => d.serial === sn)?.inboundVatRate;
                        return (
                          <button 
                            key={sn} onClick={() => setLines(prev => prev.map(l => {
                              if (l.id !== activeLineId) return l;
                              const cur = l.selectedSerial || [];
                              return isSelected ? { ...l, selectedSerial: cur.filter(x => x !== sn) } : { ...l, selectedSerial: [...cur, sn] };
                            }))}
                            className={`p-2.5 rounded-xl border text-left transition-all ${isSelected ? 'bg-red-600 border-red-700 text-white shadow-md scale-[0.98]' : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-red-300'}`}
                          >
                            <p className="text-[11px] font-mono font-bold truncate">{sn}</p>
                            <p className={`text-[9px] font-semibold mt-1 opacity-70 ${isSelected ? 'text-white' : 'text-slate-400'}`}>Nhập: {inboundRate}%</p>
                          </button>
                        );
                      })}
                      {(!currentItem?.serials || currentItem.serials.length === 0) && (
                        <div className="col-span-2 py-20 text-center text-slate-300 italic text-xs">Sản phẩm này không có Serial trong kho</div>
                      )}
                    </div>
                    </>
                  )}
                </div>
              </div>

              {/* Box Tổng tiền kết luận */}
              <div className={`px-4 py-2.5 rounded-xl border shadow-md transition-all ${type === 'IMPORT' ? 'bg-emerald-600 border-emerald-500/80 text-white' : 'bg-red-600 border-red-500/80 text-white'}`}>
                 <div className="flex justify-between items-end gap-3">
                    <div>
                       <p className="text-[9px] font-semibold opacity-80 mb-0.5 tracking-tight">Tổng thanh toán sau thuế</p>
                       <p className="text-2xl font-semibold tabular-nums tracking-tighter leading-none">{formatCurrency(total)}</p>
                    </div>
                    <div className="text-right pb-0.5">
                       <p className="text-[8px] font-bold opacity-60 italic max-w-[12rem]">* {numberToVietnameseText(total).slice(0, 30)}...</p>
                    </div>
                 </div>
              </div>
            </div>
          </div>

        </div>

        <div className="px-4 py-2.5 bg-slate-100 border-t border-slate-200/80 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 font-bold hover:bg-slate-200/80 rounded-lg transition-all">HỦY BỎ</button>
          <button 
            onClick={handleConfirm}
            disabled={
              isImportingExcel ||
              (!isMultiBatchImportMode &&
                (
                  (lines || []).every(l => !(l.itemId && (parseFloat(l.quantity) || 0) > 0)) ||
                  hasDuplicates ||
                  !vatValidation.isValid ||
                  !serialMatchValidation.isValid ||
                  isProductionExportBlocked
                ))
            }
            className={`px-8 py-2 text-sm text-white rounded-lg font-semibold shadow-md transform transition-all active:scale-[0.98] disabled:opacity-50 disabled:grayscale ${type === 'IMPORT' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
          >
             {isMultiBatchImportMode ? `GHI SỔ ${importedBatches.length} PHIẾU IMPORT` : 'GHI SỔ CHỨNG TỪ'}
          </button>
        </div>
      </div>

      {/* Datalists: suggestions from Catalogs */}
      <datalist id="warehouseSupplierList">
        {supplierNameOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="warehouseCustomerList">
        {customerNameOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
};

// Helper: Read number to text simulation (đã có trong shared/utils/format.ts nhưng gọi lại để modal an toàn)
const numberToVietnameseText = (num: number) => {
   return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
};