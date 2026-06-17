import type { AccountDefinition, CompanyInfo, FinancialYear, JournalEntry } from '@shared/types';
import { computeB09FinancialMetrics } from '@shared/utils/b09FinancialMetrics';
import { journalEntryDetailsArray } from '@shared/utils/journalEntryDetails';
import { normalizeLedgerAccountCode } from '@shared/utils/ledgerAccountCode';

export type FinancialExportReportType = 'BALANCE_SHEET' | 'INCOME_STATEMENT' | 'TRIAL_BALANCE' | 'NOTES';

export type BalanceSheetRow = {
  label: string;
  code: string;
  value: number | null;
  beginValue: number | null;
  bold?: boolean;
  indent?: number;
  italic?: boolean;
};

export type IncomeStatementRow = {
  code: string;
  label: string;
  value: number;
  bold?: boolean;
  indent?: number;
  italic?: boolean;
};

export type TrialBalanceAccountRow = {
  code: string;
  name: string;
  level: number;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
};

export type TrialBalanceExportData = {
  year: number;
  rows: TrialBalanceAccountRow[];
  totals: {
    openingDebit: number;
    openingCredit: number;
    periodDebit: number;
    periodCredit: number;
    closingDebit: number;
    closingCredit: number;
  };
};

export const TRIAL_BALANCE_CODES: string[] = [
  '111', '1111', '1112',
  '112', '1121', '1122',
  '121',
  '128', '1281', '1288',
  '131',
  '133', '1331', '1332',
  '136', '1361', '1368',
  '138', '1381', '1386', '1388',
  '141',
  '151', '152', '153', '154', '155', '156', '157',
  '211', '2111', '2112', '2113',
  '214', '2141', '2142', '2143', '2147',
  '228', '2281', '2288',
  '229', '2291', '2292', '2293', '2294',
  '241', '2411', '2412', '2413',
  '242',
  '331',
  '333', '3331', '33311', '33312', '3332', '3333', '3334', '3335', '3336', '3337', '3338', '33381', '33382', '3339',
  '334', '335',
  '336', '3361', '3368',
  '338', '3381', '3382', '3383', '3384', '3385', '3386', '3387', '3388',
  '341', '3411', '3412',
  '352', '3521', '3522', '3524',
  '353', '3531', '3532', '3533', '3534',
  '356', '3561', '3562',
  '4111', '4112', '4118',
  '413', '418', '419',
  '421', '4211', '4212',
  '511', '5111', '5112', '5113', '5118',
  '515',
  '611', '631', '632', '635', '642', '6421', '6422',
  '711',
  '811', '821',
  '911',
];

