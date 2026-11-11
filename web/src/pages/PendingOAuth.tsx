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
      <h2>Registration needs attention</h2>
      <p className="lede">These clients signed in and did not get a bot. Connect again, or bind the client to a bot you already have.</p>
      <DataTable label="OAuth clients that did not register">
        <thead>
          <tr>
            <th>Client</th>
            <th>Client id</th>
            <th>Tried</th>
            <th>What happened</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.client_id}>
              <td>{client.name}</td>
              <td className="url">{client.client_id}</td>
              <td>{time(client.last_seen_at)}</td>
              <td>{client.last_error ?? 'Connect the client again to register it.'}</td>
              <td>
                <Button to={bindPath(client.client_id)}>Bind to an existing bot</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </section>
  );
}

function bindPath(clientId: string): string {
  return `/oauth/choose?${new URLSearchParams({ client_id: clientId }).toString()}`;
}
