import {
  PLACEHOLDER_TYPE,
  WORKFLOW_FILE_FORMAT_VERSION,
  type ImportIssue,
  type MigrationReport,
  type PortKind,
  type WorkflowFile,
  type WorkflowFileConnection,
  type WorkflowFileConnections,
  type WorkflowFileNode,
} from '@olly/shared-types';
import { CONVERTERS, DROPPED_TYPES, type N8nNode } from './converters.js';
import { isObject, list, num, str, type Params } from './helpers.js';

export interface N8nConversion {
  file: WorkflowFile;
  report: MigrationReport;
  errors: ImportIssue[];
}

const N8N_TYPE = /^(n8n-nodes-|@n8n\/|@[\w.-]+\/n8n-nodes-)/;
const PORT_KINDS: readonly string[] = ['main', 'ai_languageModel', 'ai_memory', 'ai_tool'];
const isPortKind = (v: string): v is PortKind => PORT_KINDS.includes(v);

/** Variáveis das expressões que o Olly Flow suporta (spec 003); as demais vão para revisão. */
const SUPPORTED_VARIABLES = new Set([
  'json',
  'binary',
  'input',
  'itemIndex',
  'node',
  'vars',
  'env',
  'execution',
  'workflow',
  'now',
  'today',
  'loop',
  'parameter',
  'fromAI',
]);
/** Funções de extensão do N8N (`'texto'.toInt()`...) que o Olly Flow não tem. */
const EXTENSION_FUNCTIONS =
  /\.(isEmpty|isNotEmpty|toInt|toFloat|toNumber|toBoolean|toDateTime|toJsonString|extractEmail|extractDomain|extractUrl|removeTags|toSnakeCase|toTitleCase|toSentenceCase|urlEncode|urlDecode|hash|base64Encode|base64Decode|isEmail|isUrl|isNumeric|pluck|unique|average|randomItem|removeDuplicates|compact|chunk|difference|intersection|union|smartJoin|renameKeys|keepFieldsContaining|removeField|hasField|beginningOf|endOfMonth|isBetween|isWeekend|isEven|isOdd)\(/;

function scanExpressions(
  node: string,
  type: string,
  value: unknown,
  path: string,
  out: MigrationReport['expressionsToReview'],
): void {
  if (typeof value === 'string') {
    if (!value.startsWith('=')) return;
    const reasons = new Set<string>();
    for (const m of value.matchAll(/(?<![\w$])\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const name = m[1] ?? '';
      if (!SUPPORTED_VARIABLES.has(name)) reasons.add(`$${name} não existe no Olly Flow`);
      else if (name === 'vars')
        reasons.add('$vars tem outro significado no Olly Flow (variáveis da execução)');
      else if (name === 'fromAI' && !type.startsWith('tool.'))
        reasons.add('$fromAI só vale nas ferramentas do agente');
    }
    const ext = EXTENSION_FUNCTIONS.exec(value);
    if (ext) reasons.add(`função de extensão do N8N "${ext[1] ?? ''}()" não existe no Olly Flow`);
    for (const reason of reasons) out.push({ node, parameter: path, reason });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      scanExpressions(node, type, v, `${path}[${String(i)}]`, out);
    });
    return;
  }
  if (isObject(value)) {
    for (const [k, v] of Object.entries(value))
      scanExpressions(node, type, v, path ? `${path}.${k}` : k, out);
  }
}

/** Nós alcançáveis a partir de uma saída de um nó, pelas conexões principais (sem passar por ele). */
function reachableFrom(
  connections: WorkflowFileConnections,
  start: string,
  outIndex: number,
): Set<string> {
  const seen = new Set<string>();
  const queue = (connections[start]?.main?.[outIndex] ?? []).map((t) => t.node);
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (name === start || seen.has(name)) continue;
    seen.add(name);
    for (const outputs of connections[name]?.main ?? [])
      for (const t of outputs) queue.push(t.node);
  }
  return seen;
}

/**
 * JSON exportado pelo N8N → arquivo do Olly Flow (spec 015, FR-023 a FR-026). Os nós com
 * conversão mudam de tipo e de parâmetros; os demais viram marcadores com o JSON original. A
 * importação segue depois pelo mesmo caminho do formato do Olly Flow.
 */
