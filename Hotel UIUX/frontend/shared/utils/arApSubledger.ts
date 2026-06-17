import type { Customer, FinancialYear, FundTransaction, Invoice, JournalEntry, Supplier } from '../types';
import { journalEntryDetailsArray } from './journalEntryDetails';

/** Cộng dồn (Nợ − Có) trên các dòng TK bắt đầu bằng prefix, theo objectId/objectName, đến hết endDate. */
export function computeSubledgerNetByObject(
  entries: JournalEntry[],
  endDate: string,
  accountPrefix: string,
): Map<string, number> {
  const netByObject = new Map<string, number>();
  const end = String(endDate);
  for (const je of entries) {
    if (String(je.date) > end) continue;
    for (const d of journalEntryDetailsArray(je)) {
      const acc = String(d.account || '');
      if (!acc.startsWith(accountPrefix)) continue;
      const key = String(d.objectId || d.objectName || 'UNKNOWN');
      const prev = netByObject.get(key) || 0;
      netByObject.set(key, prev + (Number(d.debit || 0) - Number(d.credit || 0)));
    }
  }
  for (const [k, v] of Array.from(netByObject.entries())) {
    if (Math.abs(v) < 0.000001) netByObject.delete(k);
  }
  return netByObject;
}

function firstObjectNameForKey(
  entries: JournalEntry[],
  endDate: string,
  accountPrefix: string,
  key: string,
): string | undefined {
  const end = String(endDate);
  for (const je of entries) {
    if (String(je.date) > end) continue;
    for (const d of journalEntryDetailsArray(je)) {
      const acc = String(d.account || '');
      if (!acc.startsWith(accountPrefix)) continue;
      const k = String(d.objectId || d.objectName || 'UNKNOWN');
      if (k !== key) continue;
      const n = String(d.objectName || '').trim();
      if (n) return n;
    }
  }
  return undefined;
}

function enrichArApRowMeta(
  kind: 'AR' | 'AP',
  objectKey: string,
  entries: JournalEntry[],
  endDate: string,
  invoices: Invoice[],
  customers: Customer[],
  suppliers: Supplier[],
): { displayName: string; code?: string; taxCode?: string } {
  const prefix = kind === 'AR' ? '131' : '331';
  let displayName = firstObjectNameForKey(entries, endDate, prefix, objectKey) || objectKey;
  let code: string | undefined;
  let taxCode: string | undefined;
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const custById = new Map(customers.map((c) => [c.id, c]));
  const supById = new Map(suppliers.map((s) => [s.id, s]));

  if (objectKey === 'UNKNOWN') {
    displayName =
      kind === 'AR'
        ? '(Chưa gắn đối tượng — kiểm tra bút toán TK 131)'
        : '(Chưa gắn đối tượng — kiểm tra bút toán TK 331)';
  } else {
    const inv = invById.get(objectKey);
    if (kind === 'AR' && inv?.type === 'SALES') {
      displayName = inv.customerName || inv.buyerUnitName || inv.buyerLegalName || displayName;
      taxCode = inv.buyerTaxCode || taxCode;
    }
    if (kind === 'AP' && inv?.type === 'PURCHASE') {
      displayName = inv.customerName || inv.buyerUnitName || displayName;
      taxCode = inv.buyerTaxCode || taxCode;
    }
    const c = custById.get(objectKey);
    if (c && kind === 'AR') {
      displayName = c.name || displayName;
      code = c.code || code;
      taxCode = c.taxCode || taxCode;
    }
    const s = supById.get(objectKey);
    if (s && kind === 'AP') {
      displayName = s.name || displayName;
      code = s.code || code;
      taxCode = s.taxCode || taxCode;
    }
  }
  return { displayName, code, taxCode };
}

export type ArApSubledgerRow = {
  objectKey: string;
  displayName: string;
  code?: string;
  taxCode?: string;
  balance: number;
};

export type ArApSummaryRow = ArApSubledgerRow & {
  totalDebt: number;
  totalPaid: number;
  /** Một hoặc nhiều số HĐ (phân tách bởi dấu phẩy) gắn với đối tượng trên TK 131/331. */
  invoiceNumber?: string;
};

function collectSummaryInvoiceNumbers(
  kind: 'AR' | 'AP',
  objectKey: string,
  entries: JournalEntry[],
  endDate: string,
  invoices: Invoice[],
): string | undefined {
  if (objectKey === 'UNKNOWN') return undefined;
  const prefix = kind === 'AR' ? '131' : '331';
  const invoiceNoById = new Map(
    (invoices || []).map((inv) => [String(inv.id || '').trim(), String(inv.invoiceNumber || '').trim()]),
  );
  const seen = new Set<string>();
  const directNo = String(invoiceNoById.get(objectKey) || '').trim();
  if (directNo) seen.add(directNo);

  const end = String(endDate);
  for (const je of entries) {
    if (String(je.date) > end) continue;
    for (const d of journalEntryDetailsArray(je)) {
      const acc = String(d.account || '');
      if (!acc.startsWith(prefix)) continue;
      const k = String(d.objectId || d.objectName || 'UNKNOWN');
      if (k !== objectKey) continue;
      const sourceInvoiceNumber = String(d.sourceInvoiceNumber || '').trim();
      const sourceInvoiceId = String(d.sourceInvoiceId || '').trim();
      const oid = String(d.objectId || '').trim();
      const num =
        sourceInvoiceNumber ||
        (sourceInvoiceId ? String(invoiceNoById.get(sourceInvoiceId) || '').trim() : '') ||
        (oid ? String(invoiceNoById.get(oid) || '').trim() : '');
      if (num) seen.add(num);
    }
  }
  if (seen.size === 0) return undefined;
  return Array.from(seen).sort().join(', ');
}

export type ArApMovementLine = {
  date: string;
  journalId: string;
  referenceId: string;
  invoiceNumber?: string;
  description: string;
  objectKey: string;
  displayName: string;
  debtSide: number;
  paySide: number;
  runningBalance: number;
};

export function buildReceivableRows(
  entries: JournalEntry[],
  endDate: string,
  invoices: Invoice[],
  customers: Customer[],
  suppliers: Supplier[] = [],
): ArApSubledgerRow[] {
  const map = computeSubledgerNetByObject(entries, endDate, '131');
  const rows: ArApSubledgerRow[] = [];
  for (const [key, net] of map.entries()) {
    const balance = Math.round(net);
    if (balance === 0) continue;
    const meta = enrichArApRowMeta('AR', key, entries, endDate, invoices, customers, suppliers);
    rows.push({ objectKey: key, displayName: meta.displayName, code: meta.code, taxCode: meta.taxCode, balance });
  }
  rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  return rows;
}

