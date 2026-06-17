#!/usr/bin/env sh
# One-shot migrate job — chạy TRƯỚC backend scale và worker.
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[migrate] DATABASE_URL is required"
  exit 1
fi

./scripts/wait-for-postgres.sh

echo "[migrate] Running prisma migrate deploy..."
if ! npx prisma migrate deploy; then
  echo "[migrate] FAILED — deployment must not continue (API/worker would use wrong schema)"
  exit 1
fi

echo "[migrate] Success — schema is up to date"
