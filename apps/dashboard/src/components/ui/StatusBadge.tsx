import React from 'react';
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  XCircleIcon,
  InfoIcon,
  ShieldIcon,
  UsersIcon,
} from './Icons';

export type StatusType =
  | 'healthy'
  | 'connected'
  | 'degraded'
  | 'unreachable'
  | 'pending'
  | 'approved'
  | 'changed'
  | 'active'
  | 'revoked'
  | 'disabled'
  | 'admin'
  | 'member'
  | 'success'
  | 'error'
  | 'warning'
  | 'info';

export interface StatusBadgeProps {
  status: StatusType | string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
  const norm = status.toLowerCase();

  let style = 'bg-status-info-bg text-status-info-text border-status-info-border';
  let icon: React.ReactNode = <InfoIcon className="w-3.5 h-3.5" />;
  const text = label || status;

  switch (norm) {
    case 'healthy':
    case 'connected':
    case 'approved':
    case 'active':
    case 'success':
      style = 'bg-status-success-bg text-status-success-text border-status-success-border';
      icon = <CheckCircleIcon className="w-3.5 h-3.5" />;
      break;

    case 'degraded':
    case 'pending':
    case 'changed':
    case 'warning':
      style = 'bg-status-warning-bg text-status-warning-text border-status-warning-border';
      icon = <AlertTriangleIcon className="w-3.5 h-3.5" />;
      break;

    case 'unreachable':
    case 'revoked':
    case 'disabled':
    case 'error':
      style = 'bg-status-error-bg text-status-error-text border-status-error-border';
      icon = <XCircleIcon className="w-3.5 h-3.5" />;
      break;

    case 'admin':
      style = 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30';
      icon = <ShieldIcon className="w-3.5 h-3.5" />;
      break;

    case 'member':
      style = 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30';
      icon = <UsersIcon className="w-3.5 h-3.5" />;
      break;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${style} ${className}`}
    >
      {icon}
      <span>{text}</span>
    </span>
  );
}
