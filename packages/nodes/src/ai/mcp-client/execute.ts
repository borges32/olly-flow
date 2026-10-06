import { Ajv, type ValidateFunction } from 'ajv';
import type {
  BinaryRef,
  Item,
  McpOperation,
  McpToolDefinition,
  NodeOutput,
} from '@olly/shared-types';
import { MCP_OPERATIONS } from '@olly/shared-types';
import type { ResolvedCredential } from '../../credentials/definitions.js';
import {
  NodeExecutionError,
  NodeParameterError,
  errorJson,
  failedItem,
  itemErrorMode,
} from '../../errors.js';
import type { McpCallRef, NodeContext, NodeExecuteInput } from '../../types.js';

// Argumentos do formulário chegam como texto das expressões: `coerceTypes` converte "3" em 3
// quando o schema pede número. No modo JSON, os tipos valem como vieram.
const formAjv = new Ajv({
  strict: false,
  allErrors: true,
  coerceTypes: true,
  validateSchema: false,
});
const jsonAjv = new Ajv({ strict: false, allErrors: true, validateSchema: false });

type Outcome = { ok: true; item: Item } | { ok: false; error: unknown };

/** Executa o nó Cliente MCP item a item (spec 010, plan §5). */
export async function executeMcpClient(
  input: NodeExecuteInput,
  ctx: NodeContext,
): Promise<NodeOutput> {
  // Sem gateway (motor sem MCP), falha antes de qualquer item.
  ctx.mcp();
  const items = input.items.length > 0 ? input.items : [{ json: {} }];
  const mode = itemErrorMode(ctx.node.settings);
  const credential = ctx.node.credentialId ? await ctx.getCredential() : undefined;
  const validators = new Map<string, ValidateFunction>();

  const outcomes = await ctx.mapItems(items, async (item, itemIndex): Promise<Outcome> => {
    try {
      const json = await runItem(ctx, itemIndex, credential, validators);
      return { ok: true, item: ctx.helpers.pairedItem(json, itemIndex) };
    } catch (error) {
      if (mode === 'stop') throw error;
      return { ok: false, error };
    }
  });

  const main: Item[] = [];
  const failed: Item[] = [];
  outcomes.forEach((outcome, i) => {
    if (outcome.ok) main.push(outcome.item);
    else if (mode === 'errorOutput')
      failed.push(failedItem(outcome.error, items[i]?.json ?? {}, i));
    else main.push({ json: errorJson(outcome.error), pairedItem: { item: i } });
  });
  return mode === 'errorOutput' ? { main, error: failed } : { main };
}

async function runItem(
  ctx: NodeContext,
  itemIndex: number,
  credential: ResolvedCredential | undefined,
  validators: Map<string, ValidateFunction>,
): Promise<Item> {
  const gateway = ctx.mcp();
  const serverId = text(ctx.getParam('serverId', itemIndex));
  if (!serverId) throw new NodeParameterError('serverId', 'selecione um servidor MCP');
  const operation = ctx.getParam('operation', itemIndex) as McpOperation;
  if (!MCP_OPERATIONS.includes(operation)) {
    throw new NodeParameterError('operation', `operação desconhecida: ${operation}`);
  }
  const ref: McpCallRef = {
    serverId,
    nodeId: ctx.node.id,
    runIndex: ctx.runIndex,
    itemIndex,
    signal: ctx.signal,
    ...(credential && { credential }),
  };

  switch (operation) {
    case 'callTool': {
      const toolName = text(ctx.getParam('toolName', itemIndex));
      if (!toolName) throw new NodeParameterError('toolName', 'selecione uma tool');
      const tool = await gateway.prepareTool({ ...ref, toolName });
      const formMode = ctx.getParam('argumentsMode', itemIndex) !== 'json';
      const args = formMode
        ? formArguments(ctx.getParam('arguments', itemIndex), tool)
        : jsonArguments(ctx.getParam('argumentsJson', itemIndex));
      // FR-009/SC-004: argumentos validados contra o schema aprovado antes de qualquer chamada.
      validate(tool, args, formMode, validators);
      const result = await gateway.callTool({ ...ref, toolName, arguments: args });
      const { content, binary } = await storeBinaries(ctx, result.content);
      if (result.isError) {
        // FR-010: `isError` é falha do nó, sujeita à configuração de erro (`onError`).
        throw new NodeExecutionError(errorText(content) || `A tool "${toolName}" devolveu erro`, {
          description: `Tool "${toolName}" do servidor MCP`,
        });
      }
      return withBinary(
        {
          content,
          ...(result.structuredContent && { structuredContent: result.structuredContent }),
          isError: false,
        },
        binary,
      );
    }
    case 'listTools':
      return { json: { tools: await gateway.listTools(ref) } };
    case 'listResources':
      return { json: { resources: await gateway.listResources(ref) } };
    case 'readResource': {
      const uri = text(ctx.getParam('resourceUri', itemIndex));
      if (!uri) throw new NodeParameterError('resourceUri', 'informe a URI do resource');
      const result = await gateway.readResource({ ...ref, uri });
      const { content, binary } = await storeBinaries(ctx, result.contents);
      return withBinary({ uri, contents: content }, binary);
    }
    case 'listPrompts':
      return { json: { prompts: await gateway.listPrompts(ref) } };
    case 'getPrompt': {
      const name = text(ctx.getParam('promptName', itemIndex));
      if (!name) throw new NodeParameterError('promptName', 'informe o nome do prompt');
      const args = promptArguments(ctx.getParam('promptArguments', itemIndex));
      const result = await gateway.getPrompt({ ...ref, name, arguments: args });
      return {
        json: {
          ...(result.description !== undefined && { description: result.description }),
          messages: result.messages,
        },
      };
    }
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Formulário: campos vazios e não obrigatórios ficam de fora (o formulário guarda `''` quando o
 * usuário não preenche).
 */
function formArguments(raw: unknown, tool: McpToolDefinition): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new NodeParameterError('arguments', 'deve ser um objeto');
  }
  const required = new Set(
    Array.isArray(tool.inputSchema.required) ? (tool.inputSchema.required as string[]) : [],
  );
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) => required.has(key) || (value !== '' && value !== undefined),
    ),
  );
}

