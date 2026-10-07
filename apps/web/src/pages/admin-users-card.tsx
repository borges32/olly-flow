import { PASSWORD_MIN_LENGTH, type UserAdminSummary, type UserOrigin } from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys, useAdminUsers } from '@/api/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const ORIGIN: Record<UserOrigin, string> = { local: 'local', idp: 'IdP', linked: 'local + IdP' };

const errorText = (e: unknown) =>
  e instanceof ApiError ? [e.message, ...e.issues.map((i) => i.message)].join(' — ') : undefined;

type Row = { kind: 'edit' | 'password'; id: string } | null;

/** Spec 014 (FR-006, FR-009, FR-014): usuários locais e do IdP. */
export function UsersCard() {
  const api = useApi();
  const queryClient = useQueryClient();
  const users = useAdminUsers();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', isAdmin: false });
  const [row, setRow] = useState<Row>(null);
  const [draft, setDraft] = useState({ name: '', email: '', password: '' });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
  const onError = (e: unknown) =>
    toast.error('Operação não concluída', { description: errorText(e) });

  const create = useMutation({
    mutationFn: () => api.post<UserAdminSummary>('/api/v1/admin/users', form),
    onSuccess: () => {
      toast.success('Usuário criado', {
        description: 'Ele troca a senha no primeiro acesso.',
      });
      setForm({ name: '', email: '', password: '', isAdmin: false });
      setCreating(false);
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch<UserAdminSummary>(`/api/v1/admin/users/${id}`, body),
    onSuccess: () => {
      setRow(null);
      refresh();
    },
    onError,
  });
  const reset = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.put(`/api/v1/admin/users/${id}/password`, { password }),
    onSuccess: () => {
      toast.success('Senha redefinida', {
        description: 'As sessões do usuário foram encerradas; ele troca a senha ao entrar.',
      });
      setRow(null);
      refresh();
    },
    onError,
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.put(`/api/v1/admin/users/${id}/active`, { active }),
    onSuccess: refresh,
    onError,
  });

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle role="heading" aria-level={2}>
          Usuários
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCreating((c) => !c);
          }}
        >
          <UserPlus /> Novo usuário local
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 px-4">
        {creating && (
          <form
            onSubmit={submitCreate}
            className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-4"
            data-testid="new-user-form"
          >
            <div className="grid gap-1">
              <Label htmlFor="new-user-name">Nome</Label>
              <Input
                id="new-user-name"
                required
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="new-user-email">E-mail</Label>
              <Input
                id="new-user-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => {
                  setForm({ ...form, email: e.target.value });
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="new-user-password">Senha inicial</Label>
              <Input
                id="new-user-password"
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => {
                  setForm({ ...form, password: e.target.value });
                }}
              />
            </div>
            <label className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                checked={form.isAdmin}
                onChange={(e) => {
                  setForm({ ...form, isAdmin: e.target.checked });
                }}
              />
              Administrador da plataforma
            </label>
            <p className="text-xs text-muted-foreground sm:col-span-3">
              O usuário troca a senha inicial no primeiro acesso. Pelo menos {PASSWORD_MIN_LENGTH}{' '}
              caracteres.
            </p>
            <Button type="submit" size="sm" disabled={create.isPending}>
              Criar usuário
            </Button>
          </form>
        )}
        <table className="w-full text-sm" data-testid="admin-users">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Usuário</th>
              <th className="py-2 font-medium">Origem</th>
              <th className="py-2 font-medium">Último acesso</th>
              <th className="py-2 font-medium">Situação</th>
              <th className="py-2 font-medium">Admin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id} className="border-t align-top" data-testid={`user-${u.email}`}>
                <td className="py-2">
                  {row?.kind === 'edit' && row.id === u.id ? (
                    <form
                      className="grid gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        update.mutate({ id: u.id, body: { name: draft.name, email: draft.email } });
                      }}
                    >
                      <Input
                        aria-label="Nome"
                        value={draft.name}
                        onChange={(e) => {
                          setDraft({ ...draft, name: e.target.value });
                        }}
                      />
                      <Input
                        aria-label="E-mail"
                        type="email"
                        value={draft.email}
                        onChange={(e) => {
                          setDraft({ ...draft, email: e.target.value });
                        }}
                      />
                      <div className="flex gap-1">
                        <Button type="submit" size="sm">
                          Salvar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRow(null);
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="font-medium">{u.name ?? u.email}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </>
                  )}
                  {row?.kind === 'password' && row.id === u.id && (
                    <form
                      className="mt-2 flex flex-wrap items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        reset.mutate({ id: u.id, password: draft.password });
                      }}
                    >
                      <Input
                        aria-label={`Nova senha de ${u.email}`}
                        type="password"
                        className="w-56"
                        minLength={PASSWORD_MIN_LENGTH}
                        required
                        autoComplete="new-password"
                        value={draft.password}
                        onChange={(e) => {
                          setDraft({ ...draft, password: e.target.value });
                        }}
                      />
                      <Button type="submit" size="sm">
                        Redefinir
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRow(null);
                        }}
                      >
                        Cancelar
                      </Button>
                    </form>
                  )}
                </td>
                <td className="py-2">
                  <Badge variant="outline">{ORIGIN[u.origin]}</Badge>
                </td>
                <td className="py-2 text-muted-foreground">
                  {u.lastLoginAt ? dateFormat.format(new Date(u.lastLoginAt)) : 'nunca'}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={u.isActive ? 'default' : 'secondary'}>
                      {u.isActive ? 'ativo' : 'inativo'}
                    </Badge>
                    {u.locked && <Badge variant="warning">bloqueado</Badge>}
                    {u.mustChangePassword && (
                      <Badge variant="warning">troca de senha pendente</Badge>
                    )}
                  </div>
                </td>
                <td className="py-2">
                  <input
                    type="checkbox"
                    aria-label={`Administrador: ${u.email}`}
                    checked={u.isAdmin}
                    onChange={(e) => {
                      update.mutate({ id: u.id, body: { isAdmin: e.target.checked } });
                    }}
                  />
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Editar ${u.email}`}
                    onClick={() => {
                      setDraft({ name: u.name ?? '', email: u.email, password: '' });
                      setRow({ kind: 'edit', id: u.id });
                    }}
                  >
                    <Pencil />
                  </Button>
                  {u.origin !== 'idp' && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Redefinir senha de ${u.email}`}
                      onClick={() => {
                        setDraft({ name: '', email: '', password: '' });
                        setRow({ kind: 'password', id: u.id });
                      }}
                    >
                      <KeyRound />
                    </Button>
                  )}
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
  );
}
