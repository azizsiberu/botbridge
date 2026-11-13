import { useState } from 'react';
import { base, useData, type ReachableBot } from '../workspace-data';
import { State, Row, type ViewProps } from './shared';
import { ProfileCard } from './ProfileCard';

export function Directory(p: ViewProps & { id?: string }) {
  const state = useData<ReachableBot[]>(base(p.bot.id) + '/directory', p.revision),
    [q, setQ] = useState('');
  const bot = state.data?.find((b) => b.id === p.id);
  const rows = state.data?.filter((b) =>
    (b.name + ' ' + b.description).toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <State {...state} data={state.data} refresh={p.refresh}>
      {p.id ? (
        bot ? (
          <ProfileCard agent={bot} own={bot.id === p.bot.id} compose={p.compose} />
        ) : (
          <p className="ws-notice">Bot unavailable.</p>
        )
      ) : (
        <>
          <div className="ws-tools">
            <input
              className="control"
              aria-label="Search bots"
              placeholder="Search reachable bots"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {rows?.map((b) => (
            <Row
              key={b.id}
              to={'/search/' + b.id}
              name={b.name}
              detail={b.description || b.relation.replaceAll('_', ' ')}
            />
          ))}
          {!rows?.length && <p className="ws-notice">No matching bots.</p>}
        </>
      )}
    </State>
  );
}
