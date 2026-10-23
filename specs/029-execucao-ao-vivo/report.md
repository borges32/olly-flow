# Relatório — Spec 029: Acompanhamento ao vivo da execução

**Status:** Implementada
**Data:** 23/10/2026

## Resumo

O modal de **Log** da spec 026 passou a funcionar também como **acompanhamento ao vivo** da execução na fila, em andamento ou aguardando:
- **Acesso:** pela tela **Execuções** (menu da execução ativa › **Acompanhar**), pelo editor (botão "N em andamento" na barra superior) e pelo link da subexecução no próprio Log.
- **Cabeçalho:** indicador "Ao vivo", status, modo, gatilho, versão, início e tempo decorrido (a cada segundo), mais "X de Y nós já rodaram · N passos concluídos · N em andamento". No Esperar longo, "Aguardando até HH:mm:ss". O erro da execução aparece no topo.
- **Passos:** na ordem de início, com os em andamento no fim (ícone girando, duração correndo), status em português (em andamento, sucesso, erro, sem dados, aguardando, interrompido), itens de entrada e saída e erro destacado. Só metadados: os dados continuam no canvas da execução.
- **Atualização:** eventos do WebSocket (sala sem dados) em até 2 s, sem recarregar; ao abrir no meio, os passos concluídos vêm do banco e os em andamento de um hash no Redis. Conexão perdida: aviso, reconexão e ressincronização, sem perder nem duplicar.
- **Fim:** status final, relógio parado, Log completo (sem o limite de 500 linhas), Copiar e downloads liberados.
- **Interromper:** no modal, com confirmação, para quem tem `workflow:execute`.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `ExecutionSteps`, `ExecutionStep`, `RunningStep`, `LIVE_STEPS_LIMIT`, `JoinExecutionRequest` em `packages/shared-types/src/api.ts` |
| T002 | ✅ | `apps/api/src/executions/running-steps.ts`; o `RedisEventPublisher` (worker) grava no mesmo `multi()` do `PUBLISH`, e o `ExecutionEventsService.emit` (API em processo) chama o `track`. Falha do Redis só gera aviso |
| T010 | ✅ | `ExecutionsService.steps` e rota `GET /executions/:id/steps` (`execution:read`), `stepsQuerySchema` (`limit` de 1 a 10.000) |
| T011 | ✅ | `join` com `metadataOnly` (`executions.gateway.ts`). O `leave` já existia. A entrega passou a mandar uma versão só a cada conexão (ver Decisões) |
| T012 | ✅ | `status` com lista separada por vírgulas em `listExecutionsQuerySchema`; filtro `in` no `list` |
| T013 | ✅ | `execution-steps.int.test.ts` (11 casos) e `executions.int.test.ts` › "spec 029 — FR-015…" |
| T020 | ✅ | `execution-log.ts` a partir de `ExecutionSteps` (passos em andamento, `logProgress`, `formatElapsed`, rótulos em português); `execution-log.test.ts` (testes da spec 026 adaptados à nova entrada, com o mesmo texto esperado, mais 5 da spec 029) |
| T021 | ✅ | `live-execution.ts` (funções puras, `live-execution.test.ts` com 9 casos) e `use-live-execution.ts` (join antes da consulta, eventos guardados durante a consulta, agrupamento por quadro, reconexão, reserva de 15 s, relógio) |
| T022 | ✅ | `execution-log-dialog.tsx`: modo ao vivo, rolagem automática (para quando o usuário sobe a lista), "Mostrando as últimas 500 de N linhas", "A execução não existe mais" |
| T023 | ✅ | `execution-actions.tsx` (**Acompanhar** nas ativas; **Excluir** só nas terminadas) e `executions-page.tsx` (menu em todas as linhas; o botão Parar continua) |
| T030 | ✅ | **Interromper** com confirmação (`StopAction` no modal), em `queued` e `running`, com `workflow:execute` |
| T031 | ✅ | O link da subexecução abre o acompanhamento dela (se ativa, com "(ao vivo)") ou o Log dela, no mesmo modal |
| T040 | ✅ | `apps/web/src/editor/running-executions.tsx`, na barra do editor (fora do canvas de uma execução) |
| T050 | ✅ | `apps/web/e2e/execution-live.spec.ts` (6 casos) |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ✅ | Ver "Requisitos" e "Critérios de sucesso" |
| T092 | ✅ | `docs/arquitetura/contratos.md` (rota, `join`/`leave`, filtro, hash no Redis) e `docs/execucao.md` (seção "Acompanhamento ao vivo") |
| T093 | ✅ | Este relatório; status em `spec.md` e `docs/roadmap.md` |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | E2E `execution-live.spec.ts` › "FR-001/FR-002/FR-004/FR-008/SC-001/SC-002…" (pela lista), "FR-015…" (pelo editor), "FR-011…" (pela subexecução) |
| FR-002 | Sim | `execution-steps.int.test.ts` › "FR-002/FR-003/FR-013…"; `execution-log.test.ts` › "FR-002: tempo decorrido legível"; E2E (tempo decorrido correndo) |
| FR-003 | Sim | `execution-log.test.ts` › "FR-003: o passo em andamento vem no fim…"; `live-execution.test.ts` › "FR-003: nós em paralelo…"; integração › "FR-002/FR-003/FR-013…" |
| FR-004 | Sim | `live-execution.test.ts` › "FR-004…" (2 casos); integração › "FR-004: leave…"; E2E (em andamento e depois concluído, com medição de latência) |
| FR-005 | Sim | Integração › "FR-005…" (worker e API em processo); `live-execution.test.ts` › "FR-005/FR-009…"; E2E › "FR-005/FR-006…" (aberto no meio) |
| FR-006 | Sim | Integração › "FR-006…"; `live-execution.test.ts` › "FR-006/FR-008…"; E2E › "FR-005/FR-006…" |
| FR-007 | Sim | Integração › "FR-007…" (`resumeAt`); `live-execution.test.ts` › "FR-007…" (espera e retomada sem duplicar) |
| FR-008 | Sim | `live-execution.test.ts` › "FR-006/FR-008…"; E2E (status final, sem "Ao vivo", downloads liberados, Log completo) |
| FR-009 | Sim | `live-execution.test.ts` › "FR-005/FR-009…" (ressincronização sem duplicar); E2E › "FR-009/SC-003…" |
| FR-010 | Sim | `execution-log.test.ts` › "FR-010…"; integração › "FR-005…" (`nodeCount`, `nodes`, `executedNodeIds`) |
| FR-011 | Sim | Integração › "FR-011…"; `execution-log.test.ts` › "FR-011…"; E2E › "FR-011…" |
| FR-012 | Sim | Integração › "FR-012/SC-004…" (404 sem permissão e inexistente) |
| FR-013 | Sim | Integração › "FR-002/FR-003/FR-013…" (sem dados na resposta), "FR-013: com metadataOnly…", "FR-013: na sala do workflow com dados…" |
| FR-014 | Sim | E2E › "FR-014/SC-004…" (confirmação, passo interrompido, viewer sem a ação) |
| FR-015 | Sim | `executions.int.test.ts` › "spec 029 — FR-015…"; E2E › "FR-015…" |
| FR-016 | Sim | Integração › "FR-016…" (`limit` e `total`); `live-execution.test.ts` › "FR-016…" (2 casos); `execution-log.test.ts` › "FR-016…" |
| NFR-001 | Sim | E2E › "FR-001…": entre o início do nó (horário do worker) e a tela, menos de 2 s |
| NFR-002 | Sim | A rota lê só as colunas de metadados de `node_executions` (sem `input`/`output` nem o object storage); integração confere que os dados não saem na resposta |
| NFR-003 | Sim | Limite de 500 linhas no estado e eventos agrupados por quadro (`requestAnimationFrame`); `live-execution.test.ts` › "FR-016…" |
| NFR-004 | Sim | Nomes e erros saem das mesmas colunas do Log (`node_executions.node_name`, `error`, já mascaradas na gravação) |
| NFR-005 | Sim | Textos em português; o modal e o botão do editor quebram linha no celular (sem teste automatizado de celular) |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | E2E com Esperar A (4 s) e Esperar B (4 s): cada nó aparece "em andamento" e depois com a duração final; latência medida abaixo de 2 s. O workflow real de 5 minutos fica para a demonstração |
| SC-002 | ✅ | E2E: as linhas do acompanhamento no fim são as mesmas da rota (`/steps` sem limite), na mesma ordem; E2E › "FR-005/FR-006…" abre no meio |
| SC-003 | ✅ | E2E › "FR-009/SC-003…": rede do navegador cortada por 10 s no meio da execução; o aviso aparece e some, e os passos terminam iguais aos do Log |
| SC-004 | ✅ | Integração: 404 para quem não é do projeto; o viewer recebe os passos sem dados. E2E: o viewer acompanha, sem Interromper |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 950 testes (893 nos pacotes e 57 na raiz). Na primeira rodada, o teste de tempo NFR-002 da spec 003 (`expressions`, 1000 itens em menos de 1 s) passou do tempo (1,25 s), com a máquina ocupada também pela integração rodando em paralelo; o turbo interrompeu os outros pacotes. Rodado de novo, sem a integração em paralelo, tudo passou. É a instabilidade já conhecida, sem relação com esta spec |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 435 testes (api 366, db 35, nodes 31, engine 3) |
| `pnpm test:e2e` | ✅ 68 de 68 (6 da spec 029) |
| `pnpm app:up && pnpm smoke` | ✅ |

