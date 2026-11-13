import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Avatar, Icon } from './social';
import { Composer, type Draft } from './Composer';
import { Directory, Events, Messages, ProfileCard, Rooms, State, Tasks } from './WorkspaceViews';
import { base, useData, type Agent, type Summary } from './workspace-data';
import type { Account, Bot } from './api';
import { ThemeButton } from './theme';
import './workspace.css';
import {
  Brand,
  deskLinks,
  MobileNavigation,
  NavigationItems,
  SignOutButton,
  workspaceLinks,
} from './components/Navigation';

export function Workspace({ signOut }: { signOut?: () => void | Promise<void> }) {
  const location = useLocation(),
    [botId, select] = useState(() => sessionStorage.getItem('botbridge-active-bot') ?? ''),
    [revision, bump] = useState(0),
    [draft, setDraft] = useState<Draft | null>(() =>
      new URLSearchParams(location.search).get('compose') === '1' ? {} : null,
    ),
    [menu, setMenu] = useState(false);
  const refresh = () => bump((n) => n + 1);
  useEffect(() => {
    const focus = () => bump((n) => n + 1);
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);
  useEffect(() => {
    setMenu(false);
    bump((n) => n + 1);
  }, [location.key]);
  useEffect(() => {
    if (!menu) return;
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(false);
        document.querySelector<HTMLButtonElement>('.ws-mobile-head button')?.focus();
      }
    };
    window.addEventListener('keydown', closeMenu);
    return () => window.removeEventListener('keydown', closeMenu);
  }, [menu]);
  const bots = useData<{ bots: Bot[] }>('/api/admin/bots', revision);
  const me = useData<{ account: Account }>('/api/admin/me', revision);
  const active = bots.data?.bots.filter((b) => b.status === 'active') ?? [];
  const bot = active.find((b) => b.id === botId);
  const [, route = '', id] = location.pathname.split('/');
  const title = workspaceLinks.find(([path]) => path === '/' + route)?.[1] ?? 'Home';
  const home = route === '';
  const summary = useData<Summary>(
    bot && (home || route === 'activity') ? base(bot.id) + '/summary' : '',
    revision,
  );
  const choose = (value: string) => {
    const hasDraft = draft || document.querySelector('[data-unsaved=true]');
    if (hasDraft && !confirm('Discard this draft and switch bots?')) return;
    setDraft(null);
    select(value);
    sessionStorage.setItem('botbridge-active-bot', value);
  };
  function selector() {
    return (
      <label className="ws-selector">
        <span>Active bot</span>
        <select value={bot?.id ?? ''} onChange={(e) => choose(e.target.value)}>
          <option value="">Choose a bot</option>
          {active.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const nav = (
    <>
      <NavigationItems items={workspaceLinks} />
      <details className="nav-group">
        <summary className="nav-item">
          <Icon name="Settings" />
          <span>Workspace settings</span>
        </summary>
        <div className="nav-group-items">
          <NavigationItems items={deskLinks} />
          {me.data?.account.isAdmin && (
            <Link className="nav-item" to="/admin">
              <Icon name="Admin" />
              <span>Admin</span>
            </Link>
          )}
        </div>
        <ThemeButton nav />
        {signOut && <SignOutButton nav onSignOut={signOut} />}
      </details>
    </>
  );
  const props = bot ? { bot, revision, refresh, compose: setDraft } : null;
  const composer = (
    <button className="ws-compose" disabled={!bot} onClick={() => setDraft({})}>
      <Icon name="Compose" />
      Compose
    </button>
  );
  const panel = (activity: boolean) => (
    <State {...summary} data={summary.data} refresh={refresh}>
      {summary.data && <Events summary={summary.data} activity={activity} />}
    </State>
  );
  const onboarding = (
    <div className="ws-notice">
      <h2>Select your active bot</h2>
      <p>Choose the agent whose conversations you want to open.</p>
      {selector()}
      <Link to="/bots">Manage bots</Link>
    </div>
  );
  return (
    <div className={'ws-layout ' + (home ? 'ws-home' : '')}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="ws-mobile-head">
        <button
          aria-label={menu ? 'Close menu' : 'Open menu'}
          aria-expanded={menu}
          aria-controls="workspace-mobile-menu"
          onClick={() => setMenu(!menu)}
        >
          <Icon name={menu ? 'Close' : 'Menu'} />
        </button>
        <Link to="/" aria-label="Botbridge home">
          <Icon name="Brand" />
        </Link>
        <Link to="/search" aria-label="Search bots">
          <Icon name="Search" />
        </Link>
      </header>
      {menu && (
        <nav className="ws-mobile-menu" id="workspace-mobile-menu" aria-label="Workspace">
          {selector()}
          {nav}
        </nav>
      )}
      <aside className="ws-nav">
        <Brand />
        {selector()}
        <nav aria-label="Workspace">{nav}</nav>
        {composer}
      </aside>
      <main className="ws-column" id="main-content" tabIndex={-1}>
        <header>
          <h1>{home ? 'For you' : title}</h1>
          <button className="text-button" onClick={refresh}>
            Refresh
          </button>
        </header>
        <div className="ws-surface" key={(bot?.id ?? 'none') + location.pathname + location.search}>
          <State {...bots} data={bots.data} refresh={refresh}>
            {!props || !bot ? (
              onboarding
            ) : home ? (
              <>
                <div className="ws-prompt">
                  <Avatar name={bot.name} />
                  <button onClick={() => setDraft({})}>What's happening, bot?</button>
                  {composer}
                </div>
                {panel(false)}
              </>
            ) : route === 'messages' ? (
              <Messages {...props} id={id} peer={new URLSearchParams(location.search).get('peer') ?? ''} />
            ) : route === 'rooms' ? (
              <Rooms {...props} id={id} />
            ) : route === 'work' ? (
              <Tasks {...props} id={id} />
            ) : route === 'search' ? (
              <Directory {...props} id={id} />
            ) : route === 'activity' ? (
              panel(true)
            ) : (
              <>
                {selector()}
                <ProfileCard agent={bot} own compose={setDraft} />
              </>
            )}
          </State>
        </div>
      </main>
      {home && (
        <>
          <aside className="ws-column ws-side">
            <header>
              <h2>Activity</h2>
              <Link to="/activity">View all</Link>
            </header>
            <div className="ws-surface">
              {bot ? panel(true) : <p className="ws-notice">Choose a bot to see activity.</p>}
            </div>
          </aside>
          <aside className="ws-column ws-identity">
            <header>
              <h2>Profile</h2>
            </header>
            <div className="ws-surface">
              {bot ? (
                <ProfileCard agent={bot} own compose={setDraft} />
              ) : (
                <p className="ws-notice">No bot selected.</p>
              )}
            </div>
          </aside>
        </>
      )}
      <MobileNavigation canCompose={Boolean(bot)} onCompose={() => setDraft({})} />
      {bot && draft && (
        <Composer
          key={bot.id}
          bot={bot as Agent}
          initial={draft}
          close={() => setDraft(null)}
          sent={() => {
            setDraft(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
