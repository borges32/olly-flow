import { describe, expect, it } from 'vitest';
import { createOidcSettings } from './oidc';

const storage = {
  length: 0,
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
} satisfies Storage;

const settings = createOidcSettings({
  authority: 'http://localhost:8080/realms/olly',
  clientId: 'olly-web',
  origin: 'http://localhost:5173',
  storage,
});

describe('FR-007: configuração OIDC do frontend', () => {
  it('FR-007: usa Authorization Code (PKCE) com cliente público, sem segredo', () => {
    expect(settings.response_type).toBe('code');
    expect(settings.disablePKCE).not.toBe(true);
    expect(settings).not.toHaveProperty('client_secret');
    expect(settings.scope).toBe('openid profile email');
  });

  it('FR-007: renova o token silenciosamente', () => {
    expect(settings.automaticSilentRenew).toBe(true);
  });

  it('FR-007: callback e logout voltam para a própria aplicação', () => {
    expect(settings.redirect_uri).toBe('http://localhost:5173/auth/callback');
    expect(settings.post_logout_redirect_uri).toBe('http://localhost:5173/');
  });

  it('FR-008: só usa configuração OIDC genérica (emissor e client id)', () => {
    expect(settings.authority).toBe('http://localhost:8080/realms/olly');
    expect(settings.client_id).toBe('olly-web');
    expect(settings.metadata).toBeUndefined();
  });
});
