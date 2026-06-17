
import React, { useState, useEffect, useMemo, useCallback } from 'react';
// Added DollarSign and ShieldCheck to the imports below
import { X, Search, Plus, Trash, AlertCircle, AlertTriangle, CheckCircle2, Info, Receipt as ReceiptIcon, Building as BuildingIcon, DollarSign, ShieldCheck, Download, Upload, RefreshCw } from 'lucide-react';
import { InvoiceDetail, Invoice, type BankAccount } from '@shared/types';
import {
  formatCurrency,
  formatThousandsVNFromDigits,
  numberToVietnameseText,
  parseDigitsOnly,
} from '@shared/utils/format';
import {
  buildDeferredRevenueSchedule,
  collectDeferredInvoice3387Warnings,
  getDeferredRevenueRecognitionAccount,
} from '@shared/utils/deferredRevenue';
import { coercePaidInvoicePaymentMethodFromDebtLabels } from '@shared/utils/invoiceCoercion';
import { vatAmountUnrounded } from '@shared/utils/vatRate';
import { roundInvoiceTotalsFromSums, roundVnd } from '@shared/utils/vndMoney';
import { PURCHASE_SERVICE_DEBIT_ACCOUNT_CODES } from '@shared/utils/invoicePurchaseServiceAccounts';
import { findStrictDuplicateInvoice, findSoftDuplicateSameNumber } from '@shared/utils/invoiceDuplicateIdentity';
import {
  analyzeCrossPeriodInvoice,
  isFullCrossPeriodPosting,
  isSameFyLateTaxFilingOnly,
  type PriorPeriodMateriality,
} from '@shared/utils/crossPeriodInvoice';
import { resolveBankAccountFromSnapshot } from '@shared/utils/bankAccountPayments';
import { useApp } from '../../../app/store';
import { mergePartnerNameSuggestions } from '@shared/utils/partnerNameMemory';
/** Hiển thị đầy đủ tên NH + STK trong ô chọn (không rút gọn). */
function formatBankSelectLabel(bank: Pick<BankAccount, 'bankName' | 'accountNumber'>) {
  const n = String(bank.accountNumber || '').trim();
  return `${bank.bankName} — ${n}`;
}

/** Thành tiền dòng = SL×ĐG (số thực); thuế dòng chưa làm tròn — tổng làm tròn ở totals / khi lưu. */
function normalizeInvoiceDetailLine(d: InvoiceDetail): InvoiceDetail {
  const qty = Number(d.quantity || 0);
  const price = Number(d.price || 0);
  const rawVat = Number(d.vatRate);
  const vatRate = Number.isFinite(rawVat) ? rawVat : 0;
  const amount = qty * price;
  const vatAmount = vatAmountUnrounded(amount, vatRate);
  return { ...d, quantity: qty, price, vatRate, amount, vatAmount };
}

interface InvoiceCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  mode: 'SALES' | 'PURCHASE';
  category: 'DEVICE' | 'SERVICE';
  invoice?: Invoice | null;
  onDownloadTemplate?: (mode: 'SALES' | 'PURCHASE', category: 'DEVICE' | 'SERVICE') => void;
  onImport?: (mode: 'SALES' | 'PURCHASE', category: 'DEVICE' | 'SERVICE', file: File) => Promise<void> | void;
  importing?: boolean;
}

