import type { ExecutionDetail, NodeExecutionStatus, SubExecutionRef } from '@olly/shared-types';

/** Linha do log da execução (spec 026, FR-002): uma por execução de nó, mais a falha geral. */
export interface LogRow {
  key: string;
  kind: 'node' | 'execution';
  /** Horário local com milissegundos (`HH:mm:ss,SSS`). */
  time: string;
  startedAt: string;
  nodeId: string | null;
  nodeName: string;
  nodeType: string;
  status: NodeExecutionStatus | ExecutionDetail['status'];
  durationMs: number | null;
  itemsIn: number | null;
  itemsOut: number | null;
  /** Iteração do laço (spec 007): 0, 1, 2... */
  runIndex: number;
  error: string | null;
  subExecutions: SubExecutionRef[];
}

export type LogStatusFilter = 'all' | NodeExecutionStatus;

export const LOG_STATUS_LABEL: Record<LogStatusFilter, string> = {
  all: 'Todos os eventos',
  success: 'Sucesso',
  error: 'Erro',
  skipped: 'Sem dados',
  waiting: 'Aguardando',
  cancelled: 'Interrompido',
  running: 'Executando',
};

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

export function logTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())},${pad(d.getMilliseconds(), 3)}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${String(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const between = (startIso: string, endIso: string | null) =>
  endIso === null ? null : Date.parse(endIso) - Date.parse(startIso);

/**
 * Linhas na ordem da API (início e iteração), com o tipo do nó da definição executada e as
 * subexecuções de cada nó (FR-004): na iteração cujo intervalo contém o início da subexecução;
 * sem intervalo que a contenha, na última iteração do nó.
 */
export function logRows(detail: ExecutionDetail): { rows: LogRow[]; orphans: SubExecutionRef[] } {
  const types = new Map((detail.definition?.nodes ?? []).map((n) => [n.id, n.type]));
  const rows: LogRow[] = detail.nodes.map((n) => ({
    key: `${n.nodeId}#${String(n.runIndex)}`,
    kind: 'node',
    time: logTime(n.startedAt),
    startedAt: n.startedAt,
    nodeId: n.nodeId,
    nodeName: n.nodeName,
    nodeType: types.get(n.nodeId) ?? '',
    status: n.status,
    durationMs: between(n.startedAt, n.finishedAt),
    itemsIn: n.itemsIn,
    itemsOut: n.itemsOut,
    runIndex: n.runIndex,
    error: n.error?.message ?? null,
    subExecutions: [],
  }));
  const orphans: SubExecutionRef[] = [];
  for (const sub of detail.subExecutions) {
    const candidates = rows.filter((r) => r.nodeId !== null && r.nodeId === sub.nodeId);
    const at = Date.parse(sub.startedAt);
    const target =
      candidates.find(
        (r) =>
          Date.parse(r.startedAt) <= at &&
          (r.durationMs === null || at <= Date.parse(r.startedAt) + r.durationMs),
      ) ?? candidates.at(-1);
    if (target) target.subExecutions.push(sub);
    else orphans.push(sub);
  }
  if (detail.error) {
    const at = detail.finishedAt ?? detail.startedAt;
    rows.push({
      key: 'execution',
      kind: 'execution',
      time: logTime(at),
      startedAt: at,
      nodeId: null,
      nodeName: 'Execução',
      nodeType: '',
      status: detail.status,
      durationMs: null,
      itemsIn: null,
      itemsOut: null,
      runIndex: 0,
      error: detail.error.message,
      subExecutions: [],
    });
  }
  return { rows, orphans };
}

/** FR-003: status e texto (nome, tipo ou mensagem, sem diferenciar maiúsculas). */
export function filterLog(rows: LogRow[], status: LogStatusFilter, text: string): LogRow[] {
  const needle = text.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (status === 'all' || r.status === status) &&
      (!needle ||
        [r.nodeName, r.nodeType, r.error ?? ''].some((v) => v.toLowerCase().includes(needle))),
  );
}

export const shortId = (id: string) => id.slice(0, 8);

const MODE_LABEL = { test: 'teste', production: 'produção' } as const;

/** Linha de resumo do cabeçalho (status · modo · gatilho · início → fim · duração). */
export function logSummary(detail: ExecutionDetail): string {
  const end = detail.finishedAt ? new Date(detail.finishedAt).toLocaleString('pt-BR') : '…';
  return [
    detail.status,
    MODE_LABEL[detail.mode],
    detail.triggerType,
    `${new Date(detail.startedAt).toLocaleString('pt-BR')} → ${end}`,
    formatDuration(between(detail.startedAt, detail.finishedAt)),
  ].join(' · ');
}

const rowText = (r: LogRow) =>
  [
    r.time,
    r.runIndex > 0 ? `${r.nodeName} #${String(r.runIndex + 1)}` : r.nodeName,
    r.nodeType,
    r.status,
    formatDuration(r.durationMs),
    r.itemsIn === null ? '' : `${String(r.itemsIn)} → ${String(r.itemsOut)}`,
    r.error ?? '',
    r.subExecutions.map((s) => `subexecução ${s.id}`).join(', '),
  ]
    .join('\t')
    .trimEnd();

/** FR-003: texto para copiar e baixar (`.txt`), com as linhas filtradas. */
export function logText(detail: ExecutionDetail, workflowName: string, rows: LogRow[]): string {
  return [
    `Log — execução ${detail.id} · ${workflowName}`,
    logSummary(detail),
    '',
    ...rows.map(rowText),
  ].join('\n');
}

/** FR-003: conteúdo do `.json`, com as linhas filtradas. */
export function logJson(detail: ExecutionDetail, workflowName: string, rows: LogRow[]) {
  return {
    execution: {
      id: detail.id,
      workflowId: detail.workflowId,
      workflowName,
      status: detail.status,
      mode: detail.mode,
      triggerType: detail.triggerType,
      startedAt: detail.startedAt,
      finishedAt: detail.finishedAt,
      error: detail.error,
    },
    events: rows.map((r) => ({
      startedAt: r.startedAt,
      nodeId: r.nodeId,
      nodeName: r.nodeName,
      nodeType: r.nodeType,
      runIndex: r.runIndex,
      status: r.status,
      durationMs: r.durationMs,
      itemsIn: r.itemsIn,
      itemsOut: r.itemsOut,
      error: r.error,
      subExecutions: r.subExecutions.map((s) => s.id),
    })),
  };
}
