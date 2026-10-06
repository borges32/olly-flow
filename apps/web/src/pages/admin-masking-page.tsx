import { useCan } from '@/api/use-can';
import { AdminNav } from '@/components/layout/admin-nav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MaskingRulesEditor } from '@/governance/masking-rules-editor';

/** Regras globais de mascaramento (spec 009, FR-014/FR-016). */
export function AdminMaskingPage() {
  const allowed = useCan('project:manage');
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
      <AdminNav />
      {!allowed ? (
        <p className="text-muted-foreground">Acesso restrito à administração da plataforma.</p>
      ) : (
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle role="heading" aria-level={2}>
              Mascaramento de dados (LGPD)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 px-4">
            <p className="text-sm text-muted-foreground">
              Regras de todos os projetos. As regras padrão podem ser desativadas, mas não
              excluídas; cada projeto pode acrescentar as suas.
            </p>
            <MaskingRulesEditor projectId={null} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
