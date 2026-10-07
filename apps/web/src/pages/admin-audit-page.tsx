import type { AuditRecord } from '@olly/shared-types';
import { Download, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useAudit } from '@/api/queries';
import { useCan } from '@/api/use-can';
import { useAuth } from '@/auth/auth-provider';
import { AdminNav } from '@/components/layout/admin-nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

interface Filters {
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { action: '', entityType: '', entityId: '', userId: '', from: '', to: '' };

/** Datas do formulário (horário local) → ISO; campos vazios saem do filtro. */
function toQuery(f: Filters): Record<string, string> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(f) as [keyof Filters, string][]) {
    if (!v.trim()) continue;
    q[k] = k === 'from' || k === 'to' ? new Date(v).toISOString() : v.trim();
  }
  return q;
}

/** Auditoria (spec 009, FR-018): filtros, detalhe e exportação CSV. */
export function AdminAuditPage() {
  const allowed = useCan('audit:read');
  const { getAccessToken } = useAuth();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<AuditRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const audit = useAudit(filters);
  const rows = audit.data?.pages.flatMap((p) => p.items) ?? [];

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setFilters(toQuery(draft));
  };
  const field = (key: keyof Filters) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => {
      setDraft((d) => ({ ...d, [key]: e.target.value }));
    },
  });

  // O CSV vem em streaming do servidor; o navegador baixa o arquivo pronto.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams(filters).toString();
      const res = await fetch(`/api/v1/audit/export.csv${params ? `?${params}` : ''}`, {
        headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Não foi possível exportar', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
      <AdminNav />
      {!allowed ? (
        <p className="text-muted-foreground">Acesso restrito a quem tem a permissão audit:read.</p>
      ) : (
        <Card className="gap-4 py-4">
          <CardContent className="grid gap-4 px-4">
            <form onSubmit={apply} className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
              <div className="grid gap-1.5">
                <Label htmlFor="audit-action">Ação</Label>
                <Input id="audit-action" placeholder="ex.: workflow.*" {...field('action')} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="audit-entity">Entidade</Label>
                <Input id="audit-entity" placeholder="ex.: workflow" {...field('entityType')} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="audit-entity-id">Id da entidade</Label>
                <Input id="audit-entity-id" {...field('entityId')} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="audit-user">Id do usuário</Label>
                <Input id="audit-user" {...field('userId')} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="audit-from">De</Label>
                <Input id="audit-from" type="datetime-local" {...field('from')} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="audit-to">Até</Label>
                <Input id="audit-to" type="datetime-local" {...field('to')} />
              </div>
              <div className="flex gap-2 md:col-span-3 lg:col-span-6">
                <Button type="submit">Filtrar</Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraft(EMPTY);
                    setFilters({});
                  }}
                >
                  Limpar
                </Button>
                <div className="flex-1" />
                <Button
                  type="button"
                  variant="outline"
                  disabled={exporting}
                  onClick={() => void exportCsv()}
                >
                  {exporting ? <Loader2 className="animate-spin" /> : <Download />} Exportar CSV
                </Button>
              </div>
            </form>
            <table className="w-full text-sm" data-testid="audit-table">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Data</th>
                  <th className="py-2 font-medium">Usuário</th>
                  <th className="py-2 font-medium">Ação</th>
                  <th className="py-2 font-medium">Entidade</th>
                  <th className="py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t hover:bg-accent"
                    onClick={() => {
                      setDetail(r);
                    }}
                  >
                    <td className="py-2 whitespace-nowrap">
                      {dateFormat.format(new Date(r.createdAt))}
                    </td>
                    <td className="py-2">{r.userEmail ?? (r.userId ? r.userId : 'sistema')}</td>
                    <td className="py-2 font-mono text-xs">{r.action}</td>
                    <td className="py-2 text-xs">
                      {r.entityType} <span className="text-muted-foreground">{r.entityId}</span>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{r.ip ?? '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && !audit.isLoading && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">
                      Nenhum registro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {audit.hasNextPage && (
              <Button
                variant="outline"
                disabled={audit.isFetchingNextPage}
                onClick={() => void audit.fetchNextPage()}
              >
                Carregar mais
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.action}</DialogTitle>
          </DialogHeader>
          <pre
            className="max-h-[60vh] overflow-auto rounded bg-muted p-3 text-xs"
            data-testid="audit-detail"
          >
            {JSON.stringify(detail, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
