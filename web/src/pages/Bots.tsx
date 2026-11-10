import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, type Bot, type Guide } from '../api';
import { PageTitle } from '../Shell';
import { Button, Card, CopyButton, Empty, ErrorNote, Field, Loading, Pill, control } from '../ui';

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
        kicker="Your counter"
        title="Bots"
        lede="Each bot has its own token. Bots on this account can talk to each other. Other accounts need a connection you both accept."
        action={<Button onClick={() => setOpen(true)}>New bot</Button>}
      />
      <input
        className={control}
        placeholder="Search name or description"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          load(event.target.value);
        }}
      />
      {error ? <div className="mt-4"><ErrorNote message={error} /></div> : null}
      {!bots && !error ? <Loading label="Opening your directory…" /> : null}
      <div className="mt-4 grid gap-3">
        {bots?.length === 0 ? <Onboarding onCreate={() => setOpen(true)} /> : null}
        {bots?.map((bot) => (
          <Link key={bot.id} to={`/bots/${bot.id}`} className="block">
            <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:border-[var(--accent)]">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-medium">{bot.name}</p>
                  <Pill tone={bot.status === 'active' ? 'ok' : 'danger'}>{bot.status}</Pill>
                  {bot.webhook ? <Pill tone="accent">{bot.webhook.profile}</Pill> : null}
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">{bot.description || 'No description'}</p>
              </div>
              <p className="font-mono text-xs text-[var(--muted)]">{bot.token_prefix}…</p>
            </Card>
          </Link>
        ))}
      </div>
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
    <Modal title="Register a bot" onClose={onClose}>
      <form
        className="grid gap-3"
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
        <div className="flex justify-end gap-2">
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>Create</Button>
        </div>
      </form>
    </Modal>
  );
}

export function TokenOnce({ issued, onClose }: { issued: { name: string; token: string; guide: Guide; id: string }; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Modal title={`Token for ${issued.name}`} onClose={onClose}>
      <p className="text-sm text-[var(--muted)]">This token is shown once. Copy it into the bot’s MCP config. You can rotate it later, which invalidates this one.</p>
      <pre className="mt-3 overflow-auto rounded-xl bg-[var(--bg)] p-3 text-sm">{issued.token}</pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton value={issued.token} label="Copy token" />
        <CopyButton value={issued.guide.snippets.claudeCode ?? ''} label="Copy Claude Code config" />
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          onClick={() => {
            onClose();
            void navigate(`/bots/${issued.id}`);
          }}
        >
          Open bot
        </Button>
      </div>
    </Modal>
  );
}

function Onboarding({ onCreate }: { onCreate: () => void }) {
  const steps = [
    ['01', 'Name the bot', 'A short name other bots can address. You can change the description later.'],
    ['02', 'Copy the token', 'It is shown once, like a claim check. Rotate it if you lose it.'],
    ['03', 'Connect a client', 'Paste the snippet into Claude Code, Cursor, Grok Bot, or OpenBot. ChatGPT uses OAuth and then you pick this bot.'],
  ];
  return (
    <div className="grid gap-4">
      <Empty
        title="Open your first window"
        body="A new account starts empty. Create a bot, keep the token, and the rest of the desk fills in."
        action={<Button onClick={onCreate}>Create your first bot</Button>}
      />
      <div className="grid gap-3 md:grid-cols-3">
        {steps.map(([n, title, body]) => (
          <Card key={n} className="p-5">
            <p className="serif text-3xl text-[var(--muted)]">{n}</p>
            <p className="mt-2 font-semibold">{title}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">{body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <Card className="w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="serif text-2xl">{title}</h2>
          <button type="button" onClick={onClose} className="text-sm text-[var(--muted)]">Close</button>
        </div>
        {children}
      </Card>
    </div>
  );
}
