import type { NodeDefinition } from '../../types.js';
import { executeManualTrigger } from './execute.js';

/** Gatilho manual (FR-017, spec 002). Equivale ao `n8n-nodes-base.manualTrigger`. */
export const manualTrigger: NodeDefinition = {
  type: 'trigger.manual',
  version: 1,
  displayName: 'Gatilho manual',
  description: 'Inicia o workflow manualmente, com os itens recebidos ou um item vazio.',
  icon: 'play',
  category: 'trigger',
  inputs: [],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: executeManualTrigger,
};
