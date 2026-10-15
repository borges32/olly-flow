# Tarefas — Spec 023: Organizar os nós do workflow ("Tidy up")

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Fundação

- [x] T001 Dependência `@dagrejs/dagre` no `apps/web`, com justificativa no relatório → plan "Decisões técnicas"
- [x] T002 `tidy-up.ts` com testes de unidade (sobreposição, ordem, ramos, sub-nós e sub-nós de sub-nós, seleção, laço, partes desconectadas, âncora, 100 nós) (FR-001 a FR-004, NFR-001, SC-001) → plan §1

## Fase 2 — HU-1/HU-2: Editor (P1)

- [x] T010 Ação `tidyUp` no store (um passo de desfazer), botão "Organizar" e atalho Shift+Alt+T; somente leitura (FR-001, FR-005) → plan §2
- [x] T011 E2E: organizar pelo botão e pelo atalho, desfazer, somente leitura (FR-001, FR-005, SC-002)

## Fase 3 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T092 Atualizar a documentação (README dos nós: comportamentos do editor)
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
