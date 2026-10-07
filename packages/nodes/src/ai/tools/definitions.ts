import type { Item } from '@olly/shared-types';
import { NodeParameterError } from '../../errors.js';
import { httpRequestParamsSchema } from '../../http/request/definition.js';
import { postgresQueryParamsSchema } from '../../postgres/query/definition.js';
import type { JSONSchema7, NodeContext, NodeDefinition } from '../../types.js';
import { subNodeExecute } from '../chat-model/definition.js';
import { fromAISchema } from '../runtime/from-ai.js';
import { toolNameOf } from '../runtime/tool-name.js';
import type { AgentTool } from '../runtime/types.js';

/** Parâmetros comuns das ferramentas (FR-007): nome, descrição e aprovação. */
const toolBase: Record<string, JSONSchema7> = {
  toolName: {
    type: 'string',
    title: 'Nome da ferramenta',
    description: 'Letras, números, _ e -. Vazio: o nome do nó.',
    default: '',
    'x-no-expression': true,
  } as JSONSchema7,
  toolDescription: {
    type: 'string',
    title: 'Descrição para o modelo',
    description: 'O que a ferramenta faz e quando usá-la (obrigatória).',
    default: '',
    'x-multiline': true,
    'x-no-expression': true,
  } as JSONSchema7,
  requireApproval: {
    type: 'boolean',
    title: 'Exigir aprovação humana',
    description: 'Cada chamada pausa a execução até alguém aprovar ou rejeitar.',
    default: false,
  },
};

const META = new Set(['toolName', 'toolDescription', 'requireApproval']);

/** Exemplos de `$fromAI` mostrados no formulário da ferramenta HTTP (valores em modo Expressão). */
export const HTTP_TOOL_EXAMPLES = {
  url: "https://api.exemplo.com/clientes/{{ $fromAI('id', 'Id do cliente') }}",
  queryValue: "{{ $fromAI('cidade', 'Nome da cidade') }}",
  jsonBody:
    "{ \"cidade\": \"{{ $fromAI('cidade', 'Nome da cidade') }}\", \"dias\": {{ $fromAI('dias', 'Quantidade de dias', 'number', 3) }} }",
};

/** Exemplo da Ferramenta: código mostrado no formulário: o schema e o código que o usa. */
export const CODE_TOOL_EXAMPLES = {
  inputSchema:
    '{"type":"object","properties":{"valor":{"type":"number","description":"Valor da compra em reais"},"parcelas":{"type":"integer","description":"Número de parcelas"}},"required":["valor","parcelas"]}',
  jsCode: [
    'const { valor, parcelas } = $input.first().json;',
    'return { parcela: Number((valor / parcelas).toFixed(2)) };',
  ].join('\n'),
};

/** Parâmetros do `http.request` com exemplos de `$fromAI` na ajuda dos campos. */
function httpToolProperties(): Record<string, JSONSchema7> {
  const props = httpRequestParamsSchema.properties as Record<string, JSONSchema7>;
  const mode = 'Use o modo Expressão no campo para o modelo preencher o valor com $fromAI.';
  return {
    ...props,
    queryParameters: {
      ...(props.queryParameters as JSONSchema7),
      description: [
        mode,
        `Na URL: ${HTTP_TOOL_EXAMPLES.url}`,
        `Num parâmetro de query: Nome = cidade, Valor = ${HTTP_TOOL_EXAMPLES.queryValue}`,
      ].join('\n'),
    },
    jsonBody: {
      ...(props.jsonBody as JSONSchema7),
      description: [
        'Texto JSON ou expressão que produz um objeto.',
        mode,
        `Exemplo: ${HTTP_TOOL_EXAMPLES.jsonBody}`,
      ].join('\n'),
    },
  };
}

/** Parâmetros sem os de identificação (base do schema gerado por `$fromAI`). */
const toolParams = (ctx: NodeContext) =>
  Object.fromEntries(Object.entries(ctx.node.params).filter(([k]) => !META.has(k)));

