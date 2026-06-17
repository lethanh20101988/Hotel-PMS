import React from 'react';
import { Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { formatCurrency } from '@shared/utils/format';

export type VatComparisonDatum = { name: string; v: number };

export function InvoiceVatComparisonChart({ data }: { data: VatComparisonDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Bar dataKey="v" radius={[6, 6, 0, 0]} maxBarSize={40}>
          <Cell fill="#34d399" />
          <Cell fill="#8b5cf6" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
