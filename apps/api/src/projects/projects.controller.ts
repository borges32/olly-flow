import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  ProjectMember,
  ProjectQuotaRequest,
  ProjectSummary,
  RoleName,
  UserSummary,
} from '@olly/shared-types';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Authenticated } from '../auth/public.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { NotFoundError } from '../common/errors.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission, RequireProjectMember } from '../rbac/require-permission.decorator.js';
import {
  memberBodySchema,
  projectBodySchema,
  quotaBodySchema,
  userSearchQuerySchema,
} from './projects.schemas.js';
import { ProjectsService } from './projects.service.js';

const userIdPipe = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundError('Usuário não encontrado'),
});

@ApiTags('projetos')
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Authenticated()
  @Get('projects')
  list(@CurrentUser() user: AuthenticatedUser): Promise<ProjectSummary[]> {
    return this.projects.list(user);
  }

  @RequirePermission('project:manage', 'global')
  @Post('projects')
  create(
    @Audit() audit: AuditContext,
    @Body(new ZodPipe(projectBodySchema)) body: { name: string },
  ): Promise<ProjectSummary> {
    return this.projects.create(audit, body.name);
  }

  @RequireProjectMember('id')
  @Get('projects/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ProjectSummary> {
    return this.projects.get(user, id);
  }

  @RequirePermission('project:manage', { project: 'id' })
  @HttpCode(204)
  @Put('projects/:id')
  async rename(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Body(new ZodPipe(projectBodySchema)) body: { name: string },
  ): Promise<void> {
    await this.projects.rename(audit, id, body.name);
  }

  /**
   * Spec 006, FR-012: cota de execuções simultâneas do projeto. Só a administração da
   * plataforma (o limite protege a capacidade compartilhada).
   */
  @RequirePermission('project:manage', 'global')
  @HttpCode(204)
  @Put('projects/:id/quota')
  async setQuota(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Body(new ZodPipe(quotaBodySchema)) body: ProjectQuotaRequest,
  ): Promise<void> {
    await this.projects.setQuota(audit, id, body.maxConcurrentExecutions);
  }

  @RequirePermission('project:manage', { project: 'id' })
  @HttpCode(204)
  @Delete('projects/:id')
  async delete(@Audit() audit: AuditContext, @Param('id') id: string): Promise<void> {
    await this.projects.delete(audit, id);
  }

  @RequirePermission('project:manage', { project: 'id' })
  @Get('projects/:id/members')
  members(@Param('id') id: string): Promise<ProjectMember[]> {
    return this.projects.members(id);
  }

  @RequirePermission('project:manage', { project: 'id' })
  @Put('projects/:id/members/:userId')
  setMember(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodPipe(memberBodySchema)) body: { role: RoleName },
  ): Promise<ProjectMember> {
    return this.projects.setMember(audit, id, userId, body.role);
  }

  @RequirePermission('project:manage', { project: 'id' })
  @HttpCode(204)
  @Delete('projects/:id/members/:userId')
  async removeMember(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Param('userId', userIdPipe) userId: string,
  ): Promise<void> {
    await this.projects.removeMember(audit, id, userId);
  }

  /** Busca de usuários para adicionar membros. */
  @RequirePermission(['user:manage', 'project:manage'], 'anyProject')
  @Get('users')
  searchUsers(
    @Query(new ZodPipe(userSearchQuerySchema)) query: { search?: string },
  ): Promise<UserSummary[]> {
    return this.projects.searchUsers(query.search);
  }
}
