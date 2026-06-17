# Docker — frontend (nginx) + backend + postgres + redis

- `Dockerfile.frontend` — build Vite từ `frontend/`, phục vụ tĩnh bằng nginx.
- `docker-compose.yml` — build context tính từ **thư mục gốc dự án** (cha của `frontend/`).
- `nginx.conf` — SPA + proxy `/api/` → service `backend`.

Chạy từ thư mục `Hotel UIUX`:

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

Ứng dụng: http://localhost:3180 — API qua nginx: http://localhost:3180/api/

## Volume dữ liệu

Bind `E:/Dự án SME Hotel/Hotel data` → `/data` trong container `backend`:

| Host | Container | Mục đích |
|------|-----------|----------|
| `Hotel data/dev.db` | `/data/dev.db` | Nguồn SQLite (migrate một lần) |
| `Hotel data/Backup` | `/data/Backup` | Backup zip |
| `Hotel data/invoice-incoming` | `/data/invoice-incoming` | XML hóa đơn điện tử |

PostgreSQL dùng volume Docker `postgres_data` (không nằm trong bind mount trên).

## Migrate SQLite → PostgreSQL

**Cảnh báo:** TRUNCATE toàn bộ bảng PG trước khi copy. Chỉ chạy khi cần restore từ `dev.db`.

```powershell
Set-Location "E:\Dự án SME Hotel\Hotel UIUX"
docker compose -f infra/docker/docker-compose.yml run --rm `
  -e SQLITE_PATH=/data/dev.db `
  -e NODE_OPTIONS=--max-old-space-size=1024 `
  --entrypoint node backend scripts/migrateSqliteToPostgres.mjs
```

Verify counts:

```powershell
docker compose -f infra/docker/docker-compose.yml run --rm --entrypoint node backend scripts/verifyPostgresCounts.mjs
```

Smoke test (backend phải đang chạy):

```powershell
docker compose -f infra/docker/docker-compose.yml exec backend node scripts/smokeTestApi.mjs
```

Script smoke test: health → `/api/state` → login mật khẩu tạm → `/api/backup/info` → khôi phục hash mật khẩu gốc.

## Khôi phục mật khẩu super admin

Trong `docker-compose.yml`, đặt `SUPER_ADMIN_RESET="1"` và `SUPER_ADMIN_PASSWORD` (mật khẩu mới), restart `backend`, sau đó đặt lại `SUPER_ADMIN_RESET="0"`.
