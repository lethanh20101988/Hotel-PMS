# Tờ khai GTGT — lưu ổ đĩa (SQLite) & cấu hình ổ E:

## Thiết kế cơ sở dữ liệu (SQLite / Prisma)

| Bảng | Mô tả |
|------|--------|
| **Gtgt01Data** (`id = 1`) | Một dòng duy nhất. Cột `payload` (JSON) chứa toàn bộ: `snapshots[]`, `baselines`, `pl204ByPeriod`, `workingDrafts`, `version`. Thay thế lưu rải rác trong `localStorage` khi dùng API. |
| **AppState** (`id = 1`) | Dữ liệu kế toán tổng (niên độ, sổ, HĐ, …) — đã có từ trước. |

**Liên kết KHBS / bản bổ sung:** Trong `snapshots[]`, mỗi phần tử có thể có `parentSnapshotId` trỏ tới bản “Lần đầu” cùng kỳ (điền khi lưu ở chế độ bổ sung).

File vật lý SQLite do biến môi trường `DATABASE_URL` quyết định (ví dụ ổ E:).

## Biến môi trường (ví dụ máy Windows)

Tạo file `backend/.env` (không commit) hoặc đặt biến hệ thống:

```env
# File CSDL trên ổ E: (tự tạo thư mục nếu chưa có)
DATABASE_URL="file:E:/VictoryData/victory.db"

# Backup zip + bản sao SQLite định kỳ
BACKUP_DIR=E:/VictoryData/Backup
BACKUP_HOST_PATH=E:/VictoryData/Backup

# Mỗi 24 giờ copy file .db vào BACKUP_DIR/SqliteAuto/ (0 = tắt)
AUTO_DB_BACKUP_HOURS=24
```

API:

- `GET /api/tax/gtgt01/data` — đọc payload tờ khai (không cần JWT, giống `GET /api/state`).
- `PUT /api/tax/gtgt01/data` — ghi payload (cần đăng nhập, Bearer token).

## Đóng gói `.exe` (hướng dẫn ngắn)

1. **Electron / Tauri:** đóng gói `frontend/dist` + chạy `backend` như tiến trình con, trỏ `DATABASE_URL` tới thư mục dữ liệu người dùng (ví dụ `%USERPROFILE%\\VictoryData` hoặc `E:\\VictoryData`).
2. Công cụ phổ biến: `electron-builder` (Windows: target `nsis` hoặc `portable`).
3. Backup định kỳ: dùng `AUTO_DB_BACKUP_HOURS` + màn **Sao lưu** trong ứng dụng (zip đã gồm `state.json` và bản sao SQLite trong file zip).

**Luồng Electron → SQLite → file `.db` cục bộ:** xem [ELECTRON-SQLITE-FLOW.md](./ELECTRON-SQLITE-FLOW.md).
