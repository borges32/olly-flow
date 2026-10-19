# Spec 025 — Redimensionar as colunas do painel do nó

| Campo | Valor |
|---|---|
| **Status** | Implementada |
| **Fase** | 4 — Hardening (apoio à UX) |
| **Depende de** | 003 |
| **Requisitos de produto** | PR-15 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

O painel do nó (spec 003, FR-017) mostra três colunas de largura fixa: **Entrada**, **Parâmetros** e **Saída**. Conforme o nó, uma delas precisa de mais espaço: o código JavaScript na coluna do meio, um JSON largo na entrada ou na saída. Hoje não dá para alargar uma coluna, e o conteúdo fica cortado ou com rolagem horizontal.

O PO pediu (19/10/2026) que o usuário consiga ajustar a largura de cada coluna, como no N8N.

## Histórias de usuário

### HU-1 — Ajustar a largura das colunas (Prioridade: P1)

Como **editor**, quero arrastar as divisórias entre as colunas do painel do nó, para dar mais espaço à coluna que estou usando.

**Teste independente:** abrir o painel de um nó, arrastar a divisória entre Parâmetros e Saída e conferir que a coluna do meio ficou mais larga e a Saída mais estreita.

**Cenários de aceite:**
1. **Dado** o painel do nó aberto, **quando** arrasto a divisória entre duas colunas, **então** uma coluna cresce e a vizinha diminui na mesma medida, e a terceira não muda.
2. **Dado** uma coluna no tamanho mínimo, **quando** continuo arrastando, **então** ela não fica menor que o mínimo.
3. **Dado** larguras ajustadas, **quando** fecho e abro o painel (de qualquer nó), ou recarrego a página, **então** as larguras continuam as mesmas no mesmo navegador.
4. **Dado** uma divisória com o foco do teclado, **quando** uso as setas ← e →, **então** a divisória se move.
5. **Dado** larguras ajustadas, **quando** dou um clique duplo numa divisória, **então** as larguras voltam ao padrão.

### Casos de borda

- **Tela estreita** (as colunas ficam empilhadas): sem divisórias.
- **Armazenamento do navegador indisponível** (janela anônima, bloqueio): o ajuste funciona, mas não é lembrado.
- **Valor guardado inválido:** volta ao padrão.

## Requisitos funcionais

- **FR-001**: O painel do nó DEVE ter divisórias arrastáveis entre Entrada e Parâmetros e entre Parâmetros e Saída. Arrastar muda só as duas colunas vizinhas, respeitando uma largura mínima para cada coluna.
- **FR-002**: As larguras DEVEM ser lembradas no navegador e valer para o painel de qualquer nó. Clique duplo numa divisória DEVE voltar ao padrão.
- **FR-003**: As divisórias DEVEM ser acessíveis pelo teclado (foco e setas) e identificadas para leitores de tela.

## Requisitos não funcionais

- **NFR-001**: Interface em português do Brasil (NFR-G07).

## Entidades-chave

Nenhuma nova: a preferência fica no navegador.

## Critérios de sucesso

- **SC-001**: Depois de arrastar a divisória entre Parâmetros e Saída, a coluna do meio fica mais larga, e a largura se mantém ao fechar e reabrir o painel.

## Fora do escopo

- Guardar as larguras no servidor (por usuário, em todos os navegadores).
- Esconder ou recolher colunas.

## Pré-requisitos humanos

- Nenhum.

## Pontos em aberto

Nenhum.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 19/10/2026 | Criação da spec, a pedido do PO ("o usuário consiga ajustar a largura de cada coluna" do painel do nó), com implementação pedida diretamente | Código e JSON largos no painel do nó |
| 19/10/2026 | Implementação concluída ([relatório](report.md)) | — |
