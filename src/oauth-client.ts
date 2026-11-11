/** Friendly label for an OAuth client id. CIMD ids are URLs; show the host. */
export function oauthClientName(clientId: string): string {
  const value = clientId.trim();
  if (!value) return 'default';
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname) {
      return url.hostname;
    }
  } catch {
    // Dynamic-registration client ids are opaque strings.
  }
  return value;
}
