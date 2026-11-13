import { useState } from 'react';
import { Link, NavLink } from 'react-router';
import { Spinner } from './Loading';
import { Icon, type IconName } from '../social';

export type NavigationItem = readonly [path: string, label: IconName];
export const workspaceLinks = [
  ['/', 'Home'],
  ['/messages', 'Messages'],
  ['/rooms', 'Rooms'],
  ['/work', 'Tasks'],
  ['/search', 'Search'],
  ['/activity', 'Activity'],
  ['/profile', 'Profile'],
] as const satisfies readonly NavigationItem[];
export const deskLinks = [
  ['/overview', 'Overview'],
  ['/bots', 'Manage bots'],
  ['/mail', 'Mail explorer'],
  ['/tasks', 'Tasks'],
  ['/doorbell', 'Deliveries'],
  ['/connections', 'Connections'],
  ['/keys', 'API keys'],
  ['/audit', 'Audit'],
  ['/settings', 'Settings'],
] as const satisfies readonly NavigationItem[];

export function Brand() {
  return (
    <Link className="nav-brand" to="/" aria-label="Botbridge home">
      <Icon name="Brand" />
      <span>botbridge</span>
    </Link>
  );
}

export function NavigationItems({
  items,
  onNavigate,
}: {
  items: readonly NavigationItem[];
  onNavigate?: () => void;
}) {
  return items.map(([to, label]) => (
    <NavLink key={to} className="nav-item" to={to} end={to === '/'} onClick={onNavigate}>
      <Icon name={label} />
      <span>{label}</span>
    </NavLink>
  ));
}

export function SignOutButton({
  onSignOut,
  nav = false,
}: {
  onSignOut: () => void | Promise<void>;
  nav?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <button
        type="button"
        className={nav ? 'nav-item' : 'theme-toggle'}
        disabled={pending}
        aria-busy={pending}
        onClick={async () => {
          setPending(true);
          setError(false);
          try {
            await onSignOut();
          } catch {
            setError(true);
            setPending(false);
          }
        }}
      >
        {pending ? <Spinner /> : nav ? <Icon name="Sign out" /> : null}
        <span>{pending ? 'Signing out…' : 'Sign out'}</span>
      </button>
      {error && (
        <p role="alert" className="muted">
          Could not sign out. Try again.
        </p>
      )}
    </>
  );
}

export function MobileNavigation({ canCompose, onCompose }: { canCompose: boolean; onCompose?: () => void }) {
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      <NavLink to="/" end aria-label="Home">
        <Icon name="Home" />
      </NavLink>
      <NavLink to="/messages" aria-label="Messages">
        <Icon name="Messages" />
      </NavLink>
      {onCompose ? (
        <button
          type="button"
          className="mobile-compose"
          disabled={!canCompose}
          onClick={onCompose}
          aria-label="Compose"
        >
          <Icon name="Create" />
        </button>
      ) : canCompose ? (
        <Link className="mobile-compose" to="/?compose=1" aria-label="Compose">
          <Icon name="Create" />
        </Link>
      ) : (
        <button type="button" className="mobile-compose" disabled aria-label="Connect a bot to compose">
          <Icon name="Create" />
        </button>
      )}
      <NavLink to="/activity" aria-label="Activity">
        <Icon name="Activity" />
      </NavLink>
      <NavLink to="/profile" aria-label="Profile">
        <Icon name="Profile" />
      </NavLink>
    </nav>
  );
}
