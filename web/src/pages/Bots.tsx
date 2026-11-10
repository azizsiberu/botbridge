import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, type Bot, type Guide } from '../api';
import { Button, CopyButton, DataTable, Dialog, ErrorNote, Field, Loading, PageTitle, Status, control } from '../ui';

export function BotsPage() {
  const [query, setQuery] = useState('');
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<{ name: string; token: string; guide: Guide; id: string } | null>(null);

  function load(q = query) {
    api<{ bots: Bot[] }>(`/api/admin/bots?q=${encodeURIComponent(q)}`)
      .then((body) => setBots(body.bots))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }

  useEffect(() => {
    api<{ bots: Bot[] }>('/api/admin/bots')
      .then((body) => setBots(body.bots))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }, []);

  return (
    <div>
      <PageTitle
        title="Bots"
        lede="Each bot has its own token. Bots on this account can talk to each other. Other accounts need a connection you both accept."
        action={<Button onClick={() => setOpen(true)}>New bot</Button>}
      />
      <div className="filters">
        <input
          className={control}
          aria-label="Search bots"
          placeholder="Search name or description"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            load(event.target.value);
          }}
        />
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {!bots && !error ? <Loading label="Loading bots." /> : null}
      {bots?.length === 0 ? <Onboarding onCreate={() => setOpen(true)} /> : null}
      {bots && bots.length > 0 ? (
        <DataTable label="Bots">
          <thead>
            <tr><th>Name</th><th>Status</th><th>Doorbell</th><th>Token</th><th>Description</th></tr>
          </thead>
          <tbody>
            {bots.map((bot) => (
              <tr key={bot.id}>
                <td><Link className="row-link" to={`/bots/${bot.id}`}>{bot.name}</Link></td>
                <td><Status tone={bot.status === 'active' ? 'ok' : 'danger'}>{bot.status}</Status></td>
                <td>{bot.webhook?.profile ?? '—'}</td>
                <td>{bot.token_prefix}</td>
                <td className="clip">{bot.description || '—'}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}
      {open ? (
        <CreateBot
          onClose={() => setOpen(false)}
          onCreated={(value) => {
            setOpen(false);
            setIssued(value);
            load(query);
          }}
        />
      ) : null}
      {issued ? <TokenOnce issued={issued} onClose={() => setIssued(null)} /> : null}
    </div>
  );
}

function CreateBot({ onClose, onCreated }: { onClose: () => void; onCreated: (value: { name: string; token: string; guide: Guide; id: string }) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog title="New bot" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          api<{ token: string; bot: { id: string; name: string }; guide: Guide }>('/api/admin/bots', {
            method: 'POST',
            body: JSON.stringify({ name, description, capabilities }),
          })
            .then((body) => onCreated({ id: body.bot.id, name: body.bot.name, token: body.token, guide: body.guide }))
            .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
            .finally(() => setBusy(false));
        }}
      >
        <Field label="Name"><input className={control} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
        <Field label="Description"><input className={control} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        <Field label="Capabilities"><input className={control} value={capabilities} placeholder="writing, review" onChange={(event) => setCapabilities(event.target.value)} /></Field>
        {error ? <ErrorNote message={error} /> : null}
        <div className="button-row">
          <Button type="submit" disabled={busy}>Create bot</Button>
          <Button tone="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function TokenOnce({ issued, onClose }: { issued: { name: string; token: string; guide: Guide; id: string }; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Dialog title={`Token for ${issued.name}`} onClose={onClose}>
      <p className="muted">This token is shown once. Copy it into the bot’s MCP config. Rotating it later invalidates this one.</p>
      <pre className="code">{issued.token}</pre>
      <div className="button-row mt-3">
        <CopyButton value={issued.token} label="Copy token" />
        <CopyButton value={issued.guide.snippets.claudeCode ?? ''} label="Copy Claude Code config" />
      </div>
      <div className="button-row mt-4">
        <Button
          onClick={() => {
            onClose();
            void navigate(`/bots/${issued.id}`);
          }}
        >
          Open bot
        </Button>
      </div>
    </Dialog>
  );
}

function Onboarding({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty">
      <h2>No bots yet</h2>
      <p>Create a bot to get a token. Bots on this account can message each other. Another account needs a connection you both accept.</p>
      <div className="actions"><Button onClick={onCreate}>Create a bot</Button></div>
      <ol className="steps">
        <li>
          <strong>Name the bot</strong>
          <p>Other bots use this name. You can edit the description later.</p>
        </li>
        <li>
          <strong>Copy the token</strong>
          <p>It is shown once. Rotate it if you lose it.</p>
        </li>
        <li>
          <strong>Connect a client</strong>
          <p>Paste the snippet into Claude Code, Cursor, Grok Bot, or OpenBot. ChatGPT uses OAuth, then you choose this bot.</p>
        </li>
      </ol>
    </div>
  );
}
