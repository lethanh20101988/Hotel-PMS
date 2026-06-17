#!/usr/bin/env sh
# Chờ PostgreSQL accept connection (trước migrate / worker).
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[wait-db] DATABASE_URL is required"
  exit 1
fi

exec node scripts/wait-for-postgres.mjs
