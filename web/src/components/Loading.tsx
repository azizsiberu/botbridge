import { Icon } from '../social';

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Loading({ label, inline = false }: { label: string; inline?: boolean }) {
  return (
    <div
      className={`loading${inline ? ' loading-inline' : ''}`}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="loading-label">
        <Spinner />
        <span>{label}</span>
      </div>
      {!inline && (
        <div className="loading-skeleton" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div className="skeleton-row" key={row}>
              <span className="skeleton-avatar" />
              <div>
                <span className="skeleton-line" />
                <span className="skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppLoading({ label = 'Opening your workspace…' }: { label?: string }) {
  return (
    <main className="app-loading">
      <div className="app-loading-card">
        <div className="brand">
          <Icon name="Brand" />
          <span>botbridge</span>
        </div>
        <Loading label={label} />
      </div>
    </main>
  );
}
