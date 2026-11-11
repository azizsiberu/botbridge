import { useEffect, useState } from 'react';
import { api, type Connection } from '../api';
import { Button, DataTable, Empty, ErrorNote, Loading, PageTitle, Status } from '../ui';

export function ConnectionsPage() {
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<{ connections: Connection[] }>('/api/admin/connections')
      .then((body) => setRows(body.connections))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }

  useEffect(() => {
    load();
  }, []);

  const incoming = rows?.filter((row) => row.direction === 'incoming' && row.status === 'pending') ?? [];
  const outgoing = rows?.filter((row) => row.direction === 'outgoing' && row.status === 'pending') ?? [];
  const active = rows?.filter((row) => row.status === 'active') ?? [];

  return (
    <div>
      <PageTitle
        title="Connections"
        lede="Your own bots can already talk. A link to another account starts as a request. Nothing is shared until they approve, and either of you can revoke it."
      />
      {error ? <ErrorNote message={error} /> : null}
      {!rows && !error ? <Loading label="Loading connections." /> : null}
      {rows && incoming.length === 0 && outgoing.length === 0 && active.length === 0 ? (
        <Empty title="No connections" body="Ask a bot to call request_connection, or wait for someone to invite this account. Approval stays here, with a person." />
      ) : null}
      <Section title="Waiting for you" rows={incoming} onDecide={load} />
      <Section title="You asked" rows={outgoing} />
      <Section title="Open links" rows={active} onDecide={load} />
    </div>
  );
}

function Section({ title, rows, onDecide }: { title: string; rows: Connection[]; onDecide?: () => void }) {
  if (rows.length === 0) return null;
  return (
    <section className="section">
      <h2>{title}</h2>
      <DataTable label={title}>
        <thead>
          <tr><th>From</th><th>To</th><th>Kind</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{label(row.from)}</td>
              <td>{label(row.to)}</td>
              <td>{row.kind}</td>
              <td><Status tone={row.status === 'active' ? 'ok' : 'warn'}>{row.status}</Status></td>
              <td>
                <div className="button-row">
                  {row.direction === 'incoming' && row.status === 'pending' && onDecide ? (
                    <>
                      <Button onClick={() => act(row.id, 'approve', onDecide)}>Approve</Button>
                      <Button tone="secondary" onClick={() => act(row.id, 'decline', onDecide)}>Decline</Button>
                    </>
                  ) : null}
                  {row.status === 'active' && onDecide ? (
                    <Button tone="danger" onClick={() => act(row.id, 'revoke', onDecide)}>Revoke</Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </section>
  );
}

function label(side: { name: string; bot: string | null }): string {
  return side.bot ? `${side.name} / ${side.bot}` : side.name;
}

function act(id: string, action: 'approve' | 'decline' | 'revoke', done: () => void) {
  api(`/api/admin/connections/${id}/${action}`, { method: 'POST' }).then(done).catch(() => done());
}
