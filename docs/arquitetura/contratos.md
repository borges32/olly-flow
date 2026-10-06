# Contratos Centrais

> Normativo. Alterações exigem registro no `plan.md` da spec e no `report.md` (constituição, Artigo IX.3). Ao alterar, atualize este arquivo.

## Tipos de workflow (`packages/shared-types`)

```ts
export interface BinaryRef { id: string; mimeType: string; fileName?: string; size?: number }
export interface Item {
  json: Record<string, unknown>;
  binary?: Record<string, BinaryRef>;            // referência a objeto no storage
  pairedItem?: { item: number; input?: number }; // item de entrada que originou este
}
export type NodeOutput = Record<string, Item[]>; // porta -> itens: { main }, { true, false }, { output0.. }, { error }

export interface WorkflowNode {
  id: string;
  type: string;                                   // ver "Tipos de nó"
  name: string;                                   // único no workflow; usado em $('Nome')
  params: Record<string, unknown>;
  credentialId?: string;
  position: [number, number];
  disabled?: boolean;
  settings?: {
    retry?: { maxTries: number; waitMs: number; backoff?: 'fixed' | 'exponential' }; // 1–10, 0–60 000 ms (spec 004)
    timeoutMs?: number;
    onError?: 'stop' | 'continue' | 'errorOutput';
    parallelItems?: { enabled: boolean; concurrency: number };
  };
}
export interface Edge { id: string; from: string; fromPort: string; to: string; toPort: string }
export interface PortDef {
  name: string; displayName?: string; required?: boolean;
  kind: 'main' | 'ai_languageModel' | 'ai_memory' | 'ai_tool';
  maxConnections?: number;                        // spec 011: 1 modelo, 1 memória
}
export type ExecutionStatus = 'queued' | 'running' | 'waiting' | 'success' | 'error' | 'cancelled';
export type NodeExecutionStatus = 'running' | 'success' | 'error' | 'skipped' | 'waiting' | 'cancelled';

export interface WorkflowSettings {
  timeoutSec?: number;
  maxParallel?: number;                           // padrão 8 (spec 006)
  saveExecutionData?: 'all' | 'errorsOnly' | 'none'; // spec 009
  errorWorkflowId?: string;                       // spec 007
}
export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: Edge[];
  settings: WorkflowSettings;
  pinData?: Record<string, Item[]>;               // por id do nó (spec 003)
}
```

`workflowDefinitionSchema` (zod) valida também: ids e nomes de nó únicos, ids de aresta únicos e arestas/`pinData` apontando para nós existentes.

## Contrato de nó (`packages/nodes`)

```ts
export interface NodeDefinition {
  type: string;
  version: number;
  displayName: string;
  description: string;
  icon: string;
  category: 'trigger' | 'logic' | 'data' | 'code' | 'ai' | 'integration' | 'flow';
  inputs: PortDef[];
  outputs: PortDef[];                             // podem ser dinâmicas (Merge, Switch)
  paramsSchema: JSONSchema7;                      // gera o formulário; extensões x-display-options, x-secret
  credentialTypes?: string[];
  supportsParallelItems?: boolean;                // spec 006
  rerunOnPartialExecution?: boolean;              // roda de novo ao executar um nó adiante (spec 003, FR-020)
  // spec 004: paramsSchema aceita x-no-expression, x-multiline e x-load-options (docs/nos/README.md)
  execute(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput>;
}
```

