import type { AccountingRegimeConfig, Invoice, InvoiceDetail, Tt58TaxBookProfile } from '../../types';

export type Tt58IndustryGroupCode = 'A' | 'B' | 'C' | 'D';

type Tt58IndustryDefinition = {
  id: string;
  group: Tt58IndustryGroupCode;
  name: string;
  example: string;
  /** Thuế GTGT theo tỷ lệ % doanh thu (S1/S2a). */
  vatRevenueRatePercent: number;
  /** Thuế TNDN theo tỷ lệ % doanh thu (S1/S3a). */
  citRevenueRatePercent: number;
  keywords: string[];
};

export const TT58_INDUSTRY_GROUP_ORDER: Tt58IndustryGroupCode[] = ['A', 'B', 'C', 'D'];

export const TT58_INDUSTRY_GROUP_META: Record<
  Tt58IndustryGroupCode,
  { title: string; hint: string; badgeClass: string }
> = {
  A: {
    title: 'Nhóm A',
    hint: 'Phân phối, cung cấp hàng hóa — GTGT 1%, TNDN 1% doanh thu',
    badgeClass: 'bg-sky-100 text-sky-900 ring-sky-200/80',
  },
  B: {
    title: 'Nhóm B',
    hint: 'Dịch vụ, xây dựng không bao thầu nguyên vật liệu — GTGT 5%, TNDN 5% doanh thu',
    badgeClass: 'bg-violet-100 text-violet-900 ring-violet-200/80',
  },
  C: {
    title: 'Nhóm C',
    hint: 'Sản xuất, vận tải, dịch vụ gắn hàng hóa, xây dựng có vật tư — GTGT 3%, TNDN 2% doanh thu',
    badgeClass: 'bg-emerald-100 text-emerald-900 ring-emerald-200/80',
  },
  D: {
    title: 'Nhóm D',
    hint: 'Hoạt động kinh doanh khác — GTGT 2%, TNDN 1% doanh thu',
    badgeClass: 'bg-amber-100 text-amber-900 ring-amber-200/80',
  },
};