/** Số dư phải trả (331) = Có − Nợ = −(Nợ − Có) trên chi tiết 331. */
export function buildPayableRows(
  entries: JournalEntry[],
  endDate: string,
  invoices: Invoice[],
  suppliers: Supplier[],
  customers: Customer[] = [],
): ArApSubledgerRow[] {
  const map = computeSubledgerNetByObject(entries, endDate, '331');
  const rows: ArApSubledgerRow[] = [];
  for (const [key, net] of map.entries()) {
    const balance = Math.round(-net);
    if (balance === 0) continue;
    const meta = enrichArApRowMeta('AP', key, entries, endDate, invoices, customers, suppliers);
    rows.push({ objectKey: key, displayName: meta.displayName, code: meta.code, taxCode: meta.taxCode, balance });
  }
  rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  return rows;
}

/** Tổng phát sinh tăng nợ (Nợ TK 131 hoặc Có TK 331) và tổng đã thu/đã trả (đối ứng). */
export function computeArApDebitCreditTotalsByObject(
  entries: JournalEntry[],
  endDate: string,
  kind: 'AR' | 'AP',
): Map<string, { debt: number; pay: number }> {
  const prefix = kind === 'AR' ? '131' : '331';
  const map = new Map<string, { debt: number; pay: number }>();
  const end = String(endDate);
  for (const je of entries) {
    if (String(je.date) > end) continue;
    for (const d of journalEntryDetailsArray(je)) {
      const acc = String(d.account || '');
      if (!acc.startsWith(prefix)) continue;
      const key = String(d.objectId || d.objectName || 'UNKNOWN');
      const cur = map.get(key) || { debt: 0, pay: 0 };
      if (kind === 'AR') {
        cur.debt += Number(d.debit || 0);
        cur.pay += Number(d.credit || 0);
      } else {
        cur.debt += Number(d.credit || 0);
        cur.pay += Number(d.debit || 0);
      }
      map.set(key, cur);
    }
  }
  return map;
}

function normalizeSummaryPartyName(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

type SummaryParty = {
  id: string;
  name: string;
  code?: string;
  taxCode?: string;
};

function buildSummaryPartyIndex(parties: SummaryParty[]) {
  const byId = new Map<string, SummaryParty>();
  const exactNameIndex = new Map<string, SummaryParty | null>();
  const list: SummaryParty[] = [];
  for (const p of parties) {
    const id = String(p.id || '').trim();
    const name = String(p.name || '').trim();
    if (!id || !name) continue;
    const normalized: SummaryParty = { ...p, id, name };
    byId.set(id, normalized);
    list.push(normalized);
    const nk = normalizeSummaryPartyName(name);
    if (!nk) continue;
    const existed = exactNameIndex.get(nk);
    exactNameIndex.set(nk, existed === undefined ? normalized : null);
  }
  return { byId, list, exactNameIndex };
}

function resolveSummaryPartyByName(
  rawName: string,
  index: ReturnType<typeof buildSummaryPartyIndex>,
): SummaryParty | undefined {
  const n = normalizeSummaryPartyName(rawName);
  if (!n) return undefined;
  const exact = index.exactNameIndex.get(n);
  if (exact && exact.id) return exact;
  let hit: SummaryParty | undefined;
  for (const p of index.list) {
    const pn = normalizeSummaryPartyName(p.name);
    if (!pn) continue;
    if (!(pn.includes(n) || n.includes(pn))) continue;
    if (hit && hit.id !== p.id) return undefined;
    hit = p;
  }
  return hit;
}

function appendInvoiceNumbers(target: Set<string>, raw?: string) {
  if (!raw) return;
  for (const piece of String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    target.add(piece);
  }
}

function resolveInvoicePartyLabel(kind: 'AR' | 'AP', invoice: Invoice): string {
  return kind === 'AR'
    ? String(invoice.customerName || invoice.buyerUnitName || invoice.buyerLegalName || '').trim()
    : String(invoice.customerName || invoice.buyerUnitName || '').trim();
}

function resolvePartyMetaFromInvoice(
  kind: 'AR' | 'AP',
  invoice: Invoice | undefined,
  customers: Customer[],
  suppliers: Supplier[],
): { id?: string; name?: string; code?: string; taxCode?: string } | null {
  if (!invoice) return null;
  const partyIndex = buildSummaryPartyIndex(
    (kind === 'AR' ? customers : suppliers).map((p) => ({
      id: String(p.id || ''),
      name: String(p.name || ''),
      code: p.code,
      taxCode: p.taxCode,
    })),
  );
  const party = resolveSummaryPartyByName(resolveInvoicePartyLabel(kind, invoice), partyIndex);
  if (party) return party;
  return {
    name: resolveInvoicePartyLabel(kind, invoice) || undefined,
    taxCode: kind === 'AR' ? invoice.buyerTaxCode || undefined : undefined,
  };
}

function buildInvoicesByPartyKey(kind: 'AR' | 'AP', invoices: Invoice[]) {
  const map = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    const key = normalizeSummaryPartyName(resolveInvoicePartyLabel(kind, inv));
    if (!key) continue;
    const arr = map.get(key) || [];
    arr.push(inv);
    map.set(key, arr);
  }
  return map;
}

function resolvePartyKeyFromArApLine(
  kind: 'AR' | 'AP',
  objectKey: string,
  objectName: string,
  linkedInvoice: Invoice | undefined,
  partyIndex: ReturnType<typeof buildSummaryPartyIndex>,
): string {
  const byId = partyIndex.byId.get(objectKey);
  if (byId?.name) return normalizeSummaryPartyName(byId.name);
  const byName = resolveSummaryPartyByName(objectName, partyIndex);
  if (byName?.name) return normalizeSummaryPartyName(byName.name);
  const invoiceName = resolveInvoicePartyLabel(kind, linkedInvoice || ({} as Invoice));
  if (invoiceName) return normalizeSummaryPartyName(invoiceName);
  return normalizeSummaryPartyName(objectName || objectKey);
}

function textMentionsInvoiceNumber(texts: string[], invoiceNumber: string): boolean {
  const needle = String(invoiceNumber || '').trim().toLowerCase();
  if (!needle || needle.length < 3) return false;
  return texts.some((text) => {
    const hay = String(text || '').trim().toLowerCase();
    return hay.length >= needle.length && hay.includes(needle);
  });
}