`NodeContext` oferece, entre outros: `getParam(name, itemIndex)` (com expressões já resolvidas para o item; erros de expressão são lançados como `ExpressionError` na leitura), `setVariable(name, value)` (variável da execução, lida em `$vars`; spec 003), `getCredential()` (spec 004: devolve `{ id, type, data, updatedAt }`, a credencial do nó decifrada e verificada contra o projeto do workflow), `signal` (`AbortSignal`, abortado pelo timeout do nó ou pelo cancelamento), `logger`, `helpers` (paired items, binários no object storage e `registerSecret(valor)`, que inclui um segredo derivado, como um token OAuth2, no mascaramento), `runCode({ code, mode })` (spec 005: código de usuário no task runner com o contexto do nó; o `console` vai para o registro do nó), `respondToWebhook(resposta)` (spec 005: resposta do webhook; só a primeira vale, as seguintes devolvem `false`) e `mapItems(itens, fn)` (spec 006: processa os itens com a concorrência de `settings.parallelItems` quando o tipo tem `supportsParallelItems`; senão, um por vez; ordem preservada). Tipos com `supportsParallelItems` na spec 006: `http.request`, `postgres.query` (modo por item) e `postgres.write` (sem transação única). Spec 007:
- `NodeContext.loop` (`LoopState { index, maxIterations, accumulated, data }`) existe só nos nós de laço;
- `NodeContext.maxLoopIterations` é o teto global;
- `NodeDefinition.dynamicPorts` (`mergeInputs` | `switchOutputs`) descreve portas calculadas pelos parâmetros, e `resolveNodePorts(tipo, nó)` (`@olly/shared-types`) devolve as portas efetivas, inclusive a saída `error` quando `settings.onError = 'errorOutput'`;
- os laços são analisados por `analyzeLoops` (`@olly/shared-types`): ciclos só pela porta `continue` de um nó de laço dominador. `NodeExecuteInput` traz `inputs` (itens por porta) e `items` (atalho para `inputs.main`).

Spec 008 (parte antecipada para a 011):
- `NodeWaitSignal` (`@olly/nodes`): o nó o lança para pausar, com `{ reason, resumeAt?, approvals?, data? }`. A execução fica `waiting`, os ramos independentes terminam, e o motor devolve `RunResult.status = 'waiting'` com `waiting` (nós em espera) e `snapshot` (`EngineSnapshot`: estado dos nós, índices, laços, `$vars`, resposta do webhook). `RunOptions.resume = { snapshot, values }` continua a execução: os nós com valor executam de novo, com o mesmo `runIndex` e `ctx.resume = { data, value }`; os demais seguem esperando;
- `NodeContext.subWorkflows()` devolve o `SubWorkflowGateway` (`run({ workflowId, items, wait, signal })`), entregue pelo motor a partir de `RunOptions.subWorkflows`;
- `NodeRunRecord.status` e `ExecutionFinishedEvent.status` aceitam `waiting` (neste último, `finishedAt` é `null`).

Spec 010:
- `NodeContext.runIndex` (execução do nó na execução: 0, 1... nos laços);
- `NodeContext.mcp()` devolve o `McpGateway` (`@olly/nodes`), que o motor recebe em `RunOptions.mcp` (a API o monta por execução); sem gateway, lança erro. O gateway expõe `prepareTool`, `callTool`, `listTools`, `listResources`, `readResource`, `listPrompts` e `getPrompt`, todos com `McpCallRef { serverId, nodeId, runIndex, itemIndex, credential?, signal? }`, e aplica catálogo, políticas, snapshot, registro e auditoria;
- extensão `x-mcp-arguments` (formulário gerado do `inputSchema` da tool) e fontes `mcpServers`/`mcpTools` em `x-load-options`.

