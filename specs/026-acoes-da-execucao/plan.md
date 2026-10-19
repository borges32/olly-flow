# Plano técnico — Spec 026: Ações da execução: excluir e ver o log

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Banco:** migration `0018_execution_parent_node` acrescenta `executions.parent_node_id` (nó que criou a subexecução).
- **Motor:** o contexto do nó acrescenta `nodeId` à chamada de sub-workflow; a API grava em `parent_node_id`.
- **API:**
  - `GET /executions/:id` passa a trazer `subExecutions`;
  - rota nova `DELETE /executions/:id`, com a permissão nova `execution:delete`;
  - a remoção completa de execuções sai da manutenção (spec 009) para uma função compartilhada.
- **Web:** menu de ações na tela Execuções (Log, Excluir); modal de log com filtros, cópia e downloads.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III — Segurança | Rota nova com RBAC (`execution:delete`); exclusão auditada; SQL só pelo Kysely (parametrizado); o log não mostra entrada, saída nem segredos |
| IV — Testes | Integração (rota, permissões, auditoria, remoção completa, vínculo da subexecução), unidade (linhas do log, filtros, texto, JSON) e E2E (menu, log, exclusão) |
| VI — LGPD e auditoria | A exclusão remove os dados da execução (inclusive objetos no S3), como a retenção, e fica na auditoria |
| IX — Simplicidade | Sem dependência nova: menu e modal com os componentes existentes |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `infra/migrations` | `0018_execution_parent_node` (up/down) |
| `packages/db` | `executions.parent_node_id` no schema; testes de migration |
| `packages/shared-types` | `execution:delete`; `SubExecutionRef` e `ExecutionDetail.subExecutions` |
| `packages/nodes` | `nodeId?` na chamada do `SubWorkflowGateway` |
| `packages/engine` | `subWorkflows()` do contexto acrescenta `nodeId` |
| `apps/api` | `sub-workflows.ts` (grava `parent_node_id`); `executions.service`/`controller` (detalhe e exclusão); `executions/purge.ts` (remoção compartilhada); manutenção usa a função |
| `apps/web` | `executions/execution-log.ts` (linhas, filtro, texto) e `execution-log-dialog.tsx`; `executions-page.tsx` (menu, confirmação) |
| `docs/` | `contratos.md` (rota, permissão, `subExecutions`), `modelo-dados.md` (coluna, migration), matriz de permissões |

## Design

### §1 Banco e motor

- `ALTER TABLE executions ADD COLUMN parent_node_id TEXT` (a tabela é particionada; a coluna vale para as partições). Down: `DROP COLUMN`.
- `SubWorkflowGateway.run` aceita `nodeId?: string`. No motor, `subWorkflows()` devolve o gateway com `run` envolvido: `run(r) => gateway.run({ ...r, nodeId: node.id })`.
- `SubWorkflows.createExecution` grava `parent_node_id: request.nodeId ?? null`.

### §2 API

- **Detalhe:** `subExecutions: { id, workflowId, workflowName, nodeId, status, startedAt }[]`, as execuções com `parent_execution_id = :id` (pelo índice `executions_parent_idx`), em ordem de início.
- **`DELETE /executions/:id`** (`execution:delete`, por projeto da execução):
  - 404 se não existe; 409 se `queued`, `running` ou `waiting` ("pare a execução antes de excluir");
  - remove com `purgeExecutions(db, storage, ids)`: objetos do S3 (`executions/<id>/`), `node_executions`, `execution_payloads`, `execution_state`, `mcp_calls`, `agent_steps`, `approval_requests` e `executions`. `llm_usage` fica (contabilidade e cota);
  - audita `execution.delete` com `{ executionId, workflowId, status }`; 204.
- **Manutenção** (spec 009): o passo de metadados passa a chamar `purgeExecutions`.
- **Permissão:** `execution:delete` no catálogo; o editor recebe por padrão (todas menos as de administração), o admin tem todas. O seed (db-init) atualiza os papéis.

### §3 Web

- **Menu de ações** (`ExecutionActions`): botão "Ações da execução" (ícone de reticências) nas execuções terminadas; menu com "Log" e, com `execution:delete` no projeto, "Excluir". Fecha com Esc, clique fora ou escolha.
- **Excluir:** diálogo de confirmação ("Excluir a execução? Os dados dela são removidos e não há como desfazer."); depois, invalida a lista.
- **Log** (`ExecutionLogDialog`): busca `GET /executions/:id` ao abrir.
  - **Cabeçalho:** "Log — execução <8 primeiros caracteres>" · workflow; status · modo · gatilho · início → fim · duração.
  - **Linhas** (`logRows`): uma por `NodeExecutionDetail`, na ordem da API: horário `HH:mm:ss,SSS`, nome, tipo (da definição executada), status, duração, `itemsIn → itemsOut`, erro, iteração do laço (`#n` quando `runIndex > 0`) e subexecução (`subExecutions` com o mesmo `nodeId`). A falha geral da execução vira uma linha final.
  - **Subexecuções sem nó correspondente** (ex.: ferramenta do Agent): seção "Subexecuções".
  - **Filtros:** status ("Todos os eventos", Sucesso, Erro, Sem dados, Aguardando, Interrompido) e texto (nome, tipo, mensagem).
  - **Ações:** Copiar (`logText`), `.txt`, `.json` (`logJson`: cabeçalho e linhas filtradas) e "Abrir execução" (`/executions/:id`).

## Modelo de dados

- `executions.parent_node_id TEXT NULL` (migration 0018).

## Contratos

- `DELETE /api/v1/executions/:id` → 204; 404; 409 (`conflict`, "pare-a antes de excluir").
- `ExecutionDetail.subExecutions: SubExecutionRef[]`.

## Permissões RBAC

| Rota | Permissão |
|---|---|
| `DELETE /executions/:id` | `execution:delete` (projeto da execução) |

Padrão: admin e editor. Executor e visualizador não excluem.

## Configuração

Nenhuma.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Permissão nova `execution:delete` (admin, editor) | Reusar `workflow:delete` ou `workflow:update` | Excluir histórico é diferente de editar o workflow; papéis podem ser ajustados sem afetar a edição |
| Só execuções terminadas | Cancelar e excluir em um passo | Evita apagar dados que um worker ainda está gravando; parar já existe |
| `parent_node_id` gravado | Associar pelo horário do nó | Vínculo exato, também com nós executados várias vezes |
| `llm_usage` preservado | Apagar junto | É contabilidade e cota mensal; apagar permitiria contornar o limite |
| Menu próprio | `@radix-ui/react-dropdown-menu` | Duas opções; sem dependência nova |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-005, NFR-002, SC-002 | Integração | `apps/api/src/executions/execution-delete.int.test.ts` |
| FR-004 | Integração | `apps/api/src/executions/execution-delete.int.test.ts` (subexecução com `nodeId`) |
| FR-002, FR-003, FR-004 | Unidade | `apps/web/src/executions/execution-log.test.ts` |
| FR-001 a FR-005, SC-001 | E2E | `apps/web/e2e/executions.spec.ts` › "spec 026…" |
| Migration 0018 | Integração | `packages/db/src/migrations.int.test.ts` |

## Riscos

| Risco | Mitigação |
|---|---|
| Exclusão por engano | Confirmação, permissão própria e auditoria |
| Objeto do S3 não removido (falha de rede) | Registrado em log, como na retenção; a execução sai do banco |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 19/10/2026 | Criação do plano | Spec 026 |
