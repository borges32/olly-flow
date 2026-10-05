# apps/worker

Worker de execuções ([spec 006](../../specs/006-fila-workers-paralelismo/spec.md)): consome a fila `executions` (BullMQ/Redis) e executa os workflows com o `packages/engine`, com o próprio task runner (sandbox de expressões e código).

- O código do worker fica em [`apps/api/src/worker`](../api/src/worker/) e é exportado como `@olly/api/worker`: ele reaproveita os módulos de execução da API (banco, nós, credenciais, binários, `ExecutionRunner`). Este pacote é o processo implantável.
- Usa a **mesma configuração** da API (`.env` / variáveis de ambiente), mais `OLLY_WORKER_CONCURRENCY` (20), `OLLY_WORKER_SHUTDOWN_TIMEOUT` (60 s) e `OLLY_WORKER_PORT` (3101).
- `GET :3101/health` (503 durante o encerramento) e `GET :3101/metrics` (Prometheus).
- `SIGTERM`: para de consumir e espera as execuções em andamento até o limite; as que passarem dele terminam como `error`/`worker_lost` (nunca são reexecutadas).

```bash
pnpm --filter @olly/worker dev          # desenvolvimento
docker compose --profile app up -d --scale worker=3   # vários workers (FR-014)
```

Semântica de execução: [docs/execucao.md](../../docs/execucao.md).
