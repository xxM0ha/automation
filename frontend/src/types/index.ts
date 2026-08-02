export type Page = 'landing' | 'login' | 'register' | 'dashboard' | 'orders' | 'menu' | 'reports' | 'apps' | 'automation' | 'developer' | 'printers' | 'branches' | 'notifications';
export type Role = 'admin' | 'kitchen';

export interface LiveActivityItem {
  id: number;
  title: string;
  description: string;
  time: string;
  status: string;
  type: 'order' | 'delivery' | 'alert' | 'completed';
  platformId: string | null;
}

export interface Order {
  id: string;
  platformId: string;
  time: string;
  relativeTime: string;
  items: string;
  status: 'جديد' | 'مقبول' | 'قيد التحضير' | 'مكتمل';
  total: string;
  customerName: string;
  customerPhone: string;
  address: string;
  notes: string;
}

export interface MenuItem {
  id: number;
  name: string;
  price: string;
  description: string;
  image: string;
  tag?: string;
  status: 'نشط' | 'مخفي';
  category: string;
  categoryId?: number;
  platforms: string[];
  platformNames: Record<string, string>;
  platformAliases: Record<string, string[]>;
  platformPosCategories: Record<string, string>;
}

export interface ChartDataPoint {
  time?: string;
  week?: string;
  orders?: number;
  revenue?: number;
}

export interface OrderSourceItem {
  name: string;
  value: number;
  color: string;
}

export interface Notification {
  id: number;
  title: string;
  body: string;
  time: string;
  read: boolean;
  type: 'order' | 'alert' | 'system';
}
