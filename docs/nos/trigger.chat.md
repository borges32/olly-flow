# Mensagem de chat recebida (`trigger.chat`)

Inicia o workflow a cada mensagem de chat: pelo painel de chat do editor, pela página de chat hospedada ou por chamadas HTTP de outros sistemas. Equivale ao "When chat message received" do N8N (`@n8n/n8n-nodes-langchain.chatTrigger`, versões 1 a 1.3). Produzido pela [spec 021](../../specs/021-chat-trigger/spec.md).

| Item | Valor |
|---|---|
| Categoria | Gatilho |
| Entradas | — (com "Da memória", a entrada de sub-nó `ai_memory`) |
| Saídas | `main` |
| Credenciais | `webhookBasicAuth` (com `authentication: "basicAuth"`) |

## Parâmetros

Nenhum parâmetro aceita expressão: eles valem antes de existir um item.

| Parâmetro | Descrição |
|---|---|
| `webhookId` | Identificador público do chat (oculto no editor). Gerado ao criar, colar ou duplicar o nó; na importação, vem do N8N. Forma a URL `/webhook/<webhookId>/chat` |
| `public` | `false` (padrão): o chat só funciona no painel do editor. `true`: depois de publicar, responde também fora do editor |
| `mode` | `hostedChat` (padrão): página de chat pronta em `/chat/<webhookId>`. `webhook`: só o endereço HTTP |
| `authentication` | `none` (padrão), `basicAuth` (usuário e senha da credencial) ou `ollyUserAuth` (qualquer usuário ativo logado no Olly Flow, equivalente ao "n8n User Auth") |
| `initialMessages` | Mensagens exibidas ao abrir a página, uma por linha (modo `hostedChat`) |
| `options.title`, `options.subtitle` | Título e subtítulo da página |
| `options.inputPlaceholder` | Texto de exemplo do campo da mensagem |
| `options.showWelcomeScreen`, `options.getStarted` | Tela de boas-vindas com o botão de começar |
| `options.allowFileUploads`, `options.allowedFilesMimeTypes` | Anexos e tipos permitidos (vírgula, com curingas: `image/*,application/pdf`) |
| `options.allowedOrigins` | CORS do endereço HTTP: origens separadas por vírgula, ou `*` (padrão) |
| `options.loadPreviousSession` | `notSupported` (padrão) ou `memory`: ao voltar à página, o histórico da sessão vem da memória ligada a este nó |
| `options.responseMode` | `lastNode` (padrão): responde com a saída do último nó. `responseNode`: quem responde é o nó **Responder ao webhook** |

## Item de saída

Uma mensagem gera uma execução com um item:

```json
{ "sessionId": "c1d7…", "action": "sendMessage", "chatInput": "Qual o prazo do chamado 42?" }
```

- **Arquivos:** vão para o object storage. O item recebe os binários `data0`, `data1`… e, no JSON, a lista `files` (`fileName`, `mimeType`, `fileSize`, `fileExtension`), como no N8N.
- **Com o Agent e o Basic LLM Chain:** no prompt "do item", eles leem o `chatInput`. A memória usa o `sessionId` pelo padrão da chave (`{{ $json.sessionId }}`), então cada conversa tem a própria memória.

## Onde conversar

| Onde | Como | Execução |
|---|---|---|
| **Editor** | Painel **Chat e logs** no pé do editor (ou o botão **Abrir chat**), como no N8N: o chat à esquerda e os logs dos nós à direita. **Nova sessão** recomeça a conversa | Teste: os nós mostram o andamento ao vivo, e cada resposta tem o link para a execução |
| **Página hospedada** | `<origem>/chat/<webhookId>` (modo `hostedChat`, workflow publicado) | Produção, com a origem `chat` |
| **HTTP** | `POST <origem>/webhook/<webhookId>/chat` (workflow publicado) | Produção, com a origem `chat` |

**Logs (FR-016):** o painel no pé do editor existe em qualquer workflow; sem Chat Trigger, chama-se só **Logs**.
- **Recolhido:** fica numa barra até ser aberto.
- **Lista:** os nós da execução de teste na ordem de início, com status, duração e se foram reaproveitados ou fixados.
- **Detalhes:** escolher um nó mostra o erro, a entrada e a saída (tabela, JSON, schema e **Baixar**) e, no Agent e no Basic LLM Chain, os passos.
- **Ao abrir:** o painel mostra o último nó com erro ou, sem erro, o último executado.

