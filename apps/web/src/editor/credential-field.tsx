import type { NodeDescription } from '@olly/nodes';
import type { WorkflowNode } from '@olly/shared-types';
import { KeyRound } from 'lucide-react';
import { useId } from 'react';
import { useCredentials } from '@/api/queries';
import { useCan } from '@/api/use-can';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useEditorStore } from './store';

/**
 * Credencial do nó (spec 004, FR-004, FR-007): lista as credenciais do projeto com tipo aceito pelo
 * nó. Sem `credential:use`, mostra apenas se há uma credencial configurada.
 */
export function CredentialField({
  node,
  description,
  projectId,
  readOnly,
}: {
  node: WorkflowNode;
  description: NodeDescription | undefined;
  projectId: string;
  readOnly: boolean;
}) {
  const id = useId();
  const accepted = description?.credentialTypes;
  const canUse = useCan('credential:use', projectId);
  const credentials = useCredentials(projectId, canUse && accepted !== undefined);
  if (!accepted || accepted.length === 0) return null;

  const options = (credentials.data ?? []).filter((c) => accepted.includes(c.type));
  const current = node.credentialId;
  const missing =
    current !== undefined &&
    credentials.data !== undefined &&
    !options.some((c) => c.id === current);

  return (
    <div className="grid gap-1.5" data-testid="credential-field">
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="flex items-center gap-1.5">
          <KeyRound className="size-3.5" /> Credencial
        </Label>
        {canUse && (
          <a
            href={`/credentials?project=${projectId}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-primary hover:underline"
          >
            Gerenciar credenciais
          </a>
        )}
      </div>
      {canUse ? (
        <Select
          id={id}
          aria-label="Credencial"
          value={current ?? ''}
          disabled={readOnly || credentials.isLoading}
          onChange={(e) => {
            useEditorStore
              .getState()
              .updateNode(node.id, { credentialId: e.target.value || undefined });
          }}
        >
          <option value="">Nenhuma</option>
          {missing && <option value={current}>(credencial não encontrada)</option>}
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type})
            </option>
          ))}
        </Select>
      ) : (
        <p className="text-sm text-muted-foreground">
          {current ? 'Credencial configurada.' : 'Nenhuma credencial.'}
        </p>
      )}
      {canUse && credentials.data && options.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhuma credencial do tipo {accepted.join(', ')} neste projeto.
        </p>
      )}
    </div>
  );
}
