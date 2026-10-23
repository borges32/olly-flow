# Plano técnico — Spec 028: Chat da plataforma ("Olly Chat")

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Banco:** migration `0020_olly_chat` com:
  - a configuração do chat (uma linha);
  - as sessões e as mensagens;
  - em `users`, o nome de usuário do IdP e o contador de sessões.
- **API** (módulo novo `olly-chat`):
  - **sessões:** rotas para qualquer usuário autenticado, sempre só as do próprio usuário;
  - **mensagem:** a API monta o payload com o usuário da sessão de login, chama o webhook configurado pelo filtro de rede (`HttpGuard`, spec 004), repassa ao navegador o stream NDJSON (spec 027) e guarda a pergunta e a resposta;
  - **configuração:** rota da administração da plataforma;
  - **limpeza:** passo novo na manutenção diária (spec 009).
- **Web:**
  - item **Olly Chat** no menu e página `/assistente` (barra de sessões e conversa), reaproveitando os componentes e a leitura do stream do chat da spec 021/027;
  - aba **Olly Chat** na Administração.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III — Segurança | Toda chamada de saída passa pelo filtro anti-SSRF (`HttpGuard`); o payload é montado no servidor com o usuário autenticado; segredos da autenticação do webhook criptografados como as credenciais (envelope), nunca devolvidos nem logados; rotas novas com RBAC (`@Authenticated` e `project:manage` global); SQL só pelo Kysely |
| IV — Testes | Integração (payload, identidade, numeração, sessões de outro usuário, renomear/excluir, uma mensagem por vez, stream e resposta comum, falhas, configuração, auditoria, segredos, retenção, filtro de rede) e E2E (menu, sessões, conversa com o passo atual, administração) |
| VI — LGPD e auditoria | Retenção a partir da última mensagem (padrão 7 dias) na manutenção diária; só o dono vê as sessões; configuração e limpeza auditadas |
| IX — Simplicidade | Sem dependência nova: reaproveita `HttpGuard`, a criptografia de credenciais, o formato e a leitura do stream (spec 027) e os componentes de chat (spec 021) |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `infra/migrations`, `packages/db` | `0020_olly_chat`: `olly_chat_config`, `olly_chat_sessions`, `olly_chat_messages`; `users.idp_username`, `users.chat_sessions_created`; schema e testes de migration |
| `packages/shared-types` | `OllyChatSession`, `OllyChatMessage`, `OllyChatConfig` (sem segredos), `OllyChatConfigUpdate`, payload `OllyChatPayload` |
| `apps/api` | `olly-chat/` (service, controller, schemas); `auth/user-sync.service.ts` (guarda o `preferred_username`); `maintenance.service.ts` (retenção); rotação de chave (`credentials/key-rotation.ts`) inclui o segredo do chat |
| `apps/web` | `pages/olly-chat-page.tsx` (sessões e conversa); `pages/admin-chat-page.tsx`; menu (`app-layout.tsx`), abas (`admin-nav.tsx`), rotas (`App.tsx`); reaproveita `chat/chat-view.tsx` e `chat/chat-stream.ts` |
| `docs/` | `docs/chat-olly.md` (uso, payload, workflow do assistente, memória), `contratos.md`, `modelo-dados.md`, `rbac-matriz.md` (se aplicável) |

## Design

### §1 Dados (migration 0020)

- **`olly_chat_config`:** uma linha (`id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id)`), com os campos:
  - `webhook_url TEXT NULL`, `retention_days INT NOT NULL DEFAULT 7 CHECK (1..3650)`;
  - `auth_type TEXT NOT NULL DEFAULT 'none' CHECK (none | headerAuth | basicAuth)`, `auth_encrypted BYTEA NULL`, `key_version INT NULL`, `key_provider TEXT NULL`;
  - `updated_by UUID NULL`, `updated_at TIMESTAMPTZ`.
  - Sem linha = não configurado.
