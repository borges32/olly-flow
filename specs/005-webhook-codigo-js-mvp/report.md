# Relatório — Spec 005: Webhook, código JavaScript e fechamento do MVP

**Status:** Verificada, com pendências (SC-001 depende das fixtures reais da POC; nenhum comando falhando)
**Data:** 04/10/2026

## Resumo

- **Publicação de workflows:**
  - publica uma versão e despublica; a produção usa sempre a versão publicada;
  - valida estrutura e webhooks; sem autenticação, só aviso, salvo com `OLLY_REQUIRE_WEBHOOK_AUTH=true`.
- **Webhooks:**
  - gateway `/webhook/*` e `/webhook-test/*` com autenticação por credencial (header, Basic, HMAC em tempo constante sobre o corpo cru);
  - limites: payload, rate limit por rota, CORS e allowlist de IP;
  - três modos de resposta, com 504 no timeout;
  - nó **Responder ao webhook** (vale a primeira resposta);
  - escuta de teste pelo editor, com o payload chegando em tempo real.
- **Despacho:** execuções despachadas por um `ExecutionDispatcher` substituível (em processo, com limite de concorrência e fila `queued`), pronto para a fila da spec 006.
- **Código JavaScript:**
  - nó `code.javascript` com a API do N8N;
  - isolate novo por execução de nó no task runner, com limites de tempo e memória e `console` capturado;
  - o runner reinicia se o processo cair;
  - editor Monaco local, com autocomplete das variáveis e dos nós.
- **Execuções:**
  - tela com filtros e paginação, e abertura no canvas somente leitura;
  - dados omitidos sem `execution:readData` (também em tempo real);
  - "Copiar para o editor".
