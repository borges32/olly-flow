# Tarefas — Spec 013: Hardening, documentação e go-live

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — HU-1: Segurança (P1)

- [ ] T001 Para cada achado crítico/alto: teste de reprodução → correção → registro (FR-001, FR-002) → plan §1
- [ ] T002 Achados médios: correção ou mitigação documentada como "pendente de aprovação" (FR-002, FR-003)
- [ ] T003 `plano-de-acao.md` completo (FR-001, SC-001)
- [ ] T004 [P] Auditorias, Trivy e gitleaks no CI (FR-004, SC-002) → plan §2
- [ ] T005 [P] Cabeçalhos de segurança + teste (FR-005) → plan §2
- [ ] T006 [P] Teste do `values-prod.yaml` (FR-006) → plan §2

## Fase 2 — HU-2: Migração (P1)

- [ ] T010 Resolver as pendências de `docs/migracao/relatorio-poc.md` ou encaminhá-las (FR-010)
- [ ] T011 `pnpm migration:shadow` com modo shadow (FR-011) → plan §4
- [ ] T012 Gerar `docs/migracao/comparacao.md` (SC-004)

## Fase 3 — HU-3: Documentação (P1)

- [ ] T020 [P] `docs/usuario/` (FR-007) → plan §3
- [ ] T021 [P] `docs/operacao/` + scripts de backup e teste de restore em homologação (FR-008, SC-003) → plan §3
- [ ] T022 [P] `docs/desenvolvimento/` + `examples/node-template/` com testes (FR-009) → plan §3

## Fase 4 — HU-4: Go-live (P1)

- [ ] T030 `docs/go-live/` (checklist, hypercare, desligamento) e `values-prod.yaml` de referência (FR-012) → plan §5
- [ ] T031 `pnpm smoke:prod` não destrutivo, executado em homologação (FR-012, NFR-001, SC-007)

## Fase 5 — HU-5: Treinamento (P2)

- [ ] T040 `docs/treinamento/` com roteiros, exercícios e workflows de exemplo (FR-013)

## Fase 6 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste/evidência e cada SC foi verificado
- [ ] T092 Marcar no checklist os itens técnicos concluídos (SC-006)
- [ ] T093 Escrever `report.md` com a seção final **"Prontidão para go-live"** (pronto / depende de ação humana / riscos remanescentes) e atualizar o status em `spec.md` e `docs/roadmap.md`
