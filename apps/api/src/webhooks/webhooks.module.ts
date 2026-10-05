import { Global, Module } from '@nestjs/common';
import { ExecutionsModule } from '../executions/executions.module.js';
import { PublishingService } from './publishing.service.js';
import { TestListeners } from './test-listeners.js';
import { WebhookGateway } from './webhook-gateway.js';
import { WebhookRegistry } from './webhook-registry.js';
import { WebhooksController } from './webhooks.controller.js';

/** Publicação, rotas e gateway de webhooks (spec 005). */
@Global()
@Module({
  imports: [ExecutionsModule],
  controllers: [WebhooksController],
  providers: [
    WebhookRegistry,
    PublishingService,
    WebhookGateway,
    { provide: TestListeners, useFactory: () => new TestListeners() },
  ],
  exports: [WebhookRegistry, WebhookGateway],
})
export class WebhooksModule {}
