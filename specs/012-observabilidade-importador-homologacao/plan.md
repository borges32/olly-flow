# Plano técnico — Spec 012: Observabilidade (OpenTelemetry) e importador N8N

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Observabilidade:** SDK OpenTelemetry na API, nos workers e nos runners, com traces, métricas e logs exportados por **OTLP** para um coletor OTel configurável. A plataforma não armazena nem exibe telemetria: painéis, alertas e retenção ficam nas ferramentas da instituição, atrás do coletor.
- **Importador:** `packages/importer-n8n` com conversores por tipo.
- **Pentest:** documento de escopo.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — N8N | Importador fiel à ADR-0001; credenciais não importadas |
| VIII | Traces, métricas e logs sem payload; mascaramento nos logs exportados |
| VI | Destino da telemetria por configuração (variáveis padrão do OpenTelemetry), sem fornecedor fixo |
| IV | Coletor OTLP de teste em processo nos testes de integração |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/telemetry` | Novo: inicialização do SDK OTel (traces, métricas, logs), atributos de recurso, utilitários de span e propagação |
| `apps/api`, `apps/worker` | Inicialização da telemetria antes do Nest; spans de execução e de nó; métricas; logs correlacionados |
| `packages/engine` | Sem mudança: os spans de nó saem dos callbacks do runner (`onNodeStart`/`onNodeFinish`) |
| `apps/task-runner` | Spans `taskrunner.evaluate`/`taskrunner.code` e métrica de falhas do sandbox no cliente (processo do worker); o processo filho continua sem segredos e sem SDK |
| `apps/python-runner` | Quando existir (spec 008): `opentelemetry-instrumentation-fastapi`, contexto pelo header |
| `packages/importer-n8n` | Novo |
| `apps/api` | `POST /import/n8n`; `trace_id` na execução |
| `apps/web` | `/workflows/import` e banner de pendências |
| `infra/` | Serviço opcional `otel-collector` no Compose (perfil `otel`, exportador `debug`) para desenvolvimento |
| `docs/` | `observabilidade.md`, `migracao/relatorio-poc.md`, `seguranca/escopo-pentest.md` |

## Design

### §1 Inicialização e exportação (FR-004)
- `packages/telemetry` configura `@opentelemetry/sdk-node` com:
  - exportadores OTLP de traces, métricas e logs (`@opentelemetry/exporter-*-otlp-http`; gRPC só se a instituição exigir);
  - `BatchSpanProcessor`, `PeriodicExportingMetricReader` e `BatchLogRecordProcessor`, com filas limitadas (o excedente é descartado);
  - recurso com `service.name` (`olly-api`, `olly-worker`, `olly-task-runner`), `service.version` e `deployment.environment`.
- **Configuração:** as variáveis padrão do OpenTelemetry (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_SERVICE_NAME`, `OTEL_SDK_DISABLED`). Sem `OTEL_EXPORTER_OTLP_ENDPOINT`, o SDK não é iniciado (telemetria desligada).
- **Falha do coletor:** a exportação é assíncrona; erros do exportador vão para o log local (com limite de frequência) e nunca para o caminho da execução.
- O SDK é iniciado antes do Nest (primeiro import de `main.ts`). Auto-instrumentação só de `http` (spans de servidor das requisições da API, inclusive webhooks): no ESM, `pg`, `ioredis` e `bullmq` importados por módulos ESM não passam pelo `require` e exigiriam o *loader* `--import`; os spans de domínio (execução, nó, runner) são manuais.

### §2 Traces (FR-001)
- Contexto propagado:
  - API → fila (`traceparent`/`tracestate` nos dados do job; span `execution.enqueue` do tipo *producer*);
  - worker → python-runner (header), quando existir.
- **Spans:**
  - `workflow.execute`: `olly.execution.id`, `olly.workflow.id`, `olly.workflow.version`, `olly.project.id`, `olly.trigger.type`, `olly.execution.mode`;
  - `node.execute`: `olly.node.id`, `olly.node.type`, `olly.node.run_index`, `olly.items.in`, `olly.items.out`, status do span pelo resultado;
