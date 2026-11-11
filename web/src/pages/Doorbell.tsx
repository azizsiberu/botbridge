import { useEffect, useState } from 'react';
import { api, type Delivery } from '../api';
import { Empty, ErrorNote, FeedItem, FeedList, PageTitle, Status, control, time } from '../ui';

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
      <PageTitle title="Deliveries" lede="Webhook deliveries, including retries." />
      <div className="filters cols-2">
        <input className={control} aria-label="Bot name" placeholder="Bot name" value={bot} onChange={(event) => setBot(event.target.value)} />
        <select className={control} aria-label="State" value={state} onChange={(event) => setState(event.target.value as (typeof states)[number])}>
          {states.map((item) => <option key={item} value={item}>{item || 'All states'}</option>)}
        </select>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {rows?.length === 0 ? <Empty title="No deliveries" body="A test ping, or a message to a bot with a webhook, is listed here." /> : null}
      {rows && rows.length > 0 ? (
        <FeedList label="Doorbell deliveries">
          {rows.map((row) => (
            <FeedItem
              key={row.id}
              name={row.bot.name}
              title={`${row.bot.name} · ${row.event}`}
              when={<time dateTime={row.created_at}>{time(row.created_at)}</time>}
              detail={row.last_error ?? (row.last_status ? `HTTP ${row.last_status}` : 'No delivery detail')}
              meta={
                <>
                  <Status tone={row.state === 'delivered' ? 'ok' : row.state === 'failed' ? 'danger' : 'warn'}>{row.state}</Status>
                  <span>{row.attempts}/{row.max_attempts} attempts</span>
                </>
              }
            />
          ))}
        </FeedList>
      ) : null}
    </div>
  );
}
