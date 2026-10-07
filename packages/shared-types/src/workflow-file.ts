import { resolveNodePorts, type PortedType } from './ports.js';
import {
  isSubNodeType,
  type Edge,
  type Item,
  type PortDef,
  type PortKind,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowNodeSettings,
  type WorkflowSettings,
} from './workflow.js';

/**
 * Arquivo JSON de workflow (spec 015): a estrutura do JSON de workflow do N8N (envelope, nós e
 * conexões pelo nome do nó, com índices de saída e de entrada) com os tipos e os parâmetros do
 * Olly Flow. É o que se baixa, o que se importa e o que vai para a área de transferência.
 * Referência para pessoas e modelos de IA: docs/nos/workflow-json.md.
 */
export const WORKFLOW_FILE_FORMAT_VERSION = 1;
export const PLACEHOLDER_TYPE = 'placeholder.unsupported';

export type FileOnError = 'stopWorkflow' | 'continueRegularOutput' | 'continueErrorOutput';

export interface WorkflowFileNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number];
  parameters?: Record<string, unknown>;
  /** Referência no formato do N8N: chave = tipo da credencial. Nunca os dados. */
  credentials?: Record<string, { id?: string; name?: string }>;
  disabled?: boolean;
  onError?: FileOnError;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  /** Configurações sem equivalente no N8N (FR-004). */
  ollyFlow?: {
    retryBackoff?: 'fixed' | 'exponential';
    timeoutMs?: number;
    parallelItems?: { enabled: boolean; concurrency: number };
  };
}

export interface WorkflowFileConnection {
  node: string;
  type: PortKind;
  index: number;
}

/** `conexões[origem][tipo][índice da saída] = destinos`. */
export type WorkflowFileConnections = Record<
  string,
  Partial<Record<PortKind, WorkflowFileConnection[][]>>
>;

export interface WorkflowFileSettings {
  executionTimeout?: number;
  errorWorkflow?: string;
  saveDataSuccessExecution?: 'all' | 'none';
  saveDataErrorExecution?: 'all' | 'none';
  ollyFlow?: { maxParallel?: number };
}

export interface WorkflowFile {
  id?: string;
  name?: string;
  nodes: WorkflowFileNode[];
  connections: WorkflowFileConnections;
  pinData?: Record<string, Item[]>;
  settings?: WorkflowFileSettings;
  meta?: {
    ollyFlow?: { formatVersion: number; exportedAt?: string; workflowVersion?: number };
  };
  tags?: unknown[];
  active?: boolean;
}

/**
 * O que a conversão precisa saber de um tipo de nó: portas, versão, valores padrão e credenciais
 * aceitas. Na API é o `NodeRegistry`; no editor, a lista de `/node-types` (`NodeDescription`).
 */
export interface NodeTypeInfo extends PortedType {
  version: number;
  paramsSchema?: { properties?: Record<string, unknown> };
  credentialTypes?: string[];
}
export interface NodeTypeCatalog {
  get(type: string): NodeTypeInfo | undefined;
}

export interface ImportIssue {
  code: string;
  message: string;
  /** Nome do nó envolvido, quando houver. */
  node?: string;
}

export interface ImportIssues {
  errors: ImportIssue[];
  pending: ImportIssue[];
  warnings: ImportIssue[];
}

/** Credencial citada por um nó do arquivo, para resolver no projeto de destino (FR-014). */
export interface CredentialRef {
  nodeId: string;
  nodeName: string;
  type: string;
  id?: string;
  name?: string;
}

export type ImportFormat = 'olly' | 'n8n';

/** Relatório de migração da importação do N8N (FR-026). */
export interface MigrationReport {
  nodes: {
    converted: { node: string; from: string; to: string }[];
    withWarnings: { node: string; from: string; to: string; warnings: string[] }[];
    unsupported: { node: string; from: string; reason: string }[];
  };
  expressionsToReview: { node: string; parameter: string; reason: string }[];
  credentialsToCreate: { name: string; n8nType: string; ollyType?: string; nodes: string[] }[];
  semanticNotes: string[];
}

