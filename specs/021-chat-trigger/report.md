# Relatório — Spec 021: Nó Chat Trigger ("When chat message received")

**Status:** Implementada (pendentes: avaliação da Segurança e workflows reais da POC; ver "Pendências")
**Data:** 14/10/2026

## Resumo

O nó **Mensagem de chat recebida** (`trigger.chat`) equivale ao Chat Trigger do N8N. Cada mensagem vira um item `{ sessionId, action, chatInput }`, que o Agent e o Basic LLM Chain já leem pelo prompt do item, com a memória pela sessão. Há três formas de conversar:

- **Painel de chat no editor:** o botão **Abrir chat** executa o workflow em modo teste a cada mensagem e mostra o andamento ao vivo no canvas. Cada resposta tem o link da execução, e **Nova sessão** recomeça a conversa.
- **Página hospedada:** em `/chat/<webhookId>`, depois de publicar. Tem título, subtítulo, mensagens iniciais, tela de boas-vindas, anexos, recarga do histórico da memória e login por usuário e senha ou pela plataforma.
- **Endereço HTTP do N8N:** `/webhook/<webhookId>/chat`, com as ações `sendMessage` e `loadPreviousSession`, JSON ou multipart, e CORS.

Mensagens da mesma sessão rodam uma de cada vez (decisão do PO). A importação converte o `chatTrigger` 1 a 1.3, mantendo a URL pelo `webhookId`, e aponta o que não existe aqui: *streaming*, "Respond to Chat", sessão manual, CSS e a memória temporária no chat.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `@fastify/busboy` 3.2.3 (API) e `react-markdown` 10.1.0 (web); ver "Dependências adicionadas" |
| T002 | ⚠️ | Conferido pelo conhecimento do código do N8N (Chat Trigger 1.1 a 1.3), sem acesso ao repositório do N8N nesta máquina. Ver "Desvios" |
| T010 | ✅ | `packages/shared-types/src/ports.ts` (`chatTriggerInputs`, `CHAT_MEMORY_PORT`), `chat.ts` (tipos e constantes) |
| T011 | ✅ | `packages/nodes/src/trigger/chat/definition.ts`, `config.ts` |
| T012 | ✅ | `packages/nodes/src/trigger/chat/response.ts`, `history.ts` |
| T013 | ✅ | `packages/engine/src/validate.ts` (`CHAT_TRIGGER_DUPLICATE`, `CHAT_BUFFER_MEMORY`) |
| T020 | ✅ | `apps/api/src/webhooks/publishing.service.ts` (`chatIssues`, rotas `GET`/`POST <webhookId>/chat`) |
| T021 | ✅ | `apps/api/src/chat/chat.service.ts`; delegação em `webhook-gateway.ts`; `webhook-response.ts` (resposta do nó compartilhada) |
| T022 | ✅ | `apps/api/src/chat/chat.int.test.ts` (12 casos) |
| T030 | ✅ | `ChatService.history` (chave da memória pelo avaliador de expressões) |
| T040 | ✅ | `apps/api/src/chat/chat.controller.ts`; ação nova na matriz RBAC e `docs/rbac-matriz.md` regenerado |
| T041 | ✅ | `apps/web/src/editor/chat-panel.tsx`, `use-chat-test.ts`, `apps/web/src/chat/` (mensagens com Markdown) |
| T043 | ✅ | Pedido do PO (14/10/2026): `apps/web/src/editor/logs-panel.tsx` (painel inferior), `logs.ts` (`logEntries`, `defaultLogSelection`) e `logs.test.ts`; o chat virou a coluna `ChatColumn` (`chat-panel.tsx`); E2E com 3 cenários |
| T042 | ✅ | `apps/web/src/editor/chat-trigger-panel.tsx`; `withFreshWebhookId` em `graph.ts` (adicionar, colar, duplicar) |
| T050 | ✅ | `apps/web/src/pages/chat-page.tsx` e a rota pública `/chat/:webhookId` |
| T051 | ✅ | `apps/web/e2e/chat.spec.ts` (2 cenários) |
| T060 | ✅ | `apps/api/src/workflow-io/n8n/converters.ts` (`convertChatTrigger`), `convert.ts` (pendência da memória temporária) |
| T061 | ✅ | Exportação no formato da spec 015; caso em `round-trip.test.ts` |
| T062 | ✅ | `fixtures/n8n/exemplo-chat-trigger` e `docs/migracao/relatorio-fixtures-n8n.md` regenerado |
| T070 | ✅ | `docs/nos/trigger.chat.md`, `workflow-json.md`, `README.md`, `importacao-n8n.md`, `contratos.md`, `rbac-matriz.md`, `.env.example` |
| T090–T093 | ✅ | Ver abaixo |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `packages/nodes/src/trigger/chat/chat.test.ts` › "FR-001: repassa o item da mensagem…", "FR-001/FR-006: está no catálogo…"; `chat.int.test.ts` › "SC-001/FR-002/FR-011…" (item do gatilho) e "FR-007…" (arquivos no item) |
| FR-002 | Sim | `chat.int.test.ts` › "SC-001/FR-002/FR-011…", "FR-002: erro do workflow…"; `e2e/chat.spec.ts` › "SC-001/FR-002…"; matriz RBAC › "Conversar pelo painel de chat (teste)" |
| FR-003 | Sim | `chat.test.ts` › "FR-003/NFR-004…"; `chat.int.test.ts` › "SC-002/FR-003/FR-008/NFR-004…", "SC-003/FR-003…"; `e2e/chat.spec.ts` › "SC-002/SC-005/FR-003…"; `apps/web/src/editor/graph.test.ts` › "FR-003: nó novo ou colado ganha outro webhookId…" |
| FR-004 | Sim | `chat.int.test.ts` › "FR-004: Basic Auth e usuário do Olly Flow", "FR-004: com a autenticação obrigatória na instalação…" |
| FR-005 | Sim | `chat.test.ts` › "FR-005…"; `chat.int.test.ts` › "FR-005: resposta pelo nó \"Responder ao webhook\"; erro do workflow; tempo esgotado" |
| FR-006 | Sim | `packages/shared-types/src/graph.test.ts` › "FR-006…"; `packages/engine/src/validate.test.ts` › "FR-006…"; `chat.int.test.ts` › "SC-005/FR-006…"; `e2e/chat.spec.ts` (recarga) |
| FR-007 | Sim | `chat.test.ts` › "FR-007…"; `chat.int.test.ts` › "FR-007: arquivos permitidos viram binários do item…" |
| FR-008 | Sim | `chat.int.test.ts` › "SC-002/FR-003/FR-008/NFR-004…" (produção, origem `chat`). Cota, limite de tokens, política de dados e workflow de erro valem pelo mesmo `ExecutionsService.launch` das demais execuções de produção, já testado nas specs 006, 007, 009 e 011 |
| FR-009 | Sim | `chat.int.test.ts` › "FR-009: mensagem longa e excesso de mensagens por endereço são recusados" |
| FR-010 | Sim | `validate.test.ts` › "FR-010…" |
| FR-011 | Sim | `chat.int.test.ts` › "SC-001/FR-002/FR-011…" (Agent com o prompt do item e memória pelo `sessionId`); `n8n.test.ts` › "SC-004/FR-011/FR-012…" (prompt automático) |
| FR-012 | Sim | `n8n.test.ts` › "SC-004/FR-011/FR-012…", "FR-012/FR-015…"; `round-trip.test.ts` › "spec 021 — FR-012…" |
| FR-013 | Sim | `apps/api/src/workflow-io/docs.test.ts` › "SC-003: todo tipo de nó registrado está documentado" |
| FR-014 | Sim | `chat.int.test.ts` › "SC-006/FR-014…", "FR-014: quem espera a vez além do tempo limite…" |
| FR-015 | Sim | `validate.test.ts` › "FR-015…"; `n8n.test.ts` › "FR-012/FR-015…" |
| FR-016 | Sim | `apps/web/src/editor/logs.test.ts` (2 casos); `e2e/chat.spec.ts` › "SC-001/FR-002…" (logs ao lado do chat) e "SC-007/FR-016: logs no pé do editor também sem chat…" |
| NFR-001 | Sim | Página e painel com layout responsivo (Tailwind, sem rolagem horizontal) e textos em português; E2E na largura padrão. Conferência manual em celular pendente |
| NFR-002 | Parcial | Não medido isoladamente: nos testes de integração, a resposta chega assim que o `ResultSubscriber` recebe o fim da execução (aviso pelo Redis) |
| NFR-003 | Sim | Modelo simulado em todos os testes |
| NFR-004 | Sim | `chat.test.ts` › "FR-003/NFR-004…"; `chat.int.test.ts` › "SC-002…" (a configuração não traz nomes de nós nem o id do workflow) |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `chat.int.test.ts` › "SC-001…" e `e2e/chat.spec.ts` › "SC-001…": 3 mensagens, a contagem de mensagens do modelo cresce (memória) |
| SC-002 | ✅ | `chat.int.test.ts` › "SC-002…" e `e2e/chat.spec.ts` › "SC-002…" |
| SC-003 | ✅ | `chat.int.test.ts` › "SC-003…" |
| SC-004 | ✅ | `n8n.test.ts` › "SC-004…"; fixture `exemplo-chat-trigger`: 4 nós, 0 marcadores (as 2 pendências são as credenciais fictícias) |
| SC-005 | ✅ | `chat.int.test.ts` › "SC-005/FR-006…" e a recarga no E2E |
| SC-006 | ✅ | `chat.int.test.ts` › "SC-006/FR-014…" |
| SC-007 | ✅ | `e2e/chat.spec.ts` › "SC-001…" (Agente com saída e passos) e "SC-007/FR-016…" |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 859 testes (inclui os 2 de `logs.test.ts`) |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 385 testes (rodada antes do painel de logs, que mudou só o frontend) (api 330, db 29, nodes 23, engine 3). A primeira execução falhou só no teste do catálogo de tipos de nó (`workflows.int.test.ts`), que lista os tipos explicitamente: `trigger.chat` foi acrescentado à lista |
| `pnpm test:e2e` | ✅ 50 de 50, inclusive os 3 cenários do chat e dos logs e o de fps do canvas (36 fps). Uma rodada intermediária acusou 2 falhas no E2E do Agent e do Basic LLM Chain: os logs recolhidos continuavam montados e duplicavam o painel de passos do NDV. Corrigido: só o chat fica montado com o painel recolhido |
| `pnpm app:up && pnpm smoke` | ✅ |

