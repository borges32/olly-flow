# Plano técnico — Spec 025: Redimensionar as colunas do painel do nó

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

Mudança só no editor (`apps/web`), sem dependência nova:
- **`column-sizes.ts`** (`apps/web/src/editor/ndv/`): funções puras para redimensionar (percentuais das três colunas) e para ler e gravar a preferência no `localStorage`.
- **`node-details-view.tsx`**: a grade de três colunas passa a usar as larguras do estado, com duas divisórias (`ColumnHandle`) entre elas, visíveis só na tela larga (`lg`).

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — Compatibilidade com o N8N | Mesmo comportamento do painel do N8N (divisórias arrastáveis) |
| IV — Testes | Unidade para o cálculo e a preferência; E2E do arrasto, da preferência e do clique duplo |
| IX — Simplicidade | Sem dependência nova: arrasto com Pointer Events e grade CSS |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `apps/web` | `ndv/column-sizes.ts` e testes; `ndv/node-details-view.tsx` (grade e divisórias); E2E |
| `docs/` | README dos nós (comportamentos do editor) |

## Design

### §1 `column-sizes.ts`

- **Larguras:** `[entrada, parâmetros, saída]` em percentuais que somam 100. Padrão `[32, 36, 32]`, próximo do layout anterior (`1fr 1.1fr 1fr`). Mínimo de 15% por coluna.
- **`resizeColumns(sizes, handle, deltaPercent)`:** a divisória `handle` (0 entre entrada e parâmetros, 1 entre parâmetros e saída) move `deltaPercent`; a coluna da esquerda cresce e a da direita diminui na mesma medida, limitadas ao mínimo. A terceira coluna não muda.
- **`loadColumnSizes(storage)` / `saveColumnSizes(storage, sizes)`:** chave `olly.ndv.columns`; valor inválido (não são três números, abaixo do mínimo ou soma diferente de 100) → padrão. Toda leitura e gravação em `try/catch` (armazenamento indisponível).

### §2 Painel do nó

- **Grade em `lg`:** `grid-template-columns: minmax(0, Afr) auto minmax(0, Bfr) auto minmax(0, Cfr)` com as larguras do estado. As divisórias são os itens `auto` (alça de 6 px com a linha de 1 px no meio), ocultas abaixo de `lg`, onde as colunas continuam empilhadas.
- **Arrasto:** `pointerdown` na divisória captura o ponteiro e guarda a posição e a largura da grade; `pointermove` converte o deslocamento em percentual e chama `resizeColumns`; `pointerup` grava a preferência.
- **Teclado:** `role="separator"`, `aria-orientation="vertical"`, `aria-label` ("Redimensionar entre Entrada e Parâmetros"), `aria-valuenow` com a largura da coluna da esquerda, `tabIndex=0`; ← e → movem 2%.
- **Clique duplo:** volta ao padrão e grava.
- O Monaco já usa `automaticLayout` e acompanha a largura da coluna.

## Modelo de dados

Sem mudança.

## Contratos

Sem mudança.

## Permissões RBAC

Nenhuma.

## Configuração

Nenhuma.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Implementação própria (Pointer Events + grade CSS) | `react-resizable-panels` | Poucas linhas, sem dependência nova; o comportamento necessário é simples |
| Preferência no `localStorage` | Preferência do usuário no servidor | Ajuste de conveniência por navegador; fora do escopo guardar no servidor |
| Percentuais | Pixels | Mantêm a proporção quando a janela muda de tamanho |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001, FR-002 | Unidade | `apps/web/src/editor/ndv/column-sizes.test.ts` |
| FR-001, FR-002, FR-003, SC-001 | E2E | `apps/web/e2e/test-run.spec.ts` › "spec 025…" |

## Riscos

| Risco | Mitigação |
|---|---|
| Coluna estreita demais para o formulário | Mínimo de 15% e clique duplo para voltar ao padrão |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 19/10/2026 | Criação do plano | Spec 025 |
