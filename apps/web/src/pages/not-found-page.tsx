import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="grid justify-items-start gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Página não encontrada</h1>
      <Button asChild variant="outline">
        <Link to="/">Voltar ao início</Link>
      </Button>
    </div>
  );
}
