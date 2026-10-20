import React from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

export function PageHeader({
  title,
  description,
  action,
  actions,
  breadcrumbs,
}: PageHeaderProps) {
  const headerActions = actions || action;

  return (
    <div className="flex flex-col gap-2 mb-6 pb-4 border-b border-border">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-txt-muted mb-1">
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-txt-muted">/</span>}
              {b.href ? (
                <a href={b.href} className="hover:text-txt-primary transition-colors">
                  {b.label}
                </a>
              ) : (
                <span className={i === breadcrumbs.length - 1 ? 'text-txt-secondary font-medium' : ''}>
                  {b.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-txt-primary">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-txt-secondary">
              {description}
            </p>
          )}
        </div>
        {headerActions && <div className="flex items-center gap-3 shrink-0">{headerActions}</div>}
      </div>
    </div>
  );
}
