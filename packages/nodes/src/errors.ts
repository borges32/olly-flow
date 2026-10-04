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
