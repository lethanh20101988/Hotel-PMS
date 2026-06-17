import { Prisma, PrismaClient } from "@prisma/client";

type JsonRecord = Record<string, unknown>;

type OpeningBalanceAccountState = {
  accountCode: string;
  debit: number;
  credit: number;
  originMode?: string;
  readOnly?: boolean;
  lockReason?: string;
};

type OpeningBalanceDebtState = {
  id: string;
  kind: "CUSTOMER_DEBT" | "SUPPLIER_DEBT";
  accountCode: "131" | "331";
  partnerId?: string;
  partnerCode?: string;
  partnerName: string;
  invoiceNo: string;
  revenueType: string;
  amount: number;
  dueDate?: string;
  note?: string;
  sourceInvoiceId?: string;
  sourceInvoiceNumber?: string;
  sourceInvoiceDate?: string;
  sourceYearKey?: string;
  openingYearKey?: string;
  originMode?: string;
  readOnly?: boolean;
  lockReason?: string;
  syncStatus?: string;
};

type OpeningBalanceRolloverMetaState = {
  sourceYearKey: string;
  generatedAt: string;
  lockedAccountCodes?: string[];
  lockedDebtKinds?: string[];
};

type OpeningSqlYearPayload = {
  openingBalanceAccounts: OpeningBalanceAccountState[];
  openingBalanceDebts: OpeningBalanceDebtState[];
  openingBalanceRolloverMeta?: OpeningBalanceRolloverMetaState;
};

type OpeningBalancesApiYearPayload = {
  openingBalanceAccounts: OpeningBalanceAccountState[];
  openingBalanceRolloverMeta?: OpeningBalanceRolloverMetaState;
};

type OpeningBalancesApiPayload = {
  byYearKey: Record<string, OpeningBalancesApiYearPayload>;
};

type DebtDetailsApiPayload = {
  byYearKey: Record<string, OpeningBalanceDebtState[]>;
};

const ACTIVE_OPENING_FIELDS = [
  "openingBalanceAccounts",
  "openingBalanceDebts",
  "openingBalanceRolloverMeta",
] as const;

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toSafeNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
};

const toMoneyBigInt = (value: unknown) => BigInt(toSafeNumber(value));

const fromDbMoney = (value: bigint | number | null | undefined) =>
  value == null ? 0 : Number(value);

const normalizeAccountCode = (value: unknown) => String(value || "").trim();

const normalizeOpeningBalanceAccount = (raw: unknown): OpeningBalanceAccountState | null => {
  if (!isRecord(raw)) return null;
  const accountCode = normalizeAccountCode(raw.accountCode ?? raw.account);
  if (!accountCode) return null;
  return {
    accountCode,
    debit: Math.max(0, toSafeNumber(raw.debit)),
    credit: Math.max(0, toSafeNumber(raw.credit)),
    originMode: String(raw.originMode || "MANUAL"),
    readOnly: Boolean(raw.readOnly),
    lockReason: raw.lockReason != null && String(raw.lockReason).trim() ? String(raw.lockReason).trim() : undefined,
  };
};

const normalizeOpeningBalanceAccounts = (raw: unknown): OpeningBalanceAccountState[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeOpeningBalanceAccount(item))
    .filter((item): item is OpeningBalanceAccountState => Boolean(item))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
};

const normalizeDebtKind = (value: unknown): "CUSTOMER_DEBT" | "SUPPLIER_DEBT" =>
  value === "SUPPLIER_DEBT" ? "SUPPLIER_DEBT" : "CUSTOMER_DEBT";

