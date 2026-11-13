import { useEffect, useState } from 'react';
import { api, type AuditEntry } from '../api';
import { Empty, ErrorNote, FeedItem, FeedList, Loading, PageTitle, control, time } from '../ui';

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
      <PageTitle title="Audit" lede="Sends, tasks, token rotations, and doorbell tests." />
      <div className="filters cols-2">
        <input className={control} aria-label="Action" placeholder="Action, for example message.sent" value={action} onChange={(event) => setAction(event.target.value)} />
        <input className={control} aria-label="Bot name" placeholder="Bot name" value={actor} onChange={(event) => setActor(event.target.value)} />
      </div>
      {!entries && !error ? <Loading label="Loading audit log." /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {entries?.length === 0 ? <Empty title="No audit entries" body="Sends, tasks, token rotations, and doorbell tests are written here." /> : null}
      {entries && entries.length > 0 ? (
        <FeedList label="Audit log">
          {entries.map((entry) => (
            <FeedItem
              key={entry.id}
              name={entry.actor_name ?? 'system'}
              title={entry.action}
              when={<time dateTime={entry.created_at}>{time(entry.created_at)}</time>}
              detail={entry.target_name ? `${entry.target_name} · ${entry.resource_type}` : entry.resource_type}
            />
          ))}
        </FeedList>
      ) : null}
    </div>
  );
}
