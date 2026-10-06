import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { AppConfig } from '../config/config.js';

const MINIO_IMAGE =
  'cgr.dev/chainguard/minio:latest-dev@sha256:7c248c1d7832ff65a6345cb6ff7bf9cf081ccf88527f8d6f25bb9227801a5121';

export interface TestMinio {
  s3: S3Client;
  config: NonNullable<AppConfig['s3']>;
  stop(): Promise<void>;
}

/** MinIO com o bucket `olly`, para testes com object storage. */
export async function startTestMinio(): Promise<TestMinio> {
  const container: StartedTestContainer = await new GenericContainer(MINIO_IMAGE)
    .withEnvironment({ MINIO_ROOT_USER: 'olly', MINIO_ROOT_PASSWORD: 'olly-test-secret' })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
    .start();
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  const config = {
    endpoint,
    region: 'us-east-1',
    accessKey: 'olly',
    secretKey: 'olly-test-secret',
    bucket: 'olly',
  };
  const s3 = new S3Client({
    endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  });
  await s3.send(new CreateBucketCommand({ Bucket: 'olly' }));
  return {
    s3,
    config,
    stop: async () => {
      s3.destroy();
      await container.stop();
    },
  };
}