Spec 011:
- **Sub-nós:** tipos cujas saídas são todas `ai_*` (`isSubNodeType`, `@olly/shared-types`). Ficam fora do agendador e não recebem itens; fornecem um objeto ao nó pai por `NodeDefinition.supplyData(ctx, itemIndex)`, que o pai lê com `ctx.subNodes(kind, itemIndex)` (`SubNodeSupply { node, type, data }[]`). O contexto do sub-nó resolve as expressões com os itens do pai. `ChatModelSupply` (modelo LangChain, provedor e nome), `MemorySupply` (`load`, `save`) e `AgentTool[]` (`name`, `description`, `schema`, `requireApproval`, `sideEffects`, `external`, `source`, `invoke`) em `packages/nodes/src/ai/runtime/types.ts`;
- `ctx.withFromAI(valores, itemIndex)` devolve um leitor de parâmetros com `$fromAI()` resolvido para os argumentos do modelo;
- `ctx.ai()` devolve o `AiGateway` (`RunOptions.ai`): `checkModel`, `beforeModelCall` (limite mensal), `recordUsage`, `recordStep` (mascara, grava e emite `agentStep`), `persistentMemory`, `executionMemory`, `fetch` (anti-SSRF), `limits` e `allowFakeModel`;
- `NodeWaitSignal.approvals` (`NodeApprovalRequest { key, itemIndex, tool, arguments, reason }`): a API cria um pedido por chave; a decisão chega em `ctx.resume.value = { approvals: { [key]: { approved, comment } } }`;
- validações `SUBNODE_ON_MAIN`, `AGENT_MODEL_REQUIRED`, `AGENT_MEMORY_MAX`, `TOOL_NAME_INVALID`, `TOOL_NAME_DUPLICATE`, `TOOL_DESCRIPTION_REQUIRED`;
- `ctx.runCode` aceita `items` (entrada do código da ferramenta `tool.code`); fonte `aiModels` em `x-load-options`.

`NodeRegistry` (`register`, `get(type, version?)`, `list()` sem `execute`) recusa nós cujo `paramsSchema` não seja um JSON Schema draft-07 válido com `type: "object"` na raiz. Palavras-chave desconhecidas são erro; as extensões aceitas são `x-display-options`, `x-secret` e `x-hidden` (ver [docs/nos/README.md](../nos/README.md)).

## Tipos de nó

| Tipo | Spec | Tipo | Spec |
|---|---|---|---|
| `trigger.manual` | 002 | `http.request` | 004 |
| `trigger.webhook` | 005 | `http.respondToWebhook` | 005 |
| `trigger.schedule` | 008 | `postgres.query` | 004 |
| `trigger.error` | 007 | `postgres.write` | 004 |
| `trigger.executeWorkflow` | 008 | `code.javascript` | 005 |
| `data.set` | 002 | `code.python` | 008 |
| `data.setVariable` | 003 | `flow.executeWorkflow` | 008 |
| `logic.if` | 003 | `flow.wait` | 008 |
| `logic.switch` | 007 | `flow.stopAndError` | 008 |
| `logic.merge` | 007 | `ai.mcpClient` | 010 |
| `logic.while` | 007 | `ai.chatModel` | 011 |
| `logic.loopOverItems` | 007 | `ai.agent` | 011 |
| `placeholder.unsupported` | 012 | `tool.*`, `memory.*` (sub-nós) | 011 |

## Permissões RBAC

| Permissão | Introduzida na spec |
|---|---|
| `user:manage`, `project:manage` | 002 |
| `workflow:create`, `workflow:read`, `workflow:update`, `workflow:delete`, `workflow:execute` | 002 |
| `execution:read` | 003 |
| `credential:manage`, `credential:use` | 004 |
| `workflow:publish`, `execution:readData` | 005 |
| `audit:read` | 009 |
| `mcp:manage` | 010 |

**Spec 004:** listar credenciais e usá-las em nós (associar ao salvar, catálogo do Postgres) exige `credential:use`; criar, editar, excluir e testar exige `credential:manage`. Sem `credential:use`, a execução de teste de um workflow com credenciais só aceita a versão salva.

**Responsabilidade por spec (decisão de 03/10/2026):** cada spec acrescenta as permissões que cria ao catálogo, ao seed e a esta tabela, e as declara na seção "Permissões RBAC" do seu `plan.md`. As permissões das specs 002 a 009 já estão no catálogo e no seed desde a spec 001; essas specs apenas as aplicam e testam.

Catálogo e papéis padrão em `packages/shared-types/src/rbac.ts` (seed da spec 001): `admin` tem todas; `editor`, todas exceto `user:manage`, `project:manage`, `audit:read` e `mcp:manage`; `executor`, `workflow:read`, `workflow:execute` e `execution:read`; `viewer`, `workflow:read` e `execution:read`. `mcp:manage` entrou no catálogo e no seed na spec 010, como permissão exclusiva do admin, e vale só no escopo da plataforma.

