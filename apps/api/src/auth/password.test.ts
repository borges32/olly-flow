import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblems, verifyPassword } from './password.js';

describe('spec 014 — NFR-001: política de senha', () => {
  it('NFR-001: mínimo de 12 caracteres', () => {
    expect(passwordProblems('curta-123', 'ana@olly.local')).toEqual([
      'A senha precisa ter pelo menos 12 caracteres',
    ]);
    expect(passwordProblems('uma frase longa e boa', 'ana@olly.local')).toEqual([]);
  });

  it('NFR-001: recusa senhas comuns e senhas com o e-mail', () => {
    expect(passwordProblems('password1234', 'ana@olly.local')).toEqual([
      'A senha é comum demais; escolha outra',
    ]);
    expect(passwordProblems('Qwerty123456', 'ana@olly.local')).toEqual([
      'A senha é comum demais; escolha outra',
    ]);
    expect(passwordProblems('anabeatriz-2026!', 'anabeatriz@olly.local')).toEqual([
      'A senha não pode conter o e-mail',
    ]);
  });

  it('NFR-001: limite máximo (evita hashing de textos enormes)', () => {
    expect(passwordProblems('x'.repeat(257), 'ana@olly.local')).toEqual([
      'A senha pode ter no máximo 256 caracteres',
    ]);
  });
});

// scrypt com os parâmetros OWASP (~128 MiB, ~0,1 s por hash): com a suíte em paralelo, folga.
const HASH_TIMEOUT = 30_000;

/** Custo baixo para os casos de lógica: a suíte roda em paralelo com testes sensíveis a tempo. */
const LOW_COST = { n: 1024, r: 8, p: 1 };

describe('spec 014 — NFR-002: hash de senha', () => {
  it(
    'NFR-002: o custo padrão é o da OWASP (scrypt N=2^17, r=8, p=1) e não guarda a senha',
    async () => {
      const hash = await hashPassword('uma frase longa e boa');
      expect(hash).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
      expect(hash).not.toContain('frase');
    },
    HASH_TIMEOUT,
  );

  it('NFR-002: sal por senha; confere só a senha certa', async () => {
    const a = await hashPassword('uma frase longa e boa', LOW_COST);
    const b = await hashPassword('uma frase longa e boa', LOW_COST);
    expect(a).not.toBe(b);
    expect(await verifyPassword('uma frase longa e boa', a)).toBe(true);
    expect(await verifyPassword('outra frase longa', a)).toBe(false);
  });

  it('NFR-002: hash inválido ou ausente nunca confere', async () => {
    expect(await verifyPassword('qualquer coisa aqui', 'texto-claro')).toBe(false);
    expect(await verifyPassword('qualquer coisa aqui', null)).toBe(false);
  });
});
