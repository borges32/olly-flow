import { createHash } from 'node:crypto';
import type {
  McpSnapshotDiff,
  McpToolChange,
  McpToolDefinition,
  McpToolsSnapshot,
} from '@olly/shared-types';

/** JSON com as chaves ordenadas: a mesma tool gera o mesmo texto em qualquer ordem. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  // `undefined` (ex.: item de array) vira `null`, como no JSON.stringify de arrays.
  return jsonPrimitive(value) ?? 'null';
}

function jsonPrimitive(value: unknown): string | undefined {
  return JSON.stringify(value);
}

/** Hash de nome + descrição + `inputSchema` canônicos (plan §2). */
export function toolHash(tool: McpToolDefinition): string {
  const canonical = canonicalJson({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Snapshot das tools anunciadas, gravado na aprovação do servidor (FR-003). */
export function snapshotTools(tools: readonly McpToolDefinition[]): McpToolsSnapshot {
  const snapshot: McpToolsSnapshot = {};
  for (const tool of tools) {
    snapshot[tool.name] = {
      ...(tool.description !== undefined && { description: tool.description }),
      inputSchema: tool.inputSchema,
      hash: toolHash(tool),
    };
  }
  return snapshot;
}

/** Diferenças entre o snapshot aprovado e as tools anunciadas agora (vazio = iguais). */
export function diffTools(
  snapshot: McpToolsSnapshot,
  tools: readonly McpToolDefinition[],
): McpToolChange[] {
  const changes: McpToolChange[] = [];
  const current = new Map(tools.map((t) => [t.name, t]));
  const view = (t: { description?: string; inputSchema: Record<string, unknown> }) => ({
    ...(t.description !== undefined && { description: t.description }),
    inputSchema: t.inputSchema,
  });
  for (const [name, approved] of Object.entries(snapshot)) {
    const now = current.get(name);
    if (!now) changes.push({ name, kind: 'removed', before: view(approved) });
    else if (toolHash(now) !== approved.hash) {
      changes.push({ name, kind: 'changed', before: view(approved), after: view(now) });
    }
  }
  for (const tool of tools) {
    if (!(tool.name in snapshot))
      changes.push({ name: tool.name, kind: 'added', after: view(tool) });
  }
  return changes.sort((a, b) => a.name.localeCompare(b.name));
}

/** Divergência a gravar para revisão, ou `null` se não há mudança. */
export function snapshotDiff(
  snapshot: McpToolsSnapshot,
  tools: readonly McpToolDefinition[],
  now = new Date(),
): McpSnapshotDiff | null {
  const changes = diffTools(snapshot, tools);
  return changes.length ? { detectedAt: now.toISOString(), changes } : null;
}

/**
 * Tools liberadas que não podem ser chamadas (FR-003): mudaram ou sumiram desde a aprovação.
 * Tools novas não bloqueiam nada: continuam negadas até serem liberadas.
 */
export function blockedTools(diff: McpSnapshotDiff | null | undefined): Set<string> {
  return new Set((diff?.changes ?? []).filter((c) => c.kind !== 'added').map((c) => c.name));
}