function inferLegacyInvoiceForArApLine(args: {
  kind: 'AR' | 'AP';
  entry: JournalEntry;
  detail: ReturnType<typeof journalEntryDetailsArray>[number];
  directInvoice?: Invoice;
  relevantInvoices: Invoice[];
  invoiceById: Map<string, Invoice>;
  invoiceByNo: Map<string, Invoice>;
  invoicesByPartyKey: Map<string, Invoice[]>;
  partyIndex: ReturnType<typeof buildSummaryPartyIndex>;
}): Invoice | undefined {
  const { kind, entry, detail, directInvoice, relevantInvoices, invoiceById, invoiceByNo, invoicesByPartyKey, partyIndex } = args;
  if (directInvoice) return directInvoice;

  const objectKey = String(detail.objectId || detail.objectName || 'UNKNOWN').trim() || 'UNKNOWN';
  const objectName = String(detail.objectName || '').trim();
  const directByObject =
    invoiceById.get(objectKey) ||
    invoiceByNo.get(objectKey) ||
    invoiceByNo.get(String(detail.sourceInvoiceNumber || '').trim()) ||
    undefined;
  if (directByObject) return directByObject;

  const partyKey = resolvePartyKeyFromArApLine(kind, objectKey, objectName, undefined, partyIndex);
  const candidates = (partyKey ? invoicesByPartyKey.get(partyKey) : undefined) || relevantInvoices;
  if (candidates.length === 0) return undefined;

  const lineAmount =
    kind === 'AR'
      ? Math.round(Math.max(Number(detail.debit || 0), Number(detail.credit || 0)))
      : Math.round(Math.max(Number(detail.credit || 0), Number(detail.debit || 0)));
  const texts = [
    String(entry.referenceId || ''),
    String(entry.description || ''),
    String(detail.objectId || ''),
    String(detail.objectName || ''),
    String(detail.sourceInvoiceNumber || ''),
  ];

  const refMatches = candidates.filter((inv) => textMentionsInvoiceNumber(texts, String(inv.invoiceNumber || '')));
  if (refMatches.length === 1) return refMatches[0];
  if (refMatches.length > 1 && lineAmount > 0) {
    const refByAmount = refMatches.filter((inv) => Math.round(Number(inv.totalAmount || 0)) === lineAmount);
    if (refByAmount.length === 1) return refByAmount[0];
  }

  if (lineAmount > 0) {
    const byAmount = candidates.filter((inv) => Math.round(Number(inv.totalAmount || 0)) === lineAmount);
    if (byAmount.length === 1) return byAmount[0];
    const byAmountPast = byAmount.filter((inv) => String(inv.date || '').split('T')[0] <= String(entry.date || ''));
    if (byAmountPast.length === 1) return byAmountPast[0];
  }

  const pendingOnly = candidates.filter((inv) => inv.status === 'PENDING');
  if (pendingOnly.length === 1) return pendingOnly[0];
  if (candidates.length === 1) return candidates[0];
  return undefined;
}

export function buildArApSummaryRows(
  kind: 'AR' | 'AP',
  entries: JournalEntry[],
  endDate: string,
  invoices: Invoice[],
  customers: Customer[],
  suppliers: Supplier[],
): ArApSummaryRow[] {
  const totals = computeArApDebitCreditTotalsByObject(entries, endDate, kind);
  const invoiceById = new Map(
    invoices
      .filter((inv) => (kind === 'AR' ? inv.type === 'SALES' : inv.type === 'PURCHASE'))
      .map((inv) => [String(inv.id || ''), inv]),
  );
  const partyIndex = buildSummaryPartyIndex(
    (kind === 'AR' ? customers : suppliers).map((p) => ({
      id: String(p.id || ''),
      name: String(p.name || ''),
      code: p.code,
      taxCode: p.taxCode,
    })),
  );

  const grouped = new Map<
    string,
    {
      objectKey: string;
      displayName: string;
      code?: string;
      taxCode?: string;
      totalDebt: number;
      totalPaid: number;
      invoiceNumbers: Set<string>;
      sourceKeys: Set<string>;
      score: number;
    }
  >();

  for (const [key, { debt, pay }] of totals.entries()) {
    const debtRounded = Math.round(debt);
    const payRounded = Math.round(pay);
    if (!debtRounded && !payRounded) continue;
    const meta = enrichArApRowMeta(kind, key, entries, endDate, invoices, customers, suppliers);
    const invoiceNumber = collectSummaryInvoiceNumbers(kind, key, entries, endDate, invoices);

    const directParty = partyIndex.byId.get(key);
    const linkedInvoice = invoiceById.get(key);
    const invoicePartyByName = linkedInvoice
      ? resolveSummaryPartyByName(
          kind === 'AR'
            ? linkedInvoice.customerName || linkedInvoice.buyerUnitName || linkedInvoice.buyerLegalName || ''
            : linkedInvoice.customerName || '',
          partyIndex,
        )
      : undefined;
    const partyByMeta = resolveSummaryPartyByName(meta.displayName || key, partyIndex);
    const party = directParty || invoicePartyByName || partyByMeta;

    const partyNameForGroup = party?.name || meta.displayName || key;
    const normalizedPartyName = normalizeSummaryPartyName(partyNameForGroup);
    const groupKey = party?.id
      ? `ID:${party.id}`
      : normalizedPartyName
      ? `NAME:${normalizedPartyName}`
      : `RAW:${key}`;

    const score = directParty ? 3 : party?.id ? 2 : 1;
    const canonicalObjectKey = party?.id || key;
    const canonicalDisplayName = party?.name || meta.displayName || key;
    const canonicalCode = party?.code || meta.code;
    const canonicalTaxCode = party?.taxCode || meta.taxCode;

    const existing = grouped.get(groupKey);
    if (!existing) {
      const invoiceNumbers = new Set<string>();
      appendInvoiceNumbers(invoiceNumbers, invoiceNumber);
      grouped.set(groupKey, {
        objectKey: canonicalObjectKey,
        displayName: canonicalDisplayName,
        code: canonicalCode,
        taxCode: canonicalTaxCode,
        totalDebt: debtRounded,
        totalPaid: payRounded,
        invoiceNumbers,
        sourceKeys: new Set([key]),
        score,
      });
      continue;
    }

    existing.totalDebt += debtRounded;
    existing.totalPaid += payRounded;
    appendInvoiceNumbers(existing.invoiceNumbers, invoiceNumber);
    existing.sourceKeys.add(key);
    if (score > existing.score) {
      existing.objectKey = canonicalObjectKey;
      existing.displayName = canonicalDisplayName;
      existing.code = canonicalCode;
      existing.taxCode = canonicalTaxCode;
      existing.score = score;
    } else {
      if (!existing.code && canonicalCode) existing.code = canonicalCode;
      if (!existing.taxCode && canonicalTaxCode) existing.taxCode = canonicalTaxCode;
    }
  }

  const rows: ArApSummaryRow[] = [];
  for (const bucket of grouped.values()) {
    const balance = Math.round(bucket.totalDebt - bucket.totalPaid);
    if (balance === 0) continue;
    const invoiceNumbers = new Set(bucket.invoiceNumbers);
    const canonicalParty =
      partyIndex.byId.get(bucket.objectKey) || resolveSummaryPartyByName(bucket.displayName || '', partyIndex);
    const expectedType = kind === 'AR' ? 'SALES' : 'PURCHASE';
    for (const inv of invoices) {
      if (inv.type !== expectedType) continue;
      const invNo = String(inv.invoiceNumber || '').trim();
      if (!invNo) continue;

      const sourceId = String(inv.id || '').trim();
      if (sourceId && bucket.sourceKeys.has(sourceId)) {
        invoiceNumbers.add(invNo);
        continue;
      }

      if (inv.status !== 'PENDING') continue;
      const invParty = resolveSummaryPartyByName(resolveInvoicePartyLabel(kind, inv), partyIndex);
      if (canonicalParty?.id && invParty?.id === canonicalParty.id) {
        invoiceNumbers.add(invNo);
        continue;
      }

      const bucketName = normalizeSummaryPartyName(bucket.displayName || '');
      const invName = normalizeSummaryPartyName(resolveInvoicePartyLabel(kind, inv));
      if (bucketName && invName && (bucketName === invName || bucketName.includes(invName) || invName.includes(bucketName))) {
        invoiceNumbers.add(invNo);
      }
    }

    rows.push({
      objectKey: bucket.objectKey,
      displayName: bucket.displayName,
      code: bucket.code,
      taxCode: bucket.taxCode,
      balance,
      totalDebt: Math.round(bucket.totalDebt),
      totalPaid: Math.round(bucket.totalPaid),
      invoiceNumber: invoiceNumbers.size > 0 ? Array.from(invoiceNumbers).sort().join(', ') : undefined,
    });
  }

  rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  return rows;
}

