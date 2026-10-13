# Relatório — Spec 019: Baixar os dados de entrada e saída do nó

**Status:** Implementada (pendente: E2E de fps do canvas da spec 002, abaixo do mínimo neste ambiente; ver "Comandos de verificação")
**Data:** 13/10/2026

## Resumo

O painel do nó ganhou o botão **Baixar** nos dados de **Entrada** e de **Saída**. Ele salva num arquivo JSON os itens exibidos, no formato da visão JSON. O painel é o mesmo para todos os tipos de nó, então a opção vale para todos.

**Nome do arquivo:**
- identifica o nó, a entrada ou a saída;
- inclui a saída selecionada (ex.: `Adulto_-saida-Verdadeiro.json`) e a iteração do laço (`Corpo-saida-execucao-1.json`), quando há;
- com dados fixados, termina em `saida-fixada`;
- com a origem num nó anterior, usa o nome desse nó.

**O que não muda:** o download não chama a API e não expõe nada além do que o painel já mostra. Os valores mascarados continuam mascarados, e os dados truncados vão como gravados, com aviso.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `apps/web/src/editor/ndv/data-download.ts` (`itemsFileContent`, `dataFileName`) e `data-download.test.ts` |
| T010 | ✅ | `apps/web/src/editor/ndv/data-views.tsx`: propriedade `downloadName` e botão "Baixar" (`data-testid` `<painel>-download`) |
| T011 | ✅ | `apps/web/src/editor/ndv/node-details-view.tsx`: partes do nome (entrada, origem, saída, fixados, `execucao-N`) |
| T012 | ✅ | `apps/web/e2e/test-run.spec.ts` (spec 019) e verificação do nome com a iteração em `apps/web/e2e/loops.spec.ts` |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ✅ | Tabelas abaixo |
| T092 | ✅ | `docs/nos/README.md` (comportamentos comuns) e `docs/lgpd.md` (efeitos colaterais do mascaramento) |
| T093 | ✅ | Este relatório; status em `spec.md` e `docs/roadmap.md`; coluna 019 na matriz de `docs/produto/visao.md` |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `e2e/test-run.spec.ts` › "FR-001/FR-002/FR-003/FR-004/SC-001/SC-002: baixa a entrada e cada saída do If…" (entrada, saídas, origem e dados fixados em nós Set e If) |
| FR-002 | Sim | `data-download.test.ts` › "FR-002/FR-005: o conteúdo é a lista com os dados de cada item…"; E2E acima (arquivo igual à visão JSON do painel) |
| FR-003 | Sim | `data-download.test.ts` › "FR-003: o nome junta as partes…"; E2E acima (nomes com a saída, a origem e `saida-fixada`); `e2e/loops.spec.ts` (`Corpo-saida-execucao-1.json`) |
| FR-004 | Sim | E2E acima: sem execução, nem a entrada nem a saída oferecem o download |
| FR-005 | Sim | `data-download.test.ts` › "FR-002/FR-005…" (valor mascarado mantido, sem binário); o arquivo usa os mesmos dados do painel (E2E); sem `execution:readData` o painel não tem itens e cai no FR-004 |
| NFR-001 | Sim | O botão usa os dados do painel; o E2E não espera nenhuma requisição |
| NFR-002 | Sim | Textos em português |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | E2E: entrada (2 itens), "Verdadeiro" (Ana Souza) e "Falso" (Bruno Lima) do If, com nomes distintos e conteúdo igual à visão JSON |
| SC-002 | ✅ | E2E: o arquivo da saída de "Montar" colado no editor de dados fixados é aceito, e o download dos fixados é idêntico |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 825 testes. A primeira execução acusou 2 falhas em `tests/fixtures.test.ts`, vindas da spec 018 (fixture sem `expected.json`); corrigidas, ver "Decisões tomadas" |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 369 testes (api 315, db 28, nodes 23, engine 3) |
| `pnpm test:e2e` | ⚠️ 46 de 47, inclusive o cenário novo. Falha o "NFR-001: canvas com 100 nós mantém ≥ 30 fps" (spec 002): mediu 29,2 fps |
| `pnpm app:up && pnpm smoke` | ✅ |

**O teste de fps não envolve esta spec.** Ela altera só o painel do nó (aberto como diálogo), não o canvas. É a mesma falha de ambiente registrada nas specs 017 e 018.

## Decisões tomadas

- **Formato:** JSON com os dados (`json`) de cada item, igual à visão JSON e ao editor de dados fixados. Assim, o arquivo pode virar dados fixados sem ajuste. Binários, CSV e o download de todas as saídas ficaram fora do escopo (spec, "Fora do escopo").
- **Sem rota nova:** o download usa os dados já carregados no editor. Eles chegam mascarados (spec 009) e só para quem tem `execution:readData`, então não há exposição nova nem permissão nova.
- **Sem auditoria do download:** os dados já estão no navegador de quem pode vê-los. Registrado como ponto para o DPO em "Pendências".
- **Correção na fixture da spec 018:** `fixtures/n8n/exemplo-output-parsers` não tinha o `expected.json` exigido pela spec 001 (FR-016). Foi criado vazio (`{}`): o caso não executa sem credenciais, e as respostas do modelo não são determinísticas. O `notes.md` explica, e o relatório da spec 018 registra a correção.
- **Sem desativar lint:** os caracteres de controle no nome do arquivo são trocados por uma checagem do código do caractere, em vez de uma expressão regular, que exigiria desligar a regra `no-control-regex`.

## Desvios da spec/plano

Nenhum. O plano foi ajustado durante a implementação para a assinatura final de `dataFileName` (lista de partes) e a ordem das partes (`execucao-N` antes da saída).

## Dependências adicionadas

Nenhuma. O ícone `Download` já vem do `lucide-react`.

## Pendências, bloqueios e riscos

- **Fps do canvas (spec 002):** confirmar numa máquina livre ou no CI.
- **DPO:** avaliar se o download dos dados do painel, já mascarados, precisa de auditoria ou de restrição adicional.
- **Escopo a revisar pelo PO:** formato JSON e um arquivo por saída, escolhidos a partir do que o painel já mostra.

## Como demonstrar

1. `pnpm app:up` e entre no editor.
2. Crie Manual → Set → If (ou use qualquer workflow) e clique em **Executar workflow**.
3. Abra o If: em **Entrada** e em **Saída**, clique em **Baixar**. Troque para a saída **Falso** e baixe de novo: o arquivo muda de nome e de conteúdo.
4. Em **Entrada**, escolha "Saída de “Início”" e baixe: o arquivo é `Início-saida.json`.
5. Abra um nó, **Fixar dados** → **Editar**, cole o conteúdo de um arquivo baixado e salve: os dados são aceitos.

## Próximos passos sugeridos

- Baixar também os binários do item (um botão por arquivo binário), se o PO pedir.
- Formato CSV para a visão de tabela, se houver demanda.
