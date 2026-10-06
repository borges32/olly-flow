import { randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

  /** Dados de nó acima do limite inline (spec 009, FR-013). */
  async putJson(key: string, value: unknown): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: 'application/json',
      }),
    );
  }

  async getJson<T>(key: string): Promise<T> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!result.Body) throw new Error(`Objeto ${key} sem conteúdo`);
    return JSON.parse(await result.Body.transformToString()) as T;
  }

  /**
   * Remove todos os objetos sob o prefixo (retenção e política "só erros", spec 009). Devolve
   * quantos foram removidos.
   */
  async deletePrefix(prefix: string): Promise<number> {
    let removed = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ...(token && { ContinuationToken: token }),
        }),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.config.bucket, Delete: { Objects: keys } }),
        );
        removed += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }

  destroy(): void {
    this.client.destroy();
  }
}
