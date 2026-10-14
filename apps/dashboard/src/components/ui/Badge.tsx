import React from 'react';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple' | 'default';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  success: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  warning: 'bg-amber-950 text-amber-300 border-amber-800',
  danger: 'bg-rose-950 text-rose-300 border-rose-800',
  info: 'bg-sky-950 text-sky-300 border-sky-800',
  neutral: 'bg-slate-800 text-slate-300 border-slate-700',
  default: 'bg-slate-800 text-slate-300 border-slate-700',
  purple: 'bg-purple-950 text-purple-300 border-purple-800',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
  title,
}) => {
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs';
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full font-medium border ${sizeClass} ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
};

export const StatusBadge: React.FC<{ status: any }> = ({ status }) => {
  const statusStr = typeof status === 'object' && status !== null ? (status.state || 'unreachable') : String(status || 'unreachable');
  const variant = statusStr === 'connected' ? 'success' : status === 'disabled' ? 'neutral' : 'danger';
  return (
    <Badge variant={variant} className="capitalize">
      {statusStr}
    </Badge>
  );
};
