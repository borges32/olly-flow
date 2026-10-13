# Spec 020 — Nó Schedule Trigger

| Campo | Valor |
|---|---|
| **Status** | Planejada |
| **Fase** | 4 — Hardening (paridade com o N8N, apoio à migração) |
| **Depende de** | 005, 006, 009, 015 |
| **Requisitos de produto** | PR-17 (parcial), PR-20 (parcial) |
| **ADRs relacionadas** | 0001, 0004 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Hoje um workflow do Olly Flow só começa de três jeitos:
- pelo editor (gatilho manual, execução de teste);
- por um sistema externo (webhook, spec 005);
- por outro workflow (sub-workflow, spec 008).

Não há como executá-lo sozinho num horário ou a cada intervalo. Exemplos de uso:
- relatório diário às 8h;
- sincronização a cada 15 minutos;
- limpeza semanal;
- cobrança no dia 5 de cada mês.

No N8N, esse papel é do nó **Schedule Trigger** (`n8n-nodes-base.scheduleTrigger`). Ele é um dos gatilhos mais usados nos workflows da POC. Sem um equivalente:
- esses workflows chegam à importação como nós marcadores (spec 015, [docs/importacao-n8n.md](../../docs/importacao-n8n.md));
- quem migra precisa de um agendador externo chamando um webhook.

**Relação com a spec 008:** a spec 008 já previa o gatilho `trigger.schedule` (FR-007, FR-008, SC-004), em forma resumida (cron ou intervalo), e essa parte nunca foi implementada (tarefas T020 a T022 pendentes). Esta spec substitui essa parte, com o comportamento do Schedule Trigger do N8N. A spec 008 aponta para cá no seu histórico.

## Histórias de usuário

### HU-1 — Executar o workflow em horários definidos (Prioridade: P1)

Como **editor**, quero um gatilho que executa o workflow publicado sozinho, em intervalos ou horários definidos, para automatizar tarefas recorrentes sem depender de um sistema externo.

**Teste independente:** publicar um workflow com o gatilho "a cada minuto" e conferir que, em 3 minutos, ocorrem exatamente 3 execuções de produção, mesmo com mais de um worker.

**Cenários de aceite:**
1. **Dado** um workflow publicado com a regra "a cada 1 minuto", **quando** passam 3 minutos, **então** ocorrem exatamente 3 execuções, com 2 ou mais workers.
2. **Dado** a regra "todo dia às 08:30", **quando** chega 08:30 no fuso do workflow, **então** o workflow executa uma vez.
3. **Dado** a regra "toda semana, segunda e quarta, às 09:00", **quando** chega cada um desses dias e horários, **então** o workflow executa.
4. **Dado** a regra "todo mês, no dia 5, às 07:00", **quando** chega o dia 5 às 07:00, **então** o workflow executa.
5. **Dado** a regra "a cada 2 horas, no minuto 15", **quando** o relógio passa pelos horários correspondentes, **então** o workflow executa às hh:15, de 2 em 2 horas a partir da primeira execução após a publicação, como no N8N.
6. **Dado** uma expressão cron personalizada, **quando** ela coincide com o horário atual, **então** o workflow executa.
7. **Dado** um gatilho com várias regras, **quando** qualquer uma coincide, **então** o workflow executa. Regras que coincidem no mesmo instante geram uma só execução; as demais ocorrências são puladas pela regra da execução em andamento (FR-014). No N8N, cada uma geraria uma execução.
8. **Dado** uma execução agendada anterior do mesmo workflow ainda em andamento, **quando** chega o próximo horário, **então** essa ocorrência é pulada e registrada, sem nova execução.

### HU-2 — Ativar e desativar pela publicação (Prioridade: P1)

Como **editor**, quero que o agendamento passe a valer ao publicar e pare ao despublicar, para controlar quando o workflow roda em produção.

**Teste independente:** publicar, conferir execuções, despublicar e conferir que nenhuma execução nova aparece; republicar com outra regra e conferir que só a regra nova vale.

