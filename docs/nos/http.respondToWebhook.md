# Responder ao webhook (`http.respondToWebhook`)

Define a resposta HTTP da chamada que iniciou o workflow, quando o Webhook está em `responseMode: responseNode`. Equivale ao `n8n-nodes-base.respondToWebhook`.

| Item | Valor |
|---|---|
| Categoria | Fluxo |
| Entradas | `main` |
| Saídas | `main` (repassa os itens) |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `respondWith` | `firstItemJson` (padrão), `allItemsJson` (lista com o `json` de todos os itens), `text` (`responseBody`, aceita expressão), `noData` (corpo vazio), `binary` (`binaryProperty` do primeiro item, padrão `data`) |
| `responseCode` | Status HTTP (padrão 200) |
| `responseHeaders[]` | `{ name, value }` |

## Comportamento

- A resposta é enviada **assim que o nó executa**; o workflow continua depois dela.
- Se o nó executar mais de uma vez, **vale a primeira resposta**. As seguintes só geram um aviso no log da execução.
- Fora de uma chamada de webhook (ex.: execução manual), o nó só repassa os itens.
- O `content-type` padrão é `application/json` (JSON), `text/plain` (texto) ou o tipo do binário. Pode ser trocado pelos cabeçalhos.

Introduzido na [spec 005](../../specs/005-webhook-codigo-js-mvp/spec.md) (FR-008).
