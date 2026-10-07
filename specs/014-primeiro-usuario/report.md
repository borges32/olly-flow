# Relatório — Spec 014: Primeiro usuário, usuários locais e IdP opcional

**Status:** Implementada com pendências (validação da Segurança para o login local)
**Data:** 06/10/2026

## Resumo

- **Usuários locais** (e-mail e senha) passam a ser a forma de entrada padrão:
  - hash scrypt com os parâmetros da OWASP e política de senha;
  - bloqueio após tentativas erradas;
  - sessões opacas revogáveis, com expiração por inatividade e por tempo máximo;
  - troca obrigatória da senha definida pela administração.
- **Primeiro usuário:** numa instalação sem usuários, a tela de entrada conduz o cadastro do administrador da plataforma, aceito uma única vez (com trava contra cadastros simultâneos).
- **Administração › Usuários:** criar, editar, desativar e reativar, redefinir senha e conceder administração global, com origem, situação e último acesso. A plataforma nunca fica sem administrador ativo.
- **IdP opcional** (`OLLY_IDP_ENABLED`, desligado por padrão): com ele, a tela oferece as duas entradas; e-mails iguais são vinculados se o IdP confirmar o e-mail; a ativação é auditada.
- **Comando do operador** (`users-admin`) para criar ou recuperar um administrador local.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `infra/migrations/0015_local_users.{up,down}.sql`; tipos em `packages/db` |
| T002 | ✅ | `OLLY_IDP_ENABLED`, limites de sessão e bloqueio; `OIDC_*` obrigatórias só com o IdP; `AppConfig.auth`, `AppConfig.oidc` opcional |
| T003 | ✅ | `packages/shared-types/src/auth.ts`; `UserAdminSummary` e `MeResponse` ampliados |
| T010 | ✅ | `apps/api/src/auth/password.ts` (scrypt, política, hash fictício) |
| T011 | ✅ | `LocalSessionService` (token `olly_s_…`, hash SHA-256, cache de 30 s, revogação) |
| T012 | ✅ | `Authenticator` com os dois caminhos; `PermissionResolver` com `users.is_admin`; guard da troca de senha |
| T020–T021 | ✅ | `GET /auth/config`, `POST /auth/setup` (`pg_advisory_xact_lock`) |
| T030–T031 | ✅ | `POST /auth/local/login`, `POST /auth/logout`, `PUT /auth/password` |
| T040–T041 | ✅ | `UsersAdminService` e rotas `admin/users` (criar, editar, redefinir, ativar com revogação) |
| T042 | ✅ | `apps/api/src/cli/users-admin.ts` + `auth/admin-recovery.ts` |
| T043 | ✅ | Limpeza das sessões no job de manutenção (spec 009) |
| T050–T051 | ✅ | Vinculação por e-mail no `UserSyncService` (`email_verified`), `IdpConfigAudit`, `POST /auth/login` 404 sem IdP |
| T060 | ✅ | `AuthProvider` (local ou OIDC), telas de entrada, primeiro cadastro e troca de senha |
| T061 | ✅ | Administração › Usuários (`admin-users-card.tsx`); grupos do IdP só com ele ativado |
| T062 | ✅ | `local-session.test.ts` |
| T070 | ✅ | Compose, `.env.example`, Playwright (`OLLY_IDP_ENABLED=true` nos cenários do Keycloak), smoke com o IdP desligado |
| T071 | ✅ | `e2e/local-auth.spec.ts` |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ✅ | Todo FR tem teste que o cita (tabela abaixo); SC-001 tem a parte "menos de 3 minutos" a medir com usuários |
| T092 | ✅ | `docs/autenticacao.md` (novo), `governanca.md`, `lgpd.md` (inalterado), `contratos.md`, `modelo-dados.md`, README |
| T093 | ✅ | Este relatório; status em `spec.md` e `docs/roadmap.md` |

## Requisitos