**Alterações de MCP em andamento:** o ponto de partida e esta verificação incluem as alterações de MCP da spec 010 que estavam no diretório de trabalho e não são desta spec: TLS inseguro, endereços internos e a migration `0016_mcp_insecure_tls`. O PO confirmou que são dele.

## Decisões tomadas

- **Chat na tabela `webhooks` e no gateway:** as rotas `GET`/`POST <webhookId>/chat` reaproveitam o registro de rotas entre instâncias, o CORS e a espera do resultado. O limite de taxa do chat é por endereço de origem e por rota (FR-009), diferente do webhook, que é só por rota: numa página pública, todos os usuários dividiriam o limite.
- **Lock da sessão no Redis (FR-014):** com espera até o tempo limite da resposta. O lock é liberado quando a mensagem anterior responde, termina ou passa do tempo limite, como diz a spec. No modo "Por nó de resposta", ele sai quando o nó responde, mesmo que o fluxo continue depois.
- **Painel inferior com o chat e os logs** (pedido do PO, como no N8N):
  - **montagem:** fica recolhido numa barra no pé do canvas para qualquer workflow; recolhido, só o chat continua montado (não perde a conversa), e os logs são renderizados ao abrir;
  - **detalhes:** os logs leem o estado da execução do editor (o mesmo do canvas) e reaproveitam o painel de dados e os passos de IA do painel do nó;
