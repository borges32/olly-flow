# Plano técnico — Spec 006: Fila, workers e paralelismo

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Fila:** `QueueDispatcher` (BullMQ) substitui o dispatcher em processo na produção, com `apps/worker` standalone e eventos via Redis pub/sub.
- **Engine:** passa a ser um agendador de DAG concorrente com propagação de "sem dados".
- **Controle:** paralelismo por item, cancelamento, timeout e cotas.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — N8N | Divergência de paralelismo prevista na ADR-0001 e documentada em `docs/execucao.md` |
| IV — Testes | Determinismo testado com várias execuções; teste de queda de worker |
| VIII — Observabilidade | Linha do tempo de execução; métricas de carga |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `apps/api` | `QueueDispatcher`; relay de eventos Redis → WebSocket; endpoint de cancelamento |
| `apps/worker` | Novo: consumidor BullMQ + engine + task-runner próprio |
| `packages/engine` | Agendador concorrente, "sem dados", `parallelItems`, `AbortSignal` global |
| `packages/db` | `execution_payloads`; `projects.max_concurrent_executions` |
| `apps/web` | Animação de nós/arestas ativos; aba "Linha do tempo"; botão "Parar" |
| `infra` | Dockerfiles multi-stage; Compose com `api` e `worker`; `infra/load/webhook.js` |

## Design

### §1 `QueueDispatcher`
- Fila `executions`. Job `{ executionId }`.
- **`dispatch`:**
  1. insere `executions(status=queued)`;
  2. grava o payload do gatilho em `execution_payloads` (ou no MinIO se maior que 1 MB);
  3. adiciona o job.
- **`waitForResult`:** subscreve `execution:<id>:finished` antes de enfileirar, evitando condição de corrida.
- `OLLY_TEST_RUN_MODE=inprocess|queue` (padrão `queue`). O modo `inprocess` fica para testes.

### §2 Worker
- NestJS `createApplicationContext` + servidor HTTP mínimo (`/health`, `/metrics`) em porta interna.
- `Worker('executions', processor, { concurrency: OLLY_WORKER_CONCURRENCY })`.
- **Processor:**
  1. carrega a execução e a versão;
  2. marca `running`;
  3. roda o engine com `ExecutionRecorder` e `RedisEventPublisher`;
  4. publica `finished`.
- **SIGTERM:** `worker.close()` aguarda até `OLLY_WORKER_SHUTDOWN_TIMEOUT`. Jobs não concluídos são devolvidos.
- **Stalled:** o evento `stalled`/`failed` com `attemptsMade` > 0 marca a execução `error` com `reason: worker_lost`. O job usa `attempts: 1`, sem nova tentativa.
- **Varredura de segurança:** a cada minuto, execuções `running` sem *heartbeat* (`executions.heartbeat_at`, atualizado a cada 10 s) há mais de 60 s são marcadas `worker_lost`.

### §3 Agendador de DAG
- **Estado por nó:** `pending | ready | running | done | skipped`. Por porta de entrada: `unresolved | data | noData`.
- **Prontidão:** todas as portas de entrada conectadas resolvidas e pelo menos uma com `data`. Se todas forem `noData`, o nó vira `skipped` e propaga `noData` para as suas saídas.
- **Laço principal:**
  1. `takeReady()`;
  2. `p-limit(maxParallel)` para cada nó;
  3. `Promise.race` sobre o conjunto em andamento;
  4. repete até não haver nós prontos nem em execução.
- **Determinismo:** as saídas ficam em `outputs[nodeId][port]`. A entrada de um nó com várias arestas na mesma porta é concatenada **na ordem estável das arestas** (por `edge.id` na definição), nunca pela ordem de chegada.
- `maxParallel = 1` reproduz o comportamento sequencial; a suíte anterior deve continuar verde.