export const TRIAL_BALANCE_NAME_BY_CODE: Record<string, string> = {
  '111': 'Tiền mặt',
  '1111': 'Tiền Việt Nam',
  '1112': 'Ngoại tệ',
  '112': 'Tiền gửi Ngân hàng',
  '1121': 'Tiền Việt Nam',
  '1122': 'Ngoại tệ',
  '121': 'Chứng khoán kinh doanh',
  '128': 'Đầu tư nắm giữ đến ngày đáo hạn',
  '1281': 'Tiền gửi có kỳ hạn',
  '1288': 'Các khoản đầu tư khác nắm giữ đến ngày đáo hạn',
  '131': 'Phải thu của Khách hàng',
  '133': 'Thuế GTGT được khấu trừ',
  '1331': 'Thuế GTGT được khấu trừ của hàng hoá, dịch vụ',
  '1332': 'Thuế GTGT được khấu trừ TSCĐ',
  '136': 'Phải thu nội bộ',
  '1361': 'Vốn kinh doanh ở đơn vị trực thuộc',
  '1368': 'Phải thu nội bộ khác',
  '138': 'Phải thu khác',
  '1381': 'Tài sản thiếu chờ xử lý',
  '1386': 'Cầm cố, thế chấp, ký quỹ, ký cược',
  '1388': 'Phải thu khác',
  '141': 'Tạm ứng',
  '151': 'Hàng mua đang đi đường',
  '152': 'Nguyên liệu, vật liệu',
  '153': 'Công cụ, dụng cụ',
  '154': 'Chi phí sản xuất, kinh doanh dở dang',
  '155': 'Thành phẩm',
  '156': 'Hàng hoá',
  '157': 'Hàng gửi đi bán',
  '211': 'Tài sản cố định',
  '2111': 'TSCĐ Hữu hình',
  '2112': 'TSCĐ thuê tài chính',
  '2113': 'TSCĐ Vô hình',
  '214': 'Hao mòn tài sản cố định',
  '2141': 'Hao mòn TSCĐ Hữu hình',
  '2142': 'Hao mòn TSCĐ thuê tài chính',
  '2143': 'Hao mòn TSCĐ vô hình',
  '2147': 'Hao mòn Bất động sản đầu tư',
  '228': 'Đầu tư góp vốn vào đơn vị khác',
  '2281': 'Đầu tư vào công ty liên doanh, liên kết',
  '2288': 'Đầu tư khác',
  '229': 'Dự phòng tổn thất tài sản',
  '2291': 'Dự phòng giảm giá chứng khoán kinh doanh',
  '2292': 'Dự phòng tổn thất đầu tư vào đơn vị khác',
  '2293': 'Dự phòng phải thu khó đòi',
  '2294': 'Dự phòng giảm giá hàng tồn kho',
  '241': 'Xây dựng cơ bản dở dang',
  '2411': 'Mua sắm TSCĐ',
  '2412': 'Xây dựng cơ bản',
  '2413': 'Sửa chữa lớn TSCĐ',
  '242': 'Chi phí trả trước',
  '331': 'Phải trả cho người bán',
  '333': 'Thuế và các khoản phải nộp nhà nước',
  '3331': 'Thuế GTGT phải nộp',
  '33311': 'Thuế GTGT đầu ra',
  '33312': 'Thuế GTGT hàng nhập khẩu',
  '3332': 'Thuế tiêu thụ đặc biệt',
  '3333': 'Thuế xuất, nhập khẩu',
  '3334': 'Thuế thu nhập doanh nghiệp',
  '3335': 'Thuế thu nhập cá nhân',
  '3336': 'Thuế tài nguyên',
  '3337': 'Thuế nhà đất, tiền thuê đất',
  '3338': 'Thuế bảo vệ môi trường và các loại thuế khác',
  '33381': 'Thuế bảo vệ môi trường',
  '33382': 'Các loại thuế khác',
  '3339': 'Phí, lệ phí và các khoản phải nộp khác',
  '334': 'Phải trả người lao động',
  '335': 'Chi phí phải trả',
  '336': 'Phải trả nội bộ',
  '3361': 'Phải trả nội bộ về vốn kinh doanh',
  '3368': 'Phải trả nội bộ khác',
  '338': 'Phải trả, phải nộp khác',
  '3381': 'Tài sản thừa chờ giải quyết',
  '3382': 'Kinh phí công đoàn',
  '3383': 'Bảo hiểm xã hội',
  '3384': 'Bảo hiểm y tế',
  '3385': 'Bảo hiểm thất nghiệp',
  '3386': 'Nhận ký quỹ, ký cược',
  '3387': 'Doanh thu chưa thực hiện',
  '3388': 'Phải trả, phải nộp khác',
  '341': 'Vay và nợ thuê tài chính',
  '3411': 'Các khoản đi vay',
  '3412': 'Nợ thuê tài chính',
  '352': 'Dự phòng phải trả',
  '3521': 'Dự phòng bảo hành sản phẩm hàng hoá',
  '3522': 'Dự phòng bảo hành công trình xây dựng',
  '3524': 'Dự phòng phải trả khác',
  '353': 'Quỹ khen thưởng Phúc Lợi',
  '3531': 'Quỹ khen thưởng',
  '3532': 'Quỹ phúc lợi',
  '3533': 'Quỹ phúc lợi đã hình thành TSCĐ',
  '3534': 'Quỹ thưởng ban quản lý điều hành công ty',
  '356': 'Quỹ phát triển khoa học và công nghệ',
  '3561': 'Quỹ phát triển khoa học và công nghệ',
  '3562': 'Quỹ phát triển khoa học và công nghệ đã hình thành TSCĐ',
  '4111': 'Vốn đầu tư của chủ sở hữu',
  '4112': 'Thặng dư vốn cổ phần',
  '4118': 'Vốn khác',
  '413': 'Chênh lệch tỷ giá hối đoái',
  '418': 'Các quỹ thuộc vốn chủ sở hữu',
  '419': 'Cổ phiếu quỹ',
  '421': 'Lợi nhuận sau thuế chưa phân phối',
  '4211': 'Lợi nhuận sau thuế chưa phân phối năm trước',
  '4212': 'Lợi nhuận sau thuế chưa phân phối năm nay',
  '511': 'Doanh thu bán hàng và cung cấp dịch vụ',
  '5111': 'Doanh thu bán hàng hoá',
  '5112': 'Doanh thu bán thành phẩm',
  '5113': 'Doanh thu cung cấp dịch vụ',
  '5118': 'Doanh thu khác',
  '515': 'Doanh thu hoạt động tài chính',
  '611': 'Mua hàng',
  '631': 'Giá thành sản xuất',
  '632': 'Giá vốn hàng bán',
  '635': 'Chi phí tài chính',
  '642': 'Chi phí quản lý doanh nghiệp',
  '6421': 'Chi phí bán hàng',
  '6422': 'Chi phí quản lý doanh nghiệp',
  '711': 'Thu nhập khác',
  '811': 'Chi phí khác',
  '821': 'Chi phí thuế thu nhập doanh nghiệp',
  '911': 'Xác định kết quả kinh doanh',
};

const isOpeningEntry = (e: JournalEntry) => {
  const ref = String(e.referenceId || '').toUpperCase();
  const desc = String(e.description || '').toLowerCase();
  return ref.startsWith('OPENING') || desc.includes('số dư đầu kỳ');
};

const calculateTurnoverInPeriod = (
  entries: JournalEntry[],
  prefix: string,
  side: 'DEBIT' | 'CREDIT',
  start: string,
  end: string,
) =>
  entries
    .filter((entry) => entry.date >= start && entry.date <= end)
    .reduce(
      (acc, entry) =>
        acc +
        journalEntryDetailsArray(entry).reduce((sum, d) => {
          if (String(d.account).startsWith(prefix)) {
            return sum + (side === 'DEBIT' ? d.debit : d.credit);
          }
          return sum;
        }, 0),
      0,
    );

