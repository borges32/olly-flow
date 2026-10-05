import type { Item } from '@olly/shared-types';
import { NodeExecutionError } from '../../errors.js';
import type { CodeMode, JSONSchema7, NodeDefinition } from '../../types.js';
import { normalizeItems } from './normalize.js';

/** Código inicial de cada modo, como no N8N. */
export const DEFAULT_CODE: Record<CodeMode, string> = {
  runOnceForAllItems: `// Percorre os itens de entrada e acrescenta o campo 'meuCampo' ao JSON de cada um
for (const item of $input.all()) {
  item.json.meuCampo = 1;
}

return $input.all();`,
  runOnceForEachItem: `// Acrescenta o campo 'meuCampo' ao JSON do item
$input.item.json.meuCampo = 1;

return $input.item;`,
};

/**
 * Código JavaScript (spec 005, FR-009 a FR-011): mesma API do Code node do N8N, executado no
 * sandbox do task runner (isolate novo por execução de nó).
 */
export const codeJavascriptNode: NodeDefinition = {
  type: 'code.javascript',
  version: 1,
  displayName: 'Código (JavaScript)',
  description:
    'Transforma os itens com JavaScript, com as variáveis do N8N ($input, $json, $("Nó")...).',
  icon: 'code',
  category: 'code',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        title: 'Modo',
        description:
          '`runOnceForAllItems`: uma vez para todos os itens; `runOnceForEachItem`: uma vez por item.',
        enum: ['runOnceForAllItems', 'runOnceForEachItem'],
        default: 'runOnceForAllItems',
      },
      jsCode: {
        type: 'string',
        title: 'Código',
        default: DEFAULT_CODE.runOnceForAllItems,
        'x-no-expression': true,
        'x-code-editor': 'javascript',
      } as JSONSchema7,
    },
    additionalProperties: false,
  },
  execute: async (input, ctx) => {
    const mode: CodeMode =
      ctx.node.params.mode === 'runOnceForEachItem' ? 'runOnceForEachItem' : 'runOnceForAllItems';
    // O código é lido do parâmetro bruto: nunca é avaliado como expressão.
    const code =
      typeof ctx.node.params.jsCode === 'string' ? ctx.node.params.jsCode : DEFAULT_CODE[mode];
    const result = await ctx.runCode({ code, mode });
    if (mode === 'runOnceForAllItems') return { main: normalizeItems(result) };
    const perItem = Array.isArray(result) ? result : [];
    const items: Item[] = perItem.map((value, i) => {
      if (Array.isArray(value)) {
        throw new NodeExecutionError('No modo por item, o código deve retornar um único objeto', {
          description: `O item ${i} retornou um array`,
        });
      }
      const [item] = normalizeItems(value);
      return { ...(item as Item), pairedItem: { item: i } };
    });
    return { main: items };
  },
};