export function buildApSummaryRowsByInvoice(
  entries: JournalEntry[],
  endDate: string,
  invoices: Invoice[],
  customers: Customer[],
  suppliers: Supplier[],
): ArApSummaryRow[] {
  const purchaseInvoices = invoices.filter((inv) => inv.type === 'PURCHASE');
  const invoiceById = new Map(purchaseInvoices.map((inv) => [String(inv.id || '').trim(), inv]));
  const invoiceByNo = new Map(purchaseInvoices.map((inv) => [String(inv.invoiceNumber || '').trim(), inv]));
  const supplierIndex = buildSummaryPartyIndex(
    suppliers.map((s) => ({
      id: String(s.id || ''),
      name: String(s.name || ''),
      code: s.code,
      taxCode: s.taxCode,
    })),
  );
  const end = String(endDate);

  const grouped = new Map<
    string,
    {
      objectKey: string;
      displayName: string;
      code?: string;
      taxCode?: string;
      invoiceNumber?: string;
      totalDebt: number;
      totalPaid: number;
    }
  >();

  for (const je of entries) {
    if (String(je.date) > end) continue;
    for (const d of journalEntryDetailsArray(je)) {
      const acc = String(d.account || '');
      if (!acc.startsWith('331')) continue;

      const debtSide = Math.round(Number(d.credit || 0));
      const paySide = Math.round(Number(d.debit || 0));
      if (!debtSide && !paySide) continue;

      const rawObjectKey = String(d.objectId || d.objectName || 'UNKNOWN').trim() || 'UNKNOWN';
      const sourceInvoiceId = String(d.sourceInvoiceId || '').trim();
      const sourceInvoiceNumber = String(d.sourceInvoiceNumber || '').trim();
      const linkedInvoice =
        (sourceInvoiceId ? invoiceById.get(sourceInvoiceId) : undefined) ||
        (sourceInvoiceNumber ? invoiceByNo.get(sourceInvoiceNumber) : undefined) ||
        invoiceById.get(rawObjectKey) ||
        undefined;
      const invoiceNumber = String(
        sourceInvoiceNumber || linkedInvoice?.invoiceNumber || (sourceInvoiceId ? invoiceById.get(sourceInvoiceId)?.invoiceNumber : '') || '',
      ).trim();

      const supplierById = supplierIndex.byId.get(rawObjectKey);
      const supplierByObjectName = resolveSummaryPartyByName(String(d.objectName || '').trim(), supplierIndex);
      const supplierByInvoice = resolveSummaryPartyByName(resolveInvoicePartyLabel('AP', linkedInvoice || ({} as Invoice)), supplierIndex);
      const supplier = supplierById || supplierByObjectName || supplierByInvoice;

      const fallbackMeta = enrichArApRowMeta('AP', rawObjectKey, entries, endDate, invoices, customers, suppliers);
      const displayName =
        supplier?.name ||
        resolveInvoicePartyLabel('AP', linkedInvoice || ({} as Invoice)) ||
        fallbackMeta.displayName ||
        rawObjectKey;
      const code = supplier?.code || fallbackMeta.code;
      const taxCode = supplier?.taxCode || linkedInvoice?.buyerTaxCode || fallbackMeta.taxCode;

      const supplierKey = supplier?.id
        ? `SUP:${supplier.id}`
        : normalizeSummaryPartyName(displayName)
        ? `SUPN:${normalizeSummaryPartyName(displayName)}`
        : `SUPO:${rawObjectKey}`;
      const invoiceKey = sourceInvoiceId
        ? `INV:${sourceInvoiceId}`
        : invoiceNumber
        ? `NO:${invoiceNumber}`
        : `OBJ:${rawObjectKey}`;
      const groupKey = `${supplierKey}|${invoiceKey}`;
      const existing = grouped.get(groupKey);

      if (!existing) {
        grouped.set(groupKey, {
          objectKey: sourceInvoiceId || linkedInvoice?.id || supplier?.id || rawObjectKey,
          displayName,
          code,
          taxCode,
          invoiceNumber: invoiceNumber || undefined,
          totalDebt: debtSide,
          totalPaid: paySide,
        });
        continue;
      }

      existing.totalDebt += debtSide;
      existing.totalPaid += paySide;
      if (!existing.invoiceNumber && invoiceNumber) existing.invoiceNumber = invoiceNumber;
      if (!existing.code && code) existing.code = code;
      if (!existing.taxCode && taxCode) existing.taxCode = taxCode;
    }
  }

  const rows: ArApSummaryRow[] = [];
  for (const bucket of grouped.values()) {
    const balance = Math.round(bucket.totalDebt - bucket.totalPaid);
    if (balance === 0) continue;
    rows.push({
      objectKey: bucket.objectKey,
      displayName: bucket.displayName,
      code: bucket.code,
      taxCode: bucket.taxCode,
      balance,
      totalDebt: Math.round(bucket.totalDebt),
      totalPaid: Math.round(bucket.totalPaid),
      invoiceNumber: bucket.invoiceNumber,
    });
  }

  rows.sort((a, b) => {
    const c = String(a.displayName || '').localeCompare(String(b.displayName || ''));
    if (c !== 0) return c;
    const d = String(a.invoiceNumber || '').localeCompare(String(b.invoiceNumber || ''));
    if (d !== 0) return d;
    return Math.abs(b.balance) - Math.abs(a.balance);
  });
  return rows;
}

