import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CredentialCryptoError,
  EnvKeyProvider,
  KeyRing,
  decryptCredentialData,
  encryptCredentialData,
  envelopeKey,
  rewrapCredentialData,
} from './crypto.js';

const key = randomBytes(32).toString('base64');
const provider = new KeyRing(new EnvKeyProvider(key));
const SECRET = 'sentinela-super-secreta-123';

describe('spec 004 — FR-001: envelope encryption das credenciais', () => {
  it('FR-001: round-trip devolve os dados e o envelope não contém o segredo em claro', async () => {
    const { blob, keyVersion } = await encryptCredentialData(
      { user: 'ana', password: SECRET },
      provider,
      'cred-1',
    );
    expect(keyVersion).toBe(1);
    expect(blob.toString('utf8')).not.toContain(SECRET);
    expect(blob.toString('utf8')).not.toContain(Buffer.from(SECRET).toString('base64'));
    expect(await decryptCredentialData(blob, provider, 'cred-1')).toEqual({
      user: 'ana',
      password: SECRET,
    });
  });

  it('FR-001: cada credencial tem sua própria DEK (mesmos dados, envelopes diferentes)', async () => {
    const envelopeOf = async () =>
      JSON.parse((await encryptCredentialData({ x: 1 }, provider, 'c')).blob.toString()) as Record<
        string,
        string
      >;
    const [a, b] = await Promise.all([envelopeOf(), envelopeOf()]);
    expect(a.encDek).not.toBe(b.encDek);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('FR-001: tag adulterada, outra chave mestra ou outro id (AAD) falham', async () => {
    const { blob } = await encryptCredentialData({ password: SECRET }, provider, 'cred-1');
    const envelope = JSON.parse(blob.toString()) as Record<string, string>;
    const tag = Buffer.from(envelope.tag ?? '', 'base64');
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    const tampered = Buffer.from(JSON.stringify({ ...envelope, tag: tag.toString('base64') }));
    await expect(decryptCredentialData(tampered, provider, 'cred-1')).rejects.toThrow(
      CredentialCryptoError,
    );
    const other = new KeyRing(new EnvKeyProvider(randomBytes(32).toString('base64')));
    await expect(decryptCredentialData(blob, other, 'cred-1')).rejects.toThrow(
      CredentialCryptoError,
    );
    await expect(decryptCredentialData(blob, provider, 'cred-2')).rejects.toThrow(
      CredentialCryptoError,
    );
  });

  it('FR-001: chave mestra ausente ou com tamanho errado é recusada', () => {
    expect(() => new EnvKeyProvider(undefined)).toThrow(/32 bytes/);
    expect(() => new EnvKeyProvider(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('FR-001: versão de chave mestra desconhecida falha sem revelar dados', async () => {
    const { blob } = await encryptCredentialData({ password: SECRET }, provider, 'c');
    const v2 = new KeyRing(new EnvKeyProvider(key, 2));
    await expect(decryptCredentialData(blob, v2, 'c')).rejects.toThrow(/Versão de chave/);
  });
});

describe('spec 009 — FR-002/FR-003: rotação e migração da chave mestra', () => {
  const k1 = randomBytes(32).toString('base64');
  const k2 = randomBytes(32).toString('base64');

  it('FR-002: recifra a DEK com a versão nova sem tocar nos dados; a versão antiga continua lendo', async () => {
    const ringV1 = new KeyRing(new EnvKeyProvider(k1, 1));
    const { blob } = await encryptCredentialData({ password: SECRET }, ringV1, 'c');
    const ringV2 = new KeyRing(new EnvKeyProvider(k2, 2, { 1: k1 }));
    expect(await decryptCredentialData(blob, ringV2, 'c')).toEqual({ password: SECRET });

    const rotated = await rewrapCredentialData(blob, ringV2);
    expect(rotated.keyVersion).toBe(2);
    expect(envelopeKey(rotated.blob)).toEqual({ keyProvider: 'env', keyVersion: 2 });
    const before = JSON.parse(blob.toString()) as { ciphertext: string };
    const after = JSON.parse(rotated.blob.toString()) as { ciphertext: string };
    expect(after.ciphertext).toBe(before.ciphertext);
    // Depois da rotação, a chave antiga pode sair.
    expect(
      await decryptCredentialData(rotated.blob, new KeyRing(new EnvKeyProvider(k2, 2)), 'c'),
    ).toEqual({
      password: SECRET,
    });
    // Idempotente: recifrar de novo continua válido.
    const again = await rewrapCredentialData(rotated.blob, ringV2);
    expect(await decryptCredentialData(again.blob, ringV2, 'c')).toEqual({ password: SECRET });
  });

  it('FR-003: envelope sem provedor (spec 004) é lido como `env`', async () => {
    const { blob } = await encryptCredentialData({ a: 1 }, provider, 'c');
    const legacy = JSON.parse(blob.toString()) as Record<string, unknown>;
    delete legacy.kp;
    const legacyBlob = Buffer.from(JSON.stringify(legacy));
    expect(envelopeKey(legacyBlob)).toEqual({ keyProvider: 'env', keyVersion: 1 });
    expect(await decryptCredentialData(legacyBlob, provider, 'c')).toEqual({ a: 1 });
  });

  it('FR-001: provedor ausente no chaveiro falha de forma controlada', async () => {
    const { blob } = await encryptCredentialData({ a: 1 }, provider, 'c');
    const vaultBlob = Buffer.from(JSON.stringify({ ...JSON.parse(blob.toString()), kp: 'vault' }));
    await expect(decryptCredentialData(vaultBlob, provider, 'c')).rejects.toThrow(
      /não configurado: vault/,
    );
  });
});