- Os spans de nó são abertos e fechados pelos callbacks do runner (`onNodeStart`/`onNodeFinish`), com os horários do motor; nós com dados fixados ou reaproveitados também geram span. A execução inteira roda no contexto do span raiz, o que correlaciona os logs e propaga o contexto ao task-runner.
- O task-runner é um processo filho com ambiente mínimo e sem segredos (spec 003): ele não recebe as variáveis OTEL (que podem conter a credencial do coletor). Os spans `taskrunner.evaluate` e `taskrunner.code` são criados pelo cliente, no processo do worker, em volta de cada chamada IPC, como filhos do contexto ativo.
- Retomada (spec 008): nova raiz `workflow.execute` com `olly.execution.resumed=true`; o `trace_id` gravado é o da primeira execução.
- **Nunca** colocar payload em atributos. Teste com valor sentinela.
- `executions.trace_id` gravado no início da execução.

### §3 Métricas (FR-002)
- API de métricas do OpenTelemetry, exportadas por OTLP:
  - `olly.executions` (contador; `status`, `trigger`, `project`);
  - `olly.execution.duration` (histograma, segundos; `status`, `trigger`);
  - `olly.node.duration` (histograma; `node_type`);
  - `olly.queue.waiting`, `olly.queue.active` (*gauges* observáveis);
  - `olly.webhook.requests` (`status`);
  - `olly.sandbox.errors` (`runtime`, `reason`);
  - `olly.llm.tokens` (`model`, `direction`);
  - `olly.mcp.calls` (`server`, `status`).
- **Sem `workflow_id` nem `execution_id` em histogramas.**
- O endpoint `/metrics` (texto Prometheus) do worker, da spec 006, continua como está.

### §4 Logs (FR-003)
- O pino ganha `trace_id` e `span_id` do contexto ativo, acrescentados **depois** do mascaramento (para os ids não serem confundidos com dados pessoais), e um segundo destino (`pino.multistream`) converte cada linha em um registro de log OTel (`@opentelemetry/api-logs`), com severidade, corpo e atributos.
- O mascaramento da spec 009 (`maskingLogOptions`) é aplicado **antes** da exportação, pois o destino recebe a linha já serializada; teste de que o exportado sai mascarado.
- A saída local (stdout) continua; o envio ao SIEM, se houver, é feito pelo coletor da instituição.

### §5 Importador (`packages/importer-n8n`) — passou para a spec 015

> Desde 07/10/2026 o importador é da [spec 015](../015-exportar-importar-json/plan.md); esta seção fica como histórico.
- **Entrada:** objeto ou array de workflows do N8N. Saída: `{ workflows: WorkflowDefinition[], report }`.
- **Nós:** novo `id` (uuid); `name` e `position` preservados; `disabled` preservado.
- **Conexões:** `connections[sourceName][type][outputIndex] = [{ node, type, index }]` → `Edge`, com o mapeamento de portas:

  | Origem no N8N | Porta no Olly Flow |
  |---|---|
  | `main[i]` (padrão) | `main` |
  | If `main[0]`/`[1]` | `true`/`false` |
  | Switch `main[i]` | `output{i}` |
  | Merge, `index` de entrada | `input{index+1}` |
  | `splitInBatches` v3 `main[0]`/`[1]` | `done`/`loop` |
  | `ai_languageModel` / `ai_memory` / `ai_tool` | Portas de sub-nó |

- **Conversores:** `converters/<tipoN8N>.ts`, com `supports(typeVersion)` e `convert(parameters) → { type, params, warnings }`. Cobrem os tipos da tabela da ADR-0001 e as versões presentes nas fixtures.
- **Expressões:** mantidas. Uma varredura marca, para revisão:
  - uso de `$vars`, que tem semântica diferente no N8N;
  - funções fora da lista suportada (gerada a partir da suíte de compatibilidade);
  - `$fromAI` fora de tools.
- **Credenciais:** removidas. O relatório lista `{ nameN8N, typeN8N, suggestedType, nodes[] }`.
- **Não suportados:** `placeholder.unsupported` com `disabled: true` e `params.originalNode`. `validate.ts` emite o erro `UNSUPPORTED_NODE` na publicação.
- **Relatório:** `{ nodes: { converted, withWarnings, unsupported }, expressionsToReview[], credentialsToCreate[], semanticNotes[] }`. As notas semânticas incluem, por exemplo, que ramos executam em paralelo.

