# Victory — Thiết bị & Kế toán (TT133)

## Cấu trúc thư mục

```
.
├── package.json       # Script gọi frontend / backend (không gài dependencies FE)
├── README.md
├── .gitignore
├── .dockerignore
├── frontend/          # React + Vite (SPA)
│   ├── app/           # Shell, store, routes, layout
│   ├── modules/       # Theo nghiệp vụ: accounting, invoice, warehouse, …
│   ├── shared/        # Types, utils, components dùng chung trong FE
│   ├── services/      # (vd. Gemini) — import từ @shared
│   ├── App.tsx
│   ├── index.tsx
│   ├── vite.config.ts
│   └── package.json
├── backend/           # API Node (Express, Prisma, …)
├── storage/           # Dữ liệu cục bộ (vd. backup map vào Docker)
├── assets/            # Ảnh / tài nguyên tĩnh (design)
├── audits/            # Screenshot audit UI, báo cáo (không phải code UI)
├── generated/         # File sinh tự động, zip archive
├── infra/docker/      # Dockerfile, docker-compose, nginx cho FE container
├── scripts/           # Script tiện ích
└── docs/              # Tài liệu kiến trúc (xem docs/ROOT-LAYOUT.md)
```

**Thư mục `e:\Victory` (cha):** chỉ nên chứa repo (và `.cursor`). Ảnh/zip rải rác đã gom vào `audits/` và `generated/` trong repo.

**Lưu ý:** `shared` hiện nằm trong `frontend/shared` để **không đổi import** và giữ nguyên mọi công thức (GTGT, báo cáo, …). Có thể tách `shared/` ra ngang hàng `frontend/` ở bước sau bằng alias TypeScript/Vite (`@shared/*`).

## Chạy nhanh

Từ thư mục gốc này:

```bash
npm run dev          # Vite — thường http://localhost:3000
npm run backend:dev  # API — cấu hình trong backend/
```

Hoặc vào `frontend/` rồi `npm run dev` như trước.

### Docker (tùy chọn)

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

## Dữ liệu

- **Sổ kế toán / hóa đơn (backend):** PostgreSQL qua API khi đã đăng nhập (Docker: service `postgres`). File SQLite `dev.db` trên `Hotel data/` dùng làm nguồn migrate một lần.
- **Tờ khai 01/GTGT (nháp, baseline):** khi chạy backend và đăng nhập, đồng bộ vào PostgreSQL (`Gtgt01Data`); không có backend thì vẫn dùng `localStorage`. Cấu hình ổ E: và backup: `docs/TAX-FILING-STORAGE.md`.
- **Electron + file `.db` trên máy:** `docs/ELECTRON-SQLITE-FLOW.md`.

### Migrate SQLite → PostgreSQL

Nguồn: `E:/Dự án SME Hotel/Hotel data/dev.db` (mount Docker → `/data/dev.db`).

**Cảnh báo:** script **TRUNCATE** toàn bộ bảng PostgreSQL trước khi import. AppState JSON được copy byte-for-byte (công thức / logic nghiệp vụ không bị reshape).

```powershell
Set-Location "E:\Dự án SME Hotel\Hotel UIUX"
docker compose -f infra/docker/docker-compose.yml run --rm `
  -e SQLITE_PATH=/data/dev.db `
  -e NODE_OPTIONS=--max-old-space-size=1024 `
  --entrypoint node backend scripts/migrateSqliteToPostgres.mjs
```

Kiểm tra số lượng bản ghi:

```powershell
docker compose -f infra/docker/docker-compose.yml run --rm --entrypoint node backend scripts/verifyPostgresCounts.mjs
```

Smoke test API (health, AppState, login + endpoint có auth — tạm đặt mật khẩu test rồi khôi phục hash gốc):

```powershell
docker compose -f infra/docker/docker-compose.yml exec backend node scripts/smokeTestApi.mjs
```

Chi tiết Docker / volume: `infra/docker/README.md`.