**Permissões efetivas (spec 002):** o grupo de administração do IdP (`OIDC_ADMIN_GROUP`) concede todas as permissões em todos os projetos; os demais usuários têm as permissões do seu papel somente nos projetos dos quais são membros (`project_members`). `GET /api/v1/me` devolve `permissions: { global: Permission[], projects: { [projectId]: Permission[] } }` (`EffectivePermissions` em `@olly/shared-types`). Toda rota declara `@Public()`, `@Authenticated()`, `@RequireProjectMember(param)` ou `@RequirePermission(permissão, escopo)`; recurso de projeto do qual o usuário não é membro responde 404.

Matriz por papel: [`docs/rbac-matriz.md`](../rbac-matriz.md), gerada pelo teste da spec 005.

**Spec 009:**
- `audit:read`, `user:manage` e as regras globais de mascaramento (`project:manage`) valem só no escopo da plataforma (`@RequirePermission(..., 'global')`). O papel admin de um projeto não as tem.
- Grupos do IdP mapeados para um papel **global** (`group_role_mappings` sem projeto) entram em `EffectivePermissions.global` enquanto o token trouxer o grupo, e valem em todos os projetos.
- Com `projects.executor_can_read_data`, o papel Executor ganha `execution:readData` no projeto. A concessão é calculada no `ProjectPermissionResolver`, de modo que `/me`, as rotas e o WebSocket a enxergam igual.
- O escopo de recurso aceita `{ publishRequest: 'id' }` (projeto do pedido de publicação).

**Spec 011:** o escopo de recurso aceita `{ approval: 'approvalId' }` (projeto do pedido de aprovação do agente). Decidir exige `workflow:execute` nesse projeto.

## Convenção de expressões (spec 003)

- Um parâmetro string que começa com `=` é uma expressão-template: `"=Olá {{ $json.nome }}"`.
- Um template formado por um único `{{ }}` preserva o tipo do resultado. Um template misto produz string (`null`/`undefined` viram vazio; objetos, JSON; datas, ISO 8601).
- Avaliação somente no sandbox do task runner (`@olly/expressions` + `apps/task-runner`), em lote por nó. Detalhes, limites e divergências: [docs/expressoes.md](../expressoes.md).
- Variáveis: `$json`, `$binary`, `$itemIndex`, `$input.*`, `$('Nó').item|all()|first()|last()|params`, `$node["Nó"]` (legado), `$vars`, `$env` (somente `OLLY_EXPOSED_*`), `$execution`, `$workflow`, `$now`, `$today`, `$loop` (spec 007), `$response` e `$pageCount` (paginação, spec 008), `$fromAI()` (tools, spec 011).

## Eventos WebSocket (namespace `/executions`)

- Autenticação no handshake (`auth.token` = access token). Salas, com `execution:read` verificado no projeto a cada pedido (resposta `{ ok: false, error: 'not_found' }` sem permissão):
  - `join { executionId }` → sala `execution:<id>`;
  - `joinWorkflow { workflowId }` → sala `workflow:<id>`, que recebe os eventos de todas as execuções do workflow desde o início (o editor entra ao abrir, antes de conhecer o id da execução).
- Eventos (tipos `ExecutionEvents` em `@olly/shared-types`): `executionStarted` · `nodeStarted` · `nodeFinished` (status, contagens, duração, dados truncados, `pinned`, `reused`, `console`; `runIndex` a partir da spec 007) · `executionFinished` · `testWebhookReceived` (spec 005: id da execução, nó e o item recebido) · `agentStep` (spec 011).
- **Dados de execução (spec 005, FR-014):** quem tem `execution:readData` entra na variante `…:data` da sala e recebe os eventos completos; os demais recebem `nodeFinished` sem `data`/`console` (`dataRedacted: true`) e `testWebhookReceived` sem `payload`.

## Despacho de execuções (specs 005 e 006)

