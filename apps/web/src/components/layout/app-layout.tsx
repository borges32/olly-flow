import { History, KeyRound, LogOut, Settings, Workflow, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useMe } from '@/api/use-me';
import { useAuth } from '@/auth/auth-provider';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/executions', label: 'Execuções', icon: History },
  { to: '/credentials', label: 'Credenciais', icon: KeyRound },
  { to: '/admin', label: 'Administração', icon: Settings },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { data: me } = useMe();
  const displayName = me?.name ?? me?.email ?? user?.profile.name ?? '';

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
          {NAV.map(({ to, label, icon: Icon }) => (
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
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
