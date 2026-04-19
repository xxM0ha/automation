import type { ChartDataPoint, OrderSourceItem, LiveActivityItem, Order, MenuItem, Notification } from '../types';

// ─── Chart data ──────────────────────────────────────────────────────────────

export const orderVelocityData: ChartDataPoint[] = [
  { time: '00:00', orders: 12 },
  { time: '02:00', orders: 7  },
  { time: '04:00', orders: 4  },
  { time: '06:00', orders: 18 },
  { time: '08:00', orders: 52 },
  { time: '10:00', orders: 78 },
  { time: '12:00', orders: 105 },
  { time: '14:00', orders: 88 },
  { time: '16:00', orders: 63 },
  { time: '18:00', orders: 95 },
  { time: '20:00', orders: 71 },
  { time: '22:00', orders: 34 },
];

export const revenuePerformanceData: ChartDataPoint[] = [
  { week: 'الأسبوع 1', revenue: 42000 },
  { week: 'الأسبوع 2', revenue: 58500 },
  { week: 'الأسبوع 3', revenue: 71200 },
  { week: 'الأسبوع 4', revenue: 64800 },
  { week: 'الأسبوع 5', revenue: 89400 },
  { week: 'الأسبوع 6', revenue: 97600 },
  { week: 'الأسبوع 7', revenue: 83100 },
];

// Uses platform IDs matching PLATFORMS config
export const orderSourceData: OrderSourceItem[] = [
  { name: 'توترز',    value: 24, color: '#2563EB' },
  { name: 'طلبات',   value: 19, color: '#FF5900' },
  { name: 'تيب توب', value: 16, color: '#FEC63B' },
  { name: 'بالي فود',value: 14, color: '#EC4899' },
  { name: 'طلباتي',  value: 12, color: '#22C55E' },
  { name: 'يمّاك',   value: 9,  color: '#EF4444' },
  { name: 'ليزو',    value: 6,  color: '#A855F7' },
];

// ─── Live activity ────────────────────────────────────────────────────────────

export const liveActivity: LiveActivityItem[] = [
  {
    id: 1,
    title: 'طلب #9841 - أحمد الكردي',
    description: '2x برغر واغيو، 1x سلطة كيل',
    time: 'منذ 1 د',
    status: 'قيد التحضير',
    type: 'order',
    platformId: 'toters',
  },
  {
    id: 2,
    title: 'طلب #9838 - سارة حمدان',
    description: '1x سلمون مزجج XL، 2x عصير',
    time: 'منذ 7 د',
    status: 'جاري التوصيل',
    type: 'delivery',
    platformId: 'talabat',
  },
  {
    id: 3,
    title: 'تنبيه مخزون: دقيق',
    description: 'مستوى المخزون أقل من 15% — يرجى إعادة الطلب',
    time: 'منذ 23 د',
    status: 'عاجل',
    type: 'alert',
    platformId: null,
  },
  {
    id: 4,
    title: 'طلب #9831 - محمد رضا',
    description: '3x كربونارا بالكمأ، 1x كولا',
    time: 'منذ 41 د',
    status: 'مكتمل',
    type: 'completed',
    platformId: 'tiptop',
  },
  {
    id: 5,
    title: 'طلب #9829 - ليلى نصر',
    description: '4x وجبات كومبو العائلة',
    time: 'منذ 55 د',
    status: 'مكتمل',
    type: 'completed',
    platformId: 'baly',
  },
];

// ─── Orders ───────────────────────────────────────────────────────────────────

