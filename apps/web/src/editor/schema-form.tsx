import type { JSONSchema7Definition } from '@olly/nodes';
import { isExpression, literalValue, parseTemplate } from '@olly/expressions';
import { Plus, Trash2 } from 'lucide-react';
import { useId, type DragEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { insertExpression, scalarText } from './expression-utils';
import { FIELD_MIME, useExpressionHelpers } from './ndv/expression-context';
import { ExpressionInput } from './ndv/expression-input';
import {
  asSchema,
  fieldKind,
  isFieldVisible,
  newArrayItem,
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
  children: ReactNode;
}) {
  const helpers = useExpressionHelpers();
  const expression = isExpression(value);
  const canToggle = helpers !== null && !readOnly;

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
      onDrop={expression ? undefined : onDrop}
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
    <p className="text-xs text-muted-foreground">{schema.description}</p>
  );

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
    case 'number':
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
          <Input
            id={id}
            data-testid={testId}
            type={kind === 'number' ? 'number' : 'text'}
            autoComplete="off"
            value={toText(value)}
            disabled={readOnly}
            onChange={(e) => {
              const raw = e.target.value;
              onChange(kind === 'number' ? (raw === '' ? undefined : Number(raw)) : raw);
            }}
          />
        </ScalarField>
      );
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
