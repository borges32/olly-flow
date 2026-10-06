import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ExecutionsModule } from '../executions/executions.module.js';
import { AiController, ApprovalsController } from './ai.controller.js';
import { AiService } from './ai.service.js';

/** Rotas de IA e de aprovações (API). */
@Module({
  imports: [AuditModule, AuthModule, ExecutionsModule],
  controllers: [AiController, ApprovalsController],
  providers: [AiService],
})
export class AiModule {}
