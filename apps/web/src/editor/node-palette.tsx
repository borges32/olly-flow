import type { NodeCategory, NodeDescription } from '@olly/nodes';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { NodeIcon } from './node-icon';

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: 'Gatilhos',
  data: 'Dados',
  logic: 'Lógica',
  flow: 'Fluxo',
  code: 'Código',
  integration: 'Integrações',
  ai: 'IA',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as NodeCategory[];

export const NODE_DRAG_MIME = 'application/x-olly-node-type';

/** Paleta com busca e categorias (FR-007). Clique adiciona; também é possível arrastar ao canvas. */
export function NodePalette({
  types,
  onAdd,
}: {
  types: NodeDescription[];
  onAdd: (type: NodeDescription) => void;
}) {
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    const matches = types.filter(
      (t) =>
        !term ||
        t.displayName.toLocaleLowerCase('pt-BR').includes(term) ||
        t.description.toLocaleLowerCase('pt-BR').includes(term),
    );
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: matches
        .filter((t) => t.category === category)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    })).filter((g) => g.items.length > 0);
  }, [types, search]);

  return (
    <aside
      aria-label="Paleta de nós"
      data-testid="node-palette"
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar"
    >
      <div className="relative p-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Buscar nós"
          placeholder="Buscar nós"
          className="pl-8"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted-foreground">Nenhum nó encontrado.</p>
        )}
        {groups.map(({ category, items }) => (
          <section key={category} className="mb-3">
            <h3 className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {CATEGORY_LABELS[category]}
            </h3>
            <ul className="grid gap-1">
              {items.map((type) => (
                <li key={type.type}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(NODE_DRAG_MIME, type.type);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => {
                      onAdd(type);
                    }}
                    title={type.description}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <NodeIcon name={type.icon} className="size-4 shrink-0" />
                    <span className="truncate">{type.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
