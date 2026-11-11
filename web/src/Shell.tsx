import { NavLink } from 'react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { watchAdminAccount } from './admin-session';
import type { Account } from './api';
import { ThemeButton } from './theme';

const links = [
  ['/', 'Overview'],
  ['/bots', 'Bots'],
  ['/keys', 'API keys'],
  ['/connections', 'Connections'],
  ['/mail', 'Mail'],
  ['/tasks', 'Tasks'],
  ['/audit', 'Audit'],
  ['/doorbell', 'Doorbell'],
  ['/settings', 'Settings'],
] as const;

function Nav({ items, onNavigate }: { items: ReadonlyArray<readonly [string, string]>; onNavigate?: () => void }) {
  return (
    <nav aria-label="Desk">
      {items.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/'} onClick={onNavigate}>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function SignOutButton({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className="theme-toggle"
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        setPending(true);
        void Promise.resolve(onSignOut()).catch(() => setPending(false));
      }}
    >
      {pending ? 'Signing out' : 'Sign out'}
    </button>
  );
}

export function Shell({ children, version, onSignOut }: { children: ReactNode; version: string; onSignOut?: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => watchAdminAccount(setAccount), []);

  const items = account?.isAdmin ? [...links, ['/admin', 'Admin'] as const] : links;

  return (
    <div>
      <header className="topbar">
        <strong>botbridge</strong>
        <div className="topbar-actions">
          {onSignOut ? <SignOutButton onSignOut={onSignOut} /> : null}
          <button type="button" className="theme-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </header>
      {open ? (
        <div className="mobile-nav">
          <Nav items={items} onNavigate={() => setOpen(false)} />
          <div className="spine-foot">
            <ThemeButton />
          </div>
        </div>
      ) : null}
      <div className="shell">
        <aside className="spine">
          <div className="spine-brand">
            <strong>botbridge</strong>
            <span>v{version}</span>
            {account ? <span className="spine-account">{account.displayName}</span> : null}
          </div>
          <Nav items={items} />
          <div className="spine-foot">
            <ThemeButton />
            {onSignOut ? <SignOutButton onSignOut={onSignOut} /> : null}
          </div>
        </aside>
        <main className="main">
          <div className="main-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
