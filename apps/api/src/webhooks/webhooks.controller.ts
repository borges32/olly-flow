import { Body, Controller, Delete, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ListenTestWebhookResponse, PublishResponse } from '@olly/shared-types';
import type { AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentProjectId, CurrentUser } from '../auth/current-user.decorator.js';
import { Audit } from '../common/audit-context.decorator.js';
import { UnprocessableError } from '../common/errors.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { ExecutionsService } from '../executions/executions.service.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import {
  PublishingService,
  methodOf,
  pathOf,
  webhookIssues,
  webhookNodes,
} from './publishing.service.js';
import { TestListeners } from './test-listeners.js';
import {
  listenSchema,
  publishSchema,
  type ListenBody,
  type PublishBody,
} from './webhooks.schemas.js';

@ApiTags('publicação e webhooks')
@ApiBearerAuth()
@Controller()
export class WebhooksController {
  constructor(
    @Inject(PublishingService) private readonly publishing: PublishingService,
    @Inject(TestListeners) private readonly listeners: TestListeners,
    @Inject(ExecutionsService) private readonly executions: ExecutionsService,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
  ) {}

  /** FR-001/FR-002: publica uma versão (padrão: a última salva) e ativa as rotas de webhook. */
  @RequirePermission('workflow:publish', { workflow: 'id' })
  @HttpCode(200)
  @Post('workflows/:id/publish')
  publish(
    @Audit() audit: AuditContext,
    @Param('id') id: string,
    @Body(new ZodPipe(publishSchema)) body: PublishBody,
  ): Promise<PublishResponse> {
    return this.publishing.publish(audit, id, body.version);
  }

  @RequirePermission('workflow:publish', { workflow: 'id' })
  @HttpCode(200)
  @Post('workflows/:id/unpublish')
  unpublish(@Audit() audit: AuditContext, @Param('id') id: string): Promise<PublishResponse> {
    return this.publishing.unpublish(audit, id);
  }

  /** FR-007: escuta por 2 min uma chamada em `/webhook-test/<path>` com a definição do editor. */
  @RequirePermission('workflow:execute', { workflow: 'id' })
  @HttpCode(200)
  @Post('workflows/:id/listen-test-webhook')
  async listen(
    @Audit() audit: AuditContext,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProjectId() projectId: string,
    @Param('id') id: string,
    @Body(new ZodPipe(listenSchema)) body: ListenBody,
  ): Promise<ListenTestWebhookResponse> {
    this.executions.validate(body.definition);
    const destination = body.destinationNodeId;
    const nodes = webhookNodes(body.definition).filter((n) => !destination || n.id === destination);
    if (nodes.length === 0) {
      throw new UnprocessableError(
        destination
          ? 'O nó indicado não é um webhook do workflow'
          : 'O workflow não tem nó de webhook',
      );
    }
    // No teste vale o mesmo que na produção, menos a exigência de autenticação. Parando no
    // Webhook (HU-2.1), o nó de resposta ainda não é necessário.
    const issues = await webhookIssues(body.definition, projectId, this.credentials, false);
    const errors = issues.errors.filter(
      (e) => !(destination && e.code === 'WEBHOOK_NO_RESPONSE_NODE'),
    );
    if (errors.length > 0) {
      throw new UnprocessableError('O webhook não pode escutar', {
        issues: errors.map((e) => ({ code: e.code, message: e.message, nodeIds: e.nodeIds })),
      });
    }
    const webhooks = nodes.map((node) => ({
      nodeId: node.id,
      method: methodOf(node),
      path: pathOf(node),
    }));
    const expiresAt = this.listeners.listen(
      nodes.map((node) => ({
        method: methodOf(node),
        path: pathOf(node),
        workflowId: id,
        projectId,
        definition: body.definition,
        node,
        stopAtNode: destination === node.id,
        user,
        audit,
      })),
    );
    return { webhooks, expiresAt: new Date(expiresAt).toISOString() };
  }

  @RequirePermission('workflow:execute', { workflow: 'id' })
  @HttpCode(204)
  @Delete('workflows/:id/listen-test-webhook')
  stopListening(@Param('id') id: string): void {
    this.listeners.stop(id);
  }
}
