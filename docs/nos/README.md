# Nós do Olly Flow

**Formato JSON do workflow** (estrutura, conexões, índices das portas e catálogo de todos os nós, para pessoas e modelos de IA): [workflow-json.md](workflow-json.md).

Cada nó vive em `packages/nodes/src/<categoria>/<nome>/` (`definition.ts`, `execute.ts`, testes) e é registrado em `packages/nodes/src/builtin.ts`. O registro (`NodeRegistry`) recusa nós com definição inválida, e o teste do registro valida todos os nós da plataforma.

| Tipo | Nó | Spec | Página |
|---|---|---|---|
| `trigger.manual` | Gatilho manual | 002 | [trigger.manual.md](trigger.manual.md) |
| `data.set` | Definir campos | 002 (expressões: 003) | [data.set.md](data.set.md) |
| `data.setVariable` | Definir variável | 003 | [data.setVariable.md](data.setVariable.md) |
| `logic.if` | Se (If) | 003 | [logic.if.md](logic.if.md) |
| `http.request` | Requisição HTTP | 004 | [http.request.md](http.request.md) |
| `postgres.database` | PostgreSQL: executar consulta, selecionar, inserir, atualizar, upsert e excluir (substitui `postgres.query` e `postgres.write`) | 022 (antes 004) | [postgres.database.md](postgres.database.md) |
| `trigger.webhook` | Webhook | 005 | [trigger.webhook.md](trigger.webhook.md) |
| `http.respondToWebhook` | Responder ao webhook | 005 | [http.respondToWebhook.md](http.respondToWebhook.md) |
| `code.javascript` | Código (JavaScript) | 005 | [code.javascript.md](code.javascript.md) |
| `logic.merge` | Juntar (Merge) | 007 | [logic.merge.md](logic.merge.md) |
| `logic.while` | Enquanto (While) | 007 | [logic.while.md](logic.while.md) |
| `logic.loopOverItems` | Loop em lotes (Loop Over Items) | 007 | [logic.loopOverItems.md](logic.loopOverItems.md) |
| `logic.switch` | Roteador (Switch) | 007 | [logic.switch.md](logic.switch.md) |
| `trigger.error` | Gatilho de erro | 007 | [trigger.error.md](trigger.error.md) |
| `ai.mcpClient` | Cliente MCP | 010 | [ai.mcpClient.md](ai.mcpClient.md) |
| `flow.wait` | Esperar | 008 | [flow.wait.md](flow.wait.md) |
| `flow.executeWorkflow` | Executar sub-workflow | 008 | [flow.executeWorkflow.md](flow.executeWorkflow.md) |
| `trigger.executeWorkflow` | Quando chamado por outro workflow | 008 | [trigger.executeWorkflow.md](trigger.executeWorkflow.md) |
| `ai.agent` | Agente de IA | 011 | [ai.agent.md](ai.agent.md) |
| `ai.chatModel` | Modelo de chat (sub-nó) | 011 | [ai.chatModel.md](ai.chatModel.md) |
| `memory.postgres`, `memory.buffer` | Memória persistente e temporária (sub-nós) | 011 | [memory.md](memory.md) |
| `tool.mcp`, `tool.httpRequest`, `tool.postgresQuery`, `tool.workflow`, `tool.code` | Ferramentas do agente (sub-nós) | 011 | [tools.md](tools.md) |
| `placeholder.unsupported` | Nó não suportado (marcador da importação) | 015 | [placeholder.unsupported.md](placeholder.unsupported.md) |
| `ai.bridgeChatModel` | Bridge Chat Model: modelo de chat customizado do gateway interno (sub-nó) | 016 | [ai.bridgeChatModel.md](ai.bridgeChatModel.md) |
| `ai.agentix` | Agentix: invoca um agente ou workflow do Agentix | 016 | [ai.agentix.md](ai.agentix.md) |
| `outputParser.structured`, `outputParser.autoFixing`, `outputParser.itemList` | Output parsers do Agent e do Basic LLM Chain (sub-nós) | 018 | [output-parsers.md](output-parsers.md) |
| `ai.chainLlm` | Basic LLM Chain: uma chamada ao modelo por item, com resposta em texto ou JSON Schema e modelo reserva | 017 | [ai.chainLlm.md](ai.chainLlm.md) |
| `trigger.chat` | Mensagem de chat recebida (Chat Trigger): painel do editor, página hospedada e endereço HTTP | 021 | [trigger.chat.md](trigger.chat.md) |

**Sub-nós (spec 011):** nós cujas saídas são todas de um tipo `ai_*` (`ai_languageModel`, `ai_memory`, `ai_tool`). Conectam-se às entradas de mesmo tipo na base do Agent (desenhadas embaixo do nó, com arestas tracejadas), não executam no fluxo principal e fornecem ao nó pai um objeto (`NodeDefinition.supplyData`), lido por `ctx.subNodes(tipo, item)`. `PortDef.maxConnections` limita as conexões de uma entrada (1 modelo, 1 memória).

