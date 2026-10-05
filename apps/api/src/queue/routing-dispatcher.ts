import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionCancelledError } from '@olly/engine';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { ExecutionDispatcher, InProcessDispatcher } from '../executions/dispatcher.js';
import type { ExecutionJob, WaitResult } from '../executions/execution-job.js';
import { QueueDispatcher } from './queue-dispatcher.js';

/**
 * Despacho por modo (spec 006, plan §1): produção sempre pela fila; teste pela fila (padrão) ou
 * no processo da API com `OLLY_TEST_RUN_MODE=inprocess`.
 */
@Injectable()
export class RoutingDispatcher extends ExecutionDispatcher {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(InProcessDispatcher) private readonly inProcess: InProcessDispatcher,
    @Inject(QueueDispatcher) private readonly queue: QueueDispatcher,
  ) {
    super();
  }

  private forMode(mode: ExecutionJob['mode']): ExecutionDispatcher {
    return mode === 'test' && this.config.queue.testRunMode === 'inprocess'
      ? this.inProcess
      : this.queue;
  }

  private forExecution(executionId: string): ExecutionDispatcher {
    return this.inProcess.owns(executionId) ? this.inProcess : this.queue;
  }

  initialStatus(mode: ExecutionJob['mode']): 'queued' | 'running' {
    return this.forMode(mode).initialStatus(mode);
  }

  dispatch(job: ExecutionJob): Promise<void> {
    return this.forMode(job.mode).dispatch(job);
  }

  waitForResult(
    executionId: string,
    timeoutMs: number,
    untilResponse?: boolean,
  ): Promise<WaitResult> {
    return this.forExecution(executionId).waitForResult(executionId, timeoutMs, untilResponse);
  }

  cancel(executionId: string, reason: ExecutionCancelledError): Promise<boolean> {
    return this.forExecution(executionId).cancel(executionId, reason);
  }
}
