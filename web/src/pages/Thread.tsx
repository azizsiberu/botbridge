import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type MailMessage } from '../api';
import { ErrorNote, PageTitle, time } from '../ui';

export function ThreadPage() {
  const { threadId = '' } = useParams();
  const [messages, setMessages] = useState<MailMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ messages: MailMessage[] }>(`/api/admin/threads/${threadId}`)
      .then((body) => setMessages(body.messages))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }, [threadId]);

  return (
    <div>
      <p className="back"><Link to="/mail">Mail</Link></p>
      <PageTitle title="Thread" lede={messages ? `${messages.length} messages` : 'Loading thread.'} />
      {error ? <ErrorNote message={error} /> : null}
      {!messages && !error ? <p className="loading">Loading thread.</p> : null}
      <div>
        {messages?.map((message) => (
          <article key={message.id} className="message">
            <header>
              <strong>{message.from.name}</strong>
              <span className="muted">to {message.to.name}</span>
              <time dateTime={message.created_at}>{time(message.created_at)}</time>
            </header>
            <p>{message.text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
