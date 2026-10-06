import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import type {
  AgentStep,
  AiModel,
  AiPricing,
  AiUsageRow,
  AiUsageTotals,
  ExecutionAiUsage,
  ProjectAiSettings,
  ProjectAiUsage,
} from '@olly/shared-types';
import { sql } from 'kysely';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { NotFoundError, UnprocessableError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { AiGatewayFactory, monthStart } from './ai-gateway.service.js';
import type { AiModelBody, AiPricingBody, AiSettingsBody } from './ai.schemas.js';

interface UsageAggregate {
  input: string | number | null;
  output: string | number | null;
  calls: string | number | null;
  cost: string | number | null;
  priced: string | number | null;
  currency: string | null;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/** Totais: custo `null` quando alguma chamada não tinha preço cadastrado. */
function totals(row: UsageAggregate | undefined): AiUsageTotals {
  const calls = num(row?.calls);
  const priced = num(row?.priced);
  return {
    inputTokens: num(row?.input),
    outputTokens: num(row?.output),
    calls,
    cost:
      calls > 0 && priced === calls
        ? Math.round(num(row?.cost) * 1e6) / 1e6
        : calls === 0
          ? 0
          : null,
    currency: row?.currency ?? null,
  };
}

/**
 * Consultas de IA (spec 011): passos do agente (FR-006), uso e custo por execução, workflow e
 * projeto (FR-014), tabela de preços e configuração de IA do projeto (FR-002, FR-015).
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AiGatewayFactory) private readonly gateways: AiGatewayFactory,
  ) {}

  private usageColumns() {
    return [
      sql<string>`coalesce(sum(input_tokens), 0)`.as('input'),
      sql<string>`coalesce(sum(output_tokens), 0)`.as('output'),
      sql<string>`count(*)`.as('calls'),
      sql<string>`coalesce(sum(cost_estimate), 0)`.as('cost'),
      sql<string>`count(cost_estimate)`.as('priced'),
      sql<string | null>`max(currency)`.as('currency'),
    ] as const;
  }

  /** FR-006: passos do agente na execução; o conteúdo (mascarado) exige `execution:readData`. */
  async steps(executionId: string, canReadData: boolean): Promise<AgentStep[]> {
    const rows = await this.db
      .selectFrom('agent_steps')
      .selectAll()
      .where('execution_id', '=', executionId)
      .orderBy('created_at')
      .orderBy('step_index')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      executionId: r.execution_id,
      nodeId: r.node_id,
      runIndex: r.run_index,
      itemIndex: r.item_index,
      stepIndex: r.step_index,
      kind: r.kind,
      toolName: r.tool_name,
      ...(canReadData && { content: r.content }),
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** FR-014: tokens e custo da execução, por modelo. */
  async executionUsage(executionId: string): Promise<ExecutionAiUsage> {
    const byModel = await this.db
      .selectFrom('llm_usage')
      .select(['model', 'provider', ...this.usageColumns()])
      .where('execution_id', '=', executionId)
      .groupBy(['model', 'provider'])
      .orderBy('model')
      .execute();
    const total = await this.db
      .selectFrom('llm_usage')
      .select([...this.usageColumns()])
      .where('execution_id', '=', executionId)
      .executeTakeFirst();
    return {
      ...totals(total),
      byModel: byModel.map((r) => ({ model: r.model, provider: r.provider, ...totals(r) })),
    };
  }

  /** FR-014/FR-015: uso do projeto no período, por workflow, e o consumo do mês. */
  async projectUsage(projectId: string, from: Date, to: Date): Promise<ProjectAiUsage> {
    const project = await this.db
      .selectFrom('projects')
      .select('monthly_token_limit')
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!project) throw new NotFoundError('Projeto não encontrado');
    const byWorkflow = await this.db
      .selectFrom('llm_usage as u')
      .innerJoin('workflows as w', 'w.id', 'u.workflow_id')
      .select(['w.id as id', 'w.name as name', ...this.usageColumns()])
      .where('u.project_id', '=', projectId)
      .where('u.created_at', '>=', from)
      .where('u.created_at', '<', to)
      .groupBy(['w.id', 'w.name'])
      .orderBy('w.name')
      .execute();
    const total = await this.db
      .selectFrom('llm_usage')
      .select([...this.usageColumns()])
      .where('project_id', '=', projectId)
      .where('created_at', '>=', from)
      .where('created_at', '<', to)
      .executeTakeFirst();
    const month = await this.db
      .selectFrom('llm_usage')
      .select(sql<string>`coalesce(sum(input_tokens + output_tokens), 0)`.as('tokens'))
      .where('project_id', '=', projectId)
      .where('created_at', '>=', monthStart())
      .executeTakeFirst();
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      total: totals(total),
      monthTokens: num(month?.tokens),
      monthlyTokenLimit: project.monthly_token_limit ? Number(project.monthly_token_limit) : null,
      byWorkflow: byWorkflow.map((r): AiUsageRow => ({ id: r.id, name: r.name, ...totals(r) })),
    };
  }

  /** FR-014: uso por projeto (administração da plataforma). */
  async globalUsage(from: Date, to: Date): Promise<AiUsageRow[]> {
    const rows = await this.db
      .selectFrom('llm_usage as u')
      .innerJoin('projects as p', 'p.id', 'u.project_id')
      .select(['p.id as id', 'p.name as name', ...this.usageColumns()])
      .where('u.created_at', '>=', from)
      .where('u.created_at', '<', to)
      .groupBy(['p.id', 'p.name'])
      .orderBy('p.name')
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, ...totals(r) }));
  }

  async pricing(): Promise<AiPricing[]> {
    const rows = await this.db
      .selectFrom('llm_pricing')
      .selectAll()
      .orderBy('provider')
      .orderBy('model')
      .execute();
    return rows.map((r) => ({
      model: r.model,
      provider: r.provider,
      inputPer1m: Number(r.input_per_1m),
      outputPer1m: Number(r.output_per_1m),
      currency: r.currency,
      note: r.note,
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async upsertPricing(ctx: AuditContext, model: string, body: AiPricingBody): Promise<AiPricing[]> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('llm_pricing')
        .values({
          model,
          provider: body.provider,
          input_per_1m: body.inputPer1m,
          output_per_1m: body.outputPer1m,
          currency: body.currency ?? 'USD',
          note: body.note ?? null,
          updated_by: ctx.userId,
        })
        .onConflict((oc) =>
          oc.column('model').doUpdateSet({
            provider: body.provider,
            input_per_1m: body.inputPer1m,
            output_per_1m: body.outputPer1m,
            currency: body.currency ?? 'USD',
            note: body.note ?? null,
            updated_by: ctx.userId,
            updated_at: new Date(),
          }),
        )
        .execute();
      await this.audit.record(trx, ctx, {
        action: 'ai.pricing_update',
        entityType: 'llm_pricing',
        entityId: model,
        details: { ...body },
      });
    });
    this.gateways.invalidatePrices();
    return this.pricing();
  }

  async deletePricing(ctx: AuditContext, model: string): Promise<void> {
    const deleted = await this.db
      .deleteFrom('llm_pricing')
      .where('model', '=', model)
      .executeTakeFirst();
    if (deleted.numDeletedRows === 0n) throw new NotFoundError('Preço não encontrado');
    await this.audit.record(this.db, ctx, {
      action: 'ai.pricing_delete',
      entityType: 'llm_pricing',
      entityId: model,
    });
    this.gateways.invalidatePrices();
  }

  async settings(projectId: string): Promise<ProjectAiSettings> {
    const row = await this.db
      .selectFrom('projects')
      .select(['allowed_models', 'monthly_token_limit'])
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Projeto não encontrado');
    return {
      allowedModels: row.allowed_models,
      monthlyTokenLimit: row.monthly_token_limit ? Number(row.monthly_token_limit) : null,
      installationModels: await this.gateways.installationModels(),
    };
  }

  /** FR-002/FR-015: modelos do projeto (dentro dos da instalação) e limite mensal. */
  async updateSettings(
    ctx: AuditContext,
    projectId: string,
    body: AiSettingsBody,
  ): Promise<ProjectAiSettings> {
    const installation = new Set(await this.gateways.installationModels());
    const outside = (body.allowedModels ?? []).filter((m) => !installation.has(m));
    if (outside.length > 0) {
      throw new UnprocessableError(
        `Modelos fora da lista da instalação (Administração › IA): ${outside.join(', ')}`,
      );
    }
    await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('projects')
        .set({
          allowed_models: body.allowedModels,
          monthly_token_limit: body.monthlyTokenLimit,
        })
        .where('id', '=', projectId)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) throw new NotFoundError('Projeto não encontrado');
      await this.audit.record(trx, ctx, {
        action: 'project.ai_settings',
        entityType: 'project',
        entityId: projectId,
        details: { ...body },
      });
    });
    return this.settings(projectId);
  }

  /** FR-002: modelos permitidos na instalação (cadastro da administração). */
  async models(): Promise<AiModel[]> {
    const rows = await this.db
      .selectFrom('ai_models as m')
      .leftJoin('users as u', 'u.id', 'm.created_by')
      .select(['m.model', 'm.note', 'm.created_by', 'm.created_at', 'u.name as created_by_name'])
      .orderBy('m.model')
      .execute();
    return rows.map((r) => ({
      model: r.model,
      note: r.note,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** FR-002: inclui (ou atualiza a observação de) um modelo; vale na próxima chamada. */
  async allowModel(ctx: AuditContext, model: string, body: AiModelBody): Promise<AiModel[]> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('ai_models')
        .values({ model, note: body.note ?? null, created_by: ctx.userId })
        .onConflict((oc) => oc.column('model').doUpdateSet({ note: body.note ?? null }))
        .execute();
      await this.audit.record(trx, ctx, {
        action: 'ai.model_allow',
        entityType: 'ai_model',
        entityId: model,
        ...(body.note && { details: { note: body.note } }),
      });
    });
    return this.models();
  }

  /** FR-002: remove o modelo da instalação; as listas dos projetos deixam de enxergá-lo. */
  async removeModel(ctx: AuditContext, model: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const deleted = await trx
        .deleteFrom('ai_models')
        .where('model', '=', model)
        .executeTakeFirst();
      if (deleted.numDeletedRows === 0n) throw new NotFoundError('Modelo não cadastrado');
      await this.audit.record(trx, ctx, {
        action: 'ai.model_remove',
        entityType: 'ai_model',
        entityId: model,
      });
    });
  }

  /** Modelos que os workflows do projeto podem usar (lista do nó Modelo de chat). */
  allowedModels(projectId: string): Promise<string[]> {
    return this.gateways.allowedModels(projectId);
  }
}
