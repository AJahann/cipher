import * as React from 'react';

export type ButtonVariant = 'default' | 'ghost' | 'danger';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  isLoading?: boolean;
  loadingText?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    'bg-[var(--cipher-accent)] hover:bg-[var(--cipher-accent-hover)] text-white border-transparent',
  ghost:
    'bg-transparent border-[var(--cipher-border)] text-[var(--cipher-muted)] hover:border-[var(--cipher-border-hi)] hover:text-[var(--cipher-text)]',
  danger:
    'bg-transparent border-[var(--cipher-danger)] text-[var(--cipher-danger)] hover:bg-[var(--cipher-danger)] hover:text-white',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'default',
      isLoading = false,
      loadingText,
      disabled,
      children,
      className = '',
      ...props
    },
    ref,
  ) => {
    return (
      <button
        type='button'
        ref={ref}
        disabled={disabled || isLoading}
        className={[
          'flex w-full items-center justify-center gap-2',
          'rounded-(--cipher-radius-md) border px-4 py-2.5',
          'font-[var(--cipher-font-sans)] text-[13px]',
          'transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed',
          variantClasses[variant],
          className,
        ].join(' ')}
        {...props}
      >
        {isLoading ? (loadingText ?? 'please wait...') : children}
      </button>
    );
  },
);

Button.displayName = 'Button';
