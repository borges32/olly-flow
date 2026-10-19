import type { NodeRegistry } from '@olly/nodes';
import type { PairedResolution } from '@olly/expressions';
import type { Item, NodeOutput, WorkflowDefinition } from '@olly/shared-types';
import type { RunView } from './state.js';

const MAX_STEPS = 10_000;

/**
 * Item correspondente em `targetId` para o item de entrada `itemIndex` de `startId` (FR-004):
 * sobe pela origem de cada item e pelo `pairedItem` das saídas até chegar ao nó alvo.
 *
 * Correção 19/10/2026: se a cadeia se rompe (ex.: um nó agregou vários itens num só sem
 * informar a origem) e o nó alvo produziu um único item, ele é o correspondente: não há outro
 * possível (como no N8N). Com mais de um item no alvo, o erro sugere `.first()`/`.all()`.
 */
export function resolvePairedItem(
  def: WorkflowDefinition,
  registry: NodeRegistry,
  view: RunView,
  startId: string,
  itemIndex: number,
  targetId: string,
): PairedResolution {
  const names = new Map(def.nodes.map((n) => [n.id, n.name]));
  const name = (id: string) => names.get(id) ?? id;
  const resolved = followPairedItems(def, registry, view, startId, itemIndex, targetId, name);
  if (!('error' in resolved)) return resolved;
  const only = singleItem(view.outputOf(targetId));
  if (only) return only;
  return {
    error:
      `${resolved.error}. Para usar um item específico, use $('${name(targetId)}').first() ` +
      `(ou .all() para todos)`,
  };
}

/** Porta e índice do único item da saída, se ela tiver exatamente um. */
function singleItem(output: NodeOutput | undefined): { port: string; index: number } | undefined {
  const ports = Object.entries(output ?? {}).filter(([, items]) => items.length > 0);
  const [only] = ports;
  return ports.length === 1 && only && only[1].length === 1
    ? { port: only[0], index: 0 }
    : undefined;
}

function followPairedItems(
  def: WorkflowDefinition,
  registry: NodeRegistry,
  view: RunView,
  startId: string,
  itemIndex: number,
  targetId: string,
  name: (id: string) => string,
): PairedResolution {
  const target = name(targetId);
  let nodeId = startId;
  let port = 'main';
  let index = itemIndex;

  for (let step = 0; step < MAX_STEPS; step++) {
    const source = view.sourcesOf(nodeId)?.[port]?.[index];
    if (!source) {
      return {
        error: `Não há caminho de itens de "${name(startId)}" até "${target}" para o item ${itemIndex}`,
      };
    }
    if (source.nodeId === targetId) return { port: source.port, index: source.index };
    const item = view.outputOf(source.nodeId)?.[source.port]?.[source.index];
    const paired = item?.pairedItem;
    if (!paired) {
      return {
        error:
          `O item ${source.index} de "${name(source.nodeId)}" não indica de qual item veio; ` +
          `não é possível chegar a "${target}"`,
      };
    }
    const node = def.nodes.find((n) => n.id === source.nodeId);
    const inputs = (node && registry.get(node.type)?.inputs) ?? [];
    port = inputs[paired.input ?? 0]?.name ?? 'main';
    nodeId = source.nodeId;
    index = paired.item;
  }
  return { error: `Cadeia de itens longa demais até "${target}"` };
}

/**
 * Preenche `pairedItem` ausente quando a origem é inequívoca (plan §4): um único item de
 * entrada, ou a porta devolveu tantos itens quanto recebeu (nós 1:1).
 */
export function fillPairedItems(output: NodeOutput, inputCount: number): NodeOutput {
  if (inputCount === 0) return output;
  return Object.fromEntries(
    Object.entries(output).map(([port, items]) => [
      port,
      items.map((item, i): Item => {
        if (item.pairedItem) return item;
        if (inputCount === 1) return { ...item, pairedItem: { item: 0 } };
        if (items.length === inputCount) return { ...item, pairedItem: { item: i } };
        return item;
      }),
    ]),
  );
}
