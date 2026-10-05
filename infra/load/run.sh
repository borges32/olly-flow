#!/usr/bin/env bash
# Teste de carga da spec 006 (NFR-002). Requer Docker. Uso, na raiz do repositório:
#   infra/load/run.sh [workers=3] [duração=2m] [vus=50]
set -euo pipefail
WORKERS="${1:-3}"
DURATION="${2:-2m}"
VUS="${3:-50}"
OUT="${OUT:-infra/load/results}"
mkdir -p "$OUT"

export OLLY_HTTP_ALLOWLIST=mock
export OLLY_WEBHOOK_RATE_LIMIT_PER_MIN=1000000
docker compose --profile app --profile load up -d --build --wait --scale "worker=$WORKERS"

PROJECT_ID=$(pnpm exec tsx infra/load/setup.ts | tee "$OUT/setup.log" | sed -n 's/^PROJECT_ID=//p')

sample() {
  # Fila (execuções queued/running) e memória dos containers a cada 5 s.
  while true; do
    printf '%s ' "$(date +%T)"
    docker compose exec -T postgres psql -U "${POSTGRES_USER:-olly}" -d "${POSTGRES_DB:-olly}" -At -c \
      "SELECT 'queued=' || count(*) FILTER (WHERE status='queued') || ' running=' || count(*) FILTER (WHERE status='running') FROM executions WHERE project_id = '$PROJECT_ID'"
    docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | grep -E 'api|worker' | tr '\n' ';'
    echo
    sleep 5
  done
}

# Síncrono primeiro: o onReceived aceita mais rápido do que os workers processam e acumula fila.
for WEBHOOK in carga-sincrono carga-recebido; do
  sample > "$OUT/$WEBHOOK-samples.log" 2>&1 &
  SAMPLER=$!
  docker run --rm --network host -v "$PWD/infra/load:/scripts:ro" grafana/k6:0.57.0 run \
    -e TARGET=http://localhost:3000 -e WEBHOOK="$WEBHOOK" -e VUS="$VUS" -e DURATION="$DURATION" \
    --summary-export "/dev/stdout" /scripts/webhook.js > "$OUT/$WEBHOOK-k6.log" 2>&1 || true
  # Espera a fila esvaziar (modo onReceived acumula execuções), até 15 min.
  for _ in $(seq 1 450); do
    PENDING=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-olly}" -d "${POSTGRES_DB:-olly}" -At -c \
      "SELECT count(*) FROM executions WHERE project_id = '$PROJECT_ID' AND status IN ('queued','running')")
    [ "$PENDING" = "0" ] && break
    sleep 2
  done
  kill "$SAMPLER" || true
  docker compose exec -T postgres psql -U "${POSTGRES_USER:-olly}" -d "${POSTGRES_DB:-olly}" -c \
    "SELECT status, count(*), round(avg(extract(epoch FROM finished_at - started_at))::numeric * 1000) AS media_ms,
            round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - started_at)))::numeric * 1000) AS p95_ms
       FROM executions WHERE project_id = '$PROJECT_ID' GROUP BY status" > "$OUT/$WEBHOOK-db.log"
done
echo "Resultados em $OUT"
