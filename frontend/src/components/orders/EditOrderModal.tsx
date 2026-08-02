import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Minus, Trash2, Search, Loader2 } from 'lucide-react';
import { orders as ordersApi, menu as menuApi, type ApiOrderDetail, type ApiMenuItem } from '../../lib/api';
import { PlatformBadge } from '../ui/PlatformBadge';
import { cn } from '../../lib/utils';

interface Props {
  orderId: number;
  onClose: () => void;
}

export const EditOrderModal = ({ orderId, onClose }: Props) => {
  const [order, setOrder]         = useState<ApiOrderDetail | null>(null);
  const [menuItems, setMenuItems] = useState<ApiMenuItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState<number | 'add' | null>(null);
  const [search, setSearch]       = useState('');
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addQty, setAddQty]       = useState(1);
  const [addNotes, setAddNotes]   = useState('');
  const [selectedItem, setSelectedItem] = useState<ApiMenuItem | null>(null);

  const fetchOrder = useCallback(async () => {
    try {
      const detail = await ordersApi.detail(orderId);
      setOrder(detail);
    } catch {}
  }, [orderId]);

  useEffect(() => {
    Promise.all([
      ordersApi.detail(orderId),
      menuApi.items(),
    ]).then(([detail, itemsRes]) => {
      setOrder(detail);
      const arr = Array.isArray(itemsRes) ? itemsRes : itemsRes.results;
      setMenuItems(arr);
    }).finally(() => setLoading(false));
  }, [orderId]);

  const filteredMenu = menuItems.filter((m) =>
    !search || m.name.toLowerCase().includes(search.toLowerCase())
  );

  const changeQty = async (itemId: number, currentQty: number, delta: number) => {
    const newQty = currentQty + delta;
    if (newQty < 1) return;
    setSaving(itemId);
    try {
      const updated = await ordersApi.updateItem(orderId, itemId, { qty: newQty });
      setOrder(updated);
    } catch {} finally {
      setSaving(null);
    }
  };

  const removeItem = async (itemId: number) => {
    setSaving(itemId);
    try {
      const updated = await ordersApi.removeItem(orderId, itemId);
      setOrder(updated);
    } catch {} finally {
      setSaving(null);
    }
  };

  const addItem = async () => {
    if (!selectedItem) return;
    setSaving('add');
    try {
      const updated = await ordersApi.addItem(orderId, {
        menu_item_id: selectedItem.id,
        name: selectedItem.name,
        qty: addQty,
        unit_price: Number(selectedItem.price),
        notes: addNotes,
      });
      setOrder(updated);
      setSelectedItem(null);
      setAddQty(1);
      setAddNotes('');
      setSearch('');
      setShowAddPanel(false);
    } catch {} finally {
      setSaving(null);
    }
  };

  const total = order ? Number(order.total) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            {order && <PlatformBadge platformId={order.platformId} variant="icon" size="sm" />}
            <div>
              <h2 className="text-lg font-black text-slate-900">
                تعديل الطلب #{order?.externalId || orderId}
              </h2>
              {order && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {order.customerName}
                  {order.customerPhone ? ` · ${order.customerPhone}` : ''}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin text-on-surface" />
          </div>
        ) : order ? (
          <div className="flex-1 overflow-y-auto">

            {/* Order notes */}
            {order.notes && (
              <div className="mx-6 mt-4 px-4 py-3 bg-amber-50 rounded-xl text-sm text-amber-800 border border-amber-100">
                <span className="font-semibold">ملاحظات: </span>{order.notes}
              </div>
            )}

            {/* Items list */}
            <div className="px-6 pt-5 pb-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">الأصناف</h3>
              <div className="space-y-2">
                {order.orderItems.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">لا توجد أصناف</p>
                )}
                {order.orderItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{item.nameSnapshot}</p>
                      {item.notes && (
                        <p className="text-xs text-slate-400 mt-0.5 truncate">{item.notes}</p>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 shrink-0">
                      {Number(item.unitPrice).toLocaleString()} د.ع
                    </p>
                    {/* Qty controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => changeQty(item.id, item.qty, -1)}
                        disabled={saving === item.id || item.qty <= 1}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                      >
                        <Minus size={12} />
                      </button>
                      <span className={cn(
                        'w-7 text-center text-sm font-bold',
                        saving === item.id && 'opacity-40'
                      )}>
                        {saving === item.id ? '…' : item.qty}
                      </span>
                      <button
                        onClick={() => changeQty(item.id, item.qty, 1)}
                        disabled={saving === item.id}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    {/* Delete */}
                    <button
                      onClick={() => removeItem(item.id)}
                      disabled={saving === item.id}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Add item panel */}
            <div className="px-6 pb-5 mt-3">
              {!showAddPanel ? (
                <button
                  onClick={() => setShowAddPanel(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-sm font-semibold text-slate-400 hover:border-primary hover:text-on-surface transition-colors"
                >
                  <Plus size={16} />
                  إضافة صنف
                </button>
              ) : (
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-700">إضافة صنف جديد</p>
                    <button onClick={() => { setShowAddPanel(false); setSelectedItem(null); setSearch(''); }}
                      className="text-slate-400 hover:text-slate-600">
                      <X size={16} />
                    </button>
                  </div>

                  {/* Menu search */}
                  {!selectedItem ? (
                    <>
                      <div className="relative">
                        <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          placeholder="ابحث عن صنف..."
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl text-sm pr-9 pl-3 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                          autoFocus
                        />
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {filteredMenu.slice(0, 20).map((m) => (
                          <button
                            key={m.id}
                            onClick={() => setSelectedItem(m)}
                            className="w-full text-right flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors"
                          >
                            <span className="text-sm font-medium text-slate-700">{m.name}</span>
                            <span className="text-xs text-slate-400">{Number(m.price).toLocaleString()} د.ع</span>
                          </button>
                        ))}
                        {filteredMenu.length === 0 && (
                          <p className="text-sm text-slate-400 text-center py-3">لا توجد نتائج</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between bg-primary/5 rounded-xl px-3 py-2">
                        <p className="text-sm font-semibold text-on-surface">{selectedItem.name}</p>
                        <button onClick={() => setSelectedItem(null)} className="text-on-surface/60 hover:text-on-surface">
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex gap-3 items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500">الكمية</span>
                          <button onClick={() => setAddQty((q) => Math.max(1, q - 1))}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                            <Minus size={12} />
                          </button>
                          <span className="w-6 text-center text-sm font-bold">{addQty}</span>
                          <button onClick={() => setAddQty((q) => q + 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                            <Plus size={12} />
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="ملاحظات (اختياري)"
                          value={addNotes}
                          onChange={(e) => setAddNotes(e.target.value)}
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-xl text-sm px-3 py-1.5 outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                      <button
                        onClick={addItem}
                        disabled={saving === 'add'}
                        className="w-full py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
                      >
                        {saving === 'add' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                        إضافة
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-16 text-slate-400 text-sm">
            تعذّر تحميل الطلب
          </div>
        )}

        {/* Footer — total */}
        {order && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
            <p className="text-sm text-slate-500 font-semibold">الإجمالي</p>
            <p className="text-xl font-black text-slate-900">{total.toLocaleString()} د.ع</p>
          </div>
        )}
      </div>
    </div>
  );
};
