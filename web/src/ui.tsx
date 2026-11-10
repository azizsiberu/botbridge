import { useState, type ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] shadow-[var(--shadow)]', className)}>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium tracking-[0.14em] text-[var(--muted)] uppercase">{label}</p>
      <p className="serif mt-2 text-4xl leading-none">{value}</p>
      {hint ? <p className="mt-2 text-sm text-[var(--muted)]">{hint}</p> : null}
    </Card>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' }) {
  const tones = {
    neutral: 'bg-[var(--bg-3)] text-[var(--ink)]',
    ok: 'bg-[color-mix(in_oklab,var(--ok)_18%,transparent)] text-[var(--ok)]',
    warn: 'bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] text-[var(--warn)]',
    danger: 'bg-[color-mix(in_oklab,var(--danger)_16%,transparent)] text-[var(--danger)]',
    accent: 'bg-[var(--chip)] text-[var(--accent)]',
  };
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function Button({
  children,
  tone = 'primary',
  type = 'button',
  disabled,
  onClick,
}: {
  children: ReactNode;
  tone?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
}) {
  const tones = {
    primary: 'bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-105',
    ghost: 'border border-[var(--line)] bg-transparent text-[var(--ink)] hover:bg-[var(--bg-3)]',
    danger: 'bg-transparent text-[var(--danger)] border border-[color-mix(in_oklab,var(--danger)_40%,var(--line))]',
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cx('rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-50', tones[tone])}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

export const control =
  'w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      tone="ghost"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center">
      <p className="serif text-2xl">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">{body}</p>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <p className="rounded-xl bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] px-3 py-2 text-sm text-[var(--danger)]">{message}</p>;
}

export function time(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
