import { migrateLegacyDefinition, type WorkflowDefinition } from '@olly/shared-types';

/**
 * Definição lida do banco (rascunho, versões, execuções), com os formatos antigos migrados
 * (output parser da spec 018; payload do Agentix da spec 016). As linhas gravadas não mudam: as versões publicadas são imutáveis.
 */
export function readDefinition(raw: unknown): WorkflowDefinition {
  return migrateLegacyDefinition(raw as WorkflowDefinition).definition;
}
