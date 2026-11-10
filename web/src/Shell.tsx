import { NavLink } from 'react-router';
import { useState, type ReactNode } from 'react';
import { cx } from './ui';

const links = [
  ['/', 'Overview'],
  ['/bots', 'Bots'],
  ['/mail', 'Mail'],
  ['/tasks', 'Tasks'],
  ['/audit', 'Audit'],
  ['/doorbell', 'Doorbell'],
  ['/settings', 'Settings'],
] as const;

export function Shell({ children, version }: { children: ReactNode; version: string }) {
  const [open, setOpen] = useState(false);
  const dark = document.documentElement.classList.contains('dark');
  const [isDark, setDark] = useState(dark);

  function toggleTheme() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('botbridge-theme', next ? 'dark' : 'light');
    setDark(next);
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className={cx('border-[var(--line)] bg-[var(--bg-2)] md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-r', open ? 'block' : 'hidden md:flex')}>
        <div className="flex items-center justify-between px-5 py-6">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.22em] text-[var(--muted)] uppercase">Post office</p>
            <p className="serif text-3xl leading-none italic">botbridge</p>
          </div>
          <span className="rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-[var(--accent-ink)]">v{version}</span>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {links.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  'rounded-xl px-3 py-2 text-sm',
                  isActive ? 'bg-[var(--chip)] font-medium text-[var(--ink)]' : 'text-[var(--muted)] hover:bg-[var(--bg-3)] hover:text-[var(--ink)]',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto p-4">
          <button type="button" onClick={toggleTheme} className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-left text-sm text-[var(--muted)]">
            {isDark ? 'Light desk' : 'Night desk'}
          </button>
        </div>
      </aside>
      <div>
        <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3 md:hidden">
          <p className="serif text-xl italic">botbridge</p>
          <button type="button" className="rounded-full border border-[var(--line)] px-3 py-1 text-sm" onClick={() => setOpen((value) => !value)}>
            {open ? 'Close' : 'Menu'}
          </button>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageTitle({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-medium tracking-[0.16em] text-[var(--muted)] uppercase">{kicker}</p>
        <h1 className="serif mt-1 text-4xl leading-none">{title}</h1>
      </div>
      {action}
    </div>
  );
}
