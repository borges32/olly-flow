# Tarefas — Spec 024: Destacar o próximo nó na execução nó a nó

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Fundação

- [x] T001 `next-nodes.ts` com testes de unidade (ramos do If, saída de erro, sub-nós, Merge, dados ocultos, `skipped`, execução em andamento e sem execução) (FR-001 a FR-003) → plan §1

## Fase 2 — HU-1: Canvas (P1)

- [x] T010 Destaque no `WorkflowNodeView` (borda, selo "próximo") e arestas animadas no `editor-page.tsx` (FR-001, NFR-001) → plan §2
- [x] T011 E2E: execução nó a nó com If; só o ramo com itens destacado; o destaque passa adiante (FR-001, FR-002, SC-001)

## Fase 3 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T092 Atualizar a documentação (README dos nós: comportamentos do editor)
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
