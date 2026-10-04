import { describe, expect, it } from 'vitest';
import type { NodeContext } from '../../types.js';
import { executeSetVariable } from './execute.js';

function ctx(params: Record<string, unknown>[], vars: Record<string, unknown>): NodeContext {
  return {
    getParam: (name: string, i: number) => params[i]?.[name],
    setVariable: (name: string, value: unknown) => {
      vars[name] = value;
    },
  } as unknown as NodeContext;
}

describe('spec 003 — FR-009: data.setVariable', () => {
  it('FR-009: grava variáveis e repassa os itens inalterados', async () => {
    const vars: Record<string, unknown> = {};
    const items = [{ json: { a: 1 } }];
    const out = await executeSetVariable(
      { inputs: { main: items }, items },
      ctx(
        [
          {
            variables: [
              { name: 'total', value: 10 },
              { name: ' cliente ', value: { id: 7 } },
            ],
          },
        ],
        vars,
      ),
    );
    expect(vars).toEqual({ total: 10, cliente: { id: 7 } });
    expect(out).toEqual({ main: [{ json: { a: 1 }, pairedItem: { item: 0 } }] });
  });

  it('FR-009: com vários itens, o último valor prevalece', async () => {
    const vars: Record<string, unknown> = {};
    const items = [{ json: {} }, { json: {} }];
    await executeSetVariable(
      { inputs: { main: items }, items },
      ctx(
        [{ variables: [{ name: 'x', value: 1 }] }, { variables: [{ name: 'x', value: 2 }] }],
        vars,
      ),
    );
    expect(vars).toEqual({ x: 2 });
  });

  it('FR-009: nome vazio é rejeitado', async () => {
    const items = [{ json: {} }];
    await expect(
      executeSetVariable(
        { inputs: { main: items }, items },
        ctx([{ variables: [{ name: '  ', value: 1 }] }], {}),
      ),
    ).rejects.toThrow(/nome da variável vazio/);
  });
});
