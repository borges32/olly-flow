# Plano técnico — Spec 012: Observabilidade, importador N8N e homologação

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Observabilidade:** OpenTelemetry em todos os serviços, Prometheus/Grafana/Tempo/Loki em um Compose dedicado, dashboards e alertas versionados.
- **Importador:** `packages/importer-n8n` com conversores por tipo.
- **Implantação:** Helm chart testado em kind/k3d no CI.
- **Carga e pentest:** cenários k6 e documento de escopo do pentest.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — N8N | Importador fiel à ADR-0001; credenciais não importadas |
| III | NetworkPolicy, PodSecurityContext, segredos externos |
| VIII | Traces/métricas sem payload; mascaramento nos logs centralizados |
| VI | SIEM e alvo de infraestrutura por configuração (ADR-0006) |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `apps/*` | SDK OTel; `/metrics`; correlação de logs |
| `apps/python-runner` | `opentelemetry-instrumentation-fastapi` |
| `packages/importer-n8n` | Novo |
| `apps/api` | `POST /import/n8n`; `trace_id` na execução |
| `apps/web` | `/workflows/import`, banner de pendências, link do trace |
| `infra/` | `docker-compose.observability.yml`, `grafana/dashboards`, `prometheus/rules`, `helm/olly-flow`, `load/` |
| `docs/` | `deploy.md`, `observabilidade.md`, `migracao/relatorio-poc.md`, `seguranca/escopo-pentest.md` |

## Design

### §1 Traces
- `@opentelemetry/sdk-node` com auto-instrumentação de http, fastify, pg, ioredis e bullmq.
- Contexto propagado:
  - API → fila (atributo do job);
  - worker → task-runner (campo `traceparent` na mensagem IPC);
  - worker → python-runner (header).
- **Spans:**
  - `workflow.execute`: `execution.id`, `workflow.id`, `workflow.version`, `project.id`, `trigger.type`;
  - `node.execute`: `node.id`, `node.type`, `run_index`, `items.in`, `items.out`, `status`.
- **Nunca** colocar payload em atributos. Teste com valor sentinela.
- `executions.trace_id`. Link na UI via `OLLY_TRACE_URL_TEMPLATE` (ex.: `https://grafana/explore?traceId={traceId}`).

### §2 Métricas
- `prom-client` em `/metrics` (porta interna), na API e nos workers.
- **Métricas:**
  - `olly_executions_total{status,trigger,project}`;
  - `olly_execution_duration_seconds`;
  - `olly_node_duration_seconds{node_type}`;
  - `olly_queue_waiting`, `olly_queue_active`;
  - `olly_webhook_requests_total{status}`;
  - `olly_sandbox_errors_total{runtime,reason}`;
  - `olly_llm_tokens_total{model,direction}`;
  - `olly_mcp_calls_total{server,status}`.
- **Sem `workflow_id` em histogramas.**
- **Dashboards** (`infra/grafana/dashboards/*.json`): Visão geral, Fila/Workers, Nós, IA/MCP.
- **Regras** (`infra/prometheus/rules/olly.yml`):
  - `QueueGrowing` (derivada positiva por 5 min);
  - `HighErrorRate` (limiar configurável);
  - `WorkerHeartbeatMissing`;
  - `SandboxFailures`.
- `docker-compose.observability.yml`: otel-collector, Tempo, Prometheus, Loki e Grafana com *provisioning* automático.

### §3 Logs
- O pino inclui `trace_id`/`span_id` (mixin OTel).
- O collector exporta para o Loki (dev) e para o SIEM via `OLLY_SIEM_OTLP_ENDPOINT` (sem valor padrão; não inventar).
- Teste de que o `Masker` se aplica aos logs exportados.

### §4 Importador (`packages/importer-n8n`)
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

### §5 API e UI de importação
- **`POST /api/v1/import/n8n { projectId, workflows, dryRun }`** (`workflow:create`):
  - `dryRun` retorna só o relatório;
  - caso contrário, cria os rascunhos e retorna os ids.
- **`/workflows/import`:** upload de um ou mais JSON, escolha do projeto, prévia do relatório e confirmação.
- No canvas, um banner lista as pendências com links que focam os nós.

### §6 Testes do importador e da POC
- Testes unitários por conversor.
- **`importer.int.test.ts`:** para cada fixture, importa, confere o relatório e, se não houver placeholders, executa com `input.json` e compara com `expected.json`.
- **Script `pnpm migration:report`:** gera `docs/migracao/relatorio-poc.md` (workflow, status, pendências).

### §7 Helm (`infra/helm/olly-flow/`)
- **Deployments:**
  - `api`;
  - `worker` (HPA por CPU e, opcionalmente, KEDA pela fila Redis);
  - `python-runner`;
  - `web` (nginx).

  O `task-runner` é um processo filho do worker e da API (documentar). O launcher stdio do MCP usa um adapter Kubernetes (Jobs).
- **`values.yaml`:** recursos, réplicas, variáveis e `existingSecret`. Sem segredos no chart.
- **Segurança:**
  - `NetworkPolicy`: o python-runner só aceita conexões dos workers e não tem *egress*; a API e os workers têm *egress* configurável;
  - `securityContext`: `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false` e `capabilities.drop: [ALL]` (exceções do nsjail documentadas).
- **Disponibilidade e upgrade:** probes de liveness e readiness, `PodDisruptionBudget` e Job de migrations como *hook* `pre-install,pre-upgrade`.
- **CI:** `kind` + `helm install` + `pnpm smoke` + teste de *egress* do python-runner. A CNI precisa suportar NetworkPolicy (ex.: Calico no kind).
- Se a ADR-0006 indicar outro alvo, adaptar e registrar.
- `docs/deploy.md`: instalação, upgrade, rollback e valores.

### §8 Carga (`infra/load/`)
- Cenários k6:
  1. webhook `onReceived` (HTTP + Postgres);
  2. webhook `lastNode`;
  3. 3 ramos + Merge;
  4. JS por item (1000 itens);
  5. Python com pandas (10 mil linhas);
  6. agente com `FakeChatModel` e 3 tools.
- Execução em homologação (ou Compose). Registrar throughput, p50/p95/p99, fila e memória.
- Ajustes simples (índices, pools, concorrência) documentados.

### §9 Escopo do pentest
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
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Collector |
| `OLLY_TRACE_URL_TEMPLATE` | — | Link do trace na UI |
| `OLLY_SIEM_OTLP_ENDPOINT` | — | Destino de logs institucional |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Placeholder em vez de falhar a importação | Recusar o workflow | Preserva o trabalho e mostra o que falta |
| kind no CI | Somente lint do chart | Valida NetworkPolicy e a instalação real |

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001 | Integração | `tracing.int.test.ts` (SC-001) |
| FR-001, FR-002, FR-004 | Integração | `telemetry-leak.int.test.ts` (SC-003) |
| FR-003 | Manual + lint | `promtool check rules`; *provisioning* do Grafana (SC-002) |
| FR-005–FR-009 | Unidade + integração | `converters/*.test.ts`, `importer.int.test.ts` |
| FR-010 | Integração | Fixtures (SC-004, SC-005) |
| FR-011, FR-012 | CI | `helm-kind` (SC-006, SC-007) |
| FR-013 | Carga | k6 (SC-008) |

## Riscos

| Risco | Mitigação |
|---|---|
| Muitas variações de versão de nó no N8N | Conversores por versão; placeholder como saída segura |
| Cardinalidade de métricas | Revisão de labels; sem `workflow_id` em histogramas |
