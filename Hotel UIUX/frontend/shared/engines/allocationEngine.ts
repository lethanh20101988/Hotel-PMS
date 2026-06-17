/**
 * AllocationEngine — chỉ CCDC (TK 242 phân bổ).
 * Lũy kế phân bổ lưu ở `accumulatedAllocation`, không dùng `accumulatedDepreciation`.
 */

import { roundVnd } from '@shared/utils/vndMoney';

export const AllocationEngine = {
  /** Cơ sở phân bổ thường = toàn bộ nguyên giá (phân bổ hết về 0). */
  getAllocatableBase(cost: number): number {
    return Math.max(0, Number(cost || 0));
  },

  /** Lũy kế phân bổ mục tiêu đến hết tháng (đường thẳng, cùng logic làm tròn với TSCĐ). */
  computeTargetAllocated(
    allocatableBase: number,
    usefulLifeMonths: number,
    monthsEligible: number
  ): number {
    if (usefulLifeMonths <= 0 || allocatableBase <= 0 || monthsEligible <= 0) return 0;
    const monthlyFloat = allocatableBase / usefulLifeMonths;
    const raw = roundVnd(monthlyFloat * monthsEligible);
    return Math.min(allocatableBase, raw);
  },
};
