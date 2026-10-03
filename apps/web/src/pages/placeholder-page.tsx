import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function PlaceholderPage({ title, spec }: { title: string; spec: string }) {
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Em construção</CardTitle>
          <CardDescription>Disponível a partir da spec {spec}.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
