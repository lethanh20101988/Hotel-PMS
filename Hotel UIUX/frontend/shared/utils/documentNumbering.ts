import type { VoucherType } from '../types';

export type DocumentNumberPrefix = 'PT' | 'PC' | 'UNC' | 'BC' | 'BN' | 'PN' | 'PX' | 'PKT' | 'DC' | 'LSX';

const CITY_BRANCH_MAP: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /ha\s*noi|hanoi/i, code: 'HN' },
  { pattern: /ho\s*chi\s*minh|tp\s*hcm|tphcm|sai\s*gon/i, code: 'HCM' },
  { pattern: /da\s*nang|danang/i, code: 'DN' },
  { pattern: /hai\s*phong|haiphong/i, code: 'HP' },
  { pattern: /can\s*tho|cantho/i, code: 'CT' },
];

const toCodeToken = (value?: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

export const deriveBranchCodeFromCity = (city?: string) => {
  const normalized = String(city || '').trim();
  if (!normalized) return 'HN';

  const mapped = CITY_BRANCH_MAP.find(({ pattern }) => pattern.test(normalized));
  if (mapped) return mapped.code;

  const tokens = toCodeToken(normalized).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 'HN';
  if (tokens.length === 1) return tokens[0].slice(0, 3) || 'HN';

  return tokens.map((token) => token[0]).join('').slice(0, 4) || 'HN';
};

export const normalizeBranchCode = (branchCode?: string, city?: string) => {
  const normalized = toCodeToken(branchCode).replace(/\s+/g, '');
  if (normalized) return normalized.slice(0, 8);
  return deriveBranchCodeFromCity(city);
};

export const getDocumentPeriodParts = (date?: string) => {
  const fallback = new Date();
  const parsed = date ? new Date(date) : fallback;
  const safe = Number.isNaN(parsed.getTime()) ? fallback : parsed;
  const year = String(safe.getFullYear());
  const month = String(safe.getMonth() + 1).padStart(2, '0');
  return { year, month };
};

export const formatDocumentNumber = (prefix: DocumentNumberPrefix, branchCode: string, date: string | undefined, sequence: number) => {
  const { year, month } = getDocumentPeriodParts(date);
  return `${prefix}-${normalizeBranchCode(branchCode)}-${year}-${month}-${String(sequence).padStart(4, '0')}`;
};

export const buildDocumentCounterKey = (prefix: DocumentNumberPrefix, branchCode: string, date?: string) => {
  const { year, month } = getDocumentPeriodParts(date);
  return `${prefix}|${normalizeBranchCode(branchCode)}|${year}-${month}`;
};

export const extractDocumentSequence = (documentNumber: string | undefined, prefix: DocumentNumberPrefix, branchCode: string, date?: string) => {
  const { year, month } = getDocumentPeriodParts(date);
  const normalizedBranch = normalizeBranchCode(branchCode);
  const expectedPrefix = `${prefix}-${normalizedBranch}-${year}-${month}-`;
  if (!String(documentNumber || '').startsWith(expectedPrefix)) return null;

  const rawSequence = String(documentNumber).slice(expectedPrefix.length);
  const sequence = Number(rawSequence);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : null;
};

export const getVoucherDocumentPrefix = (voucherType: VoucherType): DocumentNumberPrefix => {
  switch (voucherType) {
    case 'RECEIPT':
      return 'PT';
    case 'PAYMENT':
      return 'PC';
    case 'PAYMENT_ORDER':
      return 'UNC';
    case 'BANK_CREDIT':
      return 'BC';
    case 'BANK_DEBIT':
      return 'BN';
    case 'IMPORT':
      return 'PN';
    case 'EXPORT':
      return 'PX';
    case 'ADJUSTMENT':
      return 'DC';
    case 'GENERAL':
    default:
      return 'PKT';
  }
};

export const getFundDocumentPrefix = (type: 'RECEIPT' | 'PAYMENT', method: 'CASH' | 'BANK'): DocumentNumberPrefix => {
  if (type === 'RECEIPT') return method === 'BANK' ? 'BC' : 'PT';
  return method === 'BANK' ? 'UNC' : 'PC';
};

export const getWarehouseDocumentPrefix = (type: 'IMPORT' | 'EXPORT'): DocumentNumberPrefix => {
  return type === 'IMPORT' ? 'PN' : 'PX';
};
