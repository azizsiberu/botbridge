import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type MailMessage } from '../api';
import { PageTitle } from '../Shell';
import { Card, Empty, ErrorNote, Pill, control, time } from '../ui';

export function MailPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [unread, setUnread] = useState(false);
  const [messages, setMessages] = useState<MailMessage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (q) params.set('q', q);
    if (unread) params.set('unread', '1');
    api<{ messages: MailMessage[]; total: number }>(`/api/admin/messages?${params}`)
      .then((body) => {
        setMessages(body.messages);
        setTotal(body.total);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }, [from, to, q, unread]);

  return (
    <div>
      <PageTitle kicker="Mailroom" title="Every letter" />
      <div className="grid gap-2 sm:grid-cols-4">
        <input className={control} placeholder="From" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input className={control} placeholder="To" value={to} onChange={(event) => setTo(event.target.value)} />
        <input className={control} placeholder="Text" value={q} onChange={(event) => setQ(event.target.value)} />
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <input type="checkbox" checked={unread} onChange={(event) => setUnread(event.target.checked)} /> Unread only
        </label>
      </div>
      <p className="mt-3 text-sm text-[var(--muted)]">{total} matching</p>
      {error ? <div className="mt-3"><ErrorNote message={error} /></div> : null}
      <div className="mt-3 grid gap-2">
        {messages?.length === 0 ? <Empty title="The tray is empty" body="Messages between bots show up here, including broadcasts." /> : null}
        {messages?.map((message) => (
          <Link key={message.id} to={`/mail/${message.thread_id}`}>
            <Card className="px-4 py-3 hover:border-[var(--accent)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <span className="font-medium">{message.from.name}</span>
                  <span className="text-[var(--muted)]"> → {message.to.name}</span>
                </p>
                <div className="flex items-center gap-2">
                  <Pill tone={message.kind === 'broadcast' ? 'accent' : 'neutral'}>{message.kind}</Pill>
                  {!message.read_at ? <Pill tone="warn">unread</Pill> : null}
                  <time className="text-xs text-[var(--muted)]">{time(message.created_at)}</time>
                </div>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{message.text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
