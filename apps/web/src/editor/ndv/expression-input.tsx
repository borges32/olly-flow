import type { ExpressionPreviewResponse } from '@olly/shared-types';
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { insertExpression, suggest, type Suggestion } from '../expression-utils';
import { FIELD_MIME, useExpressionHelpers } from './expression-context';

const formatValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};

/**
 * Campo de expressão (FR-018): edição do template `{{ }}`, autocomplete a partir da última
 * execução, pré-visualização do resultado e soltura de campos arrastados do painel de dados.
 * O valor guardado inclui o prefixo `=`; o campo mostra o template sem ele.
 */
export function ExpressionInput({
  value,
  onChange,
  readOnly,
  testId,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  testId: string;
  ariaLabel: string;
  id?: string;
}) {
  const helpers = useExpressionHelpers();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ from: number; items: Suggestion[] } | null>(null);
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<ExpressionPreviewResponse | null>(null);
  const text = value.slice(1);

  useEffect(() => {
    if (!helpers) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      helpers
        .preview(value)
        .then((r) => {
          if (!cancelled) setResult(r);
        })
        .catch(() => {
          if (!cancelled) setResult(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [helpers, value]);

  const refreshMenu = (nextText: string, caret: number) => {
    if (!helpers) return;
    setMenu(suggest(nextText.slice(0, caret), helpers.suggestions));
    setActive(0);
  };

  const accept = (s: Suggestion) => {
    const el = ref.current;
    if (!el || !menu) return;
    const caret = el.selectionStart;
    const next = text.slice(0, menu.from) + s.insert + text.slice(caret);
    const position = menu.from + s.insert.length;
    onChange(`=${next}`);
    setMenu(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(position, position);
      refreshMenu(next, position);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menu?.items.length) return;
    if (e.key === 'ArrowDown') setActive((a) => (a + 1) % menu.items.length);
    else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + menu.items.length) % menu.items.length);
    else if (e.key === 'Enter' || e.key === 'Tab') {
      const item = menu.items[active];
      if (item) accept(item);
    } else if (e.key === 'Escape') setMenu(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const expression = e.dataTransfer.getData(FIELD_MIME);
    if (!expression || readOnly) return;
    e.preventDefault();
    const caret = ref.current?.selectionStart;
    onChange(
      insertExpression(value, expression, caret === undefined ? undefined : caret + 1).value,
    );
  };

  return (
    <div className="relative grid gap-1">
      <textarea
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        data-testid={testId}
        data-expression="true"
        rows={Math.min(4, Math.max(1, text.split('\n').length))}
        spellCheck={false}
        readOnly={readOnly}
        value={text}
        onChange={(e) => {
          onChange(`=${e.target.value}`);
          refreshMenu(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onBlur={() =>
          setTimeout(() => {
            setMenu(null);
          }, 150)
        }
        onDragOver={(e) => {
          if (!readOnly && e.dataTransfer.types.includes(FIELD_MIME)) e.preventDefault();
        }}
        onDrop={onDrop}
        className="w-full resize-y rounded-md border border-primary/40 bg-accent/30 px-3 py-2 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      {menu && menu.items.length > 0 && (
        <ul
          role="listbox"
          aria-label="Sugestões"
          data-testid={`${testId}-suggestions`}
          className="absolute top-full z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 text-xs shadow-md"
        >
          {menu.items.map((s, i) => (
            <li key={s.label} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left',
                  i === active && 'bg-accent',
                )}
              >
                <span className="font-mono">{s.label}</span>
                {s.detail && <span className="text-muted-foreground">{s.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {result && (
        <p
          data-testid={`${testId}-preview`}
          className={cn(
            'truncate font-mono text-xs',
            result.ok ? 'text-muted-foreground' : 'text-destructive',
          )}
          title={result.ok ? formatValue(result.value) : result.error.message}
        >
          {result.ok ? `Resultado: ${formatValue(result.value)}` : `Erro: ${result.error.message}`}
        </p>
      )}
    </div>
  );
}