- `ExecutionDispatcher` (API): `initialStatus(mode)`, `dispatch(job)`, `waitForResult(executionId, timeoutMs, untilResponse?)` e `cancel(executionId, motivo)`. O `ExecutionJob` é serializável (execução, definição, modo, itens do gatilho, nó inicial, pin data, destino, reaproveitamento).
- `QueueDispatcher` (spec 006): grava os dados do disparo em `execution_payloads` (no MinIO acima de 1 MB) e enfileira só `{ executionId }` na fila BullMQ `executions` (`jobId` = id da execução, `attempts: 1`). Produção sempre pela fila; teste pela fila ou em processo (`OLLY_TEST_RUN_MODE`). `RoutingDispatcher` escolhe por modo.
- `InProcessDispatcher`: execução no processo da API com no máximo `OLLY_MAX_CONCURRENT_EXECUTIONS`; o excedente fica `queued`. Na spec 006, só para testes com `OLLY_TEST_RUN_MODE=inprocess`.
- Redis (spec 006): canal `olly:execution-events` (eventos de execução → WebSocket em todas as instâncias da API); `olly:execution:<id>` + chaves `…:response`/`…:outcome` com TTL de 10 min (resultado para a resposta síncrona do webhook); `olly:execution-cancel` (pedidos de cancelamento para os workers); `olly:quota:<projeto>` (vagas da cota, sorted set com validade).
- Erro da execução (`ExecutionErrorInfo`): `{ message, nodeId?, reason? }`, com `reason` = `cancelled` | `timeout` (status `cancelled`) ou `worker_lost` (status `error`).
- Iterações (spec 007): `nodeStarted`/`nodeFinished` e `NodeExecutionDetail` trazem `runIndex`; `GET /executions/:id` lista uma linha por execução de cada nó, ordenadas por início e `runIndex`.
- Workflow de erro (spec 007): `settings.errorWorkflowId`, validado ao salvar (mesmo projeto, outro workflow, com `trigger.error`) e espelhado em `workflows.error_workflow_id`. As execuções disparadas por ele têm `triggerType: 'error'`.
- Rotas (spec 006): `POST /executions/:id/cancel` (`workflow:execute`; 409 se já terminou; auditado como `execution.cancel`), `GET /projects/:id/queue-stats` (`execution:read`; `{ running, queued, limit, customLimit }`) e `PUT /projects/:id/quota { maxConcurrentExecutions: number | null }` (administração da plataforma; auditado como `project.quota`).
- Webhooks: `/webhook/<path>` (publicado) e `/webhook-test/<path>` (escuta do editor), fora de `/api/v1`, com autenticação própria por credencial. Publicação: `POST /workflows/:id/publish { version?, message }` (mensagem obrigatória desde a spec 009) e `POST /workflows/:id/unpublish` (`workflow:publish`). Escuta: `POST`/`DELETE /workflows/:id/listen-test-webhook` (`workflow:execute`). Execuções: `GET /executions` (filtros e cursor; `execution:read`).

## Governança e LGPD (spec 009)

Tipos em `packages/shared-types/src/governance.ts`. Detalhes em [docs/governanca.md](../governanca.md) e [docs/lgpd.md](../lgpd.md).

- **Chave mestra (`@olly/db`):**
  - `KeyProvider { id, currentKeyVersion(): Promise<number>, wrap(dek): Promise<{ wrapped, keyVersion }>, unwrap(wrapped, keyVersion) }`;
  - `KeyRing { current, provider(id) }`, com os provedores `EnvKeyProvider` e `VaultTransitKeyProvider`; `createKeyRing(options)` escolhe por `OLLY_KEY_PROVIDER`;
  - o envelope ganhou `kp` (provedor; ausente = `env`);
  - `rewrapCredentialData` recifra só a DEK (rotação e migração).
