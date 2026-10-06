# Webhook (`trigger.webhook`)

Inicia o workflow quando uma URL recebe uma chamada HTTP. Equivale ao `n8n-nodes-base.webhook` v2.

| Item | Valor |
|---|---|
| Categoria | Gatilho |
| Entradas | — |
| Saídas | `main` |
| Credenciais | `webhookHeaderAuth`, `webhookBasicAuth`, `webhookHmac` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `httpMethod` | `GET`, `POST` (padrão), `PUT`, `PATCH`, `DELETE`, `HEAD` |
| `path` | Caminho sem barras nas pontas: `pedidos`, `clientes/:id` (`:id` vira `params.id`). Letras, números, `.`, `_`, `~`, `-`. Não aceita expressão |
| `authentication` | `none` (padrão), `headerAuth`, `basicAuth` ou `hmac`, com a credencial do tipo correspondente selecionada no nó |
| `responseMode` | `onReceived` (padrão): 202 com `{ executionId }` na hora. `lastNode`: JSON do primeiro item do último nó que terminou com dados. `responseNode`: o que o nó **Responder ao webhook** definir |
| `options.allowedOrigins` | CORS: origens separadas por vírgula, ou `*`. Vazio: sem CORS |
| `options.ipAllowlist` | IPs ou CIDRs aceitos, separados por vírgula. Vazio: qualquer IP |

## URLs

- **Produção:** `<origem>/webhook/<path>`. Responde só depois de **Publicar** o workflow e usa sempre a versão publicada, mesmo com o rascunho alterado.
- **Teste:** `<origem>/webhook-test/<path>`. Responde enquanto o editor está em **Escutar chamada de teste** (2 min), usando a definição aberta no editor, mesmo sem salvar. A escuta termina na primeira chamada.
  - Como no "Listen for test event" do N8N, a chamada executa **só o nó Webhook** e recebe 202 com o id da execução, qualquer que seja o modo de resposta.
  - O payload aparece no nó; os seguintes são executados um a um pelo botão ▶ de cada nó, que reaproveita o payload recebido.

O painel do nó mostra as duas URLs, com botão de copiar.

## Item de saída

```json
{ "headers": { ... }, "params": { "id": "42" }, "query": { "origem": "site" }, "body": { ... } }
```

- **`headers`:** chegam sem `authorization`, `cookie`, `proxy-authorization` e `x-signature`, e sem o cabeçalho usado pela credencial (header ou HMAC).
- **`body`:** JSON vira objeto; `application/x-www-form-urlencoded` vira objeto; `text/*` e XML viram texto. Outros tipos de conteúdo vão para o object storage e o item recebe `binary.data`.
  - Corpo com um objeto ou lista JSON válido enviado como `text/plain`, `application/x-www-form-urlencoded` ou sem `Content-Type` também vira objeto: é o que fazem um `fetch` sem cabeçalho e o `curl -d`. Texto que não é JSON continua texto. A autenticação HMAC usa sempre o corpo cru.

## Autenticação

| Tipo | Como valida |
|---|---|
| Header | Cabeçalho com o nome e o valor da credencial |
| Basic | `Authorization: Basic` com usuário e senha da credencial |
| HMAC | HMAC (`sha256` padrão, `sha1` ou `sha512`; `hex` ou `base64`) do **corpo cru** com o segredo, no cabeçalho da credencial (padrão `X-Signature`). Aceita o prefixo `sha256=` (estilo GitHub) |

As comparações são feitas em tempo constante. Falha na autenticação: 401.

## Limites e erros

| Situação | Resposta |
|---|---|
| Caminho sem webhook publicado (ou sem escuta, no teste) | 404 |
| IP fora da allowlist | 403 |
| Corpo acima de `OLLY_WEBHOOK_MAX_BODY` (MB, padrão 16) | 413 |
| Mais de `OLLY_WEBHOOK_RATE_LIMIT_PER_MIN` chamadas por minuto na rota (padrão 120) | 429 |
| `lastNode`/`responseNode` sem resposta em `OLLY_WEBHOOK_RESPONSE_TIMEOUT` (s, padrão 120) | 504 com `{ executionId }`; a execução continua |
| Workflow terminou com erro (`lastNode`) | 500 com `{ executionId, error }` |
| `responseNode` sem o nó de resposta ter executado | 500 com `{ executionId }` |

## Publicação

**Publicar** valida a estrutura e os webhooks:
- o caminho é válido e não se repete no workflow;
- a credencial é do projeto e do tipo certo;
- o modo `responseNode` exige um nó **Responder ao webhook**.

Um webhook sem autenticação gera aviso. Com `OLLY_REQUIRE_WEBHOOK_AUTH=true`, gera erro. Um caminho já usado por outro workflow publicado responde 409.

## Divergências do N8N

- O modo imediato responde **202** com o id da execução (o N8N responde 200 com uma mensagem).
- Rate limit por rota e allowlist de IP vêm da plataforma.

Introduzido na [spec 005](../../specs/005-webhook-codigo-js-mvp/spec.md) (FR-001 a FR-007).
