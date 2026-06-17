import type { Asset } from '@shared/types';

/** TK chi phí phân bổ / khấu hao: 6421 CPBH, 6422 CPQLDN, 641, 627. */
export function resolveAssetExpenseAccount(asset: Pick<Asset, 'expenseAccount' | 'department'>): string {
  const ex = String(asset.expenseAccount || '').trim();
  if (/^(6421|6422|641|627)$/.test(ex)) return ex;
  return String(asset.department || '').includes('Quản lý') ? '6422' : '6421';
}
