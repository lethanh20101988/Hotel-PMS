import type { AccountingRegimeConfig, FinancialYear, Invoice, JournalEntry, Tt58TaxBookProfile } from '../../types';
import { computeTt58TaxSummary } from './financialStatements';
import { usesTt58VatRevenueRateMethod } from './tt58IndustryCatalog';
import {
  buildTt58VatGroupLabel,
  collectTt58RevenueLinesFromInvoices,
  computeTt58GroupVat,
  planTt58IndustryLedgerSections,
} from './s1DnsnLedger';

export type Tt58S2aDnsnRowKind =
  | 'opening_vat'
  | 'period_header'
  | 'group_header'
  | 'detail'
  | 'group_subtotal'
  | 'group_vat'
  | 'footer_vat_payable'
  | 'footer_vat_paid'
  | 'footer_vat_closing';

export type Tt58S2aDnsnLedgerRow = {
  kind: Tt58S2aDnsnRowKind;
  docNo?: string;
  docDate?: string;
  description: string;
  amount?: number;
  bold?: boolean;
};

export type Tt58S2aDnsnLedgerData = {
  rows: Tt58S2aDnsnLedgerRow[];
  openingVatPayable: number;
  totalRevenue: number;
  totalVatPayable: number;
  vatPaid: number;
  closingVatPayable: number;
};

const usesVatRateMethod = (profile?: Tt58TaxBookProfile) =>
  profile === 'GTGT_RATE_TNDN_RATE' || profile === 'GTGT_RATE_TNDN_INCOME';

/** S2a-DNSN — sổ doanh thu và GTGT theo nhóm cùng % thuế GTGT. */
export function computeTt58S2aDnsnLedger(
  invoicesInput: Invoice[] | undefined | null,
  entriesInput: JournalEntry[] | undefined | null,
  financialYear: FinancialYear,
  profile?: Tt58TaxBookProfile,
  regime?: AccountingRegimeConfig,
): Tt58S2aDnsnLedgerData {
  const startDate = financialYear.startDate;
  const endDate = financialYear.endDate;
  const tax = computeTt58TaxSummary(entriesInput || [], financialYear);
  const useVatRevenueRate = usesTt58VatRevenueRateMethod(profile);
  const revenueLines = collectTt58RevenueLinesFromInvoices(
    Array.isArray(invoicesInput) ? invoicesInput : [],
    startDate,
    endDate,
    regime,
  );

  const groupStats = planTt58IndustryLedgerSections(revenueLines, regime, useVatRevenueRate);
  const totalRevenue = groupStats.reduce((s, g) => s + g.groupRevenue, 0);

  const rows: Tt58S2aDnsnLedgerRow[] = [
    {
      kind: 'opening_vat',
      description: 'Số thuế GTGT còn phải nộp đầu kỳ',
      amount: tax.openingVatPayable,
      bold: true,
    },
    { kind: 'period_header', description: 'Số phát sinh trong kỳ', bold: true },
  ];

  let totalVatFromGroups = 0;

  groupStats.forEach((g, groupIndex) => {
    const { vatRate, bucket, groupRevenue, groupVatInvoices } = g;
    const label = buildTt58VatGroupLabel(g, useVatRevenueRate);
    const sectionLetter = String.fromCharCode(65 + groupIndex);
    rows.push({ kind: 'group_header', description: `${sectionLetter}. ${label}`, bold: true });

    for (const line of bucket) {
      rows.push({
        kind: 'detail',
        docNo: line.docNo,
        docDate: line.docDate,
        description: line.description,
        amount: line.revenue,
      });
    }

    const groupVat = useVatRevenueRate
      ? (groupRevenue * vatRate) / 100
      : computeTt58GroupVat(profile, groupRevenue, groupVatInvoices, totalRevenue, tax.vatOutput);

    rows.push({
      kind: 'group_subtotal',
      description: 'Tổng cộng (1)',
      amount: groupRevenue,
      bold: true,
    });
    rows.push({ kind: 'group_vat', description: 'Thuế GTGT', amount: groupVat });
    totalVatFromGroups += groupVat;
  });

  if (groupStats.length === 0) {
    rows.push({
      kind: 'group_header',
      description: '1. Nhóm hàng hóa, dịch vụ, ngành nghề (chưa có hóa đơn bán hàng trong kỳ)',
      bold: true,
    });
  }

  const totalVatPayable = usesVatRateMethod(profile)
    ? (totalVatFromGroups > 0 ? totalVatFromGroups : tax.vatOutput)
    : tax.vatOutput;
  const closingVatPayable =
    tax.openingVatPayable + totalVatPayable - tax.vatPaid;

  rows.push({
    kind: 'footer_vat_payable',
    description: 'Tổng số thuế GTGT phải nộp trong kỳ',
    amount: totalVatPayable,
    bold: true,
  });
  rows.push({
    kind: 'footer_vat_paid',
    description: 'Số thuế GTGT đã nộp trong kỳ',
    amount: tax.vatPaid,
    bold: true,
  });
  rows.push({
    kind: 'footer_vat_closing',
    description: 'Số thuế GTGT còn phải nộp cuối kỳ',
    amount: closingVatPayable,
    bold: true,
  });

  return {
    rows,
    openingVatPayable: tax.openingVatPayable,
    totalRevenue,
    totalVatPayable,
    vatPaid: tax.vatPaid,
    closingVatPayable,
  };
}

export function tt58S2aDnsnRowsToTable(
  data: Tt58S2aDnsnLedgerData,
  formatAmount: (value: number) => string,
): (string | number)[][] {
  return data.rows.map((row) => {
    if (row.kind === 'detail') {
      return [row.docNo || '', row.docDate || '', row.description, formatAmount(Number(row.amount || 0))];
    }
    if (row.amount != null && Number.isFinite(row.amount)) {
      return ['', '', row.description, formatAmount(row.amount)];
    }
    return ['', '', row.description, ''];
  });
}
