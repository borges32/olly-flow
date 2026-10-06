# Executar sub-workflow (`flow.executeWorkflow`)

Chama outro workflow publicado como sub-workflow e recebe a saída do último nó. Equivale ao `n8n-nodes-base.executeWorkflow`.

| Item | Valor |
|---|---|
| Categoria | Fluxo |
| Entradas | `main` |
| Saídas | `main` (e `error` com `onError: errorOutput`) |
| Itens em paralelo | Sim (modo `perItem`, `settings.parallelItems`) |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `workflowId` | Workflow chamado: precisa estar **publicado** e ter o gatilho [Quando chamado por outro workflow](trigger.executeWorkflow.md) |
| `mode` | `once` (padrão): uma chamada com todos os itens; `perItem`: uma chamada por item |
| `waitForCompletion` | Padrão ligado: aguarda o fim e devolve os itens do último nó. Desligado: o filho vai para a fila e o nó segue com os próprios itens |

## Comportamento

- **Versão:** roda a versão publicada do workflow chamado.
- **Permissão:** no mesmo projeto, vale a de quem disparou a execução. Em outro projeto, o dono da execução (quem a disparou ou, sem usuário, o dono do workflow) precisa ter `workflow:execute` como membro do projeto chamado.
- **Vínculo (FR-010):** a execução filha registra a execução pai (`parent_execution_id`) e a profundidade. Ela aparece na lista de execuções com o gatilho `subworkflow`.
- **Profundidade:** limitada por `OLLY_MAX_SUBWORKFLOW_DEPTH` (padrão 5).
- **Recursão:** chamar um workflow que já está na cadeia (inclusive o próprio) falha com "Recursão detectada".
- **Ordem (SC-006):** no modo `perItem`, os resultados seguem a ordem dos itens, mesmo em paralelo.
- **Aguardando o término:** a filha roda no mesmo worker do pai (usa a vaga da cota do pai). Se ela entrar em espera (ex.: um Esperar longo), o nó falha. Para sub-workflows que esperam, desligue "Aguardar o término".
- **Erros:** falha da filha vira erro do nó com a mensagem dela, sujeito ao `onError`.

Introduzido na [spec 008](../../specs/008-python-agendamento-subworkflow/spec.md) (FR-009, FR-010), parte antecipada para a spec 011.
