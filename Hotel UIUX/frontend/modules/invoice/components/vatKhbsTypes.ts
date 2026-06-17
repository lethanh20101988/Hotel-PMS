export type KhbsLineCategory = 'PAYABLE' | 'DEDUCTIBLE' | 'REFUND';

export type KhbsAdjustmentLine = {
  id: string;
  category: KhbsLineCategory;
  itemName: string;
  itemCode: string;
  reported: string;
  adjusted: string;
  /** Cột (7) — mặc định đồng bộ với chênh lệch (6); có thể sửa tay */
  liabilityAdj: string;
  reason: string;
};

export type KhbsDistributionRow = {
  id: string;
  name: string;
  taxOrLocationCode: string;
  ward: string;
  province: string;
  taxAuthority: string;
  amountAdj: string;
};

export type KhbsDocRow = {
  id: string;
  title: string;
};

export type KhbsBundle = {
  transactionCode: string;
  lines: KhbsAdjustmentLine[];
  distribution: KhbsDistributionRow[];
  documents: KhbsDocRow[];
  /** 01/KHBS mục I.3 */
  lateDaysPayable: string;
  lateInterestPayable: string;
  /** 01/KHBS mục II / III — có thể nhập thêm ngoài bảng 01-1 */
  extraDeductibleNote: string;
  extraRefundNote: string;
  /** Phần B */
  recoverRefundAmount: string;
  recoverDecisionNo: string;
  recoverDecisionDate: string;
  recoverOrderNo: string;
  recoverOrderDate: string;
  refundRecvDays: string;
  refundLateInterest: string;
  /** Ký 01-1 */
  khbs111PlaceDate: string;
  khbs111TaxpayerSigner: string;
  khbs111AgentName: string;
  khbs111AgentCert: string;
};

export function emptyKhbsBundle(): KhbsBundle {
  return {
    transactionCode: '',
    lines: [],
    distribution: [],
    documents: [],
    lateDaysPayable: '',
    lateInterestPayable: '',
    extraDeductibleNote: '',
    extraRefundNote: '',
    recoverRefundAmount: '',
    recoverDecisionNo: '',
    recoverDecisionDate: '',
    recoverOrderNo: '',
    recoverOrderDate: '',
    refundRecvDays: '',
    refundLateInterest: '',
    khbs111PlaceDate: '',
    khbs111TaxpayerSigner: '',
    khbs111AgentName: '',
    khbs111AgentCert: '',
  };
}

export function newKhbsLine(category: KhbsLineCategory = 'PAYABLE'): KhbsAdjustmentLine {
  return {
    id: `kl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    category,
    itemName: '',
    itemCode: '',
    reported: '',
    adjusted: '',
    liabilityAdj: '',
    reason: '',
  };
}

export function newKhbsDistRow(): KhbsDistributionRow {
  return {
    id: `kd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    name: '',
    taxOrLocationCode: '',
    ward: '',
    province: '',
    taxAuthority: '',
    amountAdj: '',
  };
}

export function newKhbsDocRow(): KhbsDocRow {
  return {
    id: `kdoc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    title: '',
  };
}
