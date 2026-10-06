import { ROLE_NAMES, type GroupRoleMapping, type RoleName } from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys, useAdminUsers, useGroupMappings, useProjects } from '@/api/queries';
import { useCan } from '@/api/use-can';
import { AdminNav } from '@/components/layout/admin-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ROLE_LABELS } from '@/lib/roles';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const ALL = '__todos__';

/**
 * SSO (spec 009, FR-005/FR-006): grupos do IdP → papéis, sincronizados no login de cada usuário,
 * e reativação de usuários inativados.
 */
export function AdminSsoPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const allowed = useCan('user:manage');
  const mappings = useGroupMappings();
  const users = useAdminUsers();
  const projects = useProjects();
  const [group, setGroup] = useState('');
  const [projectId, setProjectId] = useState(ALL);
  const [role, setRole] = useState<RoleName>('viewer');
  const onError = (e: unknown) =>
    toast.error('Operação não concluída', {
      description: e instanceof ApiError ? e.message : undefined,
    });
  const create = useMutation({
    mutationFn: () =>
      api.post<GroupRoleMapping>('/api/v1/sso/group-mappings', {
        idpGroup: group.trim(),
        projectId: projectId === ALL ? null : projectId,
        role,
      }),
    onSuccess: () => {
      setGroup('');
      toast.success('Mapeamento criado', {
        description: 'Vale a partir do próximo login de cada usuário do grupo.',
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.groupMappings });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/sso/group-mappings/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.groupMappings }),
    onError,
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.put(`/api/v1/admin/users/${id}/active`, { active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
    onError,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (group.trim()) create.mutate();
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
      <AdminNav />
      {!allowed ? (
        <p className="text-muted-foreground">Acesso restrito à administração da plataforma.</p>
      ) : (
        <>
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle role="heading" aria-level={2}>
                Grupos do IdP → papéis
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 px-4">
              <p className="text-sm text-muted-foreground">
                No login, quem está no grupo recebe o papel; ao sair do grupo, perde o papel herdado
                no login seguinte. Vínculos feitos à mão na tela de projetos não são alterados.
              </p>
              <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
                <Input
                  aria-label="Grupo do IdP"
                  className="w-64"
                  placeholder="Nome ou id do grupo no IdP"
                  value={group}
                  onChange={(e) => {
                    setGroup(e.target.value);
                  }}
                />
                <Select
                  aria-label="Projeto"
                  className="w-56"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                  }}
                >
                  <option value={ALL}>Todos os projetos (global)</option>
                  {(projects.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Papel"
                  className="w-40"
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value as RoleName);
                  }}
                >
                  {ROLE_NAMES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
                <Button type="submit" disabled={!group.trim()}>
                  <Plus /> Mapear
                </Button>
              </form>
              <table className="w-full text-sm" data-testid="group-mappings">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 font-medium">Grupo</th>
                    <th className="py-2 font-medium">Projeto</th>
                    <th className="py-2 font-medium">Papel</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {(mappings.data ?? []).map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="py-2 font-mono text-xs">{m.idpGroup}</td>
                      <td className="py-2">
                        {m.projectName ?? <Badge variant="secondary">global</Badge>}
                      </td>
                      <td className="py-2">{ROLE_LABELS[m.role]}</td>
                      <td>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remover mapeamento de ${m.idpGroup}`}
                          onClick={() => {
                            remove.mutate(m.id);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {mappings.data?.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-muted-foreground">
                        Nenhum grupo mapeado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle role="heading" aria-level={2}>
                Usuários
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <table className="w-full text-sm" data-testid="admin-users">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 font-medium">Usuário</th>
                    <th className="py-2 font-medium">Último login</th>
                    <th className="py-2 font-medium">Situação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(users.data ?? []).map((u) => (
                    <tr key={u.id} className="border-t">
                      <td className="py-2">
                        <div className="font-medium">{u.name ?? u.email}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {u.lastLoginAt ? dateFormat.format(new Date(u.lastLoginAt)) : 'nunca'}
                      </td>
                      <td className="py-2">
                        <Badge variant={u.isActive ? 'default' : 'secondary'}>
                          {u.isActive ? 'ativo' : 'inativo'}
                        </Badge>
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActive.mutate({ id: u.id, active: !u.isActive });
                          }}
                        >
                          {u.isActive ? 'Desativar' : 'Reativar'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
