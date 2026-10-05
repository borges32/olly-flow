import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { WorkflowDefinition } from '@olly/shared-types';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { QueueDispatcher } from '../queue/queue-dispatcher.js';
import type { ExecutionError } from './execution-job.js';

/** Execução que falhou, candidata a acionar o workflow de erro. */
export interface FailedExecution {
  executionId: string;
  workflowId: string;
  workflowName: string;
  projectId: string;
  mode: 'test' | 'production';
  triggerType: string;
  definition: WorkflowDefinition;
  error: ExecutionError;
}

/** Tipo do gatilho das execuções iniciadas por um workflow de erro. */
export const ERROR_TRIGGER_TYPE = 'error';

/**
 * Workflow de erro (spec 007, FR-014/FR-015, plan §6): quando uma execução de **produção**
 * termina com erro, enfileira o workflow indicado em `settings.errorWorkflowId` com o payload
 * do Error Trigger do N8N. Execuções iniciadas por um workflow de erro nunca acionam outro.
 */
@Injectable()
export class ErrorWorkflowTrigger {
  private readonly logger = new Logger('ErrorWorkflow');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(QueueDispatcher) private readonly queue: QueueDispatcher,
  ) {}

  /** Devolve o id da execução do workflow de erro, ou `null` quando não se aplica. */
  async trigger(failed: FailedExecution): Promise<string | null> {
    if (failed.mode !== 'production' || failed.triggerType === ERROR_TRIGGER_TYPE) return null;
    const targetId = failed.definition.settings.errorWorkflowId;
    if (!targetId || targetId === failed.workflowId) return null;
    try {
      return await this.launch(failed, targetId);
    } catch (error) {
      this.logger.error(
        `Workflow de erro ${targetId} não foi acionado para ${failed.executionId}: ${String(error)}`,
      );
      return null;
    }
  }

  private async launch(failed: FailedExecution, targetId: string): Promise<string | null> {
    const target = await this.db
      .selectFrom('workflows as w')
      .innerJoin('workflow_versions as v', (join) =>
        // Versão publicada, se houver; senão, a última salva.
        join
          .onRef('v.workflow_id', '=', 'w.id')
          .on((eb) => eb('v.version', '=', eb.fn.coalesce('w.published_version', 'w.version'))),
      )
      .select(['w.id', 'w.name', 'w.project_id', 'w.active', 'v.version', 'v.definition'])
      .where('w.id', '=', targetId)
      .where('w.deleted_at', 'is', null)
      .executeTakeFirst();
    if (target?.project_id !== failed.projectId) {
      this.logger.warn(`Workflow de erro ${targetId} inexistente ou de outro projeto`);
      return null;
    }
    const definition = target.definition as WorkflowDefinition;
    const trigger = definition.nodes.find((n) => n.type === 'trigger.error');
    if (!trigger) {
      this.logger.warn(`Workflow de erro ${targetId} não tem "Gatilho de erro"`);
      return null;
    }
    const lastNode = failed.definition.nodes.find((n) => n.id === failed.error.nodeId);
    const payload = {
      execution: {
        id: failed.executionId,
        url: `${this.config.publicUrl}/executions/${failed.executionId}`,
        error: { message: failed.error.message },
        ...(lastNode && { lastNodeExecuted: lastNode.name }),
        mode: failed.triggerType,
      },
      workflow: { id: failed.workflowId, name: failed.workflowName },
    };
    const execution = await this.db
      .insertInto('executions')
      .values({
        workflow_id: target.id,
        project_id: target.project_id,
        workflow_version: target.version,
        mode: 'production',
        trigger_type: ERROR_TRIGGER_TYPE,
        triggered_by: null,
        status: 'queued',
        definition: JSON.stringify(definition),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.queue.dispatch({
      executionId: execution.id,
      workflow: {
        id: target.id,
        name: target.name,
        projectId: target.project_id,
        active: target.active,
      },
      definition,
      mode: 'production',
      triggerItems: [{ json: payload }],
      startNodeId: trigger.id,
    });
    this.logger.log(`Workflow de erro ${target.id} acionado pela falha de ${failed.executionId}`);
    return execution.id;
  }
}
