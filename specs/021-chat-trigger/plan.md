# Plano técnico — Spec 021: Nó Chat Trigger ("When chat message received")

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Nó `trigger.chat`** (`packages/nodes/src/trigger/chat/`), com os parâmetros no formato do Chat Trigger do N8N, incluindo um `webhookId` estável, que forma a URL pública. A entrada `ai_memory` aparece quando "Carregar sessão anterior" é "Da memória".
- **Publicação:** o chat público é registrado na tabela `webhooks` existente (spec 005), em `POST <webhookId>/chat` (mensagens) e `GET <webhookId>/chat` (configuração da página), o mesmo caminho do N8N (`/webhook/<webhookId>/chat`). Assim, o chat reaproveita do webhook:
  - o registro de rotas entre instâncias;
  - o limite de taxa e o CORS;
  - a credencial Basic Auth;
  - a espera do resultado e o nó "Responder ao webhook".
- **Atendimento (`ChatService`, API):** para cada mensagem, faz em ordem:
  1. autentica;
  2. valida a mensagem e os arquivos;
  3. espera a vez da sessão, com um lock no Redis (FR-014);
  4. lança a execução;
  5. espera o resultado e devolve a resposta no formato do N8N.

  O mesmo serviço atende o painel do editor, em modo teste.
- **Editor:** o painel de chat inicia a execução de teste e acompanha os eventos como a execução de teste atual; depois busca a resposta.
- **Página hospedada:** rota pública do frontend `/chat/:webhookId`, que lê a configuração e conversa pelo mesmo endereço.
- **Importação e exportação do N8N:** conversor do `chatTrigger` (1 a 1.3); pendências para *streaming*, CSS e memória temporária.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| I — Spec antes do código | Spec 021 esclarecida pelo PO em 14/10/2026 |
| II — Compatibilidade com o N8N | Mesmos parâmetros, item de saída, caminho (`/webhook/<webhookId>/chat`), ações (`sendMessage`, `loadPreviousSession`) e formato de resposta. Desvios decididos pelo PO: sem *streaming*, sem widget e mensagens da mesma sessão em sequência |
| III — Segurança | Autenticação do chat como no webhook, inclusive `OLLY_REQUIRE_WEBHOOK_AUTH`; limite de taxa e tamanho; CORS por origem; Markdown renderizado sem HTML; sem CSS personalizado; SQL só parametrizado; rotas novas da API com RBAC |
| IV — Testes | Unidade (nó, conversor, extração da resposta, MIME); integração com Redis, Postgres e modelo simulado (público, teste, sessão anterior, sequência, autenticação, arquivos); E2E do painel e da página |
| VII — Rastreabilidade | As mensagens geram execuções registradas (origem `chat`); publicação e execução de teste já auditadas |
| VIII — Privacidade e observabilidade | Mensagens como dados de execução, com mascaramento, política de dados e retenção (spec 009); histórico na memória com a retenção da spec 011 |
| IX — Simplicidade | Reaproveita a tabela `webhooks`, o gateway, o `ResultSubscriber` e a execução de teste. Dependências novas justificadas: `@fastify/multipart` e `react-markdown` |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/shared-types` | `DynamicPorts` `chatTriggerInputs`; origem de execução `chat`; tipos do chat (`ChatConfig`, `ChatTestReply`) |
| `packages/nodes` | Nó `trigger.chat` (parâmetros, portas, saída); `chat/config.ts` (parâmetros com padrões, configuração da página); `chat/response.ts` (resposta a partir do último nó, tipos MIME permitidos); `chat/history.ts` (histórico no formato do LangChain) |
| `packages/engine` | Validação: no máximo um Chat Trigger; memória obrigatória com "Da memória"; aviso de memória temporária (FR-010, FR-006, FR-015) |
| `apps/api` | `ChatService`; rotas no gateway para os nós de chat; publicação registra as rotas de chat; rotas de teste do editor; multipart; importador e exportador |
| `apps/web` | Painel de chat no editor; página pública `/chat/:webhookId`; componentes de mensagem com Markdown; painel do nó com a URL do chat; `webhookId` novo ao adicionar ou colar o nó |
| `docs/` | `docs/nos/trigger.chat.md`, `workflow-json.md`, `importacao-n8n.md`, `contratos.md`, `docs/rbac-matriz.md` |

## Design

### §1 Nó `trigger.chat`

- **Tipo e versão:** `trigger.chat`, versão 1, categoria `trigger`, ícone `message-circle`, nome "Mensagem de chat recebida (Chat Trigger)".
- **Parâmetros** (nomes do N8N):

  ```text
  webhookId        uuid, x-hidden (gerado ao criar ou colar o nó; vem do N8N na importação)
  public           boolean, padrão false   "Disponibilizar o chat publicamente"
  mode             'hostedChat' | 'webhook' (padrão hostedChat)        show: public = true
  authentication   'none' | 'basicAuth' | 'ollyUserAuth' (padrão none)  show: public = true
  initialMessages  texto multilinha (padrão do N8N)                     show: mode = hostedChat
  options {
    allowFileUploads       boolean
    allowedFilesMimeTypes  texto (padrão '*')                           show: allowFileUploads
    allowedOrigins         texto (padrão '*')                           CORS
    inputPlaceholder, title, subtitle, getStarted   texto (padrões do N8N)
    showWelcomeScreen      boolean
    loadPreviousSession    'notSupported' | 'memory' (padrão notSupported)
    responseMode           'lastNode' | 'responseNode' (padrão lastNode)
  }
  ```

  Todos os campos com `x-no-expression`: valem antes de existir um item.
- **Credencial:** `webhookBasicAuth` com `authentication = basicAuth`, a mesma do webhook.
- **Portas:** sem entradas `main`; saída `main`. Com `DynamicPorts` `chatTriggerInputs`, ganha a entrada `ai_memory` quando `options.loadPreviousSession = memory`.
- **Execução:** emite `ctx.triggerItems`, recebidos do `ChatService` (FR-001). Sem eles, emite `{ sessionId: <novo>, action: 'sendMessage', chatInput: '' }`, para o "Executar workflow" comum continuar funcionando.
- **Item da mensagem:** `{ json: { sessionId, action: 'sendMessage', chatInput, files? }, binary? }`. Os arquivos ficam nos campos binários e na lista `files` do JSON, no formato do N8N, conferido na T002.

### §2 Resposta e arquivos (funções puras em `packages/nodes/src/trigger/chat/`)

- **`chatResponseBody(outcome, mode)`:** com `lastNode`, devolve o JSON do primeiro item do último nó, como o webhook e o N8N.
- **`chatMessageText(body)`:** usada pela página e pelo painel. Devolve `output` se for texto; senão `text`; senão o JSON formatado.
- **`fileAllowed(mimeType, allowed)`:** aceita a lista separada por vírgula, com curingas (`image/*`) e `*`.

### §3 Publicação e rotas (FR-003, FR-004, FR-010)

- **`PublishingService.prepare`:** acrescenta `chatIssues(definition, …)`:
  - `CHAT_TRIGGER_DUPLICATE`: mais de um Chat Trigger habilitado;
  - `CHAT_NO_AUTH`: autenticação "Nenhuma" com `requireAuth` (como `WEBHOOK_NO_AUTH`);
  - `CHAT_CREDENTIAL_INVALID`: credencial Basic Auth ausente ou de outro tipo;
  - `CHAT_WEBHOOK_ID_INVALID`: identificador da URL ausente ou inválido.

  A memória obrigatória com "Da memória" é apontada pela validação estrutural das entradas de sub-nó (`AGENT_MODEL_REQUIRED`, "conecte memória"), que já bloqueia a publicação.
- **`publish`:** com `public = true`, insere em `webhooks` as linhas `POST <webhookId>/chat` e `GET <webhookId>/chat`, com o `node_id` do gatilho. O `UNIQUE (method, path)` impede dois workflows com o mesmo `webhookId`, com o erro `WEBHOOK_PATH_DUPLICATE` já existente.
- **Despublicar e excluir:** removem as linhas, como hoje.
- **`WebhookGateway`:** quando o nó da rota é `trigger.chat`, delega ao `ChatService`. O limite de taxa e o CORS do gateway valem, com as origens de `options.allowedOrigins`.

### §4 `ChatService` (`apps/api/src/chat/chat.service.ts`)

**Entrada:** `{ action, sessionId, chatInput, files? }`, em JSON ou `multipart/form-data` (campos e `files[]`, como o N8N).

1. **Autenticação (FR-004):**
   - `none`: sem conferência;
   - `basicAuth`: confere a credencial com a mesma função do webhook;
   - `ollyUserAuth`: exige uma sessão válida da plataforma (token do login local ou do IdP), pelo mesmo verificador do guard global, de qualquer usuário ativo.

   Sem acesso, responde 401 com o tipo de autenticação (não a credencial), para a página saber se pede usuário e senha ou o login.
2. **Validação (FR-009, FR-007):**
   - `sessionId` com 1 a 200 caracteres;
   - `chatInput` com até `OLLY_CHAT_MAX_MESSAGE_CHARS` caracteres, e não vazio sem arquivos;
   - arquivos só com `allowFileUploads`, dentro de `fileAllowed` e de `OLLY_WEBHOOK_MAX_BODY`;
   - erros respondem 400 ou 413 com a mensagem.
3. **`loadPreviousSession` (FR-006):** não executa o workflow.
   - Com `notSupported`, responde `{ data: [] }`.
   - Com `memory`, lê a memória ligada ao gatilho. A chave vem do `sessionKey` da memória, avaliado pelo avaliador de expressões (spec 003) com `$json = { sessionId, action }`. Na memória persistente, lê as últimas mensagens em `agent_memory` (projeto e chave, janela da memória); na temporária, não há histórico.
   - Responde `{ data: mensagens }`, no formato serializado do LangChain, como o N8N.
4. **Vez da sessão (FR-014):**
   - **lock:** `SET olly:chat:<workflowId>:<sessionId> <token> NX PX (timeout + 5 s)`, com nova tentativa a cada 200 ms até `OLLY_WEBHOOK_RESPONSE_TIMEOUT`;
   - **espera esgotada:** responde 409, com "A conversa ainda está respondendo a mensagem anterior";
   - **liberação:** compara e apaga (Lua) ao receber o resultado, no tempo limite ou em erro.
5. **Execução:**
   - **arquivos:** gravados no object storage (`chat/<uuid>`);
   - **produção:** `ExecutionsService.launch` com a versão publicada, `mode: 'production'`, `triggerType: 'chat'`, `triggeredBy: null` (ou o usuário, em `ollyUserAuth`) e `job: { triggerItems: [item], startNodeId }`;
   - **teste (§5):** `startTestRun` com `trigger: { type: 'chat', triggerItems, startNodeId }`.
6. **Resposta (FR-005):** `ResultSubscriber.wait(executionId, timeout, responseMode === 'responseNode')`.
   - **nó de resposta:** devolvida como no webhook;
   - **`lastNode`:** `chatResponseBody`;
   - **erro:** 500 com a mensagem;
   - **tempo esgotado:** 504, como no webhook.
7. **Configuração da página:** `GET <webhookId>/chat` devolve só o que a página precisa (`ChatConfig`: título, subtítulo, mensagens iniciais, texto de exemplo, tela de boas-vindas, botão, arquivos e tipos, autenticação, sessão anterior), sem nomes de nós nem dados do workflow (NFR-004).

### §5 Painel de chat do editor (FR-002)

- **`POST /api/v1/workflows/:id/chat/test`** (`workflow:execute`): recebe `{ definition, sessionId, chatInput, pinData? }` (só texto; os anexos são testados pela página hospedada), faz as etapas 2, 4 e 5 do §4 em modo teste e responde `{ executionId }` na hora. O lock é liberado quando a resposta é buscada ou expira.
- **`GET /api/v1/workflows/:id/chat/test/:executionId/reply`** (`workflow:execute`): espera o resultado (o `ResultSubscriber` guarda o resultado por 10 min) e responde `ChatTestReply { status, body, message, error? }`.
- **Painel inferior (`LogsPanel`, `apps/web/src/editor/logs-panel.tsx`, FR-016), como no N8N:**
  - barra recolhida no pé do canvas, para qualquer workflow; abre pelo clique na barra, pelo botão "Abrir chat" ou ao iniciar uma execução pelo chat;
  - **chat:** com o Chat Trigger, coluna à esquerda, com a sessão e "Nova sessão" no cabeçalho;
  - **logs:** à direita, a lista dos nós da execução do editor (`logEntries`, puro, a partir de `run.nodes`: ordem de início, status, duração, itens, reaproveitado). Escolher um nó mostra a entrada e a saída no `DataPanel` do painel do nó, o erro e, no Agent e no Basic LLM Chain, os passos (`AgentStepsPanel`). Sem execução: "Nada para mostrar ainda".
- **Coluna do chat (`ChatColumn`, `apps/web/src/editor/chat-panel.tsx`):**
  - **mensagens:** guarda a lista e o `sessionId` (`crypto.randomUUID()`); "Nova sessão" troca o `sessionId` e limpa a lista;
  - **acompanhamento:** a cada envio, liga o `executionId` ao estado da execução do editor, como o "Executar workflow" (status ao vivo dos nós e passos do agente), e busca a resposta;
  - **na mensagem:** link para a execução; o erro aparece no lugar da resposta.

### §6 Página hospedada (FR-003, NFR-001, NFR-004)

- **Rota:** `/chat/:webhookId` no frontend, fora do `RequireAuth`. O nginx já serve o SPA e encaminha `/webhook/*` para a API.
- **`ChatPage`:**
  - lê a configuração e mostra a tela de boas-vindas (se ligada), as mensagens iniciais, o campo com o texto de exemplo e os anexos (se permitidos);
  - **`sessionId`:** gera um aleatório e o guarda no `localStorage` (com `try/catch`), por `webhookId`;
  - **ao abrir:** envia `loadPreviousSession` quando configurado.
- **Autenticação na página:**
  - **"Usuário e senha":** a página pede usuário e senha num formulário e envia o cabeçalho `Authorization`, guardado só no `sessionStorage`;
  - **"Usuário do Olly Flow":** sem sessão, leva ao login e volta.
- **Mensagens:** com `react-markdown`, sem HTML bruto (padrão da biblioteca) e com links em nova aba (`rel="noopener noreferrer"`). O texto configurado aparece como digitado.
- **Indisponível:** chat despublicado (404) mostra "Este chat não está disponível".

### §7 Validação no editor (FR-006, FR-010, FR-015)

`validateWorkflow` (engine) aponta:
- mais de um Chat Trigger (erro);
- "Da memória" sem memória (erro);
- **aviso** `CHAT_BUFFER_MEMORY`: um Chat Trigger e uma `memory.buffer` no mesmo workflow ("a memória temporária não guarda a conversa entre mensagens do chat; use a memória persistente").

### §8 Importação e exportação do N8N (FR-012, FR-015)

- **Conversor `@n8n/n8n-nodes-langchain.chatTrigger` (1 a 1.3):**
  - copia os parâmetros e o `webhookId` do nó do N8N;
  - `authentication: n8nUserAuth` vira `ollyUserAuth`;
  - `responseMode: streaming` ou `responseNodes` (1.3) viram `lastNode` ou `responseNode`, com pendência;
  - `loadPreviousSession: manually` vira `notSupported`, com pendência;
  - `customCss` não é copiado, com pendência.
- **Prompt `auto`:** os conversores do AI Agent e do Basic LLM Chain já tratam `promptType: auto` como o prompt do item (`chatInput`); um teste com o Chat Trigger confirma.
- **Memória temporária:** com Chat Trigger e `memoryBufferWindow` no mesmo workflow, a importação registra a pendência do FR-015.
- **Exportação:** formato de arquivo da spec 015 (estrutura do N8N, tipo `trigger.chat`), com o `webhookId` nos parâmetros. O teste de ida e volta ganha o caso.

## Modelo de dados

- Sem tabela nova: as rotas de chat ficam em `webhooks` (método `GET` ou `POST`, caminho `<webhookId>/chat`).
- `executions.trigger_type` recebe o valor `chat` (texto, sem mudança de esquema).
- Locks das sessões no Redis (`olly:chat:*`), com expiração.

## Contratos

| Contrato | Mudança |
|---|---|
| Nó `trigger.chat` | Parâmetros do §1; item `{ sessionId, action, chatInput, files? }` |
| `POST /webhook/:webhookId/chat` | Público, com a autenticação do nó. JSON ou multipart `{ action: 'sendMessage' \| 'loadPreviousSession', sessionId, chatInput, files[] }`. Resposta: JSON do último nó ou do nó de resposta; `{ data }` em `loadPreviousSession`; 400, 401 (com `authentication`), 404, 409, 413, 429, 500, 504 |
| `GET /webhook/:webhookId/chat` | Público, com a autenticação do nó: `ChatConfig` |
| `POST /api/v1/workflows/:id/chat/test` | `workflow:execute`: `{ executionId }` |
| `GET /api/v1/workflows/:id/chat/test/:executionId/reply` | `workflow:execute`: `ChatTestReply` |
| Execução | Origem `triggerType: 'chat'` |
| Publicação | Erros `CHAT_TRIGGER_DUPLICATE`, `CHAT_NO_AUTH`, `CHAT_CREDENTIAL_INVALID`, `CHAT_WEBHOOK_ID_INVALID`; aviso `CHAT_BUFFER_MEMORY` (e `CHAT_NO_AUTH` sem a autenticação obrigatória) |

## Permissões RBAC

| Permissão | Situação no catálogo/seed | Papéis | O que esta spec faz |
|---|---|---|---|
| `workflow:execute` | Existe | admin, editor, executor | Protege as rotas de teste do chat no editor |
| `workflow:publish` | Existe | admin, editor | Ativa o chat público, pela publicação |

Nenhuma permissão nova. As rotas `/webhook/...` são públicas, com a autenticação do nó, como os webhooks. A matriz RBAC (spec 005, FR-017) ganha as duas rotas novas.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_CHAT_MAX_MESSAGE_CHARS` | `20000` | Tamanho máximo da mensagem do chat |
| `OLLY_WEBHOOK_RESPONSE_TIMEOUT` | (existente, 120 s) | Tempo limite da resposta e da espera pela vez da sessão |
| `OLLY_WEBHOOK_RATE_LIMIT_PER_MIN` | (existente, 120) | Limite por endereço de origem, também no chat |
| `OLLY_WEBHOOK_MAX_BODY` | (existente, 16 MB) | Limite dos arquivos anexados |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Rotas de chat na tabela `webhooks` e no gateway | Tabela e controller próprios | Reaproveita o registro entre instâncias, o limite de taxa, o CORS, a autenticação e a espera do resultado; mesmo caminho do N8N |
| `webhookId` como parâmetro oculto do nó | Usar o `id` do nó na URL | O `id` do nó pode ser curto e previsível; o N8N usa um `webhookId` aleatório, que a importação preserva |
| Lock por sessão no Redis com espera | Fila por sessão; recusar na hora | Atende a decisão do PO (FR-014) entre instâncias da API, sem estrutura nova; a espera respeita o tempo limite da resposta |
| Painel do editor em duas chamadas (iniciar e buscar a resposta) | Uma chamada que espera o fim | O editor recebe o `executionId` na hora e mostra o andamento ao vivo, como a execução de teste |
| `loadPreviousSession` lendo a memória, sem executar o workflow | Executar o workflow com a ação | É o comportamento do N8N; não gera execuções nem custo de modelo para recarregar a página |
| `@fastify/busboy` (MIT, o parser usado pelo `@fastify/multipart`) | `@fastify/multipart`; arquivos em base64 no JSON | Protocolo do N8N para arquivos. O gateway de webhooks já recebe o corpo cru (HMAC); o `@fastify/multipart` é um parser de conteúdo e conflitaria com isso, enquanto o busboy interpreta os bytes recebidos. O limite de tamanho é o do corpo do webhook |
| `react-markdown` (MIT), sem HTML bruto | Texto puro; HTML sanitizado | As respostas de agentes vêm em Markdown, como o N8N exibe; a biblioteca não interpreta HTML por padrão |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001 | Unidade | `packages/nodes/src/trigger/chat/chat.test.ts` (item, portas dinâmicas, execução sem itens) |
| FR-002 | Integração + E2E | `apps/api/src/chat/chat.int.test.ts` (rotas de teste); `apps/web/e2e/chat.spec.ts` (painel: conversa, nova sessão, erro) |
| FR-003, NFR-004 | Integração + E2E | `chat.int.test.ts` (publicar, configuração sem dados internos, despublicar); `chat.spec.ts` (página hospedada) |
| FR-004 | Integração | `chat.int.test.ts` (nenhuma, Basic Auth, usuário do Olly Flow, `OLLY_REQUIRE_WEBHOOK_AUTH`) |
| FR-005 | Unidade + integração | `chat/response.test.ts`; `chat.int.test.ts` (último nó, nó de resposta, tempo esgotado) |
| FR-006 | Integração | `chat.int.test.ts` (histórico da memória persistente; vazio com "Não suportado") |
| FR-007 | Unidade + integração | `chat/files.test.ts`; `chat.int.test.ts` (multipart, tipo recusado, tamanho) |
| FR-008, FR-009 | Integração | `chat.int.test.ts` (origem `chat`, limite de taxa, mensagem longa) |
| FR-010, FR-015 | Unidade | `packages/engine/src/validate.test.ts` |
| FR-011 | Integração | `chat.int.test.ts` (Agent com prompt do item e memória com `sessionId`, SC-001) |
| FR-012 | Unidade | `apps/api/src/workflow-io/n8n.test.ts`; `round-trip.test.ts`; fixture `fixtures/n8n/exemplo-chat-trigger` |
| FR-013 | Unidade | `apps/api/src/workflow-io/docs.test.ts` |
| FR-014, SC-006 | Integração | `chat.int.test.ts` (duas mensagens simultâneas em sequência; espera esgotada responde 409) |
| RBAC | Integração | Matriz RBAC (spec 005) com as rotas novas |

## Riscos

| Risco | Mitigação |
|---|---|
| Chat público sem autenticação gera custo de modelo | Limite de taxa, limite mensal de tokens do projeto (spec 011) e `OLLY_REQUIRE_WEBHOOK_AUTH`; avaliação da Segurança (pré-requisito) |
| Memória temporária importada não guarda o contexto | Aviso no editor e pendência na importação (FR-015); documentação indica a memória persistente |
| Lock da sessão preso se a API cair | Expiração do lock (tempo limite + 5 s) |
| Conteúdo malicioso nas respostas renderizadas | Markdown sem HTML bruto; links com `noopener`; sem CSS personalizado |
| `webhookId` repetido ao colar nós | O editor gera um novo `webhookId` ao colar ou duplicar; a publicação recusa caminhos repetidos |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 14/10/2026 | Criação do plano | Spec 021 esclarecida pelo PO |
| 14/10/2026 | Ajustes na implementação: `@fastify/busboy` no lugar do `@fastify/multipart` (corpo cru do gateway); arquivos de `packages/nodes` (`config.ts`, `response.ts`, `history.ts`); memória obrigatória pela validação genérica de sub-nós (sem `CHAT_MEMORY_MISSING`) e erro novo `CHAT_WEBHOOK_ID_INVALID`; 401 com o tipo de autenticação; painel do editor só com texto; exportação no formato da spec 015 (tipo `trigger.chat`); execuções do chat sem os avisos de "Execução concluída" no editor | Encontrados ao implementar; nenhum requisito mudou, exceto a forma da exportação (registrada na spec) |
| 14/10/2026 | Painel inferior com o chat e os logs (FR-016), no lugar do painel de chat flutuante | Pedido do PO (spec, histórico) |