export const orders: Order[] = [
  {
    id: '#ORD-9841',
    platformId: 'toters',
    time: '13:02 م',
    relativeTime: 'منذ 1 دقيقة',
    items: '2x برغر واغيو، 1x سلطة كيل',
    status: 'جديد',
    total: '248.25 ر.س',
    customerName: 'أحمد الكردي',
    customerPhone: '+964 770 123 4567',
    address: 'بغداد، المنصور، شارع 14 رمضان',
    notes: '',
  },
  {
    id: '#ORD-9839',
    platformId: 'talabat',
    time: '12:58 م',
    relativeTime: 'منذ 5 دقائق',
    items: '1x سلمون أطلسي، 2x عصير ليمون',
    status: 'مقبول',
    total: '157.50 ر.س',
    customerName: 'سارة حمدان',
    customerPhone: '+964 771 234 5678',
    address: 'بغداد، الكرادة، شارع فلسطين',
    notes: 'بدون ثوم في الصلصة',
  },
  {
    id: '#ORD-9836',
    platformId: 'tiptop',
    time: '12:44 م',
    relativeTime: 'منذ 19 دقيقة',
    items: '3x كربونارا بالكمأ، 1x كولا',
    status: 'قيد التحضير',
    total: '293.25 ر.س',
    customerName: 'محمد رضا',
    customerPhone: '+964 772 345 6789',
    address: 'بغداد، زيونة، شارع الأميرات',
    notes: '',
  },
  {
    id: '#ORD-9833',
    platformId: 'talabaty',
    time: '12:31 م',
    relativeTime: 'منذ 32 دقيقة',
    items: '2x برغر واغيو، 2x بطاطس مقلية',
    status: 'قيد التحضير',
    total: '189.00 ر.س',
    customerName: 'ليلى نصر',
    customerPhone: '+964 773 456 7890',
    address: 'بغداد، الدورة، شارع المطار',
    notes: 'إضافة صلصة حارة',
  },
  {
    id: '#ORD-9829',
    platformId: 'yammak',
    time: '12:18 م',
    relativeTime: 'منذ 45 دقيقة',
    items: '4x وجبات كومبو، 4x مشروب',
    status: 'مكتمل',
    total: '376.00 ر.س',
    customerName: 'عمر السامرائي',
    customerPhone: '+964 774 567 8901',
    address: 'بغداد، العطيفية، شارع المدارس',
    notes: '',
  },
  {
    id: '#ORD-9825',
    platformId: 'lezzo',
    time: '11:54 ص',
    relativeTime: 'منذ 69 دقيقة',
    items: '1x سلطة كيل سيزر، 1x سلمون',
    status: 'مكتمل',
    total: '150.63 ر.س',
    customerName: 'نور الهاشمي',
    customerPhone: '+964 775 678 9012',
    address: 'بغداد، الجادرية، قرب الجامعة',
    notes: '',
  },
  {
    id: '#ORD-9822',
    platformId: 'baly',
    time: '11:39 ص',
    relativeTime: 'منذ 84 دقيقة',
    items: '5x بيتزا بيبروني كلاسيك',
    status: 'مكتمل',
    total: '412.50 ر.س',
    customerName: 'حسن العبيدي',
    customerPhone: '+964 776 789 0123',
    address: 'بغداد، البياع، شارع الخضراء',
    notes: 'التوصيل للطابق الثالث',
  },
  {
    id: '#ORD-9818',
    platformId: 'toters',
    time: '11:20 ص',
    relativeTime: 'منذ 103 دقيقة',
    items: '2x كربونارا، 1x سلطة',
    status: 'مكتمل',
    total: '213.75 ر.س',
    customerName: 'زينب الجبوري',
    customerPhone: '+964 777 890 1234',
    address: 'بغداد، الوزيرية، شارع الإذاعة',
    notes: '',
  },
];

// ─── Menu items ───────────────────────────────────────────────────────────────

export const menuItems: MenuItem[] = [
  {
    id: 1,
    name: 'سلمون أطلسي مزجج',
    price: '91.88 ر.س',
    description: 'سلمون مزجج بالعسل مع خضروات مشوية وصلصة الليمون والشبت.',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAEnZ7Nj600KmJRwyi-xZrj-pvyYc-_uJNKlpBgBGW-IYy2OH3o9tXlsJHnPgVNAjrbp50IcQALMXnj7eFSI03zswxOPNU1e0P1QZ7a8XoPKclMdKZRmsLuMgfhQZhEzVqK1TiExS4ZmlQ21AHMhrL3s01LcZgJGTWAdR16VGsafFZZsNPQxldmsovM-xty1vBHw_5GeILmUkfM43okHQYkdvGB2hFI8rnaH_0HTVeiyM7ihskM6PjIKRSIuLboIfcxg4AvmQKQFLA',
    tag: 'الأكثر مبيعاً',
    status: 'نشط',
    category: 'الأطباق الرئيسية',
    platforms: ['toters', 'talabat', 'tiptop', 'talabaty', 'yammak', 'lezzo', 'baly'],
  },
  {
    id: 2,
    name: 'برغر واغيو الممتاز',
    price: '67.50 ر.س',
    description: 'لحم واغيو مع صلصة الكمأ والبصل المشوي وجبن بري مزدوج على خبز البريوش.',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDPzwxDyyM72wKfVYSEUMzn5HzyC6cMDOX5x288C6ra4aJM68c8ec2u8UYLxPonUeCnY-9MSbopaZvVmi-gXkqNodEDFErJFVno5Lhe9gxBzlNrGuguYs6PWaWCJlQqxfXJq0Ir074rnj_fxA6m9VSmotChrpbBEgy4Lmmfd0zVDqcswr23nTZOHX3Hsbot4ucaGf2wB_zKjtURLLHGh_8wTJ_lUqxNgyk2DbDpHEsUxLv_p7AAK5lfRmzyTVa3Km9l-WszVmToWzA',
    tag: 'طبق مميز',
    status: 'نشط',
    category: 'الأطباق الرئيسية',
    platforms: ['toters', 'talabat', 'tiptop', 'talabaty', 'baly'],
  },
  {
    id: 3,
    name: 'كربونارا بالكمأ',
    price: '78.75 ر.س',
    description: 'لينغيني محلي الصنع مع كمأ صيفي أسود وجوانشيالي وبارميجيانو معتق 24 شهراً.',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBzeh4XQCY8wH2_JbiPbJNEhadUXeTZtAmGu4Xy8DEg7NBSYOTW4W8c-FknSxwns5BKpHlB85T2Y3skL-0hAYS7ycPj9FJadzLsPcPP8HHJwQ_aw6jaUyKDzOSws2Eni4Dtjz9ejbq8-EK5KxVwlEzM3E1bpq1McDdVyGwtnRRspkE0yc3tgdbrc3X78yTOS3RmvoJyws0HP-dVE5E0AfI496iObklvn25LzjqasXmT9XhQCQjbf-KahMd-s230IXTl03A9R56FSkY',
    tag: 'نفذ',
    status: 'مخفي',
    category: 'الأطباق الرئيسية',
    platforms: ['toters', 'tiptop'],
  },
  {
    id: 4,
    name: 'سلطة كيل سيزر',
    price: '58.13 ر.س',
    description: 'كيل طازج مقرمش مع خبز محمص بإكليل الجبل وصلصة الثوم المشوي وقطع البارميزان.',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAZZbKxp0XMgDQeFqFpfDU2HRLyL9OFYcxX-22F-_nJBGPrTmCBCfo6IY3lf4xXVTFvSkKU1AEbopmLcJnCchVftQgpbLd1qtBN809CyuUhtQCYA5IMlFvyZDXfded-8v5_HQKYcCMVHv8jF6S6uzmdIhrplHMx-05Pvvjc65s9XzkbIz-bhCjzEPpXifOl9PiFKDT1NyPsPgopMhCWImGCUvv5-VkfANozGrUbMENp_I02PZRTbYO6zWqF_-wEUQJ0BalbU8FZqp8',
    status: 'نشط',
    category: 'الأطباق الرئيسية',
    platforms: ['toters', 'talabat', 'tiptop', 'talabaty', 'yammak', 'lezzo', 'baly'],
  },
];

