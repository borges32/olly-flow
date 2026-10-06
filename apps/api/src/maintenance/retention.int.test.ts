import { ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import type { ProjectSummary, WorkflowDetail } from '@olly/shared-types';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service.js';
import { S3BinaryStorage } from '../binary/s3-binary-store.js';
import { REDIS } from '../core/tokens.js';
import { createWorkflow, manualNode } from '../testing/execution-helpers.js';
import { startTestMinio, type TestMinio } from '../testing/minio.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';
import { MaintenanceService } from './maintenance.service.js';

const DAY = 86_400_000;
let minio: TestMinio;
let ctx: TestContext;
let admin: TestUser;
let curto: ProjectSummary, padrao: ProjectSummary;
let wfCurto: WorkflowDetail, wfPadrao: WorkflowDetail;
let maintenance: MaintenanceService;
let storage: S3BinaryStorage;

/** DDL não aceita parâmetros: as datas (geradas aqui) vão como literais. */
async function ensurePartition(date: Date): Promise<void> {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const suffix = `${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  for (const parent of ['executions', 'node_executions']) {
    await sql`CREATE TABLE IF NOT EXISTS ${sql.table(`${parent}_${suffix}`)} PARTITION OF ${sql.table(parent)}
      FOR VALUES FROM (${sql.lit(start.toISOString())}) TO (${sql.lit(end.toISOString())})`.execute(
      ctx.database.db,
    );
  }
}

/** Execução antiga com dados no banco e um objeto no storage. */
async function oldExecution(
  wf: WorkflowDetail,
  daysAgo: number,
  status = 'success',
): Promise<string> {
  const startedAt = new Date(Date.now() - daysAgo * DAY);
  await ensurePartition(startedAt);
  const { id } = await ctx.database.db
    .insertInto('executions')
    .values({
      workflow_id: wf.id,
      project_id: wf.projectId,
      mode: 'production',
      trigger_type: 'webhook',
      status,
      started_at: startedAt,
      finished_at: status === 'running' ? null : startedAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.database.db
    .insertInto('node_executions')
    .values({
      execution_id: id,
      node_id: 'm',
      node_name: 'm',
      status: 'success',
      started_at: startedAt,
      finished_at: startedAt,
      items_in: 1,
      items_out: 1,
      input_data: JSON.stringify({ main: [{ json: { pessoal: 'dado' } }] }),
      output_data: JSON.stringify({ main: [{ json: { pessoal: 'dado' } }] }),
      console: JSON.stringify(['log']),
    })
    .execute();
  await ctx.database.db
    .insertInto('execution_payloads')
    .values({ execution_id: id, data: JSON.stringify({ triggerItems: [] }) })
    .execute();
  await minio.s3.send(
    new PutObjectCommand({ Bucket: 'olly', Key: `executions/${id}/binario`, Body: 'conteúdo' }),
  );
  return id;
}

const execution = (id: string) =>
  ctx.database.db.selectFrom('executions').select('id').where('id', '=', id).executeTakeFirst();
const nodeData = (id: string) =>
  ctx.database.db
    .selectFrom('node_executions')
    .select(['output_data', 'input_data', 'console', 'items_out'])
    .where('execution_id', '=', id)
    .executeTakeFirst();
const objects = async (id: string) =>
  (await minio.s3.send(new ListObjectsV2Command({ Bucket: 'olly', Prefix: `executions/${id}/` })))
    .KeyCount ?? 0;

beforeAll(async () => {
  minio = await startTestMinio();
  ctx = await startTestContext({ s3: minio.config }, { worker: false });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  curto = (await admin.call('POST', '/projects', { name: 'Curto' })).json<ProjectSummary>();
  padrao = (await admin.call('POST', '/projects', { name: 'Padrão' })).json<ProjectSummary>();
  const def = { nodes: [manualNode()], edges: [], settings: {} };
  wfCurto = await createWorkflow(admin, curto.id, def);
  wfPadrao = await createWorkflow(admin, padrao.id, def);
  storage = new S3BinaryStorage(minio.config);
  maintenance = new MaintenanceService(
    ctx.database.db,
    ctx.app.get<Redis>(REDIS),
    ctx.config,
    new AuditService(),
    storage,
  );
}, 240_000);
afterAll(async () => {
  storage.destroy();
  await ctx.close();
  await minio.stop();
});

describe('spec 009 — FR-017/SC-007: retenção por projeto, partições e auditoria', () => {
  it('FR-017/SC-007: remove dados e metadados expirados (com os objetos) conforme cada projeto e audita', async () => {
    const res = await admin.call('PUT', `/projects/${curto.id}/settings`, {
      retention: { dataDays: 10, metadataDays: 100 },
    });
    expect(res.statusCode).toBe(200);
    // Dados não podem durar mais que as execuções.
    expect(
      (
        await admin.call('PUT', `/projects/${curto.id}/settings`, {
          retention: { dataDays: 200 },
        })
      ).statusCode,
    ).toBe(422);

    const c = {
      recente: await oldExecution(wfCurto, 5),
      semDados: await oldExecution(wfCurto, 20),
      apagada: await oldExecution(wfCurto, 150),
      emAndamento: await oldExecution(wfCurto, 150, 'running'),
    };
    const p = {
      comDados: await oldExecution(wfPadrao, 20),
      semDados: await oldExecution(wfPadrao, 40),
      particaoAntiga: await oldExecution(wfPadrao, 420),
    };

    const report = await maintenance.run();
    expect(report.ran).toBe(true);

    // Projeto "Curto" (10 / 100 dias).
    expect((await nodeData(c.recente))?.output_data).not.toBeNull();
    expect(await objects(c.recente)).toBe(1);
    expect(await nodeData(c.semDados)).toEqual({
      output_data: null,
      input_data: null,
      console: null,
      items_out: 1,
    });
    expect(await execution(c.semDados)).toBeDefined();
    expect(await objects(c.semDados)).toBe(0);
    expect(await execution(c.apagada)).toBeUndefined();
    expect(await nodeData(c.apagada)).toBeUndefined();
    expect(await objects(c.apagada)).toBe(0);
    // Execução que ainda pode mudar não é tocada.
    expect(await execution(c.emAndamento)).toBeDefined();

    // Projeto com a retenção padrão (30 / 365 dias).
    expect((await nodeData(p.comDados))?.output_data).not.toBeNull();
    expect((await nodeData(p.semDados))?.output_data).toBeNull();
    expect(await execution(p.semDados)).toBeDefined();
    expect(await execution(p.particaoAntiga)).toBeUndefined();

    // Partições antigas descartadas; futuras criadas.
    const old = new Date(Date.now() - 420 * DAY);
    const suffix = `${old.getUTCFullYear()}${String(old.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(report.partitionsDropped).toEqual(
      expect.arrayContaining([`executions_${suffix}`, `node_executions_${suffix}`]),
    );
    const future = new Date(Date.now() + 62 * DAY);
    const futureSuffix = `${future.getUTCFullYear()}${String(future.getUTCMonth() + 1).padStart(2, '0')}`;
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_class WHERE relname = ${`executions_${futureSuffix}`}`.execute(
      ctx.database.db,
    );
    expect(rows[0]?.n).toBe(1);

    expect(report.dataPurged.executions).toBe(2);
    expect(report.metadataDeleted.executions).toBe(2);
    expect(report.dataPurged.objects + report.metadataDeleted.objects).toBe(4);
    const payloads = await ctx.database.db
      .selectFrom('execution_payloads')
      .select('execution_id')
      .where('execution_id', 'in', [c.semDados, c.apagada, p.semDados])
      .execute();
    expect(payloads).toEqual([]);

    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select(['details', 'user_id'])
      .where('action', '=', 'retention.run')
      .executeTakeFirstOrThrow();
    expect(audit.user_id).toBeNull();
    expect(audit.details).toMatchObject({
      dataPurged: { executions: 2 },
      metadataDeleted: { executions: 2, nodes: 2 },
    });

    // Repetir não remove mais nada.
    const again = await maintenance.run();
    expect(again.dataPurged.executions + again.metadataDeleted.executions).toBe(0);
  });

  it('FR-017: lock no Redis impede duas execuções simultâneas do job', async () => {
    const [a, b] = await Promise.all([maintenance.run(), maintenance.run()]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
  });
});
