# Relatório — Spec 008: Python, agendamento e nós auxiliares

**Status:** Não implementada (parcial: estado/retomada, `flow.wait` e sub-workflow antecipados para a spec 011)
**Data:** 06/10/2026

## Resumo

Por decisão humana de 06/10/2026, as tarefas T001, T040 e T041 foram implementadas antes da spec 011, porque a aprovação humana e a ferramenta `tool.workflow` do Agent dependem delas:

- **Estado e retomada** (`waiting`): o nó pausa com `NodeWaitSignal`; o motor devolve o snapshot; `execution_state` guarda o estado; a retomada roda em qualquer worker (job `resume` atrasado e varredura de 30 s); cancelar uma execução em espera a encerra.
- **`flow.wait`:** por intervalo ou até uma data/hora; até 60 s em memória, acima disso libera o worker.
- **Sub-workflows:** `trigger.executeWorkflow` (com schema opcional) e `flow.executeWorkflow` (uma vez ou por item, aguardando ou não), com execução filha vinculada ao pai, limite de profundidade (`OLLY_MAX_SUBWORKFLOW_DEPTH`, 5), detecção de recursão e regra de permissão.

O restante da spec (Python, agendamento, reexecução, Stop and Error, paginação, bateria de escape) continua pendente. Os pré-requisitos do roadmap (ADR-0006/runner Python) não mudaram.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `infra/migrations/0011_execution_state.{up,down}.sql`: `execution_state`; `executions.parent_execution_id`, `depth`, `retry_of` |
| T002 | ❌ | Pendente |
| T010–T015 | ❌ | Pendentes (Python) |
| T020–T022 | ❌ | Pendentes (agendamento) |
| T030–T031 | ❌ | Pendentes (reexecução); `retry_of` já existe |
| T040 | ✅ | `packages/nodes/src/trigger/execute-workflow`, `packages/nodes/src/flow/execute-workflow`, `apps/api/src/executions/sub-workflows.ts` |
| T041 | ✅ | `packages/engine/src/state.ts` e `run.ts` (snapshot e retomada), `packages/nodes/src/flow/wait`, `apps/api/src/executions/waits.service.ts`, job `resume` no worker |
| T042 | ❌ | Pendente (`flow.stopAndError`) |
| T050 | ❌ | Pendente (paginação) |
| T090 | ⚠️ | Verificação completa rodada junto com a spec 011 ([report](../011-ai-agent/report.md)) |
| T091 | ⚠️ | Feita só para FR-009 a FR-012 (abaixo) |
| T092 | ⚠️ | Feitos `docs/nos/flow.executeWorkflow.md`, `flow.wait.md` e `trigger.executeWorkflow.md` |
| T093 | ⚠️ | Este relatório parcial; spec e roadmap com status "Em implementação (parcial)" |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-009 | Sim | `packages/nodes/src/flow/execute-workflow/execute-workflow.test.ts` (4 casos FR-009); `apps/api/src/executions/subworkflow.int.test.ts` › "FR-009/SC-006: por item...", "FR-009: uma vez...", "FR-009: alvo não publicado...", "FR-009: sem aguardar..." |
| FR-010 | Sim | `subworkflow.int.test.ts` › "FR-010/SC-006: recursão é bloqueada", "FR-010: o limite de profundidade é aplicado" |
| FR-011 | Sim | `execute-workflow.test.ts` › "FR-011: valida os itens recebidos contra o schema", "FR-011: sem chamador..."; `subworkflow.int.test.ts` › "FR-011: itens fora do schema..." |
| FR-012 | Sim | `packages/engine/src/wait-resume.test.ts` (5 casos); `packages/nodes/src/flow/wait/wait.test.ts` (4 casos); `apps/api/src/executions/wait-resume.int.test.ts` (3 casos) |
| NFR-002 (Wait libera o worker) | Sim | `wait.test.ts` › "NFR-002"; `wait-resume.int.test.ts` › "SC-005" |
| FR-001–FR-008, FR-013–FR-017 | Não | Fora da parte antecipada |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-005 | ✅ | `wait-resume.int.test.ts` › "SC-005: espera de 2 min libera o worker e retoma em outro worker" |
| SC-006 | ✅ | `subworkflow.int.test.ts` (ordem por item, recursão bloqueada) |
| Demais | — | Pendentes |

## Comandos de verificação

Rodados junto com a spec 011: ver a tabela do [relatório da 011](../011-ai-agent/report.md#comandos-de-verificação).

## Decisões tomadas

Registradas no "Histórico de alterações" do [plan.md](plan.md):

- retomada pela fila `executions` (job `resume`) com varredura;
- a filha aguardada roda no mesmo worker do pai;
- regra de permissão do dono;
- filha que entra em espera falha quando aguardada.

Na verificação da 011 também:

- o nó `flow.executeWorkflow` passou a se chamar **"Executar sub-workflow"**, porque o nome antigo coincidia com o botão "Executar workflow" do editor;
- o `SubWorkflowService` resolve a fila por token (`SUBWORKFLOW_QUEUE`), sem importar a classe, o que eliminou um ciclo de importação no build ESM;
- o estado da espera é gravado antes de a execução aparecer como `waiting`.

## Desvios da spec/plano

Ver o Histórico do [plan.md](plan.md). Nenhum requisito mudou.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- Todo o restante da spec (Python, agendamento, reexecução, Stop and Error, paginação, bateria de escape de sandbox) e os pré-requisitos humanos do roadmap.
- A memória temporária do Agent (spec 011) não sobrevive a uma espera: o estado guarda só o snapshot do motor.

## Como demonstrar

1. Workflow A: gatilho "Quando chamado por outro workflow" → "Definir campos"; publique.
2. Workflow B: Manual → "Executar sub-workflow" (escolha A) → "Esperar" (3 minutos) → "Definir campos".
3. Execute B: a execução fica "aguardando" (o worker fica livre) e retoma depois do prazo; a execução filha aparece vinculada.

## Próximos passos sugeridos

Implementar as tarefas pendentes quando os pré-requisitos humanos forem atendidos.
