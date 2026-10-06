import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  Paginated,
  WorkflowDetail,
  WorkflowDiff,
  WorkflowSummary,
  WorkflowVersionDetail,
  WorkflowVersionSummary,
} from '@olly/shared-types';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentProjectId, CurrentUser } from '../auth/current-user.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { NotFoundError } from '../common/errors.js';
import {
  createWorkflowSchema,
  diffQuerySchema,
  listWorkflowsQuerySchema,
  restoreSchema,
  saveWorkflowSchema,
  type CreateWorkflowBody,
  type DiffQuery,
  type ListWorkflowsQuery,
  type RestoreBody,
  type SaveWorkflowBody,
} from './workflows.schemas.js';

const versionPipe = new ParseIntPipe({
  exceptionFactory: () => new NotFoundError('Versão não encontrada'),
});
import { WorkflowsService } from './workflows.service.js';

@ApiTags('workflows')
@ApiBearerAuth()
@Controller()
export class WorkflowsController {
  constructor(@Inject(WorkflowsService) private readonly workflows: WorkflowsService) {}

  @RequirePermission('workflow:create', { project: 'id' })
  @Post('projects/:id/workflows')
  create(
    @Audit() audit: AuditContext,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProjectId() projectId: string,
    @Body(new ZodPipe(createWorkflowSchema)) body: CreateWorkflowBody,
  ): Promise<WorkflowDetail> {
    return this.workflows.create(audit, user, projectId, body);
  }

  @RequirePermission('workflow:read', { project: 'id' })
  @Get('projects/:id/workflows')
  list(
    @CurrentProjectId() projectId: string,
    @Query(new ZodPipe(listWorkflowsQuerySchema)) query: ListWorkflowsQuery,
  ): Promise<Paginated<WorkflowSummary>> {
    return this.workflows.list(projectId, query);
  }

  @RequirePermission('workflow:read', { workflow: 'id' })
  @Get('workflows/:id')
  get(@Param('id') id: string): Promise<WorkflowDetail> {
    return this.workflows.get(id);
  }

  @RequirePermission('workflow:update', { workflow: 'id' })
  @Put('workflows/:id')
  save(
    @Audit() audit: AuditContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodPipe(saveWorkflowSchema)) body: SaveWorkflowBody,
  ): Promise<WorkflowDetail> {
    return this.workflows.save(audit, user, id, body);
  }

  @RequirePermission('workflow:delete', { workflow: 'id' })
  @HttpCode(204)
  @Delete('workflows/:id')
  async delete(@Audit() audit: AuditContext, @Param('id') id: string): Promise<void> {
    await this.workflows.delete(audit, id);
  }

  @RequirePermission('workflow:read', { workflow: 'id' })
  @Get('workflows/:id/versions')
  versions(@Param('id') id: string): Promise<WorkflowVersionSummary[]> {
    return this.workflows.versions(id);
  }

  /** Spec 009, FR-008: uma versão completa (para exibir e comparar). */
  @RequirePermission('workflow:read', { workflow: 'id' })
  @Get('workflows/:id/versions/:version')
  version(
    @Param('id') id: string,
    @Param('version', versionPipe) version: number,
  ): Promise<WorkflowVersionDetail> {
    return this.workflows.version(id, version);
  }

  /** Spec 009, FR-008/FR-010: diff estruturado entre duas versões. */
  @RequirePermission('workflow:read', { workflow: 'id' })
  @Get('workflows/:id/diff')
  diff(
    @Param('id') id: string,
    @Query(new ZodPipe(diffQuerySchema)) query: DiffQuery,
  ): Promise<WorkflowDiff> {
    return this.workflows.diff(id, query.from, query.to);
  }

  /** Spec 009, FR-008: restaura uma versão como nova versão. */
  @RequirePermission('workflow:update', { workflow: 'id' })
  @HttpCode(200)
  @Post('workflows/:id/versions/:version/restore')
  restore(
    @Audit() audit: AuditContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('version', versionPipe) version: number,
    @Body(new ZodPipe(restoreSchema)) body: RestoreBody,
  ): Promise<WorkflowDetail> {
    return this.workflows.restore(audit, user, id, version, body.message);
  }
}
