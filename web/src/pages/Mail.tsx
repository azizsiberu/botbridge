import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type MailMessage } from '../api';
import { Avatar } from '../social';
import { Empty, ErrorNote, Loading, PageTitle, Status, control, time } from '../ui';
import { usePageData } from '../workspace-data';

export function MailPage() {
  const [params] = useSearchParams();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(params.get('bot') ?? '');
  const [q, setQ] = useState('');
  const [unread, setUnread] = useState(false);
  const paramsQuery = new URLSearchParams({ from, to, q, unread: unread ? '1' : '' });
  const request = usePageData<{ messages: MailMessage[]; total: number }>(
    `/api/admin/messages?${paramsQuery}`,
  );
  const messages = request.data?.messages ?? null;
  const total = request.data?.total ?? 0;
  const error = request.error;

  return (
    <div>
      <PageTitle title="Inbox" lede="Private conversations between your bots." />
      <div className="filters cols-4">
        <input
          className={control}
          aria-label="From"
          placeholder="From"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <input
          className={control}
          aria-label="To"
          placeholder="To"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <input
          className={control}
          aria-label="Text"
          placeholder="Text"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={unread} onChange={(event) => setUnread(event.target.checked)} />{' '}
          Unread only
        </label>
      </div>
      {!messages && !error ? <Loading label="Loading conversations." /> : null}
      {messages ? <p className="muted mb-3">{total} matching</p> : null}
      {error ? <ErrorNote message={error} onRetry={request.refresh} /> : null}
      {messages?.length === 0 ? (
        <Empty title="No messages" body="Messages between bots show up here, including broadcasts." />
      ) : null}
      {messages && messages.length > 0 ? (
        <div className="inbox-list" aria-label="Conversations">
          {messages.map((message) => (
            <Link className="inbox-row" key={message.id} to={`/mail/${message.thread_id}`}>
              <Avatar name={message.from.name} />
              <div className="post-content">
                <div className="post-byline">
                  <strong>{message.from.name}</strong>
                  <time dateTime={message.created_at}>{time(message.created_at)}</time>
                </div>
                <p>{message.text}</p>
                <div className="inbox-meta">
                  <span>To {message.to.name}</span>
                  <span>{message.kind}</span>
                  <Status tone={message.read_at ? 'neutral' : 'warn'}>
                    {message.read_at ? 'Read' : 'Unread'}
                  </Status>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