// ─── Notifications ────────────────────────────────────────────────────────────

export const notifications: Notification[] = [
  {
    id: 1,
    title: 'طلب جديد — توترز',
    body: 'طلب #9842 من أحمد م. بقيمة 185 ر.س',
    time: 'منذ لحظة',
    read: false,
    type: 'order',
  },
  {
    id: 2,
    title: 'تنبيه مخزون',
    body: 'صلصة الطماطم أقل من 10% من المخزون',
    time: 'منذ 5 دقائق',
    read: false,
    type: 'alert',
  },
  {
    id: 3,
    title: 'اكتملت المزامنة',
    body: 'تمت مزامنة القائمة مع جميع المنصات بنجاح',
    time: 'منذ 20 دقيقة',
    read: true,
    type: 'system',
  },
  {
    id: 4,
    title: 'طلب جديد — طلبات',
    body: 'طلب #9840 من سارة ح. بقيمة 220 ر.س',
    time: 'منذ 3 دقائق',
    read: false,
    type: 'order',
  },
];

// ─── Reports ──────────────────────────────────────────────────────────────────

export const topSellingItems = [
  { name: 'برغر واغيو الممتاز', units: 428, progress: 85 },
  { name: 'سلمون أطلسي مزجج',  units: 312, progress: 65 },
  { name: 'كربونارا بالكمأ',   units: 295, progress: 60 },
  { name: 'سلطة كيل سيزر',     units: 184, progress: 40 },
  { name: 'وجبة كومبو العائلة', units: 110, progress: 25 },
];

export const dailySummary = [
  { date: '24 أكتوبر 2024', orders: 124, revenue: '46,687 ر.س', status: 'مكتمل' },
  { date: '23 أكتوبر 2024', orders: 98,  revenue: '34,201 ر.س', status: 'مكتمل' },
  { date: '22 أكتوبر 2024', orders: 156, revenue: '68,400 ر.س', status: 'معلق'  },
  { date: '21 أكتوبر 2024', orders: 84,  revenue: '29,587 ر.س', status: 'مكتمل' },
];

// ─── Platform daily breakdown (for reports bar chart) ─────────────────────────

export const platformBreakdown = [
  { platform: 'توترز',    orders: 31, revenue: 14230 },
  { platform: 'طلبات',   orders: 25, revenue: 11500 },
  { platform: 'تيب توب', orders: 21, revenue: 9650  },
  { platform: 'بالي فود',orders: 18, revenue: 8300  },
  { platform: 'طلباتي',  orders: 15, revenue: 6900  },
  { platform: 'يمّاك',   orders: 12, revenue: 5520  },
  { platform: 'ليزو',    orders: 8,  revenue: 3680  },
];
