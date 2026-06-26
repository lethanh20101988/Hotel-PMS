import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Trash2,
  Archive,
  RotateCcw,
  History,
  AlertTriangle,
  ShieldX,
  Clock,
  Send,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import {
  lifecycleApi,
  entityLabel,
  entityTitle,
  HARD_DELETE_CONFIRM_TEXT,
  type LifecycleRow,
  type RecordVersion,
  type MeProfile,
} from './lifecycleClient';
import { useAppToast } from '../../app/components/AppToastContext';
import { Pagination } from '@shared/components/Pagination';

type SubTab = 'trash' | 'archive' | 'pending';
type LifecyclePageSize = 10 | 20 | 30 | 50 | 100;
const LIFECYCLE_PAGE_SIZES: LifecyclePageSize[] = [10, 20, 30, 50, 100];
type LifecycleRemoteEntity = {
  action?: string;
  entityType?: string;
  entityId?: string;
};

/** Tự refetch khi có thay đổi realtime — không bật trạng thái "Đang tải" (tránh nháy UI). */
function useAutoRefresh(
  sub: SubTab,
  reload: (opts?: { silent?: boolean }) => void,
  setRows: React.Dispatch<React.SetStateAction<LifecycleRow[]>>,
  setSelectedKeys: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  useEffect(() => {
    const handler = (ev: Event) => {
      const entity = (ev as CustomEvent<{ entity?: LifecycleRemoteEntity }>).detail?.entity;
      const action = entity?.action;
      const entityType = entity?.entityType;
      const entityId = entity?.entityId;
      if (!action || !entityType || !entityId) {
        reload({ silent: true });
        return;
      }

      const key = `${entityType}:${entityId}`;
      let handled = false;
      setRows((prev) => {
        const remove = () => {
          const next = prev.filter((r) => rowKeyOf(r) !== key);
          handled = next.length !== prev.length;
          return next;
        };
        if (sub === 'trash') {
          if (['DATA_RESTORED', 'DATA_ARCHIVED', 'DATA_DELETE_REQUESTED', 'DATA_DELETED', 'DATA_PURGED'].includes(action)) {
            return remove();
          }
          return prev;
        }
        if (sub === 'pending') {
          if (['DATA_RESTORED', 'DATA_DELETED', 'DATA_PURGED'].includes(action)) {
            return remove();
          }
          if (action === 'DATA_DELETE_APPROVED') {
            let changed = false;
            const next = prev.map((r) => {
              if (rowKeyOf(r) !== key) return r;
              changed = true;
              return { ...r, approved: 1, approved_at: r.approved_at || new Date().toISOString() };
            });
            handled = changed;
            return next;
          }
          // Mục mới chuyển từ Thùng rác sang Chờ xóa cần row đầy đủ, fallback reload nền.
          if (action === 'DATA_DELETE_REQUESTED') return prev;
        }
        if (sub === 'archive' && ['DATA_RESTORED', 'DATA_DELETED', 'DATA_PURGED'].includes(action)) {
          return remove();
        }
        return prev;
      });
      setSelectedKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      if (!handled && sub === 'pending' && action === 'DATA_DELETE_REQUESTED') {
        reload({ silent: true });
      }
    };
    window.addEventListener('vtr:state-remote-update', handler as EventListener);
    return () => window.removeEventListener('vtr:state-remote-update', handler as EventListener);
  }, [reload, setRows, setSelectedKeys, sub]);
}

const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('vi-VN') : '—');

