# Plano técnico — Spec 003: Expressões, variáveis e execução de teste

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Sandbox:** o `apps/task-runner` (processo filho supervisionado) avalia expressões com isolated-vm em lote.
- **Engine:** resolve os parâmetros por item via `getParam`.
- **Execução de teste:** roda no processo da API, com eventos por WebSocket.
- **Log:** execuções gravadas em tabelas particionadas.
- **Frontend:** painel em três colunas (estilo NDV do N8N) e editor de expressões com Monaco.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — N8N | Prefixo `=`, variáveis do N8N, *paired items*, If v2, suíte de compatibilidade |
| III — Segurança | isolated-vm em processo separado; `$env` filtrado; autorização na sala WebSocket |
| VIII — Observabilidade | Registro de execução e por nó |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `apps/task-runner` | Novo: processo IPC + isolated-vm |
| `packages/expressions` | Parser, contexto, `ExpressionEvaluator` |
| `packages/engine` | `getParam`, `pairedItem`, pin data, `destinationNodeId`, callbacks de persistência |
| `packages/nodes` | `data.set` (atualização), `data.setVariable`, `logic.if` |
| `packages/db` | `executions`, `node_executions` particionadas |
| `apps/api` | Módulos `executions` (test-run), `expressions` (preview) e gateway WebSocket |
| `apps/web` | Painel do nó, editor de expressões, status no canvas, pin data |

## Design

### §1 Convenção de expressões
- `"=..."` é template; o restante é literal.
- **Parser:** extrai segmentos `{{ ... }}`, tolerando `}}` dentro de strings JS (*tokenizer* simples de aspas e crases).
- **Template de um único segmento** retorna o valor bruto. **Template misto** converte para string; objetos viram `JSON.stringify`.
- Documentado em `docs/expressoes.md`.

### §2 Task runner
- `child_process.fork` iniciado pela API, com reinício automático e *backoff*.
- Mensagens tipadas (zod nos dois lados):
  - `evaluateBatch { executionId, expressions: [{ id, code, itemIndex }], contextRef }` → `results[]`;
  - `disposeExecution { executionId }`;
  - `runCode` (reservada para a spec 005).
- **Um `Isolate` por execução** (`memoryLimit: 128`). Contexto reaproveitado entre nós; `compileScript` em cache por expressão.
- Cada `script.run` com `timeout: 100`.
- **Dados:** enviados via `ExternalCopy` contendo apenas os nós referenciados. A análise do código detecta `$('Nome')` e `$node["Nome"]`; quando a referência é dinâmica, o contexto completo é enviado.
- **Luxon:** carregado no isolate a partir do bundle UMD (sem `require`).

### §3 Contexto de dados
- **`$input`:** objeto com `all()`, `first()`, `last()` e `item`, calculado no host e copiado.
- **`$('Nome')`:** função do isolate que consulta um mapa `nodeName → { items, params }`.
- **`.item`:** percorre `pairedItem` desde o item atual até o nó alvo. A cadeia é pré-computada no host como `pairedChain[itemIndex] → { nodeName: itemIndex }`, para evitar idas e vindas entre host e isolate.
- **`$env`:** `Object.fromEntries` das variáveis `OLLY_EXPOSED_*` com o prefixo removido.
- **`$now`/`$today`:** `DateTime.now()`/`startOf('day')` no fuso `OLLY_TIMEZONE` (padrão `America/Sao_Paulo`).

### §4 Engine
- `NodeContext.getParam(name, itemIndex)`: resolve em lote no início do nó (todos os parâmetros com expressão × todos os itens) e consulta o cache.
- **Helper `pairedItem`:** nós 1:1 preenchem automaticamente; o If preserva o índice original.
- **Pin data:** se `pinData[nodeId]` existir, o nó emite esses itens e não executa.
- **`destinationNodeId`:** executa apenas os ancestrais do nó de destino e o próprio nó.

### §5 Nós
- **`data.set`:** novo parâmetro `includeOtherFields` (padrão `false`); `keepOnlySet` é mantido como alias (`includeOtherFields = !keepOnlySet`).
- **`data.setVariable`:** `variables: [{ name, value }]` grava em `ctx.executionVars`, compartilhado pela execução.
- **`logic.if`:**
  - parâmetros `conditions: { combinator, conditions: [{ leftValue, operator: { type, operation }, rightValue }] }` e `looseTypeValidation`;
  - operações por tipo:

    | Tipo | Operações |
    |---|---|
    | string | `equals`, `notEquals`, `contains`, `notContains`, `startsWith`, `endsWith`, `regex`, `isEmpty`, `isNotEmpty` |
    | number | `equals`, `notEquals`, `gt`, `gte`, `lt`, `lte`, `isEmpty`, `isNotEmpty` |
    | boolean | `true`, `false`, `equals` |
    | dateTime | `equals`, `after`, `before` |
    | array | `contains`, `lengthEquals`, `isEmpty`, `isNotEmpty` |
    | object | `isEmpty`, `isNotEmpty` |

  - com `looseTypeValidation = false`, tipo incompatível gera erro (como no N8N).