- **Painel do editor em duas chamadas:** iniciar e buscar a resposta. Assim, o canvas mostra o andamento ao vivo. Execuções do chat não mostram o aviso "Execução concluída": a resposta já aparece no painel, e os avisos empilhados cobriam os botões do painel (o E2E mostrou o problema).
- **Sessão anterior sem executar o workflow:** lê a memória persistente ligada ao gatilho, com a chave avaliada pelo avaliador de expressões (spec 003), e devolve o formato serializado do LangChain, como o N8N. A memória temporária não tem histórico.
- **Autenticação "Usuário do Olly Flow":** qualquer usuário ativo com sessão válida (token local ou do IdP), sem exigir acesso ao projeto, como o "n8n User Auth". A resposta 401 traz só o tipo de autenticação, para a página saber se pede usuário e senha ou o login.
- **Página hospedada:**
  - **sessões:** a do chat fica no `localStorage`; o usuário e a senha do Basic Auth, no `sessionStorage` (só a aba);
  - **leitura do histórico:** feita no próprio frontend, para não levar o pacote de nós (LangChain) ao navegador;
  - **carga de dados:** com o react-query, como o restante do frontend.
- **`webhookId` novo ao adicionar, colar ou duplicar o nó:** evita dois workflows disputando a mesma URL. A importação de arquivos mantém o do N8N, para preservar a URL.