function buildBalanceHelpers(entries: JournalEntry[], endOfYear: string, beginningCutoff: string) {
  const getNetBalance = (prefixes: string[]) =>
    prefixes.reduce((sum, prefix) => {
      const net = entries
        .filter((entry) => entry.date <= endOfYear)
        .reduce(
          (acc, entry) =>
            acc +
            journalEntryDetailsArray(entry).reduce((s, d) => {
              if (d.account.toString().startsWith(prefix)) return s + (d.debit - d.credit);
              return s;
            }, 0),
          0,
        );
      return sum + net;
    }, 0);

  const getNetBalanceAt = (dateStr: string, prefixes: string[]) =>
    prefixes.reduce((sum, prefix) => {
      const net = entries
        .filter((entry) => entry.date <= dateStr)
        .reduce(
          (acc, entry) =>
            acc +
            journalEntryDetailsArray(entry).reduce((s, d) => {
              if (d.account.toString().startsWith(prefix)) return s + (d.debit - d.credit);
              return s;
            }, 0),
          0,
        );
      return sum + net;
    }, 0);

  const getAssetSideBalance = (prefixes: string[]) => {
    const net = getNetBalance(prefixes);
    return net > 0 ? net : 0;
  };

  const getLiabilitySideBalance = (prefixes: string[]) => {
    const net = getNetBalance(prefixes);
    return net < 0 ? Math.abs(net) : 0;
  };

  const getAssetSideBalanceAt = (dateStr: string, prefixes: string[]) => {
    const net = getNetBalanceAt(dateStr, prefixes);
    return net > 0 ? net : 0;
  };

  const getLiabilitySideBalanceAt = (dateStr: string, prefixes: string[]) => {
    const net = getNetBalanceAt(dateStr, prefixes);
    return net < 0 ? Math.abs(net) : 0;
  };

  const ts_110 = ['111', '112', '113'].reduce((acc, p) => acc + getAssetSideBalance([p]), 0);
  const ts_121 = getAssetSideBalance(['121']);
  const ts_122 = 0;
  const ts_123 = getAssetSideBalance(['128']);
  const ts_120 = ts_121 + ts_122 + ts_123;
  const ts_131 = getAssetSideBalance(['131']);
  const ts_132 = getAssetSideBalance(['331']);
  const ts_133 = getAssetSideBalance(['138']) + getAssetSideBalance(['136']);
  const ts_134 = 0;
  const ts_135 = 0;
  const ts_130 = ts_131 + ts_132 + ts_133 + ts_134 + ts_135;
  const ts_141 = getAssetSideBalance(['151', '152', '153', '154', '155', '156']);
  const ts_142 = 0;
  const ts_140 = ts_141 + ts_142;

  const net133 = entries
    .filter((e) => e.date <= endOfYear)
    .reduce(
      (sum, e) =>
        sum + journalEntryDetailsArray(e).reduce((s, d) => (String(d.account).startsWith('133') ? s + (d.debit - d.credit) : s), 0),
      0,
    );
  const net3331 = entries
    .filter((e) => e.date <= endOfYear)
    .reduce(
      (sum, e) =>
        sum + journalEntryDetailsArray(e).reduce((s, d) => (String(d.account).startsWith('3331') ? s + (d.credit - d.debit) : s), 0),
      0,
    );
  const netVatStatus = net133 - net3331;
  const ts_151 = netVatStatus > 0 ? netVatStatus : 0;
  const nv_413_val = netVatStatus < 0 ? Math.abs(netVatStatus) : 0;
  const nv_413_otherTaxes = ['3332', '3333', '3334', '3335', '3336', '3337', '3338', '3339'].reduce(
    (acc, p) => acc + getLiabilitySideBalance([p]),
    0,
  );
  const nv_413 = nv_413_val + nv_413_otherTaxes;
  const ts_152 = getAssetSideBalance(['141', '242']);
  const ts_150 = ts_151 + ts_152;
  const totalAssetsShortTerm = ts_110 + ts_120 + ts_130 + ts_140 + ts_150;

  const ts_221 = getAssetSideBalance(['211']) + getAssetSideBalance(['213']);
  const ts_222 = -getLiabilitySideBalance(['214']);
  const ts_220 = ts_221 + ts_222;
  const ts_231 = getAssetSideBalance(['217']);
  const ts_232 = 0;
  const ts_230 = ts_231 + ts_232;
  const totalAssetsLongTerm = ts_220 + ts_230 + ['221', '228', '241'].reduce((acc, p) => acc + getAssetSideBalance([p]), 0);
  const totalAssets_300 = totalAssetsShortTerm + totalAssetsLongTerm;

  const nv_411 = getLiabilitySideBalance(['331']);
  const nv_412 = getLiabilitySideBalance(['131']);
  const nv_414 = getLiabilitySideBalance(['334']);
  const nv_415 =
    getLiabilitySideBalance(['338']) + ['335', '336', '337'].reduce((acc, p) => acc + getLiabilitySideBalance([p]), 0);
  const nv_416 = ['341', '311', '312', '319', '320'].reduce((acc, p) => acc + getLiabilitySideBalance([p]), 0);
  const nv_417 = getLiabilitySideBalance(['352']);
  const nv_418 = getLiabilitySideBalance(['353']);
  const nv_410 = nv_411 + nv_412 + nv_413 + nv_414 + nv_415 + nv_416 + nv_417 + nv_418;
  const totalLiabilities_400 = nv_410;
  const nv_511 = getLiabilitySideBalance(['411']);
  const net421 = getNetBalance(['421']);
  const nv_517 = net421 < 0 ? Math.abs(net421) : -net421;
  const totalEquity_500 = nv_511 + nv_517 + getLiabilitySideBalance(['412', '413', '418', '419']);
  const totalResources_600 = totalLiabilities_400 + totalEquity_500;

  const ts_110_begin = ['111', '112', '113'].reduce((acc, p) => acc + getAssetSideBalanceAt(beginningCutoff, [p]), 0);
  const ts_121_begin = getAssetSideBalanceAt(beginningCutoff, ['121']);
  const ts_122_begin = 0;
  const ts_123_begin = getAssetSideBalanceAt(beginningCutoff, ['128']);
  const ts_120_begin = ts_121_begin + ts_122_begin + ts_123_begin;
  const ts_131_begin = getAssetSideBalanceAt(beginningCutoff, ['131']);
  const ts_132_begin = getAssetSideBalanceAt(beginningCutoff, ['331']);
  const ts_133_begin = getAssetSideBalanceAt(beginningCutoff, ['138']) + getAssetSideBalanceAt(beginningCutoff, ['136']);
  const ts_134_begin = 0;
  const ts_135_begin = 0;
  const ts_130_begin = ts_131_begin + ts_132_begin + ts_133_begin + ts_134_begin + ts_135_begin;
  const ts_141_begin = getAssetSideBalanceAt(beginningCutoff, ['151', '152', '153', '154', '155', '156']);
  const ts_142_begin = 0;
  const ts_140_begin = ts_141_begin + ts_142_begin;

  const net133_begin = entries
    .filter((e) => e.date <= beginningCutoff)
    .reduce(
      (sum, e) =>
        sum + journalEntryDetailsArray(e).reduce((s, d) => (String(d.account).startsWith('133') ? s + (d.debit - d.credit) : s), 0),
      0,
    );
  const net3331_begin = entries
    .filter((e) => e.date <= beginningCutoff)
    .reduce(
      (sum, e) =>
        sum + journalEntryDetailsArray(e).reduce((s, d) => (String(d.account).startsWith('3331') ? s + (d.credit - d.debit) : s), 0),
      0,
    );
  const netVatStatus_begin = net133_begin - net3331_begin;
  const ts_151_begin = netVatStatus_begin > 0 ? netVatStatus_begin : 0;
  const nv_413_val_begin = netVatStatus_begin < 0 ? Math.abs(netVatStatus_begin) : 0;
  const nv_413_otherTaxes_begin = ['3332', '3333', '3334', '3335', '3336', '3337', '3338', '3339'].reduce(
    (acc, p) => acc + getLiabilitySideBalanceAt(beginningCutoff, [p]),
    0,
  );
  const nv_413_begin = nv_413_val_begin + nv_413_otherTaxes_begin;
  const ts_152_begin = getAssetSideBalanceAt(beginningCutoff, ['141', '242']);
  const ts_150_begin = ts_151_begin + ts_152_begin;
  const totalAssetsShortTerm_begin = ts_110_begin + ts_120_begin + ts_130_begin + ts_140_begin + ts_150_begin;

  const ts_221_begin = getAssetSideBalanceAt(beginningCutoff, ['211']) + getAssetSideBalanceAt(beginningCutoff, ['213']);
  const ts_222_begin = -getLiabilitySideBalanceAt(beginningCutoff, ['214']);
  const ts_220_begin = ts_221_begin + ts_222_begin;
  const ts_231_begin = getAssetSideBalanceAt(beginningCutoff, ['217']);
  const ts_232_begin = 0;
  const ts_230_begin = ts_231_begin + ts_232_begin;
  const totalAssetsLongTerm_begin =
    ts_220_begin + ts_230_begin + ['221', '228', '241'].reduce((acc, p) => acc + getAssetSideBalanceAt(beginningCutoff, [p]), 0);
  const totalAssets_300_begin = totalAssetsShortTerm_begin + totalAssetsLongTerm_begin;

  const nv_411_begin = getLiabilitySideBalanceAt(beginningCutoff, ['331']);
  const nv_412_begin = getLiabilitySideBalanceAt(beginningCutoff, ['131']);
  const nv_414_begin = getLiabilitySideBalanceAt(beginningCutoff, ['334']);
  const nv_415_begin =
    getLiabilitySideBalanceAt(beginningCutoff, ['338']) +
    ['335', '336', '337'].reduce((acc, p) => acc + getLiabilitySideBalanceAt(beginningCutoff, [p]), 0);
  const nv_416_begin = ['341', '311', '312', '319', '320'].reduce(
    (acc, p) => acc + getLiabilitySideBalanceAt(beginningCutoff, [p]),
    0,
  );
  const nv_417_begin = getLiabilitySideBalanceAt(beginningCutoff, ['352']);
  const nv_418_begin = getLiabilitySideBalanceAt(beginningCutoff, ['353']);
  const nv_410_begin = nv_411_begin + nv_412_begin + nv_413_begin + nv_414_begin + nv_415_begin + nv_416_begin + nv_417_begin + nv_418_begin;
  const totalLiabilities_400_begin = nv_410_begin;
  const nv_511_begin = getLiabilitySideBalanceAt(beginningCutoff, ['411']);
  const net421_begin = getNetBalanceAt(beginningCutoff, ['421']);
  const nv_517_begin = net421_begin < 0 ? Math.abs(net421_begin) : -net421_begin;
  const totalEquity_500_begin = nv_511_begin + nv_517_begin + getLiabilitySideBalanceAt(beginningCutoff, ['412', '413', '418', '419']);
  const totalResources_600_begin = totalLiabilities_400_begin + totalEquity_500_begin;

  const beginByCode: Record<string, number> = {
    '100': totalAssetsShortTerm_begin,
    '110': ts_110_begin,
    '120': ts_120_begin,
    '121': ts_121_begin,
    '122': ts_122_begin,
    '123': ts_123_begin,
    '130': ts_130_begin,
    '131': ts_131_begin,
    '132': ts_132_begin,
    '133': ts_133_begin,
    '134': ts_134_begin,
    '135': ts_135_begin,
    '140': ts_140_begin,
    '141': ts_141_begin,
    '142': ts_142_begin,
    '150': ts_150_begin,
    '151': ts_151_begin,
    '152': ts_152_begin,
    '200': totalAssetsLongTerm_begin,
    '210': 0,
    '211': 0,
    '212': 0,
    '213': 0,
    '214': 0,
    '215': 0,
    '220': ts_220_begin,
    '221': ts_221_begin,
    '222': ts_222_begin,
    '230': ts_230_begin,
    '231': ts_231_begin,
    '232': ts_232_begin,
    '240': 0,
    '250': 0,
    '251': 0,
    '252': 0,
    '253': 0,
    '260': 0,
    '300': totalAssets_300_begin,
    '400': totalLiabilities_400_begin,
    '410': nv_410_begin,
    '411': nv_411_begin,
    '412': nv_412_begin,
    '413': nv_413_begin,
    '414': nv_414_begin,
    '415': nv_415_begin,
    '416': nv_416_begin,
    '417': nv_417_begin,
    '418': nv_418_begin,
    '420': 0,
    '421': 0,
    '422': 0,
    '423': 0,
    '424': 0,
    '425': 0,
    '426': 0,
    '427': 0,
    '500': totalEquity_500_begin,
    '511': nv_511_begin,
    '512': 0,
    '513': 0,
    '514': 0,
    '515': 0,
    '516': 0,
    '517': nv_517_begin,
    '600': totalResources_600_begin,
  };

  const endByCode: Record<string, number> = {
    '100': totalAssetsShortTerm,
    '110': ts_110,
    '120': ts_120,
    '121': ts_121,
    '122': ts_122,
    '123': ts_123,
    '130': ts_130,
    '131': ts_131,
    '132': ts_132,
    '133': ts_133,
    '134': ts_134,
    '135': ts_135,
    '140': ts_140,
    '141': ts_141,
    '142': ts_142,
    '150': ts_150,
    '151': ts_151,
    '152': ts_152,
    '200': totalAssetsLongTerm,
    '210': 0,
    '211': 0,
    '212': 0,
    '213': 0,
    '214': 0,
    '215': 0,
    '220': ts_220,
    '221': ts_221,
    '222': ts_222,
    '230': ts_230,
    '231': ts_231,
    '232': ts_232,
    '240': 0,
    '250': 0,
    '251': 0,
    '252': 0,
    '253': 0,
    '260': 0,
    '300': totalAssets_300,
    '400': totalLiabilities_400,
    '410': nv_410,
    '411': nv_411,
    '412': nv_412,
    '413': nv_413,
    '414': nv_414,
    '415': nv_415,
    '416': nv_416,
    '417': nv_417,
    '418': nv_418,
    '420': 0,
    '421': 0,
    '422': 0,
    '423': 0,
    '424': 0,
    '425': 0,
    '426': 0,
    '427': 0,
    '500': totalEquity_500,
    '511': nv_511,
    '512': 0,
    '513': 0,
    '514': 0,
    '515': 0,
    '516': 0,
    '517': nv_517,
    '600': totalResources_600,
  };

  return { beginByCode, endByCode };
}

