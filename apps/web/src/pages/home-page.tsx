import { Link } from 'react-router';
import { useProjects } from '@/api/queries';
import { useMe } from '@/api/use-me';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROLE_LABELS } from '@/lib/roles';

export function HomePage() {
  const { data: me } = useMe();
  const { data: projects, isError: projectsFailed } = useProjects();
  const isGlobalAdmin = (me?.permissions.global.length ?? 0) > 0;
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {me ? `Olá, ${me.name ?? me.email}` : 'Olá'}
        </h1>
        <p className="text-muted-foreground">Bem-vindo ao Olly Flow.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Seus projetos</CardTitle>
          <CardDescription>
            {isGlobalAdmin
              ? 'Você é administrador global e tem acesso a todos os projetos.'
              : 'Projetos dos quais você participa e o seu papel em cada um.'}
          </CardDescription>
        </CardHeader>
        <CardContent data-testid="projects">
          {projectsFailed ? (
            <p className="text-sm text-destructive">Não foi possível carregar os projetos.</p>
          ) : !projects ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : projects.length > 0 ? (
            <ul className="grid gap-2">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <Link to={`/workflows?project=${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  {p.role && <Badge variant="secondary">{ROLE_LABELS[p.role]}</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Você ainda não participa de nenhum projeto.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
