import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Compara em tempo constante (NFR-003): compara os digests SHA-256, de tamanho fixo, para que o
 * tempo não revele nem o conteúdo nem o tamanho do valor esperado.
 */
export function safeEqual(a: string, b: string): boolean {
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export interface WebhookAuthInput {
  /** Cabeçalhos com nomes em minúsculas. */
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}

const header = (input: WebhookAuthInput, name: string) => {
  const v = input.headers[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
};

/** Assinatura HMAC esperada do corpo cru, no formato da credencial. */
export function hmacSignature(data: Record<string, unknown>, rawBody: Buffer): string {
  const algorithm = ['sha1', 'sha256', 'sha512'].includes(str(data.algorithm))
    ? str(data.algorithm)
    : 'sha256';
  return createHmac(algorithm, str(data.secret))
    .update(rawBody)
    .digest(data.encoding === 'base64' ? 'base64' : 'hex');
}

/**
 * Autentica a chamada do webhook pela credencial (spec 005, FR-004): header, Basic ou HMAC sobre
 * o corpo cru. Aceita a assinatura com prefixo `algoritmo=` (ex.: `sha256=...`, estilo GitHub).
 */
export function verifyWebhookAuth(
  credentialType: string,
  data: Record<string, unknown>,
  input: WebhookAuthInput,
): boolean {
  switch (credentialType) {
    case 'webhookHeaderAuth':
      return safeEqual(header(input, str(data.name)), str(data.value));
    case 'webhookBasicAuth': {
      const expected = `Basic ${Buffer.from(`${str(data.user)}:${str(data.password)}`).toString('base64')}`;
      return safeEqual(header(input, 'authorization'), expected);
    }
    case 'webhookHmac': {
      const received = header(input, str(data.headerName) || 'X-Signature').replace(
        /^[a-z0-9]+=/i,
        '',
      );
      return received !== '' && safeEqual(received, hmacSignature(data, input.rawBody));
    }
    default:
      return false;
  }
}
