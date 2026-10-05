# Enquanto (`logic.while`)

Repete um trecho do workflow enquanto uma condição for verdadeira, por exemplo para paginar uma API. Não existe no N8N; a divergência está prevista na [ADR-0001](../adr/0001-abordagem-hibrida.md).

| Item | Valor |
|---|---|
| Categoria | Lógica |
| Entradas | `main` (início), `continue` (Continuar: a volta do corpo) |
| Saídas | `loop` (Laço: entrada do corpo), `done` (Concluído) |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `condition` | Expressão booleana avaliada no início e a cada volta. `$json` é o primeiro item recebido e `$loop.index` é o número de voltas concluídas. Padrão: `={{ $loop.index < 3 }}` |
| `maxIterations` | Limite de iterações (padrão 100), limitado também pelo teto global `OLLY_MAX_LOOP_ITERATIONS` (10 000). Passar do limite com a condição ainda verdadeira é **erro**, com mensagem explícita |
| `accumulate` | O que sai em Concluído: `none` (os itens da última volta) ou `appendBodyOutput` (tudo o que o corpo devolveu, em ordem) |

## Como montar

```text
Gatilho → Enquanto ─Laço→ [corpo: nós…] ─→ Enquanto (Continuar)
             └─Concluído→ próximos nós
```

- **Volta:** o último nó do corpo volta para a entrada **Continuar**. O editor desenha essa aresta tracejada, por baixo dos nós.
- **Ciclos válidos:** um ciclo só é válido quando volta pela entrada Continuar de um nó de laço e quando o laço só recebe conexões de fora pela entrada principal do nó de laço (FR-008). Os outros ciclos são destacados no editor, com a regra no tooltip, e recusados ao salvar.
- **Laços aninhados:** podem ser usados, com um While dentro do corpo de outro.

## Comportamento

- **Cada volta:**
  - o corpo recomeça do zero;
  - `$('Nó')` dentro do corpo vê a **iteração atual**; fora do laço, vê a última;
  - cada execução de nó do corpo é registrada separadamente (`runIndex`);
  - no painel do nó, "Execução i de N" navega entre as iterações.
- **Variáveis `$loop`:** `index`, `maxIterations` e `accumulated` (os itens acumulados).
- **Sem itens:** se não chegarem itens, o laço termina; não há voltas vazias.

Introduzido na [spec 007](../../specs/007-controle-de-fluxo/spec.md) (FR-005–FR-010). Semântica: [docs/execucao.md](../execucao.md).
