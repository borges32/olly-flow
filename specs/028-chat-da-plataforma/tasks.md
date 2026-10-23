# Tarefas — Spec 028: Chat da plataforma ("Olly Chat")

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Fundação

- [x] T001 Migration `0020_olly_chat` (up/down), schema do `packages/db` e testes de migration (FR-003, FR-006, FR-008) → plan §1
- [x] T002 [P] Tipos em `packages/shared-types` (sessão, mensagem, configuração sem segredos, payload) → plan §2, §3
- [x] T003 [P] `preferred_username` gravado em `users.idp_username` no login pelo IdP, com teste (FR-004) → plan §2

## Fase 2 — HU-3: Configuração (P1)

- [x] T010 Serviço e rotas `GET`/`PUT /admin/olly-chat`: validação, segredo criptografado (vazio mantém), auditoria sem segredo; rotação de chave inclui o segredo (FR-008) → plan §3
- [x] T011 Integração: só `project:manage` global, segredo não volta, auditoria, validação (FR-008, SC-004)

## Fase 3 — HU-1/HU-2: Sessões e conversa (P1)

- [x] T020 Rotas das sessões: listar, criar (contador por usuário), renomear, excluir, mensagens; outro usuário 404 (FR-002, FR-003, FR-006) → plan §3
- [x] T021 Envio da mensagem: payload no servidor, chamada pelo `HttpGuard` com a autenticação configurada, repasse do NDJSON, resposta comum, erros, gravação da pergunta e da resposta, uma por vez, navegador desconectado, teto (FR-004, FR-005, FR-007, FR-010, NFR-001) → plan §4
- [x] T022 Integração `olly-chat.int.test.ts`: payload e identidade, `login` do IdP com prioridade, numeração por usuário sem reaproveitar, stream e resposta comum, falhas (429, 500, filtro de rede), 409, desconexão, renomear e excluir, outro usuário (FR-003 a FR-007, FR-010, SC-001, SC-002)

## Fase 4 — HU-4: Retenção (P2)

- [x] T030 Passo de retenção na manutenção diária, a partir da última mensagem, com relatório e auditoria; testes em `retention.int.test.ts` (FR-009, SC-003) → plan §5

## Fase 5 — Web (P1)

- [x] T040 [P] Item **Olly Chat** no menu e página `/assistente`: barra de sessões (nova, selecionar, renomear, excluir), conversa com o passo atual, aviso sem configuração, celular (FR-001, FR-002, FR-005, FR-006, NFR-004) → plan §6
- [x] T041 [P] Aba **Olly Chat** na Administração (URL, retenção, autenticação; segredos em branco mantêm) (FR-008) → plan §6
- [x] T042 E2E `olly-chat.spec.ts`: viewer vê o menu e conversa (passo atual e resposta), volta à sessão depois de recarregar, cria, renomeia e exclui sessões; administração configura (FR-001, FR-002, FR-005, FR-006, FR-008, SC-001, SC-002)

## Fase 5b — Resposta `report` e Mermaid (21/10/2026)

- [x] T050 `ollyChatReplyText` (lista ou objeto; `report`, depois `output`/`text`, depois JSON) no envio, com testes de unidade e de integração (FR-005)
- [x] T051 `MermaidDiagram` no Markdown dos chats, com a biblioteca `mermaid` carregada sob demanda, tema e erro de sintaxe (FR-011)
- [x] T052 E2E: resposta com `report` e flowchart desenhado (SC-005); documentação
- [x] T053 Markdown GFM (`remark-gfm`) e estilos de tabela, títulos, citação e linha horizontal, com testes de unidade e E2E (FR-012, SC-006)
- [x] T054 Visual da página (FR-013): coluna de leitura, cartões de resposta (avatar, horário, copiar), alerta de falha, espera animada, boas-vindas, sessões por data, cabeçalho com atividade, campo de mensagem que cresce; tipografia do Markdown; testes de unidade e E2E

## Fase 6 — Documentação e verificação

- [x] T090 `docs/chat-olly.md` (uso, payload, workflow do assistente com o Webhook em Streaming, chave da memória com `login` + `chatSessionId`, filtro de rede), `contratos.md`, `modelo-dados.md`, `docs/rbac-matriz.md` (se a matriz mudar)
- [x] T091 Rodar todos os comandos de verificação do AGENTS.md
- [x] T092 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
