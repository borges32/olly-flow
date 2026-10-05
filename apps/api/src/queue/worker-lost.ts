import type { Logger } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { WorkflowDefinition } from '@olly/shared-types';
import type { ExecutionEventSink } from '../executions/execution-events.service.js';
import type { ErrorWorkflowTrigger } from '../executions/error-workflow.js';
import type { ExecutionError } from '../executions/execution-job.js';
import type { ResultPublisher } from '../executions/result-bus.js';
import { WORKER_LOST_MESSAGE } from './constants.js';
import type { ProjectQuota } from './quota.js';

export interface WorkerLostDeps {
  db: Db;
  events: ExecutionEventSink;
  results: ResultPublisher;
  quota: ProjectQuota;
  logger: Logger;
  /** Aciona o workflow de erro das execuções de produção perdidas (spec 007, FR-014). */
  errorWorkflows?: ErrorWorkflowTrigger;
}

/**
 * Encerra como `error`/`worker_lost` (spec 006, FR-005) as execuções ainda `running` que
 * satisfazem o filtro: sem batimento desde `staleBefore`, ou as ids indicadas (job travado na
 * fila). Nunca reexecuta. Avisa o editor, quem espera o resultado e libera a vaga da cota.
 */
export async function markWorkerLost(
  deps: WorkerLostDeps,
  filter: { staleBefore: Date } | { executionId: string },
): Promise<string[]> {
  const error: ExecutionError = { message: WORKER_LOST_MESSAGE, reason: 'worker_lost' };
  const finishedAt = new Date();
  const rows = await deps.db
    .updateTable('executions')
    .set({ status: 'error', finished_at: finishedAt, error: JSON.stringify(error) })
    .where('status', '=', 'running')
    .$if('staleBefore' in filter, (qb) =>
      qb.where('heartbeat_at', '<', 'staleBefore' in filter ? filter.staleBefore : finishedAt),
    )
    .$if('executionId' in filter, (qb) =>
      qb.where('id', '=', 'executionId' in filter ? filter.executionId : ''),
    )
    .returning(['id', 'workflow_id', 'project_id', 'mode', 'trigger_type', 'definition'])
    .execute();
  for (const row of rows) {
    deps.logger.warn(`Execução ${row.id} encerrada: worker perdido`);
    deps.events.emit(
      'executionFinished',
      { executionId: row.id, status: 'error', finishedAt: finishedAt.toISOString(), error },
      row.workflow_id,
    );
    await Promise.allSettled([
      deps.results.finished(row.id, { status: 'error', error }),
      deps.quota.release(row.project_id, row.id),
    ]);
    if (deps.errorWorkflows && row.definition) {
      const workflow = await deps.db
        .selectFrom('workflows')
        .select('name')
        .where('id', '=', row.workflow_id)
        .executeTakeFirst();
      await deps.errorWorkflows.trigger({
        executionId: row.id,
        workflowId: row.workflow_id,
        workflowName: workflow?.name ?? '',
        projectId: row.project_id,
        mode: row.mode,
        triggerType: row.trigger_type,
        definition: row.definition as WorkflowDefinition,
        error,
      });
    }
  }
  return rows.map((r) => r.id);
}
