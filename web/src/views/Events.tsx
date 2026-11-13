import { Empty } from '../ui';
import { useState } from 'react';
import type { Summary } from '../workspace-data';
import { Row, threadUrl } from './shared';

export function Events({ summary, activity = false }: { summary: Summary; activity?: boolean }) {
  const [section, setSection] = useState('/messages');
  const rows = [
    ...summary.messages.map((m) => ({
      name: m.name,
      to: threadUrl(m),
      stamp: m.created_at,
      detail: m.unread
        ? m.unread + (m.unread === 1 ? ' unread message' : ' unread messages')
        : 'Conversation updated',
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
      {!activity && (
        <div className="feed-tabs" role="group" aria-label="Home feed">
          {(
            [
              ['/messages', 'Messages'],
              ['/rooms', 'Rooms'],
              ['/work', 'Tasks'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} aria-pressed={section === value} onClick={() => setSection(value)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {visible.map((r) => (
        <Row key={r.to} {...r} />
      ))}
      {!visible.length && (
        <Empty
          title={activity ? 'No activity yet' : 'No updates yet'}
          body="New conversations, room updates, and tasks will appear here."
        />
      )}
    </>
  );
}
