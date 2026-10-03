# Sprint 6 — Merge, While e controle de fluxo

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também os relatórios em `docs/relatorios/`, `docs/execucao.md` e as seções 6.3 e 6.9 de `docs/analise_implementacao.md`.

## Pré-requisitos

- Sprint 5 concluída e todos os comandos da seção 8 passando.

## Contexto

Com o paralelismo pronto, os workflows precisam **juntar ramos** (Merge), **repetir trechos** (While/loops), **rotear por regras** (Switch) e **tratar erros como fluxo**. Os loops quebram o modelo de DAG puro, então a semântica deve ser rigorosa e bem testada.

## Objetivo

Nós `logic.merge` (N entradas), `logic.while`, `logic.loopOverItems` e `logic.switch`, porta de erro, *error workflow* e uma suíte de workflows de referência que fixa a semântica do motor.

## Tarefas

### T1 — Nó `logic.merge`
- **Número de entradas configurável**: `numberInputs` de 2 a 10. As portas são `input1..inputN` e são recriadas no canvas ao alterar o parâmetro.
- **Modos:**

  | `mode` | Comportamento |
  |---|---|
  | `append` | Concatena os itens de `input1` até `inputN`, nessa ordem |
  | `combineByPosition` | Item i de cada entrada → um item (*merge* raso dos `json`). Opção `includeUnpaired` |
  | `combineByFields` | Join por campos: `fields: [{ input1Field, input2Field }]`, `joinMode`: `inner` \| `left` \| `outer` \| `keepNonMatches`. Somente 2 entradas; valide |
  | `chooseBranch` | Emite os itens da entrada `output: inputK` (ou um item vazio) |
  | `waitAll` | Barreira: aguarda todas as entradas e emite os itens de `input1` |

- **Opção `waitFor`:** `allConnected` (padrão; aguarda todas as entradas conectadas, considerando "sem dados" como resolvida) | `anyWithData` (executa quando todas foram resolvidas, usando apenas as que têm itens).
- Conflito de campos no *merge* raso: opção `clashHandling` (`preferInput1` | `preferLast` | `addSuffix`).
- Ajuste o engine se necessário para que o Merge execute **uma única vez** por execução (fora de loops) após todas as entradas resolvidas.

### T2 — Nó `logic.while` (loop estruturado)
- **Portas:**
  - entradas `main` (entrada inicial) e `continue` (retorno do corpo);
  - saídas `loop` (corpo) e `done` (fim).
- **Parâmetros:**
  - `condition` (expressão booleana, avaliada com `$loop` disponível);
  - `maxIterations` (padrão 100; teto global `OLLY_MAX_LOOP_ITERATIONS`, padrão 10 000);
  - `accumulate`: `none` | `appendBodyOutput`.
- **Semântica:**
  1. Ao receber `main`, define `$loop.index = 0` e avalia `condition`. Se `true`, emite os itens em `loop`; se `false`, emite em `done`.
  2. Ao receber `continue`, incrementa `$loop.index`, acumula os itens se `accumulate = appendBodyOutput` e reavalia a condição usando os itens recebidos em `continue` como `$json`/`$input`.
  3. Ao atingir `maxIterations`, a execução falha com erro claro (não emite `done` silenciosamente).
  4. `done` emite os itens acumulados (se houver acumulação) ou os últimos itens recebidos.
- Variáveis `$loop.index`, `$loop.accumulated` e `$loop.maxIterations` estão disponíveis nas expressões dos nós do corpo.
- **Engine:**
  - nós do corpo podem executar várias vezes. Cada execução recebe um `run_index` incremental;
  - `$('Nó')` dentro do corpo referencia a **iteração atual**;
  - fora do corpo, referencia a última iteração.
- **Validação estrutural** (atualize `validate.ts`): ciclos são permitidos **somente** quando:
  - a aresta de retorno termina na porta `continue` de um While;
  - o While domina todos os nós do ciclo.

  Qualquer outro ciclo continua proibido.

### T3 — `run_index` e iterações
- `node_executions.run_index` passa a ser usado. A chave primária já contempla esse campo; confira a migration.
- Painel do nó: seletor "Execução 1 de N" para navegar pelas iterações.
- WebSocket: eventos incluem `runIndex`.

