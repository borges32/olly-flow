# Output Parsers (`outputParser.structured`, `outputParser.autoFixing`, `outputParser.itemList`)

Sub-nós que definem o **formato da resposta** do [Agent](ai.agent.md) e do [Basic LLM Chain](ai.chainLlm.md), como os "Output Parsers" do N8N. Para usar um parser:
1. Ligue **"Exigir formato específico"** (`hasOutputParser`) no nó. Aparece a entrada **Output Parser** (`ai_outputParser`), obrigatória e com um parser.
2. Ligue o parser a essa entrada. As instruções de formato do parser vão ao modelo no fim do pedido.
3. A resposta interpretada sai no campo **`output`** do item.

| Tipo | Nó | Equivalente no N8N |
|---|---|---|
| `outputParser.structured` | Structured Output Parser | `outputParserStructured` |
| `outputParser.autoFixing` | Auto-fixing Output Parser | `outputParserAutofixing` |
| `outputParser.itemList` | Item List Output Parser | `outputParserItemList` |

Os três têm a saída `ai_outputParser` e não executam no fluxo principal.

## Structured Output Parser

A resposta é um **objeto JSON**.

| Parâmetro | Padrão | Descrição |
|---|---|---|
| `schemaType` | `fromJson` | `fromJson`: a partir de um exemplo JSON. `manual`: um JSON Schema |
| `jsonSchemaExample` | exemplo do N8N | Exemplo da resposta. O schema é inferido: os tipos vêm dos valores e todos os campos são obrigatórios |
| `inputSchema` | objeto com `resposta` | JSON Schema da resposta (com `manual`) |
| `autoFix` | `false` | Se a resposta não seguir o formato, o **modelo do nó** é chamado para corrigi-la, até 2 vezes. Sem a correção, o item falha com os problemas encontrados |

Exemplo ou schema inválido faz o item falhar citando o parâmetro.

## Auto-fixing Output Parser

Envolve outro parser. Se o parser interno recusar a resposta, o **modelo ligado ao Auto-fixing** recebe a resposta, o erro e as instruções, e devolve a versão corrigida. Essa versão passa de novo pelo parser interno, numa única tentativa (como no N8N).

| Item | Valor |
|---|---|
| Entradas | `ai_languageModel` (o modelo da correção; obrigatória, 1) e `ai_outputParser` (o parser interno; obrigatória, 1) |
| `options.prompt` | Prompt da correção, com `{instructions}`, `{completion}` e `{error}`. O padrão é o do N8N, em português |

Use um modelo mais barato só para a correção. A chamada conta no uso, no custo e no limite mensal, e aparece nos passos do nó, com o modelo do Auto-fixing e a marca `fixer`.

## Item List Output Parser

A resposta vira uma **lista de textos**.

| Parâmetro | Padrão | Descrição |
|---|---|---|
| `options.numberOfItems` | -1 | Máximo de itens (-1: sem limite) |
| `options.separator` | `\n` | Separador dos itens (digite `\n` para a quebra de linha) |

Itens vazios e marcadores de lista (`1.`, `-`, `*`) são removidos. Uma resposta sem itens vira uma lista vazia.

## Exemplo (trecho do JSON do workflow)

```json
"nodes": [
  { "name": "Classificar", "type": "ai.chainLlm", "parameters": { "promptSource": "define", "text": "={{ $json.descricao }}", "hasOutputParser": true } },
  { "name": "Formato", "type": "outputParser.structured", "parameters": { "schemaType": "fromJson", "jsonSchemaExample": "{\"categoria\": \"rede\"}" } }
],
"connections": {
  "Formato": { "ai_outputParser": [[{ "node": "Classificar", "type": "ai_outputParser", "index": 0 }]] }
}
```

## Formato antigo (JSON Schema dentro do nó)

Até a spec 017, o Agent e o Basic LLM Chain tinham `outputParser: "jsonSchema"` e `schema` nos parâmetros. Workflows salvos e arquivos nesse formato são **migrados automaticamente**: na leitura, no salvamento, na execução e na importação, o nó recebe `hasOutputParser: true` e um Structured Output Parser ligado a ele, com o mesmo schema e `autoFix: true`. As versões publicadas executam com o mesmo resultado.

Introduzido na [spec 018](../../specs/018-output-parsers/spec.md).
