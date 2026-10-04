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
