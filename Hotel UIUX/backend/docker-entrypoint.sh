#!/usr/bin/env sh
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required"
  exit 1
fi

./scripts/wait-for-postgres.sh

echo "Running Prisma migrations..."
if ! npx prisma migrate deploy; then
  echo "[backend] migrate deploy FAILED — container exits, no API traffic with stale schema"
  exit 1
fi

echo "Starting backend (single Node process — no pm2 cluster)..."
exec node dist/index.js