- **`olly_chat_sessions`:** `id UUID PK`, `user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE`, `number INT NOT NULL`, `title TEXT NOT NULL`, `title_custom BOOLEAN NOT NULL DEFAULT false`, `created_at`, `last_message_at TIMESTAMPTZ NOT NULL`, com `UNIQUE (user_id, number)` e índice em `(user_id, last_message_at DESC)` e em `last_message_at` (retenção).
- **`olly_chat_messages`:** `id UUID PK`, `session_id UUID NOT NULL REFERENCES olly_chat_sessions ON DELETE CASCADE`, `role TEXT CHECK (user | assistant | error)`, `text TEXT NOT NULL`, `status TEXT CHECK (pending | done)`, `execution_id UUID NULL`, `created_at`, com índice `(session_id, created_at)`.
- **`users`:** `idp_username TEXT NULL` (do `preferred_username`) e `chat_sessions_created INT NOT NULL DEFAULT 0` (contador: o número nunca é reaproveitado).

### §2 Identidade e payload

- **No login pelo IdP:** `UserSyncService` grava `idp_username` = `preferred_username` (quando vier).
- **Payload** (`OllyChatPayload`):
  - `chatSessionId` = `String(session.number)`;
  - `client` = `"chat-olly"`;
  - `email` = `user.email`;
  - `login` = `user.idp_username ?? user.email`;
  - `name` = `user.name ?? ''`;
  - `message` = texto enviado (1 a 20 000 caracteres, o limite do chat da spec 021).
- O corpo da requisição do navegador traz só `message`; o resto vem do servidor (FR-004).

### §3 API

Todas sob `/api/v1`. Rotas do usuário com `@Authenticated()` (qualquer usuário logado); a sessão de outro usuário responde 404.

| Rota | Uso |
|---|---|
| `GET /olly-chat/status` | `{ configured: boolean }` (a página avisa quando não está configurado) |
| `GET /olly-chat/sessions` | Sessões do usuário, mais recentes primeiro (`id`, `number`, `title`, `lastMessageAt`, `busy`) |
| `POST /olly-chat/sessions` | Cria a sessão: incrementa `users.chat_sessions_created` e usa o valor como `number` (na mesma transação); título "Sessão N" |
| `PATCH /olly-chat/sessions/:id` | Renomeia (`title`, 1 a 120 caracteres); `title_custom = true` |
| `DELETE /olly-chat/sessions/:id` | Exclui a sessão e as mensagens |
| `GET /olly-chat/sessions/:id/messages` | Mensagens, em ordem |
| `POST /olly-chat/sessions/:id/messages` | Envia `{ message }` e responde NDJSON (§4) |
| `GET /admin/olly-chat` | Configuração sem segredos: `{ webhookUrl, retentionDays, authType, hasSecret, updatedAt, updatedBy }` (`project:manage` global) |
| `PUT /admin/olly-chat` | Atualiza; segredo só quando informado (vazio mantém o atual); auditado como `olly_chat.config`, sem segredos nos detalhes (`project:manage` global) |

### §4 Envio da mensagem (stream)

1. **Pré-condições:**
   - sem configuração → 409 "chat não configurado";
   - sessão com mensagem `pending` → 409 "a sessão ainda está respondendo" (uma por vez; FR-007).
