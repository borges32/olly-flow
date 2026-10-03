import { LogIn, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/auth-provider';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function LoginPage({ returnTo }: { returnTo?: string }) {
  const { login } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const onLogin = () => {
    setPending(true);
    setError(undefined);
    login(returnTo).catch(() => {
      setPending(false);
      setError('Não foi possível contatar o provedor de identidade. Tente novamente em instantes.');
    });
  };

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
        <CardContent className="grid gap-4">
          <Button size="lg" onClick={onLogin} disabled={pending}>
            <LogIn />
            Entrar com conta institucional
          </Button>
          {error && (
            <p role="alert" className="text-center text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
