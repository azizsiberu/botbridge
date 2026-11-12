import { Avatar, Icon, type IconName } from './social';
import { NavLink } from 'react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { watchAdminAccount } from './admin-session';
import type { Account } from './api';
import { ThemeButton } from './theme';

const links = [
  ['/', 'Home'], ['/bots', 'Manage bots'], ['/mail', 'Mail explorer'],
  ['/tasks', 'Tasks'], ['/doorbell', 'Deliveries'], ['/settings', 'Settings'],
  ['/overview', 'Overview'], ['/connections', 'Connections'], ['/keys', 'API keys'], ['/audit', 'Audit'],
] as const;
function Nav({
  items,
  account,
  onNavigate,
}: {
  items: ReadonlyArray<readonly [string, IconName]>;
  account?: string | null;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Desk">
      {account ? (
        <div className="nav-item">
          <Icon name="Profile" />
          <span>{account}</span>
        </div>
      ) : null}
      {items.map(([to, label]) => (
        <NavLink key={to} className="nav-item" to={to} end={to === '/'} onClick={onNavigate}>
          <Icon name={label} /><span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function SignOutButton({ onSignOut, nav = false }: { onSignOut: () => void | Promise<void>; nav?: boolean }) {
  const [pending, setPending] = useState(false);
  const label = pending ? 'Signing out' : 'Sign out';
  return (
    <button
      type="button"
      className={nav ? 'nav-item' : 'theme-toggle'}
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        setPending(true);
        void Promise.resolve(onSignOut()).catch(() => setPending(false));
      }}
    >
      {nav ? <Icon name="Sign out" /> : null}
      <span>{label}</span>
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
        <strong><Icon name="Brand" /> botbridge</strong>
        <div className="topbar-actions">
          {onSignOut ? <SignOutButton onSignOut={onSignOut} /> : null}
          <button type="button" className="theme-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </header>
      {open ? (
        <div className="mobile-nav">
          <Nav items={items} account={account?.displayName} onNavigate={() => setOpen(false)} />
          <div className="spine-foot">
            <ThemeButton nav />
          </div>
        </div>
      ) : null}
      <div className="shell">
        <aside className="spine">
          <div className="spine-brand">
            <strong className="nav-brand"><Icon name="Brand" /> <span>botbridge</span></strong>
            <p className="nav-version">v{version}</p>
          </div>
          <Nav items={items} account={account?.displayName} />
          <div className="spine-foot">
            <ThemeButton nav />
            {onSignOut ? <SignOutButton nav onSignOut={onSignOut} /> : null}
          </div>
        </aside>
        <main className="main">
          <div className="main-inner">{children}</div>
        </main>
        <aside className="network-panel" aria-label="Your network">
          <div className="network-card">
            <div className="network-account">
              <Avatar name={account?.displayName ?? 'botbridge'} />
              <div>
                <strong>{account?.displayName ?? 'Your workspace'}</strong>
                <p>Botbridge v{version}</p>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        <NavLink to="/" end aria-label="Home"><Icon name="Home" /></NavLink>
        <NavLink to="/messages" aria-label="Messages"><Icon name="Inbox" /></NavLink>
        {sessionStorage.getItem('botbridge-active-bot')
          ? <NavLink to="/?compose=1" aria-label="Compose"><Icon name="Create" /></NavLink>
          : <button disabled aria-label="Choose an active bot to compose"><Icon name="Create" /></button>}
        <NavLink to="/activity" aria-label="Activity"><Icon name="Activity" /></NavLink>
        <NavLink to="/profile" aria-label="Profile"><Icon name="Profile" /></NavLink>
      </nav>
    </div>
  );
}
