import type {
  CredentialSummary,
  McpServer,
  McpServerInput,
  McpServerTestResponse,
  McpToolChange,
  McpToolPolicyInput,
  McpToolView,
  McpTransport,
} from '@olly/shared-types';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Plug, Plus, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys, useMcpServers, useMcpTools, useProjects } from '@/api/queries';
import { useCan } from '@/api/use-can';
import { AdminNav } from '@/components/layout/admin-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const TRANSPORT_LABELS: Record<McpTransport, string> = {
  streamableHttp: 'Streamable HTTP',
  sse: 'SSE (legado)',
};
const STATUS_LABELS: Record<McpServer['status'], string> = {
  pending: 'Aguardando aprovação',
  active: 'Ativo',
  disabled: 'Desativado',
};
const CHANGE_LABELS: Record<McpToolChange['kind'], string> = {
  added: 'Nova',
  changed: 'Alterada',
  removed: 'Removida',
};

const errorMessage = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...e.issues.map((i) => i.message)].join(' — ')
    : e instanceof Error
      ? e.message
      : String(e);

/** Credenciais MCP de todos os projetos (o servidor global usa a de qualquer projeto). */
function useMcpCredentials() {
  const api = useApi();
  const { data: projects = [] } = useProjects();
  const results = useQueries({
    queries: projects.map((p) => ({
      queryKey: queryKeys.credentials(p.id),
      queryFn: () => api.get<CredentialSummary[]>(`/api/v1/projects/${p.id}/credentials`),
    })),
  });
  return projects.map((p, i) => ({
    project: p,
    credentials: (results[i]?.data ?? []).filter((c) => c.type.startsWith('mcp')),
  }));
}