/** Prévia da importação (FR-011): o que seria criado, erros e pendências. */
export interface ImportPreview {
  name: string;
  format: ImportFormat;
  counts: { nodes: number; connections: number };
  errors: ImportIssue[];
  pending: ImportIssue[];
  warnings: ImportIssue[];
  migration?: MigrationReport;
  /**
   * FR-028: workflow do projeto que a importação vai sobrepor (o `id` do arquivo ou, sem ele,
   * o único com o mesmo nome). Ausente: a importação cria um novo workflow.
   */
  target?: ImportTarget;
}

export interface ImportTarget {
  workflowId: string;
  name: string;
  version: number;
  published: boolean;
  matchedBy: 'id' | 'name';
}

export interface ImportLimits {
  maxNodes: number;
  maxDepth: number;
}
export const DEFAULT_IMPORT_LIMITS: ImportLimits = { maxNodes: 500, maxDepth: 64 };

// ---------------------------------------------------------------------------------------------
// Exportação (definição → arquivo)
// ---------------------------------------------------------------------------------------------

export interface ToWorkflowFileOptions {
  catalog: NodeTypeCatalog;
  name?: string;
  /** Tipo e nome de uma credencial do projeto (nunca os dados). */
  credentialOf?: (id: string) => { type: string; name: string } | undefined;
  /** Copiar nós: só `nodes`, `connections`, `pinData` e `meta`. */
  fragment?: boolean;
  workflowId?: string;
  workflowVersion?: number;
  exportedAt?: string;
}

const ON_ERROR_TO_FILE: Record<NonNullable<WorkflowNodeSettings['onError']>, FileOnError> = {
  stop: 'stopWorkflow',
  continue: 'continueRegularOutput',
  errorOutput: 'continueErrorOutput',
};
const ON_ERROR_FROM_FILE: Record<FileOnError, NonNullable<WorkflowNodeSettings['onError']>> = {
  stopWorkflow: 'stop',
  continueRegularOutput: 'continue',
  continueErrorOutput: 'errorOutput',
};

/** Portas efetivas (dinâmicas e de erro); tipo desconhecido: nenhuma. */
function portsOf(catalog: NodeTypeCatalog, node: WorkflowNode) {
  const type = catalog.get(node.type);
  return type ? resolveNodePorts(type, node) : { inputs: [], outputs: [] };
}

const indexOfPort = (ports: PortDef[], name: string) => {
  const port = ports.find((p) => p.name === name);
  if (!port) return undefined;
  return { kind: port.kind, index: ports.filter((p) => p.kind === port.kind).indexOf(port) };
};

function nodeToFile(node: WorkflowNode, options: ToWorkflowFileOptions): WorkflowFileNode {
  const type = options.catalog.get(node.type);
  const out: WorkflowFileNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    typeVersion: type?.version ?? 1,
    position: [node.position[0], node.position[1]],
    parameters: structuredClone(node.params),
  };
  if (node.credentialId) {
    const info = options.credentialOf?.(node.credentialId);
    const key = info?.type ?? type?.credentialTypes?.[0] ?? 'credential';
    out.credentials = {
      [key]: { id: node.credentialId, ...(info && { name: info.name }) },
    };
  }
  if (node.disabled) out.disabled = true;
  const s = node.settings;
  if (s?.onError) out.onError = ON_ERROR_TO_FILE[s.onError];
  if (s?.retry) {
    out.retryOnFail = true;
    out.maxTries = s.retry.maxTries;
    out.waitBetweenTries = s.retry.waitMs;
  }
  const olly: NonNullable<WorkflowFileNode['ollyFlow']> = {};
  if (s?.retry?.backoff) olly.retryBackoff = s.retry.backoff;
  if (s?.timeoutMs !== undefined) olly.timeoutMs = s.timeoutMs;
  if (s?.parallelItems) olly.parallelItems = { ...s.parallelItems };
  if (Object.keys(olly).length > 0) out.ollyFlow = olly;
  return out;
}

