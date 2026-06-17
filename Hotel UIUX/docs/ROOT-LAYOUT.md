# Quy ước gốc dự án (sau dọn)

## Chỉ nên có ở root

| Mục | Ghi chú |
|-----|---------|
| `package.json` | Script gọi `frontend/` và `backend/` |
| `README.md` | Hướng dẫn |
| `.gitignore` | |
| `.dockerignore` | Ngữ cảnh build image frontend (context = root) |
| `frontend/` | Mã React + Vite |
| `backend/` | API Node |
| `docs/` | Tài liệu |
| `assets/` | Ảnh tĩnh / design (placeholder) |
| `audits/` | Ảnh báo cáo audit, screenshot (không phải code UI) |
| `infra/` | Docker, nginx, … |
| `scripts/` | Script tiện ích |
| `generated/` | File tự sinh, zip lưu |
| `storage/` | Dữ liệu runtime (vd. backup map vào Docker) |

## Đã xử lý

- **Ảnh / audit** rải ở `e:\Victory\` → `audits/screenshots-e-victory-root/`, `audits/ui-font-audit-legacy/`.
- **`Backups/`** → `storage/backups/` (volume Docker `./storage/backups` → `/data/Backup`).
- **`services/`** → `frontend/services/` (Gemini helper; import `@shared/types`).
- **`types.ts`** (stub) ở root → **đã xóa** (đã deprecated; dùng `frontend/shared/types`).
- **Docker**: `Dockerfile`, `docker-compose.yml`, `nginx.conf` → `infra/docker/`.

## Docker

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

## Checklist

- [ ] `npm run build` xanh sau thay đổi
- [ ] `docker compose` chạy thử nếu chỉnh volume / Dockerfile
