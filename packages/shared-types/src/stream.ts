/**
 * Resposta em streaming do Webhook e do Chat Trigger (spec 027, FR-001 a FR-004): uma linha
 * JSON por evento (NDJSON), no formato do N8N (`begin`, `item`, `end`, `error`), mais os
 * eventos do Olly Flow `execution` e `ping`. Clientes devem ignorar tipos desconhecidos.
 */
export const RESPONSE_MODE_STREAMING = 'streaming';

/** Cabeçalhos da resposta, como no Webhook do N8N, mais o que desliga o buffer do nginx. */
export const STREAM_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

/** Nó do workflow num evento do stream: o nome é o do canvas (spec 027, FR-002). */
export interface StreamNodeRef {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  runIndex: number;
}

interface StreamMetaBase {
  executionId: string;
  /** Milissegundos desde 1970, como no N8N. */
  timestamp: number;
}

export type StreamNodeMeta = StreamMetaBase & StreamNodeRef & { itemIndex: number };

export type StreamEvent =
  | {
      type: 'execution';
      metadata: StreamMetaBase & { status: 'queued' | 'started' | 'waiting' };
    }
  | { type: 'begin'; metadata: StreamNodeMeta }
  | {
      type: 'end';
      metadata: StreamNodeMeta & {
        status: 'success' | 'error' | 'cancelled';
        durationMs: number;
        itemsIn: number;
        itemsOut: number;
      };
    }
  | {
      type: 'item';
      content: unknown;
      metadata: StreamMetaBase & Partial<StreamNodeRef> & { final: true };
    }
  | {
      type: 'error';
      content: string;
      metadata: StreamMetaBase & Partial<StreamNodeRef>;
    }
  | { type: 'ping'; metadata: StreamMetaBase & { running: StreamNodeRef[] } };
