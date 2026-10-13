import { OUTPUT_PARSER_PORT } from './ports.js';
import type { WorkflowDefinition, WorkflowNode } from './workflow.js';

/** Nós que tinham o JSON Schema nos parâmetros (specs 011 e 017). */
const LEGACY_PARENTS = new Set(['ai.agent', 'ai.chainLlm']);
export const STRUCTURED_OUTPUT_PARSER_TYPE = 'outputParser.structured';

/**
 * Spec 018, FR-006: converte o formato antigo — `outputParser: 'jsonSchema'` + `schema` dentro do
 * Agent ou do Basic LLM Chain — em `hasOutputParser: true` mais um Structured Output Parser
 * ligado à entrada `ai_outputParser`, com o mesmo schema e a correção automática ligada (as 2
 * correções de antes). Pura e idempotente: roda na leitura, no salvamento, na execução e na
 * importação, sem reescrever as versões publicadas.
 */
export function migrateLegacyOutputParser<T extends WorkflowDefinition>(
  definition: T,
): { definition: T; changed: boolean } {
  const legacy = definition.nodes.filter(
    (n) => LEGACY_PARENTS.has(n.type) && 'outputParser' in n.params,
  );
  if (legacy.length === 0) return { definition, changed: false };

  const names = new Set(definition.nodes.map((n) => n.name));
  const ids = new Set(definition.nodes.map((n) => n.id));
  const unique = (base: string, taken: Set<string>) => {
    let candidate = base;
    for (let i = 2; taken.has(candidate); i++) candidate = `${base} ${String(i)}`;
    taken.add(candidate);
    return candidate;
  };
  const nodes: WorkflowNode[] = [];
  const edges = [...definition.edges];
  for (const node of definition.nodes) {
    if (!legacy.includes(node)) {
      nodes.push(node);
      continue;
    }
    const { outputParser, schema, ...params } = node.params;
    if (outputParser !== 'jsonSchema') {
      // `none` (ou valor desconhecido): só sai o parâmetro antigo.
      nodes.push({ ...node, params });
      continue;
    }
    nodes.push({ ...node, params: { ...params, hasOutputParser: true } });
    const parser: WorkflowNode = {
      id: unique(`${node.id}-parser`, ids),
      type: STRUCTURED_OUTPUT_PARSER_TYPE,
      name: unique(`${node.name} · formato`, names),
      params: {
        schemaType: 'manual',
        inputSchema: typeof schema === 'string' ? schema : JSON.stringify(schema ?? {}),
        autoFix: true,
      },
      position: [node.position[0] + 240, node.position[1] + 220],
    };
    nodes.push(parser);
    edges.push({
      id: `${parser.id}-${OUTPUT_PARSER_PORT}`,
      from: parser.id,
      fromPort: OUTPUT_PARSER_PORT,
      to: node.id,
      toPort: OUTPUT_PARSER_PORT,
    });
  }
  return { definition: { ...definition, nodes, edges }, changed: true };
}
