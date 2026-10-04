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
