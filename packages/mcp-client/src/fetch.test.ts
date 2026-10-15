import { describe, expect, it } from 'vitest';
import { McpResultTooLargeError } from './errors.js';
import { guardedFetchLike, type GuardedFetch, type GuardedFetchInit } from './fetch.js';

function recorder() {
  const seen: { url: string; init: GuardedFetchInit }[] = [];
  const guarded: GuardedFetch = (url, init) => {
    seen.push({ url: String(url), init });
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
  };
  return { seen, guarded };
}

describe('spec 010 — FR-004/FR-007: fetch dos transportes e do OAuth', () => {
  it('FR-007: corpo URLSearchParams (requisição de token OAuth) é enviado como formulário', async () => {
    const { seen, guarded } = recorder();
    const fetchLike = guardedFetchLike(guarded, 1024);
    await fetchLike('https://idp.exemplo/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'abc' }),
    });
    expect(seen[0]?.init.body).toBe('grant_type=authorization_code&code=abc');
    expect(seen[0]?.init.headers?.['content-type']).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8',
    );
    expect(seen[0]?.init.followRedirects).toBe(false);
  });

  it('FR-004: corpo JSON e cabeçalhos passam sem alteração', async () => {
    const { seen, guarded } = recorder();
    await guardedFetchLike(guarded, 1024)('https://mcp.exemplo/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: '{"jsonrpc":"2.0"}',
    });
    expect(seen[0]?.init).toMatchObject({
      method: 'POST',
      body: '{"jsonrpc":"2.0"}',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    });
  });

  it('FR-004 (Histórico 14/10/2026): opções de rede e TLS chegam ao filtro em toda requisição', async () => {
    const { seen, guarded } = recorder();
    const options = { allowPrivateNetworks: true, allowLoopback: true, insecureTls: true };
    await guardedFetchLike(guarded, 1024, options)('https://mcp.interno/mcp', { method: 'POST' });
    await guardedFetchLike(guarded, 1024)('https://mcp.exemplo/mcp', { method: 'GET' });
    expect(seen[0]?.init).toMatchObject(options);
    // Sem opções (ex.: provedor de IA), a regra padrão do filtro não muda.
    expect(seen[1]?.init).not.toHaveProperty('allowPrivateNetworks');
    expect(seen[1]?.init).not.toHaveProperty('insecureTls');
  });

  it('FR-006: resposta a POST acima do limite é interrompida', async () => {
    const big: GuardedFetch = () => Promise.resolve(new Response('x'.repeat(4096)));
    const res = await guardedFetchLike(big, 1024)('https://mcp.exemplo/mcp', { method: 'POST' });
    await expect(res.text()).rejects.toThrow(McpResultTooLargeError);
  });
});