**E2E e containers:** o Playwright reaproveita os servidores que já estão nas portas 3000 e 5173, e os containers `api`, `worker` e `web` do perfil `app` estavam no ar com o código anterior e o IdP desligado. Parei esses três containers durante o E2E e subi de novo, já com o código novo (`pnpm app:up`), antes do smoke.

**Ambiente:** a verificação rodou com o Node 22.23.3 (`.nvmrc` e `engines` do projeto). O Node padrão desta máquina é o 25.9, para o qual o `isolated-vm` não tem build nativo: com ele, os testes que usam o nó de código falham por ambiente.

## Decisões tomadas

- **Uma versão do evento por conexão:** a API entregava o evento completo nas salas com dados e, separado, a versão sem dados nas outras. No editor, o mesmo WebSocket fica na sala do workflow com dados e, com o acompanhamento aberto, também na sala da execução sem dados. A versão sem dados chegaria depois da completa e apagaria a saída dos nós no canvas. Agora a versão sem dados vai só às conexões que não estão em nenhuma sala com dados (`except`). O acompanhamento ignora os dados de qualquer forma (FR-013).
- **`nodes` em `ExecutionSteps`:** os eventos ao vivo trazem só o `nodeId`. A web precisa do nome e do tipo dos passos que começam depois da consulta, e a definição completa não pode ir na resposta (só metadados). Vão o id, o nome e o tipo dos nós (sem os sub-nós), que também servem ao progresso.
- **Sub-nós pelo tipo do nó** (`isSubNodeType`, como no agendamento do motor), em vez da conexão do editor: a API tem o catálogo de nós, e o resultado é o mesmo. O catálogo não tem nó de anotação.
- **Retomada do Esperar:** o passo "aguardando" volta a "em andamento" ao retomar, sem duplicar (o banco troca a linha no fim). A rota faz o mesmo quando o hash e a linha `waiting` coexistem.
- **Link da subexecução logo:** depois do início de um "Executar workflow", a web refaz a consulta leve em 1,5 s, para o link aparecer sem esperar a reserva de 15 s.
- **Status em português no modal** (FR-003), também no Log das execuções terminadas. A cópia e os downloads continuam com os valores da API (`success`, `error`…), como na spec 026. O E2E da spec 026 passou a esperar "sucesso" na linha.
- **Rótulo do filtro "Executando" → "Em andamento"**, para bater com o status do passo.
- **E2E de reconexão com `routeWebSocket`:** o modo offline do Chromium (`context.setOffline`) não fecha um WebSocket aberto. O teste usa os dois: corta o HTTP e derruba e recusa o WebSocket por 10 s.

