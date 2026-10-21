# Implantação no OpenShift

Manifestos para subir o Olly Flow no **ARO OpenShift** (Azure), o ambiente de homologação e produção definido na [ADR-0006](../docs/adr/0006-infraestrutura.md). O Docker Compose continua sendo o ambiente de desenvolvimento.

| Arquivo | Conteúdo |
|---|---|
| `kustomization.yaml` | Namespace, imagens (registry e versão) e lista de recursos |
| `configmap.yaml` | Configuração não sensível (`olly-flow-config`) |
| `secret.example.yaml` | **Modelo** do Secret `olly-flow-secrets`. Não é aplicado pelo Kustomize e não deve receber valores reais no repositório |
| `redis.yaml` | Volume, Deployment e Service `olly-flow-redis` (porta 6379): fila de execuções, eventos, cotas e agendamentos, com senha e persistência |
| `minio.yaml` | Volume, Deployment e Service `olly-flow-minio` (S3 na porta 9000, console na 9001): object storage dos binários e dos dados grandes das execuções |
| `db-init.yaml` | Deployment `olly-flow-db-init`: migrations e seed do banco |
| `api.yaml` | Deployment e Service `olly-flow-api` (porta 3000) |
| `worker.yaml` | Deployment `olly-flow-worker` (saúde na porta 3101, sem Service) |
| `web.yaml` | Deployment e Service `olly-flow-web` (porta 8080) e a Route `olly-flow`, a única entrada externa |
| `web-nginx-configmap.yaml` | Configuração do nginx do frontend para o OpenShift |

```text
Route olly-flow (TLS edge) ──▶ olly-flow-web :8080 ──┬─ SPA
                                                     └─ /api, /socket.io, /health, /webhook* ──▶ olly-flow-api :3000
olly-flow-worker ◀── olly-flow-redis :6379 (fila, eventos; volume persistente) ──▶ olly-flow-api
olly-flow-db-init ──▶ PostgreSQL (migrations e seed)
olly-flow-api / olly-flow-worker ──▶ olly-flow-minio :9000 (S3, volume persistente)
```

## Pré-requisitos (fora destes manifestos)

| Serviço | Uso | Variáveis |
|---|---|---|
| **PostgreSQL 14.18 ou superior** (ex.: Azure Database for PostgreSQL) | Banco da aplicação | `DATABASE_URL` |
| **Vault** (opcional, [ADR-0007](../docs/adr/0007-gestao-de-segredos.md)) | Chave das credenciais com `OLLY_KEY_PROVIDER=vault` | `OLLY_VAULT_*` |
| **IdP OIDC** (opcional, [ADR-0005](../docs/adr/0005-autenticacao-oidc.md)) | Login institucional com `OLLY_IDP_ENABLED=true` | `OIDC_*` |
| **Coletor OpenTelemetry** (opcional) | Telemetria | `OTEL_*` |

Os pods precisam alcançar esses serviços pela rede: liberação de firewall ou NetworkPolicy, a cargo da Infra.

Sobem junto, no próprio namespace:
- **Redis** (`redis.yaml`). Para usar um Redis gerenciado (ex.: Azure Cache for Redis): tire `redis.yaml` do `kustomization.yaml` e aponte o `REDIS_URL` do Secret para ele.
- **Object storage S3** (`minio.yaml`). Para usar um S3 institucional: tire `minio.yaml` do `kustomization.yaml` e troque `S3_ENDPOINT` no ConfigMap.

## 1. Gerar e publicar as imagens

As quatro imagens saem do mesmo [Dockerfile](../infra/docker/Dockerfile). A `olly-flow-db-init` tem o mesmo conteúdo da `olly-flow-api`; muda só o comando (`db-keeper`).

