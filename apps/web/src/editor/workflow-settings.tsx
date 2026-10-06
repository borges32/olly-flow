import { Settings } from 'lucide-react';
import { useState } from 'react';
import type { SaveExecutionDataPolicy } from '@olly/shared-types';
import { useProjectSettings, useWorkflows } from '@/api/queries';
import { SAVE_POLICY_LABELS } from '@/governance/labels';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useEditorStore } from './store';

const positiveOrUndefined = (raw: string) => {
  const n = Math.floor(Number(raw));
  return raw.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Configurações do workflow: workflow de erro (spec 007, FR-014), timeout global (spec 006,
 * FR-011), paralelismo máximo entre nós (spec 006, FR-006) e política de dados das execuções
 * (spec 009, FR-012). Salvas com o workflow.
 */
export function WorkflowSettingsButton({
  workflowId,
  projectId,
  readOnly,
}: {
  workflowId: string;
  projectId: string;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const settings = useEditorStore((s) => s.settings);
  const workflows = useWorkflows(open ? projectId : undefined, 1, 100);
  const projectSettings = useProjectSettings(open ? projectId : undefined);
  const candidates = (workflows.data?.items ?? []).filter((w) => w.id !== workflowId);
  const set = (patch: Parameters<ReturnType<typeof useEditorStore.getState>['setSettings']>[0]) => {
    useEditorStore.getState().setSettings(patch);
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
        title="Workflow de erro, timeout e paralelismo"
      >
        <Settings /> Configurações
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="workflow-settings">
          <DialogHeader>
            <DialogTitle>Configurações do workflow</DialogTitle>
            <DialogDescription>Valem a partir do próximo salvamento.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ws-error-workflow">Workflow de erro</Label>
              <Select
                id="ws-error-workflow"
                value={settings.errorWorkflowId ?? ''}
                disabled={readOnly}
                onChange={(e) => {
                  set({ errorWorkflowId: e.target.value || undefined });
                }}
              >
                <option value="">Nenhum</option>
                {settings.errorWorkflowId &&
                  !candidates.some((w) => w.id === settings.errorWorkflowId) && (
                    <option value={settings.errorWorkflowId}>(workflow atual)</option>
                  )}
                {candidates.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Acionado quando uma execução de produção falha. Ele precisa começar por um nó
                “Gatilho de erro”.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ws-save-data">Dados das execuções de produção</Label>
              <Select
                id="ws-save-data"
                value={settings.saveExecutionData ?? ''}
                disabled={readOnly}
                onChange={(e) => {
                  set({
                    saveExecutionData: (e.target.value || undefined) as
                      SaveExecutionDataPolicy | undefined,
                  });
                }}
              >
                <option value="">
                  Padrão do projeto
                  {projectSettings.data
                    ? ` (${SAVE_POLICY_LABELS[projectSettings.data.saveExecutionData]})`
                    : ''}
                </option>
                {Object.entries(SAVE_POLICY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Spec 009: com “só erros”, execuções com sucesso guardam só status e contagens.
                Execuções de teste sempre guardam os dados (mascarados).
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ws-timeout">Timeout da execução (s)</Label>
                <Input
                  id="ws-timeout"
                  type="number"
                  min={1}
                  placeholder="Padrão da plataforma"
                  value={settings.timeoutSec ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    set({ timeoutSec: positiveOrUndefined(e.target.value) });
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ws-parallel">Nós em paralelo</Label>
                <Input
                  id="ws-parallel"
                  type="number"
                  min={1}
                  placeholder="8"
                  value={settings.maxParallel ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    set({ maxParallel: positiveOrUndefined(e.target.value) });
                  }}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
