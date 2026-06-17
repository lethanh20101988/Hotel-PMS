# Event-Driven Realtime (Enterprise)

Transactional Outbox + Redis Event Bus + WebSocket room routing cho Hotel PMS.

## Kiến trúc

```
PUT /api/state (booking thay đổi)
  └─ PostgreSQL transaction
       ├─ AppState.upsert (hotelPms)
       └─ EventOutbox.insert (pending)

Event Dispatcher (worker)
  └─ SELECT pending FOR UPDATE SKIP LOCKED
  └─ publish Redis (id = outbox.id)
  └─ status = sent

API replicas (backend x N)
  └─ Redis subscribe → RoomManager.emitToRooms
       ├─ order:{bookingId}
       ├─ company:{companyId}
       └─ user:{userId} (notification)

Frontend
  └─ join order:{id} khi xem booking
  └─ ignore duplicate eventId
```

## Bảng `EventOutbox`

| Cột | Mô tả |
|-----|--------|
| `id` | CUID — **event id idempotent** trên WS wire |
| `eventType` | `order_created`, `order_updated`, `notification_created` |
| `payload` | JSON envelope (targetRooms + business payload) |
| `status` | `pending` → `processing` → `sent` / `failed` |
| `attempts` | Retry counter (max 10) |
| `createdAt` / `sentAt` | Audit |

## Event mapping

| Event | Rooms |
|-------|-------|
| `order_updated` | `order:{orderId}`, `company:{companyId}` |
| `order_created` | `order:{orderId}`, `company:{companyId}` |
| `notification_created` | `company:{companyId}`, `user:{userId}?` |
| `state_changed` | `company:{companyId}` (direct Redis, không outbox) |

Booking id PMS = `orderId` trong room `order:{bookingId}`.

## Chạy worker

### Docker (production)

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build event-dispatcher
```

Service `event-dispatcher` chạy `node dist/outboxWorker.js`.

### Dev — inline trong API

```bash
OUTBOX_DISPATCH_INLINE=1 npm run dev
```

Không chạy cả inline worker và `event-dispatcher` cùng lúc (trùng dispatch).

## Idempotency

- Mỗi outbox row có stable `id` → Redis envelope `id` → WS `eventId`.
- Client (`realtimeClient.ts`) giữ ring buffer 500 `eventId` đã xử lý.
- Worker retry / Redis at-least-once không gây double refresh UI.

## Fault tolerance

| Thành phần | Cơ chế |
|------------|--------|
| DB crash sau commit | Outbox `pending` — worker gửi lại |
| Redis disconnect | Publisher retry 3x; worker requeue `pending` |
| Worker crash giữa publish & mark sent | Row `processing` — cần ops reset hoặc timeout job (tương lai) |
| WS disconnect | Client resync join rooms on `open` |

**Lưu ý:** Row `processing` kẹt nếu worker die sau lock. Ops: `UPDATE EventOutbox SET status='pending' WHERE status='processing' AND updatedAt < now()-5min`.

## Monitoring

- `GET /api/realtime/stats` — connections, events/sec, latency (super admin)
- `GET /api/realtime/outbox/stats` — pending/sent/failed counts

Logs: `[outbox]`, `[outbox-dispatch]`, `[outbox-worker]`, `[realtime-bus]`.

## Redis Streams (nâng cao)

Pub/Sub hiện tại đủ cho fan-out WS. Nâng cấp Streams khi cần:

- Consumer groups per region
- Replay / audit trail
- Backpressure

Outbox pattern giữ nguyên — chỉ thay `dispatchOutboxRow` publish target.

## Best practices

1. **Luôn** ghi outbox trong cùng transaction với business write.
2. **Không** publish Redis trực tiếp từ HTTP handler cho booking (dùng outbox).
3. `state_changed` vẫn direct publish cho full-state sync (debounced PUT).
4. Scale: `--scale backend=3` + 1+ `event-dispatcher` + Redis AOF.
5. Sticky session **không** bắt buộc — room join qua WS message.

## Deploy production (migrate trước worker)

Xem `docs/DEPLOY-REALTIME.md` — thứ tự start, entrypoint scripts, rollback migrate.
