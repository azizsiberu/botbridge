import { useEffect, useState } from 'react';
import { api, type Settings } from '../api';
import { Form, Button, ErrorNote, Loading, PageTitle } from '../ui';
import { usePageData } from '../workspace-data';

function labelize(key: string): string {
  const spaced = key
    .replace(/([A-Z])/g, ' $1')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .toLowerCase();
  return spaced.slice(0, 1).toUpperCase() + spaced.slice(1);
}

export function SettingsPage() {
  const request = usePageData<Settings>('/api/admin/settings');
  const settings = request.data;
  const error = request.error;
  const setError = request.setError;
  const [split, setSplit] = useState(true);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settings) setSplit(settings.oauthSplitClients !== false);
  }, [settings]);

  return (
    <div>
      <PageTitle
        title="Settings"
        lede="Instance limits and who can open the desk. Secrets are not shown here."
      />
      {error ? <ErrorNote message={error} onRetry={request.refresh} /> : null}
      {!settings && !error ? <Loading label="Loading settings." /> : null}
      {settings ? (
        <div className="split">
          <section className="panel">
            <h2>This bridge</h2>
            <dl className="defs">
              <dt>Version</dt>
              <dd>{settings.version}</dd>
              <dt>Public URL</dt>
              <dd>{settings.publicUrl ?? 'Not set'}</dd>
              <dt>Clerk</dt>
              <dd>{settings.clerk ? 'Configured' : 'Off'}</dd>
              <dt>Hosts</dt>
              <dd>{settings.allowedHosts.join(', ')}</dd>
              <dt>Tool calls</dt>
              <dd>{settings.rateLimitPerMinute} per minute per token</dd>
            </dl>
          </section>
          <section className="panel">
            <h2>Limits</h2>
            <dl className="defs">
              {Object.entries(settings.limits).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt>{labelize(key)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="panel wide">
            <h2>Shared OAuth client ids</h2>
            <p className="muted">
              Some apps share one OAuth client id, and copies of one app (two Grok Bots) do too. With this on,
              the default, a different client name at initialize gets its own bot, so one agent never acts as
              another. Turn it off only for a client whose name changes between runs: every name on that
              client id then shares the first bot. X-Botbridge-Bot always picks the bot. You can move a
              connection from Connections.
            </p>
            <Form
              className="stack mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                setSaved(false);
                return api('/api/admin/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ oauthSplitClients: split }),
                })
                  .then(() => setSaved(true))
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
              }}
            >
              <label className="check">
                <input type="checkbox" checked={split} onChange={(event) => setSplit(event.target.checked)} />
                <span>Register a separate bot when the client name changes (recommended)</span>
              </label>
              <div className="button-row">
                <Button type="submit">Save</Button>
                {saved ? (
                  <span role="status" className="status status-ok">
                    Saved
                  </span>
                ) : null}
              </div>
            </Form>
          </section>
          {settings.allowlist ? (
            <section className="panel wide">
              <h2>Admin allowlist</h2>
              <p className="muted mb-3">
                Only these accounts can open the desk. Change them in the environment and restart.
              </p>
              <dl className="defs">
                <dt>Emails</dt>
                <dd>{settings.allowlist.emails.join(', ') || 'None'}</dd>
                <dt>User ids</dt>
                <dd>{settings.allowlist.userIds.join(', ') || 'None'}</dd>
                <dt>Organization</dt>
                <dd>
                  {settings.allowlist.orgId
                    ? `${settings.allowlist.orgId} / ${settings.allowlist.orgRole}`
                    : 'Not used'}
                </dd>
              </dl>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
