import type { NodeDescription } from '@olly/nodes';
import type { WorkflowNode } from '@olly/shared-types';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NodeIcon } from './node-icon';
import { SchemaForm } from './schema-form';
import { useEditorStore, type EditorState } from './store';

/** Coluna de parâmetros do painel do nó: nome único, desabilitar e parâmetros (FR-009). */
export function ParameterPanel({
  node,
  description,
  readOnly,
}: {
  node: WorkflowNode;
  description: NodeDescription | undefined;
  readOnly: boolean;
}) {
  const nodes = useEditorStore((s) => s.nodes);
  const updateNode = (...args: Parameters<EditorState['updateNode']>) => {
    useEditorStore.getState().updateNode(...args);
  };
  // Rascunho só enquanto o nome digitado é inválido; nomes válidos vão direto para o nó.
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? node.name;

  const trimmed = name.trim();
  const nameError = !trimmed
    ? 'Informe um nome'
    : nodes.some((n) => n.id !== node.id && n.name === trimmed)
      ? 'Já existe um nó com este nome'
      : undefined;

  return (
    <section
      aria-label="Parâmetros do nó"
      data-testid="parameter-panel"
      className="flex min-h-0 flex-col"
    >
      <header className="flex items-center gap-2 border-b p-3">
        <NodeIcon name={description?.icon} className="size-4" />
        <h3 className="flex-1 truncate text-sm font-semibold">Parâmetros</h3>
      </header>
      <div className="grid gap-5 overflow-y-auto p-4">
        {description?.description && (
          <p className="text-sm text-muted-foreground">{description.description}</p>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="node-name">Nome do nó</Label>
          <Input
            id="node-name"
            value={name}
            disabled={readOnly}
            aria-invalid={nameError !== undefined}
            onChange={(e) => {
              const next = e.target.value.trim();
              if (next && !nodes.some((n) => n.id !== node.id && n.name === next)) {
                updateNode(node.id, { name: next }, `${node.id}:name`);
                setDraft(next === e.target.value ? null : e.target.value);
              } else {
                setDraft(e.target.value);
              }
            }}
          />
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={node.disabled === true}
            disabled={readOnly}
            onChange={(e) => {
              updateNode(node.id, { disabled: e.target.checked });
            }}
          />
          Desabilitar nó (repassa a entrada sem executar)
        </label>
        {description ? (
          <SchemaForm
            schema={description.paramsSchema}
            value={node.params}
            readOnly={readOnly}
            onChange={(params, field) => {
              updateNode(node.id, { params }, `${node.id}:${field}`);
            }}
          />
        ) : (
          <p className="text-sm text-destructive">Tipo de nó desconhecido: {node.type}</p>
        )}
      </div>
    </section>
  );
}
