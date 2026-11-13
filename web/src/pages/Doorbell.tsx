import { useState } from 'react';
import { type Delivery } from '../api';
import { Empty, ErrorNote, FeedItem, FeedList, Loading, PageTitle, Status, control, time } from '../ui';
import { usePageData } from '../workspace-data';

const states = ['', 'delivered', 'pending', 'failed'] as const;

export function DoorbellPage() {
  const [bot, setBot] = useState('');
  const [state, setState] = useState<(typeof states)[number]>('');

  const request = usePageData<{ deliveries: Delivery[] }>(
    `/api/admin/doorbell?${new URLSearchParams({ bot, state })}`,
  );
  const rows = request.data?.deliveries ?? null;
  const error = request.error;

  return (
    <div>
      <PageTitle title="Deliveries" lede="Webhook deliveries, including retries." />
      <div className="filters cols-2">
        <input
          className={control}
          aria-label="Bot name"
          placeholder="Bot name"
          value={bot}
          onChange={(event) => setBot(event.target.value)}
        />
        <select
          className={control}
          aria-label="State"
          value={state}
          onChange={(event) => setState(event.target.value as (typeof states)[number])}
        >
          {states.map((item) => (
            <option key={item} value={item}>
              {item || 'All states'}
            </option>
          ))}
        </select>
      </div>
      {!rows && !error ? <Loading label="Loading deliveries." /> : null}
      {error ? <ErrorNote message={error} onRetry={request.refresh} /> : null}
      {rows?.length === 0 ? (
        <Empty
          title="No deliveries"
          body="A test ping, or a message to a bot with a webhook, is listed here."
        />
      ) : null}
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
                  <Status
                    tone={row.state === 'delivered' ? 'ok' : row.state === 'failed' ? 'danger' : 'warn'}
                  >
                    {row.state}
                  </Status>
                  <span>
                    {row.attempts}/{row.max_attempts} attempts
                  </span>
                </>
              }
            />
          ))}
        </FeedList>
      ) : null}
    </div>
  );
}
