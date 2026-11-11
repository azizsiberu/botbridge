import { useEffect, useState } from 'react';

export type ThemeName = 'light' | 'dark';

export function currentTheme(): ThemeName {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('botbridge-theme', theme);
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

export function ThemeButton() {
  const [theme, setTheme] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme(next)}>
      {next === 'light' ? 'Light theme' : 'Dark theme'}
    </button>
  );
}

export function clerkAppearance(theme: ThemeName) {
  const dark = theme === 'dark';
  return {
    variables: {
      colorPrimary: dark ? '#B6E4EA' : '#0F5C6B',
      colorDanger: dark ? '#FFB4A8' : '#8A221C',
      colorSuccess: dark ? '#9BE8C0' : '#0B5130',
      colorBackground: dark ? '#152028' : '#F5F8FA',
      colorText: dark ? '#E7EEF2' : '#142028',
      colorTextSecondary: dark ? '#C3D0D8' : '#3C5160',
      colorInputBackground: dark ? '#0C1419' : '#F5F8FA',
      colorInputText: dark ? '#E7EEF2' : '#142028',
      colorNeutral: dark ? '#C3D0D8' : '#3C5160',
      borderRadius: '4px',
      fontFamily: '"Familjen Grotesk", sans-serif',
      fontSize: '15px',
    },
    elements: {
      card: {
        boxShadow: 'none',
        border: `1px solid ${dark ? '#2A3C48' : '#D5E0E6'}`,
        backgroundColor: dark ? '#152028' : '#F5F8FA',
      },
      formButtonPrimary: {
        backgroundColor: dark ? '#B6E4EA' : '#0F5C6B',
        color: dark ? '#06262C' : '#F4FBFC',
      },
      footerActionLink: { color: dark ? '#B6E4EA' : '#0F5C6B' },
    },
  };
}
