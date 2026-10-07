import { PASSWORD_MIN_LENGTH } from '@olly/shared-types';
import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Spec 014 (FR-007): troca da própria senha. Obrigatória no primeiro acesso com senha definida
 * pela administração (`required`), ou voluntária pelo menu.
 */
export function ChangePasswordPage({ required = false }: { required?: boolean }) {
  const api = useApi();
  const { passwordChanged, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (form.next !== form.confirm) {
      setError('As senhas novas não conferem');
      return;
    }
    setPending(true);
    setError(undefined);
    api
      .put('/api/v1/auth/password', { currentPassword: form.current, newPassword: form.next })
      .then(() => {
        toast.success('Senha alterada');
        passwordChanged();
        if (!required) void navigate('/');
      })
      .catch((err: unknown) => {
        setPending(false);
        setError(err instanceof ApiError ? err.message : 'Não foi possível trocar a senha');
      });
  };
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };
  const card = (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" /> Trocar senha
        </CardTitle>
        <CardDescription>
          {required
            ? 'Sua senha foi definida pela administração. Escolha uma nova para continuar.'
            : 'As outras sessões abertas com esta conta serão encerradas.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={submit} data-testid="change-password-form">
          <div className="grid gap-1.5">
            <Label htmlFor="pwd-current">Senha atual</Label>
            <Input
              id="pwd-current"
              type="password"
              required
              autoComplete="current-password"
              value={form.current}
              onChange={set('current')}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pwd-next">Nova senha</Label>
            <Input
              id="pwd-next"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              value={form.next}
              onChange={set('next')}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pwd-confirm">Confirme a nova senha</Label>
            <Input
              id="pwd-confirm"
              type="password"
              required
              autoComplete="new-password"
              value={form.confirm}
              onChange={set('confirm')}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Pelo menos {PASSWORD_MIN_LENGTH} caracteres; evite senhas comuns e o seu e-mail.
          </p>
          <Button type="submit" disabled={pending}>
            Salvar nova senha
          </Button>
          {required && (
            <Button type="button" variant="ghost" onClick={() => void logout()}>
              Sair
            </Button>
          )}
          {error && (
            <p role="alert" className="text-center text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
  return required ? (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">{card}</main>
  ) : (
    <div className="flex justify-center py-6">{card}</div>
  );
}
