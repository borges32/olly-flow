import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ExecutionEventsService } from './execution-events.service.js';
import { ExecutionsController } from './executions.controller.js';
import { ExecutionsGateway } from './executions.gateway.js';
import { ExecutionsService } from './executions.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ExecutionsController],
  providers: [ExecutionsService, ExecutionEventsService, ExecutionsGateway],
})
export class ExecutionsModule {}
