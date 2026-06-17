import type { Gtgt01PeriodRange } from './gtgt01Aggregation';

export type Pl204PuRow = { id: string; name: string; c3: string; c4: string };
export type Pl204SaRow = { id: string; name: string; c3: string; c4: string };

export type Pl204AnnexFormState = {
  agentName: string;
  agentTaxCode: string;
  puRows: Pl204PuRow[];
  saRows: Pl204SaRow[];
};

let _puId = 0;
let _saId = 0;

export function newPl204PuRow(): Pl204PuRow {
  _puId += 1;
  return { id: `p_${Date.now()}_${_puId}`, name: '', c3: '', c4: '' };
}

export function newPl204SaRow(): Pl204SaRow {
  _saId += 1;
  return { id: `s_${Date.now()}_${_saId}`, name: '', c3: '', c4: '10' };
}

export function emptyPl204AnnexState(): Pl204AnnexFormState {
  return {
    agentName: '',
    agentTaxCode: '',
    puRows: [newPl204PuRow()],
    saRows: [newPl204SaRow()],
  };
}

export function normalizePl204AnnexFormState(raw: unknown): Pl204AnnexFormState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const agentName = typeof o.agentName === 'string' ? o.agentName : '';
  const agentTaxCode = typeof o.agentTaxCode === 'string' ? o.agentTaxCode : '';
  const puIn = o.puRows;
  const saIn = o.saRows;
  const puRows: Pl204PuRow[] = Array.isArray(puIn)
    ? puIn
        .map((r: any) => ({
          id: typeof r?.id === 'string' ? r.id : newPl204PuRow().id,
          name: typeof r?.name === 'string' ? r.name : '',
          c3: typeof r?.c3 === 'string' ? r.c3 : '',
          c4: typeof r?.c4 === 'string' ? r.c4 : '',
        }))
        .filter(r => r.id)
    : [];
  const saRows: Pl204SaRow[] = Array.isArray(saIn)
    ? saIn
        .map((r: any) => ({
          id: typeof r?.id === 'string' ? r.id : newPl204SaRow().id,
          name: typeof r?.name === 'string' ? r.name : '',
          c3: typeof r?.c3 === 'string' ? r.c3 : '',
          c4: typeof r?.c4 === 'string' ? r.c4 : '10',
        }))
        .filter(r => r.id)
    : [];
  if (puRows.length === 0) puRows.push(newPl204PuRow());
  if (saRows.length === 0) saRows.push(newPl204SaRow());
  return { agentName, agentTaxCode, puRows, saRows };
}

export type VatPl204LinkedMode = {
  periodKind: 'MONTH' | 'QUARTER';
  year: number;
  month: number;
  quarter: number;
  periodRange: Gtgt01PeriodRange;
  taxpayerName: string;
  taxpayerTaxCode: string;
  annexState: Pl204AnnexFormState;
  onAnnexChange: (next: Pl204AnnexFormState) => void;
};

export const GTGT01_PL204_BY_PERIOD_KEY = 'victory_gtgt01_pl204_by_period_v1';

export function loadPl204AnnexMap(): Record<string, Pl204AnnexFormState> {
  return {};
}

export function savePl204AnnexMap(_map: Record<string, Pl204AnnexFormState>): void {
  /* Server-only: GET/PUT /api/tax/gtgt01/data */
}
