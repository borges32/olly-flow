# Código JavaScript (`code.javascript`)

Transforma os itens com JavaScript, com a mesma API do Code node do N8N (`n8n-nodes-base.code` v2).

| Item | Valor |
|---|---|
| Categoria | Código |
| Entradas | `main` |
| Saídas | `main` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `mode` | `runOnceForAllItems` (padrão): o código roda uma vez e recebe todos os itens. `runOnceForEachItem`: roda uma vez por item |
| `jsCode` | O código: corpo de uma função assíncrona (`return` e `await` no nível de cima). Não é avaliado como expressão |

## Variáveis

| Variável | Conteúdo |
|---|---|
| `$input.all()`, `.first()`, `.last()` | Itens de entrada (no modo por item, `$input.item` é o item atual) |
| `items` | Atalho para `$input.all()` (modo uma vez) |
| `$json`, `$binary`, `$itemIndex`, `item` | Item atual (modo por item) |
| `$('Nó').all()`, `.first()`, `.last()`, `.item`, `.itemMatching(i)`, `.params` | Dados de outro nó, como nas expressões |
| `$vars`, `$env`, `$execution`, `$workflow`, `$now`, `$today` | Como nas [expressões](../expressoes.md) |
| `DateTime` | Luxon |
| `_` | lodash |
| `console.log/info/warn/error/debug` | Saída exibida na seção **Console** do painel (até 500 linhas) |

## Retorno

O retorno do código vira itens:

| Retorno | Itens |
|---|---|
| Objeto | Um item com o objeto em `json` |
| Array de objetos | Um item por objeto |
| Array de `{ json, binary? }` | Mantido |
| Outro tipo, ou nada | Erro "O código deve retornar um objeto ou array de objetos" |

No modo por item, cada execução deve retornar **um** objeto. Cada item resultante fica ligado ao item de origem (`pairedItem`).

Alterar os itens recebidos e devolvê-los também funciona:

```js
for (const item of $input.all()) item.json.total = item.json.q * item.json.p;
return $input.all();
```

## Segurança e limites

- Roda no task runner, num **isolate novo a cada execução do nó** (isolated-vm): sem `require`, `import`, `process`, rede (`fetch`), timers nem sistema de arquivos.
- **Limites:** `OLLY_CODE_TIMEOUT_MS` (padrão 30 000 ms) e `OLLY_CODE_MEMORY_MB` (padrão 128 MB). Laço infinito e alocação excessiva falham com mensagem clara.
- Se o processo do runner cair, o nó falha ("O sandbox de código foi interrompido e reiniciado") e o runner reinicia sozinho.

## Editor

O editor Monaco tem destaque de sintaxe e autocomplete das variáveis acima. Em `$('`, o Ctrl+Espaço sugere os nomes dos nós do workflow. A saída do `console` aparece abaixo da saída do nó.

## Divergências do N8N

- Sem `fetch`/`$http` nem módulos externos (fora do escopo; ADR-0001).
- Sem `$getWorkflowStaticData`, `$evaluateExpression` e helpers do N8N fora da lista acima.

Introduzido na [spec 005](../../specs/005-webhook-codigo-js-mvp/spec.md) (FR-009 a FR-012).
