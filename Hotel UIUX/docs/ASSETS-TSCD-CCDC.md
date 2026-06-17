# TSCĐ & CCDC — mô hình logic và triển khai trong Victory

Ứng dụng lưu **hồ sơ tài sản** trong mảng `assets` (JSON / AppState) và **bút toán** trong `journalEntries`. Các bảng chuẩn kế toán dưới đây là **mô hình tương đương** (logical model); không bắt buộc bảng Prisma riêng cho từng dòng phân bổ.

## Công cụ dụng cụ (CCDC)

| Bước | Nghiệp vụ | Bút toán (TT133) |
|------|-----------|------------------|
| 1 | Mua CCDC (giá chưa thuế + VAT) | Nợ **153**, Nợ **1331** / Có **111/112/331** |
| 2 | Đưa vào sử dụng | Nợ **242** / Có **153** (`handlePutCcdcIntoUse`) |
| 3 | Phân bổ tháng | Nợ **642/641/627** / Có **242** |

- Trường `ccdcLifecycle`: `STOCK_153` (chờ bước 2) hoặc `IN_USE` (đã có trên 242, phân bổ theo `useDate`).
- Ghi sổ trễ: tab **Tính Khấu hao / Phân bổ** lấy chênh lệch `targetAccumulated − đã lũy kế` cho mọi tháng ≤ tháng chọn (catch-up).

## Tài sản cố định (TSCĐ)

| Bước | Nghiệp vụ | Bút toán |
|------|-----------|----------|
| 1 | Mua TSCĐ | Nợ **211**, Nợ **1331** / Có **111/112/331** |
| 2 | Khấu hao tháng | Nợ **642/641/627** / Có **214** (không qua 242) |

- `salvageValue`: giá trị thu hồi cuối kỳ — cơ sở khấu hao = `cost − salvageValue` (`DepreciationEngine.getDepreciableBase`).
- `expenseAccount`: 6421 / 6422 / 641 / 627 (`resolveAssetExpenseAccount`).

## Engine tính toán

- **DepreciationEngine** (`frontend/shared/engines/depreciationEngine.ts`): TSCĐ — `getDepreciableBase`, `computeTargetAccumulated`; lũy kế lưu ở `accumulatedDepreciation`.
- **AllocationEngine** (`frontend/shared/engines/allocationEngine.ts`): CCDC — `getAllocatableBase`, `computeTargetAllocated`; lũy kế lưu ở `accumulatedAllocation` (không dùng `accumulatedDepreciation` cho CCDC).

Barrel: `frontend/shared/assetScheduleEngine.ts` re-export hai engine + `resolveAssetExpenseAccount`, `getAccumulatedLedgerAmount`.

- Đường thẳng: `monthlyFloat = depreciableBase / usefulLife`, lũy kế mục tiêu `min(depreciableBase, round(monthlyFloat × số tháng đủ điều kiện))`.
- Tháng kết chuyển (hồi ký): tháng cuối cùng của vòng lặp điều chỉnh để khớp `targetAccumulated` (xem `handleAddAsset`).

## Hạn chế / mở rộng

- **Partial month (IFRS)**: chưa nhân `days_used / days_in_month`; có thể bổ sung hệ số theo kỳ.
- **Thanh lý TSCĐ/CCDC**: nghiệp vụ phức tạp (811, 711, …) — chưa có wizard riêng; có thể ghi tay qua chứng từ tổng hợp.
- **Cân đối 211/214/242**: lấy từ sổ cái / `journalEntries` sau khi ghi.
