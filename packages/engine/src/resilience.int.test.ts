import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBuiltinNodes, createNodeRegistry, PoolManager } from '@olly/nodes';
import type { WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWorkflow, type CredentialResolver, type NodeRunRecord } from './run.js';

let container: StartedPostgreSqlContainer;
let admin: pg.Pool;
let pools: PoolManager;
let credentials: CredentialResolver;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const data = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
    ssl: 'disable',
  };
  admin = new pg.Pool({ ...data, ssl: false, max: 2 });
  await admin.query('CREATE SEQUENCE tentativas');
  pools = new PoolManager();
  credentials = (node) =>
    Promise.resolve({
      credential: { id: node.credentialId ?? '', type: 'postgres', data, updatedAt: 'v1' },
      secrets: [data.password],
    });
});
afterAll(async () => {
  await pools.closeAll();
  await admin.end();
  await container.stop();
});

const workflow = (query: Partial<WorkflowNode>): WorkflowDefinition => ({
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'q',
      type: 'postgres.query',
      name: 'Consulta',
      params: {},
      position: [200, 0],
      credentialId: 'cred-1',
      ...query,
    },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'q', toPort: 'main' }],
  settings: {},
});
const registry = () => createNodeRegistry(createBuiltinNodes({ pools }));

describe('spec 004 — FR-017/FR-018: resiliência com o nó Postgres', () => {
  it('FR-018/SC-006: timeout do nó cancela a query no servidor', async () => {
    const started = Date.now();
    const result = await runWorkflow(
      workflow({ params: { query: 'SELECT pg_sleep(20)' }, settings: { timeoutMs: 300 } }),
      registry(),
      { credentials },
    );
    expect(result.error?.message).toBe('Tempo limite do nó excedido (300 ms)');
    expect(Date.now() - started).toBeLessThan(5000);
    // O cancelamento chega ao servidor: a consulta não continua rodando.
    let active = 1;
    for (let i = 0; i < 20 && active > 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const { rows } = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE query = 'SELECT pg_sleep(20)' AND state = 'active'`,
      );
      active = rows[0]?.n ?? 0;
    }
    expect(active).toBe(0);
  });

  it('FR-017: retry com backoff até a consulta dar certo; tentativas registradas', async () => {
    const records: NodeRunRecord[] = [];
    const result = await runWorkflow(
      workflow({
        params: {
          query: 'SELECT 1 / (CASE WHEN nextval($1) < 3 THEN 0 ELSE 1 END) AS ok',
          queryParameters: [{ value: 'tentativas' }],
        },
        settings: { retry: { maxTries: 3, waitMs: 50, backoff: 'exponential' } },
      }),
      registry(),
      { credentials, callbacks: { onNodeFinish: (r) => void records.push(r) } },
    );
    expect(result.status).toBe('success');
    expect(result.nodes.q?.output?.main?.[0]?.json).toEqual({ ok: 1 });
    expect(records.find((r) => r.nodeId === 'q')?.attempts).toBe(3);
  });

  it('FR-017: onError continue segue com o item de erro do Postgres', async () => {
    const result = await runWorkflow(
      workflow({
        params: { query: 'SELECT * FROM nao_existe' },
        settings: { onError: 'continue' },
      }),
      registry(),
      { credentials },
    );
    expect(result.status).toBe('success');
    expect(result.nodes.q?.output?.main?.[0]?.json).toMatchObject({
      error: { message: 'relation "nao_existe" does not exist', description: 'SQLSTATE 42P01' },
    });
  });
});
