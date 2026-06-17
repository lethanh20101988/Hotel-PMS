import React, { useCallback, useMemo, useState } from 'react';
import { FileSpreadsheet, FolderOpen, Printer, RefreshCw, Save, Trash2, Download } from 'lucide-react';
import type { CompanyInfo, FinancialYear, Invoice } from '@shared/types';
import { formatCurrency, formatThousandsVNFromDigits, parseDigitsOnly } from '@shared/utils/format';
import {
  aggregateInvoicesForGtgt01,
  aggregateSupplementaryInvoicesForGtgt01,
  monthRange,
  quarterRange,
  type Gtgt01PeriodRange,
} from '../utils/gtgt01Aggregation';
import { computeSupplementaryCt37Ct38ForRange } from '../utils/gtgtSupplementaryAdjustments';
import { VatKhbsSupplementarySection } from './VatKhbsSupplementarySection';
import { VatPl204ReductionAnnex } from './VatPl204ReductionAnnex';
import type { KhbsBundle, KhbsLineCategory } from './vatKhbsTypes';
import { emptyKhbsBundle, newKhbsLine } from './vatKhbsTypes';
import { runGtgt01Validations } from '../utils/vatGtgt01Validations';
import {
  getPeriodBaselineKey,
  getPreviousTaxPeriod,
  khbsReportedAmountsFromSnapshotJson,
  latestSnapshotV43ForPeriod,
  snapshotJsonMatchesPeriod,
  type Gtgt01BaselineMap,
} from '../utils/gtgt01Baseline';
import {
  emptyPl204AnnexState,
  normalizePl204AnnexFormState,
  type Pl204AnnexFormState,
} from '../utils/vatPl204AnnexState';
import {
  getGtgt01WorkingDraftKey,
  migrateLegacyGtgt01WorkingDraftKeys,
  type Gtgt01WorkingDraftMap,
} from '../utils/gtgt01WorkingDrafts';
import {
  fetchTaxGtgt01Payload,
  putTaxGtgt01Payload,
  TAX_GTGT01_PAYLOAD_VERSION,
  type TaxGtgt01PersistPayload,
} from '../utils/taxGtgt01ServerSync';
import { downloadGtgt01MainSheet } from '../utils/gtgt01ExcelExport';
import { useApp } from '../../../app/store';
import { getInvoiceTaxDeclarationDate } from '@shared/utils/crossPeriodInvoice';

/** Cuộn tới biểu mẫu 01/GTGT sau khi bấm Mở (danh sách bản lưu nằm phía trên form). */
const GTGT01_FORM_SCROLL_ID = 'vat-gtgt01-main-form';

function scrollToGtgt01DeclarationForm() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById(GTGT01_FORM_SCROLL_ID);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.focus({ preventScroll: true });
    });
  });
}

type PeriodKind = 'MONTH' | 'QUARTER';

