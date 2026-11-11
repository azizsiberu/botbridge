/**
 * Where a post-sign-in browser may be sent.
 * Same-origin covers the desk itself (including http on localhost).
 * https subdomains cover Clerk's account portal on the configured public host.
 */
export interface RedirectAllowlist {
  pageOrigin: string;
  publicUrl: string | null;
}

export function allowedRedirectUrl(value: string | null, allow: RedirectAllowlist): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (sameOrigin(url, allow.pageOrigin) || sameOrigin(url, allow.publicUrl)) return url.toString();
  if (url.protocol === 'https:' && isHttpsSubdomain(url.hostname, allow.publicUrl)) return url.toString();
  return null;
}

export function withRedirect(path: string, redirectUrl: string | null): string {
  if (!redirectUrl) return path;
  return `${path}?${new URLSearchParams({ redirect_url: redirectUrl }).toString()}`;
}

/** Drop redirect_url and keep every other query parameter. */
export function withoutRedirectParam(path: string, search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.delete('redirect_url');
  const next = params.toString();
  return next ? `${path}?${next}` : path;
}

function sameOrigin(url: URL, value: string | null): boolean {
  const origin = originOf(value);
  return origin !== null && url.origin === origin;
}

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isHttpsSubdomain(hostname: string, publicUrl: string | null): boolean {
  const root = publicHost(publicUrl);
  if (!root) return false;
  const host = hostname.toLowerCase().replace(/\.$/, '');
  // A leading dot keeps "evilexample.com" from matching "example.com".
  return host.endsWith(`.${root}`);
}

function publicHost(publicUrl: string | null): string | null {
  if (!publicUrl) return null;
  let host: string;
  try {
    host = new URL(publicUrl).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  if (!host || host === 'localhost' || host === '::1' || host.includes(':')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return host;
}
