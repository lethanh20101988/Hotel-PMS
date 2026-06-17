/** Payload lưu trong InvoiceImportBatch.payload khi pipeline = TAX_XML */

export type EInvoiceAutoClass = "EXPENSE" | "ASSET" | "TOOL" | "DEVICE" | "UNKNOWN";

export type ParsedEInvoiceLine = {
  lineId: string;
  name: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  vatRate: number;
  vatAmount: number;
};

export type ParsedEInvoice = {
  sellerName: string;
  sellerTax: string;
  sellerAddress: string;
  buyerName: string;
  buyerTax: string;
  buyerAddress: string;
  formNo: string;
  symbolCode: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  exchangeRate: number;
  lines: ParsedEInvoiceLine[];
  totalAmount: number;
  totalVat: number;
  totalPayment: number;
  rawXmlHash: string;
  /** Hướng suy luận: mua vào / bán ra */
  direction: "PURCHASE" | "SALES";
};

export type EInvoiceReviewMeta = {
  autoClassification: EInvoiceAutoClass;
  duplicateBatchIds: string[];
  duplicateReason?: string;
  riskWarnings: string[];
  aiJournalSuggestion?: string;
  aiChatHistory?: { role: "user" | "assistant"; content: string }[];
};

export type EInvoiceStaging = {
  /** lineId -> mã vật tư nội bộ (inventory item id) */
  lineInventoryItemId: Record<string, string>;
  /** lineId -> SKU ghi nhận (ghi chú / đối chiếu) */
  lineSkuNote: Record<string, string>;
  /** lineId -> serial/IMEI, mỗi dòng một serial hoặc xuống dòng */
  lineSerials: Record<string, string>;
  performer?: string;
  paymentStatus?: "PAID" | "PENDING";
  paymentMethod?: "CASH" | "BANK";
  /** Snapshot ngân hàng khi đã TT bằng chuyển khoản (đồng bộ HĐ / phiếu chi / TK 112) */
  bankAccountId?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  bankBranch?: string;
  bankLedgerAccountCode?: string;
  /** lineId -> cách ghi nhận dòng XML khi «Nhập kho + HĐ mua» */
  linePostingKind?: Record<string, "WAREHOUSE" | "EXPENSE_6421" | "EXPENSE_6422" | "PREPAID_12M">;
};

export type TaxXmlPipelinePayload = {
  version: 2;
  pipeline: "TAX_XML";
  sourceFileName: string;
  filePath?: string | null;
  detectedAt: string;
  parseError?: string;
  parsed?: ParsedEInvoice;
  review: EInvoiceReviewMeta;
  staging: EInvoiceStaging;
  committedAt?: string;
  committedInvoiceRef?: string;
};

export function emptyTaxXmlStaging(): EInvoiceStaging {
  return {
    lineInventoryItemId: {},
    lineSkuNote: {},
    lineSerials: {},
    linePostingKind: {},
    performer: "Hệ thống (HĐ điện tử)",
    paymentStatus: "PENDING",
    paymentMethod: "BANK",
  };
}

export function emptyTaxXmlReview(): EInvoiceReviewMeta {
  return {
    autoClassification: "UNKNOWN",
    duplicateBatchIds: [],
    riskWarnings: [],
    aiChatHistory: [],
  };
}
