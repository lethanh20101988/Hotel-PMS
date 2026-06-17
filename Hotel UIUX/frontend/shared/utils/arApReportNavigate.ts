import type { ArApNavTarget } from './arApSubledger';

export const SESSION_OPEN_INVOICE_PAYLOAD = 'victory_open_invoice_payload';
export const SESSION_INVOICE_NAV_HINT = 'victory_invoice_nav_hint';
export const SESSION_OPEN_FUND_ID = 'victory_open_fund_id';

/** Điều hướng từ báo cáo Nợ phải thu / trả (double-click). */
export function triggerArApReportNavigation(target: ArApNavTarget | null): void {
  if (!target) {
    window.alert('Không xác định được hóa đơn hoặc chứng từ liên quan cho dòng này.');
    return;
  }
  try {
    if (target.mode === 'INVOICE') {
      sessionStorage.setItem(
        SESSION_OPEN_INVOICE_PAYLOAD,
        JSON.stringify({ invoiceId: target.invoiceId, listTab: target.listTab }),
      );
      window.dispatchEvent(new CustomEvent('victory:navigate', { detail: { tab: 'invoices' } }));
      return;
    }
    if (target.mode === 'FUND') {
      sessionStorage.setItem(SESSION_OPEN_FUND_ID, target.fundId);
      window.dispatchEvent(new CustomEvent('victory:navigate', { detail: { tab: 'fund' } }));
      return;
    }
    sessionStorage.setItem(
      SESSION_INVOICE_NAV_HINT,
      JSON.stringify({
        searchTerm: target.searchTerm,
        directionFilter: target.directionFilter,
        listTab: target.listTab,
      }),
    );
    window.dispatchEvent(new CustomEvent('victory:navigate', { detail: { tab: 'invoices' } }));
  } catch {
    window.alert('Không thể mở màn hình đích (trình duyệt chặn lưu tạm).');
  }
}
