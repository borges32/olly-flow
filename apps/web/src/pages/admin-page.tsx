import {
  ROLE_NAMES,
  type ProjectMember,
  type ProjectSummary,
  type RoleName,
} from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { queryKeys, useMembers, useProjects, useUserSearch } from '@/api/queries';
import { useCan, useCanAnywhere } from '@/api/use-can';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ROLE_LABELS } from '@/lib/roles';
import { cn } from '@/lib/utils';

/** Projetos, membros e papéis (spec 002, FR-013, plan §8). */
export function AdminPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const canCreateProject = useCan('project:manage');
  const canManageSomething = useCanAnywhere('project:manage');
  const { data: allProjects } = useProjects();
  const [selectedId, setSelectedId] = useState<string>();
  const [newProject, setNewProject] = useState('');
  const selectedProject = allProjects?.find((p) => p.id === selectedId);

  const createProject = useMutation({
    mutationFn: (name: string) => api.post<ProjectSummary>('/api/v1/projects', { name }),
    onSuccess: (p) => {
      setNewProject('');
      setSelectedId(p.id);
      toast.success('Projeto criado');
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
    onError: (e) => toast.error('Não foi possível criar o projeto', { description: e.message }),
  });

  if (!canManageSomething) {
    return (
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
        <p className="text-muted-foreground">Acesso restrito a quem administra projetos.</p>
      </div>
    );
  }

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (newProject.trim()) createProject.mutate(newProject.trim());
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle>Projetos</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 px-4">
            {canCreateProject && (
              <form onSubmit={onCreate} className="flex gap-2">
                <Input
                  aria-label="Nome do novo projeto"
                  placeholder="Novo projeto"
                  value={newProject}
                  onChange={(e) => {
                    setNewProject(e.target.value);
                  }}
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Criar projeto"
                  disabled={!newProject.trim()}
                >
                  <Plus />
                </Button>
              </form>
            )}
            <ul className="grid gap-1">
              {allProjects?.map((p) => (
                <ProjectItem
                  key={p.id}
                  project={p}
                  selected={p.id === selectedId}
                  onSelect={() => {
                    setSelectedId(p.id);
                  }}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
        {selectedProject ? (
          <ProjectDetail
            key={selectedProject.id}
            project={selectedProject}
            onDeleted={() => {
              setSelectedId(undefined);
            }}
          />
        ) : (
          <p className="text-muted-foreground">Selecione um projeto para gerenciar os membros.</p>
        )}
      </div>
    </div>
  );
}

function ProjectItem({
  project,
  selected,
  onSelect,
}: {
  project: ProjectSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const canManage = useCan('project:manage', project.id);
  if (!canManage) return null;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent',
          selected && 'bg-accent font-medium',
        )}
      >
        {project.name}
      </button>
    </li>
  );
}

function ProjectDetail({ project, onDeleted }: { project: ProjectSummary; onDeleted: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const projectId = project.id;
  const { data: members } = useMembers(projectId);
  const [name, setName] = useState(project.name);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.members(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  };
  const onError = (e: Error) => toast.error('Operação não concluída', { description: e.message });

  const rename = useMutation({
    mutationFn: () => api.put(`/api/v1/projects/${projectId}`, { name: name.trim() }),
    onSuccess: () => {
      toast.success('Projeto renomeado');
      invalidate();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/v1/projects/${projectId}`),
    onSuccess: () => {
      toast.success('Projeto excluído');
      onDeleted();
      invalidate();
    },
    onError,
  });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: RoleName }) =>
      api.put<ProjectMember>(`/api/v1/projects/${projectId}/members/${userId}`, { role }),
    onSuccess: invalidate,
    onError,
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/v1/projects/${projectId}/members/${userId}`),
    onSuccess: invalidate,
    onError,
  });

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle role="heading" aria-level={2}>
          {project.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 px-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) rename.mutate();
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="project-name">Nome do projeto</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={!name.trim() || name.trim() === project.name}
          >
            Renomear
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              remove.mutate();
            }}
          >
            Excluir projeto
          </Button>
        </form>

        <section className="grid gap-3">
          <h2 className="font-semibold">Membros</h2>
          <AddMember
            projectId={projectId}
            existing={members?.map((m) => m.userId) ?? []}
            onAdd={(userId, role) => {
              setRole.mutate({ userId, role });
            }}
          />
          <table className="w-full text-sm" data-testid="members">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Usuário</th>
                <th className="py-2 font-medium">Papel</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {members?.map((m) => (
                <tr key={m.userId} className="border-t">
                  <td className="py-2">
                    <div className="font-medium">{m.name ?? m.email}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </td>
                  <td className="py-2">
                    <Select
                      aria-label={`Papel de ${m.email}`}
                      className="w-40"
                      value={m.role}
                      onChange={(e) => {
                        setRole.mutate({ userId: m.userId, role: e.target.value as RoleName });
                      }}
                    >
                      {ROLE_NAMES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${m.email}`}
                      onClick={() => {
                        removeMember.mutate(m.userId);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
              {members?.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-muted-foreground">
                    Nenhum membro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </CardContent>
    </Card>
  );
}

function AddMember({
  existing,
  onAdd,
}: {
  projectId: string;
  existing: string[];
  onAdd: (userId: string, role: RoleName) => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<RoleName>('editor');
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
    }, 250);
    return () => {
      clearTimeout(t);
    };
  }, [search]);
  const { data: users } = useUserSearch(debounced, debounced.length >= 2);
  const candidates = users?.filter((u) => !existing.includes(u.id)) ?? [];

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!userId) return;
        onAdd(userId, role);
        setUserId('');
        setSearch('');
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="member-search">Buscar usuário</Label>
        <Input
          id="member-search"
          className="w-56"
          placeholder="Nome ou e-mail"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="member-user">Usuário</Label>
        <Select
          id="member-user"
          className="w-64"
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
          }}
        >
          <option value="">
            {debounced.length < 2 ? 'Digite ao menos 2 letras' : 'Selecione'}
          </option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ? `${u.name} (${u.email})` : u.email}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="member-role">Papel</Label>
        <Select
          id="member-role"
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
      </div>
      <Button type="submit" disabled={!userId}>
        <Plus /> Adicionar
      </Button>
    </form>
  );
}