### §6 Persistência
- Migrations de `executions` e `node_executions` particionadas por `started_at` (mensal).
- Função `olly_ensure_partitions(months_ahead int)`, chamada na inicialização da API (mês corrente + 2).
- **Truncamento:** se o JSON do nó passar de `OLLY_NODE_DATA_MAX_BYTES` (padrão 1 MB), grava os primeiros itens que couberem + `{ truncated: true, totalItems }`.
- `ExecutionRecorder` implementa os callbacks do engine.

### §7 Execução de teste e WebSocket
- **`POST /workflows/:id/test-run`** (`workflow:execute`):
  - corpo `{ definition, pinData?, destinationNodeId? }`;
  - resposta 202 `{ executionId }`;
  - execução assíncrona no processo da API.
- **Gateway `/executions`:** autentica o JWT no *handshake*. O evento `join { executionId }` verifica `execution:read` no projeto antes de entrar na sala.
- **Eventos:** `executionStarted`, `nodeStarted`, `nodeFinished { status, itemsOut, durationMs, data (truncado) }` e `executionFinished`.
- **`POST /expressions/preview`** (`workflow:execute`): avalia uma expressão sobre os dados da última execução de teste para o item 0.

### §8 Frontend
- **Painel do nó:** colunas Entrada | Parâmetros | Saída, com abas Tabela/JSON/Schema; "Executar até este nó"; "Fixar dados" com edição de JSON.
- **Canvas:** status por nó (executando, sucesso com contagem, erro) e marcador de pin.
- **Editor de expressões:**
  - alternador Fixo/Expressão por campo;
  - Monaco de uma linha (expansível em modal) com destaque de `{{ }}`;
  - *completion provider* baseado no schema inferido da última execução;
  - preview com *debounce* de 300 ms.
- **Arrastar campo:** gera `{{ $json.campo }}` (nó imediatamente anterior) ou `{{ $('Nó').item.json.campo }}`.

## Modelo de dados

`executions` e `node_executions` (particionadas), conforme [modelo-dados.md](../../docs/arquitetura/modelo-dados.md). Contrato: `WorkflowDefinition.pinData` (atualizar `contratos.md`).

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_EXPRESSION_TIMEOUT_MS` | 100 | Timeout por expressão |
| `OLLY_ISOLATE_MEMORY_MB` | 128 | Memória do isolate por execução |
| `OLLY_NODE_DATA_MAX_BYTES` | 1048576 | Limite de dados por nó no log |
| `OLLY_TIMEZONE` | `America/Sao_Paulo` | Fuso de `$now`/`$today` |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Isolate por execução (não por expressão) | Isolate por expressão | Custo de criação; isolamento entre execuções mantido |
| Avaliação em lote | IPC por item | Latência de IPC |
| Execução de teste no processo da API | Fila | A fila só chega na spec 006 (`ExecutionDispatcher` na 005) |

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001, FR-002, FR-003, FR-019 | Unidade | `compat.test.ts` (≥ 60 casos) + fixtures |
| FR-004 | Unidade | `paired-items.test.ts` (If filtrando) |
| FR-005, FR-006 | Integração | `sandbox-expressions.int.test.ts` (timeout, `process`, `require`, `constructor`) |
| FR-007 | Unidade | `expression-errors.test.ts` |
| FR-008, FR-009, FR-010 | Unidade | Testes dos nós |
| FR-011, FR-012, FR-013 | Integração | `test-run.int.test.ts`, `ws-auth.int.test.ts` |
| FR-014, FR-015 | Integração | `execution-recorder.int.test.ts` |
| FR-016, FR-017, FR-018 | E2E | `test-run.spec.ts`, `drag-field.spec.ts` |

## Riscos

| Risco | Mitigação |
|---|---|
| Desempenho de isolated-vm com muitos itens | Lote, cache de scripts, cópia só dos nós referenciados |
| Divergência sutil do N8N | Suíte de compatibilidade e fixtures reais |
