import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  ExecutionDetail,
  ExpressionPreviewResponse,
  TestRunResponse,
} from '@olly/shared-types';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import {
  previewSchema,
  testRunSchema,
  type PreviewBody,
  type TestRunBody,
} from './executions.schemas.js';
import { ExecutionsService } from './executions.service.js';

@ApiTags('execuções')
@ApiBearerAuth()
@Controller()
export class ExecutionsController {
  constructor(@Inject(ExecutionsService) private readonly executions: ExecutionsService) {}

  /** FR-011: execução de teste a partir do editor, inclusive sem salvar. */
  @RequirePermission('workflow:execute', { workflow: 'id' })
  @HttpCode(202)
  @Post('workflows/:id/test-run')
  testRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodPipe(testRunSchema)) body: TestRunBody,
  ): Promise<TestRunResponse> {
    return this.executions.startTestRun(user.id, id, body);
  }

  /** FR-014: execução e dados por nó. */
  @RequirePermission('execution:read', { execution: 'id' })
  @Get('executions/:id')
  get(@Param('id') id: string): Promise<ExecutionDetail> {
    return this.executions.get(id);
  }

  /** FR-018: pré-visualização de expressão sobre a última execução de teste. */
  @RequirePermission('workflow:execute', { workflow: 'id' })
  @HttpCode(200)
  @Post('workflows/:id/expressions/preview')
  preview(
    @Param('id') id: string,
    @Body(new ZodPipe(previewSchema)) body: PreviewBody,
  ): Promise<ExpressionPreviewResponse> {
    return this.executions.preview(id, body);
  }
}