- **Mascaramento (`@olly/engine`):**
  - `createMasker(rules, { salt })` devolve `Masker { mask(value) → { value, changed }, maskText(text) }`;
  - regras `MaskingRuleSpec { kind: 'field' | 'pattern', matcher, action: 'redact' | 'partial' | 'hash' }`;
  - aplicado pelo `ExecutionRecorder` (banco e eventos) e pelos logs (pino); nunca entre os nós.
- **Rotas:**
  - `POST /auth/login` (público; valida o token, sincroniza os grupos, audita `auth.login`/`auth.login_failed`);
  - `GET /admin/users`, `PUT /admin/users/:userId/active` e `GET|POST /sso/group-mappings`, `DELETE /sso/group-mappings/:mappingId` (`user:manage` global);
  - `GET|PUT /projects/:id/settings` (membro / `project:manage`);
  - `GET|POST /masking-rules`, `PUT|DELETE /masking-rules/:ruleId` (`project:manage` global);
  - `GET|POST /projects/:id/masking-rules`, `PUT|DELETE /projects/:id/masking-rules/:ruleId` (`project:manage`);
  - `GET /workflows/:id/versions/:version` e `GET /workflows/:id/diff?from=&to=` (`workflow:read`);
  - `POST /workflows/:id/versions/:version/restore` (`workflow:update`);
  - `GET /publish-requests?status=&workflowId=` (autenticado; filtra pelos projetos em que o usuário publica e pelos próprios pedidos);
  - `POST /publish-requests/:id/approve|reject|cancel` (`workflow:publish` no projeto do pedido);
  - `GET /audit` e `GET /audit/export.csv` (`audit:read` global).
- **Mudanças em contratos existentes:**
  - `PUT /workflows/:id` aceita `message?`;
  - `PublishResponse.pendingApproval?` quando a publicação vira pedido;
  - `ProjectMember.origin` (`manual` | `idp`);
  - `WorkflowSettings.saveExecutionData` passa a valer nas execuções de produção (o padrão vem do projeto).
- **Redis:**
  - canal `olly:masking-rules-changed` (invalidação das regras na API e nos workers);
  - lock `olly:retention-lock`;
  - fila BullMQ `maintenance`, com o *job scheduler* `maintenance-daily`.

## Cliente MCP (spec 010)

Tipos em `packages/shared-types/src/mcp.ts`; cliente em `packages/mcp-client` (SDK oficial, especificação MCP 2025-11-25). Detalhes em [docs/mcp-governanca.md](../mcp-governanca.md).

- **Transportes:** somente `streamableHttp` e `sse` (o cadastro recusa `stdio`). Todo tráfego pelo `fetch` com anti-SSRF (`HttpGuard` da spec 004).
- **Rotas:**
  - `GET|POST /mcp-servers`, `GET|PUT|DELETE /mcp-servers/:serverId`, `POST /mcp-servers/:serverId/test|approve|disable`, `GET /mcp-servers/:serverId/tools?projectId=`, `PUT /mcp-servers/:serverId/policies`, `POST /mcp-servers/:serverId/snapshot/accept` (`mcp:manage` global);
  - `GET /projects/:id/mcp-servers` (`credential:use`): servidores ativos e tools liberadas, com o schema aprovado;
  - `GET /executions/:id/mcp-calls` (`execution:read`; argumentos mascarados só com `execution:readData`);
  - `POST /credentials/:id/oauth/authorize` (`credential:manage`), `GET /credentials/:id/oauth/status` (`credential:use`) e `GET /oauth/callback` (público; vale pelo `state` de uso único).
- **Auditoria:** `mcp.server_create|update|delete|test|approve|disable`, `mcp.policy_update`, `mcp.snapshot_accept`, `mcp.tool_denied`, `mcp.tool_blocked` e `credential.oauth_connect`.
- **Redis:** `olly:mcp-oauth:<state>` (autorização OAuth pendente: credencial e verificador PKCE, TTL de 10 min).
- **Configuração:** `OLLY_MCP_CALL_TIMEOUT_MS` (60 000) e `OLLY_MCP_MAX_RESULT_MB` (10).
- **Spec 011:** `McpGateway.agentTools(ref)` devolve as tools liberadas e sem mudança pendente, com `destructive` (política) e `readOnly` (anotação `readOnlyHint`), para o sub-nó `tool.mcp`.

