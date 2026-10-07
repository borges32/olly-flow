import { resolveNodePorts } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { createNodeRegistry } from '../../builtin.js';
import { fakeContext } from '../../test-support/context.js';
import { PLACEHOLDER_NODE_TYPE, placeholderNode } from './definition.js';

describe('spec 015 — FR-016: nó marcador de nó não suportado', () => {
  it('é registrado e tem as portas das conexões originais (inclusive de sub-nó)', () => {
    expect(createNodeRegistry().get(PLACEHOLDER_NODE_TYPE)).toBeDefined();
    const node = { params: { ports: { inputs: ['main', 'main'], outputs: ['ai_tool'] } } };
    expect(resolveNodePorts(placeholderNode, node)).toEqual({
      inputs: [
        { name: 'in0', kind: 'main' },
        { name: 'in1', kind: 'main' },
      ],
      outputs: [{ name: 'out0', kind: 'ai_tool' }],
    });
    // Sem portas (ou com valores inválidos): uma entrada e uma saída principais.
    for (const params of [{}, { ports: { inputs: ['x'], outputs: 'main' } }]) {
      expect(resolveNodePorts(placeholderNode, { params })).toEqual({
        inputs: [{ name: 'in0', kind: 'main' }],
        outputs: [{ name: 'out0', kind: 'main' }],
      });
    }
  });

  it('falha ao executar ou ao fornecer dados, citando o tipo original', async () => {
    const ctx = fakeContext({ params: { originalType: 'n8n-nodes-base.slack' } });
    await expect(placeholderNode.execute({ inputs: { main: [] }, items: [] }, ctx)).rejects.toThrow(
      /Nó não suportado \(n8n-nodes-base\.slack\)/,
    );
    await expect(placeholderNode.supplyData?.(ctx, 0)).rejects.toThrow(/não suportado/);
  });
});
