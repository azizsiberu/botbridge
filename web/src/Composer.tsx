import { useRef, useState } from 'react';
import { api } from './api';
import { base, post, useData, type Agent, type ReachableBot, type RoomSummary } from './workspace-data';
import { Form, Button, Empty, ErrorNote, Field, Loading } from './ui';
import { Modal } from './components/Modal';
import { attach, type UploadConfig } from './lib/attachments';
import { Icon, type IconName } from './social';

export type Mode = 'Message' | 'Room post' | 'Task' | 'Broadcast';
const modes: { mode: Mode; icon: IconName; description: string }[] = [
  { mode: 'Message', icon: 'Messages', description: 'Start a private conversation with a bot.' },
  { mode: 'Room post', icon: 'Rooms', description: 'Share an update with a room.' },
  { mode: 'Task', icon: 'Tasks', description: 'Assign work and follow the result.' },
  { mode: 'Broadcast', icon: 'Activity', description: 'Reach every bot you are connected to.' },
];
function sendLabel(mode: Mode): string {
  if (mode === 'Task') return 'Assign task';
  if (mode === 'Room post') return 'Post to room';
  if (mode === 'Broadcast') return 'Review broadcast';
  return 'Send message';
}
export interface Draft {
  mode?: Mode;
  target?: string;
  thread?: string;
}
export function Composer({
  bot,
  initial,
  close,
  sent,
}: {
  bot: Agent;
  initial: Draft;
  close: () => void;
  sent: () => void;
}) {
  const [mode, setMode] = useState<Mode | undefined>(initial.mode);
  const [target, setTarget] = useState(initial.target ?? '');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const saved = useRef(false);
  const uploaded = useRef(new WeakMap<File, string>());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const root = base(bot.id);
  const [retry, setRetry] = useState(0);
  const people = useData<ReachableBot[]>(
    mode === 'Message' || mode === 'Task' ? root + '/directory' : '',
    retry,
  );
  const rooms = useData<RoomSummary[]>(mode === 'Room post' ? root + '/rooms' : '', retry);
  const choices = mode === 'Room post' ? rooms.data : people.data;
  const sourceError = people.error || rooms.error;
  function cancel() {
    if (lock.current) return;
    if (saved.current) {
      sent();
      return;
    }
    if (!(text || files.length) || window.confirm('Discard this draft?')) close();
  }

  async function send() {
    if (lock.current || saved.current || !mode) return;
    if (mode !== 'Broadcast' && !target) {
      setError(mode === 'Room post' ? 'Choose a room.' : 'Choose a bot.');
      return;
    }
    if (
      mode === 'Broadcast' &&
      !confirm('Send this broadcast to every other reachable bot, including approved connections?')
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const ids: string[] = [];
      if (files.length) {
        const config = await api<UploadConfig>(root + '/uploads');
        for (const file of files) {
          const id = uploaded.current.get(file) ?? (await attach(root, file, config));
          uploaded.current.set(file, id);
          ids.push(id);
        }
      }
      if (mode === 'Message') {
        const body: { to: string; text: string; threadId?: string; attachments: string[] } = {
          to: target,
          text,
          attachments: ids,
        };
        if (initial.thread) body.threadId = initial.thread;
        const result = await post<{ doorbell: boolean; to: { name: string } }>(root + '/messages', body);
        if (!result.doorbell) {
          saved.current = true;
          setNotice(
            result.to.name +
              " has this message in its inbox. It has no doorbell webhook, so it will not wake up. On that bot's page, set a webhook URL, a profile (generic, openbot, or grok), and a secret.",
          );
          return;
        }
      }
      if (mode === 'Room post') await post(root + '/rooms/' + target + '/posts', { text, attachments: ids });
      if (mode === 'Task') await post(root + '/tasks', { to: target, instructions: text });
      if (mode === 'Broadcast') await post(root + '/broadcast', { text });
      saved.current = true;
      sent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title={mode ?? 'Compose'} className="compose-dialog" busy={busy} onClose={cancel}>
      <p className="muted">From {bot.name}</p>
      {!mode ? (
        <div className="compose-options">
          {modes.map(({ mode: item, icon, description }) => (
            <button type="button" key={item} onClick={() => setMode(item)}>
              <Icon name={icon} />
              <span>
                <strong>{item}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            return send();
          }}
        >
          {mode === 'Broadcast' ? (
            <p>Audience: every other bot you can reach, including approved connections.</p>
          ) : (
            <Field label={mode === 'Room post' ? 'Room' : 'To'}>
              <select
                aria-label={mode === 'Room post' ? 'Room' : 'To'}
                className="control"
                required
                disabled={busy || !!initial.thread}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Choose {mode === 'Room post' ? 'a room' : 'a bot'}</option>
                {choices?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {sourceError && (
            <>
              <ErrorNote message={sourceError} />
              <button type="button" onClick={() => setRetry((n) => n + 1)}>
                Try again
              </button>
            </>
          )}
          {choices?.length === 0 && mode !== 'Broadcast' && (
            <Empty
              title={mode === 'Room post' ? 'No rooms available' : 'No reachable bots'}
              body={
                mode === 'Room post'
                  ? 'Create a room before posting an update.'
                  : 'Connect another bot before sending a message or assigning a task.'
              }
            />
          )}
          {!choices && mode !== 'Broadcast' && !sourceError && (
            <Loading label="Loading destinations." inline />
          )}
          <Field label={mode === 'Task' ? 'Instructions' : 'Message'}>
            <textarea
              aria-label={mode === 'Task' ? 'Instructions' : 'Message'}
              autoFocus
              required
              rows={5}
              className="control"
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          {(mode === 'Message' || mode === 'Room post') && (
            <Field label="Attachments">
              <input
                type="file"
                className="control"
                multiple
                disabled={busy}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            </Field>
          )}
          {error && <ErrorNote message={error} />}
          {notice ? <p role="status">{notice}</p> : null}
          <Button
            type={notice ? 'button' : 'submit'}
            busy={busy}
            pendingLabel="Sending…"
            disabled={
              !notice &&
              (busy || !text.trim() || (mode !== 'Broadcast' && !choices?.some((x) => x.id === target)))
            }
            onClick={notice ? sent : undefined}
          >
            {notice ? 'Close' : sendLabel(mode)}
          </Button>
        </Form>
      )}
    </Modal>
  );
}
