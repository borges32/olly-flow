import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  AgentApproval,
  AgentStep,
  AiModel,
  AiPricing,
  AiUsageRow,
  ApprovalStatus,
  ExecutionAiUsage,
  ProjectAiSettings,
  ProjectAiUsage,
} from '@olly/shared-types';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Authenticated } from '../auth/public.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { hasProjectPermission } from '../rbac/ability.factory.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { ResourceResolver } from '../rbac/resource-resolver.js';
import { AiService } from './ai.service.js';
import {
  aiModelNameSchema,
  aiModelSchema,
  aiPricingSchema,
  aiSettingsSchema,
  approvalDecisionSchema,
  approvalsQuerySchema,
  usageQuerySchema,
  type AiModelBody,
  type AiPricingBody,
  type AiSettingsBody,
} from './ai.schemas.js';
import { ApprovalsService } from './approvals.service.js';

/** Período padrão: o mês corrente até agora. */
function period(query: { from?: string; to?: string }): { from: Date; to: Date } {
  const now = new Date();
  return {
    from: query.from
      ? new Date(query.from)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: query.to ? new Date(query.to) : new Date(now.getTime() + 1000),
  };
}

/** Passos, uso e custo, preços e configuração de IA (spec 011, FR-006, FR-014, FR-015). */
@ApiTags('IA')
@ApiBearerAuth()
@Controller()
export class AiController {
  constructor(
    @Inject(AiService) private readonly ai: AiService,
    @Inject(ResourceResolver) private readonly resources: ResourceResolver,
  ) {}

  /** FR-006: passos do agente; o conteúdo (mascarado) exige `execution:readData`. */
  @RequirePermission('execution:read', { execution: 'id' })
  @Get('executions/:id/agent-steps')
  async steps(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AgentStep[]> {
    const projectId = await this.resources.projectIdFor('execution', id);
    return this.ai.steps(
      id,
      projectId !== null && hasProjectPermission(user, 'execution:readData', projectId),
    );
  }

  /** FR-014: tokens e custo da execução. */
  @RequirePermission('execution:read', { execution: 'id' })
  @Get('executions/:id/ai-usage')
  executionUsage(@Param('id') id: string): Promise<ExecutionAiUsage> {
    return this.ai.executionUsage(id);
  }

  /** FR-014/FR-015: uso do projeto por workflow e o consumo do mês. */
  @RequirePermission('project:manage', { project: 'id' })
  @Get('projects/:id/ai-usage')
  projectUsage(
    @Param('id') id: string,
    @Query(new ZodPipe(usageQuerySchema)) query: { from?: string; to?: string },
  ): Promise<ProjectAiUsage> {
    const { from, to } = period(query);
    return this.ai.projectUsage(id, from, to);
  }

  /** FR-014: uso por projeto (administração da plataforma). */
  @RequirePermission('project:manage', 'global')
  @Get('ai-usage')
  globalUsage(
    @Query(new ZodPipe(usageQuerySchema)) query: { from?: string; to?: string },
  ): Promise<AiUsageRow[]> {
    const { from, to } = period(query);
    return this.ai.globalUsage(from, to);
  }

  @RequirePermission('project:manage', 'global')
  @Get('ai-pricing')
  pricing(): Promise<AiPricing[]> {
    return this.ai.pricing();
  }

  /** FR-014: preços editáveis pela administração. */
  @RequirePermission('project:manage', 'global')
  @Put('ai-pricing/:model')
  upsertPricing(
    @Audit() audit: AuditContext,
    @Param('model') model: string,
    @Body(new ZodPipe(aiPricingSchema)) body: AiPricingBody,
  ): Promise<AiPricing[]> {
    return this.ai.upsertPricing(audit, model, body);
  }

  @RequirePermission('project:manage', 'global')
  @HttpCode(204)
  @Delete('ai-pricing/:model')
  async deletePricing(@Audit() audit: AuditContext, @Param('model') model: string): Promise<void> {
    await this.ai.deletePricing(audit, model);
  }

  /** FR-002: modelos permitidos na instalação (cadastro, efeito imediato). */
  @RequirePermission('project:manage', 'global')
  @Get('ai-models')
  installationModels(): Promise<AiModel[]> {
    return this.ai.models();
  }

  @RequirePermission('project:manage', 'global')
  @Put('ai-models/:model')
  allowModel(
    @Audit() audit: AuditContext,
    @Param('model', new ZodPipe(aiModelNameSchema)) model: string,
    @Body(new ZodPipe(aiModelSchema)) body: AiModelBody,
  ): Promise<AiModel[]> {
    return this.ai.allowModel(audit, model, body);
  }

  @RequirePermission('project:manage', 'global')
  @HttpCode(204)
  @Delete('ai-models/:model')
  async removeModel(
    @Audit() audit: AuditContext,
    @Param('model', new ZodPipe(aiModelNameSchema)) model: string,
  ): Promise<void> {
    await this.ai.removeModel(audit, model);
  }

  @RequirePermission('workflow:read', { project: 'id' })
  @Get('projects/:id/ai-settings')
  settings(@Param('id') id: string): Promise<ProjectAiSettings> {
    return this.ai.settings(id);
  }

  /** FR-002/FR-015: modelos e limite mensal do projeto (administração da plataforma). */
  @RequirePermission('project:manage', 'global')
  @Put('projects/:id/ai-settings')
  updateSettings(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Body(new ZodPipe(aiSettingsSchema)) body: AiSettingsBody,
  ): Promise<ProjectAiSettings> {
    return this.ai.updateSettings(audit, id, body);
  }

  /** Modelos permitidos no projeto (lista do nó Modelo de chat). */
  @RequirePermission('credential:use', { project: 'id' })
  @Get('projects/:id/ai-models')
  models(@Param('id') id: string): Promise<string[]> {
    return this.ai.allowedModels(id);
  }
}

/** Aprovação humana de ações destrutivas (spec 011, FR-011). */
@ApiTags('IA')
@ApiBearerAuth()
@Controller()
export class ApprovalsController {
  constructor(@Inject(ApprovalsService) private readonly approvals: ApprovalsService) {}

  /** Pedidos dos projetos em que o usuário pode executar. */
  @Authenticated()
  @Get('approvals')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodPipe(approvalsQuerySchema))
    query: { status?: ApprovalStatus; executionId?: string },
  ): Promise<AgentApproval[]> {
    return this.approvals.list(user, query);
  }

  @RequirePermission('workflow:execute', { approval: 'approvalId' })
  @HttpCode(200)
  @Post('approvals/:approvalId/approve')
  approve(
    @Audit() audit: AuditContext,
    @Param('approvalId') approvalId: string,
    @Body(new ZodPipe(approvalDecisionSchema)) body: { comment?: string },
  ): Promise<AgentApproval> {
    return this.approvals.decide(audit, approvalId, true, body.comment ?? null);
  }

  @RequirePermission('workflow:execute', { approval: 'approvalId' })
  @HttpCode(200)
  @Post('approvals/:approvalId/reject')
  reject(
    @Audit() audit: AuditContext,
    @Param('approvalId') approvalId: string,
    @Body(new ZodPipe(approvalDecisionSchema)) body: { comment?: string },
  ): Promise<AgentApproval> {
    return this.approvals.decide(audit, approvalId, false, body.comment ?? null);
  }
}