- **Evidências:** auditoria completa, matriz RBAC gerada por teste (`docs/rbac-matriz.md`) e fixtures executadas pela API (sintéticas, enquanto a POC não é exportada).

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `apps/api/src/executions/dispatcher.ts` (`ExecutionDispatcher`, `InProcessDispatcher`) + `execution-runner.ts` |
| T002 | ✅ | `apps/api/src/webhooks/publishing.service.ts`; migration `0006_publish_console` |
| T010 | ✅ | `webhookHeaderAuth`, `webhookBasicAuth`, `webhookHmac` |
| T011 | ✅ | `apps/api/src/webhooks/webhook-gateway.ts` |
| T012 | ✅ | |
| T013 | ✅ | `packages/nodes/src/http/respond-to-webhook/` + validação na publicação |
| T014 | ✅ | `TestListeners` + evento `testWebhookReceived` |
| T015 | ✅ | `PublishControls`, `WebhookPanel` |
| T016 | ✅ | `webhook.int.test.ts` |
| T020 | ✅ | `packages/expressions/src/code.ts` (`CodeSandbox`) + mensagem `runCode` |
| T021 | ✅ | `packages/nodes/src/code/javascript/` |
| T022 | ✅ | `apps/web/src/editor/code-editor.tsx` (Monaco local, carregado sob demanda) + seção Console |
| T023 | ✅ | `code.test.ts` (expressions), `code-js.int.test.ts` (API), `client.test.ts` (runner) |
| T030 | ✅ | `GET /executions`, `GET /executions/:id` com `dataRedacted` |
| T031 | ✅ | `/executions`, `/executions/:id` |
| T032 | ✅ | |
| T040 | ✅ | Faltavam `workflow.publish/unpublish` e `execution.manual`; `audit-coverage.int.test.ts` |
| T041 | ✅ | `apps/api/src/rbac/rbac-matrix.int.test.ts` → `docs/rbac-matriz.md` |
| T042 | ⚠️ | Só fixtures **sintéticas** (`exemplo-set-if`, `exemplo-webhook-code`); os workflows da POC não foram exportados (pré-requisito humano). `fixtures.int.test.ts` roda cada caso pela API |
| T089 | ✅ | `workflow:publish` e `execution:readData` já no catálogo e no seed (admin, editor); exigidas e cobertas na matriz |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ✅ | Ver "Requisitos" e "Critérios de sucesso" |
| T092 | ✅ | `docs/nos/trigger.webhook.md`, `http.respondToWebhook.md` e `code.javascript.md`. Também atualizados: `docs/nos/README.md`, `contratos.md`, `modelo-dados.md`, `credenciais.md`, `README.md` e `.env.example` |
| T093 | ✅ | Este relatório |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `apps/api/src/webhooks/webhook.int.test.ts` › "SC-007/FR-001…" (publicar, republicar outra versão, despublicar) e "FR-001: workflow excluído deixa de responder"; `apps/web/e2e/webhook-code.spec.ts` |
| FR-002 | Sim | `webhook.int.test.ts` › "FR-002: validações da publicação e permissão workflow:publish" e "FR-002: com OLLY_REQUIRE_WEBHOOK_AUTH…" |
| FR-003 | Sim | `apps/api/src/executions/in-process-dispatcher.test.ts` (concorrência, fila, `queued` → `running`, espera por fim/resposta/timeout) |
| FR-004 | Sim | `packages/nodes/src/trigger/webhook/webhook.test.ts` (HMAC, header, Basic); `webhook.int.test.ts` › "SC-002…" e "SC-003/FR-005: modo imediato…" (item sem cabeçalhos sensíveis, `params`, `query`, `body`) |
| FR-005 | Sim | `webhook.int.test.ts` (último nó, imediato, nó de resposta, sem resposta, 504) |
| FR-006 | Sim | `webhook.int.test.ts` › "FR-006: CORS…" e "FR-006/NFR-001: payload… rate limit" |
| FR-007 | Sim | `webhook.int.test.ts` › "HU-2/FR-007"; `executions.int.test.ts` (evento em tempo real); `webhook-code.spec.ts` |
| FR-008 | Sim | `packages/nodes/src/http/respond-to-webhook/respond.test.ts`; `packages/engine/src/code-node.test.ts` › "FR-008"; `webhook.int.test.ts` › "SC-003/FR-008" |
| FR-009 | Sim | `packages/expressions/src/code.test.ts`; `apps/task-runner/src/client.test.ts`; `packages/nodes/src/code/javascript/code.test.ts`; `packages/engine/src/code-node.test.ts`; `code-js.int.test.ts`; `webhook-code.spec.ts` |
| FR-010 | Sim | `code.test.ts` › "FR-010/SC-006…" (`require`, `process`, `fetch`, `constructor`, `import()`, timers, isolate próprio); `code-js.int.test.ts` |
| FR-011 | Sim | `code/javascript/code.test.ts` (normalização e erros descritivos); `code-js.int.test.ts` |
| FR-012 | Sim | `apps/web/src/editor/code-declarations.test.ts`; `store.test.ts` › "FR-012…"; `webhook-code.spec.ts` › "FR-009/FR-012" (autocomplete com os nós e Console) |
| FR-013 | Sim | `apps/api/src/executions/executions.int.test.ts` › "FR-013…" (filtros, cursor, projetos permitidos); `webhook-code.spec.ts` (lista e canvas somente leitura) |
| FR-014 | Sim | `executions.int.test.ts` › "FR-014…" (detalhe, preview e tempo real); `webhook-code.spec.ts` › "FR-014" |
| FR-015 | Sim | `webhook-code.spec.ts` (copiar para o editor fixa a saída do gatilho) |
| FR-016 | Sim | `apps/api/src/audit/audit-coverage.int.test.ts` |
| FR-017 | Sim | `apps/api/src/rbac/rbac-matrix.int.test.ts` (gera e confere `docs/rbac-matriz.md`) |
| FR-018 | Parcial | `apps/api/src/fixtures.int.test.ts` e `packages/engine/src/fixtures.test.ts` executam os casos existentes, que são **sintéticos** |
| NFR-001 | Sim | `config.test.ts` (16 MB, 120 s); `webhook.int.test.ts` (413, 504) |
| NFR-002 | Sim | `config.test.ts` (128 MB, 30 s); `code.test.ts` (memória e tempo) |
| NFR-003 | Sim | `webhook.test.ts` › "NFR-003" (comparação de digests SHA-256 com `timingSafeEqual`) |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ⚠️ Pendente | Requer ≥ 2 workflows **reais** da POC. Há 2 casos sintéticos executados pela API (`fixtures.int.test.ts`); o pré-requisito humano (exportar a POC para `fixtures/n8n/`) segue aberto |
| SC-002 | ✅ | `webhook.int.test.ts` › "SC-002…": assinatura válida executa; inválida, ausente ou com corpo alterado → 401 |
| SC-003 | ✅ | `webhook.int.test.ts`: `onReceived` (202), `lastNode` (200 com o JSON), `responseNode` (201 + cabeçalho + texto) |
| SC-004 | ✅ | `rbac-matrix.int.test.ts`: 11 ações × 5 perfis, 100 % iguais ao seed; `docs/rbac-matriz.md` gerado |
| SC-005 | ✅ | Toda execução (teste e produção) passa pelo `ExecutionRunner`, que grava status e duração por nó; `executions.int.test.ts` (`durationMs` em todas) e `webhook.int.test.ts` (produção registrada) |
| SC-006 | ✅ | `code-js.int.test.ts`: laço infinito, alocação excessiva, `require` e `process` falham com mensagem clara e `/health` segue respondendo; `client.test.ts`: o processo do runner morto durante o código → nó falha e o runner reinicia |
| SC-007 | ✅ | `webhook.int.test.ts` › "SC-007/FR-001" |

