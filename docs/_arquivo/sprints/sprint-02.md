# Sprint 2 — Expressões, variáveis e execução de teste

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também os relatórios em `docs/relatorios/` (Sprints 0 e 1) e a seção 5.3 de `docs/analise_implementacao.md`.

## Pré-requisitos

- Sprint 1 concluída e todos os comandos da seção 8 passando.
- **Humano (desejável):** fixtures reais da POC em `fixtures/n8n/`. Elas são a referência de compatibilidade.

## Contexto

A transferência de valores entre nós é feita por **expressões** com a mesma sintaxe do N8N (ADR-001). O usuário testa o workflow no editor e vê, em tempo real, os itens de entrada e saída de cada nó. Expressões são código de usuário e, portanto, **rodam em sandbox**.

## Objetivo

Motor de expressões compatível com o N8N rodando em isolated-vm, nós `logic.if` e `data.setVariable`, execução de teste com eventos em tempo real e log de execução persistido.

## Tarefas

### T1 — Convenção de parâmetros com expressão
- Igual ao N8N: um valor string que **começa com `=`** é uma expressão-template (ex.: `"=Olá {{ $json.nome }}"`). Qualquer outro valor é literal.
- Se o template for **exatamente** um único `{{ ... }}`, o resultado mantém o tipo (número, objeto, array, booleano). Caso contrário, o resultado é string concatenada. Objetos dentro de template misto viram JSON.
- Documente em `docs/expressoes.md`.

### T2 — `apps/task-runner` + `packages/expressions`
- `apps/task-runner`: processo Node separado, iniciado e supervisionado pela API (reinicia se morrer). Comunicação via IPC (`child_process.fork`) com mensagens JSON tipadas (`evaluateBatch`, `runCode`, a partir da Sprint 4).
- Dentro do runner, use **isolated-vm**:
  - um `Isolate` por execução de workflow (limite de 128 MB), reaproveitado entre os nós da mesma execução e descartado no fim;
  - timeout de **100 ms por expressão**.
- **Avaliação em lote:** uma chamada avalia todos os parâmetros do nó para todos os itens, para evitar o custo de IPC por item.
- `packages/expressions` contém:
  - o parser de templates (extrair os trechos `{{ }}`, com suporte a `}}` dentro de strings);
  - o montador do contexto de dados;
  - a interface `ExpressionEvaluator`.
- Nenhum acesso a `require`, `process`, `globalThis` do host, rede ou sistema de arquivos dentro do isolate.

### T3 — Variáveis disponíveis nas expressões
- `$json`, `$binary` (somente metadados), `$itemIndex`.
- `$input.all()`, `$input.first()`, `$input.last()`, `$input.item`.
- `$('Nome do Nó')` com `.item`, `.all()`, `.first()`, `.last()` e `.params`; legado `$node["Nome"].json`.
- **`.item` usa *paired items*:** cada item de saída carrega `pairedItem: { item: n }` apontando para o item de entrada que o originou. `$('X').item` segue essa cadeia até o nó X. Nós que geram 1 saída por entrada preenchem `pairedItem` automaticamente (helper no engine). Se a cadeia não puder ser resolvida, lance um `ExpressionError` com mensagem clara, como o N8N faz.
- `$vars`: variáveis da execução, escritas pelo nó `data.setVariable`. **Divergência do N8N** (lá `$vars` é global e somente leitura); documente.
- `$env`: somente variáveis de ambiente com prefixo `OLLY_EXPOSED_` (sem o prefixo). **Nunca** exponha o `process.env` completo.
- `$execution.id`, `$execution.mode` (`test` | `production`), `$workflow.id`, `$workflow.name`.
- `$now` e `$today` como `DateTime` do Luxon. Disponibilize `DateTime`, `Duration` e `Interval` do Luxon dentro do isolate.
- Mensagens de erro de expressão incluem o nó, o parâmetro e o trecho com problema.

### T4 — Integração com o engine
- Antes de executar um nó, o engine resolve os parâmetros com expressões via `ExpressionEvaluator`, por item. O nó recebe `getParam(name, itemIndex)`, igual ao `getNodeParameter` do N8N.
- O contexto de dados (saídas dos nós anteriores) é mantido pelo `ExecutionState` e serializado para o isolate sob demanda (passe apenas os nós referenciados na expressão, detectados pelo parser, quando possível).

### T5 — Suíte de compatibilidade (`packages/expressions/compat.test.ts`)
- Pelo menos 60 casos cobrindo todas as variáveis da T3, tipos de retorno, templates mistos, erros e Luxon.
- Para cada fixture em `fixtures/n8n/` que use apenas nós já implementados, um teste que executa o workflow convertido manualmente e compara com `expected.json`.

