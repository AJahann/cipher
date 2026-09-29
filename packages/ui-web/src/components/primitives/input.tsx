import * as React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      className = '',
      id,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const inputId =
      id ?? label?.toLowerCase().replace(/\s+/g, '-') ?? generatedId;
    const errorId = `${inputId}-error`;
    const describedBy = [ariaDescribedBy, error ? errorId : null]
      .filter(Boolean)
      .join(' ');

    return (
      <div className='flex flex-col gap-1.5'>
        {label && (
          <label
            htmlFor={inputId}
            className='font-(--cipher-font-mono) text-[10px] uppercase tracking-[0.08em] text-(--cipher-muted)'
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          className={[
            'w-full rounded-(--cipher-radius-md) border bg-(--cipher-surface-2) px-3 py-2.5',
            'font-(--cipher-font-sans) text-[13px] text-(--cipher-text)',
            'placeholder:text-(--cipher-muted) outline-none transition-colors duration-150',
            'focus-visible:ring-2 focus-visible:ring-(--cipher-accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--cipher-bg)',
            error
              ? 'border-(--cipher-danger) focus:border-(--cipher-danger)'
              : 'border-(--cipher-border) focus:border-(--cipher-accent-dim)',
            className,
          ].join(' ')}
          {...props}
        />
        {error && (
          <p
            id={errorId}
            className='font-(--cipher-font-mono) text-[11px] text-(--cipher-danger)'
          >
            {error}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
