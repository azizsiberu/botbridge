import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type MailMessage } from '../api';
import { Card, ErrorNote, time } from '../ui';

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
      <Link to="/mail" className="text-sm text-[var(--muted)]">← Mail</Link>
      <h1 className="serif mt-2 mb-4 text-4xl">Thread</h1>
      {error ? <ErrorNote message={error} /> : null}
      <div className="grid gap-3">
        {messages?.map((message) => (
          <Card key={message.id} className="px-5 py-4">
            <p className="text-sm">
              <span className="font-medium">{message.from.name}</span>
              <span className="text-[var(--muted)]"> to {message.to.name}</span>
              <span className="float-right text-xs text-[var(--muted)]">{time(message.created_at)}</span>
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
