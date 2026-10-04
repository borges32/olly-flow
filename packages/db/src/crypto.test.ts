import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CredentialCryptoError,
  EnvKeyProvider,
  decryptCredentialData,
  encryptCredentialData,
} from './crypto.js';

const key = randomBytes(32).toString('base64');
const provider = new EnvKeyProvider(key);
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
    const other = new EnvKeyProvider(randomBytes(32).toString('base64'));
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
    const v2 = new EnvKeyProvider(key, 2);
    await expect(decryptCredentialData(blob, v2, 'c')).rejects.toThrow(/Versão de chave/);
  });
});
