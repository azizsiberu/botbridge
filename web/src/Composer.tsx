import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { base, post, useData, type Agent, type ReachableBot, type RoomSummary } from './workspace-data';
import { ErrorNote, Field, Loading } from './ui';

export type Mode = 'Message' | 'Room post' | 'Task' | 'Broadcast';
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
type UploadConfig = { direct: boolean; maxBytes: number; allowedTypes: string[] };
async function attach(root: string, file: File, config: UploadConfig) {
  if (file.size > config.maxBytes) throw Error('File exceeds the upload limit.');
  const metadata = { filename: file.name, mimeType: file.type || 'application/octet-stream' };
  if (config.direct) {
    const ticket = await post<{ file: { id: string }; upload: { url: string; headers: Record<string, string> } }>(
      root + '/uploads',
      { ...metadata, size: file.size },
    );
    const response = await fetch(ticket.upload.url, { method: 'PUT', headers: ticket.upload.headers, body: file });
    if (!response.ok) throw Error('Upload failed. Try again.');
    return (await post<{ id: string }>(root + '/uploads/' + ticket.file.id + '/complete')).id;
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error('Could not read file.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
  return (await post<{ id: string }>(root + '/files', { ...metadata, contentBase64: data })).id;
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
  const modal = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode | undefined>(initial.mode);
  const [target, setTarget] = useState(initial.target ?? '');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const saved = useRef(false);
  const uploaded = useRef(new WeakMap<File,string>());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const root = base(bot.id);
  const [retry, setRetry] = useState(0);
  const people = useData<ReachableBot[]>(mode === 'Message' || mode === 'Task' ? root + '/directory' : '', retry);
  const rooms = useData<RoomSummary[]>(mode === 'Room post' ? root + '/rooms' : '', retry);
  const choices = mode === 'Room post' ? rooms.data : people.data;
  const sourceError = people.error || rooms.error;
  useEffect(() => {
    const el = modal.current!;
    el.showModal();
    return () => el.close();
  }, []);
  useEffect(() => {
    if (error && !busy) modal.current?.querySelector('textarea')?.focus();
  }, [error, busy]);
  function cancel() {
    if (!lock.current && (!(text || files.length) || window.confirm('Discard this draft?'))) close();
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
          const id = uploaded.current.get(file) ?? await attach(root, file, config);
          uploaded.current.set(file,id);
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
              ' has this message in its inbox. It has no doorbell webhook, so it will not wake up. On that bot\'s page, set a webhook URL, a profile (generic, openbot, or grok), and a secret.',
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
    <dialog aria-labelledby="compose-title"
      className="compose-dialog"
      ref={modal}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:enabled, select:enabled, textarea:enabled, input:enabled'));
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <header>
        <h2 id="compose-title">{mode ?? 'Compose'}</h2>
        <button type="button" disabled={busy} onClick={cancel}>
          Close
        </button>
      </header>
      <p className="muted">From {bot.name}</p>
      {!mode ? (
        <div className="compose-options">
          {(['Message', 'Room post', 'Task', 'Broadcast'] as const).map((item) => (
            <button key={item} onClick={() => setMode(item)}>
              {item}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {mode === 'Broadcast' ? (
            <p>Audience: every other bot you can reach, including approved connections.</p>
          ) : (
            <Field label={mode === 'Room post' ? 'Room' : 'To'}>
              <select aria-label={mode === 'Room post' ? 'Room' : 'To'}
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
          {!choices && mode !== 'Broadcast' && !sourceError && <Loading label="Loading destinations." />}
          <Field label={mode === 'Task' ? 'Instructions' : 'Message'}>
            <textarea aria-label={mode === 'Task' ? 'Instructions' : 'Message'}
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
                multiple
                disabled={busy}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            </Field>
          )}
          {error && <ErrorNote message={error} />}
          {notice ? <p role="status">{notice}</p> : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!notice && (busy || !text.trim() || (mode !== 'Broadcast' && !choices?.some((x) => x.id === target)))}
            onClick={() => {
              if (notice) sent();
              else void send();
            }}
          >
            {notice ? 'Close' : busy ? 'Sending…' : sendLabel(mode)}
          </button>
        </form>
      )}
    </dialog>
  );
}
