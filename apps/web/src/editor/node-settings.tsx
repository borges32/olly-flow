import type { WorkflowNode, WorkflowNodeSettings } from '@olly/shared-types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useEditorStore } from './store';

/** `undefined` remove a configuração. */
type SettingsPatch = { [K in keyof WorkflowNodeSettings]?: WorkflowNodeSettings[K] | undefined };

const DEFAULT_RETRY = { maxTries: 3, waitMs: 1000, backoff: 'fixed' as const };
const DEFAULT_PARALLEL = { enabled: true, concurrency: 5 };

const intOrUndefined = (raw: string, min: number, max: number) => {
  if (raw.trim() === '') return undefined;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

/**
 * Aba "Configurações" do nó: novas tentativas, timeout e comportamento em erro (spec 004,
 * FR-017) e, nos tipos que suportam, itens em paralelo (spec 006, FR-009).
 */
export function NodeSettings({
  node,
  readOnly,
  supportsParallelItems = false,
}: {
  node: WorkflowNode;
  readOnly: boolean;
  supportsParallelItems?: boolean;
}) {
  const settings = node.settings ?? {};
  const retry = settings.retry;
  const parallel = settings.parallelItems?.enabled ? settings.parallelItems : undefined;
  const update = (patch: SettingsPatch) => {
    const merged: Record<string, unknown> = { ...settings, ...patch };
    const next = Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== undefined),
    ) as WorkflowNodeSettings;
    useEditorStore
      .getState()
      .updateNode(
        node.id,
        { settings: Object.keys(next).length > 0 ? next : undefined },
        `${node.id}:settings`,
      );
  };

  return (
    <div className="grid gap-5" data-testid="node-settings">
      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Novas tentativas</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            data-testid="settings-retry"
            checked={retry !== undefined}
            disabled={readOnly}
            onChange={(e) => {
              update({ retry: e.target.checked ? DEFAULT_RETRY : undefined });
            }}
          />
          Tentar de novo quando falhar
        </label>
        {retry && (
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="retry-tries">Tentativas (1–10)</Label>
              <Input
                id="retry-tries"
                type="number"
                min={1}
                max={10}
                value={retry.maxTries}
                disabled={readOnly}
                onChange={(e) => {
                  update({
                    retry: { ...retry, maxTries: intOrUndefined(e.target.value, 1, 10) ?? 1 },
                  });
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="retry-wait">Espera (ms)</Label>
              <Input
                id="retry-wait"
                type="number"
                min={0}
                max={60000}
                value={retry.waitMs}
                disabled={readOnly}
                onChange={(e) => {
                  update({
                    retry: { ...retry, waitMs: intOrUndefined(e.target.value, 0, 60_000) ?? 0 },
                  });
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="retry-backoff">Espera entre tentativas</Label>
              <Select
                id="retry-backoff"
                value={retry.backoff ?? 'fixed'}
                disabled={readOnly}
                onChange={(e) => {
                  update({
                    retry: { ...retry, backoff: e.target.value as 'fixed' | 'exponential' },
                  });
                }}
              >
                <option value="fixed">Fixa</option>
                <option value="exponential">Exponencial (dobra)</option>
              </Select>
            </div>
          </div>
        )}
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor="settings-timeout">Timeout do nó (ms)</Label>
        <Input
          id="settings-timeout"
          data-testid="settings-timeout"
          type="number"
          min={1}
          placeholder="Sem limite"
          value={settings.timeoutMs ?? ''}
          disabled={readOnly}
          onChange={(e) => {
            update({ timeoutMs: intOrUndefined(e.target.value, 1, Number.MAX_SAFE_INTEGER) });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Interrompe a operação HTTP ou SQL em andamento.
        </p>
      </div>
      {supportsParallelItems && (
        <fieldset className="grid gap-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Itens em paralelo</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              data-testid="settings-parallel"
              checked={parallel !== undefined}
              disabled={readOnly}
              onChange={(e) => {
                update({ parallelItems: e.target.checked ? DEFAULT_PARALLEL : undefined });
              }}
            />
            Processar vários itens ao mesmo tempo
          </label>
          {parallel && (
            <div className="grid max-w-48 gap-1">
              <Label htmlFor="parallel-concurrency">Itens simultâneos (1–100)</Label>
              <Input
                id="parallel-concurrency"
                data-testid="settings-parallel-concurrency"
                type="number"
                min={1}
                max={100}
                value={parallel.concurrency}
                disabled={readOnly}
                onChange={(e) => {
                  update({
                    parallelItems: {
                      enabled: true,
                      concurrency: intOrUndefined(e.target.value, 1, 100) ?? 1,
                    },
                  });
                }}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            A ordem dos resultados é sempre a dos itens de entrada.
          </p>
        </fieldset>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="settings-on-error">Em caso de erro</Label>
        <Select
          id="settings-on-error"
          data-testid="settings-on-error"
          value={settings.onError === 'continue' ? 'continue' : 'stop'}
          disabled={readOnly}
          onChange={(e) => {
            update({ onError: e.target.value === 'continue' ? 'continue' : undefined });
          }}
        >
          <option value="stop">Parar a execução</option>
          <option value="continue">Continuar (emite um item com o erro)</option>
        </Select>
      </div>
    </div>
  );
}
