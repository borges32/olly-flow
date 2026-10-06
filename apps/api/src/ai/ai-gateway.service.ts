import { ollyMetrics } from '@olly/telemetry';
import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { Masker } from '@olly/engine';
import { guardedFetchLike, type GuardedFetch } from '@olly/mcp-client';
import type { AiGateway, AiMemoryStore, HttpGuard, StoredChatMessage } from '@olly/nodes';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { ExecutionEventSink } from '../executions/execution-events.service.js';
import { HTTP_GUARD } from '../node-types/node-types.module.js';

/** Limite mensal de tokens do projeto atingido (FR-015). */
export class TokenLimitExceededError extends Error {
  override name = 'TokenLimitExceededError';
}

/** Cache do uso mensal e dos preços (plan §7: 60 s). */
const CACHE_TTL_MS = 60_000;
/** Respostas dos provedores de modelo: limite do corpo lido pelo `fetch`. */
const MODEL_RESPONSE_MAX_BYTES = 50 * 1024 * 1024;

export interface AiExecutionContext {
  executionId: string;
  projectId: string;
  workflowId: string;
  /** Mascaramento do projeto (spec 009): passos gravados e transmitidos. */
  masker: Masker;
}

/** Início do mês corrente (UTC): base do limite mensal. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Serviços de IA das execuções (spec 011, plan §2–§7): allowlist de modelos (instalação ∩
 * projeto), limite mensal, uso e custo por chamada, passos mascarados e transmitidos, memória
 * persistente e temporária e o `fetch` com anti-SSRF para os provedores. Entregue ao motor como
 * `RunOptions.ai` (API e workers).
 */
