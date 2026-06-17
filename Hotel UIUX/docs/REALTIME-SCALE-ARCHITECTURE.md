# Kiến trúc Realtime Scale — SME Hotel (3000–5000 users)

## Tổng quan

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │     │  Frontend   │     │  Mobile     │
│  (WS+JWT)   │     │  (WS+JWT)   │     │  (driver)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │ nginx (sticky optional)
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ backend #1   │   │ backend #2   │   │ backend #N   │
│ ws + RoomMgr │   │ ws + RoomMgr │   │ ws + RoomMgr │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           ▼
              ┌────────────────────────┐
              │ Redis (Pub/Sub + cache) │
              │ • sme-hotel:bus:*       │
              │ • presence / orders     │
              └────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ PostgreSQL + Prisma     │
              └────────────────────────┘
```

**Không dùng:** Socket.IO, pm2 cluster.  
**Dùng:** native `ws`, Redis event bus, Docker horizontal scale.

---

## 1. Room granularity

| Room | Key | Ai join mặc định | Khi dùng |
|------|-----|------------------|----------|
| Company | `company:{companyId}` | Mọi user đã login | AppState, RBAC, báo cáo chung |
| User | `user:{userId}` | Auto on connect | Notification cá nhân |
| Driver | `driver:{driverId}` | Driver app | Vị trí, assign |
| Order | `order:{orderId}` | Client `join` | Booking/PMS chi tiết |
| Zone | `zone:{zoneId}` | Client `join` | Khu vực GPS / tầng khách sạn |
| Session | `session:{qrId}` | QR login | Đã có sẵn |

**Quy tắc routing (không broadcast cả company khi không cần):**

| Event | Target rooms |
|-------|----------------|
| `state_changed` | `company:{id}` |
| `notification_created` | `user:{id}` + `company:{id}` |
| `order_created` | `order:{id}`, `zone:{id}?`, `driver:{id}?`, `company:{id}` |
| `order_updated` | `order:{id}`, `company:{id}` |
| `order_assigned` | `order:{id}`, `driver:{id}`, `zone:{id}?` |
| `driver_location_updated` | `driver:{id}`, `zone:{id}?`, `company:{id}` |

Code: `backend/src/realtime/publish.ts`, `roomManager.ts`.

### Client join (WebSocket)

Sau khi connect, gửi:

```json
{ "type": "join", "rooms": ["order:booking-42", "zone:floor-2"] }
```

Server trả:

```json
{ "type": "joined", "rooms": ["order:booking-42"], "all": ["user:...", "company:...", "order:booking-42"] }
```

---

## 2. Redis event bus

Mỗi loại event một channel:

- `sme-hotel:bus:state_changed`
- `sme-hotel:bus:order_created`
- `sme-hotel:bus:order_updated`
- `sme-hotel:bus:order_assigned`
- `sme-hotel:bus:driver_location_updated`
- `sme-hotel:bus:notification_created`

Envelope:

```json
{
  "id": "uuid",
  "type": "order_updated",
  "at": 1710000000000,
  "originInstanceId": "instance-uuid",
  "targetRooms": ["order:abc", "company:default-company"],
  "companyId": "default-company",
  "payload": { "orderId": "abc", "status": "confirmed" }
}
```

Mọi instance subscribe tất cả channels → `RoomManager.emitToRooms()` chỉ gửi client đã join room.

Code: `backend/src/realtime/redisEventBus.ts`, `realtimeHub.ts`.

---

## 3. Multi-instance Docker

```yaml
# infra/docker/docker-compose.yml — ví dụ scale
services:
  backend:
  deploy:
    replicas: 3   # hoặc: docker compose up --scale backend=3
```

**Yêu cầu:**

- Redis luôn chạy (event bus + presence cache)
- Nginx proxy `/ws/*` với `proxy_read_timeout 130s`
- Sticky session **không bắt buộc** (state qua Redis, không in-memory session WS)

```powershell
docker compose -f infra/docker/docker-compose.yml up -d --scale backend=3
```

---

## 4. Cache strategy (Redis)

| Key | Mục đích | TTL |
|-----|----------|-----|
| `rt:online:users` | SET online users | heartbeat refresh |
| `rt:online:drivers` | SET online drivers | heartbeat |
| `rt:orders:active:{companyId}` | HASH active orders | 1h |
| `rt:presence:user:{id}` | session hint | 120s |

Code: `backend/src/realtime/presenceCache.ts`.

---

## 5. Rate limiting

- 120 messages / phút / WebSocket connection
- Trả `{ "type": "error", "error": "rate_limited" }`

Code: `backend/src/realtime/rateLimiter.ts`, `wsGateway.ts`.

---

## 6. Authentication

- JWT qua `Authorization: Bearer` hoặc `?token=` trên `/ws/state`
- Role: `user` | `driver` | `admin` | `super_admin`
- `super_admin` nhận mọi room event (ops)
- Join `order`/`zone`/`driver` chỉ khi cùng company (policy trong `roomManager.ts`)

---

## 7. Monitoring

`GET /api/realtime/stats` (super_admin):

- connections, rooms, messages published/received
- heap MB, cpu usage, instance id

---

## 8. Fault tolerance

| Thành phần | Cơ chế |
|------------|--------|
| Redis publish | Retry 3 lần, backoff |
| Redis subscriber | `resubscribe` on reconnect |
| WebSocket client | Reconnect 2s (frontend `store.ts`) |
| Instance crash | Client reconnect → instance khác; events qua Redis |

---

## 9. Best practices → 5000 users

1. **Ưu tiên room nhỏ** — order/driver/zone trước company broadcast.
2. **State_changed** chỉ khi thay AppState; notification/e-invoice dùng event riêng.
3. **Scale backend** 3–5 replicas @ ~500–1000 WS mỗi instance (tùy RAM).
4. **Redis** dedicated, `maxmemory-policy allkeys-lru` cho cache keys.
5. **PostgreSQL** — không poll liên tục; WS + debounced `GET /api/state`.
6. **nginx** `worker_connections 4096`, monitor `activeConnections`.
7. **Hotel PMS** — map `bookingId` → `order:{bookingId}` khi join room chi tiết.

---

## File map

| File | Vai trò |
|------|---------|
| `realtime/rooms.ts` | Room key helpers |
| `realtime/roomManager.ts` | Join/leave, targeted emit |
| `realtime/redisEventBus.ts` | Pub/Sub multi-channel |
| `realtime/realtimeHub.ts` | Bridge bus ↔ rooms |
| `realtime/publish.ts` | `publishOrderCreated`, … |
| `realtime/wsGateway.ts` | WS auth, join, rate limit |
| `realtime/routes.ts` | Stats + event API stubs |
| `stateSync.ts` | Legacy API (`notifyStateChanged`) |