export const InvoiceCreationModal: React.FC<InvoiceCreationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  mode,
  category,
  invoice,
  onDownloadTemplate,
  onImport,
  importing = false,
}) => {
  const {
    accounts,
    customers,
    suppliers,
    bankAccounts,
    financialYear,
    invoices: allInvoices,
    accountingPeriods,
    partnerNameHistory,
    rememberPartnerName,
  } = useApp();

  const [date, setDate] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [formNo, setFormNo] = useState('');
  const [symbolCode, setSymbolCode] = useState('');
  const [buyerTaxCode, setBuyerTaxCode] = useState('');
  const [buyerUnitName, setBuyerUnitName] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerLegalName, setBuyerLegalName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Tiền mặt' | 'Chuyển khoản' | 'Cá nhân chi hộ (3388)' | 'Công nợ'>('Tiền mặt');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [status, setStatus] = useState<'PAID' | 'PENDING'>('PAID');
  const [deferredRevenueEnabled, setDeferredRevenueEnabled] = useState(false);
  const [revenueRecognitionAccount, setRevenueRecognitionAccount] = useState('5113');
  const [serviceStartDate, setServiceStartDate] = useState('');
  const [serviceEndDate, setServiceEndDate] = useState('');
  const [crossPeriodWorkflowAcknowledged, setCrossPeriodWorkflowAcknowledged] = useState(false);
  const [sameFyTaxSupplementAcknowledged, setSameFyTaxSupplementAcknowledged] = useState(false);
  const [priorPeriodMateriality, setPriorPeriodMateriality] = useState<PriorPeriodMateriality>('IMMATERIAL');

  const [details, setDetails] = useState<InvoiceDetail[]>([
    { id: '1', productName: '', type: 'GOODS', unit: '', quantity: 1, price: 0, amount: 0, vatRate: 10, vatAmount: 0, isPromotion: false, account: '' }
  ]);
  const [activeDetailId, setActiveDetailId] = useState<string | null>(null);

  const partners = useMemo(() => {
    return mode === 'SALES' ? customers : suppliers;
  }, [mode, customers, suppliers]);

  const partnerNameOptions = useMemo(() => {
    const catalog = partners.map((p) => p.name).filter(Boolean) as string[];
    return mergePartnerNameSuggestions(mode === 'SALES' ? 'customer' : 'supplier', catalog, partnerNameHistory);
  }, [mode, partners, partnerNameHistory]);

  const invoicePeers = useMemo(
    () => allInvoices.filter((inv) => inv.type === mode && inv.category === category),
    [allInvoices, mode, category],
  );

  const crossAnalysis = useMemo(
    () => analyzeCrossPeriodInvoice(date, financialYear, accountingPeriods),
    [date, financialYear, accountingPeriods],
  );
  const fullCrossPeriod = useMemo(() => isFullCrossPeriodPosting(crossAnalysis), [crossAnalysis]);
  const sameFyLateTaxOnly = useMemo(() => isSameFyLateTaxFilingOnly(crossAnalysis), [crossAnalysis]);

  useEffect(() => {
    if (fullCrossPeriod) setDeferredRevenueEnabled(false);
  }, [fullCrossPeriod]);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const showImportTools = !invoice && !!onDownloadTemplate && !!onImport;
  const showDeferredRevenueTools = mode === 'SALES';
  const revenueRecognitionOptions = useMemo(
    () => accounts.filter((account) => ['5111', '5113'].includes(String(account.code))),
    [accounts],
  );

  const purchaseServiceDebitOptions = useMemo(() => {
    const byCode = new Map(accounts.map((a) => [String(a.code), a]));
    return PURCHASE_SERVICE_DEBIT_ACCOUNT_CODES.map((code) => byCode.get(code)).filter(
      (x): x is NonNullable<typeof x> => x != null,
    );
  }, [accounts]);
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

  const normalizeTax = (s: string) => (s || '').replace(/[^0-9]/g, '');

  const applyPartner = (p: any) => {
    if (!p) return;
    if (p.taxCode) setBuyerTaxCode(p.taxCode);
    if (p.name) setBuyerUnitName(p.name);
    if (p.address) setBuyerAddress(p.address);
    if (p.phone) setBuyerPhone(p.phone);
  };

  const tryFillPartnerByTaxCode = useCallback(
    (rawTax: string) => {
      const tax = normalizeTax(rawTax);
      if (!tax) return;
      const found = partners.find((p) => normalizeTax(p.taxCode || '') === tax);
      if (found) applyPartner(found);
    },
    [partners],
  );

  const tryFillPartnerByName = (rawName: string) => {
    const name = (rawName || '').trim().toLowerCase();
    if (!name) return;
    const found = partners.find(p => (p.name || '').trim().toLowerCase() === name);
    if (found) applyPartner(found);
  };

  // Load data
  useEffect(() => {
    if (invoice) {
      const invoiceDate = invoice.date ? invoice.date.split('T')[0] : new Date().toISOString().split('T')[0];
      setDate(invoice.date ? invoice.date.split('T')[0] : new Date().toISOString().split('T')[0]);
      setInvoiceNumber(invoice.invoiceNumber || '');
      setFormNo(invoice.formNo || '');
      setSymbolCode(invoice.symbolCode || '');
      setBuyerTaxCode(invoice.buyerTaxCode || '');
      setBuyerUnitName(invoice.buyerUnitName || invoice.customerName || '');
      setBuyerAddress(invoice.buyerAddress || '');
      setBuyerLegalName(invoice.buyerLegalName || '');
      setBuyerEmail(invoice.buyerEmail || '');
      setBuyerPhone(invoice.buyerPhone || '');
      setPaymentMethod((invoice.status === 'PENDING' ? 'Công nợ' : (invoice.paymentMethod as any) || 'Tiền mặt'));
      const matchedBankAccount = resolveBankAccountFromSnapshot(bankAccounts, invoice);
      setSelectedBankAccountId(matchedBankAccount?.id || '');
      setStatus(invoice.status === 'PENDING' ? 'PENDING' : 'PAID');
      setDeferredRevenueEnabled(!!invoice.deferredRevenueEnabled && invoice.type === 'SALES');
      setRevenueRecognitionAccount(invoice.revenueRecognitionAccount || getDeferredRevenueRecognitionAccount(invoice));
      setServiceStartDate(invoice.serviceStartDate || invoiceDate);
      setServiceEndDate(invoice.serviceEndDate || invoiceDate);
      const raw =
        invoice.details && invoice.details.length > 0
          ? invoice.details
          : [{ id: '1', productName: invoice.description || '', type: 'GOODS', unit: invoice.unit || '', quantity: invoice.quantity || 1, price: invoice.amount || 0, amount: invoice.amount || 0, vatRate: invoice.vatRate || 10, vatAmount: invoice.vatAmount || 0, isPromotion: false, account: '' }];
      setDetails(raw.map(normalizeInvoiceDetailLine));
      setCrossPeriodWorkflowAcknowledged(!!invoice.crossPeriodMeta);
      setSameFyTaxSupplementAcknowledged(
        !!invoice.vatFilingAnchorDate || invoice.taxFilingMeta?.accountingTaxSplit === 'SAME_FY_LATE_TAX',
      );
      setPriorPeriodMateriality(invoice.crossPeriodMeta?.materiality || 'IMMATERIAL');
    } else {
      const today = new Date().toISOString().split('T')[0];
      const defaultDate = (today >= financialYear.startDate && today <= financialYear.endDate) ? today : financialYear.startDate;
      setDate(defaultDate);
      setInvoiceNumber(''); setFormNo(''); setSymbolCode(''); setBuyerTaxCode(''); setBuyerUnitName(''); setBuyerAddress(''); setBuyerLegalName(''); setBuyerEmail(''); setBuyerPhone('');
      setSelectedBankAccountId(activeBankAccounts[0]?.id || '');
      setPaymentMethod('Tiền mặt'); setStatus('PAID');
      setDeferredRevenueEnabled(false);
      setRevenueRecognitionAccount(category === 'SERVICE' ? '5113' : '5111');
      setServiceStartDate(defaultDate);
      setServiceEndDate(defaultDate);
      setCrossPeriodWorkflowAcknowledged(false);
      setSameFyTaxSupplementAcknowledged(false);
      setPriorPeriodMateriality('IMMATERIAL');
      const defaultAccount = mode === 'PURCHASE' ? (category === 'SERVICE' ? '154' : '156') : '';
      setDetails([
        normalizeInvoiceDetailLine({
          id: '1',
          productName: '',
          type: category === 'SERVICE' ? 'SERVICE' : 'GOODS',
          unit: '',
          quantity: 1,
          price: 0,
          amount: 0,
          vatRate: 10,
          vatAmount: 0,
          isPromotion: false,
          account: defaultAccount,
        }),
      ]);
    }
  }, [isOpen, invoice?.id, category, mode, financialYear.startDate, financialYear.endDate]);

  // Gợi ý / tự điền đối tác theo MST/CCCD từ danh mục KH/NCC (debounce khi gõ).
  useEffect(() => {
    if (!isOpen) return;
    const n = normalizeTax(buyerTaxCode);
    if (n.length < 8) return;
    const t = window.setTimeout(() => tryFillPartnerByTaxCode(buyerTaxCode), 450);
    return () => window.clearTimeout(t);
  }, [buyerTaxCode, isOpen, tryFillPartnerByTaxCode]);

  // Keep payment method consistent with payment status (gồm HĐ từ Kho: Ghi nợ 331 / Phải thu 131).
  // Phụ thuộc invoice?.id + paymentMethod để mở lại HĐ PAID vẫn chuẩn hóa nếu DB còn nhãn nợ.
  useEffect(() => {
    if (status === 'PENDING') {
      setPaymentMethod('Công nợ');
      setSelectedBankAccountId('');
      return;
    }
    if (status !== 'PAID') return;
    const pm = String(paymentMethod || '');
    const low = pm.toLowerCase();
    const isDebt =
      pm === 'Công nợ' ||
      low.includes('ghi nợ') ||
      low.includes('phải thu') ||
      low.includes('phai thu') ||
      low.includes('công nợ') ||
      low.includes('cong no');
    if (isDebt) setPaymentMethod('Tiền mặt');
    if (paymentMethod !== 'Chuyển khoản') {
      setSelectedBankAccountId('');
      return;
    }
    const hasActiveSelection = activeBankAccounts.some((bank) => bank.id === selectedBankAccountId);
    if (selectedBankAccountId && !hasActiveSelection && activeBankAccounts.length > 0) {
      setSelectedBankAccountId(activeBankAccounts[0].id);
      return;
    }
    if (!invoice && !selectedBankAccountId && activeBankAccounts.length > 0) {
      setSelectedBankAccountId(activeBankAccounts[0].id);
    }
  }, [status, paymentMethod, invoice, selectedBankAccountId, activeBankAccounts]);

  // --- LOGIC TỔNG HỢP & VALIDATION ---
  // Tổng luôn suy từ SL×ĐG & thuế suất — không cộng amount/vatAmount trong state (tránh lệch khi mở HĐ cũ hoặc đổi giá/thuế rồi thanh toán).
  const totals = useMemo(() => {
    let sumNet = 0;
    let sumVat = 0;
    for (const d of details) {
      const qty = Number(d.quantity || 0);
      const price = Number(d.price || 0);
      const lineAmt = qty * price;
      const rawVat = Number(d.vatRate);
      const lineVat = vatAmountUnrounded(lineAmt, Number.isFinite(rawVat) ? rawVat : 0);
      sumNet += lineAmt;
      sumVat += lineVat;
    }
    const r = roundInvoiceTotalsFromSums(sumNet, sumVat);
    return { amount: r.amount, vat: r.vatAmount, total: r.totalAmount, sumNet, sumVat };
  }, [details]);

  const deferredRevenuePreview = useMemo(() => {
    if (!showDeferredRevenueTools || !deferredRevenueEnabled) return [];
    return buildDeferredRevenueSchedule({
      type: 'SALES',
      category,
      amount: totals.amount,
      deferredRevenueEnabled: true,
      serviceStartDate,
      serviceEndDate,
      revenueRecognitionAccount,
    });
  }, [showDeferredRevenueTools, deferredRevenueEnabled, category, totals.amount, serviceStartDate, serviceEndDate, revenueRecognitionAccount]);

  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Kiểm tra đối tác
    if (!buyerUnitName.trim()) errors.push(`Thiếu tên ${mode === 'SALES' ? 'người mua' : 'người bán'}`);
    if (!buyerAddress.trim()) errors.push(`Thiếu địa chỉ ${mode === 'SALES' ? 'đối tác' : 'nhà cung cấp'}`);
    if (buyerTaxCode) {
      const mstClean = buyerTaxCode.replace(/[^0-9]/g, '');
      if (mstClean.length !== 10 && mstClean.length !== 13) warnings.push("Mã số thuế có thể sai định dạng (chuẩn 10 hoặc 13 số)");
    } else if (buyerUnitName && !buyerUnitName.toLowerCase().includes("khách lẻ")) {
      warnings.push("Chưa nhập MST cho tổ chức/doanh nghiệp");
    }

    // 2. Ngày tháng & HĐ khác niên độ (TK 3387: ngoài niên độ chỉ cảnh báo nếu không phải luồng khác niên độ)
    if (date < financialYear.startDate || date > financialYear.endDate) {
      if (showDeferredRevenueTools && deferredRevenueEnabled) {
        warnings.push('Ngày hóa đơn nằm ngoài niên độ kế toán (TK 3387: chỉ cảnh báo).');
      } else if (fullCrossPeriod) {
        warnings.push(
          `Ngày HĐ ngoài niên độ đang mở — hệ thống sẽ hạch toán & kê khai thuế tại kỳ phát hiện (${crossAnalysis.discoveryPostingDate}), không sửa sổ kỳ gốc.`,
        );
      } else {
        errors.push('Ngày hóa đơn nằm ngoài niên độ kế toán');
      }
    }
    const today = new Date();
    const invDate = new Date(date + 'T12:00:00');
    const diffDays = Math.floor((today.getTime() - invDate.getTime()) / (1000 * 3600 * 24));
    if (diffDays > 30) warnings.push(`Ngày hóa đơn lùi xa (${diffDays} ngày) so với hiện tại — kiểm tra kê khai chậm / trùng.`);

    const lockedPeriod = accountingPeriods.find((p) => p.status === 'CLOSED' && date >= p.startDate && date <= p.endDate);
    if (lockedPeriod && !fullCrossPeriod && !sameFyLateTaxOnly) {
      errors.push(
        `Kỳ kế toán chứa ngày này đã bị ${lockedPeriod.lockType === 'HARD' ? 'KHÓA CỨNG' : 'KHÓA MỀM'} (${lockedPeriod.name})`,
      );
    }
    if (lockedPeriod && fullCrossPeriod) {
      warnings.push(
        `Ngày HĐ thuộc ${lockedPeriod.name} đã khóa — không ghi vào kỳ đó; bút toán dùng kỳ phát hiện (${crossAnalysis.discoveryPostingDate}).`,
      );
    }
    if (lockedPeriod && sameFyLateTaxOnly) {
      warnings.push(
        `Kỳ sổ chứa ngày HĐ đã đóng (mềm/cứng): vẫn ghi sổ theo ngày HĐ nếu bạn xác nhận kê khai bổ sung — kiểm tra quyền mở kỳ nếu cần.`,
      );
    }

    if (fullCrossPeriod) {
      warnings.push(
        `Hóa đơn khác niên độ / kỳ gốc khóa cứng: kỳ gốc (chứng từ) ${date} · kỳ phát hiện / hạch toán ${crossAnalysis.discoveryPostingDate}` +
          (crossAnalysis.originalHardLocked ? ' · kỳ gốc KHÓA CỨNG' : '') +
          (totals.vat > 0 ? ' · Thuế GTGT vào tờ khai kỳ phát hiện (bổ sung).' : ''),
      );
      if (!crossPeriodWorkflowAcknowledged) {
        errors.push('Bắt buộc tick xác nhận «Ghi nhận theo chế độ HĐ khác niên độ» (kỳ phát hiện).');
      }
    }
    if (sameFyLateTaxOnly && !fullCrossPeriod) {
      warnings.push(
        `Kê khai thuế chậm (cùng niên độ): kỳ phát sinh chứng từ ${date} · kỳ kê khai đề xuất ${crossAnalysis.discoveryPostingDate} — sổ kế toán theo ngày HĐ, không điều chỉnh 421.`,
      );
      if (totals.vat > 0) {
        warnings.push(
          mode === 'SALES'
            ? 'Gợi ý bổ sung: chỉ tiêu [37] tăng tương ứng thuế đầu ra thiếu (xem tab 01/GTGT).'
            : 'Gợi ý bổ sung: chỉ tiêu [38] tăng tương ứng thuế đầu vào thiếu (xem tab 01/GTGT).',
        );
      }
      if (!sameFyTaxSupplementAcknowledged) {
        errors.push('Bắt buộc tick xác nhận «Kê khai bổ sung cùng niên độ».');
      }
    }
    if (showDeferredRevenueTools && deferredRevenueEnabled && fullCrossPeriod) {
      errors.push('Không dùng TK 3387 (doanh thu nhận trước) cho hóa đơn khác niên độ / kỳ khóa cứng.');
    }

    // 3. Số hóa đơn & Ký hiệu
    if (!invoiceNumber.trim()) errors.push("Thiếu số hóa đơn");
    if (!symbolCode.trim()) warnings.push("Thiếu ký hiệu hóa đơn (VD: 1C23TYY)");

    const dupStrict = findStrictDuplicateInvoice(
      {
        symbolCode: symbolCode,
        invoiceNumber: invoiceNumber,
        buyerTaxCode: buyerTaxCode,
        date: date,
      },
      invoicePeers,
      invoice?.id,
    );
    if (dupStrict) {
      errors.push(
        `Trùng số hóa đơn, ký hiệu và mã số thuế: đã có ${dupStrict.invoiceNumber || dupStrict.id} · Ký hiệu ${dupStrict.symbolCode || '—'} · MST ${dupStrict.buyerTaxCode || '—'}`,
      );
    }
    const dupSoft = findSoftDuplicateSameNumber(
      {
        symbolCode: symbolCode,
        invoiceNumber: invoiceNumber,
        buyerTaxCode: buyerTaxCode,
        date: date,
      },
      invoicePeers,
      invoice?.id,
    );
    if (dupSoft && !dupStrict) {
      warnings.push(
        `Cùng số hóa đơn "${invoiceNumber.trim()}" với chứng từ khác nhưng khác ký hiệu hoặc MST (${dupSoft.invoiceNumber || dupSoft.id} · ${dupSoft.symbolCode || '—'} · MST ${dupSoft.buyerTaxCode || '—'}) — kiểm tra lại.`,
      );
    }

    // 4. Dòng hàng
    details.forEach((d, i) => {
      if (!d.productName.trim()) errors.push(`Dòng ${i+1}: Thiếu tên hàng hóa/dịch vụ`);
      if (d.quantity <= 0) errors.push(`Dòng ${i+1}: Số lượng phải > 0`);
      if (d.price < 0) errors.push(`Dòng ${i+1}: Đơn giá không được âm`);

      if (mode === 'PURCHASE') {
        const acc = String(d.account || '').trim();
        if (!acc) {
          errors.push(`Dòng ${i + 1}: Thiếu TK Nợ (hóa đơn mua bắt buộc chọn/nhập tài khoản)`);
        } else if (!/^\d{3,8}$/.test(acc)) {
          errors.push(`Dòng ${i + 1}: Mã TK Nợ không hợp lệ (chỉ gồm 3–8 chữ số)`);
        }
      }
      
      const expectedAmount = Number(d.quantity) * Number(d.price);
      if (Math.abs(Number(d.amount) - expectedAmount) > 0.0001) errors.push(`Dòng ${i+1}: Thành tiền không khớp Số lượng x Đơn giá`);
      
      const expectedVat = vatAmountUnrounded(Number(d.amount), Number.isFinite(Number(d.vatRate)) ? Number(d.vatRate) : 0);
      if (Math.abs(Number(d.vatAmount) - expectedVat) > 0.0001) warnings.push(`Dòng ${i+1}: Tiền thuế lệch so với tính trên thành tiền dòng`);
    });

    // 5. Thuế & Tổng cộng
    if (Math.abs(totals.amount + totals.vat - totals.total) > 0) errors.push("Tổng thanh toán không khớp Tổng tiền + Thuế");
    if (totals.vat > 0) {
      details.forEach((d, i) => {
        const lineVat = Number(d.vatAmount || 0);
        const r = Number(d.vatRate);
        if (lineVat > 0 && (!Number.isFinite(r) || r <= 0)) {
          errors.push(`Dòng ${i + 1}: Có tiền thuế nhưng thiếu thuế suất hợp lệ (> 0).`);
        }
      });
    }
    
    // 6. Thanh toán
    if (totals.total >= 20000000 && paymentMethod === 'Tiền mặt') {
      warnings.push("Hóa đơn ≥ 20 triệu thanh toán Tiền mặt sẽ không được khấu trừ thuế & trừ phí TNDN");
    } else if (totals.total >= 5000000 && paymentMethod === 'Tiền mặt') {
      warnings.push("Giá trị lớn (> 5tr), khuyến nghị thanh toán chuyển khoản để đảm bảo an toàn");
    }
    if (status === 'PAID' && paymentMethod === 'Chuyển khoản' && !selectedBankAccount) {
      errors.push('Đã chọn chuyển khoản nhưng chưa chọn tài khoản ngân hàng liên kết 1121xxx.');
    }

    if (showDeferredRevenueTools && deferredRevenueEnabled) {
      if (!serviceStartDate || !serviceEndDate) {
        errors.push('TK 3387 bắt buộc nhập ngày bắt đầu và ngày kết thúc dịch vụ');
      } else if (serviceEndDate < serviceStartDate) {
        errors.push('Ngày kết thúc dịch vụ phải lớn hơn hoặc bằng ngày bắt đầu');
      }
      if (totals.amount <= 0) {
        errors.push('TK 3387 chỉ áp dụng khi doanh thu trước VAT lớn hơn 0');
      }
      if (!revenueRecognitionAccount.trim()) {
        errors.push('Thiếu tài khoản ghi nhận doanh thu sau phân bổ');
      }
      warnings.push('VAT đầu ra được hạch toán ngay vào 3331, không đưa vào 3387 để phân bổ dần');
      warnings.push('TK 3387 dùng cho hóa đơn đã xuất nhưng dịch vụ chưa thực hiện hết, không thay thế cho 131 nhận trước của khách hàng');
      collectDeferredInvoice3387Warnings({
        invoiceDate: date,
        serviceStartDate,
        serviceEndDate,
        financialYearStart: financialYear.startDate,
        financialYearEnd: financialYear.endDate,
      }).forEach((w) => warnings.push(w));
    }

    return { errors, warnings, isValid: errors.length === 0 };
  }, [
    date,
    formNo,
    invoiceNumber,
    symbolCode,
    buyerTaxCode,
    buyerUnitName,
    buyerAddress,
    details,
    totals,
    financialYear,
    invoicePeers,
    accountingPeriods,
    invoice,
    showDeferredRevenueTools,
    deferredRevenueEnabled,
    serviceStartDate,
    serviceEndDate,
    revenueRecognitionAccount,
    paymentMethod,
    status,
    selectedBankAccount,
    mode,
    crossAnalysis,
    fullCrossPeriod,
    sameFyLateTaxOnly,
    crossPeriodWorkflowAcknowledged,
    sameFyTaxSupplementAcknowledged,
  ]);

  const appendDetailLine = useCallback(() => {
    const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const defaultAccount = mode === 'PURCHASE' ? (category === 'SERVICE' ? '154' : '156') : '';
    setDetails((prev) => [
      ...prev,
      normalizeInvoiceDetailLine({
        id: newId,
        productName: '',
        type: category === 'SERVICE' ? 'SERVICE' : 'GOODS',
        unit: '',
        quantity: 1,
        price: 0,
        amount: 0,
        vatRate: 10,
        vatAmount: 0,
        isPromotion: false,
        account: defaultAccount,
      }),
    ]);
    queueMicrotask(() => {
      document.getElementById(`inv-line-product-${newId}`)?.focus();
    });
  }, [category, mode]);

  if (!isOpen) return null;

  const updateDetail = (id: string, field: keyof InvoiceDetail, value: any) => {
    setDetails(prev => prev.map(d => {
      if (d.id === id) {
        const updated = { ...d, [field]: value };
        if (field === 'quantity' || field === 'price') {
          updated.amount = Number(updated.quantity) * Number(updated.price);
          updated.vatAmount = vatAmountUnrounded(updated.amount, Number(updated.vatRate));
        }
        if (field === 'vatRate') {
          const r = Number(value);
          updated.vatRate = Number.isFinite(r) ? r : 0;
          updated.vatAmount = vatAmountUnrounded(Number(updated.amount), updated.vatRate);
        }
        return updated;
      }
      return d;
    }));
  };

  const handleConfirmSave = () => {
    if (!validation.isValid) {
      alert(
        `Không thể lưu — còn ${validation.errors.length} lỗi:\n\n${validation.errors.slice(0, 12).join('\n')}${
          validation.errors.length > 12 ? `\n… và ${validation.errors.length - 12} lỗi khác` : ''
        }`,
      );
      return;
    }
    if (validation.warnings.length > 0) {
      if (!window.confirm("Vẫn còn một số cảnh báo rủi ro nghiệp vụ. Bạn có chắc chắn muốn lưu không?")) return;
    }
    const paymentMethodForSave =
      status === 'PAID'
        ? coercePaidInvoicePaymentMethodFromDebtLabels({
            ...(invoice || {}),
            status: 'PAID',
            paymentMethod,
          } as Invoice).paymentMethod
        : paymentMethod;
    const detailsOut = details.map(normalizeInvoiceDetailLine);
    const sumNet = detailsOut.reduce((s, d) => s + Number(d.amount || 0), 0);
    const sumVatF = detailsOut.reduce((s, d) => s + Number(d.vatAmount || 0), 0);
    const hdr = roundInvoiceTotalsFromSums(sumNet, sumVatF);
    const cashPostingDate =
      fullCrossPeriod && crossPeriodWorkflowAcknowledged
        ? crossAnalysis.discoveryPostingDate
        : date;
    rememberPartnerName(mode === 'SALES' ? 'customer' : 'supplier', buyerUnitName);
    onSave({
      ...(invoice ? { id: invoice.id } : {}),
      invoiceNumber, formNo, symbolCode, date, buyerTaxCode, buyerUnitName, buyerAddress,
      details: detailsOut,
      totalAmount: hdr.totalAmount,
      customerName: buyerUnitName || 'Khách lẻ',
      amount: hdr.amount,
      vatAmount: hdr.vatAmount,
      paymentMethod: paymentMethodForSave, status,
      paymentDate: status === 'PAID' ? cashPostingDate : undefined,
      bankAccountId: status === 'PAID' && paymentMethodForSave === 'Chuyển khoản' ? selectedBankAccount?.id : undefined,
      bankName: status === 'PAID' && paymentMethodForSave === 'Chuyển khoản' ? selectedBankAccount?.bankName : undefined,
      bankAccountNumber: status === 'PAID' && paymentMethodForSave === 'Chuyển khoản' ? selectedBankAccount?.accountNumber : undefined,
      bankAccountHolder: status === 'PAID' && paymentMethodForSave === 'Chuyển khoản' ? selectedBankAccount?.accountHolder : undefined,
      bankBranch: status === 'PAID' && paymentMethodForSave === 'Chuyển khoản' ? selectedBankAccount?.branch : undefined,
      bankLedgerAccountCode: status === 'PAID' && paymentMethodForSave === 'Chuyển khoản' ? selectedBankAccount?.linkedAccountCode : undefined,
      crossPeriodWorkflowAcknowledged: fullCrossPeriod && crossPeriodWorkflowAcknowledged,
      sameFyTaxSupplementAcknowledged: sameFyLateTaxOnly && !fullCrossPeriod && sameFyTaxSupplementAcknowledged,
      priorPeriodMateriality: fullCrossPeriod ? priorPeriodMateriality : undefined,
      buyerLegalName, buyerEmail, buyerPhone,
      deferredRevenueEnabled: showDeferredRevenueTools ? deferredRevenueEnabled : false,
      deferredRevenueAccount: showDeferredRevenueTools && deferredRevenueEnabled ? '3387' : undefined,
      revenueRecognitionAccount: showDeferredRevenueTools && deferredRevenueEnabled ? revenueRecognitionAccount : undefined,
      serviceStartDate: showDeferredRevenueTools && deferredRevenueEnabled ? serviceStartDate : undefined,
      serviceEndDate: showDeferredRevenueTools && deferredRevenueEnabled ? serviceEndDate : undefined,
      importedFromExcel: !!invoice?.importedFromExcel,
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-[92vh] flex flex-col animate-fade-in border border-slate-200">
        {/* Header */}
        <div className={`p-4 border-b flex justify-between items-center rounded-t-2xl ${invoice ? 'bg-amber-600' : 'bg-slate-900'} text-white`}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg">
               <ReceiptIcon className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-none">
                 {invoice ? 'Hiệu chỉnh Hóa đơn' : (mode === 'SALES' ? `Phát hành Hóa đơn Bán hàng` : `Ghi nhận Hóa đơn Mua vào`)}
              </h3>
              <p className="text-[10px] opacity-70 mt-1 font-medium tracking-tight">Loại: {category === 'SERVICE' ? 'Dịch vụ' : 'Hàng hóa thiết bị'}</p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main Form Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
             {showImportTools && (
               <input
                 ref={fileInputRef}
                 type="file"
                 className="hidden"
                 accept=".xlsx,.xls,.csv"
                 onChange={async (event) => {
                   const file = event.target.files?.[0];
                   if (!file || !onImport) return;
                   try {
                     await onImport(mode, category, file);
                   } finally {
                     event.target.value = '';
                   }
                 }}
               />
             )}

             {/* Thông tin chung: grid 2-2-2-3 + nút Excel; segmented thanh toán; input h-8, radius 4px, border #E0E0E0 */}
             <div className="space-y-3 rounded-lg border border-[#E0E0E0] bg-[#FAFBFC] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Thông tin hóa đơn</p>
                <div className="grid grid-cols-12 items-end gap-x-2 gap-y-2">
                   <div className="col-span-12 sm:col-span-2">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">Ngày lập</label>
                      <input
                        type="date"
                        className={`h-8 w-full rounded border bg-white px-2.5 text-[13px] font-semibold tabular-nums outline-none transition-shadow focus:ring-1 focus:ring-sky-400/50 ${
                          fullCrossPeriod || sameFyLateTaxOnly
                            ? 'border-amber-400 text-amber-950'
                            : date < financialYear.startDate || date > financialYear.endDate
                              ? 'border-red-400 text-red-800'
                              : 'border-[#E0E0E0] text-slate-900 focus:border-sky-500'
                        }`}
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                   </div>
                   <div className="col-span-6 sm:col-span-2">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">Mẫu số</label>
                      <input
                        className="h-8 w-full rounded border border-[#E0E0E0] bg-white px-2.5 font-mono text-[13px] font-semibold outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40"
                        placeholder="01GTKT0/001"
                        value={formNo}
                        onChange={(e) => setFormNo(e.target.value)}
                      />
                   </div>
                   <div className="col-span-6 sm:col-span-2">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">Ký hiệu</label>
                      <input
                        className="h-8 w-full rounded border border-[#E0E0E0] bg-white px-2.5 text-[13px] font-semibold uppercase outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40"
                        placeholder="1C23TYY"
                        value={symbolCode}
                        onChange={(e) => setSymbolCode(e.target.value)}
                      />
                   </div>
                   <div className="col-span-12 sm:col-span-3">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">Số hóa đơn</label>
                      <input
                        className="h-8 w-full rounded border border-[#E0E0E0] bg-white px-2.5 text-[13px] font-semibold text-red-600 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40"
                        placeholder="0000123"
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                      />
                   </div>
                   {showImportTools && (
                     <div className="col-span-12 flex flex-wrap items-center justify-end gap-1 sm:col-span-3">
                        <button
                          type="button"
                          onClick={() => onDownloadTemplate?.(mode, category)}
                          title="Tải mẫu Excel"
                          className="inline-flex h-8 items-center gap-1 rounded border border-[#E0E0E0] bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Download className="h-3.5 w-3.5 shrink-0 text-sky-600" strokeWidth={2} />
                          <span>Tải mẫu</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={importing}
                          title={importing ? 'Đang nhập…' : 'Nhập từ Excel'}
                          className={`inline-flex h-8 items-center gap-1 rounded border px-2 text-[11px] font-medium ${
                            importing
                              ? 'cursor-not-allowed border-[#E0E0E0] bg-slate-100 text-slate-400'
                              : 'border-[#E0E0E0] bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {importing ? (
                            <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2} />
                          ) : (
                            <Upload className="h-3.5 w-3.5 shrink-0 text-sky-600" strokeWidth={2} />
                          )}
                          <span>{importing ? 'Đang nhập…' : 'Nhập Excel'}</span>
                        </button>
                     </div>
                   )}
                </div>

                <div className="border-t border-[#E0E0E0] pt-3">
                   <p className="mb-2 text-xs font-medium text-slate-600">Trạng thái thanh toán</p>
                   <div className="flex min-w-0 flex-wrap items-center gap-2 gap-y-2">
                      <div
                        role="tablist"
                        aria-label="Trạng thái thanh toán"
                        className="inline-flex h-8 shrink-0 rounded border border-[#E0E0E0] bg-white p-0.5"
                      >
                         <button
                           type="button"
                           role="tab"
                           aria-selected={status === 'PAID'}
                           onClick={() => setStatus('PAID')}
                           className={`rounded px-3 text-xs font-semibold transition-colors ${
                             status === 'PAID'
                               ? 'bg-sky-100 text-sky-900 shadow-sm'
                               : 'text-slate-600 hover:bg-slate-50'
                           }`}
                         >
                           Thanh toán ngay
                         </button>
                         <button
                           type="button"
                           role="tab"
                           aria-selected={status === 'PENDING'}
                           onClick={() => setStatus('PENDING')}
                           className={`rounded px-3 text-xs font-semibold transition-colors ${
                             status === 'PENDING'
                               ? 'bg-amber-50 text-amber-900 shadow-sm ring-1 ring-amber-200/80'
                               : 'text-slate-600 hover:bg-slate-50'
                           }`}
                         >
                           Ghi nhận nợ
                         </button>
                      </div>
                      {status === 'PAID' && (
                        <select
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value as any)}
                          className="h-8 w-[min(100%,11rem)] shrink-0 rounded border border-[#E0E0E0] bg-white px-2 text-[13px] font-semibold text-slate-800 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40"
                          aria-label="Tài khoản tiền"
                        >
                          <option value="Tiền mặt">Tiền mặt (1111)</option>
                          <option value="Chuyển khoản">Chuyển khoản (TK NH)</option>
                          {mode === 'PURCHASE' && (
                            <option value="Cá nhân chi hộ (3388)">Cá nhân chi hộ (3388)</option>
                          )}
                        </select>
                      )}
                      {status === 'PAID' && paymentMethod === 'Chuyển khoản' && (
                        <>
                          <span className="sr-only">Ngân hàng liên kết</span>
                          <select
                            value={selectedBankAccountId}
                            onChange={(e) => setSelectedBankAccountId(e.target.value)}
                            className="h-8 min-w-0 max-w-full flex-1 basis-[min(100%,12rem)] rounded border border-[#E0E0E0] bg-white px-2 text-[12px] font-semibold text-slate-800 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40 sm:basis-[14rem]"
                            title={
                              selectedBankAccount
                                ? formatBankSelectLabel(selectedBankAccount)
                                : 'Chọn tài khoản ngân hàng — bút toán vào TK 1121xxx đã gán'
                            }
                            aria-label="Ngân hàng liên kết"
                          >
                            <option value="">— Chọn ngân hàng —</option>
                            {activeBankAccounts.map((bank) => (
                              <option key={bank.id} value={bank.id}>
                                {formatBankSelectLabel(bank)}
                              </option>
                            ))}
                          </select>
                          <span
                            className="inline-flex shrink-0 cursor-help text-slate-400 hover:text-slate-600"
                            title="Bút toán tiền ghi vào tài khoản con 1121xxx đã liên kết (không dùng 1121 tổng hợp)."
                          >
                            <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          </span>
                        </>
                      )}
                   </div>
                   {status === 'PAID' && paymentMethod === 'Chuyển khoản' && selectedBankAccount && (
                     <p className="mt-2 text-[11px] leading-tight text-slate-500">
                       Hạch toán: <span className="font-mono font-medium text-slate-700">{selectedBankAccount.linkedAccountCode}</span>
                       {' · '}
                       <span className="text-slate-600">{selectedBankAccount.bankName}</span>
                       {' · '}
                       <span className="font-mono">{selectedBankAccount.accountNumber}</span>
                     </p>
                   )}
                </div>
             </div>

             {fullCrossPeriod && (
               <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-4 space-y-3 shadow-sm">
                 <div className="flex items-start gap-2">
                   <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                   <div>
                     <h4 className="text-sm font-bold text-amber-950">Xử lý hóa đơn khác niên độ / kỳ gốc khóa cứng</h4>
                     <p className="text-[11px] text-amber-900/90 leading-relaxed mt-1">
                       Kỳ gốc (ngày trên HĐ): <b>{date}</b> — Kỳ phát hiện / hạch toán: <b>{crossAnalysis.discoveryPostingDate}</b>.
                       Sổ kế toán và chứng từ tiền dùng ngày kỳ phát hiện; không sửa dữ liệu kỳ đã khóa. Thuế GTGT vào tờ khai kỳ này (bổ sung nếu cần).
                     </p>
                   </div>
                 </div>
                 <label className="flex items-start gap-2 cursor-pointer text-[12px] text-amber-950">
                   <input
                     type="checkbox"
                     className="mt-1 rounded border-amber-400"
                     checked={crossPeriodWorkflowAcknowledged}
                     onChange={(e) => setCrossPeriodWorkflowAcknowledged(e.target.checked)}
                   />
                   <span>
                     Tôi xác nhận ghi nhận theo chế độ <b>HĐ khác niên độ</b> (điều chỉnh tại kỳ hiện tại, kê khai thuế tại kỳ phát hiện).
                   </span>
                 </label>
                 <div className="space-y-1.5">
                   <p className="text-[10px] font-semibold text-amber-900 uppercase tracking-wide">Mức trọng yếu (ảnh hưởng BCTC)</p>
                   <div className="flex flex-wrap gap-3 text-[12px]">
                     <label className="inline-flex items-center gap-2 cursor-pointer">
                       <input
                         type="radio"
                         name="priorMat"
                         checked={priorPeriodMateriality === 'IMMATERIAL'}
                         onChange={() => setPriorPeriodMateriality('IMMATERIAL')}
                       />
                       Không trọng yếu → DT/CP kỳ hiện tại
                     </label>
                     <label className="inline-flex items-center gap-2 cursor-pointer">
                       <input
                         type="radio"
                         name="priorMat"
                         checked={priorPeriodMateriality === 'MATERIAL'}
                         onChange={() => setPriorPeriodMateriality('MATERIAL')}
                       />
                       Trọng yếu → điều chỉnh qua TK 421
                     </label>
                   </div>
                 </div>
               </div>
             )}

             {sameFyLateTaxOnly && !fullCrossPeriod && (
               <div className="rounded-xl border border-sky-200 bg-sky-50/90 p-4 space-y-3 shadow-sm">
                 <div className="flex items-start gap-2">
                   <AlertTriangle className="w-5 h-5 text-sky-800 shrink-0 mt-0.5" />
                   <div>
                     <h4 className="text-sm font-bold text-sky-950">Kê khai thuế sai kỳ / chậm (cùng niên độ)</h4>
                     <p className="text-[11px] text-sky-900/95 leading-relaxed mt-1">
                       <b>Kỳ phát sinh</b> (chứng từ): {date} — <b>Kỳ kê khai đề xuất</b> (phát hiện): {crossAnalysis.discoveryPostingDate}.
                       Sổ kế toán và bút toán theo <b>ngày HĐ</b>; chỉ tổng hợp GTGT chuyển sang kỳ phát hiện (bổ sung). Không hạch toán điều chỉnh 421.
                     </p>
                   </div>
                 </div>
                 <label className="flex items-start gap-2 cursor-pointer text-[12px] text-sky-950">
                   <input
                     type="checkbox"
                     className="mt-1 rounded border-sky-400"
                     checked={sameFyTaxSupplementAcknowledged}
                     onChange={(e) => setSameFyTaxSupplementAcknowledged(e.target.checked)}
                   />
                   <span>
                     Tôi xác nhận <b>kê khai bổ sung cùng niên độ</b> — không sửa tờ khai đã nộp của kỳ trước; thuế vào kỳ hiện tại.
                   </span>
                 </label>
               </div>
             )}

             {/* Buyer/Supplier — hàng 1: 3+9; hàng 2: địa chỉ 12; hàng 3: 4+4+4 */}
             <div className="relative overflow-hidden rounded-lg border border-[#E0E0E0] bg-white p-4 shadow-sm">
                <div className="absolute right-0 top-0 p-3 opacity-5">
                   <BuildingIcon className="h-20 w-20" />
                </div>
                <h4 className="mb-3 flex items-center gap-2 border-b border-[#E0E0E0] pb-2 text-xs font-semibold text-slate-600">
                   <Info className="h-3.5 w-3.5" strokeWidth={2} /> Thông tin {mode === 'SALES' ? 'Người mua hàng' : 'Nhà cung cấp'}
                </h4>
                <div className="grid grid-cols-12 gap-x-2 gap-y-2">
                   <div className="col-span-12 md:col-span-3">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">Mã số thuế / CCCD</label>
                      <div className="flex gap-1">
                        <input
                          list="partnerTaxList"
                          autoComplete="off"
                          className="h-8 min-w-0 flex-1 rounded border border-[#E0E0E0] bg-white px-2.5 font-mono text-[13px] outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40"
                          placeholder="MST / CCCD"
                          value={buyerTaxCode}
                          onChange={(e) => setBuyerTaxCode(e.target.value)}
                          onBlur={() => tryFillPartnerByTaxCode(buyerTaxCode)}
                        />
                        <button
                          type="button"
                          onClick={() => tryFillPartnerByTaxCode(buyerTaxCode)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#E0E0E0] bg-white text-slate-600 hover:bg-slate-50"
                          title={`Tìm ${mode === 'SALES' ? 'khách hàng' : 'nhà cung cấp'} theo MST`}
                        >
                          <Search className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      </div>
                   </div>
                   <div className="col-span-12 md:col-span-9">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">Tên đơn vị / Khách hàng</label>
                      <input
                        list="partnerNameList"
                        className="h-8 w-full rounded border border-[#E0E0E0] bg-white px-2.5 text-[13px] font-semibold text-slate-800 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40"
                        placeholder={mode === 'SALES' ? 'Chọn/nhập khách hàng...' : 'Chọn/nhập nhà cung cấp...'}
                        value={buyerUnitName}
                        onChange={(e) => setBuyerUnitName(e.target.value)}
                        onBlur={() => {
                          rememberPartnerName(mode === 'SALES' ? 'customer' : 'supplier', buyerUnitName);
                          tryFillPartnerByName(buyerUnitName);
                        }}
                      />
                   </div>
                   <div className="col-span-12">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">Địa chỉ đăng ký</label>
                      <input
                        className="h-8 w-full rounded border border-[#E0E0E0] bg-white px-2.5 text-[13px] outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40"
                        value={buyerAddress}
                        onChange={(e) => setBuyerAddress(e.target.value)}
                      />
                   </div>
                   <div className="col-span-12 sm:col-span-4">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">Người đại diện / Liên hệ</label>
                      <input
                        className="h-8 w-full rounded border border-[#E0E0E0] bg-white px-2.5 text-[13px] outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40"
                        value={buyerLegalName}
                        onChange={(e) => setBuyerLegalName(e.target.value)}
                      />
                   </div>
                   <div className="col-span-12 sm:col-span-4">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">Email nhận hóa đơn</label>
                      <input
                        type="email"
                        className="h-8 w-full rounded border border-[#E0E0E0] bg-white px-2.5 text-[13px] outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40"
                        value={buyerEmail}
                        onChange={(e) => setBuyerEmail(e.target.value)}
                      />
                   </div>
                   <div className="col-span-12 sm:col-span-4">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">Số điện thoại</label>
                      <input
                        type="tel"
                        className="h-8 w-full rounded border border-[#E0E0E0] bg-white px-2.5 text-[13px] outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400/40"
                        value={buyerPhone}
                        onChange={(e) => setBuyerPhone(e.target.value)}
                      />
                   </div>
                </div>
             </div>

             {/* Partner suggestion lists (from Danh mục: Khách hàng / Nhà cung cấp) */}
             <datalist id="partnerNameList">
               {partnerNameOptions.map((name) => (
                 <option key={name} value={name} />
               ))}
             </datalist>
             <datalist id="partnerTaxList">
               {partners.filter(p => p.taxCode).map(p => (
                 <option key={p.id} value={p.taxCode as string}>
                   {p.name}
                 </option>
               ))}
             </datalist>

             {/* Danh mục: header #F8F9FA, ô nhập borderless + hover/focus; SL có +/- gọn */}
             <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                   <h4 className="text-xs font-semibold text-slate-600">Danh mục hàng hóa / dịch vụ</h4>
                   <button
                     type="button"
                     onClick={appendDetailLine}
                     className="inline-flex h-8 items-center gap-1 rounded border border-[#E0E0E0] bg-sky-600 px-2.5 text-xs font-semibold text-white hover:bg-sky-700"
                   >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Thêm dòng
                   </button>
                </div>
                <div className="overflow-hidden rounded border border-[#E0E0E0] bg-white">
                   <div className="max-h-[min(52vh,28rem)] overflow-auto overflow-x-auto">
                      <table className="w-full min-w-[800px] table-fixed border-collapse text-left text-[13px]">
                         <thead className="sticky top-0 z-20 border-b border-[#E0E0E0] bg-[#F8F9FA] text-[11px] font-semibold text-slate-600 shadow-sm">
                            <tr className="h-8">
                               <th className="w-[40px] max-w-[40px] px-1 text-center align-middle">#</th>
                               <th className="min-w-[12rem] px-2 py-1.5 align-middle">Tên sản phẩm / dịch vụ</th>
                               {mode === 'PURCHASE' && (
                                 <th className="w-[9rem] max-w-[9rem] min-w-0 px-2 py-1.5 align-middle">TK nợ</th>
                               )}
                               <th className="w-20 px-1 py-1.5 text-center align-middle">Đvt</th>
                               <th className="w-[80px] max-w-[80px] px-0.5 py-1.5 text-center align-middle">Sl</th>
                               <th className="w-[120px] px-1 py-1.5 text-right align-middle">Đơn giá</th>
                               <th className="w-[120px] px-1 py-1.5 text-right align-middle">Thành tiền</th>
                               <th className="w-20 px-1 py-1.5 text-center align-middle">Thuế %</th>
                               <th className="w-8 px-0 py-1.5 align-middle" />
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-[#E0E0E0]">
                            {details.map((item, idx) => {
                               const isLast = idx === details.length - 1;
                               const rowHighlight = activeDetailId === item.id;
                               const handleLineKeyDown = (e: React.KeyboardEvent) => {
                                 if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                                 const t = e.target as HTMLElement;
                                 if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
                                 if (!isLast) return;
                                 e.preventDefault();
                                 appendDetailLine();
                               };
                               const selectedDebitAccount = purchaseServiceDebitOptions.find((a) => a.code === item.account);
                               const tkDebtTitle = selectedDebitAccount
                                 ? `${selectedDebitAccount.code} — ${selectedDebitAccount.name}`
                                 : item.account || '';
                               return (
                                 <tr
                                   key={item.id}
                                   className={`group transition-colors ${
                                     rowHighlight ? 'bg-sky-50/90 ring-1 ring-inset ring-sky-200/70' : 'hover:bg-slate-50/80'
                                   }`}
                                   onFocusCapture={() => setActiveDetailId(item.id)}
                                 >
                                    <td className="px-1 py-0.5 align-middle text-center font-mono text-[11px] leading-7 text-slate-500">{idx + 1}</td>
                                    <td className="px-1 py-0.5 align-middle">
                                       <input
                                          id={`inv-line-product-${item.id}`}
                                          type="text"
                                          className="h-7 w-full rounded border border-transparent bg-transparent px-2 text-[13px] font-medium text-slate-800 outline-none transition-colors placeholder:text-slate-400 hover:border-[#E0E0E0] focus:border-sky-500 focus:ring-1 focus:ring-sky-400/35"
                                         value={item.productName}
                                         onChange={(e) => updateDetail(item.id, 'productName', e.target.value)}
                                         onKeyDown={handleLineKeyDown}
                                         placeholder="Tên hàng hóa, dịch vụ"
                                       />
                                    </td>
                                    {mode === 'PURCHASE' && (
                                      <td className="w-[9rem] max-w-[9rem] min-w-0 px-1 py-0.5 align-middle">
                                         <div className="min-w-0 max-w-full overflow-hidden">
                                           <select
                                             title={tkDebtTitle || undefined}
                                             className="h-7 w-full min-w-0 max-w-full cursor-pointer truncate rounded border border-transparent bg-transparent py-0 pl-1.5 pr-1 text-left text-[12px] font-semibold text-sky-800 outline-none hover:border-[#E0E0E0] focus:border-sky-500 focus:ring-1 focus:ring-sky-400/35"
                                             value={item.account}
                                             onChange={(e) => updateDetail(item.id, 'account', e.target.value)}
                                           >
                                            {item.account &&
                                              !purchaseServiceDebitOptions.some((a) => a.code === item.account) && (
                                                <option value={item.account}>
                                                  {item.account} (đang dùng — không có trong danh mục mở rộng)
                                                </option>
                                              )}
                                            {purchaseServiceDebitOptions.map((a) => (
                                              <option key={a.code} value={a.code}>
                                                {a.code} — {a.name}
                                              </option>
                                            ))}
                                           </select>
                                         </div>
                                      </td>
                                    )}
                                    <td className="px-1 py-0.5 align-middle">
                                       <input
                                         className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-center text-[13px] outline-none hover:border-[#E0E0E0] focus:border-sky-500 focus:ring-1 focus:ring-sky-400/35"
                                         value={item.unit}
                                         onChange={(e) => updateDetail(item.id, 'unit', e.target.value)}
                                         onKeyDown={handleLineKeyDown}
                                         placeholder="—"
                                       />
                                    </td>
                                    <td className="w-[80px] max-w-[80px] px-0.5 py-0.5 align-middle">
                                       <input
                                         type="number"
                                         className="h-7 w-full rounded border border-transparent bg-transparent px-0.5 text-center text-[12px] font-semibold tabular-nums outline-none transition-colors hover:border-[#E0E0E0] focus:border-sky-500 focus:ring-1 focus:ring-sky-400/35 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
                                         value={item.quantity}
                                         onChange={(e) => updateDetail(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                                         onKeyDown={handleLineKeyDown}
                                       />
                                    </td>
                                    <td className="px-1 py-0.5 align-middle">
                                       <input
                                         type="number"
                                         step="0.0001"
                                         min={0}
                                         className="h-7 w-full rounded border border-transparent bg-transparent px-2 text-right font-mono text-[13px] tabular-nums outline-none hover:border-[#E0E0E0] focus:border-sky-500 focus:ring-1 focus:ring-sky-400/35"
                                         value={item.price === 0 ? '' : item.price}
                                         onChange={(e) => {
                                           const n = parseFloat(e.target.value);
                                           updateDetail(item.id, 'price', Number.isFinite(n) ? n : 0);
                                         }}
                                         onKeyDown={handleLineKeyDown}
                                         placeholder="0"
                                       />
                                    </td>
                                    <td className="px-1 py-0.5 align-middle">
                                       <div className="flex h-7 items-center justify-end pr-2 text-[12px] font-semibold tabular-nums text-slate-800">
                                         {formatCurrency(item.amount)}
                                       </div>
                                    </td>
                                    <td className="px-1 py-0.5 align-middle">
                                       <select
                                         className="h-7 w-full rounded border border-transparent bg-transparent px-0.5 text-center text-[12px] font-semibold text-sky-700 outline-none hover:border-[#E0E0E0] focus:border-sky-500 focus:ring-1 focus:ring-sky-400/35"
                                         value={item.vatRate}
                                         onChange={(e) => updateDetail(item.id, 'vatRate', parseFloat(e.target.value))}
                                       >
                                          <option value={-1}>KCT</option>
                                          <option value={0}>0%</option>
                                          <option value={5}>5%</option>
                                          <option value={8}>8%</option>
                                          <option value={10}>10%</option>
                                       </select>
                                    </td>
                                    <td className="px-0 py-0.5 align-middle">
                                       <div className="flex h-7 items-center justify-center">
                                          <button
                                            type="button"
                                            onClick={() => setDetails((prev) => prev.filter((d) => d.id !== item.id))}
                                            className="rounded p-1 text-rose-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"
                                            aria-label="Xóa dòng"
                                          >
                                             <Trash className="h-3.5 w-3.5" strokeWidth={2} />
                                          </button>
                                       </div>
                                    </td>
                                 </tr>
                               );
                            })}
                         </tbody>
                      </table>
                   </div>
                </div>
             </div>
          </div>

          {/* Validation & Sidebar Info */}
          <div className="w-80 bg-slate-50 border-l border-slate-200 p-5 flex flex-col gap-5 overflow-y-auto custom-scrollbar shadow-[inset_10px_0_15px_-15px_rgba(0,0,0,0.1)]">
             {/* Totals Card */}
             <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                <h5 className="flex items-center gap-2 border-b pb-2 text-[10px] font-semibold tracking-tight text-slate-500">
                   <DollarSign className="w-3 h-3" /> Tổng thanh toán
                </h5>
                <div className="space-y-2 text-sm">
                   <div className="flex justify-between text-slate-500">
                      <span>Tiền hàng:</span>
                      <span className="font-medium tabular-nums">{formatCurrency(totals.amount)}</span>
                   </div>
                   <div className="flex justify-between text-slate-500">
                      <span>Thuế GTGT:</span>
                      <span className="font-medium tabular-nums">{formatCurrency(totals.vat)}</span>
                   </div>
                   <div className="pt-2 border-t flex justify-between items-end">
                      <span className="text-[10px] font-semibold text-slate-800">Cộng:</span>
                      <span className="text-xl font-semibold text-blue-700 tracking-tighter tabular-nums">{formatCurrency(totals.total)}</span>
                   </div>
                </div>
                <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                   <p className="text-[9px] mb-1 font-medium text-blue-500">Số tiền bằng chữ</p>
                   <p className="text-[11px] font-bold text-blue-800 italic leading-snug">{numberToVietnameseText(totals.total)}</p>
                </div>
             </div>

             {showDeferredRevenueTools && (
               <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between border-b pb-2">
                     <h5 className="text-[10px] font-semibold tracking-tight text-slate-500">Doanh thu chưa thực hiện</h5>
                     <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${deferredRevenueEnabled ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {deferredRevenueEnabled ? '3387 bật' : 'Ghi nhận ngay'}
                     </span>
                  </div>
                  <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                     <button
                       type="button"
                       disabled={fullCrossPeriod}
                       onClick={() => setDeferredRevenueEnabled(false)}
                       className={`flex-1 rounded-lg py-2 text-[11px] font-semibold transition-all ${!deferredRevenueEnabled ? 'bg-white shadow text-slate-800' : 'text-slate-500'} ${fullCrossPeriod ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                       511 ngay
                     </button>
                     <button
                       type="button"
                       disabled={fullCrossPeriod}
                       onClick={() => {
                         setDeferredRevenueEnabled(true);
                         if (!serviceStartDate) setServiceStartDate(date);
                         if (!serviceEndDate) setServiceEndDate(date);
                       }}
                       className={`flex-1 rounded-lg py-2 text-[11px] font-semibold transition-all ${deferredRevenueEnabled ? 'bg-amber-500 text-white shadow' : 'text-slate-500'} ${fullCrossPeriod ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                       Treo 3387
                     </button>
                  </div>
                  {fullCrossPeriod && (
                    <p className="text-[10px] text-amber-800">HĐ khác niên độ / kỳ khóa cứng không dùng TK 3387.</p>
                  )}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 leading-relaxed space-y-1">
                     <p><b>Theo dõi bắt buộc:</b> Khách hàng + Mã hóa đơn.</p>
                     <p><b>Thuế GTGT:</b> bóc tách ngay vào 3331, không đưa vào 3387.</p>
                     <p><b>Phân biệt với 131:</b> 131 là nhận trước chưa xuất hóa đơn, còn 3387 là đã xuất hóa đơn nhưng dịch vụ chưa thực hiện hết.</p>
                  </div>
                  {deferredRevenueEnabled && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px]">Từ ngày</label>
                          <input type="date" value={serviceStartDate} onChange={e => setServiceStartDate(e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-500" />
                        </div>
                        <div>
                          <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px]">Đến ngày</label>
                          <input type="date" value={serviceEndDate} onChange={e => setServiceEndDate(e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-500" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] mb-1 font-medium text-slate-500 text-[10px]">TK ghi nhận doanh thu khi phân bổ</label>
                        <select value={revenueRecognitionAccount} onChange={e => setRevenueRecognitionAccount(e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-amber-500">
                          {revenueRecognitionOptions.map((account) => (
                            <option key={account.code} value={account.code}>{account.code} - {account.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                        <div className="flex justify-between text-[11px] font-bold text-slate-700">
                          <span>Doanh thu treo 3387</span>
                          <span>{formatCurrency(totals.amount)}</span>
                        </div>
                        <div className="mt-2 space-y-1">
                          {deferredRevenuePreview.slice(0, 4).map((row) => (
                            <div key={row.period} className="flex items-center justify-between text-[11px] text-slate-600">
                              <span>{row.periodLabel} · {row.days} ngày</span>
                              <span className="font-bold text-amber-700">{formatCurrency(row.amount)}</span>
                            </div>
                          ))}
                          {deferredRevenuePreview.length > 4 && (
                            <div className="text-[10px] text-slate-400 italic">Còn {deferredRevenuePreview.length - 4} kỳ phân bổ nữa sẽ hiển thị sau khi lưu hóa đơn.</div>
                          )}
                          {deferredRevenuePreview.length === 0 && (
                            <div className="text-[10px] text-slate-400 italic">Nhập kỳ dịch vụ để hệ thống tính doanh thu theo số ngày thực tế.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
               </div>
             )}

             {/* Validation Center */}
             <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden">
                <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                   <h5 className="flex items-center gap-2 text-[10px] font-semibold tracking-tight text-slate-600">
                      <ShieldCheck className={`w-3 h-3 ${validation.errors.length > 0 ? 'text-red-500' : 'text-emerald-500'}`} /> Kiểm soát rủi ro
                   </h5>
                   <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${validation.isValid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {validation.errors.length + validation.warnings.length} tin
                   </span>
                </div>
                <div className="p-4 overflow-y-auto space-y-4">
                   {validation.errors.length > 0 && (
                      <div className="space-y-2">
                         <p className="text-[10px] flex font-semibold text-red-600 items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Lỗi nghiêm trọng ({validation.errors.length})</p>
                         {validation.errors.map((err, i) => (
                            <div key={i} className="text-[11px] text-red-700 bg-red-50/50 p-2 rounded-lg border border-red-100 leading-relaxed font-medium">{err}</div>
                         ))}
                      </div>
                   )}
                   {validation.warnings.length > 0 && (
                      <div className="space-y-2">
                         <p className="text-[10px] flex font-semibold text-amber-600 items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Cảnh báo rủi ro ({validation.warnings.length})</p>
                         {validation.warnings.map((warn, i) => (
                            <div key={i} className="text-[11px] text-amber-700 bg-amber-50/50 p-2 rounded-lg border border-amber-100 leading-relaxed font-medium">{warn}</div>
                         ))}
                      </div>
                   )}
                   {validation.isValid && validation.warnings.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-10 opacity-40">
                         <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-2" />
                         <p className="text-xs font-medium tracking-tight text-slate-500">Dữ liệu hợp lệ</p>
                      </div>
                   )}
                </div>
             </div>

             {/* Action Buttons */}
             <div className="mt-auto space-y-2">
                {!validation.isValid && validation.errors.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50/90 px-3 py-2 text-[11px] text-red-800 leading-snug">
                    <span className="font-semibold tracking-tight">Chưa thể {invoice ? 'cập nhật' : 'ghi sổ'}: </span>
                    {validation.errors.length <= 3
                      ? validation.errors.join(' · ')
                      : `${validation.errors.slice(0, 2).join(' · ')} · +${validation.errors.length - 2} lỗi (xem khung Kiểm soát rủi ro)`}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 font-bold rounded-xl shadow-sm hover:bg-slate-50 transition-all text-sm">Hủy</button>
                  <button 
                    type="button"
                    onClick={handleConfirmSave}
                    disabled={!validation.isValid}
                    title={!validation.isValid ? `Chưa đủ điều kiện lưu: ${validation.errors[0] || 'xem lỗi bên trên'}` : undefined}
                    className={`px-4 py-2 ${invoice ? 'bg-amber-500 hover:bg-amber-600 disabled:bg-amber-400' : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400'} text-white font-semibold rounded-xl shadow-lg transition-all text-sm disabled:opacity-80 disabled:cursor-not-allowed`}
                  >
                     {invoice ? 'Cập nhật' : 'Ghi sổ ngay'}
                  </button>
                </div>
             </div>
          </div>
        </div>
      </div>
      
      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}} />
    </div>
  );
};

// Sub-component Helper
const Building = ({ className }: { className?: string }) => (
   <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M16 14h.01"/></svg>
);

const Receipt = ({ className }: { className?: string }) => (
   <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5V6.5"/></svg>
);
