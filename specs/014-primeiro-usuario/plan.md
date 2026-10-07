# Plano técnico — Spec 014: Primeiro usuário, usuários locais e IdP opcional

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Usuários locais na tabela `users`:** hash de senha (scrypt, do `node:crypto`), troca obrigatória, administração global, tentativas e bloqueio.
- **Sessões locais opacas:** token aleatório (`olly_s_…`), guardado só como hash em `user_sessions`, enviado como `Bearer` igual ao token OIDC. Assim a API, o WebSocket e o web tratam os dois tipos da mesma forma.
- **Escolha do caminho:** o `Authenticator` olha o prefixo do token. Sessão local → banco (com cache de 30 s); senão → OIDC, só se `OLLY_IDP_ENABLED=true`.
- **IdP opcional:** desligado por padrão. As variáveis `OIDC_*` só são exigidas com ele ligado. A administração global vem de `users.is_admin` ou, com o IdP, do grupo de administração.
- **Web:** a tela de entrada consulta `GET /auth/config` e mostra o cadastro do primeiro usuário, o login local e, se ativado, "Entrar com conta institucional". Também ganha a tela de troca de senha e a gestão de usuários locais em Administração.
- **Comando do operador** para criar ou recuperar um administrador local.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III — Segurança | Senhas só como hash scrypt (sal por senha, parâmetros OWASP); sessões opacas guardadas como hash; bloqueio por tentativas; mensagens genéricas; comparação em tempo constante e hash fictício para e-mail inexistente; nada de senha em logs, respostas, auditoria ou telemetria (redact + teste sentinela) |
| IV — Testes | Integração para cada FR (API real com banco) e E2E do login local; teste de concorrência do primeiro cadastro |
| V — Escopo | Sem autocadastro, convite, recuperação por e-mail ou MFA (fora do escopo da spec) |
| VI — Decisões institucionais | O IdP continua atrás da configuração (ADR-0005); nada institucional é inventado. Risco da NFR-003 aceito pelo PO |
| VII — Rastreabilidade | Auditoria de cadastro, entradas, bloqueios, mudanças de usuários, vinculação e configuração do IdP |
| VIII — Privacidade | E-mail e nome já são dados de usuário (spec 002); as tentativas falhas auditam o e-mail informado, como hoje no login OIDC (spec 009) |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `infra/migrations` | `0015_local_users`: colunas em `users`, tabela `user_sessions` |
| `packages/db` | Tipos das novas colunas e da tabela |
| `packages/shared-types` | `AuthConfig`, `LocalLoginResponse`, `UserAdminSummary` (origem, situação, admin), corpos das rotas |
| `apps/api/src/config` | `OLLY_IDP_ENABLED`, limites de sessão e bloqueio; `OIDC_*` condicionais; `AppConfig.oidc` opcional |
| `apps/api/src/auth` | `PasswordHasher`, `LocalSessionService`, `LocalAuthService`, `LocalAuthController`; `Authenticator` com os dois caminhos; `PermissionResolver` com `is_admin`; `UserSyncService` com vinculação por e-mail |
| `apps/api/src/sso` | Rotas de administração de usuários: criar, editar, redefinir senha, administração global |
| `apps/api/src/scripts` | `users-admin.ts` (comando do operador) |
| `apps/web` | Telas de primeiro cadastro, login local e troca de senha; `AuthProvider` com sessão local ou OIDC; Administração › Usuários com usuários locais |
| `scripts/smoke.ts` | Funciona com o IdP desligado (padrão) |
| `docker-compose.yml`, `.env.example`, `apps/web/playwright.config.ts` | `OLLY_IDP_ENABLED` (padrão `false`; E2E com `true` para os cenários do Keycloak) |
| `docs/` | `autenticacao.md` (novo), `governanca.md`, `contratos.md`, `modelo-dados.md`, README |

## Design

### §1 Senhas (NFR-001, NFR-002)
- `PasswordHasher`:
  - `scrypt` com N=2^17, r=8, p=1 e sal aleatório de 16 bytes; formato `scrypt$N$r$p$sal$hash` (base64);
  - verificação com `timingSafeEqual`;
  - `needsRehash` se os parâmetros mudarem.
