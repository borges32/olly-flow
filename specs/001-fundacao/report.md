# Relatório — Spec 001: Fundação

**Status:** Implementada com pendências (pendências humanas; nenhum comando de verificação falhando)
**Data:** 03/10/2026

## Resumo

Monorepo pnpm + Turborepo com API NestJS/Fastify (OIDC genérico via JWKS, `/health` e `/api/v1/me`), frontend React/Vite com login Authorization Code + PKCE, renovação silenciosa e logout, banco PostgreSQL com migrations reversíveis, seed de papéis e auditoria imutável, contratos centrais em `@olly/shared-types`, registro de nós com validação ajv, Docker Compose com PostgreSQL, Redis, Keycloak e MinIO (todos com healthcheck), CI no GitHub Actions, fixtures N8N e smoke test. Todos os comandos de verificação do `AGENTS.md` passam localmente.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | pnpm 10.34.6 fixado, Turborepo 2, ESLint 10 (`strictTypeChecked`), Prettier, `.editorconfig`, `.nvmrc` |
| T002 | ✅ | `apps/{api,web}` e `packages/{shared-types,nodes,db}` como workspaces; `apps/{worker,task-runner,python-runner}` e `packages/{engine,expressions,mcp-client,importer-n8n}` só com README apontando a spec de origem |
| T003 | ✅ | Ver "Desvios" sobre a imagem do MinIO |
| T004 | ✅ | `infra/keycloak/olly-realm.json` + README |
| T010 | ✅ | Migrator Kysely com provider de arquivos SQL (ver "Decisões") |
| T011 | ✅ | `infra/migrations/0001_fundacao.{up,down}.sql`; triggers bloqueiam `UPDATE`, `DELETE` e `TRUNCATE` em `audit_log` |
| T012 | ✅ | Ver "Decisões" sobre o catálogo de permissões |
| T013 | ✅ | |
| T014 | ✅ | |
| T020 | ✅ | |
| T021 | ✅ | Inclui `@Authenticated()` (ver "Desvios") |
| T022 | ✅ | |
| T023 | ✅ | IdP falso (JWKS local) + Testcontainers |
| T024 | ✅ | Tailwind 4 com componentes no padrão shadcn/ui (`components.json`) |
| T025 | ✅ | |
| T026 | ✅ | 4 cenários, incluindo renovação silenciosa e logout |
| T030 | ✅ | |
| T031 | ✅ | Workflow escrito e coberto por teste; não executado no GitHub (ver "Pendências") |
| T032 | ✅ | Só o exemplo sintético; os workflows da POC não foram exportados |
| T033 | ✅ | |
| T090 | ✅ | Executado a partir de estado limpo (sem `node_modules`, `dist`, cache e volumes) |
| T091 | ✅ | Tabela "Requisitos" abaixo |
| T092 | ✅ | |
| T093 | ✅ | |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `tests/repo.test.ts` › "FR-001: …" (workspaces, scripts, READMEs reservados) |
| FR-002 | Sim | `tests/repo.test.ts` › "FR-002: serviço %s com healthcheck"; `scripts/smoke.ts` (PostgreSQL, IdP, object storage e Redis via `/health`) |
| FR-003 | Sim | `tests/keycloak-realm.test.ts` › "FR-003: …"; `scripts/smoke.ts` (password grant real) |
| FR-004 | Sim | `apps/api/src/auth/auth.int.test.ts` › "FR-004: …" (sem token, esquema errado, malformado, assinatura, `alg: none`, emissor, audiência, expirado, sem `exp`); `apps/api/src/auth/route-coverage.int.test.ts` |
| FR-005 | Sim | `auth.int.test.ts` › "FR-005: primeiro login cria…", "logins seguintes atualizam…" |
| FR-006 | Sim | `auth.int.test.ts` › "FR-006: …"; `scripts/smoke.ts` |
| FR-007 | Sim | `apps/web/e2e/auth.spec.ts` (PKCE S256, login, retorno à rota, refresh token, logout); `apps/web/src/auth/oidc.test.ts`; `apps/web/src/api/client.test.ts` (401 → relogin) |
| FR-008 | Sim | `tests/repo.test.ts` › "FR-008: …" (nenhuma referência ao fornecedor em `apps/*/src`); `oidc.test.ts`; a API é testada contra um IdP OIDC genérico e o E2E contra o Keycloak, com o mesmo código |
| FR-009 | Sim | `packages/db/src/migrations.int.test.ts` › "FR-009: …" |
| FR-010 | Sim | `packages/db/src/seed.int.test.ts`; `packages/shared-types/src/rbac.test.ts` |
| FR-011 | Sim | `packages/db/src/audit-log.int.test.ts` |
| FR-012 | Sim | `apps/api/src/health/health.int.test.ts` (inclui IdP, Redis e banco fora do ar); `scripts/smoke.ts` |
| FR-013 | Sim | `packages/shared-types/src/workflow.test.ts` |
| FR-014 | Sim | `packages/nodes/src/registry.test.ts` |
| FR-015 | Sim | `tests/repo.test.ts` › "FR-015: …"; `.github/workflows/ci.yml` |
| FR-016 | Sim | `tests/fixtures.test.ts` |
| FR-017 | Sim | `scripts/smoke.ts` (`pnpm smoke`) |
| NFR-001 | Sim | Medição: do zero (volumes apagados, imagens já baixadas), `docker compose up -d && pnpm smoke` levou **29 s**; `docker compose up -d --wait` sozinho, ~26 s |
| NFR-002 | Sim | `tests/repo.test.ts` › "NFR-002: …"; `apps/api/src/config/config.test.ts` (erro de configuração não expõe valores); log redige `authorization` (verificado manualmente) |
| NFR-003 | Sim | `tests/keycloak-realm.test.ts` › "NFR-003: …" |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `docker compose down -v && docker compose up -d && pnpm smoke` (após `pnpm install` e `pnpm build`, como no README) |
| SC-002 | ✅ | `pnpm test:e2e` › "FR-007/SC-002: login com editor@olly.local mostra o nome no cabeçalho" |
| SC-003 | ✅ | `migrations.int.test.ts` (up → down → up); manualmente: `pnpm db:rollback --all && pnpm db:migrate` |
| SC-004 | ⚠️ Parcial | O CI está escrito e coberto por teste, mas não rodou no GitHub (nada foi enviado ao remoto) e o bloqueio de merge depende de configurar a proteção da branch |
| SC-005 | ✅ | Tabela abaixo |

