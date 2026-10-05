import type { NodeDescription } from '@olly/nodes';
import type { WorkflowNode } from '@olly/shared-types';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { CredentialField } from './credential-field';
import { NodeIcon } from './node-icon';
import { NodeSettings } from './node-settings';
import { ParamOptionsContext } from './param-options';
import { SchemaForm } from './schema-form';
import { WebhookPanel } from './webhook-panel';
import { useEditorStore, type EditorState } from './store';

/**
 * Coluna de parâmetros do painel do nó: nome único, desabilitar, credencial e parâmetros (FR-009);
 * aba Configurações com retry, timeout e onError (spec 004, FR-017).
 */
export function ParameterPanel({
  node,
  description,
  readOnly,
  projectId,
  workflowId,
  canExecute,
  published,
}: {
  node: WorkflowNode;
  description: NodeDescription | undefined;
  readOnly: boolean;
  projectId: string;
  workflowId: string;
  canExecute: boolean;
  published: boolean;
}) {
  const [tab, setTab] = useState<'params' | 'settings'>('params');
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
        <div role="tablist" aria-label="Seções do nó" className="flex flex-1 gap-1">
          {(
            [
              ['params', 'Parâmetros'],
              ['settings', 'Configurações'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                setTab(key);
              }}
              className={cn(
                'rounded px-2 py-1 text-sm',
                tab === key
                  ? 'bg-accent font-semibold'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {tab === 'settings' ? (
        <div className="overflow-y-auto p-4">
          <NodeSettings
            node={node}
            readOnly={readOnly}
            supportsParallelItems={description?.supportsParallelItems === true}
          />
        </div>
      ) : (
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
          {node.type === 'trigger.webhook' && (
            <WebhookPanel
              node={node}
              workflowId={workflowId}
              canExecute={canExecute}
              published={published}
            />
          )}
          <CredentialField
            node={node}
            description={description}
            projectId={projectId}
            readOnly={readOnly}
          />
          {description ? (
            <ParamOptionsContext.Provider
              value={{
                params: node.params,
                ...(node.credentialId && { credentialId: node.credentialId }),
              }}
            >
              <SchemaForm
                schema={description.paramsSchema}
                value={node.params}
                readOnly={readOnly}
                onChange={(params, field) => {
                  updateNode(node.id, { params }, `${node.id}:${field}`);
                }}
              />
            </ParamOptionsContext.Provider>
          ) : (
            <p className="text-sm text-destructive">Tipo de nó desconhecido: {node.type}</p>
          )}
        </div>
      )}
    </section>
  );
}