- **Política** (`validatePassword(password, email)`): mínimo de 12 caracteres, máximo de 256; recusa a lista embutida de senhas comuns (≥ 12 caracteres, normalizada em minúsculas) e senhas que contenham a parte local do e-mail. Mensagens claras na API e no web.
- E-mail inexistente no login: compara com um hash fictício, para o tempo não revelar se o e-mail existe.

### §2 Sessões locais (FR-004, FR-008, NFR-004)
- **Token:** `olly_s_` + 32 bytes aleatórios (base64url), entregue uma vez. O banco guarda `sha256(token)`.
- **Validade:**
  - expira por inatividade (`OLLY_SESSION_IDLE_MINUTES`, 480) e por tempo máximo (`OLLY_SESSION_MAX_HOURS`, 24);
  - `last_used_at` é atualizado no máximo uma vez por minuto.
- **Validação:**
  - consulta a sessão com o usuário, com cache em memória de 30 s;
  - recusa sessão revogada, expirada ou de usuário inativo;
  - desativar um usuário revoga as sessões dele no banco e limpa o cache local. SC-004 (até 1 min, inclusive em outros processos) vale pelo TTL do cache.
- **Sair:** revoga a sessão atual. Trocar ou redefinir a senha revoga as outras sessões do usuário.
- **Primeiro acesso:** com `must_change_password`, a sessão só acessa `GET /me`, `GET /auth/config`, `PUT /auth/password` e `POST /auth/logout`. As demais rotas respondem `403 password_change_required`.

### §3 Login local, bloqueio e primeiro usuário (FR-001 a FR-005)
- **`POST /auth/local/login`:**
  - e-mail normalizado (minúsculas, sem espaços);
  - usuário inexistente, inativo, sem senha local ou bloqueado: resposta genérica (`401 Credenciais inválidas`), com auditoria `auth.local_login_failed` e o motivo só no detalhe da auditoria;
  - senha errada: incrementa `failed_logins`; ao chegar a `OLLY_LOGIN_MAX_ATTEMPTS` (5), grava `locked_until = now + OLLY_LOGIN_LOCK_MINUTES` (15) e audita `auth.local_locked`;
  - acerto: zera as tentativas, grava `last_login_at`, cria a sessão e audita `auth.local_login`.
- **`GET /auth/config` (público):** `{ setupRequired, idpEnabled, oidc? }`. `setupRequired` = nenhum usuário na tabela.
- **`POST /auth/setup` (público):**
  - em transação com `pg_advisory_xact_lock` (chave fixa): se já houver usuário, `409 Instalação já configurada` (FR-002);
  - senão, cria o usuário local com `is_admin = true`, audita `auth.setup` e devolve uma sessão (o usuário entra direto);
  - concorrência coberta por teste com 5 chamadas simultâneas.

### §4 Administração de usuários (FR-006, FR-007, FR-009, FR-014)
Rotas em `admin/users`, todas com `user:manage` global e auditadas:
- **`GET`** (já existe): passa a trazer `origin` (`local` | `idp` | `linked`), `isAdmin`, `locked`, `mustChangePassword` e `lastLoginAt`;
- **`POST`** `{ name, email, password, isAdmin? }`: cria um usuário local com `must_change_password = true`;
- **`PATCH /:id`** `{ name?, email?, isAdmin? }`: o e-mail continua único (409);
- **`PUT /:id/active`** (já existe): passa a revogar as sessões;
- **`PUT /:id/password`** `{ password }`: redefinição com troca obrigatória; revoga as sessões e desbloqueia.

**Último administrador (FR-009):** retirar `isAdmin` ou desativar o último usuário ativo com `is_admin` responde `409`. A verificação usa `FOR UPDATE` na mesma transação. A administração vinda só do grupo do IdP não conta, porque não é garantida.

**Troca da própria senha:** `PUT /auth/password` `{ currentPassword, newPassword }`, só para usuários com senha local.

