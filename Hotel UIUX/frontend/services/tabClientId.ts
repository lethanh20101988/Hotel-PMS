/** Mỗi lần load tab = một client id riêng (không dùng sessionStorage — tránh tab duplicate chung id). */
let tabClientId = '';

export function getTabClientId(): string {
  if (!tabClientId) {
    try {
      tabClientId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    } catch {
      tabClientId = `client-${Date.now()}`;
    }
  }
  return tabClientId;
}
