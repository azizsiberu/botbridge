import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type Overview } from '../api';
import { PageTitle } from '../Shell';
import { Card, ErrorNote, Loading, Pill, Stat, time } from '../ui';

export function OverviewPage() {
  const [days, setDays] = useState<14 | 30>(14);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>(`/api/admin/overview?days=${days}`)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }, [days]);

  return (
    <div>
      <PageTitle
        kicker="Desk"
        lede="Mail, tasks, and doorbells for the bots you can see."
        title="What moved today"
        action={
          <div className="flex gap-2">
            <button type="button" className={days === 14 ? 'text-[var(--ink)]' : 'text-[var(--muted)]'} onClick={() => setDays(14)}>
              14 days
            </button>
            <button type="button" className={days === 30 ? 'text-[var(--ink)]' : 'text-[var(--muted)]'} onClick={() => setDays(30)}>
              30 days
            </button>
          </div>
        }
      />
      {error ? <ErrorNote message={error} /> : null}
      {!data && !error ? <Loading label="Counting the mail…" /> : null}
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Active bots" value={data.bots.active} hint={`${data.bots.revoked} revoked`} />
            <Stat label="Messages" value={data.messages.total} hint={`${data.messages.unread} still unread`} />
            <Stat label="Open tasks" value={data.tasks.open} hint={`${data.tasks.completed} completed`} />
            <Stat label="Doorbell" value={data.doorbell.delivered} hint={`${data.doorbell.failed} failed · ${data.doorbell.pending} waiting`} />
          </div>
          <Card className="mt-4 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="serif text-2xl">Traffic</h2>
              <div className="flex gap-3 text-xs text-[var(--muted)]">
                <span>Mail</span>
                <span>Tasks</span>
              </div>
            </div>
            <Chart mail={data.messages.series} tasks={data.tasks.series} />
          </Card>
          <Card className="mt-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="serif text-2xl">Recent activity</h2>
              <Link to="/audit" className="text-sm text-[var(--muted)]">
                Full log
              </Link>
            </div>
            <ul>
              {data.recent.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3 text-sm">
                  <div>
                    <span className="font-medium">{entry.action}</span>
                    <span className="text-[var(--muted)]"> · {entry.actor_name ?? 'system'}</span>
                    {entry.target_name ? <span className="text-[var(--muted)]"> → {entry.target_name}</span> : null}
                  </div>
                  <time className="shrink-0 text-[var(--muted)]">{time(entry.created_at)}</time>
                </li>
              ))}
              {data.recent.length === 0 ? <li className="px-5 py-6 text-sm text-[var(--muted)]">No activity yet.</li> : null}
            </ul>
          </Card>
          <div className="mt-4 flex gap-2">
            <Pill tone="accent">Delivered {data.doorbell.delivered}</Pill>
            <Pill tone={data.doorbell.failed ? 'danger' : 'neutral'}>Failed {data.doorbell.failed}</Pill>
            <Pill>Pending {data.doorbell.pending}</Pill>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Chart({ mail, tasks }: { mail: Array<{ day: string; count: number }>; tasks: Array<{ day: string; count: number }> }) {
  const max = Math.max(1, ...mail.map((row) => row.count), ...tasks.map((row) => row.count));
  return (
    <div className="flex h-44 items-end gap-1">
      {mail.map((row, index) => (
        <div key={row.day} className="flex h-full flex-1 items-end gap-0.5" title={`${row.day}: ${row.count} messages, ${tasks[index]?.count ?? 0} tasks`}>
          <div className="w-1/2 rounded-t bg-[var(--accent)]" style={{ height: `${(row.count / max) * 100}%` }} />
          <div className="w-1/2 rounded-t bg-[var(--bg-3)]" style={{ height: `${((tasks[index]?.count ?? 0) / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}
