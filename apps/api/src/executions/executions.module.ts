import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { McpRuntimeModule } from '../mcp/mcp.module.js';
import { QueueDispatcher } from '../queue/queue-dispatcher.js';
import { RoutingDispatcher } from '../queue/routing-dispatcher.js';
import { WorkerLostSweeper } from '../queue/worker-lost-sweeper.js';
import { ExecutionDispatcher, InProcessDispatcher } from './dispatcher.js';
import { ErrorWorkflowTrigger } from './error-workflow.js';
import { ExecutionEventRelay } from './event-relay.js';
import { ExecutionEventSink, ExecutionEventsService } from './execution-events.service.js';
import { ExecutionRunner } from './execution-runner.js';
import { ExecutionsController } from './executions.controller.js';
import { ExecutionsGateway } from './executions.gateway.js';
import { ExecutionsService } from './executions.service.js';
import { SUBWORKFLOW_QUEUE, SubWorkflowService } from './sub-workflows.js';
import { ExecutionWaits } from './waits.service.js';
import { AI_RUNTIME_PROVIDERS } from '../ai/ai-runtime.js';

@Module({
  imports: [AuthModule, McpRuntimeModule],
  controllers: [ExecutionsController],
  providers: [
    ExecutionsService,
    ExecutionEventsService,
    { provide: ExecutionEventSink, useExisting: ExecutionEventsService },
    ExecutionEventRelay,
    ExecutionsGateway,
    ExecutionRunner,
    // Spec 008: esperas (estado e retomada) e sub-workflows.
    ExecutionWaits,
    SubWorkflowService,
    { provide: SUBWORKFLOW_QUEUE, useExisting: QueueDispatcher },
    // Spec 011: gateway de IA e pedidos de aprovação.
    ...AI_RUNTIME_PROVIDERS,
    InProcessDispatcher,
    // Spec 006: produção pela fila (workers); teste pela fila ou em processo.
    QueueDispatcher,
    { provide: ExecutionDispatcher, useClass: RoutingDispatcher },
    WorkerLostSweeper,
    ErrorWorkflowTrigger,
  ],
  exports: [
    ExecutionsService,
    ExecutionDispatcher,
    ExecutionEventsService,
    ExecutionEventSink,
    ExecutionWaits,
    ...AI_RUNTIME_PROVIDERS,
  ],
})
export class ExecutionsModule {}