```bash
oc new-project olly-flow            # ou: oc project olly-flow
REGISTRY=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}')
docker login -u "$(oc whoami)" -p "$(oc whoami -t)" "$REGISTRY"
VERSAO=1.0.0

docker build -f infra/docker/Dockerfile --target api    -t $REGISTRY/olly-flow/olly-flow-api:$VERSAO .
docker tag  $REGISTRY/olly-flow/olly-flow-api:$VERSAO      $REGISTRY/olly-flow/olly-flow-db-init:$VERSAO
docker build -f infra/docker/Dockerfile --target worker -t $REGISTRY/olly-flow/olly-flow-worker:$VERSAO .
docker build -f infra/docker/Dockerfile --target web    -t $REGISTRY/olly-flow/olly-flow-web:$VERSAO .
# Redis: a mesma imagem do docker-compose (redis:7-alpine, 7.4), fixada por digest.
docker pull redis@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499
docker tag  redis@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499 \
            $REGISTRY/olly-flow/olly-flow-redis:$VERSAO
# MinIO: a mesma imagem do docker-compose (build da Chainguard, fixada por digest).
docker pull cgr.dev/chainguard/minio:latest-dev@sha256:7c248c1d7832ff65a6345cb6ff7bf9cf081ccf88527f8d6f25bb9227801a5121
docker tag  cgr.dev/chainguard/minio@sha256:7c248c1d7832ff65a6345cb6ff7bf9cf081ccf88527f8d6f25bb9227801a5121 \
            $REGISTRY/olly-flow/olly-flow-minio:$VERSAO
for i in api db-init worker web redis minio; do docker push $REGISTRY/olly-flow/olly-flow-$i:$VERSAO; done
```

- **IdP ligado:** com `OLLY_IDP_ENABLED=true`, a imagem `web` precisa do emissor e do client do IdP no build: `--build-arg VITE_OIDC_AUTHORITY=https://IDP/realms/olly --build-arg VITE_OIDC_CLIENT_ID=olly-web`.
- **Registry institucional:** com outro registry, troque `newName` em `kustomization.yaml` e crie o pull secret no namespace.

Depois, ajuste `newTag` em `kustomization.yaml` para a versão publicada. Prefira um digest (`digest: sha256:...`) em produção.

## 2. Configurar

1. **`configmap.yaml`:** troque `OLLY_PUBLIC_URL` e o que mudar no ambiente (o `S3_ENDPOINT` já aponta para o MinIO do namespace).
2. **`web.yaml`:** troque o `host` da Route (o mesmo domínio de `OLLY_PUBLIC_URL`).
3. **Secret:** crie a partir do modelo `secret.example.yaml`, sem versioná-lo:

   ```bash
   # olly-flow.env, fora do repositório:
   #   DATABASE_URL=postgres://...
   #   REDIS_PASSWORD=<senha>           REDIS_URL=redis://:<senha>@olly-flow-redis:6379
   #   OLLY_MASTER_KEY=$(openssl rand -base64 32)
   #   OLLY_MASKING_SALT=$(openssl rand -hex 32)
   #   S3_ACCESS_KEY=...                S3_SECRET_KEY=...
   oc -n olly-flow create secret generic olly-flow-secrets --from-env-file=olly-flow.env
   ```

   **Guarde a `OLLY_MASTER_KEY`:** sem ela, as credenciais gravadas no banco não podem ser decifradas.

   `REDIS_PASSWORD` é a senha do Redis do namespace, e o `REDIS_URL` precisa da mesma senha. Use só letras e números (ex.: `openssl rand -hex 32`), para não precisar codificá-la na URL.

   `S3_ACCESS_KEY` e `S3_SECRET_KEY` também são o usuário e a senha de administração do MinIO, para que a API e o worker usem as mesmas chaves. A senha precisa ter pelo menos 8 caracteres (ex.: `openssl rand -hex 24`).

## 3. Aplicar

```bash
oc apply -k k3s/
oc -n olly-flow rollout status deploy/olly-flow-redis
oc -n olly-flow rollout status deploy/olly-flow-minio
oc -n olly-flow rollout status deploy/olly-flow-db-init
oc -n olly-flow rollout status deploy/olly-flow-api
oc -n olly-flow rollout status deploy/olly-flow-worker
oc -n olly-flow rollout status deploy/olly-flow-web
curl -s https://olly-flow.apps.CLUSTER.DOMINIO/health   # {"status":"ok","db":"up","redis":"up",...}
```

- **Ordem de subida:** a API e o worker podem reiniciar algumas vezes até o `olly-flow-db-init` aplicar as migrations (a `startupProbe` espera até 5 minutos).
- **Primeiro acesso:** abra a URL pública e crie o primeiro administrador (spec 014).
- **Escalar:** `oc scale deploy/olly-flow-worker --replicas=4`. A API e o frontend também escalam. O `olly-flow-db-init`, o `olly-flow-redis` e o `olly-flow-minio` ficam com 1 réplica.
- **Console do MinIO:** fica sem Route. Para abrir: `oc -n olly-flow port-forward svc/olly-flow-minio 9001:9001` e acesse http://localhost:9001.

## Segurança no OpenShift