### §4 Paralelismo por item
- `NodeDefinition.supportsParallelItems`. Para os nós por item (HTTP, Postgres `perItem`, `postgres.write` sem transação, código JS por item), o engine fornece o helper `ctx.mapItems(fn)`, que usa `p-limit(concurrency)` quando `parallelItems.enabled` e preserva os índices.

### §5 Cancelamento e timeout
- **`POST /executions/:id/cancel`** (`workflow:execute`): publica em `execution:<id>:cancel`.
- O worker mantém um `AbortController` raiz por execução. Os nós recebem sinais derivados. O task-runner recebe `disposeExecution`.
- **Timeout:** `settings.timeoutSec ?? OLLY_DEFAULT_WORKFLOW_TIMEOUT` (300). Ao estourar, aborta com `reason: timeout`.

### §6 Cotas por projeto
- `projects.max_concurrent_executions` (padrão `OLLY_PROJECT_MAX_CONCURRENT`).
- **Semáforo Redis por projeto** (`INCR` com TTL de segurança + `DECR` no fim). Sem vaga, o job é adiado (`moveToDelayed` por 1 s) e a execução continua `queued`.
- `GET /projects/:id/queue-stats` alimenta um indicador na UI.

### §7 Frontend
- Status `running` em vários nós; arestas animadas enquanto o nó de destino executa.
- **Aba "Linha do tempo":** Gantt simples (SVG) a partir de `node_executions` (início e fim).
- Botão "Parar execução" no editor e na tela de execuções.

### §8 Infra e carga
- Dockerfiles multi-stage (`api`, `worker`, `web`). Compose com `worker` escalável (`--scale worker=3`).
- **k6 `infra/load/webhook.js`:** 50 VUs por 2 min, webhook → HTTP mock → Postgres insert, nos modos `onReceived` e `lastNode`.

## Modelo de dados

- Nova tabela `execution_payloads (execution_id, data JSONB, data_ref TEXT)`.
- Novas colunas `executions.heartbeat_at` e `projects.max_concurrent_executions`.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_WORKER_CONCURRENCY` | 10 | Jobs simultâneos por worker |
| `OLLY_WORKER_SHUTDOWN_TIMEOUT` | 60 s | Espera no SIGTERM |
| `OLLY_DEFAULT_WORKFLOW_TIMEOUT` | 300 s | Timeout global padrão |
| `OLLY_PROJECT_MAX_CONCURRENT` | 20 | Cota padrão por projeto |
| `OLLY_TEST_RUN_MODE` | `queue` | Execução de teste via fila ou em processo |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Não reexecutar após `worker_lost` | Retry automático | Evitar efeitos colaterais duplicados (inserts, POSTs) |
| Concatenação por ordem de aresta | Ordem de chegada | Determinismo |
| Semáforo Redis | Grupos do BullMQ Pro | Sem dependência de licença comercial |

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001, FR-002, FR-003 | Integração | `queue-dispatcher.int.test.ts` |
| FR-004, FR-005 | Integração | `worker-resilience.int.test.ts` (kill do processo) |
| FR-006, FR-008 | Integração | `parallel.int.test.ts` (SC-001, SC-002) |
| FR-007 | Unidade | `no-data-propagation.test.ts` |
| FR-009 | Integração | `parallel-items.int.test.ts` (SC-003) |
| FR-010, FR-011 | Integração | `cancel.int.test.ts` (SC-005) |
| FR-012 | Integração | `project-quota.int.test.ts` (SC-006) |
| FR-013 | E2E | `timeline.spec.ts` |
| NFR-002 | Carga | k6 (resultados no relatório) |

## Riscos

| Risco | Mitigação |
|---|---|
| Não determinismo sutil | Teste de 20 execuções + suíte com `maxParallel` 1 e 8 (spec 007) |
| Condição de corrida no pub/sub | Subscrever antes de enfileirar |

Ao concluir, produzir `docs/execucao.md` com a semântica: prontidão, "sem dados", paralelismo, cancelamento e recuperação.
