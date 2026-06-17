# Enterprise Realtime — Outbox + Idempotency + Deploy

Stack: Node.js, `ws`, Redis Pub/Sub, PostgreSQL, Prisma, Docker multi-container.

## 1. Event idempotency

Mỗi outbox row có **`event_id` (UUID)** — dùng làm `eventId` trên WebSocket và `id` trong Redis envelope.

**Backend** (`src/outbox/eventId.ts`):

```typescript
import crypto from "node:crypto";
export function generateEventId(): string {
  return crypto.randomUUID();
}
```

**Ví dụ wire payload** (sau worker publish `order_updated`):

```json
{
  "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "event": "order_updated",
  "at": 1718380800000,
  "companyId": "default-company",
  "payload": {
    "orderId": "booking-abc123",
    "companyId": "default-company",
    "status": "active",
    "changedFields": ["services", "paidAmount"]
  }
}
```

**Frontend** (`frontend/services/realtimeClient.ts`): ring buffer 500 `eventId` — ignore duplicate.

Redis retry publish cùng `eventId` → client bỏ qua → không double refresh UI.

---

## 2. Outbox pattern

### Prisma (`event_outbox`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | cuid | PK row |
| `event_id` | UUID unique | Idempotent wire id |
| `event_type` | string | `order_updated`, … |
| `payload` | JSON | targetRooms + business data |
| `status` | pending / processing / sent / failed |
| `created_at`, `updated_at` | timestamps |

### PUT `/api/state` (transaction)

```typescript
await prisma.$transaction(async (tx) => {
  await tx.appState.upsert({ ... });
  await enqueueOutboxEvents(tx, bookingOutboxEvents); // mỗi row có eventId mới
});
```

### Worker flow

1. `SELECT … FOR UPDATE SKIP LOCKED` (batch 50)
2. `status = processing`
3. `publishWithId(event_id)` → Redis
4. `status = sent` hoặc retry `pending` (max 10 attempts)
5. `processing` stale > 5 phút → `pending`

---

## 3. Schema gate (`waitForSchemaReady`)

`src/outbox/schemaReady.ts` — retry 180s, kiểm tra:

- table `event_outbox`
- column `event_id`

Gọi trong `outboxWorker.ts` trước khi poll.

---

## 4. Deploy migrate gate

```bash
docker compose -f infra/docker/docker-compose.yml build
docker compose -f infra/docker/docker-compose.yml run --rm migrate
docker compose -f infra/docker/docker-compose.yml up -d
```

Services: `migrate` → `backend` / `event-dispatcher` (`service_completed_successfully`).

Entrypoints:

- `docker-entrypoint-migrate.sh` — migrate only
- `docker-entrypoint.sh` — wait DB + migrate + API
- `docker-entrypoint-worker.sh` — wait DB + `node dist/outboxWorker.js`

---

## 5. Fault tolerance

| Failure | Handling |
|---------|----------|
| Redis disconnect | `reconnectStrategy` + publish retry 3x |
| Worker crash after publish | Stale `processing` → `pending` → re-publish (client idempotent) |
| Server restart | Rows `pending` in DB → worker continues |
| Multi worker | `SKIP LOCKED` — no duplicate row processing |

---

## 6. WebSocket routing (no global broadcast)

| Event | Rooms |
|-------|-------|
| `order_updated` | `order:{orderId}`, `company:{companyId}` |
| `notification_created` | `company:{companyId}`, `user:{userId}` |

Client join: `{ type: "join", rooms: ["order:booking-id"] }`.

---

## 7. Monitoring

- `GET /api/realtime/stats` — connections, events/sec, latency
- `GET /api/realtime/outbox/stats` — pending/sent/failed
- JSON logs: `outbox`, `outbox-dispatch`, `outbox-worker`

---

## 8. Best practices

1. Migration **additive** trước khi deploy code mới.
2. Một job `migrate` trước scale API.
3. Worker **không** chạy `migrate deploy`.
4. Outbox trong **mọi** transaction ghi booking/notification realtime.
5. Không publish Redis từ HTTP handler cho booking events.

Xem thêm: `docs/DEPLOY-REALTIME.md`.
