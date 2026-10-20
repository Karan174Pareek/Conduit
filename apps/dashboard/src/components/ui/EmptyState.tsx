import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-lg border border-dashed border-border bg-card/40 my-4">
      {icon && (
        <div className="p-3 mb-4 rounded-full bg-elevated text-txt-secondary flex items-center justify-center">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-txt-primary">{title}</h3>
      <p className="mt-1 text-sm text-txt-secondary max-w-sm">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
