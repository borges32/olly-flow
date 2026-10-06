import type {
  ProjectSettings,
  ProjectSettingsUpdate,
  SaveExecutionDataPolicy,
} from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys, useProjectSettings } from '@/api/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SAVE_POLICY_LABELS } from './labels';
import { MaskingRulesEditor } from './masking-rules-editor';

const days = (raw: string) => (raw.trim() === '' ? null : Math.max(1, Math.floor(Number(raw))));

/**
 * Governança do projeto (spec 009): aprovação de publicação (FR-011), Executor vê os dados
 * (FR-019), política de dados padrão (FR-012), retenção (FR-017) e regras de mascaramento do
 * projeto (FR-016).
 */
export function ProjectGovernance({ projectId }: { projectId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const settings = useProjectSettings(projectId);
  const save = useMutation({
    mutationFn: (update: ProjectSettingsUpdate) =>
      api.put<ProjectSettings>(`/api/v1/projects/${projectId}/settings`, update),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.projectSettings(projectId), data);
      toast.success('Configuração salva');
    },
    onError: (e) =>
      toast.error('Configuração não salva', {
        description: e instanceof ApiError ? e.message : undefined,
      }),
  });
  const s = settings.data;
  if (!s) return null;

  return (
    <section className="grid gap-4" data-testid="project-governance">
      <h2 className="font-semibold">Governança</h2>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={s.requirePublishApproval}
          onChange={(e) => {
            save.mutate({ requirePublishApproval: e.target.checked });
          }}
        />
        <span>
          Exigir aprovação para publicar
          <span className="block text-xs text-muted-foreground">
            A publicação vira um pedido que outra pessoa com permissão de publicar aprova.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={s.executorCanReadData}
          onChange={(e) => {
            save.mutate({ executorCanReadData: e.target.checked });
          }}
        />
        <span>
          Executor vê os dados das execuções
          <span className="block text-xs text-muted-foreground">
            Sem esta opção, o papel Executor vê só status, contagens e duração.
          </span>
        </span>
      </label>
      <div className="grid max-w-sm gap-1.5">
        <Label htmlFor="save-policy">Dados das execuções de produção (padrão do projeto)</Label>
        <Select
          id="save-policy"
          value={s.saveExecutionData}
          onChange={(e) => {
            save.mutate({ saveExecutionData: e.target.value as SaveExecutionDataPolicy });
          }}
        >
          {Object.entries(SAVE_POLICY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <RetentionForm
        key={`${String(s.retention.dataDays)}-${String(s.retention.metadataDays)}`}
        settings={s}
        onSave={(retention) => {
          save.mutate({ retention });
        }}
      />
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">Mascaramento de dados do projeto</h3>
        <MaskingRulesEditor projectId={projectId} />
      </div>
    </section>
  );
}

/** Retenção (FR-017); vazio = padrão da plataforma. Reinicia quando o valor salvo muda. */
function RetentionForm({
  settings: s,
  onSave,
}: {
  settings: ProjectSettings;
  onSave: (retention: { dataDays: number | null; metadataDays: number | null }) => void;
}) {
  const [dataDays, setDataDays] = useState(s.retention.dataDays?.toString() ?? '');
  const [metadataDays, setMetadataDays] = useState(s.retention.metadataDays?.toString() ?? '');
  const saveRetention = (e: FormEvent) => {
    e.preventDefault();
    onSave({ dataDays: days(dataDays), metadataDays: days(metadataDays) });
  };
  return (
    <form onSubmit={saveRetention} className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor="retention-data">Retenção dos dados (dias)</Label>
        <Input
          id="retention-data"
          type="number"
          min={1}
          className="w-40"
          placeholder={`Padrão: ${s.effectiveRetention.dataDays}`}
          value={dataDays}
          onChange={(e) => {
            setDataDays(e.target.value);
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="retention-metadata">Retenção das execuções (dias)</Label>
        <Input
          id="retention-metadata"
          type="number"
          min={1}
          className="w-40"
          placeholder={`Padrão: ${s.effectiveRetention.metadataDays}`}
          value={metadataDays}
          onChange={(e) => {
            setMetadataDays(e.target.value);
          }}
        />
      </div>
      <Button type="submit" variant="outline">
        Salvar retenção
      </Button>
    </form>
  );
}
