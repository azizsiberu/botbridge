import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type MailMessage } from '../api';
import { DataTable, Empty, ErrorNote, PageTitle, Status, control, time } from '../ui';

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
      <PageTitle title="Mail" lede="Messages between bots, including broadcasts." />
      <div className="filters cols-4">
        <input className={control} aria-label="From" placeholder="From" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input className={control} aria-label="To" placeholder="To" value={to} onChange={(event) => setTo(event.target.value)} />
        <input className={control} aria-label="Text" placeholder="Text" value={q} onChange={(event) => setQ(event.target.value)} />
        <label className="check">
          <input type="checkbox" checked={unread} onChange={(event) => setUnread(event.target.checked)} /> Unread only
        </label>
      </div>
      {messages ? <p className="muted mb-3">{total} matching</p> : null}
      {error ? <ErrorNote message={error} /> : null}
      {messages?.length === 0 ? <Empty title="No messages" body="Messages between bots show up here, including broadcasts." /> : null}
      {messages && messages.length > 0 ? (
        <DataTable label="Mail">
          <thead>
            <tr><th>From</th><th>To</th><th>Kind</th><th>Status</th><th>When</th><th>Text</th></tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr key={message.id}>
                <td><Link className="row-link" to={`/mail/${message.thread_id}`}>{message.from.name}</Link></td>
                <td>{message.to.name}</td>
                <td>{message.kind}</td>
                <td>{message.read_at ? <Status tone="neutral">Read</Status> : <Status tone="warn">Unread</Status>}</td>
                <td>{time(message.created_at)}</td>
                <td className="clip">{message.text}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}
    </div>
  );
}
