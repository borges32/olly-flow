import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  decryptCredentialData,
  encryptCredentialData,
  type Credential,
  type Db,
  type KeyRing,
} from '@olly/db';
import { redactSecrets, type CredentialAccess } from '@olly/engine';
import {
  CredentialTestInputError,
  listColumns,
  listSchemas,
  listTables,
  testCredential,
  type CredentialTypeRegistry,
  type HttpGuard,
  type PoolManager,
  type ResolvedCredential,
} from '@olly/nodes';
import type { CredentialSummary, CredentialTestResponse, PostgresColumn } from '@olly/shared-types';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../common/errors.js';
import { DB } from '../core/tokens.js';
import { CREDENTIAL_TYPES, HTTP_GUARD, POOL_MANAGER } from '../node-types/node-types.module.js';
import type {
  CreateCredentialBody,
  TestCredentialBody,
  UpdateCredentialBody,
} from './credentials.schemas.js';

/** Chaveiro da chave mestra (`KeyRing` do `@olly/db`; spec 009, FR-001). */
export const KEY_PROVIDER = Symbol('KEY_PROVIDER');

const UNIQUE_VIOLATION = '23505';
const iso = (d: Date) => d.toISOString();

/**
 * Credenciais cifradas por projeto (spec 004, plan §2). Os dados decifrados só saem daqui para o
 * motor (`resolveForExecution`) e para o teste de conexão; respostas levam só campos públicos.
 */
