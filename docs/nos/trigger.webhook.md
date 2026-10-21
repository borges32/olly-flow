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
| `responseMode` | `onReceived` (padrão): 202 com `{ executionId }` na hora. `lastNode`: JSON do primeiro item do último nó que terminou com dados. `responseNode`: o que o nó **Responder ao webhook** definir. `streaming`: os passos (nome de cada nó executado) aos poucos e a resposta no fim; ver [Resposta em streaming](#resposta-em-streaming-spec-027) |
| `options.allowedOrigins` | CORS: origens separadas por vírgula, ou `*`. Vazio: sem CORS |
| `options.ipAllowlist` | IPs ou CIDRs aceitos, separados por vírgula. Vazio: qualquer IP |

## URLs

- **Produção:** `<origem>/webhook/<path>`. Responde só depois de **Publicar** o workflow e usa sempre a versão publicada, mesmo com o rascunho alterado.
- **Teste:** `<origem>/webhook-test/<path>`. Responde enquanto o editor está em **Escutar chamada de teste** (2 min), usando a definição aberta no editor, mesmo sem salvar. A escuta termina na primeira chamada.
  - Como no "Listen for test event" do N8N, a chamada executa **só o nó Webhook** e recebe 202 com o id da execução, qualquer que seja o modo de resposta.
  - O payload aparece no nó; os seguintes são executados um a um pelo botão ▶ de cada nó, que reaproveita o payload recebido.

O painel do nó mostra as duas URLs, com botão de copiar.

## Resposta em streaming (spec 027)

Com `responseMode: "streaming"`, a resposta começa logo e chega aos poucos, uma linha JSON por evento (NDJSON), enquanto o fluxo roda. Serve para mostrar o progresso de fluxos longos a quem chamou. O formato segue o do N8N (`begin`, `item`, `end`, `error`), mais dois eventos do Olly Flow (`execution` e `ping`). **Ignore tipos desconhecidos:** novos tipos podem aparecer.

- **Cabeçalhos:** `200`, `Content-Type: application/json; charset=utf-8`, `Transfer-Encoding: chunked`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- **`timestamp`:** milissegundos desde 1970. **`nodeName`:** o nome do nó como aparece no canvas, para saber em que ponto do workflow a execução está.

| `type` | Quando | Conteúdo |
|---|---|---|
| `execution` | Execução gravada (`queued`), começou (`started`) ou passou a aguardar (`waiting`, ex.: nó Esperar longo; o stream encerra e a execução continua) | `metadata: { executionId, status, timestamp }` |
| `begin` | Um nó começou | `metadata: { executionId, nodeId, nodeName, nodeType, runIndex, itemIndex, timestamp }` |
| `end` | O nó terminou | os campos do `begin` + `status` (`success`, `error`, `cancelled`), `durationMs`, `itemsIn`, `itemsOut` |
| `ping` | A cada `OLLY_WEBHOOK_STREAM_PING_SECONDS` (15 s) sem eventos | `metadata.running`: os nós em execução (`nodeId`, `nodeName`, `nodeType`, `runIndex`) |
| `item` | Resposta final (último evento) | `content`: o mesmo do modo `lastNode` (JSON do último nó com dados) ou o corpo do **Responder ao webhook**; `metadata`: o nó que a produziu e `final: true` |
| `error` | A execução falhou ou foi interrompida (último evento) | `content`: a mensagem; `metadata`: o nó que falhou, quando houver |

Exemplo:

```
{"type":"execution","metadata":{"executionId":"6f1c…","status":"queued","timestamp":1761000000000}}
{"type":"execution","metadata":{"executionId":"6f1c…","status":"started","timestamp":1761000000040}}
{"type":"begin","metadata":{"executionId":"6f1c…","nodeId":"a1","nodeName":"Planner","nodeType":"ai.agentix","runIndex":0,"itemIndex":0,"timestamp":1761000000100}}
{"type":"ping","metadata":{"executionId":"6f1c…","running":[{"nodeId":"a1","nodeName":"Planner","nodeType":"ai.agentix","runIndex":0}],"timestamp":1761000015100}}
{"type":"end","metadata":{"executionId":"6f1c…","nodeId":"a1","nodeName":"Planner","nodeType":"ai.agentix","runIndex":0,"itemIndex":0,"status":"success","durationMs":26390,"itemsIn":1,"itemsOut":1,"timestamp":1761000026490}}
{"type":"item","content":{"resposta":"…"},"metadata":{"executionId":"6f1c…","nodeId":"s9","nodeName":"Montar resposta","nodeType":"data.set","runIndex":0,"final":true,"timestamp":1761000027000}}
```

**O que não vai no stream:** entrada, saída, console e binários dos nós (só a resposta final tem dados); passos de sub-workflows (o "Executar workflow" aparece como um passo); sub-nós de IA; nós que não executaram (ramo sem itens).

**Consumo:**

```bash
curl -N -X POST https://<origem>/webhook/investigar -H 'content-type: application/json' -d '{"pergunta":"…"}'
```

```python
import json, httpx

with httpx.stream("POST", "https://<origem>/webhook/investigar", json={"pergunta": "…"}, timeout=None) as r:
    for line in r.iter_lines():
        if not line:
            continue
        event = json.loads(line)
        if event["type"] == "begin":
            print("Executando:", event["metadata"]["nodeName"])
        elif event["type"] == "item":
            print("Resposta:", event["content"])
```

```javascript
const res = await fetch('https://<origem>/webhook/investigar', { method: 'POST', body: JSON.stringify({ pergunta: '…' }), headers: { 'content-type': 'application/json' } });
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines.filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === 'begin') console.log('Executando:', event.metadata.nodeName);
    if (event.type === 'item') console.log('Resposta:', event.content);
  }
}
```

**Regras:**

- **Segurança:** autenticação, allowlist de IP, limite de taxa e CORS valem igual. Quem chama vê os **nomes dos nós** executados.
- **Limite por projeto:** no máximo `OLLY_WEBHOOK_STREAM_MAX_PER_PROJECT` (20) streams abertos ao mesmo tempo por projeto, Webhook e chat somados; a administração da plataforma ajusta por projeto (`PUT /api/v1/projects/:id/quota` com `maxWebhookStreams`). Acima do limite: `429`, sem criar a execução.
- **Duração:** até a execução terminar, limitada pelo tempo máximo do workflow. O tempo limite da resposta síncrona (`OLLY_WEBHOOK_RESPONSE_TIMEOUT`) não se aplica.
- **Desconexão:** se quem chamou desconecta, a execução continua.
- **Responder ao webhook:** o corpo dele vira o `item` final; status e cabeçalhos são ignorados (a publicação avisa).
- **Proxies:** o caminho até a API não pode bufferizar a resposta. O nginx do `olly-flow-web` (compose e `k3s/`) já está configurado; um proxy corporativo do cliente também precisa repassar sem buffer. Os tempos limite contam inatividade, e o `ping` mantém a conexão.
- **Escuta de teste:** a escuta do workflow inteiro (`/webhook-test`) também responde em streaming; a escuta parada no nó Webhook continua respondendo 202 na hora.

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

- **Streaming:** no N8N, o stream traz o texto dos nós que suportam streaming (ex.: o Agent, aos poucos). No Olly Flow, traz os passos do fluxo e a resposta completa no fim. A importação mantém o modo e registra a pendência.

- O modo imediato responde **202** com o id da execução (o N8N responde 200 com uma mensagem).
- Rate limit por rota e allowlist de IP vêm da plataforma.

Introduzido na [spec 005](../../specs/005-webhook-codigo-js-mvp/spec.md) (FR-001 a FR-007).
