import React from 'react';
import { InventoryTransaction } from '@shared/types';
import { formatCurrency, numberToVietnameseText } from '@shared/utils/format';
import { formatVatRateLabel, vatAmountUnrounded } from '@shared/utils/vatRate';
import { roundInvoiceTotalsFromSums } from '@shared/utils/vndMoney';

export type WarehouseVoucherTT133PrintProps = {
  transaction: InventoryTransaction;
  itemSku: string;
  itemUnit: string;
  printUnit: string;
  onPrintUnitChange: (v: string) => void;
  printDepartment: string;
  onPrintDepartmentChange: (v: string) => void;
  debitAccount: string;
  creditAccount: string;
  /** true = khổ ngang (nhiều chỗ cho tên đơn vị dài) */
  printLandscape?: boolean;
};

/**
 * Mẫu Phiếu nhập kho (01-VT) / Phiếu xuất kho (02-VT) theo Thông tư 133/2016/TT-BTC — bản in.
 * Đơn vị & Bộ phận: ô nhập tay.
 */
export const WarehouseVoucherTT133Print: React.FC<WarehouseVoucherTT133PrintProps> = ({
  transaction,
  itemSku,
  itemUnit,
  printUnit,
  onPrintUnitChange,
  printDepartment,
  onPrintDepartmentChange,
  debitAccount,
  creditAccount,
  printLandscape = false,
}) => {
  const isImport = transaction.type === 'IMPORT';
  const t = new Date(transaction.date);
  const day = t.getDate();
  const month = t.getMonth() + 1;
  const year = t.getFullYear();

  const subTotal = transaction.quantity * transaction.price;
  const vatU = vatAmountUnrounded(subTotal, Number(transaction.vatRate));
  const { vatAmount, totalAmount: total } = roundInvoiceTotalsFromSums(subTotal, vatU);

  const qtyLabel2 = isImport ? 'Thực nạp' : 'Thực bàn giao';
  const formCode = isImport ? '01' : '02';
  const title = isImport ? 'Phiếu nạp tài nguyên' : 'Phiếu bàn giao/kích hoạt';

  const personLineLeft = isImport
    ? transaction.supplier || ''
    : transaction.customer || '';
  const refLine = [
    transaction.formNo && `Mẫu ${transaction.formNo}`,
    transaction.symbolCode && `Ký hiệu ${transaction.symbolCode}`,
    transaction.documentRef && `Số ${transaction.documentRef}`,
  ]
    .filter(Boolean)
    .join(', ');

  const warehouseLine = isImport
    ? `Nạp tại kho: .................... địa điểm................................................`
    : `Bàn giao/kích hoạt tại kho (ngăn lô): .................... Địa điểm................................................`;

  const fieldTextareaCls =
    'mt-0.5 box-border block w-full min-h-[2.75rem] min-w-0 resize-y break-words border border-dotted border-slate-600 bg-transparent px-1 py-1 text-[11px] font-normal leading-snug text-black outline-none whitespace-pre-wrap print:border-black';

  const pageMaxW = printLandscape ? 'max-w-[297mm]' : 'max-w-[210mm]';

  return (
    <div
      className={`inventory-voucher-tt133-wrap mx-auto box-border w-full ${pageMaxW} px-3 py-4 text-black print:px-0 print:py-0 font-['Times_New_Roman',_Times,_serif] text-[11px] leading-snug`}
    >
      {/* Header — Đơn vị/Bộ phận full width, xuống dòng khi tên dài */}
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-4">
        <div className="min-w-0 w-full flex-1 space-y-2">
          <div className="w-full min-w-0">
            <span className="font-bold">Đơn vị:</span>
            <textarea
              value={printUnit}
              onChange={(e) => onPrintUnitChange(e.target.value)}
              rows={3}
              className={fieldTextareaCls}
              placeholder="Nhập tên đơn vị (có thể nhiều dòng)…"
              aria-label="Đơn vị"
            />
          </div>
          <div className="w-full min-w-0">
            <span className="font-bold">Bộ phận:</span>
            <textarea
              value={printDepartment}
              onChange={(e) => onPrintDepartmentChange(e.target.value)}
              rows={2}
              className={fieldTextareaCls}
              placeholder="Nhập bộ phận…"
              aria-label="Bộ phận"
            />
          </div>
        </div>
        <div className="w-full shrink-0 text-left sm:max-w-[42%] sm:text-right text-[10px] leading-tight">
          <p className="font-bold">Mẫu số {formCode} - VT</p>
          <p className="mt-0.5 italic">
            (Ban hành theo Thông tư số 133/2016/TT-BTC
            <br />
            ngày 26/8/2016 của Bộ Tài chính)
          </p>
        </div>
      </div>

      {/* Title + Nợ/Có */}
      <div className="relative mb-3">
        <div className="absolute right-0 top-0 text-[11px]">
          <div className="flex gap-1">
            <span>Nợ</span>
            <span className="min-w-[5rem] border-b border-dotted border-black text-center font-mono">{debitAccount}</span>
          </div>
          <div className="mt-1 flex gap-1">
            <span>Có</span>
            <span className="min-w-[5rem] border-b border-dotted border-black text-center font-mono">{creditAccount}</span>
          </div>
        </div>
        <h1 className="text-center text-[17px] font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-center italic">
          Ngày {day} tháng {month} năm {year}
        </p>
        <p className="mt-1 text-center">
          Số: <span className="font-mono font-bold">{transaction.voucherNumber || '....................'}</span>
        </p>
      </div>

      {/* Info lines */}
      <div className="mb-3 space-y-1.5 text-[11px]">
        {isImport ? (
          <>
            <p>
              <span className="font-bold">- Họ và tên người giao:</span>{' '}
              <span className="border-b border-dotted border-black px-1">{personLineLeft || '................................'}</span>
            </p>
            <p>
              <span className="font-bold">- Theo</span>{' '}
              <span className="border-b border-dotted border-black px-1">{refLine || '......'}</span>{' '}
              <span className="font-bold">ngày {day} tháng {month} năm {year} của</span>{' '}
              <span className="border-b border-dotted border-black px-1">{transaction.supplier || '....................'}</span>
            </p>
            <p className="whitespace-pre-wrap">{warehouseLine}</p>
          </>
        ) : (
          <>
            <p>
              <span className="font-bold">- Họ và tên người nhận hàng:</span>{' '}
              <span className="border-b border-dotted border-black px-1">{personLineLeft || '................................'}</span>
              <span className="font-bold"> Địa chỉ (bộ phận):</span>{' '}
              <span className="border-b border-dotted border-black px-1">{transaction.customerAddress || '................................'}</span>
            </p>
            <p>
              <span className="font-bold">- Lý do bàn giao/kích hoạt:</span>{' '}
              <span className="border-b border-dotted border-black px-1">{transaction.exportPurpose || transaction.note || '................................'}</span>
            </p>
            <p className="whitespace-pre-wrap">{warehouseLine}</p>
          </>
        )}
      </div>

      {/* Table */}
      <table className="w-full border-collapse border border-black text-[10px] print:table-fixed">
        <thead className="print:table-header-group">
          <tr>
            <th className="border border-black px-0.5 py-1 font-bold" rowSpan={2} style={{ width: '4%' }}>
              STT
            </th>
            <th className="border border-black px-0.5 py-1 font-bold" rowSpan={2} style={{ width: '32%' }}>
              Tên, nhãn hiệu, quy cách, phẩm chất vật tư, dụng cụ sản phẩm, hàng hóa
            </th>
            <th className="border border-black px-0.5 py-1 font-bold" rowSpan={2} style={{ width: '9%' }}>
              Mã số
            </th>
            <th className="border border-black px-0.5 py-1 font-bold" rowSpan={2} style={{ width: '7%' }}>
              Đơn vị tính
            </th>
            <th className="border border-black px-0.5 py-1 font-bold text-center" colSpan={2}>
              Số lượng
            </th>
            <th className="border border-black px-0.5 py-1 font-bold" rowSpan={2} style={{ width: '11%' }}>
              Đơn giá
            </th>
            <th className="border border-black px-0.5 py-1 font-bold" rowSpan={2} style={{ width: '13%' }}>
              Thành tiền
            </th>
          </tr>
          <tr>
            <th className="border border-black px-0.5 py-0.5 font-normal">Theo chứng từ</th>
            <th className="border border-black px-0.5 py-0.5 font-normal">{qtyLabel2}</th>
          </tr>
          <tr>
            <th className="border border-black py-0.5 text-center font-normal">A</th>
            <th className="border border-black py-0.5 text-center font-normal">B</th>
            <th className="border border-black py-0.5 text-center font-normal">C</th>
            <th className="border border-black py-0.5 text-center font-normal">D</th>
            <th className="border border-black py-0.5 text-center font-normal">1</th>
            <th className="border border-black py-0.5 text-center font-normal">2</th>
            <th className="border border-black py-0.5 text-center font-normal">3</th>
            <th className="border border-black py-0.5 text-center font-normal">4</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-black px-0.5 py-1 text-center align-top">1</td>
            <td className="border border-black px-0.5 py-1 align-top">{transaction.itemName}</td>
            <td className="border border-black px-0.5 py-1 text-center align-top font-mono">{itemSku}</td>
            <td className="border border-black px-0.5 py-1 text-center align-top">{itemUnit}</td>
            <td className="border border-black px-0.5 py-1 text-right align-top">{transaction.quantity}</td>
            <td className="border border-black px-0.5 py-1 text-right align-top">{transaction.quantity}</td>
            <td className="border border-black px-0.5 py-1 text-right align-top">{formatCurrency(transaction.price)}</td>
            <td className="border border-black px-0.5 py-1 text-right align-top">{formatCurrency(subTotal)}</td>
          </tr>
          {vatAmount > 0 && (
            <tr>
              <td className="border border-black px-0.5 py-0.5 text-right" colSpan={7}>
                Thuế GTGT ({formatVatRateLabel(Number(transaction.vatRate))})
              </td>
              <td className="border border-black px-0.5 py-0.5 text-right">{formatCurrency(vatAmount)}</td>
            </tr>
          )}
          <tr>
            <td className="border border-black px-0.5 py-1"></td>
            <td className="border border-black px-0.5 py-1 text-center font-bold">Cộng</td>
            <td className="border border-black px-0.5 py-1 text-center">x</td>
            <td className="border border-black px-0.5 py-1 text-center">x</td>
            <td className="border border-black px-0.5 py-1 text-center">x</td>
            <td className="border border-black px-0.5 py-1 text-center">x</td>
            <td className="border border-black px-0.5 py-1 text-center">x</td>
            <td className="border border-black px-0.5 py-1 text-right font-bold">{formatCurrency(total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 space-y-1.5 text-[11px]">
        <p>
          <span className="font-bold">- Tổng số tiền (viết bằng chữ):</span>{' '}
          <span className="italic">{numberToVietnameseText(total)}</span>
        </p>
        <p>
          <span className="font-bold">- Số chứng từ gốc kèm theo:</span>{' '}
          <span className="border-b border-dotted border-black">{transaction.documentRef || '................................'}</span>
        </p>
      </div>

      {/* Chữ ký — (Ký, họ tên) chỉ in nghiêng, không đậm */}
      <div className="inventory-voucher-tt133-signatures mt-8 text-[10px]">
        {isImport ? (
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="font-bold leading-tight">Người lập phiếu</p>
              <p className="mt-8 italic font-normal">(Ký, họ tên)</p>
            </div>
            <div>
              <p className="font-bold leading-tight">Người giao hàng</p>
              <p className="mt-8 italic font-normal">(Ký, họ tên)</p>
            </div>
            <div>
              <p className="font-bold leading-tight">Thủ kho</p>
              <p className="mt-8 italic font-normal">(Ký, họ tên)</p>
            </div>
            <div>
              <p className="text-[9px] leading-tight font-bold">
                Kế toán trưởng
                <br />
                (Hoặc bộ phận có nhu cầu nhập)
              </p>
              <p className="mt-6 italic font-normal">(Ký, họ tên)</p>
            </div>
          </div>
        ) : (
          <div>
            <p className="mb-4 text-right italic font-normal">
              Ngày ... tháng ... năm .....
            </p>
            <div className="grid grid-cols-5 gap-1 text-center">
              <div>
                <p className="font-bold leading-tight">Người lập phiếu</p>
                <p className="mt-8 italic font-normal">(Ký, họ tên)</p>
              </div>
              <div>
                <p className="font-bold leading-tight">Người nhận hàng</p>
                <p className="mt-8 italic font-normal">(Ký, họ tên)</p>
              </div>
              <div>
                <p className="font-bold leading-tight">Thủ kho</p>
                <p className="mt-8 italic font-normal">(Ký, họ tên)</p>
              </div>
              <div>
                <p className="text-[9px] leading-tight font-bold">
                  Kế toán trưởng
                  <br />
                  (Hoặc bộ phận có nhu cầu nhập)
                </p>
                <p className="mt-6 italic font-normal">(Ký, họ tên)</p>
              </div>
              <div>
                <p className="font-bold leading-tight">Giám đốc</p>
                <p className="mt-8 italic font-normal">(Ký, họ tên)</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
