import type {
  AiModel,
  AiPricing,
  AiUsageRow,
  AiUsageTotals,
  ProjectAiSettings,
  ProjectAiUsage,
} from '@olly/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys, useProjects } from '@/api/queries';
import { useCan } from '@/api/use-can';
import { AdminNav } from '@/components/layout/admin-nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const errorMessage = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...e.issues.map((i) => i.message)].join(' — ')
    : e instanceof Error
      ? e.message
      : String(e);
const int = new Intl.NumberFormat('pt-BR');
const cost = (t: Pick<AiUsageTotals, 'cost' | 'currency' | 'calls'>) =>
  t.cost === null ? 'sem preço' : `${t.cost.toFixed(4)} ${t.currency ?? 'USD'}`;

/** Período: mês corrente (padrão da API) ou o anterior. */
function monthRange(offset: 0 | -1): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const to =
    offset === 0
      ? new Date(now.getTime() + 1000)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

function UsageCard() {
  const api = useApi();
  const [offset, setOffset] = useState<0 | -1>(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const range = monthRange(offset);
  const qs = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  const { data: rows = [] } = useQuery({
    queryKey: queryKeys.aiUsage(range.from.slice(0, 7), String(offset)),
    queryFn: () => api.get<AiUsageRow[]>(`/api/v1/ai-usage?${qs}`),
  });
  const detail = useQuery({
    queryKey: [...queryKeys.projectAiUsage(projectId ?? ''), String(offset)],
    queryFn: () => api.get<ProjectAiUsage>(`/api/v1/projects/${projectId ?? ''}/ai-usage?${qs}`),
    enabled: projectId !== null,
  });
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle role="heading" aria-level={2}>
          Uso e custo estimado
        </CardTitle>
        <Select
          aria-label="Período"
          className="w-48"
          value={String(offset)}
          onChange={(e) => {
            setOffset(e.target.value === '-1' ? -1 : 0);
          }}
        >
          <option value="0">Mês corrente</option>
          <option value="-1">Mês anterior</option>
        </Select>
      </CardHeader>
      <CardContent className="grid gap-4 px-4">
        <table className="w-full text-sm" data-testid="ai-usage-projects">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Projeto</th>
              <th className="py-1 font-medium">Chamadas</th>
              <th className="py-1 font-medium">Tokens (entrada / saída)</th>
              <th className="py-1 font-medium">Custo estimado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted-foreground">
                  Nenhuma chamada a modelos no período.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={`border-t ${projectId === r.id ? 'bg-accent/40' : ''}`}>
                <td className="py-1.5">
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => {
                      setProjectId(r.id);
                    }}
                  >
                    {r.name}
                  </button>
                </td>
                <td>{int.format(r.calls)}</td>
                <td>
                  {int.format(r.inputTokens)} / {int.format(r.outputTokens)}
                </td>
                <td>{cost(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {detail.data && (
          <div className="grid gap-2 rounded-md border p-3 text-sm" data-testid="ai-usage-detail">
            <p>
              Consumo do mês: <strong>{int.format(detail.data.monthTokens)}</strong> tokens
              {detail.data.monthlyTokenLimit !== null
                ? ` de ${int.format(detail.data.monthlyTokenLimit)} (limite mensal)`
                : ' (sem limite mensal)'}
            </p>
            <table className="w-full">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Workflow</th>
                  <th className="py-1 font-medium">Chamadas</th>
                  <th className="py-1 font-medium">Tokens</th>
                  <th className="py-1 font-medium">Custo estimado</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.byWorkflow.map((w) => (
                  <tr key={w.id} className="border-t">
                    <td className="py-1">{w.name}</td>
                    <td>{int.format(w.calls)}</td>
                    <td>{int.format(w.inputTokens + w.outputTokens)}</td>
                    <td>{cost(w)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          O custo é estimado pela tabela de preços abaixo; o valor real é o da fatura do provedor.
        </p>
      </CardContent>
    </Card>
  );
}

/** FR-002: modelos permitidos na instalação; incluir ou remover vale na hora (sem reinício). */
function ModelsCard() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { data: models = [] } = useQuery({
    queryKey: queryKeys.aiModels,
    queryFn: () => api.get<AiModel[]>('/api/v1/ai-models'),
  });
  const [model, setModel] = useState('');
  const [note, setNote] = useState('');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.aiModels });
    // A configuração dos projetos mostra os modelos da instalação.
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };
  const add = useMutation({
    mutationFn: () =>
      api.put(`/api/v1/ai-models/${encodeURIComponent(model.trim())}`, {
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Modelo liberado', { description: 'Já vale para as próximas execuções.' });
      setModel('');
      setNote('');
      refresh();
    },
    onError: (e) => toast.error('Não foi possível liberar', { description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (name: string) => api.delete(`/api/v1/ai-models/${encodeURIComponent(name)}`),
    onSuccess: () => {
      toast.success('Modelo removido');
      refresh();
    },
    onError: (e) => toast.error('Não foi possível remover', { description: errorMessage(e) }),
  });
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle role="heading" aria-level={2}>
          Modelos permitidos
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 text-sm">
        <p className="text-muted-foreground">
          Só estes modelos podem ser usados pelos agentes (o nome exato do provedor, ex.:{' '}
          <code>gpt-5-mini</code>, <code>claude-sonnet-5-5</code>). A mudança vale na hora; cada
          projeto pode restringir a lista abaixo.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          data-testid="ai-model-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (model.trim()) add.mutate();
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="ai-model-name">Modelo</Label>
            <Input
              id="ai-model-name"
              className="w-64"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ai-model-note">Observação (opcional)</Label>
            <Input
              id="ai-model-note"
              className="w-80"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </div>
          <Button type="submit" size="sm" disabled={add.isPending || !model.trim()}>
            <Plus /> Liberar modelo
          </Button>
        </form>
        <table className="w-full" data-testid="ai-models">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Modelo</th>
              <th className="py-1 font-medium">Observação</th>
              <th className="py-1 font-medium">Liberado por</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-amber-700 dark:text-amber-300">
                  Nenhum modelo liberado: o Agent fica indisponível.
                </td>
              </tr>
            )}
            {models.map((m) => (
              <tr key={m.model} className="border-t" data-testid={`ai-model-${m.model}`}>
                <td className="py-1.5 font-mono text-xs">{m.model}</td>
                <td className="text-xs text-muted-foreground">{m.note}</td>
                <td className="text-xs text-muted-foreground">
                  {m.createdByName ?? '—'} · {new Date(m.createdAt).toLocaleDateString('pt-BR')}
                </td>
                <td className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remover ${m.model}`}
                    onClick={() => {
                      if (
                        window.confirm(`Remover ${m.model}? Os agentes que o usam passam a falhar.`)
                      )
                        remove.mutate(m.model);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ProjectSettingsCard() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useProjects();
  const [projectId, setProjectId] = useState('');
  const settings = useQuery({
    queryKey: queryKeys.projectAiSettings(projectId),
    queryFn: () => api.get<ProjectAiSettings>(`/api/v1/projects/${projectId}/ai-settings`),
    enabled: projectId !== '',
  });
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle role="heading" aria-level={2}>
          Modelos e limite por projeto
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        <Select
          aria-label="Projeto"
          className="max-w-sm"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
          }}
        >
          <option value="">Selecione o projeto…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {settings.data && (
          <SettingsForm
            key={projectId}
            settings={settings.data}
            onSave={async (body) => {
              try {
                await api.put(`/api/v1/projects/${projectId}/ai-settings`, body);
                toast.success('Configuração de IA salva');
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.projectAiSettings(projectId),
                });
              } catch (e) {
                toast.error('Não foi possível salvar', { description: errorMessage(e) });
              }
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function SettingsForm({
  settings,
  onSave,
}: {
  settings: ProjectAiSettings;
  onSave: (body: Omit<ProjectAiSettings, 'installationModels'>) => Promise<void>;
}) {
  const [restrict, setRestrict] = useState(settings.allowedModels !== null);
  const [models, setModels] = useState<string[]>(settings.allowedModels ?? []);
  const [limit, setLimit] = useState(
    settings.monthlyTokenLimit === null ? '' : String(settings.monthlyTokenLimit),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSave({
      allowedModels: restrict ? models : null,
      monthlyTokenLimit: limit.trim() === '' ? null : Number(limit),
    });
  };
  return (
    <form className="grid gap-3 text-sm" onSubmit={submit} data-testid="ai-settings-form">
      {settings.installationModels.length === 0 && (
        <p className="text-amber-700 dark:text-amber-300">
          A instalação não libera nenhum modelo (cadastre em "Modelos permitidos" acima): o Agent
          fica indisponível.
        </p>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={restrict}
          onChange={(e) => {
            setRestrict(e.target.checked);
          }}
        />
        Restringir os modelos deste projeto (sem marcar: todos os da instalação)
      </label>
      {restrict && (
        <div className="flex flex-wrap gap-3 pl-6">
          {settings.installationModels.map((m) => (
            <label key={m} className="flex items-center gap-1.5 font-mono text-xs">
              <input
                type="checkbox"
                checked={models.includes(m)}
                onChange={(e) => {
                  setModels((prev) =>
                    e.target.checked ? [...prev, m] : prev.filter((x) => x !== m),
                  );
                }}
              />
              {m}
            </label>
          ))}
        </div>
      )}
      <div className="grid max-w-sm gap-1">
        <Label htmlFor="ai-limit">Limite mensal de tokens (vazio: sem limite)</Label>
        <Input
          id="ai-limit"
          inputMode="numeric"
          value={limit}
          onChange={(e) => {
            setLimit(e.target.value.replace(/\D/g, ''));
          }}
        />
      </div>
      <div>
        <Button type="submit" size="sm">
          Salvar
        </Button>
      </div>
    </form>
  );
}

const EMPTY_PRICE = {
  model: '',
  provider: 'openai',
  input: '',
  output: '',
  currency: 'USD',
  note: '',
};

function PricingCard() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { data: prices = [] } = useQuery({
    queryKey: queryKeys.aiPricing,
    queryFn: () => api.get<AiPricing[]>('/api/v1/ai-pricing'),
  });
  const [form, setForm] = useState<typeof EMPTY_PRICE | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.aiPricing });
  const save = useMutation({
    mutationFn: (f: typeof EMPTY_PRICE) =>
      api.put(`/api/v1/ai-pricing/${encodeURIComponent(f.model.trim())}`, {
        provider: f.provider.trim(),
        inputPer1m: Number(f.input.replace(',', '.')),
        outputPer1m: Number(f.output.replace(',', '.')),
        currency: f.currency.trim() || 'USD',
        note: f.note.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Preço salvo');
      setForm(null);
      refresh();
    },
    onError: (e) => toast.error('Não foi possível salvar', { description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (model: string) => api.delete(`/api/v1/ai-pricing/${encodeURIComponent(model)}`),
    onSuccess: refresh,
    onError: (e) => toast.error('Não foi possível excluir', { description: errorMessage(e) }),
  });
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle role="heading" aria-level={2}>
          Tabela de preços (por 1 milhão de tokens)
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setForm(EMPTY_PRICE);
          }}
        >
          <Plus /> Novo preço
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        {form && (
          <form
            className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-6"
            data-testid="ai-pricing-form"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
            {(
              [
                ['model', 'Modelo'],
                ['provider', 'Provedor'],
                ['input', 'Entrada'],
                ['output', 'Saída'],
                ['currency', 'Moeda'],
                ['note', 'Observação'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="grid gap-1">
                <Label htmlFor={`price-${key}`}>{label}</Label>
                <Input
                  id={`price-${key}`}
                  value={form[key]}
                  required={key !== 'note'}
                  onChange={(e) => {
                    setForm({ ...form, [key]: e.target.value });
                  }}
                />
              </div>
            ))}
            <div className="flex gap-2 sm:col-span-6">
              <Button type="submit" size="sm" disabled={save.isPending}>
                Salvar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setForm(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
        <table className="w-full text-sm" data-testid="ai-pricing">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Modelo</th>
              <th className="py-1 font-medium">Provedor</th>
              <th className="py-1 font-medium">Entrada</th>
              <th className="py-1 font-medium">Saída</th>
              <th className="py-1 font-medium">Observação</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.model} className="border-t">
                <td className="py-1.5 font-mono text-xs">{p.model}</td>
                <td>{p.provider}</td>
                <td>
                  {p.inputPer1m} {p.currency}
                </td>
                <td>
                  {p.outputPer1m} {p.currency}
                </td>
                <td className="text-xs text-muted-foreground">{p.note}</td>
                <td className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Editar o preço de ${p.model}`}
                    onClick={() => {
                      setForm({
                        model: p.model,
                        provider: p.provider,
                        input: String(p.inputPer1m),
                        output: String(p.outputPer1m),
                        currency: p.currency,
                        note: p.note ?? '',
                      });
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Excluir o preço de ${p.model}`}
                    onClick={() => {
                      if (window.confirm(`Excluir o preço de ${p.model}?`)) remove.mutate(p.model);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          Valores iniciais: preços públicos dos provedores na data da instalação. Confira e ajuste
          ao contrato da instituição.
        </p>
      </CardContent>
    </Card>
  );
}

/** Administração de IA (spec 011, FR-002, FR-014, FR-015): uso, preços, modelos e limites. */
export function AdminAiPage() {
  const allowed = useCan('project:manage');
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
      <AdminNav />
      {!allowed ? (
        <p className="text-sm text-muted-foreground">
          Somente a administração da plataforma gerencia a IA.
        </p>
      ) : (
        <>
          <ModelsCard />
          <ProjectSettingsCard />
          <UsageCard />
          <PricingCard />
        </>
      )}
    </div>
  );
}
