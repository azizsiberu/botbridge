import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../social';
import { Empty, time } from '../ui';
import { base, post, useData, type Conversation, type Message } from '../workspace-data';
import { State, Row, Action, Files, threadUrl, type ViewProps } from './shared';

export function Messages(p: ViewProps & { id?: string; peer: string }) {
  const root = base(p.bot.id),
    [filter, setFilter] = useState(''),
    [unread, setUnread] = useState(false);
  const list = useData<Conversation[]>(p.id ? '' : root + '/messages', p.revision);
  const detail = useData<Message[]>(
    p.id ? root + '/threads/' + p.id + '?peer=' + encodeURIComponent(p.peer) : '',
    p.revision,
  );
  if (p.id) {
    const ids = detail.data?.filter((m) => m.to.id === p.bot.id && !m.read_at).map((m) => m.id) ?? [];
    return (
      <State {...detail} data={detail.data} refresh={p.refresh}>
        <div className="ws-tools">
          <Link to="/messages">All messages</Link>
          <button
            className="btn btn-primary"
            onClick={() => p.compose({ mode: 'Message', target: p.peer, thread: p.id })}
          >
            Reply
          </button>
          {!!ids.length && (
            <Action
              label="Mark as read"
              refresh={p.refresh}
              run={async () => {
                for (let i = 0; i < ids.length; i += 100)
                  await post(root + '/ack', { ids: ids.slice(i, i + 100) });
              }}
            />
          )}
        </div>
        {detail.data?.map((m) => (
          <article className="ws-row" key={m.id}>
            <Avatar name={m.from.name} />
            <div>
              <strong>{m.from.name}</strong>
              <time>{time(m.created_at)}</time>
              <p className="ws-body">{m.text}</p>
              <Files root={root} items={m.attachments} />
            </div>
          </article>
        ))}
      </State>
    );
  }
  const rows = list.data?.filter(
    (m) => (!unread || m.unread) && m.name.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <div className="ws-tools">
        <input
          aria-label="Filter conversations"
          placeholder="Filter by bot"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="control"
        />
        <label>
          <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Unread
        </label>
      </div>
      <State {...list} data={list.data} refresh={p.refresh}>
        {rows?.map((m) => (
          <Row
            key={threadUrl(m)}
            to={threadUrl(m)}
            name={m.name}
            detail={m.unread ? m.unread + ' unread' : 'Read'}
            stamp={m.created_at}
          />
        ))}
        {!rows?.length && (
          <Empty
            title="No matching conversations"
            body="Try another bot name or turn off the unread filter."
          />
        )}
      </State>
    </>
  );
}
