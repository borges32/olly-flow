# Relatório — Spec 006: Fila, workers e paralelismo

**Status:** Implementada
**Data:** 05/10/2026

## Resumo

- **Fila e workers:**
  - as execuções vão para uma fila BullMQ (Redis) que leva só o id; o payload fica em `execution_payloads`, ou no MinIO acima de 1 MB;
  - workers independentes (`apps/worker`, escaláveis com `--scale worker=N`) executam com o mesmo `ExecutionRunner` da API, com o próprio task runner;
  - eventos, respostas síncronas de webhook e invalidação de rotas passam pelo Redis e valem com várias instâncias da API.
- **Resiliência:**
  - encerramento gracioso no SIGTERM;
  - batimento por execução e varredura `worker_lost`;
  - job travado falha em vez de voltar à fila (nunca reexecuta).
- **Motor:**
  - agendador de DAG concorrente (`maxParallel`, padrão 8), estados por porta e propagação de "sem dados";
  - entrada montada na ordem das arestas (determinística);
  - itens em paralelo com concorrência e ordem preservada (`ctx.mapItems`);
  - cancelamento pelo sinal raiz e timeout global.
- **Controle:**
  - `POST /executions/:id/cancel` (interrompe HTTP, SQL com `pg_cancel_backend` e código no sandbox);
  - cota de execuções simultâneas por projeto, com semáforo no Redis, `queue-stats` e `PUT /projects/:id/quota`.
- **Editor:**
  - vários nós em execução ao mesmo tempo, com arestas animadas;
  - painel "Linha do tempo" (Gantt em SVG) e botão "Parar execução";
  - na tela de execuções: indicador da fila, "Parar" e novos status;
  - aba Configurações com "Itens em paralelo".