const normalizeOpeningBalanceDebt = (raw: unknown): OpeningBalanceDebtState | null => {
  if (!isRecord(raw)) return null;
  const id = String(raw.id || "").trim();
  const partnerName = String(raw.partnerName || "").trim();
  const invoiceNo = String(raw.invoiceNo || "").trim();
  if (!id || !partnerName) return null;
  return {
    id,
    kind: normalizeDebtKind(raw.kind),
    accountCode: raw.accountCode === "331" ? "331" : "131",
    partnerId: raw.partnerId != null && String(raw.partnerId).trim() ? String(raw.partnerId).trim() : undefined,
    partnerCode: raw.partnerCode != null && String(raw.partnerCode).trim() ? String(raw.partnerCode).trim() : undefined,
    partnerName,
    invoiceNo,
    revenueType: String(raw.revenueType || "KHAC"),
    amount: Math.max(0, toSafeNumber(raw.amount)),
    dueDate: raw.dueDate != null && String(raw.dueDate).trim() ? String(raw.dueDate).split("T")[0] : undefined,
    note: raw.note != null && String(raw.note).trim() ? String(raw.note).trim() : undefined,
    sourceInvoiceId:
      raw.sourceInvoiceId != null && String(raw.sourceInvoiceId).trim() ? String(raw.sourceInvoiceId).trim() : undefined,
    sourceInvoiceNumber:
      raw.sourceInvoiceNumber != null && String(raw.sourceInvoiceNumber).trim()
        ? String(raw.sourceInvoiceNumber).trim()
        : undefined,
    sourceInvoiceDate:
      raw.sourceInvoiceDate != null && String(raw.sourceInvoiceDate).trim()
        ? String(raw.sourceInvoiceDate).split("T")[0]
        : undefined,
    sourceYearKey:
      raw.sourceYearKey != null && String(raw.sourceYearKey).trim() ? String(raw.sourceYearKey).trim() : undefined,
    openingYearKey:
      raw.openingYearKey != null && String(raw.openingYearKey).trim() ? String(raw.openingYearKey).trim() : undefined,
    originMode: String(raw.originMode || "MANUAL"),
    readOnly: Boolean(raw.readOnly),
    lockReason: raw.lockReason != null && String(raw.lockReason).trim() ? String(raw.lockReason).trim() : undefined,
    syncStatus: String(raw.syncStatus || "MATCHED"),
  };
};

const normalizeOpeningBalanceDebts = (raw: unknown): OpeningBalanceDebtState[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeOpeningBalanceDebt(item))
    .filter((item): item is OpeningBalanceDebtState => Boolean(item));
};

const normalizeOpeningBalanceRolloverMeta = (raw: unknown): OpeningBalanceRolloverMetaState | undefined => {
  if (!isRecord(raw)) return undefined;
  const sourceYearKey = String(raw.sourceYearKey || "").trim();
  if (!sourceYearKey) return undefined;
  return {
    sourceYearKey,
    generatedAt: String(raw.generatedAt || new Date().toISOString()),
    lockedAccountCodes: Array.isArray(raw.lockedAccountCodes)
      ? raw.lockedAccountCodes.map((item) => String(item || "").trim()).filter(Boolean)
      : undefined,
    lockedDebtKinds: Array.isArray(raw.lockedDebtKinds)
      ? raw.lockedDebtKinds.map((item) => String(item || "").trim()).filter(Boolean)
      : undefined,
  };
};

const sumDebtByKind = (rows: OpeningBalanceDebtState[], kind: "CUSTOMER_DEBT" | "SUPPLIER_DEBT") =>
  rows.filter((row) => row.kind === kind).reduce((sum, row) => sum + toSafeNumber(row.amount), 0);

