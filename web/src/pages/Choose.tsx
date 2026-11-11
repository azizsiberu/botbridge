import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { oauthClientName } from '../../../src/oauth-client';
import { api, type Bot } from '../api';
import { Button, ErrorNote, Field, Loading, PageTitle, control } from '../ui';

export function ChoosePage() {
  const [params] = useSearchParams();
  const clientId = params.get('client_id') ?? '';
  const clientName = oauthClientName(clientId || 'default');
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [botId, setBotId] = useState('');
  const grantId = params.get('grant_id') ?? '';
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<{ bots: Bot[] }>('/api/admin/bots')
      .then((body) => {
        setBots(body.bots.filter((bot) => bot.status === 'active'));
        const first = body.bots.find((bot) => bot.status === 'active');
        if (first) setBotId(first.id);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }, []);

  return (
    <div>
      <PageTitle
        title={clientId ? `Bind ${clientName} to a bot` : 'Bind a connection'}
        lede="A new client registers its own bot. Use this page when you want the connection to act as a bot you already have."
      />
      {error ? <div className="mb-4"><ErrorNote message={error} /></div> : null}
      {!bots && !error ? <Loading label="Loading your bots." /> : null}
      {done ? (
        <div className="panel">
          <h2>Bound</h2>
          <p className="muted mt-2">{clientName} will use this bot. Go back to the client and try again.</p>
        </div>
      ) : null}
      {bots && !done ? (
        <div className="split">
          <section className="panel">
            <h2>Use an existing bot</h2>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                api('/api/admin/grants', { method: 'POST', body: JSON.stringify({ bot_id: botId, client_id: clientId || 'default', label: clientName, grant_id: grantId || undefined }) })
                  .then(() => setDone(true))
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
              }}
            >
              <Field label="Bot">
                <select className={control} value={botId} onChange={(event) => setBotId(event.target.value)}>
                  {bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>{bot.name}</option>
                  ))}
                </select>
              </Field>
              <ClientId clientId={clientId} clientName={clientName} />
              <div><Button type="submit" disabled={!botId}>Use this bot</Button></div>
            </form>
          </section>
          <section className="panel">
            <h2>Create one</h2>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                api<{ bot: { id: string } }>('/api/admin/bots', { method: 'POST', body: JSON.stringify({ name }) })
                  .then((created) =>
                    api('/api/admin/grants', {
                      method: 'POST',
                      body: JSON.stringify({ bot_id: created.bot.id, client_id: clientId || 'default', label: clientName, grant_id: grantId || undefined }),
                    }),
                  )
                  .then(() => setDone(true))
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
              }}
            >
              <Field label="Name"><input className={control} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
              <div><Button type="submit">Create and bind</Button></div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ClientId({ clientId, clientName }: { clientId: string; clientName: string }) {
  if (clientId && clientId !== clientName) {
    return (
      <div>
        <p>{clientName}</p>
        <p className="code">{clientId}</p>
      </div>
    );
  }
  return <p className="muted">Client {clientId || 'default'}</p>;
}
