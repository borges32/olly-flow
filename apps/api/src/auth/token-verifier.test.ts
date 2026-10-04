import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/config.js';
import { startFakeIssuer, type FakeIssuer } from '../testing/fake-oidc-issuer.js';
import { OidcTokenVerifier } from './token-verifier.js';

const PUBLIC_ISSUER = 'http://localhost:8080/realms/olly';
let issuer: FakeIssuer;

beforeAll(async () => {
  issuer = await startFakeIssuer('olly-api', { publicIssuer: PUBLIC_ISSUER });
});
afterAll(async () => {
  await issuer.close();
});

function verifier(oidc: Partial<AppConfig['oidc']>): OidcTokenVerifier {
  return new OidcTokenVerifier({
    oidc: { issuerUrl: PUBLIC_ISSUER, audience: 'olly-api', adminGroup: 'admin', ...oidc },
  } as AppConfig);
}

describe('FR-004/FR-008 (spec 001): emissor público diferente do endereço interno', () => {
  it('valida o iss público buscando descoberta e chaves pelo endereço interno', async () => {
    const token = await issuer.sign({ sub: 's', email: 'a@b.c' });
    await expect(verifier({ discoveryUrl: issuer.serverUrl }).verify(token)).resolves.toMatchObject(
      { sub: 's' },
    );
    await expect(verifier({ discoveryUrl: issuer.serverUrl }).isIssuerReachable()).resolves.toBe(
      true,
    );
  });

  it('continua exigindo que o iss do token seja o emissor público', async () => {
    const token = await issuer.sign({ sub: 's', email: 'a@b.c' }, { issuer: issuer.serverUrl });
    await expect(verifier({ discoveryUrl: issuer.serverUrl }).verify(token)).rejects.toThrow(
      'Token inválido',
    );
  });

  it('recusa descoberta cujo issuer difere do configurado', async () => {
    const token = await issuer.sign({ sub: 's', email: 'a@b.c' });
    const wrong = verifier({ issuerUrl: 'http://outro/realms/x', discoveryUrl: issuer.serverUrl });
    await expect(wrong.verify(token)).rejects.toThrow('Provedor de identidade indisponível');
  });
});