const syncOpeningBalanceAccountsFromDebt = (
  accounts: OpeningBalanceAccountState[],
  debts: OpeningBalanceDebtState[],
): OpeningBalanceAccountState[] => {
  const map = new Map<string, OpeningBalanceAccountState>();
  for (const row of accounts) {
    map.set(row.accountCode, { ...row });
  }

  const customerRows = debts.filter((row) => row.kind === "CUSTOMER_DEBT");
  const supplierRows = debts.filter((row) => row.kind === "SUPPLIER_DEBT");

  if (customerRows.length > 0 || map.has("131")) {
    const existing = map.get("131");
    map.set("131", {
      accountCode: "131",
      debit: sumDebtByKind(debts, "CUSTOMER_DEBT"),
      credit: 0,
      originMode: existing?.originMode || (customerRows.some((row) => row.originMode === "ROLLOVER") ? "ROLLOVER" : "SYNC_FROM_DEBT"),
      readOnly: existing?.readOnly || customerRows.some((row) => row.readOnly),
      lockReason: existing?.lockReason || customerRows.find((row) => row.lockReason)?.lockReason,
    });
  }

  if (supplierRows.length > 0 || map.has("331")) {
    const existing = map.get("331");
    map.set("331", {
      accountCode: "331",
      debit: 0,
      credit: sumDebtByKind(debts, "SUPPLIER_DEBT"),
      originMode: existing?.originMode || (supplierRows.some((row) => row.originMode === "ROLLOVER") ? "ROLLOVER" : "SYNC_FROM_DEBT"),
      readOnly: existing?.readOnly || supplierRows.some((row) => row.readOnly),
      lockReason: existing?.lockReason || supplierRows.find((row) => row.lockReason)?.lockReason,
    });
  }

  return Array.from(map.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
};

const getActiveYearKey = (state: JsonRecord) => {
  if (typeof state.activeYearKey === "string" && state.activeYearKey.trim()) return state.activeYearKey;
  if (isRecord(state.financialYear)) {
    const startDate = String(state.financialYear.startDate || "").trim();
    const endDate = String(state.financialYear.endDate || "").trim();
    if (startDate && endDate) return `${startDate}..${endDate}`;
  }
  return "";
};

const extractOpeningSqlPayloadFromState = (rawState: unknown): Record<string, OpeningSqlYearPayload> => {
  const state = isRecord(rawState) ? rawState : {};
  const out: Record<string, OpeningSqlYearPayload> = {};
  const yearDataByKey = isRecord(state.yearDataByKey) ? state.yearDataByKey : {};

  for (const [yearKey, bucket] of Object.entries(yearDataByKey)) {
    if (!isRecord(bucket)) continue;
    out[yearKey] = {
      openingBalanceAccounts: syncOpeningBalanceAccountsFromDebt(
        normalizeOpeningBalanceAccounts(bucket.openingBalanceAccounts),
        normalizeOpeningBalanceDebts(bucket.openingBalanceDebts),
      ),
      openingBalanceDebts: normalizeOpeningBalanceDebts(bucket.openingBalanceDebts),
      openingBalanceRolloverMeta: normalizeOpeningBalanceRolloverMeta(bucket.openingBalanceRolloverMeta),
    };
  }

  const activeYearKey = getActiveYearKey(state);
  if (activeYearKey) {
    const current = out[activeYearKey] || {
      openingBalanceAccounts: [],
      openingBalanceDebts: [],
      openingBalanceRolloverMeta: undefined,
    };
    const rootAccounts = normalizeOpeningBalanceAccounts(state.openingBalanceAccounts);
    const rootDebts = normalizeOpeningBalanceDebts(state.openingBalanceDebts);
    out[activeYearKey] = {
      openingBalanceAccounts: syncOpeningBalanceAccountsFromDebt(
        current.openingBalanceAccounts.length > 0 ? current.openingBalanceAccounts : rootAccounts,
        current.openingBalanceDebts.length > 0 ? current.openingBalanceDebts : rootDebts,
      ),
      openingBalanceDebts: current.openingBalanceDebts.length > 0 ? current.openingBalanceDebts : rootDebts,
      openingBalanceRolloverMeta:
        current.openingBalanceRolloverMeta || normalizeOpeningBalanceRolloverMeta(state.openingBalanceRolloverMeta),
    };
  }

  return out;
};

const extractOpeningBalancesApiPayload = (rawPayload: unknown): OpeningBalancesApiPayload => {
  const payload = isRecord(rawPayload) ? rawPayload : {};
  const byYearKey = isRecord(payload.byYearKey) ? payload.byYearKey : {};
  const out: Record<string, OpeningBalancesApiYearPayload> = {};

  for (const [yearKey, bucket] of Object.entries(byYearKey)) {
    const record = isRecord(bucket) ? bucket : {};
    out[yearKey] = {
      openingBalanceAccounts: normalizeOpeningBalanceAccounts(record.openingBalanceAccounts),
      openingBalanceRolloverMeta: normalizeOpeningBalanceRolloverMeta(record.openingBalanceRolloverMeta),
    };
  }

  return { byYearKey: out };
};

const extractDebtDetailsApiPayload = (rawPayload: unknown): DebtDetailsApiPayload => {
  const payload = isRecord(rawPayload) ? rawPayload : {};
  const byYearKey = isRecord(payload.byYearKey) ? payload.byYearKey : {};
  const out: Record<string, OpeningBalanceDebtState[]> = {};

  for (const [yearKey, rows] of Object.entries(byYearKey)) {
    out[yearKey] = normalizeOpeningBalanceDebts(rows);
  }

  return { byYearKey: out };
};

export const stripOpeningSqlState = (rawState: unknown) => {
  const state = cloneJson(isRecord(rawState) ? rawState : {}) as JsonRecord;
  for (const field of ACTIVE_OPENING_FIELDS) delete state[field];
  if (isRecord(state.yearDataByKey)) {
    for (const bucket of Object.values(state.yearDataByKey)) {
      if (!isRecord(bucket)) continue;
      for (const field of ACTIVE_OPENING_FIELDS) delete bucket[field];
    }
  }
  return state;
};

/** Chuẩn tên 6421/6422 theo TT133 — đồng bộ khi load state (idempotent). */
const CANONICAL_64212_LABELS: Record<string, { name: string; type: string }> = {
  "6421": { name: "Chi phí bán hàng", type: "Dư Nợ" },
  "6422": { name: "Chi phí quản lý doanh nghiệp", type: "Dư Nợ" },
};

export const applyCanonical64212AccountNames = (state: JsonRecord): boolean => {
  const acc = state.accounts;
  if (!Array.isArray(acc)) return false;
  let changed = false;
  const next = acc.map((row: unknown) => {
    if (!isRecord(row)) return row;
    const code = String(row.code ?? "");
    const canon = CANONICAL_64212_LABELS[code];
    if (!canon) return row;
    const name = String(row.name ?? "");
    const type = String(row.type ?? "");
    if (name === canon.name && type === canon.type) return row;
    changed = true;
    return { ...row, name: canon.name, type: canon.type };
  });
  if (changed) state.accounts = next;
  return changed;
};

const hasAnyOpeningSqlPayload = (payload: Record<string, OpeningSqlYearPayload>) =>
  Object.values(payload).some(
    (item) =>
      item.openingBalanceAccounts.length > 0 ||
      item.openingBalanceDebts.length > 0 ||
      Boolean(item.openingBalanceRolloverMeta),
  );

const mapPayloadFromDatabase = async (prisma: PrismaClient | Prisma.TransactionClient) => {
  const [accounts, debts, rollovers] = await Promise.all([
    prisma.openingBalance.findMany({ orderBy: [{ yearKey: "asc" }, { accountCode: "asc" }] }),
    prisma.debtDetail.findMany({ orderBy: [{ yearKey: "asc" }, { kind: "asc" }, { invoiceNo: "asc" }, { id: "asc" }] }),
    prisma.openingBalanceRollover.findMany({ orderBy: { yearKey: "asc" } }),
  ]);

  const out: Record<string, OpeningSqlYearPayload> = {};
  for (const row of accounts) {
    out[row.yearKey] ||= { openingBalanceAccounts: [], openingBalanceDebts: [] };
    out[row.yearKey].openingBalanceAccounts.push({
      accountCode: row.accountCode,
      debit: fromDbMoney(row.debit),
      credit: fromDbMoney(row.credit),
      originMode: row.originMode,
      readOnly: row.readOnly,
      lockReason: row.lockReason ?? undefined,
    });
  }
  for (const row of debts) {
    out[row.yearKey] ||= { openingBalanceAccounts: [], openingBalanceDebts: [] };
    out[row.yearKey].openingBalanceDebts.push({
      id: row.id,
      kind: normalizeDebtKind(row.kind),
      accountCode: row.accountCode === "331" ? "331" : "131",
      partnerId: row.partnerId ?? undefined,
      partnerCode: row.partnerCode ?? undefined,
      partnerName: row.partnerName,
      invoiceNo: row.invoiceNo,
      revenueType: row.revenueType,
      amount: fromDbMoney(row.amount),
      dueDate: row.dueDate ?? undefined,
      note: row.note ?? undefined,
      sourceInvoiceId: row.sourceInvoiceId ?? undefined,
      sourceInvoiceNumber: row.sourceInvoiceNumber ?? undefined,
      sourceInvoiceDate: row.sourceInvoiceDate ?? undefined,
      sourceYearKey: row.sourceYearKey ?? undefined,
      openingYearKey: row.openingYearKey ?? undefined,
      originMode: row.originMode,
      readOnly: row.readOnly,
      lockReason: row.lockReason ?? undefined,
      syncStatus: row.syncStatus,
    });
  }
  for (const row of rollovers) {
    out[row.yearKey] ||= { openingBalanceAccounts: [], openingBalanceDebts: [] };
    out[row.yearKey].openingBalanceRolloverMeta = {
      sourceYearKey: row.sourceYearKey,
      generatedAt: row.generatedAt.toISOString(),
      lockedAccountCodes: Array.isArray(row.lockedAccountCodes)
        ? row.lockedAccountCodes.map((item) => String(item || "").trim()).filter(Boolean)
        : undefined,
      lockedDebtKinds: Array.isArray(row.lockedDebtKinds)
        ? row.lockedDebtKinds.map((item) => String(item || "").trim()).filter(Boolean)
        : undefined,
    };
  }

  for (const payload of Object.values(out)) {
    payload.openingBalanceAccounts = syncOpeningBalanceAccountsFromDebt(
      payload.openingBalanceAccounts,
      payload.openingBalanceDebts,
    );
  }

  return out;
};

const upsertOpeningBalanceAccounts = async (
  prisma: PrismaClient | Prisma.TransactionClient,
  yearKey: string,
  rows: OpeningBalanceAccountState[],
) => {
  for (const row of rows) {
    await prisma.openingBalance.upsert({
      where: {
        yearKey_accountCode: {
          yearKey,
          accountCode: row.accountCode,
        },
      },
      create: {
        yearKey,
        accountCode: row.accountCode,
        debit: toMoneyBigInt(row.debit),
        credit: toMoneyBigInt(row.credit),
        originMode: row.originMode || "MANUAL",
        readOnly: Boolean(row.readOnly),
        lockReason: row.lockReason ?? null,
      },
      update: {
        debit: toMoneyBigInt(row.debit),
        credit: toMoneyBigInt(row.credit),
        originMode: row.originMode || "MANUAL",
        readOnly: Boolean(row.readOnly),
        lockReason: row.lockReason ?? null,
      },
    });
  }
};

const deleteOpeningBalanceAccountsWithoutDebt = async (
  prisma: PrismaClient | Prisma.TransactionClient,
  yearKey: string,
  keepAccountCodes: string[],
) => {
  const candidates = await prisma.openingBalance.findMany({
    where:
      keepAccountCodes.length > 0
        ? { yearKey, accountCode: { notIn: keepAccountCodes } }
        : { yearKey },
    select: {
      accountCode: true,
      debtDetails: {
        select: { id: true },
        take: 1,
      },
    },
  });

  const deleteCodes = candidates
    .filter((row) => row.debtDetails.length === 0)
    .map((row) => row.accountCode);

  if (deleteCodes.length === 0) return;

  await prisma.openingBalance.deleteMany({
    where: {
      yearKey,
      accountCode: { in: deleteCodes },
    },
  });
};

const mapOpeningBalanceRowFromDb = (row: {
  accountCode: string;
  debit: bigint | number;
  credit: bigint | number;
  originMode: string;
  readOnly: boolean;
  lockReason: string | null;
}): OpeningBalanceAccountState => ({
  accountCode: row.accountCode,
  debit: fromDbMoney(row.debit),
  credit: fromDbMoney(row.credit),
  originMode: row.originMode,
  readOnly: row.readOnly,
  lockReason: row.lockReason ?? undefined,
});

export const buildOpeningBalancesApiPayload = async (
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<OpeningBalancesApiPayload> => {
  const sqlPayload = await mapPayloadFromDatabase(prisma);
  const byYearKey: Record<string, OpeningBalancesApiYearPayload> = {};

  for (const [yearKey, payload] of Object.entries(sqlPayload)) {
    byYearKey[yearKey] = {
      openingBalanceAccounts: payload.openingBalanceAccounts,
      openingBalanceRolloverMeta: payload.openingBalanceRolloverMeta,
    };
  }

  return { byYearKey };
};

export const buildDebtDetailsApiPayload = async (
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<DebtDetailsApiPayload> => {
  const sqlPayload = await mapPayloadFromDatabase(prisma);
  const byYearKey: Record<string, OpeningBalanceDebtState[]> = {};

  for (const [yearKey, payload] of Object.entries(sqlPayload)) {
    byYearKey[yearKey] = payload.openingBalanceDebts;
  }

  return { byYearKey };
};

export const persistOpeningBalancesApiPayload = async (
  prisma: Prisma.TransactionClient,
  rawPayload: unknown,
) => {
  const payload = extractOpeningBalancesApiPayload(rawPayload);
  const yearKeys = Object.keys(payload.byYearKey);
  if (yearKeys.length === 0) return;

  const currentSqlPayload = await mapPayloadFromDatabase(prisma);

  for (const yearKey of yearKeys) {
    const currentDebts = currentSqlPayload[yearKey]?.openingBalanceDebts || [];
    const nextYearPayload = payload.byYearKey[yearKey];
    const syncedAccounts = syncOpeningBalanceAccountsFromDebt(
      nextYearPayload.openingBalanceAccounts,
      currentDebts,
    );

    await upsertOpeningBalanceAccounts(prisma, yearKey, syncedAccounts);
    await deleteOpeningBalanceAccountsWithoutDebt(
      prisma,
      yearKey,
      syncedAccounts.map((row) => row.accountCode),
    );

    if (nextYearPayload.openingBalanceRolloverMeta) {
      await prisma.openingBalanceRollover.upsert({
        where: { yearKey },
        create: {
          yearKey,
          sourceYearKey: nextYearPayload.openingBalanceRolloverMeta.sourceYearKey,
          generatedAt: new Date(nextYearPayload.openingBalanceRolloverMeta.generatedAt),
          lockedAccountCodes: nextYearPayload.openingBalanceRolloverMeta.lockedAccountCodes
            ? (cloneJson(nextYearPayload.openingBalanceRolloverMeta.lockedAccountCodes) as Prisma.InputJsonValue)
            : Prisma.DbNull,
          lockedDebtKinds: nextYearPayload.openingBalanceRolloverMeta.lockedDebtKinds
            ? (cloneJson(nextYearPayload.openingBalanceRolloverMeta.lockedDebtKinds) as Prisma.InputJsonValue)
            : Prisma.DbNull,
        },
        update: {
          sourceYearKey: nextYearPayload.openingBalanceRolloverMeta.sourceYearKey,
          generatedAt: new Date(nextYearPayload.openingBalanceRolloverMeta.generatedAt),
          lockedAccountCodes: nextYearPayload.openingBalanceRolloverMeta.lockedAccountCodes
            ? (cloneJson(nextYearPayload.openingBalanceRolloverMeta.lockedAccountCodes) as Prisma.InputJsonValue)
            : Prisma.DbNull,
          lockedDebtKinds: nextYearPayload.openingBalanceRolloverMeta.lockedDebtKinds
            ? (cloneJson(nextYearPayload.openingBalanceRolloverMeta.lockedDebtKinds) as Prisma.InputJsonValue)
            : Prisma.DbNull,
        },
      });
    } else {
      await prisma.openingBalanceRollover.deleteMany({ where: { yearKey } });
    }
  }
};

export const persistDebtDetailsApiPayload = async (
  prisma: Prisma.TransactionClient,
  rawPayload: unknown,
) => {
  const payload = extractDebtDetailsApiPayload(rawPayload);
  const yearKeys = Object.keys(payload.byYearKey);
  if (yearKeys.length === 0) return;

  for (const yearKey of yearKeys) {
    const nextDebts = payload.byYearKey[yearKey].map((row) => ({
      ...row,
      openingYearKey: row.openingYearKey ?? yearKey,
    }));
    const existingDebtAccounts = await prisma.openingBalance.findMany({
      where: {
        yearKey,
        accountCode: { in: ["131", "331"] },
      },
      orderBy: { accountCode: "asc" },
    });
    const syncedDebtAccounts = syncOpeningBalanceAccountsFromDebt(
      existingDebtAccounts.map((row) => mapOpeningBalanceRowFromDb(row)),
      nextDebts,
    ).filter((row) => row.accountCode === "131" || row.accountCode === "331");

    if (syncedDebtAccounts.length > 0) {
      await upsertOpeningBalanceAccounts(prisma, yearKey, syncedDebtAccounts);
    }

    await prisma.debtDetail.deleteMany({ where: { yearKey } });

    if (nextDebts.length > 0) {
      await prisma.debtDetail.createMany({
        data: nextDebts.map((row) => ({
          id: row.id,
          yearKey,
          kind: row.kind,
          accountCode: row.accountCode,
          partnerId: row.partnerId ?? null,
          partnerCode: row.partnerCode ?? null,
          partnerName: row.partnerName,
          invoiceNo: row.invoiceNo,
          revenueType: row.revenueType,
          amount: toMoneyBigInt(row.amount),
          dueDate: row.dueDate ?? null,
          note: row.note ?? null,
          sourceInvoiceId: row.sourceInvoiceId ?? null,
          sourceInvoiceNumber: row.sourceInvoiceNumber ?? null,
          sourceInvoiceDate: row.sourceInvoiceDate ?? null,
          sourceYearKey: row.sourceYearKey ?? null,
          openingYearKey: row.openingYearKey ?? yearKey,
          originMode: row.originMode || "MANUAL",
          readOnly: Boolean(row.readOnly),
          lockReason: row.lockReason ?? null,
          syncStatus: row.syncStatus || "MATCHED",
        })),
      });
    }
  }
};

export const buildHydratedStateWithOpeningSql = async (
  prisma: PrismaClient | Prisma.TransactionClient,
  rawState: unknown,
) => {
  const baseState = cloneJson(isRecord(rawState) ? rawState : {}) as JsonRecord;
  const sqlPayload = await mapPayloadFromDatabase(prisma);
  const yearDataByKey = isRecord(baseState.yearDataByKey) ? baseState.yearDataByKey : {};
  const allYearKeys = new Set<string>([...Object.keys(yearDataByKey), ...Object.keys(sqlPayload)]);
  const nextYearDataByKey: Record<string, unknown> = {};

  for (const yearKey of allYearKeys) {
    const bucket = isRecord(yearDataByKey[yearKey]) ? cloneJson(yearDataByKey[yearKey]) as JsonRecord : {};
    const payload = sqlPayload[yearKey] || {
      openingBalanceAccounts: [],
      openingBalanceDebts: [],
      openingBalanceRolloverMeta: undefined,
    };
    bucket.openingBalanceAccounts = payload.openingBalanceAccounts;
    bucket.openingBalanceDebts = payload.openingBalanceDebts;
    bucket.openingBalanceRolloverMeta = payload.openingBalanceRolloverMeta ?? null;
    nextYearDataByKey[yearKey] = bucket;
  }

  baseState.yearDataByKey = nextYearDataByKey;
  const activeYearKey = getActiveYearKey(baseState);
  const activePayload = activeYearKey && sqlPayload[activeYearKey]
    ? sqlPayload[activeYearKey]
    : { openingBalanceAccounts: [], openingBalanceDebts: [], openingBalanceRolloverMeta: undefined };
  baseState.openingBalanceAccounts = activePayload.openingBalanceAccounts;
  baseState.openingBalanceDebts = activePayload.openingBalanceDebts;
  baseState.openingBalanceRolloverMeta = activePayload.openingBalanceRolloverMeta ?? null;
  return baseState;
};

export const persistOpeningSqlTables = async (
  prisma: Prisma.TransactionClient,
  rawState: unknown,
) => {
  const extracted = extractOpeningSqlPayloadFromState(rawState);

  await prisma.debtDetail.deleteMany({});
  await prisma.openingBalanceRollover.deleteMany({});
  await prisma.openingBalance.deleteMany({});

  const accountRows = Object.entries(extracted).flatMap(([yearKey, payload]) =>
    payload.openingBalanceAccounts.map((row) => ({
      yearKey,
      accountCode: row.accountCode,
      debit: toMoneyBigInt(row.debit),
      credit: toMoneyBigInt(row.credit),
      originMode: row.originMode || "MANUAL",
      readOnly: Boolean(row.readOnly),
      lockReason: row.lockReason ?? null,
    })),
  );

  if (accountRows.length > 0) {
    await prisma.openingBalance.createMany({ data: accountRows });
  }

  const debtRows = Object.entries(extracted).flatMap(([yearKey, payload]) =>
    payload.openingBalanceDebts.map((row) => ({
      id: row.id,
      yearKey,
      kind: row.kind,
      accountCode: row.accountCode,
      partnerId: row.partnerId ?? null,
      partnerCode: row.partnerCode ?? null,
      partnerName: row.partnerName,
      invoiceNo: row.invoiceNo,
      revenueType: row.revenueType,
      amount: toMoneyBigInt(row.amount),
      dueDate: row.dueDate ?? null,
      note: row.note ?? null,
      sourceInvoiceId: row.sourceInvoiceId ?? null,
      sourceInvoiceNumber: row.sourceInvoiceNumber ?? null,
      sourceInvoiceDate: row.sourceInvoiceDate ?? null,
      sourceYearKey: row.sourceYearKey ?? null,
      openingYearKey: row.openingYearKey ?? yearKey,
      originMode: row.originMode || "MANUAL",
      readOnly: Boolean(row.readOnly),
      lockReason: row.lockReason ?? null,
      syncStatus: row.syncStatus || "MATCHED",
    })),
  );

  if (debtRows.length > 0) {
    await prisma.debtDetail.createMany({ data: debtRows });
  }

  const rolloverRows = Object.entries(extracted)
    .filter(([, payload]) => Boolean(payload.openingBalanceRolloverMeta))
    .map(([yearKey, payload]) => ({
      yearKey,
      sourceYearKey: payload.openingBalanceRolloverMeta!.sourceYearKey,
      generatedAt: new Date(payload.openingBalanceRolloverMeta!.generatedAt),
      lockedAccountCodes: payload.openingBalanceRolloverMeta!.lockedAccountCodes
        ? (cloneJson(payload.openingBalanceRolloverMeta!.lockedAccountCodes) as Prisma.InputJsonValue)
        : Prisma.DbNull,
      lockedDebtKinds: payload.openingBalanceRolloverMeta!.lockedDebtKinds
        ? (cloneJson(payload.openingBalanceRolloverMeta!.lockedDebtKinds) as Prisma.InputJsonValue)
        : Prisma.DbNull,
    }));

  for (const row of rolloverRows) {
    await prisma.openingBalanceRollover.create({ data: row });
  }
};

export const ensureOpeningSqlBackfilled = async (
  prisma: PrismaClient,
  rawState: unknown,
  toPrismaJson: (value: unknown) => Prisma.InputJsonValue,
) => {
  const [accountCount, debtCount, rolloverCount] = await Promise.all([
    prisma.openingBalance.count(),
    prisma.debtDetail.count(),
    prisma.openingBalanceRollover.count(),
  ]);

  if (accountCount > 0 || debtCount > 0 || rolloverCount > 0) return false;

  const extracted = extractOpeningSqlPayloadFromState(rawState);
  if (!hasAnyOpeningSqlPayload(extracted)) return false;

  await prisma.$transaction(async (tx) => {
    await persistOpeningSqlTables(tx, rawState);
    await tx.appState.upsert({
      where: { id: 1 },
      create: { id: 1, data: toPrismaJson(stripOpeningSqlState(rawState)) },
      update: { data: toPrismaJson(stripOpeningSqlState(rawState)) },
    });
  });
  return true;
};
