# Relatório — Spec 007: Controle de fluxo: Merge, While, Switch e erros

**Status:** Implementada
**Data:** 05/10/2026

## Resumo

- **Laços estruturados no motor:**
  - ciclos só pela porta `continue` de um While/Loop Over Items que é a única entrada do ciclo;
  - laços aninhados;
  - cada volta reabre o corpo;
  - registro por iteração (`runIndex`), `$('Nó')` na iteração atual e `$loop` (`index`, `maxIterations`, `accumulated`);
  - limite por nó e teto global.
- **Novos nós:**
  - `logic.merge`: 2–10 entradas; `append`, `combineByPosition`, `combineByFields` (inner/left/outer/keepNonMatches, índice hash), `chooseBranch`, `waitAll`; `waitFor` e `clashHandling`;
  - `logic.while`;
  - `logic.loopOverItems` (compatível com Split in Batches v3);
  - `logic.switch`: regras do If ou índice, fallback, todas as verdadeiras;
  - `trigger.error`.
- **Erros como fluxo:**
  - `onError = errorOutput` cria a saída `error` (por item em Set, HTTP e Postgres; os demais desviam tudo);
  - workflow de erro acionado nas falhas de produção, com o payload do Error Trigger do N8N e sem recursão.
- **Editor:**
  - portas dinâmicas, com confirmação ao remover conexões;
  - arestas de retorno tracejadas por baixo dos nós;
  - ciclo inválido destacado com a regra;
  - seletor "Execução i de N";
  - rótulos de entradas e saídas;
  - opção "Desviar para a saída de erro";
  - diálogo de configurações do workflow (workflow de erro, timeout, paralelismo).
