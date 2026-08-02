// Central config for all delivery platforms

export interface Platform {
  id: string;
  name: string;     // Arabic display name
  nameEn: string;   // English / internal key
  logo: string;     // resolved URL to SVG (via Vite ?url import)
  bgColor: string;  // Tailwind bg fallback
  textColor: string;
  hex: string;      // brand hex for charts
}

import totersLogo  from '../assets/logos/toters.svg?url';
import tiptopLogo  from '../assets/logos/tiptop.svg?url';
import talabatLogo from '../assets/logos/talabat.svg?url';
import talabatyLogo from '../assets/logos/talabaty.svg?url';
import yammakLogo  from '../assets/logos/yammak.svg?url';
import lezzoLogo   from '../assets/logos/lezzo.svg?url';
import balyLogo    from '../assets/logos/baly.svg?url';

export const PLATFORMS: Platform[] = [
  {
    id: 'toters',
    name: 'توترز',
    nameEn: 'Toters',
    logo: totersLogo,
    bgColor: 'bg-blue-600',
    textColor: 'text-white',
    hex: '#2563EB',
  },
  {
    id: 'tiptop',
    name: 'تيب توب',
    nameEn: 'TipTop',
    logo: tiptopLogo,
    bgColor: 'bg-yellow-400',
    textColor: 'text-slate-900',
    hex: '#FEC63B',
  },
  {
    id: 'talabat',
    name: 'طلبات',
    nameEn: 'Talabat',
    logo: talabatLogo,
    bgColor: 'bg-orange-500',
    textColor: 'text-white',
    hex: '#FF5900',
  },
  {
    id: 'talabaty',
    name: 'طلباتي',
    nameEn: 'Talabaty',
    logo: talabatyLogo,
    bgColor: 'bg-green-500',
    textColor: 'text-white',
    hex: '#22C55E',
  },
  {
    id: 'yammak',
    name: 'يمّاك',
    nameEn: 'Yammak',
    logo: yammakLogo,
    bgColor: 'bg-red-500',
    textColor: 'text-white',
    hex: '#EF4444',
  },
  {
    id: 'lezzo',
    name: 'ليزو',
    nameEn: 'Lezzo',
    logo: lezzoLogo,
    bgColor: 'bg-purple-500',
    textColor: 'text-white',
    hex: '#A855F7',
  },
  {
    id: 'baly',
    name: 'بالي فود',
    nameEn: 'Baly Food',
    logo: balyLogo,
    bgColor: 'bg-pink-500',
    textColor: 'text-white',
    hex: '#EC4899',
  },
];

export const getPlatform = (id: string): Platform =>
  PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0];
