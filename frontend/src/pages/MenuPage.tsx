import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { RefreshCw, Plus, Settings, MoreVertical, Search, X, CheckCircle2, Upload, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PlatformBadge } from '../components/ui/PlatformBadge';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import { menu as menuApi, platforms as platformsApi, type ApiMenuItem, type ApiMenuCategory, type ApiPlatform } from '../lib/api';
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
  };
}

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

  const handleSaveNew = async (data: Parameters<ItemFormProps['onSave']>[0]) => {
    const created = await menuApi.create({
      name: data.name, category: data.category,
      platforms: data.platforms, platformNames: data.platformNames,
      platformAliases: data.platformAliases,
      platformPosCategories: data.platformPosCategories,
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
    return matchesSearch && matchesCategory;
  });

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
