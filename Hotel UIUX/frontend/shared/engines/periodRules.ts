/** Quy tắc đếm tháng đủ điều kiện KH (TSCĐ) / phân bổ (CCDC) — dùng chung. */

export type DepreciationPolicy = 'DAY1_INCLUDES_MONTH' | 'FULL_MONTHS_ONLY';

export function countEligibleMonths(
  useDateStr: string,
  periodEnd: Date,
  usefulLife: number,
  policy: DepreciationPolicy
): number {
  const start = new Date(useDateStr);
  if (Number.isNaN(start.getTime()) || periodEnd < start) return 0;
  const monthDiff =
    (periodEnd.getFullYear() - start.getFullYear()) * 12 + (periodEnd.getMonth() - start.getMonth());
  const includeStartMonth = policy === 'DAY1_INCLUDES_MONTH' && start.getDate() === 1 ? 1 : 0;
  const monthsEligible = Math.max(0, monthDiff + includeStartMonth);
  return Math.min(Math.max(0, usefulLife), monthsEligible);
}
