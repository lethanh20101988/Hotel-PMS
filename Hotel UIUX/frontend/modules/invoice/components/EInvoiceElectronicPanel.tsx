import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Bot,
  MessageSquare,
  Package,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { useApp } from '../../../app/store';
import type { BankAccount, InventoryItem, Warehouse } from '@shared/types';
import {
  getDefaultWarehouseId,
  getWarehouseBalance,
  normalizeWarehouses,
} from '@shared/utils/warehouseInventory';

type EInvoiceAutoClass = 'EXPENSE' | 'ASSET' | 'TOOL' | 'DEVICE' | 'UNKNOWN';

type XmlLinePostingKind = 'WAREHOUSE' | 'EXPENSE_6421' | 'EXPENSE_6422' | 'PREPAID_12M';

type ParsedLine = {
  lineId: string;
  name: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  vatRate: number;
  vatAmount: number;
};

type TaxXmlPayload = {
  version: 2;
  pipeline: 'TAX_XML';
  sourceFileName: string;
  parseError?: string;
  parsed?: {
    sellerName: string;
    sellerTax: string;
    sellerAddress: string;
    buyerName: string;
    buyerTax: string;
    buyerAddress: string;
    formNo: string;
    symbolCode: string;
    invoiceNumber: string;
    invoiceDate: string;
    currency: string;
    totalAmount: number;
    totalVat: number;
    totalPayment: number;
    direction: 'PURCHASE' | 'SALES';
    lines: ParsedLine[];
  };
  review: {
    autoClassification: EInvoiceAutoClass;
    duplicateBatchIds: string[];
    duplicateReason?: string;
    riskWarnings: string[];
    aiJournalSuggestion?: string;
    aiChatHistory?: { role: 'user' | 'assistant'; content: string }[];
  };
  staging: {
    lineInventoryItemId: Record<string, string>;
    lineSkuNote: Record<string, string>;
    lineSerials: Record<string, string>;
    performer?: string;
    paymentStatus?: 'PAID' | 'PENDING';
    paymentMethod?: 'CASH' | 'BANK';
    bankAccountId?: string;
    bankName?: string;
    bankAccountNumber?: string;
    bankAccountHolder?: string;
    bankBranch?: string;
    bankLedgerAccountCode?: string;
    /** Cách ghi nhận từng dòng XML khi chọn «Nhập kho + HĐ mua» */
    linePostingKind?: Record<string, XmlLinePostingKind>;
  };
  committedAt?: string;
};

type BatchRow = {
  id: string;
  createdAt: string;
  fileName: string;
  batchStatus: string;
  queueStatus: string;
  payload: TaxXmlPayload;
};

