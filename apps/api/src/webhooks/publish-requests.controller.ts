import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { PublishApproval } from '@olly/shared-types';
import { z } from 'zod';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Authenticated } from '../auth/public.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { PublishApprovalsService, type ApprovalFilter } from './publish-approvals.service.js';

const listSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  workflowId: z.uuid().optional(),
});
const decisionSchema = z
  .object({ comment: z.string().trim().max(1000).optional() })
  .nullish()
  .transform((v) => v ?? {});

/** Pedidos de publicação (spec 009, FR-011). */
@ApiTags('publicação e webhooks')
@ApiBearerAuth()
@Controller()
export class PublishRequestsController {
  constructor(
    @Inject(PublishApprovalsService) private readonly approvals: PublishApprovalsService,
  ) {}

  /** Pedidos que o usuário pode decidir ou que abriu (contador do menu: `status=pending`). */
  @Authenticated()
  @Get('publish-requests')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodPipe(listSchema)) query: ApprovalFilter,
  ): Promise<PublishApproval[]> {
    return this.approvals.list(user, query);
  }

  @RequirePermission('workflow:publish', { publishRequest: 'id' })
  @HttpCode(200)
  @Post('publish-requests/:id/approve')
  approve(
    @Audit() audit: AuditContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodPipe(decisionSchema)) body: { comment?: string },
  ): Promise<PublishApproval> {
    return this.approvals.approve(audit, user, id, body.comment);
  }

  @RequirePermission('workflow:publish', { publishRequest: 'id' })
  @HttpCode(200)
  @Post('publish-requests/:id/reject')
  reject(
    @Audit() audit: AuditContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodPipe(decisionSchema)) body: { comment?: string },
  ): Promise<PublishApproval> {
    return this.approvals.reject(audit, user, id, body.comment);
  }

  @RequirePermission('workflow:publish', { publishRequest: 'id' })
  @HttpCode(200)
  @Post('publish-requests/:id/cancel')
  cancel(
    @Audit() audit: AuditContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PublishApproval> {
    return this.approvals.cancel(audit, user, id);
  }
}