## Espera e sub-workflows (spec 008, parte antecipada)

- **Estado:** `execution_state (execution_id, state, resume_at)` guarda o `EngineSnapshot`, o que a retomada ainda usa do disparo e os valores entregues aos nós (`deliveries`). O registro é removido no fim da execução.
- **Retomada:** job `resume` (atrasado) na fila `executions`, com `jobId` `resume-<execução>-<horário>`. Qualquer worker retoma: ocupa a cota, restaura o estado e executa os nós cujo horário venceu ou que receberam valor. Uma varredura de 30 s reagenda as retomadas vencidas. Cancelar uma execução `waiting` a encerra direto e descarta o estado.
- **Sub-workflows:** `executions.parent_execution_id` e `executions.depth`, com `trigger_type = 'subworkflow'`. Limite `OLLY_MAX_SUBWORKFLOW_DEPTH` (5) e recursão detectada pela cadeia de execuções pai.

## AI Agent (spec 011)

Tipos em `packages/shared-types/src/ai.ts`; runtime em `packages/nodes/src/ai/runtime` (laço ReAct sobre `@langchain/core`, provedores `@langchain/openai` e `@langchain/anthropic`). Segurança: [docs/seguranca-agentes.md](../seguranca-agentes.md).

- **Rotas:**
  - `GET /executions/:id/agent-steps` (`execution:read`; `content` só com `execution:readData`) e `GET /executions/:id/ai-usage` (`execution:read`);
  - `GET /projects/:id/ai-usage?from&to` (`project:manage` no projeto): totais, por workflow, consumo do mês e limite;
  - `GET /ai-usage?from&to` e `GET /ai-pricing`, `PUT|DELETE /ai-pricing/:model` (`project:manage` global);
  - `GET /projects/:id/ai-settings` (`workflow:read`) e `PUT /projects/:id/ai-settings { allowedModels, monthlyTokenLimit }` (`project:manage` global; modelos dentro do cadastro da instalação);
  - `GET /ai-models`, `PUT /ai-models/:model { note? }` e `DELETE /ai-models/:model` (`project:manage` global): modelos permitidos na instalação (`AiModel`), lidos a cada uso (sem reinício);
  - `GET /projects/:id/ai-models` (`credential:use`): modelos permitidos no projeto;
  - `GET /approvals?status&executionId` (autenticado: pedidos dos projetos com `workflow:execute`) e `POST /approvals/:approvalId/approve|reject { comment? }` (`workflow:execute`, escopo `{ approval }`; 409 se já decidido).
- **Evento `agentStep`** (`AgentStepEvent`): `{ executionId, nodeId, runIndex, itemIndex, stepIndex, kind: model|tool|approval|final|error, toolName, content?, inputTokens, outputTokens, createdAt }`; sem `content` (`contentRedacted: true`) para quem não tem `execution:readData`.
- **Auditoria:** `agent.approval_requested|approved|rejected|expired`, `ai.model_allow|remove`, `ai.pricing_update|delete` e `project.ai_settings`.
- **Aprovação:** pedido criado quando a execução entra em `waiting` com `approvals`; a decisão é entregue ao nó (`ExecutionWaits.deliver`) e, com todos os pedidos do nó decididos, a execução retoma. Expiração (`OLLY_APPROVAL_TIMEOUT_HOURS`, 24) na varredura de 30 s do worker, como rejeição. Cancelar a execução cancela os pedidos pendentes.
- **Configuração:** `OLLY_AGENT_MAX_ITERATIONS` (25), `OLLY_AGENT_TOOL_RESULT_MAX_CHARS` (20 000), `OLLY_APPROVAL_TIMEOUT_HOURS` (24) e `OLLY_RETENTION_MEMORY_DAYS` (30). Credencial `fakeLlm` só com `NODE_ENV=test`.
