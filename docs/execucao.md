# Semântica de execução

> Como o motor (`packages/engine`) e os workers executam um workflow. Produzido pela [spec 006](../specs/006-fila-workers-paralelismo/spec.md) (fila, paralelismo, cancelamento) e completado pela [spec 007](../specs/007-controle-de-fluxo/spec.md) (laços, Merge, porta de erro, workflow de erro). A semântica é fixada pela suíte de referência em `packages/engine/reference/`, que roda cada caso com paralelismo 1 e 8 e exige resultados idênticos.

## Onde a execução roda

1. A API grava a execução (`queued`) e os dados do disparo em `execution_payloads` (itens do gatilho, nó inicial, pin data, destino e reaproveitamento; no object storage acima de 1 MB).
2. A fila BullMQ `executions` recebe só `{ executionId }`: a fila não carrega dados de usuário.
3. Um worker (`apps/worker`) pega o job, verifica a cota do projeto, marca a execução `running` e executa com o motor. O worker tem o próprio task runner (sandbox de expressões e de código).
4. Os eventos (`nodeStarted`, `nodeFinished`...) vão para o Redis (canal `olly:execution-events`). Todas as instâncias da API os entregam aos editores conectados por WebSocket.
5. O desfecho e a resposta do nó "Responder ao webhook" voltam pelo Redis. Quem espera a resposta síncrona do webhook assina o canal da execução **antes** de ler o resultado gravado, então não perde um resultado que chegue no meio.

Execuções de **produção** sempre passam pela fila. Execuções de **teste** (editor) também, salvo com `OLLY_TEST_RUN_MODE=inprocess`, que as executa no processo da API.

## Prontidão e "sem dados"

O workflow é um grafo dirigido. Ciclos só são permitidos como **laços estruturados** (ver "Laços").

- Cada **porta de entrada** conectada de um nó está:
  - `unresolved`, enquanto algum nó que a alimenta não terminou;
  - `data`, quando terminaram e chegou pelo menos um item;
  - `noData`, quando terminaram sem itens.
- Um nó fica **pronto** quando todas as portas conectadas estão resolvidas e pelo menos uma tem `data`.
- Se todas estão `noData`, o nó é **pulado** (`skipped`) e também não entrega dados aos seguintes: o "sem dados" se propaga.
- Exemplo: a saída `false` vazia de um If não executa os nós seguintes e não bloqueia os demais ramos. Um nó que espera várias entradas trata a porta vazia como resolvida.
- O gatilho (nó inicial) sempre executa, mesmo sem itens.

## Paralelismo entre nós

- Todo nó pronto começa, até `settings.maxParallel` nós ao mesmo tempo.
  - Padrão: `OLLY_DEFAULT_MAX_PARALLEL`, que vale 8.
  - `maxParallel = 1` reproduz a execução sequencial.
- **Diferença intencional em relação ao N8N** ([ADR-0001](adr/0001-abordagem-hibrida.md)): no N8N os ramos rodam em sequência; aqui, ramos independentes rodam ao mesmo tempo.

### Determinismo

O resultado não depende da ordem em que os nós terminam:

- **Entrada de um nó com várias arestas:** é montada quando ele fica pronto, concatenando as saídas dos pais **na ordem das arestas na definição** do workflow, nunca na ordem de chegada.
- **Modo de resposta `lastNode` do webhook:** usa o último nó com dados na **ordem topológica** (estável, com desempate pela ordem dos nós na definição), não o último a terminar.
- **Erro em vários ramos:** quando mais de um ramo falha, o erro da execução é o do nó que vem primeiro na ordem topológica.
- **Ressalva:** `data.setVariable` em ramos paralelos que gravam a mesma variável não tem ordem garantida. Prefira variáveis distintas por ramo ou `maxParallel = 1`.

## Laços (While e Loop Over Items)

### Regra para ciclos (FR-008)