### §5 IdP opcional e vinculação (FR-010, FR-011, FR-015)
- **Configuração:** `OLLY_IDP_ENABLED` (`false`). Com `false`:
  - `OIDC_ISSUER_URL` e `OIDC_AUDIENCE` deixam de ser obrigatórias;
  - o `OidcTokenVerifier` não é usado;
  - um token que não é sessão local responde `401`;
  - `POST /auth/login` (registro do login OIDC, spec 009) responde `404`.
- **`AppConfig.idp`:** `{ enabled: boolean; oidc?: {...} }`. O `PermissionResolver` usa o grupo de administração só com o IdP ativado.
- **Vinculação no `UserSyncService`:**
  - procura por `external_id` (como hoje);
  - se não achar e existir usuário com o mesmo e-mail sem `external_id`, vincula (grava o `external_id`) quando `email_verified` vier `true` no token, e audita `auth.idp_linked`;
  - sem `email_verified = true`, recusa (`403 Conta do IdP não vinculada: e-mail não verificado`) e audita.

  Tokens do Keycloak trazem `email_verified`; outros IdPs precisam incluir a claim (documentado).
- **Web:** com `idpEnabled`, a tela mostra o botão institucional, com a configuração OIDC do próprio web (como hoje). Com o IdP desligado, o web não inicializa o cliente OIDC.

### §6 Comando do operador (FR-016)
- `node apps/api/dist/cli/users-admin.js --email <e-mail> [--name <nome>]` (na raiz do repositório e no container), ou `pnpm --filter @olly/api users:admin -- …` no desenvolvimento:
  - cria o administrador local ou, se o e-mail já existir, dá a ele administração global e senha local;
  - gera uma senha temporária forte, impressa uma única vez no terminal, com troca obrigatória;
  - desbloqueia, ativa e audita `auth.admin_recovery` (sem usuário, origem `cli`).
- **Docker:** `docker compose exec api node apps/api/dist/cli/users-admin.js --email …`.

### §7 Web
- **`AuthProvider`:** dois modos.
  - **Local:** o token fica no `localStorage` (`olly.session`, com a expiração). Sair revoga e limpa; um 401 da API limpa e leva à tela de entrada.
  - **OIDC:** o fluxo atual.

  `getAccessToken()` devolve o token do modo ativo, para a API e o WebSocket.
- **Telas:**
  - `/login`: primeiro cadastro, se `setupRequired`; formulário local; botão institucional, se `idpEnabled`;
  - `/change-password`: troca obrigatória ou voluntária, no menu do usuário;
  - **Administração › Usuários:** a aba "SSO e usuários" vira "Usuários", com usuários locais e do IdP, origem, situação, administração e as ações (criar, editar, desativar e reativar, redefinir senha). Os mapeamentos de grupo continuam na mesma aba, visíveis só com o IdP ativado.
- **Mensagens:** sem revelar se o e-mail existe; a política de senha é exibida no formulário.

### §8 Smoke, compose e E2E
- **`scripts/smoke.ts`:**
  - confere `GET /auth/config`;
  - com `idpEnabled`, segue o fluxo atual (token do Keycloak);
  - sem IdP, confere o 401 de `/me` e, se houver `OLLY_SMOKE_EMAIL` e `OLLY_SMOKE_PASSWORD`, entra localmente e chama `/me`.
- **Compose:** `OLLY_IDP_ENABLED: ${OLLY_IDP_ENABLED:-false}`, comentado. O Keycloak continua no compose, para quem ativar o IdP.
- **Playwright:** `OLLY_IDP_ENABLED=true` (os cenários atuais usam o Keycloak), mais um cenário de login local: o admin cria um usuário local pela API, o usuário entra pela tela, troca a senha e vê o projeto.

## Modelo de dados

Migration `0015_local_users`:

```sql
ALTER TABLE users
  ADD COLUMN password_hash        TEXT,
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_admin             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN failed_logins        INT     NOT NULL DEFAULT 0,
  ADD COLUMN locked_until         TIMESTAMPTZ;

CREATE TABLE user_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX user_sessions_user ON user_sessions (user_id) WHERE revoked_at IS NULL;
```

