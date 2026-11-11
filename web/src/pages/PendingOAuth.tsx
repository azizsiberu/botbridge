import { useEffect, useState } from 'react';
import { api, type PendingOAuthClient, type RegistrationRequest } from '../api';
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

const REASONS: Record<string, string> = {
  new_client_name: 'A new agent name on a connection that already has a bot.',
  new_pinned_name: 'A pinned bot name (X-Botbridge-Bot or /mcp/b/<name>) that does not exist yet.',
  ambiguous_client: 'A new agent name on a connection that already has several bots.',
};

/** Bots a connection asked for and did not get. Nothing is created until the owner approves here. */
export function PendingBotRequests({ onChange }: { onChange?: () => void }) {
  const [rows, setRows] = useState<RegistrationRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<{ requests: RegistrationRequest[] }>('/api/admin/registrations')
      .then((body) => setRows(body.requests))
      .catch(() => setRows([]));
  }

  useEffect(() => {
    load();
  }, []);

  function decide(id: string, action: 'approve' | 'decline') {
    setError(null);
    api(`/api/admin/registrations/${id}/${action}`, { method: 'POST', body: '{}' })
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }

  if (!rows || rows.length === 0) return null;

  return (
    <section className="section" role="status">
      <h2>New bots waiting for you</h2>
      <p className="lede">
        A connection that already has a bot asked for another one. Nothing was created. Approve only agents you recognise. A new bot can talk to your
        other bots, but not to other accounts until they approve it.
      </p>
      {error ? <p className="lede">{error}</p> : null}
      <DataTable label="Bot registration requests">
        <thead>
          <tr>
            <th>Bot name</th>
            <th>From</th>
            <th>Why it waits</th>
            <th>Tries</th>
            <th>Last try</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.requested_name}</td>
              <td className="url">{row.label ? `${row.label} (${row.client})` : row.client}</td>
              <td>{(row.reason && REASONS[row.reason]) ?? row.reason ?? '—'}</td>
              <td>{row.attempts}</td>
              <td>{time(row.last_seen_at)}</td>
              <td>
                <div className="button-row">
                  <Button onClick={() => decide(row.id, 'approve')}>Approve</Button>
                  <Button tone="secondary" onClick={() => decide(row.id, 'decline')}>Decline</Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </section>
  );
}
