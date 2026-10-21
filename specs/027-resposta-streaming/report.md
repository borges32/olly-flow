# Relatório — Spec 027: Resposta em streaming no Webhook e no Chat Trigger

**Status:** Implementada
**Data:** 20/10/2026

## Resumo

O Webhook e o Chat Trigger ganharam o modo de resposta **Streaming**. Quem chama recebe, enquanto o fluxo roda, uma linha JSON por evento (NDJSON, no formato do N8N), e a resposta no fim:
- **início da execução:** gravada e iniciada;
- **início e fim de cada nó:** com o **nome do nó** como no canvas, o tipo, a iteração, o status, a duração e a quantidade de itens;
- **sinal periódico:** com o nó em execução;
- **resposta final:** a mesma do modo "último nó" ou o corpo do "Responder ao webhook", com o nó que a produziu;
- **erro e espera:** encerram o stream.

O stream leva só metadados: sem entrada, saída ou console dos nós, e sem passos de sub-workflows ou de sub-nós.

**No chat:** a página hospedada, a incorporada e o painel do editor mostram "Executando: <nó>" enquanto esperam.

**Limite por projeto:** cada projeto tem um limite de streams simultâneos (padrão 20, ajustável pela administração), e acima dele a chamada é recusada antes de criar a execução.

**Importação do N8N:** o importador mantém o modo Streaming do N8N, com aviso da diferença.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | Formato conferido no código do Webhook do N8N e num exemplo do fórum. Ajustes no plano: `Content-Type: application/json; charset=utf-8` e `timestamp` em milissegundos |
| T002 | ✅ | `infra/migrations/0019_project_stream_limit`; `projects.max_webhook_streams`; testes de migration |
| T003 | ✅ | `packages/shared-types/src/stream.ts` (`StreamEvent`, cabeçalhos); `streaming` no Webhook e no Chat Trigger; `ChatConfig.streaming` |
| T004 | ✅ | `OLLY_WEBHOOK_STREAM_MAX_PER_PROJECT`, `OLLY_WEBHOOK_STREAM_PING_SECONDS` (config, `.env.example`, `k3s/configmap.yaml`) |
| T010 | ✅ | `beforeDispatch` em `ExecutionsService.launch` e `startTestRun`; `ExecutionEventsService.listen` |
| T011 | ✅ | `webhooks/stream-events.ts` (`StreamTracker`) e `webhooks/stream-session.ts` (`StreamSession`); testes de unidade |
| T012 | ✅ | `webhooks/stream-limiter.ts` sobre o semáforo da cota (`ProjectQuota` com prefixo `olly:streams`); `maxWebhookStreams` em `PUT /projects/:id/quota`, auditado |
| T013 | ✅ | Modo no gateway (produção e `/webhook-test`) via `webhooks/stream-responder.ts`; aviso `WEBHOOK_STREAM_RESPONSE_NODE` na publicação |
| T014 | ✅ | `webhook-stream.int.test.ts` (9 casos) |
| T020 | ✅ | `ChatService`: streaming com a trava da sessão renovada durante o stream; caso em `chat.int.test.ts` |
| T021 | ✅ | `chat/chat-stream.ts` (leitura e estado) e testes; `chat-page.tsx`, `chat-view.tsx` (passo atual), `editor/chat-panel.tsx` |
| T022 | ✅ | `e2e/chat.spec.ts` › "spec 027…" |
| T030 | ✅ | Importador: Webhook e Chat Trigger em Streaming, com aviso; `n8n.test.ts` |
| T090 | ✅ | `infra/docker/nginx.conf` e `k3s/web-nginx-configmap.yaml` (sem buffer, sem cache, sem gzip no `/webhook`); `k3s/web.yaml` e `k3s/README.md` |
| T091 | ✅ | `docs/nos/trigger.webhook.md` (formato, exemplos com curl, Python e JavaScript, regras e proxies), `trigger.chat.md`, `workflow-json.md`, `contratos.md`, `modelo-dados.md` |
| T092 | ✅ | Spec 021 (FR-005, NFR-004 e histórico) e spec 005 (histórico) |
| T093–T095 | ✅ | Ver abaixo |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `stream-events.test.ts` › "FR-001…"; `webhook-stream.int.test.ts` › "FR-001/FR-002/FR-003/NFR-001/SC-001…" (cabeçalhos, ordem) e "FR-001 (escuta de teste)…" |
| FR-002 | Sim | `webhook-stream.int.test.ts` (ordem, nome do nó, resposta final do último nó e do "Responder ao webhook", erro com o nó) |
| FR-003 | Sim | `stream-events.test.ts` (sem dados do nó); `webhook-stream.int.test.ts` (nada da chamada nem da saída nos passos) |
| FR-004 | Sim | `webhook-stream.int.test.ts` › "FR-004: sinal periódico…", "FR-004: nó Esperar longo…" e a desconexão em "FR-006/SC-003/FR-004…" |
| FR-005 | Sim | `chat.int.test.ts` › "spec 027…"; `chat-stream.test.ts`; E2E `chat.spec.ts` › "SC-004/FR-005…" |
| FR-006 | Sim | `webhook-stream.int.test.ts` › "FR-006/SC-003/FR-004…" (429 sem execução, vaga liberada, auditoria) |
| FR-007 | Sim | `webhook-stream.int.test.ts` › "FR-007: a autenticação…" e o aviso de publicação em "FR-002/FR-007…" |
| FR-008 | Sim | `n8n.test.ts` › "spec 027 — FR-008…" |
| FR-009 | Sim | Documentação revisada (`docs/nos/trigger.webhook.md`); testes de documentação (`docs.test.ts` e os da raiz) passando |
| NFR-001 | Sim | `webhook-stream.int.test.ts` (cada `begin`/`end` chega em menos de 1 s) |
| NFR-002 | Sim | `webhook-stream.int.test.ts` › "NFR-002/SC-002…" (duas instâncias da API) |
| NFR-003 | Sim | Textos em português |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | Integração: o fim do primeiro nó chega mais de 400 ms antes do início do terceiro; a resposta final é igual à do "último nó" |
| SC-002 | ✅ (com 30 chamadas) | Integração com duas instâncias da API: 30 chamadas simultâneas, alternadas entre as instâncias, recebem todos os passos na ordem. A spec pede 100; ver "Desvios" |
| SC-003 | ✅ | Integração: com limite 1, a segunda chamada simultânea recebe 429 sem criar execução; depois do fim da primeira, é aceita |
| SC-004 | ✅ | E2E: "Executando: Analisando dados" no chat hospedado e no painel do editor, e depois a resposta |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ⚠️ 920 de 921 na execução completa (864 nos pacotes e 57 na raiz). A falha é o teste de tempo NFR-002 das expressões (spec 003): 1,06 s para limite de 1 s, com a máquina ocupada pelos outros pacotes. Passou 3 vezes seguidas isolado; instabilidade conhecida, sem relação com esta spec |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 413 testes (api 345, db 34, nodes 31, engine 3) |
| `pnpm test:e2e` | ✅ 60 de 60 |
| `pnpm app:up && pnpm smoke` | ✅ |

