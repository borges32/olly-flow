import type { ListenTestWebhookResponse, WorkflowNode } from '@olly/shared-types';
import { Copy, Loader2, Radio, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { nodeSignatures } from './partial-run';
import { useEditorStore } from './store';

const pathOf = (node: WorkflowNode) =>
  (typeof node.params.path === 'string' ? node.params.path : '').trim().replace(/^\/+|\/+$/g, '');

function UrlRow({ label, url, testId }: { label: string; url: string; testId: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <code
          data-testid={testId}
          className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs"
        >
          {url}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Copiar ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => toast.success('URL copiada'));
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

/**
 * URLs do webhook e escuta da chamada de teste (spec 005, FR-007): o editor escuta por 2 min a
 * definição atual, mesmo sem salvar; a chamada recebida executa o workflow a partir deste nó.
 */
export function WebhookPanel({
  node,
  workflowId,
  canExecute,
  published,
}: {
  node: WorkflowNode;
  workflowId: string;
  canExecute: boolean;
  published: boolean;
}) {
  const api = useApi();
  const listening = useEditorStore((s) => s.webhookListening);
  // Segundos restantes da escuta (2 min), atualizados a cada segundo.
  const [remaining, setRemaining] = useState(120);
  const path = pathOf(node);
  const method = typeof node.params.httpMethod === 'string' ? node.params.httpMethod : 'POST';
  const origin = window.location.origin;

  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.round((Date.parse(listening) - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) useEditorStore.getState().setWebhookListening(null);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [listening]);

  const listen = async () => {
    try {
      const definition = useEditorStore.getState().definition();
      // Escuta pelo nó (HU-2.1): a chamada executa só este Webhook; os próximos nós, pelo ▶.
      const res = await api.post<ListenTestWebhookResponse>(
        `/api/v1/workflows/${workflowId}/listen-test-webhook`,
        { definition, destinationNodeId: node.id },
      );
      setRemaining(120);
      useEditorStore
        .getState()
        .setWebhookListening(
          res.expiresAt,
          nodeSignatures(definition.nodes, definition.edges, definition.pinData ?? {}),
        );
    } catch (error) {
      toast.error('Não foi possível escutar', {
        description:
          error instanceof ApiError
            ? [error.message, ...error.issues.map((i) => i.message)].join(' — ')
            : undefined,
      });
    }
  };
  const stop = async () => {
    useEditorStore.getState().setWebhookListening(null);
    await api.delete(`/api/v1/workflows/${workflowId}/listen-test-webhook`).catch(() => undefined);
  };

  return (
    <section data-testid="webhook-panel" className="grid gap-3 rounded-md border p-3">
      <h4 className="text-sm font-medium">URLs do webhook ({method})</h4>
      {path ? (
        <>
          <UrlRow
            label="URL de teste"
            url={`${origin}/webhook-test/${path}`}
            testId="webhook-test-url"
          />
          <UrlRow
            label="URL de produção"
            url={`${origin}/webhook/${path}`}
            testId="webhook-prod-url"
          />
          {!published && (
            <p className="text-xs text-muted-foreground">
              A URL de produção só responde depois de publicar o workflow.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Informe o caminho para ver as URLs.</p>
      )}
      {canExecute &&
        (listening ? (
          <div className="flex items-center gap-2" data-testid="webhook-listening">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span className="flex-1 text-sm">
              Aguardando a chamada de teste… ({Math.floor(remaining / 60)}:
              {String(remaining % 60).padStart(2, '0')})
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => void stop()}>
              <Square /> Parar
            </Button>
          </div>
        ) : (
          <Button type="button" size="sm" disabled={!path} onClick={() => void listen()}>
            <Radio /> Escutar chamada de teste
          </Button>
        ))}
    </section>
  );
}