## Desvios da spec/plano

Nenhum no comportamento. O `plan.md` foi atualizado antes do relatório (Histórico de 23/10/2026): campo `nodes` no contrato, `resumeAt` de `execution_state` (o plano citava `execution_waits`, tabela que não existe), sub-nós pelo tipo, `leave` já existente, consulta depois do "Executar workflow" e o E2E com `routeWebSocket`.

**Aprovação:** o roadmap marcava a spec como "Planejada — plano e tarefas a revisar". Como na spec 028, o pedido de implementação foi tomado como a aprovação do plano e das tarefas.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- **Workflow real de 5 minutos (SC-001):** conferir em homologação com um fluxo de produção (agentes, HTTP lento), além do E2E com esperas curtas.
- **Celular (NFR-005):** conferir o modal num celular; não há teste automatizado.
- **Redis fora do ar:** o acompanhamento continua, mas sem os passos em andamento ao abrir (só a partir dos próximos eventos). Aviso no log da API.

## Como demonstrar

1. `pnpm app:up`. Entre como `editor@olly.local` e crie um workflow: Gatilho manual → Esperar (20 s) → Esperar (40 s) → Definir campos.
2. Clique em **Executar workflow**. Na barra do editor aparece "1 em andamento": abra e escolha a execução. O modal mostra "Ao vivo", o tempo correndo e "Esperar" em andamento.
3. Feche e abra **Execuções**: no menu (reticências) da execução, **Acompanhar**. Os passos anteriores estão lá, e o em andamento também.
4. Desligue a rede do navegador por alguns segundos (DevTools › Network › Offline): aparece "Conexão perdida. Reconectando…". Volte: o aviso some e os passos continuam.
5. No fim, o modal mostra o status final e libera Copiar, `.txt` e `.json`.
6. Rode de novo e use **Interromper** no modal: a execução para e o passo fica "interrompido". Entre como `viewer@olly.local`: o acompanhamento abre, sem Interromper.

## Próximos passos sugeridos

- Notificar quem acompanha quando a execução termina (fora do escopo).
- Mostrar os passos das subexecuções aninhados no mesmo acompanhamento (fora do escopo; hoje, só o link).
