import type { User } from 'oidc-client-ts';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { LoginState } from '@/auth/auth-provider';
import { getUserManager } from '@/auth/oidc';
import { Button } from '@/components/ui/button';

// O StrictMode executa efeitos duas vezes; o código de autorização só pode ser trocado uma.
let pendingCallback: Promise<User> | undefined;

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    pendingCallback ??= getUserManager().signinRedirectCallback();
    pendingCallback
      .then((user) => {
        const { returnTo } = (user.state ?? {}) as LoginState;
        // Só caminhos internos: evita open redirect via `state`.
        const target = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
        void navigate(target, { replace: true });
      })
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        pendingCallback = undefined;
      });
  }, [navigate]);

  if (!failed) {
    return <p className="p-8 text-center text-muted-foreground">Concluindo login…</p>;
  }
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <p role="alert">Não foi possível concluir o login.</p>
      <Button onClick={() => void navigate('/', { replace: true })}>Tentar novamente</Button>
    </main>
  );
}