function baseTool(ctx: NodeContext, itemIndex: number) {
  const description = ctx.getParam('toolDescription', itemIndex);
  if (typeof description !== 'string' || !description.trim()) {
    throw new NodeParameterError(
      'toolDescription',
      'descreva para o modelo o que a ferramenta faz',
    );
  }
  return {
    name: toolNameOf(ctx.node),
    description: description.trim(),
    requireApproval: ctx.getParam('requireApproval', itemIndex) === true,
  };
}

/** Saída de um nó como resultado da ferramenta: os `json` dos itens (um só, sem lista). */
function itemsResult(items: Item[] | undefined): unknown {
  const values = (items ?? []).map((i) => i.json);
  return values.length === 1 ? values[0] : values;
}

/** Executa um nó de integração com os parâmetros resolvidos pelos argumentos do modelo. */
async function runNodeAsTool(
  node: NodeDefinition,
  ctx: NodeContext,
  itemIndex: number,
  args: Record<string, unknown>,
  signal: AbortSignal,
  overrides: Record<string, unknown> = {},
): Promise<unknown> {
  const resolve = await ctx.withFromAI(args, itemIndex);
  const items: Item[] = [{ json: {} }];
  const toolCtx: NodeContext = {
    ...ctx,
    signal,
    getParam: (name) => (Object.hasOwn(overrides, name) ? overrides[name] : resolve(name)),
    mapItems: async (list, fn) => {
      const out = [];
      for (let i = 0; i < list.length; i++) out.push(await fn(list[i] as (typeof list)[number], i));
      return out;
    },
  };
  const output = await node.execute({ inputs: { main: items }, items }, toolCtx);
  return itemsResult(output.main);
}

const subNode = (
  type: string,
  displayName: string,
  description: string,
  icon: string,
  properties: Record<string, JSONSchema7>,
  supply: (ctx: NodeContext, itemIndex: number) => Promise<AgentTool[]>,
  extra: Partial<NodeDefinition> = {},
): NodeDefinition => ({
  type,
  version: 1,
  displayName,
  description,
  icon,
  category: 'ai',
  inputs: [],
  outputs: [{ name: 'ai_tool', displayName: 'Ferramenta', kind: 'ai_tool' }],
  paramsSchema: { type: 'object', properties },
  execute: subNodeExecute(displayName),
  supplyData: supply,
  ...extra,
});

