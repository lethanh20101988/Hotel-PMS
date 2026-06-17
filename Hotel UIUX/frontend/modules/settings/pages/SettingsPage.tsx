import React, { useEffect, useState } from 'react';
import { useApp } from '../../../app/store';
import type { AccountingRegimeConfig, AccountingStandard, Tt58TaxBookProfile } from '@shared/types';
import { ACCOUNTING_STANDARD_LABELS, TT58_TAX_BOOK_PROFILE_LABELS } from '@shared/regulations/types';
import { Tt58IndustrySettingsPanel } from '../components/Tt58IndustrySettingsPanel';

const getToken = () => {
  try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
};

export const SettingsPage: React.FC = () => {
  const { systemConfig, handleUpdateSystemConfig } = useApp();
  const [me, setMe] = useState<{ email?: string | null; phone?: string | null; role?: string | null } | null>(null);
  const regime = systemConfig.accountingRegime || {
    standard: 'TT133' as AccountingStandard,
    effectiveFrom: systemConfig.initializationDate?.slice(0, 10) || new Date().toISOString().slice(0, 10),
  };

  const updateRegime = (patch: Partial<AccountingRegimeConfig>) => {
    const nextStandard = (patch.standard || regime.standard) as AccountingStandard;
    handleUpdateSystemConfig({
      accountingRegime: {
        ...regime,
        ...patch,
        standard: nextStandard,
        effectiveFrom: patch.effectiveFrom || regime.effectiveFrom || '2026-07-01',
        tt58TaxBookProfile:
          nextStandard === 'TT58_2026'
            ? ((patch.tt58TaxBookProfile || regime.tt58TaxBookProfile || 'GTGT_DEDUCT_TNDN_INCOME') as Tt58TaxBookProfile)
            : undefined,
      },
    });
  };

  useEffect(() => {
    (async () => {
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        setMe(data);
      } catch {
        // ignore
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <h3 className="text-lg font-black text-slate-800">Cấu hình</h3>
        <p className="text-sm text-slate-500 mt-1">
          Tài khoản:{' '}
          <span className="font-bold text-slate-700">{me?.email || me?.phone || '---'}</span>{' '}
          {me?.role ? <span className="text-xs text-slate-400">({me.role})</span> : null}
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-3xl">
        <h4 className="text-sm font-black uppercase tracking-wider text-slate-600">Chế độ kế toán</h4>
        <p className="mt-2 text-sm text-slate-500">
          TT133 được giữ làm mặc định. Khi chọn TT58/2026, phần Báo cáo tài chính sẽ mở B01/B02-DNSN và bộ mẫu sổ DNSN riêng.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="block text-[10px] font-black text-slate-500 uppercase mb-1.5 ml-1">Thông tư áp dụng</span>
            <select
              value={regime.standard}
              onChange={(e) => updateRegime({ standard: e.target.value as AccountingStandard })}
              className="w-full h-[44px] px-3 bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold"
            >
              <option value="TT133">{ACCOUNTING_STANDARD_LABELS.TT133}</option>
              <option value="TT58_2026">{ACCOUNTING_STANDARD_LABELS.TT58_2026}</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] font-black text-slate-500 uppercase mb-1.5 ml-1">Áp dụng từ ngày</span>
            <input
              type="date"
              value={String(regime.effectiveFrom || '').slice(0, 10)}
              onChange={(e) => updateRegime({ effectiveFrom: e.target.value })}
              className="w-full h-[44px] px-3 bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold"
            />
          </label>
        </div>

        {regime.standard === 'TT58_2026' && (
          <div className="mt-4">
            <label className="block">
              <span className="block text-[10px] font-black text-slate-500 uppercase mb-1.5 ml-1">Profile sổ kế toán TT58 theo Điều 5-8</span>
              <select
                value={regime.tt58TaxBookProfile || 'GTGT_DEDUCT_TNDN_INCOME'}
                onChange={(e) => updateRegime({ tt58TaxBookProfile: e.target.value as Tt58TaxBookProfile })}
                className="w-full h-[44px] px-3 bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold"
              >
                {Object.entries(TT58_TAX_BOOK_PROFILE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              TT58/2026 áp dụng cho doanh nghiệp siêu nhỏ và không bắt buộc doanh nghiệp đang dùng TT133 phải chuyển. Chuyển lựa chọn này chỉ đổi bộ biểu mẫu báo cáo/sổ, không tự động sửa bút toán cũ.
            </div>
            <Tt58IndustrySettingsPanel
              regime={regime}
              onChangeIndustries={(tt58PrimaryIndustryIds) =>
                updateRegime({ tt58PrimaryIndustryIds, tt58PrimaryIndustryId: undefined })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
};
