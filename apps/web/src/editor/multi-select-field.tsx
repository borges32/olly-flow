import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useLoadOptions } from './param-options';
import {
  filterOptions,
  multiSelectKey,
  selectedValues,
  toggleSelected,
  type ParamSchema,
} from './schema-form-logic';

/**
 * Seleção múltipla com opções carregadas (`x-load-options` numa lista), como o "Tools to
 * Include" do N8N: as escolhidas aparecem como etiquetas; a lista mostra nome, descrição e marca.
 */
export function MultiSelectField({
  label,
  testId,
  schema,
  itemSchema,
  value,
  readOnly,
  onChange,
  description,
}: {
  label: string;
  testId: string;
  schema: ParamSchema;
  itemSchema: ParamSchema;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
  description: ReactNode;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const { options, loading, error, hint } = useLoadOptions(schema['x-load-options']);
  const key = multiSelectKey(itemSchema);
  const selected = selectedValues(value, key);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // A lista abre no fluxo do formulário (não sobreposta): o painel rola até ela ficar visível.
  useEffect(() => {
    if (open) list.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('mousedown', close);
    };
  }, [open]);

  const toggle = (option: string) => {
    onChange(toggleSelected(value, key, option));
  };
  const known = new Set((options ?? []).map((o) => o.value));
  const visible = filterOptions(options ?? [], search);
  const status = loading
    ? 'Carregando opções…'
    : error
      ? `Não foi possível listar: ${error.message}`
      : hint;

  return (
    <div className="grid gap-1.5" ref={root} data-multiselect-open={open || undefined}>
      <label htmlFor={id} className="text-sm leading-none font-medium select-none">
        {label}
      </label>
      <div
        data-testid={testId}
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 shadow-xs',
          open && 'border-ring ring-[3px] ring-ring/50',
          readOnly && 'opacity-60',
        )}
        onClick={() => {
          if (!readOnly) setOpen(true);
        }}
      >
        {selected.map((v) => (
          <span
            key={v}
            data-testid={`${testId}-chip`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs',
              options && !known.has(v) && 'border-amber-500 text-amber-700 dark:text-amber-300',
            )}
            title={options && !known.has(v) ? 'Não liberada neste projeto' : undefined}
          >
            {v}
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remover ${v}`}
                className="rounded-full hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(v);
                }}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={readOnly}
          placeholder={selected.length === 0 ? 'Escolha…' : ''}
          className="min-w-16 flex-1 bg-transparent py-0.5 text-sm outline-none"
          value={search}
          onFocus={() => {
            setOpen(true);
          }}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Backspace' && !search && selected.length > 0) {
              toggle(selected[selected.length - 1] as string);
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const first = visible[0];
              if (first) toggle(first.value);
            }
          }}
        />
        <button
          type="button"
          aria-label={open ? 'Fechar lista' : 'Abrir lista'}
          disabled={readOnly}
          className="ml-auto text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="max-h-72 w-full scroll-my-2 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {visible.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                data-testid={`${testId}-option`}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-accent',
                  isSelected && 'bg-accent/60',
                )}
                onMouseDown={(e) => {
                  // Mantém o foco no campo de busca.
                  e.preventDefault();
                }}
                onClick={() => {
                  toggle(opt.value);
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{opt.label}</div>
                  {opt.description && (
                    <div className="line-clamp-3 text-xs text-muted-foreground">
                      {opt.description}
                    </div>
                  )}
                </div>
                {isSelected && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              {options && options.length > 0 ? 'Nenhuma opção encontrada.' : status}
            </li>
          )}
        </ul>
      )}
      {!open && status && (!options || options.length === 0) && (
        <p className="text-xs text-amber-700 dark:text-amber-300" data-testid={`${testId}-hint`}>
          {status}
        </p>
      )}
      {description}
    </div>
  );
}
