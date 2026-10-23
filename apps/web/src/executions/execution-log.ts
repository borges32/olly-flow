import type {
  ExecutionStatus,
  ExecutionSteps,
  NodeExecutionStatus,
  SubExecutionRef,
} from '@olly/shared-types';

/**
 * Linha do log da execução (spec 026, FR-002): uma por execução de nó, mais a falha geral. Spec
 * 029: os passos em andamento entram no fim, com o status `running` e a duração correndo.
 */
export interface LogRow {
  key: string;
  kind: 'node' | 'execution';
  /** Horário local com milissegundos (`HH:mm:ss,SSS`). */
  time: string;
  startedAt: string;
  nodeId: string | null;
  nodeName: string;
  nodeType: string;
  status: NodeExecutionStatus | ExecutionStatus;
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
  running: 'Em andamento',
};

/** Spec 029, FR-003: status do passo como aparece na tela. */
export const STEP_STATUS_LABEL: Record<NodeExecutionStatus, string> = {
  running: 'em andamento',
  success: 'sucesso',
  error: 'erro',
  skipped: 'sem dados',
  waiting: 'aguardando',
  cancelled: 'interrompido',
};

export const EXECUTION_STATUS_LABEL: Record<ExecutionStatus, string> = {
  queued: 'Na fila',
  running: 'Executando',
  waiting: 'Aguardando',
  success: 'Sucesso',
  error: 'Erro',
  cancelled: 'Cancelada',
};

/** Execução na fila, em andamento ou aguardando: o Log funciona como acompanhamento ao vivo. */
export const isActiveStatus = (status: ExecutionStatus) =>
  status === 'queued' || status === 'running' || status === 'waiting';

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
 * sem intervalo que a contenha, na última iteração do nó. Spec 029: os passos em andamento vêm
 * depois dos concluídos, com a duração até `now` (FR-003).
 */
export function logRows(
  detail: ExecutionSteps,
  now = Date.now(),
): { rows: LogRow[]; orphans: SubExecutionRef[] } {
  const rows: LogRow[] = detail.steps.map((n) => ({
    key: `${n.nodeId}#${String(n.runIndex)}`,
    kind: 'node',
    time: logTime(n.startedAt),
    startedAt: n.startedAt,
    nodeId: n.nodeId,
    nodeName: n.nodeName,
    nodeType: n.nodeType,
    status: n.status,
    durationMs: between(n.startedAt, n.finishedAt),
    itemsIn: n.itemsIn,
    itemsOut: n.itemsOut,
    runIndex: n.runIndex,
    error: n.error?.message ?? null,
    subExecutions: [],
  }));
  for (const r of detail.running) {
    rows.push({
      key: `${r.nodeId}#${String(r.runIndex)}`,
      kind: 'node',
      time: logTime(r.startedAt),
      startedAt: r.startedAt,
      nodeId: r.nodeId,
      nodeName: r.nodeName,
      nodeType: r.nodeType,
      status: 'running',
      durationMs: Math.max(0, now - Date.parse(r.startedAt)),
      itemsIn: null,
      itemsOut: null,
      runIndex: r.runIndex,
      error: null,
      subExecutions: [],
    });
  }
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

/** Spec 029, FR-010 e FR-016: resumo do progresso e linhas que ficaram de fora do limite. */
export function logProgress(detail: ExecutionSteps) {
  return {
    done: detail.total,
    running: detail.running.length,
    executed: detail.executedNodeIds.length,
    nodeCount: detail.nodeCount,
    hidden: Math.max(0, detail.total - detail.steps.length),
  };
}

/** FR-002 (spec 029): tempo decorrido, como `45 s`, `4 min 05 s` ou `1 h 02 min`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${String(h)} h ${pad(m)} min`;
  if (m > 0) return `${String(m)} min ${pad(sec)} s`;
  return `${String(sec)} s`;
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
export function logSummary(detail: ExecutionSteps): string {
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
export function logText(detail: ExecutionSteps, workflowName: string, rows: LogRow[]): string {
  return [
    `Log — execução ${detail.id} · ${workflowName}`,
    logSummary(detail),
    '',
    ...rows.map(rowText),
  ].join('\n');
}

/** FR-003: conteúdo do `.json`, com as linhas filtradas. */
export function logJson(detail: ExecutionSteps, workflowName: string, rows: LogRow[]) {
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
