# Plano técnico — Spec 015: Exportar e importar workflows em JSON

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Conversão pura e compartilhada** (`packages/shared-types/src/workflow-file.ts`): definição ⇄ arquivo, usada pela API (baixar e importar) e pelo editor (copiar e colar). O catálogo de tipos é um parâmetro: o `NodeRegistry` na API e a lista `/node-types` no editor.
- **Nó marcador** `placeholder.unsupported` (`packages/nodes`): portas dinâmicas copiadas das conexões originais. Fica desabilitado e bloqueia a publicação.
- **Importador do N8N** (`apps/api/src/workflow-io/n8n/`): transforma o JSON do N8N num arquivo do Olly Flow (mesmo envelope), com um conversor por tipo e versão e o relatório de migração. Depois segue o mesmo caminho da importação do Olly Flow.
- **API** (`WorkflowIoModule`): prévia, importação, exportação do rascunho salvo e exportação do canvas, com auditoria.
- **Web:**
  - diálogo "Importar" na lista, com a escolha do formato;
  - "Baixar" na lista e no editor;
  - copiar e colar pela área de transferência do sistema;
  - visual do nó marcador.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| I — Spec antes do código | Esclarecimentos do PO registrados no histórico da spec antes do plano; spec 012 atualizada (importador movido) |
