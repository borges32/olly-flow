import type { JSONSchema7Definition } from '@olly/nodes';
import { isExpression, literalValue, parseTemplate } from '@olly/expressions';
import { Plus, Trash2 } from 'lucide-react';
import { Suspense, lazy, useId, type DragEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { insertExpression, scalarText } from './expression-utils';
import { MultiSelectField } from './multi-select-field';
import { FIELD_MIME, useExpressionHelpers } from './ndv/expression-context';
import { ExpressionInput } from './ndv/expression-input';
import { useLoadOptions, useMcpToolSchema } from './param-options';
import { useEditorStore } from './store';

// Monaco só é baixado quando um nó de código é aberto (spec 005, plan §10).
const CodeEditor = lazy(() => import('./code-editor'));
import {
  asSchema,
  fieldKind,
  isFieldVisible,
  mcpArgumentsSchema,
  newArrayItem,
  rangeMessage,
  type ParamSchema,
} from './schema-form-logic';

/** Texto exibível de um valor escalar; objetos não são campos de texto. */
function toText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

interface FieldProps {
  name: string;
  path: string;
  schema: ParamSchema;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}

/** Formulário gerado do `paramsSchema` do nó (FR-009, plan §7). */
export function SchemaForm({
  schema,
  value,
  readOnly,
  onChange,
  pathPrefix = '',
}: {
  schema: ParamSchema;
  value: Record<string, unknown>;
  readOnly: boolean;
  onChange: (value: Record<string, unknown>, field: string) => void;
  pathPrefix?: string;
}) {
  const properties = schema.properties ?? {};
  return (
    <div className="grid gap-4">
      {Object.entries(properties).map(([name, def]) => {
        const prop = asSchema(def);
        if (prop['x-hidden'] || !isFieldVisible(prop, value, properties)) return null;
        const path = pathPrefix ? `${pathPrefix}.${name}` : name;
        return (
          <Field
            key={name}
            name={name}
            path={path}
            schema={prop}
            value={value[name]}
            readOnly={readOnly}
            onChange={(v) => {
              onChange({ ...value, [name]: v }, path);
            }}
          />
        );
      })}
    </div>
  );
}

/** Valor fixo correspondente ao sair do modo expressão: só templates sem código viram texto. */
function fixedFrom(value: string): string {
  try {
    return literalValue(parseTemplate(value.slice(1))) ?? '';
  } catch {
    return '';
  }
}

/**
 * Campo escalar com alternador Fixo/Expressão (FR-018, plan §8). Aceita soltar um campo do
 * painel de dados: o valor vira (ou ganha) a expressão correspondente.
 */
function ScalarField({
  id,
  label,
  testId,
  value,
  readOnly,
  onChange,
  description,
  inline,
  noExpression,
  children,
}: {
  id: string;
  label: string;
  testId: string;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
  description: ReactNode;
  inline?: boolean;
  /** `x-no-expression`: sem alternador; o valor é sempre fixo (spec 004). */
  noExpression?: boolean;
  children: ReactNode;
}) {
  const helpers = useExpressionHelpers();
  const expression = !noExpression && isExpression(value);
  const canToggle = helpers !== null && !readOnly && !noExpression;

  const onDrop = (e: DragEvent) => {
    const field = e.dataTransfer.getData(FIELD_MIME);
    if (!field || readOnly) return;
    e.preventDefault();
    onChange(insertExpression(value, field).value);
  };

  const toggle = canToggle && (
    <div
      role="group"
      aria-label={`Modo de ${label}`}
      data-testid={`${testId}-mode`}
      className="ml-auto inline-flex rounded border text-[11px]"
    >
      {(['fixed', 'expression'] as const).map((mode) => {
        const selected = (mode === 'expression') === expression;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              if (selected) return;
              if (mode === 'expression') onChange(`=${scalarText(value)}`);
              else onChange(fixedFrom(value as string));
            }}
            className={cn('px-1.5 py-0.5', selected && 'bg-accent font-medium')}
          >
            {mode === 'fixed' ? 'Fixo' : 'Expressão'}
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      className="grid gap-1.5"
      onDragOver={(e) => {
        if (!readOnly && e.dataTransfer.types.includes(FIELD_MIME)) e.preventDefault();
      }}
      onDrop={expression || noExpression ? undefined : onDrop}
    >
      {(!inline || expression) && (
        <div className="flex items-center gap-2">
          <Label htmlFor={id}>{label}</Label>
          {toggle}
        </div>
      )}
      {expression ? (
        <ExpressionInput
          id={id}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          testId={testId}
          ariaLabel={label}
        />
      ) : inline ? (
        <div className="flex items-center gap-2">
          {children}
          {toggle}
        </div>
      ) : (
        children
      )}
      {description}
    </div>
  );
}

function Field({ name, path, schema, value, readOnly, onChange }: FieldProps) {
  const id = useId();
  const label = schema.title ?? name;
  const kind = fieldKind(schema);
  const testId = `param-${path}`;
  const description = schema.description && (
    <p className="text-xs break-words whitespace-pre-line text-muted-foreground">
      {schema.description}
    </p>
  );

  // Faixa do schema (`minimum`/`maximum`): avisa na hora; o salvamento também recusa.
  const outOfRange = kind === 'number' ? rangeMessage(schema, value) : undefined;
  const singleLine = () => (
    <ScalarField
      id={id}
      label={label}
      testId={testId}
      value={value}
      readOnly={readOnly}
      onChange={onChange}
      description={description}
      noExpression={schema['x-no-expression'] === true}
    >
      <Input
        id={id}
        data-testid={testId}
        type={kind === 'number' ? 'number' : 'text'}
        autoComplete="off"
        value={toText(value)}
        disabled={readOnly}
        {...(kind === 'number' && {
          min: schema.minimum,
          max: schema.maximum,
          'aria-invalid': outOfRange !== undefined,
        })}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(kind === 'number' ? (raw === '' ? undefined : Number(raw)) : raw);
        }}
      />
      {outOfRange && (
        <p className="text-xs text-destructive" data-testid={`${testId}-range`}>
          {outOfRange}
        </p>
      )}
    </ScalarField>
  );

  if (schema['x-mcp-arguments']) {
    return (
      <McpArgumentsField
        label={label}
        path={path}
        value={value}
        readOnly={readOnly}
        onChange={onChange}
      />
    );
  }

  switch (kind) {
    case 'boolean':
      return (
        <ScalarField
          id={id}
          label={label}
          testId={testId}
          value={value}
          readOnly={readOnly}
          onChange={onChange}
          description={description}
          inline
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              id={id}
              type="checkbox"
              data-testid={testId}
              className="size-4 accent-primary"
              checked={value === true}
              disabled={readOnly}
              onChange={(e) => {
                onChange(e.target.checked);
              }}
            />
            {label}
          </label>
        </ScalarField>
      );
    case 'enum':
      return (
        <ScalarField
          id={id}
          label={label}
          testId={testId}
          value={value}
          readOnly={readOnly}
          onChange={onChange}
          description={description}
        >
          <Select
            id={id}
            data-testid={testId}
            value={toText(value ?? schema.default)}
            disabled={readOnly}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          >
            {(schema.enum ?? []).map((opt) => (
              <option key={toText(opt)} value={toText(opt)}>
                {toText(opt)}
              </option>
            ))}
          </Select>
        </ScalarField>
      );
    case 'string':
      if (schema['x-code-editor']) {
        return (
          <div className="grid gap-1.5">
            <Label htmlFor={id}>{label}</Label>
            <CodeField
              id={id}
              testId={testId}
              value={toText(value ?? schema.default)}
              readOnly={readOnly}
              onChange={onChange}
            />
            {description}
          </div>
        );
      }
      if (schema['x-load-options']) {
        return (
          <ScalarField
            id={id}
            label={label}
            testId={testId}
            value={value}
            readOnly={readOnly}
            onChange={onChange}
            description={description}
            noExpression
          >
            <LoadedOptions
              id={id}
              testId={testId}
              schema={schema}
              value={value}
              readOnly={readOnly}
              onChange={onChange}
            />
          </ScalarField>
        );
      }
      if (schema['x-multiline']) {
        return (
          <ScalarField
            id={id}
            label={label}
            testId={testId}
            value={value}
            readOnly={readOnly}
            onChange={onChange}
            description={description}
            noExpression={schema['x-no-expression'] === true}
          >
            <textarea
              id={id}
              data-testid={testId}
              spellCheck={false}
              className="min-h-24 w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
              value={toText(value)}
              disabled={readOnly}
              onChange={(e) => {
                onChange(e.target.value);
              }}
            />
          </ScalarField>
        );
      }
      return singleLine();
    case 'number':
      return singleLine();
    case 'object':
      return (
        <fieldset className="grid gap-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">{label}</legend>
          {description}
          <SchemaForm
            schema={schema}
            value={(value as Record<string, unknown> | undefined) ?? {}}
            readOnly={readOnly}
            onChange={(v) => {
              onChange(v);
            }}
            pathPrefix={path}
          />
        </fieldset>
      );
    case 'array': {
      const itemSchema = asSchema(schema.items as JSONSchema7Definition | undefined);
      if (schema['x-load-options']) {
        return (
          <MultiSelectField
            label={label}
            testId={testId}
            schema={schema}
            itemSchema={itemSchema}
            value={value}
            readOnly={readOnly}
            onChange={onChange}
            description={description}
          />
        );
      }
      const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      return (
        <fieldset className="grid gap-2">
          <legend className="pb-1 text-sm font-medium">{label}</legend>
          {description}
          {items.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item.</p>}
          {items.map((item, index) => (
            <div
              key={index}
              className="relative grid gap-3 rounded-md border p-3 pr-10"
              data-testid={`${testId}.${index}`}
            >
              <SchemaForm
                schema={itemSchema}
                value={item}
                readOnly={readOnly}
                onChange={(v) => {
                  onChange(items.map((it, i) => (i === index ? v : it)));
                }}
                pathPrefix={`${path}.${index}`}
              />
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-1 right-1 size-7"
                  aria-label={`Remover item ${index + 1}`}
                  onClick={() => {
                    onChange(items.filter((_, i) => i !== index));
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onChange([...items, newArrayItem(itemSchema)]);
              }}
            >
              <Plus />
              Adicionar
            </Button>
          )}
        </fieldset>
      );
    }
    case 'unsupported':
      return (
        <p className="text-xs text-muted-foreground">Campo “{label}” não suportado pelo editor.</p>
      );
  }
}

/**
 * Select com opções do catálogo do banco (`x-load-options`, FR-016). Sem credencial ou com erro,
 * vira campo de texto: o valor continua editável.
 */
function LoadedOptions({
  id,
  testId,
  schema,
  value,
  readOnly,
  onChange,
}: {
  id: string;
  testId: string;
  schema: ParamSchema;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}) {
  const { options, loading, error, hint } = useLoadOptions(schema['x-load-options']);
  const current = toText(value ?? schema.default);
  if (!options) {
    return (
      <div className="grid gap-1">
        <Input
          id={id}
          data-testid={testId}
          autoComplete="off"
          value={current}
          disabled={readOnly}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
        <p className="text-xs text-muted-foreground">
          {loading
            ? 'Carregando opções…'
            : error
              ? `Não foi possível listar: ${error.message}`
              : hint}
        </p>
      </div>
    );
  }
  const list =
    current && !options.some((o) => o.value === current)
      ? [{ value: current, label: current }, ...options]
      : options;
  const select = (
    <Select
      id={id}
      data-testid={testId}
      value={current}
      disabled={readOnly}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    >
      <option value="">Selecione…</option>
      {list.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </Select>
  );
  // Lista vazia: explica o motivo (ex.: nenhuma tool MCP liberada, spec 010).
  if (options.length > 0 || !hint) return select;
  return (
    <div className="grid gap-1">
      {select}
      <p className="text-xs text-amber-700 dark:text-amber-300" data-testid={`${testId}-hint`}>
        {hint}
      </p>
    </div>
  );
}

/**
 * Argumentos da tool MCP (spec 010, FR-009): formulário gerado do `inputSchema` aprovado, com o
 * alternador Fixo/Expressão em cada campo. A alternativa é o modo JSON do nó.
 */
function McpArgumentsField({
  label,
  path,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  path: string;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}) {
  const { tool, loading, hint } = useMcpToolSchema();
  const args =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const schema = tool ? mcpArgumentsSchema(tool.inputSchema) : undefined;
  return (
    <fieldset className="grid gap-3 rounded-md border p-3" data-testid={`param-${path}`}>
      <legend className="px-1 text-sm font-medium">
        {label}
        {tool && <span className="font-mono text-muted-foreground"> · {tool.name}</span>}
      </legend>
      {tool?.description && <p className="text-xs text-muted-foreground">{tool.description}</p>}
      {schema ? (
        Object.keys(schema.properties ?? {}).length > 0 ? (
          <SchemaForm
            schema={schema}
            value={args}
            readOnly={readOnly}
            onChange={(v) => {
              onChange(v);
            }}
            pathPrefix={path}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Esta tool não recebe argumentos.</p>
        )
      ) : (
        <p className="text-xs text-muted-foreground">{loading ? 'Carregando a tool…' : hint}</p>
      )}
    </fieldset>
  );
}

/** Campo de código: Monaco com as variáveis do N8N e os nomes dos nós (FR-012). */
function CodeField({
  id,
  testId,
  value,
  readOnly,
  onChange,
}: {
  id: string;
  testId: string;
  value: string;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}) {
  const nodeNames = useEditorStore((s) => s.nodes.map((n) => n.name).join('\u0000'));
  const fallback = (
    <textarea
      id={id}
      data-testid={`${testId}-fallback`}
      className="min-h-80 w-full rounded-md border bg-background p-2 font-mono text-xs"
      value={value}
      readOnly
    />
  );
  return (
    <Suspense fallback={fallback}>
      <CodeEditor
        value={value}
        readOnly={readOnly}
        testId={testId}
        nodeNames={nodeNames ? nodeNames.split('\u0000') : []}
        onChange={(v) => {
          onChange(v);
        }}
      />
    </Suspense>
  );
}
