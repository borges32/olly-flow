/** Fila de execuções (spec 006, plan §1). O job leva só `{ executionId }` (FR-001). */
export const EXECUTIONS_QUEUE = 'executions';

/** Canal dos pedidos de cancelamento para os workers (FR-010). */
export const CANCEL_CHANNEL = 'olly:execution-cancel';

/** Job de retomada de uma execução em espera (spec 008, FR-012), na mesma fila. */
export const RESUME_JOB = 'resume';

export interface ExecutionJobData {
  executionId: string;
  /** Spec 012, FR-001: contexto do trace (W3C `traceparent`/`tracestate`). */
  trace?: Record<string, string>;
}

/** Mensagem do erro `worker_lost` (FR-005). */
export const WORKER_LOST_MESSAGE =
  'O worker que executava esta execução parou de responder; ela não será reexecutada automaticamente';
