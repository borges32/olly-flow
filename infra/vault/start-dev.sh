#!/bin/sh
# Vault de desenvolvimento do compose (spec 009, T002). Diferente do modo `-dev`, guarda os
# dados em volume: reiniciar o container não perde a chave das credenciais. A chave de unseal e
# o token root ficam no próprio volume, o que só é aceitável em desenvolvimento.
set -eu
rm -f /tmp/vault-ready
cat > /tmp/vault.hcl <<HCL
storage "file" { path = "/vault/file" }
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}
disable_mlock = true
api_addr      = "http://127.0.0.1:8200"
HCL
vault server -config=/tmp/vault.hcl &
pid=$!
trap 'kill -TERM $pid' TERM INT
export VAULT_ADDR=http://127.0.0.1:8200

# `vault status`: 0 = destravado, 2 = travado, 1 = sem resposta.
while :; do
  set +e
  vault status >/dev/null 2>&1
  rc=$?
  set -e
  [ "$rc" -ne 1 ] && break
  sleep 1
done

INIT=/vault/file/dev-init.txt
[ -f "$INIT" ] || vault operator init -key-shares=1 -key-threshold=1 > "$INIT"
vault operator unseal "$(sed -n 's/^Unseal Key 1: //p' "$INIT")" >/dev/null
VAULT_TOKEN="$(sed -n 's/^Initial Root Token: //p' "$INIT")"
export VAULT_TOKEN
sh /vault/dev/init.sh
touch /tmp/vault-ready
wait "$pid"
