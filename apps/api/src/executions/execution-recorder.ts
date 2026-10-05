import type { Logger } from '@nestjs/common';
import type { Db, NewNodeExecution } from '@olly/db';
import type { NodeRunRecord, RunCallbacks } from '@olly/engine';
import { sql } from 'kysely';
import type { ExecutionEventSink } from './execution-events.service.js';
import type { ExecutionError, ExecutionOutcome } from './execution-job.js';
import { truncateByBytes } from './truncate.js';

const NO_PARTITION = '23514';

/**
 * Grava a execução e cada nó no log (FR-014), com truncamento (FR-015), e publica os eventos
 * em tempo real (FR-012). Implementa os callbacks do motor.
 */
export class ExecutionRecorder {
  constructor(
    private readonly db: Db,
    private readonly events: ExecutionEventSink,
    private readonly executionId: string,
    private readonly workflowId: string,
    private readonly maxBytes: number,
    private readonly logger: Logger,
  ) {}

  callbacks(): RunCallbacks {
    return {
      onNodeStart: (nodeId, startedAt) => {
        this.events.emit(
          'nodeStarted',
          { executionId: this.executionId, nodeId, startedAt: startedAt.toISOString() },
          this.workflowId,
        );
      },
      onNodeFinish: (record) => this.recordNode(record),
      onExecutionFinish: async (result) => {
        await this.finish(result.status, result.error ?? null);
      },
    };
  }

  /**
   * Grava o fim da execução e publica `executionFinished`. Só uma execução ainda `running` é
   * finalizada: se a varredura já a marcou como `worker_lost` (spec 006, FR-005), prevalece.
   * Devolve o status final (worker perdido conta como erro).
   */
  async finish(
    engineStatus: ExecutionOutcome['status'],
    error: ExecutionError | null,
  ): Promise<ExecutionOutcome['status']> {
    const status =
      engineStatus === 'cancelled' && error?.reason === 'worker_lost' ? 'error' : engineStatus;
    const finishedAt = new Date();
    try {
      const updated = await this.db
        .updateTable('executions')
        .set({ status, finished_at: finishedAt, error: error ? JSON.stringify(error) : null })
        .where('id', '=', this.executionId)
        .where('status', '=', 'running')
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) return status;
    } catch (err) {
      this.logger.error(`Falha ao finalizar a execução ${this.executionId}: ${String(err)}`);
    }
    this.events.emit(
      'executionFinished',
      { executionId: this.executionId, status, finishedAt: finishedAt.toISOString(), error },
      this.workflowId,
    );
    return status;
  }

  private async recordNode(record: NodeRunRecord): Promise<void> {
    // Metade do limite para a entrada e metade para a saída.
    const half = Math.floor(this.maxBytes / 2);
    const input = truncateByBytes(record.inputs, half);
    const output = truncateByBytes(record.output, half);
    const sources = Object.fromEntries(
      Object.entries(record.inputSources).map(([port, refs]) => [
        port,
        refs.slice(0, input.kept[port] ?? 0),
      ]),
    );
    const truncated = input.truncated || output.truncated;
    const row: NewNodeExecution = {
      execution_id: this.executionId,
      node_id: record.nodeId,
      node_name: record.nodeName,
      status: record.status,
      pinned: record.pinned,
      reused: record.reused,
      attempts: record.attempts,
      console: record.console ? JSON.stringify(record.console) : null,
      started_at: record.startedAt,
      finished_at: record.finishedAt,
      items_in: record.itemsIn,
      items_out: record.itemsOut,
      input_data: JSON.stringify(input.data),
      input_sources: JSON.stringify(sources),
      output_data: record.output ? JSON.stringify(output.data) : null,
      data_truncated: truncated,
      error: record.error ? JSON.stringify(record.error) : null,
    };
    try {
      await this.insertNode(row);
    } catch (err) {
      this.logger.error(
        `Falha ao gravar o nó ${record.nodeName} da execução ${this.executionId}: ${String(err)}`,
      );
    }
    this.events.emit(
      'nodeFinished',
      {
        executionId: this.executionId,
        nodeId: record.nodeId,
        status: record.status,
        itemsIn: record.itemsIn,
        itemsOut: record.itemsOut,
        durationMs: record.finishedAt.getTime() - record.startedAt.getTime(),
        pinned: record.pinned,
        reused: record.reused,
        dataTruncated: truncated,
        data: { input: input.data, output: output.data },
        ...(record.console && { console: record.console }),
        error: record.error ?? null,
      },
      this.workflowId,
    );
  }

  private async insertNode(row: NewNodeExecution): Promise<void> {
    try {
      await this.db.insertInto('node_executions').values(row).execute();
    } catch (err) {
      // Sem partição para o mês (API no ar há meses sem reiniciar): cria e tenta de novo.
      if ((err as { code?: string }).code !== NO_PARTITION) throw err;
      await sql`SELECT olly_ensure_partitions(2)`.execute(this.db);
      await this.db.insertInto('node_executions').values(row).execute();
    }
  }
}
