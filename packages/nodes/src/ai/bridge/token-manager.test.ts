import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedCredential } from '../../credentials/definitions.js';
import { startBridgeMock, type BridgeMock } from '../testing/service-mocks.js';
import {
  BRIDGE_DEFAULT_TOKEN_TTL_MS,
  BridgeTokenManager,
  bridgeLogin,
  jwtExpiration,
  type BridgeLoginFetch,
} from './token-manager.js';

const login: BridgeLoginFetch = (url, init) => fetch(url, init);

let mock: BridgeMock | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const credentialFor = (
  m: BridgeMock,
  extra: Partial<ResolvedCredential> & { data?: Record<string, unknown> } = {},
): ResolvedCredential => ({
  id: 'cred-bridge',
  type: 'bridgeApi',
  updatedAt: '2026-10-07T00:00:00.000Z',
  ...extra,
  data: {
    tokenUrl: m.tokenUrl,
    baseUrl: m.baseUrl,
    identificador: m.identificador,
    senha: m.senha,
    tokenSkewSeconds: 60,
    ...extra.data,
  },
});

describe('spec 016 — FR-004/FR-005/NFR-001: token da Bridge', () => {
  it('FR-004: o token é reaproveitado e renovado no exp menos a margem', async () => {
    mock = await startBridgeMock({ tokenTtlSeconds: 1200 });
    let now = Date.now();
    const tokens = new BridgeTokenManager(() => now);
    const credential = credentialFor(mock);
    const first = await tokens.getToken(credential, login);
    expect(jwtExpiration(first)).toBeGreaterThan(now);
    expect(await tokens.getToken(credential, login)).toBe(first);
    now += 1130 * 1000; // antes de exp − 60 s
    expect(await tokens.getToken(credential, login)).toBe(first);
    expect(mock.logins).toBe(1);
    now += 20 * 1000; // depois de exp − 60 s
    const second = await tokens.getToken(credential, login);
    expect(second).not.toBe(first);
    expect(mock.logins).toBe(2);
  });

  it('FR-004: sem exp legível, vale a duração padrão de 20 minutos menos a margem', async () => {
    mock = await startBridgeMock({ opaqueToken: true });
    const before = Date.now();
    const { token, renewAt } = await bridgeLogin(credentialFor(mock), login);
    expect(jwtExpiration(token)).toBeUndefined();
    expect(renewAt).toBeGreaterThanOrEqual(before + BRIDGE_DEFAULT_TOKEN_TTL_MS - 60_000);
    expect(renewAt).toBeLessThanOrEqual(Date.now() + BRIDGE_DEFAULT_TOKEN_TTL_MS - 60_000);
  });

  it('FR-004: a credencial alterada (updatedAt) faz um novo login', async () => {
    mock = await startBridgeMock();
    const tokens = new BridgeTokenManager();
    await tokens.getToken(credentialFor(mock), login);
    await tokens.getToken(credentialFor(mock, { updatedAt: '2026-10-08T00:00:00.000Z' }), login);
    expect(mock.logins).toBe(2);
  });

  it('NFR-001: dezenas de chamadas simultâneas fazem um único login', async () => {
    mock = await startBridgeMock({ loginDelayMs: 50 });
    const tokens = new BridgeTokenManager();
    const credential = credentialFor(mock);
    const all = await Promise.all(
      Array.from({ length: 40 }, () => tokens.getToken(credential, login)),
    );
    expect(new Set(all).size).toBe(1);
    expect(mock.logins).toBe(1);
  });

  it('FR-005: invalidar descarta só o token recusado, não um mais novo', async () => {
    mock = await startBridgeMock();
    const tokens = new BridgeTokenManager();
    const credential = credentialFor(mock);
    const first = await tokens.getToken(credential, login);
    tokens.invalidate(credential, first);
    const second = await tokens.getToken(credential, login);
    expect(second).not.toBe(first);
    tokens.invalidate(credential, first); // token antigo: não derruba o novo
    expect(await tokens.getToken(credential, login)).toBe(second);
    expect(mock.logins).toBe(2);
  });

  it('FR-004: login recusado falha com o status e um trecho da resposta, sem a senha; uma falha não fica em cache', async () => {
    mock = await startBridgeMock();
    const tokens = new BridgeTokenManager();
    const wrong = credentialFor(mock, { data: { senha: 'senha-errada-sentinela' } });
    const error = await tokens.getToken(wrong, login).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('status 401');
    expect((error as Error).message).toContain('Usuário ou senha inválidos');
    expect((error as Error).message).not.toContain('senha-errada-sentinela');
    await expect(tokens.getToken(credentialFor(mock), login)).resolves.toBeTruthy();
  });

  it('FR-004: resposta do login sem "token" gera erro claro', async () => {
    const noToken: BridgeLoginFetch = () =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"outro":1}') });
    const credential: ResolvedCredential = {
      id: 'c',
      type: 'bridgeApi',
      updatedAt: '',
      data: { tokenUrl: 'https://x/login', identificador: 'a', senha: 'b' },
    };
    await expect(bridgeLogin(credential, noToken)).rejects.toThrow('não tem o campo "token"');
  });
});
