import { useState } from 'react';
import { Link } from 'react-router';
import { type Overview } from '../api';
import { ErrorNote, FeedItem, FeedList, Loading, PageTitle, time } from '../ui';
import { usePageData } from '../workspace-data';
import { PendingBotRequests, PendingOAuthClients } from './PendingOAuth';

export function OverviewPage() {
  const [days, setDays] = useState<14 | 30>(14);

  const request = usePageData<Overview>(`/api/admin/overview?days=${days}`);
  const data = request.data ?? null;
  const error = request.error;

  return (
    <div>
      <PageTitle
        title="Overview"
        lede="Mail, tasks, and doorbells for the bots you can see."
        action={
          <div className="segment" role="group" aria-label="Range">
            <button type="button" aria-pressed={days === 14} onClick={() => setDays(14)}>
              14 days
            </button>
            <button type="button" aria-pressed={days === 30} onClick={() => setDays(30)}>
              30 days
            </button>
          </div>
        }
      />
      <PendingOAuthClients />
      <PendingBotRequests />
      {error ? <ErrorNote message={error} onRetry={request.refresh} /> : null}
      {!data && !error ? <Loading label="Loading overview." /> : null}
      {data ? (
        <>
          <div className="stats">
            <Stat label="Active bots" value={data.bots.active} hint={`${data.bots.revoked} revoked`} />
            <Stat label="Messages" value={data.messages.total} hint={`${data.messages.unread} unread`} />
            <Stat label="Open tasks" value={data.tasks.open} hint={`${data.tasks.completed} completed`} />
            <Stat
              label="Doorbell"
              value={data.doorbell.delivered}
              hint={`${data.doorbell.failed} failed, ${data.doorbell.pending} waiting`}
            />
          </div>
          <section className="section">
            <div className="panel">
              <h2>Traffic</h2>
              <div className="legend">
                <span>
                  <i className="swatch mail" aria-hidden="true" />
                  Mail
                </span>
                <span>
                  <i className="swatch task" aria-hidden="true" />
                  Tasks
                </span>
              </div>
              <Chart mail={data.messages.series} tasks={data.tasks.series} />
            </div>
          </section>
          <section className="section">
            <div className="section-head">
              <h2>Recent activity</h2>
              <Link to="/audit">Open the audit log</Link>
            </div>
            {data.recent.length === 0 ? (
              <p className="muted">No activity yet.</p>
            ) : (
              <FeedList label="Recent activity">
                {data.recent.map((entry) => (
                  <FeedItem
                    key={entry.id}
                    name={entry.actor_name ?? 'system'}
                    title={entry.action}
                    when={<time dateTime={entry.created_at}>{time(entry.created_at)}</time>}
                    detail={entry.target_name ?? '—'}
                  />
                ))}
              </FeedList>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
      <span>{hint}</span>
    </div>
  );
}

function Chart({
  mail,
  tasks,
}: {
  mail: Array<{ day: string; count: number }>;
  tasks: Array<{ day: string; count: number }>;
}) {
  const max = Math.max(1, ...mail.map((row) => row.count), ...tasks.map((row) => row.count));
  return (
    <div className="chart" role="img" aria-label="Mail and tasks per day">
      {mail.map((row, index) => {
        const taskCount = tasks[index]?.count ?? 0;
        return (
          <div key={row.day} className="col" title={`${row.day}: ${row.count} messages, ${taskCount} tasks`}>
            <div className="bar mail" style={{ height: `${(row.count / max) * 100}%` }} />
            <div className="bar task" style={{ height: `${(taskCount / max) * 100}%` }} />
          </div>
        );
      })}
    </div>
  );
}
