import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Guarda a chave mestra (KEK) e cifra/decifra as chaves de dados (DEK). Substituível
 * (constituição VI): `env` (desenvolvimento) e `vault` (Vault Transit, spec 009 / ADR-0007).
 */
export interface KeyProvider {
  /** Identificador gravado no envelope e em `credentials.key_provider`. */
  readonly id: string;
  /** Versão atual da chave mestra (a que `wrap` usa). */
  currentKeyVersion(): Promise<number>;
  wrap(dek: Buffer): Promise<{ wrapped: Buffer; keyVersion: number }>;
  unwrap(wrapped: Buffer, keyVersion: number): Promise<Buffer>;
}

/**
 * Provedores de chave mestra conhecidos (spec 009, FR-001 a FR-003): `current` cifra as DEKs
 * novas; os demais continuam decifrando o que ainda não foi migrado (migração sem parada).
 */
export class KeyRing {
  private readonly byId = new Map<string, KeyProvider>();

  constructor(
    readonly current: KeyProvider,
    others: KeyProvider[] = [],
  ) {
    for (const p of [...others, current]) this.byId.set(p.id, p);
  }

  provider(id: string): KeyProvider {
    const p = this.byId.get(id);
    if (!p) throw new CredentialCryptoError(`Provedor de chave mestra não configurado: ${id}`);
    return p;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }
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

function parseKek(base64: string | undefined): Buffer {
  const kek = Buffer.from(base64 ?? '', 'base64');
  if (kek.length !== 32) {
    throw new CredentialCryptoError('OLLY_MASTER_KEY deve ser uma chave de 32 bytes em base64');
  }
  return kek;
}

/**
 * Chave mestra em `OLLY_MASTER_KEY` (base64 de 32 bytes): provedor de desenvolvimento. Para a
 * rotação (spec 009, FR-002), as chaves anteriores ficam em `previous` (versão → base64).
 */
export class EnvKeyProvider implements KeyProvider {
  readonly id = 'env';
  private readonly keks = new Map<number, Buffer>();

  constructor(
    masterKeyBase64: string | undefined,
    private readonly version = 1,
    previous: Record<number, string> = {},
  ) {
    for (const [v, key] of Object.entries(previous)) this.keks.set(Number(v), parseKek(key));
    this.keks.set(version, parseKek(masterKeyBase64));
  }

  currentKeyVersion(): Promise<number> {
    return Promise.resolve(this.version);
  }

  wrap(dek: Buffer): Promise<{ wrapped: Buffer; keyVersion: number }> {
    const { iv, tag, ciphertext } = seal(this.kek(this.version), dek);
    return Promise.resolve({
      wrapped: Buffer.concat([iv, tag, ciphertext]),
      keyVersion: this.version,
    });
  }

  unwrap(wrapped: Buffer, keyVersion: number): Promise<Buffer> {
    if (!this.keks.has(keyVersion)) {
      return Promise.reject(
        new CredentialCryptoError(`Versão de chave mestra desconhecida: ${keyVersion}`),
      );
    }
    return Promise.resolve(
      open(this.kek(keyVersion), {
        iv: wrapped.subarray(0, IV_BYTES),
        tag: wrapped.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
        ciphertext: wrapped.subarray(IV_BYTES + TAG_BYTES),
      }),
    );
  }

  private kek(version: number): Buffer {
    const kek = this.keks.get(version);
    if (!kek) throw new CredentialCryptoError(`Versão de chave mestra desconhecida: ${version}`);
    return kek;
  }
}

interface Envelope {
  v: number;
  /** Provedor da chave mestra (spec 009); ausente nos envelopes da spec 004 = `env`. */
  kp?: string;
  kekVersion: number;
  encDek: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface SealedCredential {
  blob: Buffer;
  keyVersion: number;
  keyProvider: string;
}

/**
 * FR-001 (spec 004): cifra os dados com uma DEK nova (AES-256-GCM) e cifra a DEK com a chave
 * mestra atual. `aad` (o id da credencial) amarra o conteúdo ao registro: trocar envelopes entre
 * credenciais no banco faz a decifragem falhar.
 */
export async function encryptCredentialData(
  data: Record<string, unknown>,
  keys: KeyRing,
  aad: string,
): Promise<SealedCredential> {
  const dek = randomBytes(32);
  try {
    const sealed = seal(dek, Buffer.from(JSON.stringify(data), 'utf8'), Buffer.from(aad));
    const { wrapped, keyVersion } = await keys.current.wrap(dek);
    const envelope: Envelope = {
      v: ENVELOPE_VERSION,
      kp: keys.current.id,
      kekVersion: keyVersion,
      encDek: wrapped.toString('base64'),
      iv: sealed.iv.toString('base64'),
      tag: sealed.tag.toString('base64'),
      ciphertext: sealed.ciphertext.toString('base64'),
    };
    return {
      blob: Buffer.from(JSON.stringify(envelope), 'utf8'),
      keyVersion,
      keyProvider: keys.current.id,
    };
  } finally {
    dek.fill(0);
  }
}

function parseEnvelope(blob: Buffer): Envelope {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(blob.toString('utf8')) as Envelope;
  } catch {
    throw new CredentialCryptoError('Envelope de credencial inválido');
  }
  if (envelope.v !== ENVELOPE_VERSION)
    throw new CredentialCryptoError('Versão de envelope desconhecida');
  return envelope;
}

export async function decryptCredentialData(
  blob: Buffer,
  keys: KeyRing,
  aad: string,
): Promise<Record<string, unknown>> {
  const envelope = parseEnvelope(blob);
  const dek = await keys
    .provider(envelope.kp ?? 'env')
    .unwrap(Buffer.from(envelope.encDek, 'base64'), envelope.kekVersion);
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

/** Provedor e versão da chave mestra que cifrou o envelope. */
export function envelopeKey(blob: Buffer): { keyProvider: string; keyVersion: number } {
  const envelope = parseEnvelope(blob);
  return { keyProvider: envelope.kp ?? 'env', keyVersion: envelope.kekVersion };
}

/**
 * Rotação e migração (spec 009, FR-002, FR-003): recifra só a DEK com a chave mestra atual. Os
 * dados cifrados pela DEK não mudam (nem são decifrados).
 */
export async function rewrapCredentialData(blob: Buffer, keys: KeyRing): Promise<SealedCredential> {
  const envelope = parseEnvelope(blob);
  const dek = await keys
    .provider(envelope.kp ?? 'env')
    .unwrap(Buffer.from(envelope.encDek, 'base64'), envelope.kekVersion);
  try {
    const { wrapped, keyVersion } = await keys.current.wrap(dek);
    const next: Envelope = {
      ...envelope,
      kp: keys.current.id,
      kekVersion: keyVersion,
      encDek: wrapped.toString('base64'),
    };
    return {
      blob: Buffer.from(JSON.stringify(next), 'utf8'),
      keyVersion,
      keyProvider: keys.current.id,
    };
  } finally {
    dek.fill(0);
  }
}
