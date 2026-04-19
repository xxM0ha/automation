/**
 * API client — all backend calls go through here.
 * Token is stored in localStorage and attached automatically.
 */

const BASE = '/api';

// ─── Auth storage ─────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'kitchen';
  token: string;
  restaurant: { id: number; name: string; slug: string } | null;
}

export function getAuth(): AuthUser | null {
  try {
    const raw = localStorage.getItem('prime_auth');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuth(user: AuthUser) {
  localStorage.setItem('prime_auth', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('prime_auth');
}

// ─── Base fetch ───────────────────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getAuth()?.token;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearAuth();
    window.dispatchEvent(new CustomEvent('prime:unauthorized'));
    throw new Error('Unauthenticated');
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = err.detail || JSON.stringify(err);
    } catch {}
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

const get    = <T>(path: string)                  => request<T>('GET',    path);
const post   = <T>(path: string, body?: unknown)  => request<T>('POST',   path, body);
const patch  = <T>(path: string, body?: unknown)  => request<T>('PATCH',  path, body);
const remove = <T>(path: string)                  => request<T>('DELETE', path);

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  login: (email: string, password: string) =>
    post<AuthUser>('/auth/login/', { email, password }),
  logout: () => post('/auth/logout/'),
  me: () => get<AuthUser>('/auth/me/'),
};

// ─── Orders ───────────────────────────────────────────────────────────────────

export interface ApiOrder {
  id: number;
  platformId: string;
  externalId: string;
  status: string;
  statusDisplay: string;
  customerName: string;
  customerPhone: string;
  address: string;
  notes: string;
  total: string;
  items: string;
  createdAt: string;
}

export interface ApiOrderStats {
  active: number;
  preparing: number;
  completedToday: number;
  avgPrepMinutes: number;
}

export const orders = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return get<{ results: ApiOrder[]; count: number }>(`/orders/list/${qs}`);
  },
  live: () => get<ApiOrder[]>('/orders/live/'),
  stats: () => get<ApiOrderStats>('/orders/stats/'),
  updateStatus: (id: number, status: string) =>
    patch<ApiOrder>(`/orders/${id}/status/`, { status }),
  reject: (id: number, reason: string) =>
    post<ApiOrder>(`/orders/${id}/reject/`, { reason }),
};

// ─── Menu ─────────────────────────────────────────────────────────────────────

export interface ApiMenuItemPlatformMapping {
  platformId: string;
  platformNameAr: string;
  platformName: string;
}

export interface ApiMenuItem {
  id: number;
  name: string;
  price: string;
  priceDisplay: string;
  description: string;
  image: string;
  tag?: string;
  isAvailable: boolean;
  category: number;
  categoryName: string;
  platforms: string[];
  platformMappings: ApiMenuItemPlatformMapping[];
}

export interface ApiMenuCategory {
  id: number;
  nameAr: string;
  sortOrder: number;
}

export const menu = {
  items: () => get<{ results: ApiMenuItem[]; count: number } | ApiMenuItem[]>('/menu/items/'),
  categories: () => get<{ results: ApiMenuCategory[]; count: number } | ApiMenuCategory[]>('/menu/categories/'),
  createCategory: (nameAr: string) => post<ApiMenuCategory>('/menu/categories/', { name_ar: nameAr, sort_order: 0 }),
  toggleAvailability: (id: number) =>
    patch<ApiMenuItem>(`/menu/items/${id}/availability/`, undefined),
  update: (id: number, data: Record<string, unknown>) =>
    patch<ApiMenuItem>(`/menu/items/${id}/`, data),
  create: (data: Record<string, unknown>) =>
    post<ApiMenuItem>('/menu/items/', data),
  remove: (id: number) =>
    remove<void>(`/menu/items/${id}/`),
};

// ─── Notifications ────────────────────────────────────────────────────────────

export interface ApiNotification {
  id: number;
  title: string;
  body: string;
  type: 'order' | 'alert' | 'system';
  is_read: boolean;
  created_at: string;
}

export const notifications = {
  list: () =>
    get<{ results: ApiNotification[]; unreadCount: number }>('/notifications/'),
  markRead: (id: number) => patch<ApiNotification>(`/notifications/${id}/read/`, {}),
  markAllRead: () => post('/notifications/read-all/'),
};

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface ReportSummary {
  totalOrders: number;
  completedOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
}

export interface VelocityPoint { time: string; orders: number }
export interface PlatformStat {
  name: string; slug: string; color: string; value: number; revenue: number;
}
export interface TopItem { name: string; units: number; progress: number }

export const reports = {
  summary: (range = 'today') =>
    get<ReportSummary>(`/reports/summary/?range=${range}`),
  velocity: (range = 'today') =>
    get<VelocityPoint[]>(`/reports/velocity/?range=${range}`),
  platforms: (range = 'today') =>
    get<PlatformStat[]>(`/reports/platforms/?range=${range}`),
  topItems: (range = 'today') =>
    get<TopItem[]>(`/reports/top-items/?range=${range}`),
};

// ─── Platforms (integrations) ─────────────────────────────────────────────────

export interface ApiPlatform {
  id: number;
  slug: string;
  nameAr: string;
  nameEn: string;
  color: string;
  logoPath: string | null;
  isConnected: boolean;
  autoAccept: boolean;
  menuSync: boolean;
  ordersToday: number;
  lastSyncAt: string | null;
}

export const platforms = {
  list: () => get<ApiPlatform[]>('/platforms/'),
  connect: (slug: string, isConnected: boolean) =>
    patch<ApiPlatform>(`/platforms/${slug}/connect/`, { isConnected }),
  sync: (slug: string) => post(`/platforms/${slug}/sync/`),
  updateSettings: (slug: string, settings: { autoAccept?: boolean; menuSync?: boolean }) =>
    patch<ApiPlatform>(`/platforms/${slug}/settings/`, settings),
};
