import type { InventoryItem } from '@shared/types';
import type { Product } from './types';

/** Áp dụng field từ Danh mục Hàng hóa - Vật tư lên sản phẩm Giao hàng. */
export function applyCatalogItemToProduct(
  catalog: InventoryItem,
  base?: Partial<Product>,
): Partial<Product> {
  return {
    ...base,
    catalogItemId: catalog.id,
    sku: catalog.sku,
    name: catalog.name,
    category: String(catalog.category || '').trim() || base?.category || 'Khác',
    unit: String(catalog.unit || '').trim() || base?.unit || 'Gói',
    price: Number(catalog.sellingPrice) || Number(base?.price) || 0,
  };
}

/** Tìm mục danh mục tương ứng (theo catalogItemId, id hoặc SKU). */
export function findLinkedCatalogItem(
  product: Partial<Product>,
  catalogItems: InventoryItem[],
): InventoryItem | undefined {
  const catalogId = String(product.catalogItemId || '').trim();
  if (catalogId) {
    const byId = catalogItems.find((c) => String(c.id) === catalogId);
    if (byId) return byId;
  }
  const productId = String(product.id || '').trim();
  if (productId) {
    const byProductId = catalogItems.find((c) => String(c.id) === productId);
    if (byProductId) return byProductId;
  }
  const sku = String(product.sku || '').trim();
  if (sku) {
    return catalogItems.find((c) => String(c.sku || '').trim() === sku);
  }
  return undefined;
}

/** Gộp sản phẩm Giao hàng với dữ liệu Danh mục (đọc mới nhất khi sửa / hiển thị). */
export function mergeProductWithCatalog(product: Product, catalogItems: InventoryItem[]): Product {
  const catalog = findLinkedCatalogItem(product, catalogItems);
  if (!catalog) return product;
  return {
    ...product,
    ...applyCatalogItemToProduct(catalog, product),
    id: product.id,
    weightKg: Number(product.weightKg) || 0,
  } as Product;
}
