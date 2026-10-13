import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import {
  MAX_OUTPUT_CORRECTIONS,
  contentText,
  correctionPrompt,
  withFormatInstructions,
} from './agent.js';
import { OutputParserError, type OutputParserSupply } from './output-parser.js';
import type { ChatModelSupply } from './types.js';

/** Mensagem adicional do Basic LLM Chain (spec 017, FR-003). */
export interface ChainMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

export interface ChainStep {
  stepIndex: number;
  kind: 'model' | 'error' | 'final';
  content: unknown;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ChainHooks {
  beforeModelCall(): Promise<void>;
  onUsage(
    usage: { inputTokens: number; outputTokens: number },
    model: ChatModelSupply,
  ): Promise<void>;
  onStep(step: ChainStep): Promise<void>;
}

export interface ChainRunInput {
  model: ChatModelSupply;
  /** FR-011: usado quando a chamada ao principal falha. */
  fallback?: ChatModelSupply;
  messages: ChainMessage[];
  prompt: string;
  /** Spec 018, FR-002: o output parser ligado ao nó interpreta a resposta. */
  outputParser?: OutputParserSupply;
  hooks: ChainHooks;
  signal: AbortSignal;
}

export interface ChainRunResult {
  /** `{ text }` (FR-004) ou `{ output }` com o objeto do schema (FR-005). */
  json: Record<string, unknown>;
  /** O modelo que respondeu (principal ou reserva). */
  model: ChatModelSupply;
}

/** Resposta fora do JSON Schema depois das correções (FR-005). */
export class ChainOutputParseError extends Error {
  override name = 'ChainOutputParseError';
}

const ROLE: Record<string, ChainMessage['role']> = {
  system: 'system',
  human: 'user',
  ai: 'assistant',
};

const describe = (messages: BaseMessage[]) =>
  messages.map((m) => ({ role: ROLE[m.type] ?? m.type, text: contentText(m) }));

/** Lido de novo depois de cada `await` (o cancelamento pode chegar durante a chamada). */
const aborted = (signal: AbortSignal) => signal.aborted;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * O limite mensal de tokens (spec 011, FR-015) não aciona o reserva: o erro vem da API
 * (`TokenLimitExceededError`) e é reconhecido pelo nome.
 */
const isTokenLimit = (error: unknown) =>
  error instanceof Error && error.name === 'TokenLimitExceededError';

/**
 * Basic LLM Chain (spec 017, plan §2): uma chamada ao modelo com as mensagens e o prompt, sem
 * ferramentas nem memória. Na falha do principal, repete no reserva (FR-011); com JSON Schema,
 * pede até 2 correções ao modelo que respondeu (FR-005). Cada chamada vira um passo (FR-012).
 */
export async function runChain(input: ChainRunInput): Promise<ChainRunResult> {
  let stepIndex = 0;
  const base: BaseMessage[] = [
    ...input.messages.map((m) =>
      m.role === 'system'
        ? new SystemMessage(m.text)
        : m.role === 'assistant'
          ? new AIMessage(m.text)
          : new HumanMessage(m.text),
    ),
    new HumanMessage(withFormatInstructions(input.prompt, input.outputParser)),
  ];

  const call = async (supply: ChatModelSupply, messages: BaseMessage[]) => {
    await input.hooks.beforeModelCall();
    const response = (await supply.chatModel.invoke(messages, {
      signal: input.signal,
    })) as AIMessage;
    const usage = {
      inputTokens: response.usage_metadata?.input_tokens ?? 0,
      outputTokens: response.usage_metadata?.output_tokens ?? 0,
    };
    await input.hooks.onUsage(usage, supply);
    await input.hooks.onStep({
      stepIndex: stepIndex++,
      kind: 'model',
      content: {
        provider: supply.provider,
        model: supply.model,
        fallback: supply === input.fallback,
        messages: describe(messages),
        text: contentText(response),
      },
      ...usage,
    });
    return response;
  };

  let active = input.model;
  let response: AIMessage;
  try {
    response = await call(input.model, base);
  } catch (error) {
    if (!input.fallback || input.signal.aborted || isTokenLimit(error)) throw error;
    await input.hooks.onStep({
      stepIndex: stepIndex++,
      kind: 'error',
      content: {
        provider: input.model.provider,
        model: input.model.model,
        message: errorMessage(error),
      },
    });
    active = input.fallback;
    try {
      response = await call(input.fallback, base);
    } catch (fallbackError) {
      if (aborted(input.signal) || isTokenLimit(fallbackError)) throw fallbackError;
      throw new Error(
        `Modelo principal (${input.model.model}): ${errorMessage(error)}. Modelo reserva (${input.fallback.model}): ${errorMessage(fallbackError)}`,
        { cause: fallbackError },
      );
    }
  }

  let json: Record<string, unknown>;
  const parser = input.outputParser;
  if (parser) {
    const messages = [...base];
    const context = {
      signal: input.signal,
      hooks: {
        beforeModelCall: () => input.hooks.beforeModelCall(),
        onUsage: (usage: { inputTokens: number; outputTokens: number }, model: ChatModelSupply) =>
          input.hooks.onUsage(usage, model),
        onStep: (step: { kind: 'model' | 'error'; content: unknown }) =>
          input.hooks.onStep({ stepIndex: stepIndex++, ...step }),
      },
    };
    for (let corrections = 0; ; corrections++) {
      try {
        json = { output: await parser.parse(contentText(response), context) };
        break;
      } catch (error) {
        if (!(error instanceof OutputParserError) || !parser.fixWithRootModel) throw error;
        if (corrections >= MAX_OUTPUT_CORRECTIONS) {
          throw new ChainOutputParseError(
            `A resposta do modelo não seguiu o formato do output parser após ${String(MAX_OUTPUT_CORRECTIONS)} correções: ${error.problems.join('; ')}`,
          );
        }
        messages.push(
          response,
          new HumanMessage(correctionPrompt(error.problems, parser.formatInstructions())),
        );
        // As correções usam o modelo que respondeu (principal ou reserva).
        response = await call(active, messages);
      }
    }
  } else {
    json = { text: contentText(response) };
  }
  await input.hooks.onStep({ stepIndex: stepIndex++, kind: 'final', content: json });
  return { json, model: active };
}