## Comandos de verificação

Executados em 04/10/2026.

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 444 testes (expressions 123, nodes 118, web 54, engine 51, api 22, shared-types 12, task-runner 8, db 5, repositório 51) |
| `pnpm test:integration` | ✅ 176 testes (api 131, nodes 23, db 19, engine 3) |
| `pnpm build` | ✅ (o chunk do Monaco é separado e só carrega no nó de código) |
| `pnpm test:e2e` | ✅ 25 testes (3 novos da spec 005) |
| `docker compose up -d && pnpm smoke` | ✅ |
| `pnpm audit --audit-level=high` | ✅ 0 altas; 1 moderada (`uuid`, via Testcontainers, só testes; já registrada) |
| `pnpm app:up` | ✅ imagens com o código da spec; migration 0006 aplicada; `/webhook` pelo nginx |

## Decisões tomadas

Registradas no plano (§10, "Histórico de alterações" de 04/10/2026):

- **Dados (migration 0006):**
  - `workflows.published_version` e `workflows.active` (publicação);
  - `executions.definition` (o que de fato rodou, inclusive rascunhos não salvos), usado pela tela de execuções;
  - `node_executions.console`.
- **Contrato de nó:** `NodeContext.runCode` e `NodeContext.respondToWebhook`, registrados em `contratos.md` (constituição IX.3).
- **Código JS:**
  - os dados entregues ao código **não** são congelados, ao contrário das expressões: no N8N é comum alterar os itens e devolvê-los;
  - `_` usa o bundle UMD do `lodash`.
- **Despacho:**
  - `ExecutionJob` serializável e o mesmo despacho para teste e produção;
  - o excedente da concorrência fica `queued` em memória (a fila durável é da spec 006).
- **Gateway:**
  - rotas Fastify num escopo próprio, com corpo cru (HMAC sobre os bytes) e fora dos guards da API;
  - casamento de caminho por segmentos (estática antes de `:param`);
  - rate limit em memória, por rota, em janela fixa.

  Nenhum dos dois usa dependência nova (constituição IX.2). O plano citava `path-to-regexp` e `@fastify/rate-limit`; as soluções próprias são poucas linhas e o rate limit passa a ser distribuído na spec 006.
- **Modos de resposta:**
  - `lastNode` responde com o JSON do 1º item do último nó com dados (padrão do N8N);
  - `responseNode` responde assim que o nó executa;
  - se o workflow terminar sem resposta, 500 com o id da execução.
