import { describe, expect, it } from 'vitest';
import { allowedRedirectUrl, withRedirect, withoutRedirectParam, type RedirectAllowlist } from '../src/redirect.js';

const desk: RedirectAllowlist = {
  pageOrigin: 'https://desk.example.com',
  publicUrl: 'https://desk.example.com',
};

describe('sign-in redirect allowlist', () => {
  it('allows the current origin and the configured public origin', () => {
    expect(allowedRedirectUrl('https://desk.example.com/oauth/consent?client_id=1', desk)).toBe(
      'https://desk.example.com/oauth/consent?client_id=1',
    );
    expect(
      allowedRedirectUrl('https://desk.example.com/oauth/consent', {
        pageOrigin: 'http://127.0.0.1:5173',
        publicUrl: 'https://desk.example.com',
      }),
    ).toBe('https://desk.example.com/oauth/consent');
    expect(
      allowedRedirectUrl('http://127.0.0.1:5173/oauth/consent?x=1', {
        pageOrigin: 'http://127.0.0.1:5173',
        publicUrl: 'https://desk.example.com',
      }),
    ).toBe('http://127.0.0.1:5173/oauth/consent?x=1');
  });

  it('allows https subdomains of the configured public host', () => {
    expect(allowedRedirectUrl('https://accounts.desk.example.com/oauth/authorize', desk)).toBe(
      'https://accounts.desk.example.com/oauth/authorize',
    );
    expect(allowedRedirectUrl('https://Accounts.Desk.Example.com/oauth/authorize', desk)).toBe(
      'https://accounts.desk.example.com/oauth/authorize',
    );
  });

  it('derives the host from config and rejects everything else', () => {
    expect(allowedRedirectUrl('https://bridge.forget.it.com/oauth/consent', desk)).toBeNull();
    expect(allowedRedirectUrl('https://evil.com/oauth/consent', desk)).toBeNull();
    expect(allowedRedirectUrl('https://desk.example.com.evil.com/oauth/consent', desk)).toBeNull();
    expect(allowedRedirectUrl('https://notdesk.example.com/oauth/consent', desk)).toBeNull();
    expect(allowedRedirectUrl('http://accounts.desk.example.com/oauth/consent', desk)).toBeNull();
    expect(allowedRedirectUrl('https://user:pass@desk.example.com/oauth/consent', desk)).toBeNull();
    expect(allowedRedirectUrl('javascript:alert(1)', desk)).toBeNull();
    expect(allowedRedirectUrl('/oauth/consent', desk)).toBeNull();
    expect(allowedRedirectUrl('https://evil.localhost/consent', { pageOrigin: 'http://localhost:5173', publicUrl: 'http://localhost:8787' })).toBeNull();
    expect(
      allowedRedirectUrl('https://evil.127.0.0.1/consent', {
        pageOrigin: 'http://127.0.0.1:8787',
        publicUrl: 'http://127.0.0.1:8787',
      }),
    ).toBeNull();
    expect(allowedRedirectUrl('https://desk.example.com/oauth/consent', { pageOrigin: 'http://127.0.0.1:5173', publicUrl: null })).toBeNull();
    expect(allowedRedirectUrl(null, desk)).toBeNull();
    expect(allowedRedirectUrl('   ', desk)).toBeNull();
  });

  it('keeps an allowed redirect on sign-in links and drops a rejected one', () => {
    const consent = 'https://desk.example.com/oauth/consent';
    expect(withRedirect('/sign-in', null)).toBe('/sign-in');
    expect(withRedirect('/sign-up', consent)).toBe(`/sign-up?redirect_url=${encodeURIComponent(consent)}`);
    expect(withoutRedirectParam('/sign-in', `?redirect_url=${encodeURIComponent('https://evil.com')}&foo=1`)).toBe('/sign-in?foo=1');
    expect(withoutRedirectParam('/sign-up', '?redirect_url=https%3A%2F%2Fevil.com')).toBe('/sign-up');
  });
});
