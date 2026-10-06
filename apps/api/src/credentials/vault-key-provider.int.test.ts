import { randomBytes } from 'node:crypto';
import {
  EnvKeyProvider,
  KeyRing,
  VaultTransitKeyProvider,
  createKeyRing,
  decryptCredentialData,
  encryptCredentialData,
} from '@olly/db';
import type { CredentialSummary, ProjectSummary } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';
import { startTestVault, type TestVault } from '../testing/vault.js';
import { CredentialsService, KEY_PROVIDER } from './credentials.service.js';
import { rotateCredentialKeys } from './key-rotation.js';

let vault: TestVault;
let ctx: TestContext;
let admin: TestUser;
let project: ProjectSummary;
const masterKey = randomBytes(32).toString('base64');

beforeAll(async () => {
  vault = await startTestVault();
  ctx = await startTestContext(
    { credentials: { keyProvider: 'vault', masterKey, vault: vault.options } },
    { worker: false },
  );
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  project = (await admin.call('POST', '/projects', { name: 'Cofre' })).json<ProjectSummary>();
}, 180_000);

afterAll(async () => {
  await ctx.close();
  await vault.stop();
});

const createCredential = async (name: string) => {
  const res = await admin.call('POST', `/projects/${project.id}/credentials`, {
    name,
    type: 'httpBearer',
    data: { token: `segredo-${name}` },
  });
  expect(res.statusCode).toBe(201);
  return res.json<CredentialSummary>();
};

const rows = () =>
  ctx.database.db.selectFrom('credentials').select(['id', 'key_provider', 'key_version']).execute();

describe('spec 009 — FR-001: chave mestra no Vault Transit', () => {
  it('FR-001: a DEK é cifrada pelo Vault (a KEK não sai do Vault) e a credencial funciona', async () => {
    const provider = new VaultTransitKeyProvider(vault.options);
    const dek = randomBytes(32);
    const { wrapped, keyVersion } = await provider.wrap(dek);
    expect(wrapped.toString()).toMatch(/^vault:v1:/);
    expect(keyVersion).toBe(1);
    expect(await provider.unwrap(wrapped, 1)).toEqual(dek);

    const cred = await createCredential('api-vault');
    const row = await ctx.database.db
      .selectFrom('credentials')
      .select(['key_provider', 'key_version', 'data_encrypted'])
      .where('id', '=', cred.id)
      .executeTakeFirstOrThrow();
    expect(row.key_provider).toBe('vault');
    expect(row.data_encrypted.toString()).not.toContain('segredo-api-vault');
    const resolved = await ctx.app.get(CredentialsService).resolveForExecution(project.id, cred.id);
    expect(resolved.credential.data).toEqual({ token: 'segredo-api-vault' });
  });

  it('FR-001: seleção por configuração, sem token fixo (AppRole); segredo errado falha de forma controlada', async () => {
    expect(createKeyRing({ provider: 'vault', vault: vault.options }).current.id).toBe('vault');
    const wrong = new VaultTransitKeyProvider({ ...vault.options, secretId: 'errado' });
    await expect(wrong.wrap(randomBytes(32))).rejects.toThrow(/Falha ao autenticar no Vault/);
    await expect(wrong.wrap(randomBytes(32))).rejects.not.toThrow(/errado/);
  });
});

