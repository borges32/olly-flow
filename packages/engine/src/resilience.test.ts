import { createNodeRegistry, manualTrigger, setNode, type NodeDefinition } from '@olly/nodes';
import type { Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { REDACTED } from './redact.js';
import { runWorkflow, type CredentialResolver, type NodeRunRecord } from './run.js';

const manual: WorkflowNode = {
  id: 'm',
  type: 'trigger.manual',
  name: 'Início',
  params: {},
  position: [0, 0],
};
const edge = (from: string, to: string): Edge => ({
  id: `${from}-${to}`,
  from,
  fromPort: 'main',
  to,
  toPort: 'main',
});
const def = (nodes: WorkflowNode[], edges: Edge[]): WorkflowDefinition => ({
  nodes,
  edges,
  settings: {},
});
const node = (id: string, type: string, extra: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id,
  type,
  name: id.toUpperCase(),
  params: {},
  position: [0, 0],
  ...extra,
});
const testNode = (
  type: string,
  execute: NodeDefinition['execute'],
  extra: Partial<NodeDefinition> = {},
): NodeDefinition => ({ ...setNode, type, paramsSchema: { type: 'object' }, execute, ...extra });

describe('spec 004 — FR-017/FR-018: resiliência por nó no motor', () => {
  it('FR-017: retry com backoff exponencial até dar certo; tentativas registradas', async () => {
    const calls: number[] = [];
    const flaky = testNode('test.flaky', (input) => {
      calls.push(Date.now());
      return calls.length < 3
        ? Promise.reject(new Error('instável'))
        : Promise.resolve({ main: input.items });
    });
    const records: NodeRunRecord[] = [];
    const result = await runWorkflow(
      def(
        [
          manual,
          node('f', 'test.flaky', {
            settings: { retry: { maxTries: 3, waitMs: 30, backoff: 'exponential' } },
          }),
        ],
        [edge('m', 'f')],
      ),
      createNodeRegistry([manualTrigger, flaky]),
      { callbacks: { onNodeFinish: (r) => void records.push(r) } },
    );
    expect(result.status).toBe('success');
    expect(calls).toHaveLength(3);
    // Esperas de 30 e 60 ms (exponencial), com folga para o agendador.
    expect((calls[1] ?? 0) - (calls[0] ?? 0)).toBeGreaterThanOrEqual(25);
    expect((calls[2] ?? 0) - (calls[1] ?? 0)).toBeGreaterThanOrEqual(55);
    expect(records.find((r) => r.nodeId === 'f')?.attempts).toBe(3);
  });

  it('FR-017: esgotadas as tentativas com onError stop, a execução falha', async () => {
    let calls = 0;
    const failing = testNode('test.falha', () => {
      calls++;
      return Promise.reject(new Error('sempre falha'));
    });
    const result = await runWorkflow(
      def(
        [manual, node('f', 'test.falha', { settings: { retry: { maxTries: 2, waitMs: 1 } } })],
        [edge('m', 'f')],
      ),
      createNodeRegistry([manualTrigger, failing]),
    );
    expect(calls).toBe(2);
    expect(result).toMatchObject({
      status: 'error',
      error: { nodeId: 'f', message: 'sempre falha' },
    });
  });

  it('FR-018: timeout interrompe nó que não termina e aborta o sinal entregue a ele', async () => {
    let aborted = false;
    const hang = testNode('test.trava', (_input, ctx) => {
      ctx.signal.addEventListener('abort', () => {
        aborted = true;
      });
      return new Promise(() => undefined);
    });
    const started = Date.now();
    const result = await runWorkflow(
      def([manual, node('t', 'test.trava', { settings: { timeoutMs: 50 } })], [edge('m', 't')]),
      createNodeRegistry([manualTrigger, hang]),
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(aborted).toBe(true);
    expect(result.error?.message).toBe('Tempo limite do nó excedido (50 ms)');
  });

  it('FR-018: cancelar a execução interrompe a espera entre tentativas', async () => {
    let calls = 0;
    const failing = testNode('test.falha', () => {
      calls++;
      return Promise.reject(new Error('falha'));
    });
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new Error('Execução cancelada pelo usuário'));
    }, 50);
    const result = await runWorkflow(
      def(
        [manual, node('f', 'test.falha', { settings: { retry: { maxTries: 5, waitMs: 10_000 } } })],
        [edge('m', 'f')],
      ),
      createNodeRegistry([manualTrigger, failing]),
      { signal: controller.signal },
    );
    expect(calls).toBe(1);
    expect(result.error?.message).toBe('Execução cancelada pelo usuário');
  });

  it('FR-017: onError continue emite { json: { error } } e os nós seguintes executam', async () => {
    const failing = testNode('test.falha', () => Promise.reject(new Error('quebrou')));
    const result = await runWorkflow(
      def(
        [
          manual,
          node('f', 'test.falha', { settings: { onError: 'continue' } }),
          {
            id: 's',
            type: 'data.set',
            name: 'Depois',
            params: {
              fields: [{ name: 'ok', type: 'boolean', value: 'true' }],
              includeOtherFields: true,
            },
            position: [0, 0],
          },
        ],
        [edge('m', 'f'), edge('f', 's')],
      ),
      createNodeRegistry([manualTrigger, setNode, failing]),
    );
    expect(result.status).toBe('success');
    expect(result.nodes.f?.output?.main).toEqual([
      { json: { error: { message: 'quebrou' } }, pairedItem: { item: 0 } },
    ]);
    expect(result.nodes.s?.output?.main?.[0]?.json).toEqual({
      error: { message: 'quebrou' },
      ok: true,
    });
  });
});

