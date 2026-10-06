import type { McpServerOption } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { mcpLoadOptions } from './mcp-options';

const soma = { name: 'soma', inputSchema: { type: 'object' } };
const servers: McpServerOption[] = [
  { id: 's1', name: 'Com tools', description: '', transport: 'streamableHttp', tools: [soma] },
  { id: 's2', name: 'Sem liberação', description: '', transport: 'streamableHttp', tools: [] },
];

describe('spec 010 — FR-002/FR-009: opções de servidor e tool no nó Cliente MCP', () => {
  it('FR-009: lista os servidores do projeto e as tools liberadas do servidor escolhido', () => {
    expect(mcpLoadOptions('mcpServers', servers, '').options).toEqual([
      { value: 's1', label: 'Com tools' },
      { value: 's2', label: 'Sem liberação' },
    ]);
    expect(mcpLoadOptions('mcpTools', servers, 's1')).toEqual({
      options: [{ value: 'soma', label: 'soma' }],
      hint: undefined,
    });
  });

  it('FR-002: servidor sem tools liberadas explica por que a lista está vazia', () => {
    const result = mcpLoadOptions('mcpTools', servers, 's2');
    expect(result.options).toEqual([]);
    expect(result.hint).toMatch(/Nenhuma tool liberada para este projeto/);
    expect(result.hint).toMatch(/Administração › MCP/);
  });

  it('FR-009: sem servidor escolhido ou sem servidores, orienta o usuário', () => {
    expect(mcpLoadOptions('mcpTools', servers, '')).toEqual({
      options: undefined,
      hint: 'Selecione o servidor MCP para listar as tools.',
    });
    expect(mcpLoadOptions('mcpServers', [], '').hint).toBe(
      'Nenhum servidor MCP aprovado neste projeto.',
    );
    // Servidor que saiu do catálogo (ou de outro projeto): não lista nada.
    expect(mcpLoadOptions('mcpTools', servers, 'removido').hint).toMatch(/não está disponível/);
  });
});
