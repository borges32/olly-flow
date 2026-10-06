import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
  type StoredMessage,
} from '@langchain/core/messages';
import { Ajv } from 'ajv';
import type { AgentTool, ChatModelSupply, MemorySupply } from './types.js';
import { UNTRUSTED_INSTRUCTION, toolResultText, wrapToolResult } from './untrusted.js';

/** O agente passou do limite de iterações sem resposta final (FR-003, SC-005). */
export class AgentIterationLimitError extends Error {
  override name = 'AgentIterationLimitError';
  constructor(readonly maxIterations: number) {
    super(`O agente atingiu o limite de ${String(maxIterations)} iterações sem uma resposta final`);
  }
}

/** Resposta final fora do JSON Schema depois das correções (FR-004, SC-007). */
export class AgentOutputParseError extends Error {
  override name = 'AgentOutputParseError';
}

/** Máximo de pedidos de correção da resposta estruturada (FR-004). */
export const MAX_OUTPUT_CORRECTIONS = 2;

export interface IntermediateStep {
  action: { tool: string; toolInput: unknown };
  observation: string;
}

/** Estado serializável de um agente pausado à espera de aprovação (spec 008/011). */
export interface AgentState {
  messages: StoredMessage[];
  iterations: number;
  corrections: number;
  untrustedSeen: boolean;
  steps: IntermediateStep[];
  usage: { inputTokens: number; outputTokens: number };
  stepIndex: number;
  /** Índice da pergunta deste turno em `messages` (o que vai para a memória). */
  turnStart: number;
}

export interface ApprovalDecision {
  approved: boolean;
  comment?: string | null;
}

export interface PendingApproval {
  toolCallId: string;
  tool: string;
  arguments: Record<string, unknown>;
  reason: string;
}

export interface AgentHooks {
  beforeModelCall(): Promise<void>;
  onUsage(usage: { inputTokens: number; outputTokens: number }): Promise<void>;
  onStep(step: {
    stepIndex: number;
    kind: 'model' | 'tool' | 'approval' | 'final';
    toolName?: string;
    content: unknown;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<void>;
}

export interface AgentRunInput {
  model: ChatModelSupply;
  tools: AgentTool[];
  memory?: MemorySupply;
  systemMessage: string;
  prompt: string;
  maxIterations: number;
  /** FR-004: valida a resposta final contra este JSON Schema. */
  outputSchema?: Record<string, unknown>;
  /** FR-013: depois de conteúdo externo, ferramentas com efeitos colaterais pedem aprovação. */
  blockAfterUntrusted: boolean;
  toolResultMaxChars: number;
  hooks: AgentHooks;
  signal: AbortSignal;
  /** Retomada depois da decisão de aprovação (por `toolCallId`). */
  resume?: { state: AgentState; decisions: Record<string, ApprovalDecision> };
}

export type AgentRunResult =
  | {
      kind: 'done';
      output: unknown;
      steps: IntermediateStep[];
      usage: { inputTokens: number; outputTokens: number };
    }
  | { kind: 'paused'; state: AgentState; approvals: PendingApproval[] };

const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });

const contentText = (message: BaseMessage) =>
  typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

/** JSON da resposta: aceita o texto puro ou dentro de um bloco ```json. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  return JSON.parse(candidate) as unknown;
}

/** Problemas da resposta contra o schema (vazio = válida). */
export function outputProblems(schema: Record<string, unknown>, text: string): string[] {
  let value: unknown;
  try {
    value = extractJson(text);
  } catch {
    return ['a resposta não é um JSON válido'];
  }
  // O `$schema` do usuário (outro draft) não deve impedir a compilação.
  const rest = Object.fromEntries(Object.entries(schema).filter(([k]) => k !== '$schema'));
  const validate = ajv.compile(rest);
  if (validate(value)) return [];
  return (validate.errors ?? []).map(
    (e) =>
      `${e.instancePath.replace(/^\//, '').replaceAll('/', '.') || 'raiz'}: ${e.message ?? 'inválido'}`,
  );
}

function approvalReason(tool: AgentTool, afterUntrusted: boolean): string {
  if (tool.requireApproval)
    return `A ferramenta "${tool.name}" exige aprovação humana (ação destrutiva ou marcada pelo editor)`;
  if (afterUntrusted) {
    return `A ferramenta "${tool.name}" tem efeitos colaterais e foi chamada depois de o agente ler conteúdo externo`;
  }
  return `A ferramenta "${tool.name}" exige aprovação humana`;
}

/**
 * Executa um agente com chamada de ferramentas (spec 011, plan §3): laço ReAct sobre o modelo
 * do LangChain, com limite de iterações, resultados delimitados como não confiáveis, aprovação
 * humana (pausa com o estado serializado) e resposta opcionalmente estruturada.
 */
