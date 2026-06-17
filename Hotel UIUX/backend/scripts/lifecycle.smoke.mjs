#!/usr/bin/env node
/**
 * Smoke test E2E cho DATA LIFECYCLE (chạy với backend đang LIVE).
 *
 *   node scripts/lifecycle.smoke.mjs
 *
 * ENV (tùy chọn):
 *   LC_BASE_URL   (mặc định http://localhost:3180)
 *   LC_EMAIL      (mặc định hanoivictory@gmail.com)
 *   LC_PASSWORD   (mặc định Hanoi@Victory2026)
 *
 * Dùng entity_type "lcTest" → ghi vào mảng scratch, KHÔNG đụng dữ liệu nghiệp vụ.
 */
const BASE = process.env.LC_BASE_URL || "http://localhost:3180";
const EMAIL = process.env.LC_EMAIL || "hanoivictory@gmail.com";
const PASSWORD = process.env.LC_PASSWORD || "Hanoi@Victory2026";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-client-id": "lifecycle-smoke-test",
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
  console.log(`[smoke] BASE=${BASE} EMAIL=${EMAIL}`);
  const id = `LC-SMOKE-${Date.now()}`;
  const type = "lcTest";

  // 0) Login
  const login = await api(null, "POST", "/api/auth/login/password", { identifier: EMAIL, password: PASSWORD });
  assert(login.status === 200 && login.data?.token, "đăng nhập super admin");
  const token = login.data?.token;
  if (!token) throw new Error("Không lấy được token — dừng test");

  // 1) CREATE
  const created = await api(token, "POST", `/api/lc/${type}`, { entity: { id, name: "Smoke A", amount: 100 } });
  assert(created.status === 200 && created.data?.version === 1 && created.data?.status === "ACTIVE", "createRecord → v1 ACTIVE");

  // 2) UPDATE
  const updated = await api(token, "PATCH", `/api/lc/${type}/${id}`, { patch: { amount: 200 } });
  assert(updated.status === 200 && updated.data?.version === 2, "updateRecord → v2 (version++)");

  // 3) DELETE (soft)
  const deleted = await api(token, "DELETE", `/api/lc/${type}/${id}`, { reason: "smoke test" });
  assert(deleted.status === 200 && deleted.data?.status === "SOFT_DELETED", "deleteRecord → SOFT_DELETED");

  // 4) Trash chứa record
  const trash = await api(token, "GET", `/api/lc/trash?type=${type}`);
  assert(Array.isArray(trash.data) && trash.data.some((r) => r.entity_id === id), "trash chứa record vừa xóa");

  // 5) RESTORE
  const restored = await api(token, "POST", `/api/lc/${type}/${id}/restore`);
  assert(restored.status === 200 && restored.data?.status === "ACTIVE", "restoreRecord → ACTIVE");

  // 6) Không cho restore khi đang ACTIVE (validate transition)
  const badRestore = await api(token, "POST", `/api/lc/${type}/${id}/restore`);
  assert(badRestore.status === 404 || badRestore.status === 409, "restore khi ACTIVE bị từ chối");

  // 7) ARCHIVE
  const archived = await api(token, "POST", `/api/lc/${type}/${id}/archive`);
  assert(archived.status === 200 && archived.data?.status === "ARCHIVED", "archiveRecord → ARCHIVED");
  const archiveList = await api(token, "GET", `/api/lc/archive?type=${type}`);
  assert(Array.isArray(archiveList.data) && archiveList.data.some((r) => r.entity_id === id), "archive list chứa record");

  // 8) PENDING_DELETE (từ ARCHIVED) rồi PURGE
  const pending = await api(token, "POST", `/api/lc/${type}/${id}/pending-delete`);
  assert(pending.status === 200 && pending.data?.status === "PENDING_DELETE", "markPendingDelete → PENDING_DELETE");

  const purged = await api(token, "POST", `/api/lc/${type}/${id}/purge`);
  assert(purged.status === 200 && purged.data?.status === "DELETED", "purgeRecord → DELETED");

  // 9) Sau purge: không còn ở trash/archive
  const trashAfter = await api(token, "GET", `/api/lc/trash?type=${type}`);
  assert(!(trashAfter.data || []).some((r) => r.entity_id === id), "sau purge không còn trong trash");

  // 10) Lịch sử version vẫn giữ (pháp lý)
  const versions = await api(token, "GET", `/api/lc/${type}/${id}/versions`);
  assert(Array.isArray(versions.data) && versions.data.length >= 5, "record_versions giữ lịch sử (>=5 bản)");

  console.log(`\n[smoke] PASS=${passed} FAIL=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[smoke] lỗi:", e);
  process.exit(1);
});
