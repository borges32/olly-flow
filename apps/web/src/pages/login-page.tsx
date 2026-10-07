import { PASSWORD_MIN_LENGTH } from '@olly/shared-types';
import { LogIn, UserPlus, Workflow } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/auth-provider';
import { AuthRequestError } from '@/auth/local-session';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const message = (e: unknown) =>
  e instanceof AuthRequestError
    ? e.message
    : 'Não foi possível contatar a plataforma. Tente de novo.';

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Spec 014 (FR-001): cadastro do primeiro usuário, que vira administrador da plataforma. */
function SetupForm({ returnTo }: { returnTo?: string }) {
  const { setup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError('As senhas não conferem');
      return;
    }
    setPending(true);
    setError(undefined);
    setup({ name: form.name, email: form.email, password: form.password })
      .then(() => {
        void navigate(returnTo ?? '/');
      })
      .catch((err: unknown) => {
        setPending(false);
        setError(message(err));
      });
  };
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };
  return (
    <form className="grid gap-3" onSubmit={submit} data-testid="setup-form">
      <p className="text-sm text-muted-foreground">
        Instalação nova: cadastre o primeiro usuário. Ele será o administrador da plataforma.
      </p>
      <Field id="setup-name" label="Nome">
        <Input
          id="setup-name"
          required
          autoComplete="name"
          value={form.name}
          onChange={set('name')}
        />
      </Field>
      <Field id="setup-email" label="E-mail">
        <Input
          id="setup-email"
          type="email"
          required
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
        />
      </Field>
      <Field id="setup-password" label="Senha">
        <Input
          id="setup-password"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
        />
      </Field>
      <Field id="setup-confirm" label="Confirme a senha">
        <Input
          id="setup-confirm"
          type="password"
          required
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        Pelo menos {PASSWORD_MIN_LENGTH} caracteres; evite senhas comuns e o seu e-mail.
      </p>
      <Button size="lg" type="submit" disabled={pending}>
        <UserPlus />
        Criar administrador e entrar
      </Button>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/** Spec 014 (FR-004): e-mail e senha; com o IdP ativado, também a conta institucional. */
function LoginForm({ returnTo, idpEnabled }: { returnTo?: string; idpEnabled: boolean }) {
  const { loginLocal, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    loginLocal({ email, password })
      .then(() => {
        if (returnTo) void navigate(returnTo);
      })
      .catch((err: unknown) => {
        setPending(false);
        setError(message(err));
      });
  };
  const onInstitutional = () => {
    setPending(true);
    setError(undefined);
    login(returnTo).catch(() => {
      setPending(false);
      setError('Não foi possível contatar o provedor de identidade. Tente novamente em instantes.');
    });
  };
  return (
    <div className="grid gap-4">
      <form className="grid gap-3" onSubmit={submit} data-testid="login-form">
        <Field id="login-email" label="E-mail">
          <Input
            id="login-email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </Field>
        <Field id="login-password" label="Senha">
          <Input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </Field>
        <Button size="lg" type="submit" disabled={pending}>
          <LogIn />
          Entrar
        </Button>
      </form>
      {idpEnabled && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
          </div>
          <Button size="lg" variant="outline" onClick={onInstitutional} disabled={pending}>
            <LogIn />
            Entrar com conta institucional
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function LoginPage({ returnTo }: { returnTo?: string }) {
  const { config } = useAuth();
  return (
    <main className="relative flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="justify-items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Workflow className="size-6" />
          </div>
          <CardTitle className="text-2xl">Olly Flow</CardTitle>
          <CardDescription>Automação de workflows com IA</CardDescription>
        </CardHeader>
        <CardContent>
          {config?.setupRequired ? (
            <SetupForm {...(returnTo && { returnTo })} />
          ) : (
            <LoginForm {...(returnTo && { returnTo })} idpEnabled={config?.idpEnabled ?? false} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
