# Se (`logic.if`)

Encaminha cada item para a saída **Verdadeiro** ou **Falso** conforme condições tipadas. Equivale ao `n8n-nodes-base.if` v2.

| Item | Valor |
|---|---|
| Categoria | Lógica |
| Entradas | `main` |
| Saídas | `true` (Verdadeiro), `false` (Falso) |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `conditions.combinator` | `and` (todas as condições) ou `or` (pelo menos uma). Sem condições, o item vai para Verdadeiro |
| `conditions.conditions[]` | Lista de `{ leftValue, operator: { type, operation }, rightValue }` |
| `looseTypeValidation` | Conversão flexível de tipos (padrão `false`) |

## Operações

| Tipo | Operações |
|---|---|
| `string` | `equals`, `notEquals`, `contains`, `notContains`, `startsWith`, `endsWith`, `regex` (`padrão` ou `/padrão/flags`), `isEmpty`, `isNotEmpty` |
| `number` | `equals`, `notEquals`, `gt`, `gte`, `lt`, `lte`, `isEmpty`, `isNotEmpty` |
| `boolean` | `true`, `false`, `equals` |
| `dateTime` | `equals`, `after`, `before` (texto ISO 8601; com fuso, compara o instante) |
| `array` | `contains`, `lengthEquals`, `isEmpty`, `isNotEmpty` |
| `object` | `isEmpty`, `isNotEmpty` |

## Tipos

- **Texto digitado** no editor é sempre convertido para o tipo da condição (o campo `18` vale o número 18).
- **Resultado de expressão** precisa ter o tipo da condição, como no N8N: `={{ $json.idade }}` com valor `"18"` (texto) numa condição `number` gera erro `tipo incorreto`. Com **Conversão flexível de tipos**, o valor é convertido (`"18"` → 18, `"true"` → `true`, JSON → lista/objeto).

## Comportamento

- Avalia as condições por item; cada item sai com `pairedItem` apontando o item de entrada, para que `$('Nó').item` funcione depois do If.
- Uma saída sem itens não executa os nós ligados a ela.

Introduzido na [spec 003](../../specs/003-expressoes-execucao-teste/spec.md) (FR-010).