- **Origem do usuário (derivada):** `password_hash` presente → local; `external_id` presente → IdP; os dois → vinculado.
- **Limpeza:** o job de manutenção (spec 009) apaga sessões expiradas ou revogadas há mais de 7 dias.
- Atualizar `docs/arquitetura/modelo-dados.md`.

## Contratos

| Método e rota | Permissão | Entrada | Saída |
|---|---|---|---|
| `GET /auth/config` | Pública | — | `{ setupRequired, idpEnabled }` |
| `POST /auth/setup` | Pública (só sem usuários) | `{ name, email, password }` | `{ token, expiresAt, user }`; `409` se configurada |
| `POST /auth/local/login` | Pública | `{ email, password }` | `{ token, expiresAt, mustChangePassword }`; `401` genérico |
| `POST /auth/logout` | Autenticada (sessão local) | — | `204` |
| `PUT /auth/password` | Autenticada (usuário com senha local) | `{ currentPassword, newPassword }` | `204` |
| `GET /admin/users` | `user:manage` global | — | `UserAdminSummary[]` (com origem, admin, bloqueio, troca pendente) |
| `POST /admin/users` | `user:manage` global | `{ name, email, password, isAdmin? }` | `UserAdminSummary` |
| `PATCH /admin/users/:id` | `user:manage` global | `{ name?, email?, isAdmin? }` | `UserAdminSummary`; `409` (e-mail repetido ou último administrador) |
| `PUT /admin/users/:id/active` | `user:manage` global | `{ active }` | `204`; revoga sessões; `409` se for o último administrador |
| `PUT /admin/users/:id/password` | `user:manage` global | `{ password }` | `204` |

- **`GET /me`:** passa a trazer `authMethod` (`local` | `idp`) e `mustChangePassword`.
- **Erros:** `password_change_required` (403) e `password_policy` (422, nos `issues`).
- **Auditoria:**
  - `auth.setup`, `auth.local_login`, `auth.local_login_failed`, `auth.local_locked`, `auth.logout`;
  - `auth.password_change`, `auth.password_reset`, `auth.idp_linked`, `auth.idp_link_refused`, `auth.admin_recovery`, `auth.idp_config`;
  - `user.create`, `user.update`, `user.admin_grant`, `user.admin_revoke`, mais `user.activate` e `user.deactivate`, que já existem.

  Os detalhes nunca incluem senha.
- **IdP ativado ou desativado (FR-013):** na subida, a API compara o estado atual com o último `auth.idp_config` da auditoria e grava um novo registro quando ele mudou (ou na primeira subida). O registro tem `{ enabled }`, sem usuário, com origem `config`.

## Permissões RBAC

| Permissão | Situação no catálogo/seed | Papéis | O que esta spec faz |
|---|---|---|---|
| `user:manage` | Existe desde a 001 (global, só administração da plataforma) | Admin da plataforma | Usa nas rotas de administração de usuários |

