# Plano técnico — Spec 005: Webhook, código JavaScript e fechamento do MVP

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Execução:** publicação com rotas de webhook em cache e `ExecutionDispatcher` em processo (trocado por fila na spec 006).
- **Código JS:** nó `code.javascript` no task-runner com um isolate novo por execução de nó.
- **Consulta e evidências:** tela de execuções, auditoria completa, matriz RBAC gerada por teste e fixtures da POC recriadas.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — N8N | API do Code node; modos de resposta do Webhook; formato do Respond to Webhook |
| III — Segurança | HMAC em tempo constante; headers sensíveis removidos; sandbox JS; rate limit; `execution:readData` |
| IV — Testes | Matriz RBAC como fonte da documentação; fixtures POC |
| VII — Rastreabilidade | Auditoria completa |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `apps/api` | Módulos `publishing`, `webhooks` (gateway), `executions` (listagem), `dispatcher` |
| `apps/task-runner` | Mensagem `runCode` |
| `packages/nodes` | `trigger.webhook`, `http.respondToWebhook`, `code.javascript`; credenciais `webhookHeaderAuth`, `webhookBasicAuth`, `webhookHmac` |
| `apps/web` | Publicar, escutar webhook de teste, editor de código, tela de execuções |
| `fixtures/olly/` | Workflows da POC recriados |

## Design

### §1 Publicação
- **`POST /workflows/:id/publish { version }`** (`workflow:publish`):
  1. valida a estrutura;
  2. define `published_version` e `active = true`;
  3. sincroniza `webhooks` (path, método, workflow, nó);
  4. invalida o cache de rotas.
- **`POST /workflows/:id/unpublish`:** remove as rotas.
- Webhook de produção sem autenticação: aviso, que vira erro com `OLLY_REQUIRE_WEBHOOK_AUTH=true`.
- **UI:** botão "Publicar", badge "versão publicada vN / rascunho vM" e alternador ativo/inativo.

### §2 `ExecutionDispatcher`
- **Interface:** `dispatch({ workflowId, version, mode, trigger, items, userId }) → { executionId }` e `waitForResult(executionId, timeoutMs)`.
- **`InProcessDispatcher`:** semáforo com `OLLY_MAX_CONCURRENT_EXECUTIONS` (10). O excedente fica `queued` em uma fila em memória. Os resultados são publicados em um `EventEmitter`.

### §3 Gateway de webhooks
- Rotas Fastify `ALL /webhook/*` e `ALL /webhook-test/*`, fora do prefixo `/api/v1`, marcadas como `@Public` com autenticação própria.
- **Resolução:** cache `Map<method:path-pattern>` com *matcher* de parâmetros (`path-to-regexp`), recarregado na publicação.
- **Pipeline:**
  1. limite de corpo (`bodyLimit = OLLY_WEBHOOK_MAX_BODY`);
  2. `@fastify/rate-limit` por rota;
  3. CORS e allowlist de IP;
  4. autenticação por credencial (HMAC com `crypto.timingSafeEqual` sobre o *raw body*);
  5. montagem do item `{ headers (sem authorization/cookie/x-signature), params, query, body }`;
  6. `dispatch`.
- **Modos:**
  - `onReceived`: 202 `{ executionId }`;
  - `lastNode`/`responseNode`: `waitForResult` com `OLLY_WEBHOOK_RESPONSE_TIMEOUT` (120 s); ao estourar, 504 `{ executionId }`.
- **Teste:**
  - `POST /api/v1/workflows/:id/listen-test-webhook` registra a escuta por 2 min (registro em memória);
  - o payload recebido é emitido como `testWebhookReceived` ao editor;
  - em seguida, inicia a execução de teste.

### §4 `http.respondToWebhook`
- **Parâmetros:** `respondWith` (`firstItemJson` | `allItemsJson` | `text` | `noData` | `binary`), `responseCode` (200), `responseHeaders[]` e `responseBody`.
- Grava a resposta no contexto da execução (`ctx.webhookResponse`) apenas se ainda não houver uma. Repetições geram aviso no log.
- A publicação falha se `responseMode = responseNode` e o nó não existir.

### §5 Nó `code.javascript`
- **Parâmetros:** `mode` (`runOnceForAllItems` | `runOnceForEachItem`) e `jsCode`. Código padrão igual ao do N8N.
- **Mensagem `runCode { code, mode, items, context }`:**
  - isolate novo (`memoryLimit` 128) por execução de nó;
  - o código é envolvido em `async function` e executado com `timeout` (`OLLY_CODE_TIMEOUT_MS` = 30 000);
  - **globais:** `$input`, `$json` (por item), `$('Nó')`, `$vars`, `$env`, `$execution`, `$workflow`, `$now`, `$today`, `DateTime`, `_` (bundle do lodash) e `console` (*proxy* que acumula até 500 linhas).
