#!/usr/bin/env node
/**
 * Smoke test E2E cho RBAC + quy trình XÓA CÓ KIỂM SOÁT (backend phải đang LIVE).
 *
 *   node scripts/rbacDelete.smoke.mjs
 *
 * ENV: LC_BASE_URL (mặc định http://localhost:3180), LC_EMAIL, LC_PASSWORD.
 *
 * Đăng nhập super_admin (full quyền) để chạy được toàn bộ flow + kiểm tra các "cổng an toàn":
 *   create → soft delete → (hard delete khi chưa request: chặn) → request
 *   → (hard delete khi chưa duyệt: chặn) → (confirm sai: chặn) → approve → hard delete OK.
 */
const BASE = process.env.LC_BASE_URL || 'http://localhost:3180';
const EMAIL = process.env.LC_EMAIL || 'hanoivictory@gmail.com';
const PASSWORD = process.env.LC_PASSWORD || 'Hanoi@Victory2026';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  OK  ${msg}`);
  } else {
    failed++;
    console.error(`  XX  ${msg}`);
  }
}

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'x-client-id': 'rbac-delete-smoke',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

async function main() {
  console.log(`[smoke-rbac] BASE=${BASE} EMAIL=${EMAIL}`);
  const id = `RBAC-SMOKE-${Date.now()}`;
  const type = 'lcTest';

  const login = await api(null, 'POST', '/api/auth/login/password', { identifier: EMAIL, password: PASSWORD });
  assert(login.status === 200 && login.data?.token, 'đăng nhập super admin');
  const token = login.data?.token;
  if (!token) throw new Error('Không lấy được token — dừng test');

  // /me phải có các quyền delete:*
  const me = await api(token, 'GET', '/api/me');
  assert(me.status === 200 && me.data?.role === 'super_admin', '/me trả role super_admin');

  // create + soft delete
  assert((await api(token, 'POST', `/api/lc/${type}`, { entity: { id, name: 'RBAC A' } })).data?.version === 1, 'create v1');
  const soft = await api(token, 'DELETE', `/api/lc/${type}/${id}`, { reason: 'rbac test' });
  assert(soft.status === 200 && soft.data?.status === 'SOFT_DELETED', 'soft delete → SOFT_DELETED');

  // GATE 1: hard delete khi chưa request (đang SOFT_DELETED) → bị chặn
  const hardTooEarly = await api(token, 'POST', `/api/lc/${type}/${id}/hard-delete`, { confirm: 'DELETE' });
  assert(hardTooEarly.status === 409, 'chặn hard-delete khi chưa ở PENDING_DELETE');

  // request delete
  const req = await api(token, 'POST', `/api/lc/${type}/${id}/request-delete`);
  assert(req.status === 200 && req.data?.status === 'PENDING_DELETE' && req.data?.approved === false, 'request-delete → PENDING_DELETE (chưa duyệt)');

  // pending list chứa record + approved=0
  const pending = await api(token, 'GET', `/api/lc/pending-delete?type=${type}`);
  assert(Array.isArray(pending.data) && pending.data.some((r) => r.entity_id === id && !r.approved), 'pending list chứa record chưa duyệt');

  // GATE 2: hard delete khi chưa duyệt → bị chặn
  const hardNotApproved = await api(token, 'POST', `/api/lc/${type}/${id}/hard-delete`, { confirm: 'DELETE' });
  assert(hardNotApproved.status === 409 && hardNotApproved.data?.code === 'NOT_APPROVED', 'chặn hard-delete khi chưa duyệt');

  // approve
  const appr = await api(token, 'POST', `/api/lc/${type}/${id}/approve-delete`);
  assert(appr.status === 200 && appr.data?.approved === true, 'approve-delete → approved=true');

  // GATE 3: confirm sai → bị chặn
  const wrongConfirm = await api(token, 'POST', `/api/lc/${type}/${id}/hard-delete`, { confirm: 'xoa' });
  assert(wrongConfirm.status === 400 && wrongConfirm.data?.code === 'CONFIRM_REQUIRED', 'chặn hard-delete khi confirm sai');

  // hard delete OK (có delay vài giây ở server)
  console.log('  ..  chờ hard-delete (server có delay an toàn ~5s)…');
  const hard = await api(token, 'POST', `/api/lc/${type}/${id}/hard-delete`, { confirm: 'DELETE' });
  assert(hard.status === 200 && hard.data?.status === 'DELETED', 'hard-delete OK → DELETED');

  // sau hard-delete: không còn ở pending
  const pendingAfter = await api(token, 'GET', `/api/lc/pending-delete?type=${type}`);
  assert(!(pendingAfter.data || []).some((r) => r.entity_id === id), 'sau hard-delete không còn trong pending');

  console.log(`\n[smoke-rbac] PASS=${passed} FAIL=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[smoke-rbac] lỗi:', e);
  process.exit(1);
});
