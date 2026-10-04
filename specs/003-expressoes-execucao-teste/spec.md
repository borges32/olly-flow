# Spec 003 — Expressões, variáveis e execução de teste

| Campo | Valor |
|---|---|
| **Status** | Implementada |
| **Fase** | 1 — MVP |
| **Depende de** | 002 |
| **Requisitos de produto** | PR-02, PR-07, PR-11, PR-15, PR-17 (parcial) |
| **ADRs relacionadas** | 0001, 0003 |

## Contexto e problema

Os valores passam de um nó para outro por **expressões** com a sintaxe do N8N. Os usuários da POC já conhecem essa sintaxe. O editor precisa permitir testar o workflow e ver, em tempo real, os dados de entrada e saída de cada nó. Expressões são código escrito pelo usuário e, portanto, precisam rodar isoladas do servidor.

## Histórias de usuário

### HU-1 — Usar dados de nós anteriores (P1)

Como **editor**, quero referenciar campos de nós anteriores com expressões `{{ }}` para montar parâmetros dinâmicos.

**Cenários de aceite:**
1. **Dado** um nó anterior que produziu `{ nome: "Ana" }`, **quando** uso `=Olá {{ $json.nome }}`, **então** o parâmetro resolve para `Olá Ana`.
2. **Dado** um nó chamado "Busca", **quando** uso `{{ $('Busca').item.json.id }}` em um nó posterior, **então** recebo o id do item correspondente, mesmo após um If que filtrou itens.
3. **Dado** uma expressão com erro, **quando** executo, **então** vejo a mensagem indicando o nó, o parâmetro e o trecho com problema.

### HU-2 — Testar e ver os dados em tempo real (P1)

Como **editor**, quero executar o workflow no editor e ver o status e os dados de cada nó enquanto ele roda.

**Cenários de aceite:**
1. **Dado** `Manual → Set → If`, **quando** clico em "Executar workflow", **então** cada nó mostra o status em tempo real e posso abrir os dados de entrada e saída em tabela, JSON ou schema.
2. **Dado** um nó intermediário, **quando** escolho "Executar até este nó", **então** apenas os nós necessários são executados.
3. **Dado** dados de saída de um nó, **quando** os fixo (pin), **então** as próximas execuções usam esses dados sem executar o nó.

### HU-3 — Desvio condicional (P1)

Como **editor**, quero um nó If com condições tipadas, AND/OR, para encaminhar cada item ao ramo verdadeiro ou falso.

### HU-4 — Montar expressões com ajuda (P2)

Como **editor**, quero autocomplete, pré-visualização do resultado e arrastar campos da entrada para os parâmetros.

### HU-5 — Histórico das execuções (P1)

Como **auditor**, quero que toda execução fique registrada com o status e os dados de cada nó.

### Casos de borda

- Expressão com laço infinito é interrompida sem afetar o servidor.
- Expressão tenta acessar o ambiente do servidor: o acesso é bloqueado.
- Dados de um nó muito grandes: o registro é truncado e sinalizado.

## Requisitos funcionais