- **Normalização** (`normalizeItems`):
  - objeto → `[{ json: obj }]`;
  - array de objetos sem `json` → envolve cada um;
  - array de `{ json }` → mantém;
  - qualquer outro tipo → erro `"O código deve retornar um objeto ou array de objetos"`.
- **OOM ou queda do runner:** erro `SandboxCrashedError` e reinício supervisionado do runner.

### §6 Editor de código
- Monaco (JavaScript) com `addExtraLib` de um `.d.ts` gerado com as variáveis e `$('…')` tipado para os nomes de nós do workflow.
- Aba "Console" na saída.

### §7 Execuções
- **`GET /executions`** (`execution:read`): filtros `projectId`, `workflowId`, `status`, `mode`, `trigger`, `userId`, `from`, `to`; paginação por cursor (`started_at`, `id`).
- **`GET /executions/:id`:** metadados + nós. Sem `execution:readData`, omite `input_data`/`output_data` e retorna `dataRedacted: true`.
- **UI `/executions`:** tabela com filtros. O detalhe abre o canvas somente leitura com o painel da spec 003 alimentado pelos dados da execução. Botão "Copiar para o editor" copia os dados como pin data.

### §8 Auditoria e matriz RBAC
- Verificar a cobertura de `AuditService` em todas as ações de FR-016. Execução manual registra `execution.manual`.
- **`rbac-matrix.test.ts`:**
  - tabela declarativa `{ role, action, expected }`, executada contra a API real (Testcontainers);
  - ao final, escreve `docs/rbac-matriz.md` (o teste falha se o arquivo commitado divergir: *snapshot*).

### §9 Fixtures POC
- `fixtures/olly/<caso>.json`, recriado manualmente a partir de `fixtures/n8n/<caso>/workflow.json`.
- **`fixtures.int.test.ts`:** executa cada caso com `input.json` e compara a saída por nó com `expected.json`.
- Casos não recriáveis são listados no relatório.