**Cenários de aceite:**
1. **Dado** um rascunho com o gatilho, **quando** salvo sem publicar, **então** nenhuma execução agendada acontece.
2. **Dado** um workflow publicado, **quando** despublico, **então** as execuções agendadas param.
3. **Dado** um workflow publicado com a regra "a cada 5 minutos", **quando** publico uma versão nova com "a cada 10 minutos", **então** só a regra nova vale, sem execuções duplicadas da versão antiga.
4. **Dado** um projeto com aprovação para publicar (spec 009), **quando** o pedido ainda não foi aprovado, **então** o agendamento da versão pedida não vale.
5. **Dado** um workflow publicado, **quando** é excluído ou a plataforma reinicia, **então** o agendamento é removido ou restabelecido conforme o estado de publicação, sem duplicidade.

### HU-3 — Ver as próximas execuções e testar no editor (Prioridade: P1)

Como **editor**, quero ver quando o workflow vai rodar e testá-lo sem esperar o horário, para conferir a regra e os dados antes de publicar.

**Teste independente:** configurar uma regra no painel do nó, conferir as próximas 5 execuções exibidas, executar o workflow no editor e conferir a saída do gatilho.

**Cenários de aceite:**
1. **Dado** uma regra válida, **quando** abro o painel do nó, **então** vejo as próximas 5 execuções, no fuso do workflow.
2. **Dado** uma expressão cron inválida, um valor fora da faixa (ex.: minuto 75) ou uma regra que executaria mais de uma vez por minuto, **quando** salvo ou publico, **então** a validação aponta o problema no parâmetro, e a publicação é recusada.
3. **Dado** o gatilho no editor, **quando** clico em "Executar workflow", **então** o workflow executa uma vez na hora, com a saída do gatilho calculada para o momento atual, como no N8N.

### HU-4 — Usar a data e a hora da execução nos nós seguintes (Prioridade: P1)

Como **editor**, quero que o gatilho entregue a data e a hora da execução, para usá-las em expressões (ex.: o período de um relatório).

**Teste independente:** executar o gatilho e conferir os campos do item de saída.

**Cenários de aceite:**
1. **Dado** uma execução agendada, **quando** o gatilho emite o item, **então** ele traz os mesmos campos do N8N: `timestamp` (ISO 8601 com o deslocamento do fuso), `Readable date`, `Readable time`, `Day of week`, `Year`, `Month`, `Day of month`, `Hour`, `Minute`, `Second` e `Timezone`.
2. **Dado** um workflow importado do N8N com expressões como `{{ $json["Day of week"] }}`, **quando** executa, **então** as expressões funcionam sem ajuste.

### HU-5 — Importar o gatilho do N8N (Prioridade: P1)

Como **editor que migra do N8N**, quero que o Schedule Trigger seja importado com as mesmas regras, para não reconfigurar cada workflow.

**Teste independente:** importar um workflow do N8N com Schedule Trigger com várias regras e conferir o nó convertido e as próximas execuções iguais às do N8N.

**Cenários de aceite:**
1. **Dado** um Schedule Trigger do N8N (versões 1 a 1.2) com regras de minutos, horas, dias, semanas, meses ou cron, **quando** importo, **então** o nó vem convertido com as mesmas regras, sem nó marcador.
2. **Dado** uma regra de segundos múltipla de 60 (ex.: a cada 120 segundos), **quando** importo, **então** ela vira a regra equivalente em minutos.
3. **Dado** uma regra sem equivalente (ex.: a cada 30 segundos, abaixo do mínimo de 1 minuto), **quando** importo, **então** o nó vem com a regra a corrigir e o relatório da importação mostra a pendência; a publicação fica bloqueada até a correção.
4. **Dado** o fuso horário nas configurações do workflow do N8N, **quando** importo, **então** o workflow vem com o mesmo fuso.

### HU-6 — Exportar no formato do N8N (Prioridade: P2)

Como **editor**, quero que o arquivo baixado (spec 015) traga o gatilho no formato do N8N, para manter a ida e a volta entre as plataformas.

**Teste independente:** baixar um workflow com o gatilho, importá-lo de novo e conferir as mesmas regras.

**Cenários de aceite:**
1. **Dado** um workflow com o Schedule Trigger, **quando** baixo o JSON, **então** o nó sai como `n8n-nodes-base.scheduleTrigger`, com as regras no formato do N8N, e a reimportação devolve o mesmo nó.

### Casos de borda