export function buildArApSummaryRowsByInvoice(
  kind: 'AR' | 'AP',
  entries: JournalEntry[],
  endDate: string,
  invoices: Invoice[],
  customers: Customer[],
  suppliers: Supplier[],
): ArApSummaryRow[] {
  const prefix = kind === 'AR' ? '131' : '331';
  const expectedType = kind === 'AR' ? 'SALES' : 'PURCHASE';
  const relevantInvoices = invoices.filter((inv) => inv.type === expectedType);
  const invoiceById = new Map(relevantInvoices.map((inv) => [String(inv.id || '').trim(), inv]));
  const invoiceByNo = new Map(relevantInvoices.map((inv) => [String(inv.invoiceNumber || '').trim(), inv]));
  const invoicesByPartyKey = buildInvoicesByPartyKey(kind, relevantInvoices);
  const partyIndex = buildSummaryPartyIndex(
    (kind === 'AR' ? customers : suppliers).map((p) => ({
      id: String(p.id || ''),
      name: String(p.name || ''),
      code: p.code,
      taxCode: p.taxCode,
    })),
  );
  const end = String(endDate);

  const grouped = new Map<
    string,
    {
      objectKey: string;
      displayName: string;
      code?: string;
      taxCode?: string;
      invoiceNumber?: string;
      totalDebt: number;
      totalPaid: number;
    }
  >();

  for (const je of entries) {
    if (String(je.date) > end) continue;
    for (const d of journalEntryDetailsArray(je)) {
      const acc = String(d.account || '');
      if (!acc.startsWith(prefix)) continue;

      const objectKey = String(d.objectId || d.objectName || 'UNKNOWN').trim() || 'UNKNOWN';
      const sourceInvoiceId = String(d.sourceInvoiceId || '').trim();
      const sourceInvoiceNumber = String(d.sourceInvoiceNumber || '').trim();
      const directInvoice =
        (sourceInvoiceId ? invoiceById.get(sourceInvoiceId) : undefined) ||
        (sourceInvoiceNumber ? invoiceByNo.get(sourceInvoiceNumber) : undefined) ||
        invoiceById.get(objectKey) ||
        invoiceByNo.get(objectKey) ||
        undefined;
      const linkedInvoice = inferLegacyInvoiceForArApLine({
        kind,
        entry: je,
        detail: d,
        directInvoice,
        relevantInvoices,
        invoiceById,
        invoiceByNo,
        invoicesByPartyKey,
        partyIndex,
      });
      const invoiceNumber = String(
        sourceInvoiceNumber ||
          linkedInvoice?.invoiceNumber ||
          (sourceInvoiceId ? invoiceById.get(sourceInvoiceId)?.invoiceNumber : '') ||
          '',
      ).trim();

      const debtSide =
        kind === 'AR' ? Math.round(Number(d.debit || 0)) : Math.round(Number(d.credit || 0));
      const paySide =
        kind === 'AR' ? Math.round(Number(d.credit || 0)) : Math.round(Number(d.debit || 0));
      if (!debtSide && !paySide) continue;

      const fallbackMeta = enrichArApRowMeta(kind, objectKey, entries, endDate, invoices, customers, suppliers);
      const partyMetaFromId = partyIndex.byId.get(objectKey);
      const partyMetaFromObjectName = resolveSummaryPartyByName(String(d.objectName || '').trim(), partyIndex);
      const partyMetaFromInvoice = resolvePartyMetaFromInvoice(kind, linkedInvoice, customers, suppliers);
      const partyMeta = partyMetaFromId || partyMetaFromObjectName || partyMetaFromInvoice;

      const displayName =
        partyMeta?.name || fallbackMeta.displayName || resolveInvoicePartyLabel(kind, linkedInvoice || ({} as Invoice)) || objectKey;
      const code = partyMeta?.code || fallbackMeta.code;
      const taxCode = partyMeta?.taxCode || fallbackMeta.taxCode;

      const invoiceGroupKey = linkedInvoice?.id
        ? `INV:${linkedInvoice.id}`
        : invoiceNumber
        ? `NO:${invoiceNumber}`
        : '';
      const partyGroupKey = partyMeta?.id
        ? `PARTY:${partyMeta.id}`
        : normalizeSummaryPartyName(displayName)
        ? `PARTYN:${normalizeSummaryPartyName(displayName)}`
        : `RAW:${objectKey}`;
      const groupKey = invoiceGroupKey || partyGroupKey;

      const existing = grouped.get(groupKey);
      if (!existing) {
        grouped.set(groupKey, {
          objectKey: linkedInvoice?.id || partyMeta?.id || objectKey,
          displayName,
          code,
          taxCode,
          invoiceNumber: invoiceNumber || undefined,
          totalDebt: debtSide,
          totalPaid: paySide,
        });
        continue;
      }

      existing.totalDebt += debtSide;
      existing.totalPaid += paySide;
      if (!existing.invoiceNumber && invoiceNumber) existing.invoiceNumber = invoiceNumber;
      if (!existing.code && code) existing.code = code;
      if (!existing.taxCode && taxCode) existing.taxCode = taxCode;
    }
  }

  const rows: ArApSummaryRow[] = [];
  for (const bucket of grouped.values()) {
    const balance = Math.round(bucket.totalDebt - bucket.totalPaid);
    if (balance === 0) continue;
    rows.push({
      objectKey: bucket.objectKey,
      displayName: bucket.displayName,
      code: bucket.code,
      taxCode: bucket.taxCode,
      balance,
      totalDebt: Math.round(bucket.totalDebt),
      totalPaid: Math.round(bucket.totalPaid),
      invoiceNumber: bucket.invoiceNumber,
    });
  }

  rows.sort((a, b) => {
    const c = String(a.displayName || '').localeCompare(String(b.displayName || ''));
    if (c !== 0) return c;
    const d = String(a.invoiceNumber || '').localeCompare(String(b.invoiceNumber || ''));
    if (d !== 0) return d;
    return Math.abs(b.balance) - Math.abs(a.balance);
  });
  return rows;
}

function normApPartyName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Tổng Nợ TK 331 trên các dòng có objectId thuộc tập (thanh toán gắn HĐ). */
function sumDebit331ByObjectIds(
  entries: JournalEntry[],
  endDate: string,
  objectIds: Set<string>,
): number {
  if (objectIds.size === 0) return 0;
  let sum = 0;
  const end = String(endDate);
  for (const je of entries) {
    if (String(je.date) > end) continue;
    for (const d of journalEntryDetailsArray(je)) {
      if (!String(d.account || '').startsWith('331')) continue;
      const oid = String(d.objectId || '').trim();
      if (oid && objectIds.has(oid)) sum += Number(d.debit || 0);
    }
  }
  return Math.round(sum);
}

