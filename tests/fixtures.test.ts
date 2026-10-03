import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { read, readJson, root } from './helpers.js';

const BASE = 'fixtures/n8n';
const cases = readdirSync(join(root, BASE), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

interface N8nWorkflow {
  nodes: { name: string; type: string }[];
  connections: Record<string, unknown>;
}

describe('FR-016: estrutura das fixtures da POC N8N', () => {
  it('FR-016: o formato está documentado e há ao menos um caso', () => {
    expect(read(`${BASE}/README.md`)).toMatch(
      /workflow\.json[\s\S]*input\.json[\s\S]*expected\.json[\s\S]*notes\.md/,
    );
    expect(cases.length).toBeGreaterThan(0);
  });

  describe.each(cases)('FR-016: caso %s', (name) => {
    const dir = `${BASE}/${name}`;

    it('FR-016: tem os quatro arquivos e nome em kebab-case', () => {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      for (const f of ['workflow.json', 'input.json', 'expected.json', 'notes.md']) {
        expect(existsSync(join(root, dir, f)), `${dir}/${f}`).toBe(true);
      }
    });

    it('FR-016: entrada e saída referenciam nós existentes no workflow', () => {
      const workflow = readJson(`${dir}/workflow.json`) as N8nWorkflow;
      const names = workflow.nodes.map((n) => n.name);
      expect(workflow.connections).toBeTypeOf('object');

      const input = readJson(`${dir}/input.json`) as {
        trigger: string;
        items: { json: unknown }[];
      };
      expect(names).toContain(input.trigger);
      expect(input.items.every((i) => typeof i.json === 'object')).toBe(true);

      const expected = readJson(`${dir}/expected.json`) as Record<
        string,
        Record<string, { json: unknown }[]>
      >;
      for (const [node, ports] of Object.entries(expected)) {
        expect(names).toContain(node);
        for (const items of Object.values(ports)) expect(Array.isArray(items)).toBe(true);
      }
    });

    it('FR-016: notes.md declara origem e versão do N8N', () => {
      const notes = read(`${dir}/notes.md`);
      expect(notes).toMatch(/\*\*Origem:\*\* (POC|sintético)/);
      expect(notes).toMatch(/\*\*Versão do N8N:\*\*/);
    });
  });
});
