import { CodeSandbox } from '@olly/expressions/isolate';
import { createNodeRegistry, type WebhookResponse } from '@olly/nodes';
import type { Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { runWorkflow, type NodeRunRecord } from './run.js';

const codeRunner = new CodeSandbox({ timeoutMs: 5000, memoryMb: 64 });
const registry = createNodeRegistry();

const node = (
  id: string,
  type: string,
  name: string,
  params: Record<string, unknown> = {},
): WorkflowNode => ({
  id,
  type,
  name,
  params,
  position: [0, 0],
});
const edge = (from: string, to: string): Edge => ({
  id: `${from}-${to}`,
  from,
  fromPort: 'main',
  to,
  toPort: 'main',
});
const chain = (...nodes: WorkflowNode[]): WorkflowDefinition => ({
  nodes,
  edges: nodes.slice(1).map((n, i) => edge(nodes[i]?.id ?? '', n.id)),
  settings: {},
});
const pinData = { m: [{ json: { q: 2, p: 5 } }, { json: { q: 3, p: 10 } }] };
const manual = node('m', 'trigger.manual', 'Início');

describe('spec 005 — FR-009/FR-012: nó code.javascript no motor', () => {
  it('FR-009/HU-3.1: calcula total por item; console vai para o registro do nó', async () => {
    const records: NodeRunRecord[] = [];
    const result = await runWorkflow(
      chain(
        manual,
        node('c', 'code.javascript', 'Código', {
          jsCode:
            "console.log('itens', $input.all().length);\nreturn $input.all().map(i => ({ json: { ...i.json, total: i.json.q * i.json.p, origem: $('Início').first().json.q } }))",
        }),
      ),
      registry,
      { codeRunner, pinData, callbacks: { onNodeFinish: (r) => void records.push(r) } },
    );
    expect(result.status).toBe('success');
    expect(result.nodes.c?.output?.main).toEqual([
      { json: { q: 2, p: 5, total: 10, origem: 2 }, pairedItem: { item: 0 } },
      { json: { q: 3, p: 10, total: 30, origem: 2 }, pairedItem: { item: 1 } },
    ]);
    expect(records.find((r) => r.nodeId === 'c')?.console).toEqual(['itens 2']);
  });

  it('FR-011/HU-3.2: erro no código falha o nó com mensagem clara e guarda o console', async () => {
    const records: NodeRunRecord[] = [];
    const result = await runWorkflow(
      chain(
        manual,
        node('c', 'code.javascript', 'Código', { jsCode: "console.log('a'); return 5;" }),
      ),
      registry,
      { codeRunner, pinData, callbacks: { onNodeFinish: (r) => void records.push(r) } },
    );
    expect(result.error).toEqual({
      nodeId: 'c',
      message: 'O código deve retornar um objeto ou array de objetos',
    });
    expect(records.find((r) => r.nodeId === 'c')?.console).toEqual(['a']);
    const loop = await runWorkflow(
      chain(manual, node('c', 'code.javascript', 'Código', { jsCode: "require('fs')" })),
      registry,
      { codeRunner, pinData },
    );
    expect(loop.error?.message).toBe('Erro no código: require is not defined');
  });

  it('FR-008: a resposta do webhook é entregue uma vez (a primeira vale)', async () => {
    const responses: WebhookResponse[] = [];
    const result = await runWorkflow(
      chain(
        manual,
        node('r1', 'http.respondToWebhook', 'Responder', { responseCode: 201 }),
        node('r2', 'http.respondToWebhook', 'Responder de novo', { responseCode: 500 }),
      ),
      registry,
      { pinData, onWebhookResponse: (r) => void responses.push(r) },
    );
    expect(result.status).toBe('success');
    expect(responses).toEqual([
      { statusCode: 201, headers: {}, body: { kind: 'json', value: { q: 2, p: 5 } } },
    ]);
  });
});
