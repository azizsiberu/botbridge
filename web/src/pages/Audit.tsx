import { useState } from 'react';
import { type AuditEntry } from '../api';
import { Empty, ErrorNote, FeedItem, FeedList, Loading, PageTitle, control, time } from '../ui';
import { usePageData } from '../workspace-data';

export function AuditPage() {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');

  const request = usePageData<{ entries: AuditEntry[] }>(
    `/api/admin/audit?${new URLSearchParams({ action, actor })}`,
  );
  const entries = request.data?.entries ?? null;
  const error = request.error;

  return (
    <div>
      <PageTitle title="Audit" lede="Sends, tasks, token rotations, and doorbell tests." />
      <div className="filters cols-2">
        <input
          className={control}
          aria-label="Action"
          placeholder="Action, for example message.sent"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        />
        <input
          className={control}
          aria-label="Bot name"
          placeholder="Bot name"
          value={actor}
          onChange={(event) => setActor(event.target.value)}
        />
      </div>
      {!entries && !error ? <Loading label="Loading audit log." /> : null}
      {error ? <ErrorNote message={error} onRetry={request.refresh} /> : null}
      {entries?.length === 0 ? (
        <Empty
          title="No audit entries"
          body="Sends, tasks, token rotations, and doorbell tests are written here."
        />
      ) : null}
      {entries && entries.length > 0 ? (
        <FeedList label="Audit log">
          {entries.map((entry) => (
            <FeedItem
              key={entry.id}
              name={entry.actor_name ?? 'system'}
              title={entry.action}
              when={<time dateTime={entry.created_at}>{time(entry.created_at)}</time>}
              detail={
                entry.target_name ? `${entry.target_name} · ${entry.resource_type}` : entry.resource_type
              }
            />
          ))}
        </FeedList>
      ) : null}
    </div>
  );
}
