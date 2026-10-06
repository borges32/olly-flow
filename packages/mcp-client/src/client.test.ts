import { startMcpTestServer, type McpTestServer } from '@olly/mcp-test-server';
import type { McpToolDefinition } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpConnection, type McpClientSettings } from './connection.js';
import { McpConnectionError, McpResultTooLargeError, McpTimeoutError } from './errors.js';
import { guardedFetchLike, type GuardedFetch } from './fetch.js';
import { McpConnectionPool } from './pool.js';

let server: McpTestServer;
const requested: string[] = [];

/** "Filtro" de teste: registra cada destino e deixa passar (o filtro real é do @olly/nodes). */
const recordingGuard: GuardedFetch = async (url, init) => {
  requested.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
  const res = await fetch(url, { ...init, redirect: 'manual' });
  return res;
};

function settings(overrides: Partial<McpClientSettings> = {}): McpClientSettings {
  return {
    fetch: guardedFetchLike(recordingGuard, 1024 * 1024),
    callTimeoutMs: 5_000,
    maxResultBytes: 1024 * 1024,
    ...overrides,
  };
}

beforeAll(async () => {
  server = await startMcpTestServer();
});
afterAll(async () => {
  await server.close();
});

describe('spec 010 — FR-004/FR-006: cliente MCP', () => {
  it('FR-004: Streamable HTTP com todo o tráfego pelo fetch com anti-SSRF', async () => {
    requested.length = 0;
    const conn = await McpConnection.open(
      { serverId: 's', transport: 'streamableHttp', url: `${server.url}/mcp` },
      settings(),
    );
    expect(conn.serverInfo).toMatchObject({
      name: 'olly-mcp-test-server',
      protocolVersion: '2025-11-25',
    });
    const result = await conn.callTool('soma', { a: 2, b: 3 });
    expect(result.structuredContent).toEqual({ resultado: 5 });
    expect((await conn.readResource('test://info')).contents).toHaveLength(1);
    expect((await conn.listPrompts()).map((p) => p.name)).toEqual(['saudacao']);
    await conn.close();
    expect(requested.length).toBeGreaterThan(2);
    expect(requested.every((r) => r.endsWith('/mcp'))).toBe(true);
  });

  it('FR-004: SSE legado', async () => {
    const conn = await McpConnection.open(
      { serverId: 's', transport: 'sse', url: `${server.url}/sse` },
      settings(),
    );
    expect((await conn.callTool('echo', { texto: 'oi' })).content).toEqual([
      { type: 'text', text: 'oi' },
    ]);
    await conn.close();
  });

  it('FR-004/SC-005: destino recusado pelo filtro não conecta', async () => {
    const blocked: GuardedFetch = () =>
      Promise.reject(
        new Error('Destino bloqueado pelo filtro de rede (10.0.0.5): endereço privado'),
      );
    await expect(
      McpConnection.open(
        { serverId: 's', transport: 'streamableHttp', url: 'http://10.0.0.5/mcp' },
        settings({ fetch: guardedFetchLike(blocked, 1024) }),
      ),
    ).rejects.toThrow(McpConnectionError);
    await expect(
      McpConnection.open(
        { serverId: 's', transport: 'streamableHttp', url: 'http://10.0.0.5/mcp' },
        settings({ fetch: guardedFetchLike(blocked, 1024) }),
      ),
    ).rejects.toThrow(/bloqueado pelo filtro de rede/);
  });

  it('FR-006: o pool reaproveita a conexão (um único initialize)', async () => {
    requested.length = 0;
    const listed: McpToolDefinition[][] = [];
    const pool = new McpConnectionPool(
      settings({ onToolsListed: (_id, tools) => void listed.push(tools) }),
    );
    const config = {
      serverId: 's',
      transport: 'streamableHttp' as const,
      url: `${server.url}/mcp`,
    };
    const a = await pool.use('s:1', config, (c) => c.callTool('soma', { a: 1, b: 1 }));
    const b = await pool.use('s:1', config, (c) => c.callTool('soma', { a: 2, b: 2 }));
    expect([a.structuredContent, b.structuredContent]).toEqual([
      { resultado: 2 },
      { resultado: 4 },
    ]);
    expect(pool.size).toBe(1);
    // Conexão nova: as tools são listadas para comparar com o snapshot (plan §2).
    expect(listed).toHaveLength(1);
    expect(listed[0]?.map((t) => t.name)).toContain('soma');
    const initializes = requested.filter((r) => r.startsWith('POST')).length;
    await pool.closeAll();
    expect(pool.size).toBe(0);
    expect(initializes).toBeGreaterThanOrEqual(3);
  });

  it('FR-006/NFR-001: timeout por chamada cancela no servidor', async () => {
    const conn = await McpConnection.open(
      { serverId: 's', transport: 'streamableHttp', url: `${server.url}/mcp` },
      settings(),
    );
    await expect(conn.callTool('lento', { ms: 5_000 }, { timeoutMs: 200 })).rejects.toThrow(
      McpTimeoutError,
    );
    await expect.poll(() => server.calls.some((c) => c.tool === 'lento:cancelado')).toBe(true);
    await conn.close();
  });

  it('FR-006: cancelamento pelo sinal envia notifications/cancelled', async () => {
    const before = server.calls.filter((c) => c.tool === 'lento:cancelado').length;
    const conn = await McpConnection.open(
      { serverId: 's', transport: 'streamableHttp', url: `${server.url}/mcp` },
      settings(),
    );
    const controller = new AbortController();
    const call = conn.callTool('lento', { ms: 5_000 }, { signal: controller.signal });
    await expect.poll(() => server.calls.some((c) => c.tool === 'lento')).toBe(true);
    controller.abort(new Error('cancelada pelo usuário'));
    await expect(call).rejects.toThrow('cancelada pelo usuário');
    await expect
      .poll(() => server.calls.filter((c) => c.tool === 'lento:cancelado').length)
      .toBe(before + 1);
    await conn.close();
  });

  it('FR-006: resultado acima do limite é recusado', async () => {
    const conn = await McpConnection.open(
      { serverId: 's', transport: 'streamableHttp', url: `${server.url}/mcp` },
      settings({ fetch: guardedFetchLike(recordingGuard, 256 * 1024), maxResultBytes: 256 * 1024 }),
    );
    await expect(conn.callTool('grande', { kb: 512 })).rejects.toThrow(McpResultTooLargeError);
    await conn.close();
  });
});