| II — Compatibilidade com o N8N | Envelope, nós e conexões no formato do N8N; importador fiel à tabela da ADR-0001 |
| III — Segurança | Nada do arquivo é executado; limites de tamanho, nós e profundidade; recusa de `__proto__`/`constructor`/`prototype`; credenciais nunca exportadas nem criadas; RBAC em todas as rotas |
| IV — Testes | Cada FR com teste que o cita (tabela abaixo); exemplos da documentação verificados por teste |
| IX — Contratos | `docs/arquitetura/contratos.md` atualizado (rotas, tipo `placeholder.unsupported`, `DynamicPorts.placeholder`) |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/shared-types` | `workflow-file.ts` (formato, conversão, layout, limites, resolução de credenciais); `DynamicPorts` `placeholder`; tipos da prévia |
| `packages/nodes` | Nó `placeholder.unsupported` |
| `packages/engine` | Sub-nó decidido pelas portas efetivas; `unsupportedNodeIssues` (publicação) |
| `apps/api` | `WorkflowIoModule` (rotas, serviço, importador do N8N); bloqueio da publicação; configuração dos limites |
| `apps/web` | Diálogo de importação; "Baixar" na lista e no editor; área de transferência no formato do arquivo; visual do nó marcador |
| `docs/` | `docs/nos/workflow-json.md`, `docs/nos/placeholder.unsupported.md`, `docs/importacao-n8n.md`, contratos, README dos nós |

## Design

### §1 Formato e conversão (`workflow-file.ts`)

- **`NodeTypeCatalog`:** `get(type)` devolve `{ version, inputs, outputs, dynamicPorts?, paramsSchema?, credentialTypes? }`. É o `NodeDescription` do `@olly/nodes`, mas descrito estruturalmente para não criar dependência.
- **`toWorkflowFile(definition, ctx)`:**
  - **nós:** `params` → `parameters`, `version` do tipo → `typeVersion`, `credentialId` → `credentials[tipo] = { id, name }` (por `ctx.credentialOf(id)`);
  - **configurações do nó:**

    | Olly Flow | Arquivo |
    |---|---|
    | `onError` (`stop` / `continue` / `errorOutput`) | `onError` (`stopWorkflow` / `continueRegularOutput` / `continueErrorOutput`) |
    | `retry` | `retryOnFail` / `maxTries` / `waitBetweenTries` |
    | `retry.backoff`, `timeoutMs`, `parallelItems` | `ollyFlow.retryBackoff`, `ollyFlow.timeoutMs`, `ollyFlow.parallelItems` |
  - **arestas:** índice da porta entre as portas efetivas do mesmo tipo (`resolveNodePorts`); as saídas sem destino viram `[]`;
  - **`pinData`:** pelo nome do nó (FR-009: sempre incluído);
  - **configurações do workflow:**

    | Olly Flow | Arquivo |
    |---|---|
    | `timeoutSec` | `executionTimeout` |
    | `errorWorkflowId` | `errorWorkflow` |
    | `saveExecutionData` | `saveDataSuccessExecution` / `saveDataErrorExecution` |
    | `maxParallel` | `ollyFlow.maxParallel` |
  - **`meta.ollyFlow`:** `{ formatVersion: 1, exportedAt?, workflowVersion? }`.
- **`fromWorkflowFile(input, ctx)`** devolve `{ name, definition, issues, credentialRefs, counts }`, nesta ordem:
  1. **Conteúdo não confiável (`checkUntrusted`):** profundidade, chaves proibidas e quantidade de nós (limites em `ctx.limits`).
  2. **Envelope:** objeto com `nodes` (lista) e `connections` (objeto). `formatVersion` maior que 1 é erro `FORMAT_VERSION_UNSUPPORTED`. Tipos do N8N (`n8n-nodes-base.*`, `@n8n/*`) no formato do Olly Flow são erro `N8N_FILE` (sugere o formato N8N).
  3. **Nós:**
     - nome obrigatório e único;
     - id gerado se faltar ou repetir;
     - `typeVersion` maior que a instalada vira erro `TYPE_VERSION_UNSUPPORTED`;
     - parâmetros omitidos recebem o `default` do `paramsSchema` (nível de cima, FR-013);
     - tipo desconhecido vira marcador (§2), com as portas tiradas das conexões em que aparece.
  4. **Conexões:**
     - nome de origem e de destino precisam existir (`CONNECTION_UNKNOWN_NODE`);
     - índice → porta efetiva do tipo de conexão, calculada depois de aplicar `onError` (`CONNECTION_UNKNOWN_PORT` se não existir);
     - ids das arestas gerados; arestas duplicadas ignoradas.
  5. **`position`:** se faltar, layout por camadas (§1.1).
  6. **Restante:** `pinData` por nome → por id (nome inexistente vira aviso); `settings` pelo mapeamento inverso. A combinação sucesso `all` + erro `none` vira `all`, com aviso.
- **§1.1 Layout automático:** a camada é a distância máxima, por conexões `main`, a partir dos nós sem entrada (`x = camada × 260`, `y = ordem na camada × 160`). Os sub-nós ficam embaixo do nó pai (`y + 220`). Só os nós sem `position` são movidos.
- **`resolveCredentialRef(ref, disponíveis, aceitos)`:** pelo id (mesmo tipo); senão, pelo nome e tipo com correspondência única; senão, `undefined` (FR-014).
- **Copiar:** `toWorkflowFile` com os nós selecionados e só as arestas entre eles (o envelope sem `name`). **Colar:** `fromWorkflowFile` + a renomeação de `prepareClipboardPaste`.

### §2 Nó marcador `placeholder.unsupported`

- **Parâmetros:**
  - `originalType` e `originalTypeVersion`;
  - `reason`;
  - `originalJson` (o nó original como texto JSON, só leitura no painel);
  - `ports`: `{ inputs: kind[], outputs: kind[] }`, com `x-hidden`.
- **Portas:** `dynamicPorts: { kind: 'placeholder' }`. `resolveNodePorts` cria `in0..` e `out0..` a partir de `params.ports`, com padrão de 1 entrada e 1 saída `main`.
- **Execução:** `execute` e `supplyData` lançam "Nó não suportado (<tipo>): resolva antes de executar". Importado com `disabled: true`, ele repassa os itens (comportamento comum de nó desabilitado).
- **Motor:**
  - a decisão de sub-nó passa a usar as portas efetivas (`isSubNodeType(resolveNodePorts(t, n))`), para que um marcador ligado como ferramenta fique fora do agendamento;
  - um sub-nó desabilitado já é ignorado pelo Agent.
- **Publicação:** `unsupportedNodeIssues(definition)` (engine) gera `UNSUPPORTED_NODE`, chamado por `PublishingService.prepare`. O salvamento continua aceitando.

### §3 API (`apps/api/src/workflow-io/`)

- **`WorkflowIoService`:**
  - **`preview(user, projectId, body)`:**
    1. lê o conteúdo (texto ou objeto);
    2. converte (N8N → arquivo, §4);
    3. `fromWorkflowFile`;
    4. `validateWorkflow`;
    5. resolve as credenciais (`CredentialsService.list`; sem `credential:use`, nenhuma é ligada e todas viram pendência);
    6. monta as pendências de referência (§3.1).

    Devolve `ImportPreview`.
  - **`import(...)`:** a mesma prévia; com erro, 422 com as issues. Sem erro, `WorkflowsService.create` com a definição resolvida (as validações do salvamento valem) e auditoria `workflow.import` com `{ format, nodes, pending, unsupported }`.
  - **`export(...)`:** `toWorkflowFile` com os nomes das credenciais do projeto; auditoria `workflow.export` com `{ source: 'saved' | 'canvas', nodes }`.
- **§3.2 Sobrepor o workflow existente (FR-010, FR-028):**
  - **Identificação:**
    1. pelo `id` do arquivo, se for um workflow não excluído do projeto de destino (`matchedBy: 'id'`);
    2. senão, pelo nome final (o informado ou o do arquivo), se houver exatamente um workflow com esse nome no projeto (`matchedBy: 'name'`);
    3. com vários de mesmo nome, cria um novo, com o aviso `IMPORT_NAME_AMBIGUOUS`.
  - **Prévia:** `ImportPreview.target = { workflowId, name, version, published, matchedBy }`; um workflow publicado gera o aviso `IMPORT_TARGET_PUBLISHED`.
  - **Importação:**
    - com `target`, exige `workflow:update` no projeto e chama `WorkflowsService.save` com `baseVersion` = versão atual, a mensagem "Importado de arquivo JSON" e o nome informado (sem nome informado, mantém o atual). As validações do salvamento, a concorrência e o histórico valem;
    - sem `target`, chama `create`.

    A auditoria `workflow.import` ganha `overwritten: boolean`; a resposta, `overwritten`.
  - **Web:** a prévia mostra "Vai sobrepor o workflow … (versão N)" e o botão vira "Importar e sobrepor". Ao concluir, invalida o cache do workflow e abre o editor.
- **§3.1 Pendências:**

  | Situação | Código |
  |---|---|
  | `workflowId` (`flow.executeWorkflow`, `tool.workflow`) inexistente no projeto | `WORKFLOW_REF_NOT_FOUND` |
  | `settings.errorWorkflowId` inválido (retirado) | `ERROR_WORKFLOW_REMOVED` |
  | `serverId` (`ai.mcpClient`, `tool.mcp`) fora de `McpCatalogService.available` | `MCP_SERVER_NOT_FOUND` |
  | `model` do `ai.chatModel` fora de `AiService.allowedModels` | `AI_MODEL_NOT_ALLOWED` |
  | Caminho do webhook usado por outro workflow (`webhooks.method + path`) | `WEBHOOK_PATH_IN_USE` |
  | Credencial não resolvida | `CREDENTIAL_PENDING` |
  | Nó marcador | `UNSUPPORTED_NODE` |
- **Limites:** `OLLY_IMPORT_MAX_BYTES` (texto ou JSON re-serializado), `OLLY_IMPORT_MAX_NODES`, `OLLY_IMPORT_MAX_DEPTH`. As rotas de importação têm `bodyLimit` próprio, igual ao limite + 64 KiB, para o tamanho chegar à validação e voltar como 413 com a mensagem do limite.

### §4 Importador do N8N (`apps/api/src/workflow-io/n8n/`)

- **`convertN8n(json)`** devolve `{ file, report }`:
  - cada nó passa pelo conversor do tipo, `(node) → { type, parameters, credentials?, warnings[] } | undefined`, e `undefined` vira marcador;
  - os campos comuns são preservados (`id`, `name`, `position`, `disabled`, `onError`, `retryOnFail`, `maxTries`, `waitBetweenTries`). `continueOnFail: true` vira `continueRegularOutput`. `alwaysOutputData`, `executeOnce` e `notes` sem equivalente geram aviso;
  - os tipos de credencial são mapeados:

    | N8N | Olly Flow |
    |---|---|
    | `httpBasicAuth` | `httpBasic` |
    | `httpHeaderAuth` | `httpHeaderAuth` |
    | `httpQueryAuth` | `httpQueryAuth` |
    | `httpBearerAuth` | `httpBearer` |
    | `oAuth2Api` | `oauth2ClientCredentials` (com aviso) |
    | `postgres` | `postgres` |
    | `openAiApi` | `openAiCompatible` |
    | `anthropicApi` | `anthropic` |
    | `googlePalmApi` | `googleGemini` |

    O relatório lista `{ name, n8nType, ollyType, nodes[] }`;
  - **conexões:** mantidas, com uma exceção: a entrada 0 de um `splitInBatches` que vem de um nó alcançável pela saída 1 (lote) vira a entrada 1 (continuar);
  - **expressões:** a varredura marca `$identificador` fora da lista suportada (`$json`, `$binary`, `$input`, `$itemIndex`, `$node`, `$vars`, `$env`, `$execution`, `$workflow`, `$now`, `$today`, `$loop`, `$parameter`, `$fromAI`, `$`). Marca também as funções de extensão do N8N mais comuns (`.toInt()`, `.isEmpty()`...), o `$fromAI` fora das ferramentas e o uso de `$vars`, que tem semântica diferente;
  - **notas semânticas:** ramos executam em paralelo no Olly Flow; um `settings.executionOrder` diferente de `v1` é avisado.
- **Conversores** (`converters.ts`). Uma versão fora da lista vira marcador.

  | Tipo N8N (versões) | Olly Flow |
  |---|---|
  | `manualTrigger` | `trigger.manual` |
  | `webhook` (1–2.x) | `trigger.webhook` |
  | `errorTrigger` | `trigger.error` |
  | `executeWorkflowTrigger` (1–1.x) | `trigger.executeWorkflow` |
  | `set` (1–2: `values`; 3.x: `assignments`) | `data.set` |
  | `if` (1: por tipo; 2.x: filtro) | `logic.if` |
  | `switch` (3.x) | `logic.switch` |
  | `merge` (2–3.x) | `logic.merge` |
  | `splitInBatches` (3) | `logic.loopOverItems` |
  | `noOp` | `data.set` com `includeOtherFields: true` e sem campos |
  | `code` (1–2, JavaScript) | `code.javascript` |
  | `httpRequest` (4.x) | `http.request` |
  | `postgres` (2.x, `executeQuery` / `insert` / `update` / `upsert`) | `postgres.query` / `postgres.write` |
  | `respondToWebhook` (1.x) | `http.respondToWebhook` |
  | `executeWorkflow` (1–1.x) | `flow.executeWorkflow` |
  | `wait` (1–1.x, intervalo e data) | `flow.wait` |
  | `@n8n/n8n-nodes-langchain.agent` | `ai.agent` |
  | `lmChatOpenAi` / `lmChatAnthropic` / `lmChatGoogleGemini` | `ai.chatModel` |
  | `memoryBufferWindow` / `memoryPostgresChat` | `memory.buffer` / `memory.postgres` |
  | `toolHttpRequest`, `httpRequestTool` | `tool.httpRequest` (placeholders `{x}` → `$fromAI`) |
  | `toolCode` | `tool.code` |
  | `toolWorkflow` | `tool.workflow` |
  | `mcpClientTool` | `tool.mcp` |

  `stickyNote` é descartado (aviso). Os demais tipos viram marcador, inclusive `scheduleTrigger`, Python e `wait` por webhook.
- **Relatório (`MigrationReport`):**
  - `nodes: { converted[], withWarnings[], unsupported[] }`;
  - `expressionsToReview: { node, parameter, reason }[]`;
  - `credentialsToCreate[]`;
  - `semanticNotes[]`.

### §5 Web

- **Lista de workflows:**
  - **"Importar"** (`workflow:create`): diálogo com formato (Olly Flow | N8N), arquivo ou texto, nome, "Pré-visualizar", relatório e "Importar". Ao importar, abre o editor do novo workflow;
  - **"Baixar"** por linha (`workflow:update`).
- **Editor:** botão "Baixar" (`workflow:update`) que envia a definição do canvas para `POST /workflows/:id/export`.
- **Área de transferência:**
  - `copy` grava o arquivo (`toWorkflowFile` com o catálogo de `/node-types` e os nomes das credenciais do projeto) em `navigator.clipboard.writeText`, além da cópia interna;
  - um ouvinte de `paste` no editor lê o texto. Se for um arquivo, converte com `fromWorkflowFile`, resolve as credenciais pela lista do projeto e acrescenta os nós. Com erro, mostra um aviso e não altera o canvas. Sem texto JSON, usa a cópia interna.
- **Nó marcador:** borda tracejada âmbar e subtítulo "Não suportado: <tipo original>". O painel mostra o tipo, o motivo e o JSON original (só leitura).
- **Publicar:** o erro `UNSUPPORTED_NODE` aparece pelo tratamento de erros atual da publicação.

## Modelo de dados

Sem migrations. A auditoria usa as ações novas `workflow.export` e `workflow.import`.

## Contratos

| Método e rota | Permissão | Entrada | Saída |
|---|---|---|---|
| `POST /api/v1/projects/:id/workflows/import/preview` | `workflow:create` (projeto) | `{ format: 'olly' \| 'n8n', content: string \| object, name? }` | `ImportPreview` |
| `POST /api/v1/projects/:id/workflows/import` | `workflow:create` (projeto); `workflow:update` para sobrepor | Igual, com `name?` | `{ workflow: WorkflowDetail, preview: ImportPreview, overwritten: boolean }` (201); 422 com as issues se houver erro |
| `GET /api/v1/workflows/:id/export` | `workflow:update` (workflow) | — | `WorkflowFile` com `Content-Disposition: attachment; filename="<nome>.json"` |
| `POST /api/v1/workflows/:id/export` | `workflow:update` (workflow) | `{ definition, name? }` | `WorkflowFile` (o editor salva o arquivo) |

`ImportPreview`:

```ts
{
  name: string;
  format: 'olly' | 'n8n';
  counts: { nodes: number; connections: number };
  errors: ImportIssue[];
  pending: ImportIssue[];
  warnings: ImportIssue[];
  migration?: MigrationReport;
  /** FR-028: workflow do projeto que será sobreposto. */
  target?: { workflowId: string; name: string; version: number; published: boolean; matchedBy: 'id' | 'name' };
}
```

`ImportIssue` é `{ code, message, node? }`.

## Permissões RBAC

| Permissão | Situação no catálogo/seed | Papéis | O que esta spec faz |
|---|---|---|---|
| `workflow:update` | Existente | admin, editor | Exigida para baixar (FR-008) |
| `workflow:create` | Existente | admin, editor | Exigida para a prévia e a importação (FR-017) |
| `credential:use` | Existente | admin, editor | Necessária para a importação ligar credenciais (sem ela, ficam pendentes) |

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_IMPORT_MAX_BYTES` | `5242880` (5 MiB) | Tamanho máximo do arquivo importado |
| `OLLY_IMPORT_MAX_NODES` | `500` | Quantidade máxima de nós |
| `OLLY_IMPORT_MAX_DEPTH` | `64` | Profundidade máxima do JSON |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Conversão em `shared-types`, com catálogo injetado | Pacote novo; conversão só na API | O editor precisa dela para copiar e colar sem ir ao servidor; não cria dependência de `nodes` em `shared-types` |
| Importador do N8N gera um arquivo do Olly Flow e reaproveita a importação | Converter direto para a definição | Um único caminho de validação, de credenciais, de pendências e de marcadores |
| Importador na API (`apps/api/src/workflow-io/n8n/`) | `packages/importer-n8n` (plano da 012) | Só a API o usa; menos um pacote para manter |
| `mcpClientTool` → `tool.mcp` | `ai.mcpClient` (tabela inicial da ADR-0001) | No N8N, ele é uma ferramenta do Agent (sub-nó); o equivalente é `tool.mcp`. Registrado no relatório |
| Baixar com `workflow:update` | Permissão nova `workflow:export` | Atende "Editor e Admin" sem mudar o seed de papéis |
| Exportação do canvas por `POST` | Converter no navegador | Mantém a auditoria (FR-008) e os nomes das credenciais no servidor |
| Workflow de erro inexistente retirado | Manter a referência | O salvamento recusa a referência inválida (spec 007, FR-014) |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001–FR-005, FR-009, FR-013, FR-018 | Unidade | `packages/shared-types/src/workflow-file.test.ts` |
| FR-003, NFR-001, SC-001 (todos os tipos) | Unidade (API, com o registro real) | `apps/api/src/workflow-io/round-trip.test.ts` |
| FR-016 | Unidade + integração | `workflow-file.test.ts`; `packages/nodes` (marcador); `workflow-io.int.test.ts` (publicação bloqueada) |
| FR-006–FR-008, FR-010–FR-012, FR-014, FR-015, FR-017, NFR-002–NFR-004, SC-002, SC-005 | Integração | `apps/api/src/workflow-io/workflow-io.int.test.ts` |
| FR-008, FR-017 (papéis) | Integração | `apps/api/src/rbac/rbac-matrix.int.test.ts` |
| FR-021, FR-022, SC-003 | Unidade (API) | `apps/api/src/workflow-io/docs.test.ts` |
| FR-023–FR-026 | Unidade | `apps/api/src/workflow-io/n8n/n8n.test.ts` |
| FR-027, SC-007, SC-008 | Integração | `apps/api/src/workflow-io/n8n-fixtures.int.test.ts` |
| FR-010, FR-028 (sobrepor) | Integração + E2E | `workflow-io.int.test.ts` › "FR-028"; `e2e/workflow-io.spec.ts` |
| FR-019, FR-020, SC-006 | Unidade (web) + E2E | `apps/web/src/editor/clipboard-file.test.ts`; `e2e/workflow-io.spec.ts` |
| FR-006, FR-010, HU-3 | E2E | `e2e/workflow-io.spec.ts` |

