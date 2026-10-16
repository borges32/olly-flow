# Plano técnico — Spec 024: Destacar o próximo nó na execução nó a nó

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

Mudança só no editor (`apps/web`):
- **`nextNodes`** (`apps/web/src/editor/next-nodes.ts`): função pura que recebe nós, arestas e o estado da execução de teste e devolve os nós próximos e as arestas até eles.
- **Canvas:** o `editor-page.tsx` passa `next` para o nó e anima as arestas; o `WorkflowNodeView` desenha a borda e o selo "próximo".

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — Compatibilidade com o N8N | Sem efeito no formato do workflow; complementa o "Execute step" |
| IV — Testes | Unidade para o cálculo (ramos, erro, sub-nós, Merge, dados ocultos, execução em andamento) e E2E da execução nó a nó |
| IX — Simplicidade | Sem dependência nova, sem mudança na API |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `apps/web` | `next-nodes.ts` e testes; `workflow-node.tsx` (destaque); `editor-page.tsx` (dados do nó e arestas); E2E em `test-run.spec.ts` |
| `docs/` | README dos nós (comportamentos do editor) |

## Design

### §1 `nextNodes({ nodes, edges, run, isSubNodeEdge })`

- **Sem destaque** (FR-003): `run.status` `idle` ou `running`.
- **Origem:** nó com `status: 'success'` em `run.nodes`.
- **Saída com itens:** `output[fromPort].length > 0`. Sem `output` (dados ocultos, `dataRedacted`), vale `itemsOut > 0` para qualquer saída.
- **Destino próximo:** sem visão em `run.nodes`, ou com status `skipped` ou `cancelled` (não executou com os dados atuais). Executado (`success`, `error`, `running`, `waiting`) não é próximo.
- **Ignorados:** arestas de sub-nó (`isSubNodeEdge`), nós de origem ou destino inexistentes.
- **Retorno:** `{ nodeIds: Set<string>, edgeIds: Set<string> }`.

### §2 Canvas

- `OllyNodeData.next?: boolean` → `data-next` no nó, borda e anel violeta-azulado (`indigo`), distintos de execução (`primary`), sucesso (`emerald`), erro (`destructive`), aguardando (`sky`) e comparação (`emerald`/`amber`), e selo "próximo" (ícone `ChevronsRight`, `data-testid="node-next"`) no canto inferior esquerdo, sem conflitar com o status (canto inferior direito).
- Arestas em `edgeIds`: `animated: true`, como as de nó em execução.
- Fora da comparação de versões (o canvas da comparação não recebe `run`).

## Modelo de dados

Sem mudança.

## Contratos

Sem mudança.

## Permissões RBAC

Nenhuma: só visualização do estado da execução de teste já carregado.

## Configuração

Nenhuma.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Cálculo no editor pelo estado da execução | Pedir ao motor a lista de pendentes | O editor já tem a saída por porta de cada nó; sem mudança na API |
| `skipped` conta como pendente | Só nós sem visão | Depois de reexecutar um nó anterior, um nó que ficou "sem dados" numa execução antiga pode receber itens agora |
| Cor `indigo` + selo | Só mudar a cor | O selo deixa o estado claro também para quem tem dificuldade com cores |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001, FR-002, FR-003 | Unidade | `apps/web/src/editor/next-nodes.test.ts` |
| FR-001, SC-001 | E2E | `apps/web/e2e/test-run.spec.ts` › "spec 024…" |

## Riscos

| Risco | Mitigação |
|---|---|
| Nó executado numa iteração anterior de laço não aparece como próximo | Aceito: o laço mostra o status da última iteração |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 16/10/2026 | Criação do plano | Spec 024 |