function jsonArguments(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return {};
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new NodeParameterError('argumentsJson', 'JSON inválido');
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new NodeParameterError('argumentsJson', 'deve ser um objeto JSON');
  }
  return value as Record<string, unknown>;
}

function validate(
  tool: McpToolDefinition,
  args: Record<string, unknown>,
  formMode: boolean,
  cache: Map<string, ValidateFunction>,
): void {
  const key = `${formMode ? 'form' : 'json'}:${tool.name}`;
  let validator = cache.get(key);
  if (!validator) {
    // `$schema` (ex.: 2020-12) é descartado: as palavras-chave usuais são comuns aos drafts.
    const schema = { ...tool.inputSchema };
    delete schema.$schema;
    try {
      validator = (formMode ? formAjv : jsonAjv).compile(schema);
    } catch (error) {
      throw new NodeExecutionError(
        `Schema da tool "${tool.name}" inválido: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    cache.set(key, validator);
  }
  if (!validator(args)) {
    const problems = (validator.errors ?? []).map((e) => {
      const field =
        e.instancePath.replace(/^\//, '').replaceAll('/', '.') ||
        (e.params as { missingProperty?: string }).missingProperty ||
        'argumentos';
      return `${field}: ${e.message ?? 'inválido'}`;
    });
    throw new NodeExecutionError(`Argumentos inválidos para a tool "${tool.name}"`, {
      description: problems.join('; '),
    });
  }
}

function promptArguments(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const entry of raw as { name?: unknown; value?: unknown }[]) {
    if (typeof entry.name === 'string' && entry.name) {
      out[entry.name] =
        typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value ?? '');
    }
  }
  return out;
}

/**
 * FR-010: conteúdo binário (image/audio com `data`, resource com `blob`) vai para o object
 * storage; no item fica a referência (`binary`) e, no conteúdo, o nome da propriedade binária.
 */
async function storeBinaries(
  ctx: NodeContext,
  content: Record<string, unknown>[],
): Promise<{ content: Record<string, unknown>[]; binary: Record<string, BinaryRef> }> {
  const binary: Record<string, BinaryRef> = {};
  const out: Record<string, unknown>[] = [];
  for (const entry of content) {
    // Onde está o binário: `data` de image/audio, `blob` do resource embutido ou do resource lido.
    const embedded = entry.type === 'resource' ? (entry.resource as Record<string, unknown>) : null;
    const inner = embedded ?? entry;
    const field =
      (entry.type === 'image' || entry.type === 'audio') && typeof entry.data === 'string'
        ? 'data'
        : typeof inner.blob === 'string'
          ? 'blob'
          : null;
    if (!field) {
      out.push(entry);
      continue;
    }
    const key = Object.keys(binary).length === 0 ? 'data' : `data_${Object.keys(binary).length}`;
    const mimeType =
      typeof inner.mimeType === 'string' ? inner.mimeType : 'application/octet-stream';
    const ref = await ctx.helpers.putBinary(Buffer.from(inner[field] as string, 'base64'), {
      mimeType,
      ...(typeof inner.uri === 'string' && { fileName: inner.uri.split('/').pop() ?? inner.uri }),
    });
    binary[key] = ref;
    const replaced = {
      ...Object.fromEntries(Object.entries(inner).filter(([k]) => k !== field)),
      binaryProperty: key,
    };
    out.push(embedded ? { ...entry, resource: replaced } : replaced);
  }
  return { content: out, binary };
}

function withBinary(json: Record<string, unknown>, binary: Record<string, BinaryRef>): Item {
  return Object.keys(binary).length > 0 ? { json, binary } : { json };
}

function errorText(content: Record<string, unknown>[]): string {
  return content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
    .trim();
}
