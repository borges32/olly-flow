import type { ChatModelSupply } from './types.js';

/** Resposta recusada pelo output parser (spec 018), com os problemas encontrados. */
export class OutputParserError extends Error {
  override name = 'OutputParserError';
  constructor(readonly problems: string[]) {
    super(`A resposta não segue o formato do output parser: ${problems.join('; ')}`);
  }
}

/** Passo registrado por um parser (o nó pai numera e grava). */
export interface OutputParseStep {
  kind: 'model' | 'error';
  content: unknown;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Ganchos do nó pai (spec 018, FR-007): limite mensal, uso com o modelo que respondeu e passos.
 * As correções do Auto-fixing usam o próprio modelo pelos mesmos ganchos.
 */
export interface OutputParseHooks {
  beforeModelCall(): Promise<void>;
  onUsage(
    usage: { inputTokens: number; outputTokens: number },
    model: ChatModelSupply,
  ): Promise<void>;
  onStep(step: OutputParseStep): Promise<void>;
}

export interface OutputParseContext {
  signal: AbortSignal;
  hooks: OutputParseHooks;
}

/** O que um sub-nó de output parser entrega ao Agent, ao Basic LLM Chain ou ao Auto-fixing. */
export interface OutputParserSupply {
  kind: 'structured' | 'autoFixing' | 'itemList';
  /** Instruções de formato enviadas ao modelo junto com o pedido (FR-002). */
  formatInstructions(): string;
  /** Interpreta a resposta; lança `OutputParserError` se ela for inválida. */
  parse(text: string, context: OutputParseContext): Promise<unknown>;
  /** Structured com `autoFix`: o nó pai corrige com o próprio modelo (até 2 vezes). */
  readonly fixWithRootModel: boolean;
}

/** JSON Schema inferido de um exemplo JSON (Structured Output Parser "a partir de um exemplo"). */
export function jsonSchemaOfExample(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { type: 'array', ...(value.length > 0 && { items: jsonSchemaOfExample(value[0]) }) };
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(record).map(([k, v]) => [k, jsonSchemaOfExample(v)]),
      ),
      required: Object.keys(record),
    };
  }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'string') return { type: 'string' };
  return {};
}
