import React from 'react';
import { InventoryTransaction } from '@shared/types';
import { formatCurrency, numberToVietnameseText } from '@shared/utils/format';
import { getWarehouseVoucherPrintHeader } from '@shared/regulations/warehouseVoucherPrint';

export type WarehouseVoucherTT58ExportPrintProps = {
  transaction: InventoryTransaction;
  itemSku: string;
  itemUnit: string;
  printUnit: string;
  onPrintUnitChange: (v: string) => void;
  printDepartment: string;
  onPrintDepartmentChange: (v: string) => void;
  printLandscape?: boolean;
};

/**
 * Phiếu xuất kho (02-VT) theo Thông tư 58/2026/TT-BTC — bản in.
 */
export const WarehouseVoucherTT58ExportPrint: React.FC<WarehouseVoucherTT58ExportPrintProps> = ({
  transaction,
  itemSku,
  itemUnit,
  printUnit,
  onPrintUnitChange,
  printDepartment,
  onPrintDepartmentChange,
  printLandscape = false,
}) => {
  const t = new Date(transaction.date);
  const day = t.getDate();
  const month = t.getMonth() + 1;
  const year = t.getFullYear();
  const header = getWarehouseVoucherPrintHeader('TT58_2026', false);

  const subTotal = transaction.quantity * transaction.price;
  const warehouseName = String(transaction.warehouseName || '').trim();
  const warehouseLocation = String((transaction as { warehouseLocation?: string }).warehouseLocation || '').trim();
  const exportReason = String(transaction.exportPurpose || transaction.note || '').trim();

  const fieldTextareaCls =
    'mt-0.5 box-border block w-full min-h-[2.75rem] min-w-0 resize-y break-words border border-dotted border-slate-600 bg-transparent px-1 py-1 text-[11px] font-normal leading-snug text-black outline-none whitespace-pre-wrap print:border-black';

  const pageMaxW = printLandscape ? 'max-w-[297mm]' : 'max-w-[210mm]';
  const fmtMoney = (n: number) => formatCurrency(n).replace('₫', '').trim();

  const SignatureColumn: React.FC<{
    title: React.ReactNode;
    hint?: string;
  }> = ({ title, hint = '(Ký, ghi rõ họ tên)' }) => (
    <div className="voucher-sign-col flex flex-col items-center text-center">
      <div className="font-bold uppercase leading-tight">{title}</div>
      <p className="voucher-sign-col-hint mt-0.5 italic font-normal leading-tight print:mt-0">
        {hint}
      </p>
      <div className="mt-1.5 h-14 w-full print:mt-1 print:h-12" aria-hidden />
    </div>
  );

  return (
    <div
      className={`inventory-voucher-tt58-wrap mx-auto box-border w-full ${pageMaxW} px-3 py-4 text-black print:px-0 print:py-0 font-['Times_New_Roman',_Times,_serif] text-[11px] leading-snug`}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-4">
        <div className="min-w-0 w-full flex-1 space-y-2">
          <div className="w-full min-w-0">
            <span className="font-bold uppercase">Đơn vị:</span>
            <textarea
              value={printUnit}
              onChange={(e) => onPrintUnitChange(e.target.value)}
              rows={2}
              className={fieldTextareaCls}
              placeholder="Nhập tên đơn vị…"
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
        <div className="w-full shrink-0 text-left sm:max-w-[44%] sm:text-right text-[10px] leading-tight">
          <p className="font-bold text-[12px]">{header.formTitle}</p>
          <p className="mt-0.5 italic">
            {header.circularLines.map((line, index) => (
              <React.Fragment key={index}>
                {index > 0 && <br />}
                {line}
              </React.Fragment>
            ))}
          </p>
        </div>
      </div>

      <div className="relative mb-3">
        <p className="absolute right-0 top-0 text-[11px]">
          Số:{' '}
          <span className="font-mono font-bold border-b border-dotted border-black px-2">
            {transaction.voucherNumber || '....................'}
          </span>
        </p>
        <h1 className="text-center text-[17px] font-bold tracking-tight uppercase">Phiếu xuất kho</h1>
        <p className="mt-1 text-center italic">
          Ngày {day} tháng {month} năm {year}
        </p>
      </div>

      <div className="mb-3 space-y-1.5 text-[11px]">
        <p>
          <span className="font-bold">- Họ và tên người nhận hàng:</span>{' '}
          <span className="border-b border-dotted border-black px-1 inline-block min-w-[6rem]">
            {transaction.customer || '................................'}
          </span>
          <span className="font-bold"> Địa chỉ (bộ phận):</span>{' '}
          <span className="border-b border-dotted border-black px-1 inline-block min-w-[8rem]">
            {transaction.customerAddress || '................................'}
          </span>
        </p>
        <p>
          <span className="font-bold">- Lý do xuất kho:</span>{' '}
          <span className="border-b border-dotted border-black px-1">
            {exportReason || '................................'}
          </span>
        </p>
        <p>
          <span className="font-bold">- Xuất tại kho (ngăn lô):</span>{' '}
          <span className="border-b border-dotted border-black px-1 inline-block min-w-[8rem]">
            {warehouseName || '................................'}
          </span>{' '}
          <span className="font-bold">Địa điểm</span>{' '}
          <span className="border-b border-dotted border-black px-1 inline-block min-w-[10rem]">
            {warehouseLocation || '................................'}
          </span>
        </p>
      </div>

      <table className="w-full border-collapse border border-black text-[10px] print:table-fixed">
        <thead className="print:table-header-group">
          <tr>
            <th className="border border-black px-0.5 py-1 font-bold" rowSpan={2} style={{ width: '4%' }}>
              STT
            </th>
            <th className="border border-black px-0.5 py-1 font-bold" rowSpan={2} style={{ width: '32%' }}>
              Tên, nhãn hiệu, quy cách, phẩm chất vật liệu, dụng cụ, sản phẩm, hàng hóa
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
            <th className="border border-black px-0.5 py-0.5 font-normal">Yêu cầu</th>
            <th className="border border-black px-0.5 py-0.5 font-normal">Thực xuất</th>
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
            <td className="border border-black px-0.5 py-1 text-right align-top">{fmtMoney(transaction.price)}</td>
            <td className="border border-black px-0.5 py-1 text-right align-top">{fmtMoney(subTotal)}</td>
          </tr>
          <tr>
            <td className="border border-black px-0.5 py-1"></td>
            <td className="border border-black px-0.5 py-1 text-center font-bold">Cộng</td>
            <td className="border border-black px-0.5 py-1 text-center">x</td>
            <td className="border border-black px-0.5 py-1 text-center">x</td>
            <td className="border border-black px-0.5 py-1 text-center">x</td>
            <td className="border border-black px-0.5 py-1 text-center">x</td>
            <td className="border border-black px-0.5 py-1 text-center">x</td>
            <td className="border border-black px-0.5 py-1 text-right font-bold">{fmtMoney(subTotal)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 space-y-1.5 text-[11px]">
        <p>
          <span className="font-bold">- Tổng số tiền (viết bằng chữ):</span>{' '}
          <span className="italic border-b border-dotted border-black inline-block min-w-[60%]">
            {numberToVietnameseText(subTotal)}
          </span>
        </p>
        <p>
          <span className="font-bold">- Số chứng từ gốc kèm theo:</span>{' '}
          <span className="border-b border-dotted border-black px-1">
            {transaction.documentRef || '................................'}
          </span>
        </p>
      </div>

      <div className="inventory-voucher-tt58-signatures mt-8 text-[10px] print:mt-6">
        <p className="mb-3 text-right italic font-normal print:mb-2">
          Ngày {day} tháng {month} năm {year}
        </p>
        <div className="grid grid-cols-4 gap-2 text-center print:gap-1.5">
          <SignatureColumn title="Người nhận hàng" />
          <SignatureColumn title="Thủ kho" />
          <SignatureColumn
            title={
              <>
                <span className="block uppercase">Kế toán trưởng</span>
                <span className="mt-0.5 block text-[9px] font-bold normal-case leading-tight print:text-[8px]">
                  (Hoặc bộ phận có nhu cầu nhập)
                </span>
              </>
            }
          />
          <SignatureColumn
            title="Giám đốc"
            hint="(Ký, ghi rõ họ tên, đóng dấu)"
          />
        </div>
      </div>
    </div>
  );
};