function authHeaders(): HeadersInit {
  try {
    const token = localStorage.getItem('auth_token') || '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

const classLabel: Record<EInvoiceAutoClass, string> = {
  EXPENSE: 'Chi phí / Dịch vụ',
  ASSET: 'Tài sản',
  TOOL: 'Công cụ dụng cụ',
  DEVICE: 'Hàng hóa / Thiết bị',
  UNKNOWN: 'Chưa phân loại',
};

const classColor: Record<EInvoiceAutoClass, string> = {
  EXPENSE: 'bg-amber-100 text-amber-900',
  ASSET: 'bg-violet-100 text-violet-900',
  TOOL: 'bg-cyan-100 text-cyan-900',
  DEVICE: 'bg-emerald-100 text-emerald-900',
  UNKNOWN: 'bg-slate-100 text-slate-700',
};

function accountForClass(c: EInvoiceAutoClass): string {
  if (c === 'EXPENSE') return '6427';
  if (c === 'ASSET') return '2411';
  if (c === 'TOOL') return '153';
  return '156';
}

function bankSnapshotFromAccount(bank: BankAccount) {
  return {
    bankAccountId: bank.id,
    bankName: bank.bankName,
    bankAccountNumber: bank.accountNumber,
    bankAccountHolder: bank.accountHolder,
    bankBranch: bank.branch,
    bankLedgerAccountCode: bank.linkedAccountCode,
  };
}

function resolveXmlLinePostingKind(staging: TaxXmlPayload['staging'], lineId: string): XmlLinePostingKind {
  const k = staging.linePostingKind?.[lineId];
  if (k === 'EXPENSE_6421' || k === 'EXPENSE_6422' || k === 'PREPAID_12M' || k === 'WAREHOUSE') return k;
  return 'WAREHOUSE';
}

function expenseAccountForXmlPostingKind(kind: XmlLinePostingKind): string {
  if (kind === 'EXPENSE_6421') return '6421';
  if (kind === 'EXPENSE_6422') return '6422';
  if (kind === 'PREPAID_12M') return '242';
  return '156';
}

function normalizeSerialLookupKey(s: string): string {
  return String(s || '').trim();
}

/** HĐ bán: Serial/IMEI xuất phải đang có trong tồn kho (đã nhập). Trả về thông báo lỗi hoặc null. */
function assertSalesXmlSerialsInStock(
  lines: { itemId: string; qty: number; serials: string }[],
  inventoryById: Map<string, InventoryItem>,
  defaultWarehouseId: string,
): string | null {
  for (const line of lines) {
    const item = inventoryById.get(line.itemId);
    if (!item || item.trackingType !== 'SERIAL') continue;
    const qty = Math.round(Number(line.qty) || 0);
    if (qty <= 0) continue;
    const balance = getWarehouseBalance(item, defaultWarehouseId, defaultWarehouseId);
    const onHand = new Set((balance.serials || []).map(normalizeSerialLookupKey));
    const requested = line.serials.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (requested.length !== qty) {
      return `HĐ bán ra — mặt hàng «${item.name}» theo dõi SERIAL/IMEI: cần nhập đúng ${qty} mã đang tồn trên kho (hiện ${requested.length}).`;
    }
    const missing = requested.filter((s) => !onHand.has(normalizeSerialLookupKey(s)));
    if (missing.length > 0) {
      const show = missing.slice(0, 15);
      const more = missing.length - show.length;
      return (
        `Cảnh báo — HĐ bán ra (XML): Serial/IMEI chưa có trong kho (chưa từng nhập mua vào hoặc đã xuất/điều chỉnh mất tồn).\n` +
        `Mặt hàng: ${item.name}\n` +
        `Mã chưa khớp tồn: ${show.join(', ')}${more > 0 ? ` … (+${more} mã)` : ''}\n\n` +
        `Vui lòng kiểm tra phiếu nhập hoặc chọn đúng mã đã tồn để tránh sai sót.`
      );
    }
  }
  return null;
}

export const EInvoiceElectronicPanel: React.FC = () => {
  const { inventory, handleCreateInvoice, handleInventoryActions, bankAccounts, warehouses } = useApp();
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<BatchRow | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMode, setCommitMode] = useState<'WAREHOUSE' | 'INVOICE_ONLY'>('WAREHOUSE');
  const [chatInput, setChatInput] = useState('');
  const [localStaging, setLocalStaging] = useState<TaxXmlPayload['staging'] | null>(null);
  const commitBankSeedRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const bRes = await fetch('/api/e-invoice/batches', { headers: authHeaders() });
      if (bRes.ok) setBatches(await bRes.json());
      else setErr('Không tải được danh sách batch.');
    } catch {
      setErr('Lỗi mạng khi gọi API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onRemote = (event: Event) => {
      const kinds = ((event as CustomEvent<{ kinds?: string[] }>).detail?.kinds || []) as string[];
      if (kinds.includes('e-invoice')) void refresh();
    };
    window.addEventListener('vtr:state-remote-update', onRemote);
    const t = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.removeEventListener('vtr:state-remote-update', onRemote);
      window.clearInterval(t);
    };
  }, [refresh]);

  useEffect(() => {
    if (selected) setLocalStaging({ ...selected.payload.staging });
    else setLocalStaging(null);
  }, [selected]);

  const inventoryById = useMemo(() => {
    const m = new Map<string, InventoryItem>();
    for (const it of inventory) m.set(it.id, it);
    return m;
  }, [inventory]);

  const activeBankAccounts = useMemo(
    () => bankAccounts.filter((bank) => bank.status === 'ACTIVE'),
    [bankAccounts],
  );

  useEffect(() => {
    if (!commitOpen) {
      commitBankSeedRef.current = false;
      return;
    }
    if (commitBankSeedRef.current) return;
    if (!localStaging || localStaging.paymentStatus !== 'PAID' || localStaging.paymentMethod !== 'BANK') return;
    if (String(localStaging.bankAccountId || '').trim()) {
      commitBankSeedRef.current = true;
      return;
    }
    const first = activeBankAccounts[0];
    if (!first) return;
    commitBankSeedRef.current = true;
    setLocalStaging((prev) => (prev ? { ...prev, ...bankSnapshotFromAccount(first) } : prev));
  }, [commitOpen, localStaging, activeBankAccounts]);

  const uploadFile = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/e-invoice/upload', { method: 'POST', headers: authHeaders(), body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(j.error || 'Upload thất bại');
      return;
    }
    await refresh();
    const id = j.batchId as string | undefined;
    if (id) {
      const row = (await fetch(`/api/e-invoice/batches/${id}`, { headers: authHeaders() }).then((r) => r.json())) as BatchRow;
      setSelected(row);
    }
  };

  const validateBatch = async (id: string) => {
    const res = await fetch(`/api/e-invoice/batches/${id}/validate`, { method: 'POST', headers: authHeaders() });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      window.alert(j.error || 'Không xác nhận được');
      return;
    }
    await refresh();
    setSelected((s) => (s && s.id === id ? { ...s, batchStatus: 'VALIDATED' } : s));
  };

  const saveStaging = async (id: string, staging: TaxXmlPayload['staging']) => {
    await fetch(`/api/e-invoice/batches/${id}/staging`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(staging),
    });
  };

  const aiJournal = async (id: string) => {
    const res = await fetch(`/api/e-invoice/batches/${id}/ai-journal`, { method: 'POST', headers: authHeaders() });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(j.error || 'AI thất bại');
      return;
    }
    await refresh();
    if (selected?.id === id && j.batch) setSelected(j.batch);
  };

  const sendChat = async (id: string) => {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatInput('');
    const res = await fetch(`/api/e-invoice/batches/${id}/chat`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(j.error || 'Chat thất bại');
      return;
    }
    if (j.batch) setSelected(j.batch);
  };

  const markPosted = async (id: string, invoiceRef?: string) => {
    await fetch(`/api/e-invoice/batches/${id}/mark-posted`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceRef }),
    });
    await refresh();
    setCommitOpen(false);
    setSelected(null);
  };

  const deleteBatch = async (id: string, fileLabel: string, batchStatus: string) => {
    const posted = batchStatus === 'POSTED';
    const msg = posted
      ? `File «${fileLabel}» đã ở trạng thái POSTED (đã ghi nhận kho/HĐ). Xóa chỉ gỡ bản ghi XML khỏi danh sách — không hoàn tác bút toán đã tạo. Tiếp tục xóa?`
      : `Xóa hẳn file «${fileLabel}» khỏi danh sách HĐ điện tử (XML)?`;
    if (!window.confirm(msg)) return;
    const res = await fetch(`/api/e-invoice/batches/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) {
      let err = 'Xóa thất bại';
      try {
        const j = await res.json();
        if (j?.error) err = String(j.error);
      } catch {
        /* 204 hoặc body rỗng */
      }
      window.alert(err);
      return;
    }
    await refresh();
    setCommitOpen(false);
    setSelected(null);
  };

  const runCommit = async () => {
    if (!selected || !localStaging) return;
    const pl = selected.payload;
    const parsed = pl.parsed;
    if (!parsed) {
      window.alert('Không có dữ liệu parse.');
      return;
    }

    if (commitMode === 'INVOICE_ONLY' && parsed.direction !== 'PURCHASE') {
      window.alert('Chế độ «Chỉ hóa đơn kế toán» hiện chỉ hỗ trợ HĐ mua vào.');
      return;
    }

    if (localStaging.paymentStatus === 'PAID' && localStaging.paymentMethod === 'BANK') {
      const bankId = String(localStaging.bankAccountId || '').trim();
      const bankRow = bankId ? bankAccounts.find((b) => b.id === bankId) : undefined;
      if (!bankRow) {
        window.alert('Vui lòng chọn tài khoản ngân hàng đang sử dụng (thanh toán chuyển khoản).');
        return;
      }
    }

    await saveStaging(selected.id, localStaging);

    const paidBankSnapshot =
      localStaging.paymentStatus === 'PAID' && localStaging.paymentMethod === 'BANK'
        ? (() => {
            const bankRow = bankAccounts.find((b) => b.id === localStaging.bankAccountId);
            return bankRow ? bankSnapshotFromAccount(bankRow) : {};
          })()
        : {};

    const cls = pl.review.autoClassification;
    const normalizedWh = normalizeWarehouses(warehouses);
    const defaultWarehouseId = getDefaultWarehouseId(normalizedWh);

    if (commitMode === 'WAREHOUSE') {
      const rows = parsed.lines.map((l) => ({
        line: l,
        kind: parsed.direction === 'SALES' ? 'WAREHOUSE' : resolveXmlLinePostingKind(localStaging, l.lineId),
      }));
      const warehouseRows = rows.filter((r) => r.kind === 'WAREHOUSE');
      const offRows = parsed.direction === 'SALES' ? [] : rows.filter((r) => r.kind !== 'WAREHOUSE');

      const lines = warehouseRows.map(({ line: l }) => {
        const itemId = localStaging.lineInventoryItemId[l.lineId] || '';
        const serials = (localStaging.lineSerials[l.lineId] || '').trim();
        const inv = itemId ? inventoryById.get(itemId) : undefined;
        const sku = (inv?.sku || '').trim();
        return {
          itemId,
          qty: l.quantity,
          price: l.price,
          vat: l.vatRate,
          serials,
          note: [sku ? `SKU: ${sku}` : '', l.name].filter(Boolean).join(' — '),
        };
      });
      if (lines.some((x) => !x.itemId)) {
        window.alert('Vui lòng chọn vật tư (Kho) cho từng dòng hàng ghi nhận qua kho.');
        return;
      }
      for (const line of lines) {
        const item = inventoryById.get(line.itemId);
        if (!item) continue;
        const serialCount = line.serials.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).length;
        if (item.trackingType === 'SERIAL' && line.qty > 0 && serialCount !== line.qty) {
          window.alert(
            `Mặt hàng "${item.name}" theo dõi SERIAL/IMEI: cần đúng ${line.qty} serial (hiện ${serialCount}).`,
          );
          return;
        }
      }

      if (parsed.direction === 'SALES') {
        const serialWarn = assertSalesXmlSerialsInStock(lines, inventoryById, defaultWarehouseId);
        if (serialWarn) {
          window.alert(serialWarn);
          return;
        }
        const wh = normalizedWh.find((w) => w.id === defaultWarehouseId);
        const okSales = handleInventoryActions.stockBatch({
          actionType: 'EXPORT',
          date: parsed.invoiceDate,
          warehouseId: defaultWarehouseId,
          warehouseName: wh?.name,
          performer: localStaging.performer || 'Hệ thống (HĐ điện tử)',
          note: `HĐ điện tử XML bán ra — ${parsed.invoiceNumber}`,
          supplier: '',
          documentRef: parsed.invoiceNumber,
          supplierTaxCode: undefined,
          supplierAddress: undefined,
          customer: parsed.buyerName,
          customerTaxCode: parsed.buyerTax,
          customerAddress: parsed.buyerAddress,
          formNo: parsed.formNo,
          symbolCode: parsed.symbolCode,
          exportPurpose: '632',
          paymentStatus: localStaging.paymentStatus || 'PENDING',
          paymentMethod: localStaging.paymentMethod || 'BANK',
          ...paidBankSnapshot,
          lines,
        });
        if (okSales) await markPosted(selected.id, parsed.invoiceNumber);
        return;
      }

      const nonStockLines =
        offRows.length > 0
          ? offRows.map(({ line: l, kind }) => {
              const acc = expenseAccountForXmlPostingKind(kind);
              const noteHint =
                kind === 'PREPAID_12M'
                  ? 'Chi phí trả trước TK 242 — phân bổ dần (ví dụ 12 tháng; tự ghi Nợ chi phí / Có 242 hàng kỳ).'
                  : undefined;
              return {
                lineKey: l.lineId,
                productName: l.name,
                unit: l.unit,
                qty: l.quantity,
                price: l.price,
                vat: l.vatRate,
                expenseAccount: acc,
                note: noteHint,
              };
            })
          : [];

      const ok = handleInventoryActions.stockBatch({
        actionType: 'IMPORT',
        date: parsed.invoiceDate,
        performer: localStaging.performer || 'Hệ thống (HĐ điện tử)',
        note: `HĐ điện tử XML — ${parsed.invoiceNumber}`,
        supplier: parsed.sellerName,
        documentRef: parsed.invoiceNumber,
        supplierTaxCode: parsed.sellerTax,
        supplierAddress: parsed.sellerAddress,
        formNo: parsed.formNo,
        symbolCode: parsed.symbolCode,
        paymentStatus: localStaging.paymentStatus || 'PENDING',
        paymentMethod: localStaging.paymentMethod || 'BANK',
        ...paidBankSnapshot,
        lines,
        ...(nonStockLines.length > 0 ? { nonStockLines } : {}),
      });
      if (ok) await markPosted(selected.id, parsed.invoiceNumber);
      return;
    }

    const acc = accountForClass(cls);
    const ok = handleCreateInvoice({
      id: `INV-TAXXML-${selected.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}-${Date.now()}`,
      type: 'PURCHASE',
      category: cls === 'EXPENSE' ? 'SERVICE' : 'DEVICE',
      date: parsed.invoiceDate,
      invoiceNumber: parsed.invoiceNumber,
      formNo: parsed.formNo,
      symbolCode: parsed.symbolCode,
      customerName: parsed.sellerName,
      buyerTaxCode: parsed.sellerTax,
      buyerAddress: parsed.sellerAddress,
      buyerUnitName: parsed.sellerName,
      amount: parsed.totalAmount,
      vatRate: parsed.lines.length === 1 ? parsed.lines[0].vatRate : 0,
      vatAmount: parsed.totalVat,
      totalAmount: parsed.totalPayment,
      status: localStaging.paymentStatus === 'PAID' ? 'PAID' : 'PENDING',
      paymentMethod:
        localStaging.paymentStatus === 'PAID'
          ? localStaging.paymentMethod === 'BANK'
            ? 'Chuyển khoản'
            : 'Tiền mặt'
          : 'Công nợ',
      ...paidBankSnapshot,
      importedFromExcel: false,
      details: parsed.lines.map((l, i) => ({
        id: String(i + 1),
        productName: l.name,
        type: cls === 'EXPENSE' ? 'SERVICE' : 'GOODS',
        unit: l.unit,
        quantity: l.quantity,
        price: l.price,
        amount: l.amount,
        vatRate: l.vatRate,
        vatAmount: l.vatAmount,
        account: acc,
      })),
    } as any);
    if (ok) await markPosted(selected.id, parsed.invoiceNumber);
  };

  const staging = localStaging || selected?.payload.staging;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
          <Upload className="h-3.5 w-3.5" />
          Tải XML lên
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void uploadFile(f);
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-xs font-medium tracking-tight text-slate-500">
          File đã nhận
        </div>
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-[11px] font-medium text-slate-500">
              <tr>
                <th className="px-3 py-2">Tên file</th>
                <th className="px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2">Phân loại</th>
                <th className="px-3 py-2">Số HĐ</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const p = b.payload;
                const c = p.review?.autoClassification || 'UNKNOWN';
                return (
                  <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-medium text-slate-800">{b.fileName}</td>
                    <td className="px-3 py-2 text-slate-600">{b.batchStatus}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${classColor[c]}`}>
                        {classLabel[c]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{p.parsed?.invoiceNumber || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setSelected(b)}
                        className="text-xs font-semibold text-indigo-600 hover:underline"
                      >
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                );
              })}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
                    Chưa có file XML.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-5 py-3">
              <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{selected.fileName}</h4>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void deleteBatch(selected.id, selected.fileName, selected.batchStatus)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Xóa
                </button>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => setSelected(null)}
                  aria-label="Đóng"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="space-y-4 p-5">
              {selected.payload.parseError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {selected.payload.parseError}
                </div>
              )}

              {selected.payload.parsed && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 text-[13px]">
                      <div className="font-semibold text-slate-700">Người bán</div>
                      <div>{selected.payload.parsed.sellerName}</div>
                      <div className="text-slate-500">MST {selected.payload.parsed.sellerTax || '—'}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 text-[13px]">
                      <div className="font-semibold text-slate-700">Người mua</div>
                      <div>{selected.payload.parsed.buyerName}</div>
                      <div className="text-slate-500">MST {selected.payload.parsed.buyerTax || '—'}</div>
                    </div>
                  </div>
                  <div className="text-sm text-slate-600">
                    Số <strong>{selected.payload.parsed.invoiceNumber}</strong> · Ký hiệu{' '}
                    <strong>{selected.payload.parsed.symbolCode}</strong> · Ngày{' '}
                    <strong>{selected.payload.parsed.invoiceDate}</strong> · TT:{' '}
                    <strong>{selected.payload.parsed.totalPayment.toLocaleString('vi-VN')}</strong>{' '}
                    {selected.payload.parsed.currency}
                  </div>
                </>
              )}

              {selected.payload.review.duplicateBatchIds?.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-semibold">Có thể trùng với batch khác</div>
                    <div>{selected.payload.review.duplicateReason}</div>
                    <div className="mt-1 font-mono text-[11px]">
                      {selected.payload.review.duplicateBatchIds.join(', ')}
                    </div>
                  </div>
                </div>
              )}

              {selected.payload.review.riskWarnings?.length > 0 && (
                <div className="rounded-lg border border-orange-200 bg-orange-50/90 p-3 text-[13px] text-orange-900">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <ShieldCheck className="h-4 w-4" />
                    Cảnh báo rủi ro
                  </div>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {selected.payload.review.riskWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void validateBatch(selected.id)}
                  disabled={!selected.payload.parsed || selected.batchStatus === 'POSTED'}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Xác nhận hợp lệ (rà soát)
                </button>
                <button
                  type="button"
                  onClick={() => void aiJournal(selected.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800"
                >
                  <Bot className="h-3.5 w-3.5" />
                  Gợi ý bút toán (AI / rule)
                </button>
                <button
                  type="button"
                  onClick={() => setCommitOpen(true)}
                  disabled={selected.batchStatus === 'POSTED' || !selected.payload.parsed}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  <Package className="h-3.5 w-3.5" />
                  Ghi nhận Kho &amp; VAT
                </button>
              </div>

              {selected.payload.review.aiJournalSuggestion && (
                <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-3 text-[13px] whitespace-pre-wrap text-slate-800">
                  {selected.payload.review.aiJournalSuggestion}
                </div>
              )}

              <div className="rounded-xl border border-slate-200 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <MessageSquare className="h-4 w-4" />
                  Chat với dữ liệu hóa đơn
                </div>
                <div className="max-h-40 space-y-2 overflow-y-auto text-[13px]">
                  {(selected.payload.review.aiChatHistory || []).map((m, i) => (
                    <div
                      key={i}
                      className={m.role === 'user' ? 'text-right text-slate-700' : 'text-left text-slate-600'}
                    >
                      <span className="inline-block rounded-lg bg-slate-100 px-2 py-1">{m.content}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                    placeholder="Hỏi: tổng thanh toán, MST, dòng hàng…"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void sendChat(selected.id)}
                  />
                  <button
                    type="button"
                    onClick={() => void sendChat(selected.id)}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Gửi
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {commitOpen && selected && staging && selected.payload.parsed && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h4 className="text-sm font-semibold text-slate-800">Ghi nhận Kho &amp; VAT</h4>
            {selected.payload.parsed.direction === 'SALES' && commitMode === 'WAREHOUSE' && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-950">
                <strong>HĐ bán ra:</strong> Serial/IMEI xuất phải là mã đang tồn trên kho (đã nhập mua vào trước đó). Hệ
                thống sẽ cảnh báo và không ghi nhận nếu mã không có trong tồn — tránh xuất nhầm.
              </div>
            )}
            <div className="mt-3 flex gap-3 text-xs">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={commitMode === 'WAREHOUSE'}
                  onChange={() => setCommitMode('WAREHOUSE')}
                />
                {selected.payload.parsed.direction === 'SALES'
                  ? 'Xuất kho + HĐ bán (VAT)'
                  : 'Nhập kho + HĐ mua (VAT)'}
              </label>
              {selected.payload.parsed.direction === 'PURCHASE' && (
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={commitMode === 'INVOICE_ONLY'}
                    onChange={() => setCommitMode('INVOICE_ONLY')}
                  />
                  Chỉ hóa đơn kế toán
                </label>
              )}
            </div>
            <div className="mt-3 space-y-3">
              {selected.payload.parsed.lines.map((line) => {
                const itemId = staging.lineInventoryItemId[line.lineId] || '';
                const item = itemId ? inventoryById.get(itemId) : undefined;
                return (
                  <div key={line.lineId} className="rounded-lg border border-slate-200 p-3 text-[13px]">
                    <div className="font-medium text-slate-800">{line.name}</div>
                    <div className="text-slate-500">
                      SL {line.quantity} × {line.price.toLocaleString('vi-VN')} · Thuế {line.vatRate}%
                    </div>
                    {commitMode === 'WAREHOUSE' && selected.payload.parsed.direction !== 'SALES' && (
                      <>
                        <label className="mt-2 block text-[11px] font-medium text-slate-500">
                          Cách ghi nhận dòng này
                        </label>
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                          value={resolveXmlLinePostingKind(staging, line.lineId)}
                          onChange={(e) => {
                            const v = e.target.value as XmlLinePostingKind;
                            setLocalStaging((s) => {
                              if (!s) return s;
                              const next: typeof s = {
                                ...s,
                                linePostingKind: { ...(s.linePostingKind || {}), [line.lineId]: v },
                              };
                              if (v !== 'WAREHOUSE') {
                                next.lineInventoryItemId = { ...next.lineInventoryItemId, [line.lineId]: '' };
                                next.lineSerials = { ...next.lineSerials, [line.lineId]: '' };
                              }
                              return next;
                            });
                          }}
                        >
                          <option value="WAREHOUSE">Nhập kho — vật tư (TK tồn kho)</option>
                          <option value="EXPENSE_6421">Không qua kho — chi phí bán hàng (6421)</option>
                          <option value="EXPENSE_6422">Không qua kho — chi phí quản lý (6422)</option>
                          <option value="PREPAID_12M">Không qua kho — chi phí trả trước 242 (phân bổ 12 tháng)</option>
                        </select>
                        {resolveXmlLinePostingKind(staging, line.lineId) !== 'WAREHOUSE' && (
                          <p className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/70 px-2 py-1.5 text-[11px] leading-snug text-indigo-950">
                            {resolveXmlLinePostingKind(staging, line.lineId) === 'PREPAID_12M'
                              ? 'Dòng này ghi vào cùng hóa đơn mua & bút kho: Nợ 242 (+ VAT 1331), không tăng tồn. Các tháng sau hạch toán phân bổ Nợ 6421/6422 — Có 242 theo lịch công ty.'
                              : 'Dòng này ghi vào cùng hóa đơn mua & phiếu nhập: Nợ TK chi phí đã chọn (+ VAT 1331), không qua kho.'}
                          </p>
                        )}
                      </>
                    )}
                    {commitMode === 'WAREHOUSE' &&
                      (selected.payload.parsed.direction === 'SALES' ||
                        resolveXmlLinePostingKind(staging, line.lineId) === 'WAREHOUSE') && (
                      <>
                        <label className="mt-2 block text-[11px] font-medium text-slate-500">
                          Vật tư kho
                        </label>
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                          value={itemId}
                          onChange={(e) => {
                            const newId = e.target.value;
                            const chosen = inventory.find((it) => it.id === newId);
                            const skuVal = (chosen?.sku || '').trim();
                            setLocalStaging((s) =>
                              s
                                ? {
                                    ...s,
                                    lineInventoryItemId: { ...s.lineInventoryItemId, [line.lineId]: newId },
                                    lineSkuNote: { ...s.lineSkuNote, [line.lineId]: skuVal },
                                  }
                                : s,
                            );
                          }}
                        >
                          <option value="">— Chọn vật tư kho —</option>
                          {inventory.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name} ({it.sku || it.id})
                            </option>
                          ))}
                        </select>
                        <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">
                          <span className="text-[11px] font-medium text-slate-500">SKU</span>
                          <div className="font-mono text-[13px]">{item?.sku?.trim() ? item.sku : '—'}</div>
                        </div>
                        <label className="mt-2 block text-[11px] font-medium text-slate-500">
                          Serial / IMEI (mỗi dòng một serial hoặc cách nhau bởi dấu phẩy)
                        </label>
                        <textarea
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                          rows={2}
                          placeholder={
                            selected.payload.parsed.direction === 'SALES'
                              ? 'Mã Serial/IMEI đang có trong kho (đã nhập), VD: 860123045678901'
                              : 'VD: 860123045678901'
                          }
                          value={staging.lineSerials[line.lineId] ?? ''}
                          onChange={(e) =>
                            setLocalStaging((s) =>
                              s
                                ? { ...s, lineSerials: { ...s.lineSerials, [line.lineId]: e.target.value } }
                                : s,
                            )
                          }
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Thanh toán
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  value={staging.paymentStatus || 'PENDING'}
                  onChange={(e) =>
                    setLocalStaging((s) => {
                      if (!s) return s;
                      const v = e.target.value as 'PAID' | 'PENDING';
                      if (v === 'PENDING') {
                        return {
                          ...s,
                          paymentStatus: v,
                          bankAccountId: undefined,
                          bankName: undefined,
                          bankAccountNumber: undefined,
                          bankAccountHolder: undefined,
                          bankBranch: undefined,
                          bankLedgerAccountCode: undefined,
                        };
                      }
                      return { ...s, paymentStatus: v };
                    })
                  }
                >
                  <option value="PENDING">
                    {selected.payload.parsed.direction === 'SALES' ? 'Phải thu (131)' : 'Công nợ (331)'}
                  </option>
                  <option value="PAID">Đã thanh toán</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Phương thức (khi đã TT)
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  value={staging.paymentMethod || 'BANK'}
                  onChange={(e) =>
                    setLocalStaging((s) => {
                      if (!s) return s;
                      const v = e.target.value as 'CASH' | 'BANK';
                      if (v === 'CASH') {
                        return {
                          ...s,
                          paymentMethod: v,
                          bankAccountId: undefined,
                          bankName: undefined,
                          bankAccountNumber: undefined,
                          bankAccountHolder: undefined,
                          bankBranch: undefined,
                          bankLedgerAccountCode: undefined,
                        };
                      }
                      return { ...s, paymentMethod: v };
                    })
                  }
                >
                  <option value="BANK">Chuyển khoản</option>
                  <option value="CASH">Tiền mặt</option>
                </select>
              </label>
            </div>
            {staging.paymentStatus === 'PAID' && staging.paymentMethod === 'BANK' && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <label className="block text-xs font-semibold text-slate-600">
                  Tài khoản ngân hàng (phiếu chi / tiền gửi)
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    value={staging.bankAccountId || ''}
                    onChange={(e) => {
                      const id = e.target.value;
                      const b = bankAccounts.find((x) => x.id === id);
                      setLocalStaging((s) =>
                        s
                          ? {
                              ...s,
                              ...(b
                                ? bankSnapshotFromAccount(b)
                                : {
                                    bankAccountId: undefined,
                                    bankName: undefined,
                                    bankAccountNumber: undefined,
                                    bankAccountHolder: undefined,
                                    bankBranch: undefined,
                                    bankLedgerAccountCode: undefined,
                                  }),
                            }
                          : s,
                      );
                    }}
                  >
                    <option value="">— Chọn TK ngân hàng —</option>
                    {activeBankAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bankName} · {b.accountNumber} ({b.linkedAccountCode})
                      </option>
                    ))}
                  </select>
                </label>
                {activeBankAccounts.length === 0 && (
                  <p className="mt-2 text-[11px] text-amber-800">
                    Chưa có tài khoản ngân hàng hoạt động. Vui lòng thêm trong mục Quỹ / Tài khoản ngân hàng.
                  </p>
                )}
                {staging.bankAccountNumber ? (
                  <dl className="mt-2 grid gap-1 text-[11px] text-slate-600 sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-slate-500">Ngân hàng</dt>
                      <dd>{staging.bankName || '—'}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Số tài khoản</dt>
                      <dd className="font-mono">{staging.bankAccountNumber}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Chủ tài khoản</dt>
                      <dd>{staging.bankAccountHolder || '—'}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">TK kế toán liên kết</dt>
                      <dd className="font-mono">{staging.bankLedgerAccountCode || '—'}</dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold"
                onClick={() => setCommitOpen(false)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white"
                onClick={() => void runCommit()}
              >
                Xác nhận ghi nhận
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
