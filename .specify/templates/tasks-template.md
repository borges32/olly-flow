# Tarefas — Spec NNN: <Título>

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Preparação

- [ ] T001 <tarefa> → plan §X

## Fase 2 — Fundação (bloqueia as histórias)

- [ ] T010 <tarefa> (FR-001) → plan §X

## Fase 3 — HU-1: <título> (P1)

- [ ] T020 [P] Testes de <...> (FR-001)
- [ ] T021 Implementar <...> (FR-001) → plan §X

## Fase N — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Atualizar a documentação (`docs/nos/`, guias, `docs/arquitetura/` se houve mudança de contrato ou dados)
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
