# Plano técnico — Spec 029: Acompanhamento ao vivo da execução

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

O acompanhamento reaproveita o que já existe. Os passos concluídos são gravados em `node_executions` conforme cada nó termina, e os eventos `nodeStarted`, `nodeFinished` e `executionFinished` já chegam a todas as instâncias da API pelo Redis (spec 006). Faltam quatro coisas:

1. **Passos em andamento ao abrir (FR-005):** o início de um nó não é gravado em lugar nenhum. Quem emite os eventos (o worker ou a API em processo) passa a manter, no Redis, os passos em andamento de cada execução.
2. **Consulta leve:** `GET /executions/:id/steps` devolve o cabeçalho, os passos concluídos (só metadados, sem ler os dados nem o object storage), os passos em andamento, o horário de retomada da espera e o resumo do progresso. É o que permite cumprir a NFR-002: hoje, o modal de Log consulta a execução completa, com os dados, a cada segundo.
3. **Eventos só de metadados:** o `join` do WebSocket ganha o modo `metadataOnly`, que põe a conexão na sala sem dados, mesmo para quem tem `execution:readData`, e ganha `leave`.
4. **Web:**
   - o modal de Log (spec 026) passa a usar a consulta leve e os eventos ao vivo enquanto a execução está ativa;
   - a lista de execuções ganha "Acompanhar";
   - o editor ganha o aviso de execuções em andamento.

Sem tabela nova e sem dependência nova.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III — Segurança | A rota e o `join` exigem `execution:read` no projeto (sem permissão: 404, como hoje). O acompanhamento entrega só metadados (FR-013): a consulta não lê os dados, e o `join` em `metadataOnly` usa a sala sem dados. Nomes e erros saem das mesmas colunas do Log (spec 009, NFR-004). O Redis guarda só os ids dos nós e os horários |
| IV — Testes | Unidade (linhas do Log a partir dos passos, limite de 500, progresso, estado ao vivo); integração (rota, passos em andamento no Redis, `metadataOnly`, `leave`, RBAC, filtro de vários status); E2E (acompanhar, abrir no meio, reconexão, interromper, aviso no editor, subexecução) |
| VIII — Privacidade | Sem dados de entrada e saída no acompanhamento. Os nomes e os erros seguem o mascaramento, como no Log |
| IX — Simplicidade | Usa o modal de Log, os eventos e o relay existentes. O estado em andamento é um hash no Redis, que já é dependência |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/shared-types` | Tipos `ExecutionSteps`, `ExecutionStep` e `RunningStep`; `metadataOnly` no `join`; constante `LIVE_STEPS_LIMIT = 500` |
| `apps/api/src/executions` | `RunningSteps`, que mantém o hash no Redis e é chamado pelos dois emissores de eventos. Mudanças: rota `GET /executions/:id/steps`; `metadataOnly` e `leave` no gateway; `status` com vários valores na lista |
| `apps/api/src/worker` | `RedisEventPublisher` atualiza o `RunningSteps` junto com a publicação |
| `apps/web/src/executions` | `execution-log.ts`: as linhas vêm dos passos. `use-live-execution.ts`: consulta mais eventos ao vivo, com reconexão. `execution-log-dialog.tsx`: modo ao vivo. `execution-actions.tsx`: "Acompanhar" e Interromper |
| `apps/web/src/pages/executions-page.tsx` | Menu de ações também nas execuções ativas |
| `apps/web/src/editor` | Aviso "N execuções em andamento", com acesso ao acompanhamento |
| `docs/` | `contratos.md` (rota, `join`, filtro); guia das execuções |

## Design

### 1. Passos em andamento no Redis (FR-005)

- **Chave:** um hash `olly:running-steps:<executionId>`, com o campo `<nodeId>#<runIndex>` e o valor `startedAt` (ISO).
- **`RunningSteps.track(event, payload)`:**
  - `nodeStarted` → `HSET` mais `EXPIRE` de 24 h. A execução que travar não deixa lixo para sempre;
  - `nodeFinished` → `HDEL`;
  - `executionFinished` → `DEL`;
  - os outros eventos são ignorados.
- **Execução:**
  - o `RedisEventPublisher` (worker) faz o comando junto do `PUBLISH`, no mesmo `multi()`;
  - o `ExecutionEventsService.emit` (API em processo, como nos testes e nas execuções em linha) chama o `track` antes de publicar ou entregar;
  - só quem **emite** grava, uma vez por evento. As instâncias que só recebem pelo relay não gravam.
