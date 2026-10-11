import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { RefreshCw, Plus, Settings, MoreVertical, Search, X, CheckCircle2, Upload, Trash2, Download } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PlatformBadge } from '../components/ui/PlatformBadge';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import { menu as menuApi, platforms as platformsApi, branchesApi, getActiveBranch, type ApiMenuItem, type ApiMenuCategory, type ApiPlatform, type ApiImportItem } from '../lib/api';
import { PLATFORMS } from '../data/platforms';
import type { Page, MenuItem } from '../types';

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop';

interface MenuPageProps {
  setPage: (p: Page) => void;
}

// ─── Shared item form (used by both Add and Edit modals) ──────────────────────

interface ItemFormProps {
  initial?: Partial<MenuItem> & { categoryId?: number };
  apiCategories: ApiMenuCategory[];
  onCategoryCreated: (cat: ApiMenuCategory) => void;
  onClose: () => void;
  onSave: (data: {
    name: string; category: number; platforms: string[];
    platformNames: Record<string, string>;
    platformAliases: Record<string, string[]>;
    platformPosCategories: Record<string, string>;
    foodicsPrice: number | null;
    foodicsProductId: string;
    image: string;
  }) => Promise<void>;
  title: string;
  saveLabel: string;
}

const ItemFormModal = ({ initial, apiCategories, onCategoryCreated, onClose, onSave, title, saveLabel }: ItemFormProps) => {
  const [name, setName]               = useState(initial?.name ?? '');
  const [categoryId, setCategoryId]   = useState<number>(
    initial?.categoryId ?? apiCategories[0]?.id ?? 0
  );
  const [platforms, setPlatforms]       = useState<string[]>(initial?.platforms ?? PLATFORMS.map((p) => p.id));
  const [platformNames, setPlatformNames]   = useState<Record<string, string>>(initial?.platformNames ?? {});
  const [platformAliases, setPlatformAliases] = useState<Record<string, string[]>>(initial?.platformAliases ?? {});
  const [platformPosCategories, setPlatformPosCategories] = useState<Record<string, string>>(initial?.platformPosCategories ?? {});
  const [foodicsPrice, setFoodicsPrice] = useState<string>(initial?.foodicsPrice != null ? String(initial.foodicsPrice) : '');
  const [foodicsProductId, setFoodicsProductId] = useState<string>(initial?.foodicsProductId ?? '');
  const [imagePreview, setImagePreview] = useState<string | null>(initial?.image && initial.image !== PLACEHOLDER_IMAGE ? initial.image : null);
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [saving, setSaving]           = useState(false);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  // New category inline creation
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName]         = useState('');
  const [savingCat, setSavingCat]           = useState(false);
  const newCatRef                           = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingCategory) newCatRef.current?.focus();
  }, [addingCategory]);

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setSavingCat(true);
    try {
      const created = await menuApi.createCategory(newCatName.trim());
      onCategoryCreated(created);
      setCategoryId(created.id);
      setNewCatName('');
      setAddingCategory(false);
    } catch {
      // keep input open so user can retry
    } finally {
      setSavingCat(false);
    }
  };

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const togglePlatform = (id: string) =>
    setPlatforms((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);

  const handleSubmit = async () => {
    if (!name.trim()) { setErrors({ name: 'الاسم مطلوب' }); return; }
    // Accept Arabic-Indic digits and thousands separators ("٦٬٥٠٠" / "6,500").
    const priceText = foodicsPrice.trim()
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[,٬،\s]/g, '');
    if (priceText && !/^\d+$/.test(priceText)) { setErrors({ foodicsPrice: 'أدخل السعر كرقم فقط، مثل 6500' }); return; }
    setErrors({});
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        category: categoryId,
        platforms,
        platformNames,
        platformAliases,
        platformPosCategories,
        foodicsPrice: priceText ? Number(priceText) : null,
        foodicsProductId: foodicsProductId.trim(),
        image: imagePreview || PLACEHOLDER_IMAGE,
      });
      onClose();
    } catch {
      setErrors({ server: 'حدث خطأ أثناء الحفظ، حاول مجدداً' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-mist">
            <div>
              <h2 className="text-xl font-black text-on-surface">{title}</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">أدخل تفاصيل الطبق</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-low transition-colors">
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">

            {/* Image upload */}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            {imagePreview ? (
              <div className="relative h-40 rounded-2xl overflow-hidden group">
                <img src={imagePreview} alt="معاينة" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 bg-white text-on-surface text-xs font-bold px-3 py-2 rounded-xl hover:bg-surface-container-low transition-colors">
                    <Upload size={13} /> تغيير
                  </button>
                  <button type="button" onClick={() => setImagePreview(null)} className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-3 py-2 rounded-xl hover:bg-red-600 transition-colors">
                    <Trash2 size={13} /> حذف
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full h-32 rounded-2xl border-2 border-dashed border-mist bg-surface-container-low hover:bg-surface-container-low hover:border-primary/40 transition-all flex flex-col items-center justify-center gap-2 text-on-surface-variant group">
                <Upload size={18} className="group-hover:text-on-surface transition-colors" />
                <span className="text-sm font-semibold group-hover:text-on-surface transition-colors">اضغط لرفع صورة</span>
              </button>
            )}

            {/* Name */}
            <div>
              <input
                className={cn('w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2 transition-all', errors.name ? 'border-red-300 bg-red-50 focus:ring-red-200' : 'border-mist focus:ring-primary/20 focus:border-primary/40')}
                placeholder="اسم الطبق"
                value={name}
                onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: '' })); }}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>

            {/* Foodics price */}
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">سعر Foodics (د.ع)</label>
              <input
                className={cn('w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2 transition-all', errors.foodicsPrice ? 'border-red-300 bg-red-50 focus:ring-red-200' : 'border-mist focus:ring-primary/20 focus:border-primary/40')}
                placeholder="مثال: 6500"
                inputMode="numeric"
                dir="ltr"
                value={foodicsPrice}
                onChange={(e) => { setFoodicsPrice(e.target.value); setErrors((p) => ({ ...p, foodicsPrice: '' })); }}
              />
              {errors.foodicsPrice
                ? <p className="text-xs text-red-500 mt-1">{errors.foodicsPrice}</p>
                : <p className="text-[11px] text-on-surface-variant mt-1">سعر هذا الصنف على Foodics بالضبط — عند إرسال الطلب يُختار الصنف الذي يحمل هذا السعر. اتركه فارغاً للمطابقة بسعر التطبيق.</p>}
            </div>

            {/* Foodics product id */}
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">معرّف صنف Foodics</label>
              <input
                className="w-full rounded-xl border border-mist px-4 py-2.5 text-xs font-mono outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                placeholder="مثال: 9da6d06e-9cc6-4686-9ce1-44dcb2a4f45b"
                dir="ltr"
                value={foodicsProductId}
                onChange={(e) => setFoodicsProductId(e.target.value)}
              />
              <p className="text-[11px] text-on-surface-variant mt-1">
                عند ضبطه يُرسل الطلب بهذا المعرّف بدل البحث بالاسم والسعر — تغيير اسم الصنف في Foodics لن يؤثر عليه. اتركه فارغاً للمطابقة بالاسم.
              </p>
            </div>

            {/* Category */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded-xl border border-mist px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 bg-white cursor-pointer"
                  value={categoryId}
                  onChange={(e) => setCategoryId(Number(e.target.value))}
                >
                  {apiCategories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setAddingCategory((v) => !v)}
                  className={cn(
                    'px-3 py-2 rounded-xl border text-sm font-bold transition-colors',
                    addingCategory
                      ? 'bg-primary text-on-primary border-primary'
                      : 'border-mist text-on-surface-variant hover:border-primary/40 hover:text-on-surface'
                  )}
                  title="إضافة تصنيف جديد"
                >
                  <Plus size={16} />
                </button>
              </div>
              {addingCategory && (
                <div className="flex gap-2">
                  <input
                    ref={newCatRef}
                    className="flex-1 rounded-xl border border-primary/40 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="اسم التصنيف الجديد..."
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCategory(); if (e.key === 'Escape') setAddingCategory(false); }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateCategory}
                    disabled={savingCat || !newCatName.trim()}
                    className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold hover:bg-primary/90 disabled:opacity-40 transition-colors"
                  >
                    {savingCat ? <RefreshCw size={14} className="animate-spin" /> : 'إضافة'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddingCategory(false); setNewCatName(''); }}
                    className="px-3 py-2 rounded-xl border border-mist text-on-surface-variant hover:bg-surface-container-low transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Platforms */}
            <div className="space-y-2">
              <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">المنصات</p>
              {PLATFORMS.map((platform) => {
                const active = platforms.includes(platform.id);
                return (
                  <div key={platform.id} className={cn('rounded-2xl border transition-all overflow-hidden', active ? 'border-primary/30 bg-primary/[0.03]' : 'border-mist')}>
                    <button type="button" onClick={() => togglePlatform(platform.id)} className="w-full flex items-center justify-between px-4 py-3 text-right">
                      <div className="flex items-center gap-3">
                        <PlatformBadge platformId={platform.id} variant="icon" size="sm" />
                        <span className={cn('text-sm font-semibold', active ? 'text-on-surface' : 'text-on-surface-variant')}>{platform.name}</span>
                      </div>
                      <div className={cn('w-10 h-5 rounded-full relative transition-colors duration-300 shrink-0', active ? 'bg-primary' : 'bg-surface-container-high')}>
                        <div className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-300', active ? 'right-0.5' : 'left-0.5')} />
                      </div>
                    </button>
                    {active && (
                      <div className="px-4 pb-3 space-y-2">
                        <input
                          className="w-full rounded-xl border border-mist bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-slate-300"
                          placeholder={`الاسم الأساسي على ${platform.name}...`}
                          value={platformNames[platform.id] ?? ''}
                          onChange={(e) => setPlatformNames((prev) => ({ ...prev, [platform.id]: e.target.value }))}
                        />
                        <input
                          className="w-full rounded-xl border border-mist bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-slate-300"
                          placeholder={`تصنيف Foodics على ${platform.name} (اختياري)`}
                          dir="rtl"
                          value={platformPosCategories[platform.id] ?? ''}
                          onChange={(e) => setPlatformPosCategories((prev) => ({ ...prev, [platform.id]: e.target.value }))}
                        />
                        {(platformAliases[platform.id] ?? []).map((alias, idx) => (
                          <div key={idx} className="flex gap-2">
                            <input
                              className="flex-1 rounded-xl border border-dashed border-mist bg-surface-container-low px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-slate-300"
                              placeholder="اسم بديل..."
                              value={alias}
                              onChange={(e) => {
                                const updated = [...(platformAliases[platform.id] ?? [])];
                                updated[idx] = e.target.value;
                                setPlatformAliases((prev) => ({ ...prev, [platform.id]: updated }));
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const updated = (platformAliases[platform.id] ?? []).filter((_, i) => i !== idx);
                                setPlatformAliases((prev) => ({ ...prev, [platform.id]: updated }));
                              }}
                              className="p-2 rounded-xl text-on-surface-variant hover:text-red-500 hover:bg-red-50 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setPlatformAliases((prev) => ({
                            ...prev,
                            [platform.id]: [...(prev[platform.id] ?? []), ''],
                          }))}
                          className="text-xs text-on-surface hover:text-on-surface/80 font-semibold flex items-center gap-1 pt-0.5"
                        >
                          <Plus size={12} /> اسم بديل
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {errors.server && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{errors.server}</p>}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-mist flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose} type="button">إلغاء</Button>
            <Button className="flex-1" onClick={handleSubmit} type="button" disabled={saving}>
              {saving ? <RefreshCw size={15} className="animate-spin" /> : <Plus size={16} />}
              {saving ? 'جاري الحفظ...' : saveLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

// ─── Adapter ──────────────────────────────────────────────────────────────────

function toMenuItem(a: ApiMenuItem): MenuItem {
  const platformNames:         Record<string, string>   = {};
  const platformAliases:       Record<string, string[]> = {};
  const platformPosCategories: Record<string, string>   = {};
  for (const m of (a.platformMappings ?? [])) {
    platformNames[m.platformId]         = m.platformName;
    platformAliases[m.platformId]       = m.aliases ?? [];
    platformPosCategories[m.platformId] = m.posCategory ?? '';
  }
  return {
    id:            a.id,
    name:          a.name,
    price:         Number(a.price) > 0 ? (a.priceDisplay || `${Number(a.price).toLocaleString()} د.ع`) : '',
    description:   a.description,
    image:         a.image || PLACEHOLDER_IMAGE,
    tag:           a.tag,
    status:        a.isAvailable ? 'نشط' : 'مخفي',
    category:      a.categoryName || String(a.category),
    categoryId:    a.category,
    platforms:     a.platforms,
    platformNames,
    platformAliases,
    platformPosCategories,
    foodicsPrice:  a.foodicsPrice != null ? Number(a.foodicsPrice) : null,
    foodicsProductId: a.foodicsProductId ?? '',
  };
}

// ─── Import items from another branch ─────────────────────────────────────────

interface ImportModalProps {
  onClose: () => void;
  onImported: (summary: string) => void;
}

const ImportModal = ({ onClose, onImported }: ImportModalProps) => {
  const [branchOptions, setBranchOptions] = useState<{ slug: string; name: string }[]>([]);
  const [branch, setBranch]               = useState('');
  const [rows, setRows]                   = useState<ApiImportItem[]>([]);
  const [selected, setSelected]           = useState<number[]>([]);
  const [search, setSearch]               = useState('');
  const [hideExisting, setHideExisting]   = useState(true);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [loading, setLoading]             = useState(false);
  const [importing, setImporting]         = useState(false);
  const [error, setError]                 = useState('');

  useEffect(() => {
    const current = getActiveBranch();
    branchesApi.list()
      .then((list) => {
        const others = list.filter((b) => b.slug !== current).map((b) => ({ slug: b.slug, name: b.name }));
        setBranchOptions(others);
        if (others.length) setBranch(others[0].slug);
      })
      .catch(() => setError('تعذّر تحميل الفروع'));
  }, []);

  useEffect(() => {
    if (!branch) return;
    setLoading(true);
    setSelected([]);
    setError('');
    menuApi.importSource(branch)
      .then((res) => setRows(res.items))
      .catch(() => setError('تعذّر تحميل أصناف هذا الفرع'))
      .finally(() => setLoading(false));
  }, [branch]);

  const q = search.trim();
  const visible = rows.filter((r) => {
    if (hideExisting && r.exists) return false;
    if (!q) return true;
    return r.name.includes(q) || r.apps.some((a) => a.name.includes(q) || a.aliases.some((x) => x.includes(q)));
  });

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.includes(r.id));
  const toggleAll = () => setSelected(allVisibleSelected ? [] : visible.map((r) => r.id));

  const handleImport = async () => {
    if (!selected.length) return;
    setImporting(true);
    setError('');
    try {
      const res = await menuApi.importItems({ branch, itemIds: selected, updateExisting });
      const parts = [`تم استيراد ${res.created} صنف`];
      if (res.updated) parts.push(`تحديث ${res.updated}`);
      if (res.skipped) parts.push(`تخطّي ${res.skipped} موجود مسبقاً`);
      onImported(parts.join(' • '));
      onClose();
    } catch {
      setError('تعذّر الاستيراد، حاول مجدداً');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-mist">
            <div>
              <h2 className="text-xl font-black text-on-surface">استيراد أصناف من فرع آخر</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                تُنسخ الأصناف المحددة بسعر Foodics والتصنيف وأسماء التطبيقات كما هي
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-low transition-colors">
              <X size={20} />
            </button>
          </div>

          {/* Controls */}
          <div className="px-6 py-4 border-b border-mist space-y-3">
            <div className="flex gap-2">
              <select
                className="flex-1 rounded-xl border border-mist px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 bg-white cursor-pointer"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              >
                {branchOptions.length === 0 && <option value="">لا توجد فروع أخرى</option>}
                {branchOptions.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
              </select>
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={15} />
                <input
                  className="w-full bg-white border border-mist rounded-xl pr-9 pl-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="ابحث بالاسم أو باسم التطبيق..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant cursor-pointer">
                <input type="checkbox" className="accent-primary" checked={hideExisting} onChange={(e) => setHideExisting(e.target.checked)} />
                إخفاء الموجود مسبقاً
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant cursor-pointer">
                <input type="checkbox" className="accent-primary" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                تحديث الأصناف الموجودة بدل تخطّيها
              </label>
              <button
                type="button"
                onClick={toggleAll}
                disabled={!visible.length}
                className="text-xs font-bold text-on-surface hover:text-on-surface/70 disabled:opacity-40 mr-auto"
              >
                {allVisibleSelected ? 'إلغاء تحديد الكل' : `تحديد الكل (${visible.length})`}
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {loading ? (
              <div className="py-16 text-center text-on-surface-variant">
                <RefreshCw size={28} className="mx-auto mb-3 animate-spin opacity-40" />
                <p className="text-sm">جاري التحميل...</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="py-16 text-center text-on-surface-variant">
                <Search size={36} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">لا توجد أصناف لعرضها</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visible.map((r) => {
                  const active = selected.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggle(r.id)}
                      className={cn(
                        'w-full text-right rounded-2xl border px-4 py-3 transition-all flex items-start gap-3',
                        active ? 'border-primary/40 bg-primary/[0.04]' : 'border-mist hover:border-primary/20'
                      )}
                    >
                      <div className={cn(
                        'mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors',
                        active ? 'bg-primary border-primary' : 'border-mist bg-white'
                      )}>
                        {active && <CheckCircle2 size={14} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-on-surface">{r.name}</span>
                          {r.categoryName && (
                            <span className="text-[10px] font-semibold text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-full">
                              {r.categoryName}
                            </span>
                          )}
                          {r.exists && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">موجود مسبقاً</span>
                          )}
                          {r.sameNameDifferentPrice && (
                            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">نسخة بسعر مختلف</span>
                          )}
                        </div>
                        <p className={cn('text-[11px] font-semibold mt-1', r.foodicsPrice != null ? 'text-on-surface-variant' : 'text-amber-600')}>
                          {r.foodicsPrice != null
                            ? `سعر Foodics: ${Number(r.foodicsPrice).toLocaleString('en-US')} د.ع`
                            : 'لا يوجد سعر Foodics'}
                        </p>
                        {r.apps.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {r.apps.map((a) => (
                              <span key={a.platform} className="text-[10px] text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-full">
                                {a.platform}: {[a.name, ...a.aliases].filter(Boolean).join(' / ')}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg mt-3">{error}</p>}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-mist flex gap-3 items-center">
            <span className="text-xs font-semibold text-on-surface-variant">{selected.length} محدد</span>
            <div className="flex gap-3 mr-auto">
              <Button variant="secondary" onClick={onClose} type="button">إلغاء</Button>
              <Button onClick={handleImport} type="button" disabled={importing || !selected.length}>
                {importing ? <RefreshCw size={15} className="animate-spin" /> : <Download size={16} />}
                {importing ? 'جاري الاستيراد...' : 'استيراد المحدد'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

export const MenuPage = ({ setPage }: MenuPageProps) => {
  const [items, setItems]             = useState<MenuItem[]>([]);
  const [apiCategories, setApiCategories] = useState<ApiMenuCategory[]>([]);
  const [platformConns, setPlatformConns] = useState<ApiPlatform[]>([]);
  const [searchVal, setSearchVal]     = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [syncing, setSyncing]         = useState(false);
  const [menuOpenId, setMenuOpenId]   = useState<number | null>(null);
  const [showAddModal, setShowAddModal]   = useState(false);
  const [editItem, setEditItem]           = useState<MenuItem | null>(null);
  const [showImport, setShowImport]       = useState(false);
  const [toast, setToast]                 = useState('');
  const [onlyUnlinked, setOnlyUnlinked]   = useState(false);
  // Items ticked for a bulk on/off.
  const [selected, setSelected]           = useState<number[]>([]);
  const [bulkBusy, setBulkBusy]           = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      const raw = await menuApi.items();
      const list = Array.isArray(raw) ? raw : (raw as { results: ApiMenuItem[] }).results;
      setItems(list.map(toMenuItem));
    } catch {}
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const raw = await menuApi.categories();
      const list = Array.isArray(raw) ? raw : (raw as { results: ApiMenuCategory[] }).results;
      setApiCategories(list);
      // Default to the "الكل" (All) view so uncategorized items are visible too.
    } catch {}
  }, []);

  useEffect(() => {
    fetchItems();
    fetchCategories();
    platformsApi.list().then(setPlatformConns).catch(() => {});
  }, [fetchItems, fetchCategories]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const toggleStatus = async (id: number) => {
    setItems((prev) => prev.map((item) =>
      item.id === id ? { ...item, status: item.status === 'نشط' ? 'مخفي' : 'نشط' } : item
    ));
    try {
      const updated = await menuApi.toggleAvailability(id);
      setItems((prev) => prev.map((item) => item.id === id ? toMenuItem(updated) : item));
    } catch {
      fetchItems();
    }
  };

  const toggleSelected = (id: number) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  // One request for all ticked items → the devices get a single list per app
  // and toggle them in one run, instead of one run per item.
  const setSelectedAvailability = async (available: boolean) => {
    if (selected.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await menuApi.setAvailabilityBulk(selected, available);
      const byId = new Map(res.items.map((it) => [it.id, toMenuItem(it)]));
      setItems((prev) => prev.map((item) => byId.get(item.id) ?? item));
      setToast(res.updated > 0
        ? `تم ${available ? 'تشغيل' : 'إيقاف'} ${res.updated} صنف وإرسالها للأجهزة دفعة واحدة`
        : `الأصناف المحددة ${available ? 'تعمل' : 'متوقفة'} بالفعل`);
      setSelected([]);
    } catch {
      setToast('تعذّر تحديث الأصناف، حاول مجدداً');
      fetchItems();
    } finally {
      setBulkBusy(false);
      setTimeout(() => setToast(''), 6000);
    }
  };

  const handleSaveNew = async (data: Parameters<ItemFormProps['onSave']>[0]) => {
    const created = await menuApi.create({
      name: data.name, category: data.category,
      platforms: data.platforms, platformNames: data.platformNames,
      platformAliases: data.platformAliases,
      platformPosCategories: data.platformPosCategories,
      foodicsPrice: data.foodicsPrice,
      foodicsProductId: data.foodicsProductId,
    });
    setItems((prev) => [toMenuItem(created), ...prev]);
  };

  const handleSaveEdit = async (data: Parameters<ItemFormProps['onSave']>[0]) => {
    if (!editItem) return;
    const updated = await menuApi.update(editItem.id, {
      name: data.name, category: data.category,
      platforms: data.platforms, platformNames: data.platformNames,
      platformAliases: data.platformAliases,
      platformPosCategories: data.platformPosCategories,
      foodicsPrice: data.foodicsPrice,
      foodicsProductId: data.foodicsProductId,
    });
    setItems((prev) => prev.map((item) => item.id === editItem.id ? toMenuItem(updated) : item));
  };

  const handleDuplicate = async (item: MenuItem) => {
    setMenuOpenId(null);
    try {
      const created = await menuApi.create({
        name: `${item.name} (نسخة)`,
        category: item.categoryId,
        platforms: item.platforms,
        platformNames: {},
      });
      setItems((prev) => [toMenuItem(created), ...prev]);
    } catch {}
  };

  const handleDelete = async (id: number) => {
    setMenuOpenId(null);
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await menuApi.remove(id);
    } catch {
      fetchItems(); // revert on error
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      // Enqueue a platform sync for every menu item.
      await Promise.all(items.map((it) => menuApi.sync(it.id)));
    } catch {
      // best-effort — individual failures are logged server-side
    }
    setSyncing(false);
  };

  // ── Display ────────────────────────────────────────────────────────────────

  const categoryNames = apiCategories.map((c) => c.nameAr);

  const filtered = items.filter((item) => {
    const matchesSearch = !searchVal || item.name.includes(searchVal) || item.description.includes(searchVal);
    const matchesCategory = !activeCategory || item.category === activeCategory;
    const matchesLink = !onlyUnlinked || !item.foodicsProductId;
    return matchesSearch && matchesCategory && matchesLink;
  });

  const unlinkedCount = items.filter((i) => !i.foodicsProductId).length;

  const liveCount = items.filter((i) => i.status === 'نشط').length;

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="menu" setPage={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="menu" />
        <main className="p-6 md:p-8 space-y-6 overflow-y-auto">

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-5">
            <div>
              <h1 className="text-3xl md:text-4xl font-black text-on-surface">إدارة القائمة</h1>
              <p className="text-on-surface-variant mt-2 max-w-xl text-sm">
                قم بتكوين عروضك الطهوية وضبط الأسعار ومزامنة التوافر عبر جميع شركاء التوصيل في الوقت الفعلي.
              </p>
            </div>
            <div className="flex gap-3 shrink-0">
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                <Download size={16} />
                استيراد من فرع
              </Button>
              <Button variant="secondary" onClick={handleSync}>
                <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'جاري المزامنة...' : 'مزامنة المنصات'}
              </Button>
              <Button onClick={() => setShowAddModal(true)}>
                <Plus size={16} />
                إضافة عنصر
              </Button>
            </div>
          </div>

          {/* Search + Category tabs */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={15} />
              <input
                className="w-full bg-white border border-mist rounded-xl pr-9 pl-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                placeholder="ابحث عن عنصر..."
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
              />
              {searchVal && (
                <button className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" onClick={() => setSearchVal('')}>
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => setOnlyUnlinked((v) => !v)}
              className={cn(
                'px-4 py-2.5 rounded-xl text-sm font-bold border transition-all shrink-0',
                onlyUnlinked
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-on-surface-variant border-mist hover:border-amber-400 hover:text-on-surface'
              )}
              title="عرض الأصناف غير المرتبطة بصنف Foodics فقط"
            >
              غير مرتبط بـ Foodics{unlinkedCount ? ` (${unlinkedCount})` : ''}
            </button>
            {categoryNames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 bg-surface-container-low p-1.5 rounded-2xl">
                <button
                  onClick={() => setActiveCategory('')}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                    activeCategory === '' ? 'bg-white text-on-surface shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high'
                  )}
                >
                  الكل
                </button>
                {categoryNames.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={cn(
                      'px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                      activeCategory === cat ? 'bg-white text-on-surface shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high'
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Menu grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map((item) => (
              <Card key={item.id} className="p-0 overflow-hidden flex flex-col group">
                <div className="relative h-44 overflow-hidden">
                  <img
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    src={item.image}
                    alt={item.name}
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <label
                    className="absolute top-3 left-3 w-7 h-7 rounded-lg bg-white/90 backdrop-blur shadow-sm flex items-center justify-center cursor-pointer"
                    title="تحديد للتشغيل/الإيقاف الجماعي"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-primary cursor-pointer"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                    />
                  </label>
                  {item.tag && (
                    <div className="absolute top-3 right-3">
                      <span className="px-2.5 py-1 bg-white/90 backdrop-blur text-xs font-bold rounded-full text-on-surface shadow-sm">
                        {item.tag}
                      </span>
                    </div>
                  )}
                  <div className={cn(
                    'absolute bottom-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold',
                    item.status === 'نشط' ? 'bg-green-500 text-white' : 'bg-surface-container-low0 text-white'
                  )}>
                    {item.status === 'نشط' ? '● نشط' : '● مخفي'}
                  </div>
                </div>
                <div className="p-5 flex flex-col flex-grow gap-3">
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="font-bold text-base text-on-surface leading-tight">{item.name}</h3>
                    {item.price && <span className="text-on-surface font-black text-sm shrink-0">{item.price}</span>}
                  </div>
                  <p className={cn('text-[11px] font-semibold', item.foodicsPrice != null ? 'text-on-surface-variant' : 'text-amber-600')}>
                    {item.foodicsPrice != null ? `سعر Foodics: ${item.foodicsPrice.toLocaleString('en-US')} د.ع` : 'لا يوجد سعر Foodics'}
                  </p>
                  <p
                    className={cn('text-[11px] font-semibold', item.foodicsProductId ? 'text-forest' : 'text-amber-600')}
                    title={item.foodicsProductId || undefined}
                  >
                    {item.foodicsProductId
                      ? `مرتبط بـ Foodics · ${item.foodicsProductId.slice(0, 8)}`
                      : 'غير مرتبط بصنف Foodics'}
                  </p>
                  <p className="text-xs text-on-surface-variant line-clamp-2 leading-relaxed">{item.description}</p>
                  <div className="mt-auto pt-3 border-t border-slate-50 flex items-center justify-between">
                    {/* Availability toggle */}
                    <button className="flex items-center gap-2" onClick={() => toggleStatus(item.id)}>
                      <div className={cn('w-10 h-5 rounded-full relative transition-colors duration-300', item.status === 'نشط' ? 'bg-primary' : 'bg-slate-300')}>
                        <div className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-300', item.status === 'نشط' ? 'right-0.5' : 'left-0.5')} />
                      </div>
                      <span className={cn('text-xs font-bold', item.status === 'نشط' ? 'text-on-surface' : 'text-on-surface-variant')}>
                        {item.status}
                      </span>
                    </button>

                    {/* Settings + 3-dot menu */}
                    <div className="flex gap-1 relative">
                      <button
                        className="p-1.5 text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors"
                        title="تعديل"
                        onClick={() => { setEditItem(item); setMenuOpenId(null); }}
                      >
                        <Settings size={15} />
                      </button>
                      <button
                        className="p-1.5 text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors"
                        onClick={() => setMenuOpenId(menuOpenId === item.id ? null : item.id)}
                      >
                        <MoreVertical size={15} />
                      </button>
                      {menuOpenId === item.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                          <div className="absolute left-0 bottom-8 bg-white rounded-xl shadow-2xl border border-mist z-20 overflow-hidden w-40 py-1">
                            <button
                              className="w-full text-right px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
                              onClick={() => { setEditItem(item); setMenuOpenId(null); }}
                            >
                              تعديل
                            </button>
                            <button
                              className="w-full text-right px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
                              onClick={() => handleDuplicate(item)}
                            >
                              تكرار
                            </button>
                            <button
                              className="w-full text-right px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                              onClick={() => handleDelete(item.id)}
                            >
                              حذف
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full py-16 text-center text-on-surface-variant">
                <Search size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">
                  {searchVal ? `لا توجد نتائج للبحث عن "${searchVal}"` : 'لا توجد عناصر في هذا التصنيف'}
                </p>
              </div>
            )}
          </div>

          {/* Platform sync summary */}
          <div className="bg-surface-container-low rounded-2xl p-6 md:p-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-bold tracking-widest text-on-surface-variant uppercase">حالة مزامنة المنصات</span>
                <div className="flex items-end gap-2 mt-3">
                  <span className="text-4xl font-black text-on-surface">{liveCount}</span>
                  <span className="text-on-surface-variant text-sm pb-1">/ {items.length} عنصر نشط</span>
                </div>
                <div className="mt-2 w-48 bg-surface-container-high rounded-full h-1.5">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all"
                    style={{ width: items.length ? `${(liveCount / items.length) * 100}%` : '0%' }}
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {PLATFORMS.map((platform) => {
                const conn = platformConns.find((c) => c.slug === platform.id);
                const connected = !!conn?.isConnected;
                return (
                  <div key={platform.id} className="bg-white rounded-xl p-3 flex flex-col items-center gap-2 shadow-sm">
                    <PlatformBadge platformId={platform.id} variant="icon" size="md" />
                    <span className="text-[11px] font-semibold text-on-surface text-center">{platform.name}</span>
                    <div className="flex items-center gap-1">
                      {connected ? (
                        <>
                          <CheckCircle2 size={12} className="text-green-500" />
                          <span className="text-[10px] text-green-600 font-bold">متصل</span>
                        </>
                      ) : (
                        <>
                          <X size={12} className="text-on-surface-variant" />
                          <span className="text-[10px] text-on-surface-variant font-bold">غير متصل</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </main>
      </div>

      {/* Import from another branch */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={(summary) => {
            setToast(summary);
            fetchItems();
            fetchCategories();
            setTimeout(() => setToast(''), 6000);
          }}
        />
      )}

      {/* Bulk on/off bar — shown while items are ticked */}
      {selected.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white border border-mist shadow-2xl rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-on-surface">تم تحديد {selected.length} صنف</span>
          <button
            className="text-xs font-semibold text-on-surface-variant hover:text-on-surface"
            onClick={() => setSelected(Array.from(new Set([...selected, ...filtered.map((i) => i.id)])))}
          >
            تحديد كل الظاهر ({filtered.length})
          </button>
          <Button onClick={() => setSelectedAvailability(true)} disabled={bulkBusy}>
            تشغيل المحدد
          </Button>
          <Button variant="secondary" onClick={() => setSelectedAvailability(false)} disabled={bulkBusy}>
            إيقاف المحدد
          </Button>
          <button
            className="p-1.5 text-on-surface-variant hover:bg-surface-container-low rounded-lg"
            onClick={() => setSelected([])}
            title="إلغاء التحديد"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-6 z-[60] bg-on-surface text-white text-sm font-bold px-4 py-3 rounded-xl shadow-2xl">
          {toast}
        </div>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <ItemFormModal
          apiCategories={apiCategories}
          onCategoryCreated={(cat) => setApiCategories(prev => [...prev, cat])}
          onClose={() => setShowAddModal(false)}
          onSave={handleSaveNew}
          title="إضافة عنصر جديد"
          saveLabel="إضافة إلى القائمة"
        />
      )}

      {/* Edit Item Modal */}
      {editItem && (
        <ItemFormModal
          initial={editItem}
          apiCategories={apiCategories}
          onCategoryCreated={(cat) => setApiCategories(prev => [...prev, cat])}
          onClose={() => setEditItem(null)}
          onSave={handleSaveEdit}
          title={`تعديل: ${editItem.name}`}
          saveLabel="حفظ التعديلات"
        />
      )}
    </div>
  );
};