// ---------- Modal: lịch sử phiên bản ----------
const VersionHistoryModal: React.FC<{ row: LifecycleRow; onClose: () => void }> = ({ row, onClose }) => {
  const [versions, setVersions] = useState<RecordVersion[] | null>(null);
  const [error, setError] = useState<string>('');
  useEffect(() => {
    lifecycleApi
      .versions(row.entity_type, row.entity_id)
      .then(setVersions)
      .catch((e) => setError(String(e.message || e)));
  }, [row.entity_type, row.entity_id]);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/45 p-4">
      <button type="button" className="absolute inset-0" aria-label="Đóng" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <h4 className="flex items-center gap-2 text-base font-black text-slate-900">
          <History size={18} /> Lịch sử phiên bản — {entityLabel(row.entity_type)} #{row.entity_id}
        </h4>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {!versions && !error && <p className="mt-3 text-sm text-slate-500">Đang tải…</p>}
        {versions && (
          <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-slate-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Ver</th>
                  <th className="px-3 py-2">Hành động</th>
                  <th className="px-3 py-2">Thời điểm</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version} className="border-t border-slate-50">
                    <td className="px-3 py-2 font-bold tabular-nums">{v.version}</td>
                    <td className="px-3 py-2">{v.action}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{fmt(v.created_at)}</td>
                  </tr>
                ))}
                {versions.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                      Chưa có phiên bản nào.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

const rowKeyOf = (r: LifecycleRow) => `${r.entity_type}:${r.entity_id}`;

// ---------- Modal: xác nhận XÓA VĨNH VIỄN ----------
const HardDeleteModal: React.FC<{
  rows: LifecycleRow[];
  onClose: () => void;
  onStartDelete: () => void;
  onSuccess: (count: number) => void;
  onError: (message: string) => void;
}> = ({ rows, onClose, onStartDelete, onSuccess, onError }) => {
  const row = rows[0];
  const bulk = rows.length > 1;
  const [text, setText] = useState('');

  const ready = text.trim() === HARD_DELETE_CONFIRM_TEXT;

  const confirm = () => {
    if (!ready) return;
    const confirmText = text.trim();
    const items = [...rows];
    onStartDelete();
    onClose();
    void (async () => {
      try {
        for (const item of items) {
          await lifecycleApi.hardDelete(item.entity_type, item.entity_id, confirmText);
        }
        onSuccess(items.length);
      } catch (e: any) {
        onError(String(e?.message || e));
      }
    })();
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-900/55 p-4">
      <div className="relative w-full max-w-md rounded-2xl border-2 border-rose-300 bg-white p-5 shadow-2xl">
        <h4 className="flex items-center gap-2 text-base font-black text-rose-700">
          <ShieldX size={20} /> Xóa vĩnh viễn — không thể hoàn tác
        </h4>
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {bulk ? (
            <>
              Bạn sắp <b>xóa thật {rows.length} mục</b> khỏi cơ sở dữ liệu.
              Chỉ còn lại bản ghi audit &amp; lịch sử phiên bản phục vụ pháp lý.
              <ul className="mt-2 max-h-28 overflow-y-auto text-xs text-rose-800/90">
                {rows.slice(0, 12).map((r) => (
                  <li key={rowKeyOf(r)}>
                    {entityLabel(r.entity_type)} — {entityTitle(r)}
                  </li>
                ))}
                {rows.length > 12 && <li>… và {rows.length - 12} mục khác</li>}
              </ul>
            </>
          ) : (
            <>
              Bạn sắp <b>xóa thật</b> {entityLabel(row.entity_type)} <b>{entityTitle(row)}</b> khỏi cơ sở dữ liệu.
              Chỉ còn lại bản ghi audit &amp; lịch sử phiên bản phục vụ pháp lý.
            </>
          )}
        </div>
        <label className="mt-4 block text-sm font-bold text-slate-700">
          Gõ <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-white">{HARD_DELETE_CONFIRM_TEXT}</span>{' '}
          để xác nhận
        </label>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={HARD_DELETE_CONFIRM_TEXT}
          className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-rose-500 focus:outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!ready}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-black text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShieldX size={15} />
            Xóa vĩnh viễn
          </button>
        </div>
      </div>
    </div>
  );
};

