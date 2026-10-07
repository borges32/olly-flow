import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateWorkflow } from '@olly/engine';
import { createNodeRegistry } from '@olly/nodes';
import { fromWorkflowFile } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';

/**
 * Spec 015, FR-021/FR-022/SC-003: a documentação do formato (docs/nos/workflow-json.md) cobre
 * todos os tipos de nó da plataforma, e os exemplos completos (marcados com
 * `<!-- exemplo-completo -->`) são importáveis sem erros.
 */
const DOC = readFileSync(new URL('../../../../docs/nos/workflow-json.md', import.meta.url), 'utf8');
const registry = createNodeRegistry();
const examples = [...DOC.matchAll(/<!-- exemplo-completo -->\n```json\n([\s\S]*?)```/g)].map(
  (m) => m[1] ?? '',
);

describe('spec 015 — FR-021/FR-022: documentação do formato para pessoas e modelos de IA', () => {
  it('SC-003: todo tipo de nó registrado está documentado', () => {
    const missing = registry
      .list()
      .map((t) => t.type)
      .filter((type) => !DOC.includes(`\`${type}\``));
    expect(missing).toEqual([]);
  });

  it('SC-003: há exemplos completos e todos são importáveis sem erros', () => {
    expect(examples.length).toBeGreaterThanOrEqual(7);
    const covered = new Set<string>();
    for (const text of examples) {
      const result = fromWorkflowFile(JSON.parse(text) as unknown, {
        catalog: { get: (t) => registry.get(t) },
        newId: randomUUID,
      });
      const name = result.name;
      expect(result.issues.errors, name).toEqual([]);
      expect(result.issues.pending, name).toEqual([]);
      expect(validateWorkflow(result.definition, registry), name).toEqual({
        errors: [],
        warnings: [],
      });
      for (const n of result.definition.nodes) covered.add(n.type);
    }
    // Os exemplos cobrem webhook, If, Merge, laços, Switch e Agent com ferramentas (SC-004).
    for (const type of [
      'trigger.webhook',
      'logic.if',
      'logic.merge',
      'logic.loopOverItems',
      'logic.while',
      'logic.switch',
      'ai.agent',
      'tool.httpRequest',
    ]) {
      expect(covered, type).toContain(type);
    }
  });
});
