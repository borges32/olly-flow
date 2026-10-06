import type { Logger } from '@nestjs/common';
import type { Db, NewNodeExecution } from '@olly/db';
import { NO_MASKING, type Masker, type NodeRunRecord, type RunCallbacks } from '@olly/engine';
import type { SaveExecutionDataPolicy } from '@olly/shared-types';
import { sql } from 'kysely';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import type { ExecutionEventSink } from './execution-events.service.js';
import type { ExecutionError, ExecutionOutcome } from './execution-job.js';
import { executionPrefix, nodeDataKey } from './node-data.js';
import { truncateByBytes } from './truncate.js';

const NO_PARTITION = '23514';

export interface RecorderOptions {
  /** Limite de dados por nó (FR-015 da spec 003): o excedente é truncado. */
  maxBytes: number;
  /** Spec 009, FR-014: mascaramento do que é gravado e transmitido. */
  masker?: Masker;
  /** Spec 009, FR-012: o que guardar dos dados. Padrão: tudo. */
  savePolicy?: SaveExecutionDataPolicy;
  /** Spec 009, FR-013: dados acima disto (bytes de JSON) vão para o object storage. */
  inlineLimit?: number;
  storage?: S3BinaryStorage | null;
}

/**
 * Grava a execução e cada nó no log (FR-014), com truncamento (FR-015), e publica os eventos
 * em tempo real (FR-012). Implementa os callbacks do motor.
 *
 * Spec 009: tudo o que sai daqui (banco, WebSocket) passa antes pelo mascaramento (FR-014); os
 * dados que o motor entrega aos nós seguintes não são tocados (FR-015). A política de dados
 * (FR-012) decide se os dados são gravados, e os grandes vão para o object storage (FR-013).
 */
export class ExecutionRecorder {
  private readonly masker: Masker;
  private readonly savePolicy: SaveExecutionDataPolicy;

  constructor(
    private readonly db: Db,
    private readonly events: ExecutionEventSink,
    private readonly executionId: string,
    private readonly workflowId: string,
    private readonly options: RecorderOptions,
    private readonly logger: Logger,
  ) {
    this.masker = options.masker ?? NO_MASKING;
    this.savePolicy = options.savePolicy ?? 'all';
  }

  callbacks(): RunCallbacks {
    return {
      onNodeStart: (nodeId, startedAt, runIndex) => {
        this.events.emit(
          'nodeStarted',
          { executionId: this.executionId, nodeId, runIndex, startedAt: startedAt.toISOString() },
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
    error = error ? this.masker.mask(error).value : null;
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
    if (this.savePolicy === 'errorsOnly' && status === 'success') await this.discardData();
    this.events.emit(
      'executionFinished',
      { executionId: this.executionId, status, finishedAt: finishedAt.toISOString(), error },
      this.workflowId,
    );
    return status;
  }

  /** Política "só erros" (FR-012, SC-004): execução com sucesso fica só com os metadados. */
  private async discardData(): Promise<void> {
    try {
      await this.db
        .updateTable('node_executions')
        .set({
          input_data: null,
          input_sources: null,
          output_data: null,
          console: null,
          data_ref: null,
        })
        .where('execution_id', '=', this.executionId)
        .execute();
      await this.options.storage?.deletePrefix(executionPrefix(this.executionId));
    } catch (err) {
      this.logger.error(
        `Falha ao descartar os dados da execução ${this.executionId}: ${String(err)}`,
      );
    }
  }

  private async recordNode(record: NodeRunRecord): Promise<void> {
    // Metade do limite para a entrada e metade para a saída.
    const half = Math.floor(this.options.maxBytes / 2);
    const input = truncateByBytes(record.inputs, half);
    const output = truncateByBytes(record.output, half);
    const sources = Object.fromEntries(
      Object.entries(record.inputSources).map(([port, refs]) => [
        port,
        refs.slice(0, input.kept[port] ?? 0),
      ]),
    );
    const truncated = input.truncated || output.truncated;
    // FR-014/FR-015: mascara uma cópia; `record` (dados do motor) fica intacto.
    const masked = this.masker.mask({
      input: input.data,
      output: record.output ? output.data : null,
      console: record.console ?? null,
      error: record.error ?? null,
    });
    const m = masked.value;
    const keepData = this.savePolicy !== 'none';
    const data = keepData
      ? await this.placeData(record, { input: m.input, inputSources: sources, output: m.output })
      : { input_data: null, input_sources: null, output_data: null, data_ref: null };
    const row: NewNodeExecution = {
      execution_id: this.executionId,
      node_id: record.nodeId,
      node_name: record.nodeName,
      run_index: record.runIndex,
      status: record.status,
      pinned: record.pinned,
      reused: record.reused,
      attempts: record.attempts,
      console: keepData && m.console ? JSON.stringify(m.console) : null,
      started_at: record.startedAt,
      finished_at: record.finishedAt,
      items_in: record.itemsIn,
      items_out: record.itemsOut,
      ...data,
      data_truncated: truncated,
      data_masked: masked.changed,
      error: m.error ? JSON.stringify(m.error) : null,
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
        runIndex: record.runIndex,
        status: record.status,
        itemsIn: record.itemsIn,
        itemsOut: record.itemsOut,
        durationMs: record.finishedAt.getTime() - record.startedAt.getTime(),
        pinned: record.pinned,
        reused: record.reused,
        dataTruncated: truncated,
        data: keepData ? { input: m.input, output: m.output ?? {} } : { input: {}, output: {} },
        ...(keepData && m.console && { console: m.console }),
        error: m.error,
      },
      this.workflowId,
    );
  }

  /** Inline no banco ou, acima do limite, no object storage (FR-013). */
  private async placeData(
    record: NodeRunRecord,
    data: { input: unknown; inputSources: unknown; output: unknown },
  ): Promise<Pick<NewNodeExecution, 'input_data' | 'input_sources' | 'output_data' | 'data_ref'>> {
    const inline = {
      input_data: JSON.stringify(data.input),
      input_sources: JSON.stringify(data.inputSources),
      output_data: data.output ? JSON.stringify(data.output) : null,
      data_ref: null,
    };
    const { storage, inlineLimit } = this.options;
    if (!storage || inlineLimit === undefined) return inline;
    const size =
      inline.input_data.length + inline.input_sources.length + (inline.output_data?.length ?? 0);
    if (size <= inlineLimit) return inline;
    const key = nodeDataKey(this.executionId, record.nodeId, record.runIndex);
    try {
      await storage.putJson(key, data);
      return { input_data: null, input_sources: null, output_data: null, data_ref: key };
    } catch (err) {
      this.logger.warn(`Dados do nó ${record.nodeName} ficaram no banco: ${String(err)}`);
      return inline;
    }
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
