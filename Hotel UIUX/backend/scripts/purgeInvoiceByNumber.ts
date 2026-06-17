/**
 * Gỡ hóa đơn theo số hiển thị (vd. "6") khỏi AppState: mọi bucket yearDataByKey + mảng gốc.
 * Chạy:  DATABASE_URL="file:/path/to/dev.db"  npx tsx scripts/purgeInvoiceByNumber.ts 6
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type AnyRec = Record<string, unknown>;

const parseTrxSerialsForPurge = (s?: string) =>
  (s || '')
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

const numQtyPurge = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const roundInvQtyPurge = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0);

function stripImportPeersFromInventorySnapshot(items: AnyRec[] | undefined, importPeers: AnyRec[]): AnyRec[] {
  const list = (items || []).map((it) => ({
    ...it,
    serials: [...((it.serials as string[]) || [])],
    serialDetails: [...((it.serialDetails as AnyRec[]) || [])].map((d) => ({ ...d })),
  }));
  for (const t of importPeers) {
    if (t.type !== 'IMPORT') continue;
    const idx = list.findIndex((i) => i.id === t.itemId);
    if (idx === -1) continue;
    const item = list[idx];
    const serialList = parseTrxSerialsForPurge(t.serials as string);
    const currents = (item.serials as string[]) || [];
    const details = (item.serialDetails as AnyRec[]) || [];
    const onHand = numQtyPurge(item.quantity);
    const need = numQtyPurge(t.quantity);
    const nextQty = Math.max(0, roundInvQtyPurge(onHand - need));
    const nextSerials =
      serialList.length > 0 ? currents.filter((s) => !serialList.includes(s)) : currents;
    const nextDetails =
      serialList.length > 0 ? details.filter((sd) => !serialList.includes(String(sd.serial))) : details;
    list[idx] = { ...item, quantity: nextQty, serials: nextSerials, serialDetails: nextDetails };
  }
  return list;
}

function stripOrphanSerialsFromInventory(items: AnyRec[] | undefined, importPeers: AnyRec[]): AnyRec[] {
  const serialList = importPeers.flatMap((t) =>
    t.type === 'IMPORT' ? parseTrxSerialsForPurge(t.serials as string) : [],
  );
  if (serialList.length === 0) return items || [];
  const drop = new Set(serialList);
  return (items || []).map((it) => ({
    ...it,
    serials: ((it.serials as string[]) || []).filter((s) => !drop.has(s)),
    serialDetails: ((it.serialDetails as AnyRec[]) || []).filter((sd) => !drop.has(String(sd.serial))),
  }));
}

function purgeWarehouseArtifactFromYearDataSlice(
  yd: AnyRec,
  args: {
    peerIds: Set<string>;
    peerTrxs: AnyRec[];
    batchId: string;
    trxId: string;
    headType?: string;
    ref: string;
    sourceRef: string;
    voucherRef: string;
  },
): AnyRec {
  const { peerIds, peerTrxs, batchId, trxId, headType, ref, sourceRef, voucherRef } = args;
  const head = peerTrxs[0];
  const importPeers = peerTrxs.filter((t) => t.type === 'IMPORT');
  const hadPeerTrx = ((yd.transactions as AnyRec[]) || []).some((t) => peerIds.has(String(t.id)));

  let nextTransactions = ((yd.transactions as AnyRec[]) || []).filter((t) => !peerIds.has(String(t.id)));
  let nextInvoices = [...((yd.invoices as AnyRec[]) || [])];
  let nextJe = [...((yd.journalEntries as AnyRec[]) || [])];
  let nextFt = [...((yd.fundTransactions as AnyRec[]) || [])];
  let nextV = [...((yd.accountingVouchers as AnyRec[]) || [])];
  let nextInv = [...((yd.inventory as AnyRec[]) || [])];

  if (batchId && head) {
    const vn = String(head.voucherNumber || '');
    const dr = String(head.documentRef || '');
    const ht = headType || head.type;
    if (ht === 'IMPORT') {
      const invPurId = `INV-PUR-BATCH-${batchId}`;
      const vouId = `VOU-INV-${invPurId}`;
      nextInvoices = nextInvoices.filter((inv) => inv.id !== invPurId);
      nextV = nextV.filter((v) => v.id !== vouId);
      nextJe = nextJe.filter((je) => {
        const jid = String(je.id || '');
        const jref = String(je.referenceId || '');
        if (jid === `JE-IM-BATCH-${batchId}`) return false;
        if (jid === `JE-VOU-${vouId}`) return false;
        if (vn && jref === vn) return false;
        if (dr && jref === dr) return false;
        return true;
      });
      nextFt = nextFt.filter((ft) => {
        const fid = String(ft.id || '');
        if (fid === `FT-PUR-BATCH-${batchId}`) return false;
        if (fid === `FT-INV-${invPurId}`) return false;
        if (vn && (ft.referenceDoc === vn || ft.voucherNumber === vn)) return false;
        if (dr && ft.referenceDoc === dr) return false;
        return true;
      });
    } else {
      const invSalId = `INV-SALES-BATCH-${batchId}`;
      const vouId = `VOU-INV-${invSalId}`;
      nextInvoices = nextInvoices.filter((inv) => inv.id !== invSalId);
      nextV = nextV.filter((v) => v.id !== vouId);
      nextJe = nextJe.filter((je) => {
        const jid = String(je.id || '');
        const jref = String(je.referenceId || '');
        if (jid === `JE-EX-COST-BATCH-${batchId}`) return false;
        if (jid === `JE-EX-REV-BATCH-${batchId}`) return false;
        if (jid === `JE-VOU-${vouId}`) return false;
        if (vn && jref === vn) return false;
        if (dr && jref === dr) return false;
        return true;
      });
      nextFt = nextFt.filter((ft) => {
        const fid = String(ft.id || '');
        if (fid === `FT-SALES-BATCH-${batchId}`) return false;
        if (fid === `FT-INV-${invSalId}`) return false;
        if (vn && (ft.referenceDoc === vn || ft.voucherNumber === vn)) return false;
        if (dr && ft.referenceDoc === dr) return false;
        return true;
      });
    }
  } else if (head) {
    const ht = headType || head.type;
    const linkedInvId = ht === 'IMPORT' ? `INV-PUR-${trxId}` : `INV-SALES-${trxId}`;
    const linkedVouId = `VOU-INV-${linkedInvId}`;
    nextInvoices = nextInvoices.filter((inv) => {
      if (!inv) return true;
      const invNo = String((inv as AnyRec).invoiceNumber || '');
      if (invNo === ref || (sourceRef && invNo === sourceRef) || (voucherRef && invNo === voucherRef))
        return false;
      if (inv.id === linkedInvId) return false;
      return true;
    });
    nextV = nextV.filter((v) => v.id !== linkedVouId);
    nextJe = nextJe.filter((je) => {
      if (
        je.referenceId === ref ||
        je.referenceId === sourceRef ||
        je.referenceId === voucherRef ||
        je.referenceId === trxId
      )
        return false;
      if (je.id === `JE-IM-${trxId}`) return false;
      if (je.id === `JE-EX-COST-${trxId}`) return false;
      if (je.id === `JE-EX-REV-${trxId}`) return false;
      if (je.id === `JE-VOU-${linkedVouId}`) return false;
      return true;
    });
    nextFt = nextFt.filter((ft) => {
      if (
        ft.referenceDoc === ref ||
        ft.referenceDoc === sourceRef ||
        ft.referenceDoc === voucherRef ||
        ft.voucherNumber === ref ||
        ft.voucherNumber === voucherRef ||
        ft.referenceDoc === trxId
      )
        return false;
      if (ft.id === `FT-PUR-${trxId}`) return false;
      if (ft.id === `FT-SALES-${trxId}`) return false;
      if (ft.id === `FT-INV-${linkedInvId}`) return false;
      return true;
    });
  }

  if (importPeers.length) {
    if (hadPeerTrx) nextInv = stripImportPeersFromInventorySnapshot(nextInv, importPeers);
    else nextInv = stripOrphanSerialsFromInventory(nextInv, importPeers);
  }

  return {
    ...yd,
    transactions: nextTransactions,
    invoices: nextInvoices,
    journalEntries: nextJe,
    fundTransactions: nextFt,
    accountingVouchers: nextV,
    inventory: nextInv,
  };
}

function purgeStandaloneFromSlice(yd: AnyRec, invId: string, invoiceRef: string): AnyRec {
  const voucherId = `VOU-INV-${invId}`;
  const separatePaymentVoucherId = `VOU-INV-PAY-${invId}`;
  const invoiceRefEqualsId = !invoiceRef || invoiceRef === invId;
  const voucherRefs = new Set([
    voucherId,
    separatePaymentVoucherId,
    `UNC-${invoiceRef}`,
    `PC-${invoiceRef}`,
    `BC-${invoiceRef}`,
    `PT-${invoiceRef}`,
  ]);

  const shouldDeleteJournal = (je: AnyRec) => {
    const jeId = String(je?.id || '');
    const jeRef = String(je?.referenceId || '');
    const jeDesc = String(je?.description || '');
    if (jeId === `JE-INV-${invId}`) {
      if (invoiceRefEqualsId) return true;
      return jeRef === invoiceRef || jeDesc.includes(invoiceRef);
    }
    if (jeId.startsWith(`JE-PAY-INV-${invId}-`)) {
      if (invoiceRefEqualsId) return true;
      return jeRef === invoiceRef || jeDesc.includes(invoiceRef);
    }
    if (jeId === `JE-VOU-${voucherId}`) {
      if (invoiceRefEqualsId) return true;
      return voucherRefs.has(jeRef) || jeDesc.includes(invoiceRef);
    }
    if (jeId === `JE-VOU-${separatePaymentVoucherId}`) {
      if (invoiceRefEqualsId) return true;
      return voucherRefs.has(jeRef) || jeDesc.includes(invoiceRef);
    }
    return false;
  };

  const shouldDeleteFund = (ft: AnyRec) => {
    const ftId = String(ft?.id || '');
    const ftRef = String(ft?.referenceDoc || '');
    const ftDesc = String(ft?.description || '');
    if (ftId === `FT-INV-${invId}`) {
      if (invoiceRefEqualsId) return true;
      return ftRef === invoiceRef || ftDesc.includes(invoiceRef);
    }
    if (ftId === `FT-INV-PAY-${invId}`) {
      if (invoiceRefEqualsId) return true;
      return ftRef === invoiceRef || ftDesc.includes(invoiceRef);
    }
    if (ftId.startsWith(`FT-PAY-${invId}-`)) {
      if (invoiceRefEqualsId) return true;
      return ftRef === invoiceRef || ftDesc.includes(invoiceRef);
    }
    return false;
  };

  const shouldDeleteVoucher = (v: AnyRec) => {
    const vId = String(v?.id || '');
    const vNo = String(v?.voucherNumber || '');
    const vDesc = String(v?.description || '');
    if (vId !== voucherId && vId !== separatePaymentVoucherId) return false;
    if (invoiceRefEqualsId) return true;
    return voucherRefs.has(vNo) || vDesc.includes(invoiceRef);
  };

  return {
    ...yd,
    invoices: ((yd.invoices as AnyRec[]) || []).filter((i) => String(i.id) !== invId),
    journalEntries: ((yd.journalEntries as AnyRec[]) || []).filter((je) => !shouldDeleteJournal(je)),
    fundTransactions: ((yd.fundTransactions as AnyRec[]) || []).filter((ft) => !shouldDeleteFund(ft)),
    accountingVouchers: ((yd.accountingVouchers as AnyRec[]) || []).filter((v) => !shouldDeleteVoucher(v)),
  };
}

function collectInvoices(state: AnyRec): AnyRec[] {
  const out: AnyRec[] = [];
  const ybk = state.yearDataByKey as Record<string, AnyRec> | undefined;
  if (ybk && typeof ybk === 'object') {
    for (const yd of Object.values(ybk)) {
      for (const inv of (yd.invoices as AnyRec[]) || []) out.push(inv);
    }
  }
  for (const inv of (state.invoices as AnyRec[]) || []) out.push(inv);
  return out;
}

function collectAllTransactions(state: AnyRec): AnyRec[] {
  const out: AnyRec[] = [];
  const ybk = state.yearDataByKey as Record<string, AnyRec> | undefined;
  if (ybk && typeof ybk === 'object') {
    for (const yd of Object.values(ybk)) {
      for (const t of (yd.transactions as AnyRec[]) || []) out.push(t);
    }
  }
  for (const t of (state.transactions as AnyRec[]) || []) out.push(t);
  return out;
}

function dedupeById<T extends { id?: unknown }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(String(r.id), r);
  return Array.from(m.values());
}

async function main() {
  const target = String(process.argv[2] || '6').trim();
  const row = await prisma.appState.findUnique({ where: { id: 1 } });
  if (!row?.data) {
    console.error('Không có AppState trong DB.');
    process.exit(1);
  }

  const state = JSON.parse(JSON.stringify(row.data)) as AnyRec;
  const allInv = collectInvoices(state);
  const matches = dedupeById(
    allInv.filter((inv) => String(inv.invoiceNumber || '').trim() === target),
  );

  if (matches.length === 0) {
    console.error(`Không tìm thấy hóa đơn số «${target}» trong state.`);
    process.exit(1);
  }

  console.log(
    'Khớp:',
    matches.map((i) => ({ id: i.id, type: i.type, date: i.date })),
  );

  const seenInv = new Set<string>();
  const allTx = collectAllTransactions(state);
  let ybk = (state.yearDataByKey as Record<string, AnyRec>) || {};

  for (const inv of matches) {
    const invId = String(inv.id);
    if (seenInv.has(invId)) continue;
    seenInv.add(invId);

    const invoiceRef = String(inv.invoiceNumber || invId || '').trim();

    const mPurBatch = invId.match(/^INV-PUR-BATCH-(.+)$/);
    const mSalBatch = invId.match(/^INV-SALES-BATCH-(.+)$/);
    const batchId = String((mPurBatch?.[1] || mSalBatch?.[1] || '').trim());

    const purgeRootWarehouse = (peerTrxs: AnyRec[], bId: string, trxId0: string, head: AnyRec) => {
      const peerIds = new Set(peerTrxs.map((p) => String(p.id)));
      const ref = String(head.voucherNumber || head.documentRef || invoiceRef);
      const sourceRef = String(head.documentRef || '');
      const voucherRef = String(head.voucherNumber || '');
      const rootYd: AnyRec = {
        invoices: state.invoices || [],
        transactions: state.transactions || [],
        journalEntries: state.journalEntries || [],
        fundTransactions: state.fundTransactions || [],
        accountingVouchers: state.accountingVouchers || [],
        inventory: state.inventory || [],
      };
      const purgedRoot = purgeWarehouseArtifactFromYearDataSlice(JSON.parse(JSON.stringify(rootYd)), {
        peerIds,
        peerTrxs: peerTrxs.map((x) => ({ ...x })),
        batchId: bId,
        trxId: trxId0,
        headType: String(head.type || 'IMPORT'),
        ref,
        sourceRef,
        voucherRef,
      });
      state.invoices = (purgedRoot.invoices as AnyRec[]) || [];
      state.transactions = (purgedRoot.transactions as AnyRec[]) || [];
      state.journalEntries = (purgedRoot.journalEntries as AnyRec[]) || [];
      state.fundTransactions = (purgedRoot.fundTransactions as AnyRec[]) || [];
      state.accountingVouchers = (purgedRoot.accountingVouchers as AnyRec[]) || [];
      state.inventory = (purgedRoot.inventory as AnyRec[]) || [];
    };

    if (batchId) {
      const peerTrxs = dedupeById(
        allTx.filter((t) => String((t as AnyRec).batchId || '').trim() === batchId),
      );
      if (peerTrxs.length === 0) {
        console.warn(`Batch ${batchId}: không tìm thấy phiếu kho — vẫn gỡ HĐ/chứng từ theo batch trong các bucket.`);
      }
      const peerIds = new Set(peerTrxs.map((p) => String(p.id)));
      const head = peerTrxs[0] || { type: 'IMPORT', voucherNumber: '', documentRef: invoiceRef };
      const ref = String(head.voucherNumber || head.documentRef || invoiceRef);
      const sourceRef = String(head.documentRef || '');
      const voucherRef = String(head.voucherNumber || '');
      const trxId = String((head as AnyRec).id || '');

      for (const k of Object.keys(ybk)) {
        ybk[k] = purgeWarehouseArtifactFromYearDataSlice(JSON.parse(JSON.stringify(ybk[k] || {})), {
          peerIds,
          peerTrxs: peerTrxs.map((x) => ({ ...x })),
          batchId,
          trxId,
          headType: String(head.type || 'IMPORT'),
          ref,
          sourceRef,
          voucherRef,
        });
      }

      purgeRootWarehouse(peerTrxs, batchId, trxId, head);
      state.yearDataByKey = ybk;
      continue;
    }

    const mTrx = invId.match(/^INV-(PUR|SALES)-(TRX-[A-Za-z0-9-]+)/);
    const trxIdOnly = mTrx?.[2] || '';
    if (trxIdOnly) {
      const peerTrxs = allTx.filter((t) => String(t.id) === trxIdOnly);
      const peerIds = new Set(peerTrxs.map((p) => String(p.id)));
      const head = peerTrxs[0];
      if (head) {
        const ref = String(head.voucherNumber || head.documentRef || invoiceRef);
        const sourceRef = String(head.documentRef || '');
        const voucherRef = String(head.voucherNumber || '');
        for (const k of Object.keys(ybk)) {
          ybk[k] = purgeWarehouseArtifactFromYearDataSlice(JSON.parse(JSON.stringify(ybk[k] || {})), {
            peerIds,
            peerTrxs: peerTrxs.map((x) => ({ ...x })),
            batchId: '',
            trxId: trxIdOnly,
            headType: String(head.type || 'IMPORT'),
            ref,
            sourceRef,
            voucherRef,
          });
        }
        purgeRootWarehouse(peerTrxs, '', trxIdOnly, head);
      }
      state.invoices = ((state.invoices as AnyRec[]) || []).filter((i) => i.id !== invId);
      state.yearDataByKey = ybk;
      continue;
    }

    for (const k of Object.keys(ybk)) {
      ybk[k] = purgeStandaloneFromSlice(JSON.parse(JSON.stringify(ybk[k] || {})), invId, invoiceRef);
    }
    const rootStandalone: AnyRec = {
      invoices: state.invoices || [],
      journalEntries: state.journalEntries || [],
      fundTransactions: state.fundTransactions || [],
      accountingVouchers: state.accountingVouchers || [],
    };
    const pRoot = purgeStandaloneFromSlice(rootStandalone, invId, invoiceRef);
    state.invoices = (pRoot.invoices as AnyRec[]) || [];
    state.journalEntries = (pRoot.journalEntries as AnyRec[]) || [];
    state.fundTransactions = (pRoot.fundTransactions as AnyRec[]) || [];
    state.accountingVouchers = (pRoot.accountingVouchers as AnyRec[]) || [];
    state.yearDataByKey = ybk;
  }

  await prisma.appState.update({
    where: { id: 1 },
    data: { data: JSON.parse(JSON.stringify(state)) },
  });

  console.log('Đã cập nhật AppState — đã gỡ hóa đơn và dữ liệu liên quan (mọi niên độ + mảng gốc).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
