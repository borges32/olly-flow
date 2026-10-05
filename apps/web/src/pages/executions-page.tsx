import type { ExecutionStatus } from '@olly/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { Gauge, Loader2, Square } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useExecutions, useProjects, useQueueStats, useWorkflows } from '@/api/queries';
import { useCan } from '@/api/use-can';
import { useCancelExecution } from '@/editor/use-test-run';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const STATUS_LABEL: Record<ExecutionStatus, string> = {
  queued: 'Na fila',
  running: 'Executando',
  waiting: 'Aguardando',
  success: 'Sucesso',
  error: 'Erro',
  cancelled: 'Cancelada',
};
type Filter = 'project' | 'workflow' | 'status' | 'mode' | 'trigger' | 'from' | 'to';

const duration = (ms: number | null) =>
  ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

/** Spec 006, FR-012: ocupação da cota do projeto. */
function QueueIndicator({ projectId }: { projectId: string }) {
  const { data } = useQueueStats(projectId);
  if (!data) return null;
  const full = data.running >= data.limit;
  return (
    <div
      data-testid="queue-stats"
      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
      title={
        data.customLimit
          ? 'Cota de execuções simultâneas definida para o projeto'
          : 'Cota padrão da plataforma'
      }
    >
      <Gauge className={full ? 'size-4 text-amber-600' : 'size-4 text-muted-foreground'} />
      <span>
        <strong>{data.running}</strong> de {data.limit} em execução
      </span>
      <span className="text-muted-foreground">·</span>
      <span>
        <strong>{data.queued}</strong> na fila
      </span>
    </div>
  );
}

/** Para uma execução da lista (spec 006, FR-010); só para quem pode executar no projeto. */
function StopButton({ executionId, projectId }: { executionId: string; projectId: string }) {
  const canExecute = useCan('workflow:execute', projectId);
  const cancel = useCancelExecution();
  const queryClient = useQueryClient();
  if (!canExecute) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 text-destructive hover:text-destructive"
      aria-label="Parar execução"
      title="Parar execução"
      onClick={() => {
        void cancel(executionId).then(() =>
          queryClient.invalidateQueries({ queryKey: ['executions'] }),
        );
      }}
    >
      <Square className="size-3.5" /> Parar
    </Button>
  );
}

/** Execuções com filtros (spec 005, FR-013); abrir uma leva ao canvas somente leitura. */
export function ExecutionsPage() {
  const [params, setParams] = useSearchParams();
  const { data: projects } = useProjects();
  const projectId = params.get('project') ?? '';
  const workflows = useWorkflows(projectId || undefined, 1, 100);
  const value = (k: Filter) => params.get(k) ?? '';
  const set = (k: Filter, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'project') next.delete('workflow');
    setParams(next);
  };
  const toIso = (date: string, end: boolean) =>
    date ? new Date(`${date}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : '';
  const filters = Object.fromEntries(
    Object.entries({
      projectId,
      workflowId: value('workflow'),
      status: value('status'),
      mode: value('mode'),
      trigger: value('trigger'),
      from: toIso(value('from'), false),
      to: toIso(value('to'), true),
      limit: '50',
    }).filter(([, v]) => v !== ''),
  );
  const executions = useExecutions(filters);
  const items = executions.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Execuções</h1>
        {projectId && <QueueIndicator projectId={projectId} />}
      </div>
      <div className="flex flex-wrap items-end gap-3" data-testid="execution-filters">
        <div className="grid gap-1.5">
          <Label htmlFor="f-project">Projeto</Label>
          <Select
            id="f-project"
            className="w-48"
            value={projectId}
            onChange={(e) => {
              set('project', e.target.value);
            }}
          >
            <option value="">Todos</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-workflow">Workflow</Label>
          <Select
            id="f-workflow"
            className="w-48"
            value={value('workflow')}
            disabled={!projectId}
            onChange={(e) => {
              set('workflow', e.target.value);
            }}
          >
            <option value="">Todos</option>
            {workflows.data?.items.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-status">Status</Label>
          <Select
            id="f-status"
            className="w-36"
            value={value('status')}
            onChange={(e) => {
              set('status', e.target.value);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-mode">Modo</Label>
          <Select
            id="f-mode"
            className="w-32"
            value={value('mode')}
            onChange={(e) => {
              set('mode', e.target.value);
            }}
          >
            <option value="">Todos</option>
            <option value="test">Teste</option>
            <option value="production">Produção</option>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-trigger">Gatilho</Label>
          <Select
            id="f-trigger"
            className="w-32"
            value={value('trigger')}
            onChange={(e) => {
              set('trigger', e.target.value);
            }}
          >
            <option value="">Todos</option>
            <option value="manual">Manual</option>
            <option value="webhook">Webhook</option>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-from">De</Label>
          <Input
            id="f-from"
            type="date"
            className="w-40"
            value={value('from')}
            onChange={(e) => {
              set('from', e.target.value);
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-to">Até</Label>
          <Input
            id="f-to"
            type="date"
            className="w-40"
            value={value('to')}
            onChange={(e) => {
              set('to', e.target.value);
            }}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm" data-testid="executions-table">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Workflow</th>
              <th className="px-4 py-2 font-medium">Modo</th>
              <th className="px-4 py-2 font-medium">Gatilho</th>
              <th className="px-4 py-2 font-medium">Início</th>
              <th className="px-4 py-2 font-medium">Duração</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {executions.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-4 animate-spin" />
                </td>
              </tr>
            )}
            {!executions.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhuma execução encontrada.
                </td>
              </tr>
            )}
            {items.map((e) => (
              <tr
                key={e.id}
                className="border-t hover:bg-muted/30"
                data-testid={`execution-${e.id}`}
              >
                <td className="px-4 py-2">
                  <Badge
                    variant={e.status === 'success' ? 'default' : 'secondary'}
                    data-status={e.status}
                  >
                    {e.status === 'running' && <Loader2 className="size-3 animate-spin" />}
                    {STATUS_LABEL[e.status]}
                  </Badge>
                </td>
                <td className="px-4 py-2 font-medium">
                  <Link className="hover:underline" to={`/executions/${e.id}`}>
                    {e.workflowName}
                  </Link>
                </td>
                <td className="px-4 py-2">{e.mode === 'test' ? 'Teste' : 'Produção'}</td>
                <td className="px-4 py-2">{e.triggerType === 'webhook' ? 'Webhook' : 'Manual'}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {dateFormat.format(new Date(e.startedAt))}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{duration(e.durationMs)}</td>
                <td className="px-2 py-1 text-right">
                  {(e.status === 'queued' || e.status === 'running') && (
                    <StopButton executionId={e.id} projectId={e.projectId} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {executions.hasNextPage && (
        <Button
          variant="outline"
          className="justify-self-center"
          disabled={executions.isFetchingNextPage}
          onClick={() => void executions.fetchNextPage()}
        >
          Carregar mais
        </Button>
      )}
    </div>
  );
}