- **Falhas:** uma falha do Redis só gera um aviso no log. O acompanhamento continua, só sem os passos em andamento ao abrir, porque os eventos ao vivo os trazem.
- **`RunningSteps.list(executionId)`:** `HGETALL`, ordenado por `startedAt`.
- **Execução terminada:** a rota ignora o hash (por exemplo, se o `DEL` falhou ou a varredura de worker perdido marcou a execução).

### 2. Consulta leve — `GET /executions/:id/steps` (FR-002 a FR-011, FR-016)

`ExecutionsService.steps(executionId, { limit })`:

- **Execução:** as colunas de `executions`, sem `definition` na resposta. A definição só é lida para os nomes e os tipos dos nós.
- **Passos concluídos:**
  - consulta em `node_executions` só com as colunas de metadados (`node_id`, `node_name`, `run_index`, `status`, `started_at`, `finished_at`, `items_in`, `items_out`, `error`);
  - sem ler `input`/`output` nem o object storage;
  - `count(*)` para o total;
  - com `limit`, os últimos `limit` por `started_at desc, run_index desc`, devolvidos em ordem crescente.
- **Passos em andamento:** o `RunningSteps.list`, com o nome e o tipo tirados da definição. Só enquanto a execução está `queued`, `running` ou `waiting`.
- **Retomada:** `resumeAt` vem de `execution_waits.resume_at` quando a execução está `waiting` (FR-007).
- **Subexecuções:** a mesma consulta de `get` (por `parent_execution_id`), com o status, para o link do FR-011.
- **Progresso (FR-010):** `nodeCount` conta os nós da definição, menos os sub-nós (`isSubNodeEdge`, como no editor) e as anotações. `executedNodeIds` são os ids distintos que já têm passo concluído ou em andamento. A web mostra "X de Y nós já rodaram".
- **`limit`:** opcional, de 1 a 10.000. A web usa 500 (`LIVE_STEPS_LIMIT`) enquanto a execução está ativa; sem `limit`, devolve todos (o Log da execução terminada).

### 3. WebSocket — `metadataOnly` e `leave` (FR-004, FR-013)

- **`join`:** aceita `{ executionId, metadataOnly?: boolean }`. Com `metadataOnly`, entra em `executionRoom(id)`, a sala que recebe a versão sem dados (`withoutData`), mesmo com `execution:readData`. O canvas e o painel do agente continuam usando o `join` sem a opção.
- **`leave`:** `{ executionId }` sai das duas salas da execução. O modal chama ao fechar, para não receber eventos à toa.
- **Payload sem dados:** o `nodeFinished` em `withoutData` já vem com `data` vazio e `dataRedacted`. Os metadados (status, itens, duração) chegam inteiros.

### 4. Web — estado ao vivo (`use-live-execution.ts`)

- **Primeira consulta:** `useLiveExecution(executionId, active)` faz `GET /steps?limit=500`.
- **Eventos:** com a execução ativa, faz `join` com `metadataOnly` e escuta `nodeStarted`, `nodeFinished` e `executionFinished`, filtrando pelo `executionId`.
- **Funções puras** (testadas em unidade) atualizam o estado:
  - `nodeStarted` → entra em `running`;
  - `nodeFinished` → sai de `running` e entra em `steps`, sem duplicar pela chave `nodeId#runIndex`, e respeitando o limite de 500 (o total sobe);
  - `executionFinished` → nova consulta **sem** `limit` (o Log completo, FR-008/FR-016), e para de escutar.
- **Ordem:** o join acontece **antes** da primeira consulta, e os eventos que chegarem antes dela entram depois na mesma regra sem duplicar. Assim nenhum evento se perde entre a consulta e a assinatura (FR-005).
- **Reconexão (FR-009):**
  - no `disconnect`, mostra "Reconectando…";
  - no `connect`, faz de novo o `join` e a consulta (ressincroniza);
  - de reserva, faz uma consulta leve a cada 15 s enquanto a execução está ativa, para cobrir eventos perdidos (custo baixo, NFR-002).
- **Relógio:** um tique de 1 s atualiza o tempo decorrido e a duração dos passos em andamento (FR-002/FR-003). Só roda com a execução ativa e o modal aberto.

### 5. Web — modal de Log em modo ao vivo (FR-001 a FR-011, FR-014, FR-016)