- **Plataforma fora do ar no horário agendado:** as execuções perdidas não são recuperadas depois, como no N8N. Ao voltar, a plataforma segue a partir do próximo horário.
- **Execução anterior ainda em andamento** (na fila, executando ou em espera): a ocorrência é pulada e registrada (decisão do PO, 13/10/2026; o N8N executaria mesmo assim).
- **Horário de verão e fusos:** a regra segue o relógio local do fuso. Um horário que não existe na mudança de horário (ex.: 00:30 no dia em que o relógio pula de 00:00 para 01:00) não executa ou executa uma vez, sem duplicar.
- **Dia do mês inexistente** (ex.: dia 31 em fevereiro): o mês sem o dia não executa, como numa expressão cron.
- **Intervalo maior que 1 em horas, dias, semanas ou meses** (ex.: "a cada 2 semanas"): conta a partir da primeira execução após a publicação, como no N8N.
- **Vários gatilhos agendados no mesmo workflow:** cada um dispara o workflow pelas próprias regras.
- **Workflow publicado com credencial ou projeto removido:** a execução agendada falha e é registrada como as demais execuções de produção (log, workflow de erro da spec 007).
- **Retenção e política de dados (spec 009):** as execuções agendadas são execuções de produção e seguem a política do projeto.

## Requisitos funcionais

- **FR-001**: O sistema DEVE oferecer o gatilho Schedule Trigger, com uma ou mais regras. Cada regra é de um destes tipos, com os parâmetros do N8N:
  - a cada N minutos;
  - a cada N horas, no minuto M;
  - a cada N dias, na hora H e no minuto M;
  - a cada N semanas, nos dias da semana escolhidos, na hora H e no minuto M;
  - a cada N meses, no dia D, na hora H e no minuto M;
  - expressão cron personalizada (5 ou 6 campos, com segundos opcionais).
- **FR-002**: O agendamento DEVE valer só para a versão publicada. Ele começa na publicação (ou na aprovação, quando o projeto exige aprovação), troca de regras ao publicar uma versão nova e termina ao despublicar ou excluir o workflow.
- **FR-003**: Cada horário agendado DEVE gerar exatamente uma execução de produção por regra, com qualquer número de workers e após reinícios da plataforma.
- **FR-004**: O workflow DEVE ter uma configuração própria de fuso horário, como no N8N, com o fuso da plataforma como padrão. As regras seguem esse fuso, e ele vale também para `$now` e `$today` nas execuções do workflow, como no N8N.
- **FR-005**: O gatilho DEVE emitir um item com `timestamp`, `Readable date`, `Readable time`, `Day of week`, `Year`, `Month`, `Day of month`, `Hour`, `Minute`, `Second` e `Timezone`, nos formatos do N8N, calculados para o horário da execução no fuso do workflow.
- **FR-006**: Na execução pelo editor, o gatilho DEVE emitir o item uma vez, calculado para o momento atual, sem esperar o horário.
- **FR-007**: O editor DEVE validar as regras (faixas de valores e expressão cron) e mostrar as próximas 5 execuções. A publicação DEVE ser recusada com uma regra inválida.
- **FR-008**: O intervalo mínimo entre execuções de uma regra DEVE ser de 1 minuto. Não há regra de segundos, e uma expressão cron com o campo de segundos só pode fixar um segundo (ex.: `30 */5 * * * *`).
- **FR-009**: As execuções agendadas DEVEM aparecer no log de execuções com a origem "agendamento", seguir as cotas de execução do projeto (spec 006), a política de dados e a retenção (spec 009) e acionar o workflow de erro (spec 007) quando falham.
- **FR-010**: O importador do N8N DEVE converter o Schedule Trigger (versões 1 a 1.2) com todas as regras, e o arquivo exportado DEVE trazer o nó no formato do N8N, com ida e volta sem perda.
- **FR-011**: Regras sem equivalente na importação (ex.: segundos abaixo de 60 ou não múltiplos de 60) DEVEM aparecer como pendências no relatório da importação, e a regra importada fica inválida até a correção.
- **FR-012**: O sistema DEVE auditar a ativação e a desativação de agendamentos junto com a publicação e a despublicação (spec 005, FR-016).
- **FR-013**: A documentação do nó DEVE existir em `docs/nos/`, e o catálogo de `docs/nos/workflow-json.md` DEVE incluir o nó, para pessoas e modelos de IA (spec 015).
- **FR-014**: QUANDO há uma execução agendada anterior do mesmo workflow em andamento (na fila, executando ou em espera), a ocorrência DEVE ser pulada, sem criar execução, e registrada no log da plataforma e na métrica de agendamentos.
- **FR-015**: Ocorrências perdidas com a plataforma fora do ar NÃO DEVEM ser executadas depois. Uma ocorrência que começaria com atraso maior que a tolerância configurada é descartada e registrada como perdida.