/** Bảng ngành nghề thực tế — TT58/2026 (DNSN, tỷ lệ % trên doanh thu). */
const TT58_INDUSTRY_CATALOG: Tt58IndustryDefinition[] = [
  {
    id: 'wholesale_retail',
    group: 'A',
    name: 'Bán buôn, bán lẻ',
    example: 'Thiết bị, tạp hóa, shop quần áo',
    vatRevenueRatePercent: 1,
    citRevenueRatePercent: 1,
    keywords: ['ban buon', 'ban le', 'tap hoa', 'sieu thi', 'phan phoi', 'cua hang', 'shop', 'quan ao'],
  },
  {
    id: 'ecommerce',
    group: 'A',
    name: 'Thương mại điện tử',
    example: 'Shopee, Lazada, TikTok Shop',
    vatRevenueRatePercent: 1,
    citRevenueRatePercent: 1,
    keywords: ['thuong mai dien tu', 'ecommerce', 'shopee', 'lazada', 'tiktok shop', 'sàn'],
  },
  {
    id: 'consulting_brokerage',
    group: 'B',
    name: 'Tư vấn, môi giới',
    example: 'Tư vấn, môi giới, đại lý dịch vụ',
    vatRevenueRatePercent: 5,
    citRevenueRatePercent: 5,
    keywords: ['tu van', 'moi gioi', 'dai ly dich vu', 'consulting', 'broker'],
  },
  {
    id: 'personal_service',
    group: 'B',
    name: 'Dịch vụ cá nhân',
    example: 'Cắt tóc, làm đẹp, chăm sóc cá nhân',
    vatRevenueRatePercent: 5,
    citRevenueRatePercent: 5,
    keywords: ['cat toc', 'lam dep', 'cham soc ca nhan', 'salon', 'nail'],
  },
  {
    id: 'construction_labor',
    group: 'B',
    name: 'Xây dựng không bao thầu nguyên vật liệu',
    example: 'Thi công xây lắp nhân công',
    vatRevenueRatePercent: 5,
    citRevenueRatePercent: 5,
    keywords: ['xay dung khong vat tu', 'khong bao thau nguyen vat lieu', 'nhan cong', 'thi cong nhan cong'],
  },
  {
    id: 'transport',
    group: 'C',
    name: 'Vận tải',
    example: 'Vận tải hành khách, hàng hóa',
    vatRevenueRatePercent: 3,
    citRevenueRatePercent: 2,
    keywords: ['van tai', 'van chuyen', 'giao hang', 'xe khach', 'hang hoa', 'logistics van'],
  },
  {
    id: 'software',
    group: 'B',
    name: 'Dịch vụ phần mềm',
    example: 'SaaS, app, bảo trì phần mềm',
    vatRevenueRatePercent: 5,
    citRevenueRatePercent: 5,
    keywords: ['phan mem', 'software', 'saas', 'app', 'phan mem', 'license'],
  },
  {
    id: 'repair_service',
    group: 'B',
    name: 'Dịch vụ sửa chữa',
    example: 'Sửa chữa máy móc thiết bị, điện lạnh',
    vatRevenueRatePercent: 5,
    citRevenueRatePercent: 5,
    keywords: ['sua chua', 'may moc', 'thiet bi', 'gara', 'dien lanh', 'bao tri', 'service'],
  },
  {
    id: 'spa_beauty',
    group: 'B',
    name: 'Spa, làm đẹp',
    example: 'Thẩm mỹ',
    vatRevenueRatePercent: 5,
    citRevenueRatePercent: 5,
    keywords: ['spa', 'lam dep', 'tham my', 'salon', 'nail'],
  },
  {
    id: 'restaurant',
    group: 'C',
    name: 'Nhà hàng, ăn uống',
    example: 'Quán ăn, cafe, dịch vụ kèm hàng hóa',
    vatRevenueRatePercent: 3,
    citRevenueRatePercent: 2,
    keywords: ['nha hang', 'an uong', 'quan an', 'f&b', 'cafe', 'coffee', 'dich vu gan voi hang hoa'],
  },
  {
    id: 'manufacturing',
    group: 'C',
    name: 'Sản xuất',
    example: 'May mặc gia công, xưởng mộc, cơ khí',
    vatRevenueRatePercent: 3,
    citRevenueRatePercent: 2,
    keywords: ['san xuat', 'may mac', 'xuong moc', 'co khi', 'che tao', 'nha may'],
  },
  {
    id: 'processing',
    group: 'C',
    name: 'Gia công',
    example: 'CNC, in ấn',
    vatRevenueRatePercent: 3,
    citRevenueRatePercent: 2,
    keywords: ['gia cong', 'cnc', 'in an', 'gia cong'],
  },
  {
    id: 'construction_material',
    group: 'C',
    name: 'Xây dựng có bao thầu nguyên vật liệu',
    example: 'Nhà thầu lo vật tư và nhân công',
    vatRevenueRatePercent: 3,
    citRevenueRatePercent: 2,
    keywords: ['xay dung co vat tu', 'bao thau nguyen vat lieu', 'tron goi', 'cong trinh', 'vat tu xay dung'],
  },
  {
    id: 'logistics_goods',
    group: 'C',
    name: 'Logistics có hàng hóa',
    example: 'Kho + vận chuyển',
    vatRevenueRatePercent: 3,
    citRevenueRatePercent: 2,
    keywords: ['logistics', 'kho', 'van chuyen hang', '3pl', 'fulfillment'],
  },
  {
    id: 'other_business',
    group: 'D',
    name: 'Hoạt động kinh doanh khác',
    example: 'Ngành hỗn hợp chưa phân loại vào nhóm A/B/C',
    vatRevenueRatePercent: 2,
    citRevenueRatePercent: 1,
    keywords: ['khac', 'hon hop', 'chua phan loai', 'kinh doanh khac', 'other'],
  },
];

const catalogById = new Map(TT58_INDUSTRY_CATALOG.map((row) => [row.id, row]));

const foldVi = (text: string) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim();

export const getTt58IndustryById = (id: string | undefined | null): Tt58IndustryDefinition | null => {
  const key = String(id || '').trim();
  return key ? catalogById.get(key) || null : null;
};

/** Danh sách ngành đã khai báo (gộp mảng mới + id đơn lẻ cũ). */
export const getTt58PrimaryIndustryIds = (regime?: AccountingRegimeConfig): string[] => {
  const merged: string[] = [];
  const push = (id: string) => {
    const hit = getTt58IndustryById(id);
    if (hit && !merged.includes(hit.id)) merged.push(hit.id);
  };
  if (Array.isArray(regime?.tt58PrimaryIndustryIds)) {
    for (const id of regime.tt58PrimaryIndustryIds) push(String(id || '').trim());
  }
  push(String(regime?.tt58PrimaryIndustryId || '').trim());
  return merged;
};

const getTt58IndustriesForResolution = (regime?: AccountingRegimeConfig): Tt58IndustryDefinition[] => {
  const ids = getTt58PrimaryIndustryIds(regime);
  if (ids.length === 0) return TT58_INDUSTRY_CATALOG;
  return ids.map((id) => getTt58IndustryById(id)).filter((x): x is Tt58IndustryDefinition => !!x);
};

const scoreIndustryHaystack = (row: Tt58IndustryDefinition, haystack: string): number => {
  let score = 0;
  for (const kw of row.keywords) {
    const k = foldVi(kw);
    if (k && haystack.includes(k)) score += k.length >= 6 ? 3 : 2;
  }
  if (foldVi(row.name).length > 2 && haystack.includes(foldVi(row.name))) score += 4;
  return score;
};

