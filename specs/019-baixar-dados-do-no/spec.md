# Spec 019 — Baixar os dados de entrada e saída do nó

| Campo | Valor |
|---|---|
| **Status** | Implementada (pendente: E2E de fps do canvas da spec 002 no ambiente atual) |
| **Fase** | 4 — Hardening (apoio à depuração) |
| **Depende de** | 003, 009 |
| **Requisitos de produto** | PR-15 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

O painel do nó (spec 003, FR-017) mostra a entrada e a saída da última execução em tabela, JSON ou schema. Para depurar dados grandes ou aninhados, o painel não basta:
- a tabela mostra até 200 itens e 30 colunas, com os valores encurtados;
- o JSON só pode ser copiado selecionando o texto na tela;
- não dá para comparar execuções num editor externo, abrir os dados numa ferramenta de JSON ou anexá-los a um chamado.

Quem constrói o workflow precisa levar esses dados para fora do editor, em qualquer nó.

## Histórias de usuário

### HU-1 — Baixar a entrada e a saída de qualquer nó (Prioridade: P1)

Como **editor**, quero baixar num arquivo os dados de entrada e de saída que o painel do nó mostra, para depurar os dados fora do editor.

**Teste independente:** executar um workflow de teste, abrir o painel de um nó e baixar a entrada e a saída, conferindo que os arquivos têm os mesmos itens mostrados no painel.

**Cenários de aceite:**
1. **Dado** um nó já executado, **quando** clico em "Baixar" no painel de entrada ou no de saída, **então** recebo um arquivo JSON com os itens que o painel mostra, no formato da visão JSON.
2. **Dado** um nó com várias saídas (por exemplo, o If), **quando** baixo a saída, **então** o arquivo traz os itens da saída selecionada, e o nome do arquivo indica qual é.
3. **Dado** a origem da entrada trocada para a saída de um nó anterior, **quando** baixo, **então** o arquivo traz os dados dessa origem, e o nome do arquivo indica o nó de origem.
4. **Dado** dados fixados na saída, **quando** baixo a saída, **então** o arquivo traz os dados fixados.
5. **Dado** um nó em laço com várias execuções, **quando** escolho uma execução e baixo, **então** o arquivo traz os dados da execução escolhida, e o nome do arquivo indica qual é.
6. **Dado** qualquer tipo de nó (gatilhos, nós de dados, de controle de fluxo, de IA ou de integração), **quando** o painel tem dados, **então** a opção está disponível.

### Casos de borda

- **Painel sem dados:** nó não executado, saída sem itens ou dados ocultos por falta da permissão `execution:readData`. A opção fica indisponível.
- **Dados truncados na gravação (spec 003, FR-015):** o arquivo traz os dados como gravados, e a opção avisa que estão truncados.
- **Campos mascarados (spec 009, FR-014):** o arquivo traz os valores mascarados, como o painel mostra. Os valores originais nunca são baixados.
- **Nome do nó com caracteres inválidos para arquivo** (`/`, `:`, `?`…): esses caracteres são trocados no nome do arquivo.

## Requisitos funcionais

- **FR-001**: O painel do nó DEVE oferecer, nos dados de entrada e nos de saída, a opção de baixar os itens exibidos num arquivo JSON, para todos os tipos de nó.
- **FR-002**: O arquivo DEVE conter os itens da saída (porta), da origem da entrada e da execução do laço selecionadas no painel, no mesmo formato da visão JSON (lista com os dados de cada item), sem o limite de itens e colunas da tabela.
- **FR-003**: O nome do arquivo DEVE identificar o nó, se é entrada ou saída e, quando houver, a saída selecionada e a execução do laço, sem caracteres inválidos para nomes de arquivo.
- **FR-004**: QUANDO o painel não tem itens para mostrar, a opção NÃO DEVE estar disponível.
- **FR-005**: O arquivo NÃO DEVE conter dados além dos que o painel mostra: valores mascarados continuam mascarados, dados ocultos pela falta de permissão não são baixados e dados truncados são baixados como gravados, com aviso.

## Requisitos não funcionais

- **NFR-001**: O download não faz nova chamada à API: usa os dados já carregados no editor.
- **NFR-002**: Interface em português do Brasil (NFR-G07).

## Entidades-chave

- **Arquivo de dados do nó**: lista JSON com os dados (`json`) de cada item exibido no painel.

## Critérios de sucesso

- **SC-001**: Num workflow Manual → Set → If executado no editor, os arquivos baixados da entrada e de cada saída do If têm exatamente os itens que o painel mostra, com nomes de arquivo distintos.
- **SC-002**: O arquivo baixado da saída pode ser colado como dados fixados no editor de dados fixados sem ajuste.

## Fora do escopo

- Baixar os arquivos binários dos itens (o arquivo traz só os dados JSON).
- Outros formatos (CSV, Excel).
- Baixar todas as saídas, todos os nós ou a execução inteira de uma vez.
- Auditoria do download: os dados já estão no navegador de quem tem a permissão de vê-los.

## Pré-requisitos humanos

- Nenhum.

## Pontos em aberto

Nenhum. As escolhas de formato (JSON, só os dados do item, um arquivo por painel) seguiram o que o painel já mostra e estão na seção "Fora do escopo"; podem ser revistas pelo PO na verificação.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 13/10/2026 | Criação da spec, com o escopo pedido pelo PO ("incluir em todos os nós a opção de download dos valores da entrada e saída") | Depuração dos dados fora do editor |
| 13/10/2026 | Implementação concluída ([relatório](report.md)) | — |