- **`execution:readData` também no tempo real e no preview:**
  - sala `…:data` para quem pode ver dados; os demais recebem `nodeFinished` sem dados (`dataRedacted`);
  - o preview de expressões ignora a execução para quem não tem a permissão;
  - a regra fecha um caminho de leitura de dados que a spec não citava explicitamente.
- **"Copiar para o editor":** fixa a saída do **gatilho** da execução no rascunho, como o "Debug in editor" do N8N. Os demais nós executam de novo.
- **Matriz RBAC:** gerada pelo teste contra a API real; o teste falha se `docs/rbac-matriz.md` divergir (`OLLY_UPDATE_RBAC_MATRIX=1` regenera).
- **Editor de código:**
  - Monaco empacotado localmente (sem CDN), carregado sob demanda;
  - EditContext desligado, porque com ele o atalho de espaço do canvas engolia os espaços digitados;
  - Esc dentro do editor fecha as sugestões, não o painel do nó;
  - o autocomplete dos nomes em `$('…')` abre com Ctrl+Espaço.
- **`OLLY_TRUST_PROXY`** (padrão `false`; `true` no compose, atrás do nginx): necessário para a allowlist de IP do webhook ver o IP real do cliente.
- **Limites de configuração:** `OLLY_WEBHOOK_MAX_BODY` em MB e `OLLY_WEBHOOK_RESPONSE_TIMEOUT` em segundos (os nomes do plano não diziam a unidade).

## Desvios da spec/plano

- **Spec:** sem mudança de comportamento. O ponto em aberto (`OLLY_REQUIRE_WEBHOOK_AUTH` no MVP) seguiu o padrão indicado na própria spec (só aviso), e a opção de bloquear está implementada e testada.
- **Plano:** recebeu a seção §10 antes do código.
- **FR-018/SC-001 parcial:** sem os workflows da POC, os casos são sintéticos (risco previsto no plano).
- **Testes de nome diferente do plano:**
  - `respond-to-webhook.int.test.ts` → o nó de resposta é coberto em `webhook.int.test.ts` + `respond.test.ts`;
  - `code-js-security.int.test.ts` → incluído em `code-js.int.test.ts`;
  - `executions.spec.ts` e `webhook-test.spec.ts` → `webhook-code.spec.ts`;
  - `rbac-matrix.test.ts` → `rbac-matrix.int.test.ts` (roda com Testcontainers).

## Dependências adicionadas

| Pacote | Versão | Motivo | Licença |
|---|---|---|---|
| `monaco-editor` | 0.57.0 | Editor de código (stack: `@monaco-editor/react`), empacotado localmente | MIT |
| `@monaco-editor/react` | 4.7.0 | Integração React do Monaco (na stack) | MIT |
| `lodash` (em `@olly/expressions`) | 4.18.1 | Bundle UMD para `_` dentro do isolate (API do Code node do N8N); `lodash-es` já era usado | MIT |
| override `dompurify` ≥ 3.4.16 | 3.4.16 | O Monaco fixa 3.4.15 (vulnerabilidade baixa, IN_PLACE + hook); correção de patch, no padrão de `overrides` já usado | MPL-2.0 OR Apache-2.0 |

## Pendências, bloqueios e riscos

- **Pré-requisito humano:** exportar os workflows reais da POC para `fixtures/n8n/` (com `input.json`, `expected.json` e `notes.md`). Sem isso, o **SC-001 fica pendente**. A recriação em `fixtures/olly/` e a verificação já estão automatizadas: basta acrescentar os casos.
- **Pré-requisito humano após esta spec:** reunião de **Go/No-Go** registrada em ADR. A spec 006 não começa sem ela.
- **[PRECISA ESCLARECIMENTO]** `OLLY_REQUIRE_WEBHOOK_AUTH` no MVP: implementado com o padrão (aviso). Decidir se a homologação liga o bloqueio.
- **Execução no processo da API:** a concorrência está limitada, mas execuções longas e código JS disputam CPU com a API, e a fila em memória se perde se a API reiniciar (prevista para a spec 006).
- **Rate limit e escutas de teste em memória:** valem por instância da API; com várias instâncias, precisam do Redis (spec 006).
- **Bundle do frontend:** o chunk principal passa de 1 MB (aviso do Vite, já existente); o Monaco (≈ 4 MB) fica num chunk separado, só para o nó de código.
- Continua a vulnerabilidade moderada do `uuid` (Testcontainers, só testes).