2. **Gravação:** grava a mensagem do usuário e uma resposta `pending`. Atualiza `last_message_at` e, se o título não foi personalizado e é a primeira mensagem, o título "Sessão N · <primeiros 40 caracteres>".
3. **Resposta ao navegador:** assume a resposta com os cabeçalhos do stream (spec 027, `STREAM_RESPONSE_HEADERS`).
4. **Chamada ao webhook:** `POST` com o payload, `content-type: application/json` e a autenticação configurada (cabeçalho ou `Authorization: Basic`), pelo `HttpGuard.fetch`.
5. **Leitura da resposta:**
   - **NDJSON:** repassa cada linha ao navegador e guarda o `item` final ou o `error` (e o `executionId` do `metadata`). O texto guardado vem de `ollyChatReplyText` (`packages/shared-types`): o primeiro elemento, se for lista; o campo `report`; senão `output` ou `text`; senão o JSON formatado. Um texto (o conteúdo inteiro, ou o `output`/`text`) que é um JSON com `report`, com ou sem bloco ```json em volta, é lido como JSON; um item no formato do N8N (`{ json: {...} }`) é desembrulhado. Sem `report`/`output`/`text` no objeto, a busca desce pelos campos (até 6 níveis, textos JSON incluídos), e o primeiro `report` achado vale. A página aplica a mesma função ao exibir as respostas guardadas;
   - **resposta comum:** JSON ou texto vira um `item` único;
   - **HTTP de erro** (ex.: 429 do limite de streams, 401, 500): vira um `error` com a mensagem do corpo, quando houver.
6. **Resposta guardada:** finaliza a `pending` como `assistant` (texto: `output`, `text` ou o JSON formatado) ou `error`, e encerra.
7. **Navegador desconectado:** a API continua lendo o webhook até o fim e guarda a resposta. O usuário vê a resposta ao voltar.
8. **Teto:** tempo máximo do workflow (`OLLY_DEFAULT_WORKFLOW_TIMEOUT`) mais 30 s; depois disso, `error` "o assistente não respondeu a tempo".
9. **Resposta `pending` antiga** (a API caiu no meio): mais antiga que o teto, aparece como erro "resposta interrompida" e não bloqueia a sessão.

### §5 Retenção

- **Passo novo na manutenção diária (spec 009):** exclui as sessões com `last_message_at < agora − retention_days` (em lotes, com as mensagens). O total entra no relatório e na auditoria da manutenção.

### §6 Web

- **Menu** (`app-layout.tsx`): item **Olly Chat** (ícone `MessagesSquare`), para todo usuário autenticado, rota `/assistente`.
- **Página `OllyChatPage`:**
  - **barra lateral:** sessões, **Nova sessão**, renomear (edição no lugar) e excluir (confirmação);
  - **conversa:** `ChatMessageList` e `ChatComposer` (spec 021) e `readChatStream` (spec 027), que mostra "Executando: <nó>";
  - **estados:** sem configuração, mostra o aviso; na primeira visita, cria a sessão 1;
  - **mobile:** a barra lateral vira uma lista recolhível.
- **Visual (FR-013):**
  - **Componentes próprios:** `OllyMessageList`, `OllyComposer` e `OllyEmptyState` (`chat/olly-chat-view.tsx`). Os chats da spec 021 (painel do editor e chat público) continuam com os balões de `ChatMessageList`.
  - **Funções puras testadas:** agrupamento das sessões por data e horário relativo (`chat/olly-chat-format.ts`).
  - **Tipografia do `MessageText`** (comum aos chats):
    - parágrafos com entrelinha maior;
    - títulos com espaçamento, e `##` com linha embaixo;
    - tabela com borda arredondada, cabeçalho e linhas alternadas;
    - blocos de código escuros;
    - citação com barra de cor;
    - diagrama Mermaid num cartão; o erro de sintaxe aparece como aviso (âmbar).
  - **Sem dependência nova.**
- **GFM (FR-012):** o `MessageText` usa o plugin `remark-gfm` (tabelas, tachado, listas de tarefas, links automáticos) e estiliza títulos, citações, linhas horizontais e tabelas (bordas, cabeçalho, rolagem horizontal num contêiner). Continua sem HTML bruto. Vale também para os chats da spec 021.
- **Mermaid (FR-011):** no `MessageText` (componente de Markdown dos chats), o bloco de código com a linguagem `mermaid` vira o componente `MermaidDiagram`, que carrega a biblioteca `mermaid` sob demanda (`import()`; fora do pacote principal), desenha com `securityLevel: 'strict'` (rótulos sanitizados, sem scripts nem cliques) e o tema claro ou escuro. Erro de sintaxe: mostra o código e o aviso. Vale também para os chats da spec 021, que usam o mesmo componente.
- **Administração:** aba **Olly Chat** (`/admin/chat`) com URL, retenção e autenticação (tipo e campos de segredo vazios com "deixe em branco para manter"), para quem tem `project:manage` global.

## Modelo de dados

Ver §1 (migration `0020_olly_chat`).

## Contratos

Ver §3; payload em §2; stream no formato da spec 027.

