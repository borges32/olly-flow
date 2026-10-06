import {
  AlertTriangle,
  BadgeCheck,
  History,
  KeyRound,
  LogOut,
  Settings,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { usePublishRequests } from '@/api/queries';
import { useCanAnywhere } from '@/api/use-can';
import { useMe } from '@/api/use-me';
import { useAuth } from '@/auth/auth-provider';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Spec 009: aprovações só para quem pode publicar em algum projeto. */
  publishersOnly?: boolean;
};

const NAV: NavItem[] = [
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/executions', label: 'Execuções', icon: History },
  { to: '/credentials', label: 'Credenciais', icon: KeyRound },
  { to: '/approvals', label: 'Aprovações', icon: BadgeCheck, publishersOnly: true },
  { to: '/admin', label: 'Administração', icon: Settings, adminOnly: true },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const meQuery = useMe();
  const me = meQuery.data;
  const displayName = me?.name ?? me?.email ?? user?.profile.name ?? '';
  const canAdmin = useCanAnywhere('project:manage');
  const canPublish = useCanAnywhere('workflow:publish');
  // Spec 009, FR-011: notificação na aplicação dos pedidos que aguardam a decisão do usuário.
  const pending = usePublishRequests({ status: 'pending' }, canPublish).data ?? [];
  const toDecide = pending.filter((r) => r.requestedBy.id !== me?.id).length;

  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <NavLink to="/" className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Workflow className="size-4" />
          </span>
          Olly Flow
        </NavLink>
        <nav aria-label="Menu principal" className="grid gap-1 p-2">
          {NAV.filter(
            (item) => (!item.adminOnly || canAdmin) && (!item.publishersOnly || canPublish),
          ).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent font-medium text-accent-foreground',
                )
              }
            >
              <Icon className="size-4" />
              {label}
              {to === '/approvals' && toDecide > 0 && (
                <span
                  className="ml-auto rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
                  data-testid="approvals-count"
                  aria-label={`${toDecide} pedidos aguardando aprovação`}
                >
                  {toDecide}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-2 border-b px-4">
          <span className="truncate text-sm font-medium" data-testid="user-name">
            {displayName}
          </span>
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            <LogOut />
            Sair
          </Button>
        </header>
        {meQuery.isError && (
          <div
            role="alert"
            className="flex items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-6 py-3 text-sm text-destructive"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <span className="flex-1">
              Você entrou no provedor de identidade, mas a plataforma não conseguiu carregar seus
              dados
              {meQuery.error.message ? ` (${meQuery.error.message})` : ''}. Tente novamente em
              instantes; se persistir, avise o administrador.
            </span>
            <Button size="sm" variant="outline" onClick={() => void meQuery.refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