## Como demonstrar

```bash
pnpm app:up             # ou: docker compose up -d --wait && pnpm build && pnpm db:migrate && pnpm db:seed && pnpm dev
```

1. Como `editor@olly.local` (membro Editor de um projeto), crie um workflow **Webhook → Definir campos** (`saudacao = =Olá, {{ $json.body.nome }}`). No Webhook, use o caminho `boas-vindas` e o modo "último nó".
2. No painel do Webhook, clique em **Escutar chamada de teste** e chame:

   ```bash
   curl -X POST localhost:5173/webhook-test/boas-vindas -H 'content-type: application/json' -d '{"nome":"Ana"}'
   ```

   O editor mostra "Chamada de teste recebida" e os nós executam.
3. **Salvar** e **Publicar**: o badge mostra "Publicada v1". `curl -X POST localhost:5173/webhook/boas-vindas -H 'content-type: application/json' -d '{"nome":"Bruno"}'` responde `{"saudacao":"Olá, Bruno"}`. Altere e salve o rascunho: a produção continua respondendo com a v1 até publicar de novo.
4. **HMAC:**
   - crie uma credencial **Webhook: assinatura HMAC** (segredo `s3gr3d0`) e selecione `hmac` no nó;
   - publique e assine o corpo com `printf '%s' '{"nome":"Ana"}' | openssl dgst -sha256 -hmac s3gr3d0`;
   - envie o cabeçalho `X-Signature: sha256=<hex>`. Sem ele, 401.
5. **Código:**
   - acrescente **Código (JavaScript)** com `return $input.all().map(i => ({ json: { ...i.json, total: 2 * 3 } }))` e execute o nó;
   - `console.log` aparece em **Console**; dentro de `$('…')`, Ctrl+Espaço sugere os nós;
   - `while (true) {}` falha com "Tempo limite do código excedido" (30 s) sem travar a API.
6. **Execuções:**
   - abra **Execuções**: filtre por modo "Produção" e abra uma; o canvas mostra os dados de cada nó em modo somente leitura;
   - **Copiar para o editor** fixa a chamada recebida no gatilho;
   - como `executor@olly.local`, a mesma execução aparece sem os dados.
7. **Matriz RBAC:** [`docs/rbac-matriz.md`](../../docs/rbac-matriz.md).

## Próximos passos sugeridos

- Fila durável, workers, rate limit e escutas distribuídos (spec 006).
- Destaque de sintaxe também no campo de expressões (hoje só o código usa Monaco).
- Abrir o autocomplete de nós automaticamente ao digitar `$('` (hoje com Ctrl+Espaço).
- Cancelar execução pela UI (spec 006).

## Correções após o relatório

| Data | Defeito | Correção | Teste |
|---|---|---|---|
| 05/10/2026 | Teste de UX: a chamada na URL de teste disparava o fluxo inteiro; o esperado (como no N8N) é parar no Webhook e seguir nó a nó | Spec (HU-2.1, FR-007) e plano atualizados. A escuta pelo painel envia `destinationNodeId` (o próprio Webhook): a execução para nele e a chamada recebe 202 com o id da execução, sem exigir o nó de resposta nesse momento. O editor guarda as assinaturas da definição escutada, e o ▶ dos próximos nós reaproveita o payload (FR-020 da spec 003) | `webhook.int.test.ts` › "FR-007/HU-2.1…" (escrito antes da correção, falhava); `webhook-code.spec.ts` (para no Webhook; ▶ no próximo nó usa o payload) |

## Insumos para o Go/No-Go

### Planejado × entregue (specs 001–005)

