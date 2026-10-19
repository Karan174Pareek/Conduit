import React, { useId } from 'react';

export interface FormInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helperText?: string;
  error?: string;
  rightAction?: React.ReactNode;
}

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, helperText, error, rightAction, id: customId, className = '', ...props }, ref) => {
    const generatedId = useId();
    const id = customId || generatedId;
    const helperId = `${id}-helper`;
    const errorId = `${id}-error`;

    const describedBy = [
      error ? errorId : null,
      helperText ? helperId : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    return (
      <div className="w-full space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={id} className="block text-sm font-medium text-txt-primary">
            {label}
            {props.required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
          </label>
          {rightAction}
        </div>

        <div className="relative">
          <input
            ref={ref}
            id={id}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            className={`w-full px-3.5 py-2.5 text-sm bg-surface border rounded-md text-txt-primary placeholder:text-txt-muted transition-colors focus:outline-none focus:ring-2 focus:ring-brand min-h-[44px] sm:min-h-[38px] ${
              error
                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                : 'border-border hover:border-border-strong'
            } ${className}`}
            {...props}
          />
        </div>

        {error ? (
          <p id={errorId} role="alert" className="text-xs font-medium text-red-500">
            {error}
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-xs text-txt-secondary">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);
FormInput.displayName = 'FormInput';

export interface FormSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  helperText?: string;
  error?: string;
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
  children?: React.ReactNode;
}

export const FormSelect = React.forwardRef<HTMLSelectElement, FormSelectProps>(
  ({ label, helperText, error, options, children, id: customId, className = '', ...props }, ref) => {
    const generatedId = useId();
    const id = customId || generatedId;
    const helperId = `${id}-helper`;
    const errorId = `${id}-error`;

    const describedBy = [
      error ? errorId : null,
      helperText ? helperId : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    return (
      <div className="w-full space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium text-txt-primary">
          {label}
          {props.required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
        </label>

        <select
          ref={ref}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`w-full px-3.5 py-2.5 text-sm bg-surface border rounded-md text-txt-primary transition-colors focus:outline-none focus:ring-2 focus:ring-brand min-h-[44px] sm:min-h-[38px] ${
            error
              ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
              : 'border-border hover:border-border-strong'
          } ${className}`}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>

        {error ? (
          <p id={errorId} role="alert" className="text-xs font-medium text-red-500">
            {error}
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-xs text-txt-secondary">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);
FormSelect.displayName = 'FormSelect';
