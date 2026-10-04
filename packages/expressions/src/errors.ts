import type { EvaluationErrorKind } from './types.js';

/** Erro de expressão com nó, parâmetro, item e trecho (FR-007). */
export class ExpressionError extends Error {
  override name = 'ExpressionError';

  constructor(
    readonly details: {
      nodeName: string;
      parameter: string;
      itemIndex: number;
      snippet: string;
      kind: EvaluationErrorKind;
      cause: string;
    },
  ) {
    super(
      `Erro na expressão do parâmetro "${details.parameter}" do nó "${details.nodeName}" (item ${details.itemIndex}): ` +
        `${details.cause}\nTrecho: ${details.snippet}`,
    );
  }
}