Um ciclo é válido somente quando:
1. **volta pela porta `continue`** de um nó de laço (`logic.while` ou `logic.loopOverItems`);
2. **esse nó é a única entrada do ciclo** (dominador): conexões de fora do ciclo só podem chegar à entrada `main` do nó de laço.

Laços aninhados são aceitos. Qualquer outro ciclo é recusado ao salvar (`INVALID_CYCLE`, com os nós envolvidos), e o editor o destaca com a regra no tooltip.

### Execução

- **Início:** o nó de laço recebe os itens em `main` e decide se emite em `loop` (corpo) ou em `done` (fim).
- **Corpo:** cada emissão em `loop` abre uma **volta**: o corpo recomeça do zero (nós pendentes, sem saída anterior) e seus nós executam normalmente, inclusive em paralelo e com Merge.
- **Fim da volta:** quando **todo o corpo terminou** (sem nó em andamento e sem laço interno ativo), o nó de laço recebe em `continue` o que voltou pelas arestas de retorno, na ordem das arestas, e decide de novo.
- **Durante o laço:** nós fora dele não enxergam o corpo nem a saída `done` como resolvidos; só executam depois do fim, vendo a **última** iteração.
- **Limites:**
  - cada nó de laço tem o seu (`maxIterations` do While; o número de lotes no Loop Over Items);
  - há um teto global, `OLLY_MAX_LOOP_ITERATIONS` (10 000);
  - passar do limite é erro explícito.

### Iterações e `$loop` (FR-007, FR-009)

- **Registro:** cada execução de nó dentro de um laço é registrada com um `runIndex` (0, 1, 2…), nos eventos em tempo real e em `node_executions.run_index`. O painel do nó navega entre elas ("Execução i de N").
- **`$('Nó')`:** dentro do corpo, aponta para a execução **da iteração atual**; fora do laço, para a última.
- **`$loop`:** para os nós do laço mais interno (inclusive o próprio nó de laço), traz:
  - `index`: voltas concluídas;
  - `maxIterations`;
  - `accumulated`: itens acumulados pelo nó de laço.
- **Execução de um nó (spec 003, FR-020):** nós dentro de laços nunca reaproveitam a saída anterior; sempre executam de novo.

## Merge e várias entradas

- **Quando executa:** o Merge, como qualquer nó com várias entradas, executa **uma vez**, quando todas as entradas conectadas estão resolvidas, com ou sem dados. Se todas vierem sem dados, é pulado. Dentro de um laço, executa uma vez por volta.
- **`waitFor`:** em `allConnected`, uma entrada sem dados entra como lista vazia; em `anyWithData`, é ignorada.
- **Detalhes dos modos:** ver [docs/nos/logic.merge.md](nos/logic.merge.md).

## Paralelismo por item

Nos nós com `supportsParallelItems`, a aba **Configurações** oferece "Itens em paralelo" (`settings.parallelItems: { enabled, concurrency }`). Os nós elegíveis são:
- `http.request`, que nesse caso substitui os lotes `batchSize`;
- `postgres.query`, no modo por item;
- `postgres.write`, sem transação única.

Garantias:
- no máximo `concurrency` itens ao mesmo tempo;
- a ordem dos resultados é sempre a dos itens de entrada;
- na primeira falha, nenhum item novo começa, os que estão em andamento terminam, e vale o erro do item de menor índice;
- com `onError: continue`, cada item com falha vira `{ json: { error } }` na sua posição.

O nó de código não é elegível: o modo "uma vez por item" já roda todos os itens numa única chamada ao sandbox.

## Erros

- **Por nó:** continuam valendo `retry`, `timeout` e `onError` da spec 004. A spec 007 acrescenta `onError = errorOutput`:
  - o nó ganha a saída `error`;
  - nos nós por item (Set, HTTP, Postgres), os itens que falharam seguem por ela com o campo `error`, e os demais seguem pela saída normal;
  - nos demais nós, uma falha desvia todos os itens de entrada para `error`.
