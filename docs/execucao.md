# Semântica de execução

> Como o motor (`packages/engine`) e os workers executam um workflow. Produzido pela [spec 006](../specs/006-fila-workers-paralelismo/spec.md); a [spec 007](../specs/007-controle-de-fluxo/spec.md) acrescenta Merge, laços, Switch e porta de erro.

## Onde a execução roda

1. A API grava a execução (`queued`) e os dados do disparo em `execution_payloads` (itens do gatilho, nó inicial, pin data, destino e reaproveitamento; no object storage acima de 1 MB).
2. A fila BullMQ `executions` recebe só `{ executionId }`: a fila não carrega dados de usuário.
3. Um worker (`apps/worker`) pega o job, verifica a cota do projeto, marca a execução `running` e executa com o motor. O worker tem o próprio task runner (sandbox de expressões e de código).
4. Os eventos (`nodeStarted`, `nodeFinished`...) vão para o Redis (canal `olly:execution-events`). Todas as instâncias da API os entregam aos editores conectados por WebSocket.
5. O desfecho e a resposta do nó "Responder ao webhook" voltam pelo Redis. Quem espera a resposta síncrona do webhook assina o canal da execução **antes** de ler o resultado gravado, então não perde um resultado que chegue no meio.

Execuções de **produção** sempre passam pela fila. Execuções de **teste** (editor) também, salvo com `OLLY_TEST_RUN_MODE=inprocess`, que as executa no processo da API.

## Prontidão e "sem dados"

O workflow é um grafo dirigido acíclico. Ciclos só serão permitidos pelas portas de laço, na spec 007.

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

- Por nó continuam valendo `retry`, `timeout` e `onError` da spec 004.
- No primeiro erro que para a execução, nenhum nó novo começa. Os nós que já estavam em andamento terminam e são registrados, e a execução termina com status `error`.

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
