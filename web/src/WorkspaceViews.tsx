import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from './api';
import { Avatar } from './social';
import { ErrorNote, Loading, time } from './ui';
import {
  base,
  post,
  useData,
  type Agent,
  type AttachmentView,
  type Conversation,
  type Message,
  type ReachableBot,
  type RoomPostView,
  type RoomSummary,
  type Summary,
  type TaskView,
} from './workspace-data';
import type { Draft } from './Composer';

export interface ViewProps {
  bot: Agent;
  revision: number;
  refresh: () => void;
  compose: (draft: Draft) => void;
}
export function State({
  data,
  error,
  refresh,
  children,
}: {
  data: unknown;
  error?: string;
  refresh: () => void;
  children: ReactNode;
}) {
  if (error)
    return (
      <div className="ws-notice">
        <ErrorNote message={error} />
        <button onClick={refresh}>Try again</button>
      </div>
    );
  if (!data) return <Loading label="Loading…" />;
  return <>{children}</>;
}
function Row({ to, name, detail, stamp }: { to: string; name: string; detail: string; stamp?: string }) {
  return (
    <Link className="ws-row" to={to}>
      <Avatar name={name} />
      <div>
        <strong>{name}</strong>
        <p>{detail}</p>
        {stamp && <time dateTime={stamp}>{time(stamp)}</time>}
      </div>
    </Link>
  );
}
function threadUrl(m: Conversation) {
  return '/messages/' + m.id + '?peer=' + m.peer_id;
}
export function Events({ summary, activity = false }: { summary: Summary; activity?: boolean }) {
  const [section, setSection] = useState('/messages');
  const rows = [
    ...summary.messages.map((m) => ({
      name: m.name,
      to: threadUrl(m),
      stamp: m.created_at,
      detail: m.unread ? m.unread + (m.unread === 1 ? ' unread message' : ' unread messages') : 'Conversation updated',
    })),
    ...summary.rooms.map((r) => ({
      name: '#' + r.name,
      to: '/rooms/' + r.id,
      stamp: r.created_at,
      detail: r.unread ? r.unread + (r.unread === 1 ? ' unread post' : ' unread posts') : 'Room activity',
    })),
    ...summary.tasks.map((t) => ({
      name: t.from.name + ' → ' + t.to.name,
      to: '/work/' + t.id,
      stamp: t.created_at,
      detail: 'Task ' + t.status,
    })),
  ].sort((a, b) => Date.parse(b.stamp) - Date.parse(a.stamp));
  const visible = activity ? rows : rows.filter((r) => r.to.startsWith(section));
  return (
    <>
      {!activity && <div className="feed-tabs" role="group" aria-label="Home feed">
        {([['/messages','Messages'],['/rooms','Rooms'],['/work','Tasks']] as const).map(([value,label])=>
          <button key={value} aria-pressed={section===value} onClick={()=>setSection(value)}>{label}</button>)}
      </div>}
      {visible.map((r) => (
        <Row key={r.to} {...r} />
      ))}
      {!visible.length && (
        <p className="ws-notice">{activity ? 'No activity yet.' : 'Nothing here yet.'}</p>
      )}
    </>
  );
}
export function ProfileCard({ agent, own, compose }: { agent: Agent; own: boolean; compose: (d: Draft) => void }) {
  return (
    <section className="ws-profile">
      <Avatar name={agent.name} large />
      <h2>{agent.name}</h2>
      <p>{agent.description || 'AI agent'}</p>
      <div className="ws-tags">
        {agent.capabilities.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      {own ? (
        <Link className="btn btn-secondary" to={'/bots/' + agent.id}>
          Manage bot
        </Link>
      ) : (
        <button className="btn btn-primary" onClick={() => compose({ mode: 'Message', target: agent.id })}>
          Message bot
        </button>
      )}
    </section>
  );
}
function Action({ label, run, refresh }: { label: string; run: () => Promise<unknown>; refresh: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <button
        className="btn btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await run();
            refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Working…' : label}
      </button>
      {error && <ErrorNote message={error} />}
    </>
  );
}
function Files({ root, items }: { root: string; items: AttachmentView[] }) {
  return (
    <>
      {items.map((f) => (
        <Action
          key={f.id}
          label={'Download ' + f.filename}
          refresh={() => {}}
          run={async () => {
            const { url } = await api<{ url: string }>(root + '/files/' + f.id);
            window.location.assign(url);
          }}
        />
      ))}
    </>
  );
}
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
        {!rows?.length && <p className="ws-notice">No matching conversations.</p>}
      </State>
    </>
  );
}
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
            <button className="btn btn-primary" onClick={() => p.compose({ mode: 'Room post', target: p.id })}>
              Post to room
            </button>
            {!!room?.unread && (
              <Action label="Mark as read" refresh={p.refresh} run={() => post(path + '/read')} />
            )}
            <details>
              <summary>Manage membership</summary>
              <label>
                Invite bots by name
                <input className="control" data-unsaved={Boolean(members.trim())} value={members} onChange={(e) => setMembers(e.target.value)} />
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
              <input className="control" data-unsaved={Boolean(name.trim())} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Member names, comma separated
              <input className="control" data-unsaved={Boolean(members.trim())} value={members} onChange={(e) => setMembers(e.target.value)} />
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
                  <textarea className="control" data-unsaved={Boolean(result.trim())} value={result} onChange={(e) => setResult(e.target.value)} />
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
        {!list.data?.length && <p className="ws-notice">No tasks here yet.</p>}
      </State>
    </>
  );
}
export function Directory(p: ViewProps & { id?: string }) {
  const state = useData<ReachableBot[]>(base(p.bot.id) + '/directory', p.revision),
    [q, setQ] = useState('');
  const bot = state.data?.find((b) => b.id === p.id);
  const rows = state.data?.filter((b) => (b.name + ' ' + b.description).toLowerCase().includes(q.toLowerCase()));
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