describe('spec 009 — FR-002/SC-002: rotação sem parada, idempotente e retomável', () => {
  it('FR-002/SC-002/NFR-001: recifra tudo na versão nova enquanto a API continua decifrando', async () => {
    const keys = ctx.app.get<KeyRing>(KEY_PROVIDER);
    const service = ctx.app.get(CredentialsService);
    const created: string[] = [];
    for (let i = 0; i < 120; i++) created.push((await createCredential(`rot-${i}`)).id);

    // Nova versão da chave no Vault (operação de infraestrutura).
    const provider = keys.current as VaultTransitKeyProvider;
    expect(await provider.rotateKey()).toBe(2);

    // Leituras contínuas durante a rotação: nenhuma pode falhar.
    let reads = 0;
    const state = { stop: false };
    const reader = (async () => {
      while (!state.stop) {
        const id = created[reads % created.length] as string;
        const r = await service.resolveForExecution(project.id, id);
        expect(r.credential.data).toBeDefined();
        reads++;
      }
    })();

    // Interrompida no meio (falha depois do primeiro lote) e retomada.
    await expect(
      rotateCredentialKeys(ctx.database.db, keys, new AuditService(), {
        onProgress: () => {
          throw new Error('interrompida');
        },
      }),
    ).rejects.toThrow('interrompida');
    const midway = await rows();
    expect(midway.some((r) => r.key_version === 2)).toBe(true);
    expect(midway.some((r) => r.key_version === 1)).toBe(true);

    const report = await rotateCredentialKeys(ctx.database.db, keys, new AuditService());
    state.stop = true;
    await reader;
    expect(reads).toBeGreaterThan(0);
    expect(report.failed).toBe(0);
    expect((await rows()).every((r) => r.key_provider === 'vault' && r.key_version === 2)).toBe(
      true,
    );
    // Idempotente: nada a fazer na segunda vez.
    expect((await rotateCredentialKeys(ctx.database.db, keys, new AuditService())).rewrapped).toBe(
      0,
    );
    // Novas credenciais já nascem na versão 2.
    const fresh = await createCredential('depois');
    expect((await rows()).find((r) => r.id === fresh.id)?.key_version).toBe(2);

    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select(['action', 'details'])
      .where('action', 'like', 'credential.key.rotate.%')
      .orderBy('id')
      .execute();
    expect(audit.map((a) => a.action)).toContain('credential.key.rotate.progress');
    expect(audit.at(-1)?.action).toBe('credential.key.rotate.finish');
    expect(JSON.stringify(audit)).not.toContain('segredo-');
  }, 60_000);
});

describe('spec 009 — FR-003: migração do provedor local para o cofre', () => {
  it('FR-003: credenciais cifradas com `env` passam para o Vault; depois o `env` pode sair', async () => {
    const env = new EnvKeyProvider(masterKey);
    const envRing = new KeyRing(env);
    // Simula credenciais antigas (spec 004) gravadas com o provedor local.
    const legacy: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = crypto.randomUUID();
      const { blob, keyVersion, keyProvider } = await encryptCredentialData(
        { token: `legado-${i}` },
        envRing,
        id,
      );
      await ctx.database.db
        .insertInto('credentials')
        .values({
          id,
          project_id: project.id,
          name: `legado-${i}`,
          type: 'httpBearer',
          data_encrypted: blob,
          key_version: keyVersion,
          key_provider: keyProvider,
        })
        .execute();
      legacy.push(id);
    }
    const keys = ctx.app.get<KeyRing>(KEY_PROVIDER);
    // Durante a migração, a API lê os dois provedores.
    const service = ctx.app.get(CredentialsService);
    expect((await service.resolveForExecution(project.id, legacy[0])).credential.data).toEqual({
      token: 'legado-0',
    });

    const report = await rotateCredentialKeys(ctx.database.db, keys, new AuditService(), {
      from: 'env',
    });
    expect(report.rewrapped).toBe(5);
    const migrated = await ctx.database.db
      .selectFrom('credentials')
      .select(['id', 'key_provider', 'data_encrypted'])
      .where('id', 'in', legacy)
      .execute();
    expect(migrated.every((r) => r.key_provider === 'vault')).toBe(true);
    const vaultOnly = new KeyRing(new VaultTransitKeyProvider(vault.options));
    for (const r of migrated) {
      expect(await decryptCredentialData(r.data_encrypted, vaultOnly, r.id)).toHaveProperty(
        'token',
      );
    }
    expect((await rows()).every((r) => r.key_provider === 'vault')).toBe(true);
  });
});
