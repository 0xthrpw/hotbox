import clsx from 'clsx';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-(--color-muted) mb-1 flex items-center justify-between">
        <span>{label}</span>
        {hint && <span className="text-(--color-muted) opacity-70">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Input(props: ComponentPropsWithoutRef<'input'>) {
  return (
    <input
      {...props}
      className={clsx(
        'w-full px-2 py-1.5 bg-(--color-bg) border border-(--color-border) rounded text-sm',
        'focus:outline-none focus:border-(--color-accent)',
        'mono',
        props.className,
      )}
    />
  );
}

export function Select(props: ComponentPropsWithoutRef<'select'>) {
  return (
    <select
      {...props}
      className={clsx(
        'w-full px-2 py-1.5 bg-(--color-bg) border border-(--color-border) rounded text-sm',
        'focus:outline-none focus:border-(--color-accent)',
        props.className,
      )}
    />
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  variant = 'primary',
  className,
  ...rest
}: ComponentPropsWithoutRef<'button'> & { variant?: ButtonVariant }) {
  const variantClass: Record<ButtonVariant, string> = {
    primary: 'bg-(--color-accent) text-white hover:opacity-90',
    secondary: 'bg-(--color-surface-2) text-(--color-text) hover:bg-(--color-border)',
    danger: 'bg-(--color-error) text-white hover:opacity-90',
  };
  return (
    <button
      {...rest}
      className={clsx(
        'px-3 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed',
        variantClass[variant],
        className,
      )}
    />
  );
}

export function Callout({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const cls = tone === 'error'
    ? 'border-(--color-error) text-(--color-error)'
    : tone === 'warn'
      ? 'border-(--color-warn) text-(--color-warn)'
      : 'border-(--color-border) text-(--color-muted)';
  return <div className={clsx('border rounded p-3 text-sm', cls)}>{children}</div>;
}
