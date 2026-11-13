import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Avatar } from './social';
export { Modal as Dialog } from './components/Modal';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function PageTitle({ title, lede, action }: { title: string; lede?: ReactNode; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {action ? <div className="actions">{action}</div> : null}
    </div>
  );
}

export function Button({
  children,
  tone = 'primary',
  type = 'button',
  disabled,
  onClick,
  to,
}: {
  children: ReactNode;
  tone?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  to?: string;
}) {
  const className = cx(
    'btn',
    tone === 'primary' ? 'btn-primary' : tone === 'danger' ? 'btn-danger' : 'btn-secondary',
  );
  if (to)
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={className}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const control = 'control';

export function Status({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  children: ReactNode;
}) {
  return <span className={cx('status', `status-${tone}`)}>{children}</span>;
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="copy-control">
      <Button
        tone="secondary"
        onClick={() => {
          clearTimeout(timer.current);
          void navigator.clipboard
            .writeText(value)
            .then(() => {
              setState('copied');
              timer.current = setTimeout(() => setState('idle'), 1400);
            })
            .catch(() => setState('error'));
        }}
      >
        <span aria-live="polite">{state === 'copied' ? 'Copied' : label}</span>
      </Button>
      {state === 'error' && (
        <span role="alert" className="status status-danger">
          Could not copy. Select and copy the text.
        </span>
      )}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{body}</p>
      {action ? <div className="actions">{action}</div> : null}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="loading" aria-busy="true" aria-live="polite">
      {label}
    </p>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="error">
      {message}
    </p>
  );
}

export function DataTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="data" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function FeedList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inbox-list" aria-label={label}>
      {children}
    </div>
  );
}

export function FeedItem({
  to,
  onClick,
  name,
  title,
  detail,
  when,
  meta,
  actions,
  clip = false,
}: {
  to?: string;
  onClick?: () => void;
  name?: string;
  title: ReactNode;
  detail?: ReactNode;
  when?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  clip?: boolean;
}) {
  const content = (
    <>
      {name ? <Avatar name={name} /> : null}
      <div className="post-content">
        <div className="post-byline">
          <strong>{title}</strong>
          {when}
        </div>
        {detail ? <div className={cx('feed-detail', clip && 'clip')}>{detail}</div> : null}
        {meta ? <div className="inbox-meta">{meta}</div> : null}
        {actions ? <div className="button-row feed-actions">{actions}</div> : null}
      </div>
    </>
  );
  if (to)
    return (
      <Link className="inbox-row" to={to}>
        {content}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" className="inbox-row" onClick={onClick}>
        {content}
      </button>
    );
  return <div className="inbox-row">{content}</div>;
}

export function time(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
