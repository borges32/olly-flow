# Spec 024 — Destacar o próximo nó na execução nó a nó

| Campo | Valor |
|---|---|
| **Status** | Implementada |
| **Fase** | 4 — Hardening (apoio à depuração e à UX) |
| **Depende de** | 003, 005, 007 |
| **Requisitos de produto** | PR-15 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

A execução de teste permite executar um nó por vez pelo botão ▶ do nó (spec 003, FR-020) e continuar depois da chamada de teste do webhook (spec 005, FR-007). Em workflows grandes, com vários If e Switch, não dá para ver no canvas qual é o próximo nó a executar: é preciso abrir o painel do If para descobrir qual ramo recebeu itens e depois procurar o nó seguinte desse ramo.

O PO pediu (16/10/2026) que o nó que está esperando a execução mude de cor.

## Histórias de usuário

### HU-1 — Ver o próximo nó a executar (Prioridade: P1)

Como **editor**, quero ver em destaque os nós que estão esperando a execução, para continuar o teste nó a nó sem procurar o caminho no canvas.

**Teste independente:** executar um workflow nó a nó até um If e conferir que só o nó do ramo que recebeu itens fica destacado.

**Cenários de aceite:**
1. **Dado** um workflow executado até um nó, **quando** a execução termina, **então** os nós seguintes ligados a ele, que ainda não executaram, ficam destacados com outra cor e o selo "próximo", e as conexões até eles ficam animadas.
2. **Dado** um If ou um Switch executado, **quando** só um ramo recebe itens, **então** só os nós desse ramo ficam destacados; os ramos sem itens não.
3. **Dado** o nó destacado, **quando** o executo, **então** o destaque passa para os nós seguintes dele.
4. **Dado** a chamada de teste do webhook recebida, **quando** o Webhook executa, **então** os nós seguintes dele ficam destacados.
5. **Dado** uma execução em andamento, uma execução completa sem nós pendentes ou um nó com erro, **quando** olho o canvas, **então** não há destaque de próximo nó depois do erro nem durante a execução.

### Casos de borda

- **Saída de erro** (spec 007) com itens: os nós ligados a ela são os próximos.
- **Merge esperando duas entradas:** fica destacado quando ao menos uma entrada recebeu itens.
- **Sub-nós** (modelo, memória, ferramentas, output parser): não entram no destaque; eles executam junto com o nó pai.
- **Sem a permissão `execution:readData`** (spec 005, FR-014): sem os dados por saída, um nó com itens destaca todos os nós seguintes.
- **Comparação de versões e tela somente leitura sem execução:** sem destaque.

## Requisitos funcionais

- **FR-001**: Depois de uma execução de teste terminar, o editor DEVE destacar, com cor e selo "próximo", cada nó que ainda não executou e que recebe uma conexão principal de uma saída com itens de um nó executado com sucesso, e animar essas conexões.
- **FR-002**: Ramos sem itens (If, Switch, saída de erro sem itens) NÃO DEVEM destacar os nós seguintes. Sub-nós NÃO DEVEM ser destacados.
- **FR-003**: Durante a execução e sem execução no editor, NÃO DEVE haver destaque.

## Requisitos não funcionais

- **NFR-001**: Interface em português do Brasil (NFR-G07); o destaque funciona nos temas claro e escuro e é distinto das cores de sucesso, erro, execução e comparação de versões.

## Entidades-chave

Nenhuma nova: o destaque é calculado no editor a partir do estado da execução de teste.

## Critérios de sucesso

- **SC-001**: Num workflow Início → Montar → If (Verdadeiro → Sim; Falso → Não), executando até o If com itens só no ramo verdadeiro, só "Sim" fica destacado; executando "Sim", o destaque some.

## Fora do escopo

- Executar automaticamente o próximo nó, ou um botão "executar o próximo" na barra.
- Destaque fora da execução de teste do editor (execuções de produção, tela de execução).

## Pré-requisitos humanos

- Nenhum.

## Pontos em aberto

Nenhum.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 16/10/2026 | Criação da spec, a pedido do PO ("mudar a cor do nó que está esperando a execução" no teste nó a nó), com implementação pedida diretamente | Workflows grandes com vários If |
| 16/10/2026 | Implementação concluída ([relatório](report.md)) | — |
