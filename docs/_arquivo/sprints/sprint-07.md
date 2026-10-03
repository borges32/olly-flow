# Sprint 7 — Python, agendamento e nós auxiliares

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também os relatórios em `docs/relatorios/`, a ADR-004 em `docs/decisoes.md` e a seção 6.8 de `docs/analise_implementacao.md`.

## Pré-requisitos

- Sprint 6 concluída e todos os comandos da seção 8 passando.

## Contexto

Analistas de dados da instituição precisam transformar dados com Python (pandas). Executar Python de usuário é o maior risco de segurança da plataforma: o isolamento deve ser forte e testado ativamente. Esta sprint também fecha o motor com agendamento, sub-workflows, espera e reexecução.

## Objetivo

Runner Python isolado e o nó `code.python`, gatilho cron, nós `flow.executeWorkflow`, `flow.wait` e `flow.stopAndError`, reexecução de execuções, paginação HTTP e uma bateria de testes de escape de sandbox.

## Tarefas

### T1 — `apps/python-runner`
- FastAPI (Python 3.12, dependências gerenciadas com `uv` e lock commitado) escutando **apenas na rede interna** do Compose.
- Autenticação **obrigatória** entre worker e runner: token de serviço (`OLLY_PYRUNNER_TOKEN`) em header, com comparação em tempo constante. mTLS fica como opção futura; registre.
- **Endpoint `POST /run`:**
  - **entrada:** `{ code, mode, items, context: { vars, execution, workflow, nodes } }`;
  - **saída:** `{ items, stdout, stderr, durationMs }` ou `{ error: { type, message, traceback } }`.
- **Cada requisição** executa em um **subprocesso novo sob nsjail**:
  - usuário sem privilégios;
  - **sem rede** (`--disable_clone_newnet` não deve ser usado; o namespace de rede deve ficar vazio);
  - filesystem raiz somente leitura e `/tmp` em tmpfs (64 MB);
  - limites: memória `OLLY_PY_MEMORY_MB` (padrão 256), CPU `OLLY_PY_CPU_SECONDS` (padrão 30), tempo de parede `OLLY_PY_TIMEOUT_SECONDS` (padrão 60), número de processos (`rlimit_nproc`) e tamanho de arquivo;
  - comunicação com o subprocesso via stdin/stdout (JSON), com limite de tamanho da saída (`OLLY_PY_MAX_OUTPUT_MB`, padrão 50).
- Imagem `infra/docker/python-runner.Dockerfile` com uma **allowlist de bibliotecas** em `apps/python-runner/allowed-requirements.txt`: pandas, numpy, python-dateutil, pytz, regex, orjson, unidecode. O código do usuário só consegue importar o que está instalado; não há `pip install` em runtime.
- O container roda com `cap_drop: ALL` (somente as capabilities que o nsjail exige, documentadas), `read_only: true` e `security_opt: no-new-privileges`. Documente o motivo de cada capability.
- `/health` e testes com pytest.

### T2 — API Python no código do usuário (compatível com o N8N)
- Variáveis: `_input.all()`, `_input.first()`, `_input.last()`, `_input.item` (modo por item), `_json`, `_('Nome do Nó')` com `.all()`, `.first()` e `.item`, `_vars`, `_execution`, `_workflow`, `_now` e `_today` (`datetime`).
- Itens acessíveis como `item.json` (atributo) **e** `item["json"]` (chave).
- O retorno aceita `list[dict]`, `list[{"json": ...}]` ou `dict`, normalizado como no nó JS.
- **Valide** essa API contra a versão do N8N usada na POC (fixtures). Divergências vão para `docs/nos/code.python.md`.
- `print()` é capturado como console.

### T3 — Nó `code.python`
- Parâmetros: `mode` (`runOnceForAllItems` | `runOnceForEachItem`) e `pythonCode`. O código padrão é equivalente ao do N8N.
- O worker chama o runner com timeout e `AbortSignal`. O cancelamento da execução aborta a requisição, e o runner mata o subprocesso.
- No modo `runOnceForEachItem`, envie **todos os itens em uma única requisição** e itere dentro do subprocesso, para evitar o custo de um processo por item.
- Editor Monaco com Python e autocomplete das variáveis `_*`.

### T4 — Gatilho `trigger.schedule`
- Parâmetros: `rules: [{ type: 'cron', expression } | { type: 'interval', every, unit }]` e `timezone` (padrão `America/Sao_Paulo`).
- Na publicação, cria jobs recorrentes no BullMQ (`upsertJobScheduler`); a despublicação os remove. Use a chave `workflowId:version:ruleIndex` para evitar duplicidade entre instâncias.
- Saída: `{ timestamp, scheduledTime, timezone }`.
- Valide a expressão cron na publicação e mostre as próximas 5 execuções no painel do nó.