**Portas dinâmicas (spec 007):** `dynamicPorts` descreve portas calculadas a partir dos parâmetros: `mergeInputs` (Merge), `switchOutputs` (Switch), `aiRootInputs` (entradas opcionais do Agent e do Basic LLM Chain: modelo reserva, spec 017, e output parser, spec 018) ou `chatTriggerInputs` (memória do Chat Trigger com "Carregar sessão anterior", spec 021). A regra fica em `resolveNodePorts` (`@olly/shared-types`), usada pelo motor, pela validação e pelo editor. Com `settings.onError = 'errorOutput'`, qualquer nó ganha a saída `error`: os itens que falharam seguem por ela, com o campo `error`. Nós por item (`data.set`, `http.request`, `postgres.database`) desviam só os itens que falharam; nos demais, uma falha desvia todos os itens de entrada.

Os nós de integração recebem as dependências da API por `createBuiltinNodes({ httpGuard, httpMaxResponseBytes, pools, bridgeTokens })`: filtro anti-SSRF com a allowlist, limite de resposta, pools Postgres e os tokens da Bridge em memória (spec 016). O `HttpGuard` aceita, por chamada, `insecureTls` (não verificar o certificado) e `allowPrivateNetworks` (redes privadas sem allowlist: Bridge, Agentix e MCP) e `allowLoopback` (loopback sem allowlist, só MCP). Credenciais: [docs/credenciais.md](../credenciais.md). O Cliente MCP (spec 010) usa o `McpGateway` que o motor recebe em `RunOptions.mcp` e entrega em `ctx.mcp()`: a governança (catálogo, políticas, snapshot, registro) fica na API ([docs/mcp-governanca.md](../mcp-governanca.md)).

## Convenções de `paramsSchema`

O `paramsSchema` é um **JSON Schema draft-07** com `type: "object"` na raiz. Ele gera o painel de parâmetros do editor e é validado com ajv em modo estrito: palavras-chave desconhecidas (inclusive erros de digitação) fazem o registro do nó falhar.

### Subconjunto suportado pelo painel

| Schema | Campo no painel |
|---|---|
| `type: "string"` | Texto |
| `type: "string"` + `enum` | Lista de opções |
| `type: "number"` / `"integer"` | Número |
| `type: "boolean"` | Caixa de seleção |
| `type: "object"` com `properties` | Grupo de campos |
| `type: "array"` com `items` do tipo objeto | Lista de linhas, com Adicionar e Remover |

Use `title` (rótulo), `description` (ajuda abaixo do campo) e `default` (valor inicial ao adicionar o nó ou a linha). Em números, `minimum`/`maximum` valem no editor (aviso no campo) e no salvamento: valor fixo fora da faixa é erro `PARAM_OUT_OF_RANGE` (expressões são verificadas pelo próprio nó na execução). Outros formatos aparecem como "não suportado"; amplie o painel na spec que precisar deles.

### Extensões

| Palavra-chave | Uso |
|---|---|
| `x-display-options` | Exibição condicional, equivalente ao `displayOptions` do N8N: `{ "show": { "campo": [valores] }, "hide": { "campo": [valores] } }`. Os campos citados são **irmãos** no mesmo objeto. O campo aparece quando todas as condições de `show` batem e nenhuma de `hide`. Um irmão sem valor usa o `default` do seu schema. |
| `x-secret` | Marca um valor sensível. Nos tipos de credencial, o campo nunca sai da API e é mascarado nos dados de execução (spec 004). |
| `x-hidden` | Parâmetro aceito, mas não exibido no editor (ex.: aliases legados). |
| `x-no-expression` | Campo sem modo expressão: o editor não oferece o alternador e o salvamento recusa valor iniciado por `=` (erro `EXPRESSION_NOT_ALLOWED`). Ex.: SQL do `postgres.database` (spec 004). |
| `x-multiline` | Área de texto em vez de linha única (spec 004). |
| `x-code-editor` | Campo editado no editor de código (Monaco), com autocomplete das variáveis e dos nós. Valor: a linguagem (`javascript`) (spec 005). |
| `x-load-options` | Opções buscadas no catálogo do banco da credencial do nó: `postgresSchemas`, `postgresTables` (do `schema` irmão) ou `postgresColumns` (de `schema` e `table`). Sem credencial, o campo vira texto (spec 004). Spec 010: `mcpServers` (servidores MCP ativos no projeto) e `mcpTools` (tools liberadas do `serverId` irmão). Spec 008: `workflows` (workflows do projeto, para o sub-workflow). Spec 011: `aiModels` (modelos permitidos no projeto). Numa lista (`type: array`), vira seleção múltipla com etiquetas e grava `[{ <primeiro campo obrigatório do item>: valor }]` (ex.: `toolNames` da Ferramenta: MCP). |
| `x-mcp-arguments` | Objeto preenchido por um formulário gerado do `inputSchema` aprovado da tool escolhida em `toolName` (cada campo com o alternador Fixo/Expressão). Valor: o nome do parâmetro do servidor (`serverId`) (spec 010). |

Exemplo:

