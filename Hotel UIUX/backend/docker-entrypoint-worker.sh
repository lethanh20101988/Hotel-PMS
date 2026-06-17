#!/usr/bin/env sh
# Worker entrypoint — migrate gate qua compose; schema check trong outboxWorker.ts (waitForSchemaReady).
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[worker] DATABASE_URL is required"
  exit 1
fi

./scripts/wait-for-postgres.sh

echo "[worker] starting event dispatcher (schema check inside Node process)..."
exec node dist/outboxWorker.js