Caminhos: `local-auth` = `apps/api/src/auth/local-auth.int.test.ts`; `admin` = `apps/api/src/sso/local-users-admin.int.test.ts`; `idp` = `apps/api/src/auth/idp-toggle.int.test.ts`.

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `local-auth` › "FR-001/FR-010" |
| FR-002 | Sim | `local-auth` › "FR-002/FR-003/SC-001/SC-002" (5 cadastros simultâneos, um vence) |
| FR-003 | Sim | Idem (o primeiro usuário tem `user:manage` e cria projeto) |
| FR-004 | Sim | `local-auth` › "FR-004/FR-005", "FR-004/NFR-004"; `apps/web/src/auth/local-session.test.ts` |
| FR-005 | Sim | `local-auth` › "FR-004/FR-005" (mensagem igual para senha errada e e-mail inexistente), "FR-005/NFR-004" (bloqueio) |
| FR-006 | Sim | `admin` › "FR-006/FR-007/FR-012/SC-003", "FR-006/FR-014", "FR-006/FR-007" |
| FR-007 | Sim | `local-auth` › "FR-007"; `admin` › troca obrigatória e redefinição |
| FR-008 | Sim | `admin` › "FR-008/SC-004" |
| FR-009 | Sim | `admin` › "FR-009"; `apps/api/src/maintenance/retention.int.test.ts` › "spec 014 — FR-009" |
| FR-010 | Sim | `local-auth` › "FR-001/FR-010"; `idp` › "FR-010/FR-011/SC-006"; `config.test.ts` › "spec 014 — FR-010/NFR-004"; `health.int.test.ts` › "spec 014 — FR-010" |
| FR-011 | Sim | `idp` › "FR-010/FR-011/SC-006", "FR-015/SC-007" (login local continua) |
| FR-012 | Sim | `admin` › "FR-006/FR-007/FR-012/SC-003" (usuário local editor cria workflow) |
| FR-013 | Sim | `admin` › "FR-013"; `idp` › "FR-013" (`auth.idp_config` só na mudança); auditorias conferidas em `local-auth` |
| FR-014 | Sim | `admin` › "FR-006/FR-014" |
| FR-015 | Sim | `idp` › "FR-015/SC-007" (vincula com `email_verified`, recusa sem) |
| FR-016 | Sim | `apps/api/src/auth/admin-recovery.int.test.ts` › "SC-008", "FR-016" |
| NFR-001 | Sim | `apps/api/src/auth/password.test.ts`; `local-auth` › "NFR-001" |
| NFR-002 | Sim | `password.test.ts`; `local-auth` › "SC-005/NFR-002" (sentinela em logs, respostas, auditoria e banco) |
| NFR-003 | — | Sem código de instalação, por decisão do PO (risco aceito) |
| NFR-004 | Sim | `config.test.ts`; `local-auth` › "FR-005/NFR-004", "FR-004/NFR-004" |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ (fluxo) / ⚠️ (tempo) | `local-auth` › cadastro, entrada e criação de projeto sem IdP. Os "menos de 3 minutos" para uma pessoa sem orientação precisam de teste com usuários |
| SC-002 | ✅ | `local-auth` (5 cadastros simultâneos; UI e API recusam depois) |
| SC-003 | ✅ | `admin` e `e2e/local-auth.spec.ts` |
| SC-004 | ✅ | `admin` › "FR-008/SC-004" (na hora no mesmo processo; até 30 s em outros, pelo cache) |
| SC-005 | ✅ | `local-auth` › "SC-005/NFR-002" |
| SC-006 | ✅ | `idp`, `local-auth`, `e2e/local-auth.spec.ts`, smoke (IdP desligado) |
| SC-007 | ✅ | `idp` › "FR-015/SC-007" |
| SC-008 | ✅ | `admin-recovery.int.test.ts` › "SC-008" |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` / `pnpm typecheck` / prettier | ✅ |
| `pnpm test` | ✅ 653 testes |
| `pnpm test:integration` | ✅ 327 testes (api 273, db 28, nodes 23, engine 3) + o teste novo do `/health` rodado à parte após a correção (5/5) |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 38 cenários (um a mais: login local) |
| `pnpm app:up && pnpm smoke` | ✅ com o IdP desligado (padrão) |
| `pnpm audit --prod` | ✅ Nenhuma vulnerabilidade conhecida |

## Decisões tomadas

- **Sessão opaca no banco** em vez de JWT próprio (revogação imediata), com o mesmo transporte `Bearer` do OIDC; **scrypt** do `node:crypto` (sem dependência nova); token local no `localStorage` (como o fluxo atual do navegador); bloqueio por usuário.
- **Vinculação só com `email_verified`** (salvaguarda apresentada ao PO na revisão do plano).
- **Correções encontradas na implementação:**
  - a inativação por falta de uso (spec 009) podia inativar o último administrador: agora preserva o de acesso mais recente (teste de reprodução em `retention.int.test.ts`);
  - o `/health` checava o IdP mesmo desligado e ficava "degraded": agora responde `idp: "disabled"` (teste antes da correção em `health.int.test.ts`).
- O custo do scrypt é configurável só nos testes de lógica: com os parâmetros reais em todos os casos, a disputa de CPU fazia falhar o teste de desempenho da spec 003, que roda em paralelo.

## Desvios da spec/plano

Registrados no Histórico do [plan.md](plan.md) e do plano da [spec 009](../009-governanca-lgpd-sso/plan.md): códigos de erro no padrão da API (`password_change_required`, `password_policy`); comando em `dist/cli/users-admin.js`; rotas no `GovernanceModule`; registro da ativação do IdP não bloqueia a subida; proteção do último administrador na inativação automática. Nenhum requisito da spec mudou.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- **Validação da Segurança** para o login local (pré-requisito do roadmap): política de senha, bloqueio, sessão, vinculação por e-mail e o risco aceito da NFR-003.
- **Instalações existentes** (só usuários do Keycloak): com o novo padrão, ninguém tem senha local. Subir com `OLLY_IDP_ENABLED=true` mantém o comportamento anterior; ou criar um administrador com `docker compose exec api node apps/api/dist/cli/users-admin.js --email <e-mail>`.
- **Riscos:** tomada da instalação antes do primeiro cadastro (aceito pelo PO); força bruta distribuída por vários e-mails (há bloqueio por usuário e auditoria, sem limite por IP); o token local fica no `localStorage` (exposto a XSS, como o token OIDC já ficava no navegador).
- SC-001 (tempo de 3 minutos) precisa de medição com usuários reais.

## Como demonstrar

1. `pnpm app:reset` (instalação zerada) ou um banco vazio; abra <http://localhost:5173>.
2. Cadastre o administrador na primeira tela; crie um projeto em Administração.
3. Em **Administração › Usuários**, crie um usuário local, adicione-o ao projeto; saia e entre com ele: a plataforma pede a troca de senha.
4. Erre a senha 5 vezes: o usuário fica bloqueado (aparece na listagem); a redefinição desbloqueia.
5. Desative o usuário com a sessão dele aberta: o acesso cai.
6. Suba com `OLLY_IDP_ENABLED=true pnpm app:up`: a tela mostra também "Entrar com conta institucional"; um usuário do Keycloak com o mesmo e-mail de um usuário local entra como ele.
7. Recuperação: `docker compose exec api node apps/api/dist/cli/users-admin.js --email ops@olly.local`.

## Próximos passos sugeridos

- MFA (TOTP) para usuários locais, ao menos para administradores.
- Limite de tentativas por IP no login local.
- Recuperação de senha por e-mail, quando houver SMTP institucional.
- Convites por e-mail para novos usuários.
