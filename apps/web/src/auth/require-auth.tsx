import { Outlet, useLocation } from 'react-router';
import { ChangePasswordPage } from '@/pages/change-password-page';
import { LoginPage } from '@/pages/login-page';
import { useAuth } from './auth-provider';

/**
 * Rotas internas: sem sessão, mostra a tela de entrada e volta para a rota pedida após
 * autenticar. Spec 014 (FR-007): com a troca de senha pendente, só a troca de senha.
 */
export function RequireAuth() {
  const { status, mustChangePassword } = useAuth();
  const location = useLocation();
  if (status === 'loading') return null;
  if (status === 'anonymous') return <LoginPage returnTo={location.pathname + location.search} />;
  if (mustChangePassword) return <ChangePasswordPage required />;
  return <Outlet />;
}
