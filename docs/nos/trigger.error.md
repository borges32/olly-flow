# Gatilho de erro (`trigger.error`)

Inicia um **workflow de erro**: um workflow acionado quando uma execução de produção de outro workflow falha. Equivale ao Error Trigger do N8N, com o mesmo payload.

| Item | Valor |
|---|---|
| Categoria | Gatilho |
| Entradas | — |
| Saídas | `main` |

## Como usar

1. Crie um workflow que comece por **Gatilho de erro** (ex.: Gatilho de erro → HTTP para o canal de alertas).
2. No workflow que deve ser vigiado, abra **Configurações** no editor e escolha o workflow de erro (`settings.errorWorkflowId`). Ele precisa ser do mesmo projeto, não pode ser o próprio workflow e precisa ter o Gatilho de erro.

## Payload

```json
{
  "execution": {
    "id": "…",
    "url": "https://<OLLY_PUBLIC_URL>/executions/…",
    "error": { "message": "…" },
    "lastNodeExecuted": "Nome do nó que falhou",
    "mode": "webhook"
  },
  "workflow": { "id": "…", "name": "…" }
}
```

## Comportamento

- **Quando aciona:** só quando uma execução de **produção** termina com erro, inclusive quando o worker se perde (`worker_lost`). Execuções de teste e canceladas não acionam.
- **Versão usada:** a publicada do workflow de erro, se houver; senão, a última salva. A execução aparece em Execuções com o gatilho `error`.
- **Sem recursão (FR-015):** uma execução iniciada por um workflow de erro nunca aciona outro workflow de erro, mesmo que falhe.
- **Teste pelo editor:** o gatilho emite um payload de exemplo.
- **Diferença do N8N:** o campo `execution.error.stack` não é enviado; o Olly Flow não expõe a pilha interna.

Introduzido na [spec 007](../../specs/007-controle-de-fluxo/spec.md) (FR-014, FR-015).
