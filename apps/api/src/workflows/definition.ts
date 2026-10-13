import { migrateLegacyOutputParser, type WorkflowDefinition } from '@olly/shared-types';

/**
 * Definição lida do banco (rascunho, versões, execuções), com o formato antigo do output parser
 * migrado (spec 018, FR-006). As linhas gravadas não mudam: as versões publicadas são imutáveis.
 */
export function readDefinition(raw: unknown): WorkflowDefinition {
  return migrateLegacyOutputParser(raw as WorkflowDefinition).definition;
}
