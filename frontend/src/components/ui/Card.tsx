import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  key?: number | string;
}

export const Card = ({ children, className, hover = true }: CardProps) => (
  <div
    className={cn(
      'bg-surface-container-lowest rounded-xl p-6 transition-all duration-300',
      hover && 'hover:translate-y-[-4px] hover:shadow-xl hover:shadow-on-surface/5',
      className
    )}
  >
    {children}
  </div>
);
