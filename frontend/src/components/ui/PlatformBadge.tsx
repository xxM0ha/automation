import { getPlatform } from '../../data/platforms';
import { cn } from '../../lib/utils';

interface PlatformBadgeProps {
  platformId: string;
  /** 'icon' = square logo only | 'full' = logo + name | 'name' = name only */
  variant?: 'icon' | 'full' | 'name';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: { wrap: 'w-7 h-7', img: 'w-5 h-5', text: 'text-xs' },
  md: { wrap: 'w-9 h-9', img: 'w-6 h-6', text: 'text-sm' },
  lg: { wrap: 'w-12 h-12', img: 'w-8 h-8', text: 'text-base' },
};

export const PlatformBadge = ({
  platformId,
  variant = 'full',
  size = 'md',
  className,
}: PlatformBadgeProps) => {
  const platform = getPlatform(platformId);
  const s = sizes[size];

  if (variant === 'icon') {
    return (
      <div
        className={cn(
          'rounded-xl flex items-center justify-center bg-white border border-slate-100 shadow-sm overflow-hidden p-1 shrink-0',
          s.wrap,
          className
        )}
        title={platform.name}
      >
        <img src={platform.logo} alt={platform.nameEn} className={cn(s.img, 'object-contain')} />
      </div>
    );
  }

  if (variant === 'name') {
    return (
      <span className={cn('font-semibold text-slate-700', s.text, className)}>
        {platform.name}
      </span>
    );
  }

  // full: icon + name
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'rounded-xl flex items-center justify-center bg-white border border-slate-100 shadow-sm overflow-hidden p-1 shrink-0',
          s.wrap
        )}
      >
        <img src={platform.logo} alt={platform.nameEn} className={cn(s.img, 'object-contain')} />
      </div>
      <span className={cn('font-semibold text-slate-700', s.text)}>{platform.name}</span>
    </div>
  );
};