export function computeBalanceSheetData(entries: JournalEntry[], financialYear: FinancialYear) {
  const startOfYear = financialYear.startDate;
  const endOfYear = financialYear.endDate;
  const beginningCutoff = new Date(new Date(startOfYear).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { beginByCode, endByCode } = buildBalanceHelpers(entries, endOfYear, beginningCutoff);

  const rows: BalanceSheetRow[] = [
    { label: 'A – TÀI SẢN NGÂN HẠN (100 = 110+ 120 + 130 + 140 + 150)', code: '100', value: endByCode['100'], beginValue: beginByCode['100'], bold: true },
    { label: 'I. Tiền và các khoản tương đương tiền', code: '110', value: endByCode['110'], beginValue: beginByCode['110'] },
    { label: 'II. Đầu tư tài chính ngắn hạn', code: '120', value: endByCode['120'], beginValue: beginByCode['120'] },
    { label: '1. Chứng khoán kinh doanh', code: '121', value: endByCode['121'], beginValue: beginByCode['121'], indent: 1 },
    { label: '2. Dự phòng giảm giá chứng khoán kinh doanh (*)', code: '122', value: endByCode['122'], beginValue: beginByCode['122'], indent: 1, italic: true },
    { label: '3. Đầu tư nắm giữ đến ngày đáo hạn ngắn hạn', code: '123', value: endByCode['123'], beginValue: beginByCode['123'], indent: 1 },
    { label: 'III. Các khoản phải thu ngắn hạn', code: '130', value: endByCode['130'], beginValue: beginByCode['130'] },
    { label: '1. Phải thu ngắn hạn của khách hàng', code: '131', value: endByCode['131'], beginValue: beginByCode['131'], indent: 1 },
    { label: '2. Trả trước cho người bán ngắn hạn', code: '132', value: endByCode['132'], beginValue: beginByCode['132'], indent: 1 },
    { label: '3. Phải thu ngắn hạn khác', code: '133', value: endByCode['133'], beginValue: beginByCode['133'], indent: 1 },
    { label: '4. Tài sản thiếu chờ xử lý', code: '134', value: endByCode['134'], beginValue: beginByCode['134'], indent: 1 },
    { label: '5. Dự phòng phải thu ngắn hạn khó đòi (*)', code: '135', value: endByCode['135'], beginValue: beginByCode['135'], indent: 1, italic: true },
    { label: 'IV. Hàng tồn kho', code: '140', value: endByCode['140'], beginValue: beginByCode['140'] },
    { label: '1. Hàng tồn kho', code: '141', value: endByCode['141'], beginValue: beginByCode['141'], indent: 1 },
    { label: '2. Dự phòng giảm giá hàng tồn kho (*)', code: '142', value: endByCode['142'], beginValue: beginByCode['142'], indent: 1, italic: true },
    { label: 'V. Tài sản ngắn hạn khác', code: '150', value: endByCode['150'], beginValue: beginByCode['150'] },
    { label: '1. Thuế GTGT được khấu trừ', code: '151', value: endByCode['151'], beginValue: beginByCode['151'], indent: 1 },
    { label: '2. Tài sản ngắn hạn khác', code: '152', value: endByCode['152'], beginValue: beginByCode['152'], indent: 1 },
    { label: 'B - TÀI SẢN DÀI HẠN (200=210+220+230+240+250+260)', code: '200', value: endByCode['200'], beginValue: beginByCode['200'], bold: true },
    { label: 'I. Các khoản phải thu dài hạn', code: '210', value: endByCode['210'], beginValue: beginByCode['210'] },
    { label: 'II. Tài sản cố định', code: '220', value: endByCode['220'], beginValue: beginByCode['220'] },
    { label: '- Nguyên giá', code: '221', value: endByCode['221'], beginValue: beginByCode['221'], indent: 1 },
    { label: '- Giá trị hao mòn lũy kế (*)', code: '222', value: endByCode['222'], beginValue: beginByCode['222'], indent: 1, italic: true },
    { label: 'III. Bất động sản đầu tư', code: '230', value: endByCode['230'], beginValue: beginByCode['230'] },
    { label: '- Nguyên giá', code: '231', value: endByCode['231'], beginValue: beginByCode['231'], indent: 1 },
    { label: '- Giá trị hao mòn lũy kế (*)', code: '232', value: endByCode['232'], beginValue: beginByCode['232'], indent: 1, italic: true },
    { label: 'TỔNG CỘNG TÀI SẢN (300=100+200)', code: '300', value: endByCode['300'], beginValue: beginByCode['300'], bold: true },
    { label: 'C - NỢ PHẢI TRẢ (400=410+420)', code: '400', value: endByCode['400'], beginValue: beginByCode['400'], bold: true },
    { label: 'I. Nợ ngắn hạn', code: '410', value: endByCode['410'], beginValue: beginByCode['410'] },
    { label: '1. Phải trả người bán ngắn hạn', code: '411', value: endByCode['411'], beginValue: beginByCode['411'], indent: 1 },
    { label: '2. Người mua trả tiền trước ngắn hạn', code: '412', value: endByCode['412'], beginValue: beginByCode['412'], indent: 1 },
    { label: '3. Thuế và các khoản phải nộp Nhà nước', code: '413', value: endByCode['413'], beginValue: beginByCode['413'], indent: 1 },
    { label: '4. Phải trả người lao động', code: '414', value: endByCode['414'], beginValue: beginByCode['414'], indent: 1 },
    { label: '5. Phải trả ngắn hạn khác', code: '415', value: endByCode['415'], beginValue: beginByCode['415'], indent: 1 },
    { label: '6. Vay và nợ thuê tài chính ngắn hạn', code: '416', value: endByCode['416'], beginValue: beginByCode['416'], indent: 1 },
    { label: '7. Dự phòng phải trả ngắn hạn', code: '417', value: endByCode['417'], beginValue: beginByCode['417'], indent: 1 },
    { label: '8. Quỹ khen thưởng, phúc lợi', code: '418', value: endByCode['418'], beginValue: beginByCode['418'], indent: 1 },
    { label: 'II. Nợ dài hạn', code: '420', value: endByCode['420'], beginValue: beginByCode['420'] },
    { label: 'D - VỐN CHỦ SỞ HỮU(500=511+512+513+514+515+516+517)', code: '500', value: endByCode['500'], beginValue: beginByCode['500'], bold: true },
    { label: '1. Vốn góp của chủ sở hữu', code: '511', value: endByCode['511'], beginValue: beginByCode['511'], indent: 1 },
    { label: '7. Lợi nhuận sau thuế chưa phân phối', code: '517', value: endByCode['517'], beginValue: beginByCode['517'], indent: 1 },
    { label: 'TỔNG CỘNG NGUỒN VỐN(600=400+500)', code: '600', value: endByCode['600'], beginValue: beginByCode['600'], bold: true },
  ];

  return {
    rows,
    endByCode,
    beginByCode,
    reportEndDate: endOfYear,
  };
}

export function computeIncomeStatementData(entries: JournalEntry[], year: number): IncomeStatementRow[] {
  const startStr = `${year}-01-01`;
  const endStr = `${year}-12-31`;

  const revenue = calculateTurnoverInPeriod(entries, '511', 'CREDIT', startStr, endStr);
  const deductions = calculateTurnoverInPeriod(entries, '521', 'DEBIT', startStr, endStr);
  const netRevenue_10 = revenue - deductions;
  const cogs_11 = calculateTurnoverInPeriod(entries, '632', 'DEBIT', startStr, endStr);
  const grossProfit_20 = netRevenue_10 - cogs_11;
  const financialRevenue_21 = calculateTurnoverInPeriod(entries, '515', 'CREDIT', startStr, endStr);
  const financialExpense_22 = calculateTurnoverInPeriod(entries, '635', 'DEBIT', startStr, endStr);
  const interestExpense_23 = calculateTurnoverInPeriod(entries, '635', 'DEBIT', startStr, endStr);
  const adminExpense_24 = calculateTurnoverInPeriod(entries, '642', 'DEBIT', startStr, endStr);
  const netOpProfit_30 = grossProfit_20 + financialRevenue_21 - financialExpense_22 - adminExpense_24;
  const otherIncome_31 = calculateTurnoverInPeriod(entries, '711', 'CREDIT', startStr, endStr);
  const otherExpense_32 = calculateTurnoverInPeriod(entries, '811', 'DEBIT', startStr, endStr);
  const otherProfit_40 = otherIncome_31 - otherExpense_32;
  const totalProfitBeforeTax_50 = netOpProfit_30 + otherProfit_40;
  const citTaxExpense_51 = calculateTurnoverInPeriod(entries, '821', 'DEBIT', startStr, endStr);
  const profitAfterTax_60 = totalProfitBeforeTax_50 - citTaxExpense_51;

  return [
    { code: '01', label: '1. Doanh thu bán hàng và cung cấp dịch vụ', value: revenue },
    { code: '02', label: '2. Các khoản giảm trừ doanh thu', value: deductions },
    { code: '10', label: '3. Doanh thu thuần về bán hàng và cung cấp dịch vụ (10 = 01 - 02)', value: netRevenue_10, bold: true },
    { code: '11', label: '4. Giá vốn hàng bán', value: cogs_11 },
    { code: '20', label: '5. Lợi nhuận gộp về bán hàng và cung cấp dịch vụ (20 = 10 - 11)', value: grossProfit_20, bold: true },
    { code: '21', label: '6. Doanh thu hoạt động tài chính', value: financialRevenue_21 },
    { code: '22', label: '7. Chi phí tài chính', value: financialExpense_22 },
    { code: '23', label: '- Trong đó: Chi phí lãi vay', value: interestExpense_23, indent: 1, italic: true },
    { code: '24', label: '8. Chi phí quản lý kinh doanh', value: adminExpense_24 },
    { code: '30', label: '9. Lợi nhuận thuần từ hoạt động kinh doanh (30 = 20 + 21 - 22 - 24)', value: netOpProfit_30, bold: true },
    { code: '31', label: '10. Thu nhập khác', value: otherIncome_31 },
    { code: '32', label: '11. Chi phí khác', value: otherExpense_32 },
    { code: '40', label: '12. Lợi nhuận khác (40 = 31 - 32)', value: otherProfit_40, bold: true },
    { code: '50', label: '13. Tổng lợi nhuận kế toán trước thuế (50 = 30 + 40)', value: totalProfitBeforeTax_50, bold: true },
    { code: '51', label: '14. Chi phí thuế TNDN', value: citTaxExpense_51 },
    { code: '60', label: '15. Lợi nhuận sau thuế thu nhập doanh nghiệp (60 = 50 - 51)', value: profitAfterTax_60, bold: true },
  ];
}

export function computeTrialBalanceData(
  entries: JournalEntry[],
  year: number,
  financialYear: FinancialYear,
  accounts: AccountDefinition[],
): TrialBalanceExportData {
  const startStr = financialYear.startDate;
  const endStr = financialYear.endDate;

  const nameByCode = new Map<string, string>();
  (accounts || []).forEach((a) => nameByCode.set(String(a.code), String(a.name)));

  const metricsByLeaf = new Map<string, { openingNet: number; periodDebit: number; periodCredit: number }>();
  const ensure = (code: string) => {
    if (!metricsByLeaf.has(code)) metricsByLeaf.set(code, { openingNet: 0, periodDebit: 0, periodCredit: 0 });
    return metricsByLeaf.get(code)!;
  };

  for (const e of entries) {
    const openingWindow = e.date < startStr || (isOpeningEntry(e) && e.date <= startStr);
    const inPeriod = e.date >= startStr && e.date <= endStr && !isOpeningEntry(e);
    for (const d of journalEntryDetailsArray(e)) {
      const acc = normalizeLedgerAccountCode(d.account);
      if (!acc) continue;
      const debit = Number(d.debit || 0);
      const credit = Number(d.credit || 0);
      const m = ensure(acc);
      if (openingWindow) m.openingNet += debit - credit;
      if (inPeriod) {
        m.periodDebit += debit;
        m.periodCredit += credit;
      }
    }
  }

  const calcForCode = (code: string) => {
    let openingNet = 0;
    let periodDebit = 0;
    let periodCredit = 0;

    if (['111', '112', '242', '611', '631', '632', '635', '642', '6421', '6422'].includes(code)) {
      for (const [accountCode, metric] of metricsByLeaf.entries()) {
        if (!accountCode.startsWith(code)) continue;
        openingNet += metric.openingNet;
        periodDebit += metric.periodDebit;
        periodCredit += metric.periodCredit;
      }
    } else {
      const m = metricsByLeaf.get(code) || { openingNet: 0, periodDebit: 0, periodCredit: 0 };
      openingNet = m.openingNet;
      periodDebit = m.periodDebit;
      periodCredit = m.periodCredit;
    }

    const closingNet = openingNet + (periodDebit - periodCredit);
    return {
      openingDebit: openingNet > 0 ? openingNet : 0,
      openingCredit: openingNet < 0 ? Math.abs(openingNet) : 0,
      periodDebit,
      periodCredit,
      closingDebit: closingNet > 0 ? closingNet : 0,
      closingCredit: closingNet < 0 ? Math.abs(closingNet) : 0,
    };
  };

  const rows: TrialBalanceAccountRow[] = TRIAL_BALANCE_CODES.map((code) => {
    const m = calcForCode(code);
    return {
      code,
      name: TRIAL_BALANCE_NAME_BY_CODE[code] || nameByCode.get(code) || '',
      level: Math.max(0, code.length - 3),
      ...m,
    };
  });

  let openingDebit = 0;
  let openingCredit = 0;
  let periodDebit = 0;
  let periodCredit = 0;
  let closingDebit = 0;
  let closingCredit = 0;

  for (const code of TRIAL_BALANCE_CODES) {
    if (code.length !== 3) continue;
    const m = calcForCode(code);
    openingDebit += m.openingDebit;
    openingCredit += m.openingCredit;
    periodDebit += m.periodDebit;
    periodCredit += m.periodCredit;
    closingDebit += m.closingDebit;
    closingCredit += m.closingCredit;
  }

  return {
    year,
    rows,
    totals: { openingDebit, openingCredit, periodDebit, periodCredit, closingDebit, closingCredit },
  };
}

export function computeFinancialNotesSections(
  entries: JournalEntry[],
  financialYear: FinancialYear,
  companyInfo: CompanyInfo,
) {
  const m = computeB09FinancialMetrics(entries, financialYear);
  const year = Number(String(financialYear.startDate).slice(0, 4)) || new Date().getFullYear();
  const periodLabel = `${financialYear.startDate} đến ${financialYear.endDate}`;

  return {
    year,
    periodLabel,
    companyInfo,
    metrics: m,
    sections: [
      { title: 'I. Đặc điểm hoạt động', content: 'Doanh nghiệp hoạt động trong lĩnh vực thương mại dịch vụ và quản lý thiết bị công nghệ.' },
      { title: 'II. Kỳ kế toán, đơn vị tiền tệ', content: `Kỳ kế toán: ${periodLabel}. Đơn vị tiền tệ: VND.` },
      {
        title: 'III. Cơ sở lập báo cáo',
        content: `Tổng tài sản (300): ${m.b01b.totalAssets_300}; Tổng nguồn vốn (600): ${m.b01b.totalSources_600}.`,
      },
      {
        title: 'IV. Thuyết minh B01b',
        content: `Tiền (110): ${m.b01b.cash_110}; Phải thu (130): ${m.b01b.group130}; Hàng tồn kho (141): ${m.b01b.inventory_141}; TSCĐ (220): ${m.b01b.fixedAssets_220}.`,
      },
      {
        title: 'V. Thuyết minh B02',
        content: `Doanh thu (01): ${m.b02.revenue01}; Giá vốn (11): ${m.b02.cogs11}; LN sau thuế (60): ${m.b02.pat60}.`,
      },
      {
        title: 'VI. Thuyết minh B03',
        content: `LCT HĐKD (20): ${m.b03.lct20}; LCT đầu tư (30): ${m.b03.lct30}; LCT TC (40): ${m.b03.lct40}; LCT thuần (50): ${m.b03.net50}.`,
      },
    ],
  };
}

export function reportExportBaseName(reportType: FinancialExportReportType, year: number, taxCode: string): string {
  const mst = String(taxCode || 'MST').replace(/\D/g, '') || 'MST';
  const slug: Record<FinancialExportReportType, string> = {
    BALANCE_SHEET: 'B01b-DNN',
    INCOME_STATEMENT: 'B02-DNN',
    TRIAL_BALANCE: 'F01-DNN',
    NOTES: 'B09-DNN',
  };
  return `${slug[reportType]}_${mst}_${year}`;
}

export function htkkBctcFileName(year: number, taxCode: string, lan = 0): string {
  const mst = String(taxCode || '0000000000').replace(/\D/g, '') || '0000000000';
  return `BCTC-${mst}-${year}-${lan}.xml`;
}