## Permissões RBAC

| Rota | Permissão |
|---|---|
| `/olly-chat/*` | Usuário autenticado (`@Authenticated`), só as próprias sessões |
| `GET`/`PUT /admin/olly-chat` | `project:manage` (escopo global), como a administração de IA |

## Configuração

Nenhuma variável nova: a configuração é da plataforma, na aba **Olly Chat** (banco). O teto usa `OLLY_DEFAULT_WORKFLOW_TIMEOUT`.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| A API chama o webhook (proxy do stream) | O navegador chama o webhook direto | A identidade não pode vir do navegador (FR-004); segredos não vão ao navegador; o filtro de rede vale (constituição) |
| Contador por usuário em `users` | `MAX(number) + 1` | Número nunca reaproveitado, nem depois de excluir |
| Resposta `pending` gravada antes da chamada | Gravar só no fim | Bloqueio de uma mensagem por vez sem Redis; a resposta é guardada mesmo com o navegador fechado |
| Segredo criptografado como as credenciais | Credencial de um projeto | A configuração é da plataforma, não de um projeto |
| Rota `/assistente` | `/chat` | `/chat/:webhookId` já é o chat público da spec 021 |
| `remark-gfm` (MIT) | Escrever o parser das tabelas | Plugin oficial do `react-markdown` (mesmo grupo, `remarkjs`) para o padrão GFM |
| `mermaid` (MIT), carregada sob demanda | Renderizar no servidor; imagem pronta vinda do workflow | Biblioteca de referência do formato, no navegador e só quando há diagrama; `securityLevel: 'strict'` |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-003, FR-004, FR-005, FR-006, FR-007, FR-010, NFR-001, SC-001, SC-002 | Integração | `apps/api/src/olly-chat/olly-chat.int.test.ts` (webhook falso que captura o payload e responde NDJSON ou JSON; identidade do servidor; numeração por usuário sem reaproveitar; outro usuário 404; renomear e excluir; 409 com resposta pendente; navegador desconectado guarda a resposta; erros 429 e 500; filtro de rede) |
| FR-004 (`login`) | Integração | `olly-chat.int.test.ts` + `auth` (`preferred_username` gravado no login pelo IdP; prioridade sobre o e-mail) |
| FR-008, SC-004 | Integração | `olly-chat.int.test.ts` (só `project:manage` global; segredo não volta; auditoria sem segredo; validação) |
| FR-009, SC-003 | Integração | `apps/api/src/maintenance/retention.int.test.ts` (sessão vencida apagada; sessão antiga com mensagem recente mantida) |
| FR-001, FR-002, FR-005, FR-006 | E2E | `apps/web/e2e/olly-chat.spec.ts` (menu para o viewer, Nova sessão, conversa com o passo atual, voltar à sessão, renomear, excluir, aba Olly Chat da Administração) |
| Migration | Integração | `packages/db/src/migrations.int.test.ts` |

## Riscos

| Risco | Mitigação |
|---|---|
| Memória do workflow misturando usuários (numeração por usuário) | Pré-requisito documentado: chave da memória com `login` + `chatSessionId` (spec e `docs/chat-olly.md`) |
| URL externa bloqueada pelo filtro de rede | Mensagem clara no chat; orientação de `OLLY_HTTP_ALLOWLIST` na aba Chat e na documentação |
| Respostas longas em conexões presas | Teto pelo tempo máximo do workflow; a resposta é guardada mesmo com o navegador fechado |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 21/10/2026 | Criação do plano | Spec 028 esclarecida pelo PO |
| 21/10/2026 | §4: texto pelo campo `report`; §6: diagramas Mermaid | Spec 028, histórico |
| 21/10/2026 | §4: JSON final que chega como texto (correção) | Spec 028, histórico |
| 21/10/2026 | §6: Markdown GFM (tabelas) e estilos de títulos | Spec 028, histórico |
| 22/10/2026 | §4: `report` dentro de embrulhos; exibição das respostas guardadas | Spec 028, histórico |
| 23/10/2026 | §6: visual da página (FR-013) | Spec 028, histórico |