### T6 — Nós
- **`data.set` (atualização):** valores aceitam expressões; adicione o modo `includeOtherFields: boolean` (substitui o `keepOnlySet`, mantendo compatibilidade).
- **`data.setVariable`:** parâmetros `variables: [{ name, value }]`. Grava em `$vars` e repassa os itens sem alteração.
- **`logic.if`:**
  - Parâmetros no formato do If v2 do N8N: `conditions: { combinator: 'and'|'or', conditions: [{ leftValue, operator: { type, operation }, rightValue }] }` e `looseTypeValidation: boolean`.
  - Tipos e operações:

    | Tipo | Operações |
    |---|---|
    | string | `equals`, `notEquals`, `contains`, `notContains`, `startsWith`, `endsWith`, `regex`, `isEmpty`, `isNotEmpty` |
    | number | `equals`, `notEquals`, `gt`, `gte`, `lt`, `lte`, `isEmpty`, `isNotEmpty` |
    | boolean | `true`, `false`, `equals` |
    | dateTime | `equals`, `after`, `before` |
    | array | `contains`, `lengthEquals`, `isEmpty`, `isNotEmpty` |
    | object | `isEmpty`, `isNotEmpty` |

  - Avaliado **por item**. Saídas `true` e `false`.

### T7 — Persistência do log de execução
- Migrations de `executions` e `node_executions`, **particionadas por mês** (seção 10 da análise). Crie as partições do mês corrente e dos 2 meses seguintes, e uma função SQL `olly_ensure_partitions()` chamada na inicialização da API.
- Gravar:
  - **execução:** status (`queued`, `running`, `success`, `error`, `cancelled`), modo, gatilho, usuário, versão, início, fim e erro;
  - **por nó:** status, início, fim, `items_in`, `items_out`, `input_data`, `output_data` e erro com stack.
- Limite de tamanho de `input_data`/`output_data` por nó (ex.: 1 MB). Acima disso, grave um resumo truncado com `truncated: true`.

### T8 — Execução de teste
- `POST /api/v1/workflows/:id/test-run` (`workflow:execute`). O corpo traz `definition` (permite testar sem salvar), `pinData` opcional e `destinationNodeId` opcional (executar até o nó X).
- Responde imediatamente com `executionId` e executa de forma assíncrona no processo da API.
- **WebSocket** (namespace `/executions`, autenticado com o mesmo JWT). O cliente entra na sala `execution:<id>` e recebe `executionStarted`, `nodeStarted`, `nodeFinished` (status, contagem de itens, duração, dados truncados) e `executionFinished`.
- O usuário só entra na sala se tiver `execution:read` no projeto.

### T9 — *Pin data*
- Acrescente `pinData?: Record<nodeId, Item[]>` ao `WorkflowDefinition` (alteração de contrato: registre no relatório).
- Nó com pin data não executa: emite os itens fixados. No canvas, indique o nó com pin data.

### T10 — Frontend: painel do nó (estilo NDV do N8N)
- Painel em três colunas: **Entrada** (saída do nó anterior na última execução) | **Parâmetros** | **Saída**.
- Visões **Tabela**, **JSON** e **Schema** para entrada e saída.
- Botões "Executar workflow" (no canvas) e "Executar até este nó" (no painel). Status no canvas em tempo real: executando, sucesso com contagem de itens, ou erro com mensagem.
- Botão "Fixar dados" (pin) na saída, com edição do JSON fixado.

### T11 — Frontend: editor de expressões
- Cada campo de parâmetro tem um alternador **Fixo / Expressão**.
- No modo expressão, use um editor Monaco de uma linha (expansível em modal) com destaque de `{{ }}`.
- **Autocomplete** de `$json.*`, `$('Nó').item.json.*`, `$vars.*`, `$input`, `$execution` e `$now`, usando o schema inferido da última execução.
- **Preview** do resultado para o item 0, avaliado via API (`POST /api/v1/expressions/preview`, `workflow:execute`).
- **Arrastar** um campo da coluna Entrada (visão Schema ou Tabela) para um parâmetro insere `{{ $json.campo }}`, ou `{{ $('Nó').item.json.campo }}` se o campo vier de um nó não imediatamente anterior.

## Fora do escopo

Credenciais, HTTP, Postgres, webhooks, código JS, fila e paralelismo.

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | Executar `Manual → Set → If` pelo editor mostra o status e os dados de cada nó em tempo real | E2E `test-run.spec.ts` |
| 2 | Suíte de compatibilidade com ≥ 60 casos verde; fixtures aplicáveis verdes | `compat.test.ts` |
| 3 | `{{ (() => { while(true){} })() }}` é interrompida por timeout e a API continua respondendo | Integração |
| 4 | `{{ process.env }}`, `{{ require('fs') }}` e `{{ this.constructor.constructor('return process')() }}` não acessam o host | Integração de segurança |
| 5 | `$env` expõe apenas variáveis `OLLY_EXPOSED_*` | Unitário |
| 6 | `$('Nó').item` resolve corretamente após um If que filtra itens | Unitário no engine |
| 7 | Execução registrada em `executions` e `node_executions` com status, duração e contagens | Integração |
| 8 | Usuário sem `execution:read` não consegue entrar na sala WebSocket da execução | Integração |
| 9 | Arrastar campo da entrada para um parâmetro gera a expressão correta | E2E |

## Entrega

Código, `docs/expressoes.md`, `docs/nos/logic.if.md`, `docs/nos/data.setVariable.md`, `docs/nos/data.set.md` atualizado e o relatório `docs/relatorios/sprint-02.md`.
