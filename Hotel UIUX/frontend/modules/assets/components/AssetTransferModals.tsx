import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowLeft, X, FileText } from 'lucide-react';
import { Asset, Employee } from '@shared/types';
import { formatCurrency } from '@shared/utils/format';
import { ASSET_DEPARTMENTS, generateAssetTransferSlipNumber } from '../constants';

export interface TransferAssetsPayload {
  assetIds: string[];
  toDepartment: string;
  transferDate: string;
  responsiblePersonId?: string;
  responsiblePersonName?: string;
  reason?: string;
  slipNumber?: string;
  createdBy?: string;
}

interface TransferAssetModalProps {
  asset: Asset | null;
  employees: Employee[];
  onClose: () => void;
  onConfirm: (payload: TransferAssetsPayload) => void;
}

export const TransferAssetModal: React.FC<TransferAssetModalProps> = ({
  asset,
  employees,
  onClose,
  onConfirm,
}) => {
  const today = new Date().toISOString().split('T')[0];
  const [toDepartment, setToDepartment] = useState('');
  const [responsiblePersonId, setResponsiblePersonId] = useState('');
  const [transferDate, setTransferDate] = useState(today);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!asset) return;
    setToDepartment('');
    setResponsiblePersonId('');
    setTransferDate(today);
    setReason('');
  }, [asset, today]);

  const departmentEmployees = useMemo(() => {
    if (!toDepartment) return employees;
    const filtered = employees.filter((e) => !e.department || e.department === toDepartment);
    return filtered.length ? filtered : employees;
  }, [employees, toDepartment]);

  if (!asset) return null;

  const canSubmit = Boolean(toDepartment) && toDepartment !== asset.department;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-[110] animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl border border-slate-200/80 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="shrink-0 px-6 py-4 border-b border-slate-200 bg-slate-50/90 flex justify-between items-start gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <ArrowLeftRight className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-slate-800">Điều chuyển tài sản</h3>
              <p className="text-sm text-slate-500 mt-0.5">Chuyển nhanh một tài sản sang bộ phận khác</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 w-8 h-8 flex items-center justify-center rounded-md transition-colors shrink-0"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-[#666666]">Mã tài sản</span>
              <span className="font-mono font-semibold text-blue-700">{asset.code}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#666666] shrink-0">Tên tài sản</span>
              <span className="font-semibold text-slate-800 text-right">{asset.name}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#666666]">Bộ phận hiện tại</span>
              <span className="font-medium text-slate-800">{asset.department}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Bộ phận tiếp nhận</label>
            <select
              className="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              value={toDepartment}
              onChange={(e) => {
                setToDepartment(e.target.value);
                setResponsiblePersonId('');
              }}
            >
              <option value="">— Chọn bộ phận —</option>
              {ASSET_DEPARTMENTS.filter((d) => d !== asset.department).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Người chịu trách nhiệm mới <span className="text-slate-400 font-normal">(tuỳ chọn)</span>
            </label>
            <select
              className="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              value={responsiblePersonId}
              onChange={(e) => setResponsiblePersonId(e.target.value)}
              disabled={!toDepartment}
            >
              <option value="">— Không chọn —</option>
              {departmentEmployees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.position ? ` — ${e.position}` : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Ngày điều chuyển</label>
            <input
              type="date"
              className="w-full p-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Lý do điều chuyển</label>
            <textarea
              className="w-full p-2.5 border border-slate-200 rounded-lg text-sm min-h-[80px] resize-y focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Ví dụ: Điều chuyển phục vụ dự án mới..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-5 text-sm font-semibold text-slate-600 rounded-lg hover:bg-slate-200/70 transition-colors"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onConfirm({
                assetIds: [asset.id],
                toDepartment,
                transferDate,
                responsiblePersonId: responsiblePersonId || undefined,
                reason: reason.trim() || undefined,
              })
            }
            className="h-10 px-6 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Xác nhận chuyển
          </button>
        </div>
      </div>
    </div>
  );
};

interface AssetBulkTransferFormProps {
  assets: Asset[];
  employees: Employee[];
  onCancel: () => void;
  onConfirm: (payload: TransferAssetsPayload) => void;
}

