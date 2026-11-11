import { ClerkProvider, SignIn, SignUp, useAuth } from '@clerk/react';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { publicConfig, setTokenGetter, type PublicConfig } from './api';
import { Shell } from './Shell';
import { clerkAppearance, ThemeButton, useTheme } from './theme';
import { AuditPage } from './pages/Audit';
import { BotPage } from './pages/Bot';
import { BotsPage } from './pages/Bots';
import { DoorbellPage } from './pages/Doorbell';
import { MailPage } from './pages/Mail';
import { OverviewPage } from './pages/Overview';
import { SettingsPage } from './pages/Settings';
import { TasksPage } from './pages/Tasks';
import { ThreadPage } from './pages/Thread';
import { ConnectionsPage } from './pages/Connections';
import { ChoosePage } from './pages/Choose';
import { AdminPage } from './pages/Admin';

export function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme] = useTheme();

  useEffect(() => {
    publicConfig().then(setConfig).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to start'));
  }, []);

  if (error) return <Centered title="botbridge is not answering" body={error} />;
  if (!config) return <Centered title="botbridge" body="Loading." />;
  if (config.devAuth) return <DevDesk version={config.version} />;
  if (!config.clerkPublishableKey) {
    return (
      <Centered
        title="Clerk is not configured"
        body="Set CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, BOTBRIDGE_PUBLIC_URL, and BOTBRIDGE_ADMIN_EMAILS, then restart the server."
      />
    );
  }
  return (
    <ClerkProvider publishableKey={config.clerkPublishableKey} signInUrl="/sign-in" signUpUrl="/sign-up" appearance={clerkAppearance(theme)}>
      <ClerkGate version={config.version} />
    </ClerkProvider>
  );
}

function ClerkGate({ version }: { version: string }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const location = useLocation();
  useEffect(() => {
    setTokenGetter(async () => (await getToken()) ?? null);
  }, [getToken]);
  if (!isLoaded) return <Centered title="botbridge" body="Checking your Clerk session." />;
  if (!isSignedIn) {
    const signingUp = location.pathname === '/sign-up';
    if (location.pathname !== '/sign-in' && !signingUp) return <Navigate to="/sign-in" replace />;
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="auth-top">
            <p className="brand">botbridge</p>
            <ThemeButton />
          </div>
          <p className="lede">{signingUp ? 'Create an account to manage your bots.' : 'Sign in to manage your bots.'}</p>
          {signingUp ? <SignUp routing="hash" signInUrl="/sign-in" /> : <SignIn routing="hash" signUpUrl="/sign-up" />}
        </div>
      </div>
    );
  }
  if (location.pathname === '/sign-in' || location.pathname === '/sign-up') return <Navigate to="/" replace />;
  return <Desk version={version} />;
}

function DevDesk({ version }: { version: string }) {
  setTokenGetter(async () => 'dev-admin');
  return <Desk version={version} />;
}

function Desk({ version }: { version: string }) {
  return (
    <Shell version={version}>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/bots" element={<BotsPage />} />
        <Route path="/bots/:id" element={<BotPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/oauth/choose" element={<ChoosePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/mail" element={<MailPage />} />
        <Route path="/mail/:threadId" element={<ThreadPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/doorbell" element={<DoorbellPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <div className="centered">
      <div className="panel">
        <h1>{title}</h1>
        <p className="lede">{body}</p>
      </div>
    </div>
  );
}
