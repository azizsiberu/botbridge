import { useEffect, useState } from 'react';
import { api, type PendingOAuthClient, type RegistrationRequest } from '../api';
import { Button, ErrorNote, Loading, FeedItem, FeedList, time } from '../ui';
import { usePageData } from '../workspace-data';

export function PendingOAuthClients({
  presentation = 'banner',
  onLoaded,
}: {
  presentation?: 'banner' | 'section';
  onLoaded?: (count: number) => void;
}) {
  const request = usePageData<{ clients: PendingOAuthClient[] }>('/api/admin/oauth/pending');
  const clients = request.data?.clients;
  useEffect(() => {
    if (clients) onLoaded?.(clients.length);
  }, [clients, onLoaded]);
  if (request.error) return <ErrorNote message={request.error} onRetry={request.refresh} />;
  if (!clients) return <Loading label="Loading connection requests." inline />;
  if (clients.length === 0) return null;

  return (
    <section
      className="section"
      role="status"
      style={presentation === 'banner' ? { marginTop: 0 } : undefined}
    >
      <h2>Registration needs attention</h2>
      <p className="lede">
        These clients signed in and did not get a bot. Connect again, or bind the client to a bot you already
        have.
      </p>
      <FeedList label="OAuth clients that did not register">
        {clients.map((client) => (
          <FeedItem
            key={client.client_id}
            name={client.name}
            title={client.name}
            when={<time dateTime={client.last_seen_at}>{time(client.last_seen_at)}</time>}
            detail={client.last_error ?? 'Connect the client again to register it.'}
            meta={<span className="mono">{client.client_id}</span>}
            actions={<Button to={bindPath(client.client_id)}>Bind to an existing bot</Button>}
          />
        ))}
      </FeedList>
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
  const request = usePageData<{ requests: RegistrationRequest[] }>('/api/admin/registrations');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const rows = request.data?.requests;
  const error = request.error;
  function decide(id: string, action: 'approve' | 'decline') {
    if (pendingId) return;
    setPendingId(id);
    request.setError(null);
    return api(`/api/admin/registrations/${id}/${action}`, { method: 'POST', body: '{}' })
      .then(() => {
        request.refresh();
        onChange?.();
      })
      .catch((err: unknown) => request.setError(err instanceof Error ? err.message : 'Failed'))
      .finally(() => setPendingId(null));
  }
  if (error) return <ErrorNote message={error} onRetry={request.refresh} />;
  if (!rows) return <Loading label="Loading bot registration requests." inline />;
  if (rows.length === 0) return null;

  return (
    <section className="section" role="status">
      <h2>New bots waiting for you</h2>
      <p className="lede">
        A connection that already has a bot asked for another one. Nothing was created. Approve only agents
        you recognise. A new bot can talk to your other bots, but not to other accounts until they approve it.
      </p>
      {error ? <p className="lede">{error}</p> : null}
      <FeedList label="Bot registration requests">
        {rows.map((row) => (
          <FeedItem
            key={row.id}
            name={row.requested_name}
            title={row.requested_name}
            when={<time dateTime={row.last_seen_at}>{time(row.last_seen_at)}</time>}
            detail={(row.reason && REASONS[row.reason]) ?? row.reason ?? 'Waiting for a decision.'}
            meta={
              <span>
                {row.label ? `${row.label} (${row.client})` : row.client} · {row.attempts} tries
              </span>
            }
            actions={
              <>
                <Button disabled={Boolean(pendingId)} onClick={() => decide(row.id, 'approve')}>
                  Approve
                </Button>
                <Button
                  tone="secondary"
                  disabled={Boolean(pendingId)}
                  onClick={() => decide(row.id, 'decline')}
                >
                  Decline
                </Button>
              </>
            }
          />
        ))}
      </FeedList>
    </section>
  );
}
