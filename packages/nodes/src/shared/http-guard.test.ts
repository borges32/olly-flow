import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SsrfBlockedError, blockedReason, createHttpGuard, parseAllowlist } from './http-guard.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/redirect-interno') {
      res.writeHead(302, { location: 'http://10.0.0.1/segredo' });
      res.end();
      return;
    }
    if (req.url === '/redirect-loopback') {
      res.writeHead(302, { location: 'http://127.0.0.2/segredo' });
      res.end();
      return;
    }
    if (req.url === '/redirect-local') {
      res.writeHead(302, { location: '/ok' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: req.url, auth: req.headers.authorization ?? null }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

describe('spec 004 — FR-008/SC-003: filtro anti-SSRF', () => {
  const none = parseAllowlist([]);

  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.5.4', 'private'],
    ['192.168.0.10', 'private'],
    ['169.254.169.254', 'linkLocal'],
    ['100.64.0.1', 'carrierGradeNat'],
    ['0.0.0.0', 'unspecified'],
    ['255.255.255.255', 'broadcast'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'linkLocal'],
    ['fc00::1', 'uniqueLocal'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['64:ff9b::7f00:1', 'rfc6052'],
    ['2002:7f00:1::', '6to4'],
  ])('FR-008: bloqueia %s (%s)', (address, range) => {
    expect(blockedReason(address, none)).toContain(range);
  });

  it('FR-008: aceita endereços públicos', () => {
    expect(blockedReason('8.8.8.8', none)).toBeNull();
    expect(blockedReason('2001:4860:4860::8888', none)).toBeNull();
  });

  it('FR-008: allowlist libera CIDR e IP específicos', () => {
    const allow = parseAllowlist(['10.20.0.0/16', '192.168.1.5']);
    expect(blockedReason('10.20.3.4', allow)).toBeNull();
    expect(blockedReason('10.21.0.1', allow)).not.toBeNull();
    expect(blockedReason('192.168.1.5', allow)).toBeNull();
    expect(blockedReason('192.168.1.6', allow)).not.toBeNull();
  });

  it('FR-008: URLs para a rede interna, por IP ou nome, são recusadas com mensagem clara', async () => {
    const guard = createHttpGuard();
    for (const url of [
      'http://127.0.0.1/',
      'http://10.0.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]:8080/',
      'http://localhost/',
      'http://0.0.0.0/',
    ]) {
      await expect(guard.assertDestinationAllowed(url), url).rejects.toThrow(SsrfBlockedError);
    }
    await expect(guard.fetch('http://127.0.0.1/')).rejects.toThrow(
      /Destino bloqueado pelo filtro de rede \(127\.0\.0\.1\)/,
    );
    await expect(guard.assertDestinationAllowed('file:///etc/passwd')).rejects.toThrow(/protocolo/);
    await guard.close();
  });

  it('FR-008: domínio que resolve para IP privado é bloqueado se qualquer IP for interno', async () => {
    const guard = createHttpGuard({ resolve: () => Promise.resolve(['8.8.8.8', '10.0.0.7']) });
    await expect(guard.assertDestinationAllowed('http://intranet.exemplo/')).rejects.toThrow(
      /10\.0\.0\.7/,
    );
    await guard.close();
  });

  it('FR-008: DNS rebinding — o IP da conexão é validado de novo no lookup', async () => {
    // 1ª resolução (verificação) pública; 2ª (conexão) aponta para loopback.
    let calls = 0;
    const guard = createHttpGuard({
      resolve: () => Promise.resolve([calls++ === 0 ? '8.8.8.8' : '127.0.0.1']),
    });
    const error = await guard
      .fetch(`http://rebind.exemplo:${new URL(base).port}/`)
      .catch((e: unknown) => e);
    expect(calls).toBe(2);
    expect(String((error as Error).cause ?? error)).toMatch(/Destino bloqueado.*loopback/);
    await guard.close();
  });

  it('FR-008: redirect para IP interno é bloqueado; redirect permitido é seguido', async () => {
    const guard = createHttpGuard({ allowlist: ['127.0.0.1'] });
    await expect(guard.fetch(`${base}/redirect-interno`)).rejects.toThrow(/10\.0\.0\.1/);
    const ok = await guard.fetch(`${base}/redirect-local`);
    expect(await ok.json()).toMatchObject({ url: '/ok' });
    const manual = await guard.fetch(`${base}/redirect-local`, { followRedirects: false });
    expect(manual.status).toBe(302);
    await guard.close();
  });

  it('FR-008: host na allowlist pode resolver para IP interno', async () => {
    const guard = createHttpGuard({
      allowlist: ['api.interna'],
      resolve: () => Promise.resolve(['127.0.0.1']),
    });
    const res = await guard.fetch(`http://api.interna:${new URL(base).port}/x`);
    expect(await res.json()).toMatchObject({ url: '/x' });
    await guard.close();
  });
});

describe('spec 016 — FR-013 e FR-002/FR-008: redes internas e TLS por chamada', () => {
  const none = parseAllowlist([]);
  const internal = { allowPrivateNetworks: true };

  it.each([
    ['10.0.0.5', 'privada'],
    ['172.16.5.4', 'privada'],
    ['192.168.0.10', 'privada'],
    ['100.64.0.1', 'CGNAT'],
    ['fc00::1', 'ULA'],
  ])('FR-013: com allowPrivateNetworks, aceita %s (%s)', (address) => {
    expect(blockedReason(address, none, internal)).toBeNull();
    // Sem a opção, a regra da spec 004 não muda.
    expect(blockedReason(address, none)).not.toBeNull();
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['::1', 'loopback'],
    ['169.254.169.254', 'linkLocal'],
    ['fe80::1', 'linkLocal'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['64:ff9b::7f00:1', 'rfc6052'],
    ['2002:7f00:1::', '6to4'],
  ])('FR-013: mesmo com allowPrivateNetworks, bloqueia %s (%s)', (address, range) => {
    expect(blockedReason(address, none, internal)).toContain(range);
  });

  it('FR-013: o nome interno resolve para rede privada e passa só com a opção; protocolo continua validado', async () => {
    const guard = createHttpGuard({ resolve: () => Promise.resolve(['10.20.30.40']) });
    await expect(guard.assertDestinationAllowed('https://bridge.interna/v1')).rejects.toThrow(
      SsrfBlockedError,
    );
    await expect(
      guard.assertDestinationAllowed('https://bridge.interna/v1', internal),
    ).resolves.toBeUndefined();
    await expect(guard.assertDestinationAllowed('file:///etc/passwd', internal)).rejects.toThrow(
      'protocolo',
    );
    const metadata = createHttpGuard({ resolve: () => Promise.resolve(['169.254.169.254']) });
    await expect(
      metadata.assertDestinationAllowed('http://metadados.interna/', internal),
    ).rejects.toThrow('linkLocal');
  });

  it('FR-013: redirect para loopback é bloqueado mesmo com allowPrivateNetworks', async () => {
    const guard = createHttpGuard({ allowlist: ['127.0.0.1/32'] });
    await expect(guard.fetch(`${base}/redirect-loopback`, internal)).rejects.toThrow('loopback');
    await guard.close();
  });

  it('FR-002/FR-008: HTTPS autoassinado só conecta com insecureTls, e o filtro continua valendo', async () => {
    const { startBridgeMock } = await import('../ai/testing/service-mocks.js');
    const mock = await startBridgeMock({ tls: true });
    const guard = createHttpGuard({ allowlist: ['127.0.0.1'] });
    try {
      const body = JSON.stringify({ identificador: mock.identificador, senha: mock.senha });
      const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body };
      // Padrão: o certificado é verificado e a conexão falha.
      await expect(guard.fetch(mock.tokenUrl, init)).rejects.toThrow();
      const response = await guard.fetch(mock.tokenUrl, { ...init, insecureTls: true });
      expect(response.status).toBe(200);
      await response.body?.cancel();
      // Sem a allowlist, o loopback continua bloqueado, mesmo sem verificar TLS e com redes internas.
      const strict = createHttpGuard();
      await expect(
        strict.fetch(mock.tokenUrl, { ...init, insecureTls: true, allowPrivateNetworks: true }),
      ).rejects.toThrow(SsrfBlockedError);
      await strict.close();
    } finally {
      await guard.close();
      await mock.close();
    }
  });
});
