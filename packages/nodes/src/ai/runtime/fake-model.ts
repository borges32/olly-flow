import {
  BaseChatModel,
  type BaseChatModelParams,
} from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

/**
 * Passo do roteiro do modelo simulado (spec 011, FR-016). Cada chamada ao modelo consome o
 * próximo passo; `repeat` repete o passo para sempre (ex.: laço de ferramentas).
 */
export interface FakeModelStep {
  /** Texto da resposta. Aceita `{{lastHuman}}`, `{{lastTool}}`, `{{system}}` e `{{messageCount}}`. */
  content?: string;
  toolCalls?: { name: string; args?: Record<string, unknown> }[];
  repeat?: boolean;
  usage?: { input?: number; output?: number };
}

const text = (message: BaseMessage | undefined) =>
  message === undefined
    ? ''
    : typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);

/** Último elemento que satisfaz o filtro. */
function lastOf<T>(list: T[], test: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i] as T;
    if (test(item)) return item;
  }
  return undefined;
}

/**
 * Modelo de chat determinístico para os testes (FR-016): respostas e chamadas de ferramenta
 * roteirizadas, sem rede. Só é aceito com `NODE_ENV=test` (credencial `fakeLlm`).
 *
 * Como um modelo real, não guarda estado: o passo do roteiro sai do número de respostas do
 * assistente já presentes na conversa (inclusive as da memória). Assim a retomada de uma
 * execução pausada (spec 008) continua o roteiro, e um roteiro cobre várias rodadas com memória.
 */
export class FakeScriptedChatModel extends BaseChatModel {
  /** Mensagens recebidas em cada chamada (inspeção nos testes). */
  readonly calls: BaseMessage[][] = [];

  constructor(
    private readonly script: FakeModelStep[],
    params: BaseChatModelParams = {},
  ) {
    super(params);
  }

  _llmType(): string {
    return 'olly-fake';
  }

  /** As ferramentas não mudam o roteiro: devolve o próprio modelo. */
  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    const answered = messages.filter((m) => m instanceof AIMessage).length;
    let cursor = 0;
    for (let i = 0; i < answered && this.script[cursor] && !this.script[cursor]?.repeat; i++) {
      cursor++;
    }
    const step = this.script[cursor];
    if (!step) throw new Error('Roteiro do modelo simulado esgotado');
    const content = (step.content ?? '')
      .replaceAll('{{lastHuman}}', text(lastOf(messages, (m) => m instanceof HumanMessage)))
      .replaceAll('{{lastTool}}', text(lastOf(messages, (m) => m instanceof ToolMessage)))
      .replaceAll('{{system}}', text(messages.find((m) => m instanceof SystemMessage)))
      .replaceAll('{{messageCount}}', String(messages.length));
    // Determinístico e único na conversa (o mesmo id na retomada).
    const toolCalls = (step.toolCalls ?? []).map((call, i) => ({
      id: `call_${String(messages.length)}_${String(i)}`,
      name: call.name,
      args: call.args ?? {},
      type: 'tool_call' as const,
    }));
    const inputTokens =
      step.usage?.input ?? Math.ceil(messages.reduce((n, m) => n + text(m).length, 0) / 4);
    const outputTokens = step.usage?.output ?? Math.ceil(content.length / 4) + toolCalls.length;
    const message = new AIMessage({
      content,
      tool_calls: toolCalls,
      usage_metadata: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    });
    return Promise.resolve({ generations: [{ message, text: content }] });
  }
}
