# Tarefas — Spec 004: Credenciais, HTTP Request e PostgreSQL

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [ ] T001 Migration `credentials` (FR-001)
- [ ] T002 Testcontainers: Postgres externo + servidor HTTP de teste → plan §9

## Fase 2 — Fundação

- [ ] T010 Módulo de criptografia com `KeyProvider` e `EnvKeyProvider` + testes (FR-001) → plan §1
- [ ] T011 Tipos de credencial com `x-secret` (FR-004) → plan §3
- [ ] T012 `http-guard` com validação de DNS e redirects + testes (FR-008) → plan §4
- [ ] T013 Resiliência no engine: retry, timeout com `AbortSignal`, `onError` (FR-017, FR-018) → plan §8

## Fase 3 — HU-1: Credenciais (P1)

- [ ] T020 API de credenciais com DTO sem segredos, merge de secretos e teste de conexão (FR-002, FR-005, FR-007) → plan §2
- [ ] T021 Auditoria das ações de credencial (FR-006)
- [ ] T022 *pino redact* e garantia de não serialização em execuções (FR-003)
- [ ] T023 Teste de varredura com valor sentinela (FR-002, FR-003, SC-002)
- [ ] T024 [P] Tela `/credentials` e seletor de credencial no painel do nó (FR-004, FR-005)

## Fase 4 — HU-2: HTTP Request (P1)

- [ ] T030 Nó `http.request` com corpos, autenticação, opções e binário no MinIO (FR-009, FR-010) → plan §5
- [ ] T031 Cache de token OAuth2 client credentials (FR-004)
- [ ] T032 Testes de integração do nó HTTP (FR-008, FR-009, SC-003)

## Fase 5 — HU-3: PostgreSQL (P1)

- [ ] T040 `PoolManager` (NFR-002) → plan §6
- [ ] T041 Nó `postgres.query` com proibição de expressão no SQL e `readOnly` (FR-011, FR-012, FR-013) → plan §6
- [ ] T042 Nó `postgres.write` com validação de identificadores, lote, upsert e transação (FR-014, FR-015) → plan §7
- [ ] T043 Endpoints de schemas, tabelas e colunas + UI de mapeamento (FR-016)
- [ ] T044 Testes de integração Postgres (SC-004, SC-005, SC-006)

## Fase 6 — HU-4: Resiliência na UI (P2)

- [ ] T050 Aba "Configurações" do nó (retry, timeout, onError) (FR-017)

## Fase 7 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 E2E `integrations.spec.ts` (SC-001)
- [ ] T092 Documentar `docs/nos/http.request.md`, `docs/nos/postgres.query.md`, `docs/nos/postgres.write.md` e `docs/credenciais.md`
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
