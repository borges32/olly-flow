# Relatório — Spec 023: Organizar os nós do workflow ("Tidy up")

**Status:** Implementada
**Data:** 15/10/2026

## Resumo

O editor ganhou o botão **Organizar** (atalho **Shift+Alt+T**), equivalente ao *Tidy up* do N8N:
- **layout:** reposiciona os nós da esquerda para a direita, na ordem das conexões e sem sobreposição;
- **ramos:** os do If e do Switch seguem a ordem das saídas, com "verdadeiro" em cima, sem cruzar as arestas;
- **sub-nós:** modelo, memória, ferramentas e parsers ficam embaixo do nó pai, lado a lado, na ordem das portas, e o nó pai continua na linha do fluxo;
- **alcance:** com dois ou mais nós selecionados, só eles; senão, o workflow inteiro;
- **desfazer:** um passo (Ctrl+Z).

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `@dagrejs/dagre` 3.1.1 no `apps/web` |
| T002 | ✅ | `apps/web/src/editor/tidy-up.ts` (`tidyUp`, `orderBranches`) e `tidy-up.test.ts` (5 casos) |
| T010 | ✅ | `store.applyLayout` (um `commit`, um passo de desfazer); botão "Organizar" e atalho no `editor-page.tsx` |
| T011 | ✅ | `apps/web/e2e/editor.spec.ts` › "spec 023…"; `readonly.spec.ts` (sem o botão) |
| T090–T093 | ✅ | Ver abaixo; `docs/nos/README.md` (comportamentos do editor) |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `tidy-up.test.ts` › "SC-001/FR-001…" (ordem, ramos na ordem das saídas, sem sobreposição); E2E `editor.spec.ts` › "FR-001/FR-005/SC-002…" (botão e atalho) |
| FR-002 | Sim | `tidy-up.test.ts` › "FR-002…" (sub-nós embaixo, na ordem das entradas, centralizados; sub-nó de sub-nó; pai na linha do fluxo) |
| FR-003 | Sim | `tidy-up.test.ts` › "FR-003…" |
| FR-004 | Sim | `tidy-up.test.ts` › "FR-004…" (âncora, laço, partes desconectadas, tamanho real) |
| FR-005 | Sim | E2E `editor.spec.ts` (desfazer num passo, alteração não salva); `readonly.spec.ts` (sem o botão na tela somente leitura) |
| NFR-001 | Sim | `tidy-up.test.ts` › "NFR-001…" (100 nós em menos de 1 s) |
| NFR-002 | Sim | Textos em português |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `tidy-up.test.ts` (If e Merge; Agent com sub-nós; laço) e conferência visual: captura do canvas com Início → Agent (com modelo, memória e ferramenta) → If → dois ramos → Merge, em linha, sem cruzamentos |
| SC-002 | ✅ | E2E: Ctrl+Z devolve todos os nós à posição anterior |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 877 testes (820 nos pacotes, com `turbo run test --continue`, e 57 na raiz) |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 394 testes (api 332, nodes 30, db 29, engine 3) |
| `pnpm test:e2e` | ✅ 53 de 53, inclusive o cenário do Organizar |
| `pnpm app:up && pnpm smoke` | ✅ |

## Decisões tomadas

- **dagre, layout em camadas:** redução de cruzamentos e ranqueamento prontos, como no N8N. Os laços são resolvidos pelo próprio dagre.
- **Blocos com os sub-nós:** cada nó do fluxo entra no dagre com os sub-nós embaixo. Para o nó pai ficar na linha do fluxo (o dagre alinha centros), o bloco reserva em cima o mesmo espaço dos sub-nós.
- **Ordem dos ramos:** o dagre não conhece a ordem das portas. Depois do layout, os destinos de um nó com várias saídas são reempilhados na ordem das saídas, quando estão na mesma coluna, são vizinhos e só têm esse nó como origem. Isso apareceu na conferência visual: na primeira versão, o ramo "falso" ficava em cima.
- **Sub-nó com dois pais** (ex.: a memória ligada ao Agent e ao Chat Trigger, spec 021): fica embaixo do primeiro pai.
- **Âncora no canto superior esquerdo** dos nós organizados, para o workflow não "pular" no canvas.
- **Atalho pelo código da tecla** (`KeyT`): no Mac, Alt muda o caractere digitado.

## Desvios da spec/plano

Nenhum. O plano ganhou o reempilhamento dos ramos (`outputOrder`), registrado nas decisões acima.

## Dependências adicionadas

| Pacote | Versão | Licença | Motivo |
|---|---|---|---|
| `@dagrejs/dagre` | 3.1.1 | MIT | Layout em camadas com redução de cruzamentos, usado pelo N8N e recomendado pela documentação do React Flow; o `elkjs` faria o mesmo, mas é bem maior |

## Pendências, bloqueios e riscos

Nenhuma.

## Como demonstrar

1. `pnpm app:up` e abra um workflow grande ou importado do N8N.
2. Clique em **Organizar** (ou Shift+Alt+T): os nós ficam da esquerda para a direita, e os sub-nós de IA embaixo do Agent.
3. Ctrl+Z desfaz.
4. Selecione alguns nós (Shift + arrastar) e organize: só eles mudam.
