import { DEFAULT_MASKING_RULES, type MaskingRuleSpec } from '@olly/shared-types';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createMasker,
  isValidCnpj,
  isValidCpf,
  maskingRuleProblem,
  passesLuhn,
} from './masking.js';

const SALT = 'salt-de-teste';
const defaults = createMasker(DEFAULT_MASKING_RULES, { salt: SALT });
const CPF = '529.982.247-25';
const CNPJ = '11.222.333/0001-81';
const CARD = '4111 1111 1111 1111';

describe('spec 009 — FR-014: validação dos detectores', () => {
  it('FR-014: CPF, CNPJ e cartão exigem dígito verificador / Luhn (sem falsos positivos)', () => {
    expect(isValidCpf(CPF)).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-26')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCnpj(CNPJ)).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(passesLuhn(CARD)).toBe(true);
    expect(passesLuhn('4111 1111 1111 1112')).toBe(false);
  });
});

describe('spec 009 — FR-014/FR-016: mascaramento com as regras padrão', () => {
  it('FR-016: CPF, CNPJ e cartão mascarados parcialmente; senha, token e authorization ocultos', () => {
    const { value, changed } = defaults.mask({
      main: [
        {
          json: {
            documento: CPF,
            empresa: CNPJ,
            cartao: CARD,
            password: 'segredo-123',
            api_token: 'abc123',
            headers: { Authorization: 'Bearer xyz' },
            nome: 'Maria',
          },
        },
      ],
    });
    expect(changed).toBe(true);
    expect(value.main[0]?.json).toEqual({
      documento: '***.***.247-**',
      empresa: '**.***.***/0001-**',
      cartao: '**** **** **** 1111',
      password: '***',
      api_token: '***',
      headers: { Authorization: '***' },
      nome: 'Maria',
    });
  });

  it('FR-014: CPF no meio de texto livre é mascarado (caso de borda)', () => {
    const { value } = defaults.mask({
      obs: `Cliente de CPF ${CPF} ligou; CPF 52998224725 também.`,
    });
    expect(value.obs).toBe('Cliente de CPF ***.***.247-** ligou; CPF ***.***.247-** também.');
  });

  it('FR-014: objetos aninhados e arrays em qualquer profundidade', () => {
    const { value } = defaults.mask({
      a: [[{ b: { c: [`x ${CPF}`, { senha: 1 }] } }]],
    });
    expect(value).toEqual({ a: [[{ b: { c: ['x ***.***.247-**', { senha: '***' }] } }]] });
  });

  it('FR-014: CPF guardado como número também é mascarado', () => {
    expect(defaults.mask({ doc: 52998224725 }).value).toEqual({ doc: '***.***.247-**' });
    expect(defaults.mask({ total: 12345678901 }).value).toEqual({ total: 12345678901 });
  });

  it('FR-014: números parecidos com CPF mas inválidos não são mascarados', () => {
    const input = { pedido: '123.456.789-00', telefone: '(11) 91234-5678' };
    const { value, changed } = defaults.mask(input);
    expect(changed).toBe(false);
    expect(value).toBe(input);
  });

  it('FR-014: JWT e chaves de API em texto são ocultados', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJh';
    const { value } = defaults.mask({
      msg: `token ${jwt} e chave sk-abcdefghijklmnop1234 e AKIAABCDEFGHIJKLMNOP`,
    });
    expect(value.msg).toBe('token *** e chave *** e ***');
  });

  it('FR-015: o valor original nunca é alterado', () => {
    const input = { main: [{ json: { cpf: CPF, password: 'x' } }] };
    const snapshot = structuredClone(input);
    defaults.mask(input);
    expect(input).toEqual(snapshot);
  });
});