Os Deployments funcionam com o SCC padrão `restricted-v2`:
- o container roda com um UID aleatório e o grupo 0;
- sem root e sem capabilities, com `allowPrivilegeEscalation: false` e `seccompProfile: RuntimeDefault`;
- o sistema de arquivos é só leitura (`readOnlyRootFilesystem`), e os diretórios graváveis são `emptyDir`: `/tmp` na API, no worker e no db-init; cache, pid e temporários no nginx;
- o nginx escuta na porta 8080 e fala com a API pelo Service `olly-flow-api`;
- os pods não montam o token da service account (`automountServiceAccountToken: false`). Para usar o Vault com `OLLY_VAULT_AUTH=kubernetes`, ligue de volta na API e no worker e crie a service account com o papel do Vault.

**Teste local (13/10/2026):** as imagens rodaram no Docker com as restrições do `restricted-v2` (UID 1000680000 e grupo 0, raiz só leitura, diretórios graváveis com permissão 0777 como os `emptyDir`, sem capabilities, `no-new-privileges`), com o Postgres do compose.
- **db-init:** aplicou o seed e ficou pronto.
- **API e worker:** `/health` respondeu `ok`, e o sandbox de código (isolated-vm) executou.
- **nginx:** serviu a SPA e encaminhou `/health` e `/api` para a API.
- **Redis:** com o comando do manifesto e o volume gravável pelo grupo, ficou pronto.
  - **senha:** recusou acesso sem ela (`NOAUTH`), e ela não aparece na linha de comando do processo;
  - **configuração:** aplicou `noeviction` e o limite de 768 MB;
  - **persistência:** o AOF guardou os dados após o reinício;
  - **aplicação:** a API e o worker conectaram com o `REDIS_URL` com senha e criaram as filas `executions` e `maintenance`.
- **MinIO:** com o volume de dados gravável pelo grupo, como o `fsGroup` do OpenShift, criou o bucket e ficou pronto. A classe de armazenamento da própria API gravou e leu um objeto nele.

**Fora do OpenShift (ex.: k3s puro):** a Route não existe; use um Ingress apontando para `olly-flow-web:8080`. Defina também `runAsUser` (ex.: `1000680000`) e `fsGroup: 0` no `securityContext` do pod: sem o SCC, ninguém atribui o UID, e `runAsNonRoot` recusa imagens sem UID numérico.

## Pendências

- **Imagens de produção:** o Dockerfile foi feito para o compose (testes de UX). Antes da produção, a Segurança deve revisar as imagens: base, varredura de vulnerabilidades e assinatura.
- **Redis de 1 réplica:** sem alta disponibilidade. Se o pod cair, as execuções novas esperam ele voltar. O que estava na fila não se perde, pelo AOF gravado a cada segundo; no pior caso, perde-se o último segundo. Para produção, avalie um Redis gerenciado com réplica (ex.: Azure Cache for Redis).
- **MinIO de 1 réplica:** sem alta disponibilidade. Se o pod ou o volume cair, os binários e os dados grandes das execuções ficam indisponíveis até voltar. Defina o backup do volume `olly-flow-minio-data` com a Infra. Para produção, avalie o MinIO distribuído ou um S3 institucional.
- **Licença do MinIO:** AGPLv3. Uso interno, sem modificações, mas registre a aprovação com o Jurídico, se a política institucional exigir.
- **Serviços institucionais:** endereços e credenciais de banco, Vault e IdP dependem das ADRs 0005 e 0007 e da Infra.
- **Webhooks:** a Route aceita até 130 s por requisição (`haproxy.router.openshift.io/timeout`) e troca o `X-Forwarded-For` do cliente pelo IP real (`set-forwarded-headers: replace`). Assim, a allowlist de IP dos webhooks (spec 005) não pode ser contornada por um cabeçalho forjado.
- **Streaming (spec 027):** o nginx do `olly-flow-web` não bufferiza nem comprime o `/webhook`, e a API manda `X-Accel-Buffering: no`. Os tempos limite do nginx (`proxy_read_timeout`) e da Route contam inatividade: o sinal periódico do stream (`OLLY_WEBHOOK_STREAM_PING_SECONDS`, 15 s) mantém a conexão aberta em fluxos longos. A resposta síncrona (modos "último nó" e "nó de resposta") continua limitada pelos 130 s. Proxies fora do OpenShift (ex.: um proxy corporativo do cliente) também precisam repassar a resposta sem buffer.