## Comandos de verificação

Executados em 03/10/2026, Node 22.23.3, pnpm 10.34.6, Docker 29.8 / Compose 5.6, a partir de estado limpo e repetidos após os últimos ajustes.

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ (0 erros, 0 avisos; Prettier ok) |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 78 testes (shared-types 12, nodes 9, api 4, web 9, repositório 44) |
| `pnpm test:integration` | ✅ 37 testes (db 11, api 26) |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 4 testes |
| `docker compose up -d && pnpm smoke` | ✅ |
| `pnpm audit --audit-level=high` (etapa do CI) | ✅ 0 altas; 3 moderadas em ferramentas de teste (ver "Pendências") |

## Decisões tomadas

1. **Migrations em SQL puro** (`NNNN_nome.up.sql` + `.down.sql`) executadas pelo `Migrator` do Kysely com um `MigrationProvider` próprio. Arquivos TypeScript em `infra/migrations` exigiriam importar TS em tempo de execução fora de qualquer pacote (sem acesso a `kysely` pela resolução do pnpm). O provider recusa migration sem `down` (FR-009). `plan.md` §3 atualizado.
2. **Catálogo de permissões do seed.** O plano diz "admin: todas" e "permissões criadas em specs futuras são acrescentadas ao seed por elas", mas os papéis executor/viewer já usam permissões introduzidas nas specs 002/003. Interpretação adotada: o catálogo (`packages/shared-types/src/rbac.ts`) contém **todas** as permissões de `contratos.md`, **exceto `mcp:manage`**, que a spec 010 declara explicitamente que acrescenta ao seed do admin. Assim o editor já recebe `credential:*`, `workflow:publish` e `execution:readData`, coerente com a visão de produto. **Peço revisão humana desta interpretação.**
3. **Injeção explícita (`@Inject(...)`) em todos os construtores do NestJS**, sem depender de `emitDecoratorMetadata`. Assim o código roda igual em `tsc`, `tsx` e Vitest (esbuild não emite metadados). Convenção sugerida para as próximas specs.
4. **Pacotes consumidos pelo `dist`**, com `dependsOn: ["^build"]` no Turborepo, em vez de condições de exportação customizadas.
5. **Caches curtos na autenticação:** usuário sincronizado (30 s, chaveado pelas claims: qualquer mudança de nome/e-mail ignora o cache) e papéis (60 s). Uma inativação ou mudança de papel pode levar até 60 s para valer. Considerar na spec 009.
6. **Regras de borda da autenticação:** token sem `email` → 401; e-mail já associado a outro `sub` → 409; usuário inativo → 403; IdP inacessível ao validar um token → 503 (não 401, para não forçar relogin por falha de infraestrutura).
7. **Tokens no `sessionStorage`** (escopo da aba) e proxy do Vite para `/api` e `/health` (mesma origem, sem CORS). Em homologação/produção, a SPA e a API devem ficar atrás do mesmo proxy reverso ou a API precisará de CORS (spec 012).
8. **Versões das dependências:** o `stack.md` fixa TypeScript 5 e React 18, mantidos embora existam TS 7 e React 19. Para as demais, usei a major estável mais recente compatível com essas duas (NestJS 11, Vite 7, Vitest 3, Tailwind 4, zod 4, Kysely 0.28, pnpm 10, ESLint 10), e não as majors mais novas do npm (NestJS 12, Vite 8, Vitest 5, pnpm 12).
9. **Overrides de segurança no `pnpm-workspace.yaml`:** `fastify ^5.12.5` (o `@nestjs/platform-fastify` 11 fixa 5.11.3, com 4 vulnerabilidades altas) e `js-yaml ^5.4.1` (via `@nestjs/swagger`). Remover quando as dependências diretas exigirem as versões corrigidas.
10. **Turborepo `agentGuidance: false`:** o `turbo` 2.11 insere um bloco próprio no `AGENTS.md` ao detectar um agente. Desativei a opção e mantive o `AGENTS.md` original, porque é um documento normativo do projeto.

