#!/bin/sh
# Mantém o schema do banco em dia no ambiente de testes de UX (profile `app`).
# Se o banco for recriado (ex.: volume apagado com a API no ar), as migrations e o seed
# são reaplicados em até INTERVAL segundos, sem reiniciar a API.
INTERVAL="${INTERVAL:-10}"
CLI="node packages/db/dist/cli.js"
rm -f /tmp/ready
while true; do
  if out=$($CLI migrate 2>&1); then
    if [ "$out" != "Nada a fazer." ] || [ ! -f /tmp/ready ]; then
      [ "$out" != "Nada a fazer." ] && echo "$out"
      $CLI seed && touch /tmp/ready
    fi
  else
    echo "$out" >&2
    rm -f /tmp/ready
  fi
  sleep "$INTERVAL"
done
