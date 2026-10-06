/** Parâmetro de nó inválido em tempo de execução (mensagem voltada ao usuário do editor). */
export class NodeParameterError extends Error {
  constructor(
    readonly parameter: string,
    reason: string,
  ) {
    super(`Parâmetro "${parameter}": ${reason}`);
    this.name = 'NodeParameterError';
  }
}

/** Executa `fn` devolvendo sempre uma promessa: erros síncronos viram rejeição (contrato de `execute`). */
export function settle<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Falha de execução com detalhes para o usuário (ex.: status HTTP). Com `onError: continue`,
 * `message`, `description` e `httpCode` vão para o item de erro (spec 004, FR-017).
 */
export class NodeExecutionError extends Error {
  override name = 'NodeExecutionError';
  constructor(
    message: string,
    readonly details: { description?: string; httpCode?: number } = {},
  ) {
    super(message);
  }
}

/** Item de erro emitido com `onError: continue` (formato do N8N: `{ json: { error } }`). */
export function errorJson(error: unknown): { error: Record<string, unknown> } {
  const err = error instanceof Error ? error : new Error(String(error));
  const details = err instanceof NodeExecutionError ? err.details : {};
  return {
    error: {
      message: err.message,
      ...(details.description !== undefined && { description: details.description }),
      ...(details.httpCode !== undefined && { httpCode: details.httpCode }),
    },
  };
}

/** Como tratar a falha de um item (spec 004: `continue`; spec 007: `errorOutput`). */
export type ItemErrorMode = 'stop' | 'continue' | 'errorOutput';

export function itemErrorMode(settings: { onError?: string } | undefined): ItemErrorMode {
  const mode = settings?.onError;
  return mode === 'continue' || mode === 'errorOutput' ? mode : 'stop';
}

/** Item que falhou, para a saída `error` (spec 007, FR-013): o item original com `error`. */
export function failedItem(
  error: unknown,
  json: Record<string, unknown>,
  itemIndex: number,
): { json: Record<string, unknown>; pairedItem: { item: number } } {
  return { json: { ...json, ...errorJson(error) }, pairedItem: { item: itemIndex } };
}

/** Pedido de aprovação humana de um nó em espera (spec 011, FR-010). */
export interface NodeApprovalRequest {
  /** Identifica o pedido dentro do nó (a decisão volta com a mesma chave). */
  key: string;
  itemIndex: number;
  tool: string;
  arguments: unknown;
  reason: string;
}

/** O que um nó pede ao entrar em espera (spec 008, FR-012). */
export interface NodeWaitRequest {
  /** Motivo exibido (ex.: "Aguardando até 14:30"). */
  reason: string;
  /** Retomada por tempo (ISO 8601), como no Wait. */
  resumeAt?: string;
  /** Spec 011: a decisão de cada pedido retoma o nó. */
  approvals?: NodeApprovalRequest[];
  /** Estado próprio do nó para continuar na retomada (serializável em JSON). */
  data?: unknown;
}

/**
 * Lançado pelo nó para pausar a execução (spec 008, FR-012): o motor guarda o estado e a
 * execução fica `waiting` até a retomada, que roda o nó de novo com `ctx.resume`. Não conta
 * como falha (sem retry nem `onError`).
 */
export class NodeWaitSignal extends Error {
  override name = 'NodeWaitSignal';
  constructor(readonly request: NodeWaitRequest) {
    super(request.reason);
  }
}