- **Carga:** k6 em `infra/load` (resultados abaixo).
- **Semântica documentada** em [`docs/execucao.md`](../../docs/execucao.md).

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `infra/migrations/0007_queue` (`execution_payloads`, `executions.heartbeat_at`, `projects.max_concurrent_executions`); `schema.ts`, `modelo-dados.md` |
| T002 | ✅ | `infra/docker/Dockerfile` (alvos `api`, `worker`, `web`); compose com `worker` escalável (sem porta publicada) e serviço `mock` (profile `load`) |
| T010 | ✅ | `packages/engine/src/state.ts` (`portStates`, `readiness`, `collect`) |
| T011 | ✅ | `packages/engine/src/run.ts` (laço concorrente, `maxParallel`, erro pela ordem topológica, `order` no resultado) |
| T012 | ✅ | Unidade e integração de engine, nodes e API rodadas também com `OLLY_DEFAULT_MAX_PARALLEL=1`: tudo verde |
| T020 | ✅ | `apps/api/src/queue/queue-dispatcher.ts`, `payloads.ts`, `routing-dispatcher.ts`; `executions/result-bus.ts` |
| T021 | ✅ | `apps/api/src/worker/*` (exportado como `@olly/api/worker`) + `apps/worker` (processo, SIGTERM, `/health` e `/metrics`) |
| T022 | ✅ | `executions/event-relay.ts` + `ExecutionEventSink` (`RedisEventPublisher` no worker) |
| T023 | ✅ | Batimento no `ExecutionRunner`; `queue/worker-lost.ts`, `worker-lost-sweeper.ts`; `maxStalledCount: 0` |
| T024 | ✅ | `worker/worker-resilience.int.test.ts` (SIGKILL num worker em processo separado) |
| T030 | ✅ | `executions/parallel.int.test.ts`; `packages/engine/src/scheduler.test.ts` |
| T031 | ✅ | `supportsParallelItems` em `http.request`, `postgres.query` e `postgres.write`; `NodeContext.mapItems`; aba Configurações |
| T032 | ✅ | `parallel.int.test.ts` › SC-003; `http-request.test.ts` › FR-009 |
| T040 | ✅ | `ExecutionCancelledError` no motor; cancelamento e timeout no `ExecutionRunner`; `CodeSandbox.disposeExecution` |
| T041 | ✅ | `queue/quota.ts` (sorted set com validade), `GET /projects/:id/queue-stats`, `PUT /projects/:id/quota` |
| T042 | ✅ | `executions/cancel.int.test.ts`, `queue/project-quota.int.test.ts` |
| T050 | ✅ | `execution-timeline.tsx`/`timeline.ts`, `editor-page.tsx`, `workflow-node.tsx`, `executions-page.tsx`, `node-settings.tsx` |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ✅ | Ver "Carga (NFR-002)" |
| T092 | ✅ | `docs/execucao.md`; também `contratos.md`, `modelo-dados.md`, `README.md`, `.env.example`, `apps/worker/README.md`, `infra/load/README.md` |
| T093 | ✅ | Este relatório; status em `spec.md` e `docs/roadmap.md` |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `apps/api/src/queue/queue-dispatcher.int.test.ts` › "FR-001…" (job só com o id; payload em `execution_payloads`; sem worker fica `queued`, um worker independente executa); `queue/payloads.test.ts` (acima de 1 MB vai para o object storage) |
| FR-002 | Sim | `queue-dispatcher.int.test.ts` › "FR-002…" (`lastNode` e `responseNode` respondidos pelo worker); toda a suíte `webhook.int.test.ts` agora passa pela fila |
| FR-003 | Sim | `queue-dispatcher.int.test.ts` › "FR-003: com duas APIs…" (editor na API B recebe os eventos da execução iniciada na API A; publicação na A atualiza as rotas da B); `executions.int.test.ts` e `ws.int.test.ts` pela fila |
| FR-004 | Sim | `worker/worker-resilience.int.test.ts` › "FR-004…" (para de consumir, `/health` 503, espera a execução em andamento, a próxima fica na fila; passado o limite, `worker_lost` sem voltar à fila) |
| FR-005 | Sim | `worker-resilience.int.test.ts` › "SC-004…" (SIGKILL → `error`/`worker_lost`; job reentregue não reexecuta) |
| FR-006 | Sim | `packages/engine/src/scheduler.test.ts` › "FR-006…" (ramos simultâneos, limite `maxParallel`, `maxParallel = 1` sequencial, nada novo após erro); `parallel.int.test.ts` › "SC-001" e "FR-006: maxParallel = 1…" |
| FR-007 | Sim | `packages/engine/src/no-data-propagation.test.ts` |
| FR-008 | Sim | `scheduler.test.ts` › "FR-008/SC-002…" e "FR-008: com erros em dois ramos…"; `engine.test.ts` › "a entrada segue a ordem das arestas"; `parallel.int.test.ts` › "SC-002" |
| FR-009 | Sim | `packages/nodes/src/shared/concurrency.test.ts`; `http-request.test.ts` › "FR-009/SC-003"; `scheduler.test.ts` › "FR-009…"; `parallel.int.test.ts` › "SC-003" |
| FR-010 | Sim | `executions/cancel.int.test.ts` (em andamento, na fila, RBAC, 409, auditoria); `scheduler.test.ts` › "FR-010"; `in-process-dispatcher.test.ts` › "FR-010"; `packages/expressions/src/code.test.ts` › "FR-010" (código interrompido); `apps/web/e2e/timeline.spec.ts` › "FR-010" |
| FR-011 | Sim | `cancel.int.test.ts` › "FR-011…" (`settings.timeoutSec` e padrão da plataforma); `scheduler.test.ts` › "FR-011"; `config.test.ts` › "spec 006" |
| FR-012 | Sim | `queue/project-quota.int.test.ts` (cota 2 → 3ª na fila; só a administração altera; auditoria; `null` volta ao padrão) |
| FR-013 | Sim | `apps/web/e2e/timeline.spec.ts` › "FR-013" (dois nós `running` juntos, 2 arestas animadas, linha do tempo com barras sobrepostas); `timeline.test.ts`; `store.test.ts` › "spec 006" |
| FR-014 | Sim | `docker compose --profile app --profile load up --scale worker=3`: 3 workers saudáveis, distribuição observada na carga (60 execuções simultâneas = 3 × 20) |
| NFR-001 | Sim | `cancel.int.test.ts` › "SC-005" (status e `pg_sleep` encerrados em < 2 s); `scheduler.test.ts` (< 1 s) |
| NFR-002 | Sim | `infra/load/run.sh` (k6); números em "Carga (NFR-002)" |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `parallel.int.test.ts` › "SC-001": 3 HTTP de 1 s entre o início do primeiro e o fim do último ramo, entre 0,95 s e 1,8 s |
| SC-002 | ✅ | `parallel.int.test.ts` › "SC-002": 20 execuções com tempos de ramo sorteados → uma única saída, na ordem das arestas |
| SC-003 | ✅ | `parallel.int.test.ts` › "SC-003": 20 itens × 500 ms, concorrência 5 → entre 1,9 s e 3,2 s, ordem preservada |
| SC-004 | ✅ | `worker-resilience.int.test.ts` › "SC-004" (processo do worker morto com SIGKILL) |
| SC-005 | ✅ | `cancel.int.test.ts` › "SC-005": `pg_stat_activity` sem o `pg_sleep(30)` em menos de 2 s após o cancelamento |
| SC-006 | ✅ | `project-quota.int.test.ts` › "SC-006": `queue-stats` = 2 em execução, 1 na fila; a 3ª só começa quando uma termina; pico de 2 no servidor |
| SC-007 | ✅ | Suíte anterior verde passando pela fila e pelo worker; k6 abaixo |