describe('spec 004 — FR-003/FR-007: credenciais no motor', () => {
  const SECRET = 'segredo-sentinela-987';
  const credentials: CredentialResolver = (n) =>
    Promise.resolve({
      credential: {
        id: n.credentialId ?? '',
        type: 'httpBearer',
        data: { token: SECRET },
        updatedAt: '',
      },
      secrets: [SECRET],
    });
  // Nó que expõe o segredo na saída e no log (como uma API que ecoa o cabeçalho).
  const echo = testNode(
    'test.eco',
    async (input, ctx) => {
      const { data } = await ctx.getCredential();
      ctx.helpers.registerSecret('token-derivado-xyz');
      ctx.logger.info(`usando ${String(data.token)}`);
      return {
        main: input.items.map(() => ({
          json: { visto: data.token, derivado: 'token-derivado-xyz' },
        })),
      };
    },
    { credentialTypes: ['httpBearer'] },
  );

  it('FR-003: segredos são mascarados no que é gravado, mas chegam intactos ao próximo nó', async () => {
    const records: NodeRunRecord[] = [];
    const logs: string[] = [];
    const log = (m: string) => void logs.push(m);
    const result = await runWorkflow(
      def(
        [
          manual,
          node('e', 'test.eco', { credentialId: 'c1' }),
          {
            id: 's',
            type: 'data.set',
            name: 'Depois',
            params: { fields: [], includeOtherFields: true },
            position: [0, 0],
          },
        ],
        [edge('m', 'e'), edge('e', 's')],
      ),
      createNodeRegistry([manualTrigger, setNode, echo]),
      {
        credentials,
        logger: { debug: log, info: log, warn: log, error: log },
        callbacks: { onNodeFinish: (r) => void records.push(r) },
      },
    );
    // Dados entre nós: inalterados (constituição VIII.2).
    expect(result.nodes.s?.output?.main?.[0]?.json.visto).toBe(SECRET);
    const recorded = JSON.stringify(records);
    expect(recorded).not.toContain(SECRET);
    expect(recorded).not.toContain('token-derivado-xyz');
    expect(records.find((r) => r.nodeId === 's')?.inputs.main?.[0]?.json.visto).toBe(REDACTED);
    expect(logs.join('\n')).not.toContain(SECRET);
    expect(logs).toContain(`usando ${REDACTED}`);
  });

  it('FR-003: mensagem de erro com o segredo é mascarada', async () => {
    const leaky = testNode(
      'test.vaza',
      async (_i, ctx) => {
        const { data } = await ctx.getCredential();
        throw new Error(`falhou com ${String(data.token)}`);
      },
      { credentialTypes: ['httpBearer'] },
    );
    const records: NodeRunRecord[] = [];
    const result = await runWorkflow(
      def([manual, node('v', 'test.vaza', { credentialId: 'c1' })], [edge('m', 'v')]),
      createNodeRegistry([manualTrigger, leaky]),
      { credentials, callbacks: { onNodeFinish: (r) => void records.push(r) } },
    );
    expect(result.error?.message).toBe(`falhou com ${REDACTED}`);
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('FR-007: nó sem credencial selecionada ou com tipo incompatível falha com mensagem clara', async () => {
    const run = (n: WorkflowNode, resolver: CredentialResolver) =>
      runWorkflow(def([manual, n], [edge('m', n.id)]), createNodeRegistry([manualTrigger, echo]), {
        credentials: resolver,
      });
    expect((await run(node('e', 'test.eco'), credentials)).error?.message).toBe(
      'Nó "E": selecione uma credencial',
    );
    const wrongType: CredentialResolver = (n) =>
      Promise.resolve({
        credential: { id: n.credentialId ?? '', type: 'postgres', data: {}, updatedAt: '' },
        secrets: [],
      });
    expect(
      (await run(node('e', 'test.eco', { credentialId: 'c1' }), wrongType)).error?.message,
    ).toBe('Nó "E": credencial do tipo postgres não serve para este nó');
  });
});