### §6 API e UI de importação
- **`POST /api/v1/import/n8n { projectId, workflows, dryRun }`** (`workflow:create`):
  - `dryRun` retorna só o relatório;
  - caso contrário, cria os rascunhos e retorna os ids.
- **`/workflows/import`:** upload de um ou mais JSON, escolha do projeto, prévia do relatório e confirmação.
- No canvas, um banner lista as pendências com links que focam os nós.

### §7 Testes do importador e da POC
- Testes unitários por conversor.
- **`importer.int.test.ts`:** para cada fixture, importa, confere o relatório e, se não houver placeholders, executa com `input.json` e compara com `expected.json`.
- **Script `pnpm migration:report`:** gera `docs/migracao/relatorio-poc.md` (workflow, status, pendências).

### §8 Escopo do pentest
- `docs/seguranca/escopo-pentest.md`:
  - arquitetura;
  - superfícies: webhooks, API, WebSocket, sandbox JS/Python, MCP, agentes, importador, OAuth;
  - usuários de teste por papel;
  - massa de dados;
  - exclusões;
  - contatos.

## Modelo de dados

Nova coluna `executions.trace_id`. Nenhuma tabela nova.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — (telemetria desligada) | Endereço do coletor OTel |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | Protocolo OTLP |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Cabeçalhos (ex.: autenticação do coletor); tratado como segredo |
| `OTEL_RESOURCE_ATTRIBUTES` | — | Atributos de recurso (ex.: `deployment.environment=homologacao`) |
| `OTEL_SDK_DISABLED` | `false` | Desliga a telemetria mesmo com endereço |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Só exportar por OTLP | Prometheus, Grafana, Tempo e Loki no projeto; link do trace na UI | Decisão humana: a observabilidade fica nas ferramentas da instituição; OTLP é o padrão neutro |
| Variáveis padrão do OpenTelemetry | Variáveis `OLLY_*` próprias | Operadores já conhecem; compatível com qualquer coletor |
| Placeholder em vez de falhar a importação | Recusar o workflow | Preserva o trabalho e mostra o que falta |

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001, FR-004 | Integração | `tracing.int.test.ts` com coletor OTLP de teste em processo (SC-001) |
| FR-002, FR-003 | Integração | `telemetry-export.int.test.ts`: métricas e logs correlacionados no coletor de teste (SC-002) |
| FR-001–FR-003 | Integração | `telemetry-leak.int.test.ts` com valores sentinela (SC-003) |
| FR-004 | Integração | Coletor desligado e inacessível: execuções normais (SC-006); NFR-001 medido no mesmo teste |
| FR-005–FR-009 | Unidade + integração | `converters/*.test.ts`, `importer.int.test.ts` |
| FR-010 | Integração | Fixtures (SC-004, SC-005) |
| FR-011 | Revisão | Documento de escopo do pentest |

## Riscos

| Risco | Mitigação |
|---|---|
| Muitas variações de versão de nó no N8N | Conversores por versão; placeholder como saída segura |
| Cardinalidade de métricas | Revisão de atributos; sem `workflow_id` em histogramas |
| Coletor lento ou fora do ar | Exportação em lote, filas limitadas e descarte; nada no caminho da execução |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 06/10/2026 | Reescrito conforme a spec (Histórico de 06/10/2026): observabilidade só por OTLP para um coletor OTel (sem Prometheus/Grafana/Tempo/Loki no projeto, sem link do trace na UI, sem envio direto ao SIEM); removidos Helm (§7 antigo) e carga (§8 antigo); novo `packages/telemetry` | Decisão humana |
| 06/10/2026 | Implementação da HU-1 (decisão humana: só a telemetria nesta rodada; importador e pentest pendentes): spans de nó pelos callbacks do runner (motor sem mudança); auto-instrumentação só de `http` (ESM); logs exportados por um destino do pino após o mascaramento, com os ids do trace acrescentados depois dele; spans do task-runner criados no cliente (o filho segue sem segredos nem SDK); sem spans `gen_ai.*` nesta rodada (o uso de LLM vai nas métricas) | Limitações do ESM, segurança do processo filho e simplicidade |
| 07/10/2026 | §5, §6 (importação) e §7 (testes do importador) passaram para o plano da spec 015 | Decisão humana: importador junto com a importação do formato do Olly Flow |