### §10 Decisões de implementação (04/10/2026)
- **Dados (migration `0006_publish_console`):** `workflows.published_version` e `workflows.active`; `executions.definition` (definição executada: execuções de teste rodam o rascunho não salvo, e a tela de execuções mostra o que de fato rodou); `node_executions.console` (saída do `console` do nó de código).
- **Contrato de nó (constituição IX.3):** `NodeContext.runCode({ code, mode })` executa código de usuário no task runner com os dados do nó (o motor monta o contexto, como nas expressões, e guarda a saída do console no registro do nó); `NodeContext.respondToWebhook(resposta)` grava a resposta do webhook, e só a primeira vale (devolve `false` nas seguintes).
- **Código JS:** `CodeRunner.runCode` no `@olly/expressions` (isolate novo por execução de nó, 128 MB, `OLLY_CODE_TIMEOUT_MS`), mensagem `runCode` no task runner. Os dados **não** são congelados (no N8N é comum alterar `item.json` e devolver `$input.all()`). `_` vem do bundle UMD do `lodash`. Nomes de nós citados no código são achados por `findCodeReferences` (mesma análise estática das expressões).
- **Despacho:** `ExecutionDispatcher` recebe um trabalho serializável (`ExecutionJob`: execução, definição, modo, gatilho, itens do gatilho, pin data, destino, reaproveitamento), para que a fila da spec 006 o leve a um worker. `InProcessDispatcher` limita a concorrência e marca o excedente como `queued`. Execuções de teste e de produção passam pelo mesmo despacho.
- **Gateway de webhooks:** rotas Fastify `/webhook/*` e `/webhook-test/*` registradas num escopo próprio, que recebe o corpo cru (HMAC sobre os bytes recebidos) e fica fora dos guards da API. A resolução usa um casamento simples por segmentos (`:param`), com rota estática antes de rota com parâmetro, sem dependência nova. O rate limit é uma janela fixa em memória por rota (`OLLY_WEBHOOK_RATE_LIMIT_PER_MIN`, padrão 120), também sem dependência nova; com a fila da spec 006, passa a ser distribuído.
- **Modo `lastNode`:** responde com o JSON do primeiro item do último nó que terminou com dados (padrão `firstEntryJson` do N8N). **Modo `responseNode`:** responde assim que o nó de resposta executa (não espera o fim do workflow); se o workflow terminar sem resposta, 500 com o id da execução.
- **Webhook de teste:** `POST /api/v1/workflows/:id/listen-test-webhook { definition }` (`workflow:execute`) escuta por 2 min a definição do editor (que pode não estar salva). A primeira chamada consome a escuta, emite `testWebhookReceived` e inicia uma execução de teste pelo nó de webhook. Com `destinationNodeId` igual ao nó de webhook (escuta iniciada no painel do nó, como o "Listen for test event" do N8N), a execução para no Webhook e a chamada recebe 202 com o id da execução, qualquer que seja o modo de resposta; o editor registra o nó com a assinatura da definição escutada, para que o ▶ dos nós seguintes reaproveite o payload (FR-020 da spec 003).
- **`execution:readData` também no tempo real:** quem não tem a permissão entra numa sala que recebe os eventos sem dados (`dataRedacted: true`). O preview de expressão ignora a execução indicada para quem não tem a permissão.
- **"Copiar para o editor" (FR-015):** fixa, no rascunho, a saída do nó inicial da execução (o gatilho, com os dados que vieram de fora), como o "Debug in editor" do N8N. Os demais nós executam de novo. Exige `workflow:update` e `execution:readData`.
- **Matriz RBAC:** `rbac-matrix.int.test.ts` roda contra a API real e escreve `docs/rbac-matriz.md` quando o arquivo não existe ou com `OLLY_UPDATE_RBAC_MATRIX=1`; senão, falha se o conteúdo divergir.
- **Editor de código:** Monaco empacotado localmente (sem CDN), carregado sob demanda só para o nó de código, com os workers do Vite. A extensão `x-code-editor: "javascript"` de `paramsSchema` indica o campo.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_MAX_CONCURRENT_EXECUTIONS` | 10 | Concorrência do dispatcher em processo |
| `OLLY_WEBHOOK_MAX_BODY` | 16 MB | Limite de payload |
| `OLLY_WEBHOOK_RESPONSE_TIMEOUT` | 120 s | Resposta síncrona |
| `OLLY_REQUIRE_WEBHOOK_AUTH` | false | Bloqueia publicação de webhook sem autenticação |
| `OLLY_CODE_TIMEOUT_MS` | 30000 | Timeout do código JS |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Isolate novo por execução de nó (código) | Reaproveitar o das expressões | Código pode poluir o estado global; isolamento entre nós |
| Matriz RBAC gerada pelo teste | Documento manual | Fonte única, sem divergência |

## Permissões RBAC

Regra geral (decisão de 03/10/2026): cada spec é responsável pelas permissões que introduz: aplicá-las nas rotas (`@RequirePermission`), garantir que constem do catálogo (`packages/shared-types/src/rbac.ts`), do seed de papéis e de `docs/arquitetura/contratos.md`, e testar o acesso negado por papel.

| Permissão | Situação no catálogo/seed | Papéis com a permissão | O que esta spec faz |
|---|---|---|---|
| `workflow:publish` | Já presente desde a spec 001 | admin, editor | Exigir em publicar e despublicar |
| `execution:readData` | Já presente desde a spec 001 | admin, editor | Omitir dados de execução de quem não a tem (`dataRedacted: true`) |

O teste da matriz papel × ação (FR-017) gera `docs/rbac-matriz.md` a partir do catálogo e do seed reais. Nenhuma permissão nova é criada nesta spec.

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001, FR-002 | Integração | `publishing.int.test.ts` (SC-007) |
| FR-003 | Unidade | `in-process-dispatcher.test.ts` |
| FR-004, FR-005, FR-006 | Integração | `webhook.int.test.ts` (SC-002, SC-003) |
| FR-007 | E2E | `webhook-test.spec.ts` |
| FR-008 | Integração | `respond-to-webhook.int.test.ts` |
| FR-009, FR-010, FR-011 | Integração | `code-js.int.test.ts`, `code-js-security.int.test.ts` (SC-006) |
| FR-013, FR-014, FR-015 | Integração + E2E | `executions.int.test.ts`, `executions.spec.ts` |
| FR-016 | Integração | `audit-coverage.int.test.ts` |
| FR-017 | Integração | `rbac-matrix.test.ts` (SC-004) |
| FR-018 | Integração | `fixtures.int.test.ts` (SC-001) |

## Riscos

| Risco | Mitigação |
|---|---|
| Fixtures da POC indisponíveis | Exemplo sintético + pendência no relatório |
| Execução em processo degradar a API | Limite de concorrência; fila na spec 006 |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Seção "Permissões RBAC" e tarefa T089 | Decisão humana: cada spec acrescenta e garante as permissões que cria |
| 04/10/2026 | Decisões de implementação (§10) | Lacunas do plano encontradas ao implementar |
| 05/10/2026 | Escuta de teste pelo nó executa só o Webhook (`destinationNodeId` na escuta) | Teste de UX (FR-007, HU-2.1) |
