import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button, ErrorNote, FeedItem, FeedList, Field, Loading, PageTitle, Status, control } from '../ui';

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
      <PageTitle
        title="Accounts"
        lede={mode === 'open' ? 'Sign-up is open. New people can create an account.' : 'Sign-up is invite only.'}
        action={
          <Button
            tone="secondary"
            onClick={() => {
              const next = mode === 'open' ? 'invite' : 'open';
              api('/api/admin/admin/signup', { method: 'POST', body: JSON.stringify({ mode: next }) }).then(() => setMode(next)).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
            }}
          >
            {mode === 'open' ? 'Switch to invite only' : 'Switch to open'}
          </Button>
        }
      />
      {error ? <div className="mb-4"><ErrorNote message={error} /></div> : null}
      {!users && !error ? <Loading label="Loading accounts." /> : null}
      <section className="panel mb-4">
        <h2>Invite</h2>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            api('/api/admin/admin/invites', { method: 'POST', body: JSON.stringify({ email }) })
              .then(() => setEmail(''))
              .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
          }}
        >
          <Field label="Email">
            <input className={control} value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </Field>
          <Button type="submit">Send invite</Button>
        </form>
      </section>
      {users && users.length > 0 ? (
        <FeedList label="Accounts">
          {users.map((user) => (
            <FeedItem
              key={user.id}
              name={user.display_name}
              title={user.display_name}
              detail={user.email ?? 'No email'}
              meta={
                <>
                  <Status tone={user.status === 'active' ? 'ok' : 'danger'}>{user.status}</Status>
                  <span>{user.bots} bots</span>
                </>
              }
              actions={
                <Button
                  tone="secondary"
                  onClick={() =>
                    api(`/api/admin/admin/users/${user.id}/suspend`, {
                      method: 'POST',
                      body: JSON.stringify({ suspended: user.status === 'active' }),
                    }).then(load)
                  }
                >
                  {user.status === 'active' ? 'Suspend' : 'Restore'}
                </Button>
              }
            />
          ))}
        </FeedList>
      ) : null}
    </div>
  );
}
