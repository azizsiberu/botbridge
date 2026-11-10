import { useEffect, useState } from 'react';
import { api, type AuditEntry } from '../api';
import { PageTitle } from '../Shell';
import { Card, Empty, ErrorNote, control, time } from '../ui';

export function AuditPage() {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (actor) params.set('actor', actor);
    api<{ entries: AuditEntry[] }>(`/api/admin/audit?${params}`)
      .then((body) => setEntries(body.entries))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }, [action, actor]);

  return (
    <div>
      <PageTitle kicker="Ledger" title="Audit log" />
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={control} placeholder="Action, e.g. message.sent" value={action} onChange={(event) => setAction(event.target.value)} />
        <input className={control} placeholder="Bot name" value={actor} onChange={(event) => setActor(event.target.value)} />
      </div>
      {error ? <div className="mt-4"><ErrorNote message={error} /></div> : null}
      <Card className="mt-4 overflow-hidden">
        {entries?.length === 0 ? <div className="p-4"><Empty title="Nothing recorded" body="Sends, tasks, token rotations, and doorbell tests are written here." /></div> : null}
        <ul>
          {entries?.map((entry) => (
            <li key={entry.id} className="grid gap-1 border-t border-[var(--line)] px-4 py-3 text-sm md:grid-cols-[180px_1fr_160px]">
              <span className="font-medium">{entry.action}</span>
              <span className="text-[var(--muted)]">
                {entry.actor_name ?? 'system'}
                {entry.target_name ? ` → ${entry.target_name}` : ''}
                {entry.resource_id ? ` · ${entry.resource_type}` : ''}
              </span>
              <time className="text-[var(--muted)] md:text-right">{time(entry.created_at)}</time>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