const pickFallbackTt58Industry = (
  inv: Invoice,
  detail: InvoiceDetail | undefined,
  pool: Tt58IndustryDefinition[],
): Tt58IndustryDefinition => {
  if (pool.length === 1) return pool[0];
  const lineType = String(detail?.type || '').toUpperCase();
  const preferGroup = (g: Tt58IndustryGroupCode) => pool.find((r) => r.group === g);

  if (lineType === 'SERVICE' || inv.category === 'SERVICE') {
    return preferGroup('B') || pool.find((r) => r.group === 'B') || pool[0];
  }
  if (lineType === 'GOODS' || lineType === 'PRODUCT' || lineType === 'MATERIAL') {
    return preferGroup('A') || preferGroup('C') || pool[0];
  }
  if (inv.category === 'DEVICE') {
    return preferGroup('C') || pool[0];
  }
  const byGroupOrder = TT58_INDUSTRY_GROUP_ORDER.map((g) => pool.find((r) => r.group === g)).filter(Boolean);
  return byGroupOrder[0] || pool[0];
};

export const usesTt58VatRevenueRateMethod = (profile?: Tt58TaxBookProfile) =>
  profile === 'GTGT_RATE_TNDN_RATE' || profile === 'GTGT_RATE_TNDN_INCOME';

export const usesTt58CitRevenueRateMethod = (profile?: Tt58TaxBookProfile) =>
  profile === 'GTGT_RATE_TNDN_RATE' || profile === 'GTGT_DEDUCT_TNDN_RATE';

/** Phân loại ngành từ tên hàng/dịch vụ, loại dòng, ngành mặc định hệ thống. */
export const resolveTt58IndustryForInvoiceLine = (
  inv: Invoice,
  detail: InvoiceDetail | undefined,
  regime?: AccountingRegimeConfig,
): Tt58IndustryDefinition => {
  const explicitId = String(detail?.tt58IndustryId || inv.tt58IndustryId || '').trim();
  if (explicitId) {
    const hit = getTt58IndustryById(explicitId);
    if (hit) return hit;
  }

  const pool = getTt58IndustriesForResolution(regime);
  const haystack = foldVi(
    [
      detail?.productName,
      detail?.note,
      inv.description,
      inv.customerName,
      detail?.type,
      inv.category,
    ]
      .filter(Boolean)
      .join(' '),
  );

  let best: Tt58IndustryDefinition | null = null;
  let bestScore = 0;
  for (const row of pool) {
    const score = scoreIndustryHaystack(row, haystack);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (best && bestScore > 0) return best;

  const configured = getTt58PrimaryIndustryIds(regime);
  if (configured.length > 0) {
    return pickFallbackTt58Industry(inv, detail, pool);
  }

  const lineType = String(detail?.type || '').toUpperCase();
  if (lineType === 'SERVICE' || inv.category === 'SERVICE') {
    return getTt58IndustryById('software')!;
  }
  if (lineType === 'GOODS' || lineType === 'PRODUCT' || lineType === 'MATERIAL') {
    return getTt58IndustryById('wholesale_retail')!;
  }
  if (inv.category === 'DEVICE') {
    return getTt58IndustryById('manufacturing')!;
  }
  return getTt58IndustryById('processing')!;
};

export const applyTt58IndustryToSalesInvoice = (
  invoice: Invoice,
  regime?: AccountingRegimeConfig,
): Invoice => {
  if (invoice.type !== 'SALES' || regime?.standard !== 'TT58_2026') return invoice;

  const details = (invoice.details || []).map((d) => {
    const industry = resolveTt58IndustryForInvoiceLine(invoice, d, regime);
    const vatRevenueRatePercent = industry.vatRevenueRatePercent;
    const citRevenueRatePercent = industry.citRevenueRatePercent;
    const amount = Number(d.amount || 0);
    const useRateVat = usesTt58VatRevenueRateMethod(regime.tt58TaxBookProfile);
    const vatRate = useRateVat ? 0 : Number(d.vatRate || 0);
    const vatAmount = useRateVat
      ? Math.round((amount * vatRevenueRatePercent) / 100)
      : Number(d.vatAmount || 0);
    return {
      ...d,
      tt58IndustryId: industry.id,
      vatRevenueRatePercent,
      citRevenueRatePercent,
      vatRate,
      vatAmount,
    };
  });

  const primary =
    getTt58IndustryById(invoice.tt58IndustryId) ||
    resolveTt58IndustryForInvoiceLine(invoice, details[0], regime);

  return {
    ...invoice,
    tt58IndustryId: primary.id,
    tt58IndustryGroup: primary.group,
    citRevenueRatePercent: primary.citRevenueRatePercent,
    details,
  };
};

export const groupTt58IndustriesByCode = () => {
  const map = new Map<Tt58IndustryGroupCode, Tt58IndustryDefinition[]>();
  for (const code of TT58_INDUSTRY_GROUP_ORDER) map.set(code, []);
  for (const row of TT58_INDUSTRY_CATALOG) {
    map.get(row.group)!.push(row);
  }
  return map;
};
