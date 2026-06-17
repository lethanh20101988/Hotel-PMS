# Realtime & scale checklist (SME Hotel)

Checklist kiến trúc realtime — áp dụng cho **Hotel UIUX** (Docker backend + frontend).

| Tiêu chí | Trạng thái | Cách triển khai |
|----------|------------|-----------------|
| **socket.io-redis adapter** | Không dùng Socket.IO | Native `ws` + Redis Pub/Sub (`sme-hotel:state-sync`) — tương đương multi-instance, ít overhead hơn adapter Socket.IO |
| **pm2 `-i max`** | Không dùng | Docker: một process `node dist/index.js`; scale bằng `docker compose up --scale backend=N` + Redis |
| **Room (`company_x`, `session_x`)** | Có | Room `company:{companyId}` cho state/notification/e-invoice; QR login: `session:{qrId}` (`qrSockets` map) |
| **Tránh global emit** | Có | `broadcastStateEvent` chỉ gửi client cùng `companyId`; `super_admin` nhận tất cả room |
| **Tránh query DB liên tục** | Có (event-driven) | State: WS → debounce → `GET /api/state`; notification/e-invoice: WS push + poll fallback 60–90s |

## Room keys

- `company:default-company` — AppState, RBAC, GTGT01, lifecycle, thông báo, e-invoice batch
- `session:{qrSessionId}` — QR đăng nhập (desktop poll HTTP backoff 1s→5s làm dự phòng)

## File chính

- `backend/src/stateSync.ts` — WS registry, room filter, Redis publish
- `backend/src/index.ts` — `/ws/state`, `/ws/qr`, `notifyScopeChanged()`
- `frontend/app/store.ts` — WS client, debounced reload

## Ghi chú

- AppState hiện single-row (`id = 1`); room `company:*` sẵn sàng khi tách multi-tenant.
- Không thêm Socket.IO chỉ để có adapter — stack hiện tại đã đạt mục tiêu checklist.
