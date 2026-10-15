import { migrateLegacyOutputParser } from './legacy-output-parser.js';
import { migrateLegacyPostgres } from './legacy-postgres.js';
import type { WorkflowDefinition } from './workflow.js';

/**
 * Spec 016 (13/10/2026): o Agentix ganhou o payload por lista de propriedades (`payloadMode:
 * 'fields'`, padrão dos nós novos). Um Agentix salvo antes não tem `payloadMode` e continua no
 * JSON: o modo é explicitado, para o formulário e a execução ficarem iguais.
 */
export function migrateLegacyAgentixPayload<T extends WorkflowDefinition>(
  definition: T,
): { definition: T; changed: boolean } {
  if (!definition.nodes.some((n) => n.type === 'ai.agentix' && !('payloadMode' in n.params))) {
    return { definition, changed: false };
  }
  return {
    definition: {
      ...definition,
      nodes: definition.nodes.map((n) =>
        n.type === 'ai.agentix' && !('payloadMode' in n.params)
          ? { ...n, params: { ...n.params, payloadMode: 'json' } }
          : n,
      ),
    },
    changed: true,
  };
}

/**
 * Formatos antigos de parâmetros convertidos para o atual, na leitura, no salvamento, na execução
 * e na importação (as versões publicadas não são reescritas): output parser (spec 018, FR-006),
 * payload do Agentix (spec 016) e nós PostgreSQL da spec 004 → nó único (spec 022, FR-008). Pura e
 * idempotente.
 */
export function migrateLegacyDefinition<T extends WorkflowDefinition>(
  definition: T,
): { definition: T; changed: boolean } {
  const parser = migrateLegacyOutputParser(definition);
  const agentix = migrateLegacyAgentixPayload(parser.definition);
  const postgres = migrateLegacyPostgres(agentix.definition);
  return {
    definition: postgres.definition,
    changed: parser.changed || agentix.changed || postgres.changed,
  };
}
