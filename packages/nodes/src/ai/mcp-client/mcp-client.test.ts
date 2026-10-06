import type { McpToolDefinition } from '@olly/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { NodeExecutionError, NodeParameterError } from '../../errors.js';
import { createNodeRegistry } from '../../builtin.js';
import { fakeContext } from '../../test-support/context.js';
import type { McpGateway, McpToolCallResult } from '../../types.js';
import { mcpClientNode } from './definition.js';

const soma: McpToolDefinition = {
  name: 'soma',
  description: 'Soma dois números.',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' }, nota: { type: 'string' } },
    required: ['a', 'b'],
  },
};

function gateway(result: McpToolCallResult = { content: [{ type: 'text', text: '5' }] }) {
  return {
    prepareTool: vi.fn(() => Promise.resolve(soma)),
    callTool: vi.fn(() => Promise.resolve(result)),
    listTools: vi.fn(() => Promise.resolve([soma])),
    agentTools: vi.fn(() =>
      Promise.resolve([{ definition: soma, destructive: false, readOnly: true }]),
    ),
    listResources: vi.fn(() => Promise.resolve([{ uri: 'test://info', name: 'info' }])),
    readResource: vi.fn(() =>
      Promise.resolve({ contents: [{ uri: 'test://info', mimeType: 'text/plain', text: 'oi' }] }),
    ),
    listPrompts: vi.fn(() => Promise.resolve([{ name: 'saudacao' }])),
    getPrompt: vi.fn(() =>
      Promise.resolve({ messages: [{ role: 'user', content: { type: 'text', text: 'Olá Ana' } }] }),
    ),
  } satisfies McpGateway;
}

const call = (params: Record<string, unknown>) => ({
  serverId: 'srv',
  operation: 'callTool',
  toolName: 'soma',
  argumentsMode: 'form',
  ...params,
});

describe('spec 010 — FR-008: nó ai.mcpClient', () => {
  it('FR-008: o nó está no registro com as seis operações e as credenciais MCP', () => {
    const def = createNodeRegistry().get('ai.mcpClient');
    expect(def?.supportsParallelItems).toBe(true);
    expect(def?.credentialTypes).toEqual(['mcpBearer', 'mcpHeaders', 'mcpOAuth']);
    const operation = mcpClientNode.paramsSchema.properties?.operation as { enum: string[] };
    expect(operation.enum).toEqual([
      'callTool',
      'listTools',
      'readResource',
      'listResources',
      'getPrompt',
      'listPrompts',
    ]);
  });

  it('FR-008/SC-001: chama a tool com argumentos vindos das expressões (já resolvidas)', async () => {
    const mcp = gateway({
      content: [{ type: 'text', text: '5' }],
      structuredContent: { resultado: 5 },
    });
    const ctx = fakeContext({
      params: [call({ arguments: { a: '2', b: 3 } }), call({ arguments: { a: 10, b: '5' } })],
      mcp,
      runIndex: 2,
    });
    const out = await mcpClientNode.execute(
      { inputs: {}, items: [{ json: {} }, { json: {} }] },
      ctx,
    );
    expect(out.main?.map((i) => i.json)).toEqual([
      {
        content: [{ type: 'text', text: '5' }],
        structuredContent: { resultado: 5 },
        isError: false,
      },
      {
        content: [{ type: 'text', text: '5' }],
        structuredContent: { resultado: 5 },
        isError: false,
      },
    ]);
    // Formulário: "2" vira 2 pelo schema (coerção), e o registro identifica item e execução.
    expect(mcp.callTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        serverId: 'srv',
        toolName: 'soma',
        arguments: { a: 2, b: 3 },
        nodeId: 'n',
        runIndex: 2,
        itemIndex: 0,
      }),
    );
    expect(mcp.callTool).toHaveBeenNthCalledWith(2, expect.objectContaining({ itemIndex: 1 }));
  });

  it('FR-008: listar tools, resources e prompts; ler resource; obter prompt', async () => {
    const mcp = gateway();
    const run = async (params: Record<string, unknown>) =>
      (
        await mcpClientNode.execute(
          { inputs: {}, items: [{ json: {} }] },
          fakeContext({ params: { serverId: 'srv', ...params }, mcp }),
        )
      ).main?.[0]?.json;
    expect(await run({ operation: 'listTools' })).toEqual({ tools: [soma] });
    expect(await run({ operation: 'listResources' })).toEqual({
      resources: [{ uri: 'test://info', name: 'info' }],
    });
    expect(await run({ operation: 'readResource', resourceUri: 'test://info' })).toEqual({
      uri: 'test://info',
      contents: [{ uri: 'test://info', mimeType: 'text/plain', text: 'oi' }],
    });
    expect(await run({ operation: 'listPrompts' })).toEqual({ prompts: [{ name: 'saudacao' }] });
    expect(
      await run({
        operation: 'getPrompt',
        promptName: 'saudacao',
        promptArguments: [{ name: 'nome', value: 'Ana' }],
      }),
    ).toEqual({ messages: [{ role: 'user', content: { type: 'text', text: 'Olá Ana' } }] });
    expect(mcp.getPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'saudacao', arguments: { nome: 'Ana' } }),
    );
  });
});