## Desvios da spec/plano

| Desvio | Motivo | Documento atualizado |
|---|---|---|
| `/health` devolve `{ status, db, redis, idp }`; 200 com `ok`/`degraded`, 503 com `error` se banco ou Redis estiver fora | Caso de borda da spec: com o IdP fora, `/health` "indica a dependência degradada" | `plan.md` (Contratos + Histórico); `HealthResponse` em `shared-types` |
| MinIO via `cgr.dev/chainguard/minio` (fixada por digest), com o bucket criado pelo próprio serviço | As imagens oficiais `minio/minio` e `quay.io/minio/minio` não estão mais disponíveis; a da Chainguard é o MinIO compilado do código-fonte. Um serviço *one-shot* para o bucket quebra `docker compose up --wait` | `plan.md` §2 + Histórico. Continua sendo MinIO, então o `stack.md` não muda |
| Decorator `@Authenticated()` e teste de cobertura de rotas | Constituição, Art. III.4 ("toda rota declara a permissão exigida"). `/me` não exige permissão específica, só autenticação; a declaração explícita e o teste (`route-coverage.int.test.ts`) atendem ao artigo sem antecipar o RBAC por projeto da spec 002, que deve estender o teste com `@RequirePermission` | Este relatório |
| Contratos novos: `BinaryRef`, `PortDef.kind`, `ExecutionStatus`, `NodeExecutionStatus`, `NodeExecuteInput`, invariantes de `workflowDefinitionSchema`, regras do `NodeRegistry`, matriz padrão de papéis | Definidos pelo plano §7 e pelas specs 004/011, sem forma exata em `contratos.md` | `docs/arquitetura/contratos.md` |
| Colunas `users.updated_at` e `project_members.created_at` | Rastrear a última sincronização com o IdP e a data do vínculo | `docs/arquitetura/modelo-dados.md` |

