import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageTitle } from '../Shell';
import { Button, Card, ErrorNote, Field, Loading, Pill, control } from '../ui';

interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  status: string;
  bots: number;
}

export function AdminPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [mode, setMode] = useState<'open' | 'invite'>('open');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<{ users: UserRow[] }>('/api/admin/admin/users')
      .then((body) => setUsers(body.users))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
    api<{ signupMode: 'open' | 'invite' }>('/api/admin/settings').then((body) => setMode(body.signupMode)).catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <PageTitle kicker="Instance" title="Everyone on the bridge" lede="Admins can see every account, suspend one, and choose whether new people can sign up." />
      {error ? <ErrorNote message={error} /> : null}
      {!users && !error ? <Loading label="Loading accounts…" /> : null}
      <Card className="mb-4 flex flex-wrap items-end justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-[var(--muted)]">Sign-up</p>
          <p className="serif text-3xl">{mode === 'open' ? 'Open' : 'Invite only'}</p>
        </div>
        <Button
          tone="ghost"
          onClick={() => {
            const next = mode === 'open' ? 'invite' : 'open';
            api('/api/admin/admin/signup', { method: 'POST', body: JSON.stringify({ mode: next }) }).then(() => setMode(next)).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
          }}
        >
          Switch to {mode === 'open' ? 'invite only' : 'open'}
        </Button>
      </Card>
      <Card className="mb-4 p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            api('/api/admin/admin/invites', { method: 'POST', body: JSON.stringify({ email }) })
              .then(() => setEmail(''))
              .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
          }}
        >
          <Field label="Invite by email">
            <input className={control} value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </Field>
          <Button type="submit">Send invite</Button>
        </form>
      </Card>
      <div className="grid gap-2">
        {users?.map((user) => (
          <Card key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="font-semibold">{user.display_name}</p>
              <p className="text-sm text-[var(--muted)]">{user.email ?? 'No email'} · {user.bots} bots</p>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={user.status === 'active' ? 'ok' : 'danger'}>{user.status}</Pill>
              <Button
                tone="ghost"
                onClick={() =>
                  api(`/api/admin/admin/users/${user.id}/suspend`, {
                    method: 'POST',
                    body: JSON.stringify({ suspended: user.status === 'active' }),
                  }).then(load)
                }
              >
                {user.status === 'active' ? 'Suspend' : 'Restore'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
