# Basic LLM Chain (`ai.chainLlm`)

Envia um prompt ao modelo de chat ligado ao nó e devolve a resposta: **uma chamada por item**, sem ferramentas, memória ou ciclos de raciocínio. Serve para resumir, classificar, extrair campos, traduzir ou gerar texto. Equivale ao "Basic LLM Chain" (`@n8n/n8n-nodes-langchain.chainLlm`) do N8N. Para usar ferramentas ou memória, use o [Agent](ai.agent.md).

| Item | Valor |
|---|---|
| Categoria | IA |
| Entradas | `main`; `ai_languageModel` ("Modelo", obrigatória, 1 modelo); com `needsFallback`, `ai_fallbackModel` ("Modelo reserva", obrigatória, 1 modelo) |
| Saída | `main` (e `error` com "saída de erro") |
| Modelos aceitos | [Modelo de chat](ai.chatModel.md) e [Bridge Chat Model](ai.bridgeChatModel.md) |
| Itens | Em paralelo com a concorrência do nó (spec 006), quando ligada; senão, um por vez |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `promptSource` | `fromInput` (padrão): o prompt é o campo `chatInput` do item. `define`: o texto de `text` |
| `text` | Texto do prompt, com expressões (ex.: `=Resuma: {{ $json.texto }}`) |
| `messages` | Lista de mensagens enviadas **antes** do prompt, na ordem: `{ role: "system" \| "user" \| "assistant", text }`. Use `system` para instruções e pares `user`/`assistant` como exemplos. Só texto (sem imagens) |
| `hasOutputParser` | "Exigir formato específico": acrescenta a entrada **Output Parser** (`ai_outputParser`), onde se liga um [output parser](output-parsers.md) (spec 018) |
| `needsFallback` | Acrescenta a entrada **Modelo reserva** |

## Saída

- **Sem output parser:** `{ "text": "<resposta>" }`, como no N8N (as expressões `$json.text` dos workflows migrados continuam valendo).
- **Com output parser:** `{ "output": <valor> }`: o objeto do Structured Output Parser ou a lista do Item List. Com a correção automática do Structured (`autoFix`), o nó pede a correção ao modelo que respondeu, até 2 vezes. Depois disso, o item falha com `A resposta do modelo não seguiu o formato do output parser após 2 correções`. O Auto-fixing corrige com o próprio modelo.

## Comportamento

- **Uma chamada por item:**
  - as mensagens adicionais vêm primeiro, na ordem; o prompt vem por último;
  - um prompt vazio faz o item falhar, citando o parâmetro;
  - uma mensagem adicional com texto vazio é ignorada.
- **Modelo reserva:** com `needsFallback`, se a chamada ao modelo principal falhar (depois das novas tentativas do próprio modelo), a mesma chamada vai ao reserva. Pontos a saber:
  - se os dois falharem, o erro cita os dois;
  - o **limite mensal de tokens** e o **cancelamento** não acionam o reserva;
  - as correções do formato usam o modelo que respondeu.
- **Governança (spec 011):**
  - o Modelo de chat aplica a lista de modelos permitidos (a Bridge não usa lista);
  - o limite mensal de tokens do projeto bloqueia a chamada;
  - o uso e o custo são registrados por chamada, com o provedor e o modelo que respondeu.
- **Passos no painel:** cada chamada vira um passo, mostrado no painel do nó ("Chamadas ao modelo") em tempo real e depois da execução. Os passos são mascarados (spec 009), e o conteúdo exige a permissão de ver os dados da execução.
  - **`model`:** traz as mensagens enviadas, a resposta, os tokens, o provedor e o modelo; a etiqueta **modelo reserva** aparece quando o reserva respondeu;
  - **`error`:** registra a falha do principal antes da troca;
  - **`final`:** traz a saída do item.
- **Tratamento de erro:** "continuar" e "saída de erro" valem por item.

## Exemplo (trecho do JSON do workflow)

```json
{
  "name": "Classificar chamado",
  "type": "ai.chainLlm",
  "typeVersion": 1,
  "position": [300, 0],
  "parameters": {
    "promptSource": "define",
    "text": "=Classifique o chamado: {{ $json.descricao }}",
    "messages": [{ "role": "system", "text": "Responda só com a categoria." }],
    "hasOutputParser": true,
    "needsFallback": false
  }
}
```

Ligue um modelo à entrada `ai_languageModel` (índice 0) e, com `needsFallback`, o reserva à mesma entrada de índice 1 (ver [workflow-json.md](workflow-json.md)).

## Divergências do N8N

- **Formato estruturado:** pelos [output parsers](output-parsers.md), como no N8N (spec 018).
- **Mensagens com imagem e processamento em lotes:** não existem. Vale a execução paralela por item.
- **Saída estruturada:** o objeto fica em `output`.

Introduzido na [spec 017](../../specs/017-basic-llm-chain/spec.md).
