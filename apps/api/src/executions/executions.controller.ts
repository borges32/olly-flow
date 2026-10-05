import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  ExecutionDetail,
  ExecutionList,
  ExpressionPreviewResponse,
  TestRunResponse,
} from '@olly/shared-types';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import {
  listExecutionsQuerySchema,
  previewSchema,
  testRunSchema,
  type ListExecutionsQuery,
  type PreviewBody,
  type TestRunBody,
} from './executions.schemas.js';
import { ExecutionsService } from './executions.service.js';

@ApiTags('execuções')
@ApiBearerAuth()
@Controller()
export class ExecutionsController {
  constructor(@Inject(ExecutionsService) private readonly executions: ExecutionsService) {}

  /** FR-011 (spec 003): execução de teste a partir do editor, inclusive sem salvar. */
  @RequirePermission('workflow:execute', { workflow: 'id' })
  @HttpCode(202)
  @Post('workflows/:id/test-run')
  testRun(
    @Audit() audit: AuditContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodPipe(testRunSchema)) body: TestRunBody,
  ): Promise<TestRunResponse> {
    return this.executions.startTestRun(audit, user, id, body);
  }

  /** FR-013 (spec 005): execuções dos projetos em que o usuário tem `execution:read`. */
  @RequirePermission('execution:read', 'anyProject')
  @Get('executions')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodPipe(listExecutionsQuerySchema)) query: ListExecutionsQuery,
  ): Promise<ExecutionList> {
    return this.executions.list(user, query);
  }

  /** FR-014: execução e nós; os dados exigem `execution:readData`. */
  @RequirePermission('execution:read', { execution: 'id' })
  @Get('executions/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ExecutionDetail> {
    return this.executions.get(user, id);
  }

  /** FR-018 (spec 003): pré-visualização de expressão sobre a última execução de teste. */
  @RequirePermission('workflow:execute', { workflow: 'id' })
  @HttpCode(200)
  @Post('workflows/:id/expressions/preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodPipe(previewSchema)) body: PreviewBody,
  ): Promise<ExpressionPreviewResponse> {
    return this.executions.preview(user, id, body);
  }
}
