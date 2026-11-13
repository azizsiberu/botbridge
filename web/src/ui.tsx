import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Avatar } from './social';
import { FormPending } from './components/AsyncForm';
import { Spinner } from './components/Loading';
export { Form } from './components/AsyncForm';
export { Loading, AppLoading } from './components/Loading';
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
  busy = false,
  pendingLabel = 'Working…',
}: {
  children: ReactNode;
  tone?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void | Promise<unknown>;
  to?: string;
  busy?: boolean;
  pendingLabel?: string;
}) {
  const formPending = useContext(FormPending);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const working = busy || pending || (type === 'submit' && formPending);
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
    <>
      <button
        type={type}
        disabled={disabled || working}
        aria-busy={working}
        className={className}
        onClick={
          onClick
            ? async () => {
                if (lock.current) return;
                lock.current = true;
                setError('');
                try {
                  const result = onClick();
                  if (result && typeof result.then === 'function') {
                    setPending(true);
                    await result;
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Action failed. Try again.');
                } finally {
                  lock.current = false;
                  setPending(false);
                }
              }
            : undefined
        }
      >
        {working && <Spinner />}
        {working ? pendingLabel : children}
      </button>
      {error && <ErrorNote message={error} />}
    </>
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
          return Promise.resolve()
            .then(() => navigator.clipboard.writeText(value))
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

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="error">
      <p>{message}</p>
      {onRetry && (
        <Button tone="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
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