- **Semântica fixada:** suíte de referência (16 casos × paralelismo 1 e 8) e [`docs/execucao.md`](../../docs/execucao.md).

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `infra/migrations/0008_error_workflow`; `packages/engine/reference/` |
| T010 | ✅ | `packages/shared-types/src/graph.ts` (`analyzeLoops`); `validate.ts` (`INVALID_CYCLE`) |
| T011 | ✅ | `packages/engine/src/state.ts` (laço ativo, reabertura do corpo, `continue` com o corpo quieto, `runIndex`), `run.ts` |
| T012 | ✅ | `$loop` no escopo de expressões (`ExpressionData.loop`, prelude, código JS, protocolo do task runner) |
| T020 | ✅ | `packages/nodes/src/logic/while/` |
| T021 | ✅ | Casos 08, 09, 11 (e 16) |
| T030 | ✅ | `packages/shared-types/src/ports.ts` (`resolveNodePorts`, `dynamicPorts`) no motor, na validação e no canvas; `apps/web/src/editor/port-guard.ts` |
| T031 | ✅ | `packages/nodes/src/logic/merge/` |
| T032 | ✅ | Casos 01–07 |
| T033 | ✅ | Painel do Merge pelo formulário do schema (campos por modo) — sem autocomplete dos campos de join (ver Pendências) |
| T040 | ✅ | Saída `error` no motor (`executeWithResilience`) e por item em `data.set`, `http.request`, `postgres.query`, `postgres.write`; opção na aba Configurações |
| T041 | ✅ | `trigger.error`; `apps/api/src/executions/error-workflow.ts` (worker e varredura `worker_lost`); validação ao salvar |
| T042 | ✅ | Caso 14; `apps/api/src/executions/flow-control.int.test.ts` |
| T050 | ✅ | `packages/nodes/src/logic/loop-over-items/` + caso 10 |
| T051 | ✅ | `packages/nodes/src/logic/switch/` + casos 12–13 (condições do If extraídas para `logic/if/conditions.ts`) |
| T060 | ✅ | `workflow-edge.tsx`, `workflow-node.tsx`, `loops.ts`, `node-details-view.tsx`, `workflow-settings.tsx` |
| T090 | ✅ | `packages/engine/src/reference.test.ts` |
| T091 | ✅ | Ver "Comandos de verificação" |
| T092 | ✅ | `docs/nos/logic.merge.md`, `logic.while.md`, `logic.loopOverItems.md`, `logic.switch.md`, `trigger.error.md`; `docs/nos/README.md`, `docs/execucao.md`, `contratos.md`, `modelo-dados.md`, `.env.example` |
| T093 | ✅ | Este relatório |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `packages/shared-types/src/graph.test.ts` › "FR-001…"; `logic/merge/merge.test.ts` (3 entradas); `apps/web/src/editor/port-guard.test.ts`; `apps/web/e2e/loops.spec.ts` (3 entradas no canvas); casos 02 e 07 |
| FR-002 | Sim | `merge.test.ts`; casos 01–07 (`reference.test.ts`) |
| FR-003 | Sim | `merge.test.ts` › "conflito de campos" e "anyWithData"; caso 07 |
| FR-004 | Sim | Casos 01 e 02 (`runs: 1`) |
| FR-005 | Sim | `logic/while/while.test.ts`; casos 08 e 11 |
| FR-006 | Sim | `while.test.ts` › "FR-006"; caso 09 |
| FR-007 | Sim | Caso 08 (`$loop.index`, `$loop.maxIterations`); `loops.test.ts` › "FR-007…" |
| FR-008 | Sim | `graph.test.ts` (laço válido, sem nó de laço, volta pela principal, entrada no meio, aninhados); `engine/src/validate.test.ts`; `loops.test.ts` › "ciclo inválido"; `flow-control.int.test.ts` › "SC-005" |
| FR-009 | Sim | `loops.test.ts` › "runIndex"; casos 08, 11 e 16; `flow-control.int.test.ts` › "FR-009" (API e WebSocket) |
| FR-010 | Sim | `apps/web/e2e/loops.spec.ts` (seletor "Execução i de N") |
| FR-011 | Sim | `while.test.ts` › "FR-011"; caso 10 |
| FR-012 | Sim | `logic/switch/switch.test.ts`; casos 12 e 13; `graph.test.ts` (portas) |
| FR-013 | Sim | `data/set/set.test.ts` › "FR-013"; caso 14; `graph.test.ts` (porta `error`) |
| FR-014 | Sim | `flow-control.int.test.ts` › "SC-006…" e "falha em execução de teste não aciona"; caso 15 |
| FR-015 | Sim | `flow-control.int.test.ts` › "FR-015…" (sem recursão; validação ao salvar) |
| FR-016 | Sim | `apps/web/src/editor/loops.test.ts`; `apps/web/e2e/loops.spec.ts` (aresta de retorno distinta; ciclo inválido destacado com a regra; salvar recusa); `e2e/editor.spec.ts` (spec 002, destaque ao salvar) |
| FR-017 | Sim | `reference.test.ts`: cada caso com `maxParallel` 1 e 8, resultados e número de execuções idênticos |
| NFR-001 | Sim | `loops.test.ts` › "NFR-001"; `config.test.ts` › "spec 007" |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `reference.test.ts`: 16 casos × 2 níveis de paralelismo |
| SC-002 | ✅ | Caso 08: 5 páginas acumuladas em `done` |
| SC-003 | ✅ | Caso 09 e `while.test.ts`: "Limite de 3 iterações atingido" |
| SC-004 | ✅ | Caso 04 e `merge.test.ts` › "SC-004": join à esquerda por `cpf` entre ramos paralelos |
| SC-005 | ✅ | `graph.test.ts`, `flow-control.int.test.ts` (422 `INVALID_CYCLE` com os nós), `loops.spec.ts` |
| SC-006 | ✅ | Caso 14 (`errorOutput` parcial); `flow-control.int.test.ts` › "SC-006" (payload: `execution.id`, `url`, `lastNodeExecuted`, `mode`, `workflow.id/name`) |

## Comandos de verificação

Executados em 05/10/2026.

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 525 testes (nodes 139, expressions 124, engine 88, web 63, repositório 51, api 27, shared-types 20, task-runner 8, db 5) |
| `pnpm test:integration` | ✅ 203 testes (api 156, nodes 23, db 21, engine 3) |
| Regressão sequencial (`OLLY_DEFAULT_MAX_PARALLEL=1`, integração da API) | ✅ 156 testes |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 28 testes (1 novo: `loops.spec.ts`) |
| `docker compose up -d && pnpm smoke` | ✅ |
| `pnpm audit --audit-level=high` | ✅ 0 altas; 1 moderada (`uuid`, via Testcontainers, só testes; já registrada) |

## Decisões tomadas

Registradas no "Histórico de alterações" de `plan.md` (05/10/2026):

- **Regras compartilhadas:** `analyzeLoops` e `resolveNodePorts` ficam em `@olly/shared-types`. O motor, a validação ao salvar e o editor usam a mesma regra.
- **Dominância:** verificada como "entrada única do ciclo", que para ciclos alcançáveis equivale à dominância.
  - **Nó de laço do ciclo:** o que só recebe conexões internas pela `continue`.
  - **Aninhamento:** tratado por recursão sem as arestas de retorno.
- **Determinismo com paralelismo:**
  - o nó de laço só recebe a `continue` quando todo o corpo terminou a volta;
  - nós fora do laço esperam o fim e veem a última iteração.
