import { afterAll, describe, expect, it } from 'vitest';
import { IsolateEvaluator } from './isolate.js';
import { expressionData, referencedNode } from './testing.js';
import type { EvaluateResult, ExpressionData } from './types.js';

/**
 * Suíte de compatibilidade com o N8N (FR-019, SC-002). Os valores esperados seguem a documentação
 * e o comportamento do N8N; divergências intencionais estão em docs/expressoes.md.
 */
// Limite folgado: estes testes verificam semântica, não o timeout (ver sandbox.test.ts).
const evaluator = new IsolateEvaluator({ timeoutMs: 2000 });
afterAll(() => {
  evaluator.disposeAll();
});

const data = expressionData({
  params: { x: 5 },
  input: [
    {
      json: {
        nome: 'Ana',
        sobrenome: 'Souza',
        idade: 34,
        ativo: true,
        tags: ['a', 'b'],
        endereco: { cidade: 'Recife' },
        nulo: null,
        preco: 10.5,
      },
      binary: { arquivo: { id: 'obj/1', mimeType: 'application/pdf' } },
    },
    { json: { nome: 'Bruno', idade: 16, ativo: false, tags: [] } },
  ],
  nodes: {
    Busca: referencedNode([{ json: { id: 1 } }, { json: { id: 2 } }], { params: { url: 'x' } }),
    If: referencedNode([], {
      outputs: { true: [{ json: { v: 'sim' } }], false: [{ json: { v: 'nao' } }] },
      outputOrder: ['true', 'false'],
    }),
    NaoExecutado: referencedNode([], { executed: false }),
  },
  paired: [
    { Busca: { port: 'main', index: 1 } },
    { Busca: { error: 'Item correspondente indisponível em "Busca"' } },
  ],
  vars: { limite: 10 },
  env: { API_URL: 'https://api.local' },
});

async function evaluate(
  template: string,
  itemIndex = 0,
  d: ExpressionData = data,
): Promise<EvaluateResult> {
  const [result] = await evaluator.evaluateBatch({
    executionId: 'compat',
    data: d,
    requests: [{ id: 'r', template, itemIndex }],
  });
  if (!result) throw new Error('sem resultado');
  return result;
}

const value = async (template: string, itemIndex = 0) => {
  const r = await evaluate(template, itemIndex);
  if (!r.ok) throw new Error(`${template}: ${r.error.message}`);
  return r.value;
};

type Case = [description: string, template: string, expected: unknown, itemIndex?: number];

