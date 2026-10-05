# Spec 008 — Python, agendamento e nós auxiliares

| Campo | Valor |
|---|---|
| **Status** | Aprovada |
| **Fase** | 2 — Execução avançada |
| **Depende de** | 007 |
| **Requisitos de produto** | PR-10, PR-03 (paginação), PR-20 (parcial) |
| **ADRs relacionadas** | 0001, 0004 |

## Contexto e problema

Analistas de dados precisam transformar dados com Python (pandas). Executar Python de usuário é o maior risco de segurança da plataforma: o isolamento precisa ser forte e testado ativamente. O motor também precisa de agendamento, sub-workflows, espera, reexecução e paginação HTTP para ficar completo.

## Histórias de usuário

### HU-1 — Código Python (P1)

Como **analista**, quero escrever Python com pandas, com a mesma API do N8N, para transformar itens.

**Cenários de aceite:**
1. **Dado** itens vindos do Postgres, **quando** agrego com pandas, **então** recebo os itens agregados.
2. **Dado** código que tenta acessar a rede, ler arquivos do sistema ou criar processos, **quando** executo, **então** a operação é bloqueada e o erro aparece no log, sem afetar outras execuções.

### HU-2 — Agendar workflows (P1)

Como **editor**, quero acionar workflows por cron ou intervalo.

**Cenários de aceite:**
1. **Dado** um agendamento a cada minuto e 2 workers, **quando** passam 3 minutos, **então** ocorrem exatamente 3 execuções.

### HU-3 — Reutilizar workflows (P2)

Como **editor**, quero chamar outro workflow publicado como sub-workflow e receber o resultado.

### HU-4 — Esperar e interromper (P2)

Como **editor**, quero pausar a execução por um tempo (sem ocupar recursos) e encerrar com erro customizado.

### HU-5 — Reexecutar (P1)

Como **executor**, quero reexecutar uma execução com erro a partir do nó que falhou, reaproveitando o que já deu certo.

### HU-6 — Paginação HTTP (P2)

Como **editor**, quero que o HTTP Request colete todas as páginas automaticamente.

### Casos de borda

- Espera longa e worker reiniciado: a execução retoma em outro worker.
- Sub-workflow chama a si mesmo: bloqueado pelo limite de profundidade.
- Python gera uma saída gigante: é truncada ou falha de forma controlada.

## Requisitos funcionais

- **FR-001**: Código Python DEVE executar em um serviço separado, em um processo novo por requisição, sem rede, com sistema de arquivos somente leitura (exceto um diretório temporário limitado), sem privilégios e com limites de memória, CPU, tempo, processos e tamanho de saída.
- **FR-002**: O serviço Python DEVE aceitar somente chamadas autenticadas dos workers.
- **FR-003**: Somente as bibliotecas de uma lista aprovada DEVEM estar disponíveis. Instalação em tempo de execução NÃO DEVE ser possível.
- **FR-004**: O nó `code.python` DEVE oferecer os modos "todos os itens" e "por item" e a API do N8N (`_input`, `_json`, `_('Nó')`, `_vars`, `_execution`, `_workflow`, `_now`, `_today`), com itens acessíveis por atributo e por chave e `print` capturado.
- **FR-005**: O retorno Python DEVE ser normalizado como no nó JS.
- **FR-006**: O cancelamento da execução DEVE encerrar o processo Python.
- **FR-007**: O gatilho `trigger.schedule` DEVE aceitar regras cron e de intervalo com fuso horário, criadas na publicação e removidas na despublicação, sem duplicidade entre workers.
- **FR-008**: O editor DEVE validar a expressão cron e mostrar as próximas 5 execuções.
- **FR-009**: O nó `flow.executeWorkflow` DEVE chamar um workflow publicado (respeitando as permissões do dono da execução), uma vez ou por item, aguardando ou não o término, e retornar a saída do último nó.
- **FR-010**: Execuções de sub-workflow DEVEM ser vinculadas à execução pai. A profundidade de aninhamento DEVE ser limitada e a recursão direta detectada.
- **FR-011**: O gatilho `trigger.executeWorkflow` DEVE receber os itens e, opcionalmente, validá-los contra um schema.
- **FR-012**: O nó `flow.wait` DEVE esperar por intervalo ou até uma data/hora. Esperas longas DEVEM liberar o worker e retomar a execução a partir do estado salvo.
- **FR-013**: O nó `flow.stopAndError` DEVE encerrar a execução com erro customizado (mensagem ou objeto).
- **FR-014**: O sistema DEVE permitir reexecutar uma execução com erro a partir dos nós que falharam, reaproveitando as saídas bem-sucedidas, usando a versão original ou a publicada.
- **FR-015**: O editor DEVE permitir executar a partir de um nó, reaproveitando os dados de uma execução anterior.
- **FR-016**: O `http.request` DEVE paginar por URL da próxima página ou por atualização de parâmetros, com critério de término e limite de requisições, expondo `$response` e `$pageCount`.
- **FR-017**: DEVE existir uma bateria automatizada de testes de escape de sandbox (JS e Python) executada no CI.

## Requisitos não funcionais

- **NFR-001**: Padrões do Python: 256 MB, 30 s de CPU, 60 s de parede, 50 MB de saída, `/tmp` de 64 MB.
- **NFR-002**: Esperas de até 60 s ficam em memória; acima disso, são persistidas.

## Entidades-chave

- **Estado de execução**: snapshot do motor para retomada.
- **Execução pai/filha**: vínculo entre execução e sub-execução.

## Critérios de sucesso

- **SC-001**: Python com pandas agrega dados do Postgres.
- **SC-002**: Bateria de escape (≥ 30 casos) verde no CI.
- **SC-003**: O runner recusa chamadas sem token.
- **SC-004**: Agendamento de 1 min gera 3 execuções em 3 min com 2 workers.
- **SC-005**: Espera de 2 min retoma em outro worker.
- **SC-006**: Sub-workflow por item preserva a ordem; a recursão é bloqueada.
- **SC-007**: A reexecução não reexecuta os nós bem-sucedidos.
- **SC-008**: A paginação coleta as 7 páginas de um mock.

## Fora do escopo

Vault/KMS, versionamento visual, MCP, AI Agent e Kubernetes.

## Pré-requisitos humanos

Nenhum.

## Pontos em aberto

Nenhum.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 7 | Migração para SDD |