Nenhuma permissão nova. A administração global passa a vir também de `users.is_admin`.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_IDP_ENABLED` | `false` | Ativa o login pelo IdP (OIDC). Com `true`, exige `OIDC_ISSUER_URL` e `OIDC_AUDIENCE` |
| `OLLY_SESSION_IDLE_MINUTES` | `480` | Expiração da sessão local por inatividade |
| `OLLY_SESSION_MAX_HOURS` | `24` | Duração máxima da sessão local |
| `OLLY_LOGIN_MAX_ATTEMPTS` | `5` | Tentativas erradas antes do bloqueio |
| `OLLY_LOGIN_LOCK_MINUTES` | `15` | Duração do bloqueio |
| `OLLY_SMOKE_EMAIL` / `OLLY_SMOKE_PASSWORD` | — | Usuário local opcional do smoke test com o IdP desligado |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Sessão opaca no banco | JWT assinado pela API | Revogação imediata (sair, desativar, trocar senha) sem lista de bloqueio; mesmo transporte `Bearer` do OIDC |
| scrypt do `node:crypto` | argon2 (dependência nativa), bcrypt | Sem dependência nova; recomendado pela OWASP com os parâmetros adotados |
| Token no `localStorage` (web) | Cookie `HttpOnly` | Mantém o modelo atual (o token OIDC também vive no navegador) e o mesmo caminho para a API e o WebSocket; cookie exigiria CSRF e mudaria o WebSocket. Risco de XSS documentado; a CSP do web continua restritiva |
| Vinculação só com `email_verified` | Vincular sempre | Evita tomada de conta por quem cria no IdP uma conta com o e-mail de um usuário local |
| Bloqueio por usuário | Bloqueio por IP | O IP é pouco confiável atrás de proxies; por usuário atende à NFR-004. O rate limit por IP pode vir depois |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001, FR-002, FR-003 | Integração | `local-auth.int.test.ts` › primeiro cadastro, recusa com usuário existente, 5 chamadas simultâneas (SC-002) |
| FR-004, FR-005, FR-008, NFR-004 | Integração | `local-auth.int.test.ts` › login, mensagem genérica, bloqueio, expiração, sair, usuário desativado com sessão aberta (SC-004) |
| FR-006, FR-007, FR-009, FR-014 | Integração | `local-users-admin.int.test.ts` › criar, editar, desativar, redefinir, troca obrigatória, último administrador, listagem com origem |
| FR-010, FR-011 | Integração | `idp-toggle.int.test.ts` › IdP desligado (token OIDC recusado, `OIDC_*` dispensadas), ligado (OIDC e local juntos) |
| FR-012 | Integração | `local-users-admin.int.test.ts` › usuário local editor num projeto |
| FR-013 | Integração | Auditoria conferida nos casos acima; `idp-toggle.int.test.ts` › `auth.idp_config` gravado só quando o estado muda |
| FR-015 | Integração | `idp-toggle.int.test.ts` › vinculação com `email_verified` e recusa sem ele (SC-007) |
| FR-016 | Integração | `users-admin-cli.int.test.ts` › comando cria e recupera um administrador (SC-008) |
| NFR-001 | Unidade | `password.test.ts` › política e hash |
| NFR-002, SC-005 | Integração | `local-auth.int.test.ts` › senha sentinela ausente de logs, respostas, auditoria e banco em claro |
| Config | Unidade | `config.test.ts` › `OIDC_*` condicionais |
| SC-001, SC-003, SC-006 | E2E | `e2e/local-auth.spec.ts` › login local, troca de senha, projeto; com o IdP ativo, as duas opções na tela. O primeiro cadastro é coberto na integração, porque o E2E usa um banco já populado |

## Riscos

| Risco | Mitigação |
|---|---|
| Tomada da instalação antes do primeiro cadastro (sem código, NFR-003) | Risco aceito pelo PO; documentar "cadastre o primeiro usuário antes de expor a plataforma" |
| Instalações existentes (só IdP) ficam sem acesso com o novo padrão | `OLLY_IDP_ENABLED=true` mantém o comportamento atual; comando do operador (§6); nota no README e no relatório |
| IdP sem a claim `email_verified` | Vinculação recusada com mensagem clara; documentar a configuração da claim |
| Força bruta distribuída em vários e-mails | Bloqueio por usuário e auditoria das falhas; o rate limit por IP fica para uma spec futura |
| Vários processos sobem ao mesmo tempo e gravam o mesmo `auth.idp_config` | Comparação e gravação sob `pg_advisory_xact_lock`; no máximo um registro por mudança |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 06/10/2026 | Criação do plano | Spec esclarecida pelo PO |
| 06/10/2026 | Implementação: códigos de erro no padrão da API (`password_change_required`, `issues[].code = password_policy`); comando em `dist/cli/users-admin.js` (como o `credentials` da spec 009); rotas de usuário no `GovernanceModule` (`LocalAuthController`, `UsersAdminService`); `IdpConfigAudit` não impede a subida se o banco falhar (só avisa); custo do scrypt configurável apenas para os testes de lógica (o padrão segue o da OWASP) | Ajustes de implementação |
| 06/10/2026 | FR-009 e a inativação por falta de uso (spec 009): se ela fosse inativar todos os administradores ativos, o de acesso mais recente fica ativo; a limpeza das sessões locais roda no mesmo job | Defeito encontrado ao implementar: o job podia deixar a plataforma sem administrador (teste de reprodução em `retention.int.test.ts`) |
