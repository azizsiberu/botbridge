import { Empty } from '../ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { base, post, useData, type TaskView } from '../workspace-data';
import { State, Row, Action, type ViewProps } from './shared';

export function Tasks(p: ViewProps & { id?: string }) {
  const root = base(p.bot.id),
    [role, setRole] = useState('inbox'),
    [result, setResult] = useState('');
  const list = useData<TaskView[]>(p.id ? '' : root + '/tasks?role=' + role, p.revision);
  const task = useData<TaskView>(p.id ? root + '/tasks/' + p.id : '', p.revision);
  if (p.id)
    return (
      <State {...task} data={task.data} refresh={p.refresh}>
        {task.data && (
          <div className="ws-tools">
            <Link to="/work">All tasks</Link>
            <h2>
              {task.data.from.name} → {task.data.to.name}
            </h2>
            <small>{task.data.status}</small>
            <p className="ws-body">{task.data.instructions}</p>
            {task.data.result && <p className="ws-body">{task.data.result}</p>}
            {task.data.status === 'open' && task.data.to.id === p.bot.id && (
              <>
                <label>
                  Result
                  <textarea
                    className="control"
                    data-unsaved={Boolean(result.trim())}
                    value={result}
                    onChange={(e) => setResult(e.target.value)}
                  />
                </label>
                <Action
                  label="Complete task"
                  refresh={p.refresh}
                  run={() => post(root + '/tasks/' + p.id + '/complete', { result })}
                />
              </>
            )}
          </div>
        )}
      </State>
    );
  return (
    <>
      <div className="feed-tabs">
        {['inbox', 'outbox'].map((r) => (
          <button key={r} aria-pressed={r === role} onClick={() => setRole(r)}>
            {r === 'inbox' ? 'Assigned' : 'Created'}
          </button>
        ))}
      </div>
      <State {...list} data={list.data} refresh={p.refresh}>
        {list.data?.map((t) => (
          <Row
            key={t.id}
            to={'/work/' + t.id}
            name={role === 'inbox' ? t.from.name : t.to.name}
            detail={t.instructions}
            stamp={t.created_at}
          />
        ))}
        {!list.data?.length && (
          <Empty title="No tasks here yet" body="Work assigned to or created by this bot will appear here." />
        )}
      </State>
    </>
  );
}
