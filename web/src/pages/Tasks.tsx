import { useEffect, useState } from 'react';
import { api, type Task } from '../api';
import { PageTitle } from '../Shell';
import { Card, Empty, ErrorNote, control, time } from '../ui';

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

  const columns: Array<{ status: Task['status']; title: string }> = [
    { status: 'open', title: 'Open' },
    { status: 'completed', title: 'Completed' },
  ];

  return (
    <div>
      <PageTitle kicker="Work" title="Tasks" />
      <input className={control} placeholder="Search instructions, results, or bots" value={q} onChange={(event) => setQ(event.target.value)} />
      {error ? <div className="mt-4"><ErrorNote message={error} /></div> : null}
      {tasks?.length === 0 ? <div className="mt-4"><Empty title="No tasks" body="When a bot posts work for another bot, it lands in the open column." /></div> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {columns.map((column) => (
          <div key={column.status}>
            <h2 className="mb-2 text-xs font-medium tracking-[0.16em] text-[var(--muted)] uppercase">{column.title}</h2>
            <div className="grid gap-2">
              {tasks?.filter((task) => task.status === column.status).map((task) => (
                <button key={task.id} type="button" onClick={() => setOpen(task)} className="text-left">
                  <Card className="px-4 py-3 hover:border-[var(--accent)]">
                    <p className="text-sm font-medium">{task.from.name} → {task.to.name}</p>
                    <p className="mt-1 line-clamp-3 text-sm text-[var(--muted)]">{task.instructions}</p>
                  </Card>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {open ? (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => setOpen(null)}>
          <Card className="max-h-[80vh] w-full max-w-xl overflow-auto p-5" >
            <p className="text-xs tracking-[0.14em] text-[var(--muted)] uppercase">{open.status}</p>
            <h2 className="serif text-3xl">{open.from.name} → {open.to.name}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{time(open.created_at)}</p>
            <h3 className="mt-4 text-sm font-medium">Instructions</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm">{open.instructions}</p>
            <h3 className="mt-4 text-sm font-medium">Result</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--muted)]">{open.result ?? 'Not finished.'}</p>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
