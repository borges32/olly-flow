import type { Item, NodeOutput } from '@olly/shared-types';
import { Ajv } from 'ajv';
import { NodeExecutionError, NodeParameterError } from '../../errors.js';
import type { NodeContext, NodeDefinition, NodeExecuteInput } from '../../types.js';

const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });

/** `inputSchema` do gatilho (JSON Schema de cada item), ou `null` se não houver. */
export function parseInputSchema(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return null;
  }
  let schema: unknown = raw;
  if (typeof raw === 'string') {
    try {
      schema = JSON.parse(raw) as unknown;
    } catch {
      throw new NodeParameterError('inputSchema', 'JSON inválido');
    }
  }
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new NodeParameterError('inputSchema', 'deve ser um objeto JSON Schema');
  }
  return schema as Record<string, unknown>;
}

async function executeTrigger(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  // Execução de teste no editor (sem chamador): um item vazio, como o gatilho manual.
  const items: Item[] = input.items.length > 0 ? input.items : [{ json: {} }];
  const schema = parseInputSchema(ctx.getParam('inputSchema', 0));
  if (schema && input.items.length > 0) {
    const validate = ajv.compile(schema);
    const problems = items.flatMap((item, i) =>
      validate(item.json)
        ? []
        : (validate.errors ?? []).map(
            (e) =>
              `item ${i}: ${e.instancePath.replace(/^\//, '') || 'json'} ${e.message ?? 'inválido'}`,
          ),
    );
    if (problems.length > 0) {
      throw new NodeExecutionError('Itens recebidos fora do schema do sub-workflow', {
        description: problems.join('; '),
      });
    }
  }
  return Promise.resolve({ main: items.map((item, i) => ctx.helpers.pairedItem(item, i)) });
}

/**
 * Gatilho de sub-workflow (spec 008, FR-011): recebe os itens do workflow chamador e, se houver
 * `inputSchema`, valida cada item. Equivale ao `n8n-nodes-base.executeWorkflowTrigger`.
 */
export const executeWorkflowTrigger: NodeDefinition = {
  type: 'trigger.executeWorkflow',
  version: 1,
  displayName: 'Quando chamado por outro workflow',
  description: 'Inicia o workflow quando outro o chama como sub-workflow.',
  icon: 'log-in',
  category: 'trigger',
  inputs: [],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: {
    type: 'object',
    properties: {
      inputSchema: {
        type: 'string',
        title: 'Schema dos itens (opcional)',
        description:
          'JSON Schema validado em cada item recebido. Também descreve a entrada quando o workflow é usado como ferramenta de um agente (spec 011).',
        default: '',
        'x-multiline': true,
        'x-no-expression': true,
      },
    },
  } as NodeDefinition['paramsSchema'],
  execute: executeTrigger,
};
