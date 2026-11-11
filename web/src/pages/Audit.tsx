import { useEffect, useState } from 'react';
import { api, type AuditEntry } from '../api';
import { DataTable, Empty, ErrorNote, PageTitle, control, time } from '../ui';

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
      {error ? <ErrorNote message={error} /> : null}
      {entries?.length === 0 ? <Empty title="No audit entries" body="Sends, tasks, token rotations, and doorbell tests are written here." /> : null}
      {entries && entries.length > 0 ? (
        <DataTable label="Audit log">
          <thead>
            <tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>Resource</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{time(entry.created_at)}</td>
                <td>{entry.action}</td>
                <td>{entry.actor_name ?? 'system'}</td>
                <td>{entry.target_name ?? '—'}</td>
                <td>{entry.resource_type}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}
    </div>
  );
}