describe('spec 010 — FR-009/SC-004: argumentos validados antes da chamada', () => {
  it('FR-009/SC-004: argumento inválido falha sem chamar o servidor', async () => {
    const mcp = gateway();
    const ctx = fakeContext({ params: call({ arguments: { a: 'dois' } }), mcp });
    const run = mcpClientNode.execute({ inputs: {}, items: [{ json: {} }] }, ctx);
    await expect(run).rejects.toThrow(NodeExecutionError);
    await expect(run).rejects.toThrow('Argumentos inválidos para a tool "soma"');
    await run.catch((e: unknown) => {
      expect((e as NodeExecutionError).details.description).toMatch(/a: must be number/);
      expect((e as NodeExecutionError).details.description).toMatch(/b/);
    });
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('FR-009: modo JSON (texto ou objeto), sem coerção de tipos', async () => {
    const mcp = gateway();
    const exec = (argumentsJson: unknown) =>
      mcpClientNode.execute(
        { inputs: {}, items: [{ json: {} }] },
        fakeContext({ params: call({ argumentsMode: 'json', argumentsJson }), mcp }),
      );
    await exec('{"a": 1, "b": 2}');
    await exec({ a: 3, b: 4 });
    expect(
      mcp.callTool.mock.calls.map((c) => (c as unknown as [{ arguments: unknown }])[0].arguments),
    ).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
    await expect(exec('{"a": "1", "b": 2}')).rejects.toThrow(/Argumentos inválidos/);
    await expect(exec('{a:')).rejects.toThrow(NodeParameterError);
  });

  it('FR-009: campo opcional vazio do formulário não é enviado', async () => {
    const mcp = gateway();
    await mcpClientNode.execute(
      { inputs: {}, items: [{ json: {} }] },
      fakeContext({ params: call({ arguments: { a: 1, b: 2, nota: '' } }), mcp }),
    );
    expect(mcp.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ arguments: { a: 1, b: 2 } }),
    );
  });
});

describe('spec 010 — FR-010/FR-012: binários, isError e negação', () => {
  it('FR-010: conteúdo binário vai para o storage e fica referenciado no item', async () => {
    const png = Buffer.from('png-fake').toString('base64');
    const mcp = gateway({
      content: [
        { type: 'text', text: 'Um pixel' },
        { type: 'image', data: png, mimeType: 'image/png' },
      ],
    });
    const ctx = fakeContext({ params: call({ arguments: { a: 1, b: 2 } }), mcp });
    const [item] =
      (await mcpClientNode.execute({ inputs: {}, items: [{ json: {} }] }, ctx)).main ?? [];
    expect(item?.json.content).toEqual([
      { type: 'text', text: 'Um pixel' },
      { type: 'image', mimeType: 'image/png', binaryProperty: 'data' },
    ]);
    expect(item?.binary?.data).toMatchObject({ mimeType: 'image/png', size: 8 });
    expect(Buffer.from(ctx.binaries.get(item?.binary?.data?.id ?? '') ?? []).toString()).toBe(
      'png-fake',
    );
  });

  it('FR-010: isError falha o nó; com onError continue vira item de erro', async () => {
    const mcp = gateway({ isError: true, content: [{ type: 'text', text: 'Falha simulada' }] });
    const params = call({ arguments: { a: 1, b: 2 } });
    await expect(
      mcpClientNode.execute({ inputs: {}, items: [{ json: {} }] }, fakeContext({ params, mcp })),
    ).rejects.toThrow('Falha simulada');
    const out = await mcpClientNode.execute(
      { inputs: {}, items: [{ json: { id: 7 } }] },
      fakeContext({ params, mcp, node: { settings: { onError: 'continue' } } }),
    );
    expect(out.main?.[0]?.json).toMatchObject({ error: { message: 'Falha simulada' } });
    const routed = await mcpClientNode.execute(
      { inputs: {}, items: [{ json: { id: 7 } }] },
      fakeContext({ params, mcp, node: { settings: { onError: 'errorOutput' } } }),
    );
    expect(routed.main).toEqual([]);
    expect(routed.error?.[0]?.json).toMatchObject({ id: 7, error: { message: 'Falha simulada' } });
  });

  it('FR-012: tool negada falha com o erro do gateway e não é chamada', async () => {
    const mcp = gateway();
    mcp.prepareTool.mockRejectedValueOnce(new Error('Tool "apagar" não está liberada'));
    await expect(
      mcpClientNode.execute(
        { inputs: {}, items: [{ json: {} }] },
        fakeContext({ params: call({ toolName: 'apagar' }), mcp }),
      ),
    ).rejects.toThrow('não está liberada');
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('FR-007: a credencial do nó vai para o gateway', async () => {
    const mcp = gateway();
    const credential = { id: 'c1', type: 'mcpBearer', data: { token: 't' }, updatedAt: '' };
    await mcpClientNode.execute(
      { inputs: {}, items: [{ json: {} }] },
      fakeContext({ params: { serverId: 'srv', operation: 'listTools' }, mcp, credential }),
    );
    expect(mcp.listTools).toHaveBeenCalledWith(expect.objectContaining({ credential }));
  });
});
