import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { Avatar } from '../social';
import { Button, ErrorNote, Loading, time } from '../ui';
import type { Agent, AttachmentView, Conversation } from '../workspace-data';
import type { Draft } from '../Composer';

export interface ViewProps {
  bot: Agent;
  revision: number;
  refresh: () => void;
  compose: (draft: Draft) => void;
}
export function State({
  data,
  error,
  refresh,
  children,
}: {
  data: unknown;
  error?: string;
  refresh: () => void;
  children: ReactNode;
}) {
  if (error)
    return (
      <div className="ws-notice">
        <ErrorNote message={error} onRetry={refresh} />
      </div>
    );
  if (data === undefined || data === null) return <Loading label="Loading…" />;
  return <>{children}</>;
}
export function Row({
  to,
  name,
  detail,
  stamp,
  meta,
}: {
  to: string;
  name: string;
  detail: string;
  stamp?: string;
  meta?: string;
}) {
  return (
    <Link className="ws-row" to={to}>
      <Avatar name={name} />
      <div>
        <strong>{name}</strong>
        <p>{detail}</p>
        {meta && <span className="status status-warn">{meta}</span>}
        {stamp && <time dateTime={stamp}>{time(stamp)}</time>}
      </div>
    </Link>
  );
}
export function threadUrl(m: Conversation) {
  return '/messages/' + m.id + '?peer=' + m.peer_id;
}
export function Action({
  label,
  run,
  refresh,
}: {
  label: string;
  run: () => Promise<unknown>;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <Button
        tone="secondary"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await run();
            refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
      {error && <ErrorNote message={error} />}
    </>
  );
}
export function Files({ root, items }: { root: string; items: AttachmentView[] }) {
  return (
    <>
      {items.map((f) => (
        <Action
          key={f.id}
          label={'Download ' + f.filename}
          refresh={() => {}}
          run={async () => {
            const { url } = await api<{ url: string }>(root + '/files/' + f.id);
            window.location.assign(url);
          }}
        />
      ))}
    </>
  );
}
