import type { ExecutionStep, ExecutionSteps, SubExecutionRef } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import {
  filterLog,
  formatElapsed,
  logJson,
  logProgress,
  logRows,
  logText,
  logTime,
} from './execution-log';

const t = (ms: number) => new Date(Date.UTC(2026, 9, 19, 11, 58, 35) + ms).toISOString();
const TYPES: Record<string, string> = {
  m: 'trigger.webhook',
  x: 'flow.executeWorkflow',
  v: 'code.javascript',
};
const node = (
  nodeId: string,
  nodeName: string,
  start: number,
  end: number,
  extra: Partial<ExecutionStep> = {},
): ExecutionStep => ({
  nodeId,
  nodeName,
  nodeType: TYPES[nodeId] ?? '',
  runIndex: 0,
  status: 'success',
  startedAt: t(start),
  finishedAt: t(end),
  itemsIn: 1,
  itemsOut: 1,
  error: null,
  ...extra,
});

const detail: ExecutionSteps = {
  id: '0a1b2c3d-0000-4000-8000-000000000000',
  workflowId: 'wf',
  projectId: 'p',
  workflowVersion: 1,
  mode: 'production',
  triggerType: 'webhook',
  status: 'error',
  startedAt: t(0),
  finishedAt: t(5000),
  error: { message: 'Falhou no nó Validar', nodeId: 'v' },
  resumeAt: null,
  nodes: [
    { id: 'm', name: 'Webhook', type: 'trigger.webhook' },
    { id: 'x', name: 'Resolver', type: 'flow.executeWorkflow' },
    { id: 'v', name: 'Validar', type: 'code.javascript' },
  ],
  nodeCount: 3,
  executedNodeIds: ['m', 'x', 'v'],
  total: 4,
  steps: [
    node('m', 'Webhook', 0, 3),
    node('x', 'Resolver', 10, 3230),
    node('x', 'Resolver', 3300, 3400, { runIndex: 1 }),
    node('v', 'Validar', 3500, 3552, {
      status: 'error',
      itemsOut: 0,
      error: { name: 'Error', message: 'campo cpf ausente' },
    }),
  ],
  running: [],
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

/** Execução ainda em andamento: Webhook concluído e Resolver rodando há 2 s. */
const live: ExecutionSteps = {
  ...detail,
  status: 'running',
  finishedAt: null,
  error: null,
  executedNodeIds: ['m', 'x'],
  total: 1,
  steps: [node('m', 'Webhook', 0, 3)],
  running: [
    {
      nodeId: 'x',
      nodeName: 'Resolver',
      nodeType: 'flow.executeWorkflow',
      runIndex: 0,
      startedAt: t(10),
    },
  ],
  subExecutions: [{ ...(detail.subExecutions[0] as SubExecutionRef), status: 'running' }],
};

describe('spec 029 — acompanhamento ao vivo no Log', () => {
  it('FR-003: o passo em andamento vem no fim, com a duração correndo e sem itens', () => {
    const { rows } = logRows(live, Date.parse(t(2010)));
    expect(rows.map((r) => [r.nodeName, r.status, r.durationMs])).toEqual([
      ['Webhook', 'success', 3],
      ['Resolver', 'running', 2000],
    ]);
    expect(rows[1]).toMatchObject({
      itemsIn: null,
      itemsOut: null,
      nodeType: 'flow.executeWorkflow',
    });
    // A duração acompanha o relógio (FR-002).
    expect(logRows(live, Date.parse(t(5010))).rows[1]?.durationMs).toBe(5000);
  });

  it('FR-011: a subexecução ativa fica na linha do nó em andamento que a criou', () => {
    const { rows, orphans } = logRows(live, Date.parse(t(2010)));
    expect(rows[1]?.subExecutions.map((s) => [s.id, s.status])).toEqual([['sub-1', 'running']]);
    expect(orphans).toEqual([]);
  });

  it('FR-010: resumo com passos concluídos, em andamento e nós que já rodaram sobre o total', () => {
    expect(logProgress(live)).toEqual({
      done: 1,
      running: 1,
      executed: 2,
      nodeCount: 3,
      hidden: 0,
    });
  });

  it('FR-016: o resumo conta as linhas que ficaram fora das últimas 500', () => {
    expect(logProgress({ ...live, total: 1200, steps: live.steps }).hidden).toBe(1199);
  });

  it('FR-002: tempo decorrido legível', () => {
    expect(formatElapsed(999)).toBe('0 s');
    expect(formatElapsed(45_400)).toBe('45 s');
    expect(formatElapsed(245_000)).toBe('4 min 05 s');
    expect(formatElapsed(3_720_000)).toBe('1 h 02 min');
  });
});
