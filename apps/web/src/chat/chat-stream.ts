import type { StreamEvent } from '@olly/shared-types';

/** Junta os pedaços recebidos e devolve as linhas JSON completas (NDJSON, spec 027). */
export class NdjsonReader {
  private buffer = '';

  push(text: string): StreamEvent[] {
    this.buffer += text;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.flatMap(parseLine);
  }

  /** O que sobrou sem quebra de linha no fim. */
  flush(): StreamEvent[] {
    const rest = this.buffer;
    this.buffer = '';
    return parseLine(rest);
  }
}

function parseLine(line: string): StreamEvent[] {
  if (!line.trim()) return [];
  try {
    return [JSON.parse(line) as StreamEvent];
  } catch {
    return [];
  }
}

export type ChatStreamResult = { ok: true; body: unknown } | { ok: false; message: string };

/**
 * Estado do chat durante o stream (spec 027, FR-005): o passo atual é o nó que começou por
 * último e ainda não terminou; o `item` traz a resposta, e o `error`, a falha.
 */
export class ChatStreamState {
  private readonly running = new Map<string, string>();
  result: ChatStreamResult | null = null;

  apply(event: StreamEvent): void {
    switch (event.type) {
      case 'begin':
        this.running.set(
          `${event.metadata.nodeId}#${String(event.metadata.runIndex)}`,
          event.metadata.nodeName,
        );
        return;
      case 'end':
        this.running.delete(`${event.metadata.nodeId}#${String(event.metadata.runIndex)}`);
        return;
      case 'item':
        this.result = { ok: true, body: event.content };
        return;
      case 'error':
        this.result = { ok: false, message: event.content };
        return;
      default:
    }
  }

  /** Nome do nó em execução (o mais recente), ou `null`. */
  get step(): string | null {
    return [...this.running.values()].at(-1) ?? null;
  }
}

/** Lê o stream da resposta, avisando o passo atual, até o fim. */
export async function readChatStream(
  res: Response,
  onStep: (step: string | null) => void,
): Promise<ChatStreamResult> {
  const state = new ChatStreamState();
  const reader = new NdjsonReader();
  const apply = (events: StreamEvent[]) => {
    for (const event of events) {
      state.apply(event);
      onStep(state.step);
    }
  };
  if (res.body) {
    const stream = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      apply(reader.push(decoder.decode(value, { stream: true })));
    }
  }
  apply(reader.flush());
  return state.result ?? { ok: false, message: 'O stream terminou sem resposta' };
}
