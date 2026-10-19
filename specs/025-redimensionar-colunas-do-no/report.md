# Relatório — Spec 025: Redimensionar as colunas do painel do nó

**Status:** Implementada
**Data:** 19/10/2026

## Resumo

O painel do nó ganhou divisórias arrastáveis entre **Entrada**, **Parâmetros** e **Saída**:
- **arrastar:** muda só as duas colunas vizinhas, com mínimo de 15% cada;
- **teclado:** a divisória recebe foco e se move com ← e →;
- **clique duplo:** volta ao padrão (32% / 36% / 32%, próximo do layout anterior);
- **preferência:** as larguras ficam no navegador e valem para o painel de qualquer nó;
- **tela estreita:** colunas empilhadas, sem divisórias, como antes.

Numa coluna estreita, os botões do cabeçalho de Entrada e Saída ("Executar este nó", "Fixar dados") passam para a linha de baixo em vez de ficarem cortados.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `apps/web/src/editor/ndv/column-sizes.ts` e `column-sizes.test.ts` (4 casos) |
| T010 | ✅ | `ndv/column-handle.tsx` (divisória), `ndv/use-column-sizes.ts` (estado e preferência), grade em `node-details-view.tsx`; cabeçalho com quebra de linha em `data-views.tsx` |
| T011 | ✅ | `apps/web/e2e/test-run.spec.ts` › "spec 025…" |
| T090–T093 | ✅ | Ver abaixo; `docs/nos/README.md` (comportamentos do editor) |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `column-sizes.test.ts` › "FR-001…" (vizinhas, mínimo); E2E (arrastar 150 px: Parâmetros cresce, Saída diminui, Entrada igual) |
| FR-002 | Sim | `column-sizes.test.ts` › "FR-002…" (preferência válida, inválida, armazenamento indisponível); E2E (reabrir o painel de outro nó mantém a largura; clique duplo volta ao padrão) |
| FR-003 | Sim | E2E (foco e seta →); `role="separator"`, `aria-orientation`, `aria-label` e `aria-valuenow` |
| NFR-001 | Sim | Textos em português |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | E2E e conferência visual pela captura do painel com a coluna do meio alargada |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 899 testes (842 nos pacotes, com `turbo run test --continue`, e 57 na raiz) |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 397 testes (api 332, db 32, nodes 30, engine 3) |
| `pnpm test:e2e` | ✅ 56 de 56 |
| `pnpm app:up && pnpm smoke` | ✅ |

## Decisões tomadas

- **Sem dependência nova:** Pointer Events e grade CSS (`grid-template-columns` por variável CSS só na tela larga), em vez de `react-resizable-panels`.
- **Percentuais:** mantêm a proporção quando a janela muda de tamanho.
- **Preferência no `localStorage`** (`olly.ndv.columns`), com leitura e gravação protegidas; valor inválido volta ao padrão.
- **Cabeçalho com quebra de linha:** apareceu na conferência visual. Com a Saída estreita, o botão "Fixar dados" ficava cortado.

## Desvios da spec/plano

Nenhum. A quebra de linha do cabeçalho foi acrescentada nas decisões acima.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

Nenhuma.

## Como demonstrar

1. `pnpm app:up`, abra um workflow e dê clique duplo num nó.
2. Arraste a linha entre Parâmetros e Saída: a coluna do meio cresce.
3. Feche e abra outro nó: a largura continua a mesma.
4. Clique duplo na linha: volta ao padrão.
