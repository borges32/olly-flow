import type { CredentialTypeDescription, JSONSchema7 } from '@olly/nodes';
import type {
  CredentialSummary,
  CredentialTestResponse,
  CreateCredentialRequest,
  UpdateCredentialRequest,
} from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Pencil, Plug, Plus, Trash2, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys, useCredentialTypes, useCredentials, useProjects } from '@/api/queries';
import { useCan } from '@/api/use-can';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Texto de um valor escalar do formulário (objetos não são campos de credencial). */
const scalar = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

type FieldSchema = JSONSchema7 & { 'x-secret'?: boolean; 'x-multiline'?: boolean };

const errorMessage = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...e.issues.map((i) => i.message)].join(' — ')
    : e instanceof Error
      ? e.message
      : String(e);

function fieldsOf(type: CredentialTypeDescription | undefined): [string, FieldSchema][] {
  return Object.entries(type?.properties.properties ?? {}).map(([k, v]) => [k, v as FieldSchema]);
}

/** Valores iniciais: campos públicos da credencial ou padrões do tipo; secretos sempre vazios. */
function initialValues(type: CredentialTypeDescription | undefined, editing?: CredentialSummary) {
  return Object.fromEntries(
    fieldsOf(type).map(([name, schema]) => [
      name,
      schema['x-secret']
        ? ''
        : (editing?.publicFields[name] ??
          schema.default ??
          (schema.type === 'boolean' ? false : '')),
    ]),
  ) as Record<string, unknown>;
}

