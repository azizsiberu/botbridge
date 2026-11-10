import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, type Bot } from '../api';
import { PageTitle } from '../Shell';
import { Button, Card, ErrorNote, Field, Loading, control } from '../ui';

export function ChoosePage() {
  const [params] = useSearchParams();
  const clientId = params.get('client_id') ?? '';
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [botId, setBotId] = useState('');
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
        kicker="OAuth"
        title="Which bot is this?"
        lede="This client will act as one of your bots until you revoke the grant. The choice is yours, not the client’s."
      />
      {error ? <ErrorNote message={error} /> : null}
      {!bots && !error ? <Loading label="Loading your bots…" /> : null}
      {done ? (
        <Card className="p-6">
          <p className="serif text-3xl">Bound.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">Go back to the client and try again. You can revoke this from Settings.</p>
        </Card>
      ) : null}
      {bots && !done ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="serif text-2xl">Use an existing bot</h2>
            <form
              className="mt-4 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                api('/api/admin/grants', { method: 'POST', body: JSON.stringify({ bot_id: botId, client_id: clientId || 'default', label: 'OAuth client' }) })
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
              <p className="text-xs text-[var(--muted)]">Client {clientId || 'default'}</p>
              <Button type="submit" disabled={!botId}>Use this bot</Button>
            </form>
          </Card>
          <Card className="p-5">
            <h2 className="serif text-2xl">Or create one</h2>
            <form
              className="mt-4 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                api<{ bot: { id: string } }>('/api/admin/bots', { method: 'POST', body: JSON.stringify({ name }) })
                  .then((created) =>
                    api('/api/admin/grants', {
                      method: 'POST',
                      body: JSON.stringify({ bot_id: created.bot.id, client_id: clientId || 'default', label: 'OAuth client' }),
                    }),
                  )
                  .then(() => setDone(true))
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
              }}
            >
              <Field label="Name"><input className={control} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
              <Button type="submit">Create and bind</Button>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
