# Sprint 11 — Observabilidade, importador N8N e homologação

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também os relatórios em `docs/relatorios/`, a ADR-001 (tabela de mapeamento do importador) e a ADR-006 em `docs/decisoes.md`, e a seção 8.4 de `docs/analise_implementacao.md`.

## Pré-requisitos

- Sprint 10 concluída e todos os comandos da seção 8 passando.
- **Humano:** ADR-006 decidida (Kubernetes/nuvem). Acesso a um cluster ou namespace de homologação, se aplicável.
- **Humano:** todos os workflows da POC exportados em `fixtures/n8n/` (não só os de referência).
- **Humano:** pentest contratado ou agendado para começar nesta sprint, no ambiente de homologação.

## Contexto

A plataforma está funcionalmente completa. Agora ela precisa:
- ser **operável** (métricas, traces, logs centralizados);
- ser **implantável** em homologação/produção;
- receber os workflows da POC por meio de um **importador** automático.

## Objetivo

Observabilidade com OpenTelemetry, Helm charts e ambiente de homologação, importador N8N → Olly Flow com relatório de migração, e testes de carga completos.

## Tarefas

### T1 — OpenTelemetry
- `@opentelemetry/sdk-node` na API, no worker e no task-runner (propague o contexto via IPC). No python-runner, use `opentelemetry-instrumentation-fastapi`.
- **Trace por execução:** span raiz `workflow.execute` (atributos `execution.id`, `workflow.id`, `workflow.version`, `project.id`, `trigger.type`) e span filho por nó (`node.id`, `node.type`, `run_index`, `items.in`, `items.out`, status).
  - Auto-instrumentação de HTTP, pg, ioredis e BullMQ;
  - **sem dados de payload** nos atributos.
- O `trace_id` é gravado em `executions` e mostrado na UI com link configurável para o Tempo/Jaeger (`OLLY_TRACE_URL_TEMPLATE`).
- Exportação OTLP configurável. Adicione um *collector* + Tempo + Prometheus + Grafana + Loki em `docker-compose.observability.yml`.

### T2 — Métricas (Prometheus)
- Endpoint `/metrics` (porta interna) na API e nos workers. Métricas:
  - `olly_executions_total{status,trigger,project}`;
  - `olly_execution_duration_seconds` (histograma);
  - `olly_node_duration_seconds{node_type}`;
  - `olly_queue_waiting`, `olly_queue_active`;
  - `olly_webhook_requests_total{status}`;
  - `olly_sandbox_errors_total{runtime,reason}`;
  - `olly_llm_tokens_total{model,direction}`;
  - `olly_mcp_calls_total{server,status}`.
- Cuidado com cardinalidade: **não** use `workflow_id` como label em histogramas.
- **Dashboards Grafana** versionados em `infra/grafana/dashboards/`: visão geral, fila/workers, nós, IA/MCP.
- **Alertas** (regras Prometheus): fila crescendo por mais de 5 min, taxa de erro acima de X%, worker sem *heartbeat* e falhas do sandbox.

### T3 — Logs centralizados
- Logs pino em JSON com `trace_id` e `span_id` para correlação.
- Configuração de envio ao SIEM/ELK institucional via collector (endpoint por variável de ambiente; não invente endpoints).
- Garanta que o mascaramento da Sprint 8 vale também aqui (teste).

### T4 — Importador N8N → Olly Flow (`packages/importer-n8n`)
- **Entrada:** JSON exportado do N8N (um workflow ou um array).
- **Conversão:**
  - `nodes[]` → `WorkflowNode` (novo `id`, `name` preservado, `position` preservada);
  - `connections` (indexadas por nome) → `edges` (indexadas por id), com portas (`main[0]` → `main`, If `main[0]/[1]` → `true`/`false`, Switch → `outputN`, Merge `index` → `inputN`, `ai_*` → portas de sub-nó);
  - mapeamento de tipos conforme a tabela da ADR-001;
  - **um conversor por tipo de nó**, que mapeia `typeVersion` + `parameters` do N8N para os `params` do Olly Flow. Cobre pelo menos as versões usadas nas fixtures.
- **Expressões:**
  - mantêm a sintaxe, que é compatível;
  - converta construções conhecidas que divergem (ex.: `$vars` global do N8N → aviso);
  - marque para revisão as expressões que usam funções não suportadas (lista gerada pela suíte de compatibilidade).
