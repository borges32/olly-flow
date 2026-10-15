# Plano técnico — Spec 023: Organizar os nós do workflow ("Tidy up")

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

Mudança só no editor (`apps/web`):
- **`tidyUp`** (`apps/web/src/editor/tidy-up.ts`): função pura que recebe nós, arestas, tamanhos e tipos e devolve as posições novas.
- **Layout dos nós principais:** pelo `@dagrejs/dagre`, em camadas da esquerda para a direita, com redução de cruzamentos. É o mesmo algoritmo do Tidy up do N8N.
- **Sub-nós:** cada nó principal entra no dagre como um bloco com os seus sub-nós embaixo (FR-002), e os sub-nós são posicionados dentro do bloco.
- **Ação do store:** um único `commit`, ou seja, um passo de desfazer, com o workflow marcado como alterado.
- **Disparo:** botão na barra do editor e atalho Shift+Alt+T.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — Compatibilidade com o N8N | Mesmo recurso (Tidy up), mesmo atalho, mesma regra de seleção, sub-nós embaixo do pai |
| IV — Testes | Unidade para o layout (sobreposição, ordem, sub-nós, seleção, laço, âncora, tempo) e E2E do botão, do atalho e do desfazer |
| IX — Simplicidade | Dependência nova justificada: `@dagrejs/dagre` (MIT), em vez de implementar a redução de cruzamentos |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `apps/web` | `tidy-up.ts` e `tidy-up.test.ts`; ação `tidyUp` no store; botão e atalho no `editor-page.tsx`; E2E |
| `docs/` | Seção no README dos nós (comportamentos do editor) |

## Design

### §1 `tidyUp(input)`

Entradas:
- `nodes` e `edges`;
- `sizes`: os tamanhos medidos pelo React Flow; sem medida, usa o padrão;
- `isSubNode(node)`: nó cujas saídas são todas `ai_*`, como em `subnodes.ts`;
- `inputOrder(node)`: os nomes das entradas, para a ordem dos sub-nós;
- `selection`: os ids selecionados.

Passos:
1. **Alvo:** com dois ou mais nós selecionados, os selecionados e os sub-nós deles (recursivamente); senão, todos (FR-003).
2. **Blocos:** cada nó principal do alvo vira um bloco com os sub-nós ligados a ele.
   - **Sub-nós:** ficam embaixo do pai, lado a lado, na ordem das entradas do pai; os sub-nós de sub-nós, embaixo do sub-nó.
   - **Medidas:** a largura do bloco é a maior entre a do nó e a da fileira de sub-nós; a altura soma o nó, o espaço e a altura da fileira. No bloco de um nó do fluxo principal, o mesmo espaço sobra em cima, para o nó ficar no centro do bloco, na linha do fluxo (o dagre alinha centros).
3. **dagre:** `rankdir: LR`, `nodesep: 60`, `ranksep: 120`, `marginx/marginy: 0`; as arestas são as principais entre os blocos do alvo.
   - **Partes desconectadas** são posicionadas pelo próprio dagre, sem sobreposição.
   - **Laços** (arestas de retorno) são resolvidos pelo dagre (o `acyclicer` padrão), que termina.
4. **Ordem dos ramos:** os destinos de um nó com várias saídas (If, Switch) são reempilhados na ordem das saídas (`outputOrder`), quando estão na mesma coluna, são vizinhos e só têm esse nó como origem. O dagre não conhece a ordem das portas.
5. **Posição:** o dagre devolve o centro de cada bloco. O nó principal fica centralizado no topo do bloco, e os sub-nós são distribuídos embaixo, centralizados sob o pai.
6. **Âncora:** desloca tudo para o canto superior esquerdo coincidir com o dos nós do alvo antes da organização (FR-004). Posições arredondadas para inteiros.
7. **Retorno:** `Record<id, [x, y]>`, só com os nós do alvo.

### §2 Store e editor

- **`tidyUp(positions)`:** um `commit({ nodes })`, que vale como um passo de desfazer e marca `dirty` (FR-005).
- **Botão "Organizar":** ícone `wand-sparkles`, na barra do editor, desabilitado na tela somente leitura e com menos de 2 nós. Depois de organizar, chama `fitView` (FR-001).
- **Atalho:** Shift+Alt+T, no mesmo tratador de teclas do canvas (fora de campos de texto e do painel do nó).

## Modelo de dados

Sem mudança.

## Contratos

Sem mudança: só as posições dos nós.

## Permissões RBAC

Nenhuma. Organizar é editar o rascunho (salvar continua exigindo `workflow:update`).

## Configuração

Nenhuma.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| `@dagrejs/dagre` (MIT, 3.x) | Estender o layout por camadas da importação (spec 015); `elkjs` | Redução de cruzamentos e ranqueamento prontos e testados; é o que o N8N e a documentação do React Flow usam; o `elkjs` é bem maior |
| Sub-nós como parte do bloco do pai | Sub-nós como nós do dagre | Garante os sub-nós embaixo do pai, como no N8N, sem arestas verticais confundindo as camadas |
| Âncora no canto superior esquerdo | Posição absoluta do dagre (a partir de 0,0) | O workflow não "pula" no canvas, e a organização de uma seleção fica onde ela estava |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001, FR-002, FR-003, FR-004, NFR-001, SC-001 | Unidade | `apps/web/src/editor/tidy-up.test.ts` |
| FR-001, FR-005, SC-002 | E2E | `apps/web/e2e/editor.spec.ts` (botão, atalho, desfazer, somente leitura) |

## Riscos

| Risco | Mitigação |
|---|---|
| Tamanho real ainda não medido (nó recém-criado) | Tamanho padrão do nó como alternativa |
| Workflows muito grandes | NFR-001 medido no teste com 100 nós |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 15/10/2026 | Criação do plano | Spec 023 |
| 15/10/2026 | Ordem dos ramos pelas saídas (`outputOrder`) e bloco simétrico do nó pai, depois da conferência visual (ramo "falso" em cima; Agent acima da linha do fluxo) | Implementação |