@Injectable()
export class AiGatewayFactory {
  private readonly monthUsage = new Map<string, { tokens: number; at: number; month: number }>();
  private prices?: {
    at: number;
    byModel: Map<string, { input: number; output: number; currency: string }>;
  };
  readonly fetch: typeof fetch;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HTTP_GUARD) guard: HttpGuard,
    @Inject(ExecutionEventSink) private readonly events: ExecutionEventSink,
  ) {
    const guarded = ((url: string | URL, init: Parameters<GuardedFetch>[1]) =>
      guard.fetch(url, init)) as unknown as GuardedFetch;
    this.fetch = guardedFetchLike(guarded, MODEL_RESPONSE_MAX_BYTES) as typeof fetch;
  }

  /** Modelos permitidos na instalação: o cadastro da administração, lido a cada uso (FR-002). */
  async installationModels(): Promise<string[]> {
    const rows = await this.db.selectFrom('ai_models').select('model').orderBy('model').execute();
    return rows.map((r) => r.model);
  }

  /** Modelos permitidos no projeto: os da instalação, restritos pela lista do projeto. */
  async allowedModels(projectId: string): Promise<string[]> {
    const project = await this.db
      .selectFrom('projects')
      .select('allowed_models')
      .where('id', '=', projectId)
      .executeTakeFirst();
    const installation = await this.installationModels();
    const restricted = project?.allowed_models;
    return restricted ? installation.filter((m) => restricted.includes(m)) : installation;
  }

  /** Tokens do projeto no mês corrente (cache de 60 s, acrescido localmente a cada uso). */
  async monthTokens(projectId: string, now = new Date()): Promise<number> {
    const month = monthStart(now).getTime();
    const cached = this.monthUsage.get(projectId);
    if (cached && cached.month === month && Date.now() - cached.at < CACHE_TTL_MS)
      return cached.tokens;
    const row = await this.db
      .selectFrom('llm_usage')
      .select((eb) =>
        eb.fn
          .coalesce(
            eb.fn.sum<string>(eb('input_tokens', '+', eb.ref('output_tokens'))),
            eb.val('0'),
          )
          .as('tokens'),
      )
      .where('project_id', '=', projectId)
      .where('created_at', '>=', new Date(month))
      .executeTakeFirst();
    const tokens = Number(row?.tokens ?? 0);
    this.monthUsage.set(projectId, { tokens, at: Date.now(), month });
    return tokens;
  }

  private async price(model: string) {
    if (!this.prices || Date.now() - this.prices.at > CACHE_TTL_MS) {
      const rows = await this.db.selectFrom('llm_pricing').selectAll().execute();
      this.prices = {
        at: Date.now(),
        byModel: new Map(
          rows.map((r) => [
            r.model,
            {
              input: Number(r.input_per_1m),
              output: Number(r.output_per_1m),
              currency: r.currency,
            },
          ]),
        ),
      };
    }
    return this.prices.byModel.get(model);
  }

  /** Invalida o cache de preços (alteração pela administração). */
  invalidatePrices(): void {
    this.prices = undefined;
  }

  forExecution(ctx: AiExecutionContext): AiGateway {
    const executionMemories = new Map<string, StoredChatMessage[]>();
    const persistent = (sessionKey: string): AiMemoryStore => ({
      load: async (limit) => {
        const rows = await this.db
          .selectFrom('agent_memory')
          .select('message')
          .where('project_id', '=', ctx.projectId)
          .where('session_key', '=', sessionKey)
          .orderBy('id', 'desc')
          .limit(limit)
          .execute();
        return rows.reverse().map((r) => r.message as StoredChatMessage);
      },
      append: async (messages) => {
        if (messages.length === 0) return;
        await this.db
          .insertInto('agent_memory')
          .values(
            messages.map((message) => ({
              project_id: ctx.projectId,
              session_key: sessionKey,
              message: JSON.stringify(message),
            })),
          )
          .execute();
      },
    });

    return {
      checkModel: async ({ model }) => {
        const allowed = await this.allowedModels(ctx.projectId);
        if (allowed.length === 0) {
          throw new Error(
            'Nenhum modelo de IA está permitido: a administração cadastra os modelos em Administração › IA (e o projeto pode restringir a lista)',
          );
        }
        if (!allowed.includes(model)) {
          throw new Error(
            `O modelo "${model}" não está na lista permitida (instalação e projeto): ${allowed.join(', ')}`,
          );
        }
      },
      beforeModelCall: async () => {
        const project = await this.db
          .selectFrom('projects')
          .select('monthly_token_limit')
          .where('id', '=', ctx.projectId)
          .executeTakeFirst();
        const limit = project?.monthly_token_limit ? Number(project.monthly_token_limit) : null;
        if (limit === null) return;
        const used = await this.monthTokens(ctx.projectId);
        if (used >= limit) {
          throw new TokenLimitExceededError(
            `Limite mensal de tokens do projeto atingido (${used.toLocaleString('pt-BR')} de ${limit.toLocaleString('pt-BR')}): novas chamadas ao modelo estão bloqueadas até o próximo mês ou até a administração ajustar o limite`,
          );
        }
      },
      recordUsage: async (usage) => {
        // Spec 012, FR-002: tokens por modelo e direção.
        ollyMetrics.llmTokens(usage.model, usage.inputTokens, usage.outputTokens);
        const price = await this.price(usage.model);
        const cost = price
          ? (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000
          : null;
        await this.db
          .insertInto('llm_usage')
          .values({
            execution_id: ctx.executionId,
            project_id: ctx.projectId,
            workflow_id: ctx.workflowId,
            node_id: usage.nodeId,
            provider: usage.provider,
            model: usage.model,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            cost_estimate: cost,
            currency: price?.currency ?? null,
          })
          .execute();
        const cached = this.monthUsage.get(ctx.projectId);
        if (cached) cached.tokens += usage.inputTokens + usage.outputTokens;
      },
      recordStep: async (step) => {
        // VIII.2: o conteúdo do passo é mascarado antes de gravar e transmitir.
        const content = ctx.masker.mask(step.content).value;
        const row = await this.db
          .insertInto('agent_steps')
          .values({
            execution_id: ctx.executionId,
            project_id: ctx.projectId,
            node_id: step.nodeId,
            run_index: step.runIndex,
            item_index: step.itemIndex,
            step_index: step.stepIndex,
            kind: step.kind,
            tool_name: step.toolName ?? null,
            content: JSON.stringify(content ?? null),
            input_tokens: step.inputTokens ?? null,
            output_tokens: step.outputTokens ?? null,
          })
          .returning('created_at')
          .executeTakeFirstOrThrow();
        this.events.emit(
          'agentStep',
          {
            executionId: ctx.executionId,
            nodeId: step.nodeId,
            runIndex: step.runIndex,
            itemIndex: step.itemIndex,
            stepIndex: step.stepIndex,
            kind: step.kind,
            toolName: step.toolName ?? null,
            content,
            inputTokens: step.inputTokens ?? null,
            outputTokens: step.outputTokens ?? null,
            createdAt: row.created_at.toISOString(),
          },
          ctx.workflowId,
        );
      },
      persistentMemory: persistent,
      executionMemory: (nodeId, sessionKey) => {
        const key = `${nodeId}:${sessionKey}`;
        return {
          load: (limit) => Promise.resolve((executionMemories.get(key) ?? []).slice(-limit)),
          append: (messages) => {
            executionMemories.set(key, [...(executionMemories.get(key) ?? []), ...messages]);
            return Promise.resolve();
          },
        };
      },
      fetch: this.fetch,
      limits: {
        maxIterations: this.config.ai.maxIterations,
        toolResultMaxChars: this.config.ai.toolResultMaxChars,
      },
      allowFakeModel: this.config.env === 'test',
    };
  }
}
