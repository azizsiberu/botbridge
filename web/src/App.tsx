import { ClerkProvider, SignIn, useAuth } from '@clerk/react';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { publicConfig, setTokenGetter, type PublicConfig } from './api';
import { Shell } from './Shell';
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

  useEffect(() => {
    publicConfig().then(setConfig).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to start'));
  }, []);

  if (error) return <Centered title="botbridge is not answering" body={error} />;
  if (!config) return <Centered title="Opening the desk…" body="Loading the bridge." />;
  if (config.devAuth) {
    return <DevDesk version={config.version} />;
  }
  if (!config.clerkPublishableKey) {
    return (
      <Centered
        title="Clerk is not configured"
        body="Set CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, BOTBRIDGE_PUBLIC_URL, and BOTBRIDGE_ADMIN_EMAILS, then rebuild is not required — restart the server."
      />
    );
  }
  return (
    <ClerkProvider publishableKey={config.clerkPublishableKey}>
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
  if (!isLoaded) return <Centered title="Opening the desk…" body="Checking your Clerk session." />;
  if (!isSignedIn) {
    if (location.pathname !== '/sign-in') return <Navigate to="/sign-in" replace />;
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div>
          <p className="serif mb-6 text-center text-4xl italic">botbridge</p>
          <SignIn routing="hash" />
        </div>
      </div>
    );
  }
  if (location.pathname === '/sign-in') return <Navigate to="/" replace />;
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
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="serif text-4xl italic">{title}</p>
        <p className="mt-3 text-sm text-[var(--muted)]">{body}</p>
      </div>
    </div>
  );
}
