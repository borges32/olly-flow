import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ChatController } from '../chat/chat.controller.js';
import { ChatService } from '../chat/chat.service.js';
import { ExecutionsModule } from '../executions/executions.module.js';
import { PublishApprovalsService } from './publish-approvals.service.js';
import { PublishRequestsController } from './publish-requests.controller.js';
import { PublishingService } from './publishing.service.js';
import { TestListeners } from './test-listeners.js';
import { WebhookGateway } from './webhook-gateway.js';
import { WebhookRegistry } from './webhook-registry.js';
import { WebhooksController } from './webhooks.controller.js';

/** Publicação, rotas e gateway de webhooks (spec 005) e o chat (spec 021). */
@Global()
@Module({
  imports: [ExecutionsModule, AuthModule],
  controllers: [WebhooksController, PublishRequestsController, ChatController],
  providers: [
    WebhookRegistry,
    PublishingService,
    PublishApprovalsService,
    WebhookGateway,
    ChatService,
    { provide: TestListeners, useFactory: () => new TestListeners() },
  ],
  exports: [WebhookRegistry, WebhookGateway],
})
export class WebhooksModule {}
