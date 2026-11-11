import { useEffect, useState } from 'react';
import { api, type ApiKey } from '../api';
import { Button, CopyButton, DataTable, Dialog, Empty, ErrorNote, Field, Loading, PageTitle, Status, time, control } from '../ui';

export function KeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<{ label: string; token: string } | null>(null);

  function load() {
    api<{ keys: ApiKey[] }>('/api/admin/api-keys')
      .then((body) => setKeys(body.keys))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <PageTitle
        title="API keys"
        lede="A key belongs to this account. A client that connects with it becomes a bot, named from the client. The secret is shown once."
        action={<Button onClick={() => setOpen(true)}>New key</Button>}
      />
      {error ? <ErrorNote message={error} /> : null}
      {!keys && !error ? <Loading label="Loading API keys." /> : null}
      {keys?.length === 0 ? (
        <Empty
          title="No API keys"
          body="Create a key, then send Authorization: Bearer bbk_… to /mcp. Each client name registers its own bot."
          action={<Button onClick={() => setOpen(true)}>New key</Button>}
        />
      ) : null}
      {keys && keys.length > 0 ? (
        <DataTable label="API keys">
          <thead>
            <tr>
              <th>Label</th>
              <th>Prefix</th>
              <th>Last used</th>
              <th>Created</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>{key.label}</td>
                <td className="url">{key.token_prefix}</td>
                <td>{time(key.last_used_at)}</td>
                <td>{time(key.created_at)}</td>
                <td><Status tone={key.revoked_at ? 'danger' : 'ok'}>{key.revoked_at ? 'revoked' : 'active'}</Status></td>
                <td>
                  {key.revoked_at ? null : (
                    <Button
                      tone="danger"
                      onClick={() => {
                        api(`/api/admin/api-keys/${key.id}/revoke`, { method: 'POST' })
                          .then(load)
                          .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}
      {open ? (
        <NewKey
          onClose={() => setOpen(false)}
          onCreated={(value) => {
            setOpen(false);
            setIssued(value);
            load();
          }}
        />
      ) : null}
      {issued ? (
        <Dialog title={`Key for ${issued.label}`} onClose={() => setIssued(null)}>
          <p className="muted">Copy this key now. botbridge stores only a hash, so it cannot be shown again.</p>
          <pre className="code">{issued.token}</pre>
          <div className="button-row mt-3">
            <CopyButton value={issued.token} label="Copy key" />
            <CopyButton value={`Authorization: Bearer ${issued.token}`} label="Copy header" />
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function NewKey({ onClose, onCreated }: { onClose: () => void; onCreated: (value: { label: string; token: string }) => void }) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="New API key" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          api<{ label: string; token: string }>('/api/admin/api-keys', {
            method: 'POST',
            body: JSON.stringify({ label }),
          })
            .then((body) => onCreated({ label: body.label, token: body.token }))
            .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
            .finally(() => setBusy(false));
        }}
      >
        <Field label="Label">
          <input className={control} value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={80} />
        </Field>
        <p className="muted">Use a name you will recognize later, such as the machine or the product.</p>
        {error ? <ErrorNote message={error} /> : null}
        <div className="button-row">
          <Button type="submit" disabled={busy}>Create key</Button>
          <Button tone="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
