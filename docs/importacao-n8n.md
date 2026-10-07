# Importação de workflows do N8N

Como trazer para o Olly Flow os workflows exportados do N8N ("Download" no editor do N8N). Introduzido na [spec 015](../specs/015-exportar-importar-json/spec.md) (HU-3), que absorveu o importador previsto na [ADR-0001](adr/0001-abordagem-hibrida.md). Público: quem migra os workflows da POC.

## Como importar

1. Em **Workflows**, escolha o projeto e clique em **Importar**.
2. Em **Formato**, escolha **N8N**. Selecione o arquivo ou cole o JSON.
3. Clique em **Pré-visualizar**. A prévia mostra:
   - os erros que impedem a importação;
   - as pendências;
   - o **relatório de migração**: nós convertidos, com aviso e não suportados, expressões a revisar, credenciais a cadastrar e diferenças de comportamento.
4. Clique em **Importar**. O workflow é criado como **rascunho** (nunca publicado), e o editor abre. Se o projeto já tiver **um único** workflow com o mesmo nome (por exemplo, numa reimportação), ele é **sobreposto** como uma nova versão: o botão vira "Importar e sobrepor", e o histórico é mantido.
5. Resolva as pendências no editor:
   - escolha as credenciais;
   - substitua os nós marcadores;
   - revise as expressões marcadas.

   Depois, publique.

A importação é feita pela API (`POST /api/v1/projects/:id/workflows/import`, com `format: "n8n"`). Ela exige a permissão `workflow:create` e fica na auditoria (`workflow.import`).

## O que é convertido

| Tipo do N8N (versões) | Nó do Olly Flow | Observações |
|---|---|---|
| `manualTrigger` | `trigger.manual` | |
| `webhook` (1–2.x) | `trigger.webhook` | Autenticação básica e por cabeçalho; JWT, vários métodos e as opções de resposta geram aviso |
| `errorTrigger` | `trigger.error` | |
| `executeWorkflowTrigger` | `trigger.executeWorkflow` | Entradas definidas viram o `inputSchema` |
| `set` (1–2 e 3.x) | `data.set` | O modo JSON (raw) não é convertido |
| `if` (1 e 2.x) | `logic.if` | Operações aproximadas (`exists`, `afterOrEquals`...) geram aviso |
| `switch` (3.x) | `logic.switch` | Regras e modo expressão; saída padrão (`fallbackOutput`) |
| `merge` (1–3.x) | `logic.merge` | Concatenar, por posição, por campos e escolher ramo; `combineAll` e SQL não |
| `splitInBatches` (3) | `logic.loopOverItems` | O retorno do laço passa a chegar à entrada **continuar** (índice 1) |
| `noOp` | `data.set` (repassa os itens) | |
| `code` (JavaScript) | `code.javascript` | Python ainda não existe: vira marcador |
| `httpRequest` (4.x) | `http.request` | Autenticação genérica (básica, cabeçalho, query, bearer, OAuth2); credencial pré-definida gera aviso |
| `postgres` (2.x: consulta, inserir, atualizar, upsert) | `postgres.query` / `postgres.write` | |
| `respondToWebhook` | `http.respondToWebhook` | "JSON" vira texto com `Content-Type: application/json`; "redirect" vira 302 com `Location` |
| `executeWorkflow` | `flow.executeWorkflow` | O workflow chamado precisa ser escolhido de novo |
| `wait` (intervalo e data) | `flow.wait` | Retomada por webhook ou formulário: marcador |
| `@n8n/n8n-nodes-langchain.agent` | `ai.agent` | Output parser não convertido |
| `lmChatOpenAi`, `lmChatAnthropic`, `lmChatGoogleGemini` | `ai.chatModel` | O modelo precisa estar liberado em Administração › IA |
| `memoryBufferWindow`, `memoryPostgresChat` | `memory.buffer`, `memory.postgres` | |
| `toolHttpRequest`, `httpRequestTool` | `tool.httpRequest` | Os `{marcadores}` da ferramenta antiga viram `$fromAI` |
| `toolCode` (JavaScript) | `tool.code` | A variável `query` é recriada no início do código |
| `toolWorkflow` | `tool.workflow` | O workflow precisa ser escolhido de novo |
| `mcpClientTool` | `tool.mcp` | Escolha o servidor do catálogo. Na ADR-0001 a tabela citava `ai.mcpClient`, mas no N8N este nó é uma ferramenta do Agent |

- **Descartados:** `stickyNote` (com nota no relatório).
- **Marcadores:** os demais tipos viram [nós marcadores](nos/placeholder.unsupported.md), com o JSON original. Exemplos: `scheduleTrigger` (o gatilho agendado ainda não existe), Slack, planilhas.

## Conexões, credenciais e expressões

- **Conexões:** mantidas, com os mesmos índices de saída e de entrada (If 0/1, Switch, Merge, saída de erro), exceto o retorno do Loop Over Items. As conexões de tipos que o Olly Flow não tem (`ai_outputParser`, `ai_document`...) são descartadas, com nota.
- **Credenciais:** nunca são importadas.
  - O relatório lista cada credencial (nome, tipo do N8N e tipo equivalente) e os nós que a usam.
  - Se o projeto já tiver uma credencial do tipo equivalente com o mesmo nome, o nó já fica ligado a ela.
- **Expressões:** mantidas, já que a sintaxe é a mesma. São marcadas para revisão:
  - variáveis que o Olly Flow não tem (`$items`, `$jmespath`, `$prevNode`...);
  - funções de extensão do N8N (`.toInt()`, `.isEmpty()`...);
  - `$vars`, que no Olly Flow são as variáveis da execução;
  - `$fromAI` fora das ferramentas.
- **Configurações do workflow:** `executionTimeout` e as opções de salvar dados. O workflow de erro do N8N precisa ser importado e escolhido de novo.
- **Comportamento:** no Olly Flow, ramos independentes executam em **paralelo** (no N8N, um depois do outro). O relatório sempre lembra disso.

## Fixtures da POC

Os workflows de referência ficam em [`fixtures/n8n/`](../fixtures/n8n/README.md). O teste `apps/api/src/workflow-io/n8n-fixtures.int.test.ts`:
1. importa cada um pela API;
2. executa os que não têm pendências com a entrada do caso e compara com a saída esperada;
3. gera o [relatório consolidado](migracao/relatorio-fixtures-n8n.md).

Hoje há só fixtures sintéticas: a exportação dos workflows reais da POC é um pré-requisito humano.

Formato do arquivo do Olly Flow, para comparação: [docs/nos/workflow-json.md](nos/workflow-json.md).