## Requisitos não funcionais

- **NFR-001**: O atraso entre o horário agendado e o início da execução é de até 5 segundos com a fila sem carga.
- **NFR-002**: Os testes automatizados não dependem do relógio real (tempo simulado ou intervalos curtos), exceto o teste de SC-001.
- **NFR-003**: Interface em português do Brasil (NFR-G07); os nomes dos campos de saída seguem o N8N, por compatibilidade das expressões (ADR-0001).

## Entidades-chave

- **Regra de agendamento**: tipo (minutos, horas, dias, semanas, meses, cron) e os parâmetros do tipo.
- **Agendamento ativo**: ligação entre a versão publicada de um workflow, o gatilho e cada regra, com o fuso e, para intervalos maiores que 1, a última ocorrência executada.
- **Execução agendada**: execução de produção com origem "agendamento" e o horário que a originou.

## Critérios de sucesso

- **SC-001**: Um workflow publicado com a regra "a cada 1 minuto" gera exatamente 3 execuções em 3 minutos, com 2 workers (substitui o SC-004 da spec 008).
- **SC-002**: Despublicar interrompe as execuções; publicar uma versão com outra regra não deixa execuções da regra antiga.
- **SC-003**: Para cada tipo de regra, as próximas 5 execuções calculadas coincidem com as do N8N para os mesmos parâmetros e fuso.
- **SC-004**: Um workflow do N8N com Schedule Trigger importa sem nó marcador, e o arquivo exportado reimporta com as mesmas regras.
- **SC-005**: Uma expressão do N8N com os campos de saída do gatilho (`$json.Hour`, `$json["Day of week"]`) funciona sem ajuste.

## Fora do escopo

- Recuperar execuções perdidas enquanto a plataforma estava fora do ar.
- Os gatilhos antigos do N8N **Cron** (`n8n-nodes-base.cron`) e **Interval** (`n8n-nodes-base.interval`): a POC não os usa; continuam como nós marcadores.
- Pausar o agendamento sem despublicar o workflow.
- Agendamentos com data de início e de fim ou execuções únicas numa data (o N8N também não oferece no Schedule Trigger).
- Calendários de feriados e dias úteis.
- Python, reexecução, Stop and Error e paginação da spec 008, que continuam lá.

## Pré-requisitos humanos

- ~~Responder aos pontos em aberto~~ (respondidos em 13/10/2026).
- Revisar plano e tarefas.
- Workflows da POC com Schedule Trigger em `fixtures/n8n/`.

## Pontos em aberto

Nenhum. Respondidos pelo PO em 13/10/2026:
- **Fuso horário:** cada workflow tem o seu, como no N8N; padrão: o da plataforma (FR-004).
- **Intervalo mínimo:** 1 minuto (FR-008).
- **Execução anterior em andamento:** pular a ocorrência (FR-014).
- **Execuções perdidas:** não são recuperadas, como no N8N (FR-015).
- **Gatilhos antigos Cron e Interval:** a POC não usa; fora do escopo.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 13/10/2026 | Criação da spec, a pedido do PO ("novo nó do tipo Schedule Trigger semelhante ao do N8N"). Substitui a parte de agendamento da spec 008 (FR-007, FR-008, SC-004; tarefas T020 a T022), que nunca foi implementada | Paridade com o N8N e migração dos workflows da POC |
| 13/10/2026 | Pontos em aberto respondidos pelo PO: fuso por workflow (FR-004, que passa a valer também para `$now`/`$today`), mínimo de 1 minuto sem regra de segundos (FR-008, HU-5), pular com execução anterior em andamento (FR-014, novo), sem recuperar execuções perdidas (FR-015, novo), Cron e Interval fora do escopo. Status: Planejada | Esclarecimento |
