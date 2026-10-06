# Quando chamado por outro workflow (`trigger.executeWorkflow`)

Gatilho de sub-workflow: recebe os itens do workflow chamador. Equivale ao `n8n-nodes-base.executeWorkflowTrigger`.

| Item | Valor |
|---|---|
| Categoria | Gatilho |
| Entradas | — |
| Saídas | `main` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `inputSchema` | JSON Schema opcional, validado em cada item recebido (FR-011). Na spec 011, também descreve a entrada quando o workflow é ferramenta de um agente |

## Comportamento

- Emite os itens recebidos do chamador.
- Com `inputSchema`, um item fora do schema faz a execução falhar com a lista de problemas.
- Executado no editor, sem chamador, emite um item vazio, como o gatilho manual.
- O workflow precisa ser publicado para ser chamado.

Introduzido na [spec 008](../../specs/008-python-agendamento-subworkflow/spec.md) (FR-011), parte antecipada para a spec 011.
