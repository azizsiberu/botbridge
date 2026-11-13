import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  Form,
  Button,
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

interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  status: string;
  bots: number;
}

export function AdminPage() {
  const [revision, bump] = useState(0);
  const request = usePageData<{ users: UserRow[] }>('/api/admin/admin/users', revision);
  const settings = usePageData<{ signupMode: 'open' | 'invite' }>('/api/admin/settings', revision);
  const users = request.data?.users;
  const [mode, setMode] = useState<'open' | 'invite'>('open');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const error = request.error ?? settings.error;
  const setError = request.setError;

  function load() {
    setError(null);
    settings.setError(null);
    bump((value) => value + 1);
  }
  useEffect(() => {
    if (settings.data) setMode(settings.data.signupMode);
  }, [settings.data]);

  return (
    <div>
      <PageTitle
        title="Accounts"
        lede={
          mode === 'open' ? 'Sign-up is open. New people can create an account.' : 'Sign-up is invite only.'
        }
        action={
          <Button
            tone="secondary"
            onClick={() => {
              const next = mode === 'open' ? 'invite' : 'open';
              return api('/api/admin/admin/signup', { method: 'POST', body: JSON.stringify({ mode: next }) })
                .then(() => setMode(next))
                .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
            }}
          >
            {mode === 'open' ? 'Switch to invite only' : 'Switch to open'}
          </Button>
        }
      />
      {error ? (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={load} />
        </div>
      ) : null}
      {notice && (
        <p role="status" className="status status-ok mb-4">
          {notice}
        </p>
      )}
      {!users && !error ? <Loading label="Loading accounts." /> : null}
      <section className="panel mb-4">
        <h2>Invite</h2>
        <Form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setNotice('');
            return api('/api/admin/admin/invites', { method: 'POST', body: JSON.stringify({ email }) })
              .then(() => {
                setEmail('');
                setNotice('Invitation sent.');
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'));
          }}
        >
          <Field label="Email">
            <input
              className={control}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
            />
          </Field>
          <Button type="submit">Send invite</Button>
        </Form>
      </section>
      {users?.length === 0 && (
        <Empty title="No accounts" body="Accounts will appear here after they sign in." />
      )}
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
