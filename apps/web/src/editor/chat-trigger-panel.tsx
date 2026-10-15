import type { WorkflowNode } from '@olly/shared-types';
import { UrlRow } from './webhook-panel';

/**
 * URLs do chat publicado (spec 021, FR-003): a página hospedada e o endereço HTTP do N8N
 * (`/webhook/<webhookId>/chat`). Valem depois de publicar o workflow; no editor, o chat é
 * testado pelo botão "Abrir chat".
 */
export function ChatTriggerPanel({ node, published }: { node: WorkflowNode; published: boolean }) {
  const webhookId = typeof node.params.webhookId === 'string' ? node.params.webhookId : '';
  const isPublic = node.params.public === true;
  const hosted = node.params.mode !== 'webhook';
  const origin = window.location.origin;
  return (
    <section data-testid="chat-trigger-panel" className="grid gap-3 rounded-md border p-3">
      {!isPublic ? (
        <p className="text-xs text-muted-foreground">
          Teste a conversa pelo botão <strong>Abrir chat</strong> do editor. Para usar fora do
          editor, ligue <strong>Disponibilizar o chat publicamente</strong> e publique o workflow.
        </p>
      ) : (
        <>
          {hosted && (
            <UrlRow
              label="Página do chat"
              url={`${origin}/chat/${webhookId}`}
              testId="chat-page-url"
            />
          )}
          <UrlRow
            label="Endereço HTTP (protocolo do N8N)"
            url={`${origin}/webhook/${webhookId}/chat`}
            testId="chat-endpoint-url"
          />
          <p className="text-xs text-muted-foreground">
            {published
              ? 'O chat responde com a versão publicada; publique de novo para valer as alterações.'
              : 'O chat passa a responder depois de publicar o workflow.'}
          </p>
        </>
      )}
    </section>
  );
}
