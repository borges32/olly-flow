# Relatório — Spec 026: Ações da execução: excluir e ver o log

**Status:** Implementada
**Data:** 19/10/2026

## Resumo

Cada execução terminada na tela **Execuções** ganhou o botão de ações (reticências), com duas opções:
- **Log:** modal com o cabeçalho da execução (identificador curto, workflow, status, modo, gatilho, início → fim, duração) e uma linha por execução de nó:
  - **conteúdo de cada linha:** horário com milissegundos, nome e tipo do nó, status, duração, itens de entrada → saída e mensagem de erro;
  - **ordem e falha geral:** as linhas seguem a ordem da execução, e a falha geral aparece no fim;
  - **filtros e ações:** status, texto, Copiar, `.txt`, `.json` e "Abrir execução";
  - **subexecução:** a linha do "Executar workflow" leva à subexecução. Subexecuções sem nó correspondente (ex.: ferramenta do Agent) ficam numa seção à parte.
- **Excluir:** pede confirmação e remove a execução com todos os dados: nós, payloads, estado, chamadas MCP, passos do agente, pedidos de aprovação e objetos no S3. Só vale para execuções terminadas, exige a permissão nova `execution:delete` (admin e editor) e fica na auditoria (`execution.delete`).

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `infra/migrations/0018_execution_parent_node` (up/down); `packages/db` (schema e testes de migration) |
| T002 | ✅ | `execution:delete` em `packages/shared-types/src/rbac.ts`; `rbac.test.ts`; matriz `docs/rbac-matriz.md` regenerada |
| T003 | ✅ | `nodeId` no `SubWorkflowGateway` (`packages/nodes`); o motor preenche (`packages/engine/src/run.ts`); `sub-workflows.ts` grava `parent_node_id` |
| T010 | ✅ | `apps/api/src/executions/purge.ts`; a retenção (`maintenance.service.ts`) usa a mesma função |
| T011 | ✅ | `subExecutions` em `GET /executions/:id` |
| T012 | ✅ | `DELETE /executions/:id`; `execution-delete.int.test.ts` |
| T020 | ✅ | `apps/web/src/executions/execution-log.ts` e `execution-log.test.ts` |
| T021 | ✅ | `execution-actions.tsx` (menu e confirmação), `execution-log-dialog.tsx`; `executions-page.tsx` |
| T022 | ✅ | `apps/web/e2e/executions.spec.ts` |
| T090–T093 | ✅ | Ver abaixo; `contratos.md`, `modelo-dados.md`, roadmap e matriz de rastreabilidade |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | E2E `executions.spec.ts` (menu com Log e Excluir para o editor; só Log para o viewer) |
| FR-002 | Sim | `execution-log.test.ts` › "FR-002…"; E2E (linhas, tipos, erro, falha geral) |
| FR-003 | Sim | `execution-log.test.ts` › "FR-003…" (filtros, texto e JSON); E2E (filtros, `.json`, Abrir execução) |
| FR-004 | Sim | `execution-delete.int.test.ts` › "FR-004…"; `execution-log.test.ts` › "FR-004…"; E2E (link da subexecução) |
| FR-005 | Sim | `execution-delete.int.test.ts` › "FR-005…" (204, 409 para ativa, 403 para executor e viewer, 404 depois, auditoria); `rbac.test.ts`; matriz de RBAC; E2E (confirmação, cancelar, excluir) |
| NFR-001 | Sim | Textos em português |
| NFR-002 | Sim | `execution-delete.int.test.ts` (nenhuma linha nem objeto no MinIO depois; `llm_usage` preservado); `retention.int.test.ts` continua passando com a função compartilhada |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | E2E com Início → Executar workflow → código com erro: todos os nós, o erro, o link da subexecução, filtros e `.json` filtrado. Conferência visual pela captura do modal |
| SC-002 | ✅ | Integração e E2E: a execução some da lista, `GET` responde 404 e não sobram linhas nem objetos |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 904 testes (847 nos pacotes e 57 na raiz). Na execução completa, o teste de tempo NFR-002 das expressões (spec 003) falhou uma vez (1,7 s com a máquina ocupada pelos outros pacotes) e passou 3 vezes seguidas isolado; instabilidade conhecida, sem relação com esta spec |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 401 testes (api 335, db 33, nodes 30, engine 3) |
| `pnpm test:e2e` | ✅ 58 de 58 |
| `pnpm app:up && pnpm smoke` | ✅ |

## Decisões tomadas

- **Permissão nova `execution:delete`** (admin e editor), em vez de reaproveitar `workflow:delete`: excluir histórico é diferente de excluir o workflow, e os papéis podem ser ajustados sem afetar a edição. O db-init (seed) atualiza os papéis gravados a cada implantação.
- **Só execuções terminadas:** execução ativa responde 409 ("pare-a antes de excluir"), para não apagar dados que um worker ainda grava.
- **`llm_usage` preservado:** é a contabilidade de custo e a cota mensal de tokens do projeto (spec 011); apagar junto permitiria contornar o limite.
- **`executions.parent_node_id`** (migration 0018) em vez de associar a subexecução pelo horário: o vínculo é exato, também com o nó executado várias vezes (laço). O motor preenche o `nodeId` em toda chamada de sub-workflow, então o "Executar workflow" e a ferramenta de workflow do Agent registram o nó sem mudança nos nós. Subexecuções anteriores à migration ficam sem nó e aparecem na seção "Subexecuções".
- **Remoção compartilhada com a retenção** (`purgeExecutions`): a exclusão manual e a retenção da spec 009 removem exatamente as mesmas tabelas. A retenção passou também a remover `execution_state` (antes ficava).
- **Menu próprio, sem dependência nova,** posicionado de forma fixa a partir do botão (a tabela corta o que passa da borda) e fechado por Esc, clique fora ou rolagem.
- **Rótulo do gatilho na lista:** a conferência visual mostrou subexecuções com o gatilho "Manual". A lista agora mostra Sub-workflow, Chat e Gatilho de erro.

## Desvios da spec/plano

Nenhum.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- **Teste de tempo NFR-002 das expressões:** instável sob carga nesta máquina (ver comandos de verificação).

## Como demonstrar

1. `pnpm app:up` e abra **Execuções**.
2. Numa execução terminada, clique nas reticências → **Log**: filtre por "Erro", busque um nó, baixe o `.json` e siga o link da subexecução.
3. Reticências → **Excluir** → confirmar: a execução some da lista.
4. Como viewer, o menu só tem **Log**.
