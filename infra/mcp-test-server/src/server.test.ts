import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMcpTestServer, type McpTestServer } from './server.js';

// eslint-disable-next-line @typescript-eslint/no-deprecated -- FR-004: transporte SSE legado
const LegacySseClientTransport = SSEClientTransport;

let server: McpTestServer;

beforeAll(async () => {
  server = await startMcpTestServer();
});
afterAll(async () => {
  await server.close();
});

async function connect(kind: 'http' | 'sse', headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'teste', version: '1.0.0' });
  const init = headers ? { requestInit: { headers } } : {};
  const transport =
    kind === 'http'
      ? new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), init)
      : new LegacySseClientTransport(new URL(`${server.url}/sse`), init);
  await client.connect(transport);
  return client;
}

describe('spec 010 — FR-013: servidor MCP de teste', () => {
  it('FR-013: Streamable HTTP lista as tools e chama soma', async () => {
    const client = await connect('http');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['echo', 'soma', 'consulta_cliente', 'apagar_registro', 'erro']),
    );
    const result = await client.callTool({ name: 'soma', arguments: { a: 2, b: 3 } });
    expect(result.structuredContent).toEqual({ resultado: 5 });
    expect((await client.callTool({ name: 'erro', arguments: {} })).isError).toBe(true);
    expect((await client.readResource({ uri: 'test://info' })).contents[0]).toMatchObject({
      text: 'Servidor MCP de teste do Olly Flow',
    });
    const prompt = await client.getPrompt({ name: 'saudacao', arguments: { nome: 'Ana' } });
    expect(JSON.stringify(prompt.messages)).toContain('Diga olá para Ana.');
    await client.close();
  });

  it('FR-013: SSE legado também responde', async () => {
    const client = await connect('sse');
    const result = await client.callTool({ name: 'echo', arguments: { texto: 'oi' } });
    expect(result.content).toEqual([{ type: 'text', text: 'oi' }]);
    await client.close();
  });

  it('FR-013: MUTATE_SCHEMA altera soma e avisa as sessões abertas', async () => {
    let changed = false;
    const client = new Client({ name: 'teste', version: '1.0.0' });
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      changed = true;
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)));
    // O aviso vai pelo stream GET da sessão, aberto logo após o `initialize`.
    await new Promise((r) => setTimeout(r, 200));
    server.setMutateSchema(true);
    await expect.poll(() => changed).toBe(true);
    const soma = (await client.listTools()).tools.find((t) => t.name === 'soma');
    expect(Object.keys(soma?.inputSchema.properties ?? {})).toContain('c');
    server.setMutateSchema(false);
    await client.close();
  });

  it('FR-013: com bearer, recusa sem o token', async () => {
    const secured = await startMcpTestServer({ auth: { kind: 'bearer', token: 't0k3n' } });
    try {
      const denied = new Client({ name: 't', version: '1' });
      await expect(
        denied.connect(new StreamableHTTPClientTransport(new URL(`${secured.url}/mcp`))),
      ).rejects.toThrow();
      const ok = new Client({ name: 't', version: '1' });
      await ok.connect(
        new StreamableHTTPClientTransport(new URL(`${secured.url}/mcp`), {
          requestInit: { headers: { authorization: 'Bearer t0k3n' } },
        }),
      );
      expect((await ok.listTools()).tools.length).toBeGreaterThan(0);
      await ok.close();
    } finally {
      await secured.close();
    }
  });
});
