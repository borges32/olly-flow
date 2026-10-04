import { describe, expect, it } from 'vitest';
import { exposedEnv } from './env.js';

describe('spec 003 — FR-005: $env filtrado', () => {
  it('FR-005: expõe só OLLY_EXPOSED_*, sem o prefixo', () => {
    expect(
      exposedEnv({
        OLLY_EXPOSED_API_URL: 'https://api.local',
        OLLY_EXPOSED_: 'vazio',
        DATABASE_URL: 'postgres://segredo',
        OIDC_ISSUER_URL: 'http://idp',
        OLLY_TIMEZONE: 'UTC',
        OLLY_EXPOSED_UNDEF: undefined,
      }),
    ).toEqual({ API_URL: 'https://api.local' });
  });
});
