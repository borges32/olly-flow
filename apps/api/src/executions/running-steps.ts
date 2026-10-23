import { Logger } from '@nestjs/common';
import type { ExecutionEvents } from '@olly/shared-types';
import type { ChainableCommander, Redis } from 'ioredis';

/** Uma execução travada (worker morto sem `executionFinished`) não deixa o hash para sempre. */
const TTL_SECONDS = 24 * 60 * 60;

export const runningStepsKey = (executionId: string) => `olly:running-steps:${executionId}`;

export interface RunningStepEntry {
  nodeId: string;
  runIndex: number;
  startedAt: string;
}

const field = (nodeId: string, runIndex: number) => `${nodeId}#${String(runIndex)}`;

const TRACKED = new Set<keyof ExecutionEvents>([
  'nodeStarted',
  'nodeFinished',
  'executionFinished',
]);

/**
 * Passos em andamento de cada execução (spec 029, FR-005, plan §1): o início de um nó não é
 * gravado no banco, então quem emite os eventos (o worker ou a API em processo) mantém um hash
 * no Redis, `<nodeId>#<runIndex>` → `startedAt`. Só guarda ids e horários.
 */
export class RunningSteps {
  private readonly logger = new Logger('RunningSteps');

  constructor(private readonly redis: Redis) {}

  /** Põe na transação os comandos do evento (os eventos que não mudam o estado não põem nada). */
  static apply<K extends keyof ExecutionEvents>(
    chain: ChainableCommander,
    event: K,
    payload: ExecutionEvents[K],
  ): ChainableCommander {
    const key = runningStepsKey(payload.executionId);
    if (event === 'nodeStarted') {
      const e = payload as ExecutionEvents['nodeStarted'];
      return chain.hset(key, field(e.nodeId, e.runIndex), e.startedAt).expire(key, TTL_SECONDS);
    }
    if (event === 'nodeFinished') {
      const e = payload as ExecutionEvents['nodeFinished'];
      return chain.hdel(key, field(e.nodeId, e.runIndex));
    }
    if (event === 'executionFinished') return chain.del(key);
    return chain;
  }

  /** Atualiza o hash pelo evento. Uma falha do Redis só gera aviso: os eventos ao vivo bastam. */
  track<K extends keyof ExecutionEvents>(event: K, payload: ExecutionEvents[K]): void {
    if (!TRACKED.has(event)) return;
    RunningSteps.apply(this.redis.multi(), event, payload)
      .exec()
      .catch((error: unknown) => {
        this.logger.warn(`Passos em andamento não atualizados (${event}): ${String(error)}`);
      });
  }

  /** Passos em andamento, por ordem de início; vazio se o Redis falhar. */
  async list(executionId: string): Promise<RunningStepEntry[]> {
    let hash: Record<string, string>;
    try {
      hash = await this.redis.hgetall(runningStepsKey(executionId));
    } catch (error) {
      this.logger.warn(`Passos em andamento indisponíveis: ${String(error)}`);
      return [];
    }
    return Object.entries(hash)
      .map(([key, startedAt]) => {
        // O id do nó pode conter `#`: a iteração é o que vem depois do último.
        const at = key.lastIndexOf('#');
        return { nodeId: key.slice(0, at), runIndex: Number(key.slice(at + 1)), startedAt };
      })
      .filter((s) => s.nodeId !== '' && Number.isInteger(s.runIndex))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runIndex - b.runIndex);
  }
}