O painel do nó mostra as URLs do chat público, com o botão de copiar. A plataforma não fornece widget para sites; outros sistemas usam o endereço HTTP.

## Protocolo HTTP (o do N8N)

- **Enviar mensagem:** `{ "action": "sendMessage", "sessionId": "...", "chatInput": "..." }`, em JSON. Com arquivos, `multipart/form-data` com os campos `action`, `sessionId`, `chatInput` e os arquivos em `files`.
- **Resposta:**
  - **`lastNode`:** o JSON do primeiro item do último nó; o texto do Agent está em `output`, o do Basic LLM Chain em `text`;
  - **`responseNode`:** o que o nó **Responder ao webhook** definir.
- **Sessão anterior:** `{ "action": "loadPreviousSession", "sessionId": "..." }`. Responde `{ "data": [...] }`, com as mensagens no formato serializado do LangChain, sem executar o workflow.
- **`GET`:** devolve a configuração da página (título, mensagens iniciais, opções), sem dados do workflow.

| Status | Quando |
|---|---|
| 400 | Mensagem vazia, `sessionId` ausente, tipo de arquivo não permitido |
| 401 | Autenticação inválida (o corpo traz o tipo esperado em `authentication`) |
| 404 | Chat não publicado ou não público |
| 409 | A conversa ainda está respondendo a mensagem anterior (ver abaixo) |
| 413 | Mensagem acima de `OLLY_CHAT_MAX_MESSAGE_CHARS` caracteres |
| 429 | Mensagens demais por minuto do mesmo endereço (`OLLY_WEBHOOK_RATE_LIMIT_PER_MIN`) |
| 500 | O workflow terminou com erro |
| 504 | O workflow não respondeu dentro de `OLLY_WEBHOOK_RESPONSE_TIMEOUT` (a execução continua) |

## Comportamentos

- **Mensagens da mesma sessão, uma de cada vez:** a seguinte espera a anterior responder, terminar ou passar do tempo limite. Assim, a memória não perde contexto. Quem espera além do tempo limite recebe 409. Sessões diferentes rodam ao mesmo tempo. O N8N executaria as duas juntas; decisão do PO.
- **Memória temporária:** a memória temporária (`memory.buffer`, a "Simple Memory" do N8N) só lembra a conversa dentro de uma execução. No chat, cada mensagem é uma execução, então use a **memória persistente** (`memory.postgres`). O editor avisa (`CHAT_BUFFER_MEMORY`), e a importação registra a pendência.
- **Sessão pelo `sessionId`:** quem souber o `sessionId` de outra pessoa pode carregar a conversa dela com "Carregar sessão anterior", como no N8N (risco aceito pelo PO). A página hospedada gera um `sessionId` aleatório e o guarda no navegador.
- **Um gatilho de chat por workflow** (`CHAT_TRIGGER_DUPLICATE`).
- **Governança:** as execuções do chat público são de produção, com o mascaramento, a política de dados e a retenção (spec 009), a cota do projeto (spec 006), o limite mensal de tokens (spec 011) e o workflow de erro (spec 007).
- **Publicação:**
  - **Sem autenticação** (`CHAT_NO_AUTH`): só gera aviso; com `OLLY_REQUIRE_WEBHOOK_AUTH`, recusa a publicação, como no webhook;
  - **Usuário e senha:** a credencial precisa ser do tipo `webhookBasicAuth` deste projeto (`CHAT_CREDENTIAL_INVALID`);
  - **URL repetida:** dois workflows não publicam o mesmo `webhookId`.
- **Página hospedada:**
  - **Usuário e senha:** pede no formulário da página e guarda só na aba;
  - **Usuário do Olly Flow:** leva ao login da plataforma;
  - **Respostas:** o texto em Markdown é exibido sem HTML, e os links abrem em nova aba;
  - **Aparência:** não há CSS personalizado.

## Fora do escopo

*Streaming* das respostas, o nó "Respond to Chat", widget para sites, CSS personalizado e o hub de chat do N8N. Na importação, esses recursos viram pendências: o *streaming* passa a responder de uma vez, e a sessão anterior "manual" fica "Não suportado".