describe('spec 009 — FR-014: regras e ações', () => {
  it('FR-014: ações ocultar, parcial e hash (com salt)', () => {
    const rules: MaskingRuleSpec[] = [
      { kind: 'field', matcher: 'a', action: 'redact' },
      { kind: 'field', matcher: 'b', action: 'partial' },
      { kind: 'field', matcher: 'c', action: 'hash' },
    ];
    const m = createMasker(rules, { salt: SALT });
    const { value } = m.mask({ a: 'valor-a', b: 'abcdefghijkl', c: 'valor-c', d: 'livre' });
    expect(value.a).toBe('***');
    expect(value.b).toBe('***ijkl');
    expect(value.c).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(value.d).toBe('livre');
    // Mesmo valor, mesmo hash (permite correlacionar); outro salt, outro hash.
    expect(m.mask({ c: 'valor-c' }).value.c).toBe(value.c);
    expect(createMasker(rules, { salt: 'outro' }).mask({ c: 'valor-c' }).value.c).not.toBe(value.c);
  });

  it('FR-014: glob com ponto compara o caminho do campo; sem ponto, só o nome', () => {
    const m = createMasker([{ kind: 'field', matcher: 'cliente.nome', action: 'redact' }], {
      salt: SALT,
    });
    const { value } = m.mask({ main: [{ json: { cliente: { nome: 'Ana' }, nome: 'Loja' } }] });
    expect(value.main[0]?.json).toEqual({ cliente: { nome: '***' }, nome: 'Loja' });
  });

  it('FR-014: e-mail e telefone (regras disponíveis, desligadas por padrão)', () => {
    const m = createMasker(
      [
        { kind: 'pattern', matcher: 'email', action: 'partial' },
        { kind: 'pattern', matcher: 'phone', action: 'partial' },
      ],
      { salt: SALT },
    );
    expect(m.mask({ x: 'fale com maria@exemplo.com ou (11) 91234-5678' }).value.x).toBe(
      'fale com m***@exemplo.com ou (**) *****-5678',
    );
    expect(defaults.mask({ x: 'maria@exemplo.com' }).changed).toBe(false);
  });

  it('FR-014: campo mascarado inteiro, mesmo objeto ou número', () => {
    const m = createMasker([{ kind: 'field', matcher: '*token*', action: 'redact' }], {
      salt: SALT,
    });
    expect(m.mask({ tokens: { a: 1 }, token_count: 3 }).value).toEqual({
      tokens: '***',
      token_count: '***',
    });
  });

  it('FR-014: matcher inválido é recusado na validação', () => {
    expect(maskingRuleProblem({ kind: 'pattern', matcher: 'rg', action: 'redact' })).toMatch(
      /Detector desconhecido/,
    );
    expect(maskingRuleProblem({ kind: 'field', matcher: '*', action: 'redact' })).toMatch(/todos/);
    expect(maskingRuleProblem({ kind: 'field', matcher: 'a(b)', action: 'redact' })).not.toBeNull();
    expect(maskingRuleProblem({ kind: 'field', matcher: '*cpf*', action: 'redact' })).toBeNull();
  });

  it('FR-014: maskText mascara mensagens de log', () => {
    expect(defaults.maskText(`falha no CPF ${CPF}`)).toBe('falha no CPF ***.***.247-**');
  });

  it('FR-014 (bug): objeto cíclico não trava o mascaramento', () => {
    // Antes: com duas referências ao próprio objeto, o percurso era 2^64 (só o limite de
    // profundidade o parava) e a API ficava com 100% de CPU.
    const node: Record<string, unknown> = { cpf: CPF };
    node.a = node;
    node.b = node;
    node.c = [node, node];
    const t0 = performance.now();
    const { value } = defaults.mask({ node });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(value.node.cpf).toBe('***.***.247-**');
  });

  it('FR-014: objetos simples de outro realm (sandbox vm) continuam mascarados', () => {
    const foreign = runInNewContext(
      `({ doc: '${CPF}', senha: 'x', lista: [{ cartao: '${CARD}' }] })`,
    ) as object;
    expect(defaults.mask({ foreign }).value).toEqual({
      foreign: { doc: '***.***.247-**', senha: '***', lista: [{ cartao: '**** **** **** 1111' }] },
    });
  });

  it('FR-014 (bug): campo sensível com valor cíclico é ocultado sem erro', () => {
    const token: Record<string, unknown> = {};
    token.self = token;
    const m = createMasker([{ kind: 'field', matcher: 'token', action: 'hash' }], { salt: SALT });
    expect(m.mask({ token }).value).toEqual({ token: '***' });
  });

  it('FR-014 (bug): instâncias de classe (req/res do log HTTP) não são percorridas', () => {
    class Socket {
      server: unknown;
      peers: unknown[] = [];
    }
    class Response {
      socket = new Socket();
      cpf = CPF;
    }
    const res = new Response();
    res.socket.server = res;
    res.socket.peers = Array.from({ length: 8 }, () => res);
    const log = { res, responseTime: 3 };
    const t0 = performance.now();
    const { value, changed } = defaults.mask(log);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(changed).toBe(false);
    expect(value.res).toBe(res);
  });
});

describe('spec 009 — NFR-002: custo do mascaramento', () => {
  it('NFR-002: 1000 itens típicos mascarados em poucos milissegundos', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      json: {
        id: i,
        nome: `Cliente ${i}`,
        email: `c${i}@exemplo.com`,
        cpf: CPF,
        endereco: { rua: 'Rua A', numero: i, cidade: 'Brasília' },
        tags: ['a', 'b', 'c'],
        observacao: 'texto livre sem dados sensíveis, apenas para ocupar espaço',
      },
    }));
    const data = { main: items };
    const serialize = () => JSON.stringify(data);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) serialize();
    const serializeMs = (performance.now() - t0) / 5;
    const t1 = performance.now();
    for (let i = 0; i < 5; i++) defaults.mask(data);
    const maskMs = (performance.now() - t1) / 5;
    // Referência: gravar envolve serializar e escrever no banco; o mascaramento custa da ordem
    // da serialização. A medição comparativa com a gravação fica no relatório.
    expect(maskMs).toBeLessThan(Math.max(50, serializeMs * 20));
  });
});