**Conformidade com o processo:** a constituição (`.specify/memory/constitution.md`) e os templates foram adicionados ao repositório durante a sessão, depois da leitura inicial. Revisei a implementação contra a constituição ao fim e corrigi três pontos: Art. III.4 (acima), Art. III.8 (removi um `eslint-disable` e um override de regra em testes que eu tinha introduzido) e Art. IX.1 (licenças abaixo). As atualizações de `plan.md` foram feitas durante a implementação, não antes dela, como pede o Art. I.3. A `spec.md` não precisou mudar de comportamento.

## Dependências adicionadas

Todas as licenças são permissivas (MIT, Apache-2.0, ISC). Pacotes listados no `stack.md` aparecem como "stack".

| Pacote | Versão | Motivo | Licença |
|---|---|---|---|
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-fastify`, `@nestjs/testing` | 11.2.7 | Stack (API) | MIT |
| `fastify` | 5.12.5 | Tipos de request/reply e override de segurança | MIT |
| `@nestjs/swagger` | 11.4.7 | Swagger em `/docs` (plano §4) | MIT |
| `@fastify/static` | 10.1.5 | Peer do Swagger UI no adapter Fastify | MIT |
| `nestjs-pino`, `pino`, `pino-http` | 4.6.1 / 9.14.0 / 10.5.0 | Stack (logger); `pino`/`pino-http` são peers | MIT |
| `reflect-metadata`, `rxjs` | 0.2.2 / 7.8.2 | Peers do NestJS | Apache-2.0 |
| `jose` | 6.2.12 | Stack (validação de JWT via JWKS) | MIT |
| `ioredis` | 5.11.1 | Cliente Redis do `/health`; o mesmo usado pelo BullMQ (spec 006) | MIT |
| `zod` | 4.6.5 | Stack | MIT |
| `kysely`, `pg`, `@types/pg` | 0.28.17 / 8.23.1 | Stack (banco) | MIT |
| `ajv`, `@types/json-schema` | 8.20.0 / 7.0.15 | Validação de `paramsSchema` (plano §7) e tipo `JSONSchema7` do contrato | MIT |
| `react`, `react-dom`, `@types/react`, `@types/react-dom` | 18.3.x | Stack | MIT |
| `react-router` | 7.18.4 | Stack | MIT |
| `@tanstack/react-query` | 5.104.1 | Stack | MIT |
| `oidc-client-ts` | 3.5.0 | Stack | Apache-2.0 |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.3 | Stack | MIT |
| `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` | — | Dependências padrão dos componentes shadcn/ui | MIT / Apache-2.0 / ISC |
| `sonner` | 2.0.8 | Toast do shadcn/ui (aviso de 403, plano §6) | MIT |
| `vite`, `@vitejs/plugin-react` | 7.3.6 / 5.2.0 | Stack | MIT |
| `vitest`, `@playwright/test`, `@testcontainers/postgresql`, `@testcontainers/redis` | — | Stack (testes) | MIT / Apache-2.0 |
| `turbo`, `typescript` | 2.11.7 / 5.9.3 | Stack | MIT / Apache-2.0 |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`, `prettier` | — | Lint e formatação (plano §1) | MIT |
| `tsx` | 4.23.15 | Executar TypeScript em `pnpm dev` (API), `pnpm smoke` e no preparo do E2E | MIT |
| `@types/node` | 22.20.5 | Tipos do Node 22 | MIT |

