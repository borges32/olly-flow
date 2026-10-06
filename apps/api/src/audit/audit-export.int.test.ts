import type { AuditList, ProjectSummary } from '@olly/shared-types';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let url: string;
let admin: TestUser, editor: TestUser;
const TOTAL = 100_000;

beforeAll(async () => {
  ctx = await startTestContext({}, { worker: false });
  url = await ctx.listen();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  const project = (
    await admin.call('POST', '/projects', { name: 'Auditado' })
  ).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'admin' });
  // 100 mil registros com ~600 bytes de detalhes cada (CSV de ~70 MB).
  await sql`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip, created_at)
    SELECT ${editor.id}::uuid, 'carga.registro', 'workflow', 'wf-' || g,
           jsonb_build_object('n', g, 'texto', repeat('x', 600)), '10.0.0.1',
           now() - make_interval(secs => g)
    FROM generate_series(1, ${TOTAL}) AS g`.execute(ctx.database.db);
  await ctx.database.db
    .insertInto('audit_log')
    .values({
      user_id: admin.id,
      action: 'workflow.publish',
      entity_type: 'workflow',
      entity_id: 'wf-especial',
      details: JSON.stringify({ nota: '=HYPERLINK("http://mal")', aspas: 'diz "oi"' }),
    })
    .execute();
}, 240_000);
afterAll(async () => {
  await ctx.close();
});

describe('spec 009 — FR-018: consulta da auditoria', () => {
  it('FR-018: só com `audit:read` (administração da plataforma)', async () => {
    // Admin de um projeto não lê a auditoria da plataforma.
    expect((await editor.call('GET', '/audit')).statusCode).toBe(403);
    expect((await editor.call('GET', '/audit/export.csv')).statusCode).toBe(403);
  });

  it('FR-018: filtros por usuário, ação (prefixo), entidade e período; paginação por cursor', async () => {
    const special = (
      await admin.call('GET', '/audit?action=workflow.*&entityId=wf-especial')
    ).json<AuditList>();
    expect(special.items).toHaveLength(1);
    expect(special.items[0]).toMatchObject({
      action: 'workflow.publish',
      userEmail: 'admin@t.local',
      details: { aspas: 'diz "oi"' },
    });

    const byUser = (
      await admin.call('GET', `/audit?userId=${editor.id}&limit=3`)
    ).json<AuditList>();
    expect(byUser.items).toHaveLength(3);
    expect(byUser.items.every((i) => i.userId === editor.id)).toBe(true);
    const next = (
      await admin.call('GET', `/audit?userId=${editor.id}&limit=3&cursor=${byUser.nextCursor}`)
    ).json<AuditList>();
    expect(Number(next.items[0]?.id)).toBeLessThan(Number(byUser.items[2]?.id));

    // Período: os registros foram criados a 1 s de distância (wf-g = agora - g s).
    const at = async (entityId: string) =>
      (
        await ctx.database.db
          .selectFrom('audit_log')
          .select('created_at')
          .where('entity_id', '=', entityId)
          .executeTakeFirstOrThrow()
      ).created_at.toISOString();
    const window = (
      await admin.call(
        'GET',
        `/audit?action=carga.registro&from=${encodeURIComponent(await at('wf-20'))}&to=${encodeURIComponent(await at('wf-10'))}`,
      )
    ).json<AuditList>();
    expect(window.items.map((i) => i.entityId)).toEqual(
      // Mais recentes primeiro: de wf-20 (início do período, inclusivo) a wf-11.
      Array.from({ length: 10 }, (_, i) => `wf-${20 - i}`),
    );
    expect((await admin.call('GET', '/audit?cursor=abc')).statusCode).toBe(422);
  });
});

describe('spec 009 — FR-018/SC-008: exportação CSV em streaming', () => {
  it('SC-008: 100 mil registros exportados sem acumular na memória', async () => {
    const res = await fetch(`${url}/api/v1/audit/export.csv?action=carga.registro`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    if (!res.body) throw new Error('sem corpo');
    // O ReadableStream do Node é iterável; a API não carrega os tipos do DOM.
    const body = res.body as unknown as AsyncIterable<Uint8Array>;
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    // Memória viva (depois de coletar o lixo): `--expose-gc` no vitest.integration.config.ts.
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) throw new Error('execute com --expose-gc');
    gc();
    const baseline = process.memoryUsage().heapUsed;
    let peak = 0;
    let sampledAt = 0;
    let lines = 0;
    let bytes = 0;
    let first = '';
    for await (const value of body) {
      bytes += value.byteLength;
      const text = decoder.decode(value, { stream: true });
      if (!first) first = text.slice(0, 200);
      for (const ch of text) if (ch === '\n') lines++;
      if (bytes - sampledAt > 5 * 1024 * 1024) {
        sampledAt = bytes;
        gc();
        peak = Math.max(peak, process.memoryUsage().heapUsed - baseline);
      }
    }
    expect(lines).toBe(TOTAL + 1);
    expect(first.startsWith('﻿"id","data","usuario_id"')).toBe(true);
    expect(bytes).toBeGreaterThan(60 * 1024 * 1024);
    // A resposta tem mais de 60 MB; a memória viva do processo (API + cliente) fica pequena.
    expect(peak).toBeLessThan(20 * 1024 * 1024);
  }, 120_000);

  it('FR-018: CSV escapa aspas e neutraliza fórmulas de planilha', async () => {
    const res = await admin.call('GET', '/audit/export.csv?entityId=wf-especial');
    expect(res.statusCode).toBe(200);
    const [, line] = res.body.split('\n');
    expect(line).toContain('"workflow.publish"');
    expect(line).toContain('""aspas"":""diz \\""oi\\""""');
    // O campo de detalhes começa com `{`; uma célula que começasse com `=` ganharia um apóstrofo.
    expect(line).not.toMatch(/,"=/);
  });
});
