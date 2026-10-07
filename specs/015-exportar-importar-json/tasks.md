# Tarefas — Spec 015: Exportar e importar workflows em JSON

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Preparação

- [x] T001 Atualizar a spec 012 (importador movido) e registrar os esclarecimentos no histórico da spec 015 → plan "Verificação da constituição"
- [x] T002 [P] Configuração `OLLY_IMPORT_MAX_BYTES`, `OLLY_IMPORT_MAX_NODES`, `OLLY_IMPORT_MAX_DEPTH` (NFR-002) → plan "Configuração"

## Fase 2 — Fundação (bloqueia as histórias)

- [x] T010 `DynamicPorts` `placeholder` em `resolveNodePorts` e nó `placeholder.unsupported` com testes (FR-016) → plan §2
- [x] T011 Motor: sub-nó pelas portas efetivas; `unsupportedNodeIssues` (FR-016) → plan §2
- [x] T012 `workflow-file.ts`: `toWorkflowFile`, `fromWorkflowFile`, layout, limites, `resolveCredentialRef`, com testes unitários (FR-001–FR-005, FR-009, FR-013, FR-016, FR-018) → plan §1

## Fase 3 — HU-1: Baixar (P1)

- [x] T020 Testes de integração da exportação: rascunho salvo e canvas, credenciais só referenciadas, dados fixados, permissão e auditoria (FR-006–FR-009, SC-002)
- [x] T021 Rotas `GET`/`POST /workflows/:id/export` (FR-006–FR-008) → plan §3

## Fase 4 — HU-2: Importar do Olly Flow (P1)

- [x] T030 Testes de integração: prévia, importação, credenciais, pendências, marcadores, publicação bloqueada, limites, conteúdo hostil, auditoria, desempenho (FR-010–FR-018, NFR-002–NFR-004, SC-005)
- [x] T031 Rotas de prévia e importação, pendências de referência e bloqueio da publicação (FR-010–FR-017) → plan §3
- [x] T033 Sobrepor o workflow existente (id ou nome único), aviso na prévia, permissão e auditoria, com testes (FR-010, FR-028) → plan §3.2
- [x] T032 [P] Ida e volta com todos os tipos de nó (NFR-001, SC-001) → plan §1

## Fase 5 — HU-3: Importar do N8N (P1)

- [x] T040 Conversores por tipo e versão, conexões, credenciais, varredura de expressões e relatório, com testes unitários (FR-023–FR-026) → plan §4
- [x] T041 Formato `n8n` na prévia e na importação (FR-010, FR-023) → plan §3, §4
- [x] T042 Fixtures do N8N: importar todas, relatório consolidado, executar as sem pendências contra a saída esperada (FR-027, SC-007, SC-008) → plan §4

## Fase 6 — Web (HU-1 a HU-4)

- [x] T050 Diálogo "Importar" com formato, prévia e relatório; "Baixar" na lista (FR-006, FR-010, FR-011, FR-026) → plan §5
- [x] T051 "Baixar" no editor (canvas) (FR-006) → plan §5
- [x] T052 Copiar e colar pela área de transferência no formato do arquivo, com testes unitários (FR-019, FR-020, SC-006) → plan §5
- [x] T053 [P] Visual do nó marcador e painel com o JSON original (FR-016) → plan §5
- [x] T055 Aviso de sobreposição no diálogo e cenário E2E (FR-028) → plan §3.2
- [x] T054 E2E `workflow-io.spec.ts`: baixar, importar Olly Flow e N8N, colar (FR-006, FR-010, FR-019, FR-020)

## Fase 7 — HU-5: Documentação (P1)

- [x] T060 Atualizar `docs/nos/workflow-json.md` (dados fixados, marcador, importação do N8N, situação) e criar `docs/nos/placeholder.unsupported.md` e `docs/importacao-n8n.md` (FR-021) → plan §4
- [x] T061 Teste da documentação: todo tipo documentado e exemplos importáveis (FR-022, SC-003)

## Fase 8 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T092 Atualizar a documentação (`docs/nos/README.md`, `docs/arquitetura/contratos.md`, `docs/rbac-matriz.md`, ADR-0001 nota)
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
