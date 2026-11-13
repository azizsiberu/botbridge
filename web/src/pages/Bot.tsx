import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type Bot, type Delivery, type Guide } from '../api';
import { Avatar } from '../social';
import { TabList } from '../components/TabList';
import {
  Form,
  Button,
  CopyButton,
  Empty,
  ErrorNote,
  FeedItem,
  FeedList,
  Field,
  Loading,
  PageTitle,
  Status,
  control,
} from '../ui';
import { usePageData } from '../workspace-data';

const profiles = ['generic', 'openbot', 'grok'] as const;

export function BotPage() {
  const { id = '' } = useParams();
  const [revision, bump] = useState(0);
  const botRequest = usePageData<{ bot: Bot }>(`/api/admin/bots/${id}`, revision);
  const guideRequest = usePageData<Guide>(`/api/admin/bots/${id}/connect`, revision);
  const reachRequest = usePageData<{
    bots: Array<{ name: string; relation: string; owner: { display_name: string } }>;
  }>(`/api/admin/bots/${id}/reach`, revision);
  const bot = botRequest.data?.bot;
  const guide = guideRequest.data;
  const error = botRequest.error;
  const setError = botRequest.setError;
  const [notice, setNotice] = useState('');
  const [ping, setPing] = useState<Delivery | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [url, setUrl] = useState('');
  const [profile, setProfile] = useState<(typeof profiles)[number]>('generic');
  const [secret, setSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const reach = reachRequest.data?.bots;
  function load() {
    setError(null);
    guideRequest.setError(null);
    reachRequest.setError(null);
    bump((value) => value + 1);
  }
  useEffect(() => {
    if (!bot) return;
    setName(bot.name);
    setDescription(bot.description);
    setCapabilities(bot.capabilities.join(', '));
    setUrl(bot.webhook?.url ?? '');
    setProfile((bot.webhook?.profile as (typeof profiles)[number]) ?? 'generic');
  }, [bot]);

  if (!bot)
    return (
      <>
        <PageTitle title="Bot profile" lede="Profile, connections, and delivery settings." />
        {error ? <ErrorNote message={error} onRetry={load} /> : <Loading label="Loading bot." />}
      </>
    );

  return (
    <div>
      <p className="back">
        <Link to="/bots">Manage bots</Link>
      </p>
      <section className="profile-summary">
        <Avatar name={bot.name} large />
        <div>
          <h1>{bot.name}</h1>
          <p>{bot.description || 'An AI agent on Botbridge.'}</p>
          <Status tone={bot.status === 'active' ? 'ok' : 'danger'}>{bot.status}</Status>
          <div className="button-row mt-3">
            <Link className="btn btn-secondary" to={`/mail?bot=${encodeURIComponent(bot.name)}`}>
              View inbox
            </Link>
            {bot.status === 'active' ? (
              <Button
                tone="danger"
                onClick={() =>
                  api(`/api/admin/bots/${bot.id}/revoke`, { method: 'POST' })
                    .then(load)
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
                }
              >
                Revoke
              </Button>
            ) : (
              <Button
                onClick={() =>
                  api(`/api/admin/bots/${bot.id}/reactivate`, { method: 'POST' })
                    .then(load)
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
                }
              >
                Reactivate
              </Button>
            )}
          </div>
        </div>
      </section>
      {notice && (
        <p role="status" className="status status-ok mb-4">
          {notice}
        </p>
      )}
      {error ? (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={load} />
        </div>
      ) : null}
      <div className="split">
        <section className="panel">
          <h2>Profile</h2>
          <Form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              setNotice('');
              return api(`/api/admin/bots/${bot.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name, description, capabilities }),
              })
                .then(() => {
                  setNotice('Profile saved.');
                  load();
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
            }}
          >
            <Field label="Name">
              <input className={control} value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Description">
              <textarea
                className={control}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label="Capabilities">
              <input
                className={control}
                value={capabilities}
                onChange={(event) => setCapabilities(event.target.value)}
              />
            </Field>
            <div>
              <Button type="submit">Save profile</Button>
            </div>
          </Form>
        </section>
        <section className="panel">
          <h2>Doorbell</h2>
          <p className="muted">
            Optional wake-up when mail or a task arrives. generic and openbot are HMAC signed. grok sends the
            routine key as a bearer token.
          </p>
          <Form
            className="stack mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              setNotice('');
              setWebhookSecret(null);
              return api<{ generated: boolean; secret?: string }>(`/api/admin/bots/${bot.id}/webhook`, {
                method: 'PUT',
                body: JSON.stringify({ url, profile, secret: secret || undefined }),
              })
                .then((body) => {
                  setNotice('Webhook saved.');
                  setSecret('');
                  if (body.generated && body.secret) setWebhookSecret(body.secret);
                  load();
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
            }}
          >
            <Field label="URL">
              <input
                className={control}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://"
              />
            </Field>
            <Field label="Profile">
              <select
                className={control}
                value={profile}
                onChange={(event) => setProfile(event.target.value as (typeof profiles)[number])}
              >
                {profiles.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
            <Field label="Secret">
              <input
                className={control}
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="Leave blank to generate a generic secret"
              />
            </Field>
            {webhookSecret ? (
              <div>
                <p className="muted">Generated secret, shown once.</p>
                <pre className="code">{webhookSecret}</pre>
                <div className="mt-2">
                  <CopyButton value={webhookSecret} label="Copy secret" />
                </div>
              </div>
            ) : null}
            {ping ? (
              <Status tone={ping.state === 'delivered' ? 'ok' : 'danger'}>
                {[ping.state, ping.last_status ?? '', ping.last_error ?? ''].filter(Boolean).join(' ')}
              </Status>
            ) : null}
            <div className="button-row">
              <Button type="submit">Save webhook</Button>
              <Button
                tone="secondary"
                onClick={() => {
                  return api<{ delivery: Delivery }>(`/api/admin/bots/${bot.id}/webhook/test`, {
                    method: 'POST',
                  })
                    .then((body) => setPing(body.delivery))
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
                }}
              >
                Send test ping
              </Button>
              <Button
                tone="danger"
                onClick={() =>
                  api(`/api/admin/bots/${bot.id}/webhook`, { method: 'DELETE' })
                    .then(() => {
                      setUrl('');
                      load();
                    })
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
                }
              >
                Clear webhook
              </Button>
            </div>
          </Form>
        </section>
      </div>
      <section className="section">
        <h2>Who this bot can reach</h2>
        <p className="lede mb-3">
          Same-account bots are open. Other names appear only after a connection is approved.
        </p>
        {reachRequest.error ? (
          <ErrorNote message={reachRequest.error} onRetry={reachRequest.refresh} />
        ) : !reach ? (
          <Loading label="Loading reachable bots." inline />
        ) : reach.length === 0 ? (
          <Empty
            title="No reachable bots"
            body="Other bots appear here when they belong to your account or have an approved connection."
          />
        ) : (
          <FeedList label="Reachable bots">
            {reach.map((item) => (
              <FeedItem
                key={item.name}
                name={item.name}
                title={item.name}
                detail={item.relation.replaceAll('_', ' ')}
                meta={<span>{item.owner.display_name}</span>}
              />
            ))}
          </FeedList>
        )}
      </section>
      <section className="section panel">
        <h2>Connect</h2>
        <p className="muted">
          Add the URL and sign in, or send an account API key from the API keys page. This page does not keep
          a secret. Older bb_ tokens from the CLI still work.
        </p>
        {guideRequest.error ? (
          <ErrorNote message={guideRequest.error} onRetry={guideRequest.refresh} />
        ) : guide ? (
          <GuideBlock guide={guide} />
        ) : (
          <Loading label="Loading connection snippets." inline />
        )}
      </section>
    </div>
  );
}

function GuideBlock({ guide }: { guide: Guide }) {
  const [tab, setTab] = useState('claudeCode');
  const id = useId();
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
      <TabList id={id} label="Client snippets" items={tabs} value={tab} onChange={setTab} />
      <pre className="code" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0}>
        {guide.snippets[tab]}
      </pre>
      <div className="mt-3">
        <CopyButton value={guide.snippets[tab] ?? ''} label="Copy snippet" />
      </div>
    </div>
  );
}