- **FR-001**: Um parâmetro string iniciado por `=` DEVE ser tratado como expressão-template. Os demais valores são literais.
- **FR-002**: Um template formado por um único `{{ }}` DEVE preservar o tipo do resultado. Um template misto DEVE produzir string.
- **FR-003**: As expressões DEVEM suportar as variáveis listadas em `docs/arquitetura/contratos.md` aplicáveis a esta spec: `$json`, `$binary`, `$itemIndex`, `$input.*`, `$('Nó').*`, `$node[...]`, `$vars`, `$env`, `$execution`, `$workflow`, `$now`, `$today`, além de Luxon.
- **FR-004**: `$('Nó').item` DEVE resolver o item correspondente seguindo a cadeia de *paired items*. Se a cadeia não puder ser resolvida, DEVE gerar erro claro.
- **FR-005**: `$env` DEVE expor somente variáveis com prefixo `OLLY_EXPOSED_`.
- **FR-006**: Expressões DEVEM executar isoladas do servidor, sem acesso a processo, módulos, rede ou sistema de arquivos, e com limite de tempo e memória.
- **FR-007**: Erros de expressão DEVEM informar o nó, o parâmetro e o trecho.
- **FR-008**: O nó `data.set` DEVE aceitar expressões e a opção de incluir os demais campos do item.
- **FR-009**: O nó `data.setVariable` DEVE gravar variáveis da execução, acessíveis via `$vars`, e repassar os itens inalterados.
- **FR-010**: O nó `logic.if` DEVE avaliar, por item, condições tipadas (string, number, boolean, dateTime, array, object) combinadas por AND/OR, com saídas `true` e `false`.
- **FR-011**: O sistema DEVE permitir executar um workflow em modo de teste a partir do editor, inclusive sem salvar e até um nó de destino.
- **FR-012**: Durante a execução de teste, o sistema DEVE enviar eventos em tempo real por nó (início, fim, status, contagem de itens).
- **FR-013**: Somente usuários com permissão de ler execuções do projeto DEVEM receber esses eventos.
- **FR-014**: Toda execução DEVE ser registrada com status, modo, gatilho, usuário, versão, horários e erro. Cada nó DEVE ser registrado com status, horários, contagens de itens, dados de entrada e saída e erro.
- **FR-015**: Dados de nó acima do limite configurado DEVEM ser truncados e marcados como truncados.
- **FR-016**: O sistema DEVE permitir fixar dados de saída de um nó (pin data), que substituem a execução do nó.
- **FR-017**: O painel do nó DEVE mostrar entrada, parâmetros e saída, com visões de tabela, JSON e schema.
- **FR-018**: O editor de expressões DEVE oferecer autocomplete baseado na última execução, pré-visualização do resultado e arrastar campo para gerar a expressão.
- **FR-019**: O comportamento das expressões DEVE ser verificado contra uma suíte de compatibilidade com o N8N.

## Requisitos não funcionais

- **NFR-001**: Timeout de 100 ms por expressão; limite de memória de 128 MB por execução.
- **NFR-002**: Avaliação de expressões em lote por nó, para que 1000 itens com 3 expressões cada sejam avaliados em menos de 1 s.

## Entidades-chave

- **Execução**: instância de execução de um workflow (modo `test` ou `production`).
- **Execução de nó**: registro por nó (e, futuramente, por iteração).
- **Pin data**: dados fixados de um nó dentro do workflow.

## Critérios de sucesso

- **SC-001**: E2E executa `Manual → Set → If` e mostra o status e os dados em tempo real.
- **SC-002**: Suíte de compatibilidade com ≥ 60 casos verde; fixtures aplicáveis verdes.
- **SC-003**: Expressão com laço infinito é interrompida e a API segue respondendo.
- **SC-004**: Tentativas de fuga (`process`, `require`, `constructor.constructor`) falham.
- **SC-005**: Arrastar campo da entrada para um parâmetro gera a expressão correta.

## Fora do escopo

Credenciais, HTTP, Postgres, webhooks, código JS, fila e paralelismo.

## Pré-requisitos humanos

- Desejável: fixtures reais da POC em `fixtures/n8n/` para a suíte de compatibilidade.

## Pontos em aberto

Nenhum. Divergência registrada: no N8N, `$vars` são variáveis globais somente leitura; no Olly Flow, são variáveis da execução escritas por `data.setVariable` (ADR-0001).

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 2 | Migração para SDD |
| 03/10/2026 | Permissões RBAC explicitadas no plano (seção e tarefa T089), sem mudança de requisito | Decisão humana sobre permissões por spec |
| 03/10/2026 | Status `Implementada`; sem mudança de requisito. Desvios de plano registrados em [report.md](report.md) | Implementação da spec |