- **Erro que para a execução:** nenhum nó novo começa. Os nós que já estavam em andamento terminam e são registrados, e a execução termina com status `error`.
- **Workflow de erro** (FR-014/FR-015):
  - **Quando aciona:** quando uma execução de **produção** termina com erro (inclusive `worker_lost`), o workflow indicado em `settings.errorWorkflowId` é enfileirado.
  - **Como:** o gatilho dele é `trigger.error`, com o payload do Error Trigger do N8N (`execution.id/url/error/lastNodeExecuted/mode`, `workflow.id/name`).
  - **Sem recursão:** uma execução iniciada por um workflow de erro nunca aciona outro.
  - **Detalhes:** ver [docs/nos/trigger.error.md](nos/trigger.error.md).

## Cancelamento e timeout global

- **Cancelar:** pelo botão "Parar execução" ou por `POST /executions/:id/cancel`, com a permissão `workflow:execute`.
  - **Na fila:** a execução termina na hora como `cancelled` e nunca começa.
  - **Em andamento:** o worker aborta o `AbortController` raiz da execução, e cada nó recebe um sinal derivado. Com isso:
    - requisições HTTP são abortadas;
    - consultas SQL são canceladas no servidor (`pg_cancel_backend`);
    - código em execução no sandbox é interrompido.
  - **Resultado:** o motor não espera o nó responder. Os nós interrompidos ficam `cancelled`, os pendentes não executam, e a execução termina `cancelled`, com `error.reason = 'cancelled'`. O alvo é terminar em até 2 s (NFR-001).
- **Timeout global:** `settings.timeoutSec` do workflow ou `OLLY_DEFAULT_WORKFLOW_TIMEOUT` (300 s). Ao estourar, a execução é cancelada como acima, com `error.reason = 'timeout'`.

## Cotas por projeto

- Cada projeto tem um limite de execuções simultâneas: `projects.max_concurrent_executions`, ou `OLLY_PROJECT_MAX_CONCURRENT` (20) quando não definido.
- Só a administração da plataforma altera esse limite, por `PUT /projects/:id/quota`.
- Funcionamento:
  - antes de executar, o worker ocupa uma vaga num semáforo no Redis;
  - sem vaga, o job é adiado por 1 s e a execução continua `queued`;
  - cada vaga tem validade renovada a cada batimento, então a vaga de um worker que caiu expira sozinha.
- `GET /projects/:id/queue-stats` alimenta o indicador "em execução / na fila" na tela de execuções.

## Recuperação: worker perdido

- **Batimento:** a execução em andamento atualiza `executions.heartbeat_at` a cada 10 s.
- **Detecção:** uma varredura na API, a cada minuto, encerra como `error` com `error.reason = 'worker_lost'` toda execução `running` sem batimento há mais de 60 s. A fila marca o job travado de um worker que caiu (`maxStalledCount: 0`) como falho, e esse sinal também encerra a execução como `worker_lost`.
- **Sem reexecução:** uma execução com `worker_lost` **nunca é reexecutada automaticamente**, para evitar efeitos colaterais duplicados, como um INSERT ou um POST repetidos. Um job reentregue é ignorado, porque o worker só começa execuções que ainda estão `queued`.
- **Encerramento gracioso** (`SIGTERM`):
  1. o worker para de consumir a fila;
  2. espera as execuções em andamento por até `OLLY_WORKER_SHUTDOWN_TIMEOUT` (60 s);
  3. as que passarem do limite são interrompidas e terminam como `error`/`worker_lost`;
  4. os jobs ainda não iniciados ficam na fila para outro worker.

## Escala local

```bash
docker compose --profile app up -d --build --scale worker=3
```

Cada worker processa até `OLLY_WORKER_CONCURRENCY` (20) jobs ao mesmo tempo. Endpoints internos de cada worker:
- `GET :3101/health`, que responde 503 durante o encerramento;
- `GET :3101/metrics`, no formato Prometheus.
