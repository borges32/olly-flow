# Plano técnico — Spec 007: Controle de fluxo

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Engine:** ganha suporte a ciclos controlados (porta `continue`), um `run_index` por iteração e escopo de iteração para `$('Nó')`.
- **Novos nós:** Merge com N entradas, While, Loop Over Items, Switch e `trigger.error`.
- **Erros:** porta `error` por nó e error workflow no dispatcher.
- **Semântica:** fixada por uma suíte de workflows de referência.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — N8N | Error Trigger com o mesmo payload; Loop Over Items compatível com Split in Batches v3; Switch v3. Divergências (While, Merge N) previstas na ADR-0001 |
| IV — Testes | Suíte de referência com 2 níveis de paralelismo |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/engine` | Ciclos, `run_index`, escopo de iteração, porta `error`, `validate.ts` |
| `packages/nodes` | `logic.merge`, `logic.while`, `logic.loopOverItems`, `logic.switch`, `trigger.error` |
| `apps/api`/`worker` | Disparo do error workflow; `workflows.error_workflow_id` |
| `apps/web` | Portas dinâmicas, arestas de retorno, seletor de iteração, painel do Merge |

## Design

### §1 Merge
- **Portas dinâmicas:** `outputs`/`inputs` calculados a partir de `params.numberInputs`. O canvas recria as portas e remove arestas órfãs com confirmação.
- **Modos:**

  | `mode` | Comportamento |
  |---|---|
  | `append` | Concatena `input1..N` em ordem |
  | `combineByPosition` | `merge` raso de `json` por índice; `includeUnpaired` |
  | `combineByFields` | `fields: [{ input1Field, input2Field }]`, `joinMode`: `inner` \| `left` \| `outer` \| `keepNonMatches`. Valida `numberInputs = 2`. Índice hash pela chave |
  | `chooseBranch` | `output: inputK` \| `empty` |
  | `waitAll` | Emite `input1` |

- **`waitFor`:**
  - `allConnected` (padrão): exige todas as portas resolvidas (`data` ou `noData`);
  - `anyWithData`: executa quando todas estão resolvidas, usando só as que têm dados. Se nenhuma tiver dados, o nó fica `skipped`.
- **`clashHandling`:** `preferInput1` | `preferLast` | `addSuffix` (`_1`, `_2`...).
- `pairedItem` com `input` indicado (multi-origem).

### §2 Laços no engine
- **Detecção:** `validate.ts` calcula as SCCs (Tarjan). Cada SCC não trivial precisa:
  - ter exatamente uma aresta de entrada no ciclo apontando para a porta `continue` de um nó `logic.while`/`logic.loopOverItems`;
  - ter esse nó como **dominador** de todos os nós da SCC (árvore de dominadores a partir dos gatilhos).

  Caso contrário, erro `INVALID_CYCLE` com os nós.
- **Execução:** o nó de laço controla o corpo. Ao emitir em `loop`, o engine "reabre" os nós do corpo (os da SCC):
  - reseta o estado de prontidão;
  - incrementa `runIndex[nodeId]`;
  - mantém o histórico de saídas `outputs[nodeId][runIndex]`.
- **Escopo de `$('Nó')`:** dentro do corpo, resolve a saída do `runIndex` corrente da iteração; fora, o último `runIndex`. O engine passa ao avaliador o mapa `nodeName → runIndex visível`.
- **Nós do corpo com várias entradas** (ex.: Merge dentro do laço) resolvem as portas por iteração.

### §3 While
- **Estado interno:** `{ index, accumulated[], lastItems }`.
- **Ao receber `main`:** `index = 0`, avalia `condition` com `$json`/`$input` = itens recebidos. Se `true`, emite em `loop`; se `false`, em `done`.
- **Ao receber `continue`:** `index++`. Se `accumulate = appendBodyOutput`, `accumulated.push(...itens)`. Se `index >= maxIterations`, lança `LoopLimitExceededError`. Caso contrário, reavalia a condição sobre os itens recebidos.
- **`done`:** emite `accumulated` (se houver acumulação) ou `lastItems`.
- **Limites:** `maxIterations` padrão 100, limitado por `OLLY_MAX_LOOP_ITERATIONS` (10 000).

### §4 Loop Over Items
- Portas iguais às do While. `batchSize` (10).
- **Ao receber `main`:** guarda a fila de itens e emite o primeiro lote.
- **Ao receber `continue`:** acumula os itens e emite o próximo lote. Quando a fila acaba, emite `done` com os acumulados.
- `$loop.index` disponível.

### §5 Switch
- **`mode = rules`:**
  - `rules: [{ conditions (formato do If), outputKey? }]` → portas `output0..N`, com o nome exibido = `outputKey`;
  - `options.fallbackOutput`: `none` | `extra` | índice;
  - `options.allMatchingOutputs`.
- **`mode = expression`:** `numberOutputs` e `output` (expressão que retorna o índice).

### §6 Porta de erro e error workflow
- **`onError = errorOutput`:** o nó ganha a porta `error`.
  - Em nós por item, os itens que falharam vão para `error` com `json.error = { message, description, httpCode? }` e os demais para `main`.
  - Em nós "once", a falha envia todos os itens de entrada para `error`.
- **`workflows.error_workflow_id`** (+ `settings.errorWorkflowId`). Ao concluir uma execução `production` com `error`, o worker despacha o error workflow com o item:
  ```json
  { "execution": { "id", "url", "error": { "message", "stack" }, "lastNodeExecuted", "mode" },
    "workflow": { "id", "name" } }
  ```
- **Recursão:** execuções cujo gatilho é `trigger.error` nunca disparam um error workflow.
- `trigger.error` sem parâmetros.

### §7 Frontend
- **Painel do Merge:** modo, número de entradas e campos de join com autocomplete das entradas.
- **Arestas de retorno:** desenhadas com uma curva externa e um traço distinto. A conexão inválida mostra um *tooltip* com a regra.
- **Seletor "Execução i de N"** no painel do nó (dados por `runIndex`). Eventos WebSocket com `runIndex`.
- Rótulos das saídas do Switch e da porta `error`.

### §8 Suíte de referência (`packages/engine/reference/`)
- Formato: `<caso>.json { definition, input, expected: { [nodeName]: Item[] | { runs: Item[][] } }, expectError? }`.
- **Casos mínimos (15):**
  1. If → Merge `append` (ramo vazio);
  2. 3 ramos → `waitAll`;
  3. join `inner`;
  4. join `left`;
  5. join `outer`;
  6. `keepNonMatches`;
  7. `combineByPosition` com `includeUnpaired`;
  8. While de paginação (5 páginas) com acumulação;
  9. While atingindo o limite;
  10. Loop Over Items (25 itens, lote 10);
  11. While com ramos paralelos + Merge no corpo;
  12. Switch com fallback;
  13. Switch `allMatchingOutputs`;
  14. `errorOutput` parcial;
  15. error workflow acionado.
- Cada caso roda com `maxParallel` 1 e 8, e os resultados devem ser idênticos.

## Modelo de dados

- Coluna `workflows.error_workflow_id`.
- `node_executions.run_index` passa a ser usado (já está na chave primária).

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_MAX_LOOP_ITERATIONS` | 10000 | Teto global de iterações |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Laço estruturado com porta `continue` + dominância | Ciclos livres (N8N) | Semântica previsível e validável |
| Join por índice hash | Laço aninhado | Desempenho O(n+m) |

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001–FR-004 | Unidade + referência | `merge.test.ts`, casos 1–7 |
| FR-005–FR-007, FR-009 | Referência | Casos 8, 9, 11 |
| FR-008 | Unidade | `validate-cycles.test.ts` (SC-005) |
| FR-010, FR-016 | E2E | `loops.spec.ts` |
| FR-011 | Referência | Caso 10 |
| FR-012 | Referência | Casos 12–13 |
| FR-013 | Referência | Caso 14 |
| FR-014, FR-015 | Integração | `error-workflow.int.test.ts` (SC-006) |
| FR-017 | Referência | `reference.test.ts` (SC-001) |

