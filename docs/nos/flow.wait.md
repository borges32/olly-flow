# Esperar (`flow.wait`)

Pausa a execução por um intervalo ou até uma data/hora e segue com os mesmos itens. Equivale ao `n8n-nodes-base.wait` nos modos de tempo.

| Item | Valor |
|---|---|
| Categoria | Fluxo |
| Entradas | `main` |
| Saídas | `main` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `resume` | `timeInterval` (padrão): depois de um intervalo; `specificTime`: numa data/hora |
| `amount`, `unit` | Intervalo: quantidade e unidade (`seconds`, `minutes` (padrão), `hours`, `days`) |
| `dateTime` | Data/hora em ISO 8601 (ex.: `2026-10-06T14:30:00-03:00`). Aceita expressão |

Os parâmetros são lidos do primeiro item: a espera vale para o nó inteiro.

## Comportamento

- **Até 60 s:** a espera fica em memória (o worker continua ocupado) e o cancelamento a interrompe.
- **Acima de 60 s (NFR-002):** a execução fica `waiting`, o estado do motor é gravado (`execution_state`) e o worker é liberado. No horário, qualquer worker retoma a execução a partir do estado salvo e o nó segue com os itens.
- **Ramos independentes** do Esperar continuam executando; só o que depende dele aguarda.
- **Data no passado** (ou intervalo zero): segue na hora.
- **Cancelar** uma execução em espera a encerra na hora e descarta o estado.
- A espera não conta como falha: retry e `onError` não se aplicam.

## Divergências do N8N

- Os modos de retomada por webhook e por formulário do N8N não foram implementados (fora do escopo da spec 008).

Introduzido na [spec 008](../../specs/008-python-agendamento-subworkflow/spec.md) (FR-012), parte antecipada para a spec 011.
