import { describe, expect, it } from 'vitest';
import {
  accessor,
  fieldExpression,
  inferSchema,
  insertExpression,
  suggest,
} from './expression-utils';

const items = [
  {
    json: {
      nome: 'Ana',
      idade: 34,
      cliente: { cidade: 'Recife', cep: '50000' },
      tags: ['a'],
      'nome completo': 'Ana S.',
    },
  },
  { json: { nome: 'Bruno', extra: true } },
];

describe('spec 003 — FR-017/FR-018: schema, arrastar campo e autocomplete', () => {
  it('FR-017: infere o schema juntando as chaves dos itens', () => {
    const schema = inferSchema(items);
    expect(schema.map((f) => [f.key, f.type])).toEqual([
      ['nome', 'string'],
      ['idade', 'number'],
      ['cliente', 'object'],
      ['tags', 'array'],
      ['nome completo', 'string'],
      ['extra', 'boolean'],
    ]);
    expect(schema[2]?.children?.map((c) => c.path)).toEqual([
      ['cliente', 'cidade'],
      ['cliente', 'cep'],
    ]);
  });

  it('SC-005: campo da entrada vira $json; de outro nó, $("Nó").item.json', () => {
    expect(fieldExpression(['nome'], { kind: 'input' })).toBe('$json.nome');
    expect(fieldExpression(['cliente', 'cidade'], { kind: 'input' })).toBe('$json.cliente.cidade');
    expect(fieldExpression(['nome completo'], { kind: 'input' })).toBe('$json["nome completo"]');
    expect(fieldExpression(['id'], { kind: 'node', name: 'Busca' })).toBe(
      "$('Busca').item.json.id",
    );
    expect(fieldExpression(['id'], { kind: 'node', name: "D'Ávila" })).toBe(
      "$('D\\'Ávila').item.json.id",
    );
    expect(accessor(['lista', 0, 'x'])).toBe('.lista[0].x');
  });

  it('SC-005: soltar em valor fixo cria a expressão; em expressão, insere no cursor', () => {
    expect(insertExpression('texto fixo', '$json.nome')).toEqual({
      value: '={{ $json.nome }}',
      caret: 17,
    });
    expect(insertExpression(undefined, '$json.a').value).toBe('={{ $json.a }}');
    expect(insertExpression('=Olá !', '$json.nome', 5).value).toBe('=Olá {{ $json.nome }}!');
    expect(insertExpression('=Olá', '$json.nome').value).toBe('=Olá{{ $json.nome }}');
  });

  const ctx = {
    input: inferSchema(items),
    nodes: { Busca: inferSchema([{ json: { id: 1, pedido: { total: 9 } } }]), 'Outro nó': [] },
  };

  it('FR-018: sugere campos da entrada depois de $json.', () => {
    expect(suggest('={{ $json.', ctx)?.items.map((i) => i.label)).toEqual([
      'nome',
      'idade',
      'cliente',
      'tags',
      'extra',
    ]);
    expect(suggest('={{ $json.no', ctx)).toMatchObject({
      from: 10,
      items: [{ label: 'nome', insert: 'nome' }],
    });
    expect(suggest('={{ $json.cliente.c', ctx)?.items.map((i) => i.label)).toEqual([
      'cidade',
      'cep',
    ]);
  });

  it('FR-018: sugere nós e os campos de um nó', () => {
    expect(suggest("={{ $('", ctx)?.items.map((i) => i.insert)).toEqual(["Busca')", "Outro nó')"]);
    expect(suggest("={{ $('Busca').item.json.", ctx)?.items.map((i) => i.label)).toEqual([
      'id',
      'pedido',
    ]);
    expect(suggest("={{ $('Busca').item.json.pedido.t", ctx)?.items.map((i) => i.label)).toEqual([
      'total',
    ]);
  });

  it('FR-018: sugere variáveis ao digitar $; nada fora de {{ }}', () => {
    expect(suggest('={{ $v', ctx)?.items.map((i) => i.label)).toEqual(['$vars']);
    expect(suggest('={{ $', ctx)?.items.length).toBeGreaterThan(5);
    expect(suggest('=$json.', ctx)).toBeNull();
    expect(suggest('={{ $json.nome }} $json.', ctx)).toBeNull();
  });
});
