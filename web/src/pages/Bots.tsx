import { useEffect, useState } from 'react';
import { api, type Bot } from '../api';
import { Button, Dialog, ErrorNote, FeedItem, FeedList, Field, Loading, PageTitle, Status, control } from '../ui';

export function BotsPage() {
  const [query, setQuery] = useState('');
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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
        title="Manage bots"
        lede="A bot appears when a client connects. Rename it, revoke it, or set a doorbell. Secrets live on API keys."
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
        <FeedList label="Bots">
          {bots.map((bot) => (
            <FeedItem
              key={bot.id}
              to={`/bots/${bot.id}`}
              name={bot.name}
              title={bot.name}
              detail={bot.description || 'No description'}
              clip
              meta={
                <>
                  <Status tone={bot.status === 'active' ? 'ok' : 'danger'}>{bot.status}</Status>
                  <span>{bot.webhook?.profile ? `Doorbell ${bot.webhook.profile}` : 'No doorbell'}</span>
                </>
              }
            />
          ))}
        </FeedList>
      ) : null}
      {open ? (
        <CreateBot
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            load(query);
          }}
        />
      ) : null}
    </div>
  );
}

function CreateBot({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
          api('/api/admin/bots', {
            method: 'POST',
            body: JSON.stringify({ name, description, capabilities }),
          })
            .then(() => onCreated())
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

function Onboarding({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty">
      <h2>No bots yet</h2>
      <p>Add the MCP URL in a client and sign in, or create an API key and connect with it. The bot shows up here.</p>
      <div className="actions">
        <Button to="/keys">Create an API key</Button>
        <Button tone="secondary" onClick={onCreate}>Create a bot</Button>
      </div>
      <ol className="steps">
        <li>
          <strong>Add the URL</strong>
          <p>Point the client at /mcp and sign in. OAuth registers a bot for that client.</p>
        </li>
        <li>
          <strong>Or use an API key</strong>
          <p>Create a key, send it as Authorization: Bearer bbk_…, and each client name becomes a bot.</p>
        </li>
        <li>
          <strong>Rename it here</strong>
          <p>Revoke a bot to take it out of the directory. Another account still needs a connection you both accept.</p>
        </li>
      </ol>
    </div>
  );
}
