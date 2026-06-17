import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

export type DevicePieDatum = { name: string; value: number; color: string };

export function DashboardDevicePieChart({ data }: { data: DevicePieDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} innerRadius={16} outerRadius={26} paddingAngle={2} dataKey="value">
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
