import { NavLink } from 'react-router';
import { useCan, useCanAnywhere } from '@/api/use-can';
import { cn } from '@/lib/utils';

/** Abas da administração (spec 009): cada uma só aparece com a permissão correspondente. */
export function AdminNav() {
  const projects = useCanAnywhere('project:manage');
  const users = useCan('user:manage');
  const masking = useCan('project:manage');
  const audit = useCan('audit:read');
  const tabs = [
    projects && { to: '/admin', label: 'Projetos', end: true },
    users && { to: '/admin/sso', label: 'SSO e usuários' },
    masking && { to: '/admin/masking', label: 'Mascaramento' },
    audit && { to: '/admin/audit', label: 'Auditoria' },
  ].filter((t): t is { to: string; label: string; end?: boolean } => Boolean(t));
  return (
    <nav aria-label="Administração" className="flex gap-1 border-b">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end ?? false}
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground',
              isActive ? 'border-primary font-medium text-foreground' : 'border-transparent',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