### T4 — Nó `logic.loopOverItems` (split in batches)
- **Portas:** entrada `main` e `continue`; saídas `loop` e `done`. Mesmo mecanismo de ciclo do While.
- `batchSize` (padrão 10): a cada iteração emite o próximo lote em `loop`; ao fim, `done` emite todos os itens recebidos em `continue`, acumulados.
- Compatível com o `splitInBatches` v3 do N8N. Isso será usado pelo importador na Sprint 11.

### T5 — Nó `logic.switch`
- `mode`:
  - `rules`: lista de regras com as mesmas condições do If; cada regra é uma porta de saída `output0..outputN`, com nome opcional;
  - `expression`: expressão que retorna o índice da saída.
- `options`:
  - `fallbackOutput`: `none` | `extra` (porta adicional) | `outputK`;
  - `allMatchingOutputs`: o item vai para todas as regras verdadeiras, não só a primeira.

### T6 — Porta de erro e *error workflow*
- `settings.onError = 'errorOutput'`: o nó ganha uma porta de saída extra `error`. Itens com falha vão para ela com `json.error = { message, description, httpCode? }`, e os itens com sucesso seguem em `main`. Habilite a opção na UI.
- **Error workflow:** `workflows.error_workflow_id`. Quando uma execução de produção termina com `error`, o dispatcher enfileira o error workflow com o item:
  ```json
  { "execution": { "id", "url", "error", "lastNodeExecuted", "mode" },
    "workflow": { "id", "name" } }
  ```
  É o mesmo formato do Error Trigger do N8N.
- Nó `trigger.error` (gatilho do error workflow).
- Proteção contra recursão: o error workflow não dispara a si mesmo nem a outro error workflow.

### T7 — Frontend
- Painel do Merge: seletor de modo e quantidade de entradas, com campos de join usando autocomplete dos campos das entradas.
- Canvas:
  - arestas de retorno desenhadas por baixo/por fora, com estilo distinto;
  - ao tentar criar um ciclo inválido, mostre uma mensagem explicando a regra.
- Visualização das saídas nomeadas do Switch e da porta `error`.

### T8 — Suíte de workflows de referência (`packages/engine/reference/`)
- Pelo menos 15 workflows em JSON, com entrada e saída esperada, cobrindo:
  - If → dois ramos → Merge `append` (incluindo ramo vazio);
  - 3 ramos paralelos → Merge `waitAll`;
  - `combineByFields` nos modos inner/left/outer;
  - While de paginação (HTTP mock com 5 páginas) com acumulação;
  - While atingindo `maxIterations`;
  - loopOverItems com 25 itens e lote 10;
  - While contendo ramos paralelos e Merge dentro do corpo;
  - Switch com fallback e `allMatchingOutputs`;
  - `errorOutput` com itens parcialmente falhos;
  - error workflow acionado.
- Cada caso roda com `maxParallel = 1` **e** `maxParallel = 8`, e o resultado precisa ser idêntico.

## Fora do escopo

Python, cron, sub-workflow e Wait.

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | Suíte de referência (≥ 15 casos × 2 níveis de paralelismo) verde | `reference.test.ts` |
| 2 | Paginação com While acumula todos os itens das 5 páginas e emite em `done` | Referência |
| 3 | While que atinge `maxIterations` falha com erro explícito | Referência |
| 4 | Ramos Postgres + HTTP em paralelo unidos por `combineByFields` (left join) | Integração |
| 5 | Ciclo que não passa pela porta `continue` de um While é rejeitado | Unitário |
| 6 | Erro em nó com `errorOutput` desvia os itens; sem a porta, dispara o error workflow com o payload correto | Integração |
| 7 | Painel do nó permite navegar entre as iterações (`run_index`) | E2E |
| 8 | Toda a suíte das sprints anteriores verde | CI |

## Entrega

Código, `docs/execucao.md` atualizado (loops, merge, erros), `docs/nos/logic.merge.md`, `docs/nos/logic.while.md`, `docs/nos/logic.loopOverItems.md`, `docs/nos/logic.switch.md`, `docs/nos/trigger.error.md` e o relatório `docs/relatorios/sprint-06.md`.
