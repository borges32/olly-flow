# Plano técnico — Spec 019: Baixar os dados de entrada e saída do nó

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

Mudança só no editor (`apps/web`). O `DataPanel`, usado pela entrada e pela saída do painel de todos os nós, ganha o botão **"Baixar"**. O botão salva os itens da porta selecionada com o `downloadJson` da spec 015. O `NodeDetailsView` informa ao painel o nome base do arquivo (nó, entrada ou saída, origem e execução do laço). O painel acrescenta a porta, quando há mais de uma.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III — Segurança | Nenhuma rota nova; o arquivo traz só os dados já carregados no editor, que chegam mascarados (spec 009) e só para quem tem `execution:readData` |
| IV — Testes | Unidade para o nome do arquivo e o conteúdo; E2E do download na entrada e nas saídas do If |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `apps/web` | `ndv/data-download.ts` (nome do arquivo e conteúdo, funções puras); `DataPanel` com o botão; `NodeDetailsView` com o nome base; testes |
| `docs/` | `docs/nos/README.md` (comportamentos comuns a todos os nós) e `docs/lgpd.md` (efeitos colaterais do mascaramento) |

## Design

### §1 Conteúdo e nome do arquivo (`apps/web/src/editor/ndv/data-download.ts`)

- `itemsFileContent(items)`: `items.map((i) => i.json)`, igual à visão JSON e ao editor de dados fixados (SC-002).
- `dataFileName(parts)`, com as partes na ordem abaixo (as vazias são descartadas):
  - **partes:** nome do nó (ou o do nó de origem, quando a entrada mostra a saída de um anterior), `entrada` ou `saida`, `execucao-N` (só quando o nó tem mais de uma execução) e a porta (só quando há mais de uma);
  - **junção:** partes unidas por `-`, com `.json` no fim;
  - **caracteres inválidos:** `/ \ : * ? " < > |` e de controle trocados por `_`.
- O nome usa o **rótulo** da porta (ex.: `Verdadeiro`), como as abas do painel.

### §2 `DataPanel`

- **Propriedade nova `downloadName?: (string | undefined)[]`:** as partes do nome base. O painel acrescenta a porta, e `dataFileName` acrescenta o `.json`.
- **Botão "Baixar":** ícone `Download`, junto ao contador de itens.
  - **Quando aparece:** só com itens na porta atual (FR-004).
  - **Dados truncados:** o `title` avisa que os dados estão truncados (FR-005).
- **Sem limite:** o download não usa o limite de 200 itens da tabela.

### §3 `NodeDetailsView`

- **Nome base da entrada:**
  - `"<nó>-entrada"`, mais `-execucao-N` quando há mais de uma execução;
  - com a origem num nó anterior: `"<anterior>-saida"`.
- **Nome base da saída:** `"<nó>-saida"`, mais `-execucao-N` quando há mais de uma execução.
  - **Dados fixados:** `"<nó>-saida-fixada"`.

## Modelo de dados

Sem mudança.

## Contratos

Sem mudança de API.

## Permissões RBAC

Nenhuma permissão nova. Os dados do painel já dependem de `execution:readData` (spec 009).

## Configuração

Nenhuma.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| JSON com os dados de cada item | Itens completos (`json`, `binary`, `pairedItem`); CSV | É o que a visão JSON mostra e o que o editor de dados fixados aceita (SC-002) |
| Download no navegador com os dados já carregados | Rota na API com os dados gravados | Sem exposição nova e sem rota; os dados exibidos são os mesmos gravados (inclusive o truncamento) |
| Um arquivo por porta | Todas as portas num objeto | Segue a seleção do painel; o nome do arquivo identifica a porta |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-002, FR-003 | Unidade | `apps/web/src/editor/ndv/data-download.test.ts` |
| FR-001, FR-002, FR-003, FR-004, SC-001, SC-002 | E2E | `apps/web/e2e/test-run.spec.ts` (Manual → Set → If, origem num nó anterior, dados fixados) e `apps/web/e2e/loops.spec.ts` (execução do laço no nome) |
| FR-005 | Unidade + E2E | Conteúdo igual ao exibido (`data-download.test.ts`); sem botão sem dados (E2E) |

## Riscos

| Risco | Mitigação |
|---|---|
| Dados pessoais saem do sistema em arquivo | Os dados chegam mascarados ao editor (spec 009), e só quem tem `execution:readData` os vê; registrado no relatório para avaliação do DPO |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 13/10/2026 | Criação do plano | Spec 019 |