export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const toolsByName = new Map(input.tools.map((t) => [t.name, t]));
  const decisions = input.resume?.decisions ?? {};
  let state: AgentState;
  let messages: BaseMessage[];
  if (input.resume) {
    state = structuredClone(input.resume.state);
    messages = mapStoredMessagesToChatMessages(state.messages);
  } else {
    const history = input.memory ? await input.memory.load() : [];
    messages = [
      new SystemMessage(`${input.systemMessage}\n\n${UNTRUSTED_INSTRUCTION}`),
      ...history,
      new HumanMessage(input.prompt),
    ];
    state = {
      messages: [],
      iterations: 0,
      corrections: 0,
      untrustedSeen: false,
      steps: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      stepIndex: 0,
      turnStart: messages.length - 1,
    };
  }
  const bound =
    input.tools.length > 0 && input.model.chatModel.bindTools
      ? input.model.chatModel.bindTools(
          input.tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.schema },
          })),
        )
      : input.model.chatModel;

  const step = async (s: Parameters<AgentHooks['onStep']>[0]) => {
    await input.hooks.onStep(s);
    state.stepIndex = Math.max(state.stepIndex, s.stepIndex + 1);
  };
  const pause = (approvals: PendingApproval[]): AgentRunResult => {
    state.messages = mapChatMessagesToStoredMessages(messages);
    return { kind: 'paused', state, approvals };
  };

  for (;;) {
    input.signal.throwIfAborted();
    // Chamadas de ferramenta ainda sem resultado (inclusive as que aguardavam aprovação).
    const last = messages.at(-1);
    if (last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0) {
      const answered = new Set(
        messages.filter((m) => m instanceof ToolMessage).map((m) => m.tool_call_id),
      );
      const pending: PendingApproval[] = [];
      for (const call of last.tool_calls ?? []) {
        const callId = call.id ?? '';
        if (answered.has(callId)) continue;
        const tool = toolsByName.get(call.name);
        const args = call.args;
        if (!tool) {
          messages.push(
            new ToolMessage({
              tool_call_id: callId,
              content: `Ferramenta "${call.name}" não existe.`,
            }),
          );
          continue;
        }
        const afterUntrusted = input.blockAfterUntrusted && state.untrustedSeen && tool.sideEffects;
        if (tool.requireApproval || afterUntrusted) {
          const decision = decisions[callId];
          if (!decision) {
            pending.push({
              toolCallId: callId,
              tool: tool.name,
              arguments: args,
              reason: approvalReason(tool, afterUntrusted),
            });
            continue;
          }
          await step({
            stepIndex: state.stepIndex,
            kind: 'approval',
            toolName: tool.name,
            content: {
              approved: decision.approved,
              comment: decision.comment ?? null,
              arguments: args,
            },
          });
          if (!decision.approved) {
            // FR-011: a rejeição volta ao agente como resultado da ferramenta.
            const rejection = `Ação rejeitada pelo usuário${decision.comment ? `: ${decision.comment}` : ''}`;
            messages.push(new ToolMessage({ tool_call_id: callId, content: rejection }));
            state.steps.push({
              action: { tool: tool.name, toolInput: args },
              observation: rejection,
            });
            continue;
          }
        }
        let result: unknown;
        try {
          result = await tool.invoke(args, input.signal);
        } catch (error) {
          if (input.signal.aborted) throw error;
          result = `Erro da ferramenta: ${error instanceof Error ? error.message : String(error)}`;
        }
        if (tool.external) state.untrustedSeen = true;
        const observation = toolResultText(result, input.toolResultMaxChars);
        messages.push(
          new ToolMessage({
            tool_call_id: callId,
            content: wrapToolResult(tool.source, result, input.toolResultMaxChars),
          }),
        );
        state.steps.push({ action: { tool: tool.name, toolInput: args }, observation });
        await step({
          stepIndex: state.stepIndex,
          kind: 'tool',
          toolName: tool.name,
          content: { arguments: args, result: observation },
        });
      }
      if (pending.length > 0) return pause(pending);
    }

    if (state.iterations >= input.maxIterations) {
      throw new AgentIterationLimitError(input.maxIterations);
    }
    await input.hooks.beforeModelCall();
    const response = (await bound.invoke(messages, { signal: input.signal })) as AIMessage;
    state.iterations++;
    const usage = {
      inputTokens: response.usage_metadata?.input_tokens ?? 0,
      outputTokens: response.usage_metadata?.output_tokens ?? 0,
    };
    state.usage.inputTokens += usage.inputTokens;
    state.usage.outputTokens += usage.outputTokens;
    await input.hooks.onUsage(usage);
    messages.push(response);
    const toolCalls = response.tool_calls ?? [];
    await step({
      stepIndex: state.stepIndex,
      kind: 'model',
      content: {
        text: contentText(response),
        toolCalls: toolCalls.map((c) => ({ name: c.name, arguments: c.args })),
      },
      ...usage,
    });
    if (toolCalls.length > 0) continue;

    const answer = contentText(response);
    if (input.outputSchema) {
      const problems = outputProblems(input.outputSchema, answer);
      if (problems.length > 0) {
        if (state.corrections >= MAX_OUTPUT_CORRECTIONS) {
          throw new AgentOutputParseError(
            `A resposta do agente não seguiu o JSON Schema após ${String(MAX_OUTPUT_CORRECTIONS)} correções: ${problems.join('; ')}`,
          );
        }
        state.corrections++;
        messages.push(
          new HumanMessage(
            `A resposta não segue o JSON Schema exigido (${problems.join('; ')}). ` +
              `Responda de novo somente com um JSON válido para este schema: ${JSON.stringify(input.outputSchema)}`,
          ),
        );
        continue;
      }
    }
    const output = input.outputSchema ? extractJson(answer) : answer;
    await step({ stepIndex: state.stepIndex, kind: 'final', content: { output } });
    // FR-009: a memória guarda a pergunta e a resposta final do turno.
    const question = messages[state.turnStart];
    if (input.memory && question) await input.memory.save([question, new AIMessage(answer)]);
    return { kind: 'done', output, steps: state.steps, usage: state.usage };
  }
}
