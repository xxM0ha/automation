/**
 * API client — all backend calls go through here.
 * Token is stored in localStorage and attached automatically.
 */

const BASE = '/api';

// ─── Auth storage ─────────────────────────────────────────────────────────────

export interface Branch {
  id: number;
  name: string;
  slug: string;
  role: 'admin' | 'kitchen' | null;
}

/** A branch as the owner manages it (extra fields + its logins). */
export interface BranchAdmin extends Branch {
  foodicsBranch: string;
  printingEnabled: boolean;
  isActive: boolean;
  itemCount: number;
  logins: { username: string; role: string }[];
}

export interface AuthUser {
  id: number;
  email: string;
  username: string | null;
  name: string;
  role: 'admin' | 'kitchen';
  isDev: boolean;
  isOwner: boolean;
  token: string;
  restaurant: { id: number; name: string; slug: string } | null;
  organization: { id: number; name: string; slug: string } | null;
  activeBranch: string | null;
  branches: Branch[];
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
  localStorage.removeItem('prime_branch');
}

/** The branch the owner is currently viewing (sent as the X-Branch header). */
export function getActiveBranch(): string | null {
  return localStorage.getItem('prime_branch');
}

export function setActiveBranch(slug: string | null) {
  if (slug) localStorage.setItem('prime_branch', slug);
  else localStorage.removeItem('prime_branch');
}

