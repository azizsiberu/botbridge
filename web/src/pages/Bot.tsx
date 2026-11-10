import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type Bot, type Delivery, type Guide } from '../api';
import { PageTitle } from '../Shell';
import { Button, Card, CopyButton, ErrorNote, Field, Pill, control } from '../ui';
import { TokenOnce } from './Bots';

const profiles = ['generic', 'openbot', 'grok'] as const;

export function BotPage() {
  const { id = '' } = useParams();
  const [bot, setBot] = useState<Bot | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; token: string; guide: Guide; id: string } | null>(null);
  const [ping, setPing] = useState<Delivery | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [url, setUrl] = useState('');
  const [profile, setProfile] = useState<(typeof profiles)[number]>('generic');
  const [secret, setSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [reach, setReach] = useState<Array<{ name: string; relation: string; owner: { display_name: string } }>>([]);

  function load() {
    api<{ bot: Bot }>(`/api/admin/bots/${id}`)
      .then((body) => {
        setBot(body.bot);
        setName(body.bot.name);
        setDescription(body.bot.description);
        setCapabilities(body.bot.capabilities.join(', '));
        setUrl(body.bot.webhook?.url ?? '');
        setProfile((body.bot.webhook?.profile as (typeof profiles)[number]) ?? 'generic');
        setReach([]);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
    api<Guide>(`/api/admin/bots/${id}/connect`).then(setGuide).catch(() => undefined);
    api<{ bots: Array<{ name: string; relation: string; owner: { display_name: string } }> }>(`/api/admin/bots/${id}/reach`)
      .then((body) => setReach(body.bots))
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, [id]);

  if (!bot) return error ? <ErrorNote message={error} /> : <p className="text-[var(--muted)]">Loading bot…</p>;

  return (
    <div>
      <Link to="/bots" className="text-sm text-[var(--muted)]">← Directory</Link>
      <PageTitle
        kicker={bot.status}
        title={bot.name}
        action={
          <div className="flex gap-2">
            <Button
              tone="ghost"
              onClick={() => {
                api<{ token: string; guide: Guide }>(`/api/admin/bots/${bot.id}/rotate-token`, { method: 'POST' })
                  .then((body) => setIssued({ id: bot.id, name: bot.name, token: body.token, guide: body.guide }))
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
              }}
            >
              Rotate token
            </Button>
            {bot.status === 'active' ? (
              <Button tone="danger" onClick={() => api(`/api/admin/bots/${bot.id}/revoke`, { method: 'POST' }).then(load).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))}>
                Revoke
              </Button>
            ) : (
              <Button onClick={() => api(`/api/admin/bots/${bot.id}/reactivate`, { method: 'POST' }).then(load).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))}>
                Reactivate
              </Button>
            )}
          </div>
        }
      />
      {error ? <div className="mb-4"><ErrorNote message={error} /></div> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="serif text-2xl">Profile</h2>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              api(`/api/admin/bots/${bot.id}`, { method: 'PATCH', body: JSON.stringify({ name, description, capabilities }) })
                .then(load)
                .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
            }}
          >
            <Field label="Name"><input className={control} value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Description"><textarea className={control} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
            <Field label="Capabilities"><input className={control} value={capabilities} onChange={(event) => setCapabilities(event.target.value)} /></Field>
            <div className="flex gap-2">{bot.capabilities.map((item) => <Pill key={item}>{item}</Pill>)}</div>
            <div><Button type="submit">Save profile</Button></div>
          </form>
        </Card>
        <Card className="p-5">
          <h2 className="serif text-2xl">Doorbell</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Optional wake-up when mail or a task arrives. generic and openbot are HMAC signed. grok sends the routine key as a bearer token.</p>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setWebhookSecret(null);
              api<{ generated: boolean; secret?: string }>(`/api/admin/bots/${bot.id}/webhook`, {
                method: 'PUT',
                body: JSON.stringify({ url, profile, secret: secret || undefined }),
              })
                .then((body) => {
                  setSecret('');
                  if (body.generated && body.secret) setWebhookSecret(body.secret);
                  load();
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
            }}
          >
            <Field label="URL"><input className={control} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></Field>
            <Field label="Profile">
              <select className={control} value={profile} onChange={(event) => setProfile(event.target.value as (typeof profiles)[number])}>
                {profiles.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Secret"><input className={control} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Leave blank to generate a generic secret" /></Field>
            {webhookSecret ? (
              <div>
                <p className="mb-2 text-sm text-[var(--muted)]">Generated secret, shown once.</p>
                <pre className="overflow-auto rounded-xl bg-[var(--bg)] p-3 text-sm">{webhookSecret}</pre>
                <div className="mt-2"><CopyButton value={webhookSecret} label="Copy secret" /></div>
              </div>
            ) : null}
            {ping ? <Pill tone={ping.state === 'delivered' ? 'ok' : 'danger'}>{ping.state} {ping.last_status ?? ''} {ping.last_error ?? ''}</Pill> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save webhook</Button>
              <Button
                tone="ghost"
                onClick={() => {
                  api<{ delivery: Delivery }>(`/api/admin/bots/${bot.id}/webhook/test`, { method: 'POST' })
                    .then((body) => setPing(body.delivery))
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
                }}
              >
                Send test ping
              </Button>
              <Button tone="danger" onClick={() => api(`/api/admin/bots/${bot.id}/webhook`, { method: 'DELETE' }).then(() => { setUrl(''); load(); }).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))}>
                Clear
              </Button>
            </div>
          </form>
        </Card>
        <Card className="p-5">
          <h2 className="serif text-2xl">Who this bot can reach</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Same-account bots are open. Other names appear only after a connection is approved.</p>
          <ul className="mt-4 grid gap-2">
            {reach.map((item) => (
              <li key={item.name} className="flex items-center justify-between text-sm">
                <span>{item.name}</span>
                <span className="text-[var(--muted)]">{item.relation.replace('_', ' ')} · {item.owner.display_name}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="serif text-2xl">Connect</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Static tokens still work. OAuth clients use the URL alone. Paste a rotated token into the bearer snippets yourself — this page does not store it.</p>
          {guide ? <GuideBlock guide={guide} /> : <p className="mt-3 text-sm text-[var(--muted)]">Loading snippets…</p>}
        </Card>
      </div>
      {issued ? <TokenOnce issued={issued} onClose={() => setIssued(null)} /> : null}
    </div>
  );
}

function GuideBlock({ guide }: { guide: Guide }) {
  const [tab, setTab] = useState('claudeCode');
  const tabs = [
    ['claudeCode', 'Claude Code'],
    ['cursor', 'Cursor'],
    ['grok', 'Grok Bot'],
    ['openbot', 'OpenBot'],
    ['chatgpt', 'ChatGPT'],
    ['generic', 'Generic'],
  ] as const;
  return (
    <div className="mt-4">
      <p className="mb-2 font-mono text-xs text-[var(--muted)]">{guide.mcpUrl}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={tab === key ? 'text-sm font-medium' : 'text-sm text-[var(--muted)]'}>
            {label}
          </button>
        ))}
      </div>
      <pre className="max-h-64 overflow-auto rounded-xl bg-[var(--bg)] p-3 text-xs leading-relaxed whitespace-pre-wrap">{guide.snippets[tab]}</pre>
      <div className="mt-3"><CopyButton value={guide.snippets[tab] ?? ''} label="Copy snippet" /></div>
    </div>
  );
}
