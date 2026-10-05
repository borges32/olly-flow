import { describe, expect, it } from 'vitest';
import { fakeContext } from '../../test-support/context.js';
import { respondToWebhookNode } from './definition.js';

const items = [{ json: { id: 1 } }, { json: { id: 2 } }];
const run = async (params: Record<string, unknown>, input = items) => {
  const ctx = fakeContext({ params });
  const out = await respondToWebhookNode.execute({ inputs: { main: input }, items: input }, ctx);
  return { ctx, out };
};

describe('spec 005 — FR-008: Responder ao webhook', () => {
  it('FR-008: primeiro item, todos os itens, texto, vazio e binário, com status e cabeçalhos', async () => {
    const first = await run({
      responseCode: 201,
      responseHeaders: [{ name: 'X-Origem', value: 'olly' }],
    });
    expect(first.ctx.responses).toEqual([
      {
        statusCode: 201,
        headers: { 'X-Origem': 'olly' },
        body: { kind: 'json', value: { id: 1 } },
      },
    ]);
    expect(first.out).toEqual({ main: items });
    expect((await run({ respondWith: 'allItemsJson' })).ctx.responses[0]?.body).toEqual({
      kind: 'json',
      value: [{ id: 1 }, { id: 2 }],
    });
    expect((await run({ respondWith: 'text', responseBody: 'ok' })).ctx.responses[0]?.body).toEqual(
      {
        kind: 'text',
        value: 'ok',
      },
    );
    expect((await run({ respondWith: 'noData', responseCode: 204 })).ctx.responses[0]).toEqual({
      statusCode: 204,
      headers: {},
    });
    const ref = { id: 'b1', mimeType: 'application/pdf' };
    const bin = await run({ respondWith: 'binary' }, [
      { json: {}, binary: { data: ref } } as never,
    ]);
    expect(bin.ctx.responses[0]?.body).toEqual({ kind: 'binary', ref });
    await expect(run({ respondWith: 'binary' })).rejects.toThrow('propriedade binária "data"');
  });

  it('caso de borda: executado duas vezes, vale a primeira resposta (a segunda só gera aviso)', async () => {
    const ctx = fakeContext({ params: {} });
    await respondToWebhookNode.execute({ inputs: { main: items }, items }, ctx);
    await respondToWebhookNode.execute({ inputs: { main: items }, items }, ctx);
    expect(ctx.logs).toEqual(['O webhook já foi respondido; esta resposta foi ignorada']);
  });
});
