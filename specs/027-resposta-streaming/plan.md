# Plano técnico — Spec 027: Resposta em streaming no Webhook e no Chat Trigger

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Modo de resposta `streaming`:** entra no Webhook (`trigger.webhook`) e no Chat Trigger (`trigger.chat`).
- **Entrega do stream:** a instância da API que recebe a chamada assina os eventos da execução e escreve uma linha NDJSON por evento na resposta, sem buffer.
  - **Origem dos eventos:** `nodeStarted`, `nodeFinished` e `executionFinished`, que o worker já publica no canal Redis `olly:execution-events` (spec 006).
  - **Momento da assinatura:** entre a criação da execução e o despacho, para nenhum evento se perder.
- **Limite de streams por projeto:** contado no Redis, para valer com várias instâncias da API.
- **Proxies:** o nginx do `k3s/` e do compose deixa de bufferizar o caminho `/webhook`.
- **Sem mudança no motor nem nos workers.**

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — Compatibilidade com o N8N | Mesmo modo (`responseMode: streaming`) e tipos de evento do N8N (`begin`, `item`, `end`, `error`); importação do modo |
| III — Segurança | Autenticação, allowlist de IP, limite de taxa e CORS do webhook e do chat valem igual; o stream só leva metadados (sem entrada, saída, console ou binários); a resposta final segue o tratamento atual; a rota alterada (`PUT /projects/:id/quota`) mantém o RBAC (`project:manage` global) e a auditoria |
| IV — Testes | Unidade (formato dos eventos, limite), integração (stream real lido aos poucos, ordem, erro, fila, espera, desconexão, limite, duas instâncias da API), E2E (chat hospedado e painel do editor) |
| VI — Operação | Limite por projeto, sinal periódico, liberação da vaga na desconexão |
| IX — Simplicidade | Sem dependência nova: Fastify com `reply.raw`, Redis já existente |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/nodes` | `responseMode: streaming` no Webhook e no Chat Trigger, com descrição (nomes dos nós visíveis a quem chama) |
| `packages/shared-types` | Tipos do evento do stream (`StreamEvent`) e `streaming` em `ChatSettings` |
| `packages/db` / `infra/migrations` | `0019_project_stream_limit`: `projects.max_webhook_streams INT NULL` |
| `apps/api` | `webhooks/execution-stream.ts` (assinatura, formato, sinal periódico, encerramento); `webhooks/stream-limiter.ts` (Redis); `webhook-gateway.ts` e `chat.service.ts` (modo novo); `publishing.service.ts` (aviso do "Responder ao webhook"); `ExecutionsService.launch` com `beforeDispatch`; config `OLLY_WEBHOOK_STREAM_MAX_PER_PROJECT` e `OLLY_WEBHOOK_STREAM_PING_SECONDS`; `PUT /projects/:id/quota` com `maxWebhookStreams`; importador do N8N |
| `apps/web` | Chat hospedado/incorporado (`chat/chat-view.tsx`): lê o stream e mostra o passo atual; painel de chat do editor: passo atual pelo estado da execução de teste (já recebido pelo WebSocket) |
| `infra/docker/nginx.conf`, `k3s/web-nginx-configmap.yaml`, `k3s/web.yaml` | Sem buffer nem compressão no `/webhook`; comentário do tempo limite da Route |
| `docs/` | `docs/nos/trigger.webhook.md`, `docs/nos/trigger.chat.md` (formato, exemplos, proxies), `contratos.md`, `modelo-dados.md`, `k3s/README.md` |

## Design

### §1 Formato (NDJSON)

- **Cabeçalhos** (os do Webhook do N8N, conferidos na T001): `Content-Type: application/json; charset=utf-8`, `Transfer-Encoding: chunked`, `Cache-Control: no-cache` e `Connection: keep-alive`, mais `X-Accel-Buffering: no` (nginx); status 200.
- **`timestamp`:** milissegundos desde 1970 (número), como no N8N; `itemIndex` sempre presente (0).
- **Uma linha JSON por evento**, terminada em `\n`:

| `type` | Quando | Campos |
|---|---|---|
| `execution` | Início, fila, espera | `metadata: { executionId, status: started \| queued \| waiting, timestamp }` |
| `begin` | Nó começou | `metadata: { executionId, nodeId, nodeName, nodeType, runIndex, itemIndex: 0, timestamp }` |
| `end` | Nó terminou | `metadata` do `begin` + `{ status: success \| error \| cancelled, durationMs, itemsIn, itemsOut }` |
| `item` | Resposta final | `content`: a resposta (Webhook: o JSON que o modo "último nó" devolve, ou o corpo do "Responder ao webhook"; chat: o texto da resposta); `metadata: { executionId, nodeId, nodeName, final: true, timestamp }` (o nó que produziu a resposta) |
| `error` | Execução falhou ou foi interrompida | `content`: mensagem (mesmo texto das respostas de erro atuais); `metadata: { executionId, nodeId?, nodeName?, timestamp }` |
| `ping` | A cada `OLLY_WEBHOOK_STREAM_PING_SECONDS` (padrão 15) sem eventos | `metadata: { executionId, running: [{ nodeId, nodeName, nodeType, runIndex }], timestamp }` (os nós em execução: um, ou mais com itens em paralelo; vazio na fila) |

- **Nome do nó:** `nodeName` é o nome como aparece no canvas (o mesmo do `$('Nó')`), em todo evento ligado a um nó, para quem chama saber em que ponto do workflow a execução está. O `ExecutionStream` guarda os nós que começaram e ainda não terminaram, para o `ping`.
- **Do N8N:** `begin`, `item`, `end` e `error`, com o mesmo significado (no N8N, `begin`/`end` delimitam o que cada nó transmite). **Do Olly Flow:** `execution` e `ping`. A documentação orienta a ignorar tipos desconhecidos.
- **Eventos fora do stream:**
  - nós com status `skipped`;
  - sub-nós (o motor não os registra como passos);
  - eventos de outras execuções, inclusive sub-workflows (outro `executionId`);
  - `agentStep` e dados (`data`, `console`) do `nodeFinished`.

### §2 Assinatura sem perda e ordem

- **Hook `beforeDispatch(executionId)`:** novo no `ExecutionsService.launch`, chamado depois de inserir a execução e antes de despachar. O gateway registra ali o ouvinte no `ExecutionStream`.
- **`ExecutionStream`:** recebe as mensagens do canal Redis pela assinatura que a API já mantém (`ExecutionEventsService`) e repassa aos ouvintes locais por `executionId`.
- **Ordem:** os eventos de uma execução saem de um único worker, pelo mesmo canal, então a ordem é preservada (NFR-002).
- **Fim:**
  - **com sucesso:** no `executionFinished`, busca o resultado pelo `dispatcher.waitForResult` (o mesmo da resposta síncrona), escreve o `item` final e encerra;
  - **com erro ou cancelada:** escreve o `error` e encerra;
  - **em espera** (`waiting`): escreve `execution: waiting` e encerra.
- **Teto de duração:** o tempo máximo do workflow mais uma margem de 30 s; depois disso, escreve `error` ("tempo máximo do stream") e encerra.
- **Desconexão** (`reply.raw` `close`): remove o ouvinte e libera a vaga. A execução segue.

### §3 Webhook

- `responseMode` ganha `streaming`.
- No `respond()` do gateway, o modo novo usa `reply.hijack()` e o `ExecutionStream`.
- Publicação: com `streaming` e um "Responder ao webhook" no fluxo, aviso `WEBHOOK_STREAM_RESPONSE_NODE` ("status e cabeçalhos do nó de resposta são ignorados no modo Streaming").
- Vale também em `/webhook-test`.

### §4 Chat

- `ChatSettings.responseMode` ganha `streaming`; o `POST …/chat` responde com o stream (§1), com o `item` final trazendo o texto da resposta.
- **Página hospedada e incorporada:** com `responseMode: streaming` (já vem na configuração pública do chat), lê a resposta com `fetch` + `ReadableStream`, mostra "Executando: <nó>" no lugar do indicador de digitação a cada `begin` e a resposta no `item`.
- **Painel do editor:** mostra o nó com status `running` no estado da execução de teste (eventos do WebSocket que o editor já recebe). Não depende do stream HTTP.
- A sessão ocupada (spec 021, FR-014) e o limite de taxa valem igual.

### §5 Limite por projeto

- **`StreamLimiter`:** conjunto ordenado no Redis `olly:streams:<projeto>`; o membro é o id do stream, e a pontuação, a validade (agora + 2 × intervalo do sinal).
  - **Adquirir:** script Lua que remove os vencidos e conta; abaixo do limite, adiciona. A operação é atômica entre instâncias.
  - **Renovar:** a cada `ping` ou evento.
  - **Liberar:** no fim e na desconexão. Uma instância que cai deixa a vaga vencer sozinha.
- **Limite:** `projects.max_webhook_streams` ou `OLLY_WEBHOOK_STREAM_MAX_PER_PROJECT` (padrão 20).
- **Acima do limite:** 429 `{ message: 'Limite de streams simultâneos do projeto atingido (N)' }`, antes de criar a execução.
- **Ajuste:** `PUT /projects/:id/quota` aceita `maxWebhookStreams: number | null` (`project:manage` global), auditado como `project.quota`.

### §6 Proxies

- **nginx (`infra/docker/nginx.conf` e `k3s/web-nginx-configmap.yaml`):** no `location ~ ^/webhook(-test)?/`, `proxy_buffering off`, `proxy_cache off`, `gzip off` e `proxy_read_timeout` no tempo máximo de workflow do ambiente (o sinal periódico evita corte por inatividade).
- **Route (`k3s/web.yaml`):** comentário de que `haproxy.router.openshift.io/timeout` deve ser maior ou igual ao tempo máximo dos workflows chamados em streaming.

### §7 Importação do N8N

- **Webhook** `responseMode: streaming` → `streaming`, sem o aviso atual (`convertWebhook`).
- **Chat Trigger** `options.responseMode: streaming` → `streaming`, no lugar de `lastNode` com aviso.
- **Aviso nos dois casos:** "No Olly Flow, o stream traz os passos do fluxo; a resposta completa chega no fim (sem texto do modelo aos poucos)".

## Modelo de dados

- `projects.max_webhook_streams INT NULL CHECK (max_webhook_streams > 0)` (migration 0019). `NULL` = padrão da plataforma.

## Contratos

- **Webhook e chat em `streaming`:** 200 com NDJSON (§1); 429 acima do limite de streams.
- **`PUT /api/v1/projects/:id/quota`:** `{ maxConcurrentExecutions?: number | null, maxWebhookStreams?: number | null }`.
- **`StreamEvent`** em `packages/shared-types`.

## Permissões RBAC

| Rota | Permissão |
|---|---|
| `PUT /projects/:id/quota` (campo novo) | `project:manage` (escopo global), como hoje |

Webhook e chat: autenticação própria (specs 005 e 021), sem mudança.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `OLLY_WEBHOOK_STREAM_MAX_PER_PROJECT` | 20 | Streams simultâneos por projeto sem limite próprio |
| `OLLY_WEBHOOK_STREAM_PING_SECONDS` | 15 | Intervalo do sinal periódico (e base da validade da vaga) |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Modo de resposta no Webhook e no Chat Trigger | Nó novo "Webhook streaming" | Mesmo desenho do N8N (importação direta) e reaproveita autenticação, publicação e escuta de teste |
| Eventos do canal Redis existente | Consultar `node_executions` periodicamente | Tempo real, sem carga no banco; o canal já cruza instâncias e preserva a ordem |
| Assinatura no `beforeDispatch` | Guardar os eventos recentes de todas as execuções em cada API | Sem perda e sem memória proporcional ao volume total |
| NDJSON com `reply.raw` | SSE | Decisão do PO; mais simples para integrações (curl, Python) |
| Limite no Redis com validade | Contador em memória | Vale com várias instâncias e se recupera da queda de uma |
| Painel do editor pelo estado da execução de teste | Stream HTTP no painel | O editor já recebe os eventos pelo WebSocket |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001, FR-002, FR-003, FR-004, SC-001 | Integração | `apps/api/src/webhooks/webhook-stream.int.test.ts` (cliente que lê linha a linha: ordem, metadados sem dados, resposta final, erro, fila, espera, desconexão, `ping` com intervalo curto) |
| FR-006, SC-003 | Integração | `webhook-stream.int.test.ts` (limite 1, 429 sem execução, vaga liberada) |
| NFR-002, SC-002 | Integração | `webhook-stream.int.test.ts` (duas instâncias da API na mesma base e no mesmo Redis, chamadas distribuídas) |
| FR-005, SC-004 | Integração + E2E | `chat.int.test.ts` (stream pela API do chat); `apps/web/e2e/chat.spec.ts` (passo atual no chat hospedado e no painel) |
| FR-007 | Integração | `webhook-stream.int.test.ts` (autenticação e aviso de publicação) |
| FR-008 | Unidade | `apps/api/src/workflow-io/n8n/n8n.test.ts` |
| Formato | Unidade | `apps/api/src/webhooks/execution-stream.test.ts` |

## Riscos

| Risco | Mitigação |
|---|---|
| Proxy no caminho do cliente bufferiza (fora do `k3s/`) | Cabeçalho `X-Accel-Buffering: no`, sinal periódico e orientação na documentação; pré-requisito de Infra |
| Formato do N8N diferente do lembrado | T001 confere com a documentação do N8N antes de implementar e ajusta §1 |
| Conexões longas consomem a API | Limite por projeto; vaga com validade |
| Evento perdido entre criar e despachar | Assinatura no `beforeDispatch` (§2) |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 20/10/2026 | Criação do plano | Spec 027 |
| 20/10/2026 | §1: `nodeName` em todo evento de nó, no `ping` (nós em execução) e no `item` final (nó que produziu a resposta) | Spec 027, histórico |
| 20/10/2026 | T001: formato conferido no N8N (código do Webhook e exemplo do fórum): `Content-Type: application/json; charset=utf-8`; `metadata` com `nodeId`, `nodeName`, `itemIndex`, `runIndex` e `timestamp` em milissegundos | Implementação |