- **Origem das linhas:** `execution-log.ts` passa a montar as linhas a partir de `ExecutionSteps`, com os mesmos campos de `LogRow`. Os passos em andamento entram com o status `running` e a duração calculada pelo relógio. `logSummary`, `logText` e `logJson` passam a receber `ExecutionSteps`, e os testes da spec 026 são ajustados à nova entrada.
- **Com a execução ativa:**
  - **Cabeçalho:** indicador "Ao vivo" (ponto pulsando), status, tempo decorrido e "X de Y nós já rodaram · N em andamento".
  - **Passos em andamento:** ficam no fim, destacados (ícone girando e duração correndo). A lista rola sozinha para o fim, a menos que o usuário tenha rolado para cima.
  - **Espera:** "Aguardando até HH:mm:ss" quando há `resumeAt`.
  - **Limite:** "Mostrando as últimas 500 de N linhas", quando o total passa de 500.
  - **Interromper:** com `workflow:execute` no projeto (a permissão da rota de cancelar), nas execuções `queued` e `running` (as mesmas que a lista permite). Pede confirmação e chama `POST /executions/:id/cancel`.
  - **Copiar e downloads:** ficam desabilitados até o fim, porque o Log ainda está incompleto.
- **Ao terminar:** o indicador vira o status final, o relógio para e as linhas passam a ser todas (sem limite).
- **Execução excluída** (404 na consulta): aviso "A execução não existe mais".
- **Link da subexecução (FR-011):** se a subexecução está ativa (pelo status em `subExecutions` ou pelo próximo evento), o link abre o modal de acompanhamento dela, um modal por vez, que substitui o atual. Se já terminou, abre o Log dela, também em modal. O link para o canvas continua em "Abrir execução".

### 6. Web — entradas (FR-001, FR-015)

- **Lista de execuções:**
  - o menu de ações aparece também nas execuções `queued`, `running` e `waiting`, com **Acompanhar**, que abre o modal em modo ao vivo;
  - **Excluir** continua só nas terminadas;
  - o botão de parar da linha continua.
- **Editor:**
  - **Aviso:** um botão na barra superior, "N em andamento", com o ícone girando, só quando N > 0. Abre uma lista curta (início, modo, gatilho) e, ao escolher uma execução, o modal de acompanhamento dela.
  - **Origem dos dados:** `GET /executions?workflowId=<id>&status=queued,running,waiting`, a cada 10 s, só com o editor aberto e a aba visível.
  - **Na tela de uma execução:** o aviso não aparece no canvas somente leitura de uma execução (`ExecutionPage`).
- **Lista com vários status:** `status` de `GET /executions` passa a aceitar uma lista separada por vírgulas. Um status único continua funcionando como antes.

## Modelo de dados

Sem migration. O estado em andamento fica no Redis (§1), sem persistência: se o Redis for limpo, os passos em andamento voltam com os próximos eventos.

## Contratos

| Método e rota | Permissão | Entrada | Saída |
|---|---|---|---|
| `GET /api/v1/executions/:id/steps` | `execution:read` (projeto da execução) | `?limit=1..10000` (opcional) | `ExecutionSteps` |
| `GET /api/v1/executions` | `execution:read` (como hoje) | `status` aceita `queued,running,waiting` | Como hoje |
| WS `join` | `execution:read` (como hoje) | `{ executionId, metadataOnly?: boolean }` | `{ ok }` |
| WS `leave` | Conexão autenticada | `{ executionId }` | `{ ok: true }` |

```ts
interface ExecutionSteps {
  id: string; workflowId: string; projectId: string; workflowVersion: number | null;
  mode: 'test' | 'production'; triggerType: string; status: ExecutionStatus;
  startedAt: string; finishedAt: string | null; error: ExecutionErrorInfo | null;
  resumeAt: string | null;                 // FR-007
  nodeCount: number; executedNodeIds: string[];  // FR-010
  total: number;                           // passos concluídos (FR-016)
  steps: ExecutionStep[];                  // os últimos `limit`, em ordem de início
  running: RunningStep[];                  // FR-005
  subExecutions: SubExecutionRef[];        // FR-011
}
interface ExecutionStep {
  nodeId: string; nodeName: string; nodeType: string; runIndex: number;
  status: NodeExecutionStatus; startedAt: string; finishedAt: string | null;
  itemsIn: number; itemsOut: number; error: { name: string; message: string } | null;
}
interface RunningStep { nodeId: string; nodeName: string; nodeType: string; runIndex: number; startedAt: string }
```

## Permissões RBAC

| Permissão | Situação no catálogo/seed | Papéis | O que esta spec faz |
|---|---|---|---|
| `execution:read` | Existe | Todos os papéis do projeto | Exigida pela rota `/steps` e pelo `join` (como hoje) |
| `workflow:execute` | Existe | admin, editor, executor | Mostra **Interromper** (a rota de cancelar já exige) |