/**
 * Truy vết & làm sạch dòng báo cáo Nợ phải trả NCC:
 * - Bỏ dòng gắn id HĐ mua đã thanh toán mà vẫn còn dương (lệch đồng bộ cũ).
 * - Với khóa cũ chỉ theo tên NCC (không trùng id HĐ đang PENDING), cộng thêm Nợ 331 của các HĐ mua đã TT (objectId = id HĐ) cùng tên → chỉ giữ phần còn thực sự chưa trả.
 */
export function reconcileApSummaryRowsForPayables(
  rows: ArApSummaryRow[],
  entries: JournalEntry[],
  endDate: string,
  invoices: Invoice[],
  suppliers: Supplier[],
): ArApSummaryRow[] {
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const paidPurchasesByNormName = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    if (inv.type !== 'PURCHASE' || inv.status !== 'PAID') continue;
    const n = normApPartyName(inv.customerName || '');
    if (!n) continue;
    const arr = paidPurchasesByNormName.get(n) || [];
    arr.push(inv);
    paidPurchasesByNormName.set(n, arr);
  }
  const supplierNormById = new Map(suppliers.map((s) => [s.id, normApPartyName(s.name || '')]));

  const out: ArApSummaryRow[] = [];

  for (const row of rows) {
    const directInv = invById.get(row.objectKey);
    if (directInv?.type === 'PURCHASE' && directInv.status === 'PAID' && row.balance > 0) {
      continue;
    }

    const isPendingPurchaseBucket =
      directInv?.type === 'PURCHASE' && directInv.status === 'PENDING';

    let extraPaid = 0;
    if (!isPendingPurchaseBucket) {
      const nameKeys = new Set<string>();
      const nkKey = normApPartyName(row.objectKey);
      const nkDisp = normApPartyName(row.displayName);
      if (nkKey) nameKeys.add(nkKey);
      if (nkDisp) nameKeys.add(nkDisp);
      const supN = supplierNormById.get(row.objectKey);
      if (supN) nameKeys.add(supN);

      const matchedIds = new Set<string>();
      for (const nk of nameKeys) {
        const list = paidPurchasesByNormName.get(nk);
        if (!list) continue;
        for (const p of list) matchedIds.add(p.id);
      }
      if (matchedIds.size > 0) {
        extraPaid = sumDebit331ByObjectIds(entries, endDate, matchedIds);
      }
    }

    const adjPaid = row.totalPaid + extraPaid;
    const adjBalance = row.totalDebt - adjPaid;
    if (adjBalance <= 0) continue;

    out.push({
      ...row,
      totalPaid: adjPaid,
      balance: Math.round(adjBalance),
    });
  }

  out.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  return out;
}

export function buildArApMovementLines(
  entries: JournalEntry[],
  endDate: string,
  kind: 'AR' | 'AP',
  invoices: Invoice[],
  customers: Customer[],
  suppliers: Supplier[],
): ArApMovementLine[] {
  const prefix = kind === 'AR' ? '131' : '331';
  const expectedType = kind === 'AR' ? 'SALES' : 'PURCHASE';
  const relevantInvoices = (invoices || []).filter((inv) => inv.type === expectedType);
  const invoiceById = new Map(relevantInvoices.map((inv) => [String(inv.id || '').trim(), inv]));
  const invoiceByNo = new Map(relevantInvoices.map((inv) => [String(inv.invoiceNumber || '').trim(), inv]));
  const invoicesByPartyKey = buildInvoicesByPartyKey(kind, relevantInvoices);
  const partyIndex = buildSummaryPartyIndex(
    (kind === 'AR' ? customers : suppliers).map((p) => ({
      id: String(p.id || ''),
      name: String(p.name || ''),
      code: p.code,
      taxCode: p.taxCode,
    })),
  );
  const end = String(endDate);
  const raw: ArApMovementLine[] = [];
  for (const je of entries) {
    if (String(je.date) > end) continue;
    for (const d of journalEntryDetailsArray(je)) {
      const acc = String(d.account || '');
      if (!acc.startsWith(prefix)) continue;
      const objectKey = String(d.objectId || d.objectName || 'UNKNOWN');
      const sourceInvoiceId = String(d.sourceInvoiceId || '').trim();
      const sourceInvoiceNumber = String(d.sourceInvoiceNumber || '').trim();
      const directInvoice =
        (sourceInvoiceId ? invoiceById.get(sourceInvoiceId) : undefined) ||
        (sourceInvoiceNumber ? invoiceByNo.get(sourceInvoiceNumber) : undefined) ||
        invoiceById.get(String(objectKey || '').trim()) ||
        invoiceByNo.get(String(objectKey || '').trim()) ||
        undefined;
      const linkedInvoice = inferLegacyInvoiceForArApLine({
        kind,
        entry: je,
        detail: d,
        directInvoice,
        relevantInvoices,
        invoiceById,
        invoiceByNo,
        invoicesByPartyKey,
        partyIndex,
      });
      const invoiceNumber =
        sourceInvoiceNumber ||
        linkedInvoice?.invoiceNumber ||
        undefined;
      const debtSide =
        kind === 'AR' ? Math.round(Number(d.debit || 0)) : Math.round(Number(d.credit || 0));
      const paySide =
        kind === 'AR' ? Math.round(Number(d.credit || 0)) : Math.round(Number(d.debit || 0));
      if (!debtSide && !paySide) continue;
      const meta = enrichArApRowMeta(kind, objectKey, entries, endDate, invoices, customers, suppliers);
      raw.push({
        date: String(je.date),
        journalId: je.id,
        referenceId: String(je.referenceId || ''),
        invoiceNumber,
        description: String(je.description || ''),
        objectKey,
        displayName: meta.displayName,
        debtSide,
        paySide,
        runningBalance: 0,
      });
    }
  }
  raw.sort((a, b) => {
    const c = a.date.localeCompare(b.date);
    if (c !== 0) return c;
    return String(a.journalId).localeCompare(String(b.journalId));
  });
  const runMap = new Map<string, number>();
  for (const line of raw) {
    const prev = runMap.get(line.objectKey) || 0;
    const next = prev + line.debtSide - line.paySide;
    runMap.set(line.objectKey, next);
    line.runningBalance = next;
  }
  return raw;
}

