# Plano técnico — Spec 018: Output Parsers como no N8N

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Novo tipo de conexão `ai_outputParser`**, ao lado de `ai_languageModel`, `ai_memory` e `ai_tool`.
- **Três sub-nós em `packages/nodes/src/ai/output-parsers/`:**
  - `outputParser.structured`;
  - `outputParser.autoFixing`, que tem as próprias entradas de modelo e de parser;
  - `outputParser.itemList`.

  Cada um entrega ao nó pai um `OutputParserSupply`, com as instruções de formato e a interpretação da resposta.
- **Agent e Basic LLM Chain:** ganham o parâmetro `hasOutputParser`, e as portas dinâmicas acrescentam a entrada `ai_outputParser`. O JSON Schema no nó (`outputParser` + `schema`) sai dos parâmetros.
- **Correção:**
  - **com o modelo do nó:** o loop de correção atual (até 2) passa a valer para o Structured com `autoFix`;
  - **com o modelo do próprio sub-nó:** a do Auto-fixing acontece dentro dele, pelos mesmos ganchos de uso e passos do nó pai.
- **Migração do formato antigo:** uma função pura, `migrateLegacyOutputParser`, converte a definição. Ela roda na leitura (rascunho e versões), no salvamento, na execução e na importação, sem reescrever o histórico.
- **Importador do N8N:** conversores 1:1 dos três parsers, no lugar da absorção feita nas specs 011 e 017.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| I — Spec antes do código | Spec 018 criada com as decisões do PO; históricos das specs 011 e 017 apontam a mudança |
| II — Compatibilidade com o N8N | Mesmos sub-nós, parâmetros, entrada `ai_outputParser` e opção "Require Specific Output Format"; importação 1:1 |
| IV — Testes | Modelo simulado; cada FR com teste que o cita; regressão da migração (SC-004) |
| VIII — Governança de IA | Correções pelos ganchos de uso, limite e passos do nó pai (inclusive o modelo do Auto-fixing) |
| IX — Contratos | `docs/arquitetura/contratos.md` e `docs/nos/workflow-json.md` atualizados (tipo de conexão novo) |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/shared-types` | `PortKind` e o schema zod com `ai_outputParser`; listas de tipos de porta (`ports.ts`, `workflow-file.ts`); `DynamicPorts` `aiRootInputs` (substitui `fallbackModel`); `migrateLegacyOutputParser` |
| `packages/nodes` | Sub-nós `outputParser.*`; `OutputParserSupply`; `runAgent` e `runChain` com o parser no lugar do `outputSchema`; parâmetros do Agent e do Basic LLM Chain |
| `packages/engine` | Sub-nós de sub-nós (o Auto-fixing lê o próprio modelo e parser); validação das entradas novas (já genérica) |
| `apps/api` | Migração na leitura, no salvamento e na execução; importador do N8N (conversores dos parsers, sem absorção); testes |
| `apps/web` | Entrada e cor do tipo `ai_outputParser` no canvas; ícones; o painel vem do schema |
| `docs/` | `docs/nos/output-parsers.md`, `ai.agent.md`, `ai.chainLlm.md`, `workflow-json.md`, `importacao-n8n.md`, contratos |

## Design

### §1 Tipo de conexão e portas (`packages/shared-types`)

- **Tipo de conexão:** `PortKind` passa a incluir `'ai_outputParser'`, também em `SUBNODE_PORT_KINDS`, no zod do `Edge` e nas listas `PORT_KINDS` de `ports.ts`, `workflow-file.ts` e do importador. Na ordem das portas do arquivo, ele vem depois de `ai_tool`.
- **`DynamicPorts`:** `{ kind: 'aiRootInputs' }` substitui `fallbackModel` e soma as entradas pelos parâmetros:
  - `needsFallback` → `ai_fallbackModel` (`ai_languageModel`, índice 1; spec 017);
  - `hasOutputParser` → `ai_outputParser` ("Output Parser", `required`, `maxConnections: 1`).

  O Agent e o Basic LLM Chain declaram `aiRootInputs`.
- **Auto-fixing:** a entrada de parser é fixa (`inputs`: `ai_languageModel` e `ai_outputParser`, ambas obrigatórias e com uma conexão), e a saída é `ai_outputParser`.

### §2 Contrato do parser (`packages/nodes/src/ai/runtime/types.ts`)

```ts
interface OutputParserSupply {
  kind: 'structured' | 'autoFixing' | 'itemList';
  /** Instruções de formato enviadas ao modelo. */
  formatInstructions(): string;
  /** Interpreta a resposta; lança OutputParserError(problemas) se inválida. */
  parse(text: string, context: OutputParseContext): Promise<unknown>;
  /** Structured com autoFix: o nó pai corrige com o próprio modelo (até 2). */
  readonly fixWithRootModel: boolean;
}
interface OutputParseContext {
  signal: AbortSignal;
  /** Ganchos do nó pai: limite mensal, uso e passos (FR-007). */
  hooks: { beforeModelCall; onUsage(usage, model); onStep(step) };
}
```

### §3 Sub-nós (`packages/nodes/src/ai/output-parsers/`)

| Tipo | Parâmetros (nomes do N8N) | Comportamento |
|---|---|---|
| `outputParser.structured` ("Structured Output Parser") | `schemaType` (`fromJson` padrão \| `manual`), `jsonSchemaExample` (exemplo do N8N), `inputSchema`, `autoFix` (padrão `false`) | O schema vem do exemplo (inferência atual do importador, movida para `@olly/nodes`) ou do `inputSchema`. As instruções trazem o schema. `parse` usa `outputProblems` e `extractJson`. Exemplo ou schema inválido gera `NodeParameterError` |
| `outputParser.autoFixing` ("Auto-fixing Output Parser") | `options.prompt` (padrão do N8N, com `{instructions}`, `{completion}`, `{error}`) | `parse` chama o interno; em `OutputParserError`, chama o próprio modelo com o prompt de correção, pelos ganchos do contexto (uso com o modelo do Auto-fixing, passo `model` com `fixer: true`), e passa a resposta pelo interno de novo (uma tentativa). As instruções são as do interno |
| `outputParser.itemList` ("Item List Output Parser") | `options.numberOfItems` (padrão -1 = sem limite), `options.separator` (padrão `\n`) | Divide pelo separador, tira espaços, marcadores (`1.`, `-`, `*`) e vazios, e corta no limite. Nunca falha. As instruções pedem um item por linha (ou pelo separador) |

### §4 Agent e Basic LLM Chain (`runtime/agent.ts`, `runtime/chain.ts`)

- **Parâmetros:** saem `outputParser` e `schema`, e entra `hasOutputParser` (booleano, "Exigir formato específico").
- **Leitura do parser:** com `hasOutputParser`, o nó lê `ctx.subNodes('ai_outputParser', i, { port: 'ai_outputParser' })` e exige um parser.
- **`runAgent` e `runChain`:** recebem `outputParser?: OutputParserSupply` no lugar de `outputSchema`. As instruções de formato vão ao fim do pedido, como no N8N.
- **Resposta final:**
  - chama `parser.parse(texto, { signal, hooks })`;
  - em `OutputParserError` com `fixWithRootModel`, aplica o loop atual (`correctionPrompt` com as instruções do parser, até `MAX_OUTPUT_CORRECTIONS`) no modelo que respondeu;
  - sem correção, o erro sobe com os problemas.
- **Saída com parser:** `{ output: valor }` nos dois nós; o Agent mantém `usage` e `intermediateSteps`.

### §5 Sub-nós de sub-nós (`packages/engine/src/run.ts`)

O contexto de um sub-nó hoje recebe `subNodes: () => []`. Passa a receber `subNodesFor(sub, subType, …)`, com o mesmo item e o mesmo sinal, para o Auto-fixing ler o próprio modelo e parser. Uma cadeia de Auto-fixing ligados entre si é limitada a 5 níveis (`WorkflowRunError`), e a validação já recusa ciclos entre arestas.

### §6 Migração do formato antigo (`migrateLegacyOutputParser`, `packages/shared-types`)

- **O que converte:** cada `ai.agent` ou `ai.chainLlm` com `params.outputParser === 'jsonSchema'`. O nó recebe `hasOutputParser: true`, perde `outputParser` e `schema`, e ganha um nó novo:
  - **tipo e nome:** `outputParser.structured`, com o nome `<nó> · formato` (único) e o id `<id do nó>-parser`;
  - **parâmetros:** `schemaType: 'manual'`, `inputSchema: <schema>` e `autoFix: true`, para manter as 2 correções de hoje;
  - **posição:** abaixo do nó;
  - **ligação:** uma aresta `ai_outputParser` até o nó.
- **Propriedades:** é idempotente e devolve se houve mudança.
- **Onde roda:**
  - **API:** na leitura do rascunho e das versões (`WorkflowsService`), na entrada do salvamento (antes da validação) e na montagem da execução (inclusive as versões publicadas e o workflow de erro);
  - **importação:** em `fromWorkflowFile`;
  - **histórico:** as linhas de `workflow_versions` não são reescritas.

### §7 Importador do N8N (`apps/api/src/workflow-io/n8n/`)

- **Nós pais (FR-008):**
  - `@n8n/n8n-nodes-langchain.agent` e `chainLlm`: `hasOutputParser` passa como veio;
  - o `OUTPUT_PARSER_WARNING` é removido;
  - os demais parâmetros não mudam, inclusive o `needsFallback` do `chainLlm`.
- **Conversores dos parsers:**

  | Tipo do N8N (versões) | Nó do Olly Flow | Parâmetros |
  |---|---|---|
  | `outputParserStructured` (1 a 1.3) | `outputParser.structured` | `schemaType` (`fromJson` padrão; `manual` com `inputSchema`); v1 e v1.1 com `jsonSchema` → `schemaType: 'manual'`, `inputSchema: jsonSchema`; `jsonSchemaExample`; `autoFix` (1.3) e `customizeRetryPrompt`/`prompt` → aviso se personalizado (o prompt de correção do nó é o padrão) |
  | `outputParserAutofixing` (1) | `outputParser.autoFixing` | `options.prompt` |
  | `outputParserItemList` (1) | `outputParser.itemList` | `options.numberOfItems`, `options.separator` |

- **Conexões (FR-009):**
  - `ai_outputParser` entra em `PORT_KINDS` do importador e deixa de ser descartada;
  - cada conexão vai à porta `ai_outputParser` do destino (Agent, Basic LLM Chain ou Auto-fixing);
  - o `ai_languageModel` ligado a um Auto-fixing vai à entrada de modelo dele;
  - pela regra de índices da spec 015, um Basic LLM Chain com reserva e parser recebe cada conexão na sua porta.
- **Remoção:** saem `structuredParserSchema`, `PARSER_TARGETS`, a inferência no importador (movida para `@olly/nodes`, §3) e o bloco de absorção em `convert.ts`. Os testes da absorção (specs 011 e 017) passam a esperar os sub-nós.
- **Pendências no relatório (FR-010):**
  - `hasOutputParser` sem conexão `ai_outputParser` → aviso no nó;
  - parser sem destino → nota;
  - Auto-fixing sem modelo ou parser interno → aviso;
  - `jsonSchemaExample` inválido → aviso.

  Essas pendências também aparecem na validação depois da importação (entradas obrigatórias).
- **Arquivos do Olly Flow antigos:** `fromWorkflowFile` aplica `migrateLegacyOutputParser` (§6) antes da validação.
- **Fixtures e documentação:** uma fixture sintética em `fixtures/n8n/` com o Agent e o Basic LLM Chain ligados aos três parsers, executada pelo `n8n-fixtures.int.test.ts` (que regenera `docs/migracao/relatorio-fixtures-n8n.md`), e a tabela de `docs/importacao-n8n.md`.

### §8 Editor (`apps/web`)

- **Canvas:** o tipo `ai_outputParser` usa a cor e o rótulo de sub-nó ("Output Parser"), como os demais tipos `ai_*`; o canvas já desenha as entradas pelas portas efetivas.
- **Ícones:** `braces` (Structured), `wrench` (Auto-fixing) e `list` (Item List).

## Modelo de dados

Sem migrations: a migração do formato antigo é feita na leitura e no salvamento (§6).

## Contratos

- **Tipo de conexão `ai_outputParser`.**
- **Tipos de nó:** `outputParser.structured`, `outputParser.autoFixing` e `outputParser.itemList`.
- **`ai.agent` e `ai.chainLlm`:** o parâmetro `hasOutputParser` substitui `outputParser` e `schema`.
- **`DynamicPorts`:** `aiRootInputs` substitui `fallbackModel`.
- **`OutputParserSupply`.**
- **Saída com parser:** `{ output }`.
- Sem rotas, tabelas, permissões ou variáveis novas.

## Permissões RBAC

Sem permissões novas.

## Configuração

Nenhuma variável nova.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Migração na leitura, no salvamento e na execução | Migration SQL que reescreve rascunhos e versões | As versões publicadas são imutáveis (spec 009); a função pura cobre também os arquivos importados |
| Structured com `autoFix` corrigindo no modelo do nó | Sempre exigir o Auto-fixing | Igual ao N8N (opção do Structured) e preserva o comportamento atual na migração |
| Uma tentativa no Auto-fixing | As mesmas 2 do Structured | Igual ao N8N |
| Ganchos do nó pai no contexto do parser | O parser chama o gateway direto | Uso, limite e passos ficam no nó pai, que aparece no painel |
| `aiRootInputs` único para as entradas opcionais | Um tipo de porta dinâmica por entrada | O Basic LLM Chain precisa das duas (reserva e parser) ao mesmo tempo |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001, FR-002 | Unidade | `packages/nodes/src/ai/output-parsers/output-parsers.test.ts` e os testes do Agent e do Basic LLM Chain (entrada, instruções, `output`) |
| FR-003, FR-004, FR-005 | Unidade (modelo simulado) | `output-parsers.test.ts` (exemplo e schema, `autoFix`, Auto-fixing com prompt padrão e personalizado, Item List com separador e limite) |
| FR-001 (validação), FR-004 (sub-nós de sub-nós) | Unidade | `packages/engine/src/output-parsers.test.ts` |
| FR-006, SC-004 | Unidade e integração | `packages/shared-types/src/legacy-output-parser.test.ts`; `apps/api/src/ai/output-parsers.int.test.ts` (workflow antigo salvo direto no banco, lido, executado e publicado) |
| FR-007, SC-001, SC-002, SC-003 | Integração | `output-parsers.int.test.ts` (uso e passos das correções, inclusive do Auto-fixing) |
| FR-008, FR-009, FR-010, SC-005 | Unidade | `apps/api/src/workflow-io/n8n/n8n.test.ts` (Agent e Basic LLM Chain com cada parser; Auto-fixing em cadeia; Structured v1; reserva com parser; pendências no relatório; arquivo antigo do Olly Flow) |
| FR-008, SC-005 | Integração | `apps/api/src/workflow-io/n8n-fixtures.int.test.ts` (fixture sintética com os três parsers, importada e executada com o modelo simulado) |
| FR-011 | Unidade | `apps/api/src/workflow-io/docs.test.ts` (tipos documentados; exemplos com parser) |
| HU-1 (editor) | E2E | `apps/web/e2e/agent.spec.ts` (ligar a opção mostra a entrada Output Parser) |

## Riscos

| Risco | Mitigação |
|---|---|
| Algum lugar que lê a definição sem migrar | Migração centralizada na leitura e na execução; teste com um workflow antigo gravado direto no banco; o salvamento migra antes de validar |
| Recursão entre Auto-fixing | Limite de 5 níveis e validação de ciclos |
| Mudança no formato do arquivo exportado (parser vira nó) | Igual ao N8N; o formato antigo continua importável (migração) |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 09/10/2026 | Criação | Spec 018 |
| 09/10/2026 | §7 detalhado para a migração do N8N com as alterações dos nós (FR-008 a FR-010); testes e fixture | Pedido do PO |
