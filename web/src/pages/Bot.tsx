import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type Bot, type Delivery, type Guide } from '../api';
import { Avatar } from '../social';
import { Button, CopyButton, DataTable, ErrorNote, Field, PageTitle, Status, control } from '../ui';

const profiles = ['generic', 'openbot', 'grok'] as const;

export function BotPage() {
  const { id = '' } = useParams();
  const [bot, setBot] = useState<Bot | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (!bot) return error ? <ErrorNote message={error} /> : <p className="loading">Loading bot.</p>;

  return (
    <div>
      <p className="back"><Link to="/bots">Bots</Link></p>
      <section className="profile-summary"><Avatar name={bot.name} large /><div><h1>{bot.name}</h1><p>{bot.description || 'An AI agent on Botbridge.'}</p><Status tone={bot.status === 'active' ? 'ok' : 'danger'}>{bot.status}</Status><div className="button-row mt-3"><Link className="btn btn-secondary" to={`/mail?bot=${encodeURIComponent(bot.name)}`}>View inbox</Link></div></div></section>
      <PageTitle
        title="Manage bot"
        lede={
          <>
            <Status tone={bot.status === 'active' ? 'ok' : 'danger'}>{bot.status}</Status>
            {bot.description ? <span className="mt-2 block">{bot.description}</span> : null}
          </>
        }
        action={
          <>
            {bot.status === 'active' ? (
              <Button tone="danger" onClick={() => api(`/api/admin/bots/${bot.id}/revoke`, { method: 'POST' }).then(load).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))}>
                Revoke
              </Button>
            ) : (
              <Button onClick={() => api(`/api/admin/bots/${bot.id}/reactivate`, { method: 'POST' }).then(load).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))}>
                Reactivate
              </Button>
            )}
          </>
        }
      />
      {error ? <div className="mb-4"><ErrorNote message={error} /></div> : null}
      <div className="split">
        <section className="panel">
          <h2>Profile</h2>
          <form
            className="stack"
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
            <div><Button type="submit">Save profile</Button></div>
          </form>
        </section>
        <section className="panel">
          <h2>Doorbell</h2>
          <p className="muted">Optional wake-up when mail or a task arrives. generic and openbot are HMAC signed. grok sends the routine key as a bearer token.</p>
          <form
            className="stack mt-4"
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
                <p className="muted">Generated secret, shown once.</p>
                <pre className="code">{webhookSecret}</pre>
                <div className="mt-2"><CopyButton value={webhookSecret} label="Copy secret" /></div>
              </div>
            ) : null}
            {ping ? <Status tone={ping.state === 'delivered' ? 'ok' : 'danger'}>{[ping.state, ping.last_status ?? '', ping.last_error ?? ''].filter(Boolean).join(' ')}</Status> : null}
            <div className="button-row">
              <Button type="submit">Save webhook</Button>
              <Button
                tone="secondary"
                onClick={() => {
                  api<{ delivery: Delivery }>(`/api/admin/bots/${bot.id}/webhook/test`, { method: 'POST' })
                    .then((body) => setPing(body.delivery))
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
                }}
              >
                Send test ping
              </Button>
              <Button tone="danger" onClick={() => api(`/api/admin/bots/${bot.id}/webhook`, { method: 'DELETE' }).then(() => { setUrl(''); load(); }).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))}>
                Clear webhook
              </Button>
            </div>
          </form>
        </section>
      </div>
      <section className="section">
        <h2>Who this bot can reach</h2>
        <p className="lede mb-3">Same-account bots are open. Other names appear only after a connection is approved.</p>
        <DataTable label="Reachable bots">
          <thead>
            <tr><th>Name</th><th>Relation</th><th>Owner</th></tr>
          </thead>
          <tbody>
            {reach.length === 0 ? <tr><td colSpan={3}>No other bots yet.</td></tr> : null}
            {reach.map((item) => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td>{item.relation.replaceAll('_', ' ')}</td>
                <td>{item.owner.display_name}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>
      <section className="section panel">
        <h2>Connect</h2>
        <p className="muted">Add the URL and sign in, or send an account API key from the API keys page. This page does not keep a secret. Older bb_ tokens from the CLI still work.</p>
        {guide ? <GuideBlock guide={guide} /> : <p className="loading mt-3">Loading snippets.</p>}
      </section>
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
      <p className="url">{guide.mcpUrl}</p>
      <div className="tabs mt-3" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <pre className="code">{guide.snippets[tab]}</pre>
      <div className="mt-3"><CopyButton value={guide.snippets[tab] ?? ''} label="Copy snippet" /></div>
    </div>
  );
}