export const AssetBulkTransferForm: React.FC<AssetBulkTransferFormProps> = ({
  assets,
  employees,
  onCancel,
  onConfirm,
}) => {
  const today = new Date().toISOString().split('T')[0];
  const [slipNumber] = useState(() => generateAssetTransferSlipNumber());
  const [transferDate, setTransferDate] = useState(today);
  const [toDepartment, setToDepartment] = useState('');
  const [responsiblePersonId, setResponsiblePersonId] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [reason, setReason] = useState('');

  const fromDepartments = useMemo(() => {
    const set = new Set(assets.map((a) => a.department));
    return [...set];
  }, [assets]);

  const fromDepartmentLabel =
    fromDepartments.length === 0
      ? '—'
      : fromDepartments.length === 1
        ? fromDepartments[0]
        : `${fromDepartments.length} bộ phận (${fromDepartments.join(', ')})`;

  const totalCost = assets.reduce((s, a) => s + (Number(a.cost) || 0), 0);
  const totalResidual = assets.reduce((s, a) => s + (Number(a.residualValue) || 0), 0);

  const departmentEmployees = useMemo(() => {
    if (!toDepartment) return employees;
    const filtered = employees.filter((e) => !e.department || e.department === toDepartment);
    return filtered.length ? filtered : employees;
  }, [employees, toDepartment]);

  const canSubmit = Boolean(toDepartment) && assets.some((a) => a.department !== toDepartment);

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            title="Quay lại danh sách"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Phiếu điều chuyển tài sản
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">Lập phiếu chuyển giao nhiều tài sản cùng lúc</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Số phiếu</label>
          <input
            className="w-full p-2.5 border rounded-lg bg-slate-50 font-mono text-sm font-bold text-blue-700"
            value={slipNumber}
            readOnly
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Ngày điều chuyển</label>
          <input
            type="date"
            className="w-full p-2.5 border rounded-lg text-sm font-mono"
            value={transferDate}
            onChange={(e) => setTransferDate(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Người lập phiếu</label>
          <input
            className="w-full p-2.5 border rounded-lg text-sm"
            placeholder="Họ tên người lập"
            value={createdBy}
            onChange={(e) => setCreatedBy(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Bộ phận chuyển</label>
          <input
            className="w-full p-2.5 border rounded-lg bg-slate-50 text-sm text-slate-700"
            value={fromDepartmentLabel}
            readOnly
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Bộ phận nhận</label>
          <select
            className="w-full p-2.5 border rounded-lg text-sm bg-white"
            value={toDepartment}
            onChange={(e) => {
              setToDepartment(e.target.value);
              setResponsiblePersonId('');
            }}
          >
            <option value="">— Chọn bộ phận —</option>
            {ASSET_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            Người nhận bàn giao <span className="font-normal text-slate-400">(tuỳ chọn)</span>
          </label>
          <select
            className="w-full p-2.5 border rounded-lg text-sm bg-white"
            value={responsiblePersonId}
            onChange={(e) => setResponsiblePersonId(e.target.value)}
            disabled={!toDepartment}
          >
            <option value="">— Không chọn —</option>
            {departmentEmployees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2 lg:col-span-3">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Lý do điều chuyển</label>
          <textarea
            className="w-full p-2.5 border rounded-lg text-sm min-h-[72px] resize-y"
            placeholder="Ghi chú chung cho phiếu điều chuyển..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between gap-2 text-sm">
          <span className="font-semibold text-slate-700">Danh sách tài sản ({assets.length})</span>
          <span className="text-slate-500">
            NG: <b className="text-slate-800">{formatCurrency(totalCost)}</b>
            {' · '}
            GTCL: <b className="text-emerald-700">{formatCurrency(totalResidual)}</b>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white text-slate-500 text-xs border-b">
              <tr>
                <th className="p-3 text-left">Mã TS</th>
                <th className="p-3 text-left">Tên tài sản</th>
                <th className="p-3 text-center">Loại</th>
                <th className="p-3 text-left">Bộ phận hiện tại</th>
                <th className="p-3 text-right">Nguyên giá</th>
                <th className="p-3 text-right">GT còn lại</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/80">
                  <td className="p-3 font-mono font-bold text-blue-600">{a.code}</td>
                  <td className="p-3 font-medium text-slate-800">{a.name}</td>
                  <td className="p-3 text-center">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100">{a.type}</span>
                  </td>
                  <td className="p-3 text-slate-600">{a.department}</td>
                  <td className="p-3 text-right tabular-nums font-semibold">{formatCurrency(a.cost)}</td>
                  <td className="p-3 text-right tabular-nums font-semibold text-emerald-700">{formatCurrency(a.residualValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-10 px-5 text-sm font-semibold text-slate-600 rounded-lg hover:bg-slate-100 border border-slate-200"
        >
          Hủy bỏ
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            onConfirm({
              assetIds: assets.map((a) => a.id),
              toDepartment,
              transferDate,
              responsiblePersonId: responsiblePersonId || undefined,
              slipNumber,
              createdBy: createdBy.trim() || undefined,
              reason: reason.trim() || undefined,
            })
          }
          className="h-10 px-6 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Xác nhận chuyển ({assets.length} TS)
        </button>
      </div>
    </div>
  );
};