| Spec | Objetivo | Entregue | Status |
|---|---|---|---|
| 001 | Monorepo, Compose, OIDC, banco, contratos, CI | Integral | Verificada |
| 002 | Canvas, CRUD de workflows, RBAC por projeto, motor sequencial | Integral, mais exclusão de conexão pelo botão (correção pós-verificação) | Verificada |
| 003 | Expressões N8N em sandbox, If, `$vars`, execução de teste, log | Integral, mais execução de um nó por vez com reaproveitamento (FR-020, pedido no teste de UX) | Verificada |
| 004 | Credenciais, anti-SSRF, HTTP, Postgres, retry/timeout | Integral, com mascaramento de segredos em profundidade e varredura com sentinelas | Verificada |
| 005 | Webhook, publicação, código JS, execuções, matriz RBAC, POC | Integral, **exceto SC-001** (fixtures reais da POC não exportadas) | Implementada |

**Em números:**
- **Nós disponíveis (10):** manual, webhook, Set, Definir variável, If, HTTP, Postgres consulta/gravar, Responder ao webhook e Código JS.
- **Credenciais (9 tipos):** 6 de saída e 3 de webhook.
- **Testes:** 444 unitários, 175 de integração (Testcontainers: PostgreSQL, Redis, MinIO) e 25 E2E (Playwright).
- **RBAC:** matriz RBAC 100 % verde.

### Dificuldades encontradas

- **Compatibilidade de runtime:** isolated-vm 7 exige Node 24, e o projeto ficou no isolated-vm 6 com Node 22 (ADR-0003). Na troca para Node 24, atualizar.
- **Imagens e IdP de desenvolvimento:** o MinIO oficial deixou de publicar imagens (usamos a build da Chainguard), e o Keycloak exigiu ajuste de hostname para funcionar dentro e fora do compose.
- **Tempo real:** eventos de execuções rápidas se perdiam antes do editor entrar na sala. Foi resolvido com a sala do workflow e um buffer no cliente.
- **Testes sensíveis à carga:** timeouts de expressão sob CPU disputada nos testes paralelos. Foi resolvido com aquecimento do isolate e limites folgados nos testes semânticos.
- **Editor:** o Monaco atual usa EditContext, que conflitava com os atalhos do canvas, e o Esc fechava o painel junto com as sugestões. Ambos estão corrigidos e cobertos por E2E.
- **Pré-requisitos humanos ainda abertos:** fixtures reais da POC, validação de UX com usuários da POC e ADRs institucionais 0005–0008. Eles concentram o risco de compatibilidade com o N8N.

### Riscos para as specs 006–013

| Spec | Risco | Impacto | Mitigação já preparada |
|---|---|---|---|
| 006 | Migrar execução do processo da API para fila/workers (BullMQ) sem regressão; rate limit, escutas de teste e eventos multi-instância | Médio | `ExecutionDispatcher` e `ExecutionJob` serializável já isolam o despacho; eventos já saem por um serviço único |
| 006 | Go/No-Go (TCO vs. N8N Enterprise) e ADR-0006 (infraestrutura) pendentes | Alto (bloqueia) | Compose completo e imagens prontas; Helm previsto na spec 012 |
| 007–008 | Paridade de controle de fluxo (Merge, loops, porta de erro) e Python em nsjail (exige namespaces do kernel nos containers) | Médio/Alto | Contrato de portas e `onError` prontos; sandbox de código já isolado em processo |
| 009 | ADR-0005 (IdP) e ADR-0007 (Vault/KMS) não decididas; mascaramento de dados pessoais e retenção | Alto | `KeyProvider` substituível, `key_version` gravado, OIDC genérico; `execution:readData` já aplicado |
| 010–011 | ADR-0008 (provedores de LLM) pendente; custo e aprovação humana | Alto | Anti-SSRF reutilizável (MCP), permissões e auditoria prontas |
| 012 | Importador N8N e homologação dependem das fixtures reais da POC (ainda ausentes) | Alto | Formato das fixtures e verificação automática prontos (`fixtures/`, testes do motor e da API) |
| 013 | Pentest e aceite de riscos | Médio | Varreduras de segredos, matriz RBAC e testes de sandbox automatizados |
