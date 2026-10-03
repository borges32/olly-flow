# Spec 007 — Controle de fluxo: Merge, While, Switch e erros

| Campo | Valor |
|---|---|
| **Status** | Aprovada |
| **Fase** | 2 — Execução avançada |
| **Depende de** | 006 |
| **Requisitos de produto** | PR-01, PR-13, PR-02 (Switch complementar) |
| **ADRs relacionadas** | 0001 (While, Merge com N entradas) |

## Contexto e problema

Com ramos em paralelo, os workflows precisam:
- **juntar ramos** (Merge);
- **repetir trechos** (While e laço por lotes);
- **rotear por regras** (Switch);
- **tratar erros como parte do fluxo**.

Laços quebram o modelo de grafo acíclico, então a semântica precisa ser rigorosa.

## Histórias de usuário

### HU-1 — Juntar dados de ramos (P1)

Como **editor**, quero combinar os dados de vários ramos: concatenar, combinar por posição, fazer join por campo, escolher um ramo ou apenas sincronizar.

**Cenários de aceite:**
1. **Dado** um ramo Postgres e um ramo HTTP em paralelo, **quando** uso Merge com join à esquerda por `cpf`, **então** cada registro do banco recebe os dados correspondentes da API.
2. **Dado** um If cujo ramo `false` ficou vazio, **quando** os dois ramos chegam a um Merge `append`, **então** o Merge executa com os itens do ramo `true`.

### HU-2 — Repetir até uma condição (P1)

Como **editor**, quero um nó While para repetir um trecho enquanto uma condição for verdadeira, como paginar uma API.

**Cenários de aceite:**
1. **Dado** uma API com 5 páginas, **quando** uso While com acumulação, **então** a saída `done` contém os itens das 5 páginas.
2. **Dado** uma condição que nunca fica falsa, **quando** o limite de iterações é atingido, **então** a execução falha com erro explícito.

### HU-3 — Processar em lotes (P2)

Como **editor**, quero processar muitos itens em lotes de tamanho fixo.

### HU-4 — Rotear por regras (P2)

Como **editor**, quero um Switch com várias saídas e uma saída padrão.

### HU-5 — Erros como fluxo (P1)

Como **editor**, quero desviar itens com erro para uma saída própria e ter um workflow de erro acionado quando uma execução de produção falhar.

### Casos de borda

- Merge dentro do corpo de um While executa uma vez por iteração.
- Referência `$('Nó')` dentro do laço aponta para a iteração atual.
- O workflow de erro não aciona a si mesmo.

## Requisitos funcionais

- **FR-001**: O nó `logic.merge` DEVE aceitar de 2 a 10 entradas, configuráveis.
- **FR-002**: O Merge DEVE suportar os modos `append`, `combineByPosition` (com opção de incluir itens sem par), `combineByFields` (inner, left, outer, keepNonMatches; somente 2 entradas), `chooseBranch` e `waitAll`.
- **FR-003**: O Merge DEVE oferecer a política de espera (todas as entradas conectadas ou somente as com dados) e o tratamento de conflito de campos (preferir a entrada 1, a última ou adicionar sufixo).
- **FR-004**: Fora de laços, o Merge DEVE executar uma única vez por execução, após todas as entradas resolvidas.
- **FR-005**: O nó `logic.while` DEVE ter as entradas `main` e `continue` e as saídas `loop` e `done`, com condição por expressão, limite de iterações e acumulação opcional da saída do corpo.
- **FR-006**: QUANDO o limite de iterações for atingido, a execução DEVE falhar com erro explícito.
- **FR-007**: As expressões DEVEM ter acesso a `$loop.index`, `$loop.accumulated` e `$loop.maxIterations` dentro do laço.
- **FR-008**: Ciclos DEVEM ser permitidos somente quando a aresta de retorno termina na porta `continue` de um While ou de um Loop Over Items que domina o ciclo. Qualquer outro ciclo DEVE ser rejeitado.
- **FR-009**: Nós dentro de laços DEVEM registrar cada iteração separadamente. `$('Nó')` DEVE referenciar a iteração atual dentro do corpo e a última fora dele.
- **FR-010**: O painel do nó DEVE permitir navegar entre as iterações.
- **FR-011**: O nó `logic.loopOverItems` DEVE emitir lotes de tamanho configurável em `loop` e, ao final, todos os itens acumulados em `done`, de forma compatível com o Split in Batches v3 do N8N.
- **FR-012**: O nó `logic.switch` DEVE rotear por regras (mesmas condições do If) ou por expressão de índice, com saída de fallback e a opção de enviar a todas as regras verdadeiras.
- **FR-013**: Cada nó DEVE poder ter uma saída `error` que recebe os itens que falharam, enquanto os itens com sucesso seguem pela saída normal.
- **FR-014**: Um workflow DEVE poder indicar um workflow de erro, acionado quando uma execução de produção falhar, com o payload no formato do Error Trigger do N8N.
- **FR-015**: O workflow de erro NÃO DEVE acionar a si mesmo nem outro workflow de erro.
- **FR-016**: O editor DEVE desenhar as arestas de retorno com estilo distinto e explicar por que um ciclo é inválido.
- **FR-017**: A semântica do motor DEVE ser fixada por uma suíte de workflows de referência executada com paralelismo 1 e 8, com resultados idênticos.

## Requisitos não funcionais

- **NFR-001**: Teto global de iterações configurável (padrão 10 000).

## Entidades-chave

- **Iteração**: execução de um nó dentro de um laço (índice de execução).
- **Workflow de erro**: workflow acionado por falhas de outro.

## Critérios de sucesso

- **SC-001**: Suíte de referência (≥ 15 casos × 2 níveis de paralelismo) verde.
- **SC-002**: Paginação de 5 páginas acumulada em `done`.
- **SC-003**: Limite de iterações gera erro explícito.
- **SC-004**: Join à esquerda entre ramos paralelos correto.
- **SC-005**: Ciclo inválido rejeitado.
- **SC-006**: `errorOutput` e o workflow de erro funcionam com o payload correto.

## Fora do escopo

Python, cron, sub-workflow e Wait.

## Pré-requisitos humanos

Nenhum.

## Pontos em aberto

Nenhum.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 6 | Migração para SDD |
