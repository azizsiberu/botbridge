import { useEffect, useState } from 'react';
import { api, type Delivery } from '../api';
import { PageTitle } from '../Shell';
import { Card, Empty, ErrorNote, Pill, control, time } from '../ui';

const states = ['', 'delivered', 'pending', 'failed'] as const;

export function DoorbellPage() {
  const [bot, setBot] = useState('');
  const [state, setState] = useState<(typeof states)[number]>('');
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (bot) params.set('bot', bot);
    if (state) params.set('state', state);
    api<{ deliveries: Delivery[] }>(`/api/admin/doorbell?${params}`)
      .then((body) => setRows(body.deliveries))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }, [bot, state]);

  return (
    <div>
      <PageTitle kicker="Wake-ups" title="Doorbell" />
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={control} placeholder="Bot name" value={bot} onChange={(event) => setBot(event.target.value)} />
        <select className={control} value={state} onChange={(event) => setState(event.target.value as (typeof states)[number])}>
          {states.map((item) => <option key={item} value={item}>{item || 'All states'}</option>)}
        </select>
      </div>
      {error ? <div className="mt-4"><ErrorNote message={error} /></div> : null}
      <div className="mt-4 grid gap-2">
        {rows?.length === 0 ? <Empty title="No deliveries" body="A test ping or a real message to a bot with a webhook shows up here, including retries." /> : null}
        {rows?.map((row) => (
          <Card key={row.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{row.bot.name} · {row.event}</p>
              <Pill tone={row.state === 'delivered' ? 'ok' : row.state === 'failed' ? 'danger' : 'warn'}>{row.state}</Pill>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Attempt {row.attempts}/{row.max_attempts}
              {row.last_status ? ` · HTTP ${row.last_status}` : ''}
              {row.last_error ? ` · ${row.last_error}` : ''}
              {' · '}
              {time(row.created_at)}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