- **Credenciais:** não importadas. Gere a lista `{ nomeN8N, tipoN8N, tipoOllySugerido, nósQueUsam }`.
- **Nós não suportados:** importados como `placeholder.unsupported`, com `disabled: true`, `params.originalNode` contendo o JSON original e destaque visual no canvas. A validação impede a publicação enquanto existirem placeholders.
- **Relatório de migração (JSON + exibição na UI):**
  - nós convertidos, com aviso ou não suportados;
  - expressões a revisar;
  - credenciais a cadastrar;
  - divergências de semântica conhecidas (ex.: paralelismo de ramos, que no N8N é sequencial).

### T5 — Importação na UI
- `/workflows/import` (`workflow:create`): upload de arquivo(s) JSON, escolha do projeto, prévia do relatório antes de confirmar e criação dos workflows como **rascunho**.
- Após importar, o canvas mostra um banner com as pendências e um link para cada nó problemático.
- `POST /api/v1/import/n8n` com `dryRun: boolean`.

### T6 — Testes do importador
- Para cada fixture em `fixtures/n8n/`, o teste importa, verifica o relatório e, quando não houver placeholders, executa com `input.json` e compara com `expected.json`.
- Testes unitários por conversor de nó.
- Gere `docs/migracao/relatorio-poc.md` com o resultado da importação de **todos** os workflows da POC (tabela: workflow, status, pendências).

### T7 — Helm charts e homologação
- `infra/helm/olly-flow/`: deployments de `api`, `worker` (HPA por CPU e, se disponível, KEDA pela fila), `task-runner` (*sidecar* ou processo filho, documente), `python-runner` e `web` (nginx estático).
  - `values.yaml` com recursos, réplicas e variáveis;
  - segredos via `existingSecret` (sem segredos no chart);
  - `NetworkPolicy`: o python-runner só aceita conexões dos workers e não tem saída de rede;
  - `PodSecurityContext` restritivo;
  - *probes* de liveness e readiness;
  - `PodDisruptionBudget`;
  - job de migrations como *pre-upgrade hook*.
- PostgreSQL, Redis, Vault e MinIO são **externos** ao chart (serviços gerenciados ou da instituição) e configurados via `values`.
- Se a ADR-006 apontar outro alvo (ex.: Docker Swarm/VMs), adapte e registre.
- `docs/deploy.md` com o passo a passo de instalação, upgrade e rollback.

### T8 — Testes de carga completos
- Cenários k6 em `infra/load/`:
  1. webhook `onReceived` com workflow HTTP + Postgres;
  2. webhook `lastNode`;
  3. workflow com 3 ramos paralelos + Merge;
  4. código JS por item (1000 itens);
  5. Python com pandas (10 mil linhas);
  6. agente com FakeChatModel e 3 tools.
- Execute contra o ambiente de homologação (ou Compose, se a homologação não estiver disponível) e registre os resultados no relatório.
- Identifique os gargalos e aplique ajustes simples: índices, tamanho de pools, concorrência dos workers.
- As **metas de carga** devem ser definidas pelo PO. Se não houver, registre as medições como baseline e marque as metas como pendência.

### T9 — Apoio ao pentest
- `docs/seguranca/escopo-pentest.md`: arquitetura, superfícies de ataque (webhooks, API, WebSocket, sandbox JS/Python, MCP, agentes, importador), usuários de teste por papel e áreas fora do escopo.
- Massa de dados e usuários de teste no ambiente de homologação.

## Fora do escopo

Corrigir os achados do pentest (Sprint 12), deploy em produção e treinamento.

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | Uma execução gera trace com span por nó, visível no Grafana/Tempo a partir do link na UI | Manual + integração |
| 2 | Dashboards e alertas versionados e carregados automaticamente no Compose de observabilidade | Manual |
| 3 | Nenhum payload ou segredo aparece em traces, métricas ou logs | Integração (busca por valores sentinela) |
| 4 | 100% dos workflows da POC importados; `docs/migracao/relatorio-poc.md` gerado | Teste + documento |
| 5 | Fixtures sem placeholders executam com resultado igual ao `expected.json` | `importer.test.ts` |
| 6 | `helm install` em cluster de teste (kind/k3d no CI) sobe todos os componentes saudáveis e roda o smoke test | CI |
| 7 | NetworkPolicy impede o python-runner de acessar a rede externa | Teste no kind/k3d |
| 8 | Resultados dos 6 cenários de carga registrados no relatório | Relatório |
| 9 | Toda a suíte das sprints anteriores verde | CI |

## Entrega

Código, `infra/helm/`, `infra/grafana/`, `infra/load/`, `docs/deploy.md`, `docs/observabilidade.md`, `docs/migracao/relatorio-poc.md`, `docs/seguranca/escopo-pentest.md` e o relatório `docs/relatorios/sprint-11.md`.
