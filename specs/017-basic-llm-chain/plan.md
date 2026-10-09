# Plano técnico — Spec 017: Nó Basic LLM Chain

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Nó novo `ai.chainLlm`** ("Basic LLM Chain", categoria `ai`), em `packages/nodes/src/ai/chain-llm/`:
  - entrada `main` e entrada `ai_languageModel` (Modelo);
  - com `needsFallback`, uma segunda entrada `ai_languageModel` (Modelo reserva), por portas dinâmicas;
  - saída `main`.
- **Execução por item**, numa função de runtime própria (`runChain`):
  - monta as mensagens (sistema, exemplos, prompt) e faz **uma** chamada ao modelo, sem ferramentas nem memória;
  - com JSON Schema, valida a resposta e pede até 2 correções, reaproveitando a validação e a extração do Agent;
  - registra uso, custo e passos pelos mesmos ganchos do Agent (`beforeModelCall`, `recordUsage`, `recordStep`).
- **Modelo reserva:** se a chamada ao principal falhar, a mesma chamada vai ao reserva. O limite mensal e o cancelamento não acionam o reserva.
- **Passos no painel:** o `AgentStepsPanel` do editor passa a valer também para o `ai.chainLlm`. A API e o WebSocket dos passos já são genéricos por nó.
- **Importador do N8N:** conversor do `chainLlm`, que absorve o Structured Output Parser como JSON Schema e liga o reserva à segunda entrada.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| I — Spec antes do código | Esclarecimentos do PO registrados no histórico da spec antes deste plano |
| II — Compatibilidade com o N8N | Mesmos parâmetros e saída `text` do `chainLlm`; reserva na entrada `ai_languageModel` de índice 1, como no JSON do N8N; importação dos workflows da POC |
| III — Segurança | O modelo chega pelos sub-nós existentes (anti-SSRF, credenciais cifradas, mascaramento); passos mascarados antes de gravar e transmitir (spec 009) |
| IV — Testes | Modelo simulado (`fakeLlm`) e Bridge simulada; cada FR com teste que o cita |
| VIII — Governança de IA | Lista de modelos (pelo sub-nó), limite mensal, uso e custo por chamada, como no Agent |
| IX — Contratos | `docs/arquitetura/contratos.md` e `docs/nos/workflow-json.md` atualizados |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/shared-types` | `DynamicPorts` ganha `{ kind: 'fallbackModel' }`; `resolveNodePorts` acrescenta a entrada `ai_fallbackModel` quando `params.needsFallback` |
| `packages/nodes` | Nó `ai.chainLlm` (`definition.ts`); `runtime/chain.ts` (`runChain`); `ctx.subNodes(kind, item, { port })` para ler só uma entrada |
| `packages/engine` | `subNodes` aceita o filtro por porta; nada mais muda (sub-nós, portas dinâmicas e validação de entradas obrigatórias já são genéricos) |
| `apps/api` | Conversor `chainLlm` e absorção do `outputParserStructured` no importador do N8N; catálogo de tipos nos testes |
| `apps/web` | Painel de passos também para `ai.chainLlm`; ícone `link` |
| `docs/` | `docs/nos/ai.chainLlm.md`, `docs/nos/workflow-json.md`, `docs/importacao-n8n.md`, `docs/nos/README.md`, `docs/arquitetura/contratos.md` |

## Design

### §1 Parâmetros do nó (`packages/nodes/src/ai/chain-llm/definition.ts`)

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `promptSource` | `fromInput` \| `define` | `fromInput` | Como no Agent: `chatInput` do item ou o texto abaixo |
| `text` | texto (multilinha) | `""` | Visível com `define`; expressões |
| `messages` | lista de `{ role: 'system' \| 'user' \| 'assistant', text }` | `[]` | Mensagens antes do prompt, na ordem; expressões em `text` |
| `outputParser` | `none` \| `jsonSchema` | `none` | `jsonSchema`: resposta estruturada |
| `schema` | texto (JSON Schema) | objeto com `resposta` | Visível com `jsonSchema`; sem expressão (como no Agent) |
| `needsFallback` | booleano | `false` | Acrescenta a entrada "Modelo reserva" |

- **Portas:**
  - `inputs`: `main`, mais `ai_languageModel` ("Modelo", `required`, `maxConnections: 1`);
  - `dynamicPorts: { kind: 'fallbackModel' }`: com `needsFallback`, `resolveNodePorts` acrescenta `ai_fallbackModel` ("Modelo reserva", tipo `ai_languageModel`, `required`, `maxConnections: 1`);
  - **índices no JSON:** como a porta é a segunda do tipo `ai_languageModel`, tem índice 1 no arquivo (spec 015), igual ao N8N. A validação existente de entradas obrigatórias aponta a falta do reserva (HU-4, cenário 3).
- **Execução:** `supportsParallelItems: true` (execução paralela por item da spec 006, no lugar dos lotes do N8N). `execute` usa `ctx.mapItems`.

### §2 Execução por item (`packages/nodes/src/ai/runtime/chain.ts`)

1. **Modelos:**
   - **principal:** `ctx.subNodes('ai_languageModel', i, { port: 'ai_languageModel' })`;
   - **reserva:** com `needsFallback`, `ctx.subNodes('ai_languageModel', i, { port: 'ai_fallbackModel' })`.

   Cada sub-nó já aplica a lista de modelos permitidos, quando a usa (spec 011 e 016).
2. **Mensagens:**
   - `messages` vira `SystemMessage`, `HumanMessage` e `AIMessage`, na ordem;
   - o prompt vem por último, como `HumanMessage`;
   - prompt vazio gera `NodeParameterError('text' | 'promptSource')`;
   - mensagem com texto vazio é ignorada.
3. **Chamada (`callModel`):**
   - `await ai.beforeModelCall()`, depois `model.chatModel.invoke(messages, { signal })`;
   - uso por `recordUsage({ provider, model })` do modelo que respondeu;
   - passo `model` com `content: { messages, text, model, fallback }`, que inclui as mensagens enviadas (HU-5) e os tokens.
4. **Reserva (FR-011):**
   - se a chamada ao principal lança, e o erro não é `TokenLimitExceededError` nem cancelamento (`ctx.signal.aborted`), registra o passo `error` (`{ model, message }`) e repete a chamada no reserva;
   - se o reserva também falhar, o item falha com `Modelo principal: <erro>. Modelo reserva: <erro>`.

   O limite mensal é identificado pelo `name` do erro (`TokenLimitExceededError`), sem depender da API.
5. **Formato (FR-005):** com `jsonSchema`, usa as funções do Agent já exportadas de `runtime/agent.ts`:
   - `outputProblems` valida a resposta; se houver problemas, acrescenta a mensagem de correção (o mesmo texto do Agent) e repete a chamada no **mesmo** modelo que respondeu, até `MAX_OUTPUT_CORRECTIONS` (2);
   - depois disso, lança `AgentOutputParseError`, com a mensagem adaptada para "a resposta do modelo";
   - `extractJson` extrai o objeto.
6. **Saída:**
   - sem formato: `{ text }` (FR-004), com `contentText` da resposta (junta os blocos de texto, spec 016);
   - com formato: `{ output: objeto }`;
   - passo `final` com a saída.

   O tratamento de erro por item segue o padrão dos nós por item (`itemErrorMode`, `failedItem`, `errorJson`).

### §3 Filtro por porta em `subNodes` (`packages/engine/src/run.ts`)

`subNodes(kind, itemIndex, options?: { port?: string })`: com `port`, só as arestas com `toPort === port`. Sem `port`, o comportamento atual (todas as entradas do tipo, usado pelo Agent) não muda. A assinatura muda em `NodeContext` e no `fakeContext`.

### §4 Painel de passos (`apps/web`)

- **Painel:** a condição `node.type === 'ai.agent'` em `node-details-view.tsx` vira uma lista `STEP_NODE_TYPES = ['ai.agent', 'ai.chainLlm']`. Os passos usam a rota existente `GET /executions/:id/agent-steps` e o evento `agentStep`.
- **Componente:** o `AgentStepsPanel` passa a exibir as `messages` do passo `model`, quando houver, e o indicador "reserva".
- **Ícone:** `link` (lucide `Link`).

### §5 Importador do N8N (`apps/api/src/workflow-io/n8n/`)

- **Conversor `@n8n/n8n-nodes-langchain.chainLlm`** (versões 1 a 1.7):
  - `promptType` (`auto` → `fromInput`, `define`) e `text`;
  - `messages.messageValues[]`:
    - `SystemMessagePromptTemplate` → `system`, `HumanMessagePromptTemplate` → `user` e `AIMessagePromptTemplate` → `assistant`, com `message` → `text`;
    - `messageType` `imageBinary` ou `imageUrl` → mensagem descartada, com aviso;
  - `hasOutputParser` → `outputParser: 'jsonSchema'`;
  - `needsFallback` → `needsFallback`;
  - `batching` → aviso ("lotes fora do escopo: vale a execução paralela por item").
- **Output parser:** depois da conversão dos nós, cada `@n8n/n8n-nodes-langchain.outputParserStructured` ligado por `ai_outputParser` a um `chainLlm` é absorvido:
  - `schemaType: 'manual'` + `inputSchema` → `schema`;
  - `jsonSchemaExample` → schema inferido do exemplo (tipos dos campos, todos obrigatórios), com aviso para revisar;
  - o nó do parser é removido, e a conexão `ai_outputParser` não gera nota.
  - Outros parsers (`outputParserAutofixing`, `outputParserItemList`) ou parser ligado a outro nó: ficam como hoje (marcador e nota), com aviso no `chainLlm`.
- **Modelo reserva:** as conexões `ai_languageModel` com `index: 1` para o `chainLlm` já chegam à porta de índice 1 (o reserva), pela regra de índices da spec 015.
- **Agent do N8N:** o `outputParserStructured` ligado a um `@n8n/n8n-nodes-langchain.agent` também é absorvido (`outputParser: 'jsonSchema'` no `ai.agent`). Hoje o conversor do Agent só avisa "Output parser não convertido". A mudança é pequena, usa a mesma função e melhora a migração.

## Modelo de dados

Sem migrations: os passos usam `agent_steps` (spec 011) e o uso usa `llm_usage`.

## Contratos

- **Tipo de nó:** `ai.chainLlm`:
  - entradas `main`, `ai_languageModel` e, com `needsFallback`, `ai_fallbackModel` (tipo `ai_languageModel`);
  - saída `main`;
  - saída por item: `{ text }` ou `{ output }`.
- **`DynamicPorts`:** `{ kind: 'fallbackModel' }`.
- **`NodeContext.subNodes(kind, itemIndex, { port? })`.**
- **Passos:** o passo `model` pode trazer `messages`, `model` e `fallback`; o passo `error` traz a falha do principal antes do reserva. Rotas e eventos sem mudança.

## Permissões RBAC

| Permissão | Situação no catálogo/seed | Papéis | O que esta spec faz |
|---|---|---|---|
| `execution:read`, `execution:readData` | Existentes | `execution:read` para todos os papéis do projeto; `execution:readData` conforme a spec 009 | Ler os passos do nó pela rota existente (o conteúdo exige `execution:readData`, como no Agent) |

Sem permissões novas.

## Configuração

Nenhuma variável nova.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| `runChain` próprio, reaproveitando `outputProblems`, `extractJson`, `contentText` e os ganchos do Agent | `runAgent` com zero ferramentas | O Agent não aceita mensagens de exemplo nem reserva, e o loop de ferramentas não tem uso aqui; a validação do formato fica compartilhada |
| Reserva como segunda porta `ai_languageModel` por portas dinâmicas | Parâmetro com o id do modelo reserva | Igual ao N8N (índice 1) e à importação; o editor já desenha entradas dinâmicas |
| Objeto estruturado em `output` | Em `text` | `text` é texto (como no N8N sem parser); `output` é o campo da resposta estruturada no Agent |
| Execução paralela por item no lugar dos lotes | Opção de lote no nó | Decisão do PO; a spec 006 já limita a concorrência |
| Passos na tabela e no painel do Agent | Painel novo | Mesmo formato e mascaramento; a rota já é por nó |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001, FR-002, FR-003, FR-004 | Unidade (modelo simulado) | `packages/nodes/src/ai/chain-llm/chain-llm.test.ts` (prompt do item e definido, mensagens na ordem, `text`, vários itens, prompt vazio) |
| FR-005 | Unidade | `chain-llm.test.ts` (objeto em `output`, correção, falha após 2 correções) |
| FR-007 | Unidade | `chain-llm.test.ts` ("continuar" e "saída de erro" por item) |
| FR-011 | Unidade | `chain-llm.test.ts` (principal falha → reserva; os dois falham; limite e cancelamento não acionam o reserva; correção no mesmo modelo) |
| FR-001 (portas), FR-011 (validação) | Unidade | `packages/shared-types/src/ports.test.ts` (entrada do reserva) e `packages/engine/src/chain-llm.test.ts` (sem modelo, reserva sem modelo, `subNodes` por porta) |
| FR-006, FR-010, FR-012, SC-003, SC-004, SC-006, SC-007 | Integração | `apps/api/src/ai/chain-llm.int.test.ts` (uso e custo, limite mensal, passos na API e no evento, mascaramento, Bridge simulada, reserva, sentinelas) |
| FR-008, SC-005 | Unidade | `apps/api/src/workflow-io/n8n/n8n.test.ts` (`chainLlm`, mensagens, parser absorvido, reserva, avisos) |
| FR-009 | Unidade | `apps/api/src/workflow-io/docs.test.ts` (tipo documentado; exemplo completo importável) |
| HU-5 (painel) | E2E | `apps/web/e2e/agent.spec.ts` (passos do `ai.chainLlm` no painel do nó) |

## Riscos

| Risco | Mitigação |
|---|---|
| A troca para o reserva esconder falhas recorrentes do principal | Passo `error` com a falha do principal, visível no painel; uso registrado com o modelo que respondeu |
| O schema inferido de um `jsonSchemaExample` do N8N diferir do esperado | Aviso no relatório da importação para revisar o schema |
| Mudança na assinatura de `subNodes` quebrar o Agent | Parâmetro opcional; os testes do Agent continuam rodando sem ele |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 09/10/2026 | Criação, depois dos esclarecimentos do PO | Spec 017 |
