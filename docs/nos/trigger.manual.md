# Gatilho manual (`trigger.manual`)

Inicia o workflow manualmente. Equivale ao `n8n-nodes-base.manualTrigger`.

| Item | Valor |
|---|---|
| Categoria | Gatilho |
| Entradas | — |
| Saídas | `main` |
| Parâmetros | Nenhum |

## Comportamento

- Emite os itens recebidos pelo motor (por exemplo, os da execução de teste ou *pin data*).
- Sem itens recebidos, emite um item vazio: `[{ "json": {} }]`.

## Compatibilidade com o N8N

Idêntico. Introduzido na [spec 002](../../specs/002-editor-workflows-rbac/spec.md) (FR-017).
