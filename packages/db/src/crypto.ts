import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Guarda a chave mestra (KEK) e cifra/decifra as chaves de dados (DEK). Substituível
 * (constituição VI): o provedor institucional (Vault/KMS, ADR-0007) entra na spec 009.
 */
export interface KeyProvider {
  currentKeyVersion(): number;
  wrap(dek: Buffer): Promise<Buffer>;
  unwrap(wrapped: Buffer, keyVersion: number): Promise<Buffer>;
}

export class CredentialCryptoError extends Error {
  override name = 'CredentialCryptoError';
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;

interface Sealed {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

function seal(key: Buffer, plaintext: Buffer, aad?: Buffer): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function open(key: Buffer, { iv, tag, ciphertext }: Sealed, aad?: Buffer): Buffer {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // A mensagem do Node não traz dados, mas padronizamos para não depender disso.
    throw new CredentialCryptoError('Não foi possível decifrar a credencial');
  }
}

/** Chave mestra em `OLLY_MASTER_KEY` (base64 de 32 bytes): provedor de desenvolvimento. */
export class EnvKeyProvider implements KeyProvider {
  private readonly kek: Buffer;

  constructor(
    masterKeyBase64: string | undefined,
    private readonly version = 1,
  ) {
    const kek = Buffer.from(masterKeyBase64 ?? '', 'base64');
    if (kek.length !== 32) {
      throw new CredentialCryptoError('OLLY_MASTER_KEY deve ser uma chave de 32 bytes em base64');
    }
    this.kek = kek;
  }

  currentKeyVersion(): number {
    return this.version;
  }

  wrap(dek: Buffer): Promise<Buffer> {
    const { iv, tag, ciphertext } = seal(this.kek, dek);
    return Promise.resolve(Buffer.concat([iv, tag, ciphertext]));
  }

  unwrap(wrapped: Buffer, keyVersion: number): Promise<Buffer> {
    if (keyVersion !== this.version) {
      return Promise.reject(
        new CredentialCryptoError(`Versão de chave mestra desconhecida: ${keyVersion}`),
      );
    }
    return Promise.resolve(
      open(this.kek, {
        iv: wrapped.subarray(0, IV_BYTES),
        tag: wrapped.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
        ciphertext: wrapped.subarray(IV_BYTES + TAG_BYTES),
      }),
    );
  }
}

interface Envelope {
  v: number;
  kekVersion: number;
  encDek: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

/**
 * FR-001: cifra os dados com uma DEK nova (AES-256-GCM) e cifra a DEK com a chave mestra.
 * `aad` (o id da credencial) amarra o conteúdo ao registro: trocar envelopes entre credenciais
 * no banco faz a decifragem falhar.
 */
export async function encryptCredentialData(
  data: Record<string, unknown>,
  provider: KeyProvider,
  aad: string,
): Promise<{ blob: Buffer; keyVersion: number }> {
  const dek = randomBytes(32);
  try {
    const sealed = seal(dek, Buffer.from(JSON.stringify(data), 'utf8'), Buffer.from(aad));
    const keyVersion = provider.currentKeyVersion();
    const envelope: Envelope = {
      v: ENVELOPE_VERSION,
      kekVersion: keyVersion,
      encDek: (await provider.wrap(dek)).toString('base64'),
      iv: sealed.iv.toString('base64'),
      tag: sealed.tag.toString('base64'),
      ciphertext: sealed.ciphertext.toString('base64'),
    };
    return { blob: Buffer.from(JSON.stringify(envelope), 'utf8'), keyVersion };
  } finally {
    dek.fill(0);
  }
}

export async function decryptCredentialData(
  blob: Buffer,
  provider: KeyProvider,
  aad: string,
): Promise<Record<string, unknown>> {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(blob.toString('utf8')) as Envelope;
  } catch {
    throw new CredentialCryptoError('Envelope de credencial inválido');
  }
  if (envelope.v !== ENVELOPE_VERSION)
    throw new CredentialCryptoError('Versão de envelope desconhecida');
  const dek = await provider.unwrap(Buffer.from(envelope.encDek, 'base64'), envelope.kekVersion);
  try {
    const plaintext = open(
      dek,
      {
        iv: Buffer.from(envelope.iv, 'base64'),
        tag: Buffer.from(envelope.tag, 'base64'),
        ciphertext: Buffer.from(envelope.ciphertext, 'base64'),
      },
      Buffer.from(aad),
    );
    return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
  } finally {
    dek.fill(0);
  }
}
