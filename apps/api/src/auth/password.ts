import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@olly/shared-types';

/** Parâmetros OWASP para scrypt (N=2^17, r=8, p=1): ~128 MiB e ~0,1 s por hash. */
const N = 131_072;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p, maxmem: MAX_MEMORY };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export interface ScryptCost {
  n: number;
  r: number;
  p: number;
}
const DEFAULT_COST: ScryptCost = { n: N, r: R, p: P };

/**
 * Hash da senha (spec 014, NFR-002): `scrypt$N$r$p$sal$hash`, base64. O custo padrão é o da
 * OWASP; outro custo só nos testes (a verificação lê os parâmetros do próprio hash).
 */
export async function hashPassword(
  password: string,
  cost: ScryptCost = DEFAULT_COST,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost.n, cost.r, cost.p);
  return `scrypt$${String(cost.n)}$${String(cost.r)}$${String(cost.p)}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Confere a senha em tempo constante; hash ausente ou inválido nunca confere. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split('$') ?? [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(keyB64, 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  const key = await derive(
    password,
    Buffer.from(saltB64, 'base64'),
    Number(n),
    Number(r),
    Number(p),
  );
  return timingSafeEqual(key, expected);
}

/** Hash fictício: o login de e-mail inexistente gasta o mesmo tempo (não revela o e-mail). */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString('base64'));
  return dummy;
}

/**
 * Senhas comuns com 12 caracteres ou mais (as menores já são recusadas pelo tamanho), em
 * minúsculas. Lista curta e embutida: complementa o tamanho mínimo, não o substitui.
 */
const COMMON = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456123456',
  '111111111111',
  '000000000000',
  '123123123123',
  '112233445566',
  '121212121212',
  '987654321098',
  'password1234',
  'password123!',
  'password@123',
  'passw0rd1234',
  'password12345',
  'passwordpassword',
  'qwerty123456',
  'qwertyuiop12',
  'qwertyuiopas',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'q1w2e3r4t5y6',
  'asdfghjkl123',
  'zxcvbnm12345',
  'iloveyou1234',
  'administrator',
  'administrador',
  'admin1234567',
  'admin@123456',
  'adminadmin12',
  'welcome12345',
  'welcome@1234',
  'letmein12345',
  'changeme1234',
  'trocarsenha1',
  'senha1234567',
  'senha@123456',
  'senhasenha12',
  'minhasenha12',
  'mudar@123456',
  'abcdefghijkl',
  'abc123abc123',
  'abcd1234abcd',
  'aaaaaaaaaaaa',
  'football1234',
  'baseball1234',
  'superman1234',
  'batman123456',
  'princess1234',
  'sunshine1234',
  'brasil123456',
  'flamengo1234',
  'corinthians1',
  'palmeiras123',
  'saopaulo1234',
]);

/** Problemas da senha conforme a política (spec 014, NFR-001); vazio = aceita. */
export function passwordProblems(password: string, email: string): string[] {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return [`A senha precisa ter pelo menos ${String(PASSWORD_MIN_LENGTH)} caracteres`];
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return [`A senha pode ter no máximo ${String(PASSWORD_MAX_LENGTH)} caracteres`];
  }
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return ['A senha é comum demais; escolha outra'];
  const local = email.split('@')[0]?.trim().toLowerCase() ?? '';
  if (local.length >= 4 && lower.includes(local)) return ['A senha não pode conter o e-mail'];
  return [];
}
