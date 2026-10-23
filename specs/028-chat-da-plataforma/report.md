# Relatório — Spec 028: Chat da plataforma ("Olly Chat")

**Status:** Implementada
**Data:** 21/10/2026

## Resumo

A plataforma ganhou o **Olly Chat**:
- **Acesso:** item no menu e página `/assistente`, para qualquer usuário autenticado, de qualquer perfil.
- **Sessões:** numeradas por usuário ("Sessão 1", "Sessão 2"…) na barra lateral. O usuário cria, retoma, renomeia e exclui; os números nunca são reaproveitados.
- **Envio:** cada mensagem vai ao workflow configurado com o payload `{ chatSessionId, client: "chat-olly", email, login, name, message }`, montado pela API com o usuário logado. O `login` é o nome de usuário do provedor de identidade (IdP), com prioridade, ou o e-mail.
- **Resposta:** em Streaming (spec 027), com "Executando: <nó>" enquanto espera. O texto exibido é o campo `report` do JSON final do workflow (`[{ client, report, memoria }]`), em Markdown, com diagramas Mermaid (` ```mermaid `). Pergunta e resposta ficam guardadas, mesmo com o navegador fechado no meio.
- **Configuração:** aba **Olly Chat** na Administração, com URL do webhook, retenção (padrão 7 dias, a partir da última mensagem) e autenticação opcional (cabeçalho com chave ou Basic), com os segredos criptografados.
- **Retenção:** a manutenção diária apaga as sessões vencidas.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `infra/migrations/0020_olly_chat`; `olly_chat_config`, `olly_chat_sessions`, `olly_chat_messages`, `users.idp_username`, `users.chat_sessions_created`; testes de migration |
| T002 | ✅ | `packages/shared-types/src/olly-chat.ts` |
| T003 | ✅ | `UserSyncService` grava o `preferred_username` (login e vinculação de contas) |
| T010 | ✅ | `olly-chat/olly-chat-config.service.ts` (segredos criptografados como as credenciais; vazio mantém); rotas `GET`/`PUT /admin/olly-chat`; rotação de chave inclui o segredo (`credentials/key-rotation.ts`) |
| T011 | ✅ | `olly-chat.int.test.ts` › "spec 028 — configuração…" |
| T020 | ✅ | `olly-chat/olly-chat.service.ts` e `olly-chat.controller.ts` (sessões, mensagens, renomear, excluir; outro usuário: 404) |
| T021 | ✅ | Envio: payload no servidor, `HttpGuard`, repasse do NDJSON, resposta comum, erros, uma mensagem por vez (trava da sessão no banco), navegador desconectado, teto |
| T022 | ✅ | `olly-chat.int.test.ts` › "spec 028 — sessões e mensagens" (4 casos) |
| T030 | ✅ | `MaintenanceService.purgeOllyChat`; `retention.int.test.ts` › "spec 028…" |
| T040 | ✅ | `pages/olly-chat-page.tsx`; item **Olly Chat** no menu (`app-layout.tsx`); rota `/assistente` |
| T041 | ✅ | `pages/admin-chat-page.tsx`; aba **Olly Chat** (`admin-nav.tsx`); rota `/admin/chat` |
| T042 | ✅ | `apps/web/e2e/olly-chat.spec.ts` (2 casos) |
| T050 | ✅ | `ollyChatReplyText` em `packages/shared-types/src/olly-chat.ts` (`report`; depois `output`/`text`; depois JSON), usado no envio; `olly-chat.test.ts` e `olly-chat.int.test.ts` › "FR-005 (21/10/2026)…" |
| T051 | ✅ | `apps/web/src/chat/mermaid-diagram.tsx` e `mermaid-source.ts` (com `mermaid-source.test.ts`); `chat-view.tsx` desenha os blocos ` ```mermaid ` |
| T052 | ✅ | E2E `olly-chat.spec.ts` (diagrama desenhado e bloco inválido); `docs/chat-olly.md` |
| Correção (21/10/2026) | ✅ | No teste do PO em dev, com um workflow real, o chat mostrou o JSON inteiro: o JSON final chegava como **texto**, e `ollyChatReplyText` só lia o `report` de objetos. Reproduzido em `olly-chat.test.ts` › "FR-005 (correção 21/10/2026)…" e corrigido: um texto que é um JSON com `report` (inclusive em `output`/`text` e num bloco ```json) é lido como JSON. Itens no formato do N8N (`{ json: {...} }`) são desembrulhados. Integração › "FR-005 (correção 21/10/2026)…" |
| T053 | ✅ | `remark-gfm` no `MessageText` (`chat-view.tsx`), com estilos de tabela (contêiner com rolagem), títulos, citação e linha horizontal; `message-text.test.tsx` (trecho da resposta real do PO); E2E com título e tabela |
| Correção (22/10/2026) | ✅ | Em dev, o chat mostrou o JSON inteiro de novo (`exemplo.json`). O conteúdo direto (lista, objeto, texto) já funcionava, mas não quando vinha embrulhado: `{ output: [...] }` de um Agent com parser estruturado, outro campo em volta, `{ json: [...] }` ou JSON serializado duas vezes. Reproduzido em `olly-chat.test.ts` › "FR-005 (correção 22/10/2026)…" e corrigido: a busca desce até 6 níveis, e o `report` do nível mais alto (ou um `output`/`text` em texto) vence. A página do chat aplica a mesma leitura às respostas já guardadas. Integração › "FR-005 (correção 22/10/2026)…" |
| T054 | ✅ | Visual (FR-013): `chat/olly-chat-view.tsx` (`OllyMessageList`, `OllyComposer`, `OllyEmptyState`, `OllyAvatar`), `chat/olly-chat-format.ts` (com `olly-chat-format.test.ts`), página reorganizada; tipografia do `MessageText` e cartão do diagrama; E2E (boas-vindas, grupo "Hoje", resumo do cabeçalho, Copiar com a área de transferência). Conferido com capturas em claro, escuro e celular (390 px) |
| T090 | ✅ | `docs/chat-olly.md`, `contratos.md`, `modelo-dados.md` (a matriz de RBAC não mudou) |
| T091–T093 | ✅ | Ver abaixo |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | E2E `olly-chat.spec.ts` (o viewer abre **Olly Chat** pelo menu) |
| FR-002 | Sim | E2E (barra de sessões, nova sessão, conversa) |
| FR-003 | Sim | `olly-chat.int.test.ts` › "FR-003/SC-002…" (1, 2, excluir, 3; outro usuário começa no 1) |
| FR-004 | Sim | `olly-chat.int.test.ts` › "FR-003/FR-004/…" (payload exato; `login` do IdP; campos de identidade enviados pela página ignorados; sem IdP, o e-mail) |
| FR-005 | Sim | Integração (repasse do stream, resposta comum, campo `report` do JSON final); unidade `olly-chat.test.ts` (lista ou objeto, alternativas); E2E (passo atual e Markdown do `report`) |
| FR-006 | Sim | Integração (mensagens guardadas; outro usuário 404; renomear e excluir); E2E (voltar à sessão depois de recarregar, renomear, excluir) |
| FR-007 | Sim | `olly-chat.int.test.ts` › "FR-007…" (409 com resposta em andamento; resposta guardada com o navegador fechado) |
| FR-008 | Sim | `olly-chat.int.test.ts` › "FR-008/SC-004…" (só `project:manage` global, validação, segredo não volta, auditoria sem segredo, cabeçalho enviado ao webhook); E2E (aba Olly Chat) |
| FR-009 | Sim | `retention.int.test.ts` › "FR-009/SC-003…" |
| FR-010 | Sim | `olly-chat.int.test.ts` › "FR-005/FR-010…" (HTTP 500, limite de streams, filtro de rede) |
| FR-011 | Sim | Unidade `mermaid-source.test.ts`; E2E `olly-chat.spec.ts` (flowchart desenhado em SVG; bloco inválido mostra o código e o aviso, e o resto da mensagem aparece) |
| FR-012 | Sim | Unidade `message-text.test.tsx` (tabela com cabeçalho e linhas em contêiner com rolagem; títulos, linha horizontal, tachado, link automático; sem HTML bruto); E2E `olly-chat.spec.ts` (título e tabela na resposta) |
| FR-013 | Sim | Unidade `olly-chat-format.test.ts` (grupos por data, horário, resumo, primeiro nome); E2E `olly-chat.spec.ts` (boas-vindas, grupo "Hoje", "2 mensagens · última atividade", Copiar leva o Markdown) |
| NFR-001 | Sim | Integração (identidade do servidor; destino interno bloqueado pelo filtro) |
| NFR-002 | Sim | Retenção, sessões só do dono e auditoria (testes acima) |
| NFR-003 | Sim (indireto) | O stream é repassado linha a linha, sem acumular (E2E: o passo aparece antes da resposta); a latência não é medida separadamente |
| NFR-004 | Parcial | Textos em português; barra lateral empilhada em telas estreitas (`md:`), sem teste automatizado em celular |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | E2E: o viewer manda a mensagem a um workflow publicado (Webhook em Streaming → Esperar → resposta com o payload). O chat mostra "Executando: Analisando", e a resposta traz `chat-olly`, o número da sessão, o login e a mensagem |
| SC-002 | ✅ | Integração e E2E: duas sessões com o histórico de cada uma depois de recarregar; outro usuário não as vê e tem a própria "Sessão 1" |
| SC-003 | ✅ | Integração: retenção de 7 dias apaga a sessão com mensagem de 8 dias e mantém a criada há 30 dias com mensagem de ontem |
| SC-004 | ✅ | Integração: 403 para quem não tem `project:manage` global |
| SC-006 | ✅ | Unidade com o trecho da resposta real de produção do PO (títulos, tabela "Ações recomendadas", lista, linha horizontal): a tabela vira `<table>`, sem os `|`; E2E com tabela no `report` |
| SC-005 | ✅ | E2E: o workflow devolve `{ client, report }` com um flowchart no `report`; o chat mostra o diagrama (SVG com "Pergunta"), e não o código |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 928 testes (871 nos pacotes e 57 na raiz). Na rodada completa, o teste de desempenho NFR-002 da spec 003 (`expressions`, 1000 itens em menos de 1 s) passou do tempo (1,28 s), com a máquina carregada pelo turbo. Rodado de novo sozinho, passou (124 de 124). É a instabilidade já conhecida, sem relação com esta spec |
| `pnpm build` | ✅ O `mermaid` fica num pacote à parte (`mermaid.core-*.js`, 152 kB gzip), baixado só quando aparece um diagrama |
| `pnpm test:integration` | ✅ 421 testes (api 352, db 35, nodes 31, engine 3) |
| `pnpm test:e2e` | ✅ 62 de 62 |
| `pnpm app:up && pnpm smoke` | ✅ |

O nome "Olly Chat" foi pedido durante a verificação. Depois da troca, rodei de novo o lint, o typecheck, o E2E do Olly Chat, o `app:up` e o smoke, todos ✅. Depois do ajuste do `report` e do Mermaid (Fase 5b), rodei de novo a verificação completa (números acima).

Depois da correção do JSON como texto, rodei de novo:
- **✅** lint, typecheck, `pnpm test` (shared-types 51), build, a integração do Olly Chat (7 de 7), o E2E do Olly Chat (2 de 2), o `app:up` e o smoke.
- **NFR-002 da spec 003:** falhou de novo por tempo (1,19 s) na rodada com o turbo e passou rodado sozinho.

Depois do Markdown GFM (T053), rodei de novo a verificação completa:
- **✅** install, lint, typecheck, `pnpm test` (930: web 128, shared-types 51…), build, `pnpm test:integration` (422: api 353, db 35, nodes 31, engine 3), `app:up` e smoke.
- **`pnpm test:e2e`:** 61 de 62. A falha foi o teste de desempenho do canvas (spec 002, NFR-001: 26 fps, mínimo de 30), que não tem relação com o chat. Rodado de novo sozinho, com os E2E dos chats (specs 021 e 028), passou (7 de 7).

Depois da correção de 22/10/2026 (`report` dentro de embrulhos), rodei de novo a verificação completa:
- **✅** typecheck, `pnpm test` (shared-types 52), build, `app:up` e smoke.
- **`pnpm lint`:** só o Prettier reclamou do `exemplo.json`, um arquivo de exemplo do PO na raiz do repositório, fora do código. Não mexi nele. Sem ele, o lint passa.
- **`pnpm test:integration`:** 421 de 422. A falha foi o teste SC-004 da spec 011 (aprovação com troca de worker), uma disputa de tempo. Rodado de novo sozinho, passou (6 de 6).
- **`pnpm test:e2e`:** 61 de 62. Falhou de novo o teste de fps do canvas (spec 002, 26 fps). Rodado de novo sozinho, com o E2E do Olly Chat, passou (3 de 3).

## Decisões tomadas

- **A API chama o webhook,** não o navegador: a identidade não pode ser forjada, os segredos não vão ao navegador e o filtro de rede vale. A API repassa o NDJSON ao navegador sem mudar o formato da spec 027.
- **Numeração por usuário** com contador em `users` (nunca reaproveita). Como duas pessoas têm uma "Sessão 1", a documentação e a aba de configuração orientam a chave da memória com `login` + `chatSessionId`.
- **Uma mensagem por vez:** a resposta `pending` é gravada antes da chamada, sob trava da linha da sessão (`FOR UPDATE`). Uma `pending` mais antiga que o teto (tempo máximo do workflow + 30 s) conta como interrompida.
- **Resposta guardada mesmo com o navegador fechado:** a API continua lendo o webhook até o fim.
- **Resposta que não é streaming** (JSON ou texto de uma vez) vira um `item` único; respostas HTTP de erro viram um `error` com a mensagem do corpo.
- **Segredos:** criptografados como as credenciais (`encryptCredentialData`, AAD `olly_chat_config`), também recifrados pela rotação de chaves.
- **Permissão da configuração:** `project:manage` global, a mesma da administração de IA.
- **Rota `/assistente`:** `/chat/<id>` já é o chat público da spec 021.
- **Interface:**
  - **"Nova sessão":** fica desabilitada enquanto uma sessão está sendo criada. O E2E mostrou uma corrida entre a sessão automática da primeira visita e o clique.
  - **Ícones de excluir:** somem durante a espera da resposta.
- **Nome "Olly Chat":** pedido pelo PO durante a verificação (menu, título, aba). O `client` do payload continua `chat-olly`.
- **Visual (23/10/2026, pedido do PO):**
  - **Componentes próprios:** o Olly Chat ganhou componentes próprios, porque as respostas são relatórios longos. Os chats da spec 021 (painel do editor e chat público) mantêm os balões e só herdam a tipografia nova do Markdown.
  - **Altura:** a página ocupa a altura da tela.
  - **Largura:** a conversa fica numa coluna de até 56 rem.
  - **Celular:** o avatar some para sobrar espaço.
  - **Exclusão durante a resposta:** a lixeira não aparece (antes, ficava esmaecida).
- **Campo `report` e Mermaid (21/10/2026, pedido do PO depois da implementação):**
  - **Texto:** a API guarda o `report` do primeiro item do JSON final. Sem ele, vale o comportamento anterior (`output`/`text`/JSON), e os workflows já feitos continuam funcionando.
  - **Diagramas:** desenhados no navegador, no componente de Markdown comum aos chats, e por isso valem também nos chats da spec 021.
  - **Carregamento:** a biblioteca só é baixada quando aparece um diagrama (pacote à parte).
  - **Segurança:** `securityLevel: 'strict'` (rótulos sanitizados, sem scripts nem cliques).
  - **Tema:** acompanha o claro/escuro da página.

## Desvios da spec/plano

Nenhum. O ajuste do `report` e do Mermaid entrou na spec e no plano antes do código (Histórico de 21/10/2026: FR-005 alterado, FR-011 e SC-005 novos, Fase 5b). O mesmo vale para a correção do JSON como texto (FR-005), para o Markdown GFM (FR-012 e SC-006, T053) e para o visual da página (FR-013, T054).

## Dependências adicionadas

| Dependência | Versão | Licença | Justificativa |
|---|---|---|---|
| `remark-gfm` (`apps/web`) | 4.0.1 (exata) | MIT | O PO testou com a resposta real de produção, e a tabela do relatório não era formatada: o `react-markdown` só segue o Markdown básico (CommonMark), e as tabelas são do padrão GFM. É o plugin oficial do mesmo grupo (`remarkjs`) |
| `mermaid` (`apps/web`) | 12.1.0 (exata) | MIT | Pedido do PO: desenhar os flowcharts que o workflow devolve no `report`. É a biblioteca de referência do formato. Carregada sob demanda (`import()`), fora do pacote principal |

## Pendências, bloqueios e riscos

- **Respostas já guardadas com o JSON inteiro** (antes da correção) continuam assim; as novas mostram o `report`. Para ver a correção em dev, é preciso implantar a nova versão da API.
- **Workflow do assistente:** publicar com o Webhook em Streaming e a memória com `login` + `chatSessionId` (pré-requisito da spec).
- **URL fora do Olly Flow:** liberar no filtro de rede (`OLLY_HTTP_ALLOWLIST`), se for o caso.
- **Celular (NFR-004):** conferir a página num celular; não há teste automatizado.

## Como demonstrar

1. `pnpm app:up`; publique um workflow com o Webhook em **Responder: streaming** (ex.: Webhook → Agent → resposta).
2. **Administração › Olly Chat:** informe a URL do webhook e salve.
3. Entre como qualquer usuário, abra **Olly Chat** no menu e mande uma mensagem: o passo atual aparece, e depois a resposta (o `report` do workflow). Um bloco ` ```mermaid ` com `flowchart` aparece como diagrama.
4. Crie outra sessão, recarregue e volte à primeira: o histórico está lá. Renomeie e exclua pela barra lateral.
