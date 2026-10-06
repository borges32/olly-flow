# Memórias do agente (`memory.*`)

Sub-nós conectados à porta **Memória** do [Agente de IA](ai.agent.md) (no máximo uma). Guardam a conversa por **chave de sessão**: o histórico vai para o modelo antes do pedido, e o pedido e a resposta final são acrescentados ao fim.

| Tipo | Nó | Duração | Equivalente no N8N |
|---|---|---|---|
| `memory.postgres` | Memória persistente | Entre execuções, até a retenção | Postgres Chat Memory |
| `memory.buffer` | Memória temporária | Só durante a execução | Simple Memory |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `sessionKey` | Identifica a conversa (ex.: o id do usuário ou do chat). Aceita expressão; padrão `{{ $json.sessionId }}`. Vazia, o item falha |
| `contextWindowLength` | Quantas mensagens anteriores (perguntas e respostas) vão para o modelo (padrão 10, máximo 200) |

## Comportamento (FR-009)

- **Persistente:** grava em `agent_memory`, isolada por projeto (a mesma chave em outro projeto é outra conversa). As mensagens são apagadas após `retention.memoryDays` do projeto (Projetos › Governança; padrão `OLLY_RETENTION_MEMORY_DAYS`, 30 dias) pelo job de manutenção.
- **Temporária:** vive no processo da execução: dois itens com a mesma chave na mesma execução compartilham a conversa; uma nova execução começa vazia. Não sobrevive a uma pausa para aprovação.
- A conversa guardada contém o que o usuário escreveu e o que o modelo respondeu. Evite usar dados pessoais como chave de sessão e defina a retenção conforme a LGPD.

Introduzido na [spec 011](../../specs/011-ai-agent/spec.md) (FR-009).