## Carga (NFR-002)

**Ambiente:** `infra/load/run.sh` em 05/10/2026, numa máquina de desenvolvimento.
- Compose com 1 API e 3 workers (`OLLY_WORKER_CONCURRENCY=20`), Postgres, Redis e um mock HTTP (nginx).
- Workflow: Webhook → `http.request` (mock) → `postgres.query` (INSERT), com a cota do projeto em 500.
- Carga: 50 VUs por 2 min em cada modo.

| Métrica | `onReceived` (202, entrada na fila) | `lastNode` (200, caminho completo) |
|---|---|---|
| Requisições | 83.077 (692 req/s) | 14.022 (116,6 req/s) |
| Falhas | 0 | 0 |
| Latência HTTP p50 / p95 / p99 | 66 / 121 / 169 ms | 442 / 608 / 678 ms |
| Latência máxima | 300 ms | 753 ms |
| Execuções concluídas pelos workers | ~112/s (6.726 no último minuto) | = requisições (116,6/s) |
| Fila (execuções `queued`) | até 71.862: a entrada (692/s) supera a vazão dos 3 workers | 0 a 17 |
| Execuções simultâneas | 55–60 (3 × 20) | até 60 |
| Memória por worker (pico) | 182–186 MiB | 203–233 MiB |
| Memória da API (pico) | 144 MiB | 129 MiB |
| CPU por worker (média) | — | ~123 % (o worker é o gargalo) |

Leitura:
- A API aceita webhooks bem acima da capacidade de execução: no `onReceived`, a diferença vira fila durável, sem erro nem perda.
- A vazão sobe com mais workers (`--scale`).
- Cerca de 490 ms por execução, com mock instantâneo, indica custo de CPU no worker e o pool Postgres pequeno (`OLLY_PG_POOL_MAX=5` por worker e por credencial, para 20 jobs simultâneos). Ajuste e perfilamento ficam para a spec 012 (metas de carga NFR-G08).
- Na primeira rodada, o `run.sh` executou o `onReceived` antes do `lastNode`, e a fila acumulada distorceria o segundo modo. A fila foi descartada (65.930 execuções da carga marcadas `cancelled` direto no banco) e o `lastNode` rodou sem fila. O script agora roda o síncrono primeiro.

## Comandos de verificação

