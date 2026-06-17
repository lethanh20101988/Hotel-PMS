/**
 * Smoke test: health, AppState hydration, login + authenticated API.
 * Temporarily sets a known password on the super-admin user, then restores the original hash.
 *
 * Usage (running backend container):
 *   API_BASE_URL=http://127.0.0.1:4000 node scripts/smokeTestApi.mjs
 *
 * From host via Docker:
 *   docker compose -f infra/docker/docker-compose.yml exec backend \
 *     node scripts/smokeTestApi.mjs
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const API_BASE = String(process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const TEST_EMAIL = String(process.env.SMOKE_TEST_EMAIL || process.env.SUPER_ADMIN_EMAIL || "hanoivictory@gmail.com").trim();
const TEST_PASSWORD = String(process.env.SMOKE_TEST_PASSWORD || "SmokeTest-Temp-2026!");

const prisma = new PrismaClient();

function fail(msg) {
  console.error("[smoke] FAIL:", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[smoke] OK:", msg);
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, opts);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
}

async function main() {
  const { res: healthRes, body: health } = await fetchJson("/api/health");
  if (!healthRes.ok || health?.ok !== true) fail(`health ${healthRes.status}: ${JSON.stringify(health)}`);
  ok("health");

  const { res: stateRes, body: state } = await fetchJson("/api/state");
  if (!stateRes.ok) fail(`state ${stateRes.status}`);
  const accounts = Array.isArray(state?.accounts) ? state.accounts.length : 0;
  if (accounts < 1) fail(`state.accounts empty (got ${accounts})`);
  ok(`state hydrated (${accounts} accounts)`);

  const user = await prisma.user.findFirst({
    where: { email: TEST_EMAIL },
    select: { id: true, email: true, passwordHash: true, status: true },
  });
  if (!user) fail(`user not found: ${TEST_EMAIL}`);
  if (user.status !== "active") fail(`user not active: ${user.status}`);

  const originalHash = user.passwordHash;
  const tempHash = await bcrypt.hash(TEST_PASSWORD, 12);

  try {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: tempHash } });

    const { res: loginRes, body: login } = await fetchJson("/api/auth/login/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    if (!loginRes.ok || !login?.token) fail(`login ${loginRes.status}: ${JSON.stringify(login)}`);
    ok(`login (${user.email})`);

    const { res: backupRes, body: backup } = await fetchJson("/api/backup/info", {
      headers: { Authorization: `Bearer ${login.token}` },
    });
    if (!backupRes.ok || !backup?.baseDir) fail(`backup/info ${backupRes.status}: ${JSON.stringify(backup)}`);
    ok("authenticated backup/info");
  } finally {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: originalHash } });
    ok("restored original password hash");
  }

  console.log("[smoke] All checks passed.");
}

main()
  .catch((err) => {
    console.error("[smoke] ERROR:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