const SUB_TABS: { id: SubTab; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'trash', label: 'Thùng rác', icon: Trash2 },
  { id: 'archive', label: 'Lưu trữ', icon: Archive },
  { id: 'pending', label: 'Chờ xóa vĩnh viễn', icon: Clock },
];

export const LifecyclePage: React.FC = () => {
  const { pushToast } = useAppToast();
  const [me, setMe] = useState<MeProfile | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [sub, setSub] = useState<SubTab>('trash');
  const [rows, setRows] = useState<LifecycleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string>('');
  const [historyRow, setHistoryRow] = useState<LifecycleRow | null>(null);
  const [hardRows, setHardRows] = useState<LifecycleRow[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<LifecyclePageSize>(20);

  useEffect(() => {
    let cancelled = false;
    lifecycleApi
      .me()
      .then((profile) => {
        if (!cancelled) setMe(profile);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setMeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const can = useCallback(
    (perm: string) => !!me && (me.role === 'super_admin' || me.permissions?.includes(perm)),
    [me],
  );
  const canViewPending = !meLoaded || can('delete:approve') || can('delete:request') || can('delete:hard');

  const visibleTabs = useMemo(
    () => SUB_TABS.filter((t) => (t.id === 'pending' ? canViewPending : true)),
    [canViewPending],
  );

  const reload = useCallback((opts?: { silent?: boolean }) => {
    const showLoading = opts?.silent === false;
    if (showLoading) setLoading(true);
    setError('');
    const p =
      sub === 'trash'
        ? lifecycleApi.listTrash()
        : sub === 'archive'
          ? lifecycleApi.listArchive()
          : lifecycleApi.listPendingDelete();
    p.then(setRows)
      .catch((e) => setError(String(e.message || e)))
      .finally(() => {
        if (showLoading) setLoading(false);
      });
  }, [sub]);

  const removeRowsOptimistic = useCallback((targets: LifecycleRow[]) => {
    const keys = new Set(targets.map(rowKeyOf));
    if (keys.size === 0) return;
    setRows((prev) => prev.filter((row) => !keys.has(rowKeyOf(row))));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.delete(key);
      return next;
    });
  }, []);

  const approveRowsOptimistic = useCallback((targets: LifecycleRow[]) => {
    const keys = new Set(targets.map(rowKeyOf));
    if (keys.size === 0) return;
    const approvedAt = new Date().toISOString();
    setRows((prev) =>
      prev.map((row) =>
        keys.has(rowKeyOf(row)) ? { ...row, approved: 1, approved_at: row.approved_at || approvedAt } : row,
      ),
    );
  }, []);

  useEffect(() => {
    if (sub === 'pending' && !canViewPending) {
      setSub('trash');
      return;
    }
    setSelectedKeys(new Set());
    setPage(1);
    reload({ silent: true });
  }, [reload, sub, canViewPending]);
  useAutoRefresh(sub, reload, setRows, setSelectedKeys);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safePage, pageSize]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedKeys.has(rowKeyOf(r))),
    [rows, selectedKeys],
  );
  const allPageSelected =
    paginatedRows.length > 0 && paginatedRows.every((r) => selectedKeys.has(rowKeyOf(r)));
  const somePageSelected = paginatedRows.some((r) => selectedKeys.has(rowKeyOf(r)));

  const toggleRow = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedKeys((prev) => {
      if (allPageSelected) {
        const next = new Set(prev);
        for (const r of paginatedRows) next.delete(rowKeyOf(r));
        return next;
      }
      const next = new Set(prev);
      for (const r of paginatedRows) next.add(rowKeyOf(r));
      return next;
    });
  };

  const runBulk = async (
    targets: LifecycleRow[],
    fn: (row: LifecycleRow) => Promise<unknown>,
    confirmMsg?: string,
    successMsg?: string,
    optimistic?: () => void,
  ) => {
    if (targets.length === 0) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyKey('bulk');
    optimistic?.();
    let ok = 0;
    let fail = 0;
    let lastErr = '';
    try {
      for (const row of targets) {
        try {
          await fn(row);
          ok += 1;
        } catch (e: any) {
          fail += 1;
          lastErr = String(e?.message || e);
        }
      }
      setSelectedKeys(new Set());
      reload({ silent: true });
      if (fail === 0) {
        pushToast({
          message: successMsg || `Đã xử lý ${ok} mục.`,
          variant: 'success',
        });
      } else {
        pushToast({
          message: `Xử lý ${ok}/${targets.length} mục. ${fail} mục thất bại: ${lastErr}`,
          variant: 'error',
          durationMs: 10000,
        });
      }
    } finally {
      setBusyKey('');
    }
  };

  const run = async (
    key: string,
    fn: () => Promise<unknown>,
    confirmMsg?: string,
    successMsg?: string,
    optimistic?: () => void,
  ) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyKey(key);
    optimistic?.();
    try {
      await fn();
      reload({ silent: true });
      if (successMsg) pushToast({ message: successMsg, variant: 'success' });
    } catch (e: any) {
      pushToast({ message: `Thao tác thất bại: ${e?.message || e}`, variant: 'error', durationMs: 8000 });
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-xl font-black text-slate-800">
          <Trash2 size={22} /> Vòng đời dữ liệu
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Quy trình xóa an toàn: <b>Xóa mềm</b> → <b>Yêu cầu xóa</b> (admin) → <b>Duyệt</b> (super admin) →{' '}
          <b>Xóa vĩnh viễn</b>. Mọi thao tác đều được ghi vết (audit) và có lịch sử phiên bản.
          {me && (
            <span className="ml-1 text-slate-400">
              · Vai trò của bạn: <b className="text-slate-600">{me.role}</b>
            </span>
          )}
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {visibleTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSub(id)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors ${
              sub === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => reload({ silent: true })}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50"
        >
          <RotateCcw size={15} /> Tải lại
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {(sub === 'trash' || sub === 'pending') && selectedRows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <span className="text-sm font-bold text-blue-900">
            Đã chọn {selectedRows.length} mục
          </span>
          {sub === 'trash' && can('delete:restore') && (
            <button
              type="button"
              disabled={busyKey === 'bulk'}
              onClick={() =>
                runBulk(
                  selectedRows,
                  (r) => lifecycleApi.restore(r.entity_type, r.entity_id),
                  `Khôi phục ${selectedRows.length} mục về trạng thái hoạt động?`,
                  `Đã khôi phục ${selectedRows.length} mục.`,
                  () => removeRowsOptimistic(selectedRows),
                )
              }
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
            >
              <RotateCcw size={13} /> Khôi phục
            </button>
          )}
          {sub === 'trash' && can('delete:request') && (
            <button
              type="button"
              disabled={busyKey === 'bulk'}
              onClick={() =>
                runBulk(
                  selectedRows,
                  (r) => lifecycleApi.requestDelete(r.entity_type, r.entity_id),
                  `Gửi yêu cầu xóa vĩnh viễn cho ${selectedRows.length} mục? Yêu cầu cần super admin duyệt trước khi xóa thật.`,
                  `Đã gửi yêu cầu xóa vĩnh viễn cho ${selectedRows.length} mục.`,
                  () => removeRowsOptimistic(selectedRows),
                )
              }
              className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              <Send size={13} /> Yêu cầu xóa
            </button>
          )}
          {sub === 'pending' && (can('delete:approve') || can('delete:hard')) && (
            <button
              type="button"
              disabled={busyKey === 'bulk'}
              onClick={() => {
                const targets = selectedRows.filter((r) => !r.approved);
                runBulk(
                  targets,
                  (r) => lifecycleApi.approveDelete(r.entity_type, r.entity_id),
                  targets.length > 0
                    ? `Duyệt yêu cầu xóa vĩnh viễn cho ${targets.length} mục?`
                    : undefined,
                  targets.length > 0 ? `Đã duyệt ${targets.length} yêu cầu xóa.` : undefined,
                  () => approveRowsOptimistic(targets),
                );
                if (targets.length === 0) {
                  pushToast({ message: 'Không có mục «Chờ duyệt» trong danh sách đã chọn.', variant: 'error' });
                }
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
            >
              <CheckCircle2 size={13} /> Duyệt xóa
            </button>
          )}
          {sub === 'pending' && can('delete:hard') && (
            <button
              type="button"
              disabled={busyKey === 'bulk'}
              onClick={() => {
                const targets = selectedRows.filter((r) => r.approved);
                if (targets.length === 0) {
                  pushToast({
                    message: 'Chỉ xóa vĩnh viễn các mục đã được duyệt. Hãy duyệt trước hoặc bỏ chọn mục chưa duyệt.',
                    variant: 'error',
                    durationMs: 8000,
                  });
                  return;
                }
                setHardRows(targets);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-40"
            >
              <ShieldX size={13} /> Xóa vĩnh viễn
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedKeys(new Set())}
            className="ml-auto text-xs font-bold text-slate-500 hover:text-slate-700"
          >
            Bỏ chọn
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[min(70vh,640px)] overflow-auto overscroll-contain">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 text-[10px] font-black uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
              <tr>
                {(sub === 'trash' || sub === 'pending') && (
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả trang này"
                      checked={allPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = somePageSelected && !allPageSelected;
                      }}
                      onChange={toggleAllVisible}
                      disabled={paginatedRows.length === 0 || busyKey === 'bulk'}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                )}
              <th className="px-4 py-2.5">Loại</th>
              <th className="px-3 py-2.5">Tên / Mã</th>
              <th className="px-3 py-2.5">
                {sub === 'archive' ? 'Lưu trữ lúc' : sub === 'pending' ? 'Trạng thái duyệt' : 'Xóa lúc'}
              </th>
              <th className="px-3 py-2.5">Bởi / Lý do</th>
              <th className="px-3 py-2.5 text-right">Thao tác</th>
            </tr>
          </thead>
            <tbody>
              {paginatedRows.length === 0 && (
                <tr>
                  <td
                    colSpan={sub === 'trash' || sub === 'pending' ? 6 : 5}
                    className="px-4 py-12 text-center text-sm font-medium italic text-slate-400"
                  >
                    Không có bản ghi trong mục này.
                  </td>
                </tr>
              )}
              {paginatedRows.map((r) => {
                const key = rowKeyOf(r);
                const busy = busyKey === key || busyKey === 'bulk';
                const approved = !!r.approved;
                const checked = selectedKeys.has(key);
                return (
                  <tr key={key} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    {(sub === 'trash' || sub === 'pending') && (
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Chọn ${entityTitle(r)}`}
                          checked={checked}
                          onChange={() => toggleRow(key)}
                          disabled={busy}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                        {entityLabel(r.entity_type)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-800">{entityTitle(r)}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">
                      {sub === 'archive' ? (
                        fmt(r.archived_at)
                      ) : sub === 'pending' ? (
                        approved ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">
                            <ShieldCheck size={12} /> Đã duyệt
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-bold text-amber-700">
                            <Clock size={12} /> Chờ duyệt
                          </span>
                        )
                      ) : (
                        fmt(r.deleted_at)
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">
                      {(sub === 'pending' ? r.requested_by || r.deleted_by : r.deleted_by) || '—'}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {/* Restore — cần delete:restore */}
                        {can('delete:restore') && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              run(
                                key,
                                () => lifecycleApi.restore(r.entity_type, r.entity_id),
                                undefined,
                                'Đã khôi phục bản ghi về trạng thái hoạt động.',
                                () => removeRowsOptimistic([r]),
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                            title="Khôi phục về ACTIVE"
                          >
                            <RotateCcw size={13} /> Khôi phục
                          </button>
                        )}

                        {/* Trash: Lưu trữ + Yêu cầu xóa vĩnh viễn */}
                        {sub === 'trash' && can('delete:restore') && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              run(
                                key,
                                () => lifecycleApi.archive(r.entity_type, r.entity_id),
                                undefined,
                                undefined,
                                () => removeRowsOptimistic([r]),
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-2 py-1 text-xs font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-40"
                            title="Chuyển sang lưu trữ"
                          >
                            <Archive size={13} /> Lưu trữ
                          </button>
                        )}
                        {sub === 'trash' && can('delete:request') && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              run(
                                key,
                                () => lifecycleApi.requestDelete(r.entity_type, r.entity_id),
                                'Gửi yêu cầu xóa vĩnh viễn? Yêu cầu cần super admin duyệt trước khi xóa thật.',
                                'Đã gửi yêu cầu xóa vĩnh viễn. Chuyển sang tab Chờ xóa vĩnh viễn.',
                                () => removeRowsOptimistic([r]),
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                            title="Yêu cầu xóa vĩnh viễn"
                          >
                            <Send size={13} /> Yêu cầu xóa
                          </button>
                        )}

                        {/* Pending: Duyệt (nếu chưa duyệt) hoặc Xóa vĩnh viễn (nếu đã duyệt) */}
                        {sub === 'pending' && !approved && (can('delete:approve') || can('delete:hard')) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              run(
                                key,
                                () => lifecycleApi.approveDelete(r.entity_type, r.entity_id),
                                'Duyệt yêu cầu xóa vĩnh viễn?',
                                'Đã duyệt yêu cầu xóa. Bạn có thể xóa vĩnh viễn sau khi bấm nút Xóa vĩnh viễn.',
                                () => approveRowsOptimistic([r]),
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                            title="Duyệt yêu cầu xóa"
                          >
                            <CheckCircle2 size={13} /> Duyệt xóa
                          </button>
                        )}
                        {sub === 'pending' && approved && can('delete:hard') && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setHardRows([r])}
                            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-40"
                            title="Xóa vĩnh viễn"
                          >
                            <ShieldX size={13} /> Xóa vĩnh viễn
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setHistoryRow(r)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50"
                          title="Lịch sử phiên bản"
                        >
                          <History size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pagination
          page={safePage}
          totalItems={rows.length}
          pageSize={pageSize}
          onChangePage={setPage}
          onChangePageSize={(next) => {
            setPageSize(next as LifecyclePageSize);
            setPage(1);
          }}
          pageSizeOptions={LIFECYCLE_PAGE_SIZES}
          variant="compact"
        />
      </div>

      {historyRow && <VersionHistoryModal row={historyRow} onClose={() => setHistoryRow(null)} />}
      {hardRows && hardRows.length > 0 && (
        <HardDeleteModal
          rows={hardRows}
          onClose={() => setHardRows(null)}
          onStartDelete={() => {
            setBusyKey('bulk');
            removeRowsOptimistic(hardRows);
          }}
          onSuccess={(n) => {
            setBusyKey('');
            setHardRows(null);
            setSelectedKeys(new Set());
            reload({ silent: true });
            pushToast({
              message:
                n > 1
                  ? `Đã xóa vĩnh viễn ${n} mục khỏi cơ sở dữ liệu (audit + lịch sử vẫn giữ).`
                  : 'Đã xóa vĩnh viễn khỏi cơ sở dữ liệu (audit + lịch sử vẫn giữ).',
              variant: 'success',
            });
          }}
          onError={(message) => {
            setBusyKey('');
            reload({ silent: true });
            pushToast({
              message: `Xóa vĩnh viễn thất bại: ${message}`,
              variant: 'error',
              durationMs: 10000,
            });
          }}
        />
      )}
    </div>
  );
};

export default LifecyclePage;
