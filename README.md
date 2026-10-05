# Olly Flow

Plataforma interna de automação de workflows visuais com IA, compatível conceitualmente com o N8N ([ADR-0001](docs/adr/0001-abordagem-hibrida.md)). O desenvolvimento segue **Spec-Driven Development**: veja o [`AGENTS.md`](AGENTS.md), o [roadmap](docs/roadmap.md) e a [documentação](docs/README.md).

## Pré-requisitos

| Ferramenta | Versão |
|---|---|
| Node.js | 22 LTS (`.nvmrc`; com nvm: `nvm install && nvm use`) |
| pnpm | fixado em `package.json` (`packageManager`); habilite com `corepack enable` |
| Docker | Engine 24+ com Docker Compose v2 |

Máquina de referência: 16 GB de RAM. As portas `3000`, `5173`, `5432`, `6379`, `8080`, `9000` e `9001` precisam estar livres.

## Primeiros passos

```bash
corepack enable
pnpm install
cp .env.example .env            # valores fictícios, só para o ambiente local (inclui OLLY_MASTER_KEY)
docker compose up -d --wait     # PostgreSQL, Redis, Keycloak (IdP de dev) e MinIO
pnpm build
pnpm db:migrate && pnpm db:seed
pnpm smoke                      # verifica o ambiente de ponta a ponta
```

Desenvolvimento com recarga automática (API em `:3000`, worker em `:3101`, frontend em `:5173`):

```bash
pnpm dev
```

As execuções passam pela fila (Redis/BullMQ) e são executadas pelo **worker** (`apps/worker`, spec 006), que o `pnpm dev` também sobe. Para executar os testes do editor sem worker, use `OLLY_TEST_RUN_MODE=inprocess` no `.env`. Semântica de execução (paralelismo, cancelamento, cotas): [docs/execucao.md](docs/execucao.md).

> **`.env` criado antes da spec 004?** Acrescente `OLLY_MASTER_KEY` (copie do `.env.example` ou gere com `openssl rand -base64 32`): a API não sobe sem a chave mestra das credenciais. Ver [docs/credenciais.md](docs/credenciais.md).

Abra <http://localhost:5173> e entre com um usuário de teste (senha `olly123`).

Webhooks publicados respondem em `http://localhost:5173/webhook/<caminho>` (e `/webhook-test/<caminho>` enquanto o editor escuta), pelo proxy do frontend; direto na API, em `http://localhost:3000/webhook/<caminho>`. Ver [docs/nos/trigger.webhook.md](docs/nos/trigger.webhook.md). Só `admin@olly.local` (grupo `admin` do IdP) tem acesso global; os demais precisam ser adicionados a um projeto em **Administração** para ver e editar workflows.

| Usuário | Papel |
|---|---|
| `admin@olly.local` | admin |
| `editor@olly.local` | editor |
| `executor@olly.local` | executor |
| `viewer@olly.local` | viewer |

### Testar a UX sem ambiente de desenvolvimento

Para validar o editor com usuários (por exemplo, da POC) sem instalar Node, suba também a API, o worker e o frontend em containers (`--scale worker=3` para vários workers):

```bash
docker compose --profile app up -d --build --wait   # ou: pnpm app:up
```

Abra <http://localhost:5173>. A API e o frontend usam as portas `3000` e `5173`: pare o `pnpm dev` antes, e use `pnpm app:down` para voltar ao modo de desenvolvimento. Após mudar o código, repita o comando (ele reconstrói as imagens).

- **Apagar tudo e recomeçar:** `pnpm app:reset` (remove containers e volumes e sobe de novo).
- **Banco sempre pronto:** o serviço `db-init` aplica migrations e seed e continua vigiando; se o banco for recriado com a API no ar, o schema volta em segundos.
- **Usuários:** o login é exclusivamente pelo IdP (não há cadastro na plataforma). No ambiente local, use os usuários de teste da tabela acima, que existem no Keycloak desde a subida; o registro na plataforma acontece no primeiro login.

Roteiro sugerido: entre uma vez com cada usuário de teste (para existirem na plataforma), depois, como `admin@olly.local`, crie um projeto em **Administração** e adicione os demais com os papéis desejados.

Outros endereços úteis:

| Serviço | Endereço |
|---|---|
| API (saúde) | <http://localhost:3000/health> |
| Swagger (somente `NODE_ENV=development`) | <http://localhost:3000/docs> |
| Console do Keycloak | <http://localhost:8080/admin> (`admin`/`admin`) |
| Console do MinIO | <http://localhost:9001> (`olly`/`olly-dev-secret`) |

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | API, worker e frontend em modo desenvolvimento |
| `pnpm build` | Compila todos os workspaces |
| `pnpm lint` | ESLint (estrito, com tipos) e Prettier |
| `pnpm typecheck` | TypeScript em todos os workspaces |
| `pnpm test` | Testes de unidade |
| `pnpm test:integration` | Testes de integração com Testcontainers (exige Docker) |
| `pnpm test:e2e` | Playwright; sobe o compose, aplica migrations e inicia API, worker e frontend |
| `pnpm smoke` | Smoke test do ambiente (inicia a API compilada se ela não estiver no ar) |
| `pnpm app:up` / `pnpm app:down` / `pnpm app:reset` | Sobe/para/recria do zero a API, o worker e o frontend em containers (profile `app`), para testes de UX |
| `infra/load/run.sh` | Teste de carga (k6) do webhook com N workers ([infra/load](infra/load/README.md)) |
| `pnpm db:migrate` / `pnpm db:rollback` / `pnpm db:seed` | Migrations ([`infra/migrations`](infra/migrations/README.md)) e papéis padrão |

Na primeira execução do E2E, instale o navegador: `pnpm --filter @olly/web exec playwright install chromium`.

## Estrutura

```text
apps/api               API REST (NestJS + Fastify): OIDC, RBAC por projeto, projetos, workflows
apps/web               Frontend (React + Vite + Tailwind + shadcn/ui), editor com React Flow
apps/worker            Worker de execuções: consome a fila e executa com o motor (spec 006)
apps/task-runner       Sandbox de expressões e código JavaScript (isolated-vm)
apps/python-runner     reservado (spec 008)
packages/shared-types  Tipos e schemas zod dos contratos centrais
packages/nodes         Contrato de nó, registro e nós (docs/nos/)
packages/engine        Validação estrutural e motor de execução
packages/db            Kysely, migrator, seed
infra/keycloak         Realm do IdP de desenvolvimento
infra/migrations       Migrations SQL versionadas
fixtures/n8n           Workflows de referência da POC (formato no README da pasta)
specs/                 Especificações (spec, plan, tasks, report)
```

Detalhes em [`docs/arquitetura/stack.md`](docs/arquitetura/stack.md).

## Problemas comuns

- **Porta ocupada:** `docker compose up` falha com `address already in use`. Libere a porta ou pare o serviço local equivalente (por exemplo, um PostgreSQL instalado na máquina).
- **Realm alterado não aparece:** o Keycloak só importa o realm se ele ainda não existir. Recrie: `docker compose up -d --force-recreate keycloak`.
- **Recomeçar do zero:** `docker compose down -v` apaga os volumes do banco e do MinIO.