## Riscos

| Risco | Mitigação |
|---|---|
| Muitas variações de versão de nó no N8N | Conversores por versão; marcador como saída segura, com o JSON original |
| Arquivo hostil (profundidade, tamanho, chaves de protótipo) | Verificação antes de qualquer conversão; limites configuráveis |
| Dados fixados com dados pessoais no arquivo baixado | Decisão do PO (FR-009); só Editor e Admin baixam, com auditoria |
| Área de transferência indisponível (sem HTTPS ou sem permissão) | Copiar e colar internos continuam funcionando |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 07/10/2026 | Criação, já com os esclarecimentos do PO e o importador absorvido da spec 012 | Spec 015 |
| 07/10/2026 | Ajustes da implementação: (1) colar passou do atalho Ctrl+V para o evento `paste` do navegador (o `preventDefault` no atalho impedia o evento com o texto da área de transferência), e a cópia interna continua como alternativa; (2) ao colar nós, os dados fixados do fragmento não são aplicados; (3) o `bodyLimit` das rotas é o dobro de `OLLY_IMPORT_MAX_BYTES` + 64 KiB, porque o texto JSON escapado ocupa mais que o arquivo; acima dele, o Fastify responde 413 com a mensagem padrão; (4) no formato N8N, a verificação de conteúdo hostil e do limite de nós roda antes da conversão | Implementação |
| 07/10/2026 | §3.2: importar o JSON de um workflow existente sobrepõe o rascunho (nova versão), identificado pelo `id` e, sem ele, pelo nome único | Mudança da spec (FR-010, FR-028) |
