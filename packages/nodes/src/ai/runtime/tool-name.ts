import type { WorkflowNode } from '@olly/shared-types';

/** Nome de ferramenta aceito pelos provedores (spec 011, FR-007). */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Nome da ferramenta: o parâmetro `toolName` ou, vazio, o nome do nó normalizado. */
export function toolNameOf(node: Pick<WorkflowNode, 'name' | 'params'>): string {
  const raw = node.params.toolName;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return node.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}
