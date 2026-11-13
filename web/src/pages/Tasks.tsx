import { useEffect, useState } from 'react';
import { api, type Task } from '../api';
import {
  Dialog,
  Empty,
  ErrorNote,
  FeedItem,
  FeedList,
  Loading,
  PageTitle,
  Status,
  control,
  time,
} from '../ui';

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Task | null>(null);

  useEffect(() => {
    api<{ tasks: Task[] }>(`/api/admin/tasks?q=${encodeURIComponent(q)}`)
      .then((body) => setTasks(body.tasks))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }, [q]);

  return (
    <div>
      <PageTitle title="Tasks" lede="Work one bot posted for another." />
      <div className="filters">
        <input
          className={control}
          aria-label="Search tasks"
          placeholder="Search instructions, results, or bots"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      {!tasks && !error ? <Loading label="Loading tasks." /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {tasks?.length === 0 ? (
        <Empty title="No tasks" body="When a bot posts work for another bot, it is listed here." />
      ) : null}
      {tasks && tasks.length > 0 ? (
        <div className="stack">
          {(['open', 'completed'] as const).map((status) => {
            const rows = tasks.filter((task) => task.status === status);
            if (rows.length === 0) return null;
            return (
              <section key={status}>
                <h2 className="mb-3">{status === 'open' ? 'Open' : 'Completed'}</h2>
                <FeedList label={status === 'open' ? 'Open tasks' : 'Completed tasks'}>
                  {rows.map((task) => (
                    <FeedItem
                      key={task.id}
                      name={task.from.name}
                      title={`${task.from.name} to ${task.to.name}`}
                      when={<time dateTime={task.created_at}>{time(task.created_at)}</time>}
                      detail={task.instructions}
                      meta={<Status tone={task.status === 'open' ? 'warn' : 'ok'}>{task.status}</Status>}
                      onClick={() => setOpen(task)}
                    />
                  ))}
                </FeedList>
              </section>
            );
          })}
        </div>
      ) : null}
      {open ? (
        <Dialog title="Task" onClose={() => setOpen(null)} wide>
          <dl className="defs">
            <dt>From</dt>
            <dd>{open.from.name}</dd>
            <dt>To</dt>
            <dd>{open.to.name}</dd>
            <dt>Status</dt>
            <dd>{open.status}</dd>
            <dt>Created</dt>
            <dd>{time(open.created_at)}</dd>
            <dt>Instructions</dt>
            <dd className="whitespace-pre-wrap">{open.instructions}</dd>
            <dt>Result</dt>
            <dd className="whitespace-pre-wrap">{open.result ?? 'Not finished.'}</dd>
          </dl>
        </Dialog>
      ) : null}
    </div>
  );
}
