import { ROLE_NAMES, type GroupRoleMapping, type RoleName } from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys, useGroupMappings, useProjects } from '@/api/queries';
import { useCan } from '@/api/use-can';
import { AdminNav } from '@/components/layout/admin-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/auth/auth-provider';
import { ROLE_LABELS } from '@/lib/roles';
import { UsersCard } from './admin-users-card';

const ALL = '__todos__';

/**
 * Usuários (spec 014, FR-006, FR-014) e SSO (spec 009, FR-005/FR-006): usuários locais e do
 * IdP, administração global, redefinição de senha e grupos do IdP → papéis (com o IdP ativado).
 */
export function AdminSsoPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const allowed = useCan('user:manage');
  const mappings = useGroupMappings();
  const { config } = useAuth();
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
          <UsersCard />
          {/* Spec 014 (FR-010): os grupos do IdP só fazem sentido com o IdP ativado. */}
          {config?.idpEnabled && (
            <Card className="gap-4 py-4">
              <CardHeader className="px-4">
                <CardTitle role="heading" aria-level={2}>
                  Grupos do IdP → papéis
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 px-4">
                <p className="text-sm text-muted-foreground">
                  No login, quem está no grupo recebe o papel; ao sair do grupo, perde o papel
                  herdado no login seguinte. Vínculos feitos à mão na tela de projetos não são
                  alterados.
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
          )}
        </>
      )}
    </div>
  );
}
