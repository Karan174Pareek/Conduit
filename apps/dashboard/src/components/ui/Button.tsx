import type React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  isLoading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading,
  isLoading,
  fullWidth = false,
  disabled = false,
  icon,
  leftIcon,
  rightIcon,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  const isButtonLoading = Boolean(loading || isLoading);
  const leadingIcon = isButtonLoading ? (
    <svg
      className="animate-spin h-4 w-4 text-current"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  ) : (
    leftIcon || icon
  );

  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-colors select-none rounded-md min-h-[44px] sm:min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none active:scale-[0.98]';

  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 gap-1.5',
    md: 'text-sm px-4 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  }[size];

  const variantStyles = {
    primary:
      'bg-brand text-brand-text hover:bg-brand-hover focus-visible:ring-brand shadow-card',
    secondary:
      'bg-card text-txt-primary border border-border hover:bg-elevated hover:border-border-strong focus-visible:ring-txt-secondary shadow-card',
    outline:
      'bg-transparent text-txt-primary border border-border hover:bg-elevated hover:border-border-strong focus-visible:ring-brand shadow-card',
    danger:
      'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 shadow-card',
    ghost:
      'bg-transparent text-txt-secondary hover:text-txt-primary hover:bg-elevated focus-visible:ring-txt-muted',
  }[variant];

  const widthStyle = fullWidth ? 'w-full' : '';

  return (
    <button
      type={type}
      disabled={disabled || isButtonLoading}
      aria-busy={isButtonLoading}
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${widthStyle} ${className}`}
      {...props}
    >
      {leadingIcon}
      {children && <span>{children}</span>}
      {rightIcon}
    </button>
  );
}
