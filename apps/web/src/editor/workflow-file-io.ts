import type { NodeDescription } from '@olly/nodes';
import {
  fromWorkflowFile,
  resolveCredentialRef,
  toWorkflowFile,
  type AvailableCredential,
  type ImportIssue,
  type NodeTypeCatalog,
  type WorkflowDefinition,
} from '@olly/shared-types';
import { copySelection, type Clipboard } from './graph';

/** Catálogo da conversão a partir da lista `/node-types` (spec 015). */
export function catalogFrom(types: ReadonlyMap<string, NodeDescription>): NodeTypeCatalog {
  return { get: (type) => types.get(type) };
}

/**
 * FR-019: nós selecionados (e as conexões entre eles) como o JSON do arquivo, para a área de
 * transferência. Das credenciais, só o tipo, o id e o nome.
 */
export function selectionAsFileText(
  definition: Pick<WorkflowDefinition, 'nodes' | 'edges'>,
  selectedIds: string[],
  catalog: NodeTypeCatalog,
  credentials: AvailableCredential[],
): string | null {
  if (selectedIds.length === 0) return null;
  const selected = copySelection(definition.nodes, definition.edges, selectedIds);
  const byId = new Map(credentials.map((c) => [c.id, c]));
  const file = toWorkflowFile(
    { nodes: selected.nodes, edges: selected.edges, settings: {} },
    {
      catalog,
      fragment: true,
      credentialOf: (id) => {
        const c = byId.get(id);
        return c && { type: c.type, name: c.name };
      },
    },
  );
  return JSON.stringify(file, null, 2);
}

export type PastedFile =
  { ok: true; clipboard: Clipboard; pending: ImportIssue[] } | { ok: false; errors: ImportIssue[] };

/** Parece um JSON de workflow (objeto com `nodes`)? Texto comum cola pelo fluxo interno. */
export function looksLikeWorkflowJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') && t.includes('"nodes"');
}

/**
 * FR-020: texto colado no formato do arquivo → nós e conexões para acrescentar ao canvas, com
 * as mesmas regras de conversão, credenciais e nós marcadores da importação. Com erro, nada é
 * acrescentado.
 */
export function parsePastedFile(
  text: string,
  catalog: NodeTypeCatalog,
  credentials: AvailableCredential[],
  newId: () => string,
): PastedFile {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          code: 'IMPORT_INVALID_JSON',
          message: `O texto colado não é um JSON válido: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  const result = fromWorkflowFile(value, { catalog, newId, fragment: true });
  if (result.issues.errors.length > 0) return { ok: false, errors: result.issues.errors };
  const pending = [...result.issues.pending];
  const byId = new Map(result.definition.nodes.map((n) => [n.id, n]));
  for (const ref of result.credentialRefs) {
    const node = byId.get(ref.nodeId);
    if (!node) continue;
    const found = resolveCredentialRef(ref, credentials, catalog.get(node.type)?.credentialTypes);
    if (found) node.credentialId = found.id;
    else {
      pending.push({
        code: 'CREDENTIAL_PENDING',
        message: `Nó "${node.name}": escolha a credencial ${ref.type}${ref.name ? ` ("${ref.name}")` : ''}`,
        node: node.name,
      });
    }
  }
  return {
    ok: true,
    clipboard: { nodes: result.definition.nodes, edges: result.definition.edges },
    pending,
  };
}

/** Salva um JSON como arquivo no navegador (FR-006). */
export function downloadJson(content: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
