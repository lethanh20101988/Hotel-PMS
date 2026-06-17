import React from 'react';
import { AlertTriangle, Ban, Calculator, Copy, LucideIcon, X } from 'lucide-react';

export type InvoiceImportWarningKind = 'ROUNDING' | 'DUPLICATE_NUMBER' | 'STATUS';

export interface InvoiceImportWarningItem {
  id: string;
  kind: InvoiceImportWarningKind;
  message: string;
}

interface InvoiceImportWarningsModalProps {
  isOpen: boolean;
  importLabel: string;
  warnings: InvoiceImportWarningItem[];
  onClose: () => void;
  onConfirm: () => void;
}

const WARNING_META: Record<
  InvoiceImportWarningKind,
  {
    label: string;
    icon: LucideIcon;
    panelClass: string;
    badgeClass: string;
    iconClass: string;
  }
> = {
  ROUNDING: {
    label: 'Chênh lệch làm tròn',
    icon: Calculator,
    panelClass: 'border-violet-200 bg-violet-50',
    badgeClass: 'bg-violet-100 text-violet-700 border border-violet-200',
    iconClass: 'bg-violet-100 text-violet-700',
  },
  DUPLICATE_NUMBER: {
    label: 'Cùng số HĐ, khác ký hiệu hoặc MST',
    icon: Copy,
    panelClass: 'border-amber-200 bg-amber-50',
    badgeClass: 'bg-amber-100 text-amber-700 border border-amber-200',
    iconClass: 'bg-amber-100 text-amber-700',
  },
  STATUS: {
    label: 'Hóa đơn hủy/xóa',
    icon: Ban,
    panelClass: 'border-rose-200 bg-rose-50',
    badgeClass: 'bg-rose-100 text-rose-700 border border-rose-200',
    iconClass: 'bg-rose-100 text-rose-700',
  },
};

export const InvoiceImportWarningsModal: React.FC<InvoiceImportWarningsModalProps> = ({
  isOpen,
  importLabel,
  warnings,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  const summaryCards = (Object.keys(WARNING_META) as InvoiceImportWarningKind[])
    .map((kind) => ({
      kind,
      count: warnings.filter((warning) => warning.kind === kind).length,
      meta: WARNING_META[kind],
    }))
    .filter((card) => card.count > 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        <div className="bg-slate-800 p-4 text-white flex justify-between items-center">
          <h3 className="font-bold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-300" /> Cảnh báo khi import hóa đơn
          </h3>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <p className="text-sm text-slate-600">
              Phát hiện <b>{warnings.length}</b> cảnh báo khi import hóa đơn <b>{importLabel}</b>.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Riêng hóa đơn có chênh lệch làm tròn sẽ được hệ thống tự cân bút toán nhưng vẫn giữ nguyên số gốc từ Excel.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {summaryCards.map(({ kind, count, meta }) => (
              <div key={kind} className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide ${meta.badgeClass}`}>
                {meta.label}: {count}
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {warnings.map((warning) => {
              const meta = WARNING_META[warning.kind];
              const Icon = meta.icon;
              return (
                <div key={warning.id} className={`rounded-xl border p-4 ${meta.panelClass}`}>
                  <div className="flex items-start gap-3">
                    <div className={`rounded-lg p-2 shrink-0 ${meta.iconClass}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wide ${meta.badgeClass}`}>
                        {meta.label}
                      </div>
                      <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap break-words">
                        {warning.message}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-t bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded">
            Dừng import
          </button>
          <button onClick={onConfirm} className="px-6 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700">
            Tiếp tục import
          </button>
        </div>
      </div>
    </div>
  );
};