Imagens Docker: `postgres:16-alpine`, `redis:7-alpine`, `quay.io/keycloak/keycloak:26.6` (Apache-2.0) e `cgr.dev/chainguard/minio` (MinIO, AGPL-3.0, usado só como serviço de desenvolvimento, sem linkagem).

## Pendências, bloqueios e riscos

- **[PRECISA ESCLARECIMENTO: plataforma de CI]** continua aberto. Usei o padrão da spec (GitHub Actions). Se for GitLab CI, o workflow precisa ser portado.
- **Proteção de branch (SC-004):** marcar os jobs `verify`, `integration` e `e2e` como *required status checks* na `main`. Ação humana.
- **CI não executado no GitHub:** nada foi enviado ao remoto. As versões das actions (`checkout@v5`, `setup-node@v5`, `pnpm/action-setup@v4`, `upload-artifact@v4`) devem ser confirmadas na primeira execução.
- **ADRs 0002–0004 seguem `Proposta`:** implementado conforme a proposta, como a spec autoriza.
- **ADR-0005 (IdP) pendente:** a integração é OIDC genérica (emissor + audiência + client id); o Keycloak é só o IdP local. Nada institucional foi assumido.
- **Fixtures da POC:** não exportadas (pré-requisito humano). Só existe `fixtures/n8n/exemplo-set-if`, marcado como sintético.
- **Vulnerabilidades moderadas restantes** (não bloqueiam o CI): `vitest`/`@vitest/mocker` < 4.1.11 (leitura de arquivo pelo servidor de mocks; só em desenvolvimento, corrigida apenas na major 4) e `uuid` < 11.1.1 (via `testcontainers` → `dockerode`, só em testes).
- **Imagem do MinIO:** o plano gratuito da Chainguard publica apenas a tag flutuante; o compose fixa o digest. Atualizar exige trocar o digest manualmente. Se a instituição tiver um registry interno com MinIO, substitua.
- **Keycloak em `start-dev`** usa banco embutido: alterações feitas no console se perdem ao recriar o container; o realm é reimportado do arquivo.
- **Rotas inexistentes sob `/api/v1`** devolvem 404 antes do guard (o guard só roda em rotas existentes).

## Como demonstrar

```bash
corepack enable && pnpm install
cp .env.example .env
docker compose up -d --wait
pnpm build && pnpm db:migrate && pnpm db:seed
pnpm smoke                       # ✔ por requisito (FR-002, 003, 004, 006, 009, 012, 017)
pnpm dev                         # API :3000 e frontend :5173
```

1. Abra <http://localhost:5173>, clique em **Entrar com conta institucional** e use `editor@olly.local` / `olly123`. O cabeçalho mostra **Eduardo Editor** e a tela inicial lista as permissões do papel.
2. Alterne o tema (ícone de lua/sol), navegue pelo menu lateral e clique em **Sair**. Um novo login volta a pedir credenciais.
3. Entre como `viewer@olly.local` e compare as permissões.
4. `curl -i localhost:3000/api/v1/me` → 401 com `requestId`; `curl localhost:3000/health` → `{"status":"ok",...}`.
5. `docker compose stop keycloak && curl localhost:3000/health` → `"status":"degraded","idp":"down"` (HTTP 200). Depois, `docker compose start keycloak`.
6. Swagger: <http://localhost:3000/docs> (com `NODE_ENV=development`).
7. Testes: `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`.

## Próximos passos sugeridos

- Confirmar a interpretação do catálogo de permissões do seed (Decisão 2) antes da spec 002.
- Na spec 002, estender `route-coverage.int.test.ts` para `@RequirePermission` e substituir o `GroupPermissionResolver`.
- Avaliar a migração para Vitest 4 (remove as vulnerabilidades moderadas restantes) e, mais adiante, NestJS 12.
- Imagem Docker da API e do frontend para homologação (spec 012), com proxy reverso de mesma origem.
- Auditar o primeiro login (`user.created`) quando a spec 009 tratar inativação e grupos do IdP.