function parseNum(v: string): number {
  const n = Number(String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function fmtInput(n: number): string {
  if (!n) return '';
  return String(n);
}

export interface VatGtgt01DeclarationProps {
  invoices: Invoice[];
  companyInfo: CompanyInfo;
  financialYear: FinancialYear;
}

type Snapshot = {
  id: string;
  createdAt: string;
  label: string;
  json: string;
  /** Bản bổ sung / KHBS: liên kết tờ khai lần đầu cùng kỳ (nếu có). */
  parentSnapshotId?: string;
};

/** Khi mở bổ sung lần n mà chưa có nháp: lấy JSON từ bản bổ sung (n−1) hoặc lần đầu cùng kỳ. */
function findFallbackSnapshotJsonForSupplementary(
  snapList: { label: string; json: string; createdAt: string }[],
  periodKind: PeriodKind,
  year: number,
  month: number,
  quarter: number,
  supplementaryNo: string,
): string | null {
  const n = Math.max(1, parseInt(String(supplementaryNo).replace(/\D/g, ''), 10) || 1);
  const match = (s: { label: string; json: string }) =>
    snapshotJsonMatchesPeriod(s.json, periodKind, year, month, quarter);
  const list = snapList.filter(match).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (n <= 1) {
    const first = list.find(s => /\bLần đầu\b/i.test(s.label));
    return first?.json ?? null;
  }
  const prevRe = new RegExp(`Bổ sung\\s*${n - 1}(?:\\b|$)`);
  const prev = list.find(s => prevRe.test(s.label));
  if (prev) return prev.json;
  const first = list.find(s => /\bLần đầu\b/i.test(s.label));
  return first?.json ?? null;
}

function resolveParentSnapshotId(
  snapList: Snapshot[],
  periodKind: PeriodKind,
  year: number,
  month: number,
  quarter: number,
  filingFirst: boolean,
  supplementaryNo: string,
): string | undefined {
  if (filingFirst) return undefined;
  const n = Math.max(1, parseInt(String(supplementaryNo).replace(/\D/g, ''), 10) || 1);
  const samePeriod = (s: Snapshot) =>
    snapshotJsonMatchesPeriod(s.json, periodKind, year, month, quarter);
  const list = snapList.filter(samePeriod).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (n <= 1) {
    const first = list.find(s => /\bLần đầu\b/i.test(s.label));
    return first?.id;
  }
  const prevRe = new RegExp(`Bổ sung\\s*${n - 1}(?:\\b|$)`);
  const prev = list.find(s => prevRe.test(s.label));
  if (prev) return prev.id;
  const first = list.find(s => /\bLần đầu\b/i.test(s.label));
  return first?.id;
}

export const VatGtgt01Declaration: React.FC<VatGtgt01DeclarationProps> = ({
  invoices,
  companyInfo,
  financialYear,
}) => {
  const { backendAvailable, hydrated } = useApp();
  const fyYear = useMemo(() => new Date(financialYear.startDate).getFullYear(), [financialYear.startDate]);

  const invoicesInFy = useMemo(
    () =>
      invoices.filter((inv) => {
        const taxDate = getInvoiceTaxDeclarationDate(inv);
        return taxDate >= financialYear.startDate && taxDate <= financialYear.endDate;
      }),
    [invoices, financialYear.startDate, financialYear.endDate],
  );

  const supplementaryFilingCount = useMemo(
    () =>
      invoicesInFy.filter(
        (inv) => inv.crossPeriodMeta?.supplementaryVat || inv.taxFilingMeta?.supplementaryFromPriorPeriod,
      ).length,
    [invoicesInFy],
  );

  const [activityName, setActivityName] = useState('Hoạt động sản xuất kinh doanh thông thường');
  const [periodKind, setPeriodKind] = useState<PeriodKind>('QUARTER');
  const [year, setYear] = useState(fyYear);
  const [month, setMonth] = useState(1);
  const [quarter, setQuarter] = useState(1);
  const [filingFirst, setFilingFirst] = useState(true);
  const [supplementaryNo, setSupplementaryNo] = useState('');

  const [taxpayerName, setTaxpayerName] = useState(companyInfo.name || '');
  const [taxpayerTaxCode, setTaxpayerTaxCode] = useState(companyInfo.taxCode || '');
  const [agentName, setAgentName] = useState('');
  const [agentTaxCode, setAgentTaxCode] = useState('');
  const [agentContractNo, setAgentContractNo] = useState('');
  const [agentContractDate, setAgentContractDate] = useState('');
  const [depName, setDepName] = useState('');
  const [depTaxCode, setDepTaxCode] = useState('');
  const [depProvince, setDepProvince] = useState('');
  const [depDistrict, setDepDistrict] = useState('');
  const [depWard, setDepWard] = useState('');

  const [noActivity, setNoActivity] = useState(false);

  const [n22, setN22] = useState('');
  const [n23, setN23] = useState('');
  const [n23a, setN23a] = useState('');
  const [n24, setN24] = useState('');
  const [n24a, setN24a] = useState('');
  const [n25, setN25] = useState('');
  const [n26, setN26] = useState('');
  const [n29, setN29] = useState('');
  const [n30, setN30] = useState('');
  const [n31, setN31] = useState('');
  const [n32, setN32] = useState('');
  const [n33, setN33] = useState('');
  const [n32a, setN32a] = useState('');
  const [n37, setN37] = useState('');
  const [n38, setN38] = useState('');
  const [n39a, setN39a] = useState('');
  const [n40b, setN40b] = useState('');
  const [n42, setN42] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signDate, setSignDate] = useState('');

  const [khbs, setKhbs] = useState(() => emptyKhbsBundle());

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  const [baselines, setBaselines] = useState<Gtgt01BaselineMap>({});

  const [pl204ByPeriod, setPl204ByPeriod] = useState<Record<string, Pl204AnnexFormState>>({});

  const [periodWorkingDrafts, setPeriodWorkingDrafts] = useState<Gtgt01WorkingDraftMap>({});
  const [taxSyncReady, setTaxSyncReady] = useState(false);
  const [remoteTaxReloadNonce, setRemoteTaxReloadNonce] = useState(0);

  const workingDraftsRef = React.useRef(periodWorkingDrafts);
  workingDraftsRef.current = periodWorkingDrafts;

  const skipAutoFromWorkingDraftRef = React.useRef<string | null>(null);
  const prevHydratedDraftKeyRef = React.useRef<string | null>(null);
  const snapshotsForFallbackRef = React.useRef(snapshots);
  snapshotsForFallbackRef.current = snapshots;

  const periodRange: Gtgt01PeriodRange = useMemo(() => {
    if (periodKind === 'MONTH') return monthRange(year, month);
    return quarterRange(year, quarter);
  }, [periodKind, year, month, quarter]);

  const supplementaryVatSuggestion = useMemo(
    () => computeSupplementaryCt37Ct38ForRange(invoicesInFy, periodRange),
    [invoicesInFy, periodRange],
  );

  const supplementarySliceAgg = useMemo(
    () => aggregateSupplementaryInvoicesForGtgt01(invoicesInFy, periodRange),
    [invoicesInFy, periodRange],
  );

  const applySupplementaryCt37Ct38 = useCallback(() => {
    const add37 = supplementaryVatSuggestion.ct37;
    const add38 = supplementaryVatSuggestion.ct38;
    setN37((prev) => fmtInput(parseNum(prev) + add37));
    setN38((prev) => fmtInput(parseNum(prev) + add38));
  }, [supplementaryVatSuggestion.ct37, supplementaryVatSuggestion.ct38]);

  const periodBaselineKey = useMemo(
    () => getPeriodBaselineKey(periodKind, year, month, quarter),
    [periodKind, year, month, quarter],
  );

  const workingDraftKey = useMemo(
    () => getGtgt01WorkingDraftKey(periodBaselineKey, filingFirst, supplementaryNo),
    [periodBaselineKey, filingFirst, supplementaryNo],
  );

  const pl204AnnexCurrent = useMemo(
    () => pl204ByPeriod[periodBaselineKey] ?? emptyPl204AnnexState(),
    [pl204ByPeriod, periodBaselineKey],
  );

  const setPl204AnnexCurrent = useCallback(
    (next: Pl204AnnexFormState) => {
      setPl204ByPeriod(prev => ({ ...prev, [periodBaselineKey]: next }));
    },
    [periodBaselineKey],
  );

  const baselineForPeriod = baselines[periodBaselineKey];

  /**
   * Chốt số dư chuyển kỳ (kỳ liền trước): Base_43 = [43] tờ khai lần đầu kỳ k-1; Target_43 = [43] bản nháp mới nhất cùng kỳ.
   * Δ = Target_43 − Base_43 → [37] hoặc [38] kỳ k; [22]_k = Base_43 (không sửa tay khi có đủ dữ liệu kỳ trước).
   */
  const prevPeriodNetCarry = useMemo(() => {
    const prev = getPreviousTaxPeriod(periodKind, year, month, quarter);
    if (!prev) return null;
    const baseRec = baselines[prev.baselineKey];
    if (!baseRec?.json) return null;
    const baseVals = khbsReportedAmountsFromSnapshotJson(baseRec.json);
    const v43First = baseVals?.['[43]'];
    if (typeof v43First !== 'number') return null;
    let v43Latest = latestSnapshotV43ForPeriod(
      snapshots,
      prev.periodKind,
      prev.year,
      prev.month,
      prev.quarter,
    );
    if (v43Latest === null) v43Latest = v43First;
    let adj37 = 0;
    let adj38 = 0;
    if (v43Latest < v43First) adj37 = v43First - v43Latest;
    else if (v43Latest > v43First) adj38 = v43Latest - v43First;
    const prevLabel =
      prev.periodKind === 'MONTH' ? `T${prev.month}/${prev.year}` : `Q${prev.quarter}/${prev.year}`;
    return {
      v43First,
      v43Latest,
      adj37,
      adj38,
      prevLabel,
      basisSignature: `${periodBaselineKey}|${v43First}|${v43Latest}`,
    };
  }, [periodKind, year, month, quarter, baselines, snapshots, periodBaselineKey]);

  const lastCarrySigRef = React.useRef<string>('');

  React.useEffect(() => {
    lastCarrySigRef.current = '';
  }, [periodBaselineKey, filingFirst]);

  /** Không có baseline lần đầu kỳ liền trước — chỉ khai lần đầu: để trống [22]/[37]/[38]. */
  React.useEffect(() => {
    if (!filingFirst) return;
    if (prevPeriodNetCarry) return;
    if (skipAutoFromWorkingDraftRef.current === workingDraftKey) return;
    setN22('');
    setN37('');
    setN38('');
  }, [filingFirst, prevPeriodNetCarry, periodBaselineKey, workingDraftKey]);

  React.useEffect(() => {
    if (!prevPeriodNetCarry) return;
    if (skipAutoFromWorkingDraftRef.current === workingDraftKey) return;
    const sig = `${prevPeriodNetCarry.basisSignature}|${filingFirst}`;
    if (lastCarrySigRef.current === sig) return;
    lastCarrySigRef.current = sig;
    setN22(fmtInput(prevPeriodNetCarry.v43First));
    setN37(prevPeriodNetCarry.adj37 ? fmtInput(prevPeriodNetCarry.adj37) : '');
    setN38(prevPeriodNetCarry.adj38 ? fmtInput(prevPeriodNetCarry.adj38) : '');
  }, [prevPeriodNetCarry, periodBaselineKey, filingFirst, workingDraftKey]);

  /** Khóa [22] khi đã suy từ [43] lần đầu kỳ liền trước (áp dụng cả lần đầu và bổ sung kỳ này). */
  const lockN22FromPrevPeriod = Boolean(prevPeriodNetCarry);

  const nums = useMemo(() => {
    const g = (s: string) => (noActivity ? 0 : parseNum(s));
    const v22 = g(n22);
    const v23 = g(n23);
    const v23a = g(n23a);
    const v24 = g(n24);
    const v24a = g(n24a);
    const v25 = g(n25);
    const v26 = g(n26);
    const v29 = g(n29);
    const v30 = g(n30);
    const v31 = g(n31);
    const v32 = g(n32);
    const v33 = g(n33);
    const v32a = g(n32a);
    const v37 = g(n37);
    const v38 = g(n38);
    const v39a = g(n39a);
    const v40b = g(n40b);
    const v42 = g(n42);

    const v27 = v29 + v30 + v32 + v32a;
    const v28 = v31 + v33;
    const v34 = v26 + v27;
    const v35 = v28;
    const v36 = v35 - v25;
    const d = v36 - v22 + v37 - v38 - v39a;
    const v40a = d >= 0 ? d : 0;
    const v41 = d <= 0 ? -d : 0;
    const v40 = v40a - v40b;
    const v43 = v41 - v42;

    return {
      v22,
      v23,
      v23a,
      v24,
      v24a,
      v25,
      v26,
      v29,
      v30,
      v31,
      v32,
      v33,
      v32a,
      v37,
      v38,
      v39a,
      v40b,
      v40,
      v42,
      v27,
      v28,
      v34,
      v35,
      v36,
      v40a,
      v41,
      v43,
    };
  }, [
    noActivity,
    n22,
    n23,
    n23a,
    n24,
    n24a,
    n25,
    n26,
    n29,
    n30,
    n31,
    n32,
    n33,
    n32a,
    n37,
    n38,
    n39a,
    n40b,
    n42,
  ]);

  const gtgtValidations = useMemo(
    () =>
      runGtgt01Validations({
        filingFirst,
        khbs,
        nums: {
          v37: nums.v37,
          v38: nums.v38,
          v40a: nums.v40a,
          v40b: nums.v40b,
          v41: nums.v41,
          v42: nums.v42,
        },
      }),
    [filingFirst, khbs, nums.v37, nums.v38, nums.v40a, nums.v40b, nums.v41, nums.v42],
  );

  const persistSnapshots = useCallback((next: Snapshot[]) => {
    setSnapshots(next);
  }, []);

  const buildTaxPayloadWithSnapshots = useCallback(
    (sn: Snapshot[]): TaxGtgt01PersistPayload => ({
      version: TAX_GTGT01_PAYLOAD_VERSION,
      snapshots: sn,
      baselines,
      pl204ByPeriod,
      workingDrafts: periodWorkingDrafts,
    }),
    [baselines, pl204ByPeriod, periodWorkingDrafts],
  );

  const buildTaxPayload = useCallback(
    () => buildTaxPayloadWithSnapshots(snapshots),
    [buildTaxPayloadWithSnapshots, snapshots],
  );

  /** Đồng bộ từ SQLite qua API — không lưu tờ khai vào localStorage/sessionStorage. */
  React.useEffect(() => {
    if (!backendAvailable) {
      setTaxSyncReady(true);
      return;
    }
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const { payload } = await fetchTaxGtgt01Payload();
        if (cancelled) return;
        if (payload && typeof payload === 'object') {
          if (Array.isArray(payload.snapshots)) {
            setSnapshots(payload.snapshots as Snapshot[]);
          }
          if (payload.baselines && typeof payload.baselines === 'object') {
            setBaselines(payload.baselines as Gtgt01BaselineMap);
          }
          if (payload.pl204ByPeriod && typeof payload.pl204ByPeriod === 'object') {
            setPl204ByPeriod(payload.pl204ByPeriod as Record<string, Pl204AnnexFormState>);
          }
          if (payload.workingDrafts && typeof payload.workingDrafts === 'object') {
            const w = migrateLegacyGtgt01WorkingDraftKeys(payload.workingDrafts as Gtgt01WorkingDraftMap);
            setPeriodWorkingDrafts(w);
          }
        }
      } catch {
        /* offline / lỗi mạng — dữ liệu chỉ còn trong RAM phiên hiện tại */
      } finally {
        if (!cancelled) setTaxSyncReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendAvailable, hydrated, remoteTaxReloadNonce]);

  React.useEffect(() => {
    const onRemote = (e: Event) => {
      const kinds = (e as CustomEvent<{ kinds?: string[] }>).detail?.kinds;
      if (kinds?.includes('tax')) setRemoteTaxReloadNonce((n) => n + 1);
    };
    window.addEventListener('vtr:state-remote-update', onRemote);
    return () => window.removeEventListener('vtr:state-remote-update', onRemote);
  }, []);

  /** Tự lưu nháp lên SQLite sau ~4s (cùng file DB với hệ thống). */
  React.useEffect(() => {
    if (!backendAvailable || !hydrated || !taxSyncReady) return;
    const t = window.setTimeout(() => {
      void putTaxGtgt01Payload(buildTaxPayload());
    }, 4000);
    return () => window.clearTimeout(t);
  }, [backendAvailable, hydrated, taxSyncReady, buildTaxPayload]);

  const applyFromInvoices = useCallback(() => {
    const s = aggregateInvoicesForGtgt01(invoicesInFy, periodRange);
    setNoActivity(false);
    setN23(fmtInput(s.purchaseValue));
    setN24(fmtInput(s.purchaseVat));
    setN25(fmtInput(s.purchaseVat));
    setN26(fmtInput(s.salesExempt));
    setN29(fmtInput(s.v29));
    setN30(fmtInput(s.v30));
    setN31(fmtInput(s.v31));
    setN32(fmtInput(s.v32));
    setN33(fmtInput(s.v33));
    setN32a(fmtInput(s.v32a));
    setN23a('');
    setN24a('');
  }, [invoicesInFy, periodRange]);

  const invoicesInFyRef = React.useRef(invoicesInFy);
  invoicesInFyRef.current = invoicesInFy;
  const periodRangeRef = React.useRef(periodRange);
  periodRangeRef.current = periodRange;

  /** Đổi tháng/quý/năm hoặc loại kỳ: làm mới ngay [23]–[33] từ HĐ (chỉ khai lần đầu; bổ sung giữ số để chỉnh tay). */
  React.useEffect(() => {
    if (!filingFirst) return;
    if (skipAutoFromWorkingDraftRef.current === workingDraftKey) return;
    const s = aggregateInvoicesForGtgt01(invoicesInFyRef.current, periodRangeRef.current);
    setNoActivity(false);
    setN23(fmtInput(s.purchaseValue));
    setN24(fmtInput(s.purchaseVat));
    setN25(fmtInput(s.purchaseVat));
    setN26(fmtInput(s.salesExempt));
    setN29(fmtInput(s.v29));
    setN30(fmtInput(s.v30));
    setN31(fmtInput(s.v31));
    setN32(fmtInput(s.v32));
    setN33(fmtInput(s.v33));
    setN32a(fmtInput(s.v32a));
    setN23a('');
    setN24a('');
  }, [periodBaselineKey, periodKind, year, month, quarter, filingFirst, workingDraftKey]);

  const syncKhbsFromGtgt = useCallback(() => {
    const g = (s: string) => (noActivity ? 0 : parseNum(s));
    const mappings: { code: string; name: string; category: KhbsLineCategory; value: number }[] = [
      { code: '[36]', name: 'Thuế GTGT phát sinh kỳ này [36]', category: 'PAYABLE', value: nums.v36 },
      { code: '[40a]', name: 'Thuế GTGT phải nộp SXKD trong kỳ [40a]', category: 'PAYABLE', value: nums.v40a },
      { code: '[40b]', name: 'Thuế GTGT mua ĐT được bù trừ [40b]', category: 'PAYABLE', value: g(n40b) },
      { code: '[40]', name: 'Thuế GTGT còn phải nộp trong kỳ [40]', category: 'PAYABLE', value: nums.v40 },
      { code: '[25]', name: 'Thuế GTGT hàng mua vào được khấu trừ kỳ này [25]', category: 'DEDUCTIBLE', value: g(n25) },
      { code: '[22]', name: 'Thuế GTGT được khấu trừ kỳ trước chuyển sang [22]', category: 'DEDUCTIBLE', value: g(n22) },
      { code: '[41]', name: 'Thuế GTGT chưa khấu trừ hết kỳ này [41]', category: 'DEDUCTIBLE', value: nums.v41 },
      { code: '[43]', name: 'Thuế GTGT còn được khấu trừ chuyển kỳ sau [43]', category: 'DEDUCTIBLE', value: nums.v43 },
      { code: '[42]', name: 'Thuế GTGT đề nghị hoàn [42]', category: 'REFUND', value: g(n42) },
    ];
    setKhbs(prev => {
      const lines = [...prev.lines];
      for (const m of mappings) {
        const idx = lines.findIndex(l => l.itemCode.trim() === m.code);
        const adj = m.value;
        if (idx >= 0) {
          const rep = parseNum(lines[idx].reported);
          lines[idx] = {
            ...lines[idx],
            itemName: lines[idx].itemName || m.name,
            category: m.category,
            adjusted: String(adj),
            liabilityAdj: String(adj - rep),
          };
        } else {
          lines.push({
            ...newKhbsLine(m.category),
            itemCode: m.code,
            itemName: m.name,
            adjusted: String(adj),
            reported: '',
            liabilityAdj: String(adj),
          });
        }
      }
      return { ...prev, lines };
    });
  }, [noActivity, n22, n25, n40b, n42, nums]);

  const fillKhbsReportedFromBaseline = useCallback(() => {
    const rec = baselines[periodBaselineKey];
    if (!rec?.json) {
      window.alert('Chưa có bản lần đầu đã lưu cho kỳ này.');
      return;
    }
    const vals = khbsReportedAmountsFromSnapshotJson(rec.json);
    if (!vals) {
      window.alert('Không đọc được baseline.');
      return;
    }
    setKhbs(prev => ({
      ...prev,
      lines: prev.lines.map(l => {
        const code = l.itemCode.trim();
        const v = vals[code];
        if (v === undefined) return l;
        const adj = parseNum(l.adjusted);
        return { ...l, reported: String(v), liabilityAdj: String(adj - v) };
      }),
    }));
  }, [baselines, periodBaselineKey]);

  const serializeState = useCallback(
    () =>
      JSON.stringify({
        activityName,
        periodKind,
        year,
        month,
        quarter,
        filingFirst,
        supplementaryNo,
        taxpayerName,
        taxpayerTaxCode,
        agentName,
        agentTaxCode,
        agentContractNo,
        agentContractDate,
        depName,
        depTaxCode,
        depProvince,
        depDistrict,
        depWard,
        noActivity,
        n22,
        n23,
        n23a,
        n24,
        n24a,
        n25,
        n26,
        n29,
        n30,
        n31,
        n32,
        n33,
        n32a,
        n37,
        n38,
        n39a,
        n40b,
        n42,
        signerName,
        signDate,
        khbs,
        pl204Annex: pl204AnnexCurrent,
      }),
    [
      activityName,
      periodKind,
      year,
      month,
      quarter,
      filingFirst,
      supplementaryNo,
      taxpayerName,
      taxpayerTaxCode,
      agentName,
      agentTaxCode,
      agentContractNo,
      agentContractDate,
      depName,
      depTaxCode,
      depProvince,
      depDistrict,
      depWard,
      noActivity,
      n22,
      n23,
      n23a,
      n24,
      n24a,
      n25,
      n26,
      n29,
      n30,
      n31,
      n32,
      n33,
      n32a,
      n37,
      n38,
      n39a,
      n40b,
      n42,
      signerName,
      signDate,
      khbs,
      pl204AnnexCurrent,
    ],
  );

  const serializeStateRef = React.useRef(serializeState);
  serializeStateRef.current = serializeState;

  const saveWorkingDraftForCurrentKey = useCallback(() => {
    const pk = getPeriodBaselineKey(periodKind, year, month, quarter);
    const dk = getGtgt01WorkingDraftKey(pk, filingFirst, supplementaryNo);
    try {
      const json = serializeStateRef.current();
      setPeriodWorkingDrafts(prev => (prev[dk] === json ? prev : { ...prev, [dk]: json }));
    } catch {
      // ignore
    }
  }, [periodKind, year, month, quarter, filingFirst, supplementaryNo]);

  const commitPeriodKind = useCallback(
    (k: PeriodKind) => {
      if (k === periodKind) return;
      saveWorkingDraftForCurrentKey();
      setPeriodKind(k);
    },
    [periodKind, saveWorkingDraftForCurrentKey],
  );

  const commitYear = useCallback(
    (y: number) => {
      const next = Number(y) || fyYear;
      if (next === year) return;
      saveWorkingDraftForCurrentKey();
      setYear(next);
    },
    [year, fyYear, saveWorkingDraftForCurrentKey],
  );

  const commitMonth = useCallback(
    (m: number) => {
      if (m === month) return;
      saveWorkingDraftForCurrentKey();
      setMonth(m);
    },
    [month, saveWorkingDraftForCurrentKey],
  );

  const commitQuarter = useCallback(
    (q: number) => {
      if (q === quarter) return;
      saveWorkingDraftForCurrentKey();
      setQuarter(q);
    },
    [quarter, saveWorkingDraftForCurrentKey],
  );

  const loadFromJson = useCallback((json: string) => {
    try {
      const o = JSON.parse(json);
      if (typeof o.activityName === 'string') setActivityName(o.activityName);
      if (o.periodKind === 'MONTH' || o.periodKind === 'QUARTER') setPeriodKind(o.periodKind);
      if (typeof o.year === 'number') setYear(o.year);
      if (typeof o.month === 'number') setMonth(o.month);
      if (typeof o.quarter === 'number') setQuarter(o.quarter);
      if (typeof o.filingFirst === 'boolean') setFilingFirst(o.filingFirst);
      if (typeof o.supplementaryNo === 'string') setSupplementaryNo(o.supplementaryNo);
      const str = (k: string) => (typeof o[k] === 'string' ? o[k] : '');
      setTaxpayerName(str('taxpayerName'));
      setTaxpayerTaxCode(str('taxpayerTaxCode'));
      setAgentName(str('agentName'));
      setAgentTaxCode(str('agentTaxCode'));
      setAgentContractNo(str('agentContractNo'));
      setAgentContractDate(str('agentContractDate'));
      setDepName(str('depName'));
      setDepTaxCode(str('depTaxCode'));
      setDepProvince(str('depProvince'));
      setDepDistrict(str('depDistrict'));
      setDepWard(str('depWard'));
      if (typeof o.noActivity === 'boolean') setNoActivity(o.noActivity);
      setN22(str('n22'));
      setN23(str('n23'));
      setN23a(str('n23a'));
      setN24(str('n24'));
      setN24a(str('n24a'));
      setN25(str('n25'));
      setN26(str('n26'));
      setN29(str('n29'));
      setN30(str('n30'));
      setN31(str('n31'));
      setN32(str('n32'));
      setN33(str('n33'));
      setN32a(str('n32a'));
      setN37(str('n37'));
      setN38(str('n38'));
      setN39a(str('n39a'));
      setN40b(str('n40b'));
      setN42(str('n42'));
      setSignerName(str('signerName'));
      setSignDate(str('signDate'));
      if (o.khbs && typeof o.khbs === 'object') {
        const k = o.khbs as Partial<KhbsBundle>;
        setKhbs({
          ...emptyKhbsBundle(),
          ...k,
          lines: Array.isArray(k.lines) ? k.lines : [],
          distribution: Array.isArray(k.distribution) ? k.distribution : [],
          documents: Array.isArray(k.documents) ? k.documents : [],
        });
      }
      const plNorm = normalizePl204AnnexFormState((o as any).pl204Annex);
      if (plNorm && (o.periodKind === 'MONTH' || o.periodKind === 'QUARTER') && typeof o.year === 'number') {
        const pk = getPeriodBaselineKey(o.periodKind, o.year, o.month ?? 1, o.quarter ?? 1);
        setPl204ByPeriod(prev => ({ ...prev, [pk]: plNorm }));
      }
    } catch {
      window.alert('Không đọc được bản lưu.');
    }
  }, []);

  const loadFromJsonRef = React.useRef(loadFromJson);
  loadFromJsonRef.current = loadFromJson;

  const openSnapshotFromList = useCallback(
    (json: string) => {
      try {
        saveWorkingDraftForCurrentKey();
        const o = JSON.parse(json) as Record<string, unknown>;
        const kind =
          o.periodKind === 'MONTH' || o.periodKind === 'QUARTER' ? (o.periodKind as PeriodKind) : 'QUARTER';
        const y = typeof o.year === 'number' ? o.year : year;
        const mo = typeof o.month === 'number' ? o.month : month;
        const q = typeof o.quarter === 'number' ? o.quarter : quarter;
        const pk = getPeriodBaselineKey(kind, y, mo, q);
        const fk = typeof o.filingFirst === 'boolean' ? o.filingFirst : true;
        const sup = typeof o.supplementaryNo === 'string' ? o.supplementaryNo : '';
        const dk = getGtgt01WorkingDraftKey(pk, fk, sup);
        setPeriodWorkingDrafts(prev => ({ ...prev, [dk]: json }));
        skipAutoFromWorkingDraftRef.current = dk;
        prevHydratedDraftKeyRef.current = dk;
        loadFromJson(json);
        scrollToGtgt01DeclarationForm();
      } catch {
        window.alert('Không đọc được bản lưu.');
      }
    },
    [year, month, quarter, saveWorkingDraftForCurrentKey, loadFromJson],
  );

  React.useLayoutEffect(() => {
    const prevHydrated = prevHydratedDraftKeyRef.current;
    if (prevHydrated === workingDraftKey) return;
    prevHydratedDraftKeyRef.current = workingDraftKey;

    let draft = workingDraftsRef.current[workingDraftKey];
    if (!draft) draft = workingDraftsRef.current[periodBaselineKey];

    if (!draft && !filingFirst) {
      const fb = findFallbackSnapshotJsonForSupplementary(
        snapshotsForFallbackRef.current,
        periodKind,
        year,
        month,
        quarter,
        supplementaryNo,
      );
      if (fb) draft = fb;
    }

    if (draft) {
      skipAutoFromWorkingDraftRef.current = workingDraftKey;
      loadFromJsonRef.current(draft);
      setFilingFirst(filingFirst);
      setSupplementaryNo(String(supplementaryNo || ''));
    } else {
      skipAutoFromWorkingDraftRef.current = null;
      lastCarrySigRef.current = '';
    }
  }, [workingDraftKey, periodBaselineKey, filingFirst, supplementaryNo, periodKind, year, month, quarter]);

  const handleSaveSnapshot = () => {
    const json = serializeState();
    const tag = filingFirst ? 'Lần đầu' : `Bổ sung ${supplementaryNo || '?'}`;
    const label = `${periodRange.label} · ${tag}`;
    const parentSnapshotId = resolveParentSnapshotId(
      snapshots,
      periodKind,
      year,
      month,
      quarter,
      filingFirst,
      supplementaryNo,
    );
    const snap: Snapshot = {
      id: `gtgt_${Date.now()}`,
      createdAt: new Date().toISOString(),
      label,
      json,
      ...(parentSnapshotId ? { parentSnapshotId } : {}),
    };

    let nextBaselines = baselines;
    if (filingFirst) {
      const prevRec = baselines[periodBaselineKey];
      if (prevRec) {
        const dt = new Date(prevRec.savedAt).toLocaleString('vi-VN');
        const ok = window.confirm(
          `Kỳ này đã có bản lần đầu (baseline) lưu lúc ${dt}. Ghi đè baseline bằng nội dung hiện tại?\n\n(Nếu Không: vẫn lưu bản nháp vào danh sách, nhưng không đổi baseline.)`,
        );
        if (ok) {
          nextBaselines = {
            ...baselines,
            [periodBaselineKey]: { savedAt: new Date().toISOString(), json },
          };
          setBaselines(nextBaselines);
        }
      } else {
        nextBaselines = {
          ...baselines,
          [periodBaselineKey]: { savedAt: new Date().toISOString(), json },
        };
        setBaselines(nextBaselines);
      }
    }

    const nextWorkingDrafts =
      periodWorkingDrafts[periodBaselineKey] === json
        ? periodWorkingDrafts
        : { ...periodWorkingDrafts, [periodBaselineKey]: json };
    setPeriodWorkingDrafts(nextWorkingDrafts);

    const nextSnapshots = [snap, ...snapshots];
    persistSnapshots(nextSnapshots);

    const persistBody: TaxGtgt01PersistPayload = {
      version: TAX_GTGT01_PAYLOAD_VERSION,
      snapshots: nextSnapshots,
      baselines: nextBaselines,
      pl204ByPeriod,
      workingDrafts: nextWorkingDrafts,
    };
    if (backendAvailable && hydrated) void putTaxGtgt01Payload(persistBody);
  };

  const handlePrint = () => window.print();

  const handleExportExcel = () => {
    const cell = (s: string) => (noActivity ? '0' : String(parseNum(s)));
    const rows = [
      { stt: 'I', desc: 'Thuế GTGT còn được khấu trừ chuyển kỳ [22]', code: '22', col4: '', col5: cell(n22) },
      { stt: 'I', desc: 'Giá trị và thuế GTGT hàng mua [23], [24]', code: '23/24', col4: cell(n23), col5: cell(n24) },
      { stt: 'I', desc: 'Nhập khẩu [23a], [24a]', code: '23a/24a', col4: cell(n23a), col5: cell(n24a) },
      { stt: 'I', desc: 'Thuế GTGT hàng mua được khấu trừ [25]', code: '25', col4: '', col5: cell(n25) },
      { stt: 'II', desc: 'HHDV không chịu thuế [26]', code: '26', col4: cell(n26), col5: '—' },
      { stt: 'II', desc: 'Doanh thu chịu thuế [27]=[29]+[30]+[32]+[32a]', code: '27', col4: String(nums.v27), col5: '—' },
      { stt: 'II', desc: 'Thuế GTGT [28]=[31]+[33]', code: '28', col4: '—', col5: String(nums.v28) },
      { stt: 'III', desc: 'Thuế GTGT phát sinh [36]', code: '36', col4: '', col5: String(nums.v36) },
      {
        stt: 'IV',
        desc: 'Điều chỉnh tăng, giảm thuế GTGT còn được khấu trừ của các kỳ trước',
        code: '',
        col4: '',
        col5: '',
      },
      { stt: '1', desc: 'Điều chỉnh giảm thuế GTGT được khấu trừ [37]', code: '37', col4: '', col5: cell(n37) },
      { stt: '2', desc: 'Điều chỉnh tăng thuế GTGT được khấu trừ [38]', code: '38', col4: '', col5: cell(n38) },
      { stt: 'VI', desc: 'Thuế phải nộp SXKD [40a]', code: '40a', col4: '', col5: String(nums.v40a) },
      { stt: 'VI', desc: 'Thuế còn phải nộp [40]', code: '40', col4: '', col5: String(nums.v40) },
      { stt: 'VI', desc: 'Thuế chưa khấu trừ hết [41], hoàn [42], chuyển kỳ [43]', code: '41/42/43', col4: `${nums.v41}`, col5: `${cell(n42)} / ${nums.v43}` },
    ];
    void downloadGtgt01MainSheet({
      title: `${periodRange.label} · ${taxpayerName || '—'} · MST ${taxpayerTaxCode || '—'}`,
      rows,
    });
  };

  React.useEffect(() => {
    if (companyInfo.name) setTaxpayerName(companyInfo.name);
    if (companyInfo.taxCode) setTaxpayerTaxCode(companyInfo.taxCode);
  }, [companyInfo.name, companyInfo.taxCode]);

  const numCell = (value: number) => (
    <span className="block text-right font-mono text-sm tabular-nums">{formatCurrency(value)}</span>
  );

  const inputCell = (
    field: string,
    val: string,
    setVal: (s: string) => void,
    disabled?: boolean,
  ) => (
    <>
      <input
        aria-label={field}
        disabled={disabled}
        inputMode="numeric"
        className="w-full min-w-[120px] rounded border border-slate-200 px-2 py-1 text-right font-mono text-sm print:hidden disabled:bg-slate-100"
        value={formatThousandsVNFromDigits(val)}
        onChange={e => setVal(parseDigitsOnly(e.target.value))}
        placeholder="0"
      />
      <span className="hidden text-right font-mono text-sm tabular-nums print:block">
        {val ? formatCurrency(parseNum(val)) : '—'}
      </span>
    </>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2 text-purple-900">
          <FileSpreadsheet className="h-6 w-6" />
          <h2 className="text-lg font-black tracking-tight">Tờ khai thuế GTGT (Mẫu 01/GTGT)</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyFromInvoices}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black tracking-wide text-white shadow hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" /> Trích xuất từ hóa đơn
          </button>
          <button
            type="button"
            onClick={handleSaveSnapshot}
            className="inline-flex max-w-[min(100%,16rem)] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-[11px] font-black leading-tight tracking-wide text-slate-700 shadow-sm hover:bg-slate-50 sm:max-w-none sm:text-xs"
          >
            <Save className="h-4 w-4 shrink-0" /> Lưu tờ khai thuế GTGT(01/GTGT)
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black tracking-wide text-emerald-900 shadow-sm hover:bg-emerald-100"
          >
            <Download className="h-4 w-4" /> Xuất Excel
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-black tracking-wide text-white shadow hover:bg-slate-900"
          >
            <Printer className="h-4 w-4" /> In
          </button>
        </div>
      </div>

      {supplementaryFilingCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 print:hidden">
          <p className="font-bold">Tờ khai gồm hóa đơn kê khai bổ sung (khác kỳ phát sinh hoặc khác niên độ)</p>
          <p className="mt-1 text-[12px] leading-relaxed">
            Có {supplementaryFilingCount} hóa đơn neo thuế tại kỳ này trong khi chứng từ phát sinh trước đó — không sửa tờ khai đã nộp của kỳ cũ.
            Khi nộp: bổ sung / KHBS theo quy định; cùng niên độ (sổ đúng ngày HĐ) không dùng điều chỉnh 421.
          </p>
        </div>
      )}

      {supplementaryVatSuggestion.invoiceCount > 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950 print:hidden space-y-2">
          <p className="font-bold">Gợi ý điều chỉnh thuế từ HĐ bổ sung (thiếu / thừa / sai kỳ kê)</p>
          <p className="text-[12px] leading-relaxed">
            Trong kỳ <b>{periodRange.label}</b>: cộng dồn từ {supplementaryVatSuggestion.invoiceCount} hóa đơn —{' '}
            <b>[37]</b> +{formatCurrency(supplementaryVatSuggestion.ct37)} (thiếu đầu ra, khai thừa đầu vào — tăng nghĩa vụ / giảm khấu trừ);{' '}
            <b>[38]</b> +{formatCurrency(supplementaryVatSuggestion.ct38)} (thừa đầu ra, thiếu đầu vào — giảm nghĩa vụ / tăng khấu trừ).
            Mốc so sánh: thuế trước lần lưu hoặc số đã khai nếu có khóa kê khai. Chỉ tiêu <b>[40]</b> cập nhật khi đổi [37]/[38].
          </p>
          {supplementaryVatSuggestion.ct37 + supplementaryVatSuggestion.ct38 > 50_000_000 && (
            <p className="text-[11px] font-semibold text-rose-700">
              Tổng điều chỉnh lớn — kiểm tra rủi ro thanh tra / đối chiếu với tờ khai đã nộp.
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-[11px] text-violet-900">
            <span>
              Phần [23]–[33] từ HĐ chỉ bổ sung: mua {formatCurrency(supplementarySliceAgg.purchaseValue)} / thuế mua{' '}
              {formatCurrency(supplementarySliceAgg.purchaseVat)} · bán (nhóm 10%){' '}
              {formatCurrency(supplementarySliceAgg.v32)} / thuế {formatCurrency(supplementarySliceAgg.v33)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              const sum = supplementaryVatSuggestion.ct37 + supplementaryVatSuggestion.ct38;
              if (sum <= 0) return;
              if (!window.confirm('Cộng giá trị gợi ý vào [37] và [38] hiện tại (cộng thêm vào số đang nhập)?')) return;
              applySupplementaryCt37Ct38();
            }}
            className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-violet-800"
          >
            Cộng gợi ý vào [37] / [38]
          </button>
          {supplementaryVatSuggestion.detail.length > 0 && (
            <ul className="max-h-24 overflow-y-auto text-[10px] list-disc pl-4 text-violet-900/90">
              {supplementaryVatSuggestion.detail.slice(0, 12).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {snapshots.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 print:hidden">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
            <FolderOpen className="h-4 w-4" /> Bản nháp đã lưu
            {backendAvailable ? ' (SQLite — máy chủ)' : ' (chưa kết nối API — chỉ trong phiên, F5 sẽ mất nếu chưa đồng bộ)'}
          </div>
          <ul className="max-h-32 space-y-1 overflow-y-auto text-sm">
            {snapshots.map(s => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5">
                <span className="truncate font-medium text-slate-700">{s.label}</span>
                <span className="shrink-0 text-[10px] text-slate-400">
                  {new Date(s.createdAt).toLocaleString('vi-VN')}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-xs font-bold text-blue-600 hover:underline"
                  onClick={() => openSnapshotFromList(s.json)}
                >
                  Mở
                </button>
                <button
                  type="button"
                  className="shrink-0 text-rose-600"
                  title="Xóa"
                  onClick={() => {
                    const next = snapshots.filter(x => x.id !== s.id);
                    persistSnapshots(next);
                    if (backendAvailable && hydrated) {
                      void putTaxGtgt01Payload(buildTaxPayloadWithSnapshots(next));
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        id={GTGT01_FORM_SCROLL_ID}
        tabIndex={-1}
        className="gtgt01-declaration-print scroll-mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm outline-none"
      >
        <header className="border-b border-slate-200 pb-4 text-center">
          <h1 className="text-base font-black uppercase leading-snug text-slate-900">
            Tờ khai thuế giá trị gia tăng (Mẫu số 01/GTGT)
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            (Áp dụng đối với người nộp thuế tính thuế theo phương pháp khấu trừ)
          </p>
        </header>

        <div className="mt-4 space-y-4 text-sm print:hidden">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-400">[01a] Tên HĐSXKD</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={activityName}
                onChange={e => setActivityName(e.target.value)}
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-black uppercase text-slate-400">Kỳ kê khai</span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-bold"
                  value={periodKind}
                  onChange={e => commitPeriodKind(e.target.value as PeriodKind)}
                >
                  <option value="MONTH">Theo tháng</option>
                  <option value="QUARTER">Theo quý</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase text-slate-400">[01b] Kỳ tính thuế</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  <input
                    type="number"
                    className="w-24 rounded-lg border border-slate-200 px-2 py-2 text-center font-mono font-bold"
                    value={year}
                    onChange={e => commitYear(Number(e.target.value) || fyYear)}
                    min={2000}
                    max={2100}
                  />
                  {periodKind === 'MONTH' ? (
                    <select
                      className="flex-1 rounded-lg border border-slate-200 px-2 py-2 font-bold"
                      value={month}
                      onChange={e => commitMonth(Number(e.target.value))}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                        <option key={m} value={m}>
                          Tháng {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="flex-1 rounded-lg border border-slate-200 px-2 py-2 font-bold"
                      value={quarter}
                      onChange={e => commitQuarter(Number(e.target.value))}
                    >
                      {[1, 2, 3, 4].map(q => (
                        <option key={q} value={q}>
                          Quý {q}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="mt-1 text-[11px] font-bold text-blue-700">{periodRange.label}</p>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <label className="flex cursor-pointer items-center gap-2 font-bold">
              <input
                type="radio"
                checked={filingFirst}
                onChange={() => {
                  if (!filingFirst) {
                    saveWorkingDraftForCurrentKey();
                    setFilingFirst(true);
                    setSupplementaryNo('');
                  }
                }}
              />
              [02] Lần đầu
            </label>
            <label className="flex cursor-pointer items-center gap-2 font-bold">
              <input
                type="radio"
                checked={!filingFirst}
                onChange={() => {
                  if (filingFirst) {
                    saveWorkingDraftForCurrentKey();
                    setFilingFirst(false);
                  }
                }}
              />
              [03] Bổ sung lần thứ
            </label>
            <input
              type="number"
              min={1}
              disabled={filingFirst}
              placeholder="Số thứ tự"
              className="w-28 rounded border border-slate-200 px-2 py-1 text-center disabled:bg-slate-200"
              value={supplementaryNo}
              onChange={e => setSupplementaryNo(e.target.value)}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-400">[04] Tên người nộp thuế</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-bold uppercase"
                value={taxpayerName}
                onChange={e => setTaxpayerName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-400">[05] Mã số thuế</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                value={taxpayerTaxCode}
                onChange={e => setTaxpayerTaxCode(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-400">[06] Tên đại lý thuế (nếu có)</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-400">[07] MST đại lý thuế</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                value={agentTaxCode}
                onChange={e => setAgentTaxCode(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-400">[08] Hợp đồng ĐLT — Số</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={agentContractNo}
                onChange={e => setAgentContractNo(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-400">[08] Ngày</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={agentContractDate}
                onChange={e => setAgentContractDate(e.target.value)}
              />
            </label>
          </div>

          <div className="rounded-lg border border-dashed border-slate-200 p-3">
            <p className="mb-2 text-[10px] font-black uppercase text-slate-400">Đơn vị phụ thuộc / ĐĐKD (nếu có)</p>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                placeholder="[09] Tên ĐVPT / địa điểm KD"
                className="rounded-lg border border-slate-200 px-3 py-2 md:col-span-2"
                value={depName}
                onChange={e => setDepName(e.target.value)}
              />
              <input
                placeholder="[10] MST ĐVPT / mã địa điểm KD"
                className="rounded-lg border border-slate-200 px-3 py-2 font-mono"
                value={depTaxCode}
                onChange={e => setDepTaxCode(e.target.value)}
              />
              <div className="grid grid-cols-3 gap-2 md:col-span-2">
                <input
                  placeholder="[11c] Tỉnh/TP"
                  className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  value={depProvince}
                  onChange={e => setDepProvince(e.target.value)}
                />
                <input
                  placeholder="[11b] Quận/Huyện"
                  className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  value={depDistrict}
                  onChange={e => setDepDistrict(e.target.value)}
                />
                <input
                  placeholder="[11a] Xã/Phường"
                  className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  value={depWard}
                  onChange={e => setDepWard(e.target.value)}
                />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-bold text-amber-900">
            <input type="checkbox" checked={noActivity} onChange={e => setNoActivity(e.target.checked)} />
            [21] Không phát sinh hoạt động mua, bán trong kỳ
          </label>

          {prevPeriodNetCarry && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/80 p-3 text-xs text-indigo-950 print:hidden">
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-indigo-800">
                Bảng kê điều chỉnh chuyển kỳ (kỳ {prevPeriodNetCarry.prevLabel} → kỳ {periodRange.label})
              </p>
              <table className="w-full border-collapse text-left text-[11px]">
                <thead>
                  <tr className="border-b border-indigo-200 font-black text-indigo-900">
                    <th className="py-1 pr-2">Nội dung</th>
                    <th className="py-1 text-right">Số tiền</th>
                  </tr>
                </thead>
                <tbody className="font-medium">
                  <tr className="border-b border-indigo-100">
                    <td className="py-1 pr-2">[43] tờ khai lần đầu kỳ trước (chốt)</td>
                    <td className="py-1 text-right font-mono tabular-nums">{formatCurrency(prevPeriodNetCarry.v43First)}</td>
                  </tr>
                  <tr className="border-b border-indigo-100">
                    <td className="py-1 pr-2">[43] sau bổ sung mới nhất cùng kỳ (nếu có)</td>
                    <td className="py-1 text-right font-mono tabular-nums">{formatCurrency(prevPeriodNetCarry.v43Latest)}</td>
                  </tr>
                  <tr className="border-b border-indigo-200 font-black">
                    <td className="py-1 pr-2">Chênh lệch Δ = Target [43] − Base [43]</td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {formatCurrency(prevPeriodNetCarry.v43Latest - prevPeriodNetCarry.v43First)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-2 pt-2" colSpan={2}>
                      Hệ thống gán:{' '}
                      {prevPeriodNetCarry.adj37 > 0 && (
                        <span>
                          [37] = {formatCurrency(prevPeriodNetCarry.adj37)} (giảm khấu trừ); [38] = 0.
                        </span>
                      )}
                      {prevPeriodNetCarry.adj38 > 0 && (
                        <span>
                          [38] = {formatCurrency(prevPeriodNetCarry.adj38)} (tăng khấu trừ); [37] = 0.
                        </span>
                      )}
                      {prevPeriodNetCarry.adj37 === 0 && prevPeriodNetCarry.adj38 === 0 && (
                        <span>[37] = 0; [38] = 0.</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-[10px] font-bold leading-snug text-indigo-800">
                [22] kỳ này luôn bằng [43] lần đầu kỳ trước — ô [22] bị khóa khi có đủ dữ liệu baseline. Sai sót làm tăng
                thuế phải nộp [40] xử lý theo quy định (không đưa vào [37]/[38]).
              </p>
            </div>
          )}

          {gtgtValidations.length > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 print:hidden">
              <ul className="space-y-1.5 text-sm font-bold text-rose-900">
                {gtgtValidations.map(v => (
                  <li key={v.id}>{v.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* In ấn: tóm tắt kỳ + NNT */}
        <div className="mt-4 hidden text-sm leading-relaxed print:block">
          <p>
            <b>Kỳ tính thuế:</b> {periodRange.label}
            {filingFirst ? ' — Lần đầu' : ` — Bổ sung lần thứ ${supplementaryNo || '…'}`}
          </p>
          <p>
            <b>Người nộp thuế:</b> {taxpayerName} — <b>MST:</b> {taxpayerTaxCode}
          </p>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="gtgt01-gtgt-table w-full min-w-[720px] border-collapse border border-slate-300 text-sm [&_thead>tr>th:first-child]:w-12 [&_thead>tr>th:first-child]:text-center [&_thead>tr>th:first-child]:align-middle [&_tbody>tr>td:first-child]:w-11 [&_tbody>tr>td:first-child]:min-w-[2.75rem] [&_tbody>tr>td:first-child]:text-center [&_tbody>tr>td:first-child]:align-middle [&_tbody>tr>td:first-child]:tabular-nums">
            <thead>
              <tr className="bg-slate-100 text-left text-[10px] font-black uppercase">
                <th className="border border-slate-300 px-2 py-2">STT</th>
                <th className="border border-slate-300 px-2 py-2">Chỉ tiêu</th>
                <th className="border border-slate-300 px-2 py-2 w-14">Mã</th>
                <th className="border border-slate-300 px-2 py-2 w-36">Giá trị HHDV (chưa thuế)</th>
                <th className="border border-slate-300 px-2 py-2 w-36">Thuế GTGT</th>
              </tr>
            </thead>
            <tbody className="text-xs">
              <tr>
                <td className="border border-slate-300 px-2 font-bold">A</td>
                <td className="border border-slate-300 px-2">Chỉ tiêu [21]</td>
                <td className="border border-slate-300 px-2 text-center">21</td>
                <td className="border border-slate-300 px-2" colSpan={2}>
                  <span className="print:hidden">Xem ô kiểm phía trên</span>
                  <span className="hidden print:inline">{noActivity ? 'Có' : 'Không'}</span>
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2 font-bold">B</td>
                <td className="border border-slate-300 px-2">Thuế GTGT được khấu trừ kỳ trước chuyển sang [22]</td>
                <td className="border border-slate-300 px-2 text-center">22</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2 align-top">
                  {inputCell('22', n22, setN22, noActivity || lockN22FromPrevPeriod)}
                </td>
              </tr>
              <tr className="bg-slate-50 font-bold">
                <td className="border border-slate-300 px-2 font-bold">C</td>
                <td className="border border-slate-300 px-2 font-bold" colSpan={4}>
                  Kê khai thuế giá trị gia tăng phải nộp ngân sách nhà nước
                </td>
              </tr>
              <tr className="bg-emerald-50/40">
                <td className="border border-slate-300 px-2 font-bold">I</td>
                <td className="border border-slate-300 px-2 font-bold" colSpan={4}>
                  Hàng hóa, dịch vụ mua vào
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">1</td>
                <td className="border border-slate-300 px-2">Giá trị và thuế GTGT hàng mua vào [23], [24]</td>
                <td className="border border-slate-300 px-2 text-center">23 / 24</td>
                <td className="border border-slate-300 px-2">
                  {inputCell('23', n23, setN23, noActivity)}
                </td>
                <td className="border border-slate-300 px-2">
                  {inputCell('24', n24, setN24, noActivity)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">a</td>
                <td className="border border-slate-300 px-2">Trong đó: hàng nhập khẩu [23a], [24a]</td>
                <td className="border border-slate-300 px-2 text-center">23a/24a</td>
                <td className="border border-slate-300 px-2">
                  {inputCell('23a', n23a, setN23a, noActivity)}
                </td>
                <td className="border border-slate-300 px-2">
                  {inputCell('24a', n24a, setN24a, noActivity)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">2</td>
                <td className="border border-slate-300 px-2">Thuế GTGT hàng mua vào được khấu trừ kỳ này [25]</td>
                <td className="border border-slate-300 px-2 text-center">25</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">
                  {inputCell('25', n25, setN25, noActivity)}
                </td>
              </tr>
              <tr className="bg-blue-50/40">
                <td className="border border-slate-300 px-2 font-bold">II</td>
                <td className="border border-slate-300 px-2 font-bold" colSpan={4}>
                  Hàng hóa, dịch vụ bán ra
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">1</td>
                <td className="border border-slate-300 px-2">HHDV không chịu thuế GTGT [26]</td>
                <td className="border border-slate-300 px-2 text-center">26</td>
                <td className="border border-slate-300 px-2">
                  {inputCell('26', n26, setN26, noActivity)}
                </td>
                <td className="border border-slate-300 px-2 text-slate-400">—</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">2</td>
                <td className="border border-slate-300 px-2">
                  Tổng doanh thu và thuế GTGT của HHDV chịu thuế [27]=[29]+[30]+[32]+[32a], [28]=[31]+[33]
                </td>
                <td className="border border-slate-300 px-2 text-center">27 / 28</td>
                <td className="border border-slate-300 px-2">{numCell(nums.v27)}</td>
                <td className="border border-slate-300 px-2">{numCell(nums.v28)}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">a</td>
                <td className="border border-slate-300 px-2">Thuế suất 0% (doanh thu [29], không phát sinh thuế GTGT đầu ra ở cột 5)</td>
                <td className="border border-slate-300 px-2 text-center">29</td>
                <td className="border border-slate-300 px-2">
                  {inputCell('29', n29, setN29, noActivity)}
                </td>
                <td className="border border-slate-300 px-2 text-center text-slate-400">—</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">b</td>
                <td className="border border-slate-300 px-2">Thuế suất 5% [30], [31]</td>
                <td className="border border-slate-300 px-2 text-center">30/31</td>
                <td className="border border-slate-300 px-2">
                  {inputCell('30', n30, setN30, noActivity)}
                </td>
                <td className="border border-slate-300 px-2">
                  {inputCell('31', n31, setN31, noActivity)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">c</td>
                <td className="border border-slate-300 px-2">Thuế suất 10% [32], [33]</td>
                <td className="border border-slate-300 px-2 text-center">32/33</td>
                <td className="border border-slate-300 px-2">
                  {inputCell('32', n32, setN32, noActivity)}
                </td>
                <td className="border border-slate-300 px-2">
                  {inputCell('33', n33, setN33, noActivity)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">d</td>
                <td className="border border-slate-300 px-2">HHDV không tính thuế [32a]</td>
                <td className="border border-slate-300 px-2 text-center">32a</td>
                <td className="border border-slate-300 px-2">
                  {inputCell('32a', n32a, setN32a, noActivity)}
                </td>
                <td className="border border-slate-300 px-2 text-slate-400">—</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">3</td>
                <td className="border border-slate-300 px-2">Tổng doanh thu tất cả HHDV bán ra [34], [35]</td>
                <td className="border border-slate-300 px-2 text-center">34/35</td>
                <td className="border border-slate-300 px-2">{numCell(nums.v34)}</td>
                <td className="border border-slate-300 px-2">{numCell(nums.v35)}</td>
              </tr>
              <tr className="bg-purple-50/30">
                <td className="border border-slate-300 px-2 font-bold">III</td>
                <td className="border border-slate-300 px-2">Thuế GTGT phát sinh kỳ này [36]=[35]-[25]</td>
                <td className="border border-slate-300 px-2 text-center">36</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">{numCell(nums.v36)}</td>
              </tr>
              <tr className="bg-amber-50/40">
                <td className="border border-slate-300 px-2 font-bold">IV</td>
                <td className="border border-slate-300 px-2 font-bold" colSpan={4}>
                  Điều chỉnh tăng, giảm thuế giá trị gia tăng còn được khấu trừ của các kỳ trước
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">1</td>
                <td className="border border-slate-300 px-2">Điều chỉnh giảm thuế GTGT được khấu trừ [37]</td>
                <td className="border border-slate-300 px-2 text-center">37</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">{inputCell('37', n37, setN37, noActivity)}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">2</td>
                <td className="border border-slate-300 px-2">Điều chỉnh tăng thuế GTGT được khấu trừ [38]</td>
                <td className="border border-slate-300 px-2 text-center">38</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">{inputCell('38', n38, setN38, noActivity)}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2 font-bold">V</td>
                <td className="border border-slate-300 px-2">Thuế GTGT được khấu trừ chuyển đến [39a]</td>
                <td className="border border-slate-300 px-2 text-center">39a</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">{inputCell('39a', n39a, setN39a, noActivity)}</td>
              </tr>
              <tr className="bg-slate-100 font-bold">
                <td className="border border-slate-300 px-2">VI</td>
                <td className="border border-slate-300 px-2 font-bold">
                  Xác định nghĩa vụ thuế giá trị gia tăng phải nộp trong kỳ:
                </td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2" />
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">1</td>
                <td className="border border-slate-300 px-2">
                  Thuế giá trị gia tăng phải nộp của hoạt động sản xuất kinh doanh trong kỳ{' '}
                  <span className="whitespace-normal">
                    {'{[40a]=([36]-[22]+[37]-[38]-[39a]) ≥ 0}'}
                  </span>
                </td>
                <td className="border border-slate-300 px-2 text-center font-mono text-[11px]">[40a]</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">{numCell(nums.v40a)}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">2</td>
                <td className="border border-slate-300 px-2">
                  Thuế giá trị gia tăng mua vào của dự án đầu tư được bù trừ với thuế GTGT còn phải nộp của hoạt động
                  sản xuất kinh doanh cùng kỳ tính thuế ([40b]≤[40a])
                </td>
                <td className="border border-slate-300 px-2 text-center font-mono text-[11px]">[40b]</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">{inputCell('40b', n40b, setN40b, noActivity)}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">3</td>
                <td className="border border-slate-300 px-2">
                  Thuế giá trị gia tăng còn phải nộp trong kỳ ([40]=[40a]-[40b])
                </td>
                <td className="border border-slate-300 px-2 text-center font-mono text-[11px]">[40]</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">{numCell(nums.v40)}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">4</td>
                <td className="border border-slate-300 px-2">
                  Thuế giá trị gia tăng chưa khấu trừ hết kỳ này{' '}
                  <span className="whitespace-normal">{'{[41]=([36]-[22]+[37]-[38]-[39a]) ≤ 0}'}</span>
                </td>
                <td className="border border-slate-300 px-2 text-center font-mono text-[11px]">[41]</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">{numCell(nums.v41)}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">4.1</td>
                <td className="border border-slate-300 px-2">Thuế giá trị gia tăng đề nghị hoàn ([42] ≤ [41])</td>
                <td className="border border-slate-300 px-2 text-center font-mono text-[11px]">[42]</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">{inputCell('42', n42, setN42, noActivity)}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2">4.2</td>
                <td className="border border-slate-300 px-2">
                  Thuế giá trị gia tăng còn được khấu trừ chuyển kỳ sau ([43]=[41]-[42])
                </td>
                <td className="border border-slate-300 px-2 text-center font-mono text-[11px]">[43]</td>
                <td className="border border-slate-300 px-2" />
                <td className="border border-slate-300 px-2">{numCell(nums.v43)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid gap-4 border-t border-slate-200 pt-4 print:block">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-[10px] font-black uppercase text-slate-400">Người ký</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={signerName}
                onChange={e => setSignerName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-[10px] font-black uppercase text-slate-400">Ngày ký</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={signDate}
                onChange={e => setSignDate(e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-teal-100 bg-teal-50/20 p-4 print:border-slate-200">
        <p className="mb-3 text-center text-[10px] font-black uppercase tracking-wide text-teal-900 print:hidden">
          Phụ lục kèm tờ khai (ưu đãi giảm thuế GTGT — theo từng kỳ kê khai)
        </p>
        <VatPl204ReductionAnnex
          invoices={invoices}
          companyInfo={companyInfo}
          financialYear={financialYear}
          linkedMode={{
            periodKind,
            year,
            month,
            quarter,
            periodRange,
            taxpayerName,
            taxpayerTaxCode,
            annexState: pl204AnnexCurrent,
            onAnnexChange: setPl204AnnexCurrent,
          }}
        />
      </div>

      {!filingFirst && (
        <VatKhbsSupplementarySection
          khbs={khbs}
          setKhbs={setKhbs}
          periodLabel={periodRange.label}
          supplementaryNo={supplementaryNo}
          taxpayerName={taxpayerName}
          taxpayerTaxCode={taxpayerTaxCode}
          setTaxpayerName={setTaxpayerName}
          setTaxpayerTaxCode={setTaxpayerTaxCode}
          agentName={agentName}
          agentTaxCode={agentTaxCode}
          agentContractNo={agentContractNo}
          agentContractDate={agentContractDate}
          setAgentName={setAgentName}
          setAgentTaxCode={setAgentTaxCode}
          setAgentContractNo={setAgentContractNo}
          setAgentContractDate={setAgentContractDate}
          onSyncAdjustedFromMain={syncKhbsFromGtgt}
          hasFirstFilingBaseline={Boolean(baselineForPeriod)}
          onFillKhbsReportedFromBaseline={fillKhbsReportedFromBaseline}
        />
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
          @media print {
            @page { size: A4 landscape; margin: 12mm; }
            .gtgt01-declaration-print .rounded-xl { box-shadow: none !important; border: 1px solid #ccc !important; }
            .gtgt01-declaration-print table.gtgt01-gtgt-table td { font-size: 10px !important; vertical-align: top !important; }
            .gtgt01-declaration-print table.gtgt01-gtgt-table td:first-child { vertical-align: middle !important; text-align: center !important; }
          }
        `,
        }}
      />
    </div>
  );
};
