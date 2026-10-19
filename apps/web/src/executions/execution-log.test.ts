import type { ExecutionDetail, NodeExecutionDetail } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { filterLog, logJson, logRows, logText, logTime } from './execution-log';

const t = (ms: number) => new Date(Date.UTC(2026, 9, 19, 11, 58, 35) + ms).toISOString();
const node = (
  nodeId: string,
  nodeName: string,
  start: number,
  end: number,
  extra: Partial<NodeExecutionDetail> = {},
): NodeExecutionDetail => ({
  nodeId,
  nodeName,
  runIndex: 0,
  status: 'success',
  startedAt: t(start),
  finishedAt: t(end),
  itemsIn: 1,
  itemsOut: 1,
  pinned: false,
  reused: false,
  dataTruncated: false,
  input: null,
  output: null,
  console: null,
  error: null,
  ...extra,
});

const detail: ExecutionDetail = {
  id: '0a1b2c3d-0000-4000-8000-000000000000',
  workflowId: 'wf',
  projectId: 'p',
  workflowVersion: 1,
  mode: 'production',
  triggerType: 'webhook',
  triggeredBy: null,
  status: 'error',
  startedAt: t(0),
  finishedAt: t(5000),
  error: { message: 'Falhou no nó Validar', nodeId: 'v' },
  dataRedacted: true,
  definition: {
    nodes: [
      { id: 'm', type: 'trigger.webhook', name: 'Webhook', params: {}, position: [0, 0] },
      { id: 'x', type: 'flow.executeWorkflow', name: 'Resolver', params: {}, position: [0, 0] },
      { id: 'v', type: 'code.javascript', name: 'Validar', params: {}, position: [0, 0] },
    ],
    edges: [],
    settings: {},
  },
  nodes: [
    node('m', 'Webhook', 0, 3),
    node('x', 'Resolver', 10, 3230),
    node('x', 'Resolver', 3300, 3400, { runIndex: 1 }),
    node('v', 'Validar', 3500, 3552, {
      status: 'error',
      itemsOut: 0,
      error: { name: 'Error', message: 'campo cpf ausente' },
    }),
  ],
  subExecutions: [
    {
      id: 'sub-1',
      workflowId: 'filho',
      workflowName: 'Filho',
      nodeId: 'x',
      status: 'success',
      startedAt: t(20),
    },
    {
      id: 'sub-2',
      workflowId: 'filho',
      workflowName: 'Filho',
      nodeId: 'x',
      status: 'success',
      startedAt: t(3310),
    },
    {
      id: 'sub-ferramenta',
      workflowId: 'filho',
      workflowName: 'Filho',
      nodeId: 'ferramenta',
      status: 'success',
      startedAt: t(3320),
    },
  ],
};

describe('spec 026 — log da execução', () => {
  it('FR-002: uma linha por execução de nó, na ordem, com tipo, duração, itens e erro; a falha geral no fim', () => {
    const { rows } = logRows(detail);
    expect(rows.map((r) => [r.nodeName, r.nodeType, r.runIndex, r.status, r.durationMs])).toEqual([
      ['Webhook', 'trigger.webhook', 0, 'success', 3],
      ['Resolver', 'flow.executeWorkflow', 0, 'success', 3220],
      ['Resolver', 'flow.executeWorkflow', 1, 'success', 100],
      ['Validar', 'code.javascript', 0, 'error', 52],
      ['Execução', '', 0, 'error', null],
    ]);
    expect(rows[3]?.error).toBe('campo cpf ausente');
    expect(rows[4]?.error).toBe('Falhou no nó Validar');
    expect(rows[0]?.time).toBe(logTime(t(0)));
    expect(rows[0]?.time).toMatch(/^\d{2}:\d{2}:\d{2},000$/);
  });

  it('FR-004: subexecução na iteração do nó que a criou; sem nó no log, fica à parte', () => {
    const { rows, orphans } = logRows(detail);
    expect(rows[1]?.subExecutions.map((s) => s.id)).toEqual(['sub-1']);
    expect(rows[2]?.subExecutions.map((s) => s.id)).toEqual(['sub-2']);
    expect(orphans.map((s) => s.id)).toEqual(['sub-ferramenta']);
  });

  it('FR-003: filtra por status e por texto (nome, tipo ou mensagem)', () => {
    const { rows } = logRows(detail);
    expect(filterLog(rows, 'error', '').map((r) => r.nodeName)).toEqual(['Validar', 'Execução']);
    expect(filterLog(rows, 'all', 'RESOLVER')).toHaveLength(2);
    expect(filterLog(rows, 'all', 'javascript').map((r) => r.nodeName)).toEqual(['Validar']);
    expect(filterLog(rows, 'all', 'cpf').map((r) => r.nodeName)).toEqual(['Validar']);
    expect(filterLog(rows, 'success', 'cpf')).toEqual([]);
  });

  it('FR-003: texto e JSON trazem o cabeçalho e só as linhas filtradas', () => {
    const { rows } = logRows(detail);
    const filtered = filterLog(rows, 'all', 'resolver');
    const text = logText(detail, 'Orquestrador', filtered);
    const lines = text.split('\n');
    expect(lines[0]).toBe(`Log — execução ${detail.id} · Orquestrador`);
    expect(lines[1]).toMatch(/^error · produção · webhook · .+ → .+ · 5\.00 s$/);
    expect(lines.slice(3)).toHaveLength(2);
    expect(lines[3]).toContain('Resolver\tflow.executeWorkflow\tsuccess\t3.22 s\t1 → 1');
    expect(lines[3]).toContain('subexecução sub-1');
    expect(lines[4]).toContain('Resolver #2');

    const json = logJson(detail, 'Orquestrador', filtered);
    expect(json.execution).toMatchObject({ id: detail.id, workflowName: 'Orquestrador' });
    expect(json.events.map((e) => [e.nodeName, e.runIndex, e.subExecutions])).toEqual([
      ['Resolver', 0, ['sub-1']],
      ['Resolver', 1, ['sub-2']],
    ]);
  });
});
