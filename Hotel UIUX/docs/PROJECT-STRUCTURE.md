# Bản đồ mã nguồn & công thức quan trọng

## Đã sắp xếp (an toàn, không đổi logic)

- **Frontend** gom vào `frontend/`: toàn bộ `app/`, `modules/`, `shared/`, entry Vite.
- **Backend** giữ nguyên `backend/` (anh em thư mục với `frontend/`).
- **Relative import** giữ nguyên (ví dụ `modules/invoice/...` → `shared/types`: vẫn `../../../shared/...`).

## Công thức / luồng nghiệp vụ (file gốc)

| Khu vực | File chính |
|--------|------------|
| Tờ khai 01/GTGT | `frontend/modules/invoice/components/VatGtgt01Declaration.tsx` |
| Tổng hợp HĐ → chỉ tiêu GTGT | `frontend/modules/invoice/utils/gtgt01Aggregation.ts` |
| Baseline / [43] kỳ trước | `frontend/modules/invoice/utils/gtgt01Baseline.ts` |
| Bản nháp theo kỳ | `frontend/modules/invoice/utils/gtgt01WorkingDrafts.ts` |
| PL 204 | `frontend/modules/invoice/utils/vatPl204AnnexState.ts`, `vatPl204Aggregation.ts` |
| Validation 01/GTGT | `frontend/modules/invoice/utils/vatGtgt01Validations.ts` |
| Store toàn app | `frontend/app/store.ts` |
| Báo cáo B01/B09 | `frontend/shared/utils/accounting.ts`, `b09FinancialMetrics.ts` |

**Công thức không bị mất:** chỉ thay đổi **đường dẫn thư mục** trên đĩa; nội dung file `.ts`/`.tsx` được di chuyển nguyên khối vào `frontend/`.

## localStorage (trình duyệt) — khóa cố định

Không phụ thuộc tên thư mục dự án:

- `victory_gtgt01_snapshots_v1`
- `victory_gtgt01_first_filing_baseline_v1`
- `victory_gtgt01_working_drafts_by_period_v1`
- `victory_gtgt01_pl204_by_period_v1`

## Gốc repo (sau dọn)

Chỉ còn config (`package.json`, `.gitignore`, `.dockerignore`), `README`, `docs/`, `frontend/`, `backend/`, `storage/`, `assets/`, `audits/`, `generated/`, `infra/`, `scripts/`. Chi tiết: `docs/ROOT-LAYOUT.md`.

## Đã làm (import ổn định)

- Alias **`@shared/*`** trong `frontend/vite.config.ts` và `frontend/tsconfig.json`.
- Toàn bộ import từ `shared/` dùng `@shared/...` (xem `docs/REFACTOR-SAFE-STEPS.md`).

## Giai đoạn tiếp (tùy chọn)

1. Thêm `frontend/src/` và gom `app` + `modules` vào `src/` — cần cập nhật `vite.config` + import.
2. Tách `frontend/shared` → `shared/` ở gốc repo — chỉnh alias `@shared` trỏ tới `../shared`.
3. `infra/docker-compose.yml` trỏ `frontend` build + `backend` API.