/** Cadastro e edição de servidor (FR-001). Somente transportes HTTP nesta versão (FR-005). */
function ServerDialog({ editing, onClose }: { editing: McpServer | null; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useProjects();
  const groups = useMcpCredentials();
  const [form, setForm] = useState<McpServerInput>({
    name: editing?.name ?? '',
    description: editing?.description ?? '',
    transport: editing?.transport ?? 'streamableHttp',
    url: editing?.url ?? '',
    credentialId: editing?.credentialId ?? null,
    projectId: editing?.projectId ?? null,
  });
  const set = (patch: Partial<McpServerInput>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };
  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.put<McpServer>(`/api/v1/mcp-servers/${editing.id}`, form)
        : api.post<McpServer>('/api/v1/mcp-servers', form),
    onSuccess: (server) => {
      toast.success(
        editing && server.status === 'pending' && editing.status !== 'pending'
          ? 'Servidor atualizado: aprove de novo para voltar a usá-lo'
          : editing
            ? 'Servidor atualizado'
            : 'Servidor cadastrado (aguardando aprovação)',
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers });
      onClose();
    },
    onError: (e) => toast.error('Não foi possível salvar', { description: errorMessage(e) }),
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const visibleGroups = form.projectId
    ? groups.filter((g) => g.project.id === form.projectId)
    : groups;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <form onSubmit={onSubmit} className="grid gap-4" data-testid="mcp-server-form">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar servidor MCP' : 'Novo servidor MCP'}</DialogTitle>
            <DialogDescription>
              O servidor entra pendente e só é usado depois de aprovado. Trocar o endereço, o
              transporte, a credencial ou o escopo exige nova aprovação.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-name">Nome</Label>
            <Input
              id="mcp-name"
              required
              value={form.name}
              onChange={(e) => {
                set({ name: e.target.value });
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-description">Descrição</Label>
            <Input
              id="mcp-description"
              value={form.description ?? ''}
              onChange={(e) => {
                set({ description: e.target.value });
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-transport">Transporte</Label>
            <Select
              id="mcp-transport"
              value={form.transport}
              onChange={(e) => {
                set({ transport: e.target.value as McpTransport });
              }}
            >
              {Object.entries(TRANSPORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Somente servidores via HTTP nesta versão. O endereço passa pelo filtro anti-SSRF.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              required
              placeholder="https://mcp.exemplo.gov.br/mcp"
              value={form.url}
              onChange={(e) => {
                set({ url: e.target.value });
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-scope">Escopo</Label>
            <Select
              id="mcp-scope"
              value={form.projectId ?? ''}
              onChange={(e) => {
                set({ projectId: e.target.value || null, credentialId: null });
              }}
            >
              <option value="">Global (todos os projetos)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  Projeto: {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-credential">Credencial</Label>
            <Select
              id="mcp-credential"
              value={form.credentialId ?? ''}
              onChange={(e) => {
                set({ credentialId: e.target.value || null });
              }}
            >
              <option value="">Nenhuma</option>
              {visibleGroups
                .filter((g) => g.credentials.length > 0)
                .map((g) => (
                  <optgroup key={g.project.id} label={g.project.name}>
                    {g.credentials.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Credenciais MCP (Bearer, cabeçalhos ou OAuth). Usada no teste, na aprovação e nas
              execuções; o nó pode informar a sua.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={save.isPending || !form.name.trim() || !form.url.trim()}
            >
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** HU-1, cenário 1: capacidades e tools do servidor. */
function TestResultDialog({
  server,
  result,
  onClose,
}: {
  server: McpServer;
  result: McpServerTestResponse;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto" data-testid="mcp-test-result">
        <DialogHeader>
          <DialogTitle>Teste de “{server.name}”</DialogTitle>
          <DialogDescription>
            {result.ok ? 'Conexão bem-sucedida.' : 'Não foi possível conectar.'}
          </DialogDescription>
        </DialogHeader>
        {result.ok ? (
          <div className="grid gap-3 text-sm">
            <p className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
              {result.serverInfo?.name ?? 'Servidor'} {result.serverInfo?.version} · protocolo{' '}
              {result.serverInfo?.protocolVersion ?? '—'}
            </p>
            <p>
              <span className="font-medium">Capacidades:</span>{' '}
              {Object.keys(result.serverInfo?.capabilities ?? {}).join(', ') || '—'}
            </p>
            <div>
              <p className="font-medium">Tools ({result.tools?.length ?? 0})</p>
              <ul className="mt-1 grid gap-1">
                {result.tools?.map((t) => (
                  <li key={t.name}>
                    <span className="font-mono">{t.name}</span>
                    {t.description && (
                      <span className="text-muted-foreground"> — {t.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="size-4" />
            {result.message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** FR-003: diff da mudança pendente (descrição e schema) e "Aceitar mudança". */
function PendingDiff({ server }: { server: McpServer }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const accept = useMutation({
    mutationFn: () => api.post<McpServer>(`/api/v1/mcp-servers/${server.id}/snapshot/accept`),
    onSuccess: () => {
      toast.success('Mudança aceita: o snapshot foi atualizado');
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers });
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers', server.id] });
    },
    onError: (e) => toast.error('Não foi possível aceitar', { description: errorMessage(e) }),
  });
  if (!server.pendingDiff) return null;
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  return (
    <div className="grid gap-3 rounded-md border border-amber-500/50 p-3" data-testid="mcp-diff">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm">
          <span className="font-medium">Mudança detectada</span> em{' '}
          {new Date(server.pendingDiff.detectedAt).toLocaleString('pt-BR')}. Tools liberadas que
          mudaram ficam bloqueadas até a revisão; tools novas continuam negadas.
        </p>
        <Button
          size="sm"
          onClick={() => {
            accept.mutate();
          }}
          disabled={accept.isPending}
        >
          Aceitar mudança
        </Button>
      </div>
      {server.pendingDiff.changes.map((change) => (
        <div key={change.name} className="grid gap-2" data-testid={`mcp-diff-${change.name}`}>
          <p className="text-sm">
            <span className="font-mono font-medium">{change.name}</span>{' '}
            <Badge variant={change.kind === 'added' ? 'secondary' : 'warning'}>
              {CHANGE_LABELS[change.kind]}
            </Badge>
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {(['before', 'after'] as const).map((side) => (
              <div key={side} className="grid gap-1">
                <p className="text-xs text-muted-foreground">
                  {side === 'before' ? 'Aprovado' : 'Anunciado agora'}
                </p>
                {change[side] ? (
                  <>
                    <p className="text-xs">{change[side].description ?? '(sem descrição)'}</p>
                    <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-[11px]">
                      {json(change[side].inputSchema)}
                    </pre>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">—</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** FR-002: liberação de tools (negadas por padrão) e marcação de destrutiva, por escopo. */
function ToolsPanel({ server }: { server: McpServer }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useProjects();
  const [scope, setScope] = useState<string>(server.projectId ?? '');
  const projectId = scope || null;
  const { data: tools = [], isLoading } = useMcpTools(server.id, projectId);
  const [edits, setEdits] = useState<Record<string, McpToolPolicyInput>>({});
  const current = (t: McpToolView): McpToolPolicyInput =>
    edits[t.name] ?? {
      toolName: t.name,
      allowed: t.policy.allowed,
      destructive: t.policy.destructive,
    };
  const edit = (t: McpToolView, patch: Partial<McpToolPolicyInput>) => {
    setEdits((prev) => ({ ...prev, [t.name]: { ...current(t), ...patch } }));
  };
  const save = useMutation({
    // Só as linhas alteradas: uma política de projeto prevalece sobre a global.
    mutationFn: () =>
      api.put<McpToolView[]>(`/api/v1/mcp-servers/${server.id}/policies`, {
        projectId,
        policies: Object.values(edits),
      }),
    onSuccess: () => {
      setEdits({});
      toast.success('Políticas salvas');
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers', server.id] });
    },
    onError: (e) => toast.error('Não foi possível salvar', { description: errorMessage(e) }),
  });
  const SOURCE = { project: 'do projeto', global: 'global', default: 'padrão (negada)' } as const;
  return (
    <div className="grid gap-3" data-testid="mcp-tools">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="mcp-policy-scope">Políticas para</Label>
          <Select
            id="mcp-policy-scope"
            className="w-64"
            value={scope}
            disabled={server.projectId !== null}
            onChange={(e) => {
              setScope(e.target.value);
              setEdits({});
            }}
          >
            <option value="">Todos os projetos (global)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <p className="flex-1 text-xs text-muted-foreground">
          Tools são negadas por padrão. A política de um projeto prevalece sobre a global.
          Destrutivas exigem aprovação humana quando usadas por agentes (spec 011).
        </p>
        <Button
          size="sm"
          disabled={save.isPending || Object.keys(edits).length === 0}
          onClick={() => {
            save.mutate();
          }}
        >
          Salvar políticas
        </Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando tools…</p>
      ) : tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sem tools no snapshot. Aprove o servidor para gravar as tools anunciadas.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tool</th>
                <th className="px-3 py-2 font-medium">Liberada</th>
                <th className="px-3 py-2 font-medium">Destrutiva</th>
                <th className="px-3 py-2 font-medium">Origem</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => {
                const value = current(t);
                return (
                  <tr key={t.name} className="border-t" data-testid={`mcp-tool-${t.name}`}>
                    <td className="px-3 py-2">
                      <span className="font-mono">{t.name}</span>
                      {t.changed && (
                        <Badge variant="warning" className="ml-2">
                          Mudança pendente
                        </Badge>
                      )}
                      {t.description && (
                        <p className="text-xs text-muted-foreground">{t.description}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        aria-label={`Liberar ${t.name}`}
                        checked={value.allowed}
                        onChange={(e) => {
                          edit(t, { allowed: e.target.checked });
                        }}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        aria-label={`Destrutiva ${t.name}`}
                        checked={value.destructive}
                        onChange={(e) => {
                          edit(t, { destructive: e.target.checked });
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {edits[t.name] ? 'alterada (não salva)' : SOURCE[t.policy.source]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Catálogo de servidores MCP (spec 010, HU-1): cadastro, teste, aprovação, políticas e diff. */
export function AdminMcpPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const allowed = useCan('mcp:manage');
  const { data: servers = [] } = useMcpServers(allowed);
  const { data: projects = [] } = useProjects();
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tested, setTested] = useState<{ server: McpServer; result: McpServerTestResponse } | null>(
    null,
  );
  const selected = servers.find((s) => s.id === selectedId) ?? null;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers });

  const action = useMutation({
    mutationFn: async ({
      server,
      kind,
    }: {
      server: McpServer;
      kind: 'test' | 'approve' | 'disable' | 'delete';
    }) => {
      if (kind === 'test') {
        return {
          server,
          kind,
          result: await api.post<McpServerTestResponse>(`/api/v1/mcp-servers/${server.id}/test`),
        };
      }
      if (kind === 'delete') {
        await api.delete(`/api/v1/mcp-servers/${server.id}`);
        return { server, kind };
      }
      await api.post<McpServer>(`/api/v1/mcp-servers/${server.id}/${kind}`);
      return { server, kind };
    },
    onSuccess: ({ server, kind, result }) => {
      if (result) setTested({ server, result });
      if (kind === 'approve')
        toast.success(`“${server.name}” aprovado: snapshot das tools gravado`);
      if (kind === 'disable') toast.success(`“${server.name}” desativado`);
      if (kind === 'delete') {
        toast.success(`“${server.name}” excluído`);
        if (selectedId === server.id) setSelectedId(null);
      }
      refresh();
    },
    onError: (e) => toast.error('Não foi possível concluir', { description: errorMessage(e) }),
  });
  const run = (server: McpServer, kind: 'test' | 'approve' | 'disable' | 'delete') => {
    action.mutate({ server, kind });
  };
  const projectName = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.name ?? 'Projeto') : 'Global';

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
      <AdminNav />
      {!allowed ? (
        <p className="text-muted-foreground">Acesso restrito à administração da plataforma.</p>
      ) : (
        <>
          <Card className="gap-4 py-4">
            <CardHeader className="flex flex-row items-center gap-2 px-4">
              <CardTitle role="heading" aria-level={2} className="flex-1">
                Servidores MCP
              </CardTitle>
              <Button
                size="sm"
                onClick={() => {
                  setEditing('new');
                }}
              >
                <Plus /> Novo servidor
              </Button>
            </CardHeader>
            <CardContent className="px-4">
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm" data-testid="mcp-servers">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Nome</th>
                      <th className="px-3 py-2 font-medium">Endereço</th>
                      <th className="px-3 py-2 font-medium">Escopo</th>
                      <th className="px-3 py-2 font-medium">Situação</th>
                      <th className="w-56 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {servers.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                          Nenhum servidor MCP no catálogo.
                        </td>
                      </tr>
                    )}
                    {servers.map((s) => (
                      <tr
                        key={s.id}
                        className={`border-t ${selectedId === s.id ? 'bg-accent/40' : ''}`}
                        data-testid={`mcp-server-${s.name}`}
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="font-medium hover:underline"
                            onClick={() => {
                              setSelectedId(s.id);
                            }}
                          >
                            {s.name}
                          </button>
                          {s.description && (
                            <p className="text-xs text-muted-foreground">{s.description}</p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs">{s.url}</span>
                          <p className="text-xs text-muted-foreground">
                            {TRANSPORT_LABELS[s.transport]}
                          </p>
                        </td>
                        <td className="px-3 py-2">{projectName(s.projectId)}</td>
                        <td className="px-3 py-2">
                          <Badge
                            variant={
                              s.status === 'active'
                                ? 'default'
                                : s.status === 'pending'
                                  ? 'secondary'
                                  : 'outline'
                            }
                          >
                            {STATUS_LABELS[s.status]}
                          </Badge>
                          {s.pendingDiff && (
                            <Badge variant="warning" className="ml-1">
                              Mudança pendente
                            </Badge>
                          )}
                          {s.status === 'active' && (
                            <p className="text-xs text-muted-foreground">{s.toolCount} tools</p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Testar ${s.name}`}
                              disabled={action.isPending}
                              onClick={() => {
                                run(s, 'test');
                              }}
                            >
                              <Plug />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Aprovar ${s.name}`}
                              title="Aprovar (grava o snapshot das tools)"
                              disabled={action.isPending}
                              onClick={() => {
                                run(s, 'approve');
                              }}
                            >
                              <ShieldCheck />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Editar ${s.name}`}
                              onClick={() => {
                                setEditing(s);
                              }}
                            >
                              <Pencil />
                            </Button>
                            {s.status === 'active' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={action.isPending}
                                onClick={() => {
                                  run(s, 'disable');
                                }}
                              >
                                Desativar
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Excluir ${s.name}`}
                              disabled={action.isPending}
                              onClick={() => {
                                run(s, 'delete');
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          {selected && (
            <Card className="gap-4 py-4" data-testid="mcp-server-detail">
              <CardHeader className="px-4">
                <CardTitle role="heading" aria-level={2}>
                  Tools de “{selected.name}”
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 px-4">
                <PendingDiff server={selected} />
                <ToolsPanel key={selected.id} server={selected} />
              </CardContent>
            </Card>
          )}
        </>
      )}
      {editing && (
        <ServerDialog
          editing={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {tested && (
        <TestResultDialog
          server={tested.server}
          result={tested.result}
          onClose={() => {
            setTested(null);
          }}
        />
      )}
    </div>
  );
}
