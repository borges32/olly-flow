# Plano técnico — Spec 020: Nó Schedule Trigger

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Nó `trigger.schedule`** (`packages/nodes/src/trigger/schedule/`), com os parâmetros no formato do Schedule Trigger 1.2 do N8N (`rule.interval[]`), para importar e exportar 1:1. Funções puras no mesmo pacote cobrem:
  - converter cada regra em expressão cron e intervalo de recorrência;
  - validar as regras;
  - calcular as próximas execuções;
  - montar o item de saída.
- **Fuso do workflow:** a configuração `settings.timezone` (IANA), com o padrão `OLLY_TIMEZONE`. Vale para as regras e para `$now`/`$today`.
- **Agendamentos ativos:** gravados na tabela `workflow_schedules`, na mesma transação da publicação, como a tabela `webhooks` (spec 005). A despublicação e a exclusão os removem.
- **Disparo:** *job schedulers* do BullMQ (já usados na manutenção, spec 009), numa fila `schedules`. Um reconciliador no worker mantém os schedulers do Redis iguais à tabela. O processador do disparo:
  - descarta as ocorrências atrasadas;
  - aplica a recorrência dos intervalos maiores que 1;
  - pula a ocorrência se houver execução agendada em andamento;
  - lança a execução de produção com a origem `schedule`.
