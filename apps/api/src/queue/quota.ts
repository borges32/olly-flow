import type { Redis } from 'ioredis';

/**
 * Semáforo de execuções simultâneas por projeto (spec 006, FR-012, plan §6). Cada vaga é um
 * membro de um sorted set com validade (score = expiração em ms): a vaga de um worker que caiu
 * expira sozinha, sem afetar as demais. O worker renova a validade a cada batimento.
 */
const ACQUIRE = `
local key, now, expires, limit, member = KEYS[1], tonumber(ARGV[1]), ARGV[2], tonumber(ARGV[3]), ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
if redis.call('ZSCORE', key, member) or redis.call('ZCARD', key) < limit then
  redis.call('ZADD', key, expires, member)
  redis.call('PEXPIRE', key, tonumber(expires) - now)
  return 1
end
return 0
`;

const quotaKey = (projectId: string) => `olly:quota:${projectId}`;

export class ProjectQuota {
  constructor(
    private readonly redis: Redis,
    private readonly leaseMs: number,
  ) {}

  /** Ocupa uma vaga do projeto para a execução; `false` se a cota está cheia. */
  async acquire(projectId: string, executionId: string, limit: number): Promise<boolean> {
    const now = Date.now();
    const result = await this.redis.eval(
      ACQUIRE,
      1,
      quotaKey(projectId),
      now,
      now + this.leaseMs,
      limit,
      executionId,
    );
    return result === 1;
  }

  /** Renova a validade da vaga (batimento). */
  async refresh(projectId: string, executionId: string): Promise<void> {
    const expires = Date.now() + this.leaseMs;
    await this.redis
      .multi()
      .zadd(quotaKey(projectId), 'XX', expires, executionId)
      .pexpire(quotaKey(projectId), this.leaseMs)
      .exec();
  }

  async release(projectId: string, executionId: string): Promise<void> {
    await this.redis.zrem(quotaKey(projectId), executionId);
  }
}