@Injectable()
export class CredentialsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(KEY_PROVIDER) private readonly keys: KeyRing,
    @Inject(CREDENTIAL_TYPES) private readonly types: CredentialTypeRegistry,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(HTTP_GUARD) private readonly guard: HttpGuard,
    @Inject(POOL_MANAGER) private readonly pools: PoolManager,
  ) {}

  private decrypt(row: Credential): Promise<Record<string, unknown>> {
    return decryptCredentialData(row.data_encrypted, this.keys, row.id);
  }

  private toSummary(row: Credential, data: Record<string, unknown>): CredentialSummary {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      type: row.type,
      publicFields: this.types.publicFields(row.type, data),
      secretFieldsSet: this.types
        .secretFields(row.type)
        .filter((f) => data[f] !== undefined && data[f] !== ''),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  private validate(type: string, data: Record<string, unknown>): Record<string, unknown> {
    if (!this.types.get(type))
      throw new UnprocessableError(`Tipo de credencial desconhecido: ${type}`);
    const result = this.types.validate(type, data);
    if (!result.ok) {
      throw new UnprocessableError('Dados da credencial inválidos', {
        issues: result.problems.map((message) => ({ message })),
      });
    }
    return result.data;
  }

  private async load(id: string): Promise<Credential> {
    const row = await this.db
      .selectFrom('credentials')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Credencial não encontrada');
    return row;
  }

  private async resolved(row: Credential): Promise<ResolvedCredential> {
    return {
      id: row.id,
      type: row.type,
      data: await this.decrypt(row),
      updatedAt: iso(row.updated_at),
    };
  }

  private nameConflict(error: unknown): never {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ConflictError('Já existe uma credencial com esse nome no projeto');
    }
    throw error;
  }

  async list(projectId: string): Promise<CredentialSummary[]> {
    const rows = await this.db
      .selectFrom('credentials')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('name')
      .execute();
    return Promise.all(rows.map(async (r) => this.toSummary(r, await this.decrypt(r))));
  }

  async get(id: string): Promise<CredentialSummary> {
    const row = await this.load(id);
    return this.toSummary(row, await this.decrypt(row));
  }

  /** FR-001/FR-006: cifra com DEK própria (AAD = id) e audita sem valores. */
  async create(
    ctx: AuditContext,
    projectId: string,
    body: CreateCredentialBody,
  ): Promise<CredentialSummary> {
    const data = this.validate(body.type, body.data);
    const id = randomUUID();
    const { blob, keyVersion, keyProvider } = await encryptCredentialData(data, this.keys, id);
    const row = await this.db
      .transaction()
      .execute(async (trx) => {
        const inserted = await trx
          .insertInto('credentials')
          .values({
            id,
            project_id: projectId,
            name: body.name,
            type: body.type,
            data_encrypted: blob,
            key_version: keyVersion,
            key_provider: keyProvider,
            created_by: ctx.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, ctx, {
          action: 'credential.create',
          entityType: 'credential',
          entityId: id,
          details: { projectId, name: body.name, type: body.type },
        });
        return inserted;
      })
      .catch((e: unknown) => this.nameConflict(e));
    return this.toSummary(row, data);
  }

  /** HU-1.1: segredo ausente ou vazio mantém o valor atual. */
  async update(
    ctx: AuditContext,
    id: string,
    body: UpdateCredentialBody,
  ): Promise<CredentialSummary> {
    const row = await this.load(id);
    const current = await this.decrypt(row);
    const data = this.validate(row.type, this.types.merge(row.type, current, body.data ?? {}));
    const { blob, keyVersion, keyProvider } = await encryptCredentialData(data, this.keys, id);
    const changedFields = Object.keys(body.data ?? {}).filter((f) => body.data?.[f] !== '');
    const updated = await this.db
      .transaction()
      .execute(async (trx) => {
        const saved = await trx
          .updateTable('credentials')
          .set({
            name: body.name ?? row.name,
            data_encrypted: blob,
            key_version: keyVersion,
            key_provider: keyProvider,
            updated_at: new Date(),
          })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, ctx, {
          action: 'credential.update',
          entityType: 'credential',
          entityId: id,
          // Só os nomes dos campos alterados, nunca os valores.
          details: {
            projectId: row.project_id,
            name: saved.name,
            type: row.type,
            fields: changedFields,
          },
        });
        return saved;
      })
      .catch((e: unknown) => this.nameConflict(e));
    return this.toSummary(updated, data);
  }

  async delete(ctx: AuditContext, id: string): Promise<void> {
    const row = await this.load(id);
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('credentials').where('id', '=', id).execute();
      await this.audit.record(trx, ctx, {
        action: 'credential.delete',
        entityType: 'credential',
        entityId: id,
        details: { projectId: row.project_id, name: row.name, type: row.type },
      });
    });
  }

  /** FR-005: testa a conexão; a mensagem passa pelo mascaramento antes de sair (FR-003). */
  async test(
    ctx: AuditContext,
    id: string,
    body: TestCredentialBody,
  ): Promise<CredentialTestResponse> {
    const row = await this.load(id);
    const credential = await this.resolved(row);
    let result: CredentialTestResponse;
    try {
      result = await testCredential(
        credential,
        { guard: this.guard },
        body.url ? { url: body.url } : {},
      );
    } catch (error) {
      if (error instanceof CredentialTestInputError) throw new UnprocessableError(error.message);
      throw error;
    }
    const secrets = new Set(this.types.secretValues(row.type, credential.data));
    const safe = { ok: result.ok, message: redactSecrets(result.message, secrets) };
    await this.audit.record(this.db, ctx, {
      action: 'credential.test',
      entityType: 'credential',
      entityId: id,
      details: { projectId: row.project_id, name: row.name, type: row.type, ok: safe.ok },
    });
    return safe;
  }

  /**
   * Para o motor: a credencial do nó, só se for do projeto do workflow (outro projeto = não
   * encontrada), com os valores a mascarar nos dados gravados.
   */
  async resolveForExecution(
    projectId: string,
    credentialId: string | undefined,
  ): Promise<CredentialAccess> {
    const row = credentialId
      ? await this.db
          .selectFrom('credentials')
          .selectAll()
          .where('id', '=', credentialId)
          .where('project_id', '=', projectId)
          .executeTakeFirst()
      : undefined;
    if (!row) throw new Error('Credencial não encontrada neste projeto');
    const credential = await this.resolved(row);
    return { credential, secrets: this.types.secretValues(row.type, credential.data) };
  }

  /** Tipos de credencial existentes no projeto, por id (validação ao salvar workflows). */
  async typesById(projectId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('credentials')
      .select(['id', 'type'])
      .where('project_id', '=', projectId)
      .where('id', 'in', ids)
      .execute();
    return new Map(rows.map((r) => [r.id, r.type]));
  }

  private async postgres<T>(
    id: string,
    fn: (pool: ReturnType<PoolManager['get']>) => Promise<T>,
  ): Promise<T> {
    const row = await this.load(id);
    if (row.type !== 'postgres')
      throw new UnprocessableError('A credencial não é do tipo PostgreSQL');
    const credential = await this.resolved(row);
    try {
      return await fn(this.pools.get(credential));
    } catch (error) {
      const secrets = new Set(this.types.secretValues(row.type, credential.data));
      const message = error instanceof Error ? error.message : String(error);
      throw new UnprocessableError(
        `Não foi possível consultar o banco: ${redactSecrets(message, secrets)}`,
      );
    }
  }

  /** FR-016: catálogo do banco da credencial. */
  postgresSchemas(id: string): Promise<string[]> {
    return this.postgres(id, (pool) => listSchemas(pool));
  }

  postgresTables(id: string, schema: string): Promise<string[]> {
    return this.postgres(id, (pool) => listTables(pool, schema));
  }

  postgresColumns(id: string, schema: string, table: string): Promise<PostgresColumn[]> {
    return this.postgres(id, (pool) => listColumns(pool, schema, table));
  }
}
