import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { AccountingRegimeConfig } from '@shared/types';
import {
  groupTt58IndustriesByCode,
  getTt58IndustryById,
  getTt58PrimaryIndustryIds,
  TT58_INDUSTRY_GROUP_META,
  TT58_INDUSTRY_GROUP_ORDER,
  usesTt58CitRevenueRateMethod,
  usesTt58VatRevenueRateMethod,
} from '@shared/regulations/tt58_2026/tt58IndustryCatalog';

type Props = {
  regime: AccountingRegimeConfig;
  onChangeIndustries: (industryIds: string[]) => void;
};

type ViewMode = 'compact' | 'picker';

type ConfirmAction =
  | { type: 'apply'; draftIds: string[] }
  | { type: 'remove'; industryId: string };

const ConfirmDialog: React.FC<{
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, message, confirmLabel = 'Xác nhận', onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/45 p-4">
    <button type="button" className="absolute inset-0" aria-label="Đóng" onClick={onCancel} />
    <div
      role="dialog"
      aria-modal="true"
      className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
    >
      <h4 className="text-base font-black text-slate-900">{title}</h4>
      <div className="mt-2 text-sm leading-relaxed text-slate-600">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
        >
          Hủy
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

export const Tt58IndustrySettingsPanel: React.FC<Props> = ({ regime, onChangeIndustries }) => {
  const grouped = groupTt58IndustriesByCode();
  const selectedIds = getTt58PrimaryIndustryIds(regime);
  const profile = regime.tt58TaxBookProfile;
  const vatByRevenue = usesTt58VatRevenueRateMethod(profile);
  const citByRevenue = usesTt58CitRevenueRateMethod(profile);
  const vatColumnLabel = vatByRevenue ? 'GTGT % DT' : 'GTGT theo HĐ';
  const citColumnLabel = citByRevenue ? 'TNDN % DT' : 'TNDN thu nhập';
  const incomeTaxRateText = '15% nếu doanh thu năm trước không quá 3 tỷ; 17% nếu trên 3 tỷ đến không quá 50 tỷ';
  const taxProfileNote =
    profile === 'GTGT_RATE_TNDN_RATE'
      ? 'Trường hợp 1: GTGT và TNDN đều tính theo tỷ lệ % trên doanh thu, áp dụng theo nhóm ngành bên dưới.'
      : profile === 'GTGT_RATE_TNDN_INCOME'
        ? `Trường hợp 2: GTGT tính theo tỷ lệ % trên doanh thu theo nhóm ngành; TNDN tính trên thu nhập tính thuế (${incomeTaxRateText}), không phân biệt ngành nghề.`
        : profile === 'GTGT_DEDUCT_TNDN_INCOME'
          ? `Trường hợp 3: GTGT theo phương pháp khấu trừ (thuế đầu ra trừ đầu vào, thuế suất theo mặt hàng 5%/8%/10%); TNDN tính trên thu nhập tính thuế (${incomeTaxRateText}).`
          : 'GTGT theo phương pháp khấu trừ; TNDN theo tỷ lệ % doanh thu của nhóm ngành bên dưới.';

  const [viewMode, setViewMode] = useState<ViewMode>(selectedIds.length > 0 ? 'compact' : 'picker');
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  // getTt58PrimaryIndustryIds() trả về MẢNG MỚI mỗi lần render → nếu dùng trực tiếp làm dependency,
  // effect sẽ chạy lại ở mọi lần render và reset draftIds → người dùng "không tích chọn được".
  // Vì vậy chỉ đồng bộ lại khi NỘI DUNG ngành nghề đã lưu thực sự thay đổi.
  const selectedKey = selectedIds.join('|');
  useEffect(() => {
    setDraftIds(selectedIds);
    if (selectedIds.length === 0) {
      setViewMode('picker');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const draftSet = useMemo(() => new Set(draftIds), [draftIds]);

  const selectedRows = selectedIds
    .map((id) => getTt58IndustryById(id))
    .filter((x): x is NonNullable<typeof x> => !!x);

  const selectedByGroup = TT58_INDUSTRY_GROUP_ORDER.map((code) => ({
    code,
    rows: selectedRows.filter((r) => r.group === code),
  })).filter((g) => g.rows.length > 0);

  const draftRows = draftIds
    .map((id) => getTt58IndustryById(id))
    .filter((x): x is NonNullable<typeof x> => !!x);

  const toggleDraft = (id: string, checked: boolean) => {
    if (checked) {
      if (draftSet.has(id)) return;
      setDraftIds((prev) => [...prev, id]);
      return;
    }
    setDraftIds((prev) => prev.filter((x) => x !== id));
  };

  const openPicker = () => {
    setDraftIds(selectedIds);
    setViewMode('picker');
  };

  const requestApplyDraft = () => {
    if (draftIds.length === 0) return;
    setConfirmAction({ type: 'apply', draftIds: [...draftIds] });
  };

  const requestRemove = (industryId: string) => {
    setConfirmAction({ type: 'remove', industryId });
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'apply') {
      onChangeIndustries(confirmAction.draftIds);
      setViewMode('compact');
    } else {
      const next = selectedIds.filter((x) => x !== confirmAction.industryId);
      onChangeIndustries(next);
      if (next.length === 0) setViewMode('picker');
    }
    setConfirmAction(null);
  };

  const renderTaxRates = (row: { vatRevenueRatePercent: number; citRevenueRatePercent: number }) => (
    <span className="text-xs text-slate-500">
      {vatByRevenue ? `GTGT ${row.vatRevenueRatePercent}% DT` : 'GTGT khấu trừ'}
      {' · '}
      {citByRevenue ? `TNDN ${row.citRevenueRatePercent}% DT` : 'TNDN 15%/17%'}
    </span>
  );

  const renderIndustryTable = (
    rows: ReturnType<typeof getTt58IndustryById>[],
    mode: 'picker' | 'compact',
  ) => {
    if (!rows.length) return null;
    const byGroup = TT58_INDUSTRY_GROUP_ORDER.map((code) => ({
      code,
      items: rows.filter((r) => r?.group === code),
    })).filter((g) => g.items.length > 0);

    return (
      <div className="space-y-3">
        {byGroup.map(({ code, items }) => {
          const meta = TT58_INDUSTRY_GROUP_META[code];
          return (
            <section key={code} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div
                className={`flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 ${meta.badgeClass} bg-opacity-40`}
              >
                <div>
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-black uppercase ring-1 ${meta.badgeClass}`}
                  >
                    {meta.title}
                  </span>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-600">{meta.hint}</p>
                </div>
                <span className="text-[10px] font-bold text-slate-600">{items.length} mục</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80 text-[10px] font-black uppercase tracking-wide text-slate-500">
                      {mode === 'picker' ? <th className="w-10 px-4 py-2" /> : null}
                      <th className="px-3 py-2">Ngành thực tế</th>
                      <th className="px-3 py-2">Ví dụ</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap">{vatColumnLabel}</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap">{citColumnLabel}</th>
                      {mode === 'compact' ? <th className="w-14 px-3 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => {
                      if (!row) return null;
                      const selected = mode === 'picker' ? draftSet.has(row.id) : true;
                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-slate-50 last:border-0 ${
                            selected ? 'bg-blue-50/60' : 'hover:bg-slate-50/60'
                          }`}
                        >
                          {mode === 'picker' ? (
                            <td className="px-4 py-2 align-middle">
                              <input
                                type="checkbox"
                                checked={draftSet.has(row.id)}
                                onChange={(e) => toggleDraft(row.id, e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                aria-label={`Chọn ${row.name}`}
                              />
                            </td>
                          ) : null}
                          <td className="px-3 py-2 font-semibold text-slate-800">{row.name}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">{row.example}</td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-800">
                            {vatByRevenue ? `${row.vatRevenueRatePercent}%` : '5% / 8% / 10%'}
                          </td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-700">
                            {citByRevenue ? `${row.citRevenueRatePercent}%` : '15% / 17%'}
                          </td>
                          {mode === 'compact' ? (
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => requestRemove(row.id)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                                title="Xóa ngành nghề"
                                aria-label={`Xóa ${row.name}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    );
  };

  const pickerGroups = TT58_INDUSTRY_GROUP_ORDER.map((code) => ({
    code,
    rows: grouped.get(code) || [],
  }));

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-xs font-black uppercase tracking-wider text-slate-600">
            Bảng ngành nghề thực tế (TT58/2026)
          </h5>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            Chọn ngành nghề kinh doanh, nhấn <span className="font-semibold text-slate-700">Xác nhận</span> để áp dụng.
            Sau khi xác nhận, chỉ hiển thị các mục đã chọn — dùng <span className="font-semibold text-slate-700">Thêm</span> hoặc{' '}
            <span className="font-semibold text-slate-700">Xóa</span> để điều chỉnh.
          </p>
        </div>
        {viewMode === 'compact' && (
          <button
            type="button"
            onClick={openPicker}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100"
          >
            <Plus size={14} />
            Thêm ngành nghề
          </button>
        )}
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm font-medium leading-relaxed text-blue-950">
        {taxProfileNote}
      </div>

      {viewMode === 'compact' ? (
        <>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase text-emerald-700">
                Đang áp dụng {selectedRows.length} ngành nghề
              </span>
              <span className="text-[10px] font-semibold text-emerald-600">Chế độ gọn — chỉ hiển thị mục đã chọn</span>
            </div>
            <ul className="mt-2 space-y-1">
              {selectedByGroup.map(({ code, rows }) => (
                <li key={code} className="text-xs font-medium text-emerald-900">
                  <span className="font-black text-emerald-800">Nhóm {code}:</span>{' '}
                  {rows.map((r) => r.name).join(', ')}
                </li>
              ))}
            </ul>
          </div>
          {renderIndustryTable(selectedRows, 'compact')}
        </>
      ) : (
        <>
          {selectedIds.length > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
              <p className="text-xs font-semibold text-slate-600">
                Đang chọn thêm / chỉnh sửa — tick ngành nghề rồi nhấn Xác nhận
              </p>
              <button
                type="button"
                onClick={() => {
                  setDraftIds(selectedIds);
                  setViewMode('compact');
                }}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-white"
              >
                <X size={14} />
                Hủy
              </button>
            </div>
          )}

          <div className="space-y-4">
            {pickerGroups.map(({ code, rows }) => {
              const meta = TT58_INDUSTRY_GROUP_META[code];
              const groupDraftCount = rows.filter((r) => draftSet.has(r.id)).length;
              return (
                <section
                  key={code}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 ${meta.badgeClass} bg-opacity-40`}
                  >
                    <div>
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-black uppercase ring-1 ${meta.badgeClass}`}
                      >
                        {meta.title}
                      </span>
                      <p className="mt-1 text-xs font-medium text-slate-600">{meta.hint}</p>
                    </div>
                    {groupDraftCount > 0 && (
                      <span className="text-[10px] font-bold text-slate-600">
                        Chọn {groupDraftCount}/{rows.length}
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/80 text-[10px] font-black uppercase tracking-wide text-slate-500">
                          <th className="w-10 px-4 py-2" />
                          <th className="px-3 py-2">Ngành thực tế</th>
                          <th className="px-3 py-2">Ví dụ</th>
                          <th className="px-3 py-2 text-right whitespace-nowrap">{vatColumnLabel}</th>
                          <th className="px-3 py-2 text-right whitespace-nowrap">{citColumnLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const selected = draftSet.has(row.id);
                          return (
                            <tr
                              key={row.id}
                              className={`border-b border-slate-50 last:border-0 transition-colors ${
                                selected ? 'bg-blue-50/80' : 'hover:bg-slate-50/60'
                              }`}
                            >
                              <td className="px-4 py-2.5 align-middle">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={(e) => toggleDraft(row.id, e.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                  aria-label={`Chọn ${row.name}`}
                                />
                              </td>
                              <td className="px-3 py-2.5 font-semibold text-slate-800">{row.name}</td>
                              <td className="px-3 py-2.5 text-xs text-slate-500">{row.example}</td>
                              <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-800">
                                {vatByRevenue ? `${row.vatRevenueRatePercent}%` : '5% / 8% / 10%'}
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-700">
                                {citByRevenue ? `${row.citRevenueRatePercent}%` : '15% / 17%'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm text-slate-600">
              Đã chọn <span className="font-black text-blue-700">{draftRows.length}</span> ngành nghề
              {draftRows.length > 0 && (
                <span className="mt-1 block text-xs text-slate-500">
                  {draftRows.map((r) => r.name).join(' · ')}
                </span>
              )}
            </div>
            <button
              type="button"
              disabled={draftIds.length === 0}
              onClick={requestApplyDraft}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Xác nhận
            </button>
          </div>

          {draftIds.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Chưa chọn ngành nghề — tick ít nhất một dòng phù hợp hoạt động kinh doanh của đơn vị, sau đó nhấn Xác nhận.
            </p>
          )}
        </>
      )}

      {confirmAction?.type === 'apply' && (
        <ConfirmDialog
          title="Xác nhận ngành nghề kinh doanh"
          message={
            <>
              <p>
                Bạn chọn <strong>{confirmAction.draftIds.length}</strong> ngành nghề. Sau khi xác nhận, giao diện chỉ hiển thị các mục đã chọn.
              </p>
              <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs">
                {confirmAction.draftIds.map((id) => {
                  const row = getTt58IndustryById(id);
                  if (!row) return null;
                  return (
                    <li key={id} className="font-medium text-slate-700">
                      <span className="font-black text-slate-500">[{row.group}]</span> {row.name}
                      <div className="mt-0.5">{renderTaxRates(row)}</div>
                    </li>
                  );
                })}
              </ul>
            </>
          }
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {confirmAction?.type === 'remove' && (() => {
        const row = getTt58IndustryById(confirmAction.industryId);
        if (!row) return null;
        return (
          <ConfirmDialog
            title="Xóa ngành nghề"
            message={
              <>
                Bạn có chắc muốn bỏ <strong>{row.name}</strong> khỏi danh sách áp dụng?
                {selectedIds.length === 1 && (
                  <span className="mt-2 block text-amber-700">
                    Đây là ngành nghề cuối cùng — sau khi xóa, hệ thống sẽ mở lại bảng chọn đầy đủ.
                  </span>
                )}
              </>
            }
            confirmLabel="Xóa"
            onConfirm={handleConfirm}
            onCancel={() => setConfirmAction(null)}
          />
        );
      })()}
    </div>
  );
};