Executados em 05/10/2026.

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 470 testes (expressions 124, nodes 122, engine 65, web 57, api 26, shared-types 12, task-runner 8, db 5, repositório 51) |
| `pnpm test:integration` | ✅ 196 testes (api 150, nodes 23, db 20, engine 3) |
| Regressão sequencial (`OLLY_DEFAULT_MAX_PARALLEL=1`, engine + nodes + api, unidade e integração) | ✅ |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 27 testes (2 novos da spec 006) |
| `docker compose up -d && pnpm smoke` | ✅ |
| `pnpm audit --audit-level=high` | ✅ 0 altas; 1 moderada (`uuid`, via Testcontainers, só testes; já registrada) |
| `infra/load/run.sh 3 2m 50` | ✅ imagens com o código da spec; 3 workers saudáveis; resultados em "Carga (NFR-002)" |

## Decisões tomadas

Registradas no "Histórico de alterações" de `plan.md` (05/10/2026):

- **Onde fica o worker:** o código fica em `apps/api/src/worker`, exportado como `@olly/api/worker`, e `apps/worker` é o processo implantável. Assim o worker reaproveita banco, nós, credenciais, binários e o `ExecutionRunner` sem duplicar código nem criar um pacote novo.
- **Despacho:**
  - `RoutingDispatcher`: produção sempre pela fila; testes pela fila (padrão) ou em processo (`OLLY_TEST_RUN_MODE=inprocess`);
  - `ExecutionDispatcher` ganhou `initialStatus` e `cancel`;
  - o `jobId` é o id da execução, com `attempts: 1`.
- **Resultados pelo Redis:** chave com TTL + publicação no canal da execução. Quem espera assina antes de ler a chave (plan §1: sem condição de corrida).
- **Eventos:** toda emissão da API também passa pelo Redis (relay), para que `testWebhookReceived` e afins cheguem a editores ligados em outra instância. Se o Redis falhar, a entrega é só local.
- **Rotas de webhook:** a publicação avisa as outras instâncias da API pelo Redis para recarregarem o cache. Sem isso, cada instância serviria rotas antigas.
- **Batimento:** feito pelo `ExecutionRunner` (fila e em processo).
  - **Varredura:** fica na API.
  - **Recorder:** só finaliza execução ainda `running`, então um `worker_lost` já gravado prevalece.
  - **Worker ao pegar o job:** só começa execução `queued`, o que impede reexecução.
- **SIGTERM:** execuções que passam do limite terminam `error`/`worker_lost` em vez de "devolvidas", porque devolver reexecutaria e contrariaria a FR-005. Os jobs não iniciados continuam na fila.
- **Status:** cancelamento e timeout terminam com status `cancelled` e `error.reason`; `worker_lost` termina com `error`. `ExecutionErrorInfo.reason` foi adicionado aos tipos compartilhados.
- **Determinismo do `lastNode`:** usa a ordem topológica. Com erros em vários ramos, vale o primeiro na ordem topológica.
- **Cota:**
  - sorted set com validade por vaga, renovada no batimento, em vez de `INCR`/TTL/`DECR` (com contador único, o TTL de um worker morto zeraria as vagas dos outros);
  - sem vaga, `moveToDelayed` + `DelayedError`;
  - alterada só pela administração da plataforma.
- **Paralelismo por item:** helper próprio `mapWithConcurrency` (sem `p-limit`). O nó de código não é elegível: o modo por item já roda todos os itens numa única chamada ao sandbox.
- **Cancelamento do código:** o task runner interrompe o isolate da execução no `disposeExecution`.
- **Porta do worker:** `OLLY_WORKER_PORT` padrão 3101, não 3001, que é usada com frequência por outras ferramentas (nesta máquina, o VS Code).
- **`OLLY_DEFAULT_MAX_PARALLEL`:** nova variável (padrão 8, do contrato), lida pelo motor e validada pela configuração. Foi usada na regressão com 1.
- **Testes de integração:** sobem um worker no mesmo processo (`startTestContext`), então toda a suíte anterior passou a exercitar fila, worker e relay. O teste de queda usa um worker em processo separado.

## Desvios da spec/plano

