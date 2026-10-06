# Tarefas — Spec 014: Primeiro usuário, usuários locais e IdP opcional

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Preparação

- [ ] T001 Migration `0015_local_users` (colunas em `users`, `user_sessions`) e tipos em `packages/db` → plan "Modelo de dados"
- [ ] T002 [P] Configuração: `OLLY_IDP_ENABLED`, limites de sessão e bloqueio, `OIDC_*` condicionais, `AppConfig.idp` (FR-010) → plan §5, "Configuração"
- [ ] T003 [P] Tipos de contrato em `packages/shared-types` → plan "Contratos"

## Fase 2 — Fundação (bloqueia as histórias)

- [ ] T010 [P] `PasswordHasher` e política de senha, com testes unitários (NFR-001, NFR-002) → plan §1
- [ ] T011 `LocalSessionService`: criação, validação com cache, expiração, revogação (FR-004, FR-008, NFR-004) → plan §2
- [ ] T012 `Authenticator` com os dois caminhos (sessão local ou OIDC, só com o IdP ativado), `PermissionResolver` com `is_admin`, troca obrigatória de senha bloqueando as demais rotas (FR-007, FR-010, FR-012) → plan §2, §5

## Fase 3 — HU-1: Primeiro usuário (P1)

- [ ] T020 Testes de integração do primeiro cadastro: oferta, recusa com usuário existente, concorrência, auditoria (FR-001, FR-002, FR-003, FR-013, SC-002)
- [ ] T021 `GET /auth/config` e `POST /auth/setup` com trava (FR-001, FR-002, FR-003) → plan §3

## Fase 4 — HU-2: Login local (P1)

- [ ] T030 Testes de integração: login, mensagem genérica, bloqueio, expiração, sair, usuário desativado com sessão aberta, sentinela de senha (FR-004, FR-005, FR-008, NFR-002, SC-004, SC-005)
- [ ] T031 `POST /auth/local/login`, `POST /auth/logout`, `PUT /auth/password` (FR-004, FR-005, FR-007) → plan §2, §3

## Fase 5 — HU-3: Administração de usuários locais (P1)

- [ ] T040 Testes de integração: criar, editar, desativar e reativar, redefinir, troca obrigatória, último administrador, listagem com origem, usuário local num projeto (FR-006, FR-007, FR-009, FR-012, FR-014, SC-003)
- [ ] T041 Rotas de `admin/users` (criar, editar, redefinir senha, administração global; desativação revogando sessões) (FR-006, FR-009, FR-014) → plan §4
- [ ] T042 [P] Comando do operador `users-admin` + teste (FR-016, SC-008) → plan §6
- [ ] T043 [P] Limpeza de sessões expiradas no job de manutenção → plan "Modelo de dados"

## Fase 6 — HU-4: IdP opcional (P2)

- [ ] T050 Testes de integração: IdP desligado (token OIDC recusado, `OIDC_*` dispensadas), ligado (OIDC e local juntos), vinculação com e sem `email_verified`, auditoria `auth.idp_config` (FR-010, FR-011, FR-013, FR-015, SC-006, SC-007)
- [ ] T051 Vinculação por e-mail no `UserSyncService` e auditoria da configuração do IdP na subida (FR-013, FR-015) → plan §5

## Fase 7 — Web

- [ ] T060 `AuthProvider` com sessão local ou OIDC; telas de entrada (primeiro cadastro, login local, botão institucional) e de troca de senha (FR-001, FR-004, FR-007, FR-010) → plan §7
- [ ] T061 Administração › Usuários: usuários locais e do IdP, origem, situação e ações (FR-006, FR-014) → plan §7
- [ ] T062 [P] Testes unitários do web (sessão local, política de senha no formulário)

## Fase 8 — Ambiente e E2E

- [ ] T070 `docker-compose.yml`, `.env.example`, Playwright (`OLLY_IDP_ENABLED=true` nos cenários do Keycloak) e `scripts/smoke.ts` com o IdP desligado → plan §8
- [ ] T071 E2E `local-auth.spec.ts`: login local, troca de senha e projeto; com o IdP ativo, as duas opções (SC-001, SC-003, SC-006)

## Fase 9 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Atualizar a documentação: `docs/autenticacao.md` (novo), `docs/governanca.md`, `docs/arquitetura/contratos.md`, `docs/arquitetura/modelo-dados.md`, README (atualização de instalações existentes)
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
