# Tarefas — Spec 022: Nó PostgreSQL único, com excluir e selecionar

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Fundação

- [x] T001 [P] `migrateLegacyPostgres` e inclusão em `migrateLegacyDefinition`, com testes (FR-008) → plan §4
- [x] T002 [P] `conditions.ts` (cláusula WHERE e ORDER BY), com testes de unidade (FR-005, FR-006) → plan §2

## Fase 2 — HU-1/HU-2/HU-3: Nó único (P1)

- [x] T010 Nó `postgres.database` (parâmetros, apelido das opções, despacho por operação); `builtin.ts` (FR-001, FR-002, FR-010) → plan §1
- [x] T011 `select` e `deleteTable` (delete, truncate, drop; `ColumnCache.invalidate`) (FR-003, FR-004, FR-007) → plan §2, §3
- [x] T012 Integração com PostgreSQL real: executar consulta e gravar pelo nó único; selecionar; excluir, esvaziar e remover; somente leitura; "continuar" por item (FR-001 a FR-007, SC-001, SC-002)

## Fase 3 — HU-4/HU-5: Migração e importação (P1)

- [x] T020 Testes da API e do motor que usam os tipos antigos: pela migração (entrada da API) ou atualizados para o nó único; workflow gravado no formato antigo (FR-008, SC-003)
- [x] T021 Conversor do Postgres 2.x (todas as operações) e pendências, com testes (FR-009, SC-004) → plan §5
- [x] T022 [P] Editor: ícone, E2E de integrações pelo nó único (FR-001)

## Fase 4 — Documentação

- [x] T030 `docs/nos/postgres.database.md`; `postgres.query.md`/`postgres.write.md` apontando para o novo; `workflow-json.md`; `importacao-n8n.md`; `contratos.md`; `README.md` (FR-011)

## Fase 5 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T092 Atualizar a documentação (`docs/arquitetura/`)
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
