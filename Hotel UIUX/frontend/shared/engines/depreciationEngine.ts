/**
 * DepreciationEngine — chỉ TSCĐ (TK 211 / 214).
 * Không dùng cho CCDC.
 */

import type { Asset } from '@shared/types';
import { roundVnd } from '@shared/utils/vndMoney';

export const DepreciationEngine = {
  /** Phần nguyên giá chịu khấu hao = NG − giá trị thu hồi. */
  getDepreciableBase(asset: Pick<Asset, 'cost' | 'salvageValue'>): number {
    const cost = Math.max(0, Number(asset.cost || 0));
    const salvage = Math.max(0, Math.min(cost, Number(asset.salvageValue ?? 0)));
    return Math.max(0, cost - salvage);
  },

  /**
   * Lũy kế khấu hao mục tiêu đến hết tháng (đường thẳng, làm tròn đồng bộ store).
   */
  computeTargetAccumulated(
    depreciableBase: number,
    usefulLifeMonths: number,
    monthsEligible: number
  ): number {
    if (usefulLifeMonths <= 0 || depreciableBase <= 0 || monthsEligible <= 0) return 0;
    const monthlyFloat = depreciableBase / usefulLifeMonths;
    const raw = roundVnd(monthlyFloat * monthsEligible);
    return Math.min(depreciableBase, raw);
  },
};
