# Tarefas — Spec 025: Redimensionar as colunas do painel do nó

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Fundação

- [x] T001 `column-sizes.ts` com testes de unidade (vizinhas mudam, terceira não, mínimo, preferência válida, inválida e armazenamento indisponível) (FR-001, FR-002) → plan §1

## Fase 2 — HU-1: Painel do nó (P1)

- [x] T010 Grade com as larguras do estado e divisórias arrastáveis, teclado, clique duplo e preferência (FR-001 a FR-003) → plan §2
- [x] T011 E2E: arrastar, reabrir mantendo a largura, setas do teclado e clique duplo (FR-001 a FR-003, SC-001)

## Fase 3 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T092 Atualizar a documentação (README dos nós: comportamentos do editor)
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