const cases: Case[] = [
  // Templates e tipos (FR-001, FR-002)
  ['texto com campo', '=Olá {{ $json.nome }}', 'Olá Ana'],
  ['número preserva o tipo', '={{ $json.idade }}', 34],
  ['booleano preserva o tipo', '={{ $json.ativo }}', true],
  ['array preserva o tipo', '={{ $json.tags }}', ['a', 'b']],
  ['objeto preserva o tipo', '={{ $json.endereco }}', { cidade: 'Recife' }],
  ['número em template misto vira texto', '=Idade: {{ $json.idade }}', 'Idade: 34'],
  ['objeto em template misto vira JSON', '=Obj: {{ $json.endereco }}', 'Obj: {"cidade":"Recife"}'],
  ['array em template misto vira JSON', '=Arr: {{ $json.tags }}', 'Arr: ["a","b"]'],
  ['indefinido em template misto vira vazio', '=x{{ $json.inexistente }}y', 'xy'],
  ['nulo em template misto vira vazio', '=x{{ $json.nulo }}y', 'xy'],
  ['indefinido sozinho', '={{ $json.inexistente }}', undefined],
  ['nulo sozinho', '={{ $json.nulo }}', null],
  ['vários trechos', '=a {{ 1 }} b {{ 2 }}', 'a 1 b 2'],
  ['sem trechos de código', '=sem expressão', 'sem expressão'],
  ['template vazio', '=', ''],
  ['"}}" dentro de string', '={{ "}}" }}', '}}'],
  ['objeto literal aninhado', '={{ {a: {b: 1}} }}', { a: { b: 1 } }],
  ['template literal com crases', '={{ `${$json.nome}!` }}', 'Ana!'],
  ['comentário no fim do trecho', '={{ $json.idade // comentário }}', 34],
  ['IIFE com instruções', '={{ (function(){ const a = 2; return a * 3; })() }}', 6],
  // JavaScript
  ['aritmética', '={{ $json.idade + 1 }}', 35],
  ['método de string', '={{ $json.nome.toUpperCase() }}', 'ANA'],
  ['propriedade length', '={{ $json.nome.length }}', 3],
  ['comparação', '={{ $json.idade >= 18 }}', true],
  ['ternário', '={{ $json.idade >= 18 ? "adulto" : "menor" }}', 'adulto'],
  ['optional chaining', '={{ $json.endereco?.rua?.nome }}', undefined],
  ['nullish coalescing', '={{ $json.apelido ?? "sem apelido" }}', 'sem apelido'],
  ['map e join', '={{ $json.tags.map(t => t.toUpperCase()).join(",") }}', 'A,B'],
  ['includes', '={{ $json.tags.includes("a") }}', true],
  ['filter', '={{ [1, 2, 3].filter(n => n > 1) }}', [2, 3]],
  ['Object.keys', '={{ Object.keys($json.endereco) }}', ['cidade']],
  ['JSON.stringify', '={{ JSON.stringify({ a: 1 }) }}', '{"a":1}'],
  ['Math', '={{ Math.max(1, 5, 3) }}', 5],
  ['toFixed', '={{ $json.preco.toFixed(2) }}', '10.50'],
  ['spread', '={{ [..."abc"].length }}', 3],
  ['parseInt e Number', '={{ parseInt("42", 10) + Number("1.5") }}', 43.5],
  ['encodeURIComponent', '={{ encodeURIComponent("a b") }}', 'a%20b'],
  ['reverse', '={{ $json.nome.split("").reverse().join("") }}', 'anA'],
  ['função vira indefinido', '={{ () => 1 }}', undefined],
  ['Date vira ISO', '={{ new Date(0) }}', '1970-01-01T00:00:00.000Z'],
  // $json, $binary, $itemIndex, $input (FR-003)
  ['$json do segundo item', '={{ $json.nome }}', 'Bruno', 1],
  ['$itemIndex', '={{ $itemIndex }}', 1, 1],
  ['$binary', '={{ $binary.arquivo.mimeType }}', 'application/pdf'],
  ['$binary vazio', '={{ $binary }}', {}, 1],
  ['$input.all()', '={{ $input.all().length }}', 2],
  ['$input.first()', '={{ $input.first().json.nome }}', 'Ana'],
  ['$input.last()', '={{ $input.last().json.nome }}', 'Bruno'],
  ['$input.item', '={{ $input.item.json.nome }}', 'Bruno', 1],
  ['$input.params', '={{ $input.params.x }}', 5],
  ['$parameter', '={{ $parameter.x }}', 5],
  // $('Nó') e $node (FR-003, FR-004)
  ["$('Nó').item segue o paired item", "={{ $('Busca').item.json.id }}", 2],
  ["$('Nó').first()", "={{ $('Busca').first().json.id }}", 1],
  ["$('Nó').last()", "={{ $('Busca').last().json.id }}", 2],
  ["$('Nó').all()", "={{ $('Busca').all().length }}", 2],
  ["$('Nó').params", "={{ $('Busca').params.url }}", 'x'],
  ["$('Nó').isExecuted", "={{ $('Busca').isExecuted }}", true],
  ["$('Nó').isExecuted falso", "={{ $('NaoExecutado').isExecuted }}", false],
  ["$('If').all(1): segunda saída", "={{ $('If').all(1)[0].json.v }}", 'nao'],
  ["$('If').first(): primeira saída", "={{ $('If').first().json.v }}", 'sim'],
  ["$('Nó').itemMatching()", "={{ $('Busca').itemMatching(0).json.id }}", 2],
  ['$node["Nó"].json: mesmo índice', '={{ $node["Busca"].json.id }}', 1],
  ['$node["Nó"].parameter', '={{ $node["Busca"].parameter.url }}', 'x'],
  ['$node.Nó (ponto)', '={{ $node.Busca.json.id }}', 2, 1],
  // $vars, $env, $execution, $workflow
  ['$vars', '={{ $vars.limite }}', 10],
  ['$env', '={{ $env.API_URL }}', 'https://api.local'],
  ['$execution.id', '={{ $execution.id }}', 'exec-1'],
  ['$execution.mode', '={{ $execution.mode }}', 'test'],
  ['$workflow.name', '={{ $workflow.name }}', 'Fluxo'],
  // Datas (Luxon)
  ['$now é DateTime', '={{ typeof $now.toISO() }}', 'string'],
  ['$now no fuso configurado', '={{ $now.zoneName }}', 'America/Sao_Paulo'],
  ['$today começa à meia-noite', '={{ $today.hour + $today.minute }}', 0],
  [
    'DateTime.plus',
    '={{ DateTime.fromISO("2026-10-03T10:00:00Z").setZone("UTC").plus({ days: 1 }).toISODate() }}',
    '2026-10-04',
  ],
  [
    'DateTime.toFormat',
    '={{ DateTime.fromISO("2026-10-03").toFormat("dd/MM/yyyy") }}',
    '03/10/2026',
  ],
  ['Duration', '={{ Duration.fromObject({ hours: 2 }).as("minutes") }}', 120],
  [
    'DateTime sozinho vira ISO',
    '={{ DateTime.fromISO("2026-01-01T00:00:00Z", { zone: "UTC" }) }}',
    '2026-01-01T00:00:00.000Z',
  ],
  [
    'DateTime em template misto',
    '=Data: {{ DateTime.fromISO("2026-01-01T00:00:00Z", { zone: "UTC" }) }}',
    'Data: 2026-01-01T00:00:00.000Z',
  ],
];

