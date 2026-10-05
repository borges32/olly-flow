import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ExecutionDispatcher, InProcessDispatcher } from './dispatcher.js';
import { ExecutionEventsService } from './execution-events.service.js';
import { ExecutionRunner } from './execution-runner.js';
import { ExecutionsController } from './executions.controller.js';
import { ExecutionsGateway } from './executions.gateway.js';
import { ExecutionsService } from './executions.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ExecutionsController],
  providers: [
    ExecutionsService,
    ExecutionEventsService,
    ExecutionsGateway,
    ExecutionRunner,
    InProcessDispatcher,
    // Spec 005, FR-003: a spec 006 troca esta implementação por uma fila com workers.
    { provide: ExecutionDispatcher, useExisting: InProcessDispatcher },
  ],
  exports: [ExecutionsService, ExecutionDispatcher, ExecutionEventsService],
})
export class ExecutionsModule {}
