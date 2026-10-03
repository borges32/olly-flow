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
cp .env.example .env            # valores fictícios, só para o ambiente local
docker compose up -d --wait     # PostgreSQL, Redis, Keycloak (IdP de dev) e MinIO
pnpm build
pnpm db:migrate && pnpm db:seed
pnpm smoke                      # verifica o ambiente de ponta a ponta
```

Desenvolvimento com recarga automática (API em `:3000`, frontend em `:5173`):

```bash
pnpm dev
```

Abra <http://localhost:5173> e entre com um usuário de teste (senha `olly123`):

| Usuário | Papel |
|---|---|
| `admin@olly.local` | admin |
| `editor@olly.local` | editor |
| `executor@olly.local` | executor |
| `viewer@olly.local` | viewer |

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
| `pnpm dev` | API e frontend em modo desenvolvimento |
| `pnpm build` | Compila todos os workspaces |
| `pnpm lint` | ESLint (estrito, com tipos) e Prettier |
| `pnpm typecheck` | TypeScript em todos os workspaces |
| `pnpm test` | Testes de unidade |
| `pnpm test:integration` | Testes de integração com Testcontainers (exige Docker) |
| `pnpm test:e2e` | Playwright; sobe o compose, aplica migrations e inicia API e frontend |
| `pnpm smoke` | Smoke test do ambiente (inicia a API compilada se ela não estiver no ar) |
| `pnpm db:migrate` / `pnpm db:rollback` / `pnpm db:seed` | Migrations ([`infra/migrations`](infra/migrations/README.md)) e papéis padrão |

Na primeira execução do E2E, instale o navegador: `pnpm --filter @olly/web exec playwright install chromium`.

## Estrutura

```text
apps/api               API REST (NestJS + Fastify): OIDC, /health, /api/v1/me
apps/web               Frontend (React + Vite + Tailwind + shadcn/ui)
apps/worker, apps/task-runner, apps/python-runner   reservados (specs 003, 006, 008)
packages/shared-types  Tipos e schemas zod dos contratos centrais
packages/nodes         Contrato de nó e registro de nós
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