describe('spec 003 — FR-019/SC-002: compatibilidade de expressões com o N8N', () => {
  it('SC-002: a suíte tem pelo menos 60 casos', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
  });

  it.each(cases)('FR-019: %s', async (_description, template, expected, itemIndex = 0) => {
    expect(await value(template, itemIndex)).toEqual(expected);
  });

  it('FR-019: dados são imutáveis entre itens e expressões', async () => {
    expect(await value('={{ ($json.nome = "Outro", $json.nome) }}')).toBe('Ana');
    expect(await value('={{ $json.nome }}')).toBe('Ana');
  });
});

describe('spec 003 — FR-004/FR-007: erros de expressão', () => {
  it.each([
    ['sintaxe', '={{ $json.nome.toUpperCase( }}', 'syntax', /sintaxe/i],
    ['"{{" sem fechamento', '=Olá {{ $json.nome', 'syntax', /sem o "}}"/],
    ['acesso a propriedade de indefinido', '={{ $json.x.y.z }}', 'runtime', /undefined/],
    ['nó inexistente', "={{ $('Inexistente').item }}", 'runtime', /não existe/],
    ['nó não executado', "={{ $('NaoExecutado').first() }}", 'runtime', /ainda não foi executado/],
  ])('FR-007: %s', async (_d, template, kind, message) => {
    const r = await evaluate(template);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe(kind);
    expect(r.error.message).toMatch(message);
  });

  it('FR-004: cadeia de paired items sem correspondência gera erro claro', async () => {
    const r = await evaluate("={{ $('Busca').item.json.id }}", 1);
    expect(r).toMatchObject({
      ok: false,
      error: { kind: 'runtime', message: 'Item correspondente indisponível em "Busca"' },
    });
  });
});
