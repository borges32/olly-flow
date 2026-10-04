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
  Paginated,
  WorkflowDetail,
  WorkflowSummary,
  WorkflowVersionSummary,
} from '@olly/shared-types';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentProjectId, CurrentUser } from '../auth/current-user.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import {
  createWorkflowSchema,
  listWorkflowsQuerySchema,
  saveWorkflowSchema,
  type CreateWorkflowBody,
  type ListWorkflowsQuery,
  type SaveWorkflowBody,
} from './workflows.schemas.js';
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
}
