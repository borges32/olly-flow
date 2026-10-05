import type { Item } from '@olly/shared-types';

/** Posição de um item na saída de um nó (porta + índice). */
export interface ItemRef {
  port: string;
  index: number;
}

/** Item correspondente em um nó referenciado, ou o motivo de não haver correspondência. */
export type PairedResolution = ItemRef | { error: string };

export interface ReferencedNodeData {
  executed: boolean;
  /** Itens por porta de saída. */
  outputs: Record<string, Item[]>;
  /** Ordem das portas de saída (índice de ramo do N8N: 0 = primeira saída). */
  outputOrder: string[];
  params: Record<string, unknown>;
}

/**
 * Tudo o que a expressão pode ler, copiado para o sandbox uma vez por lote (nó).
 * Só os nós referenciados pelas expressões são enviados.
 */
export interface ExpressionData {
  nodeName: string;
  params: Record<string, unknown>;
  /** Itens de entrada do nó (`$input`). */
  input: Item[];
  nodes: Record<string, ReferencedNodeData>;
  /** Por índice de item de entrada: item correspondente em cada nó referenciado (`$('Nó').item`). */
  paired: Record<string, PairedResolution>[];
  vars: Record<string, unknown>;
  env: Record<string, string>;
  execution: { id: string; mode: 'test' | 'production' };
  workflow: { id: string; name: string; active: boolean };
  timezone: string;
  /** Spec 007, FR-007: laço que contém o nó (`$loop`); ausente fora de laços. */
  loop?: LoopData;
}

export interface LoopData {
  /** Voltas concluídas (0 na primeira passagem pelo corpo). */
  index: number;
  maxIterations: number;
  /** Itens acumulados pelo nó de laço. */
  accumulated: Item[];
}

export interface EvaluateRequest {
  id: string;
  /** Parâmetro completo, com o prefixo `=`. */
  template: string;
  itemIndex: number;
}

export interface EvaluateBatch {
  executionId: string;
  data: ExpressionData;
  requests: EvaluateRequest[];
}

export type EvaluationErrorKind = 'syntax' | 'runtime' | 'timeout' | 'memory';

export type EvaluateResult =
  | { id: string; ok: true; value: unknown }
  | { id: string; ok: false; error: { kind: EvaluationErrorKind; message: string } };

/** Avalia expressões fora do processo principal (task runner) ou, nos testes, diretamente. */
export interface ExpressionEvaluator {
  evaluateBatch(batch: EvaluateBatch): Promise<EvaluateResult[]>;
  /** Libera o isolate da execução. */
  disposeExecution(executionId: string): Promise<void>;
}

/** Modos do nó de código (spec 005, FR-009), com os nomes do N8N. */
export type CodeMode = 'runOnceForAllItems' | 'runOnceForEachItem';

export interface RunCodeRequest {
  executionId: string;
  code: string;
  mode: CodeMode;
  /** Mesmo contexto das expressões (`$input`, `$('Nó')`, `$vars`...), sem congelar. */
  data: ExpressionData;
}

export type CodeErrorKind = EvaluationErrorKind | 'crashed';

/**
 * `result`: retorno do código (uma vez) ou lista com o retorno de cada item (por item), ainda
 * não normalizado em itens. `console`: linhas do `console.*` (até 500).
 */
export type RunCodeResult =
  | { ok: true; result: unknown; console: string[] }
  | { ok: false; error: { kind: CodeErrorKind; message: string }; console: string[] };

/** Executa código JavaScript de usuário isolado (task runner; ADR-0003). */
export interface CodeRunner {
  runCode(request: RunCodeRequest): Promise<RunCodeResult>;
}
