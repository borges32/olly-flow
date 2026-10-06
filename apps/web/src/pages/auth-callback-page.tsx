import type { User } from 'oidc-client-ts';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { LoginState } from '@/auth/auth-provider';
import { getUserManager } from '@/auth/oidc';
import { Button } from '@/components/ui/button';

// O StrictMode executa efeitos duas vezes; o código de autorização só pode ser trocado uma.
let pendingCallback: Promise<User> | undefined;

class LoginRejected extends Error {}

/**
 * Spec 009 (FR-005, FR-007): registra o login na plataforma, que audita e sincroniza os papéis
 * vindos dos grupos do IdP. Recusa (usuário inativo) interrompe o login; falha de rede não.
 */
async function registerLogin(user: User): Promise<void> {
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { authorization: `Bearer ${user.access_token}` },
  }).catch(() => undefined);
  if (res && (res.status === 401 || res.status === 403)) {
    const body = (await res.json().catch(() => undefined)) as
      { error?: { message?: string } } | undefined;
    throw new LoginRejected(body?.error?.message ?? 'Acesso negado pela plataforma');
  }
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState<string>();

  useEffect(() => {
    pendingCallback ??= getUserManager()
      .signinRedirectCallback()
      .then(async (user) => {
        await registerLogin(user);
        return user;
      });
    pendingCallback
      .then((user) => {
        const { returnTo } = (user.state ?? {}) as LoginState;
        // Só caminhos internos: evita open redirect via `state`.
        const target = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
        void navigate(target, { replace: true });
      })
      .catch((error: unknown) => {
        if (error instanceof LoginRejected) {
          setReason(error.message);
          void getUserManager().removeUser();
        }
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
      <p role="alert">Não foi possível concluir o login{reason ? `: ${reason}` : '.'}</p>
      <Button onClick={() => void navigate('/', { replace: true })}>Tentar novamente</Button>
    </main>
  );
}
