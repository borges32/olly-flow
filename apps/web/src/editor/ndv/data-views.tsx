import type { Item } from '@olly/shared-types';
import { GripVertical } from 'lucide-react';
import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { fieldExpression, inferSchema, scalarText, type SchemaField } from '../expression-utils';
import { FIELD_MIME } from './expression-context';

export type DragSource = { kind: 'input' } | { kind: 'node'; name: string };

type View = 'table' | 'json' | 'schema';
const VIEWS: { id: View; label: string }[] = [
  { id: 'table', label: 'Tabela' },
  { id: 'json', label: 'JSON' },
  { id: 'schema', label: 'Schema' },
];

function startDrag(e: DragEvent, path: (string | number)[], source: DragSource) {
  const expression = fieldExpression(path, source);
  e.dataTransfer.setData(FIELD_MIME, expression);
  e.dataTransfer.setData('text/plain', `{{ ${expression} }}`);
  e.dataTransfer.effectAllowed = 'copy';
}

const preview = (value: unknown): string => {
  if (value === undefined) return '';
  if (value === null) return 'null';
  const text = scalarText(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

function FieldLabel({ field, source }: { field: SchemaField; source?: DragSource }) {
  return (
    <span
      draggable={source !== undefined}
      onDragStart={
        source
          ? (e) => {
              startDrag(e, field.path, source);
            }
          : undefined
      }
      data-testid={`field-${field.path.join('.')}`}
      className={cn(
        'inline-flex items-center gap-1 font-mono',
        source && 'cursor-grab rounded px-1 hover:bg-accent',
      )}
      title={source ? 'Arraste para um parâmetro' : undefined}
    >
      {source && <GripVertical className="size-3 text-muted-foreground" />}
      {field.key}
    </span>
  );
}

function TableView({ items, source }: { items: Item[]; source?: DragSource }) {
  const columns = useMemo(() => inferSchema(items).slice(0, 30), [items]);
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted text-left">
          <tr>
            <th className="px-2 py-1 font-medium text-muted-foreground">#</th>
            {columns.map((c) => (
              <th key={c.key} className="px-2 py-1 font-medium whitespace-nowrap">
                <FieldLabel field={c} source={source} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.slice(0, 200).map((item, i) => (
            <tr key={i} className="border-t">
              <td className="px-2 py-1 text-muted-foreground">{i}</td>
              {columns.map((c) => (
                <td key={c.key} className="max-w-56 truncate px-2 py-1 font-mono">
                  {preview(item.json[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SchemaTree({
  fields,
  items,
  source,
  depth = 0,
}: {
  fields: SchemaField[];
  items: Item[];
  source?: DragSource;
  depth?: number;
}) {
  return (
    <ul className={cn('grid gap-1', depth > 0 && 'ml-4 border-l pl-2')}>
      {fields.map((f) => {
        const sample = f.path.reduce<unknown>(
          (v, k) =>
            v && typeof v === 'object' ? (v as Record<string | number, unknown>)[k] : undefined,
          items[0]?.json,
        );
        return (
          <li key={f.key} className="text-xs">
            <div className="flex items-center gap-2">
              <FieldLabel field={f} source={source} />
              <Badge variant="secondary" className="px-1 py-0 font-normal">
                {f.type}
              </Badge>
              {f.type !== 'object' && (
                <span className="truncate text-muted-foreground">{preview(sample)}</span>
              )}
            </div>
            {f.children && f.children.length > 0 && (
              <SchemaTree fields={f.children} items={items} source={source} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Dados de entrada/saída de um nó em tabela, JSON ou schema (FR-017). */
export function DataPanel({
  title,
  testId,
  data,
  portLabels = {},
  source,
  truncated,
  empty,
  header,
  toolbar,
}: {
  title: string;
  testId: string;
  data: Record<string, Item[]> | undefined;
  portLabels?: Record<string, string>;
  source?: DragSource;
  truncated?: boolean;
  empty: ReactNode;
  header?: ReactNode;
  toolbar?: ReactNode;
}) {
  const [view, setView] = useState<View>('table');
  const ports = Object.keys(data ?? {});
  const [port, setPort] = useState<string | undefined>();
  const current = port && ports.includes(port) ? port : ports[0];
  const items = (current && data?.[current]) || [];

  return (
    <section aria-label={title} data-testid={testId} className="flex min-h-0 flex-col">
      <header className="grid gap-2 border-b p-3">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-sm font-semibold">{title}</h3>
          {toolbar}
        </div>
        {header}
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Visão dos dados"
            className="inline-flex rounded-md border p-0.5"
          >
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={view === v.id}
                onClick={() => {
                  setView(v.id);
                }}
                className={cn(
                  'rounded px-2 py-0.5 text-xs',
                  view === v.id && 'bg-accent font-medium',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          {ports.length > 1 && (
            <div role="tablist" aria-label="Saída" className="inline-flex rounded-md border p-0.5">
              {ports.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={current === p}
                  onClick={() => {
                    setPort(p);
                  }}
                  className={cn(
                    'rounded px-2 py-0.5 text-xs',
                    current === p && 'bg-accent font-medium',
                  )}
                >
                  {portLabels[p] ?? p} ({data?.[p]?.length ?? 0})
                </button>
              ))}
            </div>
          )}
          {data && (
            <span className="text-xs text-muted-foreground" data-testid={`${testId}-count`}>
              {items.length} {items.length === 1 ? 'item' : 'itens'}
            </span>
          )}
          {truncated && <Badge variant="warning">dados truncados</Badge>}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!data || ports.length === 0 ? (
          <div className="text-sm text-muted-foreground">{empty}</div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum item nesta saída.</p>
        ) : view === 'table' ? (
          <TableView items={items} source={source} />
        ) : view === 'json' ? (
          <pre data-testid={`${testId}-json`} className="font-mono text-xs whitespace-pre-wrap">
            {JSON.stringify(
              items.map((i) => i.json),
              null,
              2,
            )}
          </pre>
        ) : (
          <SchemaTree fields={inferSchema(items)} items={items} source={source} />
        )}
      </div>
    </section>
  );
}