// ─── Base fetch ───────────────────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getAuth()?.token;
  const branch = getActiveBranch();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Token ${token}` } : {}),
      ...(branch ? { 'X-Branch': branch } : {}),
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

export interface RegisterBranchInput {
  name: string;
  username?: string;
  password?: string;
}

export const auth = {
  // `email` accepts an email (owners) or a branch username (branch logins).
  login: (email: string, password: string) =>
    post<AuthUser>('/auth/login/', { email, password }),
  register: (data: {
    name: string;
    email: string;
    password: string;
    businessName?: string;
    branches?: RegisterBranchInput[];
  }) => post<AuthUser>('/auth/register/', data),
  logout: () => post('/auth/logout/'),
  me: () => get<AuthUser>('/auth/me/'),
};

// ─── Branches (owner) ───────────────────────────────────────────────────────

export const branchesApi = {
  list: () => get<BranchAdmin[]>('/branches/'),
  create: (data: {
    name: string;
    foodicsBranch?: string;
    mode?: 'empty' | 'clone';
    cloneFrom?: string;
    username?: string;
    password?: string;
    role?: 'admin' | 'kitchen';
  }) => post<BranchAdmin>('/branches/', data),
  update: (id: number, data: Partial<{ name: string; foodicsBranch: string; isActive: boolean }>) =>
    patch<BranchAdmin>(`/branches/${id}/`, data),
  remove: (id: number) => remove(`/branches/${id}/`),
  setLogin: (id: number, data: { username: string; password?: string; role?: 'admin' | 'kitchen' }) =>
    post<BranchAdmin>(`/branches/${id}/login/`, data),
  syncMenus: (data: { from: string }) =>
    post<BranchSyncResult>('/branches/sync/', data),
};

export interface BranchSyncResult {
  source: string;
  results: {
    branch: string;
    name: string;
    created?: number;
    updated?: number;
    mappings?: number;
    aliases?: number;
    categories?: number;
    error?: string;
  }[];
}

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

export interface ApiOrderItem {
  id: number;
  nameSnapshot: string;
  qty: number;
  unitPrice: string;
  notes: string;
}

export interface ApiOrderDetail extends Omit<ApiOrder, 'items'> {
  platformNameAr: string;
  posExternalId: string;
  rejectionReason: string;
  orderItems: ApiOrderItem[];
  acceptedAt: string | null;
  deliveredAt: string | null;
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
  detail: (id: number) => get<ApiOrderDetail>(`/orders/${id}/`),
  live: () => get<ApiOrder[]>('/orders/live/'),
  stats: () => get<ApiOrderStats>('/orders/stats/'),
  updateStatus: (id: number, status: string) =>
    patch<ApiOrder>(`/orders/${id}/status/`, { status }),
  reject: (id: number, reason: string) =>
    post<ApiOrder>(`/orders/${id}/reject/`, { reason }),
  addItem: (orderId: number, data: { name: string; qty: number; unit_price: number; notes: string; menu_item_id?: number }) =>
    post<ApiOrderDetail>(`/orders/${orderId}/items/`, data),
  updateItem: (orderId: number, itemId: number, data: { qty?: number; notes?: string }) =>
    patch<ApiOrderDetail>(`/orders/${orderId}/items/${itemId}/`, data),
  removeItem: (orderId: number, itemId: number) =>
    remove<ApiOrderDetail>(`/orders/${orderId}/items/${itemId}/`),
};

// ─── Menu ─────────────────────────────────────────────────────────────────────

export interface ApiMenuItemPlatformMapping {
  platformId: string;
  platformNameAr: string;
  platformName: string;
  posCategory: string;
  aliases: string[];
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
  posCategory: string;
  foodicsPrice: string | null;
  /** Foodics product UUID — empty string when the item isn't linked yet. */
  foodicsProductId: string;
  platforms: string[];
  platformMappings: ApiMenuItemPlatformMapping[];
}

export interface ApiMenuCategory {
  id: number;
  nameAr: string;
  sortOrder: number;
}

/** An item in another branch, as offered by the import picker. */
export interface ApiImportItem {
  id: number;
  name: string;
  categoryName: string;
  foodicsPrice: string | null;
  apps: { platform: string; name: string; aliases: string[] }[];
  /** This branch already has it (same name AND same Foodics price). */
  exists: boolean;
  /** Same name here but a different Foodics price — importing adds a second copy. */
  sameNameDifferentPrice: boolean;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  categories: number;
  mappings: number;
  aliases: number;
  items: { id: number; name: string; action: string; targetId?: number }[];
}

export const menu = {
  items: () => get<{ results: ApiMenuItem[]; count: number } | ApiMenuItem[]>('/menu/items/'),
  importSource: (branch: string) =>
    get<{ branch: string; name: string; items: ApiImportItem[] }>(
      `/menu/import/source/?branch=${encodeURIComponent(branch)}`,
    ),
  importItems: (data: { branch: string; itemIds: number[]; updateExisting?: boolean }) =>
    post<ImportResult>('/menu/import/', data),
  categories: () => get<{ results: ApiMenuCategory[]; count: number } | ApiMenuCategory[]>('/menu/categories/'),
  createCategory: (nameAr: string) => post<ApiMenuCategory>('/menu/categories/', { name_ar: nameAr, sort_order: 0 }),
  toggleAvailability: (id: number) =>
    patch<ApiMenuItem>(`/menu/items/${id}/availability/`, undefined),
  /** Turn several items on/off at once — the devices get one message per app. */
  setAvailabilityBulk: (itemIds: number[], available: boolean) =>
    post<{ updated: number; items: ApiMenuItem[] }>('/menu/items/availability/bulk/', { itemIds, available }),
  update: (id: number, data: Record<string, unknown>) =>
    patch<ApiMenuItem>(`/menu/items/${id}/`, data),
  create: (data: Record<string, unknown>) =>
    post<ApiMenuItem>('/menu/items/', data),
  remove: (id: number) =>
    remove<void>(`/menu/items/${id}/`),
  sync: (id: number) =>
    post<{ detail: string }>(`/menu/items/${id}/sync/`, undefined),
  updateCategory: (id: number, data: Record<string, unknown>) =>
    patch<ApiMenuCategory>(`/menu/categories/${id}/`, data),
  removeCategory: (id: number) =>
    remove<void>(`/menu/categories/${id}/`),
};

// ─── Notifications ────────────────────────────────────────────────────────────

export interface ApiNotification {
  id: number;
  title: string;
  body: string;
  type: 'order' | 'alert' | 'system';
  isRead: boolean;
  createdAt: string;
  relatedOrder: number | null;
}

export interface ApiUnlinkedItem {
  name: string;
  platform: string;
  platformName: string;
  count: number;
  lastSeen: string;
  suggestion: { itemId: number; itemName: string; confidence: number } | null;
}

export const notifications = {
  list: () =>
    get<{ results: ApiNotification[]; unreadCount: number }>('/notifications/'),
  listPage: (page: number, pageSize = 20) =>
    get<{ results: ApiNotification[]; unreadCount: number; count: number; page: number; numPages: number }>(
      `/notifications/?page=${page}&page_size=${pageSize}`,
    ),
  unlinkedItems: () =>
    get<{ results: ApiUnlinkedItem[]; count: number }>('/notifications/unlinked-items/'),
  linkItem: (platform: string, name: string, menuItemId: number) =>
    post<{ mapped: boolean; itemName: string; cleared: number }>('/notifications/link-item/', {
      platform, name, menuItemId,
    }),
  markRead: (id: number) => patch<ApiNotification>(`/notifications/${id}/read/`, {}),
  markAllRead: () => post('/notifications/read-all/'),
};

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface ReportSummary {
  totalOrders: number;
  completedOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  deltas?: {
    totalOrders: number | null;
    completedOrders: number | null;
    totalRevenue: number | null;
    avgOrderValue: number | null;
  };
}

export interface VelocityPoint { time: string; orders: number }
export interface PlatformStat {
  name: string; slug: string; color: string; value: number; revenue: number; avgOrderValue: number;
}
export interface TopItem { name: string; units: number; revenue: number; progress: number }
export interface PeakForecastPoint { hour: number; avg: number }
export interface DailySummaryPoint { date: string; orders: number; revenue: number; completed: number }

export interface AutomationHealth {
  incoming: number;
  pushedOk: number;
  pushFailed: number;
  rejected: number;
  successRate: number;
  reasons: { reason: string; count: number }[];
  topUnmatched: { name: string; count: number }[];
}

export interface Fulfillment {
  total: number;
  avgAcceptMinutes: number | null;
  avgFulfilMinutes: number | null;
  cancelRate: number;
  statusCounts: Record<string, number>;
}

export interface HeatmapCell { day: number; hour: number; count: number }

// Owner reports can span several branches; pass their slugs to aggregate.
const _branchQ = (branches?: string[]) =>
  branches && branches.length ? `&branches=${encodeURIComponent(branches.join(','))}` : '';

export const reports = {
  summary: (range = 'today', branches?: string[]) =>
    get<ReportSummary>(`/reports/summary/?range=${range}${_branchQ(branches)}`),
  velocity: (range = 'today', branches?: string[]) =>
    get<VelocityPoint[]>(`/reports/velocity/?range=${range}${_branchQ(branches)}`),
  platforms: (range = 'today', branches?: string[]) =>
    get<PlatformStat[]>(`/reports/platforms/?range=${range}${_branchQ(branches)}`),
  topItems: (range = 'today', branches?: string[], by: 'units' | 'revenue' = 'units') =>
    get<TopItem[]>(`/reports/top-items/?range=${range}&by=${by}${_branchQ(branches)}`),
  peakForecast: (weeks = 8, branches?: string[]) =>
    get<PeakForecastPoint[]>(`/reports/peak-forecast/?weeks=${weeks}${_branchQ(branches)}`),
  dailySummary: (range = '7d', branches?: string[]) =>
    get<DailySummaryPoint[]>(`/reports/daily-summary/?range=${range}${_branchQ(branches)}`),
  automationHealth: (range = 'today', branches?: string[]) =>
    get<AutomationHealth>(`/reports/automation-health/?range=${range}${_branchQ(branches)}`),
  fulfillment: (range = 'today', branches?: string[]) =>
    get<Fulfillment>(`/reports/fulfillment/?range=${range}${_branchQ(branches)}`),
  peakHeatmap: (range = '30d', branches?: string[]) =>
    get<HeatmapCell[]>(`/reports/peak-heatmap/?range=${range}${_branchQ(branches)}`),
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

// ─── Automation config (app-config) ─────────────────────────────────────────
// Mirrors the `AutomationConfig` document the mobile app loads. The shape is
// kept permissive on purpose so the raw-JSON editor can round-trip anything the
// backend sends, while the quick-edit cards rely on the key fields below.

export type AutomationRunMode = 'once' | 'continuous';
export type AutomationControl = 'running' | 'paused' | 'stopped';

export interface AutomationPlatformConfig {
  platform: string;
  label: string;
  enabled: boolean;
  runMode?: AutomationRunMode;
  control?: AutomationControl;
  priority?: number;
  targetPackage?: string;
  parameters?: Record<string, unknown>;
  selectors?: Record<string, unknown>;
  flow?: unknown[];
  [key: string]: unknown;
}

export interface AutomationConfig {
  schemaVersion: number;
  updatedAt?: string;
  backend?: { baseUrl?: string; restaurant?: string; [key: string]: unknown };
  platforms: AutomationPlatformConfig[];
  [key: string]: unknown;
}

// One global config shared by all restaurants (dev-only edit).
export const appConfig = {
  get: () => get<AutomationConfig>('/dev/app-config/'),
  save: (doc: AutomationConfig) =>
    request<AutomationConfig>('PUT', '/dev/app-config/', doc),
};

// ─── Dev-only endpoints ───────────────────────────────────────────────────────

export interface DevRestaurant {
  id: number;
  name: string;
  slug: string;
  foodicsBranch?: string;
  printingEnabled?: boolean;
}

export interface DevOrderItem {
  name: string;
  qty: number;
  unitPrice: string;
  notes: string;
  matched: boolean;
}

export interface DevPick {
  item: string;
  qty: number;
  orderPrice: number | null;
  candidates: number;
  chosen: string | null;
  chosenPrice: number | null;
  byPrice: boolean;
  ok: boolean;
}

export interface DevPushMeta {
  method: string;
  ok: boolean;
  picks: DevPick[];
}

export interface DevOrder {
  id: number;
  externalId: string;
  platform: string | null;
  restaurant: string;
  status: string;
  customerName: string;
  total: string;
  posExternalId: string;
  posError: string;
  createdAt: string;
  items: DevOrderItem[];
  rawText: string;
  pushMeta: DevPushMeta | null;
}

export interface DevRejection {
  id: number;
  externalId: string;
  platform: string;
  restaurant: string;
  reason: string;
  items: string[];
  rawText: string;
  createdAt: string;
}

/** An error that happened on a device (Android app / ADB runner), uploaded by it. */
export interface DevDeviceLog {
  id: number;
  restaurant: string;
  restaurantName: string;
  source: 'app' | 'adb';
  deviceId: string;
  deviceModel: string;
  osVersion: string;
  appVersion: string;
  /** The config task that was running, e.g. "toters" or "toters_menu". */
  platform: string;
  kind: string;
  message: string;
  /** Engine log lines that led up to the error, oldest first. */
  context: string[];
  screenPackage: string;
  screenTexts: string[];
  /** Times the device saw this same error before reporting it again. */
  count: number;
  occurredAt: string;
}

export interface DevParseResult {
  parsed: boolean;
  detail?: string;
  draft?: {
    externalId?: string;
    customerName?: string;
    total?: number;
    items?: { name: string; qty: number; unitPrice?: number; notes?: string }[];
  };
  matched?: string[];
  unmatched?: string[];
  itemResults?: {
    parsedName: string;
    qty: number;
    matched: boolean;
    menuName?: string;
    posCategory?: string;
    categorySource?: 'per-app' | 'item' | 'default';
  }[];
  matchError?: string;
}

export const devApi = {
  restaurants: () => get<DevRestaurant[]>('/dev/restaurants/'),
  setPrinting: (slug: string, enabled: boolean) =>
    patch<DevRestaurant>(`/dev/restaurants/${slug}/printing/`, { enabled }),
  orders: (params: { platform?: string; problems?: boolean; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.platform) q.set('platform', params.platform);
    if (params.problems) q.set('problems', '1');
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return get<DevOrder[]>(`/dev/orders/${qs ? `?${qs}` : ''}`);
  },
  rejections: (platform?: string) =>
    get<DevRejection[]>(`/dev/rejections/${platform ? `?platform=${platform}` : ''}`),
  deviceLogs: (params: { restaurant?: string; source?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.restaurant) q.set('restaurant', params.restaurant);
    if (params.source) q.set('source', params.source);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return get<DevDeviceLog[]>(`/dev/device-logs/${qs ? `?${qs}` : ''}`);
  },
  parsePreview: (body: { platform: string; rawText: string; restaurant?: string }) =>
    post<DevParseResult>('/dev/parse-preview/', body),
};

// ─── Printers (local printing) ──────────────────────────────────────────────────

export type PrinterRole = 'station' | 'cashier';

export interface ApiPrinter {
  id: number;
  name: string;
  ip: string;
  port: number;
  paperWidth: number;
  role: PrinterRole;
  active: boolean;
}

export interface ApiPrinterInput {
  name: string;
  ip: string;
  port?: number;
  paperWidth?: number;
  role?: PrinterRole;
  active?: boolean;
}

export interface ApiRoutingItem {
  id: number;
  name: string;
  category: string;
  printerId: number | null;
}

export const printersApi = {
  list: () => get<ApiPrinter[]>('/printers/'),
  create: (data: ApiPrinterInput) => post<ApiPrinter>('/printers/', data),
  update: (id: number, data: Partial<ApiPrinterInput>) =>
    patch<ApiPrinter>(`/printers/${id}/`, data),
  remove: (id: number) => remove<void>(`/printers/${id}/`),
  routing: () => get<ApiRoutingItem[]>('/printers/routing/'),
  setRoute: (itemId: number, printerId: number | null) =>
    post<{ id: number; printerId: number | null }>('/printers/routing/', { itemId, printerId }),
  setRouteBulk: (itemIds: number[], printerId: number | null) =>
    post<{ updated: number }>('/printers/routing/bulk/', { itemIds, printerId }),
};