## Decisões tomadas

- **Formato do N8N (T001):** `begin`, `item`, `end` e `error` com `metadata.nodeId`, `nodeName`, `itemIndex`, `runIndex` e `timestamp` em milissegundos, e o `Content-Type` do Webhook do N8N. Os eventos `execution` e `ping` são do Olly Flow; a documentação orienta a ignorar tipos desconhecidos.
- **Sem perda de eventos:** a assinatura acontece no `beforeDispatch`, entre gravar a execução e despachá-la. Os eventos chegam pelo canal Redis que já alimentava o WebSocket, entregue a ouvintes por execução (`ExecutionEventsService.listen`) em cada instância da API.
- **Resposta final:** pelo `waitForResult` já usado na resposta síncrona. Com o "Responder ao webhook", o corpo dele; senão, o JSON do último nó com dados (Webhook) ou o mesmo corpo do modo "último nó" (chat). O nó que produziu a resposta vem no `metadata`.
- **`StreamResponder`:** um serviço próprio, usado pelo gateway e pelo chat. Evita a dependência circular, porque o gateway já depende do serviço do chat.
- **Limite:** reaproveita o semáforo com validade da cota de execuções (spec 006), com outro prefixo (`olly:streams`); a vaga é renovada pelo sinal periódico. Sem Redis, o limite não é conferido (o stream segue, com aviso no log), porque a fila também estaria fora.
- **Teto do stream:** o tempo máximo do workflow (`settings.timeoutSec` ou `OLLY_DEFAULT_WORKFLOW_TIMEOUT`) mais 30 s.
- **Chat:** a trava da sessão (spec 021, FR-014) é renovada durante o stream, para a mensagem seguinte da mesma sessão continuar esperando.
- **Painel do editor:** mostra o nó em execução pelo estado da execução de teste (eventos do WebSocket), sem usar o stream HTTP, como previsto no plano.
- **Proxies:** o nginx não bufferiza nem comprime o `/webhook`. Os tempos limite do nginx e da Route contam inatividade, e o sinal periódico mantém a conexão, sem precisar aumentar os 130 s da resposta síncrona.

## Desvios da spec/plano

- **SC-002:** a integração usa 30 chamadas simultâneas, e não 100, para o teste caber no tempo da suíte. A ordem e a completude são verificadas em todas.
- **Plano:** o `StreamResponder` foi acrescentado (ver Decisões). O plano previa o modo no gateway; a lógica ficou nesse serviço, usado também pelo chat.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- **Infra:** aplicar o ConfigMap (variáveis novas) e o nginx do `k3s/` atualizados; conferir que proxies fora do OpenShift (ex.: do cliente) não bufferizam a resposta.
- **SC-002 com 100 chamadas:** confirmar em homologação, com duas réplicas da API.
- **Clientes do N8N:** quem já consome o streaming do N8N recebe, no Olly Flow, os passos e a resposta completa no fim, e não o texto do modelo aos poucos. A importação avisa.

## Como demonstrar

1. `pnpm app:up`; num workflow, Webhook com **Responder: streaming**, alguns nós e **Publicar**.
2. `curl -N -X POST http://localhost:8080/webhook/<caminho>`: os passos chegam enquanto o fluxo roda, e a resposta no fim.
3. Chat Trigger público com **Responder: streaming**: na página `/chat/<id>`, o balão mostra "Executando: <nó>" e depois a resposta.
4. `PUT /api/v1/projects/<id>/quota` com `{"maxWebhookStreams": 1}`: a segunda chamada simultânea recebe 429.
