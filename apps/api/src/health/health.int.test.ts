import type { HealthResponse } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestContext, type TestContext } from '../testing/test-app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContext();
});
afterAll(async () => {
  await ctx.close();
});

async function health() {
  const res = await ctx.app.inject({ method: 'GET', url: '/health' });
  return { status: res.statusCode, body: res.json<HealthResponse>() };
}

describe('FR-012: GET /health', () => {
  it('FR-012: 200 com banco, Redis e IdP no ar, fora do prefixo /api/v1', async () => {
    expect(await health()).toEqual({
      status: 200,
      body: { status: 'ok', db: 'up', redis: 'up', idp: 'up' },
    });
    const prefixed = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(prefixed.statusCode).toBe(404);
  });

  it('FR-012 (caso de borda): IdP fora do ar só degrada e /health continua respondendo', async () => {
    await ctx.issuer.close();
    expect(await health()).toEqual({
      status: 200,
      body: { status: 'degraded', db: 'up', redis: 'up', idp: 'down' },
    });
  });

  it('FR-012: Redis fora do ar → 503', async () => {
    await ctx.redis.stop();
    const result = await health();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ status: 'error', db: 'up', redis: 'down' });
  });

  it('FR-012: banco fora do ar → 503', async () => {
    await ctx.database.container.stop();
    const result = await health();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ status: 'error', db: 'down' });
  });
});
