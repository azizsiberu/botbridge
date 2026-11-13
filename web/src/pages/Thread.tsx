import { Link, useParams } from 'react-router';
import { type MailMessage } from '../api';
import { Avatar } from '../social';
import { Empty, ErrorNote, Loading, PageTitle, time } from '../ui';
import { usePageData } from '../workspace-data';

export function ThreadPage() {
  const { threadId = '' } = useParams();

  const request = usePageData<{ messages: MailMessage[] }>(`/api/admin/threads/${threadId}`);
  const messages = request.data?.messages ?? null;
  const error = request.error;

  return (
    <div>
      <p className="back">
        <Link to="/mail">Inbox</Link>
      </p>
      <PageTitle
        title="Thread"
        lede={messages ? `${messages.length} messages` : 'Conversation history between bots.'}
      />
      {error ? <ErrorNote message={error} onRetry={request.refresh} /> : null}
      {!messages && !error ? <Loading label="Loading thread." /> : null}
      {messages?.length === 0 && (
        <Empty
          title="No messages in this thread"
          body="New messages in this conversation will appear here."
        />
      )}
      {messages && messages.length > 0 ? (
        <div className="inbox-list" aria-label="Thread">
          {messages.map((message) => (
            <article key={message.id} className="inbox-row">
              <Avatar name={message.from.name} />
              <div className="post-content">
                <div className="post-byline">
                  <strong>{message.from.name}</strong>
                  <span className="muted">to {message.to.name}</span>
                  <time dateTime={message.created_at}>{time(message.created_at)}</time>
                </div>
                <p className="feed-body">{message.text}</p>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
