
import React from 'react';
import { Wallet, Landmark, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { formatCurrency } from '@shared/utils/format';

interface StatTrend {
  receipt: number;
  payment: number;
}

interface FundStatsProps {
  cashBalance: number;
  bankBalance: number;
  cashTrend: StatTrend;
  bankTrend: StatTrend;
}

const cardShadow = 'shadow-[0_1px_3px_rgba(15,23,42,0.06)]';

const TrendBadge = ({ value, label }: { value: number; label: string }) => {
  if (value === 0)
    return (
      <span className="flex items-center text-slate-400">
        <Minus className="mr-0.5 h-3 w-3" /> {label}: 0%
      </span>
    );

  const isPositive = value > 0;
  return (
    <span className={`flex items-center ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
      {isPositive ? <ArrowUpRight className="mr-0.5 h-3 w-3" /> : <ArrowDownRight className="mr-0.5 h-3 w-3" />}
      {label}: {isPositive ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  );
};

export const FundStats: React.FC<FundStatsProps> = ({ cashBalance, bankBalance, cashTrend, bankTrend }) => {
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
      {/* Tiền mặt */}
      <div
        className={`flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 sm:p-3.5 ${cardShadow} border-l-[3px] border-l-emerald-500`}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50/90 text-emerald-600 ring-1 ring-emerald-100/60">
          <Wallet className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-tight text-slate-600">Tiền mặt (1111)</p>
          <p className="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
            {formatCurrency(cashBalance)}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-medium text-slate-500">
            <TrendBadge value={cashTrend.receipt} label="Thu" />
            <TrendBadge value={cashTrend.payment} label="Chi" />
          </div>
        </div>
      </div>

      {/* Ngân hàng */}
      <div
        className={`flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 sm:p-3.5 ${cardShadow} border-l-[3px] border-l-sky-500`}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50/90 text-sky-600 ring-1 ring-sky-100/60">
          <Landmark className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-tight text-slate-600">Tiền gửi ngân hàng (1121 tổng hợp)</p>
          <p className="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
            {formatCurrency(bankBalance)}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-medium text-slate-500">
            <TrendBadge value={bankTrend.receipt} label="Thu" />
            <TrendBadge value={bankTrend.payment} label="Chi" />
          </div>
        </div>
      </div>
    </div>
  );
};
