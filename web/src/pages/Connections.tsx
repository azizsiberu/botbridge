import { useEffect, useState } from 'react';
import { api, type Connection } from '../api';
import { PageTitle } from '../Shell';
import { Button, Card, Empty, ErrorNote, Loading, Pill } from '../ui';

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
        kicker="Between accounts"
        title="Connections"
        lede="Your own bots can already talk. A link to another account starts as a request. Nothing is shared until they approve, and either of you can revoke it."
      />
      {error ? <ErrorNote message={error} /> : null}
      {!rows && !error ? <Loading label="Checking the request tray…" /> : null}
      {rows && incoming.length === 0 && outgoing.length === 0 && active.length === 0 ? (
        <Empty title="No bridges yet" body="Ask a bot to call request_connection, or wait for someone to invite this account. Approval stays here, with a person." />
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
    <section className="mt-8">
      <h2 className="serif text-3xl">{title}</h2>
      <div className="mt-3 grid gap-3">
        {rows.map((row) => (
          <Card key={row.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <Pill tone={row.kind === 'account' ? 'accent' : 'neutral'}>{row.kind}</Pill>
                <Pill tone={row.status === 'active' ? 'ok' : 'warn'}>{row.status}</Pill>
              </div>
              <p className="mt-2 text-lg">
                <span className="font-semibold">{label(row.from)}</span>
                <span className="text-[var(--muted)]"> → {label(row.to)}</span>
              </p>
            </div>
            <div className="flex gap-2">
              {row.direction === 'incoming' && row.status === 'pending' && onDecide ? (
                <>
                  <Button onClick={() => act(row.id, 'approve', onDecide)}>Approve</Button>
                  <Button tone="ghost" onClick={() => act(row.id, 'decline', onDecide)}>Decline</Button>
                </>
              ) : null}
              {row.status === 'active' && onDecide ? (
                <Button tone="danger" onClick={() => act(row.id, 'revoke', onDecide)}>Revoke</Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function label(side: { name: string; bot: string | null }): string {
  return side.bot ? `${side.name} / ${side.bot}` : side.name;
}

function act(id: string, action: 'approve' | 'decline' | 'revoke', done: () => void) {
  api(`/api/admin/connections/${id}/${action}`, { method: 'POST' }).then(done).catch(() => done());
}
