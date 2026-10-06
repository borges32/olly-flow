#!/bin/sh
# Vault de desenvolvimento (spec 009, T002): Transit com a chave das credenciais e um AppRole
# para a API/worker. Somente desenvolvimento e testes: o Vault institucional é configurado pela
# equipe de infraestrutura conforme a ADR-0007 (pendente). Idempotente.
set -eu
export VAULT_ADDR="${VAULT_ADDR:-http://127.0.0.1:8200}"
KEY="${OLLY_VAULT_TRANSIT_KEY:-olly-credentials}"

until vault status >/dev/null 2>&1; do sleep 1; done

vault secrets list | grep -q '^transit/' || vault secrets enable transit >/dev/null
vault read "transit/keys/$KEY" >/dev/null 2>&1 || vault write -f "transit/keys/$KEY" >/dev/null
vault auth list | grep -q '^approle/' || vault auth enable approle >/dev/null

# Privilégio mínimo da aplicação: cifrar, decifrar e ler a versão da chave.
vault policy write olly-api - >/dev/null <<POLICY
path "transit/encrypt/$KEY" { capabilities = ["update"] }
path "transit/decrypt/$KEY" { capabilities = ["update"] }
path "transit/keys/$KEY" { capabilities = ["read"] }
POLICY
# Só para o comando de rotação (`pnpm credentials:rotate --rotate-vault-key`).
vault policy write olly-key-admin - >/dev/null <<POLICY
path "transit/keys/$KEY/rotate" { capabilities = ["update"] }
POLICY

vault write auth/approle/role/olly-api token_policies="olly-api,olly-key-admin" \
  token_ttl=1h token_max_ttl=4h >/dev/null
vault write auth/approle/role/olly-api/role-id role_id="$OLLY_VAULT_ROLE_ID" >/dev/null
vault write auth/approle/role/olly-api/custom-secret-id secret_id="$OLLY_VAULT_SECRET_ID" \
  >/dev/null 2>&1 || true
echo "vault pronto: transit/$KEY e approle olly-api"
