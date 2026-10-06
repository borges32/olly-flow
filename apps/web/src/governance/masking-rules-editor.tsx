import {
  MASKING_ACTIONS,
  MASKING_DETECTORS,
  type MaskingAction,
  type MaskingKind,
  type MaskingRule,
  type MaskingRuleInput,
} from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { useMaskingRules } from '@/api/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const ACTION_LABELS: Record<MaskingAction, string> = {
  redact: 'Ocultar',
  partial: 'Parcial',
  hash: 'Hash',
};

const DETECTOR_LABELS: Record<string, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  card: 'Cartão',
  email: 'E-mail',
  phone: 'Telefone',
  jwt: 'JWT',
  apiKey: 'Chave de API',
};

const errorText = (e: unknown) =>
  e instanceof ApiError ? [e.message, ...e.issues.map((i) => i.message)].join(' — ') : undefined;

/**
 * Regras de mascaramento (spec 009, FR-014, FR-016): globais (`projectId` nulo) ou do projeto.
 * No projeto, as globais aparecem só para consulta.
 */
export function MaskingRulesEditor({ projectId }: { projectId: string | null }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const rules = useMaskingRules(projectId);
  const base = projectId ? `/api/v1/projects/${projectId}/masking-rules` : '/api/v1/masking-rules';
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['masking-rules'] });
  };
  const onError = (e: unknown) => toast.error('Regra não salva', { description: errorText(e) });
  const update = useMutation({
    mutationFn: ({ rule, patch }: { rule: MaskingRule; patch: Partial<MaskingRuleInput> }) =>
      api.put(`${base}/${rule.id}`, {
        kind: rule.kind,
        matcher: rule.matcher,
        action: rule.action,
        enabled: rule.enabled,
        description: rule.description,
        ...patch,
      }),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (rule: MaskingRule) => api.delete(`${base}/${rule.id}`),
    onSuccess: invalidate,
    onError,
  });
  const [kind, setKind] = useState<MaskingKind>('field');
  const [matcher, setMatcher] = useState('');
  const [action, setAction] = useState<MaskingAction>('redact');
  const create = useMutation({
    mutationFn: (input: MaskingRuleInput) => api.post<MaskingRule>(base, input),
    onSuccess: () => {
      setMatcher('');
      toast.success('Regra criada');
      invalidate();
    },
    onError,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (matcher.trim()) create.mutate({ kind, matcher: matcher.trim(), action });
  };

  return (
    <div className="grid gap-3">
      <table
        className="w-full text-sm"
        data-testid={projectId ? 'project-masking-rules' : 'masking-rules'}
      >
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2 font-medium">Regra</th>
            <th className="py-2 font-medium">Ação</th>
            <th className="py-2 font-medium">Ativa</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {(rules.data ?? []).map((r) => {
            const editable = projectId ? r.scope === 'project' : true;
            return (
              <tr key={r.id} className="border-t">
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">
                      {r.kind === 'pattern' ? (DETECTOR_LABELS[r.matcher] ?? r.matcher) : r.matcher}
                    </span>
                    <Badge variant="outline">{r.kind === 'pattern' ? 'valor' : 'campo'}</Badge>
                    {r.builtin && <Badge variant="secondary">padrão</Badge>}
                    {projectId && r.scope === 'global' && <Badge variant="secondary">global</Badge>}
                  </div>
                  {r.description && (
                    <div className="text-xs text-muted-foreground">{r.description}</div>
                  )}
                </td>
                <td className="py-2">
                  <Select
                    aria-label={`Ação de ${r.matcher}`}
                    className="w-32"
                    value={r.action}
                    disabled={!editable}
                    onChange={(e) => {
                      update.mutate({
                        rule: r,
                        patch: { action: e.target.value as MaskingAction },
                      });
                    }}
                  >
                    {MASKING_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {ACTION_LABELS[a]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-2">
                  <input
                    type="checkbox"
                    aria-label={`Ativar ${r.matcher}`}
                    checked={r.enabled}
                    disabled={!editable}
                    onChange={(e) => {
                      update.mutate({ rule: r, patch: { enabled: e.target.checked } });
                    }}
                  />
                </td>
                <td>
                  {editable && !r.builtin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Excluir regra ${r.matcher}`}
                      onClick={() => {
                        remove.mutate(r);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <Select
          aria-label="Tipo da regra"
          className="w-36"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as MaskingKind);
            setMatcher('');
          }}
        >
          <option value="field">Nome do campo</option>
          <option value="pattern">Padrão de valor</option>
        </Select>
        {kind === 'field' ? (
          <Input
            aria-label="Campo"
            className="w-56"
            placeholder="ex.: *rg* ou cliente.nome"
            value={matcher}
            onChange={(e) => {
              setMatcher(e.target.value);
            }}
          />
        ) : (
          <Select
            aria-label="Detector"
            className="w-44"
            value={matcher}
            onChange={(e) => {
              setMatcher(e.target.value);
            }}
          >
            <option value="">Selecione</option>
            {MASKING_DETECTORS.map((d) => (
              <option key={d} value={d}>
                {DETECTOR_LABELS[d]}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label="Ação da nova regra"
          className="w-32"
          value={action}
          onChange={(e) => {
            setAction(e.target.value as MaskingAction);
          }}
        >
          {MASKING_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline" disabled={!matcher.trim()}>
          <Plus /> Criar regra
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        O mascaramento vale para o que é gravado, transmitido e registrado em log; os dados que
        passam entre os nós não mudam.
      </p>
    </div>
  );
}
