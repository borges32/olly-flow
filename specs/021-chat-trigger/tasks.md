# Tarefas — Spec 021: Nó Chat Trigger ("When chat message received")

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Preparação

- [x] T001 Dependências `@fastify/busboy` (API; no lugar do `@fastify/multipart`, ver plano) e `react-markdown` (web), com versão fixa e justificativa no relatório → plan "Decisões técnicas"
- [x] T002 Conferir no código do N8N (Chat Trigger 1 a 1.3) o item de saída com arquivos, o formato de `loadPreviousSession`, os padrões dos textos e o multipart; registrar as diferenças no relatório → plan §1, §4

## Fase 2 — Fundação (bloqueia as histórias)

- [x] T010 [P] `DynamicPorts` `chatTriggerInputs`, origem `chat` e tipos `ChatConfig`/`ChatTestReply` em `shared-types`, com testes (FR-001, FR-006) → plan §1
- [x] T011 [P] Nó `trigger.chat` (parâmetros, credencial, portas, execução com e sem itens), registrado no catálogo, com testes (FR-001) → plan §1
- [x] T012 [P] `chatResponseBody`, `chatMessageText` e `fileAllowed`, com testes (FR-005, FR-007) → plan §2
- [x] T013 Validação no engine: um Chat Trigger, memória obrigatória, aviso de memória temporária (FR-006, FR-010, FR-015) → plan §7

## Fase 3 — HU-2/HU-3: Chat público (P1)

- [x] T020 Publicação: `chatIssues` e rotas `GET`/`POST <webhookId>/chat` em `webhooks`; despublicar e excluir removem (FR-003, FR-004, FR-010) → plan §3
- [x] T021 `ChatService`: autenticação, validação, multipart, lock da sessão, lançamento em produção, resposta e configuração da página; delegação no gateway (FR-003 a FR-005, FR-007 a FR-009, FR-014) → plan §3, §4
- [x] T022 Integração: publicar, conversar com Agent e memória persistente, despublicar, autenticações, `OLLY_REQUIRE_WEBHOOK_AUTH`, nó de resposta, tempo esgotado, arquivos, limite de taxa, mensagens simultâneas (FR-003 a FR-009, FR-011, FR-014, SC-001 a SC-003, SC-006)

## Fase 4 — HU-4: Sessão anterior (P2)

- [x] T030 `loadPreviousSession` lendo a memória ligada ao gatilho (chave pelo avaliador de expressões), com testes de integração (FR-006, SC-005) → plan §4

## Fase 5 — HU-1: Painel de chat no editor (P1)

- [x] T040 Rotas `POST /workflows/:id/chat/test` e `GET .../reply` (`workflow:execute`), com testes de integração e da matriz RBAC (FR-002) → plan §5
- [x] T041 `ChatPanel` no editor (conversa, nova sessão, andamento ao vivo, link para a execução, erro) e componentes de mensagem com Markdown (FR-002) → plan §5, §6
- [x] T042 Painel do nó: URL do chat publicado, `webhookId` novo ao adicionar, colar ou duplicar o nó (FR-003) → plan §1, §3

- [x] T043 Painel inferior do editor com o chat e os logs dos nós (`logEntries` com testes de unidade; lista, detalhes com entrada, saída, erro e passos; abre e recolhe); E2E atualizado (FR-002, FR-016, SC-007) → plan §5

## Fase 6 — HU-2: Página hospedada (P1)

- [x] T050 `ChatPage` em `/chat/:webhookId` (configuração, boas-vindas, mensagens iniciais, anexos, sessão no `localStorage`, Basic Auth e login da plataforma, indisponível) (FR-003, FR-004, FR-006, FR-007, NFR-001, NFR-004) → plan §6
- [x] T051 E2E `apps/web/e2e/chat.spec.ts`: painel do editor (SC-001) e página hospedada publicada, com recarga e histórico (SC-002, SC-005)

## Fase 7 — HU-7: Importação e exportação (P1)

- [x] T060 Conversor do `chatTrigger` (1 a 1.3) com pendências (*streaming*, `manually`, CSS, memória temporária) e caso do prompt `auto` com o Chat Trigger (FR-011, FR-012, FR-015, SC-004) → plan §8
- [x] T061 Exportação como `chatTrigger` 1.1 com o `webhookId`; caso no teste de ida e volta (FR-012) → plan §8
- [x] T062 Fixture sintética `fixtures/n8n/exemplo-chat-trigger` (quatro arquivos) e relatório consolidado regenerado (SC-004)

## Fase 8 — Documentação

- [x] T070 `docs/nos/trigger.chat.md` (inclui a memória temporária e a sequência das mensagens); `workflow-json.md` (catálogo e exemplo); `importacao-n8n.md`; `contratos.md`; `docs/rbac-matriz.md` (FR-013)

## Fase 9 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T092 Atualizar a documentação (`docs/nos/README.md`, `docs/arquitetura/`)
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