/** Formulário gerado do schema do tipo (FR-004). Segredos nunca voltam da API (FR-002). */
function CredentialDialog({
  projectId,
  types,
  editing,
  onClose,
}: {
  projectId: string;
  types: CredentialTypeDescription[];
  editing: CredentialSummary | null;
  onClose: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [typeName, setTypeName] = useState(editing?.type ?? types[0]?.name ?? '');
  const type = types.find((t) => t.name === typeName);
  const [name, setName] = useState(editing?.name ?? '');
  const [values, setValues] = useState(() => initialValues(type, editing ?? undefined));
  const required = new Set(type?.properties.required ?? []);

  const save = useMutation({
    mutationFn: () => {
      const data = Object.fromEntries(
        fieldsOf(type).flatMap(([field, schema]) => {
          const v = values[field];
          // Vazio: no secreto mantém o atual (edição); nos demais, usa o padrão do tipo.
          if (v === '' && (schema['x-secret'] || schema.default !== undefined)) return [];
          return [[field, schema.type === 'integer' && v !== '' ? Number(v) : v]];
        }),
      );
      return editing
        ? api.put<CredentialSummary>(`/api/v1/credentials/${editing.id}`, {
            name,
            data,
          } satisfies UpdateCredentialRequest)
        : api.post<CredentialSummary>(`/api/v1/projects/${projectId}/credentials`, {
            name,
            type: typeName,
            data,
          } satisfies CreateCredentialRequest);
    },
    onSuccess: () => {
      toast.success(editing ? 'Credencial atualizada' : 'Credencial criada');
      void queryClient.invalidateQueries({ queryKey: queryKeys.credentials(projectId) });
      onClose();
    },
    onError: (e) => toast.error('Não foi possível salvar', { description: errorMessage(e) }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <form onSubmit={onSubmit} className="grid gap-4" data-testid="credential-form">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar credencial' : 'Nova credencial'}</DialogTitle>
            <DialogDescription>
              {type?.description ?? 'Os campos secretos são cifrados e nunca são exibidos de novo.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cred-name">Nome</Label>
            <Input
              id="cred-name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cred-type">Tipo</Label>
            <Select
              id="cred-type"
              value={typeName}
              disabled={editing !== null}
              onChange={(e) => {
                const next = types.find((t) => t.name === e.target.value);
                setTypeName(e.target.value);
                setValues(initialValues(next));
              }}
            >
              {types.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.displayName}
                </option>
              ))}
            </Select>
          </div>
          {fieldsOf(type).map(([field, schema]) => {
            const id = `cred-field-${field}`;
            const label = `${schema.title ?? field}${required.has(field) ? ' *' : ''}`;
            const value = values[field];
            const set = (v: unknown) => {
              setValues((prev) => ({ ...prev, [field]: v }));
            };
            const keep = editing?.secretFieldsSet.includes(field);
            if (schema.type === 'boolean') {
              return (
                <label key={field} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={value === true}
                    onChange={(e) => {
                      set(e.target.checked);
                    }}
                  />
                  {schema.title ?? field}
                </label>
              );
            }
            return (
              <div key={field} className="grid gap-1.5">
                <Label htmlFor={id}>{label}</Label>
                {schema.enum ? (
                  <Select
                    id={id}
                    value={scalar(value)}
                    onChange={(e) => {
                      set(e.target.value);
                    }}
                  >
                    {schema.enum.map((opt) => (
                      <option key={scalar(opt)} value={scalar(opt)}>
                        {scalar(opt)}
                      </option>
                    ))}
                  </Select>
                ) : schema['x-multiline'] ? (
                  <textarea
                    id={id}
                    className="min-h-20 rounded-md border bg-background p-2 font-mono text-xs"
                    value={scalar(value)}
                    onChange={(e) => {
                      set(e.target.value);
                    }}
                  />
                ) : (
                  <Input
                    id={id}
                    type={
                      schema['x-secret']
                        ? 'password'
                        : schema.type === 'integer'
                          ? 'number'
                          : 'text'
                    }
                    autoComplete={schema['x-secret'] ? 'new-password' : 'off'}
                    // Edição: segredo em branco mantém o valor salvo (HU-1.1).
                    placeholder={
                      schema['x-secret'] && keep
                        ? '•••••••• (deixe em branco para manter)'
                        : undefined
                    }
                    required={required.has(field) && !(schema['x-secret'] && keep)}
                    value={scalar(value)}
                    onChange={(e) => {
                      set(e.target.value);
                    }}
                  />
                )}
                {schema.description && (
                  <p className="text-xs text-muted-foreground">{schema.description}</p>
                )}
              </div>
            );
          })}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Teste de conexão (FR-005); tipos HTTP genéricos pedem uma URL. */
function TestDialog({
  credential,
  type,
  onClose,
}: {
  credential: CredentialSummary;
  type: CredentialTypeDescription | undefined;
  onClose: () => void;
}) {
  const api = useApi();
  const [url, setUrl] = useState('');
  const test = useMutation({
    mutationFn: () =>
      api.post<CredentialTestResponse>(
        `/api/v1/credentials/${credential.id}/test`,
        type?.testRequiresUrl ? { url } : {},
      ),
  });
  const result = test.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Testar “{credential.name}”</DialogTitle>
          <DialogDescription>
            {type?.testRequiresUrl
              ? 'Informe uma URL da API: o teste faz um GET autenticado com esta credencial.'
              : 'Verifica se a conexão funciona com os dados salvos.'}
          </DialogDescription>
        </DialogHeader>
        {type?.testRequiresUrl && (
          <div className="grid gap-1.5">
            <Label htmlFor="test-url">URL</Label>
            <Input
              id="test-url"
              placeholder="https://api.exemplo.gov.br/status"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
              }}
            />
          </div>
        )}
        {result && (
          <p
            data-testid="credential-test-result"
            data-ok={result.ok}
            className={`flex items-center gap-2 text-sm ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
          >
            {result.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
            {result.message}
          </p>
        )}
        {test.error && <p className="text-sm text-destructive">{errorMessage(test.error)}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button
            disabled={test.isPending || (type?.testRequiresUrl === true && !url.trim())}
            onClick={() => {
              test.mutate();
            }}
          >
            <Plug /> Testar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Credenciais do projeto (spec 004, FR-002, FR-004, FR-005, FR-007). */
export function CredentialsPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: projects } = useProjects();
  const projectId = params.get('project') ?? projects?.[0]?.id;
  const canUse = useCan('credential:use', projectId);
  const canManage = useCan('credential:manage', projectId);
  const credentials = useCredentials(projectId, canUse);
  const { data: types = [] } = useCredentialTypes();
  const [editing, setEditing] = useState<CredentialSummary | 'new' | null>(null);
  const [testing, setTesting] = useState<CredentialSummary | null>(null);
  const [toDelete, setToDelete] = useState<CredentialSummary | null>(null);
  const typeOf = (name: string) => types.find((t) => t.name === name);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/credentials/${id}`),
    onSuccess: () => {
      setToDelete(null);
      toast.success('Credencial excluída');
      void queryClient.invalidateQueries({ queryKey: queryKeys.credentials(projectId ?? '') });
    },
    onError: (e) => toast.error('Não foi possível excluir', { description: errorMessage(e) }),
  });

  if (projects && projects.length === 0) {
    return (
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Credenciais</h1>
        <p className="text-muted-foreground">Você ainda não participa de nenhum projeto.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="flex-1 text-2xl font-semibold tracking-tight">Credenciais</h1>
        <div className="grid gap-1.5">
          <Label htmlFor="project-select">Projeto</Label>
          <Select
            id="project-select"
            className="w-64"
            value={projectId ?? ''}
            onChange={(e) => {
              setParams({ project: e.target.value });
            }}
          >
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus /> Nova credencial
          </Button>
        )}
      </div>

      {!canUse ? (
        <p className="text-muted-foreground">
          Você não tem permissão para ver as credenciais deste projeto.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Atualizada</th>
                <th className="w-40 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {credentials.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    Nenhuma credencial neste projeto.
                  </td>
                </tr>
              )}
              {credentials.data?.map((c) => (
                <tr key={c.id} className="border-t" data-testid={`credential-${c.name}`}>
                  <td className="px-4 py-2 font-medium">
                    <span className="flex items-center gap-2">
                      <KeyRound className="size-4 text-muted-foreground" />
                      {c.name}
                    </span>
                  </td>
                  <td className="px-4 py-2">{typeOf(c.type)?.displayName ?? c.type}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {dateFormat.format(new Date(c.updatedAt))}
                  </td>
                  <td className="px-4 py-2">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Testar ${c.name}`}
                          onClick={() => {
                            setTesting(c);
                          }}
                        >
                          <Plug />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${c.name}`}
                          onClick={() => {
                            setEditing(c);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Excluir ${c.name}`}
                          onClick={() => {
                            setToDelete(c);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && projectId && types.length > 0 && (
        <CredentialDialog
          projectId={projectId}
          types={types}
          editing={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {testing && (
        <TestDialog
          credential={testing}
          type={typeOf(testing.type)}
          onClose={() => {
            setTesting(null);
          }}
        />
      )}
      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir credencial?</DialogTitle>
            <DialogDescription>
              “{toDelete?.name}” será excluída. Os nós que a usam vão falhar até receberem outra
              credencial.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setToDelete(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (toDelete) remove.mutate(toDelete.id);
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