export function convertN8n(input: unknown): N8nConversion {
  const report: MigrationReport = {
    nodes: { converted: [], withWarnings: [], unsupported: [] },
    expressionsToReview: [],
    credentialsToCreate: [],
    semanticNotes: [
      'Ramos independentes executam em paralelo no Olly Flow (no N8N, um ramo depois do outro).',
    ],
  };
  const errors: ImportIssue[] = [];
  const empty: WorkflowFile = { nodes: [], connections: {} };
  if (!isObject(input) || !Array.isArray(input.nodes)) {
    errors.push({
      code: 'IMPORT_INVALID',
      message: 'O conteúdo não é um workflow exportado do N8N (falta a lista "nodes")',
    });
    return { file: empty, report, errors };
  }
  const rawNodes = input.nodes.filter(isObject) as unknown as N8nNode[];
  if (rawNodes.length > 0 && !rawNodes.some((n) => N8N_TYPE.test(str(n.type)))) {
    errors.push({
      code: 'OLLY_FILE',
      message:
        'O arquivo não tem tipos de nó do N8N. Se ele foi baixado do Olly Flow, escolha o formato "Olly Flow".',
    });
    return { file: empty, report, errors };
  }

  const credentialGroups = new Map<string, MigrationReport['credentialsToCreate'][number]>();
  const addCredential = (node: N8nNode, ollyTypes?: Record<string, string>) => {
    for (const [n8nType, ref] of Object.entries(node.credentials ?? {})) {
      const name = str(isObject(ref) ? ref.name : '', n8nType);
      const key = `${n8nType}|${name}`;
      const ollyType = ollyTypes?.[n8nType];
      const group = credentialGroups.get(key) ?? {
        name,
        n8nType,
        ...(ollyType && { ollyType }),
        nodes: [],
      };
      group.nodes.push(node.name);
      credentialGroups.set(key, group);
    }
  };

  const nodes: WorkflowFileNode[] = [];
  const dropped = new Set<string>();
  const loopNodes = new Set<string>();
  for (const node of rawNodes) {
    const name = str(node.name).trim();
    const type = str(node.type);
    const version = num(node.typeVersion) ?? 1;
    if (DROPPED_TYPES.has(type)) {
      dropped.add(name);
      continue;
    }
    const position = Array.isArray(node.position) ? (node.position as [number, number]) : undefined;
    const common: Partial<WorkflowFileNode> = {
      ...(typeof node.id === 'string' && { id: node.id }),
      name,
      typeVersion: 1,
      ...(position && { position }),
    };
    const params = isObject(node.parameters) ? node.parameters : {};
    const converter = CONVERTERS[type];
    const result = converter
      ? converter(node, params, version)
      : { unsupported: `Tipo do N8N sem conversão: ${type}` };
    if ('unsupported' in result) {
      const original = Object.fromEntries(
        Object.entries(node as unknown as Params).filter(([k]) => k !== 'credentials'),
      );
      nodes.push({
        ...common,
        name,
        type: PLACEHOLDER_TYPE,
        disabled: true,
        parameters: {
          originalType: type,
          originalTypeVersion: version,
          reason: result.unsupported,
          originalJson: JSON.stringify(original, null, 2),
        },
      });
      report.nodes.unsupported.push({ node: name, from: type, reason: result.unsupported });
      addCredential(node);
      continue;
    }
    const warnings = [...result.warnings];
    if (node.alwaysOutputData) warnings.push('"Sempre emitir dados" não existe no Olly Flow');
    if (node.executeOnce)
      warnings.push('"Executar uma vez" não existe no Olly Flow: o nó processa todos os itens');
    if (node.notes) warnings.push('As notas do nó não foram importadas');
    const out: WorkflowFileNode = {
      ...common,
      name,
      type: result.type,
      parameters: result.parameters,
    };
    if (node.disabled === true) out.disabled = true;
    if (node.onError === 'continueErrorOutput') out.onError = 'continueErrorOutput';
    else if (node.onError === 'continueRegularOutput' || node.continueOnFail === true)
      out.onError = 'continueRegularOutput';
    if (node.retryOnFail === true) {
      out.retryOnFail = true;
      if (num(node.maxTries) !== undefined) out.maxTries = node.maxTries;
      if (num(node.waitBetweenTries) !== undefined) out.waitBetweenTries = node.waitBetweenTries;
    }
    for (const [n8nType, ref] of Object.entries(node.credentials ?? {})) {
      const ollyType = result.credentials?.[n8nType];
      if (ollyType && isObject(ref)) {
        out.credentials = { [ollyType]: { name: str(ref.name) } };
        break;
      }
      if (!ollyType)
        warnings.push(
          `Credencial "${str(isObject(ref) ? ref.name : '')}" (${n8nType}) não tem tipo equivalente`,
        );
    }
    addCredential(node, result.credentials);
    scanExpressions(name, result.type, result.parameters, '', report.expressionsToReview);
    if (result.type === 'logic.loopOverItems') loopNodes.add(name);
    nodes.push(out);
    if (warnings.length > 0)
      report.nodes.withWarnings.push({ node: name, from: type, to: result.type, warnings });
    else report.nodes.converted.push({ node: name, from: type, to: result.type });
  }
  if (dropped.size > 0)
    report.semanticNotes.push(`Notas (sticky notes) descartadas: ${String(dropped.size)}.`);

  // Conexões: as mesmas (os índices do N8N valem no Olly Flow), sem tipos inexistentes aqui.
  const connections: WorkflowFileConnections = {};
  const discardedKinds = new Set<string>();
  const raw = isObject(input.connections) ? input.connections : {};
  for (const [from, byKind] of Object.entries(raw)) {
    if (dropped.has(from) || !isObject(byKind)) continue;
    for (const [kind, outputs] of Object.entries(byKind)) {
      if (!isPortKind(kind)) {
        discardedKinds.add(kind);
        continue;
      }
      const converted = list(outputs).map((targets) =>
        list(targets)
          .filter(isObject)
          .filter((t) => !dropped.has(str(t.node)))
          .map((t): WorkflowFileConnection => ({
            node: str(t.node),
            type: isPortKind(str(t.type)) ? (str(t.type) as PortKind) : kind,
            index: num(t.index) ?? 0,
          })),
      );
      (connections[from] ??= {})[kind] = converted;
    }
  }
  for (const kind of discardedKinds) {
    report.semanticNotes.push(
      `Conexões do tipo "${kind}" não existem no Olly Flow e foram descartadas.`,
    );
  }
  // Loop Over Items: no N8N o retorno do laço chega à entrada 0; aqui, à entrada 1 (continuar).
  for (const loop of loopNodes) {
    const body = reachableFrom(connections, loop, 1);
    for (const source of body) {
      for (const outputs of connections[source]?.main ?? []) {
        for (const t of outputs) if (t.node === loop && t.index === 0) t.index = 1;
      }
    }
  }

  const settings = isObject(input.settings) ? input.settings : {};
  if (settings.executionOrder !== undefined && settings.executionOrder !== 'v1') {
    report.semanticNotes.push(
      `Ordem de execução "${str(settings.executionOrder)}" do N8N: no Olly Flow, ramos independentes executam em paralelo.`,
    );
  }
  if (settings.errorWorkflow)
    report.semanticNotes.push(
      'O workflow de erro do N8N precisa ser importado e escolhido de novo.',
    );
  report.credentialsToCreate = [...credentialGroups.values()];

  const file: WorkflowFile = {
    name: str(input.name),
    nodes,
    connections,
    pinData: isObject(input.pinData) ? (input.pinData as WorkflowFile['pinData']) : {},
    settings: {
      ...(num(settings.executionTimeout) !== undefined && {
        executionTimeout: settings.executionTimeout as number,
      }),
      ...(settings.saveDataSuccessExecution === 'none' && {
        saveDataSuccessExecution: 'none' as const,
      }),
      ...(settings.saveDataErrorExecution === 'none' && {
        saveDataErrorExecution: 'none' as const,
      }),
    },
    meta: { ollyFlow: { formatVersion: WORKFLOW_FILE_FORMAT_VERSION } },
  };
  return { file, report, errors };
}