Nenhuma permissão nova. A matriz `docs/rbac-matriz.md` não muda.

## Configuração

Nenhuma variável nova. O TTL de 24 h do hash e o limite de 500 são constantes do código.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Passos em andamento num hash do Redis, gravado por quem emite o evento | Gravar a linha em `node_executions` no início do nó; memória de cada API | Uma linha no início dobraria as escritas no banco (laços com milhares de iterações). A memória da API perderia os passos iniciados antes da instância subir. O Redis já recebe cada evento e é compartilhado |
| Consulta leve própria (`/steps`) | Reusar `GET /executions/:id` | O detalhe lê os dados (e o object storage) de todos os nós, o que custa caro a cada atualização (NFR-002) |
| `metadataOnly` no `join` | Sala nova; filtrar no cliente | Reusa a sala sem dados que já existe e evita trafegar entradas e saídas grandes |
| Eventos ao vivo mais consulta de reserva a cada 15 s | Só consulta a cada 1 s; só eventos | Os eventos dão a latência de 2 s (NFR-001), e a consulta rara cobre eventos perdidos sem pesar |
| Modal de Log com modo ao vivo | Painel ou página nova | Decisão do PO (ponto 1): um lugar só para os passos |
| Últimas 500 linhas enquanto a execução está ativa | Agrupar por nó | Decisão do PO (ponto 5). O Log da execução terminada continua completo |
| `status` com vários valores na lista | Rota de contagem própria | Mudança compatível que serve ao aviso do editor |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-002, FR-003, FR-010, FR-016 | Unidade | `apps/web/src/executions/execution-log.test.ts`: linhas a partir dos passos, em andamento no fim, resumo do progresso, aviso do limite |
| FR-004, FR-005, FR-009 | Unidade | `apps/web/src/executions/live-execution.test.ts`: aplicar eventos sem duplicar, eventos antes da consulta, limite de 500, ressincronização |
| FR-005 | Integração | `apps/api/src/executions/execution-steps.int.test.ts`: passo em andamento aparece na rota durante um nó Esperar ou lento, e some ao terminar; o hash é apagado no fim |
| FR-002, FR-003, FR-007, FR-010, FR-011, FR-016 | Integração | Mesmo arquivo: cabeçalho, passos sem dados, `resumeAt`, `nodeCount`/`executedNodeIds`, subexecuções, `limit` com `total` |
| FR-012, FR-013 | Integração | Mesmo arquivo: 404 sem `execution:read`; a resposta não tem `input`/`output`; `join` com `metadataOnly` de um usuário com `readData` recebe o `nodeFinished` sem dados; `leave` para de receber |
| FR-015 | Integração | `executions.int.test.ts`: `status=queued,running,waiting` |
| FR-001, FR-004, FR-006, FR-008, SC-001, SC-002 | E2E | `apps/web/e2e/execution-live.spec.ts`: acompanhar pela lista um workflow com Esperar (o nó em andamento e depois concluído, o tempo correndo, o fim com o Log completo); abrir no meio; erro destacado |
| FR-009, SC-003 | E2E | Mesmo arquivo: com a rede do navegador cortada e devolvida (`context.setOffline`), o aviso aparece e os passos terminam iguais aos do Log |
| FR-014 | E2E | Mesmo arquivo: Interromper com confirmação; o viewer não vê a ação |
| FR-015 | E2E | Mesmo arquivo: aviso "1 em andamento" no editor abre o acompanhamento e some no fim |
| FR-011 | E2E | Mesmo arquivo: o link da subexecução ativa abre o acompanhamento dela |
| SC-004 | Integração + E2E | 404 sem permissão; o viewer acompanha sem dados |

## Riscos

| Risco | Mitigação |
|---|---|
| Redis fora do ar: os passos em andamento não aparecem ao abrir | Os eventos ao vivo trazem os próximos inícios, e o aviso fica só no log da API. Os concluídos vêm do banco |
| Hash órfão (worker morto sem `executionFinished`) | TTL de 24 h. A rota ignora o hash quando a execução já terminou |
| Muitos eventos num laço rápido sobrecarregam o navegador | O estado aplica no máximo 500 linhas. Os eventos são agrupados por quadro (`requestAnimationFrame`) antes de renderizar |
| Mudança na entrada das funções do Log (spec 026) quebra a cópia e os downloads | Os testes de unidade da spec 026 são mantidos, adaptados à nova entrada, com o mesmo texto esperado |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 23/10/2026 | Criação do plano | Spec 029 esclarecida pelo PO |