### T5 — Nó `flow.executeWorkflow` (sub-workflow)
- **Parâmetros:**
  - `workflowId` (somente workflows publicados de projetos aos quais o **dono da execução** tem `workflow:execute`);
  - `mode`: `once` | `perItem`;
  - `waitForCompletion: boolean`.
- O sub-workflow começa com o gatilho `trigger.executeWorkflow`, que recebe os itens e tem um `inputSchema` opcional para validação.
- O resultado é a saída do último nó do sub-workflow. A execução filha registra `parent_execution_id` (nova coluna) e aparece vinculada na tela de execuções.
- Limite de profundidade de aninhamento (`OLLY_MAX_SUBWORKFLOW_DEPTH`, padrão 5) e detecção de recursão direta.

### T6 — Nós `flow.wait` e `flow.stopAndError`
- **`flow.wait`:** `resume`: `timeInterval` | `specificTime`.
  - Esperas ≤ 60 s ficam em memória.
  - Esperas maiores **liberam o worker**: a execução é persistida com status `waiting` (estado do engine serializado em `execution_state`, tabela nova) e um job atrasado no BullMQ a retoma.
  - Teste a retomada em outro worker.
- **`flow.stopAndError`:** `errorType`: `message` | `object`. Encerra a execução com erro customizado, que dispara o error workflow.

### T7 — Reexecução
- `POST /executions/:id/retry` (`workflow:execute`) com `useWorkflowVersion`: `original` | `published`. Reaproveita as saídas dos nós com sucesso e reexecuta a partir do(s) nó(s) que falharam.
- `POST /workflows/:id/test-run` aceita `startNodeId` + `runData` de uma execução anterior (executar a partir de um nó no editor).
- Na UI: botões "Reexecutar" na tela de execuções e "Executar a partir daqui" no nó.

### T8 — Paginação no `http.request`
- `options.pagination`:
  - `mode`: `responseContainsNextURL` (expressão para a próxima URL) | `updateParameterInEachRequest` (parâmetros com `$pageCount`/`$response`);
  - `paginationCompleteWhen`: `responseIsEmpty` | `receiveSpecificStatusCodes` | `other` (expressão);
  - `maxRequests` (padrão 100);
  - `requestIntervalMs`.
- Variáveis `$response` (`body`, `headers`, `statusCode`) e `$pageCount` disponíveis nas expressões de paginação, como no N8N.

### T9 — Bateria de testes de escape de sandbox (`security/sandbox/`)
- **JS** (task-runner), pelo menos 15 casos:
  - acesso a `process`, `require`, `constructor.constructor`, `Error.prepareStackTrace` e `Proxy`;
  - poluição de protótipo afetando o host;
  - alocação de memória excessiva, recursão profunda e loop infinito;
  - Promise que nunca resolve;
  - `SharedArrayBuffer`/`Atomics`;
  - leitura de variáveis do host.
- **Python**, pelo menos 15 casos:
  - `socket` e `urllib` para IP externo e interno;
  - `open('/etc/passwd', 'w')`, leitura de `/proc/1/environ`;
  - `os.fork` em loop (*fork bomb*), `ctypes`, `subprocess`;
  - escrita fora do `/tmp`, preenchimento do `/tmp`;
  - `import` de pacote não instalado;
  - consumo de CPU e memória, e saída gigante.
- Cada caso deve **falhar de forma controlada**, sem derrubar o worker/runner e sem afetar execuções concorrentes. Rode a bateria no CI.

## Fora do escopo

Vault/KMS, versionamento visual, MCP, AI Agent e Kubernetes.

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | Nó Python com pandas agrega itens vindos de `postgres.query` | Integração |
| 2 | Bateria de escape (≥ 30 casos) verde no CI | `security/sandbox` |
| 3 | Python não acessa a rede nem lê segredos do ambiente do container | Bateria de escape |
| 4 | Runner recusa requisições sem token válido | Integração |
| 5 | Workflow agendado a cada 1 minuto executa 3 vezes em 3 minutos com 2 instâncias de worker, sem duplicar | Integração |
| 6 | `flow.wait` de 2 minutos libera o worker e retoma em outro worker | Integração |
| 7 | Sub-workflow `perItem` retorna os resultados na ordem; recursão além do limite é bloqueada | Integração |
| 8 | Reexecução a partir do nó com erro reaproveita as saídas anteriores (nós anteriores não executam de novo) | Integração |
| 9 | Paginação HTTP coleta todas as páginas de um mock com 7 páginas | Integração |
| 10 | Toda a suíte das sprints anteriores verde | CI |

## Entrega

Código, `docs/nos/code.python.md`, `docs/nos/trigger.schedule.md`, `docs/nos/flow.executeWorkflow.md`, `docs/nos/flow.wait.md`, `docs/nos/flow.stopAndError.md`, `docs/seguranca-sandbox.md` (modelo de ameaça e controles) e o relatório `docs/relatorios/sprint-07.md`.

> 🏁 **Marco:** motor completo. Todos os nós de lógica e código solicitados estão entregues.
