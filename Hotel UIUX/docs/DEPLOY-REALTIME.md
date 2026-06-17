# Deploy Realtime + Outbox (Production)

## Tại sao migrate phải chạy trước worker?

Outbox pattern gắn **business write** và **event row** trong một transaction:

```sql
BEGIN;
  UPDATE AppState ...;
  INSERT INTO "EventOutbox" (...);
COMMIT;
```

Worker đọc bảng `EventOutbox` với Prisma model `eventOutbox`. Nếu migration **chưa chạy**:

| Tình huống | Hậu quả |
|------------|---------|
| API mới + DB cũ (không có `EventOutbox`) | `PUT /api/state` **fail** → booking không lưu, hoặc transaction rollback |
| Worker cũ + DB mới | Worker crash loop `table does not exist` |
| Worker chạy trước migrate | Crash / retry vô hạn; events có thể kẹt `processing` |
| API ghi outbox OK, worker schema lệch | Publish sai payload / query fail → **event không ra Redis** |

**Migrate deploy** tạo bảng + index (`EventOutbox_status_createdAt_idx`) và ghi `_prisma_migrations`. Worker và API **phải** dùng cùng schema version.

**Không mất event** khi deploy đúng:

1. Event chỉ “sống” sau COMMIT — nếu INSERT outbox fail (no table), cả transaction rollback → không có event ma, không có booking lệch.
2. Sau migrate, worker poll `pending` → publish → `sent`. Event nằm trong DB cho đến khi worker xử lý.

## Thứ tự start (production)

```text
1. postgres     (healthcheck: pg_isready)
2. redis        (optional healthcheck)
3. migrate      (one-shot: prisma migrate deploy) → exit 0
4. backend x N  (API — có thể migrate lại, Prisma lock an toàn)
5. event-dispatcher (chờ schema OK, KHÔNG migrate)
6. frontend
```

Docker Compose (`infra/docker/docker-compose.yml`):

- Service `migrate`: `docker-entrypoint-migrate.sh`, `restart: "no"`
- `backend` / `event-dispatcher`: `depends_on: migrate: service_completed_successfully`

## Entrypoint scripts (trong repo)

| Script | Ai chạy | Việc làm |
|--------|---------|----------|
| `scripts/wait-for-postgres.sh` | migrate, backend, worker | Chờ DB accept connection |
| `docker-entrypoint-migrate.sh` | Job `migrate` | wait → `migrate deploy` → exit |
| `docker-entrypoint.sh` | `backend` | wait → `migrate deploy` → `node dist/index.js` |
| `docker-entrypoint-worker.sh` | `event-dispatcher` | wait schema → verify `EventOutbox` → worker |

Worker **không** gọi `migrate deploy` — tránh race nhiều replica + worker cùng migrate.

## Rollback khi migrate fail

1. **Container migrate exit 1** → Compose không start backend/worker (`service_completed_successfully`).
2. **Không deploy image mới** cho API nếu migration pending — CI nên:

```bash
docker compose run --rm migrate
# chỉ khi exit 0 → scale backend
```

3. **Prisma migrate failed giữa chừng**: một migration partially applied → cần ops:
   - Đọc log `prisma migrate deploy`
   - `prisma migrate resolve` (rolled-back / applied) theo [Prisma docs](https://www.prisma.io/docs/orm/prisma-migrate/workflows/troubleshooting)
   - Restore DB snapshot nếu migration destructive

4. **Rollback app không rollback DB**: deploy image cũ + DB đã migrate forward → có thể lỗi nếu code cũ không biết column mới. Best practice:
   - Migration **backward-compatible** (add column nullable, add table)
   - Feature flag tắt code đọc outbox cho đến khi worker sẵn sàng

## Lệnh deploy gợi ý

```bash
# Build
docker compose -f infra/docker/docker-compose.yml build

# Migrate first (one-shot)
docker compose -f infra/docker/docker-compose.yml run --rm migrate

# Full stack
docker compose -f infra/docker/docker-compose.yml up -d

# Scale API sau migrate OK
docker compose -f infra/docker/docker-compose.yml up -d --scale backend=3
```

## Kiểm tra sau deploy

```bash
# Outbox queue
curl -H "Authorization: Bearer $TOKEN" http://localhost:3180/api/realtime/outbox/stats

# Worker logs
docker compose -f infra/docker/docker-compose.yml logs -f event-dispatcher
```

Expected: `EventOutbox verified — starting event dispatcher`.
