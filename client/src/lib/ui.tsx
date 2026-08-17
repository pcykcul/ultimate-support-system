/** Shared UI primitives — keep every module visually consistent. */
import React from 'react';
import { Link } from 'react-router-dom';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const styles = {
    primary: 'bg-brand text-brand-fg hover:opacity-90',
    secondary: 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }[variant];
  return (
    <button
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        styles,
        className
      )}
      {...props}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand',
        props.className
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand',
        props.className
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        'rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/40',
        props.className
      )}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('bg-white rounded-xl border border-gray-200 shadow-sm', className)}
      {...props}
    />
  );
}

export function Badge({
  color = 'gray',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  color?: 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'brand';
}) {
  const styles = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-800',
    red: 'bg-red-100 text-red-700',
    purple: 'bg-purple-100 text-purple-700',
    brand: 'bg-brand-soft text-brand',
  }[color];
  return (
    <span
      className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', styles, className)}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={cx('bg-white rounded-xl shadow-xl w-full p-5 max-h-[85vh] overflow-y-auto', wide ? 'max-w-3xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="text-gray-400 hover:text-gray-600 text-xl leading-none" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-12 text-gray-500">
      <p className="font-medium text-gray-700">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function timeAgo(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  const min = Math.floor(abs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ${suffix}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${suffix}`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ${suffix}`;
  return d.toLocaleDateString();
}

export function Countdown({ due }: { due: string | null | undefined }) {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const t = setInterval(force, 30_000);
    return () => clearInterval(t);
  }, []);
  if (!due) return null;
  const ms = new Date(due).getTime() - Date.now();
  const overdue = ms < 0;
  const min = Math.floor(Math.abs(ms) / 60000);
  const label =
    min < 60 ? `${min}m` : min < 60 * 24 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${Math.floor(min / 1440)}d`;
  return (
    <Badge color={overdue ? 'red' : ms < 30 * 60000 ? 'yellow' : 'green'}>
      {overdue ? `${label} overdue` : `${label} left`}
    </Badge>
  );
}

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="text-sm text-gray-500 hover:text-gray-800">
      ← {label}
    </Link>
  );
}
