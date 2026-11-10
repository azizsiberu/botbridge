import { NavLink } from 'react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Account } from './api';
import { cx } from './ui';

const links = [
  ['/', 'Overview'],
  ['/bots', 'Bots'],
  ['/connections', 'Connections'],
  ['/mail', 'Mail'],
  ['/tasks', 'Tasks'],
  ['/audit', 'Audit'],
  ['/doorbell', 'Doorbell'],
  ['/settings', 'Settings'],
] as const;

export function Shell({ children, version }: { children: ReactNode; version: string }) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [isDark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    api<{ account: Account }>('/api/admin/me').then((body) => setAccount(body.account)).catch(() => undefined);
  }, []);

  function toggleTheme() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('botbridge-theme', next ? 'dark' : 'light');
    setDark(next);
  }

  const nav = account?.isAdmin ? [...links, ['/admin', 'Admin'] as const] : links;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[250px_1fr]">
      <aside className={cx('border-[var(--line)] bg-[var(--bg-2)] md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-r', open ? 'block' : 'hidden md:flex')}>
        <div className="px-5 pt-7 pb-5">
          <p className="text-[10px] font-semibold tracking-[0.28em] text-[var(--muted)] uppercase">Post office</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <p className="serif text-4xl leading-none italic">botbridge</p>
            <span className="rounded-md bg-[var(--accent)] px-1.5 py-1 text-[10px] font-bold tracking-wider text-[var(--accent-ink)]">v{version}</span>
          </div>
          {account ? <p className="mt-3 text-xs text-[var(--muted)]">{account.displayName}</p> : null}
        </div>
        <nav className="flex flex-col gap-1 px-3" aria-label="Desk">
          {nav.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  'rounded-2xl px-3 py-2.5 text-sm',
                  isActive ? 'bg-[var(--chip)] font-semibold text-[var(--ink)]' : 'text-[var(--muted)] hover:bg-[var(--bg-3)] hover:text-[var(--ink)]',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto p-4">
          <button type="button" onClick={toggleTheme} className="w-full rounded-2xl border border-[var(--line)] px-3 py-2 text-left text-sm">
            {isDark ? 'Switch to the day desk' : 'Switch to the night desk'}
          </button>
        </div>
      </aside>
      <div>
        <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3 md:hidden">
          <p className="serif text-2xl italic">botbridge</p>
          <button type="button" className="rounded-full border border-[var(--line)] px-3 py-1 text-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? 'Close' : 'Menu'}
          </button>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  );
}

export function PageTitle({ kicker, title, lede, action }: { kicker: string; title: string; lede?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--muted)] uppercase">{kicker}</p>
        <h1 className="serif mt-2 text-5xl leading-[0.95]">{title}</h1>
        {lede ? <p className="mt-3 text-sm text-[var(--muted)]">{lede}</p> : null}
      </div>
      {action}
    </div>
  );
}
