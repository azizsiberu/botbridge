type Level = 'info' | 'error';

function enabled(level: Level): boolean {
  const configured = process.env.LOG_LEVEL ?? 'info';
  if (configured === 'silent') return false;
  if (configured === 'error') return level === 'error';
  return true;
}

export function log(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (!enabled(level)) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  console.error(line);
}
