# Tarefas — Spec 019: Baixar os dados de entrada e saída do nó

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Fundação

- [x] T001 `data-download.ts` (conteúdo e nome do arquivo), com testes de unidade (FR-002, FR-003, FR-005) → plan §1

## Fase 2 — HU-1: Baixar a entrada e a saída (P1)

- [x] T010 Botão "Baixar" no `DataPanel` (FR-001, FR-004, FR-005) → plan §2
- [x] T011 Nome base do arquivo no `NodeDetailsView` (entrada, origem, saída, fixados, execução do laço) (FR-003) → plan §3
- [x] T012 E2E: download da entrada e das saídas do If, conteúdo igual ao painel e sem botão sem dados (FR-001, FR-002, FR-004, SC-001, SC-002)

## Fase 3 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T092 Atualizar a documentação (`docs/nos/README.md`, comportamentos comuns; `docs/lgpd.md`, efeitos colaterais)
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
