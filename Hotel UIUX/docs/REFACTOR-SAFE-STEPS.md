# Refactor an toàn — nhật ký đã làm

## Bước 1 — Chỉ thêm alias (không đổi import)

- `frontend/vite.config.ts`: `resolve.alias['@shared']` → `shared/`
- `frontend/tsconfig.json`: `paths['@shared/*']` → `./shared/*`
- **Kiểm tra:** `npm run build` trong `frontend/` — **OK**

## Bước 2 — Đổi import sang `@shared/...`

- Thay mọi `from '.../shared/` (relative 1–3 cấp `../`) bằng `from '@shared/`
- **41 file** `.ts` / `.tsx` (không gồm `node_modules`)
- Logic / công thức trong file **không đổi**, chỉ đường import.

## Bước 3 — Build lại

- `npm run build` — **OK**

## Bước tiếp theo (chưa làm — khi cần)

1. Thêm `@modules` alias tương tự (nếu muốn).
2. Tách `frontend/src/` — từng thư mục, mỗi lần một phần + build.
3. Nâng `shared/` lên ngang `frontend/` — cần sửa alias trỏ ra thư mục cha.

## Gợi ý commit Git (nếu dùng)

1. `chore(frontend): add @shared path alias in vite and tsconfig`
2. `refactor(frontend): use @shared imports instead of relative paths to shared/`
