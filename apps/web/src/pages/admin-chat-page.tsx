import {
  OLLY_CHAT_RETENTION,
  type OllyChatAuthType,
  type OllyChatConfig,
  type OllyChatConfigUpdate,
} from '@olly/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { AdminNav } from '@/components/layout/admin-nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const CONFIG_KEY = ['admin-olly-chat'] as const;

const errorMessage = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...e.issues.map((i) => i.message)].join(' — ')
    : e instanceof Error
      ? e.message
      : String(e);

/** Aba **Olly Chat** da Administração (spec 028, FR-008). */
export function AdminChatPage() {
  const api = useApi();
  const { data } = useQuery({
    queryKey: CONFIG_KEY,
    queryFn: () => api.get<OllyChatConfig>('/api/v1/admin/olly-chat'),
  });
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
      <AdminNav />
      <Card>
        <CardHeader>
          <CardTitle>Olly Chat</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Recriado a cada configuração salva: o estado inicial é a configuração gravada. */}
          {data && <ChatConfigForm key={data.updatedAt ?? 'nova'} initial={data} />}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * URL do webhook do assistente (em Streaming), retenção das sessões e autenticação opcional.
 * Segredos em branco mantêm os guardados (eles nunca voltam da API).
 */
function ChatConfigForm({ initial }: { initial: OllyChatConfig }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [webhookUrl, setWebhookUrl] = useState(initial.webhookUrl ?? '');
  const [retentionDays, setRetentionDays] = useState(String(initial.retentionDays));
  const [authType, setAuthType] = useState<OllyChatAuthType>(initial.authType);
  const [headerName, setHeaderName] = useState(initial.headerName ?? '');
  const [basicUser, setBasicUser] = useState(initial.basicUser ?? '');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body: OllyChatConfigUpdate = {
      webhookUrl: webhookUrl.trim() || null,
      retentionDays: Number(retentionDays),
      authType,
      ...(authType === 'headerAuth' && { headerName, ...(secret && { headerValue: secret }) }),
      ...(authType === 'basicAuth' && { basicUser, ...(secret && { basicPassword: secret }) }),
    };
    try {
      const saved = await api.put<OllyChatConfig>('/api/v1/admin/olly-chat', body);
      queryClient.setQueryData(CONFIG_KEY, saved);
      toast.success('Configuração do chat salva');
    } catch (error) {
      toast.error('Não foi possível salvar', { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const keepHint =
    initial.hasSecret && authType === initial.authType ? 'Deixe em branco para manter o atual' : '';
  return (
    <form className="grid max-w-xl gap-4" onSubmit={(e) => void save(e)}>
      <p className="text-sm text-muted-foreground">
        As mensagens do chat da plataforma vão para este webhook, com o payload{' '}
        <code>chatSessionId</code>, <code>client</code>, <code>email</code>, <code>login</code>,{' '}
        <code>name</code> e <code>message</code>. Use um Webhook com{' '}
        <strong>Responder: streaming</strong>. Endereços internos que não são do Olly Flow precisam
        estar no filtro de rede (<code>OLLY_HTTP_ALLOWLIST</code>).
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="chat-webhook-url">URL do webhook do workflow</Label>
        <Input
          id="chat-webhook-url"
          type="url"
          placeholder="https://…/webhook/assistente"
          value={webhookUrl}
          onChange={(e) => {
            setWebhookUrl(e.target.value);
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="chat-retention">Retenção das sessões (dias)</Label>
        <Input
          id="chat-retention"
          type="number"
          min={OLLY_CHAT_RETENTION.min}
          max={OLLY_CHAT_RETENTION.max}
          className="w-32"
          value={retentionDays}
          onChange={(e) => {
            setRetentionDays(e.target.value);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Contados a partir da última mensagem: uma mensagem nova renova o prazo.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="chat-auth">Autenticação do webhook</Label>
        <Select
          id="chat-auth"
          className="w-56"
          value={authType}
          onChange={(e) => {
            setAuthType(e.target.value as OllyChatAuthType);
            setSecret('');
          }}
        >
          <option value="none">Nenhuma</option>
          <option value="headerAuth">Cabeçalho com chave</option>
          <option value="basicAuth">Basic Auth</option>
        </Select>
      </div>
      {authType === 'headerAuth' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="chat-header-name">Nome do cabeçalho</Label>
            <Input
              id="chat-header-name"
              placeholder="x-api-key"
              value={headerName}
              onChange={(e) => {
                setHeaderName(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="chat-header-value">Valor</Label>
            <Input
              id="chat-header-value"
              type="password"
              placeholder={keepHint}
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
              }}
            />
          </div>
        </div>
      )}
      {authType === 'basicAuth' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="chat-basic-user">Usuário</Label>
            <Input
              id="chat-basic-user"
              value={basicUser}
              onChange={(e) => {
                setBasicUser(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="chat-basic-password">Senha</Label>
            <Input
              id="chat-basic-password"
              type="password"
              placeholder={keepHint}
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
              }}
            />
          </div>
        </div>
      )}
      <div>
        <Button type="submit" disabled={busy}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
