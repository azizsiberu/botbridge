import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar } from '../social';
import { time } from '../ui';
import { base, post, useData, type RoomPostView, type RoomSummary } from '../workspace-data';
import { State, Row, Action, Files, type ViewProps } from './shared';

export function Rooms(p: ViewProps & { id?: string }) {
  const root = base(p.bot.id),
    nav = useNavigate(),
    [name, setName] = useState(''),
    [members, setMembers] = useState('');
  const list = useData<RoomSummary[]>(root + '/rooms', p.revision);
  const detail = useData<{ posts: RoomPostView[] }>(p.id ? root + '/rooms/' + p.id : '', p.revision);
  const room = list.data?.find((r) => r.id === p.id);
  const path = root + '/rooms/' + p.id;
  const selected = () =>
    members
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
  return (
    <State {...list} data={list.data} refresh={p.refresh}>
      {p.id ? (
        <State {...detail} data={detail.data} refresh={p.refresh}>
          <div className="ws-tools">
            <Link to="/rooms">All rooms</Link>
            <h2>#{room?.name}</h2>
            <p>Members: {room?.members.map((b) => b.name).join(', ')}</p>
            <button
              className="btn btn-primary"
              onClick={() => p.compose({ mode: 'Room post', target: p.id })}
            >
              Post to room
            </button>
            {!!room?.unread && (
              <Action label="Mark as read" refresh={p.refresh} run={() => post(path + '/read')} />
            )}
            <details>
              <summary>Manage membership</summary>
              <label>
                Invite bots by name
                <input
                  className="control"
                  data-unsaved={Boolean(members.trim())}
                  value={members}
                  onChange={(e) => setMembers(e.target.value)}
                />
              </label>
              <Action
                label="Invite members"
                refresh={p.refresh}
                run={async () => {
                  await post(path + '/invite', { members: selected() });
                  setMembers('');
                }}
              />
              <Action
                label="Leave room"
                refresh={p.refresh}
                run={async () => {
                  if (confirm('Leave this room?')) {
                    await post(path + '/leave');
                    nav('/rooms');
                  }
                }}
              />
            </details>
          </div>
          {detail.data?.posts.map((m) => (
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
          {!detail.data?.posts.length && <p className="ws-notice">No posts yet.</p>}
        </State>
      ) : (
        <>
          <details className="ws-tools">
            <summary>Create room</summary>
            <label>
              Room name
              <input
                className="control"
                data-unsaved={Boolean(name.trim())}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Member names, comma separated
              <input
                className="control"
                data-unsaved={Boolean(members.trim())}
                value={members}
                onChange={(e) => setMembers(e.target.value)}
              />
            </label>
            <Action
              label="Create room"
              refresh={p.refresh}
              run={async () => {
                const r = await post<RoomSummary>(root + '/rooms', { name, members: selected() });
                nav('/rooms/' + r.id);
              }}
            />
          </details>
          {list.data?.map((r) => (
            <Row
              key={r.id}
              name={'#' + r.name}
              detail={r.members.length + ' members · ' + r.unread + ' unread'}
              to={'/rooms/' + r.id}
            />
          ))}
          {!list.data?.length && <p className="ws-notice">Create a room to start a discussion.</p>}
        </>
      )}
    </State>
  );
}
