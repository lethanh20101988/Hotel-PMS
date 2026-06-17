
import React from 'react';
import { Eye, X, Printer } from 'lucide-react';
import { FundTransaction } from '@shared/types';
import { formatCurrency, numberToVietnameseText } from '@shared/utils/format';
import { useApp } from '../../../app/store';
import { getCashVoucherPrintHeader } from '@shared/regulations/cashVoucherPrint';

interface FundDetailModalProps {
  transaction: FundTransaction | null;
  onClose: () => void;
}

export const FundDetailModal: React.FC<FundDetailModalProps> = ({ transaction, onClose }) => {
  const { companyInfo, journalEntries, systemConfig } = useApp();
  if (!transaction) return null;

  const isReceipt = transaction.type === 'RECEIPT';
  const printHeader = getCashVoucherPrintHeader(systemConfig.accountingRegime?.standard, isReceipt);
  const printUnitName = String(companyInfo.name || '').trim() || '........................................';
  const printUnitAddress =
    [companyInfo.address, companyInfo.city].map((s) => String(s || '').trim()).filter(Boolean).join(', ') ||
    '........................................';
  
  // Tìm tài khoản Nợ/Có từ Nhật ký chung
  const relatedJE = journalEntries.find(je =>
    je.referenceId === transaction.voucherNumber ||
    je.referenceId === transaction.id ||
    (transaction.referenceDoc && je.referenceId === transaction.referenceDoc)
  );
  const fallbackMoneyAccount = transaction.method === 'BANK' ? (transaction.bankLedgerAccountCode || '1121') : '1111';
  const debitAcc = relatedJE?.details.find(d => d.debit > 0)?.account || (isReceipt ? fallbackMoneyAccount : '---');
  const creditAcc = relatedJE?.details.find(d => d.credit > 0)?.account || (isReceipt ? '---' : fallbackMoneyAccount);

  const handlePrint = () => {
    window.print();
  };

  const tDate = new Date(transaction.date);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 print:p-0 print:bg-white print:static overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl overflow-hidden animate-fade-in print:shadow-none print:max-w-none print:w-[290mm] print:rounded-none font-['Times_New_Roman',_Times,_serif]">
        
        {/* UI Header - Chỉ hiển thị trên màn hình, kích thước nhỏ gọn */}
        <div className={`p-2 text-white flex justify-between items-center print:hidden ${isReceipt ? 'bg-emerald-600' : 'bg-red-600'}`}>
          <h3 className="ml-2 flex items-center gap-2 font-sans text-xs font-bold">
            <Eye className="w-3.5 h-3.5" aria-hidden /> Chi tiết {isReceipt ? 'phiếu thu' : 'phiếu chi'}
          </h3>
          <div className="flex gap-2 font-sans">
             <button 
                onClick={handlePrint}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded text-[11px] font-bold transition-all"
             >
                <Printer className="w-3.5 h-3.5" /> In Phiếu (A4 Ngang)
             </button>
             <button onClick={onClose} className="hover:bg-white/20 p-1 rounded transition-colors"><X className="w-4 h-4" /></button>
          </div>
        </div>
        
        {/* Printable Area - Thiết kế tinh gọn, bám sát mẫu ảnh và đồng bộ kích thước */}
        <div className="p-6 print:p-8 text-black bg-white flex flex-col mx-auto box-border" style={{ width: '100%', maxWidth: '290mm' }}>
           
           {/* Top Section: Đơn vị & Mẫu số - Cập nhật nội dung Thông tư bám sát hình ảnh */}
           <div className="flex justify-between items-start mb-2">
              <div className="w-[50%] min-w-0 text-left space-y-0.5">
                 <p className="font-bold text-[13px] leading-snug break-words">
                    Đơn vị: {printUnitName}
                 </p>
                 <p className="font-bold text-[13px] leading-snug break-words">
                    Địa chỉ: {printUnitAddress}
                 </p>
              </div>
              <div className="text-center w-[45%]">
                 <p className="font-bold text-[15px]">{printHeader.formTitle}</p>
                 <p className="text-[12px] leading-tight mt-0.5">
                    {printHeader.circularLines.map((line, index) => (
                      <React.Fragment key={index}>
                        {index > 0 && <br />}
                        {line}
                      </React.Fragment>
                    ))}
                 </p>
              </div>
           </div>

           {/* Title & Accounting Info - Căn giữa cân đối */}
           <div className="relative mt-2 mb-6">
              <div className="text-center">
                 <h2 className="text-2xl font-bold tracking-tight">{isReceipt ? 'Phiếu thu' : 'Phiếu chi'}</h2>
                 <p className="italic text-[13px] mt-0.5">
                    Ngày {tDate.getDate()} tháng {tDate.getMonth() + 1} năm {tDate.getFullYear()}
                 </p>
              </div>
              
              <div className="absolute right-2 top-0 text-right text-[12px] space-y-0.5">
                 <p>Quyển số:....................</p>
                 <div className="flex justify-end gap-1.5 items-end">
                    <span>Số:</span> <span className="font-bold min-w-[140px] text-center border-b border-black">{transaction.voucherNumber || transaction.id.split('-').pop()}</span>
                 </div>
                 <div className="flex justify-end gap-1.5 items-end">
                    <span>Nợ:</span> <span className="font-bold min-w-[60px] text-center border-b border-black">{debitAcc}</span>
                 </div>
                 <div className="flex justify-end gap-1.5 items-end">
                    <span>Có:</span> <span className="font-bold min-w-[60px] text-center border-b border-black">{creditAcc}</span>
                 </div>
              </div>
           </div>

           {/* Content Body with dotted lines - Thu hẹp khoảng cách dòng */}
           <div className="space-y-2 text-[14px] px-2">
              <div className="flex items-end w-full">
                 <span className="shrink-0">{isReceipt ? 'Họ và tên người nộp tiền:' : 'Họ và tên người nhận tiền:'}</span>
                 <span className="ml-1 flex-1 border-b border-dotted border-black px-2 pb-0.5 font-bold">{transaction.payerReceiver}</span>
              </div>

              <div className="flex items-end w-full">
                 <span className="shrink-0">Địa chỉ:</span>
                 <span className="flex-1 border-b border-dotted border-black px-2 ml-1 pb-0.5">{companyInfo.city}</span>
              </div>

              {transaction.method === 'BANK' && (
                <>
                  <div className="flex items-end w-full">
                     <span className="shrink-0">Ngân hàng:</span>
                     <span className="flex-1 border-b border-dotted border-black px-2 ml-1 pb-0.5">{transaction.bankName || ''}</span>
                  </div>
                  <div className="flex items-end w-full">
                     <span className="shrink-0">Số tài khoản:</span>
                     <span className="flex-1 border-b border-dotted border-black px-2 ml-1 pb-0.5">
                       {transaction.bankAccountNumber || transaction.bankLedgerAccountCode || ''}
                     </span>
                  </div>
                </>
              )}

              <div className="flex items-end w-full">
                 <span className="shrink-0">{isReceipt ? 'Lý do nộp:' : 'Lý do chi:'}</span>
                 <span className="flex-1 border-b border-dotted border-black px-2 ml-1 pb-0.5">{transaction.description}</span>
              </div>

              <div className="flex items-end w-full gap-2">
                 <div className="flex items-end gap-1 shrink-0">
                    <span className="shrink-0">Số tiền:</span>
                    <span className="font-bold border-b border-black px-3 text-lg">{formatCurrency(transaction.amount)}</span>
                 </div>
                 <div className="flex-1 flex items-end gap-1 overflow-hidden">
                    <span className="shrink-0 italic">(Viết bằng chữ):</span>
                    <span className="flex-1 border-b border-dotted border-black px-2 font-bold italic pb-0.5 truncate">{numberToVietnameseText(transaction.amount)}</span>
                 </div>
              </div>

              <div className="flex items-end w-full">
                 <span className="shrink-0">Kèm theo:</span>
                 <span className="flex-1 border-b border-dotted border-black px-2 ml-1 pb-0.5">{transaction.referenceDoc || ''}</span>
                 <span className="shrink-0 ml-2">Chứng từ gốc:</span>
                 <span className="w-24 border-b border-dotted border-black ml-1"></span>
              </div>
           </div>

           {/* Signatures Section - Thu gọn chiều cao */}
           <div className="mt-6">
              <div className="text-right italic text-[13px] mb-2 pr-12">
                 Ngày {tDate.getDate()} tháng {tDate.getMonth() + 1} năm {tDate.getFullYear()}
              </div>
              <div className="grid grid-cols-5 gap-1 text-center text-[11px] font-bold leading-tight">
                 <div className="flex flex-col h-20 justify-between">
                    <p>Giám đốc</p>
                    <p className="italic font-normal normal-case text-[10px] mt-0.5">(Ký, họ tên, đóng dấu)</p>
                 </div>
                 <div className="flex flex-col h-20 justify-between">
                    <p>Kế toán trưởng</p>
                    <p className="italic font-normal normal-case text-[10px] mt-0.5">(Ký, họ tên)</p>
                 </div>
                 <div className="flex flex-col h-20 justify-between">
                    <p>{isReceipt ? 'Người nộp tiền' : 'Người nhận tiền'}</p>
                    <p className="italic font-normal normal-case text-[10px] mt-0.5">(Ký, họ tên)</p>
                 </div>
                 <div className="flex flex-col h-20 justify-between">
                    <p>Người lập phiếu</p>
                    <p className="italic font-normal normal-case text-[10px] mt-0.5">(Ký, họ tên)</p>
                 </div>
                 <div className="flex flex-col h-20 justify-between">
                    <p>Thủ quỹ</p>
                    <p className="italic font-normal normal-case text-[10px] mt-0.5">(Ký, họ tên)</p>
                 </div>
              </div>
           </div>

           {/* Footer: Receipt confirmation - Thu gọn hàng dưới */}
           <div className="mt-8 space-y-2 text-[12px] pt-2 border-t border-slate-200">
              <div className="flex items-end w-full">
                 <span className="shrink-0 text-[11px] font-bold">Đã nhận đủ số tiền (viết bằng chữ):</span>
                 <span className="flex-1 border-b border-dotted border-black ml-1 pb-0.5"></span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="flex items-end w-full">
                    <span className="shrink-0">+ Tỷ giá ngoại tệ (vàng bạc, đá quý):</span>
                    <span className="flex-1 border-b border-dotted border-black ml-1 pb-0.5"></span>
                 </div>
                 <div className="flex items-end w-full">
                    <span className="shrink-0">+ Số tiền quy đổi:</span>
                    <span className="flex-1 border-b border-dotted border-black ml-1 pb-0.5"></span>
                 </div>
              </div>
              <p className="italic text-[10px] text-slate-500 mt-1 text-right">(Liên gửi ra ngoài phải đóng dấu)</p>
           </div>
        </div>

        {/* UI Footer - Chỉ hiển thị trên màn hình */}
        <div className="p-2 bg-slate-50 border-t flex justify-end gap-2 print:hidden font-sans">
           <button onClick={onClose} className="px-5 py-1.5 bg-slate-200 text-slate-700 rounded text-[11px] font-bold hover:bg-slate-300 transition-all">
              Đóng cửa sổ
           </button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { 
            size: A4 landscape; 
            margin: 5mm; 
          }
          body { 
            background: white !important; 
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
          }
          .fixed { 
            position: absolute !important; 
            background: transparent !important; 
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
            top: 0;
            left: 0;
            width: 100%;
          }
          .shadow-xl { box-shadow: none !important; }
          body * { visibility: hidden; }
          .print\\:static, .print\\:static * { visibility: visible; }
          .print\\:hidden { display: none !important; }
          
          * {
            font-family: 'Times New Roman', Times, serif !important;
            color: black !important;
            box-sizing: border-box !important;
          }

          .print\\:w-\\[290mm\\] {
             width: 290mm !important;
             max-width: 290mm !important;
             height: auto !important;
             margin: 0 auto !important;
             padding: 0 !important;
             overflow: hidden !important;
          }
          
          .border-dotted { border-style: dotted !important; }
        }
      `}} />
    </div>
  );
};
