# Sprint 5 — Fila, workers e paralelismo

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também os relatórios em `docs/relatorios/` e a seção 5.4 de `docs/analise_implementacao.md`.

## Pré-requisitos

- Sprint 4 concluída e todos os comandos da seção 8 passando.
- **Humano:** Go/No-Go aprovado e registrado em `docs/decisoes.md`.
- **Humano (desejável):** ADR-006 (infraestrutura) decidida. Se não estiver, siga com Docker Compose e registre a pendência.

## Contexto

No MVP as execuções rodam no processo da API, o que não escala e mistura responsabilidades. Agora as execuções passam para uma fila consumida por workers independentes. O motor ganha **paralelismo real**: ramos independentes executam ao mesmo tempo, o que é uma divergência intencional do N8N (ADR-001).

## Objetivo

Execução distribuída via BullMQ, agendador de DAG concorrente, paralelismo por item, cancelamento, timeout global e cotas por projeto.

## Tarefas

### T1 — `QueueDispatcher` (substitui o `InProcessDispatcher` em produção)
- Fila BullMQ `executions`. O job contém apenas `executionId` (os dados ficam no Postgres; não coloque payloads grandes no Redis).
- **Ao enfileirar:** cria `executions` com status `queued`, grava o payload do gatilho (tabela `execution_payloads` ou object storage se > 1 MB) e adiciona o job.
- `waitForResult` usa Redis pub/sub no canal `execution:<id>:finished`.
- `InProcessDispatcher` continua disponível para testes e para o modo `test` do editor, configurável por `OLLY_TEST_RUN_MODE=inprocess|queue` (padrão `queue`).

### T2 — `apps/worker`
- Processo NestJS standalone (sem HTTP, exceto `/health` e `/metrics` em uma porta interna) que consome a fila com concorrência `OLLY_WORKER_CONCURRENCY` (padrão 10).
- Cada worker gerencia o **seu** `task-runner` (expressões/JS).
- **Desligamento gracioso:** ao receber SIGTERM, para de pegar jobs e aguarda as execuções em andamento até `OLLY_WORKER_SHUTDOWN_TIMEOUT`. As que não terminarem voltam para a fila.
- **Recuperação:**
  - job travado (worker morreu) é detectado pelo mecanismo de *stalled jobs* do BullMQ;
  - a execução é marcada como `error` com `reason: worker_lost`;
  - **não** é reexecutada automaticamente, para evitar efeitos colaterais duplicados (ex.: inserts). Registre esta decisão.
- Os eventos de execução para o WebSocket são publicados no Redis (`execution:<id>:events`). A API repassa aos clientes, permitindo múltiplas instâncias de API.

### T3 — Agendador de DAG concorrente (`packages/engine`)
- Substitua a execução sequencial pelo modelo da seção 5.4 da análise: um nó fica **pronto** quando todas as suas portas de entrada conectadas receberam dados (ou foram marcadas como "sem dados").
- Todos os nós prontos executam concorrentemente, limitados por `settings.maxParallel` do workflow (padrão 8; use `p-limit`).
- **Propagação de "sem dados":**
  - quando um ramo não produz itens (ex.: saída `false` vazia do If), os nós seguintes desse ramo **não executam**, igual ao N8N;
  - o motor marca as portas a jusante como "sem dados" para não bloquear nós que esperam várias entradas. Isso é preparação para o Merge da Sprint 6.
- O resultado precisa ser **determinístico** para a mesma entrada, independentemente da ordem de conclusão. A saída de cada nó é indexada por nó e porta, nunca pela ordem de chegada.
- Mantenha a suíte de testes das sprints anteriores verde. Execução sequencial passa a ser o caso `maxParallel = 1`.

### T4 — Paralelismo por item
- `settings.parallelItems: { enabled, concurrency }` em nós que processam item a item (`http.request`, `postgres.query` em `perItem`, `postgres.write` sem transação, `code.javascript` em `runOnceForEachItem`).
- A ordem dos itens de saída é **preservada**, igual à ordem de entrada.
- Na aba "Configurações" do nó, mostre a opção apenas nos nós que a suportam (flag `supportsParallelItems` na `NodeDefinition`).

### T5 — Cancelamento e timeout global
- `POST /executions/:id/cancel` (`workflow:execute`). O sinal é publicado no Redis, e o worker propaga um `AbortSignal` para todos os nós em execução. HTTP e Postgres cancelam a operação; o task-runner descarta o isolate.
- `settings.timeoutSec` do workflow (padrão `OLLY_DEFAULT_WORKFLOW_TIMEOUT`, 300 s): ao estourar, cancela com status `error` e `reason: timeout`.
- Botão "Parar execução" no editor e na tela de execuções.

### T6 — Cotas por projeto
- Coluna `projects.max_concurrent_executions` (padrão por variável de ambiente).
- O worker usa o *group concurrency* do BullMQ ou um semáforo no Redis por projeto. Execuções acima da cota permanecem `queued`.
- Mostre na UI a quantidade de execuções em fila por projeto.

### T7 — Visualização de paralelismo
- O canvas mostra **vários nós em execução simultânea** (animação nas arestas ativas).
- No detalhe da execução, adicione uma aba **"Linha do tempo"** (estilo Gantt) com início e fim de cada nó.

### T8 — Infraestrutura
- `docker-compose.yml` com serviços `api` e `worker` separados (Dockerfiles multi-stage em `infra/docker/`).
- `docker compose up --scale worker=3` funciona.
- Graceful shutdown testado no Compose (`docker compose stop worker`).

### T9 — Teste de carga
- Script k6 em `infra/load/webhook.js`: webhook → HTTP (mock local) → Postgres insert, com 50 usuários virtuais por 2 minutos.
- Registre no relatório: throughput, p50/p95/p99 do tempo de resposta do webhook (modo `onReceived` e `lastNode`), tamanho máximo da fila e uso de memória dos workers.

## Fora do escopo

Merge, While, Switch, porta de erro, Python, cron e Kubernetes/Helm.

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | 3 ramos HTTP independentes com atraso de 1 s cada terminam em ~1 s (não 3 s) | Integração `parallel.test.ts` |
| 2 | Mesmo workflow e entrada produzem saídas idênticas em 20 execuções seguidas | Integração |
| 3 | Ramo `false` vazio do If não executa os nós seguintes | Unitário |
| 4 | `parallelItems` com `concurrency: 5` em 20 itens com atraso de 500 ms leva ~2 s e preserva a ordem | Integração |
| 5 | Matar o worker no meio da execução: a execução termina como `error` com `reason: worker_lost`, nunca fica `running` para sempre | Integração com Testcontainers |
| 6 | Cancelar pela UI interrompe uma query Postgres longa (`pg_sleep`) em até 2 s | Integração |
| 7 | Cota de 2 execuções por projeto: a 3ª fica `queued` até uma terminar | Integração |
| 8 | Toda a suíte das sprints anteriores verde | CI |
| 9 | Resultados do k6 registrados no relatório | Relatório |

## Entrega

Código, `docs/execucao.md` (semântica de execução: prontidão, "sem dados", paralelismo, cancelamento, recuperação) e o relatório `docs/relatorios/sprint-05.md`.
