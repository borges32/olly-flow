import { describe, expect, it } from 'vitest';
import { orderByClause, whereClause } from './conditions.js';

const known = ['id', 'nome', 'idade', 'ativo'];
const ensure = (name: string, where: string) => {
  if (!known.includes(name)) throw new Error(`${where}: coluna "${name}" não existe`);
  return name;
};
const params = () => {
  const values: unknown[] = [];
  const param = (v: unknown) => {
    values.push(v);
    return `$${String(values.length)}`;
  };
  return { values, param };
};

describe('spec 022 — condições e ordenação', () => {
  it('FR-005/FR-006: operadores do N8N, colunas entre aspas e valores só como parâmetros', () => {
    const { values, param } = params();
    const sql = whereClause(
      [
        { column: 'nome', condition: 'LIKE', value: '%ana%' },
        { column: 'idade', condition: '>=', value: 18 },
        { column: 'id', condition: '!=', value: 7 },
        { column: 'ativo', condition: 'IS NOT NULL', value: 'ignorado' },
        { column: 'id', value: 3 },
      ],
      'AND',
      ensure,
      param,
    );
    expect(sql).toBe(
      ' WHERE "nome" LIKE $1 AND "idade" >= $2 AND "id" <> $3 AND "ativo" IS NOT NULL AND "id" = $4',
    );
    expect(values).toEqual(['%ana%', 18, 7, 3]);
  });

  it('FR-005: OR combina; sem condições, sem WHERE; injeção no valor fica no parâmetro', () => {
    const { values, param } = params();
    expect(
      whereClause(
        [
          { column: 'nome', condition: 'equal', value: "x'; DROP TABLE clientes; --" },
          { column: 'idade', condition: 'IS NULL' },
        ],
        'OR',
        ensure,
        param,
      ),
    ).toBe(' WHERE "nome" = $1 OR "idade" IS NULL');
    expect(values).toEqual(["x'; DROP TABLE clientes; --"]);
    expect(whereClause([], 'AND', ensure, param)).toBe('');
  });

  it('FR-006: coluna inexistente ou operador desconhecido falham antes do SQL', () => {
    const { param } = params();
    expect(() => whereClause([{ column: 'senha' }], 'AND', ensure, param)).toThrow(
      'where[0].column: coluna "senha" não existe',
    );
    expect(() => whereClause([{ column: 'id', condition: 'IN' }], 'AND', ensure, param)).toThrow(
      'operador desconhecido',
    );
  });

  it('FR-003: ORDER BY com direção; padrão ASC', () => {
    expect(
      orderByClause([{ column: 'idade', direction: 'DESC' }, { column: 'nome' }], ensure),
    ).toBe(' ORDER BY "idade" DESC, "nome" ASC');
    expect(orderByClause([], ensure)).toBe('');
  });
});
