import type { ReactNode, MouseEvent } from 'react';
import { cn } from '../../lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary:   'bg-primary-gradient text-white shadow-lg shadow-primary/20 hover:brightness-110',
  secondary: 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest',
  tertiary:  'border border-primary text-primary hover:bg-primary/5',
  ghost:     'hover:bg-surface-container-low text-on-surface-variant',
  danger:    'bg-tertiary text-white hover:brightness-110 shadow-lg shadow-tertiary/20',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-base',
  lg: 'px-10 py-5 text-lg',
};

interface ButtonProps {
  children?: ReactNode;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}

export const Button = ({
  children,
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    className={cn(
      'rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2',
      variants[variant],
      sizes[size],
      className
    )}
    {...rest}
  >
    {children}
  </button>
);
