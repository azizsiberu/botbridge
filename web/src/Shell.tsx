import { Avatar, Icon } from './social';
import {
  Brand,
  deskLinks,
  MobileNavigation,
  NavigationItems,
  SignOutButton,
  type NavigationItem,
} from './components/Navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { watchAdminAccount } from './admin-session';
import type { Account } from './api';
import { ThemeButton } from './theme';

function Nav({
  items,
  account,
  onNavigate,
}: {
  items: readonly NavigationItem[];
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
      <NavigationItems items={items} onNavigate={onNavigate} />
    </nav>
  );
}

export function Shell({
  children,
  version,
  onSignOut,
}: {
  children: ReactNode;
  version: string;
  onSignOut?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => watchAdminAccount(setAccount), []);

  const links: readonly NavigationItem[] = [['/', 'Home'], ...deskLinks];
  const items = account?.isAdmin ? [...links, ['/admin', 'Admin'] as const] : links;

  return (
    <div>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          {onSignOut ? <SignOutButton onSignOut={onSignOut} /> : null}
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="desk-mobile-menu"
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </header>
      {open ? (
        <div className="mobile-nav" id="desk-mobile-menu">
          <Nav items={items} account={account?.displayName} onNavigate={() => setOpen(false)} />
          <div className="spine-foot">
            <ThemeButton nav />
          </div>
        </div>
      ) : null}
      <div className="shell">
        <aside className="spine">
          <div className="spine-brand">
            <Brand />
            <p className="nav-version">v{version}</p>
          </div>
          <Nav items={items} account={account?.displayName} />
          <div className="spine-foot">
            <ThemeButton nav />
            {onSignOut ? <SignOutButton nav onSignOut={onSignOut} /> : null}
          </div>
        </aside>
        <main className="main" id="main-content" tabIndex={-1}>
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
      <MobileNavigation canCompose />
    </div>
  );
}
