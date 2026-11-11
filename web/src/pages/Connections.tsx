import { useEffect, useState } from 'react';
import { api, type Connection, type Grant } from '../api';
import { Button, Empty, ErrorNote, FeedItem, FeedList, Loading, PageTitle, Status, time } from '../ui';
import { PendingBotRequests, PendingOAuthClients } from './PendingOAuth';

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
        lede="Your own bots can already talk. A link to another account starts as a request. Nothing is shared until they approve, and either of you can revoke it. An account link covers the bots both accounts have when it is approved; a bot added later needs its own bot link."
      />
      {error ? <ErrorNote message={error} /> : null}
      <PendingBotRequests onChange={load} />
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
      <FeedList label="OAuth clients">
        {grants.map((grant) => (
          <FeedItem
            key={grant.id}
            name={grant.bot.name}
            title={grant.label || grant.client_id}
            when={<time dateTime={grant.created_at}>{time(grant.created_at)}</time>}
            detail={`Uses ${grant.bot.name}${grant.origin_name ? ` · ${grant.origin_name}` : ''}`}
            actions={
              <>
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
              </>
            }
          />
        ))}
      </FeedList>
    </section>
  );
}

function Section({ title, rows, onDecide }: { title: string; rows: Connection[]; onDecide?: () => void }) {
  if (rows.length === 0) return null;
  return (
    <section className="section">
      <h2>{title}</h2>
      <FeedList label={title}>
        {rows.map((row) => (
          <FeedItem
            key={row.id}
            name={row.from.name}
            title={`${label(row.from)} → ${label(row.to)}`}
            detail={row.kind}
            meta={<Status tone={row.status === 'active' ? 'ok' : 'warn'}>{row.status}</Status>}
            actions={
              row.direction === 'incoming' && row.status === 'pending' && onDecide ? (
                <>
                  <Button onClick={() => act(row.id, 'approve', onDecide)}>Approve</Button>
                  <Button tone="secondary" onClick={() => act(row.id, 'decline', onDecide)}>Decline</Button>
                </>
              ) : row.status === 'active' && onDecide ? (
                <Button tone="danger" onClick={() => act(row.id, 'revoke', onDecide)}>Revoke</Button>
              ) : undefined
            }
          />
        ))}
      </FeedList>
    </section>
  );
}

function label(side: { name: string; bot: string | null }): string {
  return side.bot ? `${side.name} / ${side.bot}` : side.name;
}

function act(id: string, action: 'approve' | 'decline' | 'revoke', done: () => void) {
  api(`/api/admin/connections/${id}/${action}`, { method: 'POST' }).then(done).catch(() => done());
}