- **Editor:** painel do nó com as próximas 5 execuções (rota de prévia na API) e o fuso nas configurações do workflow.
- **Importação e exportação do N8N:** conversor do `scheduleTrigger` (1 a 1.2) e do `settings.timezone`; exportação no mesmo formato.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| I — Spec antes do código | Spec 020 esclarecida pelo PO em 13/10/2026; a parte de agendamento da spec 008 aponta para cá |
| II — Compatibilidade com o N8N | Mesmos parâmetros (`rule.interval[]`), mesma saída, mesma recorrência dos intervalos; importação e exportação 1:1. Desvios decididos pelo PO: sem regra de segundos (mínimo de 1 minuto) e ocorrência pulada com execução em andamento |
| III — Segurança | SQL só parametrizado (Kysely); a rota de prévia declara `workflow:read`; nenhuma credencial envolvida; expressão cron validada antes de chegar ao Redis |
| IV — Testes | Unidade para regras, recorrência, validação, próximas execuções e item; integração com Redis e Postgres reais (Testcontainers) para publicação, disparo, sobreposição, atraso e 2 workers; E2E do painel |
| VII — Rastreabilidade | Publicação e despublicação auditadas com o número de regras ativadas (FR-012) |
| VIII — Privacidade e observabilidade | Toda execução agendada é registrada como as demais; métrica `olly.schedule.occurrences` (resultado: `started`, `skipped`, `lost`) e logs das ocorrências puladas e perdidas, sem dados de itens |
| IX — Simplicidade | Reaproveita o BullMQ (job schedulers) e o caminho de lançamento existente; dependência nova (`cron-parser`, MIT, já no lockfile pelo BullMQ) justificada; contratos alterados registrados em `contratos.md`, `modelo-dados.md` e `workflow-json.md` |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/shared-types` | `WorkflowSettings.timezone`; zod com fuso válido; origem de execução `schedule` nas listas/rótulos; tipos da prévia (`SchedulePreviewRequest/Response`) |
| `packages/nodes` | Nó `trigger.schedule`; `schedule/rules.ts` (cron, recorrência, validação, próximas execuções), `schedule/item.ts` (saída); dependência direta `cron-parser` |
| `packages/db` / `infra/migrations` | `0016_workflow_schedules` (tabela e índice para a checagem de sobreposição) |
| `packages/telemetry` | Contador `olly.schedule.occurrences` |
| `apps/api` | Publicação, despublicação e exclusão gravam/removem os agendamentos; validação na publicação; rota de prévia; `ScheduleSync` e `ScheduleProcessor` no worker; fuso do workflow no `ExecutionRunner`; importador e exportador do N8N |
| `apps/web` | Painel do agendamento no nó (próximas execuções, fuso efetivo, erros); fuso nas configurações do workflow; ícone; rótulo da origem "Agendamento" no log de execuções |
| `docs/` | `docs/nos/trigger.schedule.md`, `workflow-json.md`, `importacao-n8n.md`, `execucao.md`, `contratos.md`, `modelo-dados.md` |

## Design

### §1 Nó `trigger.schedule`

- **Tipo e versão:** `trigger.schedule`, versão 1, categoria `trigger`, sem entradas, saída `main`, ícone `clock`, nome "Agendamento (Schedule Trigger)".
- **Parâmetros** (mesmos nomes do N8N 1.2, para a importação e a exportação 1:1):

  ```text
  rule.interval[]: {
    field: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'cronExpression'  (padrão 'days')
    minutesInterval   (1–59, padrão 5)        x-display-options: field = minutes
    hoursInterval     (1–23, padrão 1)        field = hours
    daysInterval      (1–31, padrão 1)        field = days
    weeksInterval     (1–52, padrão 1)        field = weeks
    monthsInterval    (1–12, padrão 1)        field = months
    triggerAtDayOfMonth (1–31, padrão 1)      field = months
    triggerAtDay      (lista 0–6, dom = 0)    field = weeks (seleção múltipla)
    triggerAtHour     (0–23, padrão 0)        field ∈ days, weeks, months
    triggerAtMinute   (0–59, padrão 0)        field ∈ hours, days, weeks, months
    expression        (texto, cron)           field = cronExpression, x-no-expression
  }
  ```

  Os campos numéricos não aceitam expressão (`x-no-expression`), porque o agendamento é calculado na publicação, sem item.
- **Execução:** emite `ctx.triggerItems` quando a execução veio do agendador (FR-005). Sem eles (execução pelo editor), emite `scheduleItem(agora, fuso do workflow)` (FR-006).

### §2 Regras, recorrência e próximas execuções (`schedule/rules.ts`, funções puras)

- **`toSchedule(rule)`** devolve `{ pattern, recurrence? }`, como o `ScheduleTrigger` 1.2 do N8N:

  | Regra | `pattern` (cron com segundos) | Recorrência |
  |---|---|---|
  | minutos, N | `0 */N * * * *` | — |
  | horas, N, minuto M | `0 M * * * *` | `hours`, N (só se N > 1) |
  | dias, N, H:M | `0 M H * * *` | `days`, N (só se N > 1) |
  | semanas, N, dias D, H:M | `0 M H * * D` | `weeks`, N (só se N > 1) |
  | meses, N, dia DM, H:M | `0 M H DM * *` | `months`, N (só se N > 1) |
  | cron | a expressão (5 campos ganham `0` nos segundos) | — |

- **`recurrenceUnit(date, type, tz)`:** a unidade no fuso. Horas: hora do dia (mód 24); dias: dia do ano (mód 365); semanas: semana do ano (mód 52); meses: mês (mód 12).
- **`recurrenceAllows(type, size, current, last)`:** dispara se `last` é nulo ou se `current === (last + size) % mod`. É a regra do `recurrenceCheck` do N8N.
- **Conferência com o código do N8N:** os módulos e a semana do ano são conferidos na tarefa T002, e as diferenças vão para o relatório.
- **`ruleIssues(rule)`:** valida a faixa de cada campo, a expressão cron e o mínimo de 1 minuto (FR-008). A expressão é interpretada pelo `cron-parser`. Com 6 campos, os segundos têm de ser um valor único (sem `*`, `/`, `,` ou `-`); com 5 campos, o mínimo de 1 minuto vale por construção. Pelo menos 1 dia da semana na regra semanal.
- **`nextRuns(rules, tz, from, count = 5)`:** junta as ocorrências de todas as regras, sem repetir o mesmo instante, filtradas pela recorrência. Supõe que a primeira ocorrência após `from` é a primeira execução, como depois de uma publicação.

### §3 Item de saída (`schedule/item.ts`)

- **`scheduleItem(date, tz)`:** devolve os campos `timestamp`, `Readable date`, `Readable time`, `Day of week`, `Year`, `Month`, `Day of month`, `Hour`, `Minute`, `Second` e `Timezone`, nos formatos do N8N:
  - `timestamp`: ISO com o deslocamento do fuso;
  - `Readable date`: data por extenso em inglês com ordinal (ex.: `October 13th 2026, 8:30:00 am`);
  - `Readable time`: só a hora (ex.: `8:30:00 am`);
  - `Day of week` e `Month`: nomes em inglês;
  - demais campos numéricos: texto com 2 dígitos;
  - `Timezone`: `America/Sao_Paulo (UTC-03:00)`.
- **Implementação:** com o `Intl.DateTimeFormat`, sem dependência nova. O teste fixa os formatos contra uma saída de referência do N8N.

### §4 Fuso horário do workflow (FR-004)

- **Configuração:** `WorkflowSettings.timezone?: string`. O zod aceita os fusos de `Intl.supportedValuesOf('timeZone')` e `UTC`; sem o campo, vale `OLLY_TIMEZONE`.
- **`ExecutionRunner`:** passa `definition.settings.timezone ?? config.execution.timezone` ao contexto das expressões (`$now`, `$today`). O mesmo vale na prévia de expressões.
- **Editor:** "Fuso horário" nas configurações do workflow, com "Padrão da plataforma" e a lista de fusos.

### §5 Agendamentos ativos e publicação (FR-002, FR-012)

- **Migration `0016_workflow_schedules`:**

  ```sql
  CREATE TABLE workflow_schedules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
    version     INT  NOT NULL,
    node_id     TEXT NOT NULL,
    rule_index  INT  NOT NULL,
    pattern     TEXT NOT NULL,
    timezone    TEXT NOT NULL,
    recurrence  JSONB,          -- { type, size } quando o intervalo é maior que 1
    last_unit   INT,            -- última unidade executada (recorrência)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workflow_id, node_id, rule_index)
  );
  ```

  Também cria o índice parcial em `executions (workflow_id)`, com `trigger_type = 'schedule' AND status IN ('queued', 'running', 'waiting')`, para a checagem de sobreposição (§7). Se a tabela particionada exigir, o índice é criado por partição, como os demais.
- **`PublishingService.prepare`:** acrescenta `scheduleIssues(definition)`, com `ruleIssues` de cada regra dos nós `trigger.schedule` habilitados e o fuso válido. Os erros `SCHEDULE_RULE_INVALID` e `SCHEDULE_TIMEZONE_INVALID` recusam a publicação (FR-007) e também aparecem como pendências no painel de problemas do editor.
- **`publish`:** na mesma transação que regrava os `webhooks`, apaga e insere as linhas de `workflow_schedules` da versão publicada. A auditoria `workflow.publish` ganha `details.schedules`, com o número de regras (FR-012). A aprovação da spec 009 publica pelo mesmo método, então o agendamento só começa na aprovação.
- **`unpublish` e `delete`:** apagam as linhas. A auditoria já existente registra o fato.
- **Aviso aos workers:** depois do commit, a API publica `olly:schedules:changed` no Redis, como o `WebhookRegistry.reload()`.

### §6 Sincronização com o BullMQ (`apps/api/src/schedules/schedule-sync.ts`, no worker)

- **Fila:** `schedules`, em `queue/constants.ts`.
- **`reconcile()`:**
  - **desejado:** linhas de `workflow_schedules` cujo workflow está ativo (`active`) e com `published_version = version`;
  - **id do scheduler:** `wf:<workflowId>:<nodeId>:<ruleIndex>:v<version>:<hash curto(pattern, timezone)>`;
  - **existentes:** `queue.getJobSchedulers()`, filtrando o prefixo `wf:`;
  - **ações:** remove os que sobram (`removeJobScheduler`) e cria os que faltam (`upsertJobScheduler(id, { pattern, tz }, { name: 'fire', data: { scheduleId, workflowId, version, nodeId, ruleIndex } })`).
- **Quando roda:**
  - na partida do worker;
  - a cada mensagem `olly:schedules:changed`;
  - a cada `OLLY_SCHEDULE_RECONCILE_MS` (padrão 60 s), para cobrir mensagens perdidas.

  Um lock no Redis (`SET NX PX`) evita dois workers reconciliando ao mesmo tempo; as operações também são idempotentes.
- **Unicidade (FR-003):** o BullMQ gera um único job por horário de cada scheduler, com qualquer número de workers. Trocar de versão troca o id do scheduler, então não sobra disparo da regra antiga (SC-002).

### §7 Disparo (`apps/api/src/schedules/schedule-processor.ts`, worker da fila `schedules`)

Para cada job `fire`:

1. **Horário agendado:** lido do id do job gerado pelo scheduler (`repeat:<schedulerId>:<millis>`), com `timestamp + delay` como alternativa. O teste de integração fixa a forma contra o BullMQ instalado.
2. **Vigência:** carrega a linha e o workflow. Sem linha, workflow inativo ou versão diferente da publicada, descarta (log `debug`).
3. **Atraso (FR-015):** se `agora − horário > OLLY_SCHEDULE_MAX_DELAY_MS` (padrão 60 s), a ocorrência é perdida. Registra o log `warn` e a métrica `lost`, sem execução. Isso também cobre a plataforma que volta depois de um tempo fora.
4. **Recorrência:** com `recurrence`, faz `UPDATE workflow_schedules SET last_unit = $atual WHERE id = $id AND (last_unit IS NULL OR $atual = (last_unit + size) % mod) RETURNING id`. Sem linha devolvida, não é uma ocorrência: descarta, sem métrica.
5. **Sobreposição (FR-014):** com um lock por workflow no Redis (`olly:schedule:wf:<id>`), procura uma execução com `workflow_id = $id`, `trigger_type = 'schedule'` e `status IN ('queued', 'running', 'waiting')`.
   - **Se existe:** pula, com log `info` e a métrica `skipped`.
   - **Se não existe:** lança, ainda dentro do lock, para que regras coincidentes não lancem duas execuções.
6. **Lançamento:** lê a versão publicada (`readDefinition`) e chama `ExecutionsService.launch`, o mesmo caminho do webhook e dos sub-workflows, com:
   - `mode: 'production'`, `triggerType: 'schedule'` e `triggeredBy: null`;
   - `job: { triggerItems: [scheduleItem(horário, fuso)], startNodeId: nodeId }`.

   Registra a métrica `started`. A cota do projeto (spec 006), a política de dados (spec 009) e o workflow de erro (spec 007) valem como em qualquer execução de produção (FR-009).

### §8 Prévia e editor (FR-007)

- **Rota:** `POST /api/v1/workflows/:id/schedule/preview`, com `workflow:read`.
  - **Entrada:** `{ rules, timezone? }`, os parâmetros do nó no rascunho.
  - **Saída:** `{ timezone, runs: string[] (ISO, até 5), issues: { ruleIndex, message }[] }`.
- **`SchedulePanel`** no painel de parâmetros do `trigger.schedule`, como o `WebhookPanel`:
  - mostra as próximas 5 execuções no fuso efetivo e os problemas de cada regra;
  - recalcula com *debounce* quando os parâmetros mudam;
  - avisa que o agendamento só vale depois de publicar.
- **Log de execuções:** filtro e rótulo "Agendamento" para a origem `schedule`.

### §9 Importação e exportação do N8N (FR-010, FR-011)

- **Conversor `n8n-nodes-base.scheduleTrigger` (1 a 1.2):**
  - copia `rule.interval[]`, com os padrões do N8N para os campos ausentes;
  - converte a v1 (`rule.interval[].field` com `cronExpression` no mesmo formato);
  - `secondsInterval` múltiplo de 60 vira `minutes` com N/60;
  - os demais segundos ficam como regra `minutes` vazia e inválida, com pendência no relatório. A publicação fica bloqueada pelo `ruleIssues` (HU-5.3).
- **Configuração do workflow:** `settings.timezone` do N8N vira `settings.timezone`; `DEFAULT` ou ausente fica sem o campo.
- **Exportação:** o nó sai como `n8n-nodes-base.scheduleTrigger`, `typeVersion: 1.2`, com os mesmos parâmetros, e `settings.timezone` volta. O teste de ida e volta da spec 015 ganha o caso.

## Modelo de dados

- Tabela `workflow_schedules` e o índice parcial em `executions` (§5), na migration `0016_workflow_schedules.{up,down}.sql`.
- `executions.trigger_type` recebe o valor novo `schedule` (coluna de texto, sem mudança de esquema).
- Atualizar `docs/arquitetura/modelo-dados.md`.

## Contratos

| Contrato | Mudança |
|---|---|
| Nó `trigger.schedule` | Parâmetros do §1, saída do §3 |
| `WorkflowSettings` | `timezone?: string` (IANA) |
| `POST /api/v1/workflows/:id/schedule/preview` | `workflow:read`; entrada e saída do §8 |
| Execução | Origem `triggerType: 'schedule'` |
| Redis | Fila `schedules`; canal `olly:schedules:changed`; locks `olly:schedule:*` |
| Publicação | Erros `SCHEDULE_RULE_INVALID` e `SCHEDULE_TIMEZONE_INVALID`; auditoria com `details.schedules` |

## Permissões RBAC

| Permissão | Situação no catálogo/seed | Papéis | O que esta spec faz |
|---|---|---|---|
| `workflow:read` | Existe | Todos os papéis do projeto | Protege a rota de prévia |
| `workflow:publish` | Existe | admin, editor | Ativa e desativa os agendamentos, pela publicação |

Nenhuma permissão nova.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_TIMEZONE` | (existente) | Fuso padrão dos workflows sem fuso próprio |
| `OLLY_SCHEDULE_MAX_DELAY_MS` | `60000` | Atraso máximo para uma ocorrência ainda começar; acima disso, é perdida (FR-015) |
| `OLLY_SCHEDULE_RECONCILE_MS` | `60000` | Intervalo da reconciliação periódica dos schedulers |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| *Job schedulers* do BullMQ | Relógio próprio com lock no Redis; `node-cron` em cada worker | Já usados na manutenção (spec 009) e previstos no plano da 008; garantem um job por horário entre workers; aceitam `tz` |
| Tabela `workflow_schedules` como fonte de verdade e reconciliação | Criar e remover os schedulers só na publicação | O Redis pode perder dados ou mensagens; a reconciliação na partida e periódica restaura o estado sem duplicar (HU-2.5) |
| Parâmetros iguais aos do N8N 1.2 | Formato próprio (`rules: [{ type, every, unit }]` do plano da 008) | Importação e exportação 1:1 (FR-010), sem tradução nos dois sentidos |
| Recorrência como no `recurrenceCheck` do N8N | Cron com `*/N` | `*/N` em dias e meses reinicia a cada mês ou ano; o N8N conta a partir da primeira execução (SC-003) |
| Checagem de sobreposição pelo banco, com lock por workflow | Contador no Redis | O estado das execuções está no banco; o lock evita duas execuções de regras coincidentes |
| Descartar ocorrências atrasadas | Executar a atrasada uma vez, como o BullMQ faria | Decisão do PO (FR-015), como no N8N |
| Prévia calculada na API | Calcular no navegador | Uma só implementação das regras, sem `cron-parser` no bundle do editor |
| `cron-parser` como dependência direta de `@olly/nodes` | Escrever o interpretador de cron | Já está no lockfile (dependência do BullMQ, 5.10.1); evita reimplementar um formato com muitos casos |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001, FR-008 | Unidade | `packages/nodes/src/trigger/schedule/rules.test.ts` (cron por regra, validação, mínimo de 1 minuto, segundos únicos) |
| FR-004 | Unidade + integração | `shared-types` (zod do fuso); `apps/api/src/schedules/schedule.int.test.ts` (`$now` no fuso do workflow) |
| FR-005, FR-006 | Unidade | `schedule/item.test.ts` (formatos do N8N); `schedule.test.ts` (editor e produção) |
| FR-002, FR-003, FR-012 | Integração | `schedule.int.test.ts`: publicar, trocar de versão, despublicar, excluir, aprovação, reinício (reconciliação), auditoria |
| FR-007 | Unidade + integração + E2E | `rules.test.ts` (`nextRuns`); rota de prévia (`schedule.int.test.ts`); publicação recusada; `apps/web/e2e/schedule.spec.ts` (painel) |
| FR-009 | Integração | `schedule.int.test.ts` (origem `schedule`, cota, workflow de erro) |
| FR-010, FR-011 | Unidade | `apps/api/src/workflow-io/n8n.test.ts` (conversão 1 a 1.2, segundos, fuso, pendência); `round-trip.test.ts` |
| FR-013 | Unidade | `apps/api/src/workflow-io/docs.test.ts` (nó documentado no catálogo) |
| FR-014, FR-015 | Integração | `schedule.int.test.ts` (execução em andamento pula; regras coincidentes geram uma; atraso acima da tolerância descarta) |
| SC-001 | Integração | `schedule.int.test.ts` › 2 workers, regra de 1 minuto, 3 execuções em 3 minutos (tempo real; único teste longo, NFR-002) |
| SC-003 | Unidade | `rules.test.ts`: próximas 5 execuções por tipo de regra contra valores de referência do N8N |
| SC-004 | Unidade | `n8n.test.ts` e fixture sintética `fixtures/n8n/exemplo-schedule-trigger` |
| SC-005 | Integração | `schedule.int.test.ts` (expressões `$json.Hour` e `$json["Day of week"]`) |

## Riscos

| Risco | Mitigação |
|---|---|
| Formato do id do job do scheduler mudar entre versões do BullMQ | Alternativa `timestamp + delay` e teste de integração que fixa a forma |
| Diferenças sutis com o N8N na recorrência ou nos formatos da saída | Tarefa T002 confere com o código do N8N; SC-003 compara com valores de referência; diferenças registradas no relatório |
| Teste de 3 minutos (SC-001) lento ou instável | Único teste em tempo real, com tolerância de início; os demais usam regras e horários simulados |
| Índice parcial em tabela particionada | Criado por partição na migration, como os índices existentes; a manutenção diária cria as partições futuras com ele |
| Execução em espera (`waiting`) bloqueia o agendamento por muito tempo | Comportamento decidido (FR-014: "em andamento" inclui a espera); documentado em `docs/nos/trigger.schedule.md` |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 13/10/2026 | Criação do plano | Spec 020 esclarecida pelo PO |