- **Pré-requisitos:** ADR-0009 (Go) registrada a partir da confirmação do responsável em 05/10/2026, e roadmap e índice de ADRs atualizados. O texto dos pré-requisitos na `spec.md`, apagado por engano, foi restaurado.
- **Demais desvios:** todos já estão no Histórico de `plan.md` e `spec.md`: worker em `apps/api/src/worker`, SIGTERM, semáforo, código JS não elegível, status `cancelled`, relay de todos os eventos e endpoint de cota.
- **Nenhum requisito ficou de fora.**

## Dependências adicionadas

| Pacote | Versão | Motivo | Licença |
|---|---|---|---|
| `bullmq` (api) | ^6.3.11 | Fila de execuções (stack.md, plan §1). Traz `msgpackr` (MIT); o script nativo `msgpackr-extract` foi ignorado em `pnpm-workspace.yaml` (usa binário pré-compilado ou JS puro) | MIT |
| `@olly/api` (worker) | workspace | Código do worker | — |

Imagens só para a carga: `grafana/k6:0.57.0` (AGPL-3.0, ferramenta externa, não distribuída) e `nginx:1.29-alpine` (mock).

## Pendências, bloqueios e riscos

- **Webhook de teste e rate limit em memória por instância (spec 005):** com várias réplicas da API atrás de um balanceador, a escuta do webhook de teste só vale na instância que a recebeu, e o rate limit é por instância. Sugestão: levar ambos para o Redis antes do Helm com réplicas (spec 012). O relatório da spec 005 previa o rate limit distribuído aqui, mas a spec 006 não o inclui.
- **`$vars` em ramos paralelos:** gravar a mesma variável em ramos paralelos não tem ordem garantida. Está documentado em `docs/execucao.md`.
- **Redis indisponível:**
  - webhooks de produção respondem 500 e a execução fica `error` ("Não foi possível enfileirar");
  - os eventos caem para a entrega local.
- **Herdadas:**
  - SC-001 da spec 005 (fixtures reais da POC);
  - hospedagem do Redis no OpenShift (ADR-0006: Azure Cache ou no cluster) — decisão humana;
  - nsjail × SCC `restricted-v2` (spec 008).

## Como demonstrar

1. `pnpm app:up` (ou `docker compose --profile app up -d --build --wait --scale worker=3`) e abrir <http://localhost:5173> como `editor@olly.local`/`olly123`.
2. **Paralelismo:**
   1. crie Manual → dois `Requisição HTTP` para uma URL lenta (ex.: `https://httpbin.org/delay/2`) e clique em "Executar workflow";
   2. veja os dois nós "executando" juntos e as arestas animadas;
   3. abra "Linha do tempo": as barras ficam sobrepostas.
3. **Parar:** com uma URL lenta, clique em "Parar execução". Os nós ficam "interrompido" e a execução aparece "Cancelada" em **Execuções**.
4. **Itens em paralelo:** na aba Configurações do nó HTTP, ligue "Itens em paralelo".
5. **Cota:**
   1. como `admin@olly.local`, chame `PUT /api/v1/projects/<id>/quota {"maxConcurrentExecutions": 1}`;
   2. dispare duas execuções lentas;
   3. em **Execuções**, filtre pelo projeto: o indicador mostra "1 de 1 em execução · 1 na fila".
6. **Worker perdido:**
   1. `docker compose kill worker` durante uma execução lenta;
   2. em até ~70 s (60 s sem batimento + varredura), ela termina `error`/`worker_lost`;
   3. `docker compose up -d worker` não a reexecuta.
7. **Carga:** `infra/load/run.sh`.

## Próximos passos sugeridos

- Escuta do webhook de teste e rate limit no Redis, para várias réplicas da API.
- Exportar as métricas do worker no OTel/Grafana (spec 012) e alertar sobre fila crescente.
- Prioridade por modo na fila (execuções de teste à frente de produção acumulada).
- Reexecução manual de uma execução `worker_lost` a partir do payload guardado (spec 008: reexecução).