## Desvios da spec/plano

- **Exportação (HU-7, FR-012):** o arquivo exportado segue o formato da spec 015, que mantém os tipos do Olly Flow (`trigger.chat`) na estrutura do N8N. A spec e o plano diziam `@n8n/n8n-nodes-langchain.chatTrigger`. A correção está registrada no histórico dos dois.
- **Plano (registrado no histórico):**
  - `@fastify/busboy` no lugar do `@fastify/multipart`;
  - memória obrigatória pela validação genérica, sem `CHAT_MEMORY_MISSING`, e o erro novo `CHAT_WEBHOOK_ID_INVALID`;
  - arquivos de `packages/nodes`;
  - painel do editor só com texto (anexos pela página).
- **T002:** sem acesso ao código do N8N nesta máquina, os formatos foram conferidos pelo conhecimento do código do Chat Trigger: item com `data0…` e `files`, `{ data }` serializado na sessão anterior e campos do multipart. Os textos padrão estão em português (NFR-G07), e não nos padrões em inglês do N8N. Recomenda-se confirmar com um workflow real da POC.

## Dependências adicionadas

| Pacote | Versão | Licença | Motivo |
|---|---|---|---|
| `@fastify/busboy` | 3.2.3 | MIT | Interpretar o `multipart/form-data` do chat (arquivos) a partir do corpo cru que o gateway de webhooks já recebe; é o parser do próprio `@fastify/multipart`, mantido pela equipe do Fastify |
| `react-markdown` | 10.1.0 | MIT | Exibir as respostas dos agentes em Markdown, como o N8N, sem interpretar HTML (padrão da biblioteca). Traz o ecossistema `unified`/`remark`/`micromark` (MIT) |

## Pendências, bloqueios e riscos

- **Segurança:** avaliar a exposição pública do chat (autenticação, limite de taxa, CORS) antes da homologação. É pré-requisito do roadmap.
- **Fixtures reais:** workflows da POC com Chat Trigger em `fixtures/n8n/`, para confirmar a T002.
- **NFR-001 e NFR-002:** conferir a página num celular e medir o tempo até a resposta em homologação.
- **Custo do chat público sem autenticação:** limitado pela taxa por endereço e pelo limite mensal de tokens. `OLLY_REQUIRE_WEBHOOK_AUTH` bloqueia a publicação sem autenticação.
- ~~**Spec 020 (planejada):** o plano dela prevê a migration `0016`, que agora é a das alterações de MCP, e a exportação com o tipo do N8N. Os dois pontos precisam de ajuste antes de implementá-la.~~ A spec 020 foi removida em 19/10/2026 (decisão do PO).

## Como demonstrar

1. `pnpm app:up` e entre no editor.
2. Crie **Mensagem de chat recebida → Agente** (prompt "do item"), com um modelo de chat e a **memória persistente**.
3. Clique em **Abrir chat** e converse: o canvas mostra a execução, e a segunda pergunta usa o contexto da primeira. **Nova sessão** recomeça.
4. No gatilho, ligue **Disponibilizar o chat publicamente**, escolha **Carregar sessão anterior: Da memória** e ligue a memória também à entrada do gatilho. Publique.
5. Abra a **Página do chat** mostrada no painel do nó, numa janela anônima: converse, recarregue (o histórico volta) e use **Nova conversa**.
6. Importe `fixtures/n8n/exemplo-chat-trigger/workflow.json` no formato N8N: nenhum marcador, e a URL é a mesma do N8N.

## Próximos passos sugeridos

- *Streaming* das respostas do Agent e do Basic LLM Chain, se o PO pedir.
- Anexos também no painel do editor.
- Widget de chat para sites, se surgir a demanda.
