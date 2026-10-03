# Sprint 4 — Webhook, código JavaScript e fechamento do MVP

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também os relatórios em `docs/relatorios/` e as seções 6.1, 6.7 e 8 de `docs/analise_implementacao.md`.

## Pré-requisitos

- Sprint 3 concluída e todos os comandos da seção 8 passando.

## Contexto

Esta é a última sprint do MVP. Os workflows precisam ser acionados por sistemas externos (webhook), aceitar lógica customizada em JavaScript e ter as execuções consultáveis. No MVP, as execuções de produção rodam no **processo da API**. A fila com workers chega na Sprint 5, então mantenha a execução atrás de uma interface `ExecutionDispatcher` para trocar a implementação depois sem mexer nos chamadores.

## Objetivo

Webhook de entrada completo, publicação de workflows, nó `code.javascript` em sandbox, tela de execuções e o MVP validado com os workflows da POC.

## Tarefas

### T1 — Publicação de workflows
- `POST /workflows/:id/publish` (`workflow:publish`), com `version` no corpo: define `published_version` e `active = true`, e registra rotas de webhook e (no futuro) agendamentos.
- `POST /workflows/:id/unpublish` remove as rotas.
- Execuções de produção usam **sempre** a versão publicada, nunca o rascunho.
- Validação estrutural obrigatória antes de publicar. Gatilho de produção sem autenticação gera aviso, e `OLLY_REQUIRE_WEBHOOK_AUTH=true` transforma o aviso em erro.
- Na UI: botão "Publicar", indicador de versão publicada vs. rascunho e alternador ativo/inativo.

### T2 — `ExecutionDispatcher`
- Interface `dispatch(request): Promise<{ executionId }>` e `waitForResult(executionId, timeoutMs)`.
- Implementação `InProcessDispatcher`: executa no processo da API com limite de execuções concorrentes (`OLLY_MAX_CONCURRENT_EXECUTIONS`, padrão 10). Execuções acima do limite ficam em fila em memória com status `queued`.

### T3 — Nó `trigger.webhook` e gateway
- **Parâmetros do nó:**
  - `path` (único por método; aceita parâmetros como `pedidos/:id`) e `httpMethod`;
  - `authentication`: `none` | `headerAuth` | `basicAuth` | `hmac` (credenciais novas `webhookHeaderAuth`, `webhookBasicAuth` e `webhookHmac` com `secret`, `algorithm` e `signatureHeader`);
  - `responseMode`: `onReceived` (202 + `executionId`) | `lastNode` (retorna a saída do último nó executado) | `responseNode` (usa `http.respondToWebhook`);
  - `options`: `rawBody`, `allowedOrigins` (CORS) e `ipAllowlist`.
- **Rotas:**
  - `ALL /webhook/*`: produção, resolvida pela tabela `webhooks` com cache em memória invalidado na publicação;
  - `ALL /webhook-test/*`: ativa somente enquanto o editor está em "escutar evento de teste" (TTL de 2 minutos), e os dados chegam ao editor via WebSocket.
- **Saída do nó:** `{ headers, params, query, body }` (headers sensíveis como `authorization` e `cookie` são removidos da saída e do log).
- **Proteções:**
  - limite de payload (`OLLY_WEBHOOK_MAX_BODY`, padrão 16 MB);
  - rate limit por rota (`@fastify/rate-limit`, configurável);
  - HMAC com comparação em tempo constante.
- `lastNode`/`responseNode` aguardam até `OLLY_WEBHOOK_RESPONSE_TIMEOUT` (padrão 120 s). Depois disso, a resposta é 504 com o `executionId`, e a execução continua.

### T4 — Nó `http.respondToWebhook`
- Parâmetros: `respondWith` (`firstItemJson` | `allItemsJson` | `text` | `noData` | `binary`), `responseCode`, `responseHeaders[]` e `responseBody` (expressão quando `text`).
- Erro de validação na publicação se o workflow usa `responseMode: responseNode` sem este nó.
- Se executado mais de uma vez na mesma execução, apenas a primeira resposta vale; registre um aviso no log.

### T5 — Nó `code.javascript`
- **Parâmetros:**
  - `mode`: `runOnceForAllItems` | `runOnceForEachItem`;
  - `jsCode`.
  - Código padrão igual ao do N8N: `return $input.all();` / `return $input.item;`.
- **Execução no `apps/task-runner`** (nova mensagem `runCode`), em um isolate **novo por execução de nó**:
  - limites: 128 MB de memória e `OLLY_CODE_TIMEOUT_MS` de tempo (padrão 30 000);
  - API no isolate: `$input`, `$json`, `$('Nó')`, `$vars`, `$env` (filtrado), `$execution`, `$workflow`, `$now`, `$today`, `DateTime`, `console.log` (capturado e exibido no painel do nó, limitado a 500 linhas) e `_` (lodash, carregado no isolate);
  - código `async`/`await` permitido.
