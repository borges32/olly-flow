# Relatório — Spec 024: Destacar o próximo nó na execução nó a nó

**Status:** Implementada
**Data:** 16/10/2026

## Resumo

Na execução de teste nó a nó, o canvas passou a mostrar os nós que esperam a execução:
- **destaque:** borda e anel índigo e o selo **próximo** no nó; as conexões até ele ficam animadas;
- **quem é o próximo:** um nó que ainda não executou e recebe uma conexão de uma saída com itens de um nó executado com sucesso. No If e no Switch, só o ramo que recebeu itens; a saída de erro conta quando tem itens;
- **sem destaque:** durante a execução, sem execução no editor, depois de um nó com erro e nos sub-nós (que executam junto com o pai).

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `apps/web/src/editor/next-nodes.ts` (`nextNodes`) e `next-nodes.test.ts` (7 casos) |
| T010 | ✅ | `workflow-node.tsx` (`data-next`, borda, selo `node-next`); `editor-page.tsx` (dados do nó e arestas animadas) |
| T011 | ✅ | `apps/web/e2e/test-run.spec.ts` › "spec 024…" |
| T090–T093 | ✅ | Ver abaixo; `docs/nos/README.md` (comportamentos do editor) |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `next-nodes.test.ts` › "FR-001…" (próximo e conexão, Merge, "sem dados" antigo, dados ocultos); E2E `test-run.spec.ts` › "FR-001/FR-002/SC-001…" |
| FR-002 | Sim | `next-nodes.test.ts` › "FR-002/SC-001…" (ramo do If), "FR-002: saída de erro…", "FR-002: sub-nós…"; E2E (o ramo "Não" sem destaque) |
| FR-003 | Sim | `next-nodes.test.ts` › "FR-003…"; E2E (sem destaque antes da primeira execução) |
| NFR-001 | Sim | Textos em português; índigo com variantes para o tema escuro, distinto das cores de execução, sucesso, erro, espera e comparação |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | E2E: Início → Montar → If (Sim/Não) com um adulto. Até Montar, If destacado; depois do If, só "Sim"; depois de "Sim", nenhum. Conferência visual pela captura do canvas |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 884 testes (827 nos pacotes, com `turbo run test --continue`, e 57 na raiz) |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 397 testes (api 332, db 32, nodes 30, engine 3), no PostgreSQL 14.18 |
| `pnpm test:e2e` | ✅ 54 de 54 |
| `pnpm app:up && pnpm smoke` | ✅ |

## Decisões tomadas

- **Cálculo no editor:** o editor já tem a saída por porta de cada nó executado; sem mudança na API nem no motor.
- **"Sem dados" e "interrompido" contam como pendentes:** depois de reexecutar um nó anterior, um nó que ficou "sem dados" numa execução antiga pode receber itens agora.
- **Sem os dados** (sem `execution:readData`): vale a contagem de itens do nó, e todos os nós seguintes ficam destacados.
- **Cor e selo:** o selo deixa o estado claro também para quem tem dificuldade com cores, e fica no canto inferior esquerdo, sem conflitar com o status (canto inferior direito).
- **E2E:** o teste seleciona o nó com um clique antes do botão ▶. Só com o mouse sobre o nó, o clique falhou de forma intermitente na execução do arquivo inteiro.

## Desvios da spec/plano

Nenhum.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- **Laços:** um nó executado numa iteração anterior não aparece como próximo; o canvas mostra o status da última iteração (risco aceito no plano).

## Como demonstrar

1. `pnpm app:up` e abra um workflow com If.
2. Execute o primeiro nó pelo botão ▶: o nó seguinte fica com a borda índigo e o selo "próximo".
3. Execute até o If: só o nó do ramo que recebeu itens fica destacado.
