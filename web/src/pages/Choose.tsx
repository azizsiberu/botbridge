import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { oauthClientName } from '../../../src/oauth-client';
import { api, type Bot } from '../api';
import { Form, Button, ErrorNote, Field, Loading, PageTitle, control } from '../ui';
import { usePageData } from '../workspace-data';

export function ChoosePage() {
  const [params] = useSearchParams();
  const clientId = params.get('client_id') ?? '';
  const clientName = oauthClientName(clientId || 'default');
  const request = usePageData<{ bots: Bot[] }>('/api/admin/bots');
  const bots = request.data?.bots.filter((bot) => bot.status === 'active');
  const [botId, setBotId] = useState('');
  const grantId = params.get('grant_id') ?? '';
  const [name, setName] = useState('');
  const error = request.error;
  const setError = request.setError;
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (request.data) setBotId(request.data.bots.find((bot) => bot.status === 'active')?.id ?? '');
  }, [request.data]);

  return (
    <div>
      <PageTitle
        title={clientId ? `Bind ${clientName} to a bot` : 'Bind a connection'}
        lede="A new client registers its own bot. Use this page when you want the connection to act as a bot you already have."
      />
      {error ? (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={request.refresh} />
        </div>
      ) : null}
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
            <Form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                return api('/api/admin/grants', {
                  method: 'POST',
                  body: JSON.stringify({
                    bot_id: botId,
                    client_id: clientId || 'default',
                    label: clientName,
                    grant_id: grantId || undefined,
                  }),
                })
                  .then(() => setDone(true))
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
              }}
            >
              <Field label="Bot">
                <select className={control} value={botId} onChange={(event) => setBotId(event.target.value)}>
                  {bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.name}
                    </option>
                  ))}
                </select>
              </Field>
              <ClientId clientId={clientId} clientName={clientName} />
              <div>
                <Button type="submit" disabled={!botId}>
                  Use this bot
                </Button>
              </div>
            </Form>
          </section>
          <section className="panel">
            <h2>Create one</h2>
            <Form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                return api<{ bot: { id: string } }>('/api/admin/bots', {
                  method: 'POST',
                  body: JSON.stringify({ name }),
                })
                  .then((created) =>
                    api('/api/admin/grants', {
                      method: 'POST',
                      body: JSON.stringify({
                        bot_id: created.bot.id,
                        client_id: clientId || 'default',
                        label: clientName,
                        grant_id: grantId || undefined,
                      }),
                    }),
                  )
                  .then(() => setDone(true))
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
              }}
            >
              <Field label="Name">
                <input
                  className={control}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </Field>
              <div>
                <Button type="submit">Create and bind</Button>
              </div>
            </Form>
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
