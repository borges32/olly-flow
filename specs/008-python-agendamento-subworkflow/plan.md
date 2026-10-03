# Plano técnico — Spec 008: Python, agendamento e nós auxiliares

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Python:** `apps/python-runner` (FastAPI) executa cada requisição em um subprocesso nsjail. O worker chama o runner com token de serviço.
- **Agendamento:** job schedulers do BullMQ.
- **Engine:** suporte a estado serializável (`waiting`) para Wait, sub-workflows com vínculo pai/filha e reexecução parcial.
- **Segurança:** bateria de escape de sandbox no CI.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III.1 Sandbox | nsjail sem rede, FS somente leitura, *rlimits*; container com `cap_drop: ALL` + `no-new-privileges` |
| II — N8N | API Python `_input`/`_json`; paginação com `$response`/`$pageCount` |
| IV.4 | Bateria de escape como teste de regressão permanente |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `apps/python-runner` | Novo serviço (FastAPI, nsjail, pytest) |
| `infra/docker/python-runner.Dockerfile` | Imagem com allowlist |
| `packages/nodes` | `code.python`, `trigger.schedule`, `trigger.executeWorkflow`, `flow.executeWorkflow`, `flow.wait`, `flow.stopAndError`; paginação no `http.request` |
| `packages/engine` | Serialização de estado, retomada, reexecução parcial, `startNodeId` |
| `apps/api`/`worker` | Schedulers na publicação; jobs atrasados de retomada; endpoints de retry |
| `security/sandbox/` | Bateria de escape |
| `apps/web` | Editor Python, próximas execuções do cron, botões de reexecução |

## Design

### §1 python-runner
- Python 3.12, `uv` com lock. Escuta apenas na rede interna.
- **Autenticação:** header `Authorization: Bearer <OLLY_PYRUNNER_TOKEN>` comparado com `hmac.compare_digest`. mTLS fica como evolução (registrada).
- **`POST /run`:**
  - entrada `{ code, mode, items, context: { vars, execution, workflow, nodes } }`;
  - saída `{ items, stdout, stderr, durationMs }` | `{ error: { type, message, traceback } }`.
- **Por requisição:** `nsjail` em modo *once* com:
  - `--user 65534 --group 65534`;
  - namespaces novos, incluindo rede (**não** usar `--disable_clone_newnet`);
  - bind somente leitura do Python e do site-packages;
  - `tmpfs` em `/tmp` (64 MB);
  - `--rlimit_as`, `--rlimit_cpu`, `--rlimit_nproc`, `--rlimit_fsize` e `--time_limit`.
- Comunicação com o subprocesso: JSON por stdin/stdout, com saída limitada a `OLLY_PY_MAX_OUTPUT_MB`.
- **Wrapper interno (`bootstrap.py`):** monta `_input`, `_json`, `_('Nó')` etc. Os itens são `ItemProxy`, acessíveis como `item.json` e `item["json"]`. O código do usuário é envolvido em uma função; `print` é redirecionado.
- **Container:** `read_only: true`, `cap_drop: ALL` (+ apenas as capabilities exigidas pelo nsjail, documentadas em `docs/seguranca-sandbox.md`) e `security_opt: no-new-privileges`.

### §2 Nó `code.python`
- **Parâmetros:** `mode` e `pythonCode` (padrão equivalente ao do N8N).
- O modo por item envia todos os itens em uma única requisição e itera no subprocesso.
- `fetch` para o runner com `AbortSignal`. No cancelamento, o runner mata o subprocesso.
- Valida a API contra as fixtures da POC. Divergências vão para `docs/nos/code.python.md`.

### §3 Agendamento
- **Parâmetros:** `rules: [{ type: 'cron', expression } | { type: 'interval', every, unit }]` e `timezone` (padrão `America/Sao_Paulo`).
- **Publicação:** `queue.upsertJobScheduler('wf:<id>:v<ver>:r<i>', { pattern | every, tz })`. A despublicação remove os schedulers.
- **Saída:** `{ timestamp, scheduledTime, timezone }`.
- Validação de cron com `cron-parser`. `GET /workflows/:id/schedule-preview` retorna as próximas 5 execuções.

### §4 Sub-workflow
- **`flow.executeWorkflow`:** `workflowId`, `mode` (`once` | `perItem`) e `waitForCompletion`.
  - Verifica `workflow:execute` do **dono da execução** no projeto do alvo e exige que o alvo esteja publicado.
  - Despacha pela fila com `parent_execution_id`.
- **Profundidade:** `executions.depth`, com limite `OLLY_MAX_SUBWORKFLOW_DEPTH` (5); erro ao exceder.
- **Recursão:** `workflowId` igual a um ancestral gera erro.
- **`trigger.executeWorkflow`:** `inputSchema` opcional (JSON Schema validado com ajv).
- **Resultado:** a saída do último nó executado do filho. No modo `perItem`, resultados na ordem dos itens.

