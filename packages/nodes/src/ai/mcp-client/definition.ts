import { MCP_CREDENTIAL_TYPES, MCP_OPERATIONS } from '@olly/shared-types';
import type { JSONSchema7, NodeDefinition } from '../../types.js';
import { executeMcpClient } from './execute.js';

const when = (show: Record<string, unknown[]>) => ({ 'x-display-options': { show } });

export const mcpClientParamsSchema: JSONSchema7 = {
  type: 'object',
  required: ['serverId', 'operation'],
  properties: {
    serverId: {
      type: 'string',
      title: 'Servidor MCP',
      description: 'Servidores aprovados no catálogo e disponíveis no projeto.',
      default: '',
      'x-load-options': 'mcpServers',
      'x-no-expression': true,
    } as JSONSchema7,
    operation: {
      type: 'string',
      title: 'Operação',
      enum: [...MCP_OPERATIONS],
      default: 'callTool',
    },
    toolName: {
      type: 'string',
      title: 'Tool',
      description: 'Só as tools liberadas para o projeto.',
      default: '',
      'x-load-options': 'mcpTools',
      'x-no-expression': true,
      ...when({ operation: ['callTool'] }),
    } as JSONSchema7,
    argumentsMode: {
      type: 'string',
      title: 'Argumentos',
      description: '`form`: formulário gerado do schema da tool; `json`: objeto JSON ou expressão.',
      enum: ['form', 'json'],
      default: 'form',
      ...when({ operation: ['callTool'] }),
    } as JSONSchema7,
    arguments: {
      type: 'object',
      title: 'Argumentos da tool',
      default: {},
      'x-mcp-arguments': 'serverId',
      ...when({ operation: ['callTool'], argumentsMode: ['form'] }),
    } as JSONSchema7,
    argumentsJson: {
      type: 'string',
      title: 'Argumentos (JSON)',
      default: '{}',
      'x-multiline': true,
      ...when({ operation: ['callTool'], argumentsMode: ['json'] }),
    } as JSONSchema7,
    resourceUri: {
      type: 'string',
      title: 'URI do resource',
      default: '',
      ...when({ operation: ['readResource'] }),
    } as JSONSchema7,
    promptName: {
      type: 'string',
      title: 'Prompt',
      default: '',
      ...when({ operation: ['getPrompt'] }),
    } as JSONSchema7,
    promptArguments: {
      type: 'array',
      title: 'Argumentos do prompt',
      default: [],
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Nome', minLength: 1 },
          value: { type: 'string', title: 'Valor', default: '' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      ...when({ operation: ['getPrompt'] }),
    } as JSONSchema7,
  },
};

/**
 * Cliente MCP (spec 010, FR-008 a FR-010; plan §5): chama tools, lê resources e obtém prompts
 * de servidores do catálogo, com a governança aplicada pelo `McpGateway` (política, snapshot,
 * registro e auditoria). Equivale ao "MCP Client" do N8N.
 */
export const mcpClientNode: NodeDefinition = {
  type: 'ai.mcpClient',
  version: 1,
  displayName: 'Cliente MCP',
  description: 'Chama tools, lê resources e obtém prompts de servidores MCP aprovados.',
  icon: 'plug-zap',
  category: 'ai',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: mcpClientParamsSchema,
  credentialTypes: [...MCP_CREDENTIAL_TYPES],
  supportsParallelItems: true,
  execute: executeMcpClient,
};
