import { useEffect, useState } from 'react';
import { api, type Settings } from '../api';
import { PageTitle } from '../Shell';
import { Card, ErrorNote } from '../ui';

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Settings>('/api/admin/settings').then(setSettings).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
  }, []);
  return (
    <div>
      <PageTitle kicker="Instance" title="Settings" />
      {error ? <ErrorNote message={error} /> : null}
      {settings ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="serif text-2xl">This bridge</h2>
            <dl className="mt-4 grid grid-cols-[140px_1fr] gap-y-2 text-sm">
              <dt className="text-[var(--muted)]">Version</dt><dd>{settings.version}</dd>
              <dt className="text-[var(--muted)]">Public URL</dt><dd className="break-all">{settings.publicUrl ?? 'Not set'}</dd>
              <dt className="text-[var(--muted)]">Clerk</dt><dd>{settings.clerk ? 'Configured' : 'Off'}</dd>
              <dt className="text-[var(--muted)]">Hosts</dt><dd>{settings.allowedHosts.join(', ')}</dd>
              <dt className="text-[var(--muted)]">Tool calls</dt><dd>{settings.rateLimitPerMinute} / minute / token</dd>
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="serif text-2xl">Limits</h2>
            <ul className="mt-4 grid gap-1 text-sm text-[var(--muted)]">
              {Object.entries(settings.limits).map(([key, value]) => (
                <li key={key} className="flex justify-between gap-4"><span>{key}</span><span className="text-[var(--ink)]">{value}</span></li>
              ))}
            </ul>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h2 className="serif text-2xl">Admin allowlist</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Only these accounts can open the desk. Change them in the environment and restart.</p>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <p className="text-[var(--muted)]">Emails</p>
                <p>{settings.allowlist.emails.join(', ') || 'None'}</p>
              </div>
              <div>
                <p className="text-[var(--muted)]">User ids</p>
                <p className="break-all">{settings.allowlist.userIds.join(', ') || 'None'}</p>
              </div>
              <div>
                <p className="text-[var(--muted)]">Organization</p>
                <p>{settings.allowlist.orgId ? `${settings.allowlist.orgId} · ${settings.allowlist.orgRole}` : 'Not used'}</p>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
