import { useEffect, useState } from 'react';
import { Icon } from './social';

export type ThemeName = 'light' | 'dark';

export function currentTheme(): ThemeName {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('botbridge-theme', theme);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#101010' : '#e4ebf0');
  window.dispatchEvent(new Event('botbridge-theme'));
}

export function useTheme(): [ThemeName, (theme: ThemeName) => void] {
  const [theme, setTheme] = useState<ThemeName>(currentTheme);
  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    window.addEventListener('botbridge-theme', sync);
    return () => window.removeEventListener('botbridge-theme', sync);
  }, []);
  return [theme, applyTheme];
}

export function ThemeButton({ nav = false }: { nav?: boolean }) {
  const [theme, setTheme] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? 'Light theme' : 'Dark theme';
  if (nav) {
    return (
      <button type="button" className="nav-item" onClick={() => setTheme(next)}>
        <Icon name={label} />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme(next)}>
      {label}
    </button>
  );
}

export function clerkAppearance(theme: ThemeName) {
  const dark = theme === 'dark';
  return {
    variables: {
      colorPrimary: dark ? '#F5F5F5' : '#142028',
      colorDanger: dark ? '#FFB4A8' : '#8A221C',
      colorSuccess: dark ? '#9BE8C0' : '#0B5130',
      colorBackground: dark ? '#181818' : '#F5F8FA',
      colorText: dark ? '#F5F5F5' : '#142028',
      colorTextSecondary: dark ? '#A0A0A0' : '#3C5160',
      colorInputBackground: dark ? '#101010' : '#E4EBF0',
      colorInputText: dark ? '#F5F5F5' : '#142028',
      colorNeutral: dark ? '#A0A0A0' : '#3C5160',
      borderRadius: '12px',
      fontFamily: 'Inter, sans-serif',
      fontSize: '15px',
    },
    elements: {
      card: {
        boxShadow: 'none',
        border: `1px solid ${dark ? '#303030' : '#D5E0E6'}`,
        backgroundColor: dark ? '#181818' : '#F5F8FA',
        borderRadius: '18px',
      },
      formButtonPrimary: {
        backgroundColor: dark ? '#F5F5F5' : '#142028',
        color: dark ? '#101010' : '#F5F8FA',
        borderRadius: '12px',
      },
      footerActionLink: { color: dark ? '#F5F5F5' : '#142028' },
    },
  };
}