/** Ferramentas do Agent (spec 011, FR-007, plan §4). */
export function createAgentToolNodes(deps: {
  httpRequest: NodeDefinition;
  postgresQuery: NodeDefinition;
}): NodeDefinition[] {
  const http = subNode(
    'tool.httpRequest',
    'Ferramenta: HTTP',
    'Chama uma API HTTP; o modelo preenche os campos com $fromAI().',
    'globe',
    { ...toolBase, ...httpToolProperties() },
    (ctx, itemIndex) => {
      const base = baseTool(ctx, itemIndex);
      const rawMethod = ctx.getParam('method', itemIndex);
      const method = (typeof rawMethod === 'string' ? rawMethod : 'GET').toUpperCase();
      return Promise.resolve([
        {
          ...base,
          schema: fromAISchema(toolParams(ctx)),
          // FR-013: só leitura (GET/HEAD) não tem efeito colateral.
          sideEffects: method !== 'GET' && method !== 'HEAD',
          external: true,
          source: `http:${ctx.node.name}`,
          invoke: (args, signal) => runNodeAsTool(deps.httpRequest, ctx, itemIndex, args, signal),
        },
      ]);
    },
    { credentialTypes: deps.httpRequest.credentialTypes ?? [] },
  );

  const postgres = subNode(
    'tool.postgresQuery',
    'Ferramenta: PostgreSQL',
    'Consulta SQL fixa; o modelo só fornece os parâmetros ($fromAI), nunca o SQL.',
    'database',
    {
      ...toolBase,
      // FR-008: o modelo não escreve SQL; o SQL é fixo e não aceita expressão.
      query: (postgresQueryParamsSchema.properties as Record<string, JSONSchema7>)
        .query as JSONSchema7,
      queryParameters: (postgresQueryParamsSchema.properties as Record<string, JSONSchema7>)
        .queryParameters as JSONSchema7,
      options: (postgresQueryParamsSchema.properties as Record<string, JSONSchema7>)
        .options as JSONSchema7,
    },
    (ctx, itemIndex) => {
      const base = baseTool(ctx, itemIndex);
      const query = ctx.node.params.query;
      if (typeof query !== 'string' || !query.trim()) {
        throw new NodeParameterError('query', 'informe o SQL');
      }
      return Promise.resolve([
        {
          ...base,
          schema: fromAISchema(toolParams(ctx)),
          sideEffects: !/^\s*(select|with|show|explain)\b/i.test(query),
          external: false,
          source: `postgres:${ctx.node.name}`,
          invoke: (args, signal) =>
            runNodeAsTool(deps.postgresQuery, ctx, itemIndex, args, signal, {
              query,
              mode: 'once',
            }),
        },
      ]);
    },
    { credentialTypes: ['postgres'] },
  );

  const workflow = subNode(
    'tool.workflow',
    'Ferramenta: workflow',
    'Chama um workflow publicado; a entrada segue o schema do gatilho dele.',
    'workflow',
    {
      ...toolBase,
      workflowId: {
        type: 'string',
        title: 'Workflow',
        description: 'Workflow publicado com o gatilho "Quando chamado por outro workflow".',
        default: '',
        'x-load-options': 'workflows',
        'x-no-expression': true,
      } as JSONSchema7,
    },
    async (ctx, itemIndex) => {
      const base = baseTool(ctx, itemIndex);
      const workflowId = ctx.getParam('workflowId', itemIndex);
      if (typeof workflowId !== 'string' || !workflowId) {
        throw new NodeParameterError('workflowId', 'selecione o workflow');
      }
      const gateway = ctx.subWorkflows();
      const { inputSchema } = await gateway.describe(workflowId);
      return [
        {
          ...base,
          schema: inputSchema ?? {
            type: 'object',
            properties: { query: { type: 'string', description: 'Entrada para o workflow' } },
            required: ['query'],
          },
          sideEffects: true,
          external: false,
          source: `workflow:${ctx.node.name}`,
          invoke: async (args, signal) => {
            const result = await gateway.run({
              workflowId,
              items: [{ json: args }],
              wait: true,
              signal,
            });
            return itemsResult(result.items);
          },
        },
      ];
    },
  );

  const code = subNode(
    'tool.code',
    'Ferramenta: código',
    'Código JavaScript no sandbox; o modelo envia os argumentos do schema.',
    'code',
    {
      ...toolBase,
      inputSchema: {
        type: 'string',
        title: 'Schema dos argumentos (JSON Schema)',
        description: [
          'Os argumentos que o modelo envia ao chamar a ferramenta. Descreva cada campo em "description": é o que o modelo lê para preenchê-lo.',
          `Exemplo: ${CODE_TOOL_EXAMPLES.inputSchema}`,
        ].join('\n'),
        default: '{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}',
        'x-multiline': true,
        'x-no-expression': true,
      } as JSONSchema7,
      jsCode: {
        type: 'string',
        title: 'Código',
        description: [
          'Recebe os argumentos do modelo em $input.first().json e devolve o resultado ao modelo (objeto, texto ou itens). Roda no sandbox, sem rede nem arquivos.',
          'Exemplo, com o schema acima:',
          CODE_TOOL_EXAMPLES.jsCode,
        ].join('\n'),
        default: 'return { resposta: $input.first().json.query };',
        'x-code-editor': 'javascript',
        'x-no-expression': true,
      } as JSONSchema7,
    },
    (ctx, itemIndex) => {
      const base = baseTool(ctx, itemIndex);
      let schema: Record<string, unknown>;
      try {
        schema = JSON.parse(String(ctx.getParam('inputSchema', itemIndex))) as Record<
          string,
          unknown
        >;
      } catch {
        throw new NodeParameterError('inputSchema', 'JSON inválido');
      }
      const rawCode = ctx.getParam('jsCode', itemIndex);
      const jsCode = typeof rawCode === 'string' ? rawCode : '';
      return Promise.resolve([
        {
          ...base,
          schema,
          sideEffects: true,
          external: false,
          source: `code:${ctx.node.name}`,
          invoke: async (args) => {
            const result = await ctx.runCode({
              code: jsCode,
              mode: 'runOnceForAllItems',
              items: [{ json: args }],
            });
            return Array.isArray(result) &&
              result.every((r) => r && typeof r === 'object' && 'json' in r)
              ? itemsResult(result as Item[])
              : result;
          },
        },
      ]);
    },
  );

  const mcp = subNode(
    'tool.mcp',
    'Ferramenta: MCP',
    'Tools liberadas de um servidor MCP do catálogo (as destrutivas pedem aprovação).',
    'plug-zap',
    {
      serverId: {
        type: 'string',
        title: 'Servidor MCP',
        default: '',
        'x-load-options': 'mcpServers',
        'x-no-expression': true,
      } as JSONSchema7,
      tools: {
        type: 'string',
        title: 'Tools',
        description: '`allowed`: todas as liberadas no projeto; `selected`: só as da lista.',
        enum: ['allowed', 'selected'],
        default: 'allowed',
      },
      toolNames: {
        type: 'array',
        title: 'Tools escolhidas',
        description: 'Só as tools liberadas para o projeto.',
        default: [],
        // Seleção múltipla com as tools do servidor (grava `[{ name }]`).
        'x-load-options': 'mcpTools',
        items: {
          type: 'object',
          properties: { name: { type: 'string', title: 'Tool', minLength: 1 } },
          required: ['name'],
          additionalProperties: false,
        },
        'x-display-options': { show: { tools: ['selected'] } },
      } as JSONSchema7,
    },
    async (ctx, itemIndex) => {
      const serverId = ctx.getParam('serverId', itemIndex);
      if (typeof serverId !== 'string' || !serverId) {
        throw new NodeParameterError('serverId', 'selecione o servidor MCP');
      }
      const gateway = ctx.mcp();
      const ref = { serverId, nodeId: ctx.node.id, runIndex: ctx.runIndex, itemIndex };
      let available = await gateway.agentTools(ref);
      if (ctx.getParam('tools', itemIndex) === 'selected') {
        const chosen = new Set(
          ((ctx.getParam('toolNames', itemIndex) as { name?: string }[] | undefined) ?? []).map(
            (t) => t.name,
          ),
        );
        available = available.filter((t) => chosen.has(t.definition.name));
      }
      return available.map(({ definition, destructive, readOnly }): AgentTool => ({
        name: definition.name,
        description: definition.description ?? definition.name,
        schema: definition.inputSchema,
        // FR-010: destrutiva pela política do catálogo (spec 010) ⇒ aprovação humana.
        requireApproval: destructive,
        sideEffects: !readOnly,
        external: true,
        source: `mcp:${definition.name}`,
        invoke: async (args, signal) => {
          const result = await gateway.callTool({
            ...ref,
            toolName: definition.name,
            arguments: args,
            signal,
          });
          const text = result.content
            .filter((c) => c.type === 'text' && typeof c.text === 'string')
            .map((c) => c.text as string)
            .join('\n');
          if (result.isError) return `Erro da tool: ${text}`;
          return result.structuredContent ?? text;
        },
      }));
    },
  );

  return [mcp, http, postgres, workflow, code];
}