function normParty(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Gợi ý hóa đơn bán để đối trừ khi lập phiếu thu (TK 131). */
export function suggestSalesInvoicesForReceipt(
  payerReceiver: string,
  invoices: Invoice[],
  customers: Customer[],
): Invoice[] {
  const pn = normParty(payerReceiver);
  if (pn.length < 2) return [];
  const matchedCustomerNames = new Set<string>();
  for (const c of customers) {
    const cn = normParty(c.name);
    if (!cn) continue;
    if (cn.includes(pn) || pn.includes(cn)) matchedCustomerNames.add(cn);
  }
  const pool = invoices.filter((inv) => {
    if (inv.type !== 'SALES') return false;
    const n1 = normParty(inv.customerName || '');
    const n2 = normParty(inv.buyerUnitName || '');
    if (pn && (n1.includes(pn) || pn.includes(n1) || n2.includes(pn) || pn.includes(n2))) return true;
    for (const cn of matchedCustomerNames) {
      if (n1.includes(cn) || cn.includes(n1) || n2.includes(cn) || cn.includes(n2)) return true;
    }
    return false;
  });
  pool.sort((a, b) => {
    const pa = a.status === 'PENDING' ? 0 : 1;
    const pb = b.status === 'PENDING' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return String(b.date).localeCompare(String(a.date));
  });
  return pool.slice(0, 12);
}

/** Gợi ý hóa đơn mua để đối trừ khi lập phiếu chi (TK 331). */
function parseISODateLocal(s: string): Date {
  const part = String(s || '').split('T')[0];
  const [y, m, d] = part.split('-').map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Ngày cuối cùng trước ngày bắt đầu niên độ đang chọn (để lấy số dư “cuối niên độ trước”). */
export function endOfPreviousFiscalYear(fy: Pick<FinancialYear, 'startDate'>): string {
  const s = parseISODateLocal(fy.startDate);
  if (Number.isNaN(s.getTime())) return '';
  s.setDate(s.getDate() - 1);
  return formatISODate(s);
}

/** Cuối tháng liền kề trước ngày tham chiếu. */
export function endOfPreviousCalendarMonth(isoDate: string): string {
  const d = parseISODateLocal(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  const lastPrev = new Date(d.getFullYear(), d.getMonth(), 0);
  return formatISODate(lastPrev);
}

/** Cuối quý liền kề trước quý chứa ngày tham chiếu. */
export function endOfPreviousCalendarQuarter(isoDate: string): string {
  const d = parseISODateLocal(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth();
  const q = Math.floor(m / 3);
  let py = y;
  let pmLast: number;
  if (q === 0) {
    py = y - 1;
    pmLast = 11;
  } else {
    py = y;
    pmLast = q * 3 - 1;
  }
  const lastDay = new Date(py, pmLast + 1, 0).getDate();
  const end = new Date(py, pmLast, lastDay);
  return formatISODate(end);
}

/** Gom các khóa đối tượng (KH + HĐ bán) khớp tên để cộng dồn TK 131. */
export function resolveArObjectKeysForParty(
  payerReceiver: string,
  invoices: Invoice[],
  customers: Customer[],
): Set<string> {
  const keys = new Set<string>();
  const pn = normParty(payerReceiver);
  if (pn.length < 2) return keys;
  const matchedCustomerNames = new Set<string>();
  for (const c of customers) {
    const cn = normParty(c.name);
    if (!cn) continue;
    if (cn.includes(pn) || pn.includes(cn)) matchedCustomerNames.add(cn);
  }
  for (const inv of invoices) {
    if (inv.type !== 'SALES') continue;
    const n1 = normParty(inv.customerName || '');
    const n2 = normParty(inv.buyerUnitName || '');
    let hit =
      (pn && (n1.includes(pn) || pn.includes(n1) || n2.includes(pn) || pn.includes(n2))) || false;
    if (!hit) {
      for (const cn of matchedCustomerNames) {
        if (n1.includes(cn) || cn.includes(n1) || n2.includes(cn) || cn.includes(n2)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) keys.add(inv.id);
  }
  for (const c of customers) {
    const cn = normParty(c.name);
    if (!cn) continue;
    if (cn.includes(pn) || pn.includes(cn)) keys.add(c.id);
  }
  return keys;
}

/** Gom các khóa đối tượng (NCC + HĐ mua) khớp tên để cộng dồn TK 331. */
export function resolveApObjectKeysForParty(
  payerReceiver: string,
  invoices: Invoice[],
  suppliers: Supplier[],
): Set<string> {
  const keys = new Set<string>();
  const pn = normParty(payerReceiver);
  if (pn.length < 2) return keys;
  for (const inv of invoices) {
    if (inv.type !== 'PURCHASE') continue;
    const n1 = normParty(inv.customerName || '');
    let hit = pn && (n1.includes(pn) || pn.includes(n1));
    if (!hit) {
      for (const s of suppliers) {
        const sn = normParty(s.name);
        if (!sn) continue;
        if (!(sn.includes(pn) || pn.includes(sn))) continue;
        if (n1.includes(sn) || sn.includes(n1)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) keys.add(inv.id);
  }
  for (const s of suppliers) {
    const sn = normParty(s.name);
    if (!sn) continue;
    if (sn.includes(pn) || pn.includes(sn)) keys.add(s.id);
  }
  return keys;
}

export function sumArApBalanceForObjectKeys(
  entries: JournalEntry[],
  endDate: string,
  kind: 'AR' | 'AP',
  keys: Set<string>,
): number {
  if (!endDate || keys.size === 0) return 0;
  const prefix = kind === 'AR' ? '131' : '331';
  const map = computeSubledgerNetByObject(entries, endDate, prefix);
  let s = 0;
  for (const k of keys) {
    const net = map.get(k) ?? 0;
    s += kind === 'AR' ? net : -net;
  }
  return Math.round(s);
}

export type PartyDebtPairsResult = {
  kind: 'AR' | 'AP';
  hasObjectMatch: boolean;
  pairs: Array<{
    scope: 'Niên độ' | 'Tháng' | 'Quý';
    prevLabel: string;
    prevDate: string;
    prevBalance: number;
    curLabel: string;
    curDate: string;
    curBalance: number;
  }>;
};

/**
 * So sánh số dư phải thu / phải trả tại các mốc: cuối niên độ trước vs đến ngày chứng từ,
 * cuối tháng trước vs đến ngày chứng từ, cuối quý trước vs đến ngày chứng từ (theo NKC).
 */
export function buildPartyDebtPairs(args: {
  kind: 'AR' | 'AP';
  partyName: string;
  asOfDate: string;
  financialYear: Pick<FinancialYear, 'startDate' | 'endDate'>;
  entries: JournalEntry[];
  invoices: Invoice[];
  customers: Customer[];
  suppliers: Supplier[];
}): PartyDebtPairsResult | null {
  const { kind, partyName, asOfDate, financialYear, entries, invoices, customers, suppliers } = args;
  const asOf = String(asOfDate || '').split('T')[0];
  if (normParty(partyName).length < 2 || !asOf) return null;

  const keys =
    kind === 'AR'
      ? resolveArObjectKeysForParty(partyName, invoices, customers)
      : resolveApObjectKeysForParty(partyName, invoices, suppliers);
  const hasObjectMatch = keys.size > 0;

  const bal = (end: string) => sumArApBalanceForObjectKeys(entries, end, kind, keys);

  const prevFyEnd = endOfPreviousFiscalYear(financialYear);
  const prevMoEnd = endOfPreviousCalendarMonth(asOf);
  const prevQEnd = endOfPreviousCalendarQuarter(asOf);

  const pairs: PartyDebtPairsResult['pairs'] = [
    {
      scope: 'Niên độ',
      prevLabel: 'Cuối niên độ trước',
      prevDate: prevFyEnd,
      prevBalance: prevFyEnd ? bal(prevFyEnd) : 0,
      curLabel: 'Đến ngày chứng từ (niên độ này)',
      curDate: asOf,
      curBalance: bal(asOf),
    },
    {
      scope: 'Tháng',
      prevLabel: 'Cuối tháng trước',
      prevDate: prevMoEnd,
      prevBalance: prevMoEnd ? bal(prevMoEnd) : 0,
      curLabel: 'Đến ngày chứng từ (tháng này)',
      curDate: asOf,
      curBalance: bal(asOf),
    },
    {
      scope: 'Quý',
      prevLabel: 'Cuối quý trước',
      prevDate: prevQEnd,
      prevBalance: prevQEnd ? bal(prevQEnd) : 0,
      curLabel: 'Đến ngày chứng từ (quý này)',
      curDate: asOf,
      curBalance: bal(asOf),
    },
  ];

  return { kind, hasObjectMatch, pairs };
}

export function suggestPurchaseInvoicesForPayment(
  payerReceiver: string,
  invoices: Invoice[],
  suppliers: Supplier[],
): Invoice[] {
  const pn = normParty(payerReceiver);
  if (pn.length < 2) return [];
  const pool = invoices.filter((inv) => {
    if (inv.type !== 'PURCHASE') return false;
    const n1 = normParty(inv.customerName || '');
    if (pn && (n1.includes(pn) || pn.includes(n1))) return true;
    for (const s of suppliers) {
      const sn = normParty(s.name);
      if (!sn) continue;
      if (!(sn.includes(pn) || pn.includes(sn))) continue;
      if (n1.includes(sn) || sn.includes(n1)) return true;
    }
    return false;
  });
  pool.sort((a, b) => {
    const pa = a.status === 'PENDING' ? 0 : 1;
    const pb = b.status === 'PENDING' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return String(b.date).localeCompare(String(a.date));
  });
  return pool.slice(0, 12);
}

export function collectSourceInvoiceIdsForSubledgerObject(
  entries: JournalEntry[],
  endDate: string,
  accountPrefix: string,
  objectKey: string,
): string[] {
  const ids = new Set<string>();
  const end = String(endDate);
  for (const je of entries) {
    if (String(je.date) > end) continue;
    for (const d of journalEntryDetailsArray(je)) {
      if (!String(d.account).startsWith(accountPrefix)) continue;
      const k = String(d.objectId || d.objectName || 'UNKNOWN');
      if (k !== objectKey) continue;
      const sid = String(d.sourceInvoiceId || '').trim();
      if (sid) ids.add(sid);
    }
  }
  return [...ids];
}

export function pickInvoiceForArApNavigation(
  objectKey: string,
  entries: JournalEntry[],
  endDate: string,
  accountPrefix: string,
  invoices: Invoice[],
  preferType: 'SALES' | 'PURCHASE',
): Invoice | null {
  const fromSources = collectSourceInvoiceIdsForSubledgerObject(entries, endDate, accountPrefix, objectKey)
    .map(id => invoices.find(i => String(i.id) === id))
    .filter(Boolean) as Invoice[];
  let pool = fromSources.filter(i => i.type === preferType);
  if (pool.length === 0 && objectKey !== 'UNKNOWN') {
    const direct = invoices.find(i => String(i.id) === objectKey && i.type === preferType);
    if (direct) pool = [direct];
  }
  if (pool.length === 0 && objectKey !== 'UNKNOWN') {
    pool = invoices.filter(i => {
      if (i.type !== preferType) return false;
      if (preferType === 'SALES') {
        return (
          i.customerName === objectKey ||
          i.buyerUnitName === objectKey ||
          (i.buyerLegalName && i.buyerLegalName === objectKey)
        );
      }
      return i.customerName === objectKey;
    });
  }
  if (pool.length === 0) return null;
  const pending = pool.filter(i => i.status === 'PENDING');
  const use = pending.length ? pending : pool;
  use.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return use[0] ?? null;
}

export type ArApNavTarget =
  | { mode: 'INVOICE'; invoiceId: string; listTab: 'OUTPUT_LIST' | 'INPUT_LIST' }
  | { mode: 'FUND'; fundId: string }
  | {
      mode: 'INVOICE_FILTER';
      searchTerm: string;
      directionFilter: 'SALES' | 'PURCHASE';
      listTab: 'OUTPUT_LIST' | 'INPUT_LIST';
    };

/** Ưu tiên: hóa đơn (theo sourceInvoiceId / id / tên) → phiếu Quỹ thu/chi khớp tên → mở tab HĐ với lọc. */
export function resolveArApNavTarget(
  kind: 'AR' | 'AP',
  row: Pick<ArApSubledgerRow, 'objectKey' | 'displayName'>,
  entries: JournalEntry[],
  endDate: string,
  invoices: Invoice[],
  fundTransactions: FundTransaction[],
): ArApNavTarget | null {
  const prefix = kind === 'AR' ? '131' : '331';
  const preferType = kind === 'AR' ? 'SALES' : 'PURCHASE';
  const inv = pickInvoiceForArApNavigation(row.objectKey, entries, endDate, prefix, invoices, preferType);
  if (inv) {
    return {
      mode: 'INVOICE',
      invoiceId: inv.id,
      listTab: inv.type === 'PURCHASE' ? 'INPUT_LIST' : 'OUTPUT_LIST',
    };
  }

  const norm = (s: string) => s.trim().toLowerCase();
  const dn = norm(row.displayName);
  if (!dn || row.objectKey === 'UNKNOWN') {
    return null;
  }

  const ftPool = fundTransactions.filter(t => {
    if (String(t.date) > String(endDate)) return false;
    if (norm(t.payerReceiver) !== dn) return false;
    if (kind === 'AR') return t.type === 'RECEIPT';
    return t.type === 'PAYMENT';
  });
  ftPool.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const ft = ftPool[0];
  if (ft) return { mode: 'FUND', fundId: ft.id };

  return {
    mode: 'INVOICE_FILTER',
    searchTerm: row.displayName.trim(),
    directionFilter: preferType,
    listTab: preferType === 'SALES' ? 'OUTPUT_LIST' : 'INPUT_LIST',
  };
}