function settingsToFile(settings: WorkflowSettings): WorkflowFileSettings {
  const out: WorkflowFileSettings = {};
  if (settings.timeoutSec !== undefined) out.executionTimeout = settings.timeoutSec;
  if (settings.errorWorkflowId) out.errorWorkflow = settings.errorWorkflowId;
  if (settings.saveExecutionData) {
    const mode = settings.saveExecutionData;
    out.saveDataSuccessExecution = mode === 'all' ? 'all' : 'none';
    out.saveDataErrorExecution = mode === 'none' ? 'none' : 'all';
  }
  if (settings.maxParallel !== undefined) out.ollyFlow = { maxParallel: settings.maxParallel };
  return out;
}

/** Definição → arquivo (FR-001 a FR-004, FR-007, FR-009). */
export function toWorkflowFile(
  def: WorkflowDefinition,
  options: ToWorkflowFileOptions,
): WorkflowFile {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const connections: WorkflowFileConnections = {};
  for (const edge of def.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const out = indexOfPort(portsOf(options.catalog, from).outputs, edge.fromPort);
    const inp = indexOfPort(portsOf(options.catalog, to).inputs, edge.toPort);
    if (!out || !inp) continue;
    const byKind = (connections[from.name] ??= {});
    const outputs = (byKind[out.kind] ??= []);
    while (outputs.length <= out.index) outputs.push([]);
    outputs[out.index]?.push({ node: to.name, type: inp.kind, index: inp.index });
  }
  const pinData: Record<string, Item[]> = {};
  for (const [id, items] of Object.entries(def.pinData ?? {})) {
    const node = byId.get(id);
    if (node) pinData[node.name] = structuredClone(items);
  }
  const meta = {
    ollyFlow: {
      formatVersion: WORKFLOW_FILE_FORMAT_VERSION,
      ...(options.exportedAt && { exportedAt: options.exportedAt }),
      ...(options.workflowVersion !== undefined && { workflowVersion: options.workflowVersion }),
    },
  };
  const nodes = def.nodes.map((n) => nodeToFile(n, options));
  if (options.fragment) return { nodes, connections, pinData, meta };
  return {
    ...(options.workflowId && { id: options.workflowId }),
    name: options.name ?? '',
    nodes,
    connections,
    pinData,
    settings: settingsToFile(def.settings),
    meta,
    tags: [],
    active: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Importação (arquivo → definição)
// ---------------------------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * FR-018: conteúdo não confiável. Recusa aninhamento acima do limite e chaves que alteram
 * objetos internos, sem recursão (um JSON hostil não estoura a pilha).
 */
export function checkUntrusted(value: unknown, maxDepth: number): ImportIssue | undefined {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const { value: current, depth } = stack.pop() as { value: unknown; depth: number };
    if (current === null || typeof current !== 'object') continue;
    if (depth > maxDepth) {
      return {
        code: 'IMPORT_TOO_DEEP',
        message: `O JSON passa do limite de ${String(maxDepth)} níveis de aninhamento`,
      };
    }
    for (const key of Object.keys(current)) {
      if (FORBIDDEN_KEYS.has(key)) {
        return {
          code: 'IMPORT_FORBIDDEN_KEY',
          message: `Chave não permitida no arquivo: "${key}"`,
        };
      }
      stack.push({ value: (current as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
  return undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const PORT_KINDS: readonly string[] = ['main', 'ai_languageModel', 'ai_memory', 'ai_tool'];
const isPortKind = (v: unknown): v is PortKind => typeof v === 'string' && PORT_KINDS.includes(v);
const isForeignN8nType = (type: string) =>
  type.startsWith('n8n-nodes-base.') || type.startsWith('@n8n/');

export interface FromWorkflowFileOptions {
  catalog: NodeTypeCatalog;
  newId: () => string;
  limits?: ImportLimits;
  /** Colar nós: `connections` opcional e sem nome do workflow. */
  fragment?: boolean;
  /**
   * Na importação do N8N, os tipos do N8N já vêm convertidos; sem esta opção, um tipo do N8N no
   * formato do Olly Flow é erro (o usuário escolheu o formato errado).
   */
  allowN8nTypes?: boolean;
}

export interface FromWorkflowFileResult {
  name: string;
  definition: WorkflowDefinition;
  issues: ImportIssues;
  credentialRefs: CredentialRef[];
  counts: { nodes: number; connections: number };
}

const emptyResult = (issues: ImportIssues): FromWorkflowFileResult => ({
  name: '',
  definition: { nodes: [], edges: [], settings: {} },
  issues,
  credentialRefs: [],
  counts: { nodes: 0, connections: 0 },
});

/** Valores padrão (nível de cima do `paramsSchema`) para os parâmetros omitidos (FR-013). */
function withDefaults(
  params: Record<string, unknown>,
  type: NodeTypeInfo,
): Record<string, unknown> {
  const props = type.paramsSchema?.properties ?? {};
  // Parâmetro legado (`x-hidden`) presente: o nó está no modo antigo; preencher os padrões dos
  // parâmetros novos mudaria o comportamento (ex.: `keepOnlySet` do `data.set`).
  const legacy = Object.entries(props).some(
    ([k, s]) => isObject(s) && s['x-hidden'] === true && k in params && k !== 'ports',
  );
  if (legacy) return params;
  const out = { ...params };
  for (const [key, schema] of Object.entries(props)) {
    if (!(key in out) && isObject(schema) && 'default' in schema) {
      out[key] = structuredClone(schema.default);
    }
  }
  return out;
}

/** Nó marcador para um tipo desconhecido (FR-016), com o conteúdo original. */
function placeholderFor(raw: Record<string, unknown>, reason: string): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'credentials'));
  return {
    originalType: typeof raw.type === 'string' ? raw.type : '',
    ...(isFiniteNumber(raw.typeVersion) && { originalTypeVersion: raw.typeVersion }),
    reason,
    originalJson: JSON.stringify(rest, null, 2),
  };
}

function settingsFromFile(raw: unknown, issues: ImportIssues): WorkflowSettings {
  if (!isObject(raw)) return {};
  const out: WorkflowSettings = {};
  if (isFiniteNumber(raw.executionTimeout) && raw.executionTimeout > 0) {
    out.timeoutSec = raw.executionTimeout;
  }
  if (typeof raw.errorWorkflow === 'string' && raw.errorWorkflow) {
    out.errorWorkflowId = raw.errorWorkflow;
  }
  const success = raw.saveDataSuccessExecution;
  const error = raw.saveDataErrorExecution;
  if (success !== undefined || error !== undefined) {
    if (success === 'none' && error === 'none') out.saveExecutionData = 'none';
    else if (success === 'none') out.saveExecutionData = 'errorsOnly';
    else {
      out.saveExecutionData = 'all';
      if (error === 'none') {
        issues.warnings.push({
          code: 'SETTINGS_SAVE_DATA',
          message:
            'Guardar só as execuções com sucesso não existe no Olly Flow: importado como "guardar tudo"',
        });
      }
    }
  }
  const olly = raw.ollyFlow;
  if (isObject(olly) && isFiniteNumber(olly.maxParallel) && olly.maxParallel >= 1) {
    out.maxParallel = Math.floor(olly.maxParallel);
  }
  return out;
}

function nodeSettingsFromFile(raw: Record<string, unknown>): WorkflowNodeSettings | undefined {
  const out: WorkflowNodeSettings = {};
  const onError = raw.onError;
  if (typeof onError === 'string' && onError in ON_ERROR_FROM_FILE) {
    out.onError = ON_ERROR_FROM_FILE[onError as FileOnError];
  }
  const olly = isObject(raw.ollyFlow) ? raw.ollyFlow : {};
  if (raw.retryOnFail === true) {
    const clamp = (v: unknown, min: number, max: number, d: number) =>
      isFiniteNumber(v) ? Math.min(max, Math.max(min, Math.floor(v))) : d;
    out.retry = {
      maxTries: clamp(raw.maxTries, 1, 10, 3),
      waitMs: clamp(raw.waitBetweenTries, 0, 60_000, 1000),
      ...((olly.retryBackoff === 'fixed' || olly.retryBackoff === 'exponential') && {
        backoff: olly.retryBackoff,
      }),
    };
  }
  if (isFiniteNumber(olly.timeoutMs) && olly.timeoutMs > 0) out.timeoutMs = olly.timeoutMs;
  const parallel = olly.parallelItems;
  if (
    isObject(parallel) &&
    typeof parallel.enabled === 'boolean' &&
    isFiniteNumber(parallel.concurrency)
  ) {
    out.parallelItems = { enabled: parallel.enabled, concurrency: parallel.concurrency };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Posições para os nós sem `position` (FR-013): camadas pela distância (conexões principais) a
 * partir dos nós sem entrada; sub-nós embaixo do nó a que se ligam.
 */
export function layoutMissingPositions(
  nodes: WorkflowNode[],
  edges: Edge[],
  missing: Set<string>,
  isSubNode: (node: WorkflowNode) => boolean,
): void {
  if (missing.size === 0) return;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const subIds = new Set(nodes.filter(isSubNode).map((n) => n.id));
  const mainEdges = edges.filter((e) => !subIds.has(e.from) && !subIds.has(e.to));
  const layer = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const n of nodes) if (!subIds.has(n.id)) incoming.set(n.id, 0);
  for (const e of mainEdges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  // Longest path com limite (os laços não podem empurrar as camadas sem fim).
  const queue = [...incoming].filter(([, c]) => c === 0).map(([id]) => id);
  for (const id of queue) layer.set(id, 0);
  for (let guard = 0; guard < nodes.length * nodes.length + 1 && queue.length > 0; guard++) {
    const id = queue.shift() as string;
    const next = (layer.get(id) ?? 0) + 1;
    for (const e of mainEdges) {
      if (e.from !== id) continue;
      if ((layer.get(e.to) ?? -1) < next && next <= nodes.length) {
        layer.set(e.to, next);
        queue.push(e.to);
      }
    }
  }
  const rows = new Map<number, number>();
  for (const n of nodes) {
    if (subIds.has(n.id) || !missing.has(n.id)) continue;
    const l = layer.get(n.id) ?? 0;
    const row = rows.get(l) ?? 0;
    rows.set(l, row + 1);
    n.position = [l * 260, row * 160];
  }
  const perParent = new Map<string, number>();
  for (const n of nodes) {
    if (!subIds.has(n.id) || !missing.has(n.id)) continue;
    const parent = byId.get(edges.find((e) => e.from === n.id)?.to ?? '');
    const k = perParent.get(parent?.id ?? '') ?? 0;
    perParent.set(parent?.id ?? '', k + 1);
    n.position = parent
      ? [parent.position[0] - 120 + k * 140, parent.position[1] + 220]
      : [k * 160, 400];
  }
}

/**
 * Arquivo → definição (FR-001 a FR-005, FR-012 em parte, FR-013, FR-016, FR-018). A validação
 * estrutural completa (`validateWorkflow`) e a resolução das credenciais ficam com quem chama.
 */
export function fromWorkflowFile(
  input: unknown,
  options: FromWorkflowFileOptions,
): FromWorkflowFileResult {
  const limits = options.limits ?? DEFAULT_IMPORT_LIMITS;
  const issues: ImportIssues = { errors: [], pending: [], warnings: [] };
  const fail = (code: string, message: string) => {
    issues.errors.push({ code, message });
    return emptyResult(issues);
  };
  if (!isObject(input))
    return fail('IMPORT_INVALID', 'O conteúdo não é um objeto JSON de workflow');
  const hostile = checkUntrusted(input, limits.maxDepth);
  if (hostile) return fail(hostile.code, hostile.message);
  if (!Array.isArray(input.nodes))
    return fail('IMPORT_INVALID', 'O arquivo não tem a lista "nodes"');
  if (input.connections !== undefined && !isObject(input.connections)) {
    return fail('IMPORT_INVALID', '"connections" precisa ser um objeto');
  }
  if (input.connections === undefined && !options.fragment) {
    return fail('IMPORT_INVALID', 'O arquivo não tem o objeto "connections"');
  }
  if (input.nodes.length > limits.maxNodes) {
    return fail(
      'IMPORT_TOO_MANY_NODES',
      `O arquivo tem ${String(input.nodes.length)} nós; o limite é ${String(limits.maxNodes)}`,
    );
  }
  const meta = isObject(input.meta) && isObject(input.meta.ollyFlow) ? input.meta.ollyFlow : {};
  const formatVersion = meta.formatVersion ?? WORKFLOW_FILE_FORMAT_VERSION;
  if (!isFiniteNumber(formatVersion) || formatVersion > WORKFLOW_FILE_FORMAT_VERSION) {
    return fail(
      'FORMAT_VERSION_UNSUPPORTED',
      `Versão do formato ${JSON.stringify(formatVersion)} não suportada: esta instalação aceita até a ${String(WORKFLOW_FILE_FORMAT_VERSION)}`,
    );
  }
  if (!options.allowN8nTypes) {
    const foreign = input.nodes.filter(
      (n): n is Record<string, unknown> =>
        isObject(n) && typeof n.type === 'string' && isForeignN8nType(n.type),
    );
    if (foreign.length > 0) {
      return fail(
        'N8N_FILE',
        'O arquivo tem tipos de nó do N8N (ex.: ' +
          String(foreign[0]?.type) +
          '). Escolha o formato "N8N" na importação.',
      );
    }
  }

  // Nós.
  const nodes: WorkflowNode[] = [];
  const raws = new Map<string, Record<string, unknown>>();
  const byName = new Map<string, WorkflowNode>();
  const usedIds = new Set<string>();
  const missingPosition = new Set<string>();
  const credentialRefs: CredentialRef[] = [];
  input.nodes.forEach((raw, i) => {
    if (!isObject(raw)) {
      issues.errors.push({
        code: 'NODE_INVALID',
        message: `O nó ${String(i + 1)} não é um objeto`,
      });
      return;
    }
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) {
      issues.errors.push({
        code: 'NODE_NAME_REQUIRED',
        message: `O nó ${String(i + 1)} não tem nome`,
      });
      return;
    }
    if (byName.has(name)) {
      issues.errors.push({
        code: 'DUPLICATE_NODE_NAME',
        message: `Dois nós com o nome "${name}"`,
        node: name,
      });
      return;
    }
    if (typeof raw.type !== 'string' || !raw.type) {
      issues.errors.push({
        code: 'NODE_TYPE_REQUIRED',
        message: `Nó "${name}" sem tipo`,
        node: name,
      });
      return;
    }
    if (raw.parameters !== undefined && !isObject(raw.parameters)) {
      issues.errors.push({
        code: 'NODE_INVALID',
        message: `Nó "${name}": "parameters" precisa ser um objeto`,
        node: name,
      });
      return;
    }
    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
    if (!id || usedIds.has(id)) id = options.newId();
    usedIds.add(id);
    const type = options.catalog.get(raw.type);
    let node: WorkflowNode;
    if (!type) {
      // FR-016: tipo desconhecido vira marcador desabilitado com o conteúdo original.
      node = {
        id,
        name,
        type: PLACEHOLDER_TYPE,
        params: placeholderFor(raw, `Tipo de nó desconhecido nesta instalação: ${raw.type}`),
        position: [0, 0],
        disabled: true,
      };
      issues.pending.push({
        code: 'UNSUPPORTED_NODE',
        message: `Nó "${name}": tipo "${raw.type}" não suportado; importado como marcador desabilitado`,
        node: name,
      });
    } else {
      if (isFiniteNumber(raw.typeVersion) && raw.typeVersion > type.version) {
        issues.errors.push({
          code: 'TYPE_VERSION_UNSUPPORTED',
          message: `Nó "${name}": ${raw.type} versão ${String(raw.typeVersion)} não suportada (instalada: ${String(type.version)})`,
          node: name,
        });
        return;
      }
      const params = structuredClone(raw.parameters ?? {});
      node = {
        id,
        name,
        type: raw.type,
        params: raw.type === PLACEHOLDER_TYPE ? params : withDefaults(params, type),
        position: [0, 0],
        ...(raw.disabled === true && { disabled: true }),
      };
      if (raw.type === PLACEHOLDER_TYPE) {
        issues.pending.push({
          code: 'UNSUPPORTED_NODE',
          message: `Nó "${name}" é um marcador de nó não suportado${typeof params.originalType === 'string' && params.originalType ? ` (${params.originalType})` : ''}`,
          node: name,
        });
      }
      const settings = nodeSettingsFromFile(raw);
      if (settings) node.settings = settings;
      if (isObject(raw.credentials)) {
        const [credType, ref] = Object.entries(raw.credentials)[0] ?? [];
        if (credType && isObject(ref)) {
          credentialRefs.push({
            nodeId: id,
            nodeName: name,
            type: credType,
            ...(typeof ref.id === 'string' && ref.id && { id: ref.id }),
            ...(typeof ref.name === 'string' && ref.name && { name: ref.name }),
          });
        }
      }
    }
    const pos = raw.position;
    if (
      Array.isArray(pos) &&
      pos.length === 2 &&
      isFiniteNumber(pos[0]) &&
      isFiniteNumber(pos[1])
    ) {
      node.position = [pos[0], pos[1]];
    } else {
      missingPosition.add(id);
    }
    nodes.push(node);
    raws.set(name, raw);
    byName.set(name, node);
  });

  // Portas dos marcadores: as das conexões em que aparecem (como saída e como entrada).
  const connections = isObject(input.connections) ? input.connections : {};
  const placeholderPorts = new Map<
    string,
    { inputs: Map<PortKind, number>; outputs: Map<PortKind, number> }
  >();
  const portsFor = (name: string) => {
    let p = placeholderPorts.get(name);
    if (!p) {
      p = { inputs: new Map(), outputs: new Map() };
      placeholderPorts.set(name, p);
    }
    return p;
  };
  const forEachConnection = (
    fn: (from: string, kind: PortKind, outIndex: number, target: Record<string, unknown>) => void,
  ) => {
    for (const [from, byKind] of Object.entries(connections)) {
      if (!isObject(byKind)) continue;
      for (const [kind, outputs] of Object.entries(byKind)) {
        if (!isPortKind(kind) || !Array.isArray(outputs)) continue;
        outputs.forEach((targets, outIndex) => {
          if (!Array.isArray(targets)) return;
          for (const t of targets) if (isObject(t)) fn(from, kind, outIndex, t);
        });
      }
    }
  };
  forEachConnection((from, kind, outIndex, t) => {
    const source = byName.get(from);
    if (source?.type === PLACEHOLDER_TYPE) {
      const p = portsFor(from).outputs;
      p.set(kind, Math.max(p.get(kind) ?? 0, outIndex + 1));
    }
    const targetName = typeof t.node === 'string' ? t.node : '';
    const target = byName.get(targetName);
    const targetKind = isPortKind(t.type) ? t.type : kind;
    if (
      target?.type === PLACEHOLDER_TYPE &&
      isFiniteNumber(t.index) &&
      t.index >= 0 &&
      t.index < 50
    ) {
      const p = portsFor(targetName).inputs;
      p.set(targetKind, Math.max(p.get(targetKind) ?? 0, Math.floor(t.index) + 1));
    }
  });
  for (const node of nodes) {
    if (node.type !== PLACEHOLDER_TYPE) continue;
    const found = placeholderPorts.get(node.name);
    const declared = isObject(node.params.ports) ? node.params.ports : undefined;
    const expand = (m: Map<PortKind, number> | undefined, fallback: PortKind[]): PortKind[] => {
      if (!m || m.size === 0) return fallback;
      const order: PortKind[] = ['main', 'ai_languageModel', 'ai_memory', 'ai_tool'];
      return order.flatMap((k) => Array.from({ length: Math.min(m.get(k) ?? 0, 50) }, () => k));
    };
    const keep = (v: unknown): PortKind[] | undefined =>
      Array.isArray(v) && v.every(isPortKind) ? v : undefined;
    node.params.ports = {
      inputs: keep(declared?.inputs) ?? expand(found?.inputs, found?.outputs.size ? [] : ['main']),
      outputs: keep(declared?.outputs) ?? expand(found?.outputs, ['main']),
    };
  }

  // Conexões → arestas.
  const edges: Edge[] = [];
  const seen = new Set<string>();
  forEachConnection((from, kind, outIndex, t) => {
    const source = byName.get(from);
    const targetName = typeof t.node === 'string' ? t.node : '';
    const target = byName.get(targetName);
    if (!source) {
      issues.errors.push({
        code: 'CONNECTION_UNKNOWN_NODE',
        message: `Conexão de um nó que não existe: "${from}"`,
        node: from,
      });
      return;
    }
    if (!target) {
      issues.errors.push({
        code: 'CONNECTION_UNKNOWN_NODE',
        message: `Nó "${from}": conexão para um nó que não existe: "${targetName}"`,
        node: from,
      });
      return;
    }
    const inKind = isPortKind(t.type) ? t.type : kind;
    const inIndex = isFiniteNumber(t.index) ? Math.floor(t.index) : 0;
    const outPorts = portsOf(options.catalog, source).outputs.filter((p) => p.kind === kind);
    const inPorts = portsOf(options.catalog, target).inputs.filter((p) => p.kind === inKind);
    const outPort = outPorts[outIndex];
    const inPort = inPorts[inIndex];
    if (!outPort) {
      issues.errors.push({
        code: 'CONNECTION_UNKNOWN_PORT',
        message: `Nó "${from}" não tem a saída ${kind} ${String(outIndex)}${kind === 'main' && outIndex === outPorts.length ? ' (a saída de erro exige onError "continueErrorOutput")' : ''}`,
        node: from,
      });
      return;
    }
    if (!inPort) {
      issues.errors.push({
        code: 'CONNECTION_UNKNOWN_PORT',
        message: `Nó "${targetName}" não tem a entrada ${inKind} ${String(inIndex)}`,
        node: targetName,
      });
      return;
    }
    const key = `${source.id}|${outPort.name}|${target.id}|${inPort.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      id: options.newId(),
      from: source.id,
      fromPort: outPort.name,
      to: target.id,
      toPort: inPort.name,
    });
  });

  layoutMissingPositions(nodes, edges, missingPosition, (n) => {
    const t = options.catalog.get(n.type);
    return t !== undefined && isSubNodeType(resolveNodePorts(t, n));
  });

  // Dados fixados (FR-009): por nome → por id.
  const pinData: Record<string, Item[]> = {};
  if (isObject(input.pinData)) {
    for (const [name, items] of Object.entries(input.pinData)) {
      const node = byName.get(name);
      if (!node) {
        issues.warnings.push({
          code: 'PINDATA_UNKNOWN_NODE',
          message: `Dados fixados de um nó que não existe ("${name}") foram ignorados`,
          node: name,
        });
        continue;
      }
      if (!Array.isArray(items)) continue;
      pinData[node.id] = items
        .filter(isObject)
        .map((item) =>
          isObject(item.json)
            ? (structuredClone(item) as unknown as Item)
            : { json: structuredClone(item) },
        );
    }
  }

  const definition: WorkflowDefinition = {
    nodes,
    edges,
    settings: options.fragment ? {} : settingsFromFile(input.settings, issues),
    ...(Object.keys(pinData).length > 0 && { pinData }),
  };
  return {
    name: typeof input.name === 'string' ? input.name.trim() : '',
    definition,
    issues,
    credentialRefs,
    counts: { nodes: nodes.length, connections: edges.length },
  };
}

/** Credencial do projeto disponível para a resolução (sem os dados). */
export interface AvailableCredential {
  id: string;
  type: string;
  name: string;
}

/**
 * FR-014: pelo id (mesmo tipo); senão, pelo nome e tipo com uma única correspondência. `accepted`
 * são os tipos que o nó aceita: uma credencial de outro tipo nunca é ligada.
 */
export function resolveCredentialRef(
  ref: CredentialRef,
  available: AvailableCredential[],
  accepted: string[] = [],
): AvailableCredential | undefined {
  const usable = (c: AvailableCredential) =>
    c.type === ref.type && (accepted.length === 0 || accepted.includes(c.type));
  const byId = ref.id ? available.find((c) => c.id === ref.id && usable(c)) : undefined;
  if (byId) return byId;
  if (!ref.name) return undefined;
  const byName = available.filter((c) => c.name === ref.name && usable(c));
  return byName.length === 1 ? byName[0] : undefined;
}
