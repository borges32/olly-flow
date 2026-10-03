# Spec 006 — Fila, workers e paralelismo

| Campo | Valor |
|---|---|
| **Status** | Aprovada |
| **Fase** | 2 — Execução avançada |
| **Depende de** | 005 + Go/No-Go aprovado |
| **Requisitos de produto** | PR-12, PR-20 (parcial) |
| **ADRs relacionadas** | 0001 (paralelismo diverge do N8N), 0006 |

## Contexto e problema

No MVP as execuções rodam no processo da API, o que não escala e mistura responsabilidades. Os workflows também precisam de **paralelismo real**: ramos independentes devem rodar ao mesmo tempo. No N8N eles rodam em sequência, e essa diferença é intencional (ADR-0001).

## Histórias de usuário

### HU-1 — Ramos em paralelo (P1)

Como **editor**, quero que ramos independentes rodem simultaneamente para reduzir o tempo total da execução.

**Cenários de aceite:**
1. **Dado** 3 chamadas HTTP independentes de 1 s cada, **quando** executo, **então** o tempo total é próximo de 1 s.
2. **Dado** o mesmo workflow e a mesma entrada, **quando** executo várias vezes, **então** o resultado é sempre idêntico.

### HU-2 — Itens em paralelo (P1)

Como **editor**, quero processar os itens de um nó com concorrência limitada, preservando a ordem dos resultados.

### HU-3 — Execução escalável e resiliente (P1)

Como **administrador da plataforma**, quero que as execuções rodem em workers escaláveis, sem execuções "presas" quando um worker cai.

**Cenários de aceite:**
1. **Dado** 3 workers, **quando** chegam muitas execuções, **então** elas são distribuídas entre eles.
2. **Dado** um worker que cai no meio de uma execução, **quando** a falha é detectada, **então** a execução termina como erro (`worker_lost`), nunca fica "em execução" indefinidamente.

### HU-4 — Cancelar e limitar (P2)

Como **executor**, quero parar uma execução em andamento. Como **administrador**, quero limitar as execuções simultâneas por projeto.

### Casos de borda

- Ramo sem itens (ex.: saída `false` vazia do If): os nós seguintes não executam e não bloqueiam os demais.
- Execução excede o timeout global: é cancelada com motivo `timeout`.

## Requisitos funcionais

- **FR-001**: As execuções de produção DEVEM ser enfileiradas e processadas por workers independentes da API. A fila carrega apenas referências, não payloads.
- **FR-002**: A API DEVE continuar recebendo respostas síncronas de webhook a partir dos workers.
- **FR-003**: Os eventos de execução DEVEM chegar ao editor mesmo com várias instâncias de API e workers.
- **FR-004**: O worker DEVE encerrar de forma graciosa: parar de consumir e aguardar as execuções em andamento até um limite.
- **FR-005**: QUANDO um worker cair durante uma execução, ela DEVE terminar com status `error` e motivo `worker_lost`. O sistema NÃO DEVE reexecutá-la automaticamente.
- **FR-006**: O motor DEVE executar concorrentemente todos os nós prontos, respeitando o limite de paralelismo do workflow.
- **FR-007**: Um ramo sem itens NÃO DEVE executar os nós seguintes e DEVE ser considerado resolvido ("sem dados") para os nós que aguardam várias entradas.
- **FR-008**: O resultado da execução DEVE ser determinístico, independentemente da ordem de conclusão dos nós.
- **FR-009**: Nós elegíveis DEVEM oferecer processamento de itens em paralelo, com concorrência configurável e preservação da ordem.
- **FR-010**: O sistema DEVE permitir cancelar uma execução, interrompendo as operações em andamento.
- **FR-011**: O sistema DEVE aplicar um timeout global por workflow.
- **FR-012**: O sistema DEVE limitar as execuções simultâneas por projeto. As excedentes permanecem na fila.
- **FR-013**: O editor DEVE exibir vários nós em execução simultânea e uma linha do tempo da execução.
- **FR-014**: O ambiente local DEVE permitir escalar workers horizontalmente.

## Requisitos não funcionais

- **NFR-001**: Cancelamento efetivo em até 2 s.
- **NFR-002**: Medição de carga registrada (throughput, p50/p95/p99, fila, memória).

## Entidades-chave

- **Job de execução**: referência à execução na fila.
- **Cota de projeto**: limite de execuções simultâneas.

## Critérios de sucesso

- **SC-001**: 3 ramos de 1 s terminam em ~1 s.
- **SC-002**: 20 execuções seguidas produzem saídas idênticas.
- **SC-003**: 20 itens de 500 ms com concorrência 5 levam ~2 s, com a ordem preservada.
- **SC-004**: Worker morto gera `error`/`worker_lost`.
- **SC-005**: Cancelamento interrompe `pg_sleep` em até 2 s.
- **SC-006**: Cota de 2 mantém a 3ª execução na fila.
- **SC-007**: Suíte das specs anteriores verde; resultados do k6 no relatório.

## Fora do escopo

Merge, While, Switch, porta de erro, Python, cron e Kubernetes.

## Pré-requisitos humanos

- Go/No-Go aprovado e registrado em ADR.
- Desejável: ADR-0006 decidida. Se não estiver, segue com Docker Compose.

## Pontos em aberto

Nenhum.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 5 | Migração para SDD |
