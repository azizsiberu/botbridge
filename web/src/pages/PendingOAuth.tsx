import { useEffect, useState } from 'react';
import { api, type PendingOAuthClient } from '../api';
import { Button, DataTable, time } from '../ui';

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

  return (
    <section className="section" role="status" style={presentation === 'banner' ? { marginTop: 0 } : undefined}>
      <h2>Waiting for a bot</h2>
      <DataTable label="OAuth clients waiting for a bot">
        <thead>
          <tr>
            <th>Client</th>
            <th>Client id</th>
            <th>Tried</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.client_id}>
              <td>{client.name}</td>
              <td className="url">{client.client_id}</td>
              <td>{time(client.last_seen_at)}</td>
              <td>
                <Button to={chooseBotPath(client.client_id)}>Choose bot</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </section>
  );
}

function chooseBotPath(clientId: string): string {
  return `/oauth/choose?${new URLSearchParams({ client_id: clientId }).toString()}`;
}
