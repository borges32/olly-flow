import { useMe } from '@/api/use-me';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function HomePage() {
  const { data: me } = useMe();
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
          <CardTitle>Suas permissões</CardTitle>
          <CardDescription>Concedidas pelos grupos da sua conta institucional.</CardDescription>
        </CardHeader>
        <CardContent>
          {me && me.permissions.length > 0 ? (
            <ul className="flex flex-wrap gap-2" data-testid="permissions">
              {me.permissions.map((p) => (
                <li
                  key={p}
                  className="rounded-md bg-accent px-2 py-1 font-mono text-xs text-accent-foreground"
                >
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma permissão atribuída.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
