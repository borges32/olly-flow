import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type {
  ExecutionDetail,
  ProjectSummary,
  TestRunResponse,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext } from '../testing/test-app.js';

// Mesma imagem do docker-compose (build da Chainguard; ver report.md da spec 001).
const MINIO_IMAGE =
  'cgr.dev/chainguard/minio:latest-dev@sha256:7c248c1d7832ff65a6345cb6ff7bf9cf081ccf88527f8d6f25bb9227801a5121';
const PDF = Buffer.from('%PDF-1.4 conteúdo de teste');

let minio: StartedTestContainer;
let ctx: TestContext;
let server: Server;
let base: string;
let s3: S3Client;

beforeAll(async () => {
  minio = await new GenericContainer(MINIO_IMAGE)
    .withEnvironment({ MINIO_ROOT_USER: 'olly', MINIO_ROOT_PASSWORD: 'olly-test-secret' })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
    .start();
  const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'olly', secretAccessKey: 'olly-test-secret' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: 'olly' }));

  server = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="relatorio.pdf"',
    });
    res.end(PDF);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
    s3: {
      endpoint,
      region: 'us-east-1',
      accessKey: 'olly',
      secretKey: 'olly-test-secret',
      bucket: 'olly',
    },
  });
});
afterAll(async () => {
  server.close();
  s3.destroy();
  await ctx.close();
  await minio.stop();
});

describe('spec 004 — FR-010: respostas binárias no object storage', () => {
  it('FR-010: o binário vai para o S3; o item e o log guardam só a referência', async () => {
    const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
    const project = (
      await admin.call('POST', '/projects', { name: 'Binários' })
    ).json<ProjectSummary>();
    const wf = (
      await admin.call('POST', `/projects/${project.id}/workflows`, { name: 'PDF' })
    ).json<WorkflowDetail>();
    const definition: WorkflowDefinition = {
      nodes: [
        { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
        {
          id: 'h',
          type: 'http.request',
          name: 'Baixar',
          params: { url: `${base}/r.pdf` },
          position: [200, 0],
        },
      ],
      edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'h', toPort: 'main' }],
      settings: {},
    };
    const { executionId } = (
      await admin.call('POST', `/workflows/${wf.id}/test-run`, { definition })
    ).json<TestRunResponse>();
    let detail: ExecutionDetail | undefined;
    for (let i = 0; i < 100 && detail?.status !== 'success'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      detail = (await admin.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    }
    const item = detail?.nodes.find((n) => n.nodeId === 'h')?.output?.main?.[0];
    expect(item?.json).toEqual({});
    const ref = item?.binary?.data;
    expect(ref).toMatchObject({
      mimeType: 'application/pdf',
      fileName: 'relatorio.pdf',
      size: PDF.length,
    });
    expect(ref?.id).toMatch(new RegExp(`^executions/${executionId}/`));
    const object = await s3.send(new GetObjectCommand({ Bucket: 'olly', Key: ref?.id }));
    expect(Buffer.from((await object.Body?.transformToByteArray()) ?? [])).toEqual(PDF);
    // O conteúdo não vai para o log de execução.
    expect(JSON.stringify(detail)).not.toContain('%PDF');
  });
});