```json
{
  "type": "object",
  "properties": {
    "modo": { "type": "string", "enum": ["simples", "avancado"], "default": "simples" },
    "limite": {
      "type": "number",
      "title": "Limite",
      "x-display-options": { "show": { "modo": ["avancado"] } }
    }
  }
}
```

## Expressões nos parâmetros

Qualquer parâmetro string pode ser uma expressão (`=...`), inclusive dentro de listas e objetos, exceto os marcados com `x-no-expression`; o editor oferece o alternador **Fixo | Expressão** nos demais campos escalares. O nó recebe o valor já resolvido para cada item via `ctx.getParam(nome, índice)`. Ver [docs/expressoes.md](../expressoes.md).

## Comportamentos comuns a todos os nós

- **Nó desabilitado:** repassa a primeira entrada para a primeira saída, sem executar (como no N8N).
- **Dados fixados (pin data):** o nó emite os itens fixados na primeira saída e não executa.
- **`pairedItem`:** nós que não informam a origem de cada item recebem-na automaticamente quando ela é inequívoca (um item de entrada, ou mesma quantidade de itens). Nós que filtram ou reordenam (If) devem preenchê-la.
- **Ramo sem itens:** o nó não executa e propaga "sem dados" para os seguintes.
- **Nome:** único no workflow. Ao colar, nomes repetidos ganham sufixo numérico (`Definir campos1`).
- **Organizar (spec 023):** o botão **Organizar** da barra do editor (atalho **Shift+Alt+T**), como o *Tidy up* do N8N:
  - **layout:** reposiciona os nós da esquerda para a direita, na ordem das conexões e sem sobreposição. Os ramos do If e do Switch seguem a ordem das saídas;
  - **sub-nós:** modelo, memória, ferramentas e parsers ficam embaixo do nó pai, lado a lado;
  - **alcance:** com dois ou mais nós selecionados, só eles (e os sub-nós deles); senão, o workflow inteiro. O canto superior esquerdo fica onde estava;
  - **desfazer:** Ctrl+Z desfaz num passo. O botão não aparece na tela somente leitura.
- **Largura das colunas do painel do nó (spec 025):** as divisórias entre **Entrada**, **Parâmetros** e **Saída** podem ser arrastadas (ou movidas com ← e → quando focadas). Arrastar muda só as duas colunas vizinhas, com mínimo de 15% cada; o clique duplo numa divisória volta ao padrão. As larguras ficam guardadas no navegador e valem para o painel de qualquer nó. Na tela estreita, as colunas ficam empilhadas e sem divisórias.
- **Próximo nó (spec 024):** na execução de teste nó a nó (botão ▶ do nó, ou depois da chamada de teste do webhook), os nós que esperam a execução ficam com a borda índigo e o selo **próximo**, e as conexões até eles ficam animadas. Regras:
  - **quem é o próximo:** um nó que ainda não executou e recebe uma conexão de uma saída com itens de um nó executado com sucesso. No If e no Switch, só o ramo que recebeu itens; a saída de erro conta quando tem itens;
  - **sub-nós** (modelo, memória, ferramentas, parsers) não são destacados: executam junto com o nó pai;
  - **sem destaque** durante a execução, sem execução no editor e depois de um nó com erro.
- **Baixar os dados (spec 019):** no painel do nó, os dados de **Entrada** e de **Saída** têm o botão **Baixar**, que salva os itens exibidos num arquivo JSON, igual à visão JSON e aceito pelo editor de dados fixados. Detalhes:
  - **o que vai no arquivo:** a saída e a origem da entrada selecionadas no painel. O botão só aparece quando há itens;
  - **nome do arquivo:** `<nó>-entrada.json`, `<nó>-saida.json` ou `<nó>-saida-fixada.json`. Acrescenta a saída (`-Verdadeiro`) quando o nó tem mais de uma, e a iteração do laço (`-execucao-2`) quando o nó executou várias vezes. Com a origem num nó anterior, o arquivo é `<anterior>-saida.json`;
  - **o que fica de fora:** só os dados `json` dos itens vão no arquivo; os binários não;
  - **dados protegidos:** os valores mascarados e os dados truncados vão como gravados, e sem a permissão `execution:readData` não há o que baixar.

## Configurações do nó (spec 004)

Aba **Configurações** do painel do nó, gravada em `node.settings`:

| Configuração | Efeito |
|---|---|
| `retry` `{ maxTries (1–10), waitMs (0–60 000), backoff: fixed \| exponential }` | Executa o nó de novo após falha; no exponencial, a espera dobra a cada tentativa (`waitMs * 2^n`). As tentativas ficam em `node_executions.attempts` |
| `timeoutMs` | Aborta o nó após o tempo; o sinal (`ctx.signal`) interrompe a operação HTTP ou SQL em andamento |
| `onError` | `stop` (padrão): falha a execução. `continue`: o nó emite `{ json: { error: { message, description?, httpCode? } } }` e o fluxo segue. Os nós HTTP e Postgres tratam o erro por item (o item que falha vira o item de erro). `errorOutput` fica para a spec 007 |
