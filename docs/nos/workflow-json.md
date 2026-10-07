# Formato JSON do workflow

Referência do arquivo JSON de um workflow do Olly Flow: o que se baixa, o que se importa e o que vai para a área de transferência ao copiar nós. Público: pessoas que leem ou editam o arquivo e **modelos de IA que geram workflows** a partir de uma descrição em linguagem natural. Este documento é autossuficiente: com ele, um modelo consegue montar um workflow importável sem acesso ao código.

> **Situação:** formato definido pela [spec 015](../../specs/015-exportar-importar-json/spec.md) (Rascunho). Baixar, importar e colar JSON ainda **não estão disponíveis** na plataforma. Os tipos de nó, as portas e os parâmetros descritos aqui são os da plataforma atual. Os pontos em aberto da spec que afetam o formato estão marcados com **(proposta)**.

**Como usar com um modelo de IA:** envie este documento como contexto e peça, por exemplo: "Gere o JSON de um workflow do Olly Flow que recebe um POST em `/pedidos`, grava no PostgreSQL e responde com o id gravado. Responda só com o JSON." O resultado é importado em **Workflows › Importar**.

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Envelope](#2-envelope)
3. [Nó](#3-nó)
4. [Conexões](#4-conexões)
5. [Parâmetros e expressões](#5-parâmetros-e-expressões)
6. [Credenciais](#6-credenciais)
7. [Dados fixados](#7-dados-fixados)
8. [Configurações do workflow](#8-configurações-do-workflow)
9. [Catálogo de nós](#9-catálogo-de-nós)
10. [Regras de validação](#10-regras-de-validação)
11. [Lista de verificação para gerar um workflow](#11-lista-de-verificação-para-gerar-um-workflow)
12. [Exemplos completos](#12-exemplos-completos)
13. [Diferenças em relação ao N8N](#13-diferenças-em-relação-ao-n8n)

## 1. Visão geral

O arquivo tem a mesma estrutura do JSON de workflow do N8N: uma lista de **nós** e um objeto de **conexões** indexado pelo **nome** do nó de origem. Mudam os **tipos** e os **parâmetros** dos nós, que são os do Olly Flow ([seção 9](#9-catálogo-de-nós)).

Exemplo mínimo: um gatilho manual ligado a um nó que define um campo.

```json
{
  "name": "Olá mundo",
  "nodes": [
    {
      "id": "8b808aa1-015c-48e1-8e7e-70ba1ca9d7c3",
      "name": "Início",
      "type": "trigger.manual",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "id": "adb334cb-ef98-4fe8-82a4-2d9069eb526d",
      "name": "Saudação",
      "type": "data.set",
      "typeVersion": 1,
      "position": [260, 0],
      "parameters": {
        "fields": [{ "name": "mensagem", "type": "string", "value": "Olá, mundo!" }],
        "includeOtherFields": false
      }
    }
  ],
  "connections": {
    "Início": {
      "main": [[{ "node": "Saudação", "type": "main", "index": 0 }]]
    }
  },
  "pinData": {},
  "settings": {},
  "meta": { "ollyFlow": { "formatVersion": 1 } },
  "tags": [],
  "active": false
}
```

Termos usados neste documento:

- **Item:** a unidade de dado que trafega entre os nós, `{ "json": { ... }, "binary": { ... } }`. Cada nó recebe uma lista de itens e devolve listas de itens nas suas saídas. É o mesmo modelo do N8N.
- **Porta:** uma entrada ou saída de um nó. As portas têm um **tipo de conexão**: `main` (fluxo de itens) ou um tipo de sub-nó (`ai_languageModel`, `ai_memory`, `ai_tool`).
- **Sub-nó:** um nó que não processa itens. Ele fornece um recurso (modelo, memória ou ferramenta) ao nó **Agent** e se liga às entradas de mesmo tipo do Agent.

## 2. Envelope

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `name` | texto | não | Nome do workflow. Na importação, é o nome sugerido (o usuário pode trocar). Padrão: o nome do arquivo |
| `nodes` | lista | **sim** | Os nós ([seção 3](#3-nó)). Pode ser vazia |
| `connections` | objeto | **sim** | As conexões ([seção 4](#4-conexões)). Use `{}` sem conexões |
| `pinData` | objeto | não | Dados fixados por **nome** do nó ([seção 7](#7-dados-fixados)) |
| `settings` | objeto | não | Configurações do workflow ([seção 8](#8-configurações-do-workflow)) |
| `meta` | objeto | não | Metadados. `meta.ollyFlow.formatVersion` é a versão do formato (atual: `1`). Sem ela, a importação assume `1` |
| `tags` | lista | não | Etiquetas do N8N. O Olly Flow ainda não tem etiquetas: a exportação grava `[]` e a importação ignora |
| `active` | booleano | não | Se o workflow estava publicado na origem. A importação **sempre** cria um rascunho não publicado |
| `id` | texto | não | Id do workflow de origem. Ignorado na importação (o workflow recebe um id novo) |

Na exportação, `meta.ollyFlow` traz também `exportedAt` (data e hora ISO 8601) e `workflowVersion` (versão do rascunho exportado). Ambos são informativos e ignorados na importação.

Para **copiar e colar**, o JSON pode ter só `nodes` e `connections` (e, opcionalmente, `pinData`).

## 3. Nó

### 3.1 Campos

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | texto | não | Identificador do nó, único no workflow (a exportação usa UUID). Sem ele, a importação gera um |
| `name` | texto | **sim** | Nome **único** no workflow. É por ele que as conexões, os dados fixados e as expressões (`$('Nome')`) se referem ao nó. Use nomes curtos e descritivos, em português |
| `type` | texto | **sim** | Tipo do nó ([seção 9](#9-catálogo-de-nós)), por exemplo `http.request` |
| `typeVersion` | número | não | Versão do tipo. Todos os tipos atuais estão na versão `1`. Sem ela, vale a versão instalada |
| `position` | `[x, y]` | não | Posição no canvas, em pixels (x cresce para a direita, y para baixo). Sem ela, a importação posiciona os nós automaticamente. Sugestão: 260 px entre nós em sequência e 160 px entre ramos |
| `parameters` | objeto | não | Parâmetros do tipo ([seção 5](#5-parâmetros-e-expressões)). Os omitidos recebem o valor padrão do tipo na importação |
| `credentials` | objeto | não | Credencial do nó ([seção 6](#6-credenciais)) |
| `disabled` | booleano | não | Nó desabilitado: repassa a primeira entrada para a primeira saída, sem executar. Padrão `false` |
| `onError` | texto | não | Tratamento de erro ([3.2](#32-tratamento-de-erro-e-novas-tentativas)) |
| `retryOnFail` | booleano | não | Tenta de novo após uma falha ([3.2](#32-tratamento-de-erro-e-novas-tentativas)) |
| `maxTries` | número | não | Total de tentativas, de 1 a 10. Vale com `retryOnFail: true`. Padrão 3 |
| `waitBetweenTries` | número | não | Espera entre as tentativas, de 0 a 60 000 ms. Padrão 1000 |
| `ollyFlow` | objeto | não | Configurações sem equivalente no N8N ([3.3](#33-extensões-do-olly-flow-ollyflow)) |

### 3.2 Tratamento de erro e novas tentativas

| `onError` | Efeito |
|---|---|
| `stopWorkflow` (padrão) | A falha do nó falha a execução |
| `continueRegularOutput` | O nó emite `{ "json": { "error": { "message": "..." } } }` pela saída normal e o fluxo segue |
| `continueErrorOutput` | O nó ganha uma **saída de erro**, sempre a última ([4.5](#45-saída-de-erro)). Os itens que falharam seguem por ela, com o campo `error` |

Nos nós que processam item a item (`data.set`, `http.request`, `postgres.query`, `postgres.write`), só os itens que falharam vão para o erro. Nos demais, uma falha desvia todos os itens de entrada.

`retryOnFail: true` executa o nó de novo após uma falha, até `maxTries` tentativas, esperando `waitBetweenTries` ms entre elas.

### 3.3 Extensões do Olly Flow (`ollyFlow`)

| Campo | Tipo | Descrição |
|---|---|---|
| `ollyFlow.retryBackoff` | `fixed` \| `exponential` | Espera entre as tentativas. `exponential` dobra a espera a cada tentativa. Padrão `fixed` |
| `ollyFlow.timeoutMs` | número | Aborta o nó depois desse tempo (ms) |
| `ollyFlow.parallelItems` | `{ "enabled": booleano, "concurrency": número }` | Processa os itens em paralelo, com a concorrência indicada. Só nos tipos `http.request`, `postgres.query` (modo `perItem`) e `postgres.write` |

## 4. Conexões

### 4.1 Estrutura

```json
"connections": {
  "<nome do nó de origem>": {
    "<tipo de conexão>": [
      [ { "node": "<nome do destino>", "type": "<tipo de conexão>", "index": <índice da entrada> } ],
      [ ... destinos da saída 1 ... ]
    ]
  }
}
```

- A chave de primeiro nível é o **nome** do nó de origem, não o id.
- A chave de segundo nível é o **tipo de conexão**: `main` para o fluxo de itens; `ai_languageModel`, `ai_memory` ou `ai_tool` para os sub-nós.
- A lista externa é indexada pelo **número da saída** da origem, contado entre as saídas daquele tipo. A posição 0 é a primeira saída.
- Cada posição tem a lista de **destinos** daquela saída. Uma saída pode ir para vários nós. Uma saída sem destino é `[]`, e as saídas finais sem destino podem ser omitidas.
- Em cada destino:
  - `node` é o nome do nó de destino;
  - `type` é o tipo de conexão (o mesmo da chave);
  - `index` é o número da **entrada** do destino, contado entre as entradas daquele tipo.
- Uma conexão só liga portas do **mesmo tipo**.

### 4.2 Índices das portas

As portas são numeradas na ordem abaixo, separadamente para entradas e saídas e para cada tipo de conexão.

| Tipo | Entradas (`main`) | Saídas (`main`) |
|---|---|---|
| `trigger.manual`, `trigger.webhook`, `trigger.error`, `trigger.executeWorkflow` | nenhuma | 0 |
| `data.set`, `data.setVariable`, `code.javascript`, `http.request`, `http.respondToWebhook`, `postgres.query`, `postgres.write`, `ai.mcpClient`, `flow.wait`, `flow.executeWorkflow` | 0 | 0 |
| `logic.if` | 0 | 0 = verdadeiro, 1 = falso |
| `logic.switch` (modo `rules`) | 0 | uma por regra, na ordem de `rules` (0, 1, 2...); com `options.fallbackOutput: "extra"`, a saída **Padrão** vem depois da última regra |
| `logic.switch` (modo `expression`) | 0 | de 0 até `numberOutputs - 1` |
| `logic.merge` | de 0 até `numberInputs - 1` (entrada 1 = índice 0) | 0 |
| `logic.while` | 0 = entrada, 1 = continuar (retorno do laço) | 0 = laço (corpo), 1 = concluído |
| `logic.loopOverItems` | 0 = entrada, 1 = continuar (retorno do laço) | 0 = concluído, 1 = lote (corpo) |
| `ai.agent` | 0 | 0 |

**Sub-nós e entradas do Agent:**

| Tipo | Saída | Entrada do Agent |
|---|---|---|
| `ai.chatModel` | `ai_languageModel` 0 | `ai_languageModel` 0: **obrigatória**, exatamente 1 modelo |
| `memory.postgres`, `memory.buffer` | `ai_memory` 0 | `ai_memory` 0: opcional, no máximo 1 memória |
| `tool.mcp`, `tool.httpRequest`, `tool.postgresQuery`, `tool.workflow`, `tool.code` | `ai_tool` 0 | `ai_tool` 0: opcional, quantas ferramentas forem necessárias |

**Saída de erro:** com `onError: "continueErrorOutput"`, qualquer nó com saída `main` ganha mais uma saída, depois de todas as outras. Exemplos: `http.request` 1, `logic.if` 2, Switch com 3 regras e saída Padrão 4.

### 4.3 Sub-nós (Agent)

A conexão parte do **sub-nó** e chega ao **Agent**, com o tipo do sub-nó:

```json
"connections": {
  "Modelo": {
    "ai_languageModel": [[{ "node": "Agente", "type": "ai_languageModel", "index": 0 }]]
  },
  "Consultar CEP": {
    "ai_tool": [[{ "node": "Agente", "type": "ai_tool", "index": 0 }]]
  },
  "Memória": {
    "ai_memory": [[{ "node": "Agente", "type": "ai_memory", "index": 0 }]]
  }
}
```

Todas as ferramentas usam `"index": 0`: há uma única entrada `ai_tool`, que aceita várias conexões. Os sub-nós não recebem conexões `main` e não entram no fluxo principal. As expressões nos parâmetros de um sub-nó usam os itens que chegam ao Agent (por exemplo, `$json.sessionId`).

### 4.4 Laços

Um ciclo só é permitido através de um nó de laço (`logic.while` ou `logic.loopOverItems`), e o retorno tem de chegar à entrada **continuar** (`index: 1`). A saída do corpo leva aos nós que processam cada volta, e o último deles se liga de volta ao nó de laço.

```json
"Loop": {
  "main": [
    [{ "node": "Resumo", "type": "main", "index": 0 }],
    [{ "node": "Enviar lote", "type": "main", "index": 0 }]
  ]
},
"Enviar lote": {
  "main": [[{ "node": "Loop", "type": "main", "index": 1 }]]
}
```

Neste exemplo de `logic.loopOverItems`, a saída 0 (concluído) vai para "Resumo" e a saída 1 (lote) vai para "Enviar lote", que volta pela entrada 1 (continuar). No `logic.while`, as saídas são invertidas: 0 = laço e 1 = concluído.

### 4.5 Saída de erro

```json
{
  "name": "Chamar API",
  "type": "http.request",
  "onError": "continueErrorOutput",
  "parameters": { "url": "https://api.exemplo.gov.br/status" }
}
```

```json
"Chamar API": {
  "main": [
    [{ "node": "Tratar resposta", "type": "main", "index": 0 }],
    [{ "node": "Registrar falha", "type": "main", "index": 0 }]
  ]
}
```

Sem `onError: "continueErrorOutput"`, uma conexão na saída de erro é um erro de validação.

## 5. Parâmetros e expressões

`parameters` segue o schema de cada tipo ([seção 9](#9-catálogo-de-nós)). Regras gerais:

- **Omitidos:** recebem o valor padrão do tipo. Mesmo assim, prefira escrever explicitamente os parâmetros que definem o comportamento (modo, operação, método).
- **Listas** (`array`) são listas de objetos, por exemplo `"headers": [{ "name": "Accept", "value": "application/json" }]`.
- **Desconhecidos:** parâmetros que não existem no tipo são ignorados. Não invente parâmetros.
- **Números** têm faixa validada (por exemplo, `numberInputs` do Merge vai de 2 a 10).

### Expressões

Um parâmetro **texto** que começa com `=` é uma expressão. Dentro dele, os trechos `{{ ... }}` são JavaScript. A sintaxe é a mesma do N8N:

| Forma | Resultado |
|---|---|
| `"={{ $json.idade }}"` | Um único trecho: o valor com o tipo original (número, objeto...) |
| `"=Olá, {{ $json.nome }}!"` | Template misto: sempre texto |
| `"Olá"` | Sem `=`: texto literal, nada é avaliado |

| Variável | O que é |
|---|---|
| `$json` | Campos do item atual |
| `$binary` | Binários do item atual |
| `$itemIndex` | Índice do item atual |
| `$input.all()`, `$input.first()`, `$input.last()`, `$input.item` | Itens de entrada do nó |
| `$('Nome do nó').item.json` | Item correspondente de um nó anterior (segue a origem dos itens, mesmo depois de um If) |
| `$('Nome do nó').all()`, `.first()`, `.last()` | Itens da saída de um nó anterior. Aceitam o índice da saída: `$('Se').all(1)` são os itens da saída falso |
| `$node["Nome do nó"].json` | Sintaxe legada do N8N (item de mesmo índice) |
| `$vars.nome` | Variável gravada pelo nó `data.setVariable` |
| `$env.NOME` | Variável de ambiente exposta (`OLLY_EXPOSED_NOME` no servidor) |
| `$execution.id`, `$execution.mode` | Execução atual (`test` ou `production`) |
| `$workflow.id`, `$workflow.name` | Workflow atual |
| `$now`, `$today` | Data e hora (Luxon `DateTime`), no fuso da plataforma |
| `$loop.index` | Dentro de um laço, o número da volta (começa em 0) |

**Campos sem expressão:** os parâmetros marcados com "sem expressão" no catálogo não aceitam valor iniciado por `=`. Exemplos: o SQL do `postgres.query`, o caminho do webhook e os códigos JavaScript.

**`$fromAI`:** só nas ferramentas `tool.httpRequest` e `tool.postgresQuery`. `"={{ $fromAI('chave', 'descrição', 'tipo', padrão) }}"` marca um valor que o **modelo de IA** preenche quando chama a ferramenta. O tipo pode ser `string` (padrão), `number`, `boolean` ou `json`. Um argumento com valor padrão é opcional para o modelo. A chave aceita letras, números, `_` e `-`, com até 64 caracteres.

Guia completo: [docs/expressoes.md](../expressoes.md).

## 6. Credenciais

As credenciais **nunca** estão no arquivo. Um nó só as **referencia**, no formato do N8N: a chave é o **tipo** da credencial e o valor traz o id e o nome.

```json
"credentials": {
  "httpBearer": { "id": "3f1c9a52-6a6b-4b7e-9d0e-1c2b3a4d5e6f", "name": "API de pedidos" }
}
```

Na importação, a credencial é procurada no projeto de destino: primeiro pelo id (do mesmo tipo), depois pelo nome e tipo. Sem correspondência única, o nó fica sem credencial e a pendência aparece na prévia. **Um modelo de IA** que não conhece as credenciais da instalação deve usar um nome descritivo (por exemplo, `"name": "Banco de pedidos"`) e omitir o `id`. O usuário escolhe a credencial depois de importar.

| Tipo de credencial | Nós que aceitam | Observação |
|---|---|---|
| `httpBearer` | `http.request`, `tool.httpRequest` | Token Bearer. Requer `authentication: "credential"` |
| `httpBasic` | idem | Usuário e senha |
| `httpHeaderAuth` | idem | Cabeçalho com nome e valor |
| `httpQueryAuth` | idem | Parâmetro de query com nome e valor |
| `oauth2ClientCredentials` | idem | OAuth2 com client credentials |
| `postgres` | `postgres.query`, `postgres.write`, `tool.postgresQuery` | Conexão PostgreSQL. **Obrigatória** |
| `webhookHeaderAuth` | `trigger.webhook` | Com `authentication: "headerAuth"` |
| `webhookBasicAuth` | `trigger.webhook` | Com `authentication: "basicAuth"` |
| `webhookHmac` | `trigger.webhook` | Com `authentication: "hmac"` |
| `mcpBearer`, `mcpHeaders`, `mcpOAuth` | `ai.mcpClient` | Quando o servidor MCP exige autenticação |
| `openAiCompatible`, `anthropic`, `googleGemini` | `ai.chatModel` | Provedor do modelo. **Obrigatória** |

Cada nó tem no máximo uma credencial.

## 7. Dados fixados

`pinData` guarda, por **nome** do nó, itens fixos que o nó emite na primeira saída sem executar (útil para testar sem chamar APIs reais):

```json
"pinData": {
  "Buscar pedidos": [{ "json": { "id": 1, "valor": 1500 } }]
}
```

**(proposta)** A exportação não inclui os dados fixados, a menos que o usuário escolha "Incluir dados fixados", porque podem conter dados pessoais (LGPD). A importação aceita `pinData` normalmente.

## 8. Configurações do workflow

| Campo de `settings` | Tipo | Descrição |
|---|---|---|
| `executionTimeout` | número | Tempo máximo da execução, em segundos. Sem o campo, não há limite próprio do workflow |
| `errorWorkflow` | texto | Id do workflow de erro, que começa com `trigger.error` e é chamado quando uma execução de produção falha |
| `saveDataSuccessExecution` | `all` \| `none` | Guarda os dados das execuções com sucesso |
| `saveDataErrorExecution` | `all` \| `none` | Guarda os dados das execuções com erro |
| `ollyFlow.maxParallel` | número | Quantos ramos independentes executam ao mesmo tempo (padrão 8) |

Os dois campos `saveData*` correspondem à opção de dados de execução do Olly Flow: ambos `all` = guardar tudo; sucesso `none` e erro `all` = só erros; ambos `none` = não guardar. A combinação sucesso `all` com erro `none` não existe no Olly Flow e é importada como "guardar tudo", com um aviso.

## 9. Catálogo de nós

Notação das tabelas:
- **Padrão:** o valor usado quando o parâmetro é omitido.
- **Sem expressão:** o parâmetro não aceita valor iniciado por `=`.
- **Visível com:** o parâmetro só vale com outro parâmetro em determinado valor.

Os detalhes de comportamento de cada tipo estão na página do nó ([README](README.md)).

### Gatilhos

Todo workflow executável começa por um gatilho, que não tem entradas. Um workflow pode ter mais de um gatilho.

#### `trigger.manual` — Gatilho manual

Inicia o workflow pelo botão "Executar workflow" do editor, com um item vazio. Sem parâmetros (`"parameters": {}`).

#### `trigger.webhook` — Webhook

Inicia o workflow quando a URL `<origem>/webhook/<path>` recebe uma chamada (depois de publicado). Cada item emitido tem a forma `{ "headers": {...}, "params": {...}, "query": {...}, "body": ... }`: um corpo JSON chega como objeto.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `httpMethod` | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` \| `HEAD` | `POST` | Método aceito |
| `path` | texto | — | **Obrigatório**, sem expressão. Sem barras nas pontas (`pedidos`, `clientes/:id`, em que `:id` vira `params.id`). Aceita letras, números, `.`, `_`, `~` e `-`. Único entre os workflows publicados |
| `authentication` | `none` \| `headerAuth` \| `basicAuth` \| `hmac` | `none` | Exige a credencial correspondente ([seção 6](#6-credenciais)) |
| `responseMode` | `onReceived` \| `lastNode` \| `responseNode` | `onReceived` | `onReceived`: responde 200 na hora. `lastNode`: responde com a saída do último nó. `responseNode`: quem responde é o nó `http.respondToWebhook` |
| `options.allowedOrigins` | texto | `""` | Origens de CORS permitidas, separadas por vírgula |
| `options.ipAllowlist` | texto | `""` | IPs ou faixas permitidas, separados por vírgula |

#### `trigger.executeWorkflow` — Quando chamado por outro workflow

Inicia o workflow quando outro o chama como sub-workflow (`flow.executeWorkflow` ou `tool.workflow`). Emite os itens recebidos.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `inputSchema` | texto (JSON Schema) | `""` | Sem expressão. Opcional: valida cada item recebido. Quando o workflow é ferramenta de um agente, descreve os argumentos |

#### `trigger.error` — Gatilho de erro

Inicia este workflow quando falha uma execução de produção de outro workflow que o indique em `settings.errorWorkflow`. Sem parâmetros.

### Dados

#### `data.set` — Definir campos

Define ou altera campos em cada item.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `fields` | lista de `{ name, type, value }` | `[]` | `name` aceita notação de ponto (`cliente.nome`). `type` é `string`, `number`, `boolean` ou `json`. `value` é texto ou expressão, convertido para o tipo |
| `includeOtherFields` | booleano | `false` | `true` mantém os demais campos do item. `false` faz a saída ter só os campos definidos |

```json
"parameters": {
  "fields": [
    { "name": "total", "type": "number", "value": "={{ $json.preco * $json.quantidade }}" },
    { "name": "cliente.nome", "type": "string", "value": "={{ $json.nome }}" }
  ],
  "includeOtherFields": true
}
```

#### `data.setVariable` — Definir variável

Grava variáveis da execução, lidas depois em `$vars.<nome>`. Repassa os itens sem alteração.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `variables` | lista de `{ name, value }` | `[]` | `value` é texto ou expressão |

### Lógica

#### `logic.if` — Se (If)

Envia cada item para a saída 0 (verdadeiro) ou 1 (falso).

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `conditions.combinator` | `and` \| `or` | `and` | Todas as condições, ou pelo menos uma. Sem condições, todos os itens vão para verdadeiro |
| `conditions.conditions` | lista de `{ leftValue, operator: { type, operation }, rightValue }` | `[]` | Ver as operações abaixo |
| `looseTypeValidation` | booleano | `false` | Converte os tipos (`"18"` vira 18). Sem ela, uma expressão com o tipo errado é erro |

| `operator.type` | `operator.operation` |
|---|---|
| `string` | `equals`, `notEquals`, `contains`, `notContains`, `startsWith`, `endsWith`, `regex`, `isEmpty`, `isNotEmpty` |
| `number` | `equals`, `notEquals`, `gt`, `gte`, `lt`, `lte`, `isEmpty`, `isNotEmpty` |
| `boolean` | `true`, `false`, `equals` |
| `dateTime` | `equals`, `after`, `before` (texto ISO 8601) |
| `array` | `contains`, `lengthEquals`, `isEmpty`, `isNotEmpty` |
| `object` | `isEmpty`, `isNotEmpty` |

`leftValue` normalmente é uma expressão (`"={{ $json.valor }}"`). `rightValue` é texto (convertido para o tipo) ou expressão. Nas operações sem segundo valor (`isEmpty`, `true`...), use `""`.

```json
"parameters": {
  "conditions": {
    "combinator": "and",
    "conditions": [
      { "leftValue": "={{ $json.valor }}", "operator": { "type": "number", "operation": "gt" }, "rightValue": "1000" }
    ]
  },
  "looseTypeValidation": false
}
```

#### `logic.switch` — Roteador (Switch)

Envia cada item para a saída da primeira regra verdadeira, ou de todas as verdadeiras.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `mode` | `rules` \| `expression` | `rules` | Sem expressão |
| `rules` | lista de `{ conditions, outputKey }` | uma regra vazia | Visível com `mode: rules`. `conditions` tem o formato do If. `outputKey` é o rótulo da saída. A regra i sai pela saída i |
| `looseTypeValidation` | booleano | `false` | Visível com `mode: rules` |
| `options.fallbackOutput` | `none` \| `extra` \| número | `none` | Itens sem regra verdadeira: `none` descarta; `extra` cria a saída Padrão, depois da última regra; um número envia para essa saída |
| `options.allMatchingOutputs` | booleano | `false` | Envia o item para todas as regras verdadeiras |
| `numberOutputs` | inteiro (1–20) | 4 | Visível com `mode: expression`. Sem expressão |
| `output` | texto (expressão) | `={{ 0 }}` | Visível com `mode: expression`. Devolve o índice da saída de cada item |

#### `logic.merge` — Juntar (Merge)

Combina os itens de vários ramos. As entradas vão de 0 a `numberInputs - 1`.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `mode` | `append` \| `combineByPosition` \| `combineByFields` \| `chooseBranch` \| `waitAll` | `append` | `append`: concatena as entradas em ordem. `combineByPosition`: junta os campos pela posição. `combineByFields`: join por campo (só com 2 entradas). `chooseBranch`: emite uma entrada. `waitAll`: espera todas e emite a entrada 1 |
| `numberInputs` | inteiro (2–10) | 2 | Sem expressão. Quantidade de entradas |
| `includeUnpaired` | booleano | `false` | Visível com `combineByPosition`: inclui os itens sem par |
| `fields` | lista de `{ input1Field, input2Field }` | um par vazio | Visível com `combineByFields`: campos da junção |
| `joinMode` | `inner` \| `left` \| `outer` \| `keepNonMatches` | `inner` | Visível com `combineByFields` |
| `output` | `input` \| `empty` | `input` | Visível com `chooseBranch` |
| `chosenInput` | inteiro | 1 | Visível com `chooseBranch` e `output: input`. Número da entrada, começando em 1 |
| `clashHandling` | `preferInput1` \| `preferLast` \| `addSuffix` | `preferLast` | Visível com `combineByPosition` e `combineByFields`: campos repetidos |
| `waitFor` | `allConnected` \| `anyWithData` | `allConnected` | `allConnected`: as entradas sem dados entram como lista vazia. `anyWithData`: usa só as entradas com dados. Para juntar os dois ramos de um If, use `anyWithData` |

O Merge executa uma vez, depois que todas as entradas conectadas terminam.

#### `logic.while` — Enquanto (While)

Repete o corpo enquanto a condição for verdadeira. A saída 0 (laço) vai para o corpo, e o último nó do corpo volta para a entrada 1 (continuar). A saída 1 (concluído) segue o fluxo.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `condition` | texto (expressão) | `={{ $loop.index < 3 }}` | **Obrigatório.** Avaliada antes de cada volta |
| `maxIterations` | inteiro | 100 | Limite de voltas. Ao passar dele, a execução falha |
| `accumulate` | `none` \| `appendBodyOutput` | `none` | `appendBodyOutput`: a saída concluído recebe a saída de todas as voltas |

#### `logic.loopOverItems` — Loop em lotes

Envia os itens em lotes pela saída 1 (lote). Cada lote volta pela entrada 1 (continuar). No fim, a saída 0 (concluído) recebe todos os itens que voltaram.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `batchSize` | inteiro | 10 | Tamanho do lote |

### Código

#### `code.javascript` — Código (JavaScript)

Executa JavaScript no sandbox, com a mesma API do nó Code do N8N. Não tem `require`, `import`, rede (`fetch`), timers nem sistema de arquivos.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `mode` | `runOnceForAllItems` \| `runOnceForEachItem` | `runOnceForAllItems` | Uma vez para todos os itens (use `$input.all()`), ou uma vez por item (use `$json`) |
| `jsCode` | texto | exemplo | Sem expressão. No modo para todos, devolve uma lista `[{ json: {...} }]`. No modo por item, devolve um objeto `{ json: {...} }` |

```json
"parameters": {
  "mode": "runOnceForAllItems",
  "jsCode": "return $input.all().map((item) => ({ json: { ...item.json, nomeMaiusculo: String(item.json.nome).toUpperCase() } }));"
}
```

### Integrações

#### `http.request` — Requisição HTTP

Chama uma API HTTP para cada item. Bloqueia endereços internos (anti-SSRF), a menos que o servidor os libere.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `method` | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` \| `HEAD` \| `OPTIONS` | `GET` | |
| `url` | texto | — | **Obrigatório** |
| `authentication` | `none` \| `credential` | `none` | `credential` usa a credencial do nó |
| `queryParameters` | lista de `{ name, value }` | `[]` | |
| `headers` | lista de `{ name, value }` | `[]` | |
| `sendBody` | booleano | `false` | |
| `contentType` | `json` \| `form-urlencoded` \| `multipart` \| `raw` \| `binary` | `json` | Visível com `sendBody: true` |
| `jsonBody` | texto | `{}` | Visível com `contentType: json`. Texto JSON ou expressão que produz um objeto |
| `bodyParameters` | lista de `{ name, value, parameterType }` | `[]` | Visível com `form-urlencoded` e `multipart`. `parameterType` é `text` ou `binary` |
| `rawBody` / `rawContentType` | texto | `""` / `text/plain` | Visíveis com `contentType: raw` |
| `inputBinaryField` | texto | `data` | Visível com `contentType: binary` |
| `options.timeout` | inteiro (ms) | 30 000 | |
| `options.followRedirects` / `options.maxRedirects` | booleano / inteiro | `true` / 5 | |
| `options.fullResponse` | booleano | `false` | Inclui o status e os cabeçalhos na saída |
| `options.responseFormat` | `auto` \| `json` \| `text` \| `binary` | `auto` | |
| `options.outputBinaryField` | texto | `data` | Campo binário da resposta |
| `options.neverError` | booleano | `false` | Status 4xx e 5xx viram saída normal |
| `options.batchSize` / `options.batchIntervalMs` | inteiros | 1 / 0 | Requisições simultâneas por lote e intervalo entre lotes |

```json
"parameters": {
  "method": "POST",
  "url": "https://api.exemplo.gov.br/pedidos",
  "authentication": "credential",
  "sendBody": true,
  "contentType": "json",
  "jsonBody": "={{ JSON.stringify({ cliente: $json.cliente, total: $json.total }) }}",
  "options": { "timeout": 10000 }
}
```

#### `postgres.query` — PostgreSQL: consulta

Executa SQL **parametrizado**. Cada linha do resultado vira um item. Credencial `postgres` obrigatória.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `query` | texto | — | **Obrigatório**, sem expressão. Use `$1`, `$2`... para os valores. Nunca monte SQL com dados do item |
| `queryParameters` | lista de `{ value }` | `[]` | Valores de `$1`, `$2`... na ordem. Aceitam expressão |
| `mode` | `once` \| `perItem` | `once` | `once`: uma consulta (os parâmetros usam o primeiro item). `perItem`: uma consulta por item |
| `options.maxRows` | inteiro | 1000 | |
| `options.statementTimeoutMs` | inteiro | 30 000 | |

```json
"parameters": {
  "query": "SELECT id, nome FROM clientes WHERE cidade = $1 AND ativo = $2",
  "queryParameters": [{ "value": "={{ $json.cidade }}" }, { "value": "true" }],
  "mode": "perItem"
}
```

#### `postgres.write` — PostgreSQL: gravar

Insere, atualiza ou faz upsert de registros a partir dos itens. Credencial `postgres` obrigatória.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `operation` | `insert` \| `update` \| `upsert` | `insert` | **Obrigatório** |
| `schema` | texto | `public` | Sem expressão |
| `table` | texto | — | **Obrigatório**, sem expressão |
| `columns.mappingMode` | `autoMap` \| `defineBelow` | `autoMap` | `autoMap`: os campos do item com nome de coluna. `defineBelow`: a lista `columns.values` |
| `columns.values` | lista de `{ column, value }` | `[]` | Visível com `defineBelow`. `column` é sem expressão; `value` aceita expressão |
| `matchingColumns` | lista de `{ column }` | `[]` | Visível com `update` e `upsert`: colunas que identificam o registro |
| `options.transaction` | `none` \| `allItems` | `none` | `allItems`: todos os itens numa transação |
| `options.batchSize` | inteiro | 100 | |
| `options.returning` | texto | `*` | Colunas devolvidas |
| `options.skipOnConflict` | booleano | `false` | No `insert`, ignora as linhas em conflito |
| `options.statementTimeoutMs` | inteiro | 30 000 | |

#### `http.respondToWebhook` — Responder ao webhook

Envia a resposta da chamada que iniciou o workflow. Exige `trigger.webhook` com `responseMode: "responseNode"`.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `respondWith` | `firstItemJson` \| `allItemsJson` \| `text` \| `noData` \| `binary` | `firstItemJson` | |
| `responseBody` | texto | `""` | Visível com `text` |
| `binaryProperty` | texto | `data` | Visível com `binary` |
| `responseCode` | inteiro | 200 | |
| `responseHeaders` | lista de `{ name, value }` | `[]` | |

#### `ai.mcpClient` — Cliente MCP

Chama tools, lê resources e obtém prompts de um servidor MCP aprovado no catálogo da plataforma.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `serverId` | texto | — | **Obrigatório**, sem expressão. Id do servidor no catálogo (específico de cada instalação; na importação vira pendência se não existir) |
| `operation` | `callTool` \| `listTools` \| `readResource` \| `listResources` \| `getPrompt` \| `listPrompts` | `callTool` | **Obrigatório** |
| `toolName` | texto | `""` | Visível com `callTool`. Sem expressão |
| `argumentsMode` | `form` \| `json` | `form` | Visível com `callTool` |
| `arguments` | objeto | `{}` | Visível com `form`: argumentos da tool (cada valor aceita expressão) |
| `argumentsJson` | texto | `{}` | Visível com `json`: objeto JSON ou expressão |
| `resourceUri` | texto | `""` | Visível com `readResource` |
| `promptName` / `promptArguments` | texto / lista de `{ name, value }` | `""` / `[]` | Visíveis com `getPrompt` |

### Fluxo

#### `flow.wait` — Esperar

Pausa a execução.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `resume` | `timeInterval` \| `specificTime` | `timeInterval` | |
| `amount` / `unit` | número / `seconds` \| `minutes` \| `hours` \| `days` | 1 / `minutes` | Visíveis com `timeInterval` |
| `dateTime` | texto (ISO 8601) | `""` | Visível com `specificTime` |

#### `flow.executeWorkflow` — Executar sub-workflow

Chama outro workflow **publicado** que começa com `trigger.executeWorkflow` e recebe a saída do último nó dele.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `workflowId` | texto | — | **Obrigatório**, sem expressão. Id do workflow chamado (na importação vira pendência se não existir) |
| `mode` | `once` \| `perItem` | `once` | Uma chamada com todos os itens, ou uma por item |
| `waitForCompletion` | booleano | `true` | `false` dispara e segue sem esperar |

### IA

#### `ai.agent` — Agent

Agente de IA que raciocina e usa ferramentas para responder. Precisa de **um** `ai.chatModel` ligado à entrada `ai_languageModel`. Memória e ferramentas são opcionais ([4.3](#43-sub-nós-agent)). A saída tem o campo `output` com a resposta.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `promptSource` | `fromInput` \| `define` | `fromInput` | `fromInput`: o pedido é o campo `chatInput` do item. `define`: o pedido é o parâmetro `text` |
| `text` | texto | `""` | Visível com `define`. Normalmente uma expressão, como `={{ $json.body.pergunta }}` |
| `systemMessage` | texto | `Você é um assistente útil.` | Instruções do agente |
| `maxIterations` | inteiro | 10 | Máximo de ciclos de raciocínio e ferramenta |
| `returnIntermediateSteps` | booleano | `false` | Inclui os passos na saída |
| `outputParser` | `none` \| `jsonSchema` | `none` | `jsonSchema`: a resposta deve seguir `schema` |
| `schema` | texto (JSON Schema) | objeto com `resposta` | Visível com `jsonSchema`. Sem expressão |
| `blockToolCallsAfterUntrustedContent` | booleano | `false` | Depois de ler conteúdo externo, bloqueia as ferramentas com efeito colateral |

#### `ai.chatModel` — Modelo de chat (sub-nó)

Saída `ai_languageModel`. Credencial obrigatória: `openAiCompatible`, `anthropic` ou `googleGemini`.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `model` | texto | — | **Obrigatório**, sem expressão. Nome do modelo, que precisa estar liberado em Administração › IA (por exemplo, `gpt-4o-mini`) |
| `temperature` | número (0–2) | do provedor | Opcional. Nem todo modelo aceita |
| `topP` | número (0–1) | do provedor | Opcional. Nem todo modelo aceita |
| `maxTokens` | inteiro | 0 | 0 = padrão do provedor |
| `timeoutMs` | inteiro | 60 000 | |
| `maxRetries` | inteiro | 2 | |

#### `memory.buffer` e `memory.postgres` — Memória (sub-nós)

Saída `ai_memory`. `memory.buffer` lembra a conversa só durante a execução; `memory.postgres` lembra entre execuções.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `sessionKey` | texto | `={{ $json.sessionId }}` | **Obrigatório.** Identifica a conversa |
| `contextWindowLength` | inteiro | 10 | Quantas mensagens recentes o agente recebe |

#### Ferramentas do agente (sub-nós)

Saída `ai_tool`. Todas, exceto `tool.mcp`, têm estes parâmetros comuns:

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `toolName` | texto | `""` | Sem expressão. Letras, números, `_` e `-`, com até 64 caracteres, único no Agent. Vazio: o nome do nó normalizado |
| `toolDescription` | texto | `""` | **Obrigatório na prática** (a validação recusa vazio). Sem expressão. O que a ferramenta faz e quando usá-la: é por ela que o modelo decide chamar a ferramenta |
| `requireApproval` | booleano | `false` | Cada chamada pausa a execução até uma pessoa aprovar |

- **`tool.httpRequest` — Ferramenta: HTTP:** os parâmetros comuns e os mesmos de `http.request`. Os valores que o modelo decide usam `$fromAI`, por exemplo `"url": "=https://viacep.com.br/ws/{{ $fromAI('cep', 'CEP com 8 dígitos') }}/json/"`. Credenciais como as de `http.request`.
- **`tool.postgresQuery` — Ferramenta: PostgreSQL:** os parâmetros comuns, mais:
  - `query`: SQL fixo, sem expressão e sem `$fromAI`;
  - `queryParameters`: lista de `{ value }` para `$1`, `$2`..., normalmente com `$fromAI`;
  - `options.maxRows` e `options.statementTimeoutMs`.

  Credencial `postgres`. O modelo nunca escreve SQL.
- **`tool.code` — Ferramenta: código:** os parâmetros comuns, mais:
  - `inputSchema`: texto com o JSON Schema dos argumentos que o modelo envia. Descreva cada campo em `description`;
  - `jsCode`: recebe os argumentos em `$input.first().json` e devolve o resultado.
- **`tool.workflow` — Ferramenta: workflow:** os parâmetros comuns, mais `workflowId` (sem expressão): o id de um workflow publicado que começa com `trigger.executeWorkflow`. Os argumentos seguem o `inputSchema` desse gatilho.
- **`tool.mcp` — Ferramenta: MCP:** só tem estes parâmetros:
  - `serverId`: id do servidor no catálogo;
  - `tools`: `allowed` (todas as tools liberadas no projeto) ou `selected`;
  - `toolNames`: lista de `{ name }`, que vale com `selected`.

  Cada tool MCP vira uma ferramenta do agente; as marcadas como destrutivas pedem aprovação.

## 10. Regras de validação

A importação aplica as mesmas regras do salvamento. Os **erros** impedem a importação; os **avisos**, não.

| Código | Tipo | Regra |
|---|---|---|
| `NODE_UNKNOWN_TYPE` | erro | `type` não existe na plataforma |
| `DUPLICATE_NODE_NAME` | erro | Dois nós com o mesmo `name` |
| `DUPLICATE_NODE_ID` | erro | Dois nós com o mesmo `id` |
| `EDGE_UNKNOWN_NODE` | erro | Conexão para um nó que não existe (confira o nome exato, com acentos e maiúsculas) |
| `EDGE_UNKNOWN_PORT` | erro | Índice de saída ou de entrada que o nó não tem (por exemplo, a saída 2 de um If sem saída de erro) |
| `SUBNODE_ON_MAIN` | erro | Conexão entre portas de tipos diferentes (por exemplo, um sub-nó ligado a uma entrada `main`) |
| `AGENT_MODEL_REQUIRED` | erro | Agent sem modelo, ou com mais de um |
| `AGENT_MEMORY_MAX` | erro | Agent com mais de uma memória |
| `TOOL_NAME_INVALID` | erro | Nome de ferramenta com caracteres inválidos |
| `TOOL_NAME_DUPLICATE` | erro | Duas ferramentas com o mesmo nome no mesmo Agent |
| `TOOL_DESCRIPTION_REQUIRED` | erro | Ferramenta sem `toolDescription` |
| `INVALID_CYCLE` | erro | Ciclo que não volta pela entrada continuar (`index: 1`) de um nó de laço |
| `EXPRESSION_NOT_ALLOWED` | erro | Valor iniciado por `=` num parâmetro sem expressão |
| `PARAM_OUT_OF_RANGE` | erro | Número fora da faixa (por exemplo, `numberInputs: 15` no Merge) |
| `ORPHAN_NODE` | aviso | Nó sem nenhuma conexão (num workflow com mais de um nó) |

Além disso, a importação recusa um JSON inválido, a falta de `nodes` ou `connections`, nomes de nó vazios e tipos do N8N (`n8n-nodes-base.*`, `@n8n/*`). Ela lista como **pendências**, sem recusar:
- as credenciais não encontradas;
- os ids de workflow, de servidor MCP e de modelo que não existem no destino;
- o caminho de webhook já usado.

## 11. Lista de verificação para gerar um workflow

1. Comece por um **gatilho**: `trigger.webhook` para chamadas HTTP, `trigger.manual` para testes, `trigger.executeWorkflow` para sub-workflows.
2. Dê a cada nó um `name` **único** e use exatamente esse nome em `connections`, `pinData` e `$('...')`.
3. Use só os **tipos** e **parâmetros** da [seção 9](#9-catálogo-de-nós). Não use tipos do N8N (`n8n-nodes-base.*`).
4. Confira os **índices** das portas na [tabela 4.2](#42-índices-das-portas): If 0/1, Loop em lotes 0 = concluído e 1 = lote, While 0 = laço e 1 = concluído, retorno de laço na entrada 1.
5. Em um **Agent**, ligue exatamente um `ai.chatModel` e escreva uma `toolDescription` clara em cada ferramenta. As conexões partem do sub-nó, com o tipo dele e `index: 0`.
6. Escreva as **expressões** como texto iniciado por `=` (`"={{ $json.campo }}"`). Nunca use expressão em SQL, no caminho do webhook ou em código.
7. **SQL** sempre com `$1`, `$2`... e `queryParameters`, nunca concatenando dados.
8. **Credenciais:** só referência (tipo e um nome descritivo), sem o `id` se você não o conhece. Nunca escreva senhas, tokens ou chaves no JSON.
9. Para responder a um webhook com conteúdo próprio, use `responseMode: "responseNode"` e termine com `http.respondToWebhook`. Para responder com a saída do último nó, use `lastNode`.
10. Para juntar os ramos de um If, use `logic.merge` com `waitFor: "anyWithData"`.
11. Inclua `"meta": { "ollyFlow": { "formatVersion": 1 } }` e posições legíveis (260 px entre nós).

## 12. Exemplos completos

Todos os exemplos abaixo são importáveis sem erros (os credenciais e os ids de outros recursos aparecem como pendências).

### 12.1 Webhook que responde com dados montados

Recebe um POST em `/contatos` com `{ "nome": "Ana" }` e responde `{ "mensagem": "Olá, Ana!", "recebidoEm": "..." }`.

<!-- exemplo-completo -->
```json
{
  "name": "Cadastro de contato",
  "nodes": [
    {
      "id": "ea53e8a6-79f9-4341-800a-58b70a588f03",
      "name": "Webhook",
      "type": "trigger.webhook",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {
        "httpMethod": "POST",
        "path": "contatos",
        "authentication": "none",
        "responseMode": "responseNode",
        "options": {}
      }
    },
    {
      "id": "88f6679e-55a6-485b-a501-6ce21878be9c",
      "name": "Montar resposta",
      "type": "data.set",
      "typeVersion": 1,
      "position": [260, 0],
      "parameters": {
        "fields": [
          { "name": "mensagem", "type": "string", "value": "=Olá, {{ $json.body.nome }}!" },
          { "name": "recebidoEm", "type": "string", "value": "={{ $now.toISO() }}" }
        ],
        "includeOtherFields": false
      }
    },
    {
      "id": "1cc1ad59-2c66-4dcd-b679-6f136f3fbc25",
      "name": "Responder",
      "type": "http.respondToWebhook",
      "typeVersion": 1,
      "position": [520, 0],
      "parameters": {
        "respondWith": "firstItemJson",
        "responseCode": 200,
        "responseHeaders": []
      }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Montar resposta", "type": "main", "index": 0 }]] },
    "Montar resposta": { "main": [[{ "node": "Responder", "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "settings": {},
  "meta": { "ollyFlow": { "formatVersion": 1 } },
  "tags": [],
  "active": false
}
```

### 12.2 HTTP, If com dois ramos, Merge e gravação no PostgreSQL

Busca pedidos numa API, marca a prioridade conforme o valor, junta os ramos e grava na tabela `pedidos`.

<!-- exemplo-completo -->
```json
{
  "name": "Importar pedidos",
  "nodes": [
    {
      "id": "926fa36c-c6d1-4a8d-b075-0fb5fb8e8d32",
      "name": "Início",
      "type": "trigger.manual",
      "typeVersion": 1,
      "position": [0, 80],
      "parameters": {}
    },
    {
      "id": "30d5366b-e9f9-4bec-a6f6-33d144376b99",
      "name": "Buscar pedidos",
      "type": "http.request",
      "typeVersion": 1,
      "position": [260, 80],
      "parameters": {
        "method": "GET",
        "url": "https://api.exemplo.gov.br/pedidos",
        "authentication": "credential",
        "queryParameters": [{ "name": "status", "value": "novo" }],
        "options": { "timeout": 15000 }
      },
      "credentials": { "httpBearer": { "name": "API de pedidos" } },
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 2000
    },
    {
      "id": "cbe96dc0-4f63-4f3b-b7ff-21a0d9ee69b6",
      "name": "Valor alto?",
      "type": "logic.if",
      "typeVersion": 1,
      "position": [520, 80],
      "parameters": {
        "conditions": {
          "combinator": "and",
          "conditions": [
            {
              "leftValue": "={{ $json.valor }}",
              "operator": { "type": "number", "operation": "gt" },
              "rightValue": "1000"
            }
          ]
        },
        "looseTypeValidation": true
      }
    },
    {
      "id": "8ecd8d82-5410-4380-a51e-ee1e15deb675",
      "name": "Prioridade alta",
      "type": "data.set",
      "typeVersion": 1,
      "position": [780, 0],
      "parameters": {
        "fields": [{ "name": "prioridade", "type": "string", "value": "alta" }],
        "includeOtherFields": true
      }
    },
    {
      "id": "a5b0b771-8b71-4ede-8103-563de89a6ae7",
      "name": "Prioridade normal",
      "type": "data.set",
      "typeVersion": 1,
      "position": [780, 160],
      "parameters": {
        "fields": [{ "name": "prioridade", "type": "string", "value": "normal" }],
        "includeOtherFields": true
      }
    },
    {
      "id": "64b9fca2-8a60-4509-a4ba-11a5bc20debd",
      "name": "Juntar",
      "type": "logic.merge",
      "typeVersion": 1,
      "position": [1040, 80],
      "parameters": { "mode": "append", "numberInputs": 2, "waitFor": "anyWithData" }
    },
    {
      "id": "3e2af122-7a1b-42f4-a00c-2b11a2c2aab3",
      "name": "Gravar pedidos",
      "type": "postgres.write",
      "typeVersion": 1,
      "position": [1300, 80],
      "parameters": {
        "operation": "upsert",
        "schema": "public",
        "table": "pedidos",
        "columns": {
          "mappingMode": "defineBelow",
          "values": [
            { "column": "id", "value": "={{ $json.id }}" },
            { "column": "valor", "value": "={{ $json.valor }}" },
            { "column": "prioridade", "value": "={{ $json.prioridade }}" }
          ]
        },
        "matchingColumns": [{ "column": "id" }],
        "options": { "transaction": "allItems" }
      },
      "credentials": { "postgres": { "name": "Banco de pedidos" } }
    }
  ],
  "connections": {
    "Início": { "main": [[{ "node": "Buscar pedidos", "type": "main", "index": 0 }]] },
    "Buscar pedidos": { "main": [[{ "node": "Valor alto?", "type": "main", "index": 0 }]] },
    "Valor alto?": {
      "main": [
        [{ "node": "Prioridade alta", "type": "main", "index": 0 }],
        [{ "node": "Prioridade normal", "type": "main", "index": 0 }]
      ]
    },
    "Prioridade alta": { "main": [[{ "node": "Juntar", "type": "main", "index": 0 }]] },
    "Prioridade normal": { "main": [[{ "node": "Juntar", "type": "main", "index": 1 }]] },
    "Juntar": { "main": [[{ "node": "Gravar pedidos", "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "settings": { "executionTimeout": 300, "saveDataSuccessExecution": "none", "saveDataErrorExecution": "all" },
  "meta": { "ollyFlow": { "formatVersion": 1 } },
  "tags": [],
  "active": false
}
```

### 12.3 Loop em lotes

Gera 25 itens, envia-os a uma API em lotes de 10 e, no fim, conta os enviados.

<!-- exemplo-completo -->
```json
{
  "name": "Envio em lotes",
  "nodes": [
    {
      "id": "b96be29d-c06b-4bb4-8f0e-51e5e3ee3fb6",
      "name": "Início",
      "type": "trigger.manual",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "id": "8e5de610-213f-4ea7-b3a8-b999518c8afe",
      "name": "Gerar itens",
      "type": "code.javascript",
      "typeVersion": 1,
      "position": [260, 0],
      "parameters": {
        "mode": "runOnceForAllItems",
        "jsCode": "return Array.from({ length: 25 }, (_, i) => ({ json: { numero: i + 1 } }));"
      }
    },
    {
      "id": "17c3fae0-d62b-49cc-8906-0289d45efe94",
      "name": "Loop",
      "type": "logic.loopOverItems",
      "typeVersion": 1,
      "position": [520, 0],
      "parameters": { "batchSize": 10 }
    },
    {
      "id": "cae4df3c-1bd6-450a-846b-48db82e40db2",
      "name": "Enviar lote",
      "type": "http.request",
      "typeVersion": 1,
      "position": [780, 120],
      "parameters": {
        "method": "POST",
        "url": "https://api.exemplo.gov.br/registros",
        "sendBody": true,
        "contentType": "json",
        "jsonBody": "={{ JSON.stringify({ numero: $json.numero }) }}"
      }
    },
    {
      "id": "4ca3b8d3-0678-4821-b9f7-2bde66ffc5dc",
      "name": "Resumo",
      "type": "code.javascript",
      "typeVersion": 1,
      "position": [780, -120],
      "parameters": {
        "mode": "runOnceForAllItems",
        "jsCode": "return [{ json: { enviados: $input.all().length } }];"
      }
    }
  ],
  "connections": {
    "Início": { "main": [[{ "node": "Gerar itens", "type": "main", "index": 0 }]] },
    "Gerar itens": { "main": [[{ "node": "Loop", "type": "main", "index": 0 }]] },
    "Loop": {
      "main": [
        [{ "node": "Resumo", "type": "main", "index": 0 }],
        [{ "node": "Enviar lote", "type": "main", "index": 0 }]
      ]
    },
    "Enviar lote": { "main": [[{ "node": "Loop", "type": "main", "index": 1 }]] }
  },
  "pinData": {},
  "settings": {},
  "meta": { "ollyFlow": { "formatVersion": 1 } },
  "tags": [],
  "active": false
}
```

### 12.4 Agent com modelo, memória e ferramentas

Recebe `{ "sessionId": "...", "pergunta": "..." }` em `/atendimento` e responde com a resposta do agente. O agente pode consultar um CEP (HTTP com `$fromAI`) e calcular parcelas (código).

<!-- exemplo-completo -->
```json
{
  "name": "Atendimento com IA",
  "nodes": [
    {
      "id": "410bb6cc-3a80-43f7-8c21-e614830abdb7",
      "name": "Webhook",
      "type": "trigger.webhook",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": { "httpMethod": "POST", "path": "atendimento", "responseMode": "lastNode" }
    },
    {
      "id": "d543df9b-02bd-49c5-8f2f-8a39dfc80a20",
      "name": "Agente",
      "type": "ai.agent",
      "typeVersion": 1,
      "position": [300, 0],
      "parameters": {
        "promptSource": "define",
        "text": "={{ $json.body.pergunta }}",
        "systemMessage": "Você é o assistente de atendimento. Responda em português, de forma objetiva. Use as ferramentas quando precisar de dados.",
        "maxIterations": 6
      }
    },
    {
      "id": "26e68609-d086-4dbd-afb7-032a6e765d5b",
      "name": "Modelo",
      "type": "ai.chatModel",
      "typeVersion": 1,
      "position": [160, 220],
      "parameters": { "model": "gpt-4o-mini", "maxTokens": 0, "timeoutMs": 60000, "maxRetries": 2 },
      "credentials": { "openAiCompatible": { "name": "OpenAI" } }
    },
    {
      "id": "cd669629-54c8-4eca-b28c-4a6e3a1b1ba9",
      "name": "Memória",
      "type": "memory.buffer",
      "typeVersion": 1,
      "position": [300, 220],
      "parameters": { "sessionKey": "={{ $json.body.sessionId }}", "contextWindowLength": 10 }
    },
    {
      "id": "285bd097-1a4b-408e-acf0-b941fcefdedc",
      "name": "Consultar CEP",
      "type": "tool.httpRequest",
      "typeVersion": 1,
      "position": [440, 220],
      "parameters": {
        "toolName": "consultar_cep",
        "toolDescription": "Consulta o endereço (logradouro, bairro, cidade e UF) de um CEP brasileiro. Use quando o usuário informar um CEP.",
        "requireApproval": false,
        "method": "GET",
        "url": "=https://viacep.com.br/ws/{{ $fromAI('cep', 'CEP com 8 dígitos, só números') }}/json/"
      }
    },
    {
      "id": "4d42ec01-86e3-48f7-b11d-d524f1c7570c",
      "name": "Calcular parcelas",
      "type": "tool.code",
      "typeVersion": 1,
      "position": [580, 220],
      "parameters": {
        "toolName": "calcular_parcelas",
        "toolDescription": "Calcula o valor de cada parcela de uma compra sem juros.",
        "requireApproval": false,
        "inputSchema": "{\"type\":\"object\",\"properties\":{\"valor\":{\"type\":\"number\",\"description\":\"Valor da compra em reais\"},\"parcelas\":{\"type\":\"integer\",\"description\":\"Número de parcelas\"}},\"required\":[\"valor\",\"parcelas\"]}",
        "jsCode": "const { valor, parcelas } = $input.first().json;\nreturn { parcela: Number((valor / parcelas).toFixed(2)) };"
      }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Agente", "type": "main", "index": 0 }]] },
    "Modelo": { "ai_languageModel": [[{ "node": "Agente", "type": "ai_languageModel", "index": 0 }]] },
    "Memória": { "ai_memory": [[{ "node": "Agente", "type": "ai_memory", "index": 0 }]] },
    "Consultar CEP": { "ai_tool": [[{ "node": "Agente", "type": "ai_tool", "index": 0 }]] },
    "Calcular parcelas": { "ai_tool": [[{ "node": "Agente", "type": "ai_tool", "index": 0 }]] }
  },
  "pinData": {},
  "settings": {},
  "meta": { "ollyFlow": { "formatVersion": 1 } },
  "tags": [],
  "active": false
}
```

### 12.5 Switch com saída padrão e saída de erro

Classifica cada item por `tipo` (pessoa física, pessoa jurídica ou outro). Os itens de pessoa jurídica são consultados numa API; as falhas da consulta vão para um ramo de registro.

<!-- exemplo-completo -->
```json
{
  "name": "Classificar cadastros",
  "nodes": [
    {
      "id": "5fcbd92a-43c4-48f4-87bd-ca8fa39e9aab",
      "name": "Início",
      "type": "trigger.manual",
      "typeVersion": 1,
      "position": [0, 160],
      "parameters": {}
    },
    {
      "id": "a3b00874-9326-43a8-98d4-2532dbf31f0b",
      "name": "Roteador",
      "type": "logic.switch",
      "typeVersion": 1,
      "position": [260, 160],
      "parameters": {
        "mode": "rules",
        "rules": [
          {
            "conditions": {
              "combinator": "and",
              "conditions": [
                { "leftValue": "={{ $json.tipo }}", "operator": { "type": "string", "operation": "equals" }, "rightValue": "pf" }
              ]
            },
            "outputKey": "Pessoa física"
          },
          {
            "conditions": {
              "combinator": "and",
              "conditions": [
                { "leftValue": "={{ $json.tipo }}", "operator": { "type": "string", "operation": "equals" }, "rightValue": "pj" }
              ]
            },
            "outputKey": "Pessoa jurídica"
          }
        ],
        "looseTypeValidation": false,
        "options": { "fallbackOutput": "extra", "allMatchingOutputs": false }
      }
    },
    {
      "id": "92b1b082-c713-43d0-ac63-49fdb797fa09",
      "name": "Tratar PF",
      "type": "data.set",
      "typeVersion": 1,
      "position": [520, 0],
      "parameters": { "fields": [{ "name": "categoria", "type": "string", "value": "PF" }], "includeOtherFields": true }
    },
    {
      "id": "57470382-9592-4d60-91a7-95a442ddae1e",
      "name": "Consultar CNPJ",
      "type": "http.request",
      "typeVersion": 1,
      "position": [520, 160],
      "parameters": {
        "method": "GET",
        "url": "=https://api.exemplo.gov.br/cnpj/{{ $json.documento }}"
      },
      "onError": "continueErrorOutput"
    },
    {
      "id": "0bbd4965-5332-4b1d-a75e-8b6c17ac3b3b",
      "name": "Tipo desconhecido",
      "type": "data.set",
      "typeVersion": 1,
      "position": [520, 320],
      "parameters": { "fields": [{ "name": "categoria", "type": "string", "value": "revisar" }], "includeOtherFields": true }
    },
    {
      "id": "d6db7041-c44c-43b0-ae83-9d0621bbd3cc",
      "name": "Registrar falha",
      "type": "data.setVariable",
      "typeVersion": 1,
      "position": [780, 240],
      "parameters": { "variables": [{ "name": "ultimaFalha", "value": "={{ $json.error.message }}" }] }
    }
  ],
  "connections": {
    "Início": { "main": [[{ "node": "Roteador", "type": "main", "index": 0 }]] },
    "Roteador": {
      "main": [
        [{ "node": "Tratar PF", "type": "main", "index": 0 }],
        [{ "node": "Consultar CNPJ", "type": "main", "index": 0 }],
        [{ "node": "Tipo desconhecido", "type": "main", "index": 0 }]
      ]
    },
    "Consultar CNPJ": {
      "main": [
        [],
        [{ "node": "Registrar falha", "type": "main", "index": 0 }]
      ]
    }
  },
  "pinData": {
    "Início": [
      { "json": { "tipo": "pf", "documento": "12345678901" } },
      { "json": { "tipo": "pj", "documento": "12345678000199" } },
      { "json": { "tipo": "xx", "documento": "0" } }
    ]
  },
  "settings": {},
  "meta": { "ollyFlow": { "formatVersion": 1 } },
  "tags": [],
  "active": false
}
```

### 12.6 While

Repete o corpo três vezes, somando 1 a um contador, e termina com o valor final.

<!-- exemplo-completo -->
```json
{
  "name": "Contador",
  "nodes": [
    {
      "id": "923260ba-61c0-469f-9235-40f3c078188f",
      "name": "Início",
      "type": "trigger.manual",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "name": "Enquanto",
      "type": "logic.while",
      "position": [260, 0],
      "parameters": { "condition": "={{ $loop.index < 3 }}", "maxIterations": 10, "accumulate": "none" }
    },
    {
      "name": "Somar",
      "type": "data.set",
      "position": [520, 120],
      "parameters": {
        "fields": [{ "name": "contador", "type": "number", "value": "={{ ($json.contador ?? 0) + 1 }}" }],
        "includeOtherFields": true
      }
    },
    {
      "name": "Fim",
      "type": "data.set",
      "position": [520, -120],
      "parameters": {
        "fields": [{ "name": "resultado", "type": "number", "value": "={{ $json.contador ?? 0 }}" }],
        "includeOtherFields": false
      }
    }
  ],
  "connections": {
    "Início": { "main": [[{ "node": "Enquanto", "type": "main", "index": 0 }]] },
    "Enquanto": {
      "main": [
        [{ "node": "Somar", "type": "main", "index": 0 }],
        [{ "node": "Fim", "type": "main", "index": 0 }]
      ]
    },
    "Somar": { "main": [[{ "node": "Enquanto", "type": "main", "index": 1 }]] }
  },
  "pinData": {},
  "settings": {},
  "meta": { "ollyFlow": { "formatVersion": 1 } },
  "tags": [],
  "active": false
}
```

Neste exemplo, três nós não têm `id` nem `typeVersion`, como num JSON escrito à mão ou gerado por IA: a importação os gera.

## 13. Diferenças em relação ao N8N

| Aspecto | N8N | Olly Flow |
|---|---|---|
| Tipos de nó | `n8n-nodes-base.httpRequest`... | `http.request`... ([seção 9](#9-catálogo-de-nós)). Arquivos do N8N passam pelo importador do N8N (spec 012) |
| Parâmetros | Os do N8N | Os do Olly Flow. Muitos são equivalentes, mas não idênticos |
| Retorno de laço (Loop Over Items) | Volta para a entrada 0 do próprio nó | Volta para a entrada 1 (continuar) |
| While | Não existe | `logic.while` |
| Merge | 2 entradas (padrão) | De 2 a 10 entradas |
| Saída de erro | `onError: continueErrorOutput` | Igual: última saída |
| Configurações próprias | — | No objeto `ollyFlow` (nó, `settings` e `meta`) |
| Credenciais | Referência `{ id, name }` por tipo | Igual; resolvidas no projeto de destino na importação |
| Ativação | `active` restaura o estado | A importação sempre cria um rascunho não publicado |
