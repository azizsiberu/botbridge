import { useEffect, useState } from 'react';
import { api, type Connection, type Grant } from '../api';
import { Button, DataTable, Empty, ErrorNote, Loading, PageTitle, Status, time } from '../ui';
import { PendingOAuthClients } from './PendingOAuth';

export function ConnectionsPage() {
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [grants, setGrants] = useState<Grant[] | null>(null);

  function load() {
    api<{ connections: Connection[] }>('/api/admin/connections')
      .then((body) => setRows(body.connections))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
    api<{ grants: Grant[] }>('/api/admin/grants')
      .then((body) => setGrants(body.grants.filter((grant) => !grant.revoked_at)))
      .catch(() => setGrants([]));
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
      <PendingOAuthClients presentation="section" onLoaded={setWaiting} />
      <OAuthGrants grants={grants} onRevoke={load} onError={setError} />
      {!rows && !error ? <Loading label="Loading connections." /> : null}
      {rows && waiting === 0 && incoming.length === 0 && outgoing.length === 0 && active.length === 0 ? (
        <Empty title="No connections" body="Ask a bot to call request_connection, or wait for someone to invite this account. Approval stays here, with a person." />
      ) : null}
      <Section title="Waiting for you" rows={incoming} onDecide={load} />
      <Section title="You asked" rows={outgoing} />
      <Section title="Open links" rows={active} onDecide={load} />
    </div>
  );
}

function OAuthGrants({ grants, onRevoke, onError }: { grants: Grant[] | null; onRevoke: () => void; onError: (message: string) => void }) {
  if (!grants || grants.length === 0) return null;
  return (
    <section className="section">
      <h2>Signed-in clients</h2>
      <p className="lede">Each OAuth client is a bot. Bind it to a different bot when the automatic one is the wrong mailbox.</p>
      <DataTable label="OAuth clients">
        <thead>
          <tr><th>Client</th><th>Bot</th><th>Origin</th><th>Since</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {grants.map((grant) => (
            <tr key={grant.id}>
              <td>{grant.label || grant.client_id}</td>
              <td>{grant.bot.name}</td>
              <td>{grant.origin_name ?? '—'}</td>
              <td>{time(grant.created_at)}</td>
              <td>
                <div className="button-row">
                  <Button to={`/oauth/choose?${new URLSearchParams({ client_id: grant.client_id, grant_id: grant.id }).toString()}`}>
                    Use a different bot
                  </Button>
                  <Button
                    tone="danger"
                    onClick={() => {
                      api(`/api/admin/grants/${grant.id}/revoke`, { method: 'POST' })
                        .then(onRevoke)
                        .catch((err: unknown) => onError(err instanceof Error ? err.message : 'Failed'));
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </section>
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