## Riscos

| Risco | Mitigação |
|---|---|
| Interação laço × paralelismo | Casos 11 e de paralelismo duplo na suíte |
| Explosão de dados em laços longos | Truncamento por nó e limite de iterações |

Ao concluir, atualizar `docs/execucao.md` (laços, merge, erros).

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 05/10/2026 | §2: a análise de laços (`analyzeLoops`) e as portas dinâmicas (`resolveNodePorts`) ficam em `@olly/shared-types`, usadas pelo motor, pela validação e pelo editor | Uma única regra para os três (o editor não depende do motor) |
| 05/10/2026 | §2: "dominador" verificado como entrada única do ciclo; o nó de laço do ciclo é o que só recebe conexões internas pela `continue`; laços aninhados por recursão sem as arestas de retorno | Para um ciclo alcançável, equivale à dominância e é O(V+E); a regra do nó de laço distingue o externo do interno |
| 05/10/2026 | §2: o nó de laço recebe a `continue` só quando todo o corpo terminou a volta (sem nó em andamento nem laço interno ativo); nós fora do laço esperam o fim e veem a última iteração; `runIndex` também para nós pulados | Determinismo com paralelismo (FR-017) e semântica de "última iteração fora do laço" (FR-009) |
| 05/10/2026 | §3: While sem itens termina (emite `done`), mesmo com a condição verdadeira | Evita voltas vazias até o limite |
| 05/10/2026 | §1: `pairedItem` do Merge aponta o item da primeira entrada que contribuiu (`{ item, input }`) | O `Item` tem um único `pairedItem` |
| 05/10/2026 | §6: item desviado para `error` = item original + `error`; o workflow de erro usa a versão publicada (ou a última salva), também é acionado por `worker_lost`, e o payload não traz `execution.error.stack` | Mantém os dados para tratar o erro; o Olly Flow não expõe a pilha interna |
| 05/10/2026 | §7: a conexão que cria ciclo inválido é feita, mas fica destacada (tracejada, vermelha, com a regra no tooltip) e o editor avisa na hora; o salvamento recusa e destaca os nós | Preserva o comportamento da spec 002 (FR-005: destacar os nós do ciclo ao salvar) |
| 05/10/2026 | §7: portas que deixam de existir (Merge, Switch, saída de erro): confirmação e remoção das conexões no mesmo passo de desfazer | Plano pedia confirmação; o desfazer devolve as conexões |
| 05/10/2026 | §7: configurações do workflow (workflow de erro, timeout, paralelismo) num diálogo do editor | A spec exige indicar o workflow de erro; não havia tela para `settings` |
| 05/10/2026 | §8: 16 casos (o caso 16 cobre `$('Nó')` na iteração atual); o caso 15 executa o workflow de erro com o payload, e o disparo fica no teste de integração | O disparo depende da fila e da API |