- **Validação do retorno:**
  - aceite um objeto, um array de objetos ou um array de `{ json }`. Normalize para `Item[]`, como o N8N;
  - qualquer outro tipo gera erro descritivo.
- **Sem acesso** a `require`, `import`, `fetch`, `process`, timers do host ou sistema de arquivos. `fetch` liberado fica para avaliação futura; registre como pendência.
- Se o task runner morrer (OOM), a execução do nó falha com mensagem clara e o runner é reiniciado.

### T6 — Editor de código
- Monaco no painel do nó com tema, autocomplete das variáveis (`$input`, `$json`, `$('...')` com os nomes dos nós do workflow, `$vars`, `DateTime`) e tipos (`.d.ts` gerado das variáveis).
- Saída do `console.log` em uma aba "Console" do painel de saída.

### T7 — Tela de execuções
- `GET /api/v1/executions` (`execution:read`), paginada por cursor, com filtros: projeto, workflow, status, modo (test/production), gatilho, usuário e período.
- `GET /api/v1/executions/:id`: metadados mais os nós. Os dados (`input_data`/`output_data`) só são retornados com `execution:readData`; sem essa permissão, eles são omitidos e a resposta traz `dataRedacted: true`.
- **UI `/executions`:** tabela com filtros, status e duração. Clicar em uma execução abre o **canvas em modo somente leitura**, com os dados daquela execução em cada nó (mesmo painel da Sprint 2).
- Botão "Copiar para o editor" na execução: copia os dados como pin data no rascunho.

### T8 — Auditoria
- Garanta que `audit_log` registra:
  - criar, editar, excluir, publicar e despublicar workflow;
  - criar, alterar, excluir e testar credencial;
  - alterações de membros e papéis;
  - execução manual (quem executou).
- Teste que percorre essas ações e verifica cada registro.

### T9 — Testes de RBAC ponta a ponta
- Matriz automatizada: para cada papel (`admin`, `editor`, `executor`, `viewer`) e cada ação (criar, ler, editar, excluir, publicar, executar workflow; ver execução; ver dados da execução; gerenciar credencial; usar credencial), verifique o resultado esperado conforme a seção 7.2 da análise.
- Gere a matriz como tabela em `docs/rbac-matriz.md` a partir do próprio teste (fonte única).

### T10 — Validação do MVP com a POC
- Para cada workflow em `fixtures/n8n/` que use apenas nós já implementados, recrie-o manualmente no formato Olly Flow em `fixtures/olly/<caso>.json`. O importador automático é da Sprint 11.
- Escreva um teste que os execute com `input.json` e compare com `expected.json`.
- Liste no relatório os casos que **não** puderam ser recriados e o motivo.

## Fora do escopo

Fila/workers, paralelismo, Merge, While, Python, cron, OAuth2 Authorization Code e `fetch` no nó de código.

## Critérios de aceite (MVP)

| # | Critério | Verificação |
|---|---|---|
| 1 | Pelo menos 2 workflows da POC recriados com resultado equivalente | `fixtures.test.ts` |
| 2 | `curl -X POST /webhook/<path>` com HMAC válido dispara o workflow publicado; com HMAC inválido retorna 401 | Integração |
| 3 | Os três `responseMode` funcionam; `responseNode` retorna status, headers e body configurados | Integração |
| 4 | Webhook de teste entrega o payload ao editor via WebSocket | E2E |
| 5 | Matriz de RBAC 100% verde e `docs/rbac-matriz.md` gerado | `rbac-matrix.test.ts` |
| 6 | `executor` executa mas não edita; `viewer` não executa nem vê dados da execução | Matriz RBAC |
| 7 | 100% das execuções (teste e produção) registradas com status e duração por nó | Integração |
| 8 | Código JS com loop infinito, alocação de 1 GB ou `require('child_process')` é interrompido/bloqueado sem afetar a API | Integração de segurança |
| 9 | Retornos `{a:1}`, `[{a:1}]` e `[{json:{a:1}}]` do nó de código produzem os mesmos itens | Unitário |
| 10 | Execução de produção usa a versão publicada mesmo com rascunho alterado | Integração |

## Entrega

Código, `docs/nos/trigger.webhook.md`, `docs/nos/http.respondToWebhook.md`, `docs/nos/code.javascript.md`, `docs/rbac-matriz.md` e o relatório `docs/relatorios/sprint-04.md`.

O relatório desta sprint deve incluir também a seção **"Insumos para o Go/No-Go"**:
- tarefas planejadas vs. entregues nas Sprints 0–4;
- principais dificuldades técnicas;
- riscos para as Sprints 5–12;
- estimativa de quais sprints futuras correm risco de não caber em 2 semanas.

> ⚠️ **Marco humano:** após esta sprint, a gestão realiza a reunião de Go/No-Go (comparação de TCO com o N8N Enterprise). Não inicie a Sprint 5 sem a confirmação registrada em `docs/decisoes.md`.