- **Portas dinâmicas declarativas:** `dynamicPorts: { kind: 'mergeInputs' | 'switchOutputs' }` vai ao editor junto com o tipo do nó; não há função no catálogo.
- **Saída `error`:** o item desviado é o item original com `error`.
- **Workflow de erro:**
  - enfileirado pelo worker; a varredura de `worker_lost` também o aciona;
  - usa a versão publicada (ou a última salva);
  - execuções com `triggerType: 'error'` nunca acionam outro;
  - `settings.errorWorkflowId` é validado ao salvar (mesmo projeto, outro workflow, com `trigger.error`) e espelhado em `workflows.error_workflow_id`.
- **Editor:**
  - **Ciclo inválido:** a conexão é feita, mas fica destacada com a regra no tooltip, e o editor avisa na hora. O salvamento recusa e destaca os nós, como manda a spec 002 (FR-005).
  - **Portas que somem:** pedem confirmação, e as conexões são removidas no mesmo passo de desfazer.
- **Novas variáveis:** `OLLY_MAX_LOOP_ITERATIONS` (10 000) e `OLLY_PUBLIC_URL` (link `execution.url` do workflow de erro).
- **Código de erro de ciclo:** `CYCLE` → `INVALID_CYCLE` (nome do plano). Os testes da spec 002 foram atualizados.

## Desvios da spec/plano

- **Pré-requisitos:** a 007 não tinha pré-requisitos humanos. O cabeçalho da spec estava como "Validada" (status fora do fluxo do AGENTS.md); foi tratado como aprovação para implementar, passou a "Em implementação" e agora está "Implementada".
- **Spec 006:** a 006 continua Implementada (não Verificada) no roadmap.
- **Spec:** o Histórico registra dois esclarecimentos:
  - o ciclo inválido é desenhado e destacado, e o salvamento o recusa (FR-016);
  - `worker_lost` também aciona o workflow de erro.
- **Plano:** o Histórico registra:
  - While sem itens termina;
  - `pairedItem` do Merge aponta a primeira entrada;
  - o payload do workflow de erro não traz `stack`;
  - 16 casos de referência.
- **Nenhum requisito ficou de fora.**

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- **Painel do Merge:** os campos de join não têm autocomplete com os campos das entradas (plan §7). Hoje são texto livre com notação de ponto. Fica como melhoria.
- **`execution.error.stack`:** ausente no payload do workflow de erro. Workflows importados do N8N que leem esse campo recebem `undefined`.
- **Dados em laços longos:** cada iteração grava uma linha por nó em `node_executions`, com truncamento por nó. Laços de milhares de voltas geram muitas linhas; retenção e limpeza ficam para a spec 009.
- **Herdadas:**
  - SC-001 da spec 005 (fixtures reais da POC);
  - escuta do webhook de teste e rate limit em memória por instância da API (spec 006);
  - hospedagem do Redis no OpenShift.

## Como demonstrar

1. `pnpm app:up` e abrir <http://localhost:5173> como `editor@olly.local`/`olly123`.
2. **While:**
   1. monte Manual → **Enquanto** (condição `={{ $loop.index < 5 }}`, Saída em Concluído = `appendBodyOutput`) → Laço → **Definir campos** (`page = {{ $loop.index + 1 }}`) → de volta à entrada **Continuar**;
   2. ligue Concluído → outro nó e execute;
   3. a volta aparece tracejada e o nó final recebe 5 itens;
   4. no painel do Definir campos, "Execução 1 de 5…".
3. **Ciclo inválido:** ligue um nó do corpo à entrada principal do While. A conexão fica vermelha ("ciclo inválido", com a regra no tooltip) e salvar recusa.
4. **Merge:** dois ramos → **Juntar** (modo `combineByFields`, `cpf`/`cpf`, `left`); mude "Número de entradas" para 3 e de volta (confirmação).
5. **Saída de erro:** num nó HTTP, Configurações → "Desviar para a saída de erro": a saída **Erro** aparece; os itens com falha seguem por ela.
6. **Workflow de erro:**
   1. crie um workflow Gatilho de erro → Definir campos;
   2. no workflow vigiado, abra **Configurações** e escolha-o;
   3. publique o workflow vigiado e faça-o falhar por webhook;
   4. em **Execuções**, a execução com gatilho `error` mostra o payload.

## Próximos passos sugeridos

- Autocomplete dos campos de join do Merge a partir do esquema das entradas.
- Visão de "laço" no canvas (moldura ao redor do corpo) e contagem de voltas no nó de laço.
- Retenção e compactação das iterações no log (spec 009).
