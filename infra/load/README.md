# Teste de carga (spec 006, NFR-002)

Webhook publicado → `http.request` para um mock (nginx) → `INSERT` no Postgres, com 50 VUs por 2 minutos, nos modos de resposta `onReceived` (202 imediato; mede a entrada na fila) e `lastNode` (200 depois que o worker termina; mede o caminho completo).

```bash
infra/load/run.sh            # 3 workers, 2 min, 50 VUs (resultados em infra/load/results/)
infra/load/run.sh 1 30s 10   # variação rápida
```

O script sobe o compose (`app` + `load`) com `--scale worker=N`, libera o mock no anti-SSRF (`OLLY_HTTP_ALLOWLIST=mock`) e o rate limit do webhook, prepara projeto, credencial, tabela e workflows (`setup.ts`), roda o k6 (`grafana/k6`) e amostra a fila e a memória dos containers a cada 5 s. Os números da última medição estão no [relatório da spec 006](../../specs/006-fila-workers-paralelismo/report.md).