### §5 Wait e estado serializável
- **`flow.wait`:** `resume` (`timeInterval` | `specificTime`), `amount`, `unit` e `dateTime`.
- **Até 60 s:** `setTimeout` com `AbortSignal`.
- **Acima de 60 s:**
  1. o engine serializa o estado (outputs, `runIndex`, `$vars`, filas de laço, ponto de retomada) em `execution_state`;
  2. marca a execução `waiting` e encerra o job;
  3. agenda um job atrasado `resume { executionId }`.
- O processor de retomada restaura o estado e continua a partir do Wait.
- **Reutilizado na spec 011** (aprovação humana).

### §6 `flow.stopAndError`
- `errorType`: `message` | `object`. Lança `UserDefinedError`, que segue o fluxo de error workflow (spec 007).

### §7 Reexecução
- **`POST /executions/:id/retry { useWorkflowVersion: 'original'|'published' }`** (`workflow:execute`): cria uma nova execução com `retry_of`.
  - Os nós `success` são pré-carregados como saídas (sem executar).
  - Os que falharam e seus descendentes executam.
- **`POST /workflows/:id/test-run`** ganha `startNodeId` + `sourceExecutionId`: carrega as saídas dos ancestrais de `startNodeId` e executa a partir dele.
- UI: "Reexecutar" na execução e "Executar a partir daqui" no nó.

### §8 Paginação HTTP
- **`options.pagination`:**
  - `mode`: `responseContainsNextURL` (`nextURL` expressão) | `updateParameterInEachRequest` (`parameters: [{ type: query|body|header, name, value }]`);
  - `paginationCompleteWhen`: `responseIsEmpty` | `receiveSpecificStatusCodes` (`statusCodes`) | `other` (`completeExpression`);
  - `maxRequests` (100) e `requestIntervalMs`.
- Expressões de paginação recebem `$response { body, headers, statusCode }` e `$pageCount`. A saída concatena os itens de todas as páginas.

### §9 Bateria de escape (`security/sandbox/`)
- **JS** (≥ 15 casos): `process`, `require`, `constructor.constructor`, `Error.prepareStackTrace`, `Proxy`, poluição de protótipo do host, alocação de 1 GB, recursão profunda, laço infinito, Promise pendente, `SharedArrayBuffer`/`Atomics`, leitura de globais do host.
- **Python** (≥ 15 casos): `socket`/`urllib` externo e interno, `open('/etc/passwd','w')`, `/proc/1/environ`, *fork bomb*, `ctypes`, `subprocess`, escrita fora de `/tmp`, encher `/tmp`, import não instalado, CPU, memória, saída gigante.
- **Asserção:** cada caso falha de forma controlada; worker e runner seguem saudáveis; uma execução concorrente "testemunha" termina corretamente.
- Job dedicado no CI.

## Modelo de dados

- Novas tabelas `execution_state (execution_id, state JSONB, resume_at)`.
- Novas colunas `executions.parent_execution_id`, `executions.depth` e `executions.retry_of`.
- Novo status `waiting`.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_PYRUNNER_URL` | `http://python-runner:8000` | Endereço do runner |
| `OLLY_PYRUNNER_TOKEN` | — | Token de serviço |
| `OLLY_PY_MEMORY_MB` / `OLLY_PY_CPU_SECONDS` / `OLLY_PY_TIMEOUT_SECONDS` / `OLLY_PY_MAX_OUTPUT_MB` | 256 / 30 / 60 / 50 | Limites |
| `OLLY_MAX_SUBWORKFLOW_DEPTH` | 5 | Profundidade |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| nsjail por requisição | Pyodide; processo persistente | Isolamento forte e bibliotecas nativas (pandas) |
| Estado serializado para Wait | Manter o job ocupado | Libera o worker; base da aprovação humana |
| Token de serviço | mTLS | Simplicidade inicial; mTLS como evolução |

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001, FR-003, FR-017 | Segurança | `security/sandbox/*` (SC-002) |
| FR-002 | Integração | `pyrunner-auth.int.test.ts` (SC-003) |
| FR-004, FR-005, FR-006 | Integração + pytest | `code-python.int.test.ts` (SC-001) |
| FR-007, FR-008 | Integração | `schedule.int.test.ts` (SC-004) |
| FR-009–FR-011 | Integração | `subworkflow.int.test.ts` (SC-006) |
| FR-012 | Integração | `wait-resume.int.test.ts` (SC-005) |
| FR-013 | Unidade | `stop-and-error.test.ts` |
| FR-014, FR-015 | Integração | `retry.int.test.ts` (SC-007) |
| FR-016 | Integração | `http-pagination.int.test.ts` (SC-008) |

## Riscos

| Risco | Mitigação |
|---|---|
| nsjail exigir capabilities amplas | Documentar cada uma; NetworkPolicy adicional na spec 012 |
| Serialização incompleta do estado | Teste de retomada em outro worker com laço + Merge |

Ao concluir, produzir `docs/seguranca-sandbox.md` (modelo de ameaça e controles).
