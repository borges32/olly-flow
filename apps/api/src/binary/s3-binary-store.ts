import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { BinaryStore } from '@olly/engine';
import type { BinaryRef } from '@olly/shared-types';
import type { AppConfig } from '../config/config.js';

/**
 * Binários das execuções no object storage S3 compatível (MinIO em desenvolvimento; spec 004,
 * FR-010). O item guarda só a referência (`BinaryRef`); o conteúdo nunca vai para o log.
 */
export class S3BinaryStorage {
  private readonly client: S3Client;

  constructor(private readonly config: NonNullable<AppConfig['s3']>) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      // MinIO e a maioria dos S3 compatíveis usam o bucket no caminho, não no host.
      forcePathStyle: true,
    });
  }

  /** Armazenamento entregue ao motor; objetos agrupados por execução. */
  forExecution(executionId: string): BinaryStore {
    return {
      put: (data, meta) => this.put(`executions/${executionId}/${randomUUID()}`, data, meta),
      get: (ref) => this.get(ref),
    };
  }

  async put(
    id: string,
    data: Uint8Array,
    meta: Omit<BinaryRef, 'id' | 'size'>,
  ): Promise<BinaryRef> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: id,
        Body: data,
        ContentType: meta.mimeType,
      }),
    );
    return { id, size: data.byteLength, ...meta };
  }

  async get(ref: BinaryRef): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: ref.id }),
    );
    if (!result.Body) throw new Error(`Binário ${ref.id} sem conteúdo`);
    return result.Body.transformToByteArray();
  }

  destroy(): void {
    this.client.destroy();
  }
}
