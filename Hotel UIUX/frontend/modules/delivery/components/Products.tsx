
import React, { useMemo, useState } from 'react';
import { Product } from '../types';
import { useApp } from '../../../app/store';
import {
  applyCatalogItemToProduct,
  findLinkedCatalogItem,
  mergeProductWithCatalog,
} from '../deliveryCatalogLink';
import { Search, Plus, Package, Edit2, Trash2, Tag, Scale, DollarSign, Archive, Link2 } from 'lucide-react';

interface Props {
  products: Product[];
  onAdd: (product: Product) => void;
  onUpdate: (product: Product) => void;
  onDelete: (id: string) => void;
}

const Products: React.FC<Props> = ({ products, onAdd, onUpdate, onDelete }) => {
  const { inventoryCatalog } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const initialFormState: Partial<Product> = {
    name: '',
    category: 'Khác',
    unit: 'Gói',
    price: 0,
    weightKg: 0,
    catalogItemId: '',
    sku: '',
  };
  const [formData, setFormData] = useState<Partial<Product>>(initialFormState);

  const catalogOptions = useMemo(
    () =>
      (inventoryCatalog || [])
        .filter((item) => String(item.name || item.sku || '').trim())
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi')),
    [inventoryCatalog],
  );

  const displayProducts = useMemo(
    () => products.map((p) => mergeProductWithCatalog(p, catalogOptions)),
    [products, catalogOptions],
  );

  const filteredProducts = displayProducts.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(p.sku || '').toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleOpenModal = (product?: Product) => {
    if (product) {
      const merged = mergeProductWithCatalog(product, catalogOptions);
      setEditingId(merged.id);
      setFormData({ ...merged });
    } else {
      setEditingId(null);
      setFormData(initialFormState);
    }
    setIsModalOpen(true);
  };

  const handleCatalogLinkChange = (catalogId: string) => {
    if (!catalogId) {
      setFormData((prev) => ({
        ...prev,
        catalogItemId: undefined,
        sku: undefined,
      }));
      return;
    }
    const catalog = catalogOptions.find((c) => String(c.id) === catalogId);
    if (!catalog) return;
    setFormData((prev) => ({
      ...prev,
      ...applyCatalogItemToProduct(catalog, prev),
    }));
  };

  const isCatalogLinked = Boolean(
    formData.catalogItemId &&
      catalogOptions.some((c) => String(c.id) === String(formData.catalogItemId)),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    const linkedCatalog = findLinkedCatalogItem(formData, catalogOptions);
    const mergedFields = linkedCatalog
      ? applyCatalogItemToProduct(linkedCatalog, formData)
      : formData;

    const productData = {
      ...mergedFields,
      id: editingId || `SP-${Date.now()}`,
      price: Number(mergedFields.price) || 0,
      weightKg: Number(mergedFields.weightKg) || 0,
    } as Product;

    if (editingId) {
      onUpdate(productData);
    } else {
      onAdd(productData);
    }
    setIsModalOpen(false);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa sản phẩm này?')) {
      onDelete(id);
    }
  };

  const inputClass =
    'w-full border border-slate-300 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all shadow-sm h-11 text-sm bg-white';
  const labelClass = 'block text-sm font-semibold text-slate-700 mb-1.5';
  const readOnlyClass =
    'w-full border border-slate-200 rounded-lg px-3 py-2.5 h-11 text-sm bg-slate-50 text-slate-700';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Danh mục sản phẩm</h2>
          <p className="text-slate-500 text-sm">
            Liên kết với Danh mục → Hàng hóa - Vật tư; khi sửa tự đồng bộ tên, ĐVT, danh mục và giá bán.
          </p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Tìm tên, SKU..."
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="bg-brand-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-brand-700 transition shadow-sm"
          >
            <Plus className="w-4 h-4" /> Thêm sản phẩm
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredProducts.map((p) => (
          <div
            key={p.id}
            className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition group overflow-hidden"
          >
            <div className="p-5">
              <div className="flex justify-between items-start mb-3">
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 border border-brand-100">
                  <Package className="w-5 h-5" />
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleOpenModal(p)}
                    className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <h3 className="font-bold text-slate-800 mb-1 line-clamp-2 min-h-[3rem]">{p.name}</h3>
              {p.catalogItemId && (
                <p className="text-[11px] text-emerald-700 flex items-center gap-1 mb-2">
                  <Link2 className="w-3 h-3" />
                  Danh mục: {p.sku || p.catalogItemId}
                </p>
              )}

              <div className="space-y-2 mt-4">
                <div className="flex justify-between items-center text-sm border-b border-slate-50 pb-2">
                  <span className="text-slate-500 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5" /> Danh mục
                  </span>
                  <span className="font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-xs">
                    {p.category}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm border-b border-slate-50 pb-2">
                  <span className="text-slate-500 flex items-center gap-1">
                    <Scale className="w-3.5 h-3.5" /> Trọng lượng
                  </span>
                  <span className="font-medium text-slate-700">{p.weightKg} kg</span>
                </div>
                <div className="flex justify-between items-center text-sm pt-1">
                  <span className="text-slate-500 flex items-center gap-1">
                    <Archive className="w-3.5 h-3.5" /> Đơn vị tính
                  </span>
                  <span className="font-medium text-slate-700">{p.unit}</span>
                </div>
              </div>
            </div>
            <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex justify-between items-center">
              <span className="text-xs text-slate-500">{p.sku || p.id}</span>
              <div className="font-bold text-brand-600 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5" /> {p.price.toLocaleString()}đ
              </div>
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Package className="w-5 h-5 text-brand-600" />
                {editingId ? 'Cập nhật sản phẩm' : 'Thêm sản phẩm mới'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-3xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className={labelClass}>
                    <span className="flex items-center gap-1.5">
                      <Link2 className="w-4 h-4 text-brand-600" />
                      Hàng hóa - Vật tư
                    </span>
                  </label>
                  <select
                    className={inputClass}
                    value={formData.catalogItemId || ''}
                    onChange={(e) => handleCatalogLinkChange(e.target.value)}
                  >
                    <option value="">— Không liên kết (nhập tay) —</option>
                    {catalogOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.sku ? `${item.sku} — ` : ''}{item.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Tên sản phẩm <span className="text-red-500">*</span></label>
                  {isCatalogLinked ? (
                    <div className={readOnlyClass}>{formData.name}</div>
                  ) : (
                    <input
                      required
                      placeholder="Nhập tên sản phẩm..."
                      className={inputClass}
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Danh mục</label>
                    {isCatalogLinked ? (
                      <div className={readOnlyClass}>{formData.category}</div>
                    ) : (
                      <input
                        className={inputClass}
                        value={formData.category || ''}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      />
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Đơn vị tính</label>
                    {isCatalogLinked ? (
                      <div className={readOnlyClass}>{formData.unit}</div>
                    ) : (
                      <input
                        required
                        placeholder="VD: Gói, Thùng..."
                        className={inputClass}
                        value={formData.unit || ''}
                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Đơn giá (VNĐ)</label>
                    {isCatalogLinked ? (
                      <div className={readOnlyClass}>{Number(formData.price || 0).toLocaleString()}</div>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        required
                        className={inputClass}
                        value={formData.price ?? 0}
                        onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                      />
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Trọng lượng (Kg)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      required
                      className={inputClass}
                      value={formData.weightKg ?? 0}
                      onChange={(e) => setFormData({ ...formData, weightKg: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 mt-6">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium"
                  >
                    Lưu sản phẩm
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Products;
