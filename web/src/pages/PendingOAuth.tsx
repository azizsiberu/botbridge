import { useEffect, useState } from 'react';
import { api, type PendingOAuthClient } from '../api';
import { Button, Card, Pill, time } from '../ui';

export function PendingOAuthClients({
  presentation = 'banner',
  onLoaded,
}: {
  presentation?: 'banner' | 'section';
  onLoaded?: (count: number) => void;
}) {
  const [clients, setClients] = useState<PendingOAuthClient[] | null>(null);

  useEffect(() => {
    let cancel = false;
    api<{ clients: PendingOAuthClient[] }>('/api/admin/oauth/pending')
      .then((body) => {
        if (cancel) return;
        setClients(body.clients);
        onLoaded?.(body.clients.length);
      })
      .catch(() => {
        if (cancel) return;
        setClients([]);
        onLoaded?.(0);
      });
    return () => {
      cancel = true;
    };
  }, [onLoaded]);

  if (!clients || clients.length === 0) return null;

  const rows = clients.map((client) => <ClientRow key={client.client_id} client={client} />);
  if (presentation === 'section') {
    return (
      <section className="mt-8">
        <h2 className="serif text-3xl">Waiting for a bot</h2>
        <div className="mt-3 grid gap-3">{rows}</div>
      </section>
    );
  }
  return (
    <div className="mb-4 grid gap-3" role="status">
      {rows}
    </div>
  );
}

function ClientRow({ client }: { client: PendingOAuthClient }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Pill tone="warn">OAuth</Pill>
          <p className="font-semibold">{client.name}</p>
        </div>
        {client.name !== client.client_id ? <p className="mt-2 break-all text-xs text-[var(--muted)]">{client.client_id}</p> : null}
        <p className="mt-2 text-sm text-[var(--muted)]">Tried {time(client.last_seen_at)}. Pick the bot it should use.</p>
      </div>
      <Button to={chooseBotPath(client.client_id)}>Choose bot</Button>
    </Card>
  );
}

function chooseBotPath(clientId: string): string {
  return `/oauth/choose?${new URLSearchParams({ client_id: clientId }).toString()}`;
}
