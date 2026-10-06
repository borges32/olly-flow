import type { SourceRef } from '@olly/engine';
import type { Item, NodeOutput } from '@olly/shared-types';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';

/** Prefixo de tudo o que uma execução guarda no object storage (binários e dados). */
export const executionPrefix = (executionId: string) => `executions/${executionId}/`;

/** Dados de um nó acima do limite inline (spec 009, FR-013). */
export const nodeDataKey = (executionId: string, nodeId: string, runIndex: number) =>
  `${executionPrefix(executionId)}data/${encodeURIComponent(nodeId)}-${runIndex}.json`;

export interface NodeData {
  input: Record<string, Item[]> | null;
  inputSources: Record<string, SourceRef[]> | null;
  output: NodeOutput | null;
}

export interface NodeDataRow {
  input_data: unknown;
  input_sources: unknown;
  output_data: unknown;
  data_ref: string | null;
}

/**
 * Leitura transparente dos dados de um nó (FR-013): inline no banco ou no object storage. Sem o
 * storage configurado (ou com o objeto removido), devolve vazio em vez de falhar a consulta.
 */
export async function readNodeData(
  row: NodeDataRow,
  storage: S3BinaryStorage | null,
): Promise<NodeData> {
  if (row.data_ref) {
    if (!storage) return { input: null, inputSources: null, output: null };
    try {
      return await storage.getJson<NodeData>(row.data_ref);
    } catch {
      return { input: null, inputSources: null, output: null };
    }
  }
  return {
    input: row.input_data as Record<string, Item[]> | null,
    inputSources: row.input_sources as Record<string, SourceRef[]> | null,
    output: row.output_data as NodeOutput | null,
  };
}
