import { lazy, type ComponentType } from 'react';
import type { AccountingStandard } from './types';

export const REGULATION_REGISTRY = {
  TT133: {
    ReportPage: lazy(() =>
      import('../../modules/accounting/pages/Report133').then((m) => ({ default: m.Report133 })),
    ),
  },
  TT58_2026: {
    ReportPage: lazy(() =>
      import('../../modules/accounting/pages/Report58').then((m) => ({ default: m.Report58 })),
    ),
  },
} satisfies Record<AccountingStandard, { ReportPage: ComponentType }>;
