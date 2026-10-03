import { Outlet, useLocation } from 'react-router';
import { LoginPage } from '@/pages/login-page';
import { useAuth } from './auth-provider';

/** Rotas internas: sem sessão, mostra a tela de login e volta para a rota pedida após autenticar. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return null;
  if (status === 'anonymous') return <LoginPage returnTo={location.pathname + location.search} />;
  return <Outlet />;
}
